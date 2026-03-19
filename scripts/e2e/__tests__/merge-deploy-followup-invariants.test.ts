import { describe, expect, it } from "vitest";
import {
  assertMergeDeployFollowupScenario,
  evaluateMergeDeployFollowupScenario,
} from "../merge-deploy-followup-invariants.mjs";

function makeMessage(type, overrides = {}) {
  return {
    id: `${type}-1`,
    messageType: type,
    payload: {},
    artifacts: [],
    ...overrides,
  };
}

describe("merge/deploy follow-up invariants", () => {
  it("passes when close follow-up preserves merge candidate provenance and resets session", () => {
    const evaluation = assertMergeDeployFollowupScenario({
      issueId: "issue-1",
      deliverySnapshot: {
        issue: { id: "issue-1" },
        protocolState: { techLeadAgentId: "lead-1" },
        protocolMessages: [
          makeMessage("APPROVE_IMPLEMENTATION", {
            id: "approve-1",
            createdAt: "2026-03-19T08:54:40.000Z",
            payload: { approvalSummary: "Approved for external merge." },
          }),
          makeMessage("CLOSE_TASK", {
            id: "close-1",
            createdAt: "2026-03-19T08:54:46.000Z",
            sender: { actorType: "agent", actorId: "lead-1", role: "tech_lead" },
            payload: {
              closureSummary: "Closed with pending external merge.",
              verificationSummary: "pnpm test and pnpm build passed.",
              rollbackPlan: "Drop the isolated worktree branch if merge is rejected.",
            },
          }),
        ],
        runs: [
          {
            runId: "run-close-1",
            agentId: "lead-1",
            createdAt: "2026-03-19T08:54:41.000Z",
            resultJson: {
              protocolProgress: {
                protocolMessageType: "CLOSE_TASK",
                satisfied: true,
              },
            },
          },
        ],
      },
      changeSurface: {
        changedFiles: ["src/release-label.js"],
        mergeCandidate: {
          state: "pending",
          closeMessageId: "close-1",
          sourceBranch: "squadrail/del-2/lead-1",
          headSha: "abc123",
          workspacePath: "/tmp/worktree",
          diffStat: "1 file changed, 4 insertions(+)",
          changedFiles: ["src/release-label.js"],
          closeSummary: "Closed with pending external merge.",
          verificationSummary: "pnpm test and pnpm build passed.",
          approvalSummary: "Approved for external merge.",
          rollbackPlan: "Drop the isolated worktree branch if merge is rejected.",
          remainingRisks: ["Base workspace stays unchanged until external merge completes."],
          gateStatus: {
            mergeReady: true,
          },
        },
      },
      closeRunLog: {
        content: '[squadrail] Skipping saved session resume for task "issue-1" because wake reason is issue_ready_for_closure.',
      },
      techLeadSessions: [
        { taskKey: "issue-1", sessionDisplayId: "lead-session-2" },
      ],
      reviewerSessions: [
        { taskKey: "issue-1", sessionDisplayId: "review-session-1" },
      ],
    });

    expect(evaluation.failures).toEqual([]);
    expect(evaluation.checks.mergeCandidatePendingState).toBe(true);
    expect(evaluation.checks.closeFollowupWakeCaptured).toBe(true);
    expect(evaluation.checks.reviewerSessionNotReused).toBe(true);
  });

  it("accepts a close follow-up run identified by sender and approval timing before resultJson is finalized", () => {
    const evaluation = assertMergeDeployFollowupScenario({
      issueId: "issue-1",
      deliverySnapshot: {
        issue: { id: "issue-1" },
        protocolState: { techLeadAgentId: "lead-1" },
        protocolMessages: [
          makeMessage("APPROVE_IMPLEMENTATION", {
            id: "approve-1",
            createdAt: "2026-03-19T08:54:40.000Z",
            payload: { approvalSummary: "Approved for external merge." },
          }),
          makeMessage("CLOSE_TASK", {
            id: "close-1",
            createdAt: "2026-03-19T08:54:46.000Z",
            sender: { actorType: "agent", actorId: "lead-1", role: "tech_lead" },
            payload: {
              closureSummary: "Closed with pending external merge.",
              verificationSummary: "pnpm test and pnpm build passed.",
              rollbackPlan: "Drop the isolated worktree branch if merge is rejected.",
            },
          }),
        ],
        runs: [
          {
            runId: "run-review-1",
            agentId: "reviewer-1",
            createdAt: "2026-03-19T08:54:39.000Z",
            resultJson: {
              protocolProgress: {
                protocolMessageType: "APPROVE_IMPLEMENTATION",
                satisfied: true,
              },
            },
          },
          {
            runId: "run-close-1",
            agentId: "lead-1",
            createdAt: "2026-03-19T08:54:41.000Z",
            status: "running",
            resultJson: null,
          },
        ],
      },
      changeSurface: {
        changedFiles: ["src/release-label.js"],
        mergeCandidate: {
          state: "pending",
          closeMessageId: "close-1",
          sourceBranch: "squadrail/del-2/lead-1",
          headSha: "abc123",
          workspacePath: "/tmp/worktree",
          diffStat: "1 file changed, 4 insertions(+)",
          changedFiles: ["src/release-label.js"],
          closeSummary: "Closed with pending external merge.",
          verificationSummary: "pnpm test and pnpm build passed.",
          approvalSummary: "Approved for external merge.",
          rollbackPlan: "Drop the isolated worktree branch if merge is rejected.",
          remainingRisks: ["Base workspace stays unchanged until external merge completes."],
          gateStatus: {
            mergeReady: true,
          },
        },
      },
      closeRunLog: {
        content: '[squadrail] Skipping saved session resume for task "issue-1" because wake reason is issue_ready_for_closure.',
      },
      techLeadSessions: [
        { taskKey: "issue-1", sessionDisplayId: "lead-session-2" },
      ],
      reviewerSessions: [
        { taskKey: "issue-1", sessionDisplayId: "review-session-1" },
      ],
    });

    expect(evaluation.failures).toEqual([]);
    expect(evaluation.checks.closeRunObserved).toBe(true);
    expect(evaluation.closeRun?.runId).toBe("run-close-1");
  });

  it("accepts shell snapshot wake evidence when the run log is sparse", () => {
    const evaluation = assertMergeDeployFollowupScenario({
      issueId: "issue-1",
      deliverySnapshot: {
        issue: { id: "issue-1" },
        protocolState: { techLeadAgentId: "lead-1" },
        protocolMessages: [
          makeMessage("APPROVE_IMPLEMENTATION", {
            id: "approve-1",
            createdAt: "2026-03-19T08:54:40.000Z",
            payload: { approvalSummary: "Approved for external merge." },
          }),
          makeMessage("CLOSE_TASK", {
            id: "close-1",
            createdAt: "2026-03-19T08:54:46.000Z",
            sender: { actorType: "agent", actorId: "lead-1", role: "tech_lead" },
            payload: {
              closureSummary: "Closed with pending external merge.",
              verificationSummary: "pnpm test and pnpm build passed.",
              rollbackPlan: "Drop the isolated worktree branch if merge is rejected.",
            },
          }),
        ],
        runs: [
          {
            runId: "run-close-1",
            agentId: "lead-1",
            createdAt: "2026-03-19T08:54:41.000Z",
            status: "running",
            resultJson: null,
          },
        ],
      },
      changeSurface: {
        changedFiles: ["src/release-label.js"],
        mergeCandidate: {
          state: "pending",
          closeMessageId: "close-1",
          sourceBranch: "squadrail/del-2/lead-1",
          headSha: "abc123",
          workspacePath: "/tmp/worktree",
          diffStat: "1 file changed, 4 insertions(+)",
          changedFiles: ["src/release-label.js"],
          closeSummary: "Closed with pending external merge.",
          verificationSummary: "pnpm test and pnpm build passed.",
          approvalSummary: "Approved for external merge.",
          rollbackPlan: "Drop the isolated worktree branch if merge is rejected.",
          remainingRisks: ["Base workspace stays unchanged until external merge completes."],
          gateStatus: null,
        },
      },
      closeRunLog: { content: "" },
      closeWakeEvidence: {
        matched: true,
        path: "/tmp/shell_snapshots/close-followup.sh",
      },
      techLeadSessions: [
        { taskKey: "issue-1", sessionDisplayId: "lead-session-2" },
      ],
      reviewerSessions: [
        { taskKey: "issue-1", sessionDisplayId: "review-session-1" },
      ],
    });

    expect(evaluation.failures).toEqual([]);
    expect(evaluation.checks.deploySurfaceSignalsPresent).toBe(true);
    expect(evaluation.checks.closeFollowupWakeCaptured).toBe(true);
  });

  it("accepts a dedicated close run when the follow-up wake evidence is not persisted", () => {
    const evaluation = assertMergeDeployFollowupScenario({
      issueId: "issue-1",
      deliverySnapshot: {
        issue: { id: "issue-1" },
        protocolState: { techLeadAgentId: "lead-1" },
        protocolMessages: [
          makeMessage("APPROVE_IMPLEMENTATION", {
            id: "approve-1",
            createdAt: "2026-03-19T08:54:40.000Z",
            payload: { approvalSummary: "Approved for external merge." },
          }),
          makeMessage("CLOSE_TASK", {
            id: "close-1",
            createdAt: "2026-03-19T08:54:46.000Z",
            sender: { actorType: "agent", actorId: "lead-1", role: "tech_lead" },
            payload: {
              closureSummary: "Closed with pending external merge.",
              verificationSummary: "pnpm test and pnpm build passed.",
              rollbackPlan: "Drop the isolated worktree branch if merge is rejected.",
            },
          }),
        ],
        runs: [
          {
            runId: "run-close-1",
            agentId: "lead-1",
            createdAt: "2026-03-19T08:54:47.000Z",
            resultJson: {
              protocolProgress: {
                protocolMessageType: "CLOSE_TASK",
                satisfied: true,
              },
            },
          },
        ],
      },
      changeSurface: {
        changedFiles: ["src/release-label.js"],
        mergeCandidate: {
          state: "pending",
          closeMessageId: "close-1",
          sourceBranch: "squadrail/del-2/lead-1",
          headSha: "abc123",
          workspacePath: "/tmp/worktree",
          diffStat: "1 file changed, 4 insertions(+)",
          changedFiles: ["src/release-label.js"],
          closeSummary: "Closed with pending external merge.",
          verificationSummary: "pnpm test and pnpm build passed.",
          approvalSummary: "Approved for external merge.",
          rollbackPlan: "Drop the isolated worktree branch if merge is rejected.",
          remainingRisks: ["Base workspace stays unchanged until external merge completes."],
          gateStatus: null,
        },
      },
      closeRunLog: { content: "" },
      closeWakeEvidence: { matched: false, path: null },
      techLeadSessions: [{ taskKey: "issue-1", sessionDisplayId: "lead-session-2" }],
      reviewerSessions: [{ taskKey: "issue-1", sessionDisplayId: "review-session-1" }],
    });

    expect(evaluation.failures).toEqual([]);
    expect(evaluation.checks.closeFollowupWakeCaptured).toBe(true);
  });

  it("reports missing merge candidate provenance and stale-session hints as failures", () => {
    const evaluation = evaluateMergeDeployFollowupScenario({
      issueId: "issue-1",
      deliverySnapshot: {
        issue: { id: "issue-1" },
        protocolState: { techLeadAgentId: "lead-1" },
        protocolMessages: [
          makeMessage("APPROVE_IMPLEMENTATION", {
            id: "approve-1",
            createdAt: "2026-03-19T08:54:40.000Z",
            payload: { approvalSummary: "Approved." },
          }),
          makeMessage("CLOSE_TASK", {
            id: "close-1",
            createdAt: "2026-03-19T08:54:46.000Z",
            sender: { actorType: "agent", actorId: "lead-1", role: "tech_lead" },
            payload: {
              closureSummary: "Closed.",
              verificationSummary: "Tests passed.",
              rollbackPlan: "Revert.",
            },
          }),
        ],
        runs: [
          {
            runId: "run-review-1",
            agentId: "reviewer-1",
            createdAt: "2026-03-19T08:54:39.000Z",
            resultJson: {
              protocolProgress: {
                protocolMessageType: "APPROVE_IMPLEMENTATION",
                satisfied: false,
              },
            },
          },
        ],
      },
      changeSurface: {
        changedFiles: ["src/release-label.js"],
        mergeCandidate: {
          state: "merged",
          closeMessageId: "other-close",
          sourceBranch: null,
          headSha: null,
          workspacePath: null,
          diffStat: null,
          changedFiles: [],
          closeSummary: "Different close summary",
          verificationSummary: "Different verification summary",
          approvalSummary: "Different approval summary",
          rollbackPlan: "Different rollback plan",
          remainingRisks: [],
          gateStatus: null,
        },
      },
      closeRunLog: {
        content: "adapter output only",
      },
      techLeadSessions: [
        { taskKey: "issue-1", sessionDisplayId: "same-session" },
      ],
      reviewerSessions: [
        { taskKey: "issue-1", sessionDisplayId: "same-session" },
      ],
    });

    expect(evaluation.failures).toEqual(
      expect.arrayContaining([
        "mergeCandidatePendingState",
        "mergeCandidateAnchoredToClose",
        "mergeCandidateProvenancePreserved",
        "mergeCandidateSummariesRetained",
        "deploySurfaceSignalsPresent",
        "closeRunObserved",
        "closeFollowupWakeCaptured",
        "reviewerSessionNotReused",
      ]),
    );
  });
});
