import { activityLog, heartbeatRuns, issues } from "@squadrail/db";
import { describe, expect, it } from "vitest";
import { activityService } from "../services/activity.js";

function createResolvedChain(rows: unknown[]) {
  const chain = {
    from: () => chain,
    where: () => chain,
    leftJoin: () => chain,
    innerJoin: () => chain,
    orderBy: () => chain,
    selectDistinctOn: () => chain,
    then: <T>(resolve: (value: unknown[]) => T | PromiseLike<T>) => Promise.resolve(rows).then(resolve),
  };
  return chain;
}

function createActivityDbMock(input: {
  selectResults?: unknown[][];
  insertResults?: unknown[][];
}) {
  const selectQueue = [...(input.selectResults ?? [])];
  const insertQueue = [...(input.insertResults ?? [])];
  const insertValues: Array<{ table: unknown; value: unknown }> = [];

  const db = {
    select: () => createResolvedChain(selectQueue.shift() ?? []),
    selectDistinctOn: () => createResolvedChain(selectQueue.shift() ?? []),
    insert: (table: unknown) => ({
      values: (value: unknown) => {
        insertValues.push({ table, value });
        return {
          returning: async () => insertQueue.shift() ?? [],
        };
      },
    }),
  };

  return { db, insertValues };
}

describe("activity service", () => {
  it("lists activity rows and maps the joined shape back to activity entries", async () => {
    const row = {
      id: "activity-1",
      companyId: "company-1",
      action: "issue.updated",
      entityType: "issue",
      entityId: "issue-1",
    };
    const { db } = createActivityDbMock({
      selectResults: [[{ activityLog: row }]],
    });
    const service = activityService(db as never);

    const rows = await service.list({
      companyId: "company-1",
      agentId: "agent-1",
      entityType: "issue",
      entityId: "issue-1",
    });

    expect(rows).toEqual([row]);
  });

  it("prepends context issue when a run references an issue outside explicit activity rows", async () => {
    const { db } = createActivityDbMock({
      selectResults: [
        [{
          companyId: "company-1",
          contextSnapshot: { issueId: "issue-ctx-1" },
        }],
        [{
          issueId: "issue-2",
          identifier: "CLO-2",
          title: "Existing activity issue",
          status: "in_progress",
          priority: "high",
        }],
        [{
          issueId: "issue-ctx-1",
          identifier: "CLO-1",
          title: "Context issue",
          status: "todo",
          priority: "medium",
        }],
      ],
    });
    const service = activityService(db as never);

    const rows = await service.issuesForRun("run-1");

    expect(rows).toEqual([
      expect.objectContaining({ issueId: "issue-ctx-1" }),
      expect.objectContaining({ issueId: "issue-2" }),
    ]);
  });

  it("returns activity-linked issues directly when the context issue is already present", async () => {
    const { db } = createActivityDbMock({
      selectResults: [
        [{
          companyId: "company-1",
          contextSnapshot: { issueId: "issue-1" },
        }],
        [{
          issueId: "issue-1",
          identifier: "CLO-1",
          title: "Context issue",
          status: "todo",
          priority: "medium",
        }],
      ],
    });
    const service = activityService(db as never);

    const rows = await service.issuesForRun("run-1");

    expect(rows).toEqual([
      expect.objectContaining({ issueId: "issue-1" }),
    ]);
  });

  it("creates activity rows through the insert path", async () => {
    const created = {
      id: "activity-1",
      companyId: "company-1",
      action: "run.finished",
      entityType: "issue",
      entityId: "issue-1",
    };
    const { db, insertValues } = createActivityDbMock({
      insertResults: [[created]],
    });
    const service = activityService(db as never);

    const row = await service.create({
      companyId: "company-1",
      action: "run.finished",
      entityType: "issue",
      entityId: "issue-1",
    } as typeof activityLog.$inferInsert);

    expect(row).toEqual(created);
    expect(insertValues.find((entry) => entry.table === activityLog)?.value).toMatchObject({
      companyId: "company-1",
      action: "run.finished",
    });
  });
});
