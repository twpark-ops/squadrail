import { rolePackFiles, rolePackRevisions, rolePackSets } from "@squadrail/db";
import { describe, expect, it } from "vitest";
import { rolePackService } from "../services/role-packs.js";

function createResolvedChain(rows: unknown[]) {
  const chain = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    then: <T>(resolve: (value: unknown[]) => T | PromiseLike<T>) =>
      Promise.resolve(rows).then(resolve),
  };
  return chain;
}

function createRolePackDbMock(input: {
  selectResults?: unknown[][];
  insertResults?: Array<unknown[] | Error>;
  updateResults?: unknown[][];
}) {
  const selectQueue = [...(input.selectResults ?? [])];
  const insertQueue = [...(input.insertResults ?? [])];
  const updateQueue = [...(input.updateResults ?? [])];
  const insertValues: Array<{ table: unknown; value: unknown }> = [];
  const updateSets: Array<{ table: unknown; value: unknown }> = [];

  const db = {
    select: () => createResolvedChain(selectQueue.shift() ?? []),
    insert: (table: unknown) => ({
      values: (value: unknown) => {
        insertValues.push({ table, value });
        const next = insertQueue.shift();
        if (next instanceof Error) throw next;
        return {
          returning: async () => next ?? [],
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
    transaction: async <T>(callback: (tx: typeof db) => Promise<T>) => callback(db),
  };

  return {
    db,
    insertValues,
    updateSets,
  };
}

describe("role pack service", () => {
  it("lists role packs with the latest revision and files", async () => {
    const { db } = createRolePackDbMock({
      selectResults: [
        [
          {
            id: "set-1",
            companyId: "company-1",
            scopeType: "company",
            scopeId: "",
            roleKey: "tech_lead",
            status: "published",
            metadata: {},
            createdAt: new Date("2026-03-13T08:00:00.000Z"),
            updatedAt: new Date("2026-03-13T08:00:00.000Z"),
          },
        ],
        [
          {
            id: "rev-2",
            rolePackSetId: "set-1",
            version: 2,
            status: "published",
            message: "Latest published revision",
            createdByUserId: "board-1",
            createdByAgentId: null,
            createdAt: new Date("2026-03-13T09:00:00.000Z"),
            publishedAt: new Date("2026-03-13T09:00:00.000Z"),
          },
          {
            id: "rev-1",
            rolePackSetId: "set-1",
            version: 1,
            status: "draft",
            message: "Initial draft",
            createdByUserId: "board-1",
            createdByAgentId: null,
            createdAt: new Date("2026-03-12T09:00:00.000Z"),
            publishedAt: null,
          },
        ],
        [
          {
            id: "file-1",
            revisionId: "rev-2",
            filename: "ROLE.md",
            content: "# Tech Lead\n\nLead the delivery plan.",
            checksumSha256: "checksum-1",
            createdAt: new Date("2026-03-13T09:00:00.000Z"),
          },
        ],
      ],
    });
    const service = rolePackService(db as never);

    const packs = await service.listRolePacks({
      companyId: "company-1",
      scopeType: "company",
      scopeId: null,
    });

    expect(packs).toEqual([
      expect.objectContaining({
        id: "set-1",
        displayName: "Tech Lead",
        latestRevision: expect.objectContaining({
          id: "rev-2",
          version: 2,
        }),
        latestFiles: [
          expect.objectContaining({
            filename: "ROLE.md",
            content: "# Tech Lead\n\nLead the delivery plan.",
          }),
        ],
      }),
    ]);
  });

  it("creates a custom role pack and returns the assembled latest revision", async () => {
    const createdSet = {
      id: "set-1",
      companyId: "company-1",
      scopeType: "company",
      scopeId: "custom:release-captain",
      roleKey: "custom",
      status: "published",
      metadata: {
        customRoleName: "Release Captain",
        customRoleSlug: "release-captain",
        customRoleDescription: "Own release orchestration",
        baseRoleKey: "tech_lead",
      },
      createdAt: new Date("2026-03-13T09:00:00.000Z"),
      updatedAt: new Date("2026-03-13T09:00:00.000Z"),
    };
    const createdRevision = {
      id: "rev-1",
      rolePackSetId: "set-1",
      version: 1,
      status: "published",
      message: "Create custom role Release Captain",
      createdByUserId: "board-1",
      createdByAgentId: null,
      createdAt: new Date("2026-03-13T09:01:00.000Z"),
      publishedAt: new Date("2026-03-13T09:01:00.000Z"),
    };
    const { db, insertValues } = createRolePackDbMock({
      selectResults: [
        [],
        [createdSet],
        [createdRevision],
        [
          {
            id: "file-role",
            revisionId: "rev-1",
            filename: "ROLE.md",
            content: "# Release Captain",
            checksumSha256: "checksum-role",
            createdAt: new Date("2026-03-13T09:01:00.000Z"),
          },
          {
            id: "file-agents",
            revisionId: "rev-1",
            filename: "AGENTS.md",
            content: "# Release Captain agents",
            checksumSha256: "checksum-agents",
            createdAt: new Date("2026-03-13T09:01:00.000Z"),
          },
        ],
      ],
      insertResults: [
        [createdSet],
        [createdRevision],
        [],
      ],
    });
    const service = rolePackService(db as never);

    const created = await service.createCustomRolePack({
      companyId: "company-1",
      actor: {
        userId: "board-1",
      },
      customRole: {
        roleName: "Release Captain",
        roleSlug: null,
        description: "Own release orchestration",
        baseRoleKey: "tech_lead",
        publish: true,
      },
    });

    expect(created).toMatchObject({
      id: "set-1",
      displayName: "Release Captain",
      baseRoleKey: "tech_lead",
      latestRevision: {
        id: "rev-1",
        version: 1,
      },
    });
    expect(insertValues).toContainEqual({
      table: rolePackSets,
      value: expect.objectContaining({
        companyId: "company-1",
        roleKey: "custom",
        scopeId: "custom:release-captain",
      }),
    });
    expect(insertValues).toContainEqual({
      table: rolePackRevisions,
      value: expect.objectContaining({
        rolePackSetId: "set-1",
        version: 1,
        status: "published",
      }),
    });
    expect(insertValues).toContainEqual({
      table: rolePackFiles,
      value: expect.arrayContaining([
        expect.objectContaining({
          revisionId: "rev-1",
          filename: "ROLE.md",
        }),
      ]),
    });
  });

  it("creates a published draft revision and refreshes the latest revision view", async () => {
    const set = {
      id: "set-1",
      companyId: "company-1",
      scopeType: "company",
      scopeId: "",
      roleKey: "tech_lead",
      status: "published",
      metadata: {},
      createdAt: new Date("2026-03-13T08:00:00.000Z"),
      updatedAt: new Date("2026-03-13T08:00:00.000Z"),
    };
    const latestRevision = {
      id: "rev-1",
      rolePackSetId: "set-1",
      version: 1,
      status: "published",
      message: "Initial revision",
      createdByUserId: "board-1",
      createdByAgentId: null,
      createdAt: new Date("2026-03-13T08:00:00.000Z"),
      publishedAt: new Date("2026-03-13T08:00:00.000Z"),
    };
    const refreshedRevision = {
      id: "rev-2",
      rolePackSetId: "set-1",
      version: 2,
      status: "published",
      message: "Publish improved tech lead pack",
      createdByUserId: "board-1",
      createdByAgentId: null,
      createdAt: new Date("2026-03-13T09:00:00.000Z"),
      publishedAt: new Date("2026-03-13T09:00:00.000Z"),
    };
    const { db, insertValues, updateSets } = createRolePackDbMock({
      selectResults: [
        [set],
        [latestRevision],
        [set],
        [refreshedRevision, latestRevision],
        [
          {
            id: "file-1",
            revisionId: "rev-2",
            filename: "ROLE.md",
            content: "# Updated Tech Lead",
            checksumSha256: "checksum-new",
            createdAt: new Date("2026-03-13T09:00:00.000Z"),
          },
        ],
      ],
      insertResults: [
        [refreshedRevision],
        [],
      ],
      updateResults: [[]],
    });
    const service = rolePackService(db as never);

    const updated = await service.createDraftRevision({
      companyId: "company-1",
      rolePackSetId: "set-1",
      actor: {
        userId: "board-1",
      },
      draft: {
        status: "published",
        message: "Publish improved tech lead pack",
        files: [
          {
            filename: "ROLE.md",
            content: "# Updated Tech Lead",
          },
        ],
      },
    });

    expect(updated).toMatchObject({
      id: "set-1",
      latestRevision: {
        id: "rev-2",
        version: 2,
      },
    });
    expect(insertValues).toContainEqual({
      table: rolePackRevisions,
      value: expect.objectContaining({
        rolePackSetId: "set-1",
        version: 2,
        status: "published",
      }),
    });
    expect(updateSets).toContainEqual({
      table: rolePackSets,
      value: expect.objectContaining({
        status: "published",
        updatedAt: expect.any(Date),
      }),
    });
  });

  it("simulates a role pack with runtime prompt, checklist, and suggestions", async () => {
    const { db } = createRolePackDbMock({
      selectResults: [
        [
          {
            id: "set-1",
            companyId: "company-1",
            scopeType: "company",
            scopeId: "",
            roleKey: "engineer",
            status: "published",
            metadata: {},
            createdAt: new Date("2026-03-13T08:00:00.000Z"),
            updatedAt: new Date("2026-03-13T08:00:00.000Z"),
          },
        ],
        [
          {
            id: "rev-1",
            rolePackSetId: "set-1",
            version: 1,
            status: "published",
            message: "Initial revision",
            createdByUserId: "board-1",
            createdByAgentId: null,
            createdAt: new Date("2026-03-13T08:00:00.000Z"),
            publishedAt: new Date("2026-03-13T08:00:00.000Z"),
          },
        ],
        [
          {
            id: "file-role",
            revisionId: "rev-1",
            filename: "ROLE.md",
            content: "# Engineer\n\n- Do not skip evidence.\n- Never close without tests.",
            checksumSha256: "checksum-role",
            createdAt: new Date("2026-03-13T08:00:00.000Z"),
          },
          {
            id: "file-agents",
            revisionId: "rev-1",
            filename: "AGENTS.md",
            content: "# Agent Guide",
            checksumSha256: "checksum-agents",
            createdAt: new Date("2026-03-13T08:00:00.000Z"),
          },
        ],
      ],
    });
    const service = rolePackService(db as never);

    const simulation = await service.simulateRolePack({
      companyId: "company-1",
      rolePackSetId: "set-1",
      simulation: {
        scenario: {
          workflowState: "implementing",
          messageType: "NOTE",
          issueTitle: "Stabilize runtime dispatch",
          issueSummary: "Fix watchdog and retry drift",
          acceptanceCriteria: ["Heartbeat finishes reliably"],
          changedFiles: ["server/src/services/heartbeat.ts"],
          reviewFindings: [],
          taskBrief: "Keep the retry window narrow.",
          retrievalSummary: "Previous failures clustered around watchdog timeouts.",
          blockerCode: null,
        },
      },
    });

    expect(simulation).toMatchObject({
      companyId: "company-1",
      rolePackSetId: "set-1",
      roleKey: "engineer",
      revisionId: "rev-1",
    });
    expect(simulation?.runtimePrompt).toContain("Protocol transport rule");
    expect(simulation?.runtimePrompt).toContain("SQUADRAIL_PROTOCOL_HELPER_PATH");
    expect(simulation?.checklist.length).toBeGreaterThan(0);
    expect(simulation?.guardrails).toEqual(
      expect.arrayContaining(["Do not skip evidence.", "Never close without tests."]),
    );
    expect(simulation?.suggestedMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          messageType: "REPORT_PROGRESS",
        }),
        expect.objectContaining({
          messageType: "SUBMIT_FOR_REVIEW",
        }),
      ]),
    );
  });
});
