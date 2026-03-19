import { describe, expect, it } from "vitest";
import type { IssueProgressSnapshot } from "@squadrail/shared";
import { buildIssueProgressSignals } from "./issue-progress-signals";

function makeSnapshot(
  overrides: Partial<IssueProgressSnapshot> = {},
): IssueProgressSnapshot {
  return {
    phase: "implementing",
    headline: "Implementation is moving",
    activeOwnerRole: "engineer",
    activeOwnerAgentId: "agent-1",
    blockedReason: null,
    pendingClarificationCount: 0,
    subtaskSummary: {
      total: 4,
      done: 1,
      open: 3,
      blocked: 0,
      inReview: 0,
    },
    reviewState: "idle",
    qaState: "not_required",
    latestArtifactKinds: [],
    ...overrides,
  };
}

describe("buildIssueProgressSignals", () => {
  it("surfaces clarification, review, QA, and artifact signals", () => {
    const signals = buildIssueProgressSignals(
      makeSnapshot({
        pendingClarificationCount: 2,
        reviewState: "changes_requested",
        qaState: "pending",
        latestArtifactKinds: ["diff", "test_run"],
      }),
    );

    expect(signals).toEqual([
      { key: "clarifications", label: "2 clarifications pending", tone: "warn" },
      { key: "subtasks", label: "1/4 subtasks", tone: "neutral" },
      { key: "review-state", label: "Changes requested", tone: "warn" },
      { key: "qa-state", label: "QA pending", tone: "info" },
      { key: "artifacts", label: "2 artifacts ready", tone: "neutral" },
    ]);
  });

  it("marks completed subtasks and QA pass as success", () => {
    const signals = buildIssueProgressSignals(
      makeSnapshot({
        subtaskSummary: {
          total: 3,
          done: 3,
          open: 0,
          blocked: 0,
          inReview: 0,
        },
        reviewState: "approved",
        qaState: "passed",
      }),
    );

    expect(signals).toContainEqual({
      key: "subtasks",
      label: "3/3 subtasks",
      tone: "success",
    });
    expect(signals).toContainEqual({
      key: "review-state",
      label: "Review approved",
      tone: "success",
    });
    expect(signals).toContainEqual({
      key: "qa-state",
      label: "QA passed",
      tone: "success",
    });
  });

  it("shows blocked subtasks as a blocking signal", () => {
    const signals = buildIssueProgressSignals(
      makeSnapshot({
        subtaskSummary: {
          total: 5,
          done: 2,
          open: 1,
          blocked: 2,
          inReview: 0,
        },
      }),
    );

    expect(signals).toContainEqual({
      key: "blocked-subtasks",
      label: "2 blocked subtasks",
      tone: "blocked",
    });
  });
});
