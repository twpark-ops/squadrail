import { describe, expect, it } from "vitest";
import {
  buildInternalWorkItemDispatchMetadata,
  getInternalWorkItemKind,
  isInternalWorkItemContext,
  isLeadWatchEnabled,
  isReviewerWatchEnabled,
  leadSupervisorProtocolReason,
  leadSupervisorRunFailureReason,
  loadInternalWorkItemSupervisorContext,
  reviewerWatchReason,
} from "../services/internal-work-item-supervision.js";
import { issueLabels, issues } from "@squadrail/db";

const INTERNAL_CONTEXT = {
  issueId: "issue-1",
  parentId: "root-1",
  labelNames: ["team:internal", "work:implementation", "watch:reviewer", "watch:lead"],
  techLeadAgentId: "lead-1",
};

describe("internal work item supervision helpers", () => {
  function createResolvedChain(queueMap: Map<unknown, unknown[][]>) {
    let selectedTable: unknown = null;
    const chain = {
      from: (table: unknown) => {
        selectedTable = table;
        return chain;
      },
      where: () => chain,
      leftJoin: () => chain,
      innerJoin: () => chain,
      orderBy: () => chain,
      limit: () => chain,
      then: <T>(resolve: (value: unknown[]) => T | PromiseLike<T>) =>
        Promise.resolve((queueMap.get(selectedTable)?.shift() ?? [])).then(resolve),
    };
    return chain;
  }

  it("recognizes hidden child issues as internal work items", () => {
    expect(isInternalWorkItemContext(INTERNAL_CONTEXT)).toBe(true);
  });

  it("derives the internal work item kind from reserved labels", () => {
    expect(getInternalWorkItemKind(INTERNAL_CONTEXT)).toBe("implementation");
  });

  it("enables reviewer and lead watch flags based on labels for subtasks", () => {
    expect(isReviewerWatchEnabled(INTERNAL_CONTEXT)).toBe(true);
    expect(isLeadWatchEnabled(INTERNAL_CONTEXT)).toBe(true);
    expect(
      isLeadWatchEnabled({
        ...INTERNAL_CONTEXT,
        parentId: null,
        labelNames: ["watch:lead"],
      }),
    ).toBe(false);
    expect(
      isReviewerWatchEnabled({
        ...INTERNAL_CONTEXT,
        labelNames: ["team:internal", "work:implementation"],
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

  it("loads supervisor context with normalized labels and returns null for missing rows", async () => {
    const queueMap = new Map<unknown, unknown[][]>([
      [issues, [[{
        issueId: "issue-1",
        parentId: "root-1",
        techLeadAgentId: "lead-1",
        reviewerAgentId: "reviewer-1",
        qaAgentId: "qa-1",
        primaryEngineerAgentId: "eng-1",
      }], []]],
      [issueLabels, [[
        { name: "team:internal" },
        { name: "watch:lead" },
        { name: "watch:lead" },
      ]]],
    ]);
    const db = {
      select: () => createResolvedChain(queueMap),
    };

    await expect(loadInternalWorkItemSupervisorContext(db as never, "company-1", "issue-1")).resolves.toEqual({
      issueId: "issue-1",
      parentId: "root-1",
      techLeadAgentId: "lead-1",
      reviewerAgentId: "reviewer-1",
      qaAgentId: "qa-1",
      primaryEngineerAgentId: "eng-1",
      labelNames: ["team:internal", "watch:lead"],
    });
    await expect(loadInternalWorkItemSupervisorContext(db as never, "company-1", "missing")).resolves.toBeNull();
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

  it("returns empty dispatch metadata for non-internal contexts", () => {
    expect(buildInternalWorkItemDispatchMetadata({
      issueId: "issue-2",
      parentId: null,
      labelNames: ["watch:reviewer"],
      techLeadAgentId: null,
    })).toEqual({});
    expect(getInternalWorkItemKind({
      labelNames: ["team:internal"],
    })).toBeNull();
    expect(reviewerWatchReason("ANYTHING_ELSE")).toBe("issue_watch_assigned");
  });

  describe("isInternalWorkItemContext with parentId-based detection", () => {
    it("returns true when parentId is set and NO labels exist", () => {
      expect(isInternalWorkItemContext({
        issueId: "issue-no-labels",
        parentId: "root-1",
        labelNames: [],
        techLeadAgentId: null,
      })).toBe(true);
    });

    it("returns false when parentId is null even with team:internal label", () => {
      expect(isInternalWorkItemContext({
        issueId: "issue-root-with-label",
        parentId: null,
        labelNames: ["team:internal"],
        techLeadAgentId: "lead-1",
      })).toBe(false);
    });

    it("returns true when parentId is set with random unrelated labels", () => {
      expect(isInternalWorkItemContext({
        issueId: "issue-random",
        parentId: "root-2",
        labelNames: ["bug", "frontend", "priority:high"],
        techLeadAgentId: null,
      })).toBe(true);
    });

    it("returns false for null context", () => {
      expect(isInternalWorkItemContext(null)).toBe(false);
    });

    it("returns false for undefined context", () => {
      expect(isInternalWorkItemContext(undefined)).toBe(false);
    });
  });

  describe("watch flags require both parentId and label", () => {
    it("reviewer watch is disabled when parentId is set but watch:reviewer label is missing", () => {
      expect(isReviewerWatchEnabled({
        issueId: "issue-no-watch",
        parentId: "root-1",
        labelNames: ["team:internal", "work:implementation"],
        techLeadAgentId: "lead-1",
      })).toBe(false);
    });

    it("lead watch is disabled when parentId is set but watch:lead label is missing", () => {
      expect(isLeadWatchEnabled({
        issueId: "issue-no-lead-watch",
        parentId: "root-1",
        labelNames: ["team:internal", "watch:reviewer"],
        techLeadAgentId: "lead-1",
      })).toBe(false);
    });

    it("both watches disabled for root issue even with all watch labels present", () => {
      expect(isReviewerWatchEnabled({
        issueId: "root-issue",
        parentId: null,
        labelNames: ["watch:reviewer", "watch:lead"],
        techLeadAgentId: "lead-1",
      })).toBe(false);
      expect(isLeadWatchEnabled({
        issueId: "root-issue",
        parentId: null,
        labelNames: ["watch:reviewer", "watch:lead"],
        techLeadAgentId: "lead-1",
      })).toBe(false);
    });
  });

  describe("getInternalWorkItemKind label extraction", () => {
    it("returns 'plan' for work:plan label", () => {
      expect(getInternalWorkItemKind({ labelNames: ["work:plan", "team:internal"] })).toBe("plan");
    });

    it("returns 'qa' for work:qa label", () => {
      expect(getInternalWorkItemKind({ labelNames: ["work:qa"] })).toBe("qa");
    });

    it("returns 'review' for work:review label", () => {
      expect(getInternalWorkItemKind({ labelNames: ["work:review"] })).toBe("review");
    });

    it("returns null when no work: labels exist", () => {
      expect(getInternalWorkItemKind({ labelNames: ["team:internal", "watch:lead"] })).toBeNull();
    });

    it("returns null for empty labelNames", () => {
      expect(getInternalWorkItemKind({ labelNames: [] })).toBeNull();
    });

    it("returns null for null context", () => {
      expect(getInternalWorkItemKind(null)).toBeNull();
    });
  });

  describe("dispatch metadata completeness", () => {
    it("includes all fields for a fully labeled internal work item", () => {
      expect(buildInternalWorkItemDispatchMetadata({
        issueId: "issue-full",
        parentId: "root-1",
        labelNames: ["team:internal", "work:qa", "watch:reviewer", "watch:lead"],
        techLeadAgentId: "lead-1",
      })).toEqual({
        issueInternalWorkItem: true,
        rootIssueId: "root-1",
        internalWorkItemKind: "qa",
        reviewerWatchEnabled: true,
        leadWatchEnabled: true,
      });
    });

    it("returns partial watches when only some watch labels are present", () => {
      expect(buildInternalWorkItemDispatchMetadata({
        issueId: "issue-partial",
        parentId: "root-1",
        labelNames: ["work:implementation", "watch:reviewer"],
        techLeadAgentId: "lead-1",
      })).toEqual({
        issueInternalWorkItem: true,
        rootIssueId: "root-1",
        internalWorkItemKind: "implementation",
        reviewerWatchEnabled: true,
        leadWatchEnabled: false,
      });
    });

    it("returns internalWorkItemKind null when parentId is set but no work: labels", () => {
      expect(buildInternalWorkItemDispatchMetadata({
        issueId: "issue-no-kind",
        parentId: "root-1",
        labelNames: ["bug"],
        techLeadAgentId: null,
      })).toEqual({
        issueInternalWorkItem: true,
        rootIssueId: "root-1",
        internalWorkItemKind: null,
        reviewerWatchEnabled: false,
        leadWatchEnabled: false,
      });
    });
  });

  describe("leadSupervisorProtocolReason completeness", () => {
    it("maps ACK_ASSIGNMENT", () => {
      expect(leadSupervisorProtocolReason("ACK_ASSIGNMENT")).toBe("issue_supervisor_assignment_acknowledged");
    });

    it("maps ASK_CLARIFICATION", () => {
      expect(leadSupervisorProtocolReason("ASK_CLARIFICATION")).toBe("issue_supervisor_clarification_requested");
    });

    it("maps ESCALATE_BLOCKER", () => {
      expect(leadSupervisorProtocolReason("ESCALATE_BLOCKER")).toBe("issue_supervisor_blocker_escalated");
    });

    it("maps APPROVE_IMPLEMENTATION", () => {
      expect(leadSupervisorProtocolReason("APPROVE_IMPLEMENTATION")).toBe("issue_supervisor_implementation_approved");
    });

    it("maps TIMEOUT_ESCALATION", () => {
      expect(leadSupervisorProtocolReason("TIMEOUT_ESCALATION")).toBe("issue_supervisor_timeout_escalated");
    });

    it("returns null for unknown message types", () => {
      expect(leadSupervisorProtocolReason("UNKNOWN_TYPE")).toBeNull();
      expect(leadSupervisorProtocolReason("")).toBeNull();
    });
  });

  describe("leadSupervisorRunFailureReason edge cases", () => {
    it("returns null for succeeded status", () => {
      expect(leadSupervisorRunFailureReason({ status: "succeeded", errorCode: null })).toBeNull();
    });

    it("returns null for null status", () => {
      expect(leadSupervisorRunFailureReason({ status: null, errorCode: null })).toBeNull();
    });

    it("returns null for undefined status", () => {
      expect(leadSupervisorRunFailureReason({ status: undefined, errorCode: null })).toBeNull();
    });

    it("prefers process_lost over failed even with failed status", () => {
      expect(leadSupervisorRunFailureReason({ status: "failed", errorCode: "process_lost" })).toBe(
        "issue_supervisor_run_process_lost",
      );
    });
  });
});
