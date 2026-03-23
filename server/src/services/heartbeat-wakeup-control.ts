import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@squadrail/db";
import {
  agents,
  agentWakeupRequests,
  heartbeatRuns,
  issueProtocolState,
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
  buildDeferredIssueWakePayload,
  buildDeferredWakePromotionPlan,
  buildHeartbeatRunQueuedEvent,
  buildWakeupRequestValues,
  enrichWakeContextSnapshot,
  mergeCoalescedContextSnapshot,
  selectWakeupCoalescedRun,
  shouldBypassIssueExecutionLock,
  shouldQueueFollowupIssueExecution,
} from "./heartbeat-wake-utils.js";
import {
  normalizeAgentNameKey,
  readNonEmptyString,
} from "./heartbeat-runtime-utils.js";
import {
  SUPERSEDED_PROTOCOL_WAKE_REASONS,
  isSupersededProtocolWakeReason,
  refreshProtocolRetryContextSnapshot,
  shouldSkipSupersededProtocolFollowup,
} from "./heartbeat-protocol-watchdog.js";

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

export function refreshPromotedIssueExecutionContextSnapshot(input: {
  contextSnapshot: Record<string, unknown>;
  currentWorkflowState?: string | null;
}) {
  const workflowState = readNonEmptyString(input.currentWorkflowState);
  if (!workflowState) {
    return {
      ...input.contextSnapshot,
    };
  }
  if (!readNonEmptyString(input.contextSnapshot.protocolMessageType)) {
    return {
      ...input.contextSnapshot,
    };
  }
  return refreshProtocolRetryContextSnapshot({
    contextSnapshot: {
      ...input.contextSnapshot,
    },
    workflowState,
  });
}

export function createHeartbeatWakeupControl(input: {
  db: Db;
  publishLiveEvent: PublishHeartbeatLiveEvent;
  getAgent: (agentId: string) => Promise<typeof agents.$inferSelect | null>;
  getRun: (runId: string) => Promise<typeof heartbeatRuns.$inferSelect | null>;
  parseHeartbeatPolicy: (agent: typeof agents.$inferSelect) => { enabled: boolean; wakeOnDemand: boolean };
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
}) {
  const {
    db,
    publishLiveEvent,
    getAgent,
    getRun,
    parseHeartbeatPolicy,
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
  } = input;

  async function enqueueWakeup(agentId: string, opts: HeartbeatWakeupOptions = {}) {
    const source = opts.source ?? "on_demand";
    const triggerDetail = opts.triggerDetail ?? null;
    const contextSnapshot: Record<string, unknown> = { ...(opts.contextSnapshot ?? {}) };
    const reason = opts.reason ?? null;
    const payload = opts.payload ?? null;
    const {
      contextSnapshot: enrichedContextSnapshot,
      issueIdFromPayload,
      taskKey,
      wakeCommentId,
    } = enrichWakeContextSnapshot({
      contextSnapshot,
      reason,
      source,
      triggerDetail,
      payload,
    });
    const issueId = readNonEmptyString(enrichedContextSnapshot.issueId) ?? issueIdFromPayload;

    const agent = await getAgent(agentId);
    if (!agent) throw notFound("Agent not found");

    if (
      agent.status === "paused" ||
      agent.status === "terminated" ||
      agent.status === "pending_approval"
    ) {
      throw conflict("Agent is not invokable in its current state", { status: agent.status });
    }

    const policy = parseHeartbeatPolicy(agent);
    const writeSkippedRequest = async (skippedReason: string) => {
      await db.insert(agentWakeupRequests).values(buildWakeupRequestValues({
        companyId: agent.companyId,
        agentId,
        source,
        triggerDetail,
        reason: skippedReason,
        payload,
        status: "skipped",
        requestedByActorType: opts.requestedByActorType,
        requestedByActorId: opts.requestedByActorId,
        idempotencyKey: opts.idempotencyKey,
        finishedAt: new Date(),
      }));
    };

    if (source === "timer" && !policy.enabled) {
      await writeSkippedRequest("heartbeat.disabled");
      return null;
    }
    if (source !== "timer" && !policy.wakeOnDemand) {
      await writeSkippedRequest("heartbeat.wakeOnDemand.disabled");
      return null;
    }

    const bypassIssueExecutionLock = shouldBypassIssueExecutionLock({
      reason,
      contextSnapshot: enrichedContextSnapshot,
    });

    if (issueId && !bypassIssueExecutionLock) {
      const agentNameKey = normalizeAgentNameKey(agent.name);
      const sessionBefore = await resolveSessionBeforeForWakeup(agent, taskKey);

      const outcome = await db.transaction(async (tx) => {
        await tx.execute(
          sql`select id from issues where id = ${issueId} and company_id = ${agent.companyId} for update`,
        );

        const issue = await tx
          .select({
            id: issues.id,
            companyId: issues.companyId,
            priority: issues.priority,
            parentId: issues.parentId,
            executionRunId: issues.executionRunId,
            executionAgentNameKey: issues.executionAgentNameKey,
          })
          .from(issues)
          .where(and(eq(issues.id, issueId), eq(issues.companyId, agent.companyId)))
          .then((rows) => rows[0] ?? null);

        if (!issue) {
          await tx.insert(agentWakeupRequests).values(buildWakeupRequestValues({
            companyId: agent.companyId,
            agentId,
            source,
            triggerDetail,
            reason: "issue_execution_issue_not_found",
            payload,
            status: "skipped",
            requestedByActorType: opts.requestedByActorType,
            requestedByActorId: opts.requestedByActorId,
            idempotencyKey: opts.idempotencyKey,
            finishedAt: new Date(),
          }));
          return { kind: "skipped" as const };
        }

        if (!readNonEmptyString(enrichedContextSnapshot.issuePriority)) {
          enrichedContextSnapshot.issuePriority = issue.priority;
        }

        let activeExecutionRun = issue.executionRunId
          ? await tx
            .select()
            .from(heartbeatRuns)
            .where(eq(heartbeatRuns.id, issue.executionRunId))
            .then((rows) => rows[0] ?? null)
          : null;

        if (activeExecutionRun && activeExecutionRun.status !== "queued" && activeExecutionRun.status !== "running") {
          activeExecutionRun = null;
        }

        if (!activeExecutionRun && issue.executionRunId) {
          await tx
            .update(issues)
            .set({
              executionRunId: null,
              executionAgentNameKey: null,
              executionLockedAt: null,
              updatedAt: new Date(),
            })
            .where(eq(issues.id, issue.id));
        }

        if (!activeExecutionRun) {
          const legacyRun = await tx
            .select()
            .from(heartbeatRuns)
            .where(
              and(
                eq(heartbeatRuns.companyId, issue.companyId),
                inArray(heartbeatRuns.status, ["queued", "running"]),
                sql`${heartbeatRuns.contextSnapshot} ->> 'issueId' = ${issue.id}`,
              ),
            )
            .orderBy(
              sql`case when ${heartbeatRuns.status} = 'running' then 0 else 1 end`,
              asc(heartbeatRuns.createdAt),
            )
            .limit(1)
            .then((rows) => rows[0] ?? null);

          if (legacyRun) {
            activeExecutionRun = legacyRun;
            const legacyAgent = await tx
              .select({ name: agents.name })
              .from(agents)
              .where(eq(agents.id, legacyRun.agentId))
              .then((rows) => rows[0] ?? null);
            await tx
              .update(issues)
              .set({
                executionRunId: legacyRun.id,
                executionAgentNameKey: normalizeAgentNameKey(legacyAgent?.name),
                executionLockedAt: new Date(),
                updatedAt: new Date(),
              })
              .where(eq(issues.id, issue.id));
          }
        }

        if (activeExecutionRun) {
          const executionAgent = await tx
            .select({ name: agents.name })
            .from(agents)
            .where(eq(agents.id, activeExecutionRun.agentId))
            .then((rows) => rows[0] ?? null);
          const executionAgentNameKey =
            normalizeAgentNameKey(issue.executionAgentNameKey) ??
            normalizeAgentNameKey(executionAgent?.name);
          const isSameExecutionAgent =
            Boolean(executionAgentNameKey) && executionAgentNameKey === agentNameKey;
          const shouldQueueFollowupForSameAgent = shouldQueueFollowupIssueExecution({
            sameExecutionAgent: isSameExecutionAgent,
            activeExecutionRunStatus: activeExecutionRun.status,
            wakeCommentId,
            contextSnapshot: enrichedContextSnapshot,
          });

          if (isSameExecutionAgent && !shouldQueueFollowupForSameAgent) {
            const mergedContextSnapshot = mergeCoalescedContextSnapshot(
              activeExecutionRun.contextSnapshot,
              enrichedContextSnapshot,
            );
            const mergedRun = await tx
              .update(heartbeatRuns)
              .set({
                contextSnapshot: mergedContextSnapshot,
                updatedAt: new Date(),
              })
              .where(eq(heartbeatRuns.id, activeExecutionRun.id))
              .returning()
              .then((rows) => rows[0] ?? activeExecutionRun);

            await tx.insert(agentWakeupRequests).values(buildWakeupRequestValues({
              companyId: agent.companyId,
              agentId,
              source,
              triggerDetail,
              reason: "issue_execution_same_name",
              payload,
              status: "coalesced",
              coalescedCount: 1,
              requestedByActorType: opts.requestedByActorType,
              requestedByActorId: opts.requestedByActorId,
              idempotencyKey: opts.idempotencyKey,
              runId: mergedRun.id,
              finishedAt: new Date(),
            }));

            return { kind: "coalesced" as const, run: mergedRun };
          }

          const deferredPayload = buildDeferredIssueWakePayload({
            payload,
            issueId,
            contextSnapshot: enrichedContextSnapshot,
          });

          const existingDeferred = await tx
            .select()
            .from(agentWakeupRequests)
            .where(
              and(
                eq(agentWakeupRequests.companyId, agent.companyId),
                eq(agentWakeupRequests.agentId, agentId),
                eq(agentWakeupRequests.status, "deferred_issue_execution"),
                sql`${agentWakeupRequests.payload} ->> 'issueId' = ${issue.id}`,
              ),
            )
            .orderBy(asc(agentWakeupRequests.requestedAt))
            .limit(1)
            .then((rows) => rows[0] ?? null);

          if (existingDeferred) {
            const existingDeferredPayload = parseObject(existingDeferred.payload);
            const existingDeferredContext = parseObject(
              existingDeferredPayload[DEFERRED_WAKE_CONTEXT_KEY],
            );
            const mergedDeferredContext = mergeCoalescedContextSnapshot(
              existingDeferredContext,
              enrichedContextSnapshot,
            );
            const mergedDeferredPayload = {
              ...existingDeferredPayload,
              ...(payload ?? {}),
              issueId,
              [DEFERRED_WAKE_CONTEXT_KEY]: mergedDeferredContext,
            };

            await tx
              .update(agentWakeupRequests)
              .set({
                payload: mergedDeferredPayload,
                coalescedCount: (existingDeferred.coalescedCount ?? 0) + 1,
                updatedAt: new Date(),
              })
              .where(eq(agentWakeupRequests.id, existingDeferred.id));

            return { kind: "deferred" as const };
          }

          await tx.insert(agentWakeupRequests).values(buildWakeupRequestValues({
            companyId: agent.companyId,
            agentId,
            source,
            triggerDetail,
            reason: "issue_execution_deferred",
            payload: deferredPayload,
            status: "deferred_issue_execution",
            requestedByActorType: opts.requestedByActorType,
            requestedByActorId: opts.requestedByActorId,
            idempotencyKey: opts.idempotencyKey,
          }));

          return { kind: "deferred" as const };
        }

        const wakeupRequest = await tx
          .insert(agentWakeupRequests)
          .values(buildWakeupRequestValues({
            companyId: agent.companyId,
            agentId,
            source,
            triggerDetail,
            reason,
            payload,
            status: "queued",
            requestedByActorType: opts.requestedByActorType,
            requestedByActorId: opts.requestedByActorId,
            idempotencyKey: opts.idempotencyKey,
          }))
          .returning()
          .then((rows) => rows[0]);

        const newRun = await tx
          .insert(heartbeatRuns)
          .values({
            companyId: agent.companyId,
            agentId,
            invocationSource: source,
            triggerDetail,
            status: "queued",
            wakeupRequestId: wakeupRequest.id,
            contextSnapshot: enrichedContextSnapshot,
            sessionIdBefore: sessionBefore,
          })
          .returning()
          .then((rows) => rows[0]);

        await tx
          .update(agentWakeupRequests)
          .set({
            runId: newRun.id,
            updatedAt: new Date(),
          })
          .where(eq(agentWakeupRequests.id, wakeupRequest.id));

        await tx
          .update(issues)
          .set({
            executionRunId: newRun.id,
            executionAgentNameKey: agentNameKey,
            executionLockedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(issues.id, issue.id));

        return { kind: "queued" as const, run: newRun };
      });

      if (outcome.kind === "deferred" || outcome.kind === "skipped") return null;
      if (outcome.kind === "coalesced") return outcome.run;

      const newRun = outcome.run;
      const queuedAt = new Date();
      await upsertRunLease({
        run: newRun,
        status: "queued",
        checkpointJson: {
          phase: "queue.created",
          message: "run queued for dispatch",
        },
        heartbeatAt: queuedAt,
      });
      scheduleDispatchWatchdog(newRun.id);
      publishLiveEvent(buildHeartbeatRunQueuedEvent({
        companyId: newRun.companyId,
        runId: newRun.id,
        agentId: newRun.agentId,
        invocationSource: newRun.invocationSource,
        triggerDetail: newRun.triggerDetail,
        wakeupRequestId: newRun.wakeupRequestId,
      }));

      dispatchAgentQueueStart(agent.id);
      return newRun;
    }

    const activeRuns = await db
      .select()
      .from(heartbeatRuns)
      .where(and(eq(heartbeatRuns.agentId, agentId), inArray(heartbeatRuns.status, ["queued", "running"])))
      .orderBy(desc(heartbeatRuns.createdAt));

    const { coalescedTargetRun } = selectWakeupCoalescedRun({
      activeRuns,
      taskKey,
      wakeCommentId,
    });

    if (coalescedTargetRun) {
      const mergedContextSnapshot = mergeCoalescedContextSnapshot(
        coalescedTargetRun.contextSnapshot,
        contextSnapshot,
      );
      const mergedRun = await db
        .update(heartbeatRuns)
        .set({
          contextSnapshot: mergedContextSnapshot,
          updatedAt: new Date(),
        })
        .where(eq(heartbeatRuns.id, coalescedTargetRun.id))
        .returning()
        .then((rows) => rows[0] ?? coalescedTargetRun);

      await db.insert(agentWakeupRequests).values(buildWakeupRequestValues({
        companyId: agent.companyId,
        agentId,
        source,
        triggerDetail,
        reason,
        payload,
        status: "coalesced",
        coalescedCount: 1,
        requestedByActorType: opts.requestedByActorType,
        requestedByActorId: opts.requestedByActorId,
        idempotencyKey: opts.idempotencyKey,
        runId: mergedRun.id,
        finishedAt: new Date(),
      }));
      return mergedRun;
    }

    const wakeupRequest = await db
      .insert(agentWakeupRequests)
      .values(buildWakeupRequestValues({
        companyId: agent.companyId,
        agentId,
        source,
        triggerDetail,
        reason,
        payload,
        status: "queued",
        requestedByActorType: opts.requestedByActorType,
        requestedByActorId: opts.requestedByActorId,
        idempotencyKey: opts.idempotencyKey,
      }))
      .returning()
      .then((rows) => rows[0]);

    const sessionBefore = await resolveSessionBeforeForWakeup(agent, taskKey);

    const newRun = await db
      .insert(heartbeatRuns)
      .values({
        companyId: agent.companyId,
        agentId,
        invocationSource: source,
        triggerDetail,
        status: "queued",
        wakeupRequestId: wakeupRequest.id,
        contextSnapshot: enrichedContextSnapshot,
        sessionIdBefore: sessionBefore,
      })
      .returning()
      .then((rows) => rows[0]);

    await db
      .update(agentWakeupRequests)
      .set({
        runId: newRun.id,
        updatedAt: new Date(),
      })
      .where(eq(agentWakeupRequests.id, wakeupRequest.id));

    publishLiveEvent(buildHeartbeatRunQueuedEvent({
      companyId: newRun.companyId,
      runId: newRun.id,
      agentId: newRun.agentId,
      invocationSource: newRun.invocationSource,
      triggerDetail: newRun.triggerDetail,
      wakeupRequestId: newRun.wakeupRequestId,
    }));

    const queuedAt = new Date();
    await upsertRunLease({
      run: newRun,
      status: "queued",
      checkpointJson: {
        phase: "queue.created",
        message: "run queued for dispatch",
      },
      heartbeatAt: queuedAt,
    });
    scheduleDispatchWatchdog(newRun.id);
    dispatchAgentQueueStart(agent.id);

    return newRun;
  }

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
        const promotedContextSnapshot = refreshPromotedIssueExecutionContextSnapshot({
          contextSnapshot: promotion.promotedContextSnapshot,
          currentWorkflowState: issue.workflowState ?? null,
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
            contextSnapshot: promotedContextSnapshot,
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
    const issueRow = await db
      .select({ status: issues.status })
      .from(issues)
      .where(and(eq(issues.companyId, inputValue.companyId), eq(issues.id, inputValue.issueId)))
      .limit(1)
      .then((rows) => rows[0] ?? null);
    const protocolStateRow = await db
      .select({ workflowState: issueProtocolState.workflowState })
      .from(issueProtocolState)
      .where(
        and(
          eq(issueProtocolState.companyId, inputValue.companyId),
          eq(issueProtocolState.issueId, inputValue.issueId),
        ),
      )
      .limit(1)
      .then((rows) => rows[0] ?? null);
    const issueStateSnapshot = {
      status: issueRow?.status ?? null,
      workflowState: protocolStateRow?.workflowState ?? null,
    };

    const shouldCancelProtocolContext = (
      contextSnapshot: Record<string, unknown> | null | undefined,
      wakeReason: string | null,
    ) =>
      shouldSkipSupersededProtocolFollowup({
        issueStatus: issueStateSnapshot?.status ?? null,
        workflowState: issueStateSnapshot?.workflowState ?? null,
        wakeReason,
        protocolMessageType: readNonEmptyString(contextSnapshot?.protocolMessageType),
        protocolRecipientRole: readNonEmptyString(contextSnapshot?.protocolRecipientRole),
      });

    const wakeupRows = await db
      .select({
        id: agentWakeupRequests.id,
        reason: agentWakeupRequests.reason,
        payload: agentWakeupRequests.payload,
      })
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

    const wakeupIds = wakeupRows
      .filter((row) => {
        if (row.reason && supersededReasons.includes(row.reason)) {
          return true;
        }
        const payload = parseObject(row.payload);
        const deferredContext = parseObject(payload[DEFERRED_WAKE_CONTEXT_KEY]);
        if (Object.keys(deferredContext).length === 0) return false;
        return shouldCancelProtocolContext(
          deferredContext,
          readNonEmptyString(deferredContext.wakeReason) ?? readNonEmptyString(row.reason),
        );
      })
      .map((row) => row.id);

    if (wakeupIds.length > 0) {
      await db
        .update(agentWakeupRequests)
        .set({
          status: "cancelled",
          finishedAt: cancelledAt,
          error: reason,
          updatedAt: cancelledAt,
        })
        .where(inArray(agentWakeupRequests.id, wakeupIds));
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
      .select({
        id: heartbeatRuns.id,
        contextSnapshot: heartbeatRuns.contextSnapshot,
      })
      .from(heartbeatRuns)
      .where(and(...runConditions));
    const supersededRunIds = runs
      .filter((run) =>
        shouldCancelProtocolContext(
          parseObject(run.contextSnapshot),
          readNonEmptyString(parseObject(run.contextSnapshot).wakeReason),
        ),
      )
      .map((run) => run.id);

    let cancelledRunCount = 0;
    for (const runId of supersededRunIds) {
      const current = await getRun(runId);
      if (!current || (current.status !== "queued" && current.status !== "claimed" && current.status !== "running")) continue;
      await cancelRunInternal(runId);
      cancelledRunCount += 1;
    }

    return {
      cancelledWakeupCount: wakeupIds.length,
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
    enqueueWakeup,
    releaseIssueExecutionAndPromote,
    wakeLeadSupervisorForRunFailure,
  };
}
