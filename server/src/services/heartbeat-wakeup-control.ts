import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@squadrail/db";
import {
  agents,
  agentWakeupRequests,
  heartbeatRuns,
  issues,
} from "@squadrail/db";
import type { LiveEventType } from "@squadrail/shared";
import { runningProcesses } from "../adapters/index.js";
import { parseObject } from "../adapters/utils.js";
import { conflict, notFound } from "../errors.js";
import { logger } from "../middleware/logger.js";
import {
  buildInternalWorkItemDispatchMetadata,
  isLeadWatchEnabled,
  leadSupervisorRunFailureReason,
  loadInternalWorkItemSupervisorContext,
} from "./internal-work-item-supervision.js";
import {
  DEFERRED_WAKE_CONTEXT_KEY,
  buildDeferredWakePromotionPlan,
  buildHeartbeatRunQueuedEvent,
  buildWakeupRequestValues,
} from "./heartbeat-wake-utils.js";
import {
  normalizeAgentNameKey,
  readNonEmptyString,
} from "./heartbeat-runtime-utils.js";
import { SUPERSEDED_PROTOCOL_WAKE_REASONS, isSupersededProtocolWakeReason } from "./heartbeat-protocol-watchdog.js";

type PublishHeartbeatLiveEvent = (input: {
  companyId: string;
  type: LiveEventType;
  payload?: Record<string, unknown>;
}) => unknown;

export interface HeartbeatWakeupOptions {
  source?: "timer" | "assignment" | "on_demand" | "automation";
  triggerDetail?: "manual" | "ping" | "callback" | "system";
  reason?: string | null;
  payload?: Record<string, unknown> | null;
  idempotencyKey?: string | null;
  requestedByActorType?: "user" | "agent" | "system";
  requestedByActorId?: string | null;
  contextSnapshot?: Record<string, unknown>;
}

export function buildHeartbeatCancellationArtifacts(input: {
  message: string;
  checkpointMessage: string;
  finishedAt?: Date;
}) {
  const finishedAt = input.finishedAt ?? new Date();
  return {
    runPatch: {
      finishedAt,
      error: input.message,
      errorCode: "cancelled",
    },
    wakeupPatch: {
      finishedAt,
      error: input.message,
    },
    leasePatch: {
      phase: "finalize.cancelled",
      message: input.checkpointMessage,
    },
    releasedAt: finishedAt,
    lastError: input.message,
    eventMessage: "run cancelled",
  };
}

export function createHeartbeatWakeupControl(input: {
  db: Db;
  publishLiveEvent: PublishHeartbeatLiveEvent;
  getAgent: (agentId: string) => Promise<typeof agents.$inferSelect | null>;
  getRun: (runId: string) => Promise<typeof heartbeatRuns.$inferSelect | null>;
  resolveSessionBeforeForWakeup: (
    agent: typeof agents.$inferSelect,
    taskKey: string | null,
  ) => Promise<string | null>;
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
  finalizeAgentStatus: (
    agentId: string,
    outcome: "succeeded" | "failed" | "cancelled" | "timed_out",
  ) => Promise<void>;
  dispatchAgentQueueStart: (agentId: string) => void;
  enqueueWakeup: (
    agentId: string,
    opts?: HeartbeatWakeupOptions,
  ) => Promise<typeof heartbeatRuns.$inferSelect | null>;
}) {
  const {
    db,
    publishLiveEvent,
    getAgent,
    getRun,
    resolveSessionBeforeForWakeup,
    setRunStatus,
    setWakeupStatus,
    upsertRunLease,
    appendRunEvent,
    clearDispatchWatchdog,
    scheduleDispatchWatchdog,
    clearProtocolIdleWatchdog,
    finalizeAgentStatus,
    dispatchAgentQueueStart,
    enqueueWakeup,
  } = input;

  async function wakeLeadSupervisorForRunFailure(inputValue: {
    run: typeof heartbeatRuns.$inferSelect;
    status: "failed" | "timed_out";
    errorCode?: string | null;
    error?: string | null;
  }) {
    const issueId = readNonEmptyString(parseObject(inputValue.run.contextSnapshot).issueId);
    if (!issueId) return;

    const issueContext = await loadInternalWorkItemSupervisorContext(db, inputValue.run.companyId, issueId);
    if (!issueContext || !isLeadWatchEnabled(issueContext)) return;

    const leadAgentId = issueContext.techLeadAgentId;
    if (!leadAgentId || leadAgentId === inputValue.run.agentId) return;

    const reason = leadSupervisorRunFailureReason({
      status: inputValue.status,
      errorCode: inputValue.errorCode ?? null,
    });
    if (!reason) return;

    const internalMetadata = buildInternalWorkItemDispatchMetadata(issueContext);

    try {
      await enqueueWakeup(leadAgentId, {
        source: "automation",
        triggerDetail: "system",
        reason,
        payload: {
          issueId,
          failedRunId: inputValue.run.id,
          failedRunStatus: inputValue.status,
          failedRunErrorCode: inputValue.errorCode ?? null,
          failedRunError: inputValue.error ?? null,
          ...internalMetadata,
          protocolDispatchMode: "lead_supervisor",
        },
        contextSnapshot: {
          issueId,
          taskId: issueId,
          source: "heartbeat.run",
          failedRunId: inputValue.run.id,
          failedRunStatus: inputValue.status,
          failedRunErrorCode: inputValue.errorCode ?? null,
          failedRunError: inputValue.error ?? null,
          ...internalMetadata,
          protocolDispatchMode: "lead_supervisor",
        },
      });
    } catch (err) {
      logger.warn(
        {
          err,
          issueId,
          leadAgentId,
          failedRunId: inputValue.run.id,
          failedRunStatus: inputValue.status,
          failedRunErrorCode: inputValue.errorCode ?? null,
        },
        "failed to wake lead supervisor after child issue run failure",
      );
    }
  }

  async function releaseIssueExecutionAndPromote(run: typeof heartbeatRuns.$inferSelect) {
    const promotedRun = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select id from issues where company_id = ${run.companyId} and execution_run_id = ${run.id} for update`,
      );

      const issue = await tx
        .select({
          id: issues.id,
          companyId: issues.companyId,
          status: issues.status,
        })
        .from(issues)
        .where(and(eq(issues.companyId, run.companyId), eq(issues.executionRunId, run.id)))
        .then((rows) => rows[0] ?? null);

      if (!issue) return null;

      await tx
        .update(issues)
        .set({
          executionRunId: null,
          executionAgentNameKey: null,
          executionLockedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(issues.id, issue.id));

      while (true) {
        const deferred = await tx
          .select()
          .from(agentWakeupRequests)
          .where(
            and(
              eq(agentWakeupRequests.companyId, issue.companyId),
              eq(agentWakeupRequests.status, "deferred_issue_execution"),
              sql`${agentWakeupRequests.payload} ->> 'issueId' = ${issue.id}`,
            ),
          )
          .orderBy(asc(agentWakeupRequests.requestedAt))
          .limit(1)
          .then((rows) => rows[0] ?? null);

        if (!deferred) return null;

        const deferredAgent = await tx
          .select()
          .from(agents)
          .where(eq(agents.id, deferred.agentId))
          .then((rows) => rows[0] ?? null);

        if (
          !deferredAgent ||
          deferredAgent.companyId !== issue.companyId ||
          deferredAgent.status === "paused" ||
          deferredAgent.status === "terminated" ||
          deferredAgent.status === "pending_approval"
        ) {
          await tx
            .update(agentWakeupRequests)
            .set({
              status: "failed",
              finishedAt: new Date(),
              error: "Deferred wake could not be promoted: agent is not invokable",
              updatedAt: new Date(),
            })
            .where(eq(agentWakeupRequests.id, deferred.id));
          continue;
        }

        const deferredPayload = parseObject(deferred.payload);
        const promotedReason = readNonEmptyString(deferred.reason) ?? "issue_execution_promoted";
        if (
          (issue.status === "done" || issue.status === "cancelled")
          && isSupersededProtocolWakeReason(promotedReason)
        ) {
          await tx
            .update(agentWakeupRequests)
            .set({
              status: "cancelled",
              finishedAt: new Date(),
              error: `Deferred wake skipped because issue is already ${issue.status}`,
              updatedAt: new Date(),
            })
            .where(eq(agentWakeupRequests.id, deferred.id));
          continue;
        }
        const promotion = buildDeferredWakePromotionPlan({
          deferredPayload,
          deferredReason: deferred.reason,
          deferredSource: deferred.source,
          deferredTriggerDetail: deferred.triggerDetail,
        });

        const sessionBefore = await resolveSessionBeforeForWakeup(deferredAgent, promotion.promotedTaskKey);
        const now = new Date();
        const newRun = await tx
          .insert(heartbeatRuns)
          .values({
            companyId: deferredAgent.companyId,
            agentId: deferredAgent.id,
            invocationSource: promotion.promotedSource,
            triggerDetail: promotion.promotedTriggerDetail,
            status: "queued",
            wakeupRequestId: deferred.id,
            contextSnapshot: promotion.promotedContextSnapshot,
            sessionIdBefore: sessionBefore,
          })
          .returning()
          .then((rows) => rows[0]);

        await tx
          .update(agentWakeupRequests)
          .set({
            status: "queued",
            reason: "issue_execution_promoted",
            runId: newRun.id,
            claimedAt: null,
            finishedAt: null,
            error: null,
            updatedAt: now,
          })
          .where(eq(agentWakeupRequests.id, deferred.id));

        await tx
          .update(issues)
          .set({
            executionRunId: newRun.id,
            executionAgentNameKey: normalizeAgentNameKey(deferredAgent.name),
            executionLockedAt: now,
            updatedAt: now,
          })
          .where(eq(issues.id, issue.id));

        return newRun;
      }
    });

    if (!promotedRun) return;

    publishLiveEvent(buildHeartbeatRunQueuedEvent({
      companyId: promotedRun.companyId,
      runId: promotedRun.id,
      agentId: promotedRun.agentId,
      invocationSource: promotedRun.invocationSource,
      triggerDetail: promotedRun.triggerDetail,
      wakeupRequestId: promotedRun.wakeupRequestId,
    }));

    dispatchAgentQueueStart(promotedRun.agentId);
  }

  async function cancelRunInternal(
    runId: string,
    opts?: { message?: string; checkpointMessage?: string },
  ) {
    const run = await getRun(runId);
    if (!run) throw notFound("Heartbeat run not found");
    if (run.status !== "running" && run.status !== "queued" && run.status !== "claimed") return run;
    const cancellation = buildHeartbeatCancellationArtifacts({
      message: readNonEmptyString(opts?.message) ?? "Cancelled by control plane",
      checkpointMessage: readNonEmptyString(opts?.checkpointMessage) ?? "run cancelled by control plane",
    });

    const running = runningProcesses.get(run.id);
    if (running) {
      running.child.kill("SIGTERM");
      const graceMs = Math.max(1, running.graceSec) * 1000;
      setTimeout(() => {
        if (!running.child.killed) {
          running.child.kill("SIGKILL");
        }
      }, graceMs);
    }

    const cancelled = await setRunStatus(run.id, "cancelled", cancellation.runPatch);

    await setWakeupStatus(run.wakeupRequestId, "cancelled", cancellation.wakeupPatch);

    await upsertRunLease({
      run: cancelled ?? run,
      status: "cancelled",
      checkpointJson: cancellation.leasePatch,
      heartbeatAt: cancellation.releasedAt,
      leaseExpiresAt: cancellation.releasedAt,
      releasedAt: cancellation.releasedAt,
      lastError: cancellation.lastError,
    });

    if (cancelled) {
      await appendRunEvent(cancelled, 1, {
        eventType: "lifecycle",
        stream: "system",
        level: "warn",
        message: cancellation.eventMessage,
      });
      await releaseIssueExecutionAndPromote(cancelled);
    }

    runningProcesses.delete(run.id);
    clearDispatchWatchdog(run.id);
    clearProtocolIdleWatchdog(run.id);
    await finalizeAgentStatus(run.agentId, "cancelled");
    dispatchAgentQueueStart(run.agentId);
    return cancelled;
  }

  async function cancelIssueScope(inputValue: {
    companyId: string;
    issueId: string;
    reason?: string | null;
    excludeRunId?: string | null;
  }) {
    const cancelledAt = new Date();
    const reason = readNonEmptyString(inputValue.reason) ?? "Cancelled by control plane";

    const wakeupRows = await db
      .select({ id: agentWakeupRequests.id })
      .from(agentWakeupRequests)
      .where(
        and(
          eq(agentWakeupRequests.companyId, inputValue.companyId),
          inArray(agentWakeupRequests.status, ["queued", "claimed", "deferred_issue_execution"]),
          sql`${agentWakeupRequests.payload} ->> 'issueId' = ${inputValue.issueId}`,
        ),
      );

    if (wakeupRows.length > 0) {
      await db
        .update(agentWakeupRequests)
        .set({
          status: "cancelled",
          finishedAt: cancelledAt,
          error: reason,
          updatedAt: cancelledAt,
        })
        .where(inArray(agentWakeupRequests.id, wakeupRows.map((row) => row.id)));
    }

    const runConditions = [
      eq(heartbeatRuns.companyId, inputValue.companyId),
      inArray(heartbeatRuns.status, ["queued", "claimed", "running"]),
      sql`${heartbeatRuns.contextSnapshot} ->> 'issueId' = ${inputValue.issueId}`,
    ];
    if (inputValue.excludeRunId) {
      runConditions.push(sql`${heartbeatRuns.id} <> ${inputValue.excludeRunId}`);
    }

    const runs = await db
      .select({ id: heartbeatRuns.id })
      .from(heartbeatRuns)
      .where(and(...runConditions))
      .orderBy(
        sql`case when ${heartbeatRuns.status} = 'running' then 0 else 1 end`,
        asc(heartbeatRuns.createdAt),
      );

    let cancelledRunCount = 0;
    for (const run of runs) {
      const current = await getRun(run.id);
      if (!current || (current.status !== "queued" && current.status !== "claimed" && current.status !== "running")) continue;
      await cancelRunInternal(run.id);
      cancelledRunCount += 1;
    }

    return {
      cancelledWakeupCount: wakeupRows.length,
      cancelledRunCount,
    };
  }

  async function cancelSupersededIssueFollowups(inputValue: {
    companyId: string;
    issueId: string;
    reason?: string | null;
    excludeRunId?: string | null;
  }) {
    const cancelledAt = new Date();
    const reason = readNonEmptyString(inputValue.reason) ?? "Cancelled stale protocol follow-up";
    const supersededReasons = [...SUPERSEDED_PROTOCOL_WAKE_REASONS];

    const wakeupRows = await db
      .select({ id: agentWakeupRequests.id })
      .from(agentWakeupRequests)
      .where(
        and(
          eq(agentWakeupRequests.companyId, inputValue.companyId),
          inArray(agentWakeupRequests.status, ["queued", "claimed", "deferred_issue_execution"]),
          sql`${agentWakeupRequests.payload} ->> 'issueId' = ${inputValue.issueId}`,
          sql`(
            ${agentWakeupRequests.reason} in (${sql.join(supersededReasons.map((value) => sql`${value}`), sql`, `)})
            or ${agentWakeupRequests.payload} -> ${DEFERRED_WAKE_CONTEXT_KEY} ->> 'wakeReason' in (${sql.join(supersededReasons.map((value) => sql`${value}`), sql`, `)})
          )`,
        ),
      );

    if (wakeupRows.length > 0) {
      await db
        .update(agentWakeupRequests)
        .set({
          status: "cancelled",
          finishedAt: cancelledAt,
          error: reason,
          updatedAt: cancelledAt,
        })
        .where(inArray(agentWakeupRequests.id, wakeupRows.map((row) => row.id)));
    }

    const runConditions = [
      eq(heartbeatRuns.companyId, inputValue.companyId),
      inArray(heartbeatRuns.status, ["queued", "claimed", "running"]),
      sql`${heartbeatRuns.contextSnapshot} ->> 'issueId' = ${inputValue.issueId}`,
      sql`${heartbeatRuns.contextSnapshot} ->> 'wakeReason' in (${sql.join(supersededReasons.map((value) => sql`${value}`), sql`, `)})`,
    ];
    if (inputValue.excludeRunId) {
      runConditions.push(sql`${heartbeatRuns.id} <> ${inputValue.excludeRunId}`);
    }
    const runs = await db
      .select({ id: heartbeatRuns.id })
      .from(heartbeatRuns)
      .where(and(...runConditions));

    let cancelledRunCount = 0;
    for (const run of runs) {
      const current = await getRun(run.id);
      if (!current || (current.status !== "queued" && current.status !== "claimed" && current.status !== "running")) continue;
      await cancelRunInternal(run.id);
      cancelledRunCount += 1;
    }

    return {
      cancelledWakeupCount: wakeupRows.length,
      cancelledRunCount,
    };
  }

  async function cancelActiveForAgent(agentId: string) {
    const runs = await db
      .select()
      .from(heartbeatRuns)
      .where(and(eq(heartbeatRuns.agentId, agentId), inArray(heartbeatRuns.status, ["queued", "running"])));

    for (const run of runs) {
      const cancellation = buildHeartbeatCancellationArtifacts({
        message: "Cancelled due to agent pause",
        checkpointMessage: "run cancelled due to agent pause",
      });
      const cancelled = await setRunStatus(run.id, "cancelled", cancellation.runPatch);

      await setWakeupStatus(run.wakeupRequestId, "cancelled", cancellation.wakeupPatch);
      await upsertRunLease({
        run: cancelled ?? run,
        status: "cancelled",
        checkpointJson: cancellation.leasePatch,
        heartbeatAt: cancellation.releasedAt,
        leaseExpiresAt: cancellation.releasedAt,
        releasedAt: cancellation.releasedAt,
        lastError: cancellation.lastError,
      });

      const running = runningProcesses.get(run.id);
      if (running) {
        running.child.kill("SIGTERM");
        runningProcesses.delete(run.id);
      }
      clearDispatchWatchdog(run.id);
      clearProtocolIdleWatchdog(run.id);
      await releaseIssueExecutionAndPromote(run);
    }

    return runs.length;
  }

  return {
    cancelActiveForAgent,
    cancelIssueScope,
    cancelRunInternal,
    cancelSupersededIssueFollowups,
    releaseIssueExecutionAndPromote,
    wakeLeadSupervisorForRunFailure,
  };
}
