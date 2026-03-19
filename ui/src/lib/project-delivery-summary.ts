import type { Issue } from "@squadrail/shared";
import { buildCurrentDeliveryIssues } from "./current-delivery";

function isActiveRootIssue(issue: Issue) {
  return !issue.parentId && issue.status !== "done" && issue.status !== "cancelled";
}

function isBlockedIssue(issue: Issue) {
  const snapshot = issue.progressSnapshot;
  if (!snapshot) return issue.status === "blocked";
  return snapshot.phase === "blocked" || (snapshot.subtaskSummary.blocked ?? 0) > 0;
}

function isClarificationIssue(issue: Issue) {
  const snapshot = issue.progressSnapshot;
  if (!snapshot) return false;
  return snapshot.phase === "clarification" || (snapshot.pendingClarificationCount ?? 0) > 0;
}

function isReviewOrGateIssue(issue: Issue) {
  const phase = issue.progressSnapshot?.phase ?? null;
  return phase === "review" || phase === "qa" || phase === "merge";
}

export function buildProjectDeliverySummary(issues: Issue[], limit = 3) {
  const activeRootIssues = issues.filter(isActiveRootIssue);

  return {
    activeRootCount: activeRootIssues.length,
    blockedRootCount: activeRootIssues.filter(isBlockedIssue).length,
    clarificationRootCount: activeRootIssues.filter(isClarificationIssue).length,
    reviewOrGateCount: activeRootIssues.filter(isReviewOrGateIssue).length,
    currentDelivery: buildCurrentDeliveryIssues(activeRootIssues, limit),
  };
}
