import { describe, expect, it } from "vitest";
import { computeIssueProgressSnapshot } from "../services/issue-progress-snapshot.js";
import type {
  IssueInternalWorkItemSummary,
  IssueProtocolMessage,
  IssueProtocolState,
  IssueStatus,
} from "@squadrail/shared";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProtocolState(
  overrides: Partial<IssueProtocolState> = {},
): IssueProtocolState {
  return {
    issueId: "issue-1",
    companyId: "company-1",
    workflowState: "implementing",
    coarseIssueStatus: "in_progress",
    techLeadAgentId: "agent-tl",
    primaryEngineerAgentId: "agent-eng",
    reviewerAgentId: "agent-rev",
    qaAgentId: null,
    currentReviewCycle: 0,
    lastProtocolMessageId: null,
    lastTransitionAt: new Date("2026-03-15T10:00:00Z"),
    blockedPhase: null,
    blockedCode: null,
    blockedByMessageId: null,
    metadata: {},
    ...overrides,
  };
}

function makeWorkItemSummary(
  overrides: Partial<IssueInternalWorkItemSummary> = {},
): IssueInternalWorkItemSummary {
  return {
    total: 5,
    backlog: 0,
    todo: 1,
    inProgress: 1,
    inReview: 0,
    blocked: 0,
    done: 3,
    cancelled: 0,
    activeAssigneeAgentIds: [],
    blockerIssueId: null,
    reviewRequestedIssueId: null,
    ...overrides,
  };
}

function makeIssue(status: IssueStatus = "in_progress") {
  return { status };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("issue-progress-snapshot – computeIssueProgressSnapshot", () => {
  it('returns phase "implementing" for workflowState "implementing"', () => {
    const result = computeIssueProgressSnapshot({
      issue: makeIssue("in_progress"),
      protocolState: makeProtocolState({ workflowState: "implementing" }),
      internalWorkItemSummary: null,
      protocolMessages: [],
    });

    expect(result.phase).toBe("implementing");
  });

  it('returns phase "review" for workflowState "under_review"', () => {
    const result = computeIssueProgressSnapshot({
      issue: makeIssue("in_review"),
      protocolState: makeProtocolState({ workflowState: "under_review" }),
      internalWorkItemSummary: null,
      protocolMessages: [],
    });

    expect(result.phase).toBe("review");
  });

  it('returns phase "blocked" for workflowState "blocked"', () => {
    const result = computeIssueProgressSnapshot({
      issue: makeIssue("blocked"),
      protocolState: makeProtocolState({
        workflowState: "blocked",
        blockedPhase: "implementing",
        blockedCode: "external_dependency",
      }),
      internalWorkItemSummary: null,
      protocolMessages: [],
    });

    expect(result.phase).toBe("blocked");
    expect(result.blockedReason).toBe("external_dependency");
  });

  it("returns correct subtaskSummary from internalWorkItemSummary", () => {
    const workItems = makeWorkItemSummary({
      total: 10,
      done: 4,
      cancelled: 1,
      todo: 2,
      inProgress: 1,
      backlog: 1,
      blocked: 1,
      inReview: 0,
    });

    const result = computeIssueProgressSnapshot({
      issue: makeIssue("in_progress"),
      protocolState: makeProtocolState({ workflowState: "implementing" }),
      internalWorkItemSummary: workItems,
      protocolMessages: [],
    });

    expect(result.subtaskSummary).toEqual({
      total: 10,
      done: 5,       // done(4) + cancelled(1)
      open: 4,        // todo(2) + inProgress(1) + backlog(1)
      blocked: 1,
      inReview: 0,
    });
  });

  it("returns headline with subtask progress when available", () => {
    const workItems = makeWorkItemSummary({
      total: 6,
      done: 3,
      cancelled: 0,
      todo: 1,
      inProgress: 1,
      backlog: 0,
      blocked: 1,
      inReview: 0,
    });

    const result = computeIssueProgressSnapshot({
      issue: makeIssue("in_progress"),
      protocolState: makeProtocolState({ workflowState: "implementing" }),
      internalWorkItemSummary: workItems,
      protocolMessages: [],
    });

    expect(result.headline).toContain("Engineer is implementing");
    expect(result.headline).toContain("3/6 subtasks done");
  });

  it("returns activeOwnerRole based on phase", () => {
    // implementing → engineer
    const implResult = computeIssueProgressSnapshot({
      issue: makeIssue("in_progress"),
      protocolState: makeProtocolState({ workflowState: "implementing" }),
      internalWorkItemSummary: null,
      protocolMessages: [],
    });
    expect(implResult.activeOwnerRole).toBe("engineer");
    expect(implResult.activeOwnerAgentId).toBe("agent-eng");

    // review → reviewer
    const reviewResult = computeIssueProgressSnapshot({
      issue: makeIssue("in_review"),
      protocolState: makeProtocolState({ workflowState: "under_review" }),
      internalWorkItemSummary: null,
      protocolMessages: [],
    });
    expect(reviewResult.activeOwnerRole).toBe("reviewer");
    expect(reviewResult.activeOwnerAgentId).toBe("agent-rev");

    // planning → tech_lead
    const planResult = computeIssueProgressSnapshot({
      issue: makeIssue("in_progress"),
      protocolState: makeProtocolState({ workflowState: "planning" }),
      internalWorkItemSummary: null,
      protocolMessages: [],
    });
    expect(planResult.activeOwnerRole).toBe("tech_lead");
    expect(planResult.activeOwnerAgentId).toBe("agent-tl");
  });
});
