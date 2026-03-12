import { and, eq, gte, inArray, sql } from "drizzle-orm";
import type { Db } from "@squadrail/db";
import { heartbeatRuns } from "@squadrail/db";

export type FailureLearningFamily = "dispatch" | "runtime_process" | "workspace";
export type FailureLearningRetryability = "retryable" | "operator_required" | "blocked";

export interface IssueFailureLearningRunLike {
  status: string;
  errorCode: string | null;
  updatedAt: Date | string;
  finishedAt: Date | string | null;
}

export interface IssueFailureLearningGateStatus {
  closeReady: boolean;
  retryability: FailureLearningRetryability | "clean";
  failureFamily: FailureLearningFamily | null;
  blockingReasons: string[];
  summary: string;
  suggestedActions: string[];
  repeatedFailureCount24h: number;
  lastSeenAt: Date | null;
}

function normalizeDate(value: Date | string | null | undefined) {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value);
}

function runtimeFailureRule(errorCode: string | null | undefined) {
  switch (errorCode) {
    case "dispatch_timeout":
      return {
        family: "dispatch" as const,
        retryability: "retryable" as const,
        threshold: 2,
        blockerText: (count: number) =>
          `Dispatch timeout repeated ${count} times after the last successful run and should be reviewed before close.`,
        action: "Inspect dispatch watchdog and adapter cold-start before retrying merged close.",
      };
    case "process_lost":
      return {
        family: "runtime_process" as const,
        retryability: "operator_required" as const,
        threshold: 1,
        blockerText: () =>
          "Process-lost runtime failure has not been followed by a successful retry.",
        action: "Inspect host/runtime health, then rerun or escalate before close.",
      };
    case "workspace_required":
      return {
        family: "workspace" as const,
        retryability: "blocked" as const,
        threshold: 1,
        blockerText: () =>
          "Workspace remains blocked for implementation and should be repaired before close.",
        action: "Repair or rebind the workspace before attempting merged close.",
      };
    default:
      return null;
  }
}

function retryabilityRank(value: FailureLearningRetryability | "clean") {
  switch (value) {
    case "blocked":
      return 3;
    case "operator_required":
      return 2;
    case "retryable":
      return 1;
    default:
      return 0;
  }
}

export function buildIssueFailureLearningGateStatus(input: {
  runs: IssueFailureLearningRunLike[];
}) {
  const normalizedRuns = [...input.runs]
    .map((run) => ({
      ...run,
      updatedAt: normalizeDate(run.updatedAt),
      finishedAt: normalizeDate(run.finishedAt),
    }))
    .filter(
      (
        run,
      ): run is IssueFailureLearningRunLike & {
        updatedAt: Date;
        finishedAt: Date | null;
      } => run.updatedAt instanceof Date,
    )
    .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());

  const latestSuccessAt = normalizedRuns.find((run) => run.status === "succeeded")?.updatedAt ?? null;
  const unresolvedFailures = normalizedRuns.filter((run) => {
    if (!run.errorCode) return false;
    if (run.status !== "failed" && run.status !== "timed_out") return false;
    if (!latestSuccessAt) return true;
    return run.updatedAt.getTime() > latestSuccessAt.getTime();
  });

  const counts = new Map<string, number>();
  const latestByCode = new Map<string, Date>();
  for (const run of unresolvedFailures) {
    if (!run.errorCode) continue;
    counts.set(run.errorCode, (counts.get(run.errorCode) ?? 0) + 1);
    const seenAt = run.finishedAt ?? run.updatedAt;
    const existing = latestByCode.get(run.errorCode);
    if (!existing || (seenAt && seenAt.getTime() > existing.getTime())) {
      latestByCode.set(run.errorCode, seenAt ?? run.updatedAt);
    }
  }

  const blockingReasons: string[] = [];
  const suggestedActions: string[] = [];
  let retryability: FailureLearningRetryability | "clean" = "clean";
  let failureFamily: FailureLearningFamily | null = null;
  let repeatedFailureCount24h = 0;
  let lastSeenAt: Date | null = null;

  for (const [errorCode, count] of counts.entries()) {
    const rule = runtimeFailureRule(errorCode);
    if (!rule || count < rule.threshold) continue;
    const effectiveRetryability =
      rule.retryability === "retryable" && count >= rule.threshold
        ? "operator_required" as const
        : rule.retryability;
    blockingReasons.push(rule.blockerText(count));
    suggestedActions.push(rule.action);
    repeatedFailureCount24h += count;
    const seenAt = latestByCode.get(errorCode) ?? null;
    if (seenAt && (!lastSeenAt || seenAt.getTime() > lastSeenAt.getTime())) {
      lastSeenAt = seenAt;
    }
    if (retryabilityRank(effectiveRetryability) > retryabilityRank(retryability)) {
      retryability = effectiveRetryability;
      failureFamily = rule.family;
    }
  }

  if (blockingReasons.length === 0) {
    return {
      closeReady: true,
      retryability: "clean" as const,
      failureFamily: null,
      blockingReasons: [],
      summary: "No unresolved repeated runtime failure signal is blocking close.",
      suggestedActions: [],
      repeatedFailureCount24h: 0,
      lastSeenAt: null,
    } satisfies IssueFailureLearningGateStatus;
  }

  return {
    closeReady: false,
    retryability,
    failureFamily,
    blockingReasons,
    summary:
      retryability === "blocked"
        ? "Close is blocked until the latest runtime workspace issue is repaired."
        : "Close should stay gated until the repeated runtime failure is reviewed by an operator.",
    suggestedActions: Array.from(new Set(suggestedActions)),
    repeatedFailureCount24h,
    lastSeenAt,
  } satisfies IssueFailureLearningGateStatus;
}

export async function summarizeIssueFailureLearning(db: Db, input: {
  companyId: string;
  issueId: string;
  since?: Date;
}) {
  const since = input.since ?? new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      status: heartbeatRuns.status,
      errorCode: heartbeatRuns.errorCode,
      updatedAt: heartbeatRuns.updatedAt,
      finishedAt: heartbeatRuns.finishedAt,
    })
    .from(heartbeatRuns)
    .where(
      and(
        eq(heartbeatRuns.companyId, input.companyId),
        gte(heartbeatRuns.updatedAt, since),
        inArray(heartbeatRuns.status, ["failed", "timed_out", "succeeded"]),
        sql`coalesce(${heartbeatRuns.contextSnapshot} ->> 'issueId', ${heartbeatRuns.contextSnapshot} ->> 'taskId') = ${input.issueId}`,
      ),
    );

  return buildIssueFailureLearningGateStatus({ runs: rows });
}
