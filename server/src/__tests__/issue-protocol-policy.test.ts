import { describe, expect, it } from "vitest";
import { evaluateProtocolEvidenceRequirement } from "../services/issue-protocol-policy.js";

describe("evaluateProtocolEvidenceRequirement", () => {
  it("rejects review submission without required evidence artifacts", () => {
    const violation = evaluateProtocolEvidenceRequirement({
      message: {
        messageType: "SUBMIT_FOR_REVIEW",
        sender: {
          actorType: "agent",
          actorId: "eng-1",
          role: "engineer",
        },
        recipients: [
          {
            recipientType: "agent",
            recipientId: "rev-1",
            role: "reviewer",
          },
        ],
        workflowStateBefore: "implementing",
        workflowStateAfter: "submitted_for_review",
        summary: "submit",
        payload: {
          implementationSummary: "done",
          evidence: ["tests passed"],
          reviewChecklist: ["review"],
          changedFiles: ["src/app.ts"],
          testResults: [],
          residualRisks: ["none"],
          diffSummary: "Updated retry flow",
        },
        artifacts: [],
      },
    });

    expect(violation).toMatchObject({
      violationCode: "missing_required_artifact",
    });
  });

  it("rejects approval when the latest review submission is missing evidence artifacts", () => {
    const violation = evaluateProtocolEvidenceRequirement({
      message: {
        messageType: "APPROVE_IMPLEMENTATION",
        sender: {
          actorType: "agent",
          actorId: "rev-1",
          role: "reviewer",
        },
        recipients: [
          {
            recipientType: "agent",
            recipientId: "lead-1",
            role: "tech_lead",
          },
        ],
        workflowStateBefore: "under_review",
        workflowStateAfter: "approved",
        summary: "approved",
        payload: {
          approvalSummary: "looks good",
          approvalMode: "agent_review",
          approvalChecklist: ["Acceptance criteria covered"],
          verifiedEvidence: ["Reviewed test run"],
          residualRisks: ["No known residual risk."],
        },
        artifacts: [],
      },
      latestReviewArtifacts: [{ kind: "file" }],
      latestReviewPayload: {
        implementationSummary: "done",
        evidence: ["tests passed"],
        reviewChecklist: ["review"],
        changedFiles: ["src/app.ts"],
        testResults: ["pnpm test:run"],
        residualRisks: ["No known residual risk."],
        diffSummary: "Updated retry flow",
      },
    });

    expect(violation).toMatchObject({
      violationCode: "missing_required_artifact",
    });
  });

  it("accepts approval for legacy review submissions that satisfy the pre-contract evidence bar", () => {
    const violation = evaluateProtocolEvidenceRequirement({
      message: {
        messageType: "APPROVE_IMPLEMENTATION",
        sender: {
          actorType: "agent",
          actorId: "rev-1",
          role: "reviewer",
        },
        recipients: [
          {
            recipientType: "agent",
            recipientId: "lead-1",
            role: "tech_lead",
          },
        ],
        workflowStateBefore: "under_review",
        workflowStateAfter: "approved",
        summary: "approved",
        payload: {
          approvalSummary: "legacy evidence is sufficient",
          approvalMode: "agent_review",
          approvalChecklist: ["Legacy review evidence checked"],
          verifiedEvidence: ["Reviewed diff artifact"],
          residualRisks: ["No known residual risk."],
        },
        artifacts: [],
      },
      latestReviewArtifacts: [{ kind: "diff" }],
      latestReviewPayload: {
        implementationSummary: "done",
        evidence: ["tests passed"],
        reviewChecklist: ["review"],
        changedFiles: ["src/app.ts"],
      },
    });

    expect(violation).toBeNull();
  });

  it("rejects close without verification artifacts when merge status is merged", () => {
    const violation = evaluateProtocolEvidenceRequirement({
      message: {
        messageType: "CLOSE_TASK",
        sender: {
          actorType: "agent",
          actorId: "lead-1",
          role: "tech_lead",
        },
        recipients: [
          {
            recipientType: "role_group",
            recipientId: "human_board",
            role: "human_board",
          },
        ],
        workflowStateBefore: "approved",
        workflowStateAfter: "done",
        summary: "close",
        payload: {
          closeReason: "completed",
          closureSummary: "Closed after merge and verification handoff.",
          verificationSummary: "Verification evidence reviewed.",
          rollbackPlan: "Revert the merge commit if regressions surface.",
          finalArtifacts: ["pr://123"],
          finalTestStatus: "passed",
          mergeStatus: "merged",
        },
        artifacts: [],
      },
    });

    expect(violation).toMatchObject({
      violationCode: "close_without_verification",
    });
  });

  it("accepts a fully evidenced review submission", () => {
    const violation = evaluateProtocolEvidenceRequirement({
      message: {
        messageType: "SUBMIT_FOR_REVIEW",
        sender: {
          actorType: "agent",
          actorId: "eng-1",
          role: "engineer",
        },
        recipients: [
          {
            recipientType: "agent",
            recipientId: "rev-1",
            role: "reviewer",
          },
        ],
        workflowStateBefore: "implementing",
        workflowStateAfter: "submitted_for_review",
        summary: "submit",
        payload: {
          implementationSummary: "done",
          evidence: ["tests passed"],
          reviewChecklist: ["review"],
          changedFiles: ["src/app.ts"],
          testResults: ["pnpm test:run"],
          residualRisks: ["No known residual risk."],
          diffSummary: "Updated retry flow",
        },
        artifacts: [
          {
            kind: "diff",
            uri: "diff://123",
          },
        ],
      },
    });

    expect(violation).toBeNull();
  });

  it("rejects auto-captured test_run artifacts that are not corroborated", () => {
    const violation = evaluateProtocolEvidenceRequirement({
      message: {
        messageType: "SUBMIT_FOR_REVIEW",
        sender: {
          actorType: "agent",
          actorId: "eng-1",
          role: "engineer",
        },
        recipients: [
          {
            recipientType: "agent",
            recipientId: "rev-1",
            role: "reviewer",
          },
        ],
        workflowStateBefore: "implementing",
        workflowStateAfter: "submitted_for_review",
        summary: "submit",
        payload: {
          implementationSummary: "done",
          evidence: ["pnpm test:run"],
          reviewChecklist: ["review"],
          changedFiles: ["src/app.ts"],
          testResults: ["pnpm test:run"],
          residualRisks: ["No known residual risk."],
          diffSummary: "Updated retry flow",
        },
        artifacts: [
          {
            kind: "test_run",
            uri: "run://run-1/test",
            metadata: {
              autoCaptured: true,
            },
          },
        ],
      },
    });

    expect(violation).toMatchObject({
      violationCode: "missing_required_artifact",
    });
    expect(violation?.message).toContain("diff or commit artifact");
  });

  it("rejects strict review submissions that only provide corroborated test_run artifacts", () => {
    const violation = evaluateProtocolEvidenceRequirement({
      message: {
        messageType: "SUBMIT_FOR_REVIEW",
        sender: {
          actorType: "agent",
          actorId: "eng-1",
          role: "engineer",
        },
        recipients: [
          {
            recipientType: "agent",
            recipientId: "rev-1",
            role: "reviewer",
          },
        ],
        workflowStateBefore: "implementing",
        workflowStateAfter: "submitted_for_review",
        summary: "submit",
        payload: {
          implementationSummary: "done",
          evidence: ["pnpm test:run"],
          reviewChecklist: ["review"],
          changedFiles: ["src/app.ts"],
          testResults: ["pnpm test:run"],
          residualRisks: ["No known residual risk."],
          diffSummary: "Updated retry flow",
        },
        artifacts: [
          {
            kind: "test_run",
            uri: "run://run-1/test",
            metadata: {
              autoCaptured: true,
              captureConfidence: "corroborated",
            },
          },
        ],
      },
    });

    expect(violation).toMatchObject({
      violationCode: "missing_required_artifact",
    });
    expect(violation?.message).toContain("diff or commit artifact");
  });

  it("rejects request changes without review summary and required evidence", () => {
    const violation = evaluateProtocolEvidenceRequirement({
      message: {
        messageType: "REQUEST_CHANGES",
        sender: {
          actorType: "agent",
          actorId: "rev-1",
          role: "reviewer",
        },
        recipients: [
          {
            recipientType: "agent",
            recipientId: "eng-1",
            role: "engineer",
          },
        ],
        workflowStateBefore: "under_review",
        workflowStateAfter: "changes_requested",
        summary: "needs fixes",
        payload: {
          reviewSummary: "",
          changeRequests: [
            {
              title: "Fix retry path",
              reason: "Backoff edge case is unverified",
            },
          ],
          severity: "major",
          mustFixBeforeApprove: true,
          requiredEvidence: [],
        },
        artifacts: [],
      },
    });

    expect(violation).toMatchObject({
      violationCode: "missing_required_artifact",
    });
    expect(violation?.message).toContain("reviewSummary");
  });

  it("rejects request changes when a change request has neither affected files nor suggested action", () => {
    const violation = evaluateProtocolEvidenceRequirement({
      message: {
        messageType: "REQUEST_CHANGES",
        sender: {
          actorType: "agent",
          actorId: "rev-1",
          role: "reviewer",
        },
        recipients: [
          {
            recipientType: "agent",
            recipientId: "eng-1",
            role: "engineer",
          },
        ],
        workflowStateBefore: "under_review",
        workflowStateAfter: "changes_requested",
        summary: "needs fixes",
        payload: {
          reviewSummary: "Retry path evidence is incomplete.",
          changeRequests: [
            {
              title: "Fix retry path",
              reason: "Backoff edge case is unverified",
            },
          ],
          severity: "major",
          mustFixBeforeApprove: true,
          requiredEvidence: ["Need retry regression output"],
        },
        artifacts: [],
      },
    });

    expect(violation).toMatchObject({
      violationCode: "missing_required_artifact",
    });
    expect(violation?.message).toContain("affectedFiles or suggestedAction");
  });

  it("rejects approval without approval checklist and verified evidence", () => {
    const violation = evaluateProtocolEvidenceRequirement({
      message: {
        messageType: "APPROVE_IMPLEMENTATION",
        sender: {
          actorType: "agent",
          actorId: "rev-1",
          role: "reviewer",
        },
        recipients: [
          {
            recipientType: "agent",
            recipientId: "lead-1",
            role: "tech_lead",
          },
        ],
        workflowStateBefore: "under_review",
        workflowStateAfter: "approved",
        summary: "approved",
        payload: {
          approvalSummary: "looks good",
          approvalMode: "agent_review",
          approvalChecklist: [],
          verifiedEvidence: [],
          residualRisks: [],
        },
        artifacts: [],
      },
      latestReviewArtifacts: [{ kind: "diff" }],
      latestReviewPayload: {
        implementationSummary: "done",
        evidence: ["tests passed"],
        reviewChecklist: ["review"],
        changedFiles: ["src/app.ts"],
        testResults: ["pnpm test:run"],
        residualRisks: ["No known residual risk."],
        diffSummary: "Updated retry flow",
      },
    });

    expect(violation).toMatchObject({
      violationCode: "missing_required_artifact",
    });
    expect(violation?.message).toContain("approvalChecklist");
  });

  it("rejects close task without closure summary, verification summary, and rollback plan", () => {
    const violation = evaluateProtocolEvidenceRequirement({
      message: {
        messageType: "CLOSE_TASK",
        sender: {
          actorType: "agent",
          actorId: "lead-1",
          role: "tech_lead",
        },
        recipients: [
          {
            recipientType: "role_group",
            recipientId: "human_board",
            role: "human_board",
          },
        ],
        workflowStateBefore: "approved",
        workflowStateAfter: "done",
        summary: "close",
        payload: {
          closeReason: "completed",
          closureSummary: "",
          verificationSummary: "",
          rollbackPlan: "",
          finalArtifacts: ["pr://123"],
          finalTestStatus: "passed",
          mergeStatus: "not_merged",
        },
        artifacts: [],
      },
    });

    expect(violation).toMatchObject({
      violationCode: "close_without_verification",
    });
    expect(violation?.message).toContain("closureSummary");
  });

  it("rejects merged close when only auto-captured workspace docs are attached", () => {
    const violation = evaluateProtocolEvidenceRequirement({
      message: {
        messageType: "CLOSE_TASK",
        sender: {
          actorType: "agent",
          actorId: "lead-1",
          role: "tech_lead",
        },
        recipients: [
          {
            recipientType: "role_group",
            recipientId: "human_board",
            role: "human_board",
          },
        ],
        workflowStateBefore: "approved",
        workflowStateAfter: "done",
        summary: "close",
        payload: {
          closeReason: "completed",
          closureSummary: "Closed after merge.",
          verificationSummary: "Reviewed protocol output.",
          rollbackPlan: "Revert merge commit if needed.",
          finalArtifacts: ["pr://123"],
          finalTestStatus: "passed",
          mergeStatus: "merged",
        },
        artifacts: [
          {
            kind: "doc",
            uri: "workspace://workspace-1/binding",
            metadata: {
              autoCaptured: true,
              bindingStatus: "resolved",
            },
          },
        ],
      },
    });

    expect(violation).toMatchObject({
      violationCode: "close_without_verification",
    });
    expect(violation?.message).toContain("repo evidence, approval, and corroborated verification artifacts");
  });

  it("rejects merged close when approval is missing even if diff and test evidence exist", () => {
    const violation = evaluateProtocolEvidenceRequirement({
      message: {
        messageType: "CLOSE_TASK",
        sender: {
          actorType: "agent",
          actorId: "lead-1",
          role: "tech_lead",
        },
        recipients: [
          {
            recipientType: "role_group",
            recipientId: "human_board",
            role: "human_board",
          },
        ],
        workflowStateBefore: "approved",
        workflowStateAfter: "done",
        summary: "close",
        payload: {
          closeReason: "completed",
          closureSummary: "Closed after merge.",
          verificationSummary: "Reviewed protocol output.",
          rollbackPlan: "Revert merge commit if needed.",
          finalArtifacts: ["pr://123"],
          finalTestStatus: "passed",
          mergeStatus: "merged",
        },
        artifacts: [
          { kind: "diff", uri: "run://run-1/workspace-diff" },
          {
            kind: "test_run",
            uri: "run://run-1/test",
            metadata: {
              autoCaptured: true,
              captureConfidence: "structured",
            },
          },
        ],
      },
    });

    expect(violation).toMatchObject({
      violationCode: "close_without_verification",
    });
    expect(violation?.message).toContain("repo evidence, approval, and corroborated verification artifacts");
  });

  it("accepts merged close when repo, approval, and verification artifacts are all present", () => {
    const violation = evaluateProtocolEvidenceRequirement({
      message: {
        messageType: "CLOSE_TASK",
        sender: {
          actorType: "agent",
          actorId: "lead-1",
          role: "tech_lead",
        },
        recipients: [
          {
            recipientType: "role_group",
            recipientId: "human_board",
            role: "human_board",
          },
        ],
        workflowStateBefore: "approved",
        workflowStateAfter: "done",
        summary: "close",
        payload: {
          closeReason: "completed",
          closureSummary: "Closed after merge.",
          verificationSummary: "Reviewed protocol output.",
          rollbackPlan: "Revert merge commit if needed.",
          finalArtifacts: ["pr://123"],
          finalTestStatus: "passed",
          mergeStatus: "merged",
        },
        artifacts: [
          { kind: "diff", uri: "run://run-1/workspace-diff" },
          { kind: "approval", uri: "approval://issue-1/run-2" },
          {
            kind: "test_run",
            uri: "run://run-1/test",
            metadata: {
              autoCaptured: true,
              captureConfidence: "structured",
            },
          },
        ],
      },
    });

    expect(violation).toBeNull();
  });

  it("rejects review submission without test results, diff summary, and residual risks", () => {
    const violation = evaluateProtocolEvidenceRequirement({
      message: {
        messageType: "SUBMIT_FOR_REVIEW",
        sender: {
          actorType: "agent",
          actorId: "eng-1",
          role: "engineer",
        },
        recipients: [
          {
            recipientType: "agent",
            recipientId: "rev-1",
            role: "reviewer",
          },
        ],
        workflowStateBefore: "implementing",
        workflowStateAfter: "submitted_for_review",
        summary: "submit",
        payload: {
          implementationSummary: "done",
          evidence: ["tests passed"],
          reviewChecklist: ["review"],
          changedFiles: ["src/app.ts"],
          testResults: [],
          residualRisks: [],
          diffSummary: "",
        },
        artifacts: [
          {
            kind: "diff",
            uri: "diff://123",
          },
        ],
      },
    });

    expect(violation).toMatchObject({
      violationCode: "missing_required_artifact",
    });
    expect(violation?.message).toContain("testResults");
  });

  it("rejects review submission without implementation summary and evidence", () => {
    const violation = evaluateProtocolEvidenceRequirement({
      message: {
        messageType: "SUBMIT_FOR_REVIEW",
        sender: {
          actorType: "agent",
          actorId: "eng-1",
          role: "engineer",
        },
        recipients: [
          {
            recipientType: "agent",
            recipientId: "rev-1",
            role: "reviewer",
          },
        ],
        workflowStateBefore: "implementing",
        workflowStateAfter: "submitted_for_review",
        summary: "submit",
        payload: {
          implementationSummary: "   ",
          evidence: [],
          reviewChecklist: ["review"],
          changedFiles: ["src/app.ts"],
          testResults: ["pnpm test:run"],
          residualRisks: ["No known residual risk."],
          diffSummary: "Updated retry flow",
        },
        artifacts: [
          {
            kind: "diff",
            uri: "diff://123",
          },
        ],
      },
    });

    expect(violation).toMatchObject({
      violationCode: "missing_required_artifact",
    });
    expect(violation?.message).toContain("implementationSummary");
  });
});
