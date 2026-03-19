import { describe, expect, it } from "vitest";
import type { Issue } from "@squadrail/shared";
import { buildProjectDeliverySummary } from "./project-delivery-summary";

function makeIssue(input: Partial<Issue> & Pick<Issue, "id">): Issue {
  const now = new Date("2026-03-19T09:00:00.000Z");
  const { id, ...rest } = input;
  return {
    companyId: "company-1",
    projectId: null,
    goalId: null,
    parentId: null,
    title: "Issue",
    description: null,
    status: "todo",
    priority: "medium",
    assigneeAgentId: null,
    assigneeUserId: null,
    checkoutRunId: null,
    executionRunId: null,
    executionAgentNameKey: null,
    executionLockedAt: null,
    createdByAgentId: null,
    createdByUserId: null,
    issueNumber: null,
    identifier: null,
    requestDepth: 0,
    billingCode: null,
    assigneeAdapterOverrides: null,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    createdAt: now,
    updatedAt: now,
    id,
    internalWorkItemSummary: {
      total: 0,
      backlog: 0,
      todo: 0,
      inProgress: 0,
      inReview: 0,
      blocked: 0,
      done: 0,
      cancelled: 0,
      activeAssigneeAgentIds: [],
      blockerIssueId: null,
      reviewRequestedIssueId: null,
    },
    ...rest,
  };
}

describe("buildProjectDeliverySummary", () => {
  it("summarizes active root issues by delivery risk", () => {
    const summary = buildProjectDeliverySummary([
      makeIssue({
        id: "blocked-root",
        title: "Blocked root",
        status: "in_progress",
        priority: "critical",
        updatedAt: new Date("2026-03-19T09:05:00.000Z"),
        progressSnapshot: {
          phase: "blocked",
          headline: "Blocked by missing environment",
          activeOwnerAgentId: "eng-1",
          activeOwnerRole: "engineer",
          blockedReason: "environment_missing",
          pendingClarificationCount: 0,
          subtaskSummary: { total: 2, done: 1, open: 1, blocked: 1, inReview: 0 },
          reviewState: "idle",
          qaState: "not_required",
          latestArtifactKinds: [],
        },
      }),
      makeIssue({
        id: "clarification-root",
        title: "Clarification root",
        status: "todo",
        priority: "high",
        updatedAt: new Date("2026-03-19T09:04:00.000Z"),
        progressSnapshot: {
          phase: "clarification",
          headline: "Waiting on operator answer",
          activeOwnerAgentId: null,
          activeOwnerRole: null,
          blockedReason: null,
          pendingClarificationCount: 2,
          subtaskSummary: { total: 0, done: 0, open: 0, blocked: 0, inReview: 0 },
          reviewState: "idle",
          qaState: "not_required",
          latestArtifactKinds: [],
        },
      }),
      makeIssue({
        id: "review-root",
        title: "Review root",
        status: "in_review",
        priority: "medium",
        updatedAt: new Date("2026-03-19T09:03:00.000Z"),
        progressSnapshot: {
          phase: "review",
          headline: "Submitted for review",
          activeOwnerAgentId: "reviewer-1",
          activeOwnerRole: "reviewer",
          blockedReason: null,
          pendingClarificationCount: 0,
          subtaskSummary: { total: 1, done: 1, open: 0, blocked: 0, inReview: 1 },
          reviewState: "waiting_review",
          qaState: "not_required",
          latestArtifactKinds: [],
        },
      }),
      makeIssue({
        id: "done-root",
        title: "Done root",
        status: "done",
      }),
      makeIssue({
        id: "child-1",
        title: "Child issue",
        parentId: "blocked-root",
        status: "todo",
      }),
    ]);

    expect(summary.activeRootCount).toBe(3);
    expect(summary.blockedRootCount).toBe(1);
    expect(summary.clarificationRootCount).toBe(1);
    expect(summary.reviewOrGateCount).toBe(1);
    expect(summary.currentDelivery.map((issue) => issue.id)).toEqual([
      "blocked-root",
      "clarification-root",
      "review-root",
    ]);
  });

  it("returns empty counts when only done or child issues remain", () => {
    const summary = buildProjectDeliverySummary([
      makeIssue({
        id: "done-root",
        status: "done",
      }),
      makeIssue({
        id: "child-1",
        parentId: "done-root",
        status: "in_progress",
      }),
    ]);

    expect(summary.activeRootCount).toBe(0);
    expect(summary.blockedRootCount).toBe(0);
    expect(summary.clarificationRootCount).toBe(0);
    expect(summary.reviewOrGateCount).toBe(0);
    expect(summary.currentDelivery).toEqual([]);
  });
});
