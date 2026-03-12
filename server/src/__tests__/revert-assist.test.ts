import { describe, expect, it } from "vitest";
import { buildIssueRevertAssist, buildRevertAssistContextBody } from "../services/revert-assist.js";

describe("revert assist helpers", () => {
  it("builds recovery assist from rollback plan, merge commit, and prior actions", () => {
    const assist = buildIssueRevertAssist({
      issueIdentifier: "CLO-250",
      issueTitle: "Release regression",
      issueStatus: "done",
      mergeCommitSha: "abc123def456",
      closePayload: {
        rollbackPlan: "Revert the merge commit and verify smoke tests.",
        followUpIssueIds: ["CLO-251"],
      },
      automationMetadata: {
        revertAssist: {
          lastActionSummary: "Created follow-up CLO-251",
          lastActionAt: "2026-03-13T02:00:00.000Z",
          lastCreatedIssueId: "issue-251",
          lastCreatedIssueIdentifier: "CLO-251",
        },
      },
    });

    expect(assist).toMatchObject({
      status: "ready",
      rollbackPlan: "Revert the merge commit and verify smoke tests.",
      mergeCommitSha: "abc123def456",
      followUpIssueIds: ["CLO-251"],
      suggestedTitle: "Recovery follow-up for CLO-250",
      canCreateFollowUp: true,
      canReopen: true,
      lastActionSummary: "Created follow-up CLO-251",
      lastCreatedIssueId: "issue-251",
      lastCreatedIssueIdentifier: "CLO-251",
    });
    expect(assist?.lastActionAt).toEqual(new Date("2026-03-13T02:00:00.000Z"));
  });

  it("renders rollback context markdown for reopened work", () => {
    const body = buildRevertAssistContextBody({
      issueIdentifier: "CLO-250",
      issueTitle: "Release regression",
      rollbackPlan: "Revert the merge commit and verify smoke tests.",
      mergeCommitSha: "abc123def456",
      followUpIssueIds: ["CLO-251", "CLO-252"],
      operatorNote: "Operator requested rollback review",
    });

    expect(body).toContain("## Recovery Context");
    expect(body).toContain("- Source issue: CLO-250");
    expect(body).toContain("- Merge commit: abc123def456");
    expect(body).toContain("- Existing follow-up issues: CLO-251, CLO-252");
    expect(body).toContain("## Recorded Rollback Plan");
    expect(body).toContain("Operator requested rollback review");
  });
});
