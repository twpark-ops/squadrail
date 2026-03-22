import { and, desc, eq, inArray } from "drizzle-orm";
import { runWithoutDbContext, type Db } from "@squadrail/db";
import {
  agents,
  heartbeatRunLeases,
  heartbeatRuns,
} from "@squadrail/db";
import { runningProcesses } from "../adapters/index.js";
import { logger } from "../middleware/logger.js";
import { logActivity } from "./activity-log.js";
import {
  buildDispatchPriorityContextSnapshot,
  buildDispatchPrioritySelectionDetails,
  type HeartbeatQueuedRunPrioritySelection,
} from "./heartbeat-dispatch-priority.js";
import { shouldReapHeartbeatRun, decideDispatchWatchdogAction, scheduleDeferredRunDispatch } from "./heartbeat-protocol-watchdog.js";
import { buildProcessLostError, readNonEmptyString } from "./heartbeat-runtime-utils.js";
import type { LiveEventType } from "@squadrail/shared";
import { parseObject } from "../adapters/utils.js";

type PublishHeartbeatLiveEvent = (input: {
  companyId: string;
  type: LiveEventType;
  payload?: Record<string, unknown>;
}) => unknown;

export function createHeartbeatDispatchLifecycle(input: {
  db: Db;
  publishLiveEvent: PublishHeartbeatLiveEvent;
  getAgent: (agentId: string) => Promise<typeof agents.$inferSelect | null>;
  getRun: (runId: string) => Promise<typeof heartbeatRuns.$inferSelect | null>;
  getRunLease: (runId: string) => Promise<typeof heartbeatRunLeases.$inferSelect | null>;
  countRunningRunsForAgent: (agentId: string) => Promise<number>;
  nextRunEventSeq: (runId: string) => Promise<number>;
  parseHeartbeatPolicy: (agent: typeof agents.$inferSelect) => { maxConcurrentRuns: number };
  setRunStatus: (
    runId: string,
    status: string,
    patch?: Partial<typeof heartbeatRuns.$inferInsert>,
  ) => Promise<typeof heartbeatRuns.$inferSelect | null>;
  setWakeupStatus: (
    wakeupRequestId: string | null | undefined,
    status: string,
    patch?: Record<string, unknown>,
  ) => Promise<void>;
  upsertRunLease: (input: {
    run: typeof heartbeatRuns.$inferSelect;
    status: string;
    checkpointJson?: Record<string, unknown> | null;
    heartbeatAt?: Date;
    leaseExpiresAt?: Date;
    releasedAt?: Date | null;
    lastError?: string | null;
  }) => Promise<void>;
  appendRunEvent: (
    run: typeof heartbeatRuns.$inferSelect,
    seq: number,
    event: {
      eventType: string;
      stream?: "system" | "stdout" | "stderr";
      level?: "info" | "warn" | "error";
      color?: string;
      message?: string;
      payload?: Record<string, unknown>;
    },
  ) => Promise<void>;
  clearDispatchWatchdog: (runId: string) => void;
  scheduleDispatchWatchdog: (runId: string) => void;
  clearProtocolIdleWatchdog: (runId: string, opts?: { resetAttempts?: boolean }) => void;
  dispatchWatchdogAttempts: Map<string, number>;
  releaseIssueExecutionAndPromote: (run: typeof heartbeatRuns.$inferSelect) => Promise<void>;
  wakeLeadSupervisorForRunFailure: (input: {
    run: typeof heartbeatRuns.$inferSelect;
    status: "failed" | "timed_out";
    errorCode?: string | null;
    error?: string | null;
  }) => Promise<void>;
  dispatchAgentQueueStart: (agentId: string) => void;
  executeRun: (runId: string) => Promise<void>;
  startNextQueuedRunForAgent: (agentId: string) => Promise<Array<typeof heartbeatRuns.$inferSelect>>;
}) {
  const {
    db,
    publishLiveEvent,
    getAgent,
    getRun,
    getRunLease,
    countRunningRunsForAgent,
    nextRunEventSeq,
    parseHeartbeatPolicy,
    setRunStatus,
    setWakeupStatus,
    upsertRunLease,
    appendRunEvent,
    clearDispatchWatchdog,
    scheduleDispatchWatchdog,
    clearProtocolIdleWatchdog,
    dispatchWatchdogAttempts,
    releaseIssueExecutionAndPromote,
    wakeLeadSupervisorForRunFailure,
    dispatchAgentQueueStart,
    executeRun,
    startNextQueuedRunForAgent,
  } = input;

  async function claimQueuedRun(run: typeof heartbeatRuns.$inferSelect) {
    if (run.status !== "queued") return run;
    const claimedAt = new Date();
    const claimed = await db
      .update(heartbeatRuns)
      .set({
        status: "running",
        startedAt: run.startedAt ?? claimedAt,
        updatedAt: claimedAt,
      })
      .where(and(eq(heartbeatRuns.id, run.id), eq(heartbeatRuns.status, "queued")))
      .returning()
      .then((rows) => rows[0] ?? null);
    if (!claimed) return null;

    publishLiveEvent({
      companyId: claimed.companyId,
      type: "heartbeat.run.status",
      payload: {
        runId: claimed.id,
        agentId: claimed.agentId,
        status: claimed.status,
        invocationSource: claimed.invocationSource,
        triggerDetail: claimed.triggerDetail,
        error: claimed.error ?? null,
        errorCode: claimed.errorCode ?? null,
        startedAt: claimed.startedAt ? new Date(claimed.startedAt).toISOString() : null,
        finishedAt: claimed.finishedAt ? new Date(claimed.finishedAt).toISOString() : null,
      },
    });

    await setWakeupStatus(claimed.wakeupRequestId, "claimed", { claimedAt });
    await upsertRunLease({
      run: claimed,
      status: "launching",
      checkpointJson: {
        phase: "claim.queued",
        message: "run claimed for execution",
      },
      heartbeatAt: claimedAt,
    });
    clearDispatchWatchdog(claimed.id);
    scheduleDispatchWatchdog(claimed.id);
    return claimed;
  }

  async function applyDispatchPrioritySelection(inputValue: {
    run: typeof heartbeatRuns.$inferSelect;
    selection: HeartbeatQueuedRunPrioritySelection<typeof heartbeatRuns.$inferSelect>;
  }) {
    const now = new Date();
    const nextContext = buildDispatchPriorityContextSnapshot({
      existingContext: parseObject(inputValue.run.contextSnapshot),
      selection: inputValue.selection,
      selectedAt: now,
    });

    const updatedRun = await db
      .update(heartbeatRuns)
      .set({
        contextSnapshot: nextContext,
        updatedAt: now,
      })
      .where(eq(heartbeatRuns.id, inputValue.run.id))
      .returning()
      .then((rows) => rows[0] ?? inputValue.run);

    if (inputValue.selection.preemptedRunIds.length > 0) {
      await appendRunEvent(updatedRun, await nextRunEventSeq(updatedRun.id), {
        eventType: "dispatch.priority_preemption",
        stream: "system",
        level: "info",
        message: "dispatch selected higher-priority work ahead of older queued runs",
        payload: buildDispatchPrioritySelectionDetails(inputValue.selection),
      });

      if (inputValue.selection.issueId) {
        await logActivity(db, {
          companyId: updatedRun.companyId,
          actorType: "system",
          actorId: "heartbeat",
          agentId: updatedRun.agentId,
          runId: updatedRun.id,
          action: "heartbeat.dispatch.priority_preempted",
          entityType: "issue",
          entityId: inputValue.selection.issueId,
          details: buildDispatchPrioritySelectionDetails(inputValue.selection),
        });
      }
    }

    return updatedRun;
  }

  async function finalizeAgentStatus(
    agentId: string,
    outcome: "succeeded" | "failed" | "cancelled" | "timed_out",
  ) {
    const existing = await getAgent(agentId);
    if (!existing) return;

    if (existing.status === "paused" || existing.status === "terminated") {
      return;
    }

    const runningCount = await countRunningRunsForAgent(agentId);
    const nextStatus =
      runningCount > 0
        ? "running"
        : outcome === "succeeded" || outcome === "cancelled"
          ? "idle"
          : "error";

    const updated = await db
      .update(agents)
      .set({
        status: nextStatus,
        lastHeartbeatAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(agents.id, agentId))
      .returning()
      .then((rows) => rows[0] ?? null);

    if (updated) {
      publishLiveEvent({
        companyId: updated.companyId,
        type: "agent.status",
        payload: {
          agentId: updated.id,
          status: updated.status,
          lastHeartbeatAt: updated.lastHeartbeatAt
            ? new Date(updated.lastHeartbeatAt).toISOString()
            : null,
          outcome,
        },
      });
    }
  }

  async function handleDispatchWatchdog(runId: string) {
    const run = await getRun(runId);
    if (!run) {
      clearDispatchWatchdog(runId);
      return;
    }

    const lease = await getRunLease(runId);
    const checkpoint = parseObject(lease?.checkpointJson);
    const checkpointPhase = readNonEmptyString(checkpoint.phase);
    const dispatchAttempts = dispatchWatchdogAttempts.get(runId) ?? 0;
    const agent = run.status === "queued" ? await getAgent(run.agentId) : null;
    const runningCount = run.status === "queued" ? await countRunningRunsForAgent(run.agentId) : 0;
    const maxConcurrentRuns = agent ? parseHeartbeatPolicy(agent).maxConcurrentRuns : 1;
    const action = decideDispatchWatchdogAction({
      runStatus: run.status,
      leaseStatus: lease?.status ?? null,
      checkpointPhase,
      dispatchAttempts,
      hasRunningProcess: runningProcesses.has(runId),
      slotBlocked: run.status === "queued" && runningCount >= maxConcurrentRuns,
    });

    if (action === "noop") {
      clearDispatchWatchdog(runId);
      return;
    }

    if (action === "hold") {
      const heartbeatAt = new Date();
      const message = "dispatch watchdog is keeping the run queued until an agent slot opens";
      await upsertRunLease({
        run,
        status: "queued",
        checkpointJson: {
          phase: "dispatch.waiting_for_slot",
          message,
          runningCount,
          maxConcurrentRuns,
          previousPhase: checkpointPhase,
        },
        heartbeatAt,
      });
      if (checkpointPhase !== "dispatch.waiting_for_slot") {
        await appendRunEvent(run, await nextRunEventSeq(run.id), {
          eventType: "dispatch.watchdog",
          stream: "system",
          level: "info",
          message,
          payload: {
            runningCount,
            maxConcurrentRuns,
            previousPhase: checkpointPhase,
          },
        });
      }
      scheduleDispatchWatchdog(run.id);
      return;
    }

    if (action === "redispatch") {
      const attempt = dispatchAttempts + 1;
      dispatchWatchdogAttempts.set(runId, attempt);
      const heartbeatAt = new Date();
      await upsertRunLease({
        run,
        status: run.status === "queued" ? "queued" : "launching",
        checkpointJson: {
          phase: "dispatch.redispatch",
          message: "dispatch watchdog is re-dispatching heartbeat execution",
          attempt,
          previousPhase: checkpointPhase,
        },
        heartbeatAt,
      });
      await appendRunEvent(run, await nextRunEventSeq(run.id), {
        eventType: "dispatch.watchdog",
        stream: "system",
        level: "warn",
        message: "dispatch watchdog is re-dispatching heartbeat execution",
        payload: {
          attempt,
          previousPhase: checkpointPhase,
          leaseStatus: lease?.status ?? null,
        },
      });
      scheduleDispatchWatchdog(run.id);
      scheduleDeferredRunDispatch(() => {
        runWithoutDbContext(() => {
          logger.warn({ runId: run.id, attempt }, "dispatch watchdog re-dispatching heartbeat execution");
          if (run.status === "queued") {
            void startNextQueuedRunForAgent(run.agentId).catch((err) => {
              logger.error({ err, runId: run.id, attempt, agentId: run.agentId }, "redispatched queued heartbeat dispatch failed");
            });
            return;
          }
          void executeRun(run.id).catch((err) => {
            logger.error({ err, runId: run.id, attempt }, "redispatched heartbeat execution failed");
          });
        });
      });
      return;
    }

    const failedAt = new Date();
    const error = "Dispatch watchdog timed out before execution started";
    const failedRun = await setRunStatus(run.id, "failed", {
      error,
      errorCode: "dispatch_timeout",
      finishedAt: failedAt,
    });
    await setWakeupStatus(run.wakeupRequestId, "failed", {
      finishedAt: failedAt,
      error,
    });
    const eventRun = failedRun ?? run;
    await upsertRunLease({
      run: eventRun,
      status: "failed",
      checkpointJson: {
        phase: "dispatch.timeout",
        message: error,
        attempts: dispatchAttempts,
      },
      heartbeatAt: failedAt,
      leaseExpiresAt: failedAt,
      releasedAt: failedAt,
      lastError: error,
    });
    await appendRunEvent(eventRun, await nextRunEventSeq(eventRun.id), {
      eventType: "dispatch.watchdog",
      stream: "system",
      level: "error",
      message: error,
      payload: {
        attempts: dispatchAttempts,
        checkpointPhase,
        leaseStatus: lease?.status ?? null,
      },
    });
    clearDispatchWatchdog(runId);
    await releaseIssueExecutionAndPromote(eventRun);
    await wakeLeadSupervisorForRunFailure({
      run: eventRun,
      status: "failed",
      errorCode: "dispatch_timeout",
      error,
    });
    await finalizeAgentStatus(run.agentId, "failed");
    dispatchAgentQueueStart(run.agentId);
  }

  async function reapOrphanedRuns(opts?: { staleThresholdMs?: number }) {
    const staleThresholdMs = opts?.staleThresholdMs ?? 0;
    const now = new Date();
    const activeRuns = await db
      .select()
      .from(heartbeatRuns)
      .where(inArray(heartbeatRuns.status, ["queued", "running"]));
    const leases = activeRuns.length > 0
      ? await db
          .select()
          .from(heartbeatRunLeases)
          .where(inArray(heartbeatRunLeases.runId, activeRuns.map((run) => run.id)))
      : [];
    const leaseByRunId = new Map(leases.map((lease) => [lease.runId, lease]));

    const reaped: string[] = [];

    for (const run of activeRuns) {
      if (runningProcesses.has(run.id)) continue;
      const lease = leaseByRunId.get(run.id) ?? null;
      if (!shouldReapHeartbeatRun({
        runStatus: run.status,
        runUpdatedAt: run.updatedAt,
        lease,
        now,
        staleThresholdMs,
      })) continue;

      const processLostError = buildProcessLostError(lease);

      await setRunStatus(run.id, "failed", {
        error: processLostError,
        errorCode: "process_lost",
        finishedAt: now,
      });
      await setWakeupStatus(run.wakeupRequestId, "failed", {
        finishedAt: now,
        error: processLostError,
      });
      await upsertRunLease({
        run,
        status: "lost",
        checkpointJson: parseObject(lease?.checkpointJson),
        heartbeatAt: now,
        leaseExpiresAt: now,
        releasedAt: now,
        lastError: processLostError,
      });
      const updatedRun = await getRun(run.id);
      if (updatedRun) {
        await appendRunEvent(updatedRun, 1, {
          eventType: "lifecycle",
          stream: "system",
          level: "error",
          message: processLostError,
          payload: lease
            ? {
                leaseStatus: lease.status,
                checkpoint: lease.checkpointJson ?? null,
              }
            : undefined,
        });
        await releaseIssueExecutionAndPromote(updatedRun);
        await wakeLeadSupervisorForRunFailure({
          run: updatedRun,
          status: "failed",
          errorCode: "process_lost",
          error: processLostError,
        });
      }
      await finalizeAgentStatus(run.agentId, "failed");
      dispatchAgentQueueStart(run.agentId);
      runningProcesses.delete(run.id);
      clearDispatchWatchdog(run.id);
      clearProtocolIdleWatchdog(run.id);
      reaped.push(run.id);
    }

    if (reaped.length > 0) {
      logger.warn({ reapedCount: reaped.length, runIds: reaped }, "reaped orphaned heartbeat runs");
    }
    return { reaped: reaped.length, runIds: reaped };
  }

  return {
    applyDispatchPrioritySelection,
    claimQueuedRun,
    finalizeAgentStatus,
    handleDispatchWatchdog,
    reapOrphanedRuns,
  };
}
