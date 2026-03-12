import type { IssueMergeCandidateRevertAssist } from "@squadrail/shared";

function readString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
}

export function buildIssueRevertAssist(input: {
  issueIdentifier: string | null;
  issueTitle: string;
  issueStatus: string;
  mergeCommitSha: string | null;
  closePayload: Record<string, unknown>;
  automationMetadata?: Record<string, unknown> | null;
}): IssueMergeCandidateRevertAssist | null {
  const rollbackPlan = readString(input.closePayload.rollbackPlan);
  const followUpIssueIds = readStringArray(input.closePayload.followUpIssueIds);
  const mergeCommitSha = readString(input.mergeCommitSha);
  const automationMetadata = input.automationMetadata && typeof input.automationMetadata === "object"
    ? input.automationMetadata
    : null;
  const revertMetadata = automationMetadata && typeof automationMetadata.revertAssist === "object"
    ? (automationMetadata.revertAssist as Record<string, unknown>)
    : null;
  const canReopen = input.issueStatus === "done" || input.issueStatus === "cancelled";
  const canCreateFollowUp = Boolean(rollbackPlan || mergeCommitSha || followUpIssueIds.length > 0);
  if (!canCreateFollowUp && !canReopen) {
    return null;
  }

  const summary = mergeCommitSha
    ? "Recovery assist can reopen this issue or bootstrap a follow-up that tracks the landed merge commit."
    : rollbackPlan
      ? "Recovery assist can reopen this issue or bootstrap a follow-up from the recorded rollback plan."
      : "Recovery assist can continue the existing rollback path through linked follow-up issues.";

  return {
    status: canCreateFollowUp ? "ready" : "watch",
    summary,
    rollbackPlan,
    mergeCommitSha,
    followUpIssueIds,
    suggestedTitle: `Recovery follow-up for ${input.issueIdentifier ?? input.issueTitle}`,
    canCreateFollowUp,
    canReopen,
    lastActionSummary: readString(revertMetadata?.lastActionSummary),
    lastActionAt:
      typeof revertMetadata?.lastActionAt === "string"
        ? new Date(revertMetadata.lastActionAt)
        : null,
    lastCreatedIssueId: readString(revertMetadata?.lastCreatedIssueId),
    lastCreatedIssueIdentifier: readString(revertMetadata?.lastCreatedIssueIdentifier),
  };
}

export function buildRevertAssistContextBody(input: {
  issueIdentifier: string | null;
  issueTitle: string;
  rollbackPlan: string | null;
  mergeCommitSha: string | null;
  followUpIssueIds: string[];
  operatorNote?: string | null;
}) {
  const lines = [
    "## Recovery Context",
    "",
    `- Source issue: ${input.issueIdentifier ?? input.issueTitle}`,
    `- Title: ${input.issueTitle}`,
    input.mergeCommitSha ? `- Merge commit: ${input.mergeCommitSha}` : null,
    input.followUpIssueIds.length > 0
      ? `- Existing follow-up issues: ${input.followUpIssueIds.join(", ")}`
      : null,
    input.operatorNote ? `- Operator note: ${input.operatorNote}` : null,
  ].filter((line): line is string => line !== null);

  if (input.rollbackPlan) {
    lines.push("", "## Recorded Rollback Plan", "", input.rollbackPlan);
  }

  lines.push(
    "",
    "## Requested Recovery Outcome",
    "",
    "- Re-evaluate the landed change against the recorded rollback plan.",
    "- Decide whether a revert, partial rollback, or scoped remediation is required.",
    "- Attach updated verification evidence before this recovery issue closes.",
  );

  return lines.join("\n");
}
