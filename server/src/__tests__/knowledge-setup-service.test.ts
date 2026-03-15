import {
  companies,
  knowledgeSyncJobs,
  knowledgeSyncProjectRuns,
} from "@squadrail/db";
import { beforeEach, describe, expect, it, vi } from "vitest";

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";

const {
  mockEnqueueAfterDbCommit,
  mockProjectList,
  mockAgentList,
  mockAgentCreate,
  mockAgentUpdate,
  mockAgentPause,
  mockSetupGetView,
  mockImportProjectWorkspace,
  mockRebuildCompanyCodeGraph,
  mockRebuildCompanyDocumentVersions,
  mockBackfillProtocolFeedback,
  mockCanonicalTemplateForCompanyName,
  mockResolveCanonicalTemplateForCompany,
} = vi.hoisted(() => ({
  mockEnqueueAfterDbCommit: vi.fn(),
  mockProjectList: vi.fn(),
  mockAgentList: vi.fn(),
  mockAgentCreate: vi.fn(),
  mockAgentUpdate: vi.fn(),
  mockAgentPause: vi.fn(),
  mockSetupGetView: vi.fn(),
  mockImportProjectWorkspace: vi.fn(),
  mockRebuildCompanyCodeGraph: vi.fn(),
  mockRebuildCompanyDocumentVersions: vi.fn(),
  mockBackfillProtocolFeedback: vi.fn(),
  mockCanonicalTemplateForCompanyName: vi.fn(),
  mockResolveCanonicalTemplateForCompany: vi.fn(),
}));

vi.mock("@squadrail/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@squadrail/db")>();
  return {
    ...actual,
    enqueueAfterDbCommit: mockEnqueueAfterDbCommit,
  };
});

vi.mock("../services/projects.js", () => ({
  projectService: () => ({
    list: mockProjectList,
  }),
}));

vi.mock("../services/agents.js", () => ({
  agentService: () => ({
    list: mockAgentList,
    create: mockAgentCreate,
    update: mockAgentUpdate,
    pause: mockAgentPause,
  }),
}));

vi.mock("../services/setup-progress.js", () => ({
  setupProgressService: () => ({
    getView: mockSetupGetView,
  }),
}));

vi.mock("../services/knowledge-import.js", () => ({
  knowledgeImportService: () => ({
    importProjectWorkspace: mockImportProjectWorkspace,
  }),
}));

vi.mock("../services/knowledge-backfill.js", () => ({
  knowledgeBackfillService: () => ({
    rebuildCompanyCodeGraph: mockRebuildCompanyCodeGraph,
    rebuildCompanyDocumentVersions: mockRebuildCompanyDocumentVersions,
  }),
}));

vi.mock("../services/retrieval-personalization.js", () => ({
  retrievalPersonalizationService: () => ({
    backfillProtocolFeedback: mockBackfillProtocolFeedback,
  }),
}));

vi.mock("../services/swiftsight-org-canonical.js", () => ({
  SWIFTSIGHT_CANONICAL_TEMPLATE_KEY: "swiftsight",
  SWIFTSIGHT_CANONICAL_VERSION: "1.0.0",
  canonicalTemplateForCompanyName: mockCanonicalTemplateForCompanyName,
  resolveCanonicalTemplateForCompany: mockResolveCanonicalTemplateForCompany,
  buildCanonicalLookupMaps: vi.fn(),
}));

import { knowledgeSetupService } from "../services/knowledge-setup.js";

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
    limit: () => chain,
    then: <T>(resolve: (value: unknown[]) => T | PromiseLike<T>) =>
      Promise.resolve(shiftTableRows(selectRows, selectedTable)).then(resolve),
  };
  return chain;
}

function createMutationResult(queueMap: Map<unknown, unknown[][]>, table: unknown) {
  return {
    returning: async () => shiftTableRows(queueMap, table),
    then: <T>(resolve: (value: undefined) => T | PromiseLike<T>) => Promise.resolve(undefined).then(resolve),
  };
}

function createKnowledgeSetupDbMock(input: {
  selectRows?: Map<unknown, unknown[][]>;
  insertRows?: Map<unknown, unknown[][]>;
  updateRows?: Map<unknown, unknown[][]>;
  executeRows?: unknown[][];
}) {
  const selectRows = input.selectRows ?? new Map();
  const insertRows = input.insertRows ?? new Map();
  const updateRows = input.updateRows ?? new Map();
  const executeQueue = [...(input.executeRows ?? [])];
  const insertValues: Array<{ table: unknown; value: unknown }> = [];
  const updateSets: Array<{ table: unknown; value: unknown }> = [];

  const db = {
    select: () => createResolvedSelectChain(selectRows),
    insert: (table: unknown) => ({
      values: (value: unknown) => {
        insertValues.push({ table, value });
        return createMutationResult(insertRows, table);
      },
    }),
    update: (table: unknown) => ({
      set: (value: unknown) => {
        updateSets.push({ table, value });
        return {
          where: () => createMutationResult(updateRows, table),
        };
      },
    }),
    execute: async () => executeQueue.shift() ?? [],
  };

  return {
    db: {
      ...db,
      transaction: async <T>(callback: (tx: typeof db) => Promise<T>) => callback(db),
    },
    insertValues,
    updateSets,
  };
}

describe("knowledge setup service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnqueueAfterDbCommit.mockReturnValue(true);
    mockProjectList.mockResolvedValue([]);
    mockAgentList.mockResolvedValue([]);
    mockSetupGetView.mockResolvedValue({ status: "engine_ready" });
    mockCanonicalTemplateForCompanyName.mockReturnValue(null);
    mockResolveCanonicalTemplateForCompany.mockReturnValue(null);
  });

  it("builds and caches the knowledge setup read model on cache miss", async () => {
    const now = new Date("2026-03-13T10:00:00.000Z");
    const { db } = createKnowledgeSetupDbMock({
      selectRows: new Map([
        [companies, [[{ id: COMPANY_ID, name: "Cloud Swiftsight" }]]],
        [knowledgeSyncJobs, [[{
          id: "job-1",
          companyId: COMPANY_ID,
          status: "completed",
          selectedProjectIds: [],
          optionsJson: {},
          summaryJson: { selectedProjectCount: 0 },
          error: null,
          startedAt: now,
          completedAt: now,
          createdAt: now,
          updatedAt: now,
        }]]],
        [knowledgeSyncProjectRuns, [[{
          id: "project-run-1",
          jobId: "job-1",
          projectId: "project-1",
          workspaceId: null,
          status: "completed",
          stepJson: {},
          resultJson: {},
          error: null,
          createdAt: now,
          updatedAt: now,
        }]]],
      ]),
      executeRows: [[], [], [], [], [], []],
    });
    const service = knowledgeSetupService(db as never);

    const first = await service.getKnowledgeSetup(COMPANY_ID);
    const second = await service.getKnowledgeSetup(COMPANY_ID);

    expect(first.companyId).toBe(COMPANY_ID);
    expect(first.setupProgressStatus).toBe("engine_ready");
    expect(first.recentJobs).toHaveLength(1);
    expect(first.cache.state).toBe("miss");
    expect(second.cache.state).toBe("fresh");
  });

  it("returns org sync views from canonical templates and can look up individual sync jobs", async () => {
    mockResolveCanonicalTemplateForCompany.mockReturnValue({
      templateKey: "swiftsight",
      canonicalVersion: "1.0.0",
      agents: [
        {
          canonicalSlug: "pm",
          legacySlugs: [],
          name: "PM",
          role: "pm",
          title: "Product Manager",
          reportsToSlug: null,
          projectSlug: "runtime",
          deliveryLane: "pm",
          capabilities: "Plan delivery",
          adapterType: "codex_local",
          adapterConfig: {},
          runtimeConfig: {},
          metadata: { bootstrapSlug: "pm" },
        },
      ],
    });
    mockAgentList.mockResolvedValue([
      {
        id: "agent-pm",
        companyId: COMPANY_ID,
        name: "PM",
        urlKey: "pm",
        role: "pm",
        title: "Product Manager",
        reportsTo: null,
        adapterType: "codex_local",
        metadata: { bootstrapSlug: "pm" },
        status: "active",
      },
    ]);
    const now = new Date("2026-03-13T10:30:00.000Z");
    const { db } = createKnowledgeSetupDbMock({
      selectRows: new Map([
        [companies, [[{ id: COMPANY_ID, name: "Cloud Swiftsight" }]]],
        [knowledgeSyncJobs, [[{
          id: "job-lookup-1",
          companyId: COMPANY_ID,
          status: "completed",
          selectedProjectIds: ["project-1"],
          optionsJson: {},
          summaryJson: { selectedProjectCount: 1 },
          error: null,
          startedAt: now,
          completedAt: now,
          createdAt: now,
          updatedAt: now,
        }], [{
          id: "job-lookup-1",
          companyId: COMPANY_ID,
          status: "completed",
          selectedProjectIds: ["project-1"],
          optionsJson: {},
          summaryJson: { selectedProjectCount: 1 },
          error: null,
          startedAt: now,
          completedAt: now,
          createdAt: now,
          updatedAt: now,
        }]]],
        [knowledgeSyncProjectRuns, [[{
          id: "project-run-lookup-1",
          jobId: "job-lookup-1",
          projectId: "project-1",
          workspaceId: "workspace-1",
          status: "completed",
          stepJson: {},
          resultJson: {},
          error: null,
          createdAt: now,
          updatedAt: now,
        }], [{
          id: "project-run-lookup-1",
          jobId: "job-lookup-1",
          projectId: "project-1",
          workspaceId: "workspace-1",
          status: "completed",
          stepJson: {},
          resultJson: {},
          error: null,
          createdAt: now,
          updatedAt: now,
        }]]],
      ]),
    });
    const service = knowledgeSetupService(db as never);

    await expect(service.getOrgSync(COMPANY_ID)).resolves.toMatchObject({
      companyId: COMPANY_ID,
      templateKey: "swiftsight",
      status: "repairable",
    });
    expect(mockResolveCanonicalTemplateForCompany.mock.calls.at(-1)).toEqual([
      expect.objectContaining({
        companyName: "Cloud Swiftsight",
      }),
      {
        allowHeuristicFootprint: true,
      },
    ]);
    await expect(service.getKnowledgeSyncJob(COMPANY_ID, "job-lookup-1")).resolves.toMatchObject({
      id: "job-lookup-1",
      projectRuns: [
        expect.objectContaining({
          id: "project-run-lookup-1",
        }),
      ],
    });
    await expect(service.getKnowledgeSyncJob(COMPANY_ID, "missing-job")).resolves.toBeNull();
  });

  it("creates a sync job and executes it immediately when after-commit scheduling is unavailable", async () => {
    mockEnqueueAfterDbCommit.mockReturnValue(false);
    mockProjectList
      .mockResolvedValueOnce([
        {
          id: "project-1",
          name: "Runtime",
          primaryWorkspace: { id: "workspace-1" },
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "project-1",
          name: "Runtime",
          primaryWorkspace: { id: "workspace-1" },
        },
      ]);
    mockImportProjectWorkspace.mockResolvedValue({
      importMode: "delta",
      documentCount: 3,
    });
    mockRebuildCompanyCodeGraph.mockResolvedValue({ edges: 12 });
    mockRebuildCompanyDocumentVersions.mockResolvedValue({ versions: 4 });
    mockBackfillProtocolFeedback.mockResolvedValue({ profiles: 2 });

    const createdAt = new Date("2026-03-13T10:05:00.000Z");
    const insertedJob = {
      id: "job-sync-1",
      companyId: COMPANY_ID,
      status: "queued",
      selectedProjectIds: ["project-1"],
      optionsJson: {
        forceFull: false,
        maxFiles: 200,
        rebuildGraph: true,
        rebuildVersions: true,
        backfillPersonalization: true,
      },
      summaryJson: {
        selectedProjectCount: 1,
        completedProjectCount: 0,
        failedProjectCount: 0,
        globalSteps: {},
      },
      error: null,
      startedAt: null,
      completedAt: null,
      createdAt,
      updatedAt: createdAt,
    };
    const finalRun = {
      id: "project-run-1",
      jobId: "job-sync-1",
      projectId: "project-1",
      workspaceId: "workspace-1",
      status: "completed",
      stepJson: {
        importWorkspace: {
          status: "completed",
        },
      },
      resultJson: {
        importMode: "delta",
      },
      error: null,
      createdAt,
      updatedAt: createdAt,
    };
    const { db, insertValues, updateSets } = createKnowledgeSetupDbMock({
      selectRows: new Map([
        [knowledgeSyncJobs, [
          [],
          [insertedJob],
          [insertedJob],
        ]],
        [knowledgeSyncProjectRuns, [
          [{
            id: "project-run-1",
            jobId: "job-sync-1",
            projectId: "project-1",
            workspaceId: "workspace-1",
            status: "queued",
            stepJson: {},
            resultJson: {},
            error: null,
            createdAt,
            updatedAt: createdAt,
          }],
          [finalRun],
        ]],
      ]),
      insertRows: new Map([
        [knowledgeSyncJobs, [[insertedJob]]],
      ]),
    });
    const service = knowledgeSetupService(db as never);

    const created = await service.runKnowledgeSync(
      COMPANY_ID,
      { projectIds: ["project-1"], maxFiles: 200 },
      { actorType: "user", actorId: "user-1" },
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(created).toMatchObject({
      id: "job-sync-1",
      companyId: COMPANY_ID,
      status: "queued",
      projectRuns: [
        {
          id: "project-run-1",
          projectId: "project-1",
          status: "queued",
          workspaceId: "workspace-1",
        },
      ],
    });
    expect(insertValues.find((entry) => entry.table === knowledgeSyncJobs)?.value).toMatchObject({
      companyId: COMPANY_ID,
      requestedByActorType: "user",
      requestedByActorId: "user-1",
      selectedProjectIds: ["project-1"],
    });
    expect(insertValues.find((entry) => entry.table === knowledgeSyncProjectRuns)?.value).toEqual([
      expect.objectContaining({
        companyId: COMPANY_ID,
        projectId: "project-1",
        workspaceId: "workspace-1",
        status: "queued",
      }),
    ]);
    expect(mockImportProjectWorkspace).toHaveBeenCalledWith({
      projectId: "project-1",
      workspaceId: "workspace-1",
      maxFiles: 200,
      forceFull: false,
    });
    expect(mockRebuildCompanyCodeGraph).toHaveBeenCalledWith({
      companyId: COMPANY_ID,
      projectIds: ["project-1"],
    });
    expect(updateSets.filter((entry) => entry.table === knowledgeSyncJobs)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: knowledgeSyncJobs,
          value: expect.objectContaining({
            status: "running",
          }),
        }),
        expect.objectContaining({
          table: knowledgeSyncJobs,
          value: expect.objectContaining({
            status: "completed",
          }),
        }),
      ]),
    );
  });

  it("rejects knowledge sync requests when no projects are selected", async () => {
    mockEnqueueAfterDbCommit.mockReturnValue(false);
    mockProjectList.mockResolvedValue([]);
    const { db, insertValues, updateSets } = createKnowledgeSetupDbMock({
      selectRows: new Map([
        [knowledgeSyncJobs, [
          [],
        ]],
      ]),
    });
    const service = knowledgeSetupService(db as never);

    await expect(service.runKnowledgeSync(
      COMPANY_ID,
      { projectIds: [], forceFull: false },
      { actorType: "user", actorId: "user-1" },
    )).rejects.toThrow("No projects selected for knowledge sync");
    expect(insertValues).toEqual([]);
    expect(updateSets).toEqual([]);
  });

  it("repairs org sync by updating legacy agents, creating missing ones, and pausing extras", async () => {
    mockResolveCanonicalTemplateForCompany.mockReturnValue({
      templateKey: "swiftsight",
      canonicalVersion: "1.0.0",
      agents: [
        {
          canonicalSlug: "pm",
          legacySlugs: [],
          name: "PM",
          role: "pm",
          title: "Product Manager",
          reportsToSlug: null,
          projectSlug: "runtime",
          deliveryLane: "pm",
          capabilities: "Plan delivery",
          adapterType: "codex_local",
          adapterConfig: {},
          runtimeConfig: {},
          metadata: { bootstrapSlug: "pm", canonicalTemplateKey: "swiftsight" },
        },
        {
          canonicalSlug: "qa",
          legacySlugs: ["quality"],
          name: "QA",
          role: "qa",
          title: "QA Engineer",
          reportsToSlug: "pm",
          projectSlug: "runtime",
          deliveryLane: "qa",
          capabilities: "Verify delivery",
          adapterType: "codex_local",
          adapterConfig: {},
          runtimeConfig: {},
          metadata: { bootstrapSlug: "qa", canonicalTemplateKey: "swiftsight" },
        },
      ],
    });
    mockAgentList
      .mockResolvedValueOnce([
        {
          id: "agent-legacy-qa",
          companyId: COMPANY_ID,
          name: "Quality",
          urlKey: "quality",
          role: "qa",
          title: "QA Engineer",
          reportsTo: null,
          adapterType: "codex_local",
          metadata: { projectSlug: "wrong-project" },
          status: "active",
        },
        {
          id: "agent-extra",
          companyId: COMPANY_ID,
          name: "Python TL",
          urlKey: "python-tl",
          role: "tech_lead",
          title: "Lead",
          reportsTo: null,
          adapterType: "codex_local",
          metadata: {},
          status: "active",
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "agent-pm",
          companyId: COMPANY_ID,
          name: "PM",
          urlKey: "pm",
          role: "pm",
          title: "Product Manager",
          reportsTo: null,
          adapterType: "codex_local",
          metadata: { bootstrapSlug: "pm", canonicalTemplateKey: "swiftsight" },
          status: "active",
        },
        {
          id: "agent-legacy-qa",
          companyId: COMPANY_ID,
          name: "QA",
          urlKey: "qa",
          role: "qa",
          title: "QA Engineer",
          reportsTo: "agent-pm",
          adapterType: "codex_local",
          metadata: { bootstrapSlug: "qa", canonicalTemplateKey: "swiftsight" },
          status: "active",
        },
        {
          id: "agent-extra",
          companyId: COMPANY_ID,
          name: "Python TL",
          urlKey: "python-tl",
          role: "tech_lead",
          title: "Lead",
          reportsTo: null,
          adapterType: "codex_local",
          metadata: {},
          status: "paused",
        },
      ]);
    mockAgentCreate.mockResolvedValue({
      id: "agent-pm",
      companyId: COMPANY_ID,
      name: "PM",
      urlKey: "pm",
      role: "pm",
      title: "Product Manager",
      reportsTo: null,
      adapterType: "codex_local",
      metadata: { bootstrapSlug: "pm", canonicalTemplateKey: "swiftsight" },
      status: "active",
    });
    mockAgentUpdate.mockResolvedValue({
      id: "agent-legacy-qa",
      companyId: COMPANY_ID,
      name: "QA",
      urlKey: "qa",
      role: "qa",
      title: "QA Engineer",
      reportsTo: "agent-pm",
      adapterType: "codex_local",
      metadata: { bootstrapSlug: "qa", canonicalTemplateKey: "swiftsight" },
      status: "active",
    });
    mockAgentPause.mockResolvedValue({
      id: "agent-extra",
      status: "paused",
    });

    const { db } = createKnowledgeSetupDbMock({
      selectRows: new Map([
        [companies, [
          [{ id: COMPANY_ID, name: "Cloud Swiftsight" }],
          [{ id: COMPANY_ID, name: "Cloud Swiftsight" }],
        ]],
      ]),
    });
    const service = knowledgeSetupService(db as never);

    const result = await service.repairOrgSync(
      COMPANY_ID,
      {
        createMissing: true,
        repairMismatches: true,
        adoptLegacySingleEngineers: true,
        pauseLegacyExtras: true,
      },
      { actorType: "user", actorId: "user-1" },
    );

    expect(result.statusBefore).toBe("repairable");
    expect(result.statusAfter).toBe("repairable");
    expect(result.createdAgentIds).toEqual(["agent-pm"]);
    expect(result.updatedAgentIds).toEqual(["agent-legacy-qa"]);
    expect(result.pausedAgentIds).toEqual(["agent-extra"]);
    expect(result.adoptedAgentIds).toEqual(["agent-legacy-qa"]);
    expect(mockResolveCanonicalTemplateForCompany.mock.calls[0]).toEqual([
      expect.objectContaining({
        companyName: "Cloud Swiftsight",
      }),
    ]);
    expect(mockResolveCanonicalTemplateForCompany.mock.calls.at(-1)).toEqual([
      expect.objectContaining({
        companyName: "Cloud Swiftsight",
      }),
      {
        allowHeuristicFootprint: true,
      },
    ]);
  });
});
