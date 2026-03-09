import { describe, expect, it } from "vitest";
import {
  buildInternalWorkItemDispatchMetadata,
  getInternalWorkItemKind,
  isInternalWorkItemContext,
  isLeadWatchEnabled,
  isReviewerWatchEnabled,
  leadSupervisorProtocolReason,
  leadSupervisorRunFailureReason,
  reviewerWatchReason,
} from "../services/internal-work-item-supervision.js";

const INTERNAL_CONTEXT = {
  issueId: "issue-1",
  parentId: "root-1",
  hiddenAt: new Date("2026-03-09T00:00:00.000Z"),
  labelNames: ["team:internal", "work:implementation", "watch:reviewer", "watch:lead"],
  techLeadAgentId: "lead-1",
};

describe("internal work item supervision helpers", () => {
  it("recognizes hidden child issues as internal work items", () => {
    expect(isInternalWorkItemContext(INTERNAL_CONTEXT)).toBe(true);
  });

  it("derives the internal work item kind from reserved labels", () => {
    expect(getInternalWorkItemKind(INTERNAL_CONTEXT)).toBe("implementation");
  });

  it("enables reviewer and lead watch flags only for internal child issues", () => {
    expect(isReviewerWatchEnabled(INTERNAL_CONTEXT)).toBe(true);
    expect(isLeadWatchEnabled(INTERNAL_CONTEXT)).toBe(true);
    expect(
      isLeadWatchEnabled({
        ...INTERNAL_CONTEXT,
        hiddenAt: null,
        parentId: null,
        labelNames: ["watch:lead"],
      }),
    ).toBe(false);
  });

  it("builds dispatch metadata for internal work items", () => {
    expect(buildInternalWorkItemDispatchMetadata(INTERNAL_CONTEXT)).toEqual({
      issueInternalWorkItem: true,
      rootIssueId: "root-1",
      internalWorkItemKind: "implementation",
      reviewerWatchEnabled: true,
      leadWatchEnabled: true,
    });
  });

  it("maps reviewer watch wake reasons for assignment and reassignment", () => {
    expect(reviewerWatchReason("ASSIGN_TASK")).toBe("issue_watch_assigned");
    expect(reviewerWatchReason("REASSIGN_TASK")).toBe("issue_watch_reassigned");
  });

  it("maps lead supervisor protocol reasons for tracked child issue events", () => {
    expect(leadSupervisorProtocolReason("SUBMIT_FOR_REVIEW")).toBe("issue_supervisor_review_submitted");
    expect(leadSupervisorProtocolReason("REQUEST_CHANGES")).toBe("issue_supervisor_changes_requested");
    expect(leadSupervisorProtocolReason("ASSIGN_TASK")).toBeNull();
  });

  it("prefers process_lost over generic failed reasons for run failures", () => {
    expect(
      leadSupervisorRunFailureReason({
        status: "failed",
        errorCode: "process_lost",
      }),
    ).toBe("issue_supervisor_run_process_lost");
    expect(
      leadSupervisorRunFailureReason({
        status: "timed_out",
        errorCode: null,
      }),
    ).toBe("issue_supervisor_run_timed_out");
    expect(
      leadSupervisorRunFailureReason({
        status: "failed",
        errorCode: "adapter_failed",
      }),
    ).toBe("issue_supervisor_run_failed");
  });
});
