import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { enqueueAfterDbCommit, runWithoutDbContext, type Db } from "@squadrail/db";
import {
  agents,
  agentRuntimeState,
  agentTaskSessions,
  agentWakeupRequests,
  heartbeatRunEvents,
  heartbeatRunLeases,
  heartbeatRuns,
  costEvents,
  issueProtocolMessages,
  issueProtocolState,
  issues,
} from "@squadrail/db";
import { resolveProtocolRunRequirement, type IssuePriority, type ProtocolRunRequirement } from "@squadrail/shared";
import { conflict, notFound } from "../errors.js";
import { logger } from "../middleware/logger.js";
import { publishLiveEvent } from "./live-events.js";
import { getRunLogStore, type RunLogHandle } from "./run-log-store.js";
import { getServerAdapter, runningProcesses } from "../adapters/index.js";
import type { AdapterExecutionResult, AdapterInvocationMeta } from "../adapters/index.js";
import { createLocalAgentJwt } from "../agent-auth-jwt.js";
import { parseObject, asBoolean, asNumber, appendWithCap, MAX_EXCERPT_BYTES } from "../adapters/utils.js";
import { secretService } from "./secrets.js";
import {
  assertResolvedWorkspaceReadyForExecution,
  resolveRuntimeSessionParamsForWorkspace,
  resolveWorkspaceForRun,
  type ResolvedWorkspaceForRun,
  WorkspaceResolutionError,
} from "./heartbeat-workspace.js";
import { extractRunVerificationSignals } from "./run-verification-signals.js";
import { inspectWorkspaceGitSnapshot } from "./workspace-git-snapshot.js";
import { logActivity } from "./activity-log.js";
import { issueProtocolAutoAssistService } from "./issue-protocol-auto-assist.js";
import { createHeartbeatDispatchLifecycle } from "./heartbeat-dispatch-lifecycle.js";
import { createHeartbeatProtocolRecovery } from "./heartbeat-protocol-recovery.js";
import {
  buildHeartbeatOutcomePersistence,
  createHeartbeatRunExecution,
  resolveHeartbeatRunOutcome,
} from "./heartbeat-run-execution.js";
import { createHeartbeatStateStore } from "./heartbeat-state-store.js";
import { createHeartbeatWakeupControl } from "./heartbeat-wakeup-control.js";
import {
  attachResolvedWorkspaceContextToRunContext,
  buildProcessLostError,
  buildTaskSessionUpsertSet,
  computeLeaseExpiresAt,
  getAdapterSessionCodec,
  insertOrRefetchSingleton,
  mergeRunResultJson,
  normalizeAgentNameKey,
  normalizeMaxConcurrentRuns,
  normalizeSessionParams,
  readNonEmptyString,
  resolveNextSessionState,
  toEpochMillis,
  truncateDisplayId,
} from "./heartbeat-runtime-utils.js";
import {
  buildDispatchPriorityContextSnapshot,
  buildDispatchPrioritySelectionDetails,
  priorityClassFromRank,
  priorityRank,
  resolveDispatchWakePriorityRank,
  shouldPreemptRunningRunForQueuedSelection,
  type HeartbeatQueuedRunPrioritySelection,
} from "./heartbeat-dispatch-priority.js";
import {
  buildRequiredProtocolProgressError,
  classifyDegradedProtocolRunReason,
  classifyProtocolRuntimeDegradedState,
  decideDispatchWatchdogAction,
  describeProtocolRunRuntimeState,
  hasRequiredProtocolProgress,
  isIdleProtocolWatchdogEligibleRequirement,
  isSupersededProtocolWakeReason,
  isWorkflowStateEligibleForProtocolRetry,
  mergeProtocolMessagesWithHelperInvocations,
  parseHeartbeatPolicyConfig,
  readLeaseLastProgressAt,
  refreshProtocolRetryContextSnapshot,
  resolveProtocolIdleWatchdogDelayMs,
  resolveDegradedProtocolRecoveryReason,
  runDispatchWatchdogOutsideDbContext,
  runProtocolWatchdogRecoveries,
  scheduleDeferredRunDispatch,
  shouldEnqueueImplementationProgressFollowup,
  shouldEnqueueProtocolRequiredRetry,
  shouldEnqueueRetryableAdapterFailure,
  shouldReapHeartbeatRun,
  shouldRecoverDegradedProtocolRun,
  shouldRecoverIdleProtocolRun,
  shouldSkipSupersededProtocolFollowup,
} from "./heartbeat-protocol-watchdog.js";
export {
  buildHeartbeatCancellationArtifacts,
  refreshPromotedIssueExecutionContextSnapshot,
} from "./heartbeat-wakeup-control.js";
export { buildHeartbeatOutcomePersistence, resolveHeartbeatRunOutcome } from "./heartbeat-run-execution.js";

export {
  attachResolvedWorkspaceContextToRunContext,
  buildProcessLostError,
  buildTaskSessionUpsertSet,
  computeLeaseExpiresAt,
  getAdapterSessionCodec,
  insertOrRefetchSingleton,
  mergeRunResultJson,
  normalizeAgentNameKey,
  normalizeMaxConcurrentRuns,
  normalizeSessionParams,
  readNonEmptyString,
  resolveNextSessionState,
  toEpochMillis,
  truncateDisplayId,
} from "./heartbeat-runtime-utils.js";
export {
  buildDispatchPriorityContextSnapshot,
  buildDispatchPrioritySelectionDetails,
  normalizeIssuePriorityValue,
  prioritizeQueuedRunsForDispatch,
  priorityClassFromRank,
  priorityRank,
  resolveDispatchWakePriorityRank,
  shouldPreemptRunningRunForQueuedSelection,
  type HeartbeatQueuedRunPrioritySelection,
} from "./heartbeat-dispatch-priority.js";
export {
  buildDeferredIssueWakePayload,
  buildDeferredWakePromotionPlan,
  buildHeartbeatRunQueuedEvent,
  buildWakeupRequestValues,
  deriveCommentId,
  deriveTaskKey,
  describeSessionResetReason,
  enrichWakeContextSnapshot,
  mergeCoalescedContextSnapshot,
  parseIssueAssigneeAdapterOverrides,
  selectWakeupCoalescedRun,
  shouldBypassIssueExecutionLock,
  shouldQueueFollowupIssueExecution,
  shouldResetTaskSessionForWake,
} from "./heartbeat-wake-utils.js";
export {
  buildRequiredProtocolProgressError,
  classifyDegradedProtocolRunReason,
  classifyProtocolRuntimeDegradedState,
  decideDispatchWatchdogAction,
  describeProtocolRunRuntimeState,
  hasRequiredProtocolProgress,
  isIdleProtocolWatchdogEligibleRequirement,
  isSupersededProtocolWakeReason,
  isWorkflowStateEligibleForProtocolRetry,
  mergeProtocolMessagesWithHelperInvocations,
  parseHeartbeatPolicyConfig,
  readLeaseLastProgressAt,
  refreshProtocolRetryContextSnapshot,
  resolveProtocolIdleWatchdogDelayMs,
  resolveDegradedProtocolRecoveryReason,
  runDispatchWatchdogOutsideDbContext,
  runProtocolWatchdogRecoveries,
  scheduleDeferredRunDispatch,
  shouldEnqueueImplementationProgressFollowup,
  shouldEnqueueProtocolRequiredRetry,
  shouldEnqueueRetryableAdapterFailure,
  shouldReapHeartbeatRun,
  shouldRecoverDegradedProtocolRun,
  shouldRecoverIdleProtocolRun,
  shouldSkipSupersededProtocolFollowup,
} from "./heartbeat-protocol-watchdog.js";

const RUN_DISPATCH_WATCHDOG_MS = 8_000;
const RUN_DISPATCH_RETRY_LIMIT = 2;
export function heartbeatService(db: Db) {
  const runLogStore = getRunLogStore();
  const secretsSvc = secretService(db);
  const protocolAutoAssist = issueProtocolAutoAssistService(db);
  const dispatchWatchdogTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const dispatchWatchdogAttempts = new Map<string, number>();
  const protocolIdleWatchdogTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const protocolIdleWatchdogAttempts = new Map<string, number>();
  const {
    appendRunEvent,
    clearTaskSessions,
    countRunningRunsForAgent,
    ensureRuntimeState,
    getAgent,
    getRun,
    getRunLease,
    getRuntimeState,
    getTaskSession,
    nextRunEventSeq,
    resolveSessionBeforeForWakeup,
    setRunStatus,
    setWakeupStatus,
    upsertRunLease,
    upsertTaskSession,
  } = createHeartbeatStateStore({
    db,
    publishLiveEvent,
  });

  function clearDispatchWatchdog(runId: string) {
    const timer = dispatchWatchdogTimers.get(runId);
    if (timer) {
      clearTimeout(timer);
      dispatchWatchdogTimers.delete(runId);
    }
    dispatchWatchdogAttempts.delete(runId);
  }

  function clearProtocolIdleWatchdog(runId: string, opts?: { resetAttempts?: boolean }) {
    const timer = protocolIdleWatchdogTimers.get(runId);
    if (timer) {
      clearTimeout(timer);
    }
    protocolIdleWatchdogTimers.delete(runId);
    if (opts?.resetAttempts !== false) {
      protocolIdleWatchdogAttempts.delete(runId);
    }
  }

  function scheduleDispatchWatchdog(runId: string) {
    const existing = dispatchWatchdogTimers.get(runId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      runDispatchWatchdogOutsideDbContext(() => {
        void handleDispatchWatchdog(runId).catch((err) => {
          logger.error({ err, runId }, "dispatch watchdog failed");
        });
      });
    }, RUN_DISPATCH_WATCHDOG_MS);
    timer.unref?.();
    dispatchWatchdogTimers.set(runId, timer);
  }

  function parseHeartbeatPolicy(agent: typeof agents.$inferSelect) {
    return parseHeartbeatPolicyConfig(agent.runtimeConfig);
  }

  let wakeupControl: ReturnType<typeof createHeartbeatWakeupControl>;
  let protocolRecovery: ReturnType<typeof createHeartbeatProtocolRecovery>;
  let runExecution: ReturnType<typeof createHeartbeatRunExecution>;

  const {
    applyDispatchPrioritySelection,
    claimQueuedRun,
    finalizeAgentStatus,
    handleDispatchWatchdog,
    reapOrphanedRuns,
  } = createHeartbeatDispatchLifecycle({
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
    releaseIssueExecutionAndPromote: (run) => wakeupControl.releaseIssueExecutionAndPromote(run),
    wakeLeadSupervisorForRunFailure: (inputValue) => wakeupControl.wakeLeadSupervisorForRunFailure(inputValue),
    dispatchAgentQueueStart: (agentId) => runExecution.dispatchAgentQueueStart(agentId),
    executeRun: (runId) => runExecution.executeRun(runId),
    startNextQueuedRunForAgent: (agentId) => runExecution.startNextQueuedRunForAgent(agentId),
  });

  wakeupControl = createHeartbeatWakeupControl({
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
    dispatchAgentQueueStart: (agentId) => runExecution.dispatchAgentQueueStart(agentId),
  });

  const {
    cancelActiveForAgent,
    cancelIssueScope,
    cancelRunInternal,
    cancelSupersededIssueFollowups,
    enqueueWakeup,
    releaseIssueExecutionAndPromote,
    wakeLeadSupervisorForRunFailure,
  } = wakeupControl;
  protocolRecovery = createHeartbeatProtocolRecovery({
    db,
    getRun,
    getRunLease,
    clearProtocolIdleWatchdog,
    enqueueWakeup: (agentId, opts) => wakeupControl.enqueueWakeup(agentId, opts),
    cancelRunInternal: (runId, opts) => wakeupControl.cancelRunInternal(runId, opts),
    assistDegradedRun: (inputValue) => protocolAutoAssist.assistDegradedRun(inputValue),
    protocolIdleWatchdogTimers,
    protocolIdleWatchdogAttempts,
  });

  const {
    cancelSupersededProtocolRunIfNeeded,
    recoverIdleProtocolRuns,
    scheduleProtocolIdleWatchdog,
  } = protocolRecovery;

  runExecution = createHeartbeatRunExecution({
    db,
    publishLiveEvent,
    runLogStore,
    resolveAdapterConfigForRuntime: (companyId, config) => secretsSvc.resolveAdapterConfigForRuntime(companyId, config),
    getAgent,
    getRun,
    getTaskSession,
    nextRunEventSeq,
    ensureRuntimeState,
    countRunningRunsForAgent,
    clearTaskSessions,
    upsertTaskSession,
    setRunStatus,
    setWakeupStatus,
    upsertRunLease,
    appendRunEvent,
    parseHeartbeatPolicy,
    claimQueuedRun,
    applyDispatchPrioritySelection,
    finalizeAgentStatus,
    dispatchAgentQueueStart: (agentId) => runExecution.dispatchAgentQueueStart(agentId),
    releaseIssueExecutionAndPromote: (run) => wakeupControl.releaseIssueExecutionAndPromote(run),
    wakeLeadSupervisorForRunFailure: (inputValue) => wakeupControl.wakeLeadSupervisorForRunFailure(inputValue),
    cancelRunInternal: (runId, opts) => wakeupControl.cancelRunInternal(runId, opts),
    enqueueWakeup: (agentId, opts) => wakeupControl.enqueueWakeup(agentId, opts),
    clearDispatchWatchdog,
    clearProtocolIdleWatchdog,
    scheduleProtocolIdleWatchdog: (runId) => protocolRecovery.scheduleProtocolIdleWatchdog(runId),
    cancelSupersededProtocolRunIfNeeded: (inputValue) => protocolRecovery.cancelSupersededProtocolRunIfNeeded(inputValue),
  });

  const {
    dispatchAgentQueueStart,
    executeRun,
    startNextQueuedRunForAgent,
  } = runExecution;

  const service = {
    list: (companyId: string, agentId?: string, limit?: number) => {
      const query = db
        .select()
        .from(heartbeatRuns)
        .where(
          agentId
            ? and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.agentId, agentId))
            : eq(heartbeatRuns.companyId, companyId),
        )
        .orderBy(desc(heartbeatRuns.createdAt));

      if (limit) {
        return query.limit(limit);
      }
      return query;
    },

    getRun,

    getRuntimeState: async (agentId: string) => {
      const state = await getRuntimeState(agentId);
      const agent = await getAgent(agentId);
      if (!agent) return null;
      const ensured = state ?? (await ensureRuntimeState(agent));
      const latestTaskSession = await db
        .select()
        .from(agentTaskSessions)
        .where(and(eq(agentTaskSessions.companyId, agent.companyId), eq(agentTaskSessions.agentId, agent.id)))
        .orderBy(desc(agentTaskSessions.updatedAt))
        .limit(1)
        .then((rows) => rows[0] ?? null);
      return {
        ...ensured,
        sessionDisplayId: latestTaskSession?.sessionDisplayId ?? ensured.sessionId,
        sessionParamsJson: latestTaskSession?.sessionParamsJson ?? null,
      };
    },

    listTaskSessions: async (agentId: string) => {
      const agent = await getAgent(agentId);
      if (!agent) throw notFound("Agent not found");

      return db
        .select()
        .from(agentTaskSessions)
        .where(and(eq(agentTaskSessions.companyId, agent.companyId), eq(agentTaskSessions.agentId, agentId)))
        .orderBy(desc(agentTaskSessions.updatedAt), desc(agentTaskSessions.createdAt));
    },

    resetRuntimeSession: async (agentId: string, opts?: { taskKey?: string | null }) => {
      const agent = await getAgent(agentId);
      if (!agent) throw notFound("Agent not found");
      await ensureRuntimeState(agent);
      const taskKey = readNonEmptyString(opts?.taskKey);
      const clearedTaskSessions = await clearTaskSessions(
        agent.companyId,
        agent.id,
        taskKey ? { taskKey, adapterType: agent.adapterType } : undefined,
      );
      const runtimePatch: Partial<typeof agentRuntimeState.$inferInsert> = {
        sessionId: null,
        lastError: null,
        updatedAt: new Date(),
      };
      if (!taskKey) {
        runtimePatch.stateJson = {};
      }

      const updated = await db
        .update(agentRuntimeState)
        .set(runtimePatch)
        .where(eq(agentRuntimeState.agentId, agentId))
        .returning()
        .then((rows) => rows[0] ?? null);

      if (!updated) return null;
      return {
        ...updated,
        sessionDisplayId: null,
        sessionParamsJson: null,
        clearedTaskSessions,
      };
    },

    listEvents: (runId: string, afterSeq = 0, limit = 200) =>
      db
        .select()
        .from(heartbeatRunEvents)
        .where(and(eq(heartbeatRunEvents.runId, runId), gt(heartbeatRunEvents.seq, afterSeq)))
        .orderBy(asc(heartbeatRunEvents.seq))
        .limit(Math.max(1, Math.min(limit, 1000))),

    readLog: async (runId: string, opts?: { offset?: number; limitBytes?: number; tailBytes?: number }) => {
      const run = await getRun(runId);
      if (!run) throw notFound("Heartbeat run not found");
      if (!run.logStore || !run.logRef) throw notFound("Run log not found");

      const result = await runLogStore.read(
        {
          store: run.logStore as "local_file",
          logRef: run.logRef,
        },
        opts,
      );

      return {
        runId,
        store: run.logStore,
        logRef: run.logRef,
        ...result,
      };
    },

    recordExternalRunEvent: async (input: {
      runId: string;
      eventType: string;
      message?: string;
      level?: "info" | "warn" | "error";
      payload?: Record<string, unknown>;
    }) => {
      const run = await getRun(input.runId);
      if (!run) return false;
      await appendRunEvent(run, await nextRunEventSeq(run.id), {
        eventType: input.eventType,
        level: input.level,
        message: input.message,
        payload: input.payload,
      });
      return true;
    },

    invoke: async (
      agentId: string,
      source: "timer" | "assignment" | "on_demand" | "automation" = "on_demand",
      contextSnapshot: Record<string, unknown> = {},
      triggerDetail: "manual" | "ping" | "callback" | "system" = "manual",
      actor?: { actorType?: "user" | "agent" | "system"; actorId?: string | null },
    ) =>
      enqueueWakeup(agentId, {
        source,
        triggerDetail,
        contextSnapshot,
        requestedByActorType: actor?.actorType,
        requestedByActorId: actor?.actorId ?? null,
      }),

    wakeup: enqueueWakeup,

    reapOrphanedRuns,
    recoverIdleProtocolRuns,

    tickTimers: async (now = new Date()) => {
      const allAgents = await db.select().from(agents);
      let checked = 0;
      let enqueued = 0;
      let skipped = 0;

      for (const agent of allAgents) {
        if (agent.status === "paused" || agent.status === "terminated" || agent.status === "pending_approval") continue;
        const policy = parseHeartbeatPolicy(agent);
        if (!policy.enabled || policy.intervalSec <= 0) continue;

        checked += 1;
        const baseline = new Date(agent.lastHeartbeatAt ?? agent.createdAt).getTime();
        const elapsedMs = now.getTime() - baseline;
        if (elapsedMs < policy.intervalSec * 1000) continue;

        const run = await enqueueWakeup(agent.id, {
          source: "timer",
          triggerDetail: "system",
          reason: "heartbeat_timer",
          requestedByActorType: "system",
          requestedByActorId: "heartbeat_scheduler",
          contextSnapshot: {
            source: "scheduler",
            reason: "interval_elapsed",
            now: now.toISOString(),
          },
        });
        if (run) enqueued += 1;
        else skipped += 1;
      }

      return { checked, enqueued, skipped };
    },

    cancelRun: cancelRunInternal,

    cancelIssueScope,

    cancelSupersededIssueFollowups,

    cancelActiveForAgent,

    getActiveRunForAgent: async (agentId: string) => {
      const [run] = await db
        .select()
        .from(heartbeatRuns)
        .where(
          and(
            eq(heartbeatRuns.agentId, agentId),
            eq(heartbeatRuns.status, "running"),
          ),
        )
        .orderBy(desc(heartbeatRuns.startedAt))
        .limit(1);
      return run ?? null;
    },
  };

  return service;
}
