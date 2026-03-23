import {
  resolveProtocolRunRequirement,
  type IssuePriority,
} from "@squadrail/shared";
import { parseObject } from "../adapters/utils.js";
import { readNonEmptyString } from "./heartbeat-runtime-utils.js";

const DISPATCH_PRIORITY_ESCALATION_STEP_MS = 20 * 60 * 1000;
const DISPATCH_PRIORITY_ESCALATION_MAX_BOOST = 2;
const SHORT_SUPERVISORY_PROTOCOL_REQUIREMENT_KEYS = new Set([
  "review_reviewer",
  "qa_gate_reviewer",
  "approval_tech_lead",
]);
const HIGH_PRIORITY_PROTOCOL_WAKE_REASONS = new Set([
  "issue_ready_for_closure",
  "issue_ready_for_qa_gate",
  "protocol_review_requested",
  "protocol_implementation_approved",
  "protocol_required_retry",
]);
const LOW_PRIORITY_PROTOCOL_WAKE_REASONS = new Set([
  "protocol_timeout_escalation",
  "protocol_timeout_reminder",
]);

export function normalizeIssuePriorityValue(value: unknown): IssuePriority | null {
  const normalized = readNonEmptyString(value)?.toLowerCase();
  if (
    normalized === "critical"
    || normalized === "high"
    || normalized === "medium"
    || normalized === "low"
  ) {
    return normalized;
  }
  return null;
}

export function priorityRank(priority: IssuePriority | null) {
  switch (priority) {
    case "critical":
      return 3;
    case "high":
      return 2;
    case "medium":
      return 1;
    default:
      return 0;
  }
}

export function priorityClassFromRank(rank: number) {
  if (rank >= 3) return "critical" as const;
  if (rank === 2) return "high" as const;
  if (rank === 1) return "normal" as const;
  return "low" as const;
}

export interface HeartbeatQueuedRunPrioritySelection<T extends {
  id: string;
  createdAt: Date | string;
  contextSnapshot: Record<string, unknown> | null | undefined;
}> {
  run: T;
  issueId: string | null;
  issuePriority: IssuePriority | null;
  priorityClass: "critical" | "high" | "normal" | "low";
  wakePriorityRank: number;
  wakeReason: string | null;
  ageBoost: number;
  queuedForMs: number;
  effectiveRank: number;
  preemptedRunIds: string[];
}

export function buildDispatchPrioritySelectionDetails(input: {
  priorityClass: "critical" | "high" | "normal" | "low";
  issuePriority: IssuePriority | null;
  wakePriorityRank: number;
  wakeReason: string | null;
  ageBoost: number;
  preemptedRunIds: string[];
}) {
  return {
    priorityClass: input.priorityClass,
    issuePriority: input.issuePriority,
    wakePriorityRank: input.wakePriorityRank,
    wakeReason: input.wakeReason,
    ageBoost: input.ageBoost,
    preemptedRunIds: input.preemptedRunIds,
  };
}

export function buildDispatchPriorityContextSnapshot(input: {
  existingContext: Record<string, unknown>;
  selection: Pick<
    HeartbeatQueuedRunPrioritySelection<{
      id: string;
      createdAt: Date | string;
      contextSnapshot: Record<string, unknown> | null | undefined;
    }>,
    "issuePriority" | "priorityClass" | "wakePriorityRank" | "wakeReason" | "ageBoost" | "queuedForMs" | "preemptedRunIds"
  >;
  selectedAt?: Date;
}) {
  const selectedAt = input.selectedAt ?? new Date();
  return {
    ...input.existingContext,
    ...(input.selection.issuePriority ? { issuePriority: input.selection.issuePriority } : {}),
    dispatchPriorityClass: input.selection.priorityClass,
    dispatchWakePriorityRank: input.selection.wakePriorityRank,
    ...(input.selection.wakeReason ? { dispatchWakeReason: input.selection.wakeReason } : {}),
    dispatchPriorityAgeBoost: input.selection.ageBoost,
    dispatchPriorityQueuedForMs: input.selection.queuedForMs,
    dispatchPrioritySelectedAt: selectedAt.toISOString(),
    ...(input.selection.preemptedRunIds.length > 0
      ? {
          dispatchPreemption: {
            preempted: true,
            selectedAt: selectedAt.toISOString(),
            ...buildDispatchPrioritySelectionDetails(input.selection),
          },
        }
      : {}),
  } satisfies Record<string, unknown>;
}

export function resolveDispatchWakePriorityRank(
  contextSnapshot: Record<string, unknown> | null | undefined,
) {
  const context = parseObject(contextSnapshot);
  const wakeReason = readNonEmptyString(context.wakeReason);
  const requirement = resolveProtocolRunRequirement({
    protocolMessageType: readNonEmptyString(context.protocolMessageType),
    protocolRecipientRole: readNonEmptyString(context.protocolRecipientRole),
  });

  if (wakeReason && LOW_PRIORITY_PROTOCOL_WAKE_REASONS.has(wakeReason)) {
    return 0;
  }
  if (wakeReason && HIGH_PRIORITY_PROTOCOL_WAKE_REASONS.has(wakeReason)) {
    return 3;
  }
  if (requirement && SHORT_SUPERVISORY_PROTOCOL_REQUIREMENT_KEYS.has(requirement.key)) {
    return 2;
  }
  return 1;
}

export function shouldPreemptRunningRunForQueuedSelection(input: {
  selection: Pick<
    HeartbeatQueuedRunPrioritySelection<{
      id: string;
      createdAt: Date | string;
      contextSnapshot: Record<string, unknown> | null | undefined;
    }>,
    "wakePriorityRank"
  >;
  runningContextSnapshot: Record<string, unknown> | null | undefined;
}) {
  if (input.selection.wakePriorityRank < 2) return false;

  const runningContext = parseObject(input.runningContextSnapshot);
  const runningWakeReason = readNonEmptyString(runningContext.wakeReason);
  if (!runningWakeReason || !LOW_PRIORITY_PROTOCOL_WAKE_REASONS.has(runningWakeReason)) {
    return false;
  }

  return input.selection.wakePriorityRank > resolveDispatchWakePriorityRank(runningContext);
}

export function prioritizeQueuedRunsForDispatch<T extends {
  id: string;
  createdAt: Date | string;
  contextSnapshot: Record<string, unknown> | null | undefined;
}>(input: {
  runs: T[];
  issuePriorityByIssueId?: Map<string, IssuePriority>;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const decorated = input.runs.map((run) => {
    const contextSnapshot = parseObject(run.contextSnapshot);
    const issueId = readNonEmptyString(contextSnapshot.issueId);
    const wakeReason = readNonEmptyString(contextSnapshot.wakeReason);
    const rawPriority =
      normalizeIssuePriorityValue(contextSnapshot.issuePriority)
      ?? (issueId ? input.issuePriorityByIssueId?.get(issueId) ?? null : null);
    const queuedAt = run.createdAt instanceof Date ? run.createdAt : new Date(run.createdAt);
    const queuedForMs = Math.max(0, now.getTime() - queuedAt.getTime());
    const ageBoost = Math.min(
      DISPATCH_PRIORITY_ESCALATION_MAX_BOOST,
      Math.floor(queuedForMs / DISPATCH_PRIORITY_ESCALATION_STEP_MS),
    );
    const effectiveRank = Math.min(3, priorityRank(rawPriority) + ageBoost);
    const wakePriorityRank = resolveDispatchWakePriorityRank(contextSnapshot);

    return {
      run,
      issueId,
      issuePriority: rawPriority,
      priorityClass: priorityClassFromRank(effectiveRank),
      wakePriorityRank,
      wakeReason,
      ageBoost,
      queuedForMs,
      effectiveRank,
      createdAtMs: queuedAt.getTime(),
    };
  });

  const fifoOrder = [...decorated].sort((left, right) => {
    if (left.createdAtMs !== right.createdAtMs) return left.createdAtMs - right.createdAtMs;
    return left.run.id.localeCompare(right.run.id);
  });

  const dispatchOrder = [...decorated].sort((left, right) => {
    if (left.wakePriorityRank !== right.wakePriorityRank) {
      return right.wakePriorityRank - left.wakePriorityRank;
    }
    if (left.effectiveRank !== right.effectiveRank) return right.effectiveRank - left.effectiveRank;
    if (left.createdAtMs !== right.createdAtMs) return left.createdAtMs - right.createdAtMs;
    return left.run.id.localeCompare(right.run.id);
  });

  return dispatchOrder.map((entry) => {
    const preemptedRunIds = fifoOrder
      .filter((candidate) => (
        candidate.createdAtMs < entry.createdAtMs
        && (
          candidate.wakePriorityRank < entry.wakePriorityRank
          || (
            candidate.wakePriorityRank === entry.wakePriorityRank
            && candidate.effectiveRank < entry.effectiveRank
          )
        )
      ))
      .map((candidate) => candidate.run.id)
      .slice(0, 5);

    return {
      run: entry.run,
      issueId: entry.issueId,
      issuePriority: entry.issuePriority,
      priorityClass: entry.priorityClass,
      wakePriorityRank: entry.wakePriorityRank,
      wakeReason: entry.wakeReason,
      ageBoost: entry.ageBoost,
      queuedForMs: entry.queuedForMs,
      effectiveRank: entry.effectiveRank,
      preemptedRunIds,
    } satisfies HeartbeatQueuedRunPrioritySelection<T>;
  });
}
