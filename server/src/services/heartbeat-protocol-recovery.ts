import { and, desc, eq, gt, inArray } from "drizzle-orm";
import type { Db } from "@squadrail/db";
import {
  heartbeatRunEvents,
  heartbeatRunLeases,
  heartbeatRuns,
  issueProtocolMessages,
  issueProtocolState,
  issues,
} from "@squadrail/db";
import { resolveProtocolRunRequirement } from "@squadrail/shared";
import { runningProcesses } from "../adapters/index.js";
import { parseObject } from "../adapters/utils.js";
import { logger } from "../middleware/logger.js";
import { readNonEmptyString } from "./heartbeat-runtime-utils.js";
import {
  RUN_IMPLEMENTATION_PROGRESS_ONLY_WATCHDOG_MS,
  RUN_PROTOCOL_DEGRADED_WATCHDOG_MS,
  RUN_PROTOCOL_IDLE_WATCHDOG_MS,
  isIdleProtocolWatchdogEligibleRequirement,
  refreshProtocolRetryContextSnapshot,
  resolveDegradedProtocolRecoveryReason,
  resolveProtocolIdleWatchdogDelayMs,
  runDispatchWatchdogOutsideDbContext,
  runProtocolWatchdogRecoveries,
  shouldRecoverDegradedProtocolRun,
  shouldRecoverIdleProtocolRun,
  shouldSkipSupersededProtocolFollowup,
} from "./heartbeat-protocol-watchdog.js";
import type { HeartbeatWakeupOptions } from "./heartbeat-wakeup-control.js";

export function createHeartbeatProtocolRecovery(input: {
  db: Db;
  getRun: (runId: string) => Promise<typeof heartbeatRuns.$inferSelect | null>;
  getRunLease: (runId: string) => Promise<typeof heartbeatRunLeases.$inferSelect | null>;
  clearProtocolIdleWatchdog: (runId: string, opts?: { resetAttempts?: boolean }) => void;
  enqueueWakeup: (
    agentId: string,
    opts?: HeartbeatWakeupOptions,
  ) => Promise<typeof heartbeatRuns.$inferSelect | null>;
  cancelRunInternal: (
    runId: string,
    opts?: { message?: string; checkpointMessage?: string },
  ) => Promise<typeof heartbeatRuns.$inferSelect | null>;
  assistDegradedRun: (input: {
    runId: string;
    issueId: string;
    companyId: string;
    agentId: string;
    degradedReason: string;
    contextSnapshot: Record<string, unknown>;
  }) => Promise<boolean>;
  protocolIdleWatchdogTimers: Map<string, ReturnType<typeof setTimeout>>;
  protocolIdleWatchdogAttempts: Map<string, number>;
}) {
  const {
    db,
    getRun,
    getRunLease,
    clearProtocolIdleWatchdog,
    enqueueWakeup,
    cancelRunInternal,
    assistDegradedRun,
    protocolIdleWatchdogTimers,
    protocolIdleWatchdogAttempts,
  } = input;

  async function recoverIdleProtocolRunIfNeeded(inputValue: {
    run: typeof heartbeatRuns.$inferSelect;
    lease?: typeof heartbeatRunLeases.$inferSelect | null;
    now?: Date;
    idleThresholdMs?: number;
  }) {
    if (!runningProcesses.has(inputValue.run.id)) return false;
    const context = parseObject(inputValue.run.contextSnapshot);
    const issueId = readNonEmptyString(context.issueId);
    if (!issueId) return false;

    const requirement = resolveProtocolRunRequirement({
      protocolMessageType: readNonEmptyString(context.protocolMessageType),
      protocolRecipientRole: readNonEmptyString(context.protocolRecipientRole),
    });
    if (!isIdleProtocolWatchdogEligibleRequirement(requirement) && requirement?.key !== "implementation_engineer") {
      return false;
    }

    const issueStateSnapshot = await db
      .select({
        status: issues.status,
        workflowState: issueProtocolState.workflowState,
      })
      .from(issues)
      .leftJoin(
        issueProtocolState,
        and(
          eq(issueProtocolState.issueId, issues.id),
          eq(issueProtocolState.companyId, issues.companyId),
        ),
      )
      .where(and(eq(issues.id, issueId), eq(issues.companyId, inputValue.run.companyId)))
      .limit(1)
      .then((rows) => rows[0] ?? null);
    const latestEvent = await db
      .select({
        eventType: heartbeatRunEvents.eventType,
        createdAt: heartbeatRunEvents.createdAt,
      })
      .from(heartbeatRunEvents)
      .where(eq(heartbeatRunEvents.runId, inputValue.run.id))
      .orderBy(desc(heartbeatRunEvents.seq))
      .limit(1)
      .then((rows) => rows[0] ?? null);
    const protocolMessageWindowStart = inputValue.run.startedAt
      ? new Date(inputValue.run.startedAt.getTime() - 1_000)
      : null;
    const protocolMessages = protocolMessageWindowStart
      ? await db
        .select({
          messageType: issueProtocolMessages.messageType,
          payload: issueProtocolMessages.payload,
          createdAt: issueProtocolMessages.createdAt,
        })
        .from(issueProtocolMessages)
        .where(
          and(
            eq(issueProtocolMessages.companyId, inputValue.run.companyId),
            eq(issueProtocolMessages.issueId, issueId),
            eq(issueProtocolMessages.senderActorType, "agent"),
            eq(issueProtocolMessages.senderActorId, inputValue.run.agentId),
            gt(issueProtocolMessages.createdAt, protocolMessageWindowStart),
          ),
        )
        .orderBy(desc(issueProtocolMessages.createdAt))
      : [];
    const protocolRetryCount =
      typeof context.protocolRequiredRetryCount === "number" && Number.isFinite(context.protocolRequiredRetryCount)
        ? context.protocolRequiredRetryCount
        : 0;

    if (!shouldRecoverIdleProtocolRun({
      runStatus: inputValue.run.status,
      hasRunningProcess: true,
      requirement,
      issueStatus: issueStateSnapshot?.status ?? null,
      workflowState: issueStateSnapshot?.workflowState ?? null,
      protocolRetryCount,
      checkpointJson: inputValue.lease?.checkpointJson ?? null,
      messages: protocolMessages,
      latestEvent,
      startedAt: inputValue.run.startedAt,
      now: inputValue.now,
      idleThresholdMs:
        requirement?.key === "implementation_engineer"
          ? Math.max(inputValue.idleThresholdMs ?? 0, RUN_IMPLEMENTATION_PROGRESS_ONLY_WATCHDOG_MS)
          : inputValue.idleThresholdMs,
    })) {
      return false;
    }

    const checkpoint = parseObject(inputValue.lease?.checkpointJson);
    await enqueueWakeup(inputValue.run.agentId, {
      source: "automation",
      triggerDetail: "system",
      reason: "protocol_required_retry",
      payload: {
        issueId,
        protocolRequiredPreviousRunId: inputValue.run.id,
        protocolIdleRecovery: true,
      },
      contextSnapshot: refreshProtocolRetryContextSnapshot({
        contextSnapshot: {
          ...context,
          issueId,
          taskId: issueId,
          wakeReason: "protocol_required_retry",
          protocolOriginalWakeReason: readNonEmptyString(context.wakeReason),
          protocolRequiredRetryCount: protocolRetryCount + 1,
          protocolRequiredPreviousRunId: inputValue.run.id,
          protocolIdleRecovery: true,
          protocolIdleRecoveryPhase:
            readNonEmptyString(checkpoint.phase)
            ?? readNonEmptyString(latestEvent?.eventType),
          forceFollowupRun: true,
          forceFreshAdapterSession: true,
        },
        workflowState: issueStateSnapshot?.workflowState ?? null,
      }),
    });

    await cancelRunInternal(inputValue.run.id, {
      message: "Cancelled stalled protocol follow-up after idle adapter startup",
      checkpointMessage: "run cancelled after idle protocol stall",
    });
    return true;
  }

  async function recoverDegradedProtocolRunIfNeeded(inputValue: {
    run: typeof heartbeatRuns.$inferSelect;
    lease?: typeof heartbeatRunLeases.$inferSelect | null;
    now?: Date;
    degradedThresholdMs?: number;
  }) {
    if (!runningProcesses.has(inputValue.run.id)) return false;
    const context = parseObject(inputValue.run.contextSnapshot);
    const issueId = readNonEmptyString(context.issueId);
    if (!issueId) return false;

    const requirement = resolveProtocolRunRequirement({
      protocolMessageType: readNonEmptyString(context.protocolMessageType),
      protocolRecipientRole: readNonEmptyString(context.protocolRecipientRole),
    });
    const issueStateSnapshot = await db
      .select({
        status: issues.status,
        workflowState: issueProtocolState.workflowState,
      })
      .from(issues)
      .leftJoin(
        issueProtocolState,
        and(
          eq(issueProtocolState.issueId, issues.id),
          eq(issueProtocolState.companyId, issues.companyId),
        ),
      )
      .where(and(eq(issues.id, issueId), eq(issues.companyId, inputValue.run.companyId)))
      .limit(1)
      .then((rows) => rows[0] ?? null);
    const protocolRetryCount =
      typeof context.protocolRequiredRetryCount === "number" && Number.isFinite(context.protocolRequiredRetryCount)
        ? context.protocolRequiredRetryCount
        : 0;
    const protocolDegradedRecoveryCount =
      typeof context.protocolDegradedRecoveryCount === "number" && Number.isFinite(context.protocolDegradedRecoveryCount)
        ? context.protocolDegradedRecoveryCount
        : 0;
    const adapterRetryCount =
      typeof context.adapterRetryCount === "number" && Number.isFinite(context.adapterRetryCount)
        ? context.adapterRetryCount
        : 0;
    const adapterRetryErrorCode = readNonEmptyString(context.adapterRetryErrorCode);

    if (!shouldRecoverDegradedProtocolRun({
      runStatus: inputValue.run.status,
      hasRunningProcess: true,
      requirement,
      wakeReason: readNonEmptyString(context.wakeReason),
      issueStatus: issueStateSnapshot?.status ?? null,
      workflowState: issueStateSnapshot?.workflowState ?? null,
      protocolRetryCount,
      protocolDegradedRecoveryCount,
      adapterRetryCount,
      adapterRetryErrorCode,
      checkpointJson: inputValue.lease?.checkpointJson ?? null,
      startedAt: inputValue.run.startedAt,
      now: inputValue.now,
      degradedThresholdMs: inputValue.degradedThresholdMs,
    })) {
      return false;
    }

    const degradedReason = resolveDegradedProtocolRecoveryReason({
      runStatus: inputValue.run.status,
      requirement,
      wakeReason: readNonEmptyString(context.wakeReason),
      adapterRetryCount,
      adapterRetryErrorCode,
      checkpointJson: inputValue.lease?.checkpointJson ?? null,
      startedAt: inputValue.run.startedAt,
      now: inputValue.now,
      degradedThresholdMs: inputValue.degradedThresholdMs,
    });
    if (!degradedReason) return false;

    const autoAssisted = await assistDegradedRun({
      runId: inputValue.run.id,
      issueId,
      companyId: inputValue.run.companyId,
      agentId: inputValue.run.agentId,
      degradedReason,
      contextSnapshot: context,
    }).catch((err) => {
      logger.warn(
        {
          err,
          runId: inputValue.run.id,
          issueId,
          degradedReason,
        },
        "local-trusted deterministic protocol auto-assist failed",
      );
      return false;
    });
    if (autoAssisted) {
      await cancelRunInternal(inputValue.run.id, {
        message: `Cancelled degraded protocol run after deterministic local-trusted auto-assist (${degradedReason})`,
        checkpointMessage: "run cancelled after deterministic local-trusted protocol auto-assist",
      });
      return true;
    }

    await enqueueWakeup(inputValue.run.agentId, {
      source: "automation",
      triggerDetail: "system",
      reason: "protocol_required_retry",
      payload: {
        issueId,
        protocolRequiredPreviousRunId: inputValue.run.id,
        protocolDegradedRecovery: true,
        protocolDegradedRecoveryReason: degradedReason,
      },
      contextSnapshot: refreshProtocolRetryContextSnapshot({
        contextSnapshot: {
          ...context,
          issueId,
          taskId: issueId,
          wakeReason: "protocol_required_retry",
          protocolOriginalWakeReason: readNonEmptyString(context.wakeReason),
          protocolRequiredRetryCount: protocolRetryCount + 1,
          protocolDegradedRecoveryCount: protocolDegradedRecoveryCount + 1,
          protocolRequiredPreviousRunId: inputValue.run.id,
          protocolDegradedRecovery: true,
          protocolDegradedRecoveryReason: degradedReason,
          forceFollowupRun: true,
          forceFreshAdapterSession: true,
        },
        workflowState: issueStateSnapshot?.workflowState ?? null,
      }),
    });

    await cancelRunInternal(inputValue.run.id, {
      message: `Cancelled degraded protocol follow-up after degraded runtime detection (${degradedReason})`,
      checkpointMessage: "run cancelled after degraded protocol runtime detection",
    });
    return true;
  }

  async function cancelSupersededProtocolRunIfNeeded(inputValue: {
    run: typeof heartbeatRuns.$inferSelect;
    context: Record<string, unknown>;
  }) {
    if (inputValue.run.status !== "running") return false;
    if (!runningProcesses.has(inputValue.run.id)) return false;

    const issueId = readNonEmptyString(inputValue.context.issueId);
    if (!issueId) return false;

    const issueStateSnapshot = await db
      .select({
        status: issues.status,
        workflowState: issueProtocolState.workflowState,
      })
      .from(issues)
      .leftJoin(
        issueProtocolState,
        and(
          eq(issueProtocolState.issueId, issues.id),
          eq(issueProtocolState.companyId, issues.companyId),
        ),
      )
      .where(and(eq(issues.id, issueId), eq(issues.companyId, inputValue.run.companyId)))
      .limit(1)
      .then((rows) => rows[0] ?? null);

    if (!shouldSkipSupersededProtocolFollowup({
      wakeReason: readNonEmptyString(inputValue.context.wakeReason),
      issueStatus: issueStateSnapshot?.status ?? null,
      workflowState: issueStateSnapshot?.workflowState ?? null,
      protocolMessageType: readNonEmptyString(inputValue.context.protocolMessageType),
      protocolRecipientRole: readNonEmptyString(inputValue.context.protocolRecipientRole),
    })) {
      return false;
    }

    const message =
      issueStateSnapshot?.status === "done" || issueStateSnapshot?.status === "cancelled"
        ? `Cancelled superseded protocol run because issue is already ${issueStateSnapshot.status}.`
        : "Cancelled superseded protocol run because issue workflow moved beyond this protocol lane.";

    await cancelRunInternal(inputValue.run.id, {
      message,
      checkpointMessage: "run cancelled after superseded protocol workflow transition",
    });
    return true;
  }

  async function handleProtocolIdleWatchdog(runId: string) {
    protocolIdleWatchdogTimers.delete(runId);

    const run = await getRun(runId);
    if (!run || run.status !== "running") {
      clearProtocolIdleWatchdog(runId);
      return;
    }

    const lease = await getRunLease(run.id);
    const recovered = await runProtocolWatchdogRecoveries({
      recoverIdle: () => recoverIdleProtocolRunIfNeeded({
        run,
        lease,
        now: new Date(),
        idleThresholdMs: RUN_PROTOCOL_IDLE_WATCHDOG_MS,
      }),
      recoverDegraded: () => recoverDegradedProtocolRunIfNeeded({
        run,
        lease,
        now: new Date(),
        degradedThresholdMs: RUN_PROTOCOL_DEGRADED_WATCHDOG_MS,
      }),
      onIdleError: (err) => {
        logger.error({ err, runId: run.id }, "idle protocol recovery failed");
      },
      onDegradedError: (err) => {
        logger.error({ err, runId: run.id }, "degraded protocol recovery failed");
      },
    });
    if (recovered) {
      protocolIdleWatchdogAttempts.delete(run.id);
    }
    if (!recovered && runningProcesses.has(run.id)) {
      scheduleProtocolIdleWatchdog(run.id);
    }
  }

  function scheduleProtocolIdleWatchdog(runId: string) {
    clearProtocolIdleWatchdog(runId, { resetAttempts: false });
    const attempt = protocolIdleWatchdogAttempts.get(runId) ?? 0;
    const delayMs = resolveProtocolIdleWatchdogDelayMs(attempt);
    const timer = setTimeout(() => {
      runDispatchWatchdogOutsideDbContext(() => {
        void handleProtocolIdleWatchdog(runId).catch((err) => {
          logger.error({ err, runId }, "idle protocol watchdog failed");
        });
      });
    }, delayMs);
    timer.unref?.();
    protocolIdleWatchdogTimers.set(runId, timer);
    protocolIdleWatchdogAttempts.set(runId, attempt + 1);
  }

  async function recoverIdleProtocolRuns(opts?: { idleThresholdMs?: number }) {
    const now = new Date();
    const idleThresholdMs = opts?.idleThresholdMs ?? RUN_PROTOCOL_IDLE_WATCHDOG_MS;
    const activeRuns = await db
      .select()
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.status, "running"));
    const leases = activeRuns.length > 0
      ? await db
          .select()
          .from(heartbeatRunLeases)
          .where(inArray(heartbeatRunLeases.runId, activeRuns.map((run) => run.id)))
      : [];
    const leaseByRunId = new Map(leases.map((lease) => [lease.runId, lease]));
    const recovered: string[] = [];

    for (const run of activeRuns) {
      const lease = leaseByRunId.get(run.id) ?? null;
      const didRecover = await runProtocolWatchdogRecoveries({
        recoverIdle: () => recoverIdleProtocolRunIfNeeded({
          run,
          lease,
          now,
          idleThresholdMs,
        }),
        recoverDegraded: () => recoverDegradedProtocolRunIfNeeded({
          run,
          lease,
          now,
          degradedThresholdMs: RUN_PROTOCOL_DEGRADED_WATCHDOG_MS,
        }),
        onIdleError: (err) => {
          logger.error({ err, runId: run.id }, "idle protocol recovery failed during scan");
        },
        onDegradedError: (err) => {
          logger.error({ err, runId: run.id }, "degraded protocol recovery failed during scan");
        },
      });
      if (didRecover) {
        recovered.push(run.id);
      }
    }

    if (recovered.length > 0) {
      logger.warn({ recoveredCount: recovered.length, runIds: recovered }, "recovered protocol heartbeat runs");
    }

    return { recovered: recovered.length, runIds: recovered };
  }

  return {
    cancelSupersededProtocolRunIfNeeded,
    handleProtocolIdleWatchdog,
    recoverDegradedProtocolRunIfNeeded,
    recoverIdleProtocolRunIfNeeded,
    recoverIdleProtocolRuns,
    scheduleProtocolIdleWatchdog,
  };
}
