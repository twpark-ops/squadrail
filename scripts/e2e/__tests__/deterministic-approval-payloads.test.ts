import { describe, expect, it } from "vitest";
import {
  createDeterministicQaApprovalMessage,
  createDeterministicReviewerApprovalMessage,
} from "../deterministic-approval-payloads.mjs";

describe("deterministic approval payloads", () => {
  it("builds reviewer approval messages with approvalMode and optional QA handoff", () => {
    const message = createDeterministicReviewerApprovalMessage({
      issueId: "issue-1",
      reviewerId: "reviewer-1",
      qaAgentId: "qa-1",
      workflowStateBefore: "under_review",
    });

    expect(message.workflowStateAfter).toBe("qa_pending");
    expect(message.payload).toMatchObject({
      approvalMode: "agent_review",
      approvalSummary: expect.stringContaining("focused evidence"),
    });
    expect(message.recipients).toEqual([
      { recipientType: "agent", recipientId: "reviewer-1", role: "reviewer" },
      { recipientType: "agent", recipientId: "qa-1", role: "qa" },
    ]);
  });

  it("builds reviewer approval messages without QA handoff when qaAgentId is absent", () => {
    const message = createDeterministicReviewerApprovalMessage({
      issueId: "issue-1",
      reviewerId: "reviewer-1",
      qaAgentId: null,
      workflowStateBefore: "under_review",
    });

    expect(message.workflowStateAfter).toBe("approved");
    expect(message.payload.residualRisks).toEqual([
      "Merge remains external to this deterministic E2E harness.",
    ]);
  });

  it("builds QA approval messages with execution evidence fields", () => {
    const message = createDeterministicQaApprovalMessage({
      issueId: "issue-1",
      qaId: "qa-1",
      techLeadAgentId: "lead-1",
      workflowStateBefore: "under_qa_review",
    });

    expect(message.workflowStateAfter).toBe("approved");
    expect(message.payload).toMatchObject({
      approvalMode: "agent_review",
      executionLog: "Focused execution evidence passed for the QA gate scenario.",
      outputVerified: "Observed focused validation evidence in the latest review submission.",
      sanityCommand: "go test ./internal/observability -count=1",
    });
    expect(message.recipients).toEqual([
      { recipientType: "agent", recipientId: "qa-1", role: "qa" },
      { recipientType: "agent", recipientId: "lead-1", role: "tech_lead" },
    ]);
  });
});
