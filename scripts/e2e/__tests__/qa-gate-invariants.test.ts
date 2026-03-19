import { describe, expect, it } from "vitest";
import {
  assertQaGateInvariant,
  evaluateQaGateInvariant,
} from "../qa-gate-invariants.mjs";

function makeMessage(type, seq, overrides = {}) {
  return {
    id: `${type}-${seq}`,
    seq,
    messageType: type,
    sender: {
      actorId: "unknown",
      role: "reviewer",
    },
    recipients: [],
    payload: {},
    ...overrides,
  };
}

describe("qa gate invariants", () => {
  it("passes a reviewer to qa gate approval path", () => {
    const evaluation = assertQaGateInvariant({
      expectedReviewerId: "rev-1",
      expectedQaAgentId: "qa-1",
      finalState: {
        workflowState: "done",
      },
      messages: [
        makeMessage("APPROVE_IMPLEMENTATION", 10, {
          sender: { actorId: "rev-1", role: "reviewer" },
          workflowStateBefore: "under_review",
          workflowStateAfter: "qa_pending",
        }),
        makeMessage("START_REVIEW", 11, {
          sender: { actorId: "qa-1", role: "qa" },
          workflowStateBefore: "qa_pending",
          workflowStateAfter: "under_qa_review",
        }),
        makeMessage("APPROVE_IMPLEMENTATION", 12, {
          sender: { actorId: "qa-1", role: "qa" },
          workflowStateBefore: "under_qa_review",
          workflowStateAfter: "approved",
          payload: {
            verifiedEvidence: ["diff reviewed"],
            executionLog: "go test ./internal/observability -count=1 passed",
            sanityCommand: "go test ./internal/observability -count=1",
          },
        }),
        makeMessage("CLOSE_TASK", 13, {
          sender: { actorId: "lead-1", role: "tech_lead" },
        }),
      ],
    });

    expect(evaluation.failures).toEqual([]);
    expect(evaluation.checks.noCloseBeforeQaDecision).toBe(true);
    expect(evaluation.checks.qaApprovalHasExecutionEvidence).toBe(true);
  });

  it("fails when close happens before a QA decision", () => {
    const evaluation = evaluateQaGateInvariant({
      expectedReviewerId: "rev-1",
      expectedQaAgentId: "qa-1",
      finalState: {
        workflowState: "done",
      },
      messages: [
        makeMessage("APPROVE_IMPLEMENTATION", 10, {
          sender: { actorId: "rev-1", role: "reviewer" },
          workflowStateBefore: "under_review",
          workflowStateAfter: "qa_pending",
        }),
        makeMessage("CLOSE_TASK", 11, {
          sender: { actorId: "lead-1", role: "tech_lead" },
        }),
      ],
    });

    expect(evaluation.failures).toEqual(
      expect.arrayContaining([
        "qaStartRecorded",
        "qaDecisionRecorded",
        "noCloseBeforeQaDecision",
        "finalCloseAfterQaDecision",
      ])
    );
  });

  it("fails QA approval when execution evidence is missing", () => {
    const evaluation = evaluateQaGateInvariant({
      expectedReviewerId: "rev-1",
      expectedQaAgentId: "qa-1",
      finalState: {
        workflowState: "approved",
      },
      requireClose: false,
      messages: [
        makeMessage("APPROVE_IMPLEMENTATION", 4, {
          sender: { actorId: "rev-1", role: "reviewer" },
          workflowStateBefore: "under_review",
          workflowStateAfter: "qa_pending",
        }),
        makeMessage("START_REVIEW", 5, {
          sender: { actorId: "qa-1", role: "qa" },
          workflowStateBefore: "qa_pending",
          workflowStateAfter: "under_qa_review",
        }),
        makeMessage("APPROVE_IMPLEMENTATION", 6, {
          sender: { actorId: "qa-1", role: "qa" },
          workflowStateBefore: "under_qa_review",
          workflowStateAfter: "approved",
          payload: {
            verifiedEvidence: ["diff reviewed"],
          },
        }),
      ],
    });

    expect(evaluation.failures).toContain("qaApprovalHasExecutionEvidence");
  });

  it("fails QA request-changes when failure evidence is missing", () => {
    const evaluation = evaluateQaGateInvariant({
      expectedReviewerId: "rev-1",
      expectedQaAgentId: "qa-1",
      finalState: {
        workflowState: "changes_requested",
      },
      requireClose: false,
      messages: [
        makeMessage("APPROVE_IMPLEMENTATION", 7, {
          sender: { actorId: "rev-1", role: "reviewer" },
          workflowStateBefore: "under_review",
          workflowStateAfter: "qa_pending",
        }),
        makeMessage("START_REVIEW", 8, {
          sender: { actorId: "qa-1", role: "qa" },
          workflowStateBefore: "qa_pending",
          workflowStateAfter: "under_qa_review",
        }),
        makeMessage("REQUEST_CHANGES", 9, {
          sender: { actorId: "qa-1", role: "qa" },
          workflowStateBefore: "under_qa_review",
          workflowStateAfter: "changes_requested",
          payload: {
            requiredEvidence: ["fresh execution log"],
          },
        }),
      ],
    });

    expect(evaluation.failures).toContain("qaRequestChangesHasFailureEvidence");
  });

  it("accepts QA request-changes when failure evidence is present", () => {
    const evaluation = assertQaGateInvariant({
      expectedReviewerId: "rev-1",
      expectedQaAgentId: "qa-1",
      finalState: {
        workflowState: "changes_requested",
      },
      requireClose: false,
      messages: [
        makeMessage("APPROVE_IMPLEMENTATION", 7, {
          sender: { actorId: "rev-1", role: "reviewer" },
          workflowStateBefore: "under_review",
          workflowStateAfter: "qa_pending",
        }),
        makeMessage("START_REVIEW", 8, {
          sender: { actorId: "qa-1", role: "qa" },
          workflowStateBefore: "qa_pending",
          workflowStateAfter: "under_qa_review",
        }),
        makeMessage("REQUEST_CHANGES", 9, {
          sender: { actorId: "qa-1", role: "qa" },
          workflowStateBefore: "under_qa_review",
          workflowStateAfter: "changes_requested",
          payload: {
            requiredEvidence: ["fresh execution log"],
            executionLog: "Focused sanity run failed on fallback path",
          },
        }),
      ],
    });

    expect(evaluation.failures).toEqual([]);
    expect(evaluation.checks.qaRequestChangesHasRequiredEvidence).toBe(true);
  });
});
