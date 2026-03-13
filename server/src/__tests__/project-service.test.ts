import { goals, projectGoals, projects, projectWorkspaces } from "@squadrail/db";
import { describe, expect, it } from "vitest";
import { projectService } from "../services/projects.js";

function createResolvedChain(rows: unknown[]) {
  const chain = {
    from: () => chain,
    where: () => chain,
    innerJoin: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    then: <T>(resolve: (value: unknown[]) => T | PromiseLike<T>) => Promise.resolve(rows).then(resolve),
  };
  return chain;
}

function createProjectDbMock(input: {
  selectResults?: unknown[][];
  insertResults?: unknown[][];
  updateResults?: unknown[][];
  deleteResults?: unknown[][];
}) {
  const selectQueue = [...(input.selectResults ?? [])];
  const insertQueue = [...(input.insertResults ?? [])];
  const updateQueue = [...(input.updateResults ?? [])];
  const deleteQueue = [...(input.deleteResults ?? [])];
  const insertValues: Array<{ table: unknown; value: unknown }> = [];
  const updateSets: Array<{ table: unknown; value: unknown }> = [];
  const deletedTables: unknown[] = [];

  const db = {
    select: () => createResolvedChain(selectQueue.shift() ?? []),
    insert: (table: unknown) => ({
      values: (value: unknown) => {
        insertValues.push({ table, value });
        return {
          returning: async () => insertQueue.shift() ?? [],
        };
      },
    }),
    update: (table: unknown) => ({
      set: (value: unknown) => {
        updateSets.push({ table, value });
        return {
          where: () => ({
            returning: async () => updateQueue.shift() ?? [],
          }),
        };
      },
    }),
    delete: (table: unknown) => ({
      where: () => {
        deletedTables.push(table);
        return {
          returning: async () => deleteQueue.shift() ?? [],
        };
      },
    }),
    transaction: async <T>(callback: (tx: typeof db) => Promise<T>) => callback(db),
  };

  return { db, insertValues, updateSets, deletedTables };
}

describe("project service", () => {
  it("creates a project with an auto-assigned color and synced goal links", async () => {
    const created = {
      id: "project-1",
      companyId: "company-1",
      name: "Runtime",
      goalId: "goal-1",
      color: "#4f46e5",
      createdAt: new Date("2026-03-13T09:00:00.000Z"),
      updatedAt: new Date("2026-03-13T09:00:00.000Z"),
    };
    const { db, insertValues, deletedTables } = createProjectDbMock({
      selectResults: [
        [{ color: "#ef4444" }],
        [{ projectId: "project-1", goalId: "goal-1", goalTitle: "Stability" }],
        [],
      ],
      insertResults: [[created], []],
    });
    const service = projectService(db as never);

    const row = await service.create("company-1", {
      name: "Runtime",
      goalIds: ["goal-1"],
    });

    expect(row).toMatchObject({
      id: "project-1",
      color: expect.any(String),
      goalIds: ["goal-1"],
      goals: [{ id: "goal-1", title: "Stability" }],
      workspaces: [],
      primaryWorkspace: null,
    });
    expect(insertValues.find((entry) => entry.table === projects)?.value).toMatchObject({
      companyId: "company-1",
      goalId: "goal-1",
      name: "Runtime",
    });
    expect(deletedTables).toContain(projectGoals);
    expect(insertValues.find((entry) => entry.table === projectGoals)?.value).toEqual([
      { companyId: "company-1", projectId: "project-1", goalId: "goal-1" },
    ]);
  });

  it("creates workspaces from cwd-derived names and stores execution policy metadata", async () => {
    const workspace = {
      id: "workspace-1",
      companyId: "company-1",
      projectId: "project-1",
      name: "runtime",
      cwd: "/repo/runtime",
      repoUrl: null,
      repoRef: null,
      metadata: {
        executionPolicy: {
          mode: "shared",
          applyFor: ["analysis"],
          isolationStrategy: null,
          isolatedRoot: null,
          branchTemplate: null,
          writable: false,
        },
      },
      isPrimary: true,
      createdAt: new Date("2026-03-13T09:05:00.000Z"),
      updatedAt: new Date("2026-03-13T09:05:00.000Z"),
    };
    const { db, insertValues, updateSets } = createProjectDbMock({
      selectResults: [
        [{
          id: "project-1",
          companyId: "company-1",
          name: "Runtime",
          createdAt: new Date(),
          updatedAt: new Date(),
        }],
        [],
      ],
      insertResults: [[workspace]],
    });
    const service = projectService(db as never);

    const row = await service.createWorkspace("project-1", {
      cwd: "/repo/runtime",
      executionPolicy: {
        mode: "shared",
        applyFor: ["analysis"],
        isolationStrategy: null,
        isolatedRoot: null,
        branchTemplate: null,
        writable: false,
      },
    });

    expect(row).toMatchObject({
      id: "workspace-1",
      name: "runtime",
      isPrimary: true,
      executionPolicy: { mode: "shared" },
    });
    expect(updateSets.find((entry) => entry.table === projectWorkspaces)?.value).toMatchObject({
      isPrimary: false,
    });
    expect(insertValues.find((entry) => entry.table === projectWorkspaces)?.value).toMatchObject({
      companyId: "company-1",
      projectId: "project-1",
      name: "runtime",
      cwd: "/repo/runtime",
      isPrimary: true,
    });
  });

  it("removes a primary workspace and promotes the next candidate", async () => {
    const primary = {
      id: "workspace-1",
      companyId: "company-1",
      projectId: "project-1",
      name: "runtime",
      cwd: "/repo/runtime",
      repoUrl: null,
      repoRef: null,
      metadata: null,
      isPrimary: true,
      createdAt: new Date("2026-03-13T09:00:00.000Z"),
      updatedAt: new Date("2026-03-13T09:00:00.000Z"),
    };
    const backup = {
      ...primary,
      id: "workspace-2",
      name: "fallback",
      isPrimary: false,
      createdAt: new Date("2026-03-13T09:10:00.000Z"),
    };
    const { db, updateSets } = createProjectDbMock({
      selectResults: [[primary], [backup]],
      deleteResults: [[primary]],
    });
    const service = projectService(db as never);

    const removed = await service.removeWorkspace("project-1", "workspace-1");

    expect(removed).toMatchObject({
      id: "workspace-1",
      isPrimary: true,
    });
    expect(updateSets.filter((entry) => entry.table === projectWorkspaces)).toHaveLength(2);
  });

  it("resolves project references by url key and flags ambiguous matches", async () => {
    const { db } = createProjectDbMock({
      selectResults: [[
        { id: "project-1", companyId: "company-1", name: "Runtime" },
        { id: "project-2", companyId: "company-1", name: "Runtime" },
      ]],
    });
    const service = projectService(db as never);

    await expect(service.resolveByReference("company-1", "Runtime")).resolves.toEqual({
      project: null,
      ambiguous: true,
    });
  });

  it("preserves requested id order when listing a subset of projects", async () => {
    const { db } = createProjectDbMock({
      selectResults: [
        [
          {
            id: "project-2",
            companyId: "company-1",
            name: "Worker",
            goalId: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          {
            id: "project-1",
            companyId: "company-1",
            name: "Runtime",
            goalId: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
        [
          { projectId: "project-1", goalId: "goal-1", goalTitle: "Stability" },
        ],
        [
          {
            id: "workspace-1",
            companyId: "company-1",
            projectId: "project-1",
            name: "runtime",
            cwd: "/repo/runtime",
            repoUrl: null,
            repoRef: null,
            metadata: null,
            isPrimary: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      ],
    });
    const service = projectService(db as never);

    const rows = await service.listByIds("company-1", ["project-1", "project-2"]);

    expect(rows.map((row) => row.id)).toEqual(["project-1", "project-2"]);
    expect(rows[0]).toMatchObject({
      primaryWorkspace: expect.objectContaining({ id: "workspace-1" }),
      goals: [{ id: "goal-1", title: "Stability" }],
    });
  });

  it("refuses to update a workspace when both cwd and repoUrl become empty", async () => {
    const existing = {
      id: "workspace-1",
      companyId: "company-1",
      projectId: "project-1",
      name: "runtime",
      cwd: "/repo/runtime",
      repoUrl: null,
      repoRef: null,
      metadata: null,
      isPrimary: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const { db } = createProjectDbMock({
      selectResults: [[existing]],
    });
    const service = projectService(db as never);

    await expect(service.updateWorkspace("project-1", "workspace-1", {
      cwd: "",
      repoUrl: "",
    })).resolves.toBeNull();
  });

  it("updates a workspace and promotes it when no alternate primary exists", async () => {
    const existing = {
      id: "workspace-1",
      companyId: "company-1",
      projectId: "project-1",
      name: "runtime",
      cwd: "/repo/runtime",
      repoUrl: null,
      repoRef: null,
      metadata: null,
      isPrimary: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const updated = {
      ...existing,
      name: "runtime-main",
      repoUrl: "https://github.com/acme/runtime",
      repoRef: "main",
      isPrimary: true,
      updatedAt: new Date(),
    };
    const { db, updateSets } = createProjectDbMock({
      selectResults: [
        [existing],
        [],
        [{ id: "workspace-1" }],
      ],
      updateResults: [[updated], [updated]],
    });
    const service = projectService(db as never);

    const row = await service.updateWorkspace("project-1", "workspace-1", {
      repoUrl: "https://github.com/acme/runtime",
      repoRef: "main",
    });

    expect(row).toMatchObject({
      id: "workspace-1",
      name: "runtime-main",
      repoUrl: "https://github.com/acme/runtime",
      repoRef: "main",
      isPrimary: true,
    });
    expect(updateSets.filter((entry) => entry.table === projectWorkspaces)).toHaveLength(1);
  });

  it("returns null when creating a workspace without a project or location", async () => {
    const project = {
      id: "project-1",
      companyId: "company-1",
      name: "Runtime",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const { db } = createProjectDbMock({
      selectResults: [
        [],
        [project],
      ],
    });
    const service = projectService(db as never);

    await expect(service.createWorkspace("project-missing", {
      cwd: "/repo/runtime",
    })).resolves.toBeNull();
    await expect(service.createWorkspace("project-1", {
      name: "invalid",
    })).resolves.toBeNull();
  });

  it("resolves references directly by id and by normalized url key", async () => {
    const runtime = {
      id: "123e4567-e89b-12d3-a456-426614174000",
      companyId: "company-1",
      name: "Runtime Core",
      goalId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const { db } = createProjectDbMock({
      selectResults: [
        [runtime],
        [runtime],
      ],
    });
    const service = projectService(db as never);

    await expect(service.resolveByReference("company-1", runtime.id)).resolves.toEqual({
      ambiguous: false,
      project: expect.objectContaining({ id: runtime.id }),
    });
    await expect(service.resolveByReference("company-1", "runtime-core")).resolves.toEqual({
      ambiguous: false,
      project: expect.objectContaining({ id: runtime.id }),
    });
  });
});
