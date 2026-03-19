import {
  agents,
  issues,
  knowledgeDocuments,
  projectWorkspaces,
  projects,
  rolePackSets,
  setupProgress,
} from "@squadrail/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupProgressService } from "../services/setup-progress.js";

function shiftTableRows(queueMap: Map<unknown, unknown[][]>, table: unknown) {
  const queue = queueMap.get(table);
  return queue?.shift() ?? [];
}

function createResolvedSelectChain(selectRows: Map<unknown, unknown[][]>) {
  let selectedTable: unknown = null;
  const chain = {
    from: (table: unknown) => {
      selectedTable = table;
      return chain;
    },
    where: () => chain,
    orderBy: () => chain,
    then: <T>(resolve: (value: unknown[]) => T | PromiseLike<T>) =>
      Promise.resolve(shiftTableRows(selectRows, selectedTable)).then(resolve),
  };
  return chain;
}

function createSetupProgressDbMock(input?: {
  selectRows?: Map<unknown, unknown[][]>;
}) {
  const selectRows = input?.selectRows ?? new Map();
  const insertValues: Array<{ table: unknown; value: unknown }> = [];
  const conflictSets: Array<{ table: unknown; value: unknown }> = [];

  const db = {
    select: () => createResolvedSelectChain(selectRows),
    insert: (table: unknown) => ({
      values: (value: unknown) => {
        insertValues.push({ table, value });
        return {
          onConflictDoUpdate: (config: { set: unknown }) => {
            conflictSets.push({ table, value: config.set });
            return Promise.resolve();
          },
        };
      },
    }),
  };

  return { db, insertValues, conflictSets };
}

describe("setup progress service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("derives a fully ready view from live role-pack, knowledge, and issue counts", async () => {
    const { db } = createSetupProgressDbMock({
      selectRows: new Map([
        [setupProgress, [[{
          companyId: "company-1",
          status: "company_ready",
          selectedEngine: "codex_local",
          selectedWorkspaceId: "workspace-1",
          metadata: {},
          createdAt: new Date("2026-03-13T08:00:00.000Z"),
          updatedAt: new Date("2026-03-13T08:00:00.000Z"),
        }]]],
        [rolePackSets, [[{ count: 2 }]]],
        [knowledgeDocuments, [[{ count: 5 }]]],
        [issues, [[{ count: 3 }]]],
      ]),
    });
    const service = setupProgressService(db as never);

    const view = await service.getView("company-1");

    expect(view.status).toBe("first_issue_ready");
    expect(view.steps).toEqual({
      companyReady: true,
      squadReady: true,
      engineReady: true,
      workspaceConnected: true,
      knowledgeSeeded: true,
      firstIssueReady: true,
    });
  });

  it("recovers setup progress from live projects, workspaces, agents, knowledge, and issues when no row exists", async () => {
    const { db } = createSetupProgressDbMock({
      selectRows: new Map([
        [setupProgress, [[]]],
        [rolePackSets, [[{ count: 0 }]]],
        [knowledgeDocuments, [[{ count: 7 }]]],
        [issues, [[{ count: 9 }]]],
        [projects, [[{ count: 2 }]]],
        [agents, [[{ count: 4 }], [
          {
            id: "agent-1",
            companyId: "company-1",
            name: "TL",
            role: "engineer",
            adapterType: "claude_local",
            status: "idle",
          },
          {
            id: "agent-2",
            companyId: "company-1",
            name: "Engineer",
            role: "engineer",
            adapterType: "claude_local",
            status: "idle",
          },
          {
            id: "agent-3",
            companyId: "company-1",
            name: "Coder",
            role: "engineer",
            adapterType: "codex_local",
            status: "idle",
          },
        ]]],
        [projectWorkspaces, [[
          {
            id: "workspace-primary",
            companyId: "company-1",
            projectId: "project-1",
            name: "shared",
            cwd: "/tmp/workspace",
            repoUrl: null,
            repoRef: null,
            metadata: null,
            isPrimary: true,
            createdAt: new Date("2026-03-13T08:00:00.000Z"),
            updatedAt: new Date("2026-03-13T08:00:00.000Z"),
          },
          {
            id: "workspace-secondary",
            companyId: "company-1",
            projectId: "project-2",
            name: "secondary",
            cwd: "/tmp/workspace-2",
            repoUrl: null,
            repoRef: null,
            metadata: null,
            isPrimary: false,
            createdAt: new Date("2026-03-13T09:00:00.000Z"),
            updatedAt: new Date("2026-03-13T09:00:00.000Z"),
          },
        ]]],
      ]),
    });
    const service = setupProgressService(db as never);

    const view = await service.getView("company-1");

    expect(view.status).toBe("first_issue_ready");
    expect(view.selectedEngine).toBe("claude_local");
    expect(view.selectedWorkspaceId).toBe("workspace-primary");
    expect(view.steps).toEqual({
      companyReady: true,
      squadReady: true,
      engineReady: true,
      workspaceConnected: true,
      knowledgeSeeded: true,
      firstIssueReady: true,
    });
  });

  it("upserts merged metadata and promotes status based on refreshed counts", async () => {
    const initialRow = {
      companyId: "company-1",
      status: "engine_ready",
      selectedEngine: "claude_local",
      selectedWorkspaceId: null,
      metadata: {
        rolePacksSeeded: true,
      },
      createdAt: new Date("2026-03-13T08:00:00.000Z"),
      updatedAt: new Date("2026-03-13T08:00:00.000Z"),
    };
    const updatedRow = {
      ...initialRow,
      status: "first_issue_ready",
      selectedWorkspaceId: "workspace-1",
      metadata: {
        rolePacksSeeded: true,
        knowledgeSeeded: true,
        firstIssueReady: true,
      },
      updatedAt: new Date("2026-03-13T09:00:00.000Z"),
    };
    const { db, insertValues, conflictSets } = createSetupProgressDbMock({
      selectRows: new Map([
        [setupProgress, [[initialRow], [updatedRow]]],
        [rolePackSets, [[{ count: 1 }], [{ count: 1 }], [{ count: 1 }]]],
        [knowledgeDocuments, [[{ count: 4 }], [{ count: 4 }], [{ count: 4 }]]],
        [issues, [[{ count: 2 }], [{ count: 2 }], [{ count: 2 }]]],
      ]),
    });
    const service = setupProgressService(db as never);

    const updated = await service.update("company-1", {
      selectedWorkspaceId: "workspace-1",
      metadata: {
        knowledgeSeeded: true,
        firstIssueReady: true,
      },
    });

    expect(insertValues[0]).toMatchObject({
      table: setupProgress,
      value: expect.objectContaining({
        companyId: "company-1",
        selectedWorkspaceId: "workspace-1",
        status: "first_issue_ready",
        metadata: {
          rolePacksSeeded: true,
          knowledgeSeeded: true,
          firstIssueReady: true,
        },
      }),
    });
    expect(conflictSets[0]).toMatchObject({
      table: setupProgress,
      value: expect.objectContaining({
        status: "first_issue_ready",
      }),
    });
    expect(updated.status).toBe("first_issue_ready");
    expect(updated.steps.firstIssueReady).toBe(true);
  });
});
