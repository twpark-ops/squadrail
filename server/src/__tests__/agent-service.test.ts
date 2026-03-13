import {
  agentApiKeys,
  agentConfigRevisions,
  agentRuntimeState,
  agents,
  agentTaskSessions,
  agentWakeupRequests,
  heartbeatRunEvents,
  heartbeatRuns,
} from "@squadrail/db";
import { conflict } from "../errors.js";
import { describe, expect, it, vi } from "vitest";
import { agentService } from "../services/agents.js";

function createResolvedChain(rows: unknown[]) {
  const chain = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    then: <T>(resolve: (value: unknown[]) => T | PromiseLike<T>) => Promise.resolve(rows).then(resolve),
  };
  return chain;
}

function createAgentDbMock(input: {
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

function makeAgent(overrides: Partial<typeof agents.$inferSelect> = {}) {
  return {
    id: "agent-1",
    companyId: "company-1",
    name: "Release Captain",
    role: "tech_lead",
    title: "Release Captain",
    reportsTo: null,
    capabilities: "Coordinate releases",
    adapterType: "codex_local",
    adapterConfig: {},
    runtimeConfig: {},
    budgetMonthlyCents: 2_000,
    spentMonthlyCents: 0,
    status: "idle",
    permissions: { canCreateAgents: true },
    metadata: null,
    lastHeartbeatAt: null,
    createdAt: new Date("2026-03-13T09:00:00.000Z"),
    updatedAt: new Date("2026-03-13T09:00:00.000Z"),
    ...overrides,
  };
}

describe("agent service", () => {
  it("creates agents with normalized permissions and derived urlKey", async () => {
    const created = makeAgent();
    const { db, insertValues } = createAgentDbMock({
      insertResults: [[created]],
    });
    const service = agentService(db as never);

    const row = await service.create("company-1", {
      name: "Release Captain",
      role: "tech_lead",
      title: "Release Captain",
      reportsTo: null,
      capabilities: "Coordinate releases",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      budgetMonthlyCents: 2_000,
      spentMonthlyCents: 0,
      status: "idle",
      permissions: { canCreateAgents: true },
      metadata: null,
      lastHeartbeatAt: null,
    });

    expect(row).toMatchObject({
      id: "agent-1",
      urlKey: "release-captain",
    });
    expect(insertValues.find((entry) => entry.table === agents)?.value).toMatchObject({
      companyId: "company-1",
      role: "tech_lead",
    });
  });

  it("records a config revision when an update changes tracked fields", async () => {
    const existing = makeAgent();
    const updated = makeAgent({
      title: "Principal Release Captain",
      budgetMonthlyCents: 4_000,
    });
    const { db, insertValues, updateSets } = createAgentDbMock({
      selectResults: [[existing]],
      updateResults: [[updated]],
      insertResults: [[]],
    });
    const service = agentService(db as never);

    const row = await service.update("agent-1", {
      title: "Principal Release Captain",
      budgetMonthlyCents: 4_000,
    }, {
      recordRevision: {
        createdByUserId: "board-1",
        source: "patch",
      },
    });

    expect(row).toMatchObject({
      title: "Principal Release Captain",
      budgetMonthlyCents: 4_000,
    });
    expect(updateSets.find((entry) => entry.table === agents)?.value).toMatchObject({
      title: "Principal Release Captain",
      budgetMonthlyCents: 4_000,
    });
    expect(insertValues.find((entry) => entry.table === agentConfigRevisions)?.value).toMatchObject({
      companyId: "company-1",
      agentId: "agent-1",
      createdByUserId: "board-1",
      source: "patch",
      changedKeys: expect.arrayContaining(["title", "budgetMonthlyCents"]),
    });
  });

  it("removes an agent and cascades dependent runtime records", async () => {
    const existing = makeAgent();
    const { db, deletedTables, updateSets } = createAgentDbMock({
      selectResults: [[existing]],
      deleteResults: [[existing]],
    });
    const service = agentService(db as never);

    const removed = await service.remove("agent-1");

    expect(removed).toMatchObject({
      id: "agent-1",
      urlKey: "release-captain",
    });
    expect(updateSets.find((entry) => entry.table === agents)?.value).toMatchObject({
      reportsTo: null,
    });
    expect(deletedTables).toEqual([
      heartbeatRunEvents,
      agentTaskSessions,
      heartbeatRuns,
      agentWakeupRequests,
      agentApiKeys,
      agentRuntimeState,
      agents,
    ]);
  });

  it("creates and revokes API keys and resolves by reference", async () => {
    const existing = makeAgent();
    const keyRow = {
      id: "key-1",
      agentId: "agent-1",
      companyId: "company-1",
      name: "Primary key",
      keyHash: "hash",
      createdAt: new Date("2026-03-13T10:00:00.000Z"),
    };
    const revoked = {
      ...keyRow,
      revokedAt: new Date("2026-03-13T10:30:00.000Z"),
    };
    const { db, insertValues, updateSets } = createAgentDbMock({
      selectResults: [
        [existing],
        [makeAgent({ id: "agent-1", name: "Release Captain" })],
      ],
      insertResults: [[keyRow]],
      updateResults: [[revoked]],
    });
    const service = agentService(db as never);

    const created = await service.createApiKey("agent-1", "Primary key");
    const revokedKey = await service.revokeKey("key-1");
    const resolved = await service.resolveByReference("company-1", "Release Captain");

    expect(created).toMatchObject({
      id: "key-1",
      name: "Primary key",
      token: expect.stringMatching(/^pcp_/),
    });
    expect(insertValues.find((entry) => entry.table === agentApiKeys)?.value).toMatchObject({
      agentId: "agent-1",
      companyId: "company-1",
      name: "Primary key",
    });
    expect(updateSets.find((entry) => entry.table === agentApiKeys)?.value).toMatchObject({
      revokedAt: expect.any(Date),
    });
    expect(revokedKey).toEqual(revoked);
    expect(resolved).toEqual({
      agent: expect.objectContaining({ id: "agent-1" }),
      ambiguous: false,
    });
  });

  it("refuses to resume a pending approval agent", async () => {
    const { db } = createAgentDbMock({
      selectResults: [[makeAgent({ status: "pending_approval" })]],
    });
    const service = agentService(db as never);

    await expect(service.resume("agent-1")).rejects.toMatchObject(conflict("Pending approval agents cannot be resumed"));
  });

  it("activates pending approval agents and normalizes permission-only updates", async () => {
    const pending = makeAgent({ status: "pending_approval", permissions: { canCreateAgents: false } });
    const activated = makeAgent({ status: "idle", permissions: { canCreateAgents: false } });
    const updatedPermissions = makeAgent({ permissions: { canCreateAgents: true } });
    const { db, updateSets } = createAgentDbMock({
      selectResults: [[pending], [makeAgent()]],
      updateResults: [[activated], [updatedPermissions]],
    });
    const service = agentService(db as never);

    const activatedRow = await service.activatePendingApproval("agent-1");
    const updatedRow = await service.updatePermissions("agent-1", { canCreateAgents: true });

    expect(activatedRow).toMatchObject({ status: "idle" });
    expect(updatedRow).toMatchObject({
      permissions: expect.objectContaining({ canCreateAgents: true }),
    });
    expect(updateSets.find((entry) => entry.table === agents)?.value).toMatchObject({
      status: "idle",
    });
  });

  it("filters terminated agents from list by default and keeps them when requested", async () => {
    const active = makeAgent({ id: "agent-active", status: "idle" });
    const terminated = makeAgent({ id: "agent-terminated", status: "terminated", name: "Former Agent" });
    const { db } = createAgentDbMock({
      selectResults: [
        [active],
        [active, terminated],
      ],
    });
    const service = agentService(db as never);

    const visible = await service.list("company-1");
    const all = await service.list("company-1", { includeTerminated: true });

    expect(visible).toEqual([expect.objectContaining({ id: "agent-active" })]);
    expect(all).toEqual([
      expect.objectContaining({ id: "agent-active" }),
      expect.objectContaining({ id: "agent-terminated" }),
    ]);
  });

  it("pauses active agents and refuses to pause terminated agents", async () => {
    const paused = makeAgent({ status: "paused" });
    const { db, updateSets } = createAgentDbMock({
      selectResults: [
        [makeAgent({ status: "idle" })],
        [makeAgent({ status: "terminated" })],
      ],
      updateResults: [[paused]],
    });
    const service = agentService(db as never);

    const row = await service.pause("agent-1");

    expect(row).toMatchObject({ status: "paused" });
    expect(updateSets.find((entry) => entry.table === agents)?.value).toMatchObject({
      status: "paused",
    });
    await expect(service.pause("agent-1")).rejects.toMatchObject(conflict("Cannot pause terminated agent"));
  });

  it("terminates agents and revokes their keys", async () => {
    const terminated = makeAgent({ status: "terminated" });
    const { db, updateSets } = createAgentDbMock({
      selectResults: [
        [makeAgent({ status: "idle" })],
        [terminated],
      ],
      updateResults: [[], []],
    });
    const service = agentService(db as never);

    const row = await service.terminate("agent-1");

    expect(row).toMatchObject({
      id: "agent-1",
      status: "terminated",
    });
    expect(updateSets).toContainEqual({
      table: agents,
      value: expect.objectContaining({
        status: "terminated",
      }),
    });
    expect(updateSets).toContainEqual({
      table: agentApiKeys,
      value: expect.objectContaining({
        revokedAt: expect.any(Date),
      }),
    });
  });

  it("rejects api key creation for pending approval and terminated agents", async () => {
    const { db } = createAgentDbMock({
      selectResults: [
        [makeAgent({ status: "pending_approval" })],
        [makeAgent({ status: "terminated" })],
      ],
    });
    const service = agentService(db as never);

    await expect(service.createApiKey("agent-1", "Pending")).rejects.toMatchObject(
      conflict("Cannot create keys for pending approval agents"),
    );
    await expect(service.createApiKey("agent-1", "Terminated")).rejects.toMatchObject(
      conflict("Cannot create keys for terminated agents"),
    );
  });

  it("lists config revisions, loads a specific revision, and handles empty references", async () => {
    const revision = {
      id: "revision-1",
      agentId: "agent-1",
      createdAt: new Date("2026-03-13T11:00:00.000Z"),
    };
    const { db } = createAgentDbMock({
      selectResults: [
        [revision],
        [revision],
      ],
    });
    const service = agentService(db as never);

    await expect(service.listConfigRevisions("agent-1")).resolves.toEqual([revision]);
    await expect(service.getConfigRevision("agent-1", "revision-1")).resolves.toEqual(revision);
    await expect(service.resolveByReference("company-1", "   ")).resolves.toEqual({
      agent: null,
      ambiguous: false,
    });
  });

  it("rejects rollback when the revision snapshot still contains redacted secret markers", async () => {
    const revision = {
      id: "revision-1",
      agentId: "agent-1",
      afterConfig: {
        name: "Release Captain",
        role: "tech_lead",
        adapterType: "codex_local",
        budgetMonthlyCents: 2000,
        adapterConfig: {
          env: {
            OPENAI_API_KEY: "***REDACTED***",
          },
        },
        runtimeConfig: {},
        metadata: null,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const { db } = createAgentDbMock({
      selectResults: [[revision]],
    });
    const service = agentService(db as never);

    await expect(service.rollbackConfigRevision("agent-1", "revision-1", { userId: "board-1" })).rejects.toThrow(
      "Cannot roll back a revision that contains redacted secret values",
    );
  });

  it("builds org trees and chains of command from normalized agent rows", async () => {
    const cto = makeAgent({
      id: "agent-cto",
      name: "CTO",
      role: "cto",
      title: "CTO",
      reportsTo: null,
    });
    const lead = makeAgent({
      id: "agent-lead",
      name: "Lead",
      role: "tech_lead",
      reportsTo: "agent-cto",
    });
    const engineer = makeAgent({
      id: "agent-eng",
      name: "Engineer",
      role: "engineer",
      reportsTo: "agent-lead",
    });
    const { db } = createAgentDbMock({
      selectResults: [
        [cto, lead, engineer],
        [engineer],
        [lead],
        [cto],
      ],
    });
    const service = agentService(db as never);

    const org = await service.orgForCompany("company-1");
    const chain = await service.getChainOfCommand("agent-eng");

    expect(org).toEqual([
      expect.objectContaining({
        id: "agent-cto",
        reports: [
          expect.objectContaining({
            id: "agent-lead",
            reports: [
              expect.objectContaining({ id: "agent-eng" }),
            ],
          }),
        ],
      }),
    ]);
    expect(chain).toEqual([
      { id: "agent-lead", name: "Lead", role: "tech_lead", title: "Release Captain" },
      { id: "agent-cto", name: "CTO", role: "cto", title: "CTO" },
    ]);
  });
});
