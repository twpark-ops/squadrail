import {
  agents,
  assets,
  companies,
  companyMemberships,
  goals,
  heartbeatRuns,
  issueAttachments,
  issueComments,
  issueLabels,
  issues,
  labels,
  projectWorkspaces,
  projects,
} from "@squadrail/db";
import { describe, expect, it } from "vitest";
import { issueService } from "../services/issues.js";

function createResolvedChain(rows: unknown[]) {
  const chain = {
    from: () => chain,
    where: () => chain,
    innerJoin: () => chain,
    leftJoin: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    then: <T>(resolve: (value: unknown[]) => T | PromiseLike<T>) => Promise.resolve(rows).then(resolve),
  };
  return chain;
}

function createMutationResult(queue: unknown[][]) {
  return {
    returning: async () => queue.shift() ?? [],
    then: <T>(resolve: (value: undefined) => T | PromiseLike<T>) => Promise.resolve(undefined).then(resolve),
  };
}

function createIssueDbMock(input: {
  selectResults?: unknown[][];
  insertResults?: unknown[][];
  updateResults?: unknown[][];
  deleteResults?: unknown[][];
  executeResults?: unknown[][];
}) {
  const selectQueue = [...(input.selectResults ?? [])];
  const insertQueue = [...(input.insertResults ?? [])];
  const updateQueue = [...(input.updateResults ?? [])];
  const deleteQueue = [...(input.deleteResults ?? [])];
  const executeQueue = [...(input.executeResults ?? [])];
  const insertValues: Array<{ table: unknown; value: unknown }> = [];
  const updateSets: Array<{ table: unknown; value: unknown }> = [];
  const deletedTables: unknown[] = [];

  const db = {
    select: () => createResolvedChain(selectQueue.shift() ?? []),
    insert: (table: unknown) => ({
      values: (value: unknown) => {
        insertValues.push({ table, value });
        return createMutationResult(insertQueue);
      },
    }),
    update: (table: unknown) => ({
      set: (value: unknown) => {
        updateSets.push({ table, value });
        return {
          where: () => createMutationResult(updateQueue),
        };
      },
    }),
    delete: (table: unknown) => ({
      where: () => {
        deletedTables.push(table);
        return createMutationResult(deleteQueue);
      },
    }),
    execute: async () => executeQueue.shift() ?? [],
    transaction: async <T>(callback: (tx: typeof db) => Promise<T>) => callback(db),
  };

  return { db, insertValues, updateSets, deletedTables };
}

function makeLabel(overrides: Partial<typeof labels.$inferSelect> = {}) {
  return {
    id: "label-1",
    companyId: "company-1",
    name: "bug",
    color: "#EF4444",
    createdAt: new Date("2026-03-13T09:00:00.000Z"),
    updatedAt: new Date("2026-03-13T09:00:00.000Z"),
    ...overrides,
  };
}

function makeIssue(overrides: Partial<typeof issues.$inferSelect> = {}) {
  return {
    id: "issue-1",
    companyId: "company-1",
    issueNumber: 42,
    identifier: "CLO-42",
    parentId: null,
    projectId: null,
    goalId: null,
    title: "Fix runtime bug",
    description: "Coordinate the recovery flow",
    status: "todo",
    priority: "high",
    assigneeAgentId: null,
    assigneeUserId: null,
    requestDepth: 0,
    hiddenAt: null,
    createdByAgentId: null,
    createdByUserId: null,
    checkoutRunId: null,
    executionRunId: null,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    createdAt: new Date("2026-03-13T09:00:00.000Z"),
    updatedAt: new Date("2026-03-13T09:00:00.000Z"),
    ...overrides,
  };
}

function makeAgentRow(overrides: Partial<typeof agents.$inferSelect> = {}) {
  return {
    id: "agent-1",
    companyId: "company-1",
    name: "Release Captain",
    urlKey: "release-captain",
    role: "tech_lead",
    title: "Release Captain",
    reportsTo: null,
    capabilities: "Coordinate runtime recovery",
    adapterType: "codex_local",
    adapterConfig: {},
    runtimeConfig: {},
    budgetMonthlyCents: 0,
    spentMonthlyCents: 0,
    status: "idle",
    permissions: {},
    metadata: null,
    lastHeartbeatAt: null,
    createdAt: new Date("2026-03-13T09:00:00.000Z"),
    updatedAt: new Date("2026-03-13T09:00:00.000Z"),
    ...overrides,
  };
}

describe("issue service", () => {
  it("creates an issue with assignee validation, counter allocation, and labels", async () => {
    const persisted = makeIssue({
      status: "in_progress",
      assigneeAgentId: "agent-1",
      startedAt: new Date("2026-03-13T09:05:00.000Z"),
    });
    const label = makeLabel();
    const { db, insertValues, updateSets, deletedTables } = createIssueDbMock({
      selectResults: [
        [makeAgentRow()],
        [{ id: label.id }],
        [{ issueId: persisted.id, label }],
      ],
      insertResults: [[persisted]],
      updateResults: [[{ issueCounter: 42, issuePrefix: "CLO" }]],
    });
    const service = issueService(db as never);

    const created = await service.create("company-1", {
      title: "Fix runtime bug",
      description: "Coordinate the recovery flow",
      status: "in_progress",
      priority: "high",
      assigneeAgentId: "agent-1",
      assigneeUserId: null,
      projectId: null,
      goalId: null,
      parentId: null,
      requestDepth: 0,
      hiddenAt: null,
      createdByAgentId: null,
      createdByUserId: null,
      labelIds: [label.id],
    });

    expect(created).toMatchObject({
      id: "issue-1",
      identifier: "CLO-42",
      assigneeAgentId: "agent-1",
      labelIds: [label.id],
      labels: [expect.objectContaining({ id: label.id, name: "bug" })],
    });
    expect(updateSets.find((entry) => entry.table === companies)?.value).toMatchObject({
      issueCounter: expect.anything(),
    });
    expect(insertValues.find((entry) => entry.table === issues)?.value).toMatchObject({
      companyId: "company-1",
      issueNumber: 42,
      identifier: "CLO-42",
      assigneeAgentId: "agent-1",
      startedAt: expect.any(Date),
    });
    expect(insertValues.find((entry) => entry.table === issueLabels)?.value).toEqual([
      { issueId: "issue-1", labelId: label.id, companyId: "company-1" },
    ]);
    expect(deletedTables).toContain(issueLabels);
  });

  it("creates hidden internal work items and provisions reserved labels", async () => {
    const parent = makeIssue({
      id: "issue-root",
      identifier: "CLO-7",
      projectId: "project-1",
      goalId: "goal-1",
      hiddenAt: null,
    });
    const existingLabel = makeLabel({
      id: "label-team",
      name: "team:internal",
      color: "#64748B",
    });
    const createdReviewLabel = makeLabel({
      id: "label-review",
      name: "work:review",
      color: "#7C3AED",
    });
    const child = makeIssue({
      id: "issue-child",
      parentId: "issue-root",
      identifier: "CLO-8",
      projectId: "project-1",
      goalId: "goal-1",
      requestDepth: 1,
      hiddenAt: new Date("2026-03-13T09:10:00.000Z"),
      assigneeAgentId: "agent-1",
    });
    const { db, insertValues } = createIssueDbMock({
      selectResults: [
        [parent],
        [makeAgentRow()],
        [existingLabel],
        [{ id: existingLabel.id }, { id: createdReviewLabel.id }],
        [
          { issueId: child.id, label: existingLabel },
          { issueId: child.id, label: createdReviewLabel },
        ],
      ],
      insertResults: [[createdReviewLabel], [child]],
      updateResults: [[{ issueCounter: 8, issuePrefix: "CLO" }]],
    });
    const service = issueService(db as never);

    const created = await service.createInternalWorkItem({
      parentIssueId: "issue-root",
      companyId: "company-1",
      title: "Review fix plan",
      kind: "review",
      priority: "medium",
      assigneeAgentId: "agent-1",
      labelNames: ["team:internal", "work:review"],
    });

    expect(created).toMatchObject({
      id: "issue-child",
      parentId: "issue-root",
      requestDepth: 1,
      labelIds: ["label-team", "label-review"],
    });
    expect(insertValues.find((entry) => entry.table === labels)?.value).toMatchObject({
      companyId: "company-1",
      name: "work:review",
      color: "#7C3AED",
    });
    expect(insertValues.find((entry) => entry.table === issues)?.value).toMatchObject({
      companyId: "company-1",
      parentId: "issue-root",
      projectId: "project-1",
      goalId: "goal-1",
      requestDepth: 1,
      hiddenAt: expect.any(Date),
    });
  });

  it("updates assignment and status side effects while syncing labels", async () => {
    const existing = makeIssue({
      status: "done",
      assigneeAgentId: "agent-1",
      completedAt: new Date("2026-03-13T09:20:00.000Z"),
      checkoutRunId: "run-1",
    });
    const updated = makeIssue({
      status: "todo",
      assigneeAgentId: null,
      assigneeUserId: "user-1",
      completedAt: null,
      checkoutRunId: null,
    });
    const label = makeLabel({ id: "label-next", name: "next" });
    const { db, updateSets, deletedTables } = createIssueDbMock({
      selectResults: [
        [existing],
        [{ id: "membership-1" }],
        [{ id: label.id }],
        [{ issueId: updated.id, label }],
      ],
      updateResults: [[updated]],
    });
    const service = issueService(db as never);

    const row = await service.update("issue-1", {
      status: "todo",
      assigneeAgentId: null,
      assigneeUserId: "user-1",
      labelIds: [label.id],
    });

    expect(row).toMatchObject({
      id: "issue-1",
      status: "todo",
      assigneeUserId: "user-1",
      labelIds: ["label-next"],
    });
    expect(updateSets.find((entry) => entry.table === issues)?.value).toMatchObject({
      status: "todo",
      assigneeAgentId: null,
      assigneeUserId: "user-1",
      completedAt: null,
      cancelledAt: null,
      checkoutRunId: null,
      updatedAt: expect.any(Date),
    });
    expect(deletedTables).toContain(issueLabels);
  });

  it("lists issues with active run and labels when label filters are applied", async () => {
    const listed = makeIssue({
      id: "issue-9",
      executionRunId: "run-9",
      updatedAt: new Date("2026-03-13T10:00:00.000Z"),
    });
    const label = makeLabel({ id: "label-ops", name: "ops" });
    const { db } = createIssueDbMock({
      selectResults: [
        [{ issueId: "issue-9" }],
        [listed],
        [{ issueId: "issue-9", label }],
        [{
          id: "run-9",
          status: "running",
          agentId: "agent-1",
          invocationSource: "automation",
          triggerDetail: "system",
          startedAt: new Date("2026-03-13T09:55:00.000Z"),
          finishedAt: null,
          createdAt: new Date("2026-03-13T09:55:00.000Z"),
        }],
      ],
    });
    const service = issueService(db as never);

    const rows = await service.list("company-1", { labelId: "label-ops" });

    expect(rows).toEqual([
      expect.objectContaining({
        id: "issue-9",
        labelIds: ["label-ops"],
        activeRun: expect.objectContaining({
          id: "run-9",
          status: "running",
        }),
      }),
    ]);
  });

  it("checks out issues for the assignee and preserves in-progress ownership", async () => {
    const updated = makeIssue({
      id: "issue-10",
      status: "in_progress",
      assigneeAgentId: "agent-1",
      checkoutRunId: "run-10",
      executionRunId: "run-10",
      startedAt: new Date("2026-03-13T09:30:00.000Z"),
    });
    const { db } = createIssueDbMock({
      selectResults: [
        [{ companyId: "company-1" }],
        [makeAgentRow()],
        [],
      ],
      updateResults: [[updated]],
    });
    const service = issueService(db as never);

    const row = await service.checkout("issue-10", "agent-1", ["todo", "backlog"], "run-10");

    expect(row).toMatchObject({
      id: "issue-10",
      status: "in_progress",
      assigneeAgentId: "agent-1",
      checkoutRunId: "run-10",
    });
  });

  it("adopts stale checkout runs when the previous run has already terminated", async () => {
    const { db } = createIssueDbMock({
      selectResults: [
        [{
          id: "issue-11",
          status: "in_progress",
          assigneeAgentId: "agent-1",
          checkoutRunId: "run-old",
        }],
        [{ status: "succeeded" }],
      ],
      updateResults: [[{
        id: "issue-11",
        status: "in_progress",
        assigneeAgentId: "agent-1",
        checkoutRunId: "run-new",
        executionRunId: "run-new",
      }]],
    });
    const service = issueService(db as never);

    const ownership = await service.assertCheckoutOwner("issue-11", "agent-1", "run-new");

    expect(ownership).toMatchObject({
      id: "issue-11",
      checkoutRunId: "run-new",
      adoptedFromRunId: "run-old",
    });
  });

  it("releases issues back to todo and clears checkout state", async () => {
    const existing = makeIssue({
      id: "issue-12",
      status: "in_progress",
      assigneeAgentId: "agent-1",
      checkoutRunId: "run-12",
    });
    const updated = makeIssue({
      id: "issue-12",
      status: "todo",
      assigneeAgentId: null,
      checkoutRunId: null,
    });
    const { db } = createIssueDbMock({
      selectResults: [[existing], []],
      updateResults: [[updated]],
    });
    const service = issueService(db as never);

    const released = await service.release("issue-12", "agent-1", "run-12");

    expect(released).toMatchObject({
      id: "issue-12",
      status: "todo",
      assigneeAgentId: null,
      checkoutRunId: null,
    });
  });

  it("removes issues and cascades attached asset cleanup", async () => {
    const removed = makeIssue({ id: "issue-13" });
    const { db, deletedTables } = createIssueDbMock({
      selectResults: [
        [{ assetId: "asset-1" }],
        [],
      ],
      deleteResults: [[removed], []],
    });
    const service = issueService(db as never);

    const row = await service.remove("issue-13");

    expect(row).toMatchObject({ id: "issue-13" });
    expect(deletedTables).toEqual([issues, assets]);
  });

  it("adds comments and touches the issue timestamp for recency ordering", async () => {
    const comment = {
      id: "comment-1",
      companyId: "company-1",
      issueId: "issue-14",
      authorAgentId: null,
      authorUserId: "user-1",
      body: "Please re-run the validation suite.",
      createdAt: new Date("2026-03-13T10:20:00.000Z"),
      updatedAt: new Date("2026-03-13T10:20:00.000Z"),
    };
    const { db, updateSets } = createIssueDbMock({
      selectResults: [[{ companyId: "company-1" }]],
      insertResults: [[comment]],
    });
    const service = issueService(db as never);

    const created = await service.addComment("issue-14", comment.body, { userId: "user-1" });

    expect(created).toEqual(comment);
    expect(updateSets.find((entry) => entry.table === issues)?.value).toMatchObject({
      updatedAt: expect.any(Date),
    });
  });

  it("creates attachments by persisting both the asset row and the attachment row", async () => {
    const { db, insertValues } = createIssueDbMock({
      selectResults: [
        [{ id: "issue-15", companyId: "company-1" }],
        [{ id: "comment-15", companyId: "company-1", issueId: "issue-15" }],
      ],
      insertResults: [[{
        id: "asset-15",
        companyId: "company-1",
        provider: "s3",
        objectKey: "issues/15.png",
        contentType: "image/png",
        byteSize: 512,
        sha256: "hash",
        originalFilename: "capture.png",
        createdByAgentId: null,
        createdByUserId: "user-1",
      }], [{
        id: "attachment-15",
        companyId: "company-1",
        issueId: "issue-15",
        issueCommentId: "comment-15",
        assetId: "asset-15",
        createdAt: new Date("2026-03-13T10:25:00.000Z"),
        updatedAt: new Date("2026-03-13T10:25:00.000Z"),
      }]],
    });
    const service = issueService(db as never);

    const created = await service.createAttachment({
      issueId: "issue-15",
      issueCommentId: "comment-15",
      provider: "s3",
      objectKey: "issues/15.png",
      contentType: "image/png",
      byteSize: 512,
      sha256: "hash",
      originalFilename: "capture.png",
      createdByUserId: "user-1",
    });

    expect(created).toMatchObject({
      id: "attachment-15",
      assetId: "asset-15",
      contentType: "image/png",
      issueCommentId: "comment-15",
    });
    expect(insertValues.find((entry) => entry.table === assets)?.value).toMatchObject({
      companyId: "company-1",
      provider: "s3",
      objectKey: "issues/15.png",
    });
    expect(insertValues.find((entry) => entry.table === issueAttachments)?.value).toMatchObject({
      companyId: "company-1",
      issueId: "issue-15",
      issueCommentId: "comment-15",
      assetId: "asset-15",
    });
  });

  it("finds mentioned agents from names and normalized url keys", async () => {
    const { db } = createIssueDbMock({
      selectResults: [[
        { id: "agent-1", name: "Release Captain" },
        { id: "agent-2", name: "QA Lead" },
      ]],
    });
    const service = issueService(db as never);

    const mentioned = await service.findMentionedAgents(
      "company-1",
      "Loop in @release-captain and @qa-lead before closing.",
    );

    expect(mentioned).toEqual(["agent-1", "agent-2"]);
  });

  it("resolves ancestor project and goal context in batches", async () => {
    const { db } = createIssueDbMock({
      selectResults: [
        [{ id: "issue-16", parentId: "issue-root" }],
        [{
          id: "issue-root",
          identifier: "CLO-1",
          title: "Root",
          description: "Coordinate release hardening",
          status: "in_progress",
          priority: "critical",
          assigneeAgentId: "agent-1",
          projectId: "project-1",
          goalId: "goal-1",
          parentId: null,
        }],
        [{
          id: "workspace-1",
          companyId: "company-1",
          projectId: "project-1",
          name: "runtime",
          cwd: "/repo/runtime",
          repoUrl: "https://example.com/runtime.git",
          repoRef: "main",
          metadata: null,
          isPrimary: true,
          createdAt: new Date("2026-03-13T08:00:00.000Z"),
          updatedAt: new Date("2026-03-13T08:00:00.000Z"),
        }],
        [{
          id: "project-1",
          name: "Runtime",
          description: "Runtime services",
          status: "active",
          goalId: "goal-1",
        }],
        [{
          id: "goal-1",
          title: "Stability",
          description: "Reduce regressions",
          level: "company",
          status: "active",
        }],
      ],
    });
    const service = issueService(db as never);

    const ancestors = await service.getAncestors("issue-16");

    expect(ancestors).toEqual([
      expect.objectContaining({
        id: "issue-root",
        project: expect.objectContaining({
          id: "project-1",
          primaryWorkspace: expect.objectContaining({
            id: "workspace-1",
            name: "runtime",
          }),
        }),
        goal: expect.objectContaining({
          id: "goal-1",
          title: "Stability",
        }),
      }),
    ]);
  });

  it("gets issues by id and identifier and summarizes hidden internal work items", async () => {
    const reviewChild = makeIssue({
      id: "issue-review",
      parentId: "issue-root",
      hiddenAt: new Date("2026-03-13T09:00:00.000Z"),
      status: "in_review",
      assigneeAgentId: "agent-reviewer",
      updatedAt: new Date("2026-03-13T10:00:00.000Z"),
    });
    const blockedChild = makeIssue({
      id: "issue-blocked",
      parentId: "issue-root",
      hiddenAt: new Date("2026-03-13T09:05:00.000Z"),
      status: "blocked",
      assigneeAgentId: "agent-engineer",
      updatedAt: new Date("2026-03-13T11:00:00.000Z"),
    });
    const root = makeIssue({
      id: "issue-root",
      identifier: "CLO-200",
    });
    const label = makeLabel({ id: "label-root", name: "ops" });
    const { db } = createIssueDbMock({
      selectResults: [
        [root],
        [{ issueId: "issue-root", label }],
        [root],
        [{ issueId: "issue-root", label }],
        [reviewChild, blockedChild],
        [
          { issueId: reviewChild.id, label },
          { issueId: blockedChild.id, label },
        ],
        [reviewChild, blockedChild],
        [
          { issueId: reviewChild.id, label },
          { issueId: blockedChild.id, label },
        ],
      ],
    });
    const service = issueService(db as never);

    await expect(service.getById("issue-root")).resolves.toMatchObject({
      id: "issue-root",
      labelIds: ["label-root"],
    });
    await expect(service.getByIdentifier("clo-200")).resolves.toMatchObject({
      id: "issue-root",
      identifier: "CLO-200",
    });
    await expect(service.listInternalWorkItems("issue-root")).resolves.toEqual([
      expect.objectContaining({ id: "issue-review" }),
      expect.objectContaining({ id: "issue-blocked" }),
    ]);
    await expect(service.getInternalWorkItemSummary("issue-root")).resolves.toEqual({
      total: 2,
      backlog: 0,
      todo: 0,
      inProgress: 0,
      inReview: 1,
      blocked: 1,
      done: 0,
      cancelled: 0,
      activeAssigneeAgentIds: ["agent-reviewer", "agent-engineer"],
      blockerIssueId: "issue-blocked",
      reviewRequestedIssueId: "issue-review",
    });
  });

  it("lists and removes attachments while exposing attachment lookups", async () => {
    const attachmentRow = {
      id: "attachment-16",
      companyId: "company-1",
      issueId: "issue-16",
      issueCommentId: null,
      assetId: "asset-16",
      provider: "s3",
      objectKey: "attachments/16.png",
      contentType: "image/png",
      byteSize: 1024,
      sha256: "hash-16",
      originalFilename: "capture.png",
      createdByAgentId: null,
      createdByUserId: "user-1",
      createdAt: new Date("2026-03-13T10:30:00.000Z"),
      updatedAt: new Date("2026-03-13T10:30:00.000Z"),
    };
    const { db, deletedTables } = createIssueDbMock({
      selectResults: [
        [attachmentRow],
        [attachmentRow],
        [attachmentRow],
      ],
      deleteResults: [[attachmentRow], []],
    });
    const service = issueService(db as never);

    await expect(service.listAttachments("issue-16")).resolves.toEqual([attachmentRow]);
    await expect(service.getAttachmentById("attachment-16")).resolves.toEqual(attachmentRow);
    await expect(service.removeAttachment("attachment-16")).resolves.toEqual(attachmentRow);
    expect(deletedTables).toEqual([issueAttachments, assets]);
  });

  it("manages labels, comments, project mentions, and stale counts", async () => {
    const createdLabel = makeLabel({ id: "label-created", name: "platform" });
    const comment = {
      id: "comment-16",
      issueId: "issue-16",
      companyId: "company-1",
      authorAgentId: null,
      authorUserId: "user-1",
      body: "Track [Runtime](project://project-1) before closing.",
      createdAt: new Date("2026-03-13T10:40:00.000Z"),
      updatedAt: new Date("2026-03-13T10:40:00.000Z"),
    };
    const { db, insertValues } = createIssueDbMock({
      selectResults: [
        [createdLabel],
        [createdLabel],
        [comment],
        [comment],
        [{
          companyId: "company-1",
          title: "Coordinate [Runtime](project://project-1)",
          description: "Escalate to [Mobile](project://project-2)",
        }],
        [{ body: "Review [Runtime](project://project-1) and [Web](project://project-3)" }],
        [{ id: "project-1" }, { id: "project-3" }],
        [{ count: 2 }],
      ],
      insertResults: [[createdLabel]],
      deleteResults: [[createdLabel]],
    });
    const service = issueService(db as never);

    await expect(service.listLabels("company-1")).resolves.toEqual([createdLabel]);
    await expect(service.getLabelById("label-created")).resolves.toEqual(createdLabel);
    await expect(service.createLabel("company-1", { name: " platform ", color: "#0EA5E9" })).resolves.toEqual(
      createdLabel,
    );
    await expect(service.deleteLabel("label-created")).resolves.toEqual(createdLabel);
    await expect(service.listComments("issue-16")).resolves.toEqual([comment]);
    await expect(service.getComment("comment-16")).resolves.toEqual(comment);
    await expect(service.findMentionedProjectIds("issue-16")).resolves.toEqual(["project-1", "project-3"]);
    await expect(service.staleCount("company-1", 90)).resolves.toBe(2);

    expect(insertValues).toContainEqual({
      table: labels,
      value: {
        companyId: "company-1",
        name: "platform",
        color: "#0EA5E9",
      },
    });
  });
});
