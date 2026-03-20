import { describe, expect, it } from "vitest";
import type { Issue } from "@squadrail/shared";
import {
  resolveIssueProjectIdsFromCache,
  shouldInvalidateProjectsListForIssueActivity,
} from "./live-update-issue-cache";

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: "issue-1",
    companyId: "company-1",
    projectId: "project-a",
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
    identifier: "CLO-1",
    commentCount: 0,
    attachmentCount: 0,
    childCount: 0,
    blockedByIssueIds: [],
    createdAt: new Date("2026-03-19T00:00:00.000Z"),
    updatedAt: new Date("2026-03-19T00:00:00.000Z"),
    startedAt: null,
    completedAt: null,
    closedAt: null,
    closedByAgentId: null,
    closedByUserId: null,
    lastCommentAt: null,
    progressSnapshot: null,
    runtimeSummary: null,
    internalWorkItems: null,
    descendants: [],
    labels: [],
    urlKey: null,
    ancestors: [],
    project: null,
    goal: null,
    ...overrides,
  } as Issue;
}

describe("resolveIssueProjectIdsFromCache", () => {
  it("collects project ids from cache and payload details", () => {
    const issue = makeIssue();
    const projectIds = resolveIssueProjectIdsFromCache({
      issueId: "issue-1",
      details: {
        projectId: "project-b",
        previous: {
          projectId: "project-c",
        },
      },
      detailIssue: issue,
      listIssues: [issue],
    });

    expect(projectIds).toEqual(["project-a", "project-b", "project-c"]);
  });

  it("matches cached list issues by identifier", () => {
    const issue = makeIssue({
      id: "issue-1",
      identifier: "CLO-42",
      projectId: "project-z",
    });
    const projectIds = resolveIssueProjectIdsFromCache({
      issueId: "CLO-42",
      details: {
        issueIdentifier: "CLO-42",
      },
      detailIssue: null,
      listIssues: [issue],
    });

    expect(projectIds).toEqual(["project-z"]);
  });
});

describe("shouldInvalidateProjectsListForIssueActivity", () => {
  it("only invalidates the project list when the issue activity resolves a concrete project id", () => {
    expect(shouldInvalidateProjectsListForIssueActivity(["project-a"])).toBe(true);
    expect(shouldInvalidateProjectsListForIssueActivity([])).toBe(false);
  });
});
