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
            boardTemplateId: "company-close-template",
            boardTemplateLabel: "Release close",
            boardTemplateScope: "company",
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
      briefs: [
        {
          id: "brief-reviewer",
          briefScope: "reviewer",
          retrievalRunId: "run-reviewer",
          createdAt: "2026-03-10T11:04:00Z",
          contentJson: {
            quality: {
              confidenceLevel: "high",
              graphHitCount: 3,
              multiHopGraphHitCount: 1,
              personalizationApplied: true,
              candidateCacheHit: true,
              finalCacheHit: false,
            },
          },
        },
      ],
      retrievalFeedbackSummary: {
        positiveCount: 3,
        negativeCount: 1,
        pinnedPathCount: 2,
        hiddenPathCount: 1,
        lastFeedbackAt: "2026-03-10T11:06:00Z",
        feedbackTypeCounts: {
          operator_pin: 2,
          operator_hide: 1,
          approved: 1,
        },
      },
    });

    expect(surface.branchName).toBe("squadrail/test");
    expect(surface.workspacePath).toBe("/tmp/worktree");
    expect(surface.changedFiles).toEqual(["src/app.ts"]);
    expect(surface.mergeCandidate?.state).toBe("pending");
    expect(surface.mergeCandidate?.approvalSummary).toBe("Looks good");
    expect(surface.mergeCandidate?.templateTrace).toEqual({
      id: "company-close-template",
      label: "Release close",
      scope: "company",
    });
    expect(surface.mergeCandidate?.revertAssist).toMatchObject({
      status: "ready",
      rollbackPlan: "Revert patch",
      followUpIssueIds: [],
      canCreateFollowUp: true,
      canReopen: true,
    });
    expect(surface.retrievalContext.latestRuns[0]?.retrievalRunId).toBe("run-reviewer");
    expect(surface.retrievalContext.latestRuns[0]?.candidateCacheHit).toBe(true);
    expect(surface.retrievalContext.feedbackSummary.pinnedPathCount).toBe(2);
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
          revertAssist: {
            lastActionSummary: "Created follow-up CLO-77",
            lastActionAt: "2026-03-10T12:05:00.000Z",
            lastCreatedIssueId: "issue-77",
            lastCreatedIssueIdentifier: "CLO-77",
          },
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
      revertAssist: {
        lastActionSummary: "Created follow-up CLO-77",
        lastActionAt: "2026-03-10T12:05:00.000Z",
        lastCreatedIssueId: "issue-77",
        lastCreatedIssueIdentifier: "CLO-77",
      },
    });
    expect(surface.mergeCandidate?.revertAssist).toMatchObject({
      mergeCommitSha: "def456",
      lastActionSummary: "Created follow-up CLO-77",
      lastCreatedIssueId: "issue-77",
      lastCreatedIssueIdentifier: "CLO-77",
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

  it("derives PR bridge and CI gate state from persisted automation metadata", () => {
    const surface = buildIssueChangeSurface({
      issue: {
        id: "issue-9",
        identifier: "CLO-9",
        title: "PR bridge candidate",
        status: "done",
      },
      messages: [],
      mergeCandidateRecord: {
        state: "pending",
        closeMessageId: "close-9",
        sourceBranch: "squadrail/clo-9",
        workspacePath: "/tmp/worktree-9",
        headSha: "abc999",
        diffStat: "2 files changed",
        targetBaseBranch: "main",
        mergeCommitSha: null,
        automationMetadata: {
          prBridge: {
            provider: "github",
            repoOwner: "acme",
            repoName: "swiftsight",
            remoteUrl: "https://github.com/acme/swiftsight.git",
            repoUrl: "https://github.com/acme/swiftsight",
            number: 91,
            externalId: "991",
            url: "https://github.com/acme/swiftsight/pull/91",
            title: "CLO-9: PR bridge candidate",
            state: "draft",
            mergeability: "blocked",
            headBranch: "squadrail/clo-9",
            baseBranch: "main",
            headSha: "abc999",
            reviewDecision: null,
            commentCount: 2,
            reviewCommentCount: 1,
            lastSyncedAt: "2026-03-12T03:00:00.000Z",
            checks: [
              {
                name: "pr-verify",
                status: "pending",
                conclusion: null,
                summary: "Queued",
                required: true,
                detailsUrl: "https://github.com/acme/swiftsight/actions/runs/1",
              },
            ],
          },
        },
        operatorNote: null,
        resolvedAt: null,
      },
      failureLearningGate: {
        closeReady: false,
        retryability: "operator_required",
        failureFamily: "dispatch",
        blockingReasons: [
          "Dispatch timeout repeated 2 times after the last successful run and should be reviewed before close.",
        ],
        summary: "Close should stay gated until the repeated runtime failure is reviewed by an operator.",
        suggestedActions: [
          "Inspect dispatch watchdog and adapter cold-start before retrying merged close.",
        ],
        repeatedFailureCount24h: 2,
        lastSeenAt: "2026-03-12T03:30:00.000Z",
      },
    });

    expect(surface.mergeCandidate?.prBridge).toEqual(
      expect.objectContaining({
        provider: "github",
        number: 91,
        state: "draft",
      }),
    );
    expect(surface.mergeCandidate?.gateStatus).toEqual(
      expect.objectContaining({
        mergeReady: false,
        requiredChecksConfigured: true,
      }),
    );
    expect(surface.mergeCandidate?.gateStatus?.blockingReasons).toContain("Required checks still pending (1).");
    expect(surface.mergeCandidate?.conflictAssist).toEqual(
      expect.objectContaining({
        status: "warning",
      }),
    );
    expect(surface.mergeCandidate?.failureAssist).toEqual(
      expect.objectContaining({
        status: "watch",
        retryability: "operator_required",
        repeatedFailureCount24h: 2,
      }),
    );
  });
});
