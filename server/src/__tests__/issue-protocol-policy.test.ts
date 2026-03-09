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
});
