import { describe, expect, it } from "vitest";
import {
  assertClarificationLoopInvariant,
  evaluateClarificationLoopInvariant,
} from "../clarification-loop-invariants.mjs";

describe("clarification loop invariants", () => {
  it("passes when a human-board clarification is answered, linked, resumed, and followed by retrieval", () => {
    const evaluation = assertClarificationLoopInvariant({
      expectedClarificationMode: "human_board",
      requiresRetrievalAfterResume: true,
      childResults: [
        {
          issueId: "child-1",
          clarificationMode: "human_board",
          askMessageId: "ask-1",
          askMessageSeq: 3,
          answerMessageId: "answer-1",
          answerMessageSeq: 5,
          answerCausalMessageId: "ask-1",
          closeBlockedWhileClarificationPending: true,
          resumedWorkflowState: "implementing",
          retrievalRunIdsAfterClarification: ["run-2"],
        },
      ],
    });

    expect(evaluation.failures).toEqual([]);
    expect(evaluation.checks.answerLinked).toBe(true);
    expect(evaluation.checks.closeBlockedWhilePending).toBe(true);
    expect(evaluation.checks.retrievalAfterResume).toBe(true);
  });

  it("passes clarification-free flows when no ask/answer trail exists", () => {
    const evaluation = assertClarificationLoopInvariant({
      expectedClarificationMode: "none",
      childResults: [
        {
          issueId: "child-1",
          clarificationMode: "none",
          askMessageId: null,
          answerMessageId: null,
        },
      ],
    });

    expect(evaluation.failures).toEqual([]);
    expect(evaluation.checks.clarificationModeMatched).toBe(true);
    expect(evaluation.checks.clarificationRecorded).toBe(true);
  });

  it("reports causal, resume, and retrieval failures when the loop is incomplete", () => {
    const evaluation = evaluateClarificationLoopInvariant({
      expectedClarificationMode: "reviewer",
      requiresRetrievalAfterResume: true,
      childResults: [
        {
          issueId: "child-1",
          clarificationMode: "reviewer",
          askMessageId: "ask-1",
          askMessageSeq: 6,
          answerMessageId: "answer-1",
          answerMessageSeq: 5,
          answerCausalMessageId: "wrong-ask",
          closeBlockedWhileClarificationPending: false,
          resumedWorkflowState: "blocked",
          retrievalRunIdsAfterClarification: [],
        },
      ],
    });

    expect(evaluation.failures).toEqual(
      expect.arrayContaining([
        "answerLinked",
        "closeBlockedWhilePending",
        "resumedToImplementing",
        "retrievalAfterResume",
      ]),
    );
  });
});
