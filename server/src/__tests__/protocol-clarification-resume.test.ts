import { describe, expect, it } from "vitest";
import { resolveClarificationResumeWorkflowState } from "@squadrail/shared";

describe("resolveClarificationResumeWorkflowState", () => {
  it("resumes from blocked to the blockedPhase", () => {
    expect(
      resolveClarificationResumeWorkflowState({
        currentWorkflowState: "blocked",
        blockedPhase: "implementing",
      }),
    ).toBe("implementing");

    expect(
      resolveClarificationResumeWorkflowState({
        currentWorkflowState: "blocked",
        blockedPhase: "planning",
      }),
    ).toBe("planning");

    expect(
      resolveClarificationResumeWorkflowState({
        currentWorkflowState: "blocked",
        blockedPhase: "assignment",
      }),
    ).toBe("assigned");

    expect(
      resolveClarificationResumeWorkflowState({
        currentWorkflowState: "blocked",
        blockedPhase: "review",
      }),
    ).toBe("under_review");

    expect(
      resolveClarificationResumeWorkflowState({
        currentWorkflowState: "blocked",
        blockedPhase: "review",
        askedByRole: "qa",
      }),
    ).toBe("under_qa_review");

    expect(
      resolveClarificationResumeWorkflowState({
        currentWorkflowState: "blocked",
        blockedPhase: "closing",
      }),
    ).toBe("approved");

    // Default: no blockedPhase falls back to implementing.
    expect(
      resolveClarificationResumeWorkflowState({
        currentWorkflowState: "blocked",
        blockedPhase: null,
      }),
    ).toBe("implementing");
  });

  it("resumes from awaiting_human_decision to under_review (or under_qa_review for QA)", () => {
    expect(
      resolveClarificationResumeWorkflowState({
        currentWorkflowState: "awaiting_human_decision",
      }),
    ).toBe("under_review");

    expect(
      resolveClarificationResumeWorkflowState({
        currentWorkflowState: "awaiting_human_decision",
        askedByRole: "qa",
      }),
    ).toBe("under_qa_review");

    expect(
      resolveClarificationResumeWorkflowState({
        currentWorkflowState: "awaiting_human_decision",
        askedByRole: "reviewer",
      }),
    ).toBe("under_review");
  });

  it("returns the state unchanged for other states", () => {
    expect(
      resolveClarificationResumeWorkflowState({
        currentWorkflowState: "implementing",
      }),
    ).toBe("implementing");

    expect(
      resolveClarificationResumeWorkflowState({
        currentWorkflowState: "planning",
      }),
    ).toBe("planning");

    expect(
      resolveClarificationResumeWorkflowState({
        currentWorkflowState: "under_review",
      }),
    ).toBe("under_review");

    expect(
      resolveClarificationResumeWorkflowState({
        currentWorkflowState: "assigned",
      }),
    ).toBe("assigned");

    expect(
      resolveClarificationResumeWorkflowState({
        currentWorkflowState: "done",
      }),
    ).toBe("done");
  });

  it("uses explicitResumeWorkflowState when provided regardless of current state", () => {
    expect(
      resolveClarificationResumeWorkflowState({
        currentWorkflowState: "blocked",
        blockedPhase: "implementing",
        explicitResumeWorkflowState: "planning",
      }),
    ).toBe("planning");

    expect(
      resolveClarificationResumeWorkflowState({
        currentWorkflowState: "awaiting_human_decision",
        explicitResumeWorkflowState: "implementing",
      }),
    ).toBe("implementing");
  });
});
