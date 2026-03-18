import type { Issue, IssueProgressPhase } from "@squadrail/shared";

const PHASE_PRIORITY: Record<IssueProgressPhase, number> = {
  blocked: 0,
  clarification: 1,
  review: 2,
  qa: 3,
  merge: 4,
  implementing: 5,
  planning: 6,
  intake: 7,
  done: 8,
  cancelled: 9,
};

const ISSUE_PRIORITY: Record<Issue["priority"], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function toTimestamp(value: Date | string | null | undefined) {
  if (!value) return 0;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function isActiveRootIssue(issue: Issue) {
  return !issue.parentId && issue.status !== "done" && issue.status !== "cancelled";
}

export function sortCurrentDeliveryIssues(issues: Issue[]) {
  return [...issues].sort((left, right) => {
    const leftPhase = left.progressSnapshot?.phase ?? "intake";
    const rightPhase = right.progressSnapshot?.phase ?? "intake";
    const phaseDelta = PHASE_PRIORITY[leftPhase] - PHASE_PRIORITY[rightPhase];
    if (phaseDelta !== 0) return phaseDelta;

    const leftPriority = ISSUE_PRIORITY[left.priority] ?? ISSUE_PRIORITY.medium;
    const rightPriority = ISSUE_PRIORITY[right.priority] ?? ISSUE_PRIORITY.medium;
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;

    const leftBlocked = left.progressSnapshot?.subtaskSummary.blocked ?? 0;
    const rightBlocked = right.progressSnapshot?.subtaskSummary.blocked ?? 0;
    if (leftBlocked !== rightBlocked) return rightBlocked - leftBlocked;

    const leftClarifications = left.progressSnapshot?.pendingClarificationCount ?? 0;
    const rightClarifications = right.progressSnapshot?.pendingClarificationCount ?? 0;
    if (leftClarifications !== rightClarifications) return rightClarifications - leftClarifications;

    const updatedDelta = toTimestamp(right.updatedAt) - toTimestamp(left.updatedAt);
    if (updatedDelta !== 0) return updatedDelta;

    return left.title.localeCompare(right.title);
  });
}

export function buildCurrentDeliveryIssues(issues: Issue[], limit = 3) {
  return sortCurrentDeliveryIssues(issues.filter(isActiveRootIssue)).slice(0, limit);
}
