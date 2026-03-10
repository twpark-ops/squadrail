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
        automationMetadata: {
          lastPreparedBranch: "squadrail/merge/clo-1",
        },
        operatorNote: "Merged by operator",
        resolvedAt: "2026-03-10T12:00:00Z",
      },
    });

    expect(surface.mergeCandidate?.state).toBe("merged");
    expect(surface.mergeCandidate?.targetBaseBranch).toBe("main");
    expect(surface.mergeCandidate?.mergeCommitSha).toBe("def456");
    expect(surface.mergeCandidate?.automationMetadata).toEqual({
      lastPreparedBranch: "squadrail/merge/clo-1",
    });
  });

  it("anchors merge candidate evidence to the persisted close message", () => {
    const surface = buildIssueChangeSurface({
      issue: {
        id: "issue-1",
        identifier: "CLO-1",
        title: "Anchored candidate",
        status: "done",
      },
      messages: [
        {
          id: "approve-1",
          messageType: "APPROVE_IMPLEMENTATION",
          summary: "Approved first revision",
          createdAt: "2026-03-10T10:59:00Z",
          payload: {
            approvalSummary: "Approved first branch",
          },
          artifacts: [
            {
              kind: "approval",
              uri: "approval://1",
              label: "Approval 1",
              metadata: {},
            },
          ],
        },
        {
          id: "close-1",
          messageType: "CLOSE_TASK",
          summary: "Closed first revision",
          createdAt: "2026-03-10T11:00:00Z",
          payload: {
            mergeStatus: "pending_external_merge",
            closureSummary: "First merge candidate",
            verificationSummary: "First verification",
            rollbackPlan: "Revert first branch",
          },
          artifacts: [
            {
              kind: "doc",
              uri: "workspace://binding-1",
              label: "Workspace binding",
              metadata: {
                bindingType: "implementation_workspace",
                cwd: "/tmp/worktree-1",
                branchName: "squadrail/first",
                headSha: "abc123",
                source: "project_isolated",
                workspaceState: "fresh",
              },
            },
          ],
        },
        {
          id: "approve-2",
          messageType: "APPROVE_IMPLEMENTATION",
          summary: "Approved later revision",
          createdAt: "2026-03-10T12:00:00Z",
          payload: {
            approvalSummary: "Approved second branch",
          },
          artifacts: [
            {
              kind: "approval",
              uri: "approval://2",
              label: "Approval 2",
              metadata: {},
            },
          ],
        },
      ],
      mergeCandidateRecord: {
        state: "pending",
        closeMessageId: "close-1",
        sourceBranch: "squadrail/first",
        workspacePath: "/tmp/worktree-1",
        headSha: "abc123",
        diffStat: null,
        targetBaseBranch: "main",
        mergeCommitSha: null,
        automationMetadata: {},
        operatorNote: null,
        resolvedAt: null,
      },
    });

    expect(surface.mergeCandidate?.closeSummary).toBe("First merge candidate");
    expect(surface.mergeCandidate?.approvalSummary).toBe("Approved first branch");
    expect(surface.branchName).toBe("squadrail/first");
  });
});
