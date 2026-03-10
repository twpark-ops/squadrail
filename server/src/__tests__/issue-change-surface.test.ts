import { describe, expect, it } from "vitest";
import { buildIssueChangeSurface } from "../services/issue-change-surface.js";

describe("issue change surface", () => {
  it("derives merge candidate and change evidence from protocol artifacts", () => {
    const surface = buildIssueChangeSurface({
      issue: {
        id: "issue-1",
        identifier: "CLO-1",
        title: "Test change surface",
        status: "done",
      },
      messages: [
        {
          id: "msg-approve",
          messageType: "APPROVE_IMPLEMENTATION",
          summary: "Approved",
          createdAt: "2026-03-10T11:00:00Z",
          payload: {
            approvalSummary: "Looks good",
          },
          artifacts: [
            {
              kind: "approval",
              uri: "approval://1",
              label: "Approval evidence",
              metadata: {},
            },
          ],
        },
        {
          id: "msg-close",
          messageType: "CLOSE_TASK",
          summary: "Closed",
          createdAt: "2026-03-10T11:05:00Z",
          payload: {
            mergeStatus: "pending_external_merge",
            closureSummary: "Ready to merge",
            verificationSummary: "Focused tests passed",
            rollbackPlan: "Revert patch",
            remainingRisks: ["Merge remains external"],
          },
          artifacts: [
            {
              kind: "doc",
              uri: "workspace://binding",
              label: "Workspace binding",
              metadata: {
                bindingType: "implementation_workspace",
                cwd: "/tmp/worktree",
                branchName: "squadrail/test",
                headSha: "abc123",
                source: "project_workspace",
                workspaceState: "fresh",
              },
            },
            {
              kind: "diff",
              uri: "run://diff",
              label: "Workspace diff",
              metadata: {
                branchName: "squadrail/test",
                headSha: "abc123",
                changedFiles: ["src/app.ts"],
                statusEntries: ["M src/app.ts"],
                diffStat: "1 file changed, 10 insertions(+)",
              },
            },
            {
              kind: "test_run",
              uri: "run://test",
              label: "pnpm test",
              metadata: {},
            },
          ],
        },
      ],
    });

    expect(surface.branchName).toBe("squadrail/test");
    expect(surface.workspacePath).toBe("/tmp/worktree");
    expect(surface.changedFiles).toEqual(["src/app.ts"]);
    expect(surface.mergeCandidate?.state).toBe("pending");
    expect(surface.mergeCandidate?.approvalSummary).toBe("Looks good");
  });

  it("uses persisted merge candidate state when operator already resolved it", () => {
    const surface = buildIssueChangeSurface({
      issue: {
        id: "issue-1",
        identifier: "CLO-1",
        title: "Test change surface",
        status: "done",
      },
      messages: [],
      mergeCandidateRecord: {
        state: "merged",
        closeMessageId: "msg-close",
        sourceBranch: "squadrail/test",
        workspacePath: "/tmp/worktree",
        headSha: "abc123",
        diffStat: "1 file changed",
        targetBaseBranch: "main",
        mergeCommitSha: "def456",
        operatorNote: "Merged by operator",
        resolvedAt: "2026-03-10T12:00:00Z",
      },
    });

    expect(surface.mergeCandidate?.state).toBe("merged");
    expect(surface.mergeCandidate?.targetBaseBranch).toBe("main");
    expect(surface.mergeCandidate?.mergeCommitSha).toBe("def456");
  });
});
