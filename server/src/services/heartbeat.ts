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
import { createHeartbeatStateStore } from "./heartbeat-state-store.js";
import { createHeartbeatWakeupControl } from "./heartbeat-wakeup-control.js";
import { loadConfig } from "../config.js";
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
  normalizeIssuePriorityValue,
  prioritizeQueuedRunsForDispatch,
  priorityClassFromRank,
  priorityRank,
  type HeartbeatQueuedRunPrioritySelection,
} from "./heartbeat-dispatch-priority.js";
import {
  buildDeferredIssueWakePayload,
  buildDeferredWakePromotionPlan,
  buildHeartbeatRunQueuedEvent,
  buildWakeupRequestValues,
  DEFERRED_WAKE_CONTEXT_KEY,
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
import {
  buildRequiredProtocolProgressError,
  classifyProtocolRuntimeDegradedState,
  decideDispatchWatchdogAction,
  describeProtocolRunRuntimeState,
  hasRequiredProtocolProgress,
  isIdleProtocolWatchdogEligibleRequirement,
  isSupersededProtocolWakeReason,
  isWorkflowStateEligibleForProtocolRetry,
  parseHeartbeatPolicyConfig,
  readLeaseLastProgressAt,
  resolveProtocolIdleWatchdogDelayMs,
  resolveDegradedProtocolRecoveryReason,
  runDispatchWatchdogOutsideDbContext,
  runProtocolWatchdogRecoveries,
  scheduleDeferredRunDispatch,
  shouldEnqueueProtocolRequiredRetry,
  shouldEnqueueRetryableAdapterFailure,
  shouldReapHeartbeatRun,
  shouldRecoverDegradedProtocolRun,
  shouldRecoverIdleProtocolRun,
  shouldSkipSupersededProtocolFollowup,
  RUN_PROTOCOL_DEGRADED_WATCHDOG_MS,
  RUN_PROTOCOL_IDLE_WATCHDOG_MS,
} from "./heartbeat-protocol-watchdog.js";
export { buildHeartbeatCancellationArtifacts } from "./heartbeat-wakeup-control.js";

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
  classifyProtocolRuntimeDegradedState,
  decideDispatchWatchdogAction,
  describeProtocolRunRuntimeState,
  hasRequiredProtocolProgress,
  isIdleProtocolWatchdogEligibleRequirement,
  isSupersededProtocolWakeReason,
  isWorkflowStateEligibleForProtocolRetry,
  parseHeartbeatPolicyConfig,
  readLeaseLastProgressAt,
  resolveProtocolIdleWatchdogDelayMs,
  resolveDegradedProtocolRecoveryReason,
  runDispatchWatchdogOutsideDbContext,
  runProtocolWatchdogRecoveries,
  scheduleDeferredRunDispatch,
  shouldEnqueueProtocolRequiredRetry,
  shouldEnqueueRetryableAdapterFailure,
  shouldReapHeartbeatRun,
  shouldRecoverDegradedProtocolRun,
  shouldRecoverIdleProtocolRun,
  shouldSkipSupersededProtocolFollowup,
} from "./heartbeat-protocol-watchdog.js";

const MAX_LIVE_LOG_CHUNK_BYTES = 8 * 1024;
const RUN_LEASE_HEARTBEAT_INTERVAL_MS = 10_000;
const RUN_DISPATCH_WATCHDOG_MS = 8_000;
const RUN_DISPATCH_RETRY_LIMIT = 2;
const startLocksByAgent = new Map<string, Promise<void>>();

class SupersededProtocolFollowupError extends Error {
  readonly code = "superseded_followup";

  constructor(message: string) {
    super(message);
    this.name = "SupersededProtocolFollowupError";
  }
}

function appendExcerpt(prev: string, chunk: string) {
  return appendWithCap(prev, chunk, MAX_EXCERPT_BYTES);
}

function isRepoBackedWorkspaceSource(source: ResolvedWorkspaceForRun["source"] | null | undefined) {
  return source === "project_shared" || source === "project_isolated";
}

async function withAgentStartLock<T>(agentId: string, fn: () => Promise<T>) {
  const previous = startLocksByAgent.get(agentId) ?? Promise.resolve();
  const run = previous.then(() => runWithoutDbContext(fn));
  const marker = run.then(
    () => undefined,
    () => undefined,
  );
  startLocksByAgent.set(agentId, marker);
  try {
    return await run;
  } finally {
    if (startLocksByAgent.get(agentId) === marker) {
      startLocksByAgent.delete(agentId);
    }
  }
}

interface WakeupOptions {
  source?: "timer" | "assignment" | "on_demand" | "automation";
  triggerDetail?: "manual" | "ping" | "callback" | "system";
  reason?: string | null;
  payload?: Record<string, unknown> | null;
  idempotencyKey?: string | null;
  requestedByActorType?: "user" | "agent" | "system";
  requestedByActorId?: string | null;
  contextSnapshot?: Record<string, unknown>;
}

export function resolveHeartbeatRunOutcome(input: {
  latestRunStatus?: string | null;
  timedOut: boolean;
  exitCode?: number | null;
  errorMessage?: string | null;
  protocolProgressFailure?: {
    error: string;
    errorCode: string;
  } | null;
}) {
  if (input.latestRunStatus === "cancelled") return "cancelled" as const;
  if (input.timedOut) return "timed_out" as const;
  if ((input.exitCode ?? 0) === 0 && !input.errorMessage && !input.protocolProgressFailure) {
    return "succeeded" as const;
  }
  return "failed" as const;
}

export function buildHeartbeatOutcomePersistence(input: {
  outcome: "succeeded" | "failed" | "cancelled" | "timed_out";
  protocolProgressFailure?: {
    error: string;
    errorCode: string;
  } | null;
  adapterResult: {
    exitCode?: number | null;
    signal?: string | null;
    errorMessage?: string | null;
    errorCode?: string | null;
  };
  usageJson: Record<string, unknown> | null;
  resultJson: Record<string, unknown> | null;
  nextSessionDisplayId: string | null;
  nextSessionLegacyId: string | null;
  stdoutExcerpt: string;
  stderrExcerpt: string;
  logSummary?: { bytes: number; sha256?: string; compressed: boolean } | null;
  finishedAt?: Date;
}) {
  const finishedAt = input.finishedAt ?? new Date();
  const status =
    input.outcome === "succeeded"
      ? "succeeded"
      : input.outcome === "cancelled"
        ? "cancelled"
        : input.outcome === "timed_out"
          ? "timed_out"
          : "failed";
  const error =
    input.outcome === "succeeded"
      ? null
      : input.protocolProgressFailure?.error ??
        input.adapterResult.errorMessage ??
        (input.outcome === "timed_out" ? "Timed out" : "Adapter failed");
  const errorCode =
    input.outcome === "timed_out"
      ? "timeout"
      : input.outcome === "cancelled"
        ? "cancelled"
        : input.outcome === "failed"
          ? (input.protocolProgressFailure?.errorCode ?? input.adapterResult.errorCode ?? "adapter_failed")
          : null;

  return {
    status,
    runPatch: {
      finishedAt,
      error,
      errorCode,
      exitCode: input.adapterResult.exitCode ?? null,
      signal: input.adapterResult.signal ?? null,
      usageJson: input.usageJson,
      resultJson: input.resultJson,
      sessionIdAfter: input.nextSessionDisplayId ?? input.nextSessionLegacyId,
      stdoutExcerpt: input.stdoutExcerpt,
      stderrExcerpt: input.stderrExcerpt,
      logBytes: input.logSummary?.bytes,
      logSha256: input.logSummary?.sha256,
      logCompressed: input.logSummary?.compressed ?? false,
    },
    wakeupStatus: input.outcome === "succeeded" ? "completed" : status,
    wakeupPatch: {
      finishedAt,
      error: input.protocolProgressFailure?.error ?? input.adapterResult.errorMessage ?? null,
    },
  };
}

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
    dispatchAgentQueueStart,
    executeRun,
    startNextQueuedRunForAgent,
  });

  wakeupControl = createHeartbeatWakeupControl({
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
    enqueueWakeup: (agentId, opts) => enqueueWakeup(agentId, opts),
  });

  const {
    cancelActiveForAgent,
    cancelIssueScope,
    cancelRunInternal,
    cancelSupersededIssueFollowups,
    releaseIssueExecutionAndPromote,
    wakeLeadSupervisorForRunFailure,
  } = wakeupControl;

  async function recoverIdleProtocolRunIfNeeded(input: {
    run: typeof heartbeatRuns.$inferSelect;
    lease?: typeof heartbeatRunLeases.$inferSelect | null;
    now?: Date;
    idleThresholdMs?: number;
  }) {
    if (!runningProcesses.has(input.run.id)) return false;
    const context = parseObject(input.run.contextSnapshot);
    const issueId = readNonEmptyString(context.issueId);
    if (!issueId) return false;

    const requirement = resolveProtocolRunRequirement({
      protocolMessageType: readNonEmptyString(context.protocolMessageType),
      protocolRecipientRole: readNonEmptyString(context.protocolRecipientRole),
    });
    if (!isIdleProtocolWatchdogEligibleRequirement(requirement)) return false;

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
      .where(and(eq(issues.id, issueId), eq(issues.companyId, input.run.companyId)))
      .limit(1)
      .then((rows) => rows[0] ?? null);
    const latestEvent = await db
      .select({
        eventType: heartbeatRunEvents.eventType,
        createdAt: heartbeatRunEvents.createdAt,
      })
      .from(heartbeatRunEvents)
      .where(eq(heartbeatRunEvents.runId, input.run.id))
      .orderBy(desc(heartbeatRunEvents.seq))
      .limit(1)
      .then((rows) => rows[0] ?? null);
    const protocolRetryCount =
      typeof context.protocolRequiredRetryCount === "number" && Number.isFinite(context.protocolRequiredRetryCount)
        ? context.protocolRequiredRetryCount
        : 0;

    if (!shouldRecoverIdleProtocolRun({
      runStatus: input.run.status,
      hasRunningProcess: true,
      requirement,
      issueStatus: issueStateSnapshot?.status ?? null,
      workflowState: issueStateSnapshot?.workflowState ?? null,
      protocolRetryCount,
      checkpointJson: input.lease?.checkpointJson ?? null,
      latestEvent,
      startedAt: input.run.startedAt,
      now: input.now,
      idleThresholdMs: input.idleThresholdMs,
    })) {
      return false;
    }

    const checkpoint = parseObject(input.lease?.checkpointJson);
    await enqueueWakeup(input.run.agentId, {
      source: "automation",
      triggerDetail: "system",
      reason: "protocol_required_retry",
      payload: {
        issueId,
        protocolRequiredPreviousRunId: input.run.id,
        protocolIdleRecovery: true,
      },
      contextSnapshot: {
        ...context,
        issueId,
        taskId: issueId,
        wakeReason: "protocol_required_retry",
        protocolOriginalWakeReason: readNonEmptyString(context.wakeReason),
        protocolRequiredRetryCount: protocolRetryCount + 1,
        protocolRequiredPreviousRunId: input.run.id,
        protocolIdleRecovery: true,
        protocolIdleRecoveryPhase:
          readNonEmptyString(checkpoint.phase)
          ?? readNonEmptyString(latestEvent?.eventType),
        forceFollowupRun: true,
        forceFreshAdapterSession: true,
      },
    });

    await cancelRunInternal(input.run.id, {
      message: "Cancelled stalled protocol follow-up after idle adapter startup",
      checkpointMessage: "run cancelled after idle protocol stall",
    });
    return true;
  }

  async function recoverDegradedProtocolRunIfNeeded(input: {
    run: typeof heartbeatRuns.$inferSelect;
    lease?: typeof heartbeatRunLeases.$inferSelect | null;
    now?: Date;
    degradedThresholdMs?: number;
  }) {
    if (!runningProcesses.has(input.run.id)) return false;
    const context = parseObject(input.run.contextSnapshot);
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
      .where(and(eq(issues.id, issueId), eq(issues.companyId, input.run.companyId)))
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
      runStatus: input.run.status,
      hasRunningProcess: true,
      requirement,
      wakeReason: readNonEmptyString(context.wakeReason),
      issueStatus: issueStateSnapshot?.status ?? null,
      workflowState: issueStateSnapshot?.workflowState ?? null,
      protocolRetryCount,
      protocolDegradedRecoveryCount,
      adapterRetryCount,
      adapterRetryErrorCode,
      checkpointJson: input.lease?.checkpointJson ?? null,
      startedAt: input.run.startedAt,
      now: input.now,
      degradedThresholdMs: input.degradedThresholdMs,
    })) {
      return false;
    }

    const degradedReason = resolveDegradedProtocolRecoveryReason({
      runStatus: input.run.status,
      requirement,
      wakeReason: readNonEmptyString(context.wakeReason),
      adapterRetryCount,
      adapterRetryErrorCode,
      checkpointJson: input.lease?.checkpointJson ?? null,
      startedAt: input.run.startedAt,
      now: input.now,
      degradedThresholdMs: input.degradedThresholdMs,
    });
    if (!degradedReason) return false;

    const autoAssisted = await protocolAutoAssist.assistDegradedRun({
      runId: input.run.id,
      issueId,
      companyId: input.run.companyId,
      agentId: input.run.agentId,
      degradedReason,
      contextSnapshot: context,
    }).catch((err) => {
      logger.warn(
        {
          err,
          runId: input.run.id,
          issueId,
          degradedReason,
        },
        "local-trusted deterministic protocol auto-assist failed",
      );
      return false;
    });
    if (autoAssisted) {
      await cancelRunInternal(input.run.id, {
        message: `Cancelled degraded protocol run after deterministic local-trusted auto-assist (${degradedReason})`,
        checkpointMessage: "run cancelled after deterministic local-trusted protocol auto-assist",
      });
      return true;
    }

    await enqueueWakeup(input.run.agentId, {
      source: "automation",
      triggerDetail: "system",
      reason: "protocol_required_retry",
      payload: {
        issueId,
        protocolRequiredPreviousRunId: input.run.id,
        protocolDegradedRecovery: true,
        protocolDegradedRecoveryReason: degradedReason,
      },
      contextSnapshot: {
        ...context,
        issueId,
        taskId: issueId,
        wakeReason: "protocol_required_retry",
        protocolOriginalWakeReason: readNonEmptyString(context.wakeReason),
        protocolRequiredRetryCount: protocolRetryCount + 1,
        protocolDegradedRecoveryCount: protocolDegradedRecoveryCount + 1,
        protocolRequiredPreviousRunId: input.run.id,
        protocolDegradedRecovery: true,
        protocolDegradedRecoveryReason: degradedReason,
        forceFollowupRun: true,
        forceFreshAdapterSession: true,
      },
    });

    await cancelRunInternal(input.run.id, {
      message: `Cancelled degraded protocol follow-up after degraded runtime detection (${degradedReason})`,
      checkpointMessage: "run cancelled after degraded protocol runtime detection",
    });
    return true;
  }

  async function cancelSupersededProtocolRunIfNeeded(input: {
    run: typeof heartbeatRuns.$inferSelect;
    context: Record<string, unknown>;
  }) {
    if (input.run.status !== "running") return false;
    if (!runningProcesses.has(input.run.id)) return false;

    const issueId = readNonEmptyString(input.context.issueId);
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
      .where(and(eq(issues.id, issueId), eq(issues.companyId, input.run.companyId)))
      .limit(1)
      .then((rows) => rows[0] ?? null);

    if (!shouldSkipSupersededProtocolFollowup({
      wakeReason: readNonEmptyString(input.context.wakeReason),
      issueStatus: issueStateSnapshot?.status ?? null,
      workflowState: issueStateSnapshot?.workflowState ?? null,
      protocolMessageType: readNonEmptyString(input.context.protocolMessageType),
      protocolRecipientRole: readNonEmptyString(input.context.protocolRecipientRole),
    })) {
      return false;
    }

    const message =
      issueStateSnapshot?.status === "done" || issueStateSnapshot?.status === "cancelled"
        ? `Cancelled superseded protocol run because issue is already ${issueStateSnapshot.status}.`
        : "Cancelled superseded protocol run because issue workflow moved beyond this protocol lane.";

    await cancelRunInternal(input.run.id, {
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

  async function updateRuntimeState(
    agent: typeof agents.$inferSelect,
    run: typeof heartbeatRuns.$inferSelect,
    result: AdapterExecutionResult,
    session: { legacySessionId: string | null },
  ) {
    await ensureRuntimeState(agent);
    const usage = result.usage;
    const inputTokens = usage?.inputTokens ?? 0;
    const outputTokens = usage?.outputTokens ?? 0;
    const cachedInputTokens = usage?.cachedInputTokens ?? 0;
    const additionalCostCents = Math.max(0, Math.round((result.costUsd ?? 0) * 100));
    const hasTokenUsage = inputTokens > 0 || outputTokens > 0 || cachedInputTokens > 0;

    await db
      .update(agentRuntimeState)
      .set({
        adapterType: agent.adapterType,
        sessionId: session.legacySessionId,
        lastRunId: run.id,
        lastRunStatus: run.status,
        lastError: result.errorMessage ?? null,
        totalInputTokens: sql`${agentRuntimeState.totalInputTokens} + ${inputTokens}`,
        totalOutputTokens: sql`${agentRuntimeState.totalOutputTokens} + ${outputTokens}`,
        totalCachedInputTokens: sql`${agentRuntimeState.totalCachedInputTokens} + ${cachedInputTokens}`,
        totalCostCents: sql`${agentRuntimeState.totalCostCents} + ${additionalCostCents}`,
        updatedAt: new Date(),
      })
      .where(eq(agentRuntimeState.agentId, agent.id));

    if (additionalCostCents > 0 || hasTokenUsage) {
      await db.insert(costEvents).values({
        companyId: agent.companyId,
        agentId: agent.id,
        provider: result.provider ?? "unknown",
        model: result.model ?? "unknown",
        inputTokens,
        outputTokens,
        costCents: additionalCostCents,
        occurredAt: new Date(),
      });
    }

    if (additionalCostCents > 0) {
      await db
        .update(agents)
        .set({
          spentMonthlyCents: sql`${agents.spentMonthlyCents} + ${additionalCostCents}`,
          updatedAt: new Date(),
        })
        .where(eq(agents.id, agent.id));
    }
  }

  async function startNextQueuedRunForAgent(agentId: string) {
    return withAgentStartLock(agentId, async () => {
      const agent = await getAgent(agentId);
      if (!agent) return [];
      const policy = parseHeartbeatPolicy(agent);
      const runningCount = await countRunningRunsForAgent(agentId);
      const availableSlots = Math.max(0, policy.maxConcurrentRuns - runningCount);
      if (availableSlots <= 0) return [];

      const queuedRuns = await db
        .select()
        .from(heartbeatRuns)
        .where(and(eq(heartbeatRuns.agentId, agentId), eq(heartbeatRuns.status, "queued")))
        .orderBy(asc(heartbeatRuns.createdAt));
      if (queuedRuns.length === 0) return [];

      const missingPriorityIssueIds = Array.from(new Set(
        queuedRuns.flatMap((run) => {
          const contextSnapshot = parseObject(run.contextSnapshot);
          const issueId = readNonEmptyString(contextSnapshot.issueId);
          const issuePriority = normalizeIssuePriorityValue(contextSnapshot.issuePriority);
          return issueId && !issuePriority ? [issueId] : [];
        }),
      ));
      const issuePriorityByIssueId = new Map<string, IssuePriority>();
      if (missingPriorityIssueIds.length > 0) {
        const issuePriorityRows = await db
          .select({
            id: issues.id,
            priority: issues.priority,
          })
          .from(issues)
          .where(
            and(
              eq(issues.companyId, agent.companyId),
              inArray(issues.id, missingPriorityIssueIds),
            ),
          );
        for (const row of issuePriorityRows) {
          const priority = normalizeIssuePriorityValue(row.priority);
          if (priority) issuePriorityByIssueId.set(row.id, priority);
        }
      }

      const prioritizedRuns = prioritizeQueuedRunsForDispatch({
        runs: queuedRuns,
        issuePriorityByIssueId,
      }).slice(0, availableSlots);

      const claimedRuns: Array<typeof heartbeatRuns.$inferSelect> = [];
      for (const queuedRun of prioritizedRuns) {
        const claimed = await claimQueuedRun(queuedRun.run);
        if (!claimed) continue;
        claimedRuns.push(await applyDispatchPrioritySelection({
          run: claimed,
          selection: queuedRun,
        }));
      }
      if (claimedRuns.length === 0) return [];

      for (const claimedRun of claimedRuns) {
        logger.info(
          {
            runId: claimedRun.id,
            agentId: claimedRun.agentId,
          },
          "scheduling heartbeat execution",
        );
        scheduleDeferredRunDispatch(() => {
          runWithoutDbContext(() => {
            logger.info(
              {
                runId: claimedRun.id,
                agentId: claimedRun.agentId,
              },
              "dispatching heartbeat execution task",
            );
            void executeRun(claimedRun.id).catch((err) => {
              logger.error({ err, runId: claimedRun.id }, "queued heartbeat execution failed");
            });
          });
        });
      }
      return claimedRuns;
    });
  }

  function dispatchAgentQueueStart(agentId: string) {
    const start = () => {
      runWithoutDbContext(() => {
        void startNextQueuedRunForAgent(agentId).catch((err) => {
          logger.error({ err, agentId }, "failed to start queued heartbeat run");
        });
      });
    };

    if (enqueueAfterDbCommit(start)) return;
    start();
  }

  async function executeRun(runId: string) {
    clearDispatchWatchdog(runId);
    logger.info({ runId }, "heartbeat execution entered");
    let run = await getRun(runId);
    if (!run) return;
    if (run.status !== "queued" && run.status !== "running") return;

    if (run.status === "queued") {
      const claimed = await claimQueuedRun(run);
      if (!claimed) {
        // Another worker has already claimed or finalized this run.
        return;
      }
      run = claimed;
      clearDispatchWatchdog(run.id);
    }

    const agent = await getAgent(run.agentId);
    if (!agent) {
      await setRunStatus(runId, "failed", {
        error: "Agent not found",
        errorCode: "agent_not_found",
        finishedAt: new Date(),
      });
      await setWakeupStatus(run.wakeupRequestId, "failed", {
        finishedAt: new Date(),
        error: "Agent not found",
      });
      const failedRun = await getRun(runId);
      if (failedRun) await releaseIssueExecutionAndPromote(failedRun);
      return;
    }

    const context = parseObject(run.contextSnapshot);
    const taskKey = deriveTaskKey(context, null);
    const sessionCodec = getAdapterSessionCodec(agent.adapterType);
    const issueId = readNonEmptyString(context.issueId);
    let seq = 1;
    let handle: RunLogHandle | null = null;
    let stdoutExcerpt = "";
    let stderrExcerpt = "";
    let leaseHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let currentPhase = "preflight.init";
    let lastProgressAt = new Date();
    let eventRun = run;
    let taskSession: typeof agentTaskSessions.$inferSelect | null = null;
    let previousSessionParams: Record<string, unknown> | null = null;
    let previousSessionDisplayId: string | null = null;
    let runtimeWorkspaceWarnings: string[] = [];
    let resolvedWorkspace: ResolvedWorkspaceForRun | null = null;
    let runtimeForAdapter: {
      sessionId: string | null;
      sessionParams: Record<string, unknown> | null;
      sessionDisplayId: string | null;
      taskKey: string | null;
    } = {
      sessionId: null,
      sessionParams: null,
      sessionDisplayId: null,
      taskKey,
    };
    const idleWatchdogRequirement = resolveProtocolRunRequirement({
      protocolMessageType: readNonEmptyString(context.protocolMessageType),
      protocolRecipientRole: readNonEmptyString(context.protocolRecipientRole),
    });
    const idleWatchdogEligible = isIdleProtocolWatchdogEligibleRequirement(idleWatchdogRequirement);
    const bumpProtocolIdleWatchdog = () => {
      if (!idleWatchdogEligible) return;
      scheduleProtocolIdleWatchdog(runId);
    };

    const appendCheckpoint = async (
      phase: string,
      message: string,
      payload?: Record<string, unknown>,
    ) => {
      currentPhase = phase;
      const progressAt = new Date();
      lastProgressAt = progressAt;
      await upsertRunLease({
        run: eventRun,
        status: phase.startsWith("finalize.") ? "finalizing" : phase.startsWith("adapter.") ? "executing" : "launching",
        checkpointJson: {
          phase,
          message,
          lastProgressAt: progressAt.toISOString(),
          ...(payload ?? {}),
        },
      });
      await appendRunEvent(eventRun, seq++, {
        eventType: "checkpoint",
        stream: "system",
        level: "info",
        message,
        payload,
      });
      if (phase.startsWith("adapter.")) {
        bumpProtocolIdleWatchdog();
      }
    };

    try {
      await appendCheckpoint("preflight.runtime_state", "loading runtime state");
      const runtime = await ensureRuntimeState(agent);

      const wakeReason = readNonEmptyString(context.wakeReason);
      const issueRuntimeConfig = issueId
        ? await db
            .select({
              assigneeAgentId: issues.assigneeAgentId,
              assigneeAdapterOverrides: issues.assigneeAdapterOverrides,
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
            .where(and(eq(issues.id, issueId), eq(issues.companyId, agent.companyId)))
            .then((rows) => rows[0] ?? null)
        : null;
      if (shouldSkipSupersededProtocolFollowup({
        wakeReason,
        issueStatus: issueRuntimeConfig?.status ?? null,
        workflowState: issueRuntimeConfig?.workflowState ?? null,
        protocolMessageType: readNonEmptyString(context.protocolMessageType),
        protocolRecipientRole: readNonEmptyString(context.protocolRecipientRole),
      })) {
        const message =
          issueRuntimeConfig?.status === "done" || issueRuntimeConfig?.status === "cancelled"
            ? `Skipping stale protocol follow-up because issue is already ${issueRuntimeConfig.status}.`
            : "Skipping stale protocol follow-up because issue workflow no longer matches this wake.";
        currentPhase = "preflight.followup_superseded";
        await appendCheckpoint("preflight.followup_superseded", message, {
          wakeReason,
          issueStatus: issueRuntimeConfig?.status ?? null,
          workflowState: issueRuntimeConfig?.workflowState ?? null,
          protocolMessageType: readNonEmptyString(context.protocolMessageType),
          protocolRecipientRole: readNonEmptyString(context.protocolRecipientRole),
        });
        const cancelledRun = await setRunStatus(run.id, "cancelled", {
          finishedAt: new Date(),
          error: message,
          errorCode: "superseded_followup",
        });
        await setWakeupStatus(run.wakeupRequestId, "cancelled", {
          finishedAt: new Date(),
          error: message,
        });
        if (cancelledRun) {
          await appendRunEvent(cancelledRun, seq++, {
            eventType: "lifecycle",
            stream: "system",
            level: "warn",
            message,
            payload: {
              wakeReason,
              issueStatus: issueRuntimeConfig?.status ?? null,
            },
          });
          await releaseIssueExecutionAndPromote(cancelledRun);
          await upsertRunLease({
            run: cancelledRun,
            status: "released",
            checkpointJson: {
              phase: "preflight.followup_superseded",
              message,
              wakeReason,
              issueStatus: issueRuntimeConfig?.status ?? null,
            },
            heartbeatAt: new Date(),
            leaseExpiresAt: new Date(),
            releasedAt: new Date(),
            lastError: null,
          });
        }
        await finalizeAgentStatus(agent.id, "cancelled");
        return;
      }
      const issueAssigneeConfig = issueRuntimeConfig
        ? {
            assigneeAgentId: issueRuntimeConfig.assigneeAgentId,
            assigneeAdapterOverrides: issueRuntimeConfig.assigneeAdapterOverrides,
          }
        : null;
      const issueAssigneeOverrides =
        issueAssigneeConfig && issueAssigneeConfig.assigneeAgentId === agent.id
          ? parseIssueAssigneeAdapterOverrides(
              issueAssigneeConfig.assigneeAdapterOverrides,
            )
          : null;
      taskSession = taskKey
        ? await getTaskSession(agent.companyId, agent.id, agent.adapterType, taskKey)
        : null;
      const resetTaskSession = shouldResetTaskSessionForWake(context);
      const sessionResetReason = describeSessionResetReason(context);
      const taskSessionForRun = resetTaskSession ? null : taskSession;
      previousSessionParams = normalizeSessionParams(
        sessionCodec.deserialize(taskSessionForRun?.sessionParamsJson ?? null),
      );

      await appendCheckpoint("preflight.workspace_resolve", "resolving workspace");
      resolvedWorkspace = await resolveWorkspaceForRun({
        db,
        agent,
        context,
        taskKey,
        previousSessionParams,
        useProjectWorkspace: issueAssigneeOverrides?.useProjectWorkspace ?? null,
      });
      await appendCheckpoint("preflight.workspace_resolved", "workspace resolved", {
        source: resolvedWorkspace.source,
        workspaceId: resolvedWorkspace.workspaceId ?? null,
        projectId: resolvedWorkspace.projectId ?? null,
        workspaceUsage: resolvedWorkspace.workspaceUsage ?? null,
      });

      const runtimeSessionResolution = resolveRuntimeSessionParamsForWorkspace({
        agentId: agent.id,
        previousSessionParams,
        resolvedWorkspace,
      });
      const runtimeSessionParams = runtimeSessionResolution.sessionParams;
      runtimeWorkspaceWarnings = [
        ...resolvedWorkspace.warnings,
        ...(runtimeSessionResolution.warning ? [runtimeSessionResolution.warning] : []),
        ...(resetTaskSession && sessionResetReason
          ? [
              taskKey
                ? `Skipping saved session resume for task "${taskKey}" because ${sessionResetReason}.`
                : `Skipping saved session resume because ${sessionResetReason}.`,
            ]
          : []),
      ];
      attachResolvedWorkspaceContextToRunContext({
        contextSnapshot: context,
        resolvedWorkspace,
      });

      const runtimeSessionFallback = taskKey || resetTaskSession ? null : runtime?.sessionId ?? null;
      previousSessionDisplayId = truncateDisplayId(
        taskSessionForRun?.sessionDisplayId ??
          (sessionCodec.getDisplayId ? sessionCodec.getDisplayId(runtimeSessionParams) : null) ??
          readNonEmptyString(runtimeSessionParams?.sessionId) ??
          runtimeSessionFallback,
      );
      runtimeForAdapter = {
        sessionId: readNonEmptyString(runtimeSessionParams?.sessionId) ?? runtimeSessionFallback,
        sessionParams: runtimeSessionParams,
        sessionDisplayId: previousSessionDisplayId,
        taskKey,
      };
      await appendCheckpoint("preflight.runtime_session_ready", "runtime session resolved", {
        sessionDisplayId: runtimeForAdapter.sessionDisplayId,
        taskKey,
      });

      const startedAt = run.startedAt ?? new Date();
      lastProgressAt = startedAt;
      const runningWithSession = await db
        .update(heartbeatRuns)
        .set({
          startedAt,
          contextSnapshot: context,
          sessionIdBefore: runtimeForAdapter.sessionDisplayId ?? runtimeForAdapter.sessionId,
          updatedAt: new Date(),
        })
        .where(eq(heartbeatRuns.id, run.id))
        .returning()
        .then((rows) => rows[0] ?? null);
      if (runningWithSession) {
        run = runningWithSession;
        eventRun = runningWithSession;
      }

      const runningAgent = await db
        .update(agents)
        .set({ status: "running", updatedAt: new Date() })
        .where(eq(agents.id, agent.id))
        .returning()
        .then((rows) => rows[0] ?? null);

      if (runningAgent) {
        publishLiveEvent({
          companyId: runningAgent.companyId,
          type: "agent.status",
          payload: {
            agentId: runningAgent.id,
            status: runningAgent.status,
            outcome: "running",
          },
        });
      }

      await appendRunEvent(eventRun, seq++, {
        eventType: "lifecycle",
        stream: "system",
        level: "info",
        message: "run started",
      });

      handle = await runLogStore.begin({
        companyId: run.companyId,
        agentId: run.agentId,
        runId,
      });

      await db
        .update(heartbeatRuns)
        .set({
          logStore: handle.store,
          logRef: handle.logRef,
          updatedAt: new Date(),
        })
        .where(eq(heartbeatRuns.id, runId));
      await appendCheckpoint("preflight.log_store_ready", "run log store ready", {
        logStore: handle.store,
      });

      const onLog = async (stream: "stdout" | "stderr" | "system", chunk: string) => {
        lastProgressAt = new Date();
        bumpProtocolIdleWatchdog();
        if (stream === "stdout") stdoutExcerpt = appendExcerpt(stdoutExcerpt, chunk);
        if (stream === "stderr") stderrExcerpt = appendExcerpt(stderrExcerpt, chunk);

        if (handle) {
          await runLogStore.append(handle, {
            stream,
            chunk,
            ts: new Date().toISOString(),
          });
        }

        const payloadChunk =
          chunk.length > MAX_LIVE_LOG_CHUNK_BYTES
            ? chunk.slice(chunk.length - MAX_LIVE_LOG_CHUNK_BYTES)
            : chunk;

        publishLiveEvent({
          companyId: run.companyId,
          type: "heartbeat.run.log",
          payload: {
            runId: run.id,
            agentId: run.agentId,
            stream,
            chunk: payloadChunk,
            truncated: payloadChunk.length !== chunk.length,
          },
        });
      };
      for (const warning of runtimeWorkspaceWarnings) {
        await onLog("system", `[squadrail] ${warning}\n`);
      }
      assertResolvedWorkspaceReadyForExecution({
        resolvedWorkspace,
      });
      await appendCheckpoint("preflight.workspace_ready", "workspace ready for execution", {
        source: resolvedWorkspace.source,
        workspaceUsage: resolvedWorkspace.workspaceUsage ?? null,
      });

      const config = parseObject(agent.adapterConfig);
      const mergedConfig = issueAssigneeOverrides?.adapterConfig
        ? { ...config, ...issueAssigneeOverrides.adapterConfig }
        : config;
      const resolvedConfig = await secretsSvc.resolveAdapterConfigForRuntime(
        agent.companyId,
        mergedConfig,
      );
      const runtimeConfigWithDeployment = {
        ...resolvedConfig,
        deploymentMode: loadConfig().deploymentMode,
      };
      await appendCheckpoint("preflight.adapter_config_ready", "adapter runtime config resolved", {
        adapterType: agent.adapterType,
      });
      const onAdapterMeta = async (meta: AdapterInvocationMeta) => {
        currentPhase = "adapter.invoke";
        lastProgressAt = new Date();
        bumpProtocolIdleWatchdog();
        await appendRunEvent(eventRun, seq++, {
          eventType: "adapter.invoke",
          stream: "system",
          level: "info",
          message: "adapter invocation",
          payload: meta as unknown as Record<string, unknown>,
        });
      };

      const adapter = getServerAdapter(agent.adapterType);
      const authToken = adapter.supportsLocalAgentJwt
        ? createLocalAgentJwt(agent.id, agent.companyId, agent.adapterType, run.id)
        : null;
      if (adapter.supportsLocalAgentJwt && !authToken) {
        logger.warn(
          {
            companyId: agent.companyId,
            agentId: agent.id,
            runId: run.id,
            adapterType: agent.adapterType,
          },
          "local agent jwt secret missing or invalid; running without injected SQUADRAIL_API_KEY",
        );
      }
      await appendCheckpoint("adapter.execute_start", "starting adapter execution", {
        adapterType: agent.adapterType,
      });
      let supersededProtocolCheckInFlight = false;
      leaseHeartbeatTimer = setInterval(() => {
        void (async () => {
          await upsertRunLease({
            run: eventRun,
            status: "executing",
            checkpointJson: {
              phase: currentPhase,
              message: "lease heartbeat",
              lastProgressAt: lastProgressAt.toISOString(),
            },
          });

          if (supersededProtocolCheckInFlight) return;
          supersededProtocolCheckInFlight = true;
          try {
            await cancelSupersededProtocolRunIfNeeded({
              run: eventRun,
              context,
            });
          } finally {
            supersededProtocolCheckInFlight = false;
          }
        })();
      }, RUN_LEASE_HEARTBEAT_INTERVAL_MS);
      leaseHeartbeatTimer.unref?.();
      const adapterResult = await adapter.execute({
        runId: run.id,
        agent,
        runtime: runtimeForAdapter,
        config: runtimeConfigWithDeployment,
        context,
        onLog,
        onMeta: onAdapterMeta,
        authToken: authToken ?? undefined,
      });
      const nextSessionState = resolveNextSessionState({
        codec: sessionCodec,
        adapterResult,
        previousParams: previousSessionParams,
        previousDisplayId: runtimeForAdapter.sessionDisplayId,
        previousLegacySessionId: runtimeForAdapter.sessionId,
      });
      const protocolRequirement = resolveProtocolRunRequirement({
        protocolMessageType: readNonEmptyString(context.protocolMessageType),
        protocolRecipientRole: readNonEmptyString(context.protocolRecipientRole),
      });
      const protocolRetryCount =
        typeof context.protocolRequiredRetryCount === "number" && Number.isFinite(context.protocolRequiredRetryCount)
          ? context.protocolRequiredRetryCount
          : 0;
      const adapterRetryCount =
        typeof context.adapterRetryCount === "number" && Number.isFinite(context.adapterRetryCount)
          ? context.adapterRetryCount
          : 0;
      let protocolProgressResult: Record<string, unknown> | null = null;
      let protocolProgressFailure:
        | {
            error: string;
            errorCode: "protocol_required";
          }
        | null = null;
      let adapterRetryResult: Record<string, unknown> | null = null;
      let adapterRetryEnqueued = false;

      if (
        issueId
        && protocolRequirement
        && (adapterResult.exitCode ?? 0) === 0
        && !adapterResult.errorMessage
      ) {
        currentPhase = "finalize.protocol_progress_check";
        await appendCheckpoint("finalize.protocol_progress_check", "validating protocol progress", {
          protocolMessageType: protocolRequirement.protocolMessageType,
          recipientRole: protocolRequirement.recipientRole,
          requiredMessageTypes: protocolRequirement.requiredMessageTypes,
        });

        const protocolMessages = await db
          .select({
            id: issueProtocolMessages.id,
            messageType: issueProtocolMessages.messageType,
            createdAt: issueProtocolMessages.createdAt,
          })
          .from(issueProtocolMessages)
          .where(
            and(
              eq(issueProtocolMessages.companyId, run.companyId),
              eq(issueProtocolMessages.issueId, issueId),
              eq(issueProtocolMessages.senderActorType, "agent"),
              eq(issueProtocolMessages.senderActorId, agent.id),
              gt(
                issueProtocolMessages.createdAt,
                new Date(startedAt.getTime() - 1_000),
              ),
            ),
          )
          .orderBy(asc(issueProtocolMessages.createdAt));

        const observedMessageTypes = Array.from(
          new Set(
            protocolMessages
              .map((message) => readNonEmptyString(message.messageType))
              .filter((messageType): messageType is string => Boolean(messageType)),
          ),
        );
        const issueStateSnapshot = issueId
          ? await db
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
            .where(and(eq(issues.id, issueId), eq(issues.companyId, agent.companyId)))
            .limit(1)
            .then((rows) => rows[0] ?? null)
          : null;
        const satisfied = hasRequiredProtocolProgress({
          requirement: protocolRequirement,
          messages: protocolMessages,
          finalWorkflowState: issueStateSnapshot?.workflowState ?? null,
        });

        protocolProgressResult = {
          required: true,
          protocolMessageType: protocolRequirement.protocolMessageType,
          recipientRole: protocolRequirement.recipientRole,
          requiredMessageTypes: protocolRequirement.requiredMessageTypes,
          observedMessageTypes,
          retryCount: protocolRetryCount,
          satisfied,
        };

        if (!satisfied) {
          const retryEnqueued = shouldEnqueueProtocolRequiredRetry({
            protocolRetryCount,
            issueStatus: issueStateSnapshot?.status ?? null,
            workflowState: issueStateSnapshot?.workflowState ?? null,
            requirement: protocolRequirement,
          });
          if (retryEnqueued) {
            const retryContextSnapshot: Record<string, unknown> = {
              ...context,
              issueId,
              taskId: issueId,
              wakeReason: "protocol_required_retry",
              protocolOriginalWakeReason: readNonEmptyString(context.wakeReason),
              protocolRequiredRetryCount: protocolRetryCount + 1,
              protocolRequiredPreviousRunId: run.id,
              forceFollowupRun: true,
            };
            await enqueueWakeup(agent.id, {
              source: "automation",
              triggerDetail: "system",
              reason: "protocol_required_retry",
              payload: {
                issueId,
                protocolRequiredPreviousRunId: run.id,
              },
              contextSnapshot: retryContextSnapshot,
            });
          }

          const error = buildRequiredProtocolProgressError({
            requirement: protocolRequirement,
            observedMessageTypes,
            retryEnqueued,
          });
          protocolProgressFailure = {
            error,
            errorCode: "protocol_required",
          };

          await appendRunEvent(eventRun, seq++, {
            eventType: "protocol.required",
            stream: "system",
            level: "error",
            message: error,
            payload: {
              protocolMessageType: protocolRequirement.protocolMessageType,
              recipientRole: protocolRequirement.recipientRole,
              requiredMessageTypes: protocolRequirement.requiredMessageTypes,
              observedMessageTypes,
              retryEnqueued,
              retryCount: protocolRetryCount,
            },
          });
        }
      }

      if (
        issueId
        && (adapterResult.exitCode ?? 0) !== 0
        && adapterResult.errorMessage
      ) {
        const issueStateSnapshot = await db
          .select({
            status: issues.status,
          })
          .from(issues)
          .where(and(eq(issues.id, issueId), eq(issues.companyId, agent.companyId)))
          .limit(1)
          .then((rows) => rows[0] ?? null);
        adapterRetryEnqueued = shouldEnqueueRetryableAdapterFailure({
          adapterErrorCode: adapterResult.errorCode ?? null,
          adapterRetryCount,
          issueStatus: issueStateSnapshot?.status ?? null,
        });
        adapterRetryResult = {
          required: Boolean(readNonEmptyString(adapterResult.errorCode)),
          errorCode: adapterResult.errorCode ?? null,
          retryCount: adapterRetryCount,
          retryEnqueued: adapterRetryEnqueued,
        };

        if (adapterRetryEnqueued) {
          const retryContextSnapshot: Record<string, unknown> = {
            ...context,
            issueId,
            taskId: issueId,
            wakeReason: "adapter_retry",
            adapterRetryCount: adapterRetryCount + 1,
            adapterRetryPreviousRunId: run.id,
            adapterRetryErrorCode: adapterResult.errorCode,
            forceFollowupRun: true,
            forceFreshAdapterSession: true,
          };
          await enqueueWakeup(agent.id, {
            source: "automation",
            triggerDetail: "system",
            reason: "adapter_retry",
            payload: {
              issueId,
              adapterRetryPreviousRunId: run.id,
              adapterRetryErrorCode: adapterResult.errorCode,
            },
            contextSnapshot: retryContextSnapshot,
          });
          await appendRunEvent(eventRun, seq++, {
            eventType: "adapter.retryable_failure",
            stream: "system",
            level: "warn",
            message: `queued retry follow-up after transient adapter failure (${adapterResult.errorCode})`,
            payload: {
              errorCode: adapterResult.errorCode,
              retryCount: adapterRetryCount,
            },
          });
        }
      }

      const latestRun = await getRun(run.id);
      const outcome = resolveHeartbeatRunOutcome({
        latestRunStatus: latestRun?.status ?? null,
        timedOut: adapterResult.timedOut,
        exitCode: adapterResult.exitCode,
        errorMessage: adapterResult.errorMessage,
        protocolProgressFailure,
      });

      let logSummary: { bytes: number; sha256?: string; compressed: boolean } | null = null;
      if (handle) {
        logSummary = await runLogStore.finalize(handle);
      }

      const usageJson =
        adapterResult.usage || adapterResult.costUsd != null
          ? ({
              ...(adapterResult.usage ?? {}),
              ...(adapterResult.costUsd != null ? { costUsd: adapterResult.costUsd } : {}),
              ...(adapterResult.billingType ? { billingType: adapterResult.billingType } : {}),
            } as Record<string, unknown>)
          : null;
      let workspaceGitSnapshot: Record<string, unknown> | null = null;
      if (
        resolvedWorkspace
        && isRepoBackedWorkspaceSource(resolvedWorkspace.source)
        && resolvedWorkspace.workspaceUsage === "implementation"
      ) {
        currentPhase = "finalize.workspace_snapshot";
        await appendCheckpoint("finalize.workspace_snapshot", "capturing workspace git snapshot", {
          source: resolvedWorkspace.source,
          workspaceId: resolvedWorkspace.workspaceId ?? null,
          branchName: resolvedWorkspace.branchName ?? null,
        });
        try {
          const snapshot = await inspectWorkspaceGitSnapshot({
            cwd: resolvedWorkspace.cwd,
            branchName: resolvedWorkspace.branchName,
          });
          if (snapshot) {
            workspaceGitSnapshot = snapshot as Record<string, unknown>;
            await appendRunEvent(eventRun, seq++, {
              eventType: "workspace.snapshot",
              stream: "system",
              level: "info",
              message: snapshot.hasChanges
                ? `workspace snapshot captured (${snapshot.changedFiles.length} changed file(s))`
                : "workspace snapshot captured (clean working tree)",
              payload: {
                branchName: snapshot.branchName,
                expectedBranchName: snapshot.expectedBranchName,
                branchMismatch: snapshot.branchMismatch,
                headSha: snapshot.headSha,
                hasChanges: snapshot.hasChanges,
                changedFiles: snapshot.changedFiles,
                diffStat: snapshot.diffStat,
              },
            });
          }
        } catch (snapshotErr) {
          logger.warn({ err: snapshotErr, runId: run.id }, "failed to capture workspace git snapshot");
          await appendRunEvent(eventRun, seq++, {
            eventType: "workspace.snapshot",
            stream: "system",
            level: "warn",
            message: "failed to capture workspace git snapshot",
            payload: {
              source: resolvedWorkspace.source,
              workspaceId: resolvedWorkspace.workspaceId ?? null,
            },
          });
        }
      }
      const resultJson = mergeRunResultJson(
        adapterResult.resultJson ?? null,
        {
          ...(workspaceGitSnapshot ? { workspaceGitSnapshot } : {}),
          ...(protocolProgressResult ? { protocolProgress: protocolProgressResult } : {}),
          ...(adapterRetryResult ? { adapterRetry: adapterRetryResult } : {}),
        },
      );
      const verificationSignals = extractRunVerificationSignals({
        stdoutExcerpt,
        stderrExcerpt,
        resultJson,
      });
      const enrichedResultJson = mergeRunResultJson(
        resultJson,
        verificationSignals.length > 0 ? { verificationSignals } : null,
      );
      if (verificationSignals.length > 0) {
        await appendRunEvent(eventRun, seq++, {
          eventType: "verification.signals",
          stream: "system",
          level: "info",
          message: `captured ${verificationSignals.length} verification signal(s)`,
          payload: {
            verificationSignals,
          },
        });
      }

      const persistence = buildHeartbeatOutcomePersistence({
        outcome,
        protocolProgressFailure,
        adapterResult,
        usageJson,
        resultJson: enrichedResultJson,
        nextSessionDisplayId: nextSessionState.displayId,
        nextSessionLegacyId: nextSessionState.legacySessionId,
        stdoutExcerpt,
        stderrExcerpt,
        logSummary,
      });
      const status = persistence.status;
      await appendCheckpoint("finalize.persist_outcome", "persisting adapter outcome", {
        outcome,
        status,
      });

      await setRunStatus(run.id, status, persistence.runPatch);

      await setWakeupStatus(run.wakeupRequestId, persistence.wakeupStatus, persistence.wakeupPatch);

      const finalizedRun = await getRun(run.id);
      if (finalizedRun) {
        await appendRunEvent(finalizedRun, seq++, {
          eventType: "lifecycle",
          stream: "system",
          level: outcome === "succeeded" ? "info" : "error",
          message: `run ${outcome}`,
          payload: {
            status,
            exitCode: adapterResult.exitCode,
          },
        });
        await releaseIssueExecutionAndPromote(finalizedRun);
        if ((status === "failed" || status === "timed_out") && !adapterRetryEnqueued) {
          await wakeLeadSupervisorForRunFailure({
            run: finalizedRun,
            status,
            errorCode:
              status === "timed_out"
                ? "timeout"
                : status === "failed"
                  ? (adapterResult.errorCode ?? "adapter_failed")
                  : null,
            error:
              outcome === "succeeded"
                ? null
                : protocolProgressFailure?.error ??
                  adapterResult.errorMessage ??
                  (outcome === "timed_out" ? "Timed out" : "Adapter failed"),
          });
        }
        await upsertRunLease({
          run: finalizedRun,
          status: status === "succeeded" ? "released" : status,
          checkpointJson: {
            phase: "finalize.complete",
            message: `run ${outcome}`,
            status,
          },
          heartbeatAt: new Date(),
          leaseExpiresAt: new Date(),
          releasedAt: new Date(),
          lastError:
            outcome === "succeeded"
              ? null
              : (protocolProgressFailure?.error ?? adapterResult.errorMessage ?? "run_failed"),
        });
      }

      if (finalizedRun) {
        await updateRuntimeState(agent, finalizedRun, adapterResult, {
          legacySessionId: nextSessionState.legacySessionId,
        });
        if (taskKey) {
          if (adapterResult.clearSession || (!nextSessionState.params && !nextSessionState.displayId)) {
            await clearTaskSessions(agent.companyId, agent.id, {
              taskKey,
              adapterType: agent.adapterType,
            });
          } else {
            await upsertTaskSession({
              companyId: agent.companyId,
              agentId: agent.id,
              adapterType: agent.adapterType,
              taskKey,
              sessionParamsJson: nextSessionState.params,
              sessionDisplayId: nextSessionState.displayId,
              lastRunId: finalizedRun.id,
              lastError:
                outcome === "succeeded"
                  ? null
                  : (protocolProgressFailure?.error ?? adapterResult.errorMessage ?? "run_failed"),
            });
          }
        }
      }
      await finalizeAgentStatus(agent.id, outcome);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown adapter failure";
      const errorCode =
        err instanceof WorkspaceResolutionError
          ? err.code
          : err instanceof SupersededProtocolFollowupError
            ? err.code
            : "adapter_failed";
      logger.error({ err, runId, phase: currentPhase }, "heartbeat execution failed");

      let logSummary: { bytes: number; sha256?: string; compressed: boolean } | null = null;
      if (handle) {
        try {
          logSummary = await runLogStore.finalize(handle);
        } catch (finalizeErr) {
          logger.warn({ err: finalizeErr, runId }, "failed to finalize run log after error");
        }
      }

      const failedRun = await setRunStatus(run.id, errorCode === "superseded_followup" ? "cancelled" : "failed", {
        error: message,
        errorCode,
        finishedAt: new Date(),
        stdoutExcerpt,
        stderrExcerpt,
        logBytes: logSummary?.bytes,
        logSha256: logSummary?.sha256,
        logCompressed: logSummary?.compressed ?? false,
      });
      await setWakeupStatus(run.wakeupRequestId, errorCode === "superseded_followup" ? "cancelled" : "failed", {
        finishedAt: new Date(),
        error: message,
      });
      await upsertRunLease({
        run: eventRun,
        status: errorCode === "superseded_followup" ? "cancelled" : "failed",
        checkpointJson: {
          phase: currentPhase,
          message,
        },
        heartbeatAt: new Date(),
        leaseExpiresAt: new Date(),
        releasedAt: new Date(),
        lastError: message,
      });

      if (failedRun) {
        await appendRunEvent(failedRun, seq++, {
          eventType: "error",
          stream: "system",
          level: "error",
          message,
          payload: {
            phase: currentPhase,
            taskKey,
            workspaceSource: resolvedWorkspace?.source ?? null,
            workspaceUsage: resolvedWorkspace?.workspaceUsage ?? null,
          },
        });
        await releaseIssueExecutionAndPromote(failedRun);
        if (errorCode !== "superseded_followup") {
          await wakeLeadSupervisorForRunFailure({
            run: failedRun,
            status: "failed",
            errorCode,
            error: message,
          });
        }

        await updateRuntimeState(agent, failedRun, {
          exitCode: null,
          signal: null,
          timedOut: false,
          errorMessage: message,
        }, {
          legacySessionId: runtimeForAdapter.sessionId,
        });

        if (taskKey && (previousSessionParams || previousSessionDisplayId || taskSession)) {
          await upsertTaskSession({
            companyId: agent.companyId,
            agentId: agent.id,
            adapterType: agent.adapterType,
            taskKey,
            sessionParamsJson: previousSessionParams,
            sessionDisplayId: previousSessionDisplayId,
            lastRunId: failedRun.id,
            lastError: message,
          });
        }
      }

      await finalizeAgentStatus(agent.id, errorCode === "superseded_followup" ? "cancelled" : "failed");
    } finally {
      clearDispatchWatchdog(runId);
      clearProtocolIdleWatchdog(runId);
      if (leaseHeartbeatTimer) {
        clearInterval(leaseHeartbeatTimer);
      }
      dispatchAgentQueueStart(agent.id);
    }
  }

  async function enqueueWakeup(agentId: string, opts: WakeupOptions = {}) {
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
    const writeSkippedRequest = async (reason: string) => {
      await db.insert(agentWakeupRequests).values(buildWakeupRequestValues({
        companyId: agent.companyId,
        agentId,
        source,
        triggerDetail,
        reason,
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
