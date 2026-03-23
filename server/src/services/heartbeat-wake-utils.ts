import { asBoolean, parseObject } from "../adapters/utils.js";
import { normalizeIssuePriorityValue } from "./heartbeat-dispatch-priority.js";
import { readNonEmptyString } from "./heartbeat-runtime-utils.js";

export const DEFERRED_WAKE_CONTEXT_KEY = "_squadrailWakeContext";

type WakeSource = "timer" | "assignment" | "on_demand" | "automation";
type WakeTriggerDetail = "manual" | "ping" | "callback" | "system";

interface ParsedIssueAssigneeAdapterOverrides {
  adapterConfig: Record<string, unknown> | null;
  useProjectWorkspace: boolean | null;
}

export function parseIssueAssigneeAdapterOverrides(
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

export function deriveTaskKey(
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
    wakeReason === "protocol_review_requested" ||
    wakeReason === "protocol_implementation_approved" ||
    wakeReason === "protocol_required_retry" ||
    wakeReason === "protocol_progress_followup" ||
    wakeReason === "issue_ready_for_closure" ||
    wakeReason === "issue_ready_for_qa_gate"
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

export function describeSessionResetReason(
  contextSnapshot: Record<string, unknown> | null | undefined,
) {
  const wakeReason = readNonEmptyString(contextSnapshot?.wakeReason);
  if (
    wakeReason === "issue_assigned" ||
    wakeReason === "issue_reassigned" ||
    wakeReason === "issue_watch_assigned" ||
    wakeReason === "issue_watch_reassigned" ||
    wakeReason === "protocol_review_requested" ||
    wakeReason === "protocol_implementation_approved" ||
    wakeReason === "protocol_required_retry" ||
    wakeReason === "protocol_progress_followup" ||
    wakeReason === "issue_ready_for_closure" ||
    wakeReason === "issue_ready_for_qa_gate"
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

export function deriveCommentId(
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

export function enrichWakeContextSnapshot(input: {
  contextSnapshot: Record<string, unknown>;
  reason: string | null;
  source: WakeSource;
  triggerDetail: WakeTriggerDetail | null;
  payload: Record<string, unknown> | null;
}) {
  const { contextSnapshot, reason, source, triggerDetail, payload } = input;
  const issueIdFromPayload = readNonEmptyString(payload?.issueId);
  const commentIdFromPayload = readNonEmptyString(payload?.commentId);
  const taskKey = deriveTaskKey(contextSnapshot, payload);
  const wakeCommentId = deriveCommentId(contextSnapshot, payload);

  if (!readNonEmptyString(contextSnapshot.wakeReason) && reason) {
    contextSnapshot.wakeReason = reason;
  }
  if (!readNonEmptyString(contextSnapshot.issueId) && issueIdFromPayload) {
    contextSnapshot.issueId = issueIdFromPayload;
  }
  if (!readNonEmptyString(contextSnapshot.taskId) && issueIdFromPayload) {
    contextSnapshot.taskId = issueIdFromPayload;
  }
  if (!readNonEmptyString(contextSnapshot.taskKey) && taskKey) {
    contextSnapshot.taskKey = taskKey;
  }
  if (!readNonEmptyString(contextSnapshot.commentId) && commentIdFromPayload) {
    contextSnapshot.commentId = commentIdFromPayload;
  }
  if (!readNonEmptyString(contextSnapshot.wakeCommentId) && wakeCommentId) {
    contextSnapshot.wakeCommentId = wakeCommentId;
  }
  if (!readNonEmptyString(contextSnapshot.wakeSource) && source) {
    contextSnapshot.wakeSource = source;
  }
  if (!readNonEmptyString(contextSnapshot.wakeTriggerDetail) && triggerDetail) {
    contextSnapshot.wakeTriggerDetail = triggerDetail;
  }
  if (!readNonEmptyString(contextSnapshot.issuePriority)) {
    const priority = normalizeIssuePriorityValue(payload?.priority);
    if (priority) contextSnapshot.issuePriority = priority;
  }

  return {
    contextSnapshot,
    issueIdFromPayload,
    commentIdFromPayload,
    taskKey,
    wakeCommentId,
  };
}

export function mergeCoalescedContextSnapshot(
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

export function shouldBypassIssueExecutionLock(input: {
  reason: string | null;
  contextSnapshot: Record<string, unknown>;
}) {
  return (
    input.reason === "issue_comment_mentioned"
    || readNonEmptyString(input.contextSnapshot.wakeReason) === "issue_comment_mentioned"
  );
}

function isSameTaskScope(left: string | null, right: string | null) {
  return (left ?? null) === (right ?? null);
}

export function selectWakeupCoalescedRun(input: {
  activeRuns: Array<{
    id: string;
    status: string;
    contextSnapshot: unknown;
  }>;
  taskKey: string | null;
  wakeCommentId: string | null;
}) {
  const sameScopeQueuedRun = input.activeRuns.find(
    (candidate) => candidate.status === "queued" && isSameTaskScope(
      deriveTaskKey(candidate.contextSnapshot as Record<string, unknown> | null, null),
      input.taskKey,
    ),
  );
  const sameScopeRunningRun = input.activeRuns.find(
    (candidate) => candidate.status === "running" && isSameTaskScope(
      deriveTaskKey(candidate.contextSnapshot as Record<string, unknown> | null, null),
      input.taskKey,
    ),
  );
  const shouldQueueFollowupForCommentWake =
    Boolean(input.wakeCommentId) && Boolean(sameScopeRunningRun) && !sameScopeQueuedRun;

  return {
    sameScopeQueuedRun: sameScopeQueuedRun ?? null,
    sameScopeRunningRun: sameScopeRunningRun ?? null,
    shouldQueueFollowupForCommentWake,
    coalescedTargetRun:
      sameScopeQueuedRun ?? (shouldQueueFollowupForCommentWake ? null : sameScopeRunningRun ?? null),
  };
}

export function buildDeferredIssueWakePayload(input: {
  payload: Record<string, unknown> | null;
  issueId: string;
  contextSnapshot: Record<string, unknown>;
}) {
  return {
    ...(input.payload ?? {}),
    issueId: input.issueId,
    [DEFERRED_WAKE_CONTEXT_KEY]: input.contextSnapshot,
  };
}

export function buildDeferredWakePromotionPlan(input: {
  deferredPayload: Record<string, unknown>;
  deferredReason?: string | null;
  deferredSource?: string | null;
  deferredTriggerDetail?: string | null;
}) {
  const deferredContextSeed = parseObject(input.deferredPayload[DEFERRED_WAKE_CONTEXT_KEY]);
  const promotedReason = readNonEmptyString(input.deferredReason) ?? "issue_execution_promoted";
  const promotedSource =
    (readNonEmptyString(input.deferredSource) as WakeSource) ?? "automation";
  const promotedTriggerDetail =
    (readNonEmptyString(input.deferredTriggerDetail) as WakeTriggerDetail) ?? null;
  const promotedPayload = { ...input.deferredPayload };
  delete promotedPayload[DEFERRED_WAKE_CONTEXT_KEY];

  const {
    contextSnapshot: promotedContextSnapshot,
    taskKey: promotedTaskKey,
  } = enrichWakeContextSnapshot({
    contextSnapshot: { ...deferredContextSeed },
    reason: promotedReason,
    source: promotedSource,
    triggerDetail: promotedTriggerDetail,
    payload: promotedPayload,
  });

  return {
    promotedReason,
    promotedSource,
    promotedTriggerDetail,
    promotedPayload,
    promotedContextSnapshot,
    promotedTaskKey,
  };
}

export function buildWakeupRequestValues(input: {
  companyId: string;
  agentId: string;
  source: WakeSource;
  triggerDetail: WakeTriggerDetail | null;
  reason: string | null;
  payload: Record<string, unknown> | null;
  status: string;
  requestedByActorType?: "user" | "agent" | "system" | null;
  requestedByActorId?: string | null;
  idempotencyKey?: string | null;
  runId?: string | null;
  finishedAt?: Date | null;
  coalescedCount?: number | null;
}) {
  return {
    companyId: input.companyId,
    agentId: input.agentId,
    source: input.source,
    triggerDetail: input.triggerDetail,
    reason: input.reason,
    payload: input.payload,
    status: input.status,
    requestedByActorType: input.requestedByActorType ?? null,
    requestedByActorId: input.requestedByActorId ?? null,
    idempotencyKey: input.idempotencyKey ?? null,
    runId: input.runId ?? null,
    finishedAt: input.finishedAt ?? null,
    coalescedCount: input.coalescedCount ?? undefined,
  };
}

export function buildHeartbeatRunQueuedEvent(input: {
  companyId: string;
  runId: string;
  agentId: string;
  invocationSource: string | null;
  triggerDetail: string | null;
  wakeupRequestId: string | null;
}) {
  return {
    companyId: input.companyId,
    type: "heartbeat.run.queued" as const,
    payload: {
      runId: input.runId,
      agentId: input.agentId,
      invocationSource: input.invocationSource,
      triggerDetail: input.triggerDetail,
      wakeupRequestId: input.wakeupRequestId,
    },
  };
}
