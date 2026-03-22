import type { IssuePriority } from "@squadrail/shared";
import { parseObject } from "../adapters/utils.js";
import { readNonEmptyString } from "./heartbeat-runtime-utils.js";

const DISPATCH_PRIORITY_ESCALATION_STEP_MS = 20 * 60 * 1000;
const DISPATCH_PRIORITY_ESCALATION_MAX_BOOST = 2;

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
  ageBoost: number;
  queuedForMs: number;
  effectiveRank: number;
  preemptedRunIds: string[];
}

export function buildDispatchPrioritySelectionDetails(input: {
  priorityClass: "critical" | "high" | "normal" | "low";
  issuePriority: IssuePriority | null;
  ageBoost: number;
  preemptedRunIds: string[];
}) {
  return {
    priorityClass: input.priorityClass,
    issuePriority: input.issuePriority,
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
    "issuePriority" | "priorityClass" | "ageBoost" | "queuedForMs" | "preemptedRunIds"
  >;
  selectedAt?: Date;
}) {
  const selectedAt = input.selectedAt ?? new Date();
  return {
    ...input.existingContext,
    ...(input.selection.issuePriority ? { issuePriority: input.selection.issuePriority } : {}),
    dispatchPriorityClass: input.selection.priorityClass,
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

    return {
      run,
      issueId,
      issuePriority: rawPriority,
      priorityClass: priorityClassFromRank(effectiveRank),
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
    if (left.effectiveRank !== right.effectiveRank) return right.effectiveRank - left.effectiveRank;
    if (left.createdAtMs !== right.createdAtMs) return left.createdAtMs - right.createdAtMs;
    return left.run.id.localeCompare(right.run.id);
  });

  return dispatchOrder.map((entry) => {
    const preemptedRunIds = fifoOrder
      .filter((candidate) => candidate.createdAtMs < entry.createdAtMs && candidate.effectiveRank < entry.effectiveRank)
      .map((candidate) => candidate.run.id)
      .slice(0, 5);

    return {
      run: entry.run,
      issueId: entry.issueId,
      issuePriority: entry.issuePriority,
      priorityClass: entry.priorityClass,
      ageBoost: entry.ageBoost,
      queuedForMs: entry.queuedForMs,
      effectiveRank: entry.effectiveRank,
      preemptedRunIds,
    } satisfies HeartbeatQueuedRunPrioritySelection<T>;
  });
}
