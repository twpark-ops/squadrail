import { asBoolean, asNumber, parseObject } from "../adapters/utils.js";
import { runWithoutDbContext } from "@squadrail/db";
import { resolveProtocolRunRequirement, type ProtocolRunRequirement } from "@squadrail/shared";
import {
  normalizeMaxConcurrentRuns,
  readNonEmptyString,
  toEpochMillis,
} from "./heartbeat-runtime-utils.js";

export const RUN_PROTOCOL_IDLE_WATCHDOG_MS = 10_000;
export const RUN_PROTOCOL_DEGRADED_WATCHDOG_MS = 20_000;
export const RUN_SHORT_SUPERVISORY_DEGRADED_WATCHDOG_MS = 10_000;
export const RUN_PROTOCOL_IDLE_WATCHDOG_MAX_MS = 60_000;
export const PROTOCOL_REQUIRED_RETRY_LIMIT = 1;
export const RETRYABLE_ADAPTER_FAILURE_LIMIT = 2;
export const SUPERSEDED_PROTOCOL_WAKE_REASONS = new Set([
  "issue_ready_for_closure",
  "issue_ready_for_qa_gate",
  "protocol_required_retry",
]);
const RETRYABLE_ADAPTER_ERROR_CODES = new Set([
  "claude_stream_incomplete",
]);
const IDLE_PROTOCOL_WATCHDOG_REQUIREMENT_KEYS = new Set<ProtocolRunRequirement["key"]>([
  "assignment_engineer",
  "assignment_supervisor",
  "reassignment_engineer",
  "reassignment_supervisor",
  "change_request_engineer",
  "review_reviewer",
  "qa_gate_reviewer",
  "approval_tech_lead",
]);
const SHORT_SUPERVISORY_PROTOCOL_REQUIREMENT_KEYS = new Set<ProtocolRunRequirement["key"]>([
  "review_reviewer",
  "qa_gate_reviewer",
  "approval_tech_lead",
]);

type RunLeaseLike = {
  status?: string | null;
  checkpointJson?: Record<string, unknown> | null;
  leaseExpiresAt?: Date | string | null;
  releasedAt?: Date | string | null;
};

type ObservedProtocolProgressMessage = {
  messageType: string;
};

type HeartbeatRunEventLike = {
  eventType?: string | null;
  createdAt?: Date | string | null;
};

function isProtocolWatchdogCheckpointPhase(checkpointPhase: string | null) {
  return (
    checkpointPhase === "adapter.invoke"
    || checkpointPhase === "adapter.execute_start"
    || Boolean(checkpointPhase && (checkpointPhase.startsWith("preflight.") || checkpointPhase.startsWith("adapter.")))
  );
}

function isShortSupervisoryProtocolRequirement(requirement: ProtocolRunRequirement | null | undefined) {
  return Boolean(requirement && SHORT_SUPERVISORY_PROTOCOL_REQUIREMENT_KEYS.has(requirement.key));
}

function classifySupervisoryInvokeStallReason(input: {
  runStatus: string;
  requirement: ProtocolRunRequirement | null;
  checkpointJson?: unknown;
  startedAt?: Date | string | null;
  now?: Date;
  degradedThresholdMs?: number;
}) {
  if (input.runStatus !== "running") return null;
  if (!isShortSupervisoryProtocolRequirement(input.requirement)) return null;

  const checkpoint = parseObject(input.checkpointJson);
  const checkpointPhase = readNonEmptyString(checkpoint.phase);
  if (!isProtocolWatchdogCheckpointPhase(checkpointPhase)) return null;

  const startedAtMs = toEpochMillis(input.startedAt) ?? 0;
  if (startedAtMs <= 0) return null;

  const degradedThresholdMs = Math.min(
    input.degradedThresholdMs ?? RUN_PROTOCOL_DEGRADED_WATCHDOG_MS,
    RUN_SHORT_SUPERVISORY_DEGRADED_WATCHDOG_MS,
  );
  if ((input.now ?? new Date()).getTime() - startedAtMs < degradedThresholdMs) return null;
  return "supervisory_invoke_stall" as const;
}

function resolveProtocolRecoveryThresholdMs(input: {
  degradedReason: string | null;
  degradedThresholdMs?: number;
}) {
  if (input.degradedReason === "supervisory_invoke_stall") {
    return Math.min(
      input.degradedThresholdMs ?? RUN_PROTOCOL_DEGRADED_WATCHDOG_MS,
      RUN_SHORT_SUPERVISORY_DEGRADED_WATCHDOG_MS,
    );
  }
  return input.degradedThresholdMs ?? RUN_PROTOCOL_DEGRADED_WATCHDOG_MS;
}

export function resolveDegradedProtocolRecoveryReason(input: {
  runStatus: string;
  requirement: ProtocolRunRequirement | null;
  wakeReason?: string | null;
  adapterRetryCount: number;
  adapterRetryErrorCode?: string | null;
  checkpointJson?: unknown;
  startedAt?: Date | string | null;
  now?: Date;
  degradedThresholdMs?: number;
}) {
  return classifyDegradedProtocolRunReason({
    requirement: input.requirement,
    wakeReason: input.wakeReason,
    adapterRetryCount: input.adapterRetryCount,
    adapterRetryErrorCode: input.adapterRetryErrorCode ?? null,
  }) ?? classifySupervisoryInvokeStallReason({
    runStatus: input.runStatus,
    requirement: input.requirement,
    checkpointJson: input.checkpointJson,
    startedAt: input.startedAt,
    now: input.now,
    degradedThresholdMs: input.degradedThresholdMs,
  });
}

export function resolveProtocolIdleWatchdogDelayMs(attempt: number) {
  const normalizedAttempt = Number.isFinite(attempt) ? Math.max(0, Math.floor(attempt)) : 0;
  if (normalizedAttempt <= 1) return RUN_PROTOCOL_IDLE_WATCHDOG_MS;
  return Math.min(
    RUN_PROTOCOL_IDLE_WATCHDOG_MAX_MS,
    RUN_PROTOCOL_IDLE_WATCHDOG_MS * (2 ** (normalizedAttempt - 1)),
  );
}

export function readLeaseLastProgressAt(checkpointJson: unknown) {
  const checkpoint = parseObject(checkpointJson);
  return toEpochMillis(readNonEmptyString(checkpoint.lastProgressAt));
}

export function isIdleProtocolWatchdogEligibleRequirement(requirement: ProtocolRunRequirement | null | undefined) {
  return Boolean(requirement && IDLE_PROTOCOL_WATCHDOG_REQUIREMENT_KEYS.has(requirement.key));
}

export function shouldRecoverIdleProtocolRun(input: {
  runStatus: string;
  hasRunningProcess: boolean;
  requirement: ProtocolRunRequirement | null;
  issueStatus?: string | null;
  workflowState?: string | null;
  protocolRetryCount: number;
  checkpointJson?: unknown;
  latestEvent?: HeartbeatRunEventLike | null;
  startedAt?: Date | string | null;
  now?: Date;
  idleThresholdMs?: number;
}) {
  if (input.runStatus !== "running") return false;
  if (!input.hasRunningProcess) return false;
  if (!isIdleProtocolWatchdogEligibleRequirement(input.requirement)) return false;
  if (!shouldEnqueueProtocolRequiredRetry({
    protocolRetryCount: input.protocolRetryCount,
    issueStatus: input.issueStatus ?? null,
    workflowState: input.workflowState ?? null,
    requirement: input.requirement,
  })) {
    return false;
  }

  const checkpoint = parseObject(input.checkpointJson);
  const checkpointPhase = readNonEmptyString(checkpoint.phase);
  const checkpointLooksIdle = isProtocolWatchdogCheckpointPhase(checkpointPhase);
  if (!checkpointLooksIdle) return false;

  const lastProgressAtMs =
    readLeaseLastProgressAt(checkpoint)
    ?? toEpochMillis(input.latestEvent?.createdAt)
    ?? toEpochMillis(input.startedAt)
    ?? 0;
  const idleThresholdMs = input.idleThresholdMs ?? RUN_PROTOCOL_IDLE_WATCHDOG_MS;
  return (input.now ?? new Date()).getTime() - lastProgressAtMs >= idleThresholdMs;
}

export function classifyDegradedProtocolRunReason(input: {
  requirement: ProtocolRunRequirement | null;
  wakeReason?: string | null;
  adapterRetryCount: number;
  adapterRetryErrorCode?: string | null;
}) {
  if (!isIdleProtocolWatchdogEligibleRequirement(input.requirement)) return null;
  if (readNonEmptyString(input.wakeReason) !== "adapter_retry") return null;

  if (
    readNonEmptyString(input.adapterRetryErrorCode) === "claude_stream_incomplete"
    && input.adapterRetryCount >= 1
  ) {
    return "claude_stream_incomplete_retry_loop" as const;
  }
  if (input.adapterRetryCount < RETRYABLE_ADAPTER_FAILURE_LIMIT) return null;
  return "adapter_retry_loop" as const;
}

export function classifyProtocolRuntimeDegradedState(input: {
  runStatus: string;
  requirement: ProtocolRunRequirement | null;
  wakeReason?: string | null;
  protocolRequiredRetryCount?: number;
  protocolDegradedRecoveryCount?: number;
  protocolIdleRecovery?: boolean;
  adapterRetryCount: number;
  adapterRetryErrorCode?: string | null;
  checkpointJson?: unknown;
  startedAt?: Date | string | null;
  now?: Date;
  degradedThresholdMs?: number;
}) {
  const degradedReason = resolveDegradedProtocolRecoveryReason({
    runStatus: input.runStatus,
    requirement: input.requirement,
    wakeReason: input.wakeReason,
    adapterRetryCount: input.adapterRetryCount,
    adapterRetryErrorCode: input.adapterRetryErrorCode ?? null,
    checkpointJson: input.checkpointJson,
    startedAt: input.startedAt,
    now: input.now,
    degradedThresholdMs: input.degradedThresholdMs,
  });
  if (degradedReason === "claude_stream_incomplete_retry_loop") {
    return degradedReason;
  }
  if (input.runStatus !== "running") return degradedReason;
  if (!isIdleProtocolWatchdogEligibleRequirement(input.requirement)) return degradedReason;

  const checkpoint = parseObject(input.checkpointJson);
  const checkpointPhase = readNonEmptyString(checkpoint.phase);
  if (!isProtocolWatchdogCheckpointPhase(checkpointPhase)) return degradedReason;

  const recoveryApplied =
    input.protocolIdleRecovery === true
    || (input.protocolRequiredRetryCount ?? 0) > 0
    || (input.protocolDegradedRecoveryCount ?? 0) > 0;
  if (!recoveryApplied) return degradedReason;

  const startedAtMs = toEpochMillis(input.startedAt) ?? readLeaseLastProgressAt(checkpoint) ?? 0;
  const degradedThresholdMs = input.degradedThresholdMs ?? RUN_PROTOCOL_DEGRADED_WATCHDOG_MS;
  if ((input.now ?? new Date()).getTime() - startedAtMs < degradedThresholdMs) return degradedReason;

  return "recovered_supervisory_invoke_stall" as const;
}

export function describeProtocolRunRuntimeState(input: {
  runStatus: string;
  contextSnapshot?: unknown;
  checkpointJson?: unknown;
  startedAt?: Date | string | null;
  now?: Date;
}) {
  const context = parseObject(input.contextSnapshot);
  const requirement = resolveProtocolRunRequirement({
    protocolMessageType: readNonEmptyString(context.protocolMessageType),
    protocolRecipientRole: readNonEmptyString(context.protocolRecipientRole),
  });
  const runtimeDegradedState = classifyProtocolRuntimeDegradedState({
    runStatus: input.runStatus,
    requirement,
    wakeReason: readNonEmptyString(context.wakeReason),
    protocolRequiredRetryCount:
      typeof context.protocolRequiredRetryCount === "number" && Number.isFinite(context.protocolRequiredRetryCount)
        ? context.protocolRequiredRetryCount
        : 0,
    protocolDegradedRecoveryCount:
      typeof context.protocolDegradedRecoveryCount === "number" && Number.isFinite(context.protocolDegradedRecoveryCount)
        ? context.protocolDegradedRecoveryCount
        : 0,
    protocolIdleRecovery: context.protocolIdleRecovery === true,
    adapterRetryCount:
      typeof context.adapterRetryCount === "number" && Number.isFinite(context.adapterRetryCount)
        ? context.adapterRetryCount
        : 0,
    adapterRetryErrorCode: readNonEmptyString(context.adapterRetryErrorCode),
    checkpointJson: input.checkpointJson,
    startedAt: input.startedAt,
    now: input.now,
  });
  return {
    runtimeDegradedState,
    runtimeHealth: runtimeDegradedState ? "degraded" as const : "normal" as const,
  };
}

export function shouldRecoverDegradedProtocolRun(input: {
  runStatus: string;
  hasRunningProcess: boolean;
  requirement: ProtocolRunRequirement | null;
  wakeReason?: string | null;
  issueStatus?: string | null;
  workflowState?: string | null;
  protocolRetryCount: number;
  protocolDegradedRecoveryCount: number;
  adapterRetryCount: number;
  adapterRetryErrorCode?: string | null;
  checkpointJson?: unknown;
  startedAt?: Date | string | null;
  now?: Date;
  degradedThresholdMs?: number;
}) {
  if (input.runStatus !== "running") return false;
  if (!input.hasRunningProcess) return false;
  if (!isIdleProtocolWatchdogEligibleRequirement(input.requirement)) return false;
  if (input.protocolDegradedRecoveryCount >= 1) return false;
  if (input.issueStatus === "done" || input.issueStatus === "cancelled") return false;
  if (!input.requirement || !input.workflowState) return false;
  if (!isWorkflowStateEligibleForProtocolRetry({
    requirement: input.requirement,
    workflowState: input.workflowState,
  })) return false;

  const degradedReason = resolveDegradedProtocolRecoveryReason({
    runStatus: input.runStatus,
    requirement: input.requirement,
    wakeReason: input.wakeReason,
    adapterRetryCount: input.adapterRetryCount,
    adapterRetryErrorCode: input.adapterRetryErrorCode ?? null,
    checkpointJson: input.checkpointJson,
    startedAt: input.startedAt,
    now: input.now,
    degradedThresholdMs: input.degradedThresholdMs,
  });
  if (!degradedReason) return false;

  const checkpoint = parseObject(input.checkpointJson);
  const checkpointPhase = readNonEmptyString(checkpoint.phase);
  if (!isProtocolWatchdogCheckpointPhase(checkpointPhase)) return false;

  const startedAtMs = toEpochMillis(input.startedAt) ?? readLeaseLastProgressAt(checkpoint) ?? 0;
  const degradedThresholdMs = resolveProtocolRecoveryThresholdMs({
    degradedReason,
    degradedThresholdMs: input.degradedThresholdMs,
  });
  return (input.now ?? new Date()).getTime() - startedAtMs >= degradedThresholdMs;
}

export async function runProtocolWatchdogRecoveries(input: {
  recoverIdle: () => Promise<boolean>;
  recoverDegraded: () => Promise<boolean>;
  onIdleError?: (error: unknown) => Promise<void> | void;
  onDegradedError?: (error: unknown) => Promise<void> | void;
}) {
  let recovered = false;
  try {
    recovered = await input.recoverIdle();
  } catch (error) {
    await input.onIdleError?.(error);
  }
  if (recovered) return true;

  try {
    return await input.recoverDegraded();
  } catch (error) {
    await input.onDegradedError?.(error);
    return false;
  }
}

export function hasRequiredProtocolProgress(input: {
  requirement: ProtocolRunRequirement | null;
  messages: ObservedProtocolProgressMessage[];
  finalWorkflowState?: string | null;
}) {
  const requirement = input.requirement;
  if (!requirement) return true;
  const observedMessageTypes = Array.from(
    new Set(
      input.messages
        .map((message) => readNonEmptyString(message.messageType))
        .filter((messageType): messageType is string => Boolean(messageType)),
    ),
  );
  const hasRequired = observedMessageTypes.some((messageType) => requirement.requiredMessageTypes.includes(
    messageType as ProtocolRunRequirement["requiredMessageTypes"][number],
  ));
  if (!hasRequired) return false;

  const hasNonIntermediateProgress = observedMessageTypes.some((messageType) => !requirement.intermediateMessageTypes.includes(
    messageType as ProtocolRunRequirement["intermediateMessageTypes"][number],
  ));
  if (hasNonIntermediateProgress) return true;

  return !isWorkflowStateEligibleForProtocolRetry({
    requirement,
    workflowState: input.finalWorkflowState,
  });
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

export function shouldEnqueueRetryableAdapterFailure(input: {
  adapterErrorCode?: string | null;
  adapterRetryCount: number;
  issueStatus?: string | null;
}) {
  const errorCode = readNonEmptyString(input.adapterErrorCode);
  if (!errorCode || !RETRYABLE_ADAPTER_ERROR_CODES.has(errorCode)) return false;
  if (input.adapterRetryCount >= RETRYABLE_ADAPTER_FAILURE_LIMIT) return false;
  if (input.issueStatus === "done" || input.issueStatus === "cancelled") return false;
  return true;
}

export function isWorkflowStateEligibleForProtocolRetry(input: {
  requirement: ProtocolRunRequirement;
  workflowState: string | null | undefined;
}) {
  const workflowState = readNonEmptyString(input.workflowState);
  if (!workflowState) return false;

  switch (input.requirement.key) {
    case "assignment_engineer":
    case "reassignment_engineer":
      return workflowState === "assigned" || workflowState === "accepted";
    case "assignment_supervisor":
    case "reassignment_supervisor":
      return workflowState === "assigned";
    case "implementation_engineer":
      return workflowState === "implementing";
    case "change_request_engineer":
      return workflowState === "changes_requested";
    case "review_reviewer":
      return workflowState === "submitted_for_review" || workflowState === "under_review";
    case "qa_gate_reviewer":
      return workflowState === "qa_pending" || workflowState === "under_qa_review";
    case "approval_tech_lead":
      return workflowState === "approved";
    default:
      return false;
  }
}

export function shouldSkipSupersededProtocolFollowup(input: {
  wakeReason?: string | null;
  issueStatus?: string | null;
  workflowState?: string | null;
  protocolMessageType?: string | null;
  protocolRecipientRole?: string | null;
}) {
  if (
    (input.issueStatus === "done" || input.issueStatus === "cancelled")
    && isSupersededProtocolWakeReason(input.wakeReason)
  ) {
    return true;
  }

  const requirement = resolveProtocolRunRequirement({
    protocolMessageType: readNonEmptyString(input.protocolMessageType) ?? undefined,
    protocolRecipientRole: readNonEmptyString(input.protocolRecipientRole) ?? undefined,
  });
  if (!requirement) return false;

  if (input.issueStatus === "done" || input.issueStatus === "cancelled") {
    return true;
  }

  const workflowState = readNonEmptyString(input.workflowState);
  if (!workflowState) return false;

  return !isWorkflowStateEligibleForProtocolRetry({
    requirement,
    workflowState,
  });
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
  slotBlocked?: boolean;
}) {
  if (input.hasRunningProcess) return "noop" as const;
  if (input.runStatus === "queued") {
    if (input.slotBlocked) return "hold" as const;
    if (
      input.leaseStatus
      && input.leaseStatus !== "queued"
      && input.leaseStatus !== "launching"
    ) {
      return "noop" as const;
    }
    if (
      input.checkpointPhase !== "queue.created"
      && input.checkpointPhase !== "dispatch.redispatch"
      && input.checkpointPhase !== "dispatch.waiting_for_slot"
    ) {
      return "noop" as const;
    }
    if (input.dispatchAttempts >= 2) return "fail" as const;
    return "redispatch" as const;
  }
  if (input.runStatus !== "running") return "noop" as const;
  if (input.leaseStatus && input.leaseStatus !== "launching") return "noop" as const;
  if (input.checkpointPhase !== "claim.queued" && input.checkpointPhase !== "dispatch.redispatch") {
    return "noop" as const;
  }
  if (input.dispatchAttempts >= 2) return "fail" as const;
  return "redispatch" as const;
}

export function scheduleDeferredRunDispatch(dispatch: () => void) {
  setImmediate(dispatch);
}

export function runDispatchWatchdogOutsideDbContext(callback: () => void) {
  runWithoutDbContext(callback);
}

export function parseHeartbeatPolicyConfig(runtimeConfig: unknown) {
  const runtime = parseObject(runtimeConfig);
  const heartbeat = parseObject(runtime.heartbeat);

  return {
    enabled: asBoolean(heartbeat.enabled, true),
    intervalSec: Math.max(0, asNumber(heartbeat.intervalSec, 0)),
    wakeOnDemand: asBoolean(
      heartbeat.wakeOnDemand ?? heartbeat.wakeOnAssignment ?? heartbeat.wakeOnOnDemand ?? heartbeat.wakeOnAutomation,
      true,
    ),
    maxConcurrentRuns: normalizeMaxConcurrentRuns(heartbeat.maxConcurrentRuns),
  };
}
