import { describe, expect, it } from "vitest";
import type { Issue } from "@squadrail/shared";
import { buildCurrentDeliveryIssues } from "./current-delivery";

function makeIssue(input: Partial<Issue> & Pick<Issue, "id" | "title" | "status" | "priority">): Issue {
  const now = new Date("2026-03-18T10:00:00.000Z");
  const { id, title, status, priority, ...rest } = input;
  return {
    companyId: "company-1",
    projectId: null,
    goalId: null,
    parentId: null,
    title,
    description: null,
    status,
    priority,
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
    ...rest,
  };
}

describe("current delivery", () => {
  it("prioritizes blocked and clarification work before implementation", () => {
    const issues = [
      makeIssue({
        id: "issue-implementing",
        title: "Implement parser",
        status: "in_progress",
        priority: "high",
        progressSnapshot: {
          phase: "implementing",
          headline: "Engineer is implementing",
          activeOwnerRole: "engineer",
          activeOwnerAgentId: "eng-1",
          blockedReason: null,
          pendingClarificationCount: 0,
          subtaskSummary: { total: 3, done: 1, open: 2, blocked: 0, inReview: 0 },
          reviewState: "idle",
          qaState: "not_required",
          latestArtifactKinds: [],
        },
      }),
      makeIssue({
        id: "issue-blocked",
        title: "Fix release drift",
        status: "blocked",
        priority: "medium",
        progressSnapshot: {
          phase: "blocked",
          headline: "Blocked on workspace",
          activeOwnerRole: "tech_lead",
          activeOwnerAgentId: "tl-1",
          blockedReason: "workspace_required",
          pendingClarificationCount: 0,
          subtaskSummary: { total: 2, done: 0, open: 2, blocked: 1, inReview: 0 },
          reviewState: "idle",
          qaState: "not_required",
          latestArtifactKinds: [],
        },
      }),
      makeIssue({
        id: "issue-clarification",
        title: "Clarify DICOM mapping",
        status: "todo",
        priority: "critical",
        progressSnapshot: {
          phase: "clarification",
          headline: "Clarification needed",
          activeOwnerRole: null,
          activeOwnerAgentId: null,
          blockedReason: null,
          pendingClarificationCount: 1,
          subtaskSummary: { total: 0, done: 0, open: 0, blocked: 0, inReview: 0 },
          reviewState: "idle",
          qaState: "not_required",
          latestArtifactKinds: [],
        },
      }),
    ];

    expect(buildCurrentDeliveryIssues(issues).map((issue) => issue.id)).toEqual([
      "issue-blocked",
      "issue-clarification",
      "issue-implementing",
    ]);
  });

  it("filters out subtasks and terminal issues", () => {
    const issues = [
      makeIssue({
        id: "issue-root",
        title: "Root issue",
        status: "in_progress",
        priority: "medium",
        progressSnapshot: {
          phase: "review",
          headline: "Waiting review",
          activeOwnerRole: "reviewer",
          activeOwnerAgentId: "rev-1",
          blockedReason: null,
          pendingClarificationCount: 0,
          subtaskSummary: { total: 2, done: 1, open: 1, blocked: 0, inReview: 1 },
          reviewState: "waiting_review",
          qaState: "not_required",
          latestArtifactKinds: [],
        },
      }),
      makeIssue({
        id: "issue-child",
        title: "Child issue",
        status: "in_progress",
        priority: "medium",
        parentId: "issue-root",
      }),
      makeIssue({
        id: "issue-done",
        title: "Done issue",
        status: "done",
        priority: "high",
      }),
    ];

    expect(buildCurrentDeliveryIssues(issues).map((issue) => issue.id)).toEqual([
      "issue-root",
    ]);
  });
});
