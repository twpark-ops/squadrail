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
        evidenceCitations: [
          {
            retrievalRunId: "00000000-0000-0000-0000-000000000111",
            briefId: "00000000-0000-0000-0000-000000000222",
            citedHitRanks: [1],
            citedPaths: ["src/app.ts"],
            citedSourceTypes: ["code"],
            citedSummaryKinds: ["file"],
            citationReason: "Implementation followed the top retrieved code path.",
          },
        ],
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

  it("rejects evidence citations that do not cite a hit, path, source type, or summary kind", () => {
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
        evidenceCitations: [
          {
            retrievalRunId: "00000000-0000-0000-0000-000000000111",
            citationReason: "This should fail because nothing concrete was cited.",
          },
        ],
      },
      artifacts: [],
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects REQUEST_CHANGES payloads missing reviewSummary and requiredEvidence", () => {
    const parsed = createIssueProtocolMessageSchema.safeParse({
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
      summary: "request changes",
      payload: {
        changeRequests: [
          {
            title: "Fix retry path",
            reason: "Backoff edge case is unverified",
          },
        ],
        severity: "major",
        mustFixBeforeApprove: true,
      },
      artifacts: [],
    });

    expect(parsed.success).toBe(false);
  });

  it("accepts structured approval and close payloads", () => {
    const approveParsed = createIssueProtocolMessageSchema.safeParse({
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
      summary: "approve implementation",
      payload: {
        approvalSummary: "All review requirements are satisfied.",
        approvalMode: "agent_review",
        approvalChecklist: ["Acceptance criteria covered"],
        verifiedEvidence: ["Reviewed test run", "Reviewed diff"],
        residualRisks: ["No known residual risk."],
        followUpActions: ["Monitor rollout metrics"],
        evidenceCitations: [
          {
            retrievalRunId: "00000000-0000-0000-0000-000000000333",
            citedHitRanks: [1, 2],
            citedPaths: ["src/app.ts", "src/app.test.ts"],
            citedSourceTypes: ["code", "test_report"],
            citationReason: "Review approval relied on retrieved code and test evidence.",
          },
        ],
      },
      artifacts: [],
    });

    const closeParsed = createIssueProtocolMessageSchema.safeParse({
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
      summary: "close task",
      payload: {
        closeReason: "completed",
        closureSummary: "Release is complete and follow-up is clear.",
        verificationSummary: "Merged artifacts and verification evidence were reviewed.",
        rollbackPlan: "Revert the merge commit if production issues appear.",
        finalArtifacts: ["release note", "monitoring link"],
        finalTestStatus: "passed",
        mergeStatus: "merged",
        remainingRisks: ["No unresolved delivery blocker remains."],
        evidenceCitations: [
          {
            retrievalRunId: "00000000-0000-0000-0000-000000000444",
            citedPaths: ["docs/release/checklist.md"],
            citedSourceTypes: ["protocol_message"],
            citedSummaryKinds: ["file"],
            citationReason: "Closure used the retrieved release checklist evidence.",
          },
        ],
      },
      artifacts: [
        {
          kind: "commit",
          uri: "commit://abc123",
        },
      ],
    });

    expect(approveParsed.success).toBe(true);
    expect(closeParsed.success).toBe(true);
  });
});
