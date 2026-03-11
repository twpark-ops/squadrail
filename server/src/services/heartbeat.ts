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
import { resolveProtocolRunRequirement, type ProtocolRunRequirement } from "@squadrail/shared";
import { conflict, notFound } from "../errors.js";
import { logger } from "../middleware/logger.js";
import { publishLiveEvent } from "./live-events.js";
import { getRunLogStore, type RunLogHandle } from "./run-log-store.js";
import { getServerAdapter, runningProcesses } from "../adapters/index.js";
import type { AdapterExecutionResult, AdapterInvocationMeta, AdapterSessionCodec } from "../adapters/index.js";
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
import {
  buildInternalWorkItemDispatchMetadata,
  isLeadWatchEnabled,
  leadSupervisorRunFailureReason,
  loadInternalWorkItemSupervisorContext,
} from "./internal-work-item-supervision.js";

const MAX_LIVE_LOG_CHUNK_BYTES = 8 * 1024;
const HEARTBEAT_MAX_CONCURRENT_RUNS_DEFAULT = 1;
const HEARTBEAT_MAX_CONCURRENT_RUNS_MAX = 10;
const RUN_LEASE_TTL_MS = 45_000;
const RUN_LEASE_HEARTBEAT_INTERVAL_MS = 10_000;
const RUN_DISPATCH_WATCHDOG_MS = 8_000;
const RUN_DISPATCH_RETRY_LIMIT = 2;
const PROTOCOL_REQUIRED_RETRY_LIMIT = 1;
const DEFERRED_WAKE_CONTEXT_KEY = "_squadrailWakeContext";
const WORKSPACE_CONTEXT_KEY = "squadrailWorkspace";
const WORKSPACES_CONTEXT_KEY = "squadrailWorkspaces";
const startLocksByAgent = new Map<string, Promise<void>>();
const SUPERSEDED_PROTOCOL_WAKE_REASONS = new Set([
  "issue_ready_for_closure",
  "issue_ready_for_qa_gate",
  "protocol_required_retry",
]);

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

function mergeRunResultJson(
  base: Record<string, unknown> | null | undefined,
  additions: Record<string, unknown> | null,
) {
  if (!additions || Object.keys(additions).length === 0) return base ?? null;
  if (!base) return additions;
  const service = {
    ...base,
    ...additions,
  };

  return service;
}

function isRepoBackedWorkspaceSource(source: ResolvedWorkspaceForRun["source"] | null | undefined) {
  return source === "project_shared" || source === "project_isolated";
}

export function attachResolvedWorkspaceContextToRunContext(input: {
  contextSnapshot: Record<string, unknown>;
  resolvedWorkspace: ResolvedWorkspaceForRun;
}) {
  const { contextSnapshot, resolvedWorkspace } = input;
  const workspaceContext = {
    cwd: resolvedWorkspace.cwd,
    source: resolvedWorkspace.source,
    projectId: resolvedWorkspace.projectId,
    workspaceId: resolvedWorkspace.workspaceId,
    repoUrl: resolvedWorkspace.repoUrl,
    repoRef: resolvedWorkspace.repoRef,
    executionPolicy: resolvedWorkspace.executionPolicy,
    workspaceUsage: resolvedWorkspace.workspaceUsage,
    branchName: resolvedWorkspace.branchName,
    workspaceState: resolvedWorkspace.workspaceState,
    hasLocalChanges: resolvedWorkspace.hasLocalChanges,
  };

  contextSnapshot[WORKSPACE_CONTEXT_KEY] = workspaceContext;
  contextSnapshot.squadrailWorkspace = workspaceContext;
  contextSnapshot[WORKSPACES_CONTEXT_KEY] = resolvedWorkspace.workspaceHints;
  contextSnapshot.squadrailWorkspaces = resolvedWorkspace.workspaceHints;

  if (resolvedWorkspace.projectId && !readNonEmptyString(contextSnapshot.projectId)) {
    contextSnapshot.projectId = resolvedWorkspace.projectId;
  }

  return contextSnapshot;
}

function normalizeMaxConcurrentRuns(value: unknown) {
  const parsed = Math.floor(asNumber(value, HEARTBEAT_MAX_CONCURRENT_RUNS_DEFAULT));
  if (!Number.isFinite(parsed)) return HEARTBEAT_MAX_CONCURRENT_RUNS_DEFAULT;
  return Math.max(HEARTBEAT_MAX_CONCURRENT_RUNS_DEFAULT, Math.min(HEARTBEAT_MAX_CONCURRENT_RUNS_MAX, parsed));
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

interface ParsedIssueAssigneeAdapterOverrides {
  adapterConfig: Record<string, unknown> | null;
  useProjectWorkspace: boolean | null;
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function parseIssueAssigneeAdapterOverrides(
  raw: unknown,
): ParsedIssueAssigneeAdapterOverrides | null {
  const parsed = parseObject(raw);
  const parsedAdapterConfig = parseObject(parsed.adapterConfig);
  const adapterConfig =
    Object.keys(parsedAdapterConfig).length > 0 ? parsedAdapterConfig : null;
  const useProjectWorkspace =
    typeof parsed.useProjectWorkspace === "boolean"
      ? parsed.useProjectWorkspace
      : null;
  if (!adapterConfig && useProjectWorkspace === null) return null;
  return {
    adapterConfig,
    useProjectWorkspace,
  };
}

function deriveTaskKey(
  contextSnapshot: Record<string, unknown> | null | undefined,
  payload: Record<string, unknown> | null | undefined,
) {
  return (
    readNonEmptyString(contextSnapshot?.taskKey) ??
    readNonEmptyString(contextSnapshot?.taskId) ??
    readNonEmptyString(contextSnapshot?.issueId) ??
    readNonEmptyString(payload?.taskKey) ??
    readNonEmptyString(payload?.taskId) ??
    readNonEmptyString(payload?.issueId) ??
    null
  );
}

export function shouldResetTaskSessionForWake(
  contextSnapshot: Record<string, unknown> | null | undefined,
) {
  const wakeReason = readNonEmptyString(contextSnapshot?.wakeReason);
  if (
    wakeReason === "issue_assigned" ||
    wakeReason === "issue_reassigned" ||
    wakeReason === "issue_watch_assigned" ||
    wakeReason === "issue_watch_reassigned" ||
    wakeReason === "protocol_required_retry"
  ) return true;

  if (
    typeof contextSnapshot?.protocolRequiredRetryCount === "number"
    && Number.isFinite(contextSnapshot.protocolRequiredRetryCount)
    && contextSnapshot.protocolRequiredRetryCount > 0
  ) return true;

  const wakeSource = readNonEmptyString(contextSnapshot?.wakeSource);
  if (wakeSource === "timer") return true;

  const wakeTriggerDetail = readNonEmptyString(contextSnapshot?.wakeTriggerDetail);
  return wakeSource === "on_demand" && wakeTriggerDetail === "manual";
}

function describeSessionResetReason(
  contextSnapshot: Record<string, unknown> | null | undefined,
) {
  const wakeReason = readNonEmptyString(contextSnapshot?.wakeReason);
  if (
    wakeReason === "issue_assigned" ||
    wakeReason === "issue_reassigned" ||
    wakeReason === "issue_watch_assigned" ||
    wakeReason === "issue_watch_reassigned" ||
    wakeReason === "protocol_required_retry"
  ) {
    return `wake reason is ${wakeReason}`;
  }

  if (
    typeof contextSnapshot?.protocolRequiredRetryCount === "number"
    && Number.isFinite(contextSnapshot.protocolRequiredRetryCount)
    && contextSnapshot.protocolRequiredRetryCount > 0
  ) {
    return "a protocol-required retry is forcing a fresh session";
  }

  const wakeSource = readNonEmptyString(contextSnapshot?.wakeSource);
  if (wakeSource === "timer") return "wake source is timer";

  const wakeTriggerDetail = readNonEmptyString(contextSnapshot?.wakeTriggerDetail);
  if (wakeSource === "on_demand" && wakeTriggerDetail === "manual") {
    return "this is a manual invoke";
  }
  return null;
}

function deriveCommentId(
  contextSnapshot: Record<string, unknown> | null | undefined,
  payload: Record<string, unknown> | null | undefined,
) {
  return (
    readNonEmptyString(contextSnapshot?.wakeCommentId) ??
    readNonEmptyString(contextSnapshot?.commentId) ??
    readNonEmptyString(payload?.commentId) ??
    null
  );
}

function enrichWakeContextSnapshot(input: {
  contextSnapshot: Record<string, unknown>;
  reason: string | null;
  source: WakeupOptions["source"];
  triggerDetail: WakeupOptions["triggerDetail"] | null;
  payload: Record<string, unknown> | null;
}) {
  const { contextSnapshot, reason, source, triggerDetail, payload } = input;
  const issueIdFromPayload = readNonEmptyString(payload?.["issueId"]);
  const commentIdFromPayload = readNonEmptyString(payload?.["commentId"]);
  const taskKey = deriveTaskKey(contextSnapshot, payload);
  const wakeCommentId = deriveCommentId(contextSnapshot, payload);

  if (!readNonEmptyString(contextSnapshot["wakeReason"]) && reason) {
    contextSnapshot.wakeReason = reason;
  }
  if (!readNonEmptyString(contextSnapshot["issueId"]) && issueIdFromPayload) {
    contextSnapshot.issueId = issueIdFromPayload;
  }
  if (!readNonEmptyString(contextSnapshot["taskId"]) && issueIdFromPayload) {
    contextSnapshot.taskId = issueIdFromPayload;
  }
  if (!readNonEmptyString(contextSnapshot["taskKey"]) && taskKey) {
    contextSnapshot.taskKey = taskKey;
  }
  if (!readNonEmptyString(contextSnapshot["commentId"]) && commentIdFromPayload) {
    contextSnapshot.commentId = commentIdFromPayload;
  }
  if (!readNonEmptyString(contextSnapshot["wakeCommentId"]) && wakeCommentId) {
    contextSnapshot.wakeCommentId = wakeCommentId;
  }
  if (!readNonEmptyString(contextSnapshot["wakeSource"]) && source) {
    contextSnapshot.wakeSource = source;
  }
  if (!readNonEmptyString(contextSnapshot["wakeTriggerDetail"]) && triggerDetail) {
    contextSnapshot.wakeTriggerDetail = triggerDetail;
  }

  return {
    contextSnapshot,
    issueIdFromPayload,
    commentIdFromPayload,
    taskKey,
    wakeCommentId,
  };
}

function mergeCoalescedContextSnapshot(
  existingRaw: unknown,
  incoming: Record<string, unknown>,
) {
  const existing = parseObject(existingRaw);
  const merged: Record<string, unknown> = {
    ...existing,
    ...incoming,
  };
  const commentId = deriveCommentId(incoming, null);
  if (commentId) {
    merged.commentId = commentId;
    merged.wakeCommentId = commentId;
  }
  return merged;
}

export function shouldQueueFollowupIssueExecution(input: {
  sameExecutionAgent: boolean;
  activeExecutionRunStatus: string | null | undefined;
  wakeCommentId: string | null;
  contextSnapshot: Record<string, unknown>;
}) {
  if (!input.sameExecutionAgent) return false;
  if (input.wakeCommentId && input.activeExecutionRunStatus === "running") return true;
  return asBoolean(input.contextSnapshot.forceFollowupRun, false);
}

function runTaskKey(run: typeof heartbeatRuns.$inferSelect) {
  return deriveTaskKey(run.contextSnapshot as Record<string, unknown> | null, null);
}

function isSameTaskScope(left: string | null, right: string | null) {
  return (left ?? null) === (right ?? null);
}

function truncateDisplayId(value: string | null | undefined, max = 128) {
  if (!value) return null;
  return value.length > max ? value.slice(0, max) : value;
}

function toEpochMillis(value: Date | string | null | undefined) {
  if (!value) return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function computeLeaseExpiresAt(now = new Date()) {
  return new Date(now.getTime() + RUN_LEASE_TTL_MS);
}

type RunLeaseLike = {
  status?: string | null;
  checkpointJson?: Record<string, unknown> | null;
  leaseExpiresAt?: Date | string | null;
  releasedAt?: Date | string | null;
};

export function buildProcessLostError(lease?: RunLeaseLike | null) {
  const checkpoint = parseObject(lease?.checkpointJson);
  const phase = readNonEmptyString(checkpoint.phase);
  if (phase) {
    return `Process lost during ${phase} -- server may have restarted`;
  }
  return "Process lost -- server may have restarted";
}

type ObservedProtocolProgressMessage = {
  messageType: string;
};

export function hasRequiredProtocolProgress(input: {
  requirement: ProtocolRunRequirement | null;
  messages: ObservedProtocolProgressMessage[];
}) {
  const requirement = input.requirement;
  if (!requirement) return true;
  return input.messages.some((message) => requirement.requiredMessageTypes.includes(
    message.messageType as ProtocolRunRequirement["requiredMessageTypes"][number],
  ));
}

export function buildRequiredProtocolProgressError(input: {
  requirement: ProtocolRunRequirement;
  observedMessageTypes: string[];
  retryEnqueued: boolean;
}) {
  const expected = input.requirement.requiredMessageTypes.join(", ");
  const observed = input.observedMessageTypes.length > 0 ? input.observedMessageTypes.join(", ") : "none";
  const retrySuffix = input.retryEnqueued
    ? " A protocol-retry wake was queued automatically."
    : "";
  return [
    `Run ended without required protocol progress for ${input.requirement.protocolMessageType}/${input.requirement.recipientRole}.`,
    `Expected one of: ${expected}.`,
    `Observed: ${observed}.`,
  ].join(" ") + retrySuffix;
}

export function shouldEnqueueProtocolRequiredRetry(input: {
  protocolRetryCount: number;
  issueStatus?: string | null;
  workflowState?: string | null;
  requirement?: ProtocolRunRequirement | null;
}) {
  if (input.protocolRetryCount >= PROTOCOL_REQUIRED_RETRY_LIMIT) return false;
  if (input.issueStatus === "done" || input.issueStatus === "cancelled") return false;
  if (!input.requirement || !input.workflowState) return false;
  return isWorkflowStateEligibleForProtocolRetry({
    requirement: input.requirement,
    workflowState: input.workflowState,
  });
}

export function isWorkflowStateEligibleForProtocolRetry(input: {
  requirement: ProtocolRunRequirement;
  workflowState: string | null | undefined;
}) {
  const workflowState = readNonEmptyString(input.workflowState);
  if (!workflowState) return false;

  switch (input.requirement.key) {
    case "assignment_engineer":
    case "assignment_supervisor":
    case "reassignment_engineer":
    case "reassignment_supervisor":
      return workflowState === "assigned";
    case "implementation_engineer":
      return workflowState === "implementing";
    case "change_request_engineer":
      return workflowState === "changes_requested";
    case "review_reviewer":
      return workflowState === "submitted_for_review";
    case "qa_gate_reviewer":
      return workflowState === "qa_pending";
    case "approval_tech_lead":
      return workflowState === "approved";
    default:
      return false;
  }
}

export function shouldSkipSupersededProtocolFollowup(input: {
  wakeReason?: string | null;
  issueStatus?: string | null;
}) {
  if (input.issueStatus !== "done" && input.issueStatus !== "cancelled") return false;
  return isSupersededProtocolWakeReason(input.wakeReason);
}

export function isSupersededProtocolWakeReason(wakeReason?: string | null) {
  const normalized = readNonEmptyString(wakeReason);
  return normalized ? SUPERSEDED_PROTOCOL_WAKE_REASONS.has(normalized) : false;
}

export function shouldReapHeartbeatRun(input: {
  runStatus: string;
  runUpdatedAt: Date | string | null | undefined;
  lease?: RunLeaseLike | null;
  now?: Date;
  staleThresholdMs?: number;
}) {
  if (input.runStatus !== "queued" && input.runStatus !== "running") return false;

  const nowMs = (input.now ?? new Date()).getTime();
  const leaseExpiresAtMs = toEpochMillis(input.lease?.leaseExpiresAt);
  const leaseReleasedAtMs = toEpochMillis(input.lease?.releasedAt);

  if (!leaseReleasedAtMs && leaseExpiresAtMs !== null && leaseExpiresAtMs > nowMs) {
    return false;
  }

  const refTime = leaseExpiresAtMs ?? toEpochMillis(input.runUpdatedAt) ?? 0;
  const staleThresholdMs = input.staleThresholdMs ?? 0;
  if (staleThresholdMs > 0 && nowMs - refTime < staleThresholdMs) {
    return false;
  }

  return true;
}

export function decideDispatchWatchdogAction(input: {
  runStatus: string;
  leaseStatus?: string | null;
  checkpointPhase?: string | null;
  dispatchAttempts: number;
  hasRunningProcess: boolean;
}) {
  if (input.hasRunningProcess) return "noop" as const;
  if (input.runStatus === "queued") {
    if (
      input.leaseStatus
      && input.leaseStatus !== "queued"
      && input.leaseStatus !== "launching"
    ) {
      return "noop" as const;
    }
    if (input.checkpointPhase !== "queue.created" && input.checkpointPhase !== "dispatch.redispatch") {
      return "noop" as const;
    }
    if (input.dispatchAttempts >= RUN_DISPATCH_RETRY_LIMIT) return "fail" as const;
    return "redispatch" as const;
  }
  if (input.runStatus !== "running") return "noop" as const;
  if (input.leaseStatus && input.leaseStatus !== "launching") return "noop" as const;
  if (input.checkpointPhase !== "claim.queued" && input.checkpointPhase !== "dispatch.redispatch") {
    return "noop" as const;
  }
  if (input.dispatchAttempts >= RUN_DISPATCH_RETRY_LIMIT) return "fail" as const;
  return "redispatch" as const;
}

export function scheduleDeferredRunDispatch(dispatch: () => void) {
  setImmediate(dispatch);
}

export function runDispatchWatchdogOutsideDbContext(callback: () => void) {
  runWithoutDbContext(callback);
}

function normalizeAgentNameKey(value: string | null | undefined) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

const defaultSessionCodec: AdapterSessionCodec = {
  deserialize(raw: unknown) {
    const asObj = parseObject(raw);
    if (Object.keys(asObj).length > 0) return asObj;
    const sessionId = readNonEmptyString((raw as Record<string, unknown> | null)?.sessionId);
    if (sessionId) return { sessionId };
    return null;
  },
  serialize(params: Record<string, unknown> | null) {
    if (!params || Object.keys(params).length === 0) return null;
    return params;
  },
  getDisplayId(params: Record<string, unknown> | null) {
    return readNonEmptyString(params?.sessionId);
  },
};

function getAdapterSessionCodec(adapterType: string) {
  const adapter = getServerAdapter(adapterType);
  return adapter.sessionCodec ?? defaultSessionCodec;
}

function normalizeSessionParams(params: Record<string, unknown> | null | undefined) {
  if (!params) return null;
  return Object.keys(params).length > 0 ? params : null;
}

function resolveNextSessionState(input: {
  codec: AdapterSessionCodec;
  adapterResult: AdapterExecutionResult;
  previousParams: Record<string, unknown> | null;
  previousDisplayId: string | null;
  previousLegacySessionId: string | null;
}) {
  const { codec, adapterResult, previousParams, previousDisplayId, previousLegacySessionId } = input;

  if (adapterResult.clearSession) {
    return {
      params: null as Record<string, unknown> | null,
      displayId: null as string | null,
      legacySessionId: null as string | null,
    };
  }

  const explicitParams = adapterResult.sessionParams;
  const hasExplicitParams = adapterResult.sessionParams !== undefined;
  const hasExplicitSessionId = adapterResult.sessionId !== undefined;
  const explicitSessionId = readNonEmptyString(adapterResult.sessionId);
  const hasExplicitDisplay = adapterResult.sessionDisplayId !== undefined;
  const explicitDisplayId = readNonEmptyString(adapterResult.sessionDisplayId);
  const shouldUsePrevious = !hasExplicitParams && !hasExplicitSessionId && !hasExplicitDisplay;

  const candidateParams =
    hasExplicitParams
      ? explicitParams
      : hasExplicitSessionId
        ? (explicitSessionId ? { sessionId: explicitSessionId } : null)
        : previousParams;

  const serialized = normalizeSessionParams(codec.serialize(normalizeSessionParams(candidateParams) ?? null));
  const deserialized = normalizeSessionParams(codec.deserialize(serialized));

  const displayId = truncateDisplayId(
    explicitDisplayId ??
      (codec.getDisplayId ? codec.getDisplayId(deserialized) : null) ??
      readNonEmptyString(deserialized?.sessionId) ??
      (shouldUsePrevious ? previousDisplayId : null) ??
      explicitSessionId ??
      (shouldUsePrevious ? previousLegacySessionId : null),
  );

  const legacySessionId =
    explicitSessionId ??
    readNonEmptyString(deserialized?.sessionId) ??
    displayId ??
    (shouldUsePrevious ? previousLegacySessionId : null);

  return {
    params: serialized,
    displayId,
    legacySessionId,
  };
}

export function heartbeatService(db: Db) {
  const runLogStore = getRunLogStore();
  const secretsSvc = secretService(db);
  const dispatchWatchdogTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const dispatchWatchdogAttempts = new Map<string, number>();

  function clearDispatchWatchdog(runId: string) {
    const timer = dispatchWatchdogTimers.get(runId);
    if (timer) {
      clearTimeout(timer);
      dispatchWatchdogTimers.delete(runId);
    }
    dispatchWatchdogAttempts.delete(runId);
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

  async function getAgent(agentId: string) {
    return db
      .select()
      .from(agents)
      .where(eq(agents.id, agentId))
      .then((rows) => rows[0] ?? null);
  }

  async function getRun(runId: string) {
    return db
      .select()
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.id, runId))
      .then((rows) => rows[0] ?? null);
  }

  async function getRunLease(runId: string) {
    return db
      .select()
      .from(heartbeatRunLeases)
      .where(eq(heartbeatRunLeases.runId, runId))
      .then((rows) => rows[0] ?? null);
  }

  async function nextRunEventSeq(runId: string) {
    const latest = await db
      .select({ seq: heartbeatRunEvents.seq })
      .from(heartbeatRunEvents)
      .where(eq(heartbeatRunEvents.runId, runId))
      .orderBy(desc(heartbeatRunEvents.seq))
      .limit(1)
      .then((rows) => rows[0] ?? null);
    return (latest?.seq ?? 0) + 1;
  }

  async function getRuntimeState(agentId: string) {
    return db
      .select()
      .from(agentRuntimeState)
      .where(eq(agentRuntimeState.agentId, agentId))
      .then((rows) => rows[0] ?? null);
  }

  async function getTaskSession(
    companyId: string,
    agentId: string,
    adapterType: string,
    taskKey: string,
  ) {
    return db
      .select()
      .from(agentTaskSessions)
      .where(
        and(
          eq(agentTaskSessions.companyId, companyId),
          eq(agentTaskSessions.agentId, agentId),
          eq(agentTaskSessions.adapterType, adapterType),
          eq(agentTaskSessions.taskKey, taskKey),
        ),
      )
      .then((rows) => rows[0] ?? null);
  }

  async function resolveSessionBeforeForWakeup(
    agent: typeof agents.$inferSelect,
    taskKey: string | null,
  ) {
    if (taskKey) {
      const codec = getAdapterSessionCodec(agent.adapterType);
      const existingTaskSession = await getTaskSession(
        agent.companyId,
        agent.id,
        agent.adapterType,
        taskKey,
      );
      const parsedParams = normalizeSessionParams(
        codec.deserialize(existingTaskSession?.sessionParamsJson ?? null),
      );
      return truncateDisplayId(
        existingTaskSession?.sessionDisplayId ??
          (codec.getDisplayId ? codec.getDisplayId(parsedParams) : null) ??
          readNonEmptyString(parsedParams?.sessionId),
      );
    }

    const runtimeForRun = await getRuntimeState(agent.id);
    return runtimeForRun?.sessionId ?? null;
  }

  async function upsertTaskSession(input: {
    companyId: string;
    agentId: string;
    adapterType: string;
    taskKey: string;
    sessionParamsJson: Record<string, unknown> | null;
    sessionDisplayId: string | null;
    lastRunId: string | null;
    lastError: string | null;
  }) {
    const existing = await getTaskSession(
      input.companyId,
      input.agentId,
      input.adapterType,
      input.taskKey,
    );
    if (existing) {
      return db
        .update(agentTaskSessions)
        .set({
          sessionParamsJson: input.sessionParamsJson,
          sessionDisplayId: input.sessionDisplayId,
          lastRunId: input.lastRunId,
          lastError: input.lastError,
          updatedAt: new Date(),
        })
        .where(eq(agentTaskSessions.id, existing.id))
        .returning()
        .then((rows) => rows[0] ?? null);
    }

    return db
      .insert(agentTaskSessions)
      .values({
        companyId: input.companyId,
        agentId: input.agentId,
        adapterType: input.adapterType,
        taskKey: input.taskKey,
        sessionParamsJson: input.sessionParamsJson,
        sessionDisplayId: input.sessionDisplayId,
        lastRunId: input.lastRunId,
        lastError: input.lastError,
      })
      .returning()
      .then((rows) => rows[0] ?? null);
  }

  async function clearTaskSessions(
    companyId: string,
    agentId: string,
    opts?: { taskKey?: string | null; adapterType?: string | null },
  ) {
    const conditions = [
      eq(agentTaskSessions.companyId, companyId),
      eq(agentTaskSessions.agentId, agentId),
    ];
    if (opts?.taskKey) {
      conditions.push(eq(agentTaskSessions.taskKey, opts.taskKey));
    }
    if (opts?.adapterType) {
      conditions.push(eq(agentTaskSessions.adapterType, opts.adapterType));
    }

    return db
      .delete(agentTaskSessions)
      .where(and(...conditions))
      .returning()
      .then((rows) => rows.length);
  }

  async function ensureRuntimeState(agent: typeof agents.$inferSelect) {
    const existing = await getRuntimeState(agent.id);
    if (existing) return existing;

    return db
      .insert(agentRuntimeState)
      .values({
        agentId: agent.id,
        companyId: agent.companyId,
        adapterType: agent.adapterType,
        stateJson: {},
      })
      .returning()
      .then((rows) => rows[0]);
  }

  async function setRunStatus(
    runId: string,
    status: string,
    patch?: Partial<typeof heartbeatRuns.$inferInsert>,
  ) {
    const updated = await db
      .update(heartbeatRuns)
      .set({ status, ...patch, updatedAt: new Date() })
      .where(eq(heartbeatRuns.id, runId))
      .returning()
      .then((rows) => rows[0] ?? null);

    if (updated) {
      publishLiveEvent({
        companyId: updated.companyId,
        type: "heartbeat.run.status",
        payload: {
          runId: updated.id,
          agentId: updated.agentId,
          status: updated.status,
          invocationSource: updated.invocationSource,
          triggerDetail: updated.triggerDetail,
          error: updated.error ?? null,
          errorCode: updated.errorCode ?? null,
          startedAt: updated.startedAt ? new Date(updated.startedAt).toISOString() : null,
          finishedAt: updated.finishedAt ? new Date(updated.finishedAt).toISOString() : null,
        },
      });
    }

    return updated;
  }

  async function setWakeupStatus(
    wakeupRequestId: string | null | undefined,
    status: string,
    patch?: Partial<typeof agentWakeupRequests.$inferInsert>,
  ) {
    if (!wakeupRequestId) return;
    await db
      .update(agentWakeupRequests)
      .set({ status, ...patch, updatedAt: new Date() })
      .where(eq(agentWakeupRequests.id, wakeupRequestId));
  }

  async function upsertRunLease(input: {
    run: typeof heartbeatRuns.$inferSelect;
    status: string;
    checkpointJson?: Record<string, unknown> | null;
    heartbeatAt?: Date;
    leaseExpiresAt?: Date;
    releasedAt?: Date | null;
    lastError?: string | null;
  }) {
    const heartbeatAt = input.heartbeatAt ?? new Date();
    const leaseExpiresAt = input.leaseExpiresAt ?? computeLeaseExpiresAt(heartbeatAt);

    await db
      .insert(heartbeatRunLeases)
      .values({
        runId: input.run.id,
        companyId: input.run.companyId,
        agentId: input.run.agentId,
        status: input.status,
        checkpointJson: input.checkpointJson ?? null,
        heartbeatAt,
        leaseExpiresAt,
        releasedAt: input.releasedAt ?? null,
        lastError: input.lastError ?? null,
      })
      .onConflictDoUpdate({
        target: heartbeatRunLeases.runId,
        set: {
          status: input.status,
          checkpointJson: input.checkpointJson ?? null,
          heartbeatAt,
          leaseExpiresAt,
          releasedAt: input.releasedAt ?? null,
          lastError: input.lastError ?? null,
          updatedAt: new Date(),
        },
      });
  }

  async function appendRunEvent(
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
  ) {
    await db.insert(heartbeatRunEvents).values({
      companyId: run.companyId,
      runId: run.id,
      agentId: run.agentId,
      seq,
      eventType: event.eventType,
      stream: event.stream,
      level: event.level,
      color: event.color,
      message: event.message,
      payload: event.payload,
    });

    publishLiveEvent({
      companyId: run.companyId,
      type: "heartbeat.run.event",
      payload: {
        runId: run.id,
        agentId: run.agentId,
        seq,
        eventType: event.eventType,
        stream: event.stream ?? null,
        level: event.level ?? null,
        color: event.color ?? null,
        message: event.message ?? null,
        payload: event.payload ?? null,
      },
    });
  }

  function parseHeartbeatPolicy(agent: typeof agents.$inferSelect) {
    const runtimeConfig = parseObject(agent.runtimeConfig);
    const heartbeat = parseObject(runtimeConfig.heartbeat);

    return {
      enabled: asBoolean(heartbeat.enabled, true),
      intervalSec: Math.max(0, asNumber(heartbeat.intervalSec, 0)),
      wakeOnDemand: asBoolean(heartbeat.wakeOnDemand ?? heartbeat.wakeOnAssignment ?? heartbeat.wakeOnOnDemand ?? heartbeat.wakeOnAutomation, true),
      maxConcurrentRuns: normalizeMaxConcurrentRuns(heartbeat.maxConcurrentRuns),
    };
  }

  async function countRunningRunsForAgent(agentId: string) {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(heartbeatRuns)
      .where(and(eq(heartbeatRuns.agentId, agentId), eq(heartbeatRuns.status, "running")));
    return Number(count ?? 0);
  }

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

  async function handleDispatchWatchdog(runId: string) {
    dispatchWatchdogTimers.delete(runId);

    const run = await getRun(runId);
    if (!run) {
      clearDispatchWatchdog(runId);
      return;
    }

    const lease = await getRunLease(runId);
    const checkpoint = parseObject(lease?.checkpointJson);
    const checkpointPhase = readNonEmptyString(checkpoint.phase);
    const dispatchAttempts = dispatchWatchdogAttempts.get(runId) ?? 0;
    const action = decideDispatchWatchdogAction({
      runStatus: run.status,
      leaseStatus: lease?.status ?? null,
      checkpointPhase,
      dispatchAttempts,
      hasRunningProcess: runningProcesses.has(runId),
    });

    if (action === "noop") {
      clearDispatchWatchdog(runId);
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

  async function reapOrphanedRuns(opts?: { staleThresholdMs?: number }) {
    const staleThresholdMs = opts?.staleThresholdMs ?? 0;
    const now = new Date();

    // Find all runs in "queued" or "running" state
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
      reaped.push(run.id);
    }

    if (reaped.length > 0) {
      logger.warn({ reapedCount: reaped.length, runIds: reaped }, "reaped orphaned heartbeat runs");
    }
    return { reaped: reaped.length, runIds: reaped };
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
        .orderBy(asc(heartbeatRuns.createdAt))
        .limit(availableSlots);
      if (queuedRuns.length === 0) return [];

      const claimedRuns: Array<typeof heartbeatRuns.$inferSelect> = [];
      for (const queuedRun of queuedRuns) {
        const claimed = await claimQueuedRun(queuedRun);
        if (claimed) claimedRuns.push(claimed);
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

    const appendCheckpoint = async (
      phase: string,
      message: string,
      payload?: Record<string, unknown>,
    ) => {
      currentPhase = phase;
      await upsertRunLease({
        run: eventRun,
        status: phase.startsWith("finalize.") ? "finalizing" : phase.startsWith("adapter.") ? "executing" : "launching",
        checkpointJson: {
          phase,
          message,
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
            })
            .from(issues)
            .where(and(eq(issues.id, issueId), eq(issues.companyId, agent.companyId)))
            .then((rows) => rows[0] ?? null)
        : null;
      if (shouldSkipSupersededProtocolFollowup({
        wakeReason,
        issueStatus: issueRuntimeConfig?.status ?? null,
      })) {
        const message = `Skipping stale protocol follow-up because issue is already ${issueRuntimeConfig?.status ?? "terminal"}.`;
        currentPhase = "preflight.followup_superseded";
        await appendCheckpoint("preflight.followup_superseded", message, {
          wakeReason,
          issueStatus: issueRuntimeConfig?.status ?? null,
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

      const runtimeSessionFallback = taskKey || resetTaskSession ? null : runtime.sessionId;
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

      const onLog = async (stream: "stdout" | "stderr", chunk: string) => {
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
        await onLog("stderr", `[squadrail] ${warning}\n`);
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
      await appendCheckpoint("preflight.adapter_config_ready", "adapter runtime config resolved", {
        adapterType: agent.adapterType,
      });
      const onAdapterMeta = async (meta: AdapterInvocationMeta) => {
        currentPhase = "adapter.invoke";
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
      leaseHeartbeatTimer = setInterval(() => {
        void upsertRunLease({
          run: eventRun,
          status: "executing",
          checkpointJson: {
            phase: currentPhase,
            message: "lease heartbeat",
          },
        });
      }, RUN_LEASE_HEARTBEAT_INTERVAL_MS);
      leaseHeartbeatTimer.unref?.();
      const adapterResult = await adapter.execute({
        runId: run.id,
        agent,
        runtime: runtimeForAdapter,
        config: resolvedConfig,
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
      let protocolProgressResult: Record<string, unknown> | null = null;
      let protocolProgressFailure:
        | {
            error: string;
            errorCode: "protocol_required";
          }
        | null = null;

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
        const satisfied = hasRequiredProtocolProgress({
          requirement: protocolRequirement,
          messages: protocolMessages,
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

      let outcome: "succeeded" | "failed" | "cancelled" | "timed_out";
      const latestRun = await getRun(run.id);
      if (latestRun?.status === "cancelled") {
        outcome = "cancelled";
      } else if (adapterResult.timedOut) {
        outcome = "timed_out";
      } else if ((adapterResult.exitCode ?? 0) === 0 && !adapterResult.errorMessage && !protocolProgressFailure) {
        outcome = "succeeded";
      } else {
        outcome = "failed";
      }

      let logSummary: { bytes: number; sha256?: string; compressed: boolean } | null = null;
      if (handle) {
        logSummary = await runLogStore.finalize(handle);
      }

      const status =
        outcome === "succeeded"
          ? "succeeded"
          : outcome === "cancelled"
            ? "cancelled"
            : outcome === "timed_out"
              ? "timed_out"
              : "failed";
      await appendCheckpoint("finalize.persist_outcome", "persisting adapter outcome", {
        outcome,
        status,
      });

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

      await setRunStatus(run.id, status, {
        finishedAt: new Date(),
        error:
          outcome === "succeeded"
            ? null
            : protocolProgressFailure?.error ??
              adapterResult.errorMessage ??
              (outcome === "timed_out" ? "Timed out" : "Adapter failed"),
        errorCode:
          outcome === "timed_out"
            ? "timeout"
            : outcome === "cancelled"
              ? "cancelled"
              : outcome === "failed"
                ? (protocolProgressFailure?.errorCode ?? adapterResult.errorCode ?? "adapter_failed")
                : null,
        exitCode: adapterResult.exitCode,
        signal: adapterResult.signal,
        usageJson,
        resultJson: enrichedResultJson,
        sessionIdAfter: nextSessionState.displayId ?? nextSessionState.legacySessionId,
        stdoutExcerpt,
        stderrExcerpt,
        logBytes: logSummary?.bytes,
        logSha256: logSummary?.sha256,
        logCompressed: logSummary?.compressed ?? false,
      });

      await setWakeupStatus(run.wakeupRequestId, outcome === "succeeded" ? "completed" : status, {
        finishedAt: new Date(),
        error: protocolProgressFailure?.error ?? adapterResult.errorMessage ?? null,
      });

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
        if (status === "failed" || status === "timed_out") {
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
      if (leaseHeartbeatTimer) {
        clearInterval(leaseHeartbeatTimer);
      }
      dispatchAgentQueueStart(agent.id);
    }
  }

  async function wakeLeadSupervisorForRunFailure(input: {
    run: typeof heartbeatRuns.$inferSelect;
    status: "failed" | "timed_out";
    errorCode?: string | null;
    error?: string | null;
  }) {
    const issueId = readNonEmptyString(parseObject(input.run.contextSnapshot).issueId);
    if (!issueId) return;

    const issueContext = await loadInternalWorkItemSupervisorContext(db, input.run.companyId, issueId);
    if (!issueContext || !isLeadWatchEnabled(issueContext)) return;

    const leadAgentId = issueContext.techLeadAgentId;
    if (!leadAgentId || leadAgentId === input.run.agentId) return;

    const reason = leadSupervisorRunFailureReason({
      status: input.status,
      errorCode: input.errorCode ?? null,
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
          failedRunId: input.run.id,
          failedRunStatus: input.status,
          failedRunErrorCode: input.errorCode ?? null,
          failedRunError: input.error ?? null,
          ...internalMetadata,
          protocolDispatchMode: "lead_supervisor",
        },
        contextSnapshot: {
          issueId,
          taskId: issueId,
          source: "heartbeat.run",
          failedRunId: input.run.id,
          failedRunStatus: input.status,
          failedRunErrorCode: input.errorCode ?? null,
          failedRunError: input.error ?? null,
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
          failedRunId: input.run.id,
          failedRunStatus: input.status,
          failedRunErrorCode: input.errorCode ?? null,
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

      if (!issue) return;

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
        const deferredContextSeed = parseObject(
          deferredPayload[DEFERRED_WAKE_CONTEXT_KEY],
        );
        const promotedContextSeed: Record<string, unknown> = { ...deferredContextSeed };
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
        const promotedSource =
          (readNonEmptyString(deferred.source) as WakeupOptions["source"]) ?? "automation";
        const promotedTriggerDetail =
          (readNonEmptyString(deferred.triggerDetail) as WakeupOptions["triggerDetail"]) ?? null;
        const promotedPayload = deferredPayload;
        delete promotedPayload[DEFERRED_WAKE_CONTEXT_KEY];

        const {
          contextSnapshot: promotedContextSnapshot,
          taskKey: promotedTaskKey,
        } = enrichWakeContextSnapshot({
          contextSnapshot: promotedContextSeed,
          reason: promotedReason,
          source: promotedSource,
          triggerDetail: promotedTriggerDetail,
          payload: promotedPayload,
        });

        const sessionBefore = await resolveSessionBeforeForWakeup(deferredAgent, promotedTaskKey);
        const now = new Date();
        const newRun = await tx
          .insert(heartbeatRuns)
          .values({
            companyId: deferredAgent.companyId,
            agentId: deferredAgent.id,
            invocationSource: promotedSource,
            triggerDetail: promotedTriggerDetail,
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

    publishLiveEvent({
      companyId: promotedRun.companyId,
      type: "heartbeat.run.queued",
      payload: {
        runId: promotedRun.id,
        agentId: promotedRun.agentId,
        invocationSource: promotedRun.invocationSource,
        triggerDetail: promotedRun.triggerDetail,
        wakeupRequestId: promotedRun.wakeupRequestId,
      },
    });

      dispatchAgentQueueStart(promotedRun.agentId);
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
      await db.insert(agentWakeupRequests).values({
        companyId: agent.companyId,
        agentId,
        source,
        triggerDetail,
        reason,
        payload,
        status: "skipped",
        requestedByActorType: opts.requestedByActorType ?? null,
        requestedByActorId: opts.requestedByActorId ?? null,
        idempotencyKey: opts.idempotencyKey ?? null,
        finishedAt: new Date(),
      });
    };

    if (source === "timer" && !policy.enabled) {
      await writeSkippedRequest("heartbeat.disabled");
      return null;
    }
    if (source !== "timer" && !policy.wakeOnDemand) {
      await writeSkippedRequest("heartbeat.wakeOnDemand.disabled");
      return null;
    }

    const bypassIssueExecutionLock =
      reason === "issue_comment_mentioned" ||
      readNonEmptyString(enrichedContextSnapshot.wakeReason) === "issue_comment_mentioned";

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
            executionRunId: issues.executionRunId,
            executionAgentNameKey: issues.executionAgentNameKey,
          })
          .from(issues)
          .where(and(eq(issues.id, issueId), eq(issues.companyId, agent.companyId)))
          .then((rows) => rows[0] ?? null);

        if (!issue) {
          await tx.insert(agentWakeupRequests).values({
            companyId: agent.companyId,
            agentId,
            source,
            triggerDetail,
            reason: "issue_execution_issue_not_found",
            payload,
            status: "skipped",
            requestedByActorType: opts.requestedByActorType ?? null,
            requestedByActorId: opts.requestedByActorId ?? null,
            idempotencyKey: opts.idempotencyKey ?? null,
            finishedAt: new Date(),
          });
          return { kind: "skipped" as const };
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

            await tx.insert(agentWakeupRequests).values({
              companyId: agent.companyId,
              agentId,
              source,
              triggerDetail,
              reason: "issue_execution_same_name",
              payload,
              status: "coalesced",
              coalescedCount: 1,
              requestedByActorType: opts.requestedByActorType ?? null,
              requestedByActorId: opts.requestedByActorId ?? null,
              idempotencyKey: opts.idempotencyKey ?? null,
              runId: mergedRun.id,
              finishedAt: new Date(),
            });

            return { kind: "coalesced" as const, run: mergedRun };
          }

          const deferredPayload = {
            ...(payload ?? {}),
            issueId,
            [DEFERRED_WAKE_CONTEXT_KEY]: enrichedContextSnapshot,
          };

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

          await tx.insert(agentWakeupRequests).values({
            companyId: agent.companyId,
            agentId,
            source,
            triggerDetail,
            reason: "issue_execution_deferred",
            payload: deferredPayload,
            status: "deferred_issue_execution",
            requestedByActorType: opts.requestedByActorType ?? null,
            requestedByActorId: opts.requestedByActorId ?? null,
            idempotencyKey: opts.idempotencyKey ?? null,
          });

          return { kind: "deferred" as const };
        }

        const wakeupRequest = await tx
          .insert(agentWakeupRequests)
          .values({
            companyId: agent.companyId,
            agentId,
            source,
            triggerDetail,
            reason,
            payload,
            status: "queued",
            requestedByActorType: opts.requestedByActorType ?? null,
            requestedByActorId: opts.requestedByActorId ?? null,
            idempotencyKey: opts.idempotencyKey ?? null,
          })
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
      publishLiveEvent({
        companyId: newRun.companyId,
        type: "heartbeat.run.queued",
        payload: {
          runId: newRun.id,
          agentId: newRun.agentId,
          invocationSource: newRun.invocationSource,
          triggerDetail: newRun.triggerDetail,
          wakeupRequestId: newRun.wakeupRequestId,
        },
      });

      dispatchAgentQueueStart(agent.id);
      return newRun;
    }

    const activeRuns = await db
      .select()
      .from(heartbeatRuns)
      .where(and(eq(heartbeatRuns.agentId, agentId), inArray(heartbeatRuns.status, ["queued", "running"])))
      .orderBy(desc(heartbeatRuns.createdAt));

    const sameScopeQueuedRun = activeRuns.find(
      (candidate) => candidate.status === "queued" && isSameTaskScope(runTaskKey(candidate), taskKey),
    );
    const sameScopeRunningRun = activeRuns.find(
      (candidate) => candidate.status === "running" && isSameTaskScope(runTaskKey(candidate), taskKey),
    );
    const shouldQueueFollowupForCommentWake =
      Boolean(wakeCommentId) && Boolean(sameScopeRunningRun) && !sameScopeQueuedRun;

    const coalescedTargetRun =
      sameScopeQueuedRun ??
      (shouldQueueFollowupForCommentWake ? null : sameScopeRunningRun ?? null);

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

      await db.insert(agentWakeupRequests).values({
        companyId: agent.companyId,
        agentId,
        source,
        triggerDetail,
        reason,
        payload,
        status: "coalesced",
        coalescedCount: 1,
        requestedByActorType: opts.requestedByActorType ?? null,
        requestedByActorId: opts.requestedByActorId ?? null,
        idempotencyKey: opts.idempotencyKey ?? null,
        runId: mergedRun.id,
        finishedAt: new Date(),
      });
      return mergedRun;
    }

    const wakeupRequest = await db
      .insert(agentWakeupRequests)
      .values({
        companyId: agent.companyId,
        agentId,
        source,
        triggerDetail,
        reason,
        payload,
        status: "queued",
        requestedByActorType: opts.requestedByActorType ?? null,
        requestedByActorId: opts.requestedByActorId ?? null,
        idempotencyKey: opts.idempotencyKey ?? null,
      })
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

    publishLiveEvent({
      companyId: newRun.companyId,
      type: "heartbeat.run.queued",
      payload: {
        runId: newRun.id,
        agentId: newRun.agentId,
        invocationSource: newRun.invocationSource,
        triggerDetail: newRun.triggerDetail,
        wakeupRequestId: newRun.wakeupRequestId,
      },
    });

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

  async function cancelRunInternal(runId: string) {
    const run = await getRun(runId);
    if (!run) throw notFound("Heartbeat run not found");
    if (run.status !== "running" && run.status !== "queued") return run;
    const cancelledAt = new Date();

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

    const cancelled = await setRunStatus(run.id, "cancelled", {
      finishedAt: cancelledAt,
      error: "Cancelled by control plane",
      errorCode: "cancelled",
    });

    await setWakeupStatus(run.wakeupRequestId, "cancelled", {
      finishedAt: cancelledAt,
      error: "Cancelled by control plane",
    });

    await upsertRunLease({
      run: cancelled ?? run,
      status: "cancelled",
      checkpointJson: {
        phase: "finalize.cancelled",
        message: "run cancelled by control plane",
      },
      heartbeatAt: cancelledAt,
      leaseExpiresAt: cancelledAt,
      releasedAt: cancelledAt,
      lastError: "Cancelled by control plane",
    });

    if (cancelled) {
      await appendRunEvent(cancelled, 1, {
        eventType: "lifecycle",
        stream: "system",
        level: "warn",
        message: "run cancelled",
      });
      await releaseIssueExecutionAndPromote(cancelled);
    }

    runningProcesses.delete(run.id);
    clearDispatchWatchdog(run.id);
    await finalizeAgentStatus(run.agentId, "cancelled");
    dispatchAgentQueueStart(run.agentId);
    return cancelled;
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

    cancelIssueScope: async (input: {
      companyId: string;
      issueId: string;
      reason?: string | null;
    }) => {
      const cancelledAt = new Date();
      const reason = readNonEmptyString(input.reason) ?? "Cancelled by control plane";

      const wakeupRows = await db
        .select({ id: agentWakeupRequests.id })
        .from(agentWakeupRequests)
        .where(
          and(
            eq(agentWakeupRequests.companyId, input.companyId),
            inArray(agentWakeupRequests.status, ["queued", "claimed", "deferred_issue_execution"]),
            sql`${agentWakeupRequests.payload} ->> 'issueId' = ${input.issueId}`,
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

      const runs = await db
        .select({ id: heartbeatRuns.id })
        .from(heartbeatRuns)
        .where(
          and(
            eq(heartbeatRuns.companyId, input.companyId),
            inArray(heartbeatRuns.status, ["queued", "running"]),
            sql`${heartbeatRuns.contextSnapshot} ->> 'issueId' = ${input.issueId}`,
          ),
        )
        .orderBy(
          sql`case when ${heartbeatRuns.status} = 'running' then 0 else 1 end`,
          asc(heartbeatRuns.createdAt),
        );

      let cancelledRunCount = 0;
      for (const run of runs) {
        const current = await getRun(run.id);
        if (!current || (current.status !== "queued" && current.status !== "running")) continue;
        await cancelRunInternal(run.id);
        cancelledRunCount += 1;
      }

      return {
        cancelledWakeupCount: wakeupRows.length,
        cancelledRunCount,
      };
    },

    cancelSupersededIssueFollowups: async (input: {
      companyId: string;
      issueId: string;
      reason?: string | null;
      excludeRunId?: string | null;
    }) => {
      const cancelledAt = new Date();
      const reason = readNonEmptyString(input.reason) ?? "Cancelled stale protocol follow-up";
      const supersededReasons = [...SUPERSEDED_PROTOCOL_WAKE_REASONS];

      const wakeupRows = await db
        .select({ id: agentWakeupRequests.id })
        .from(agentWakeupRequests)
        .where(
          and(
            eq(agentWakeupRequests.companyId, input.companyId),
            inArray(agentWakeupRequests.status, ["queued", "claimed", "deferred_issue_execution"]),
            sql`${agentWakeupRequests.payload} ->> 'issueId' = ${input.issueId}`,
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
        eq(heartbeatRuns.companyId, input.companyId),
        inArray(heartbeatRuns.status, ["queued", "running"]),
        sql`${heartbeatRuns.contextSnapshot} ->> 'issueId' = ${input.issueId}`,
        sql`${heartbeatRuns.contextSnapshot} ->> 'wakeReason' in (${sql.join(supersededReasons.map((value) => sql`${value}`), sql`, `)})`,
      ];
      if (input.excludeRunId) {
        runConditions.push(sql`${heartbeatRuns.id} <> ${input.excludeRunId}`);
      }
      const runs = await db
        .select({ id: heartbeatRuns.id })
        .from(heartbeatRuns)
        .where(and(...runConditions));

      let cancelledRunCount = 0;
      for (const run of runs) {
        const current = await getRun(run.id);
        if (!current || (current.status !== "queued" && current.status !== "running")) continue;
        await cancelRunInternal(run.id);
        cancelledRunCount += 1;
      }

      return {
        cancelledWakeupCount: wakeupRows.length,
        cancelledRunCount,
      };
    },

    cancelActiveForAgent: async (agentId: string) => {
      const runs = await db
        .select()
        .from(heartbeatRuns)
        .where(and(eq(heartbeatRuns.agentId, agentId), inArray(heartbeatRuns.status, ["queued", "running"])));

      for (const run of runs) {
        const cancelledAt = new Date();
        const cancelled = await setRunStatus(run.id, "cancelled", {
          finishedAt: cancelledAt,
          error: "Cancelled due to agent pause",
          errorCode: "cancelled",
        });

        await setWakeupStatus(run.wakeupRequestId, "cancelled", {
          finishedAt: cancelledAt,
          error: "Cancelled due to agent pause",
        });
        await upsertRunLease({
          run: cancelled ?? run,
          status: "cancelled",
          checkpointJson: {
            phase: "finalize.cancelled",
            message: "run cancelled due to agent pause",
          },
          heartbeatAt: cancelledAt,
          leaseExpiresAt: cancelledAt,
          releasedAt: cancelledAt,
          lastError: "Cancelled due to agent pause",
        });

        const running = runningProcesses.get(run.id);
        if (running) {
          running.child.kill("SIGTERM");
          runningProcesses.delete(run.id);
        }
        clearDispatchWatchdog(run.id);
        await releaseIssueExecutionAndPromote(run);
      }

      return runs.length;
    },

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
