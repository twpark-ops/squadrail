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
  hiddenAt: new Date("2026-03-09T00:00:00.000Z"),
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

  it("disables reviewer and lead watch flags for hidden internal child issues", () => {
    expect(isReviewerWatchEnabled(INTERNAL_CONTEXT)).toBe(false);
    expect(isLeadWatchEnabled(INTERNAL_CONTEXT)).toBe(false);
    expect(
      isReviewerWatchEnabled({
        ...INTERNAL_CONTEXT,
        hiddenAt: null,
      }),
    ).toBe(true);
    expect(
      isLeadWatchEnabled({
        ...INTERNAL_CONTEXT,
        hiddenAt: null,
      }),
    ).toBe(true);
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
      reviewerWatchEnabled: false,
      leadWatchEnabled: false,
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
        hiddenAt: new Date("2026-03-09T00:00:00.000Z"),
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
      hiddenAt: new Date("2026-03-09T00:00:00.000Z"),
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
      hiddenAt: null,
      labelNames: ["watch:reviewer"],
      techLeadAgentId: null,
    })).toEqual({});
    expect(getInternalWorkItemKind({
      labelNames: ["team:internal"],
    })).toBeNull();
    expect(reviewerWatchReason("ANYTHING_ELSE")).toBe("issue_watch_assigned");
  });
});
