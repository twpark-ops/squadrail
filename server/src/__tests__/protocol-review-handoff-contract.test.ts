import { describe, expect, it } from "vitest";
import { createIssueProtocolMessageSchema } from "@squadrail/shared";

describe("protocol review handoff contract", () => {
  it("rejects SUBMIT_FOR_REVIEW payloads missing required handoff fields", () => {
    const parsed = createIssueProtocolMessageSchema.safeParse({
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
      summary: "submit review package",
      payload: {
        implementationSummary: "done",
        evidence: ["tests passed"],
        reviewChecklist: ["review"],
        changedFiles: ["src/app.ts"],
      },
      artifacts: [
        {
          kind: "diff",
          uri: "diff://123",
        },
      ],
    });

    expect(parsed.success).toBe(false);
  });

  it("accepts fully structured SUBMIT_FOR_REVIEW payloads", () => {
    const parsed = createIssueProtocolMessageSchema.safeParse({
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
      summary: "submit review package",
      payload: {
        implementationSummary: "done",
        evidence: ["tests passed"],
        reviewChecklist: ["review checklist item"],
        changedFiles: ["src/app.ts"],
        testResults: ["pnpm vitest app"],
        residualRisks: ["No known residual risk."],
        diffSummary: "Updated app flow and tests.",
      },
      artifacts: [
        {
          kind: "diff",
          uri: "diff://123",
        },
      ],
    });

    expect(parsed.success).toBe(true);
  });
});
