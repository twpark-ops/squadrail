import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@squadrail/db";
import {
  describeSavedTeamBlueprintVersionChanges,
  resolveSavedTeamBlueprintLifecycleState,
  type SetupProgressView,
} from "@squadrail/shared";

const {
  mockProjectList,
  mockProjectCreate,
  mockProjectUpdate,
  mockAgentList,
  mockAgentCreate,
  mockAgentUpdate,
  mockSetupGetView,
  mockSetupUpdate,
  mockSeedDefaults,
} = vi.hoisted(() => ({
  mockProjectList: vi.fn(),
  mockProjectCreate: vi.fn(),
  mockProjectUpdate: vi.fn(),
  mockAgentList: vi.fn(),
  mockAgentCreate: vi.fn(),
  mockAgentUpdate: vi.fn(),
  mockSetupGetView: vi.fn(),
  mockSetupUpdate: vi.fn(),
  mockSeedDefaults: vi.fn(),
}));

vi.mock("../services/projects.js", () => ({
  projectService: () => ({
    list: mockProjectList,
    create: mockProjectCreate,
    update: mockProjectUpdate,
  }),
}));

vi.mock("../services/agents.js", () => ({
  agentService: () => ({
    list: mockAgentList,
    create: mockAgentCreate,
    update: mockAgentUpdate,
  }),
}));

vi.mock("../services/setup-progress.js", () => ({
  setupProgressService: () => ({
    getView: mockSetupGetView,
    update: mockSetupUpdate,
  }),
}));

vi.mock("../services/role-packs.js", () => ({
  rolePackService: () => ({
    seedDefaults: mockSeedDefaults,
  }),
}));

import {
  buildTeamBlueprintExportBundle,
  listTeamBlueprints,
  teamBlueprintService,
} from "../services/team-blueprints.js";

type MutableProject = {
  id: string;
  companyId: string;
  name: string;
  urlKey: string;
  workspaces: Array<{ id: string }>;
  leadAgentId?: string | null;
};

type MutableAgent = {
  id: string;
  companyId: string;
  name: string;
  urlKey: string;
  role: string;
  title: string | null;
  reportsTo: string | null;
  metadata: Record<string, unknown> | null;
};

type HarnessState = {
  projects: MutableProject[];
  agents: MutableAgent[];
  setupView: SetupProgressView;
  seededPresetKeys: string[];
  savedBlueprints: Array<{
    id: string;
    companyScope: string;
    companyId: string;
    slug: string;
    label: string;
    description: string | null;
    sourceBlueprintKey: string | null;
    definition: Record<string, unknown>;
    defaultPreviewRequest: Record<string, unknown>;
    sourceMetadata: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date;
  }>;
};

function buildSetupView(overrides?: Partial<SetupProgressView>): SetupProgressView {
  return {
    companyId: "company-1",
    status: "engine_ready" as const,
    selectedEngine: "claude_local" as const,
    selectedWorkspaceId: null,
    metadata: {},
    steps: {
      companyReady: true,
      squadReady: false,
      engineReady: true,
      workspaceConnected: false,
      knowledgeSeeded: false,
      firstIssueReady: false,
    },
    createdAt: new Date("2026-03-14T00:00:00.000Z"),
    updatedAt: new Date("2026-03-14T00:00:00.000Z"),
    ...(overrides ?? {}),
  };
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildMockUuid(index: number) {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function createMockDb(state: HarnessState): Db {
  const db = {
    transaction: async <T>(callback: (tx: Db) => Promise<T>) => {
      const snapshot = structuredClone({
        projects: state.projects,
        agents: state.agents,
        setupView: state.setupView,
        seededPresetKeys: state.seededPresetKeys,
        savedBlueprints: state.savedBlueprints,
      });

      try {
        return await callback(db as Db);
      } catch (error) {
        state.projects.splice(0, state.projects.length, ...snapshot.projects);
        state.agents.splice(0, state.agents.length, ...snapshot.agents);
        state.setupView = snapshot.setupView;
        state.seededPresetKeys.splice(0, state.seededPresetKeys.length, ...snapshot.seededPresetKeys);
        state.savedBlueprints.splice(0, state.savedBlueprints.length, ...snapshot.savedBlueprints);
        throw error;
      }
    },
    __teamBlueprintLibraryStore: {
      async list(companyId: string) {
        return state.savedBlueprints.filter((entry) => entry.companyScope === companyId);
      },
      async get(companyId: string, savedBlueprintId: string) {
        return state.savedBlueprints.find((entry) => entry.companyScope === companyId && entry.id === savedBlueprintId) ?? null;
      },
      async insert(values: Record<string, unknown>) {
        const row = {
          id: buildMockUuid(state.savedBlueprints.length + 1),
          companyScope: String(values.companyId),
          companyId: buildMockUuid(7000 + state.savedBlueprints.length + 1),
          slug: String(values.slug),
          label: String(values.label),
          description: (values.description as string | null | undefined) ?? null,
          sourceBlueprintKey: (values.sourceBlueprintKey as string | null | undefined) ?? null,
          definition: (values.definition as Record<string, unknown> | undefined) ?? {},
          defaultPreviewRequest: (values.defaultPreviewRequest as Record<string, unknown> | undefined) ?? {},
          sourceMetadata: (values.sourceMetadata as Record<string, unknown> | undefined) ?? {},
          createdAt: new Date("2026-03-14T00:00:00.000Z"),
          updatedAt: new Date("2026-03-14T00:00:00.000Z"),
        };
        state.savedBlueprints.push(row);
        return row;
      },
      async update(companyId: string, savedBlueprintId: string, values: Record<string, unknown>) {
        const row = state.savedBlueprints.find((entry) => entry.companyScope === companyId && entry.id === savedBlueprintId) ?? null;
        if (!row) return null;
        Object.assign(row, values);
        row.updatedAt = (values.updatedAt as Date | undefined) ?? new Date("2026-03-14T00:00:00.000Z");
        return row;
      },
      async delete(companyId: string, savedBlueprintId: string) {
        const index = state.savedBlueprints.findIndex((entry) => entry.companyScope === companyId && entry.id === savedBlueprintId);
        if (index < 0) return null;
        const [row] = state.savedBlueprints.splice(index, 1);
        return row ?? null;
      },
    },
  } as Db;
  return db;
}

function createApplyHarness(input?: {
  projects?: MutableProject[];
  agents?: MutableAgent[];
  setupView?: SetupProgressView;
}) {
  const state: HarnessState = {
    projects: structuredClone(input?.projects ?? []),
    agents: structuredClone(input?.agents ?? []),
    setupView: structuredClone(input?.setupView ?? buildSetupView()),
    seededPresetKeys: [],
    savedBlueprints: [],
  };

  mockProjectList.mockImplementation(async () => state.projects);
  mockAgentList.mockImplementation(async () => state.agents);
  mockProjectCreate.mockImplementation(async (companyId: string, data: Record<string, unknown>) => {
    const created: MutableProject = {
      id: `project-${state.projects.length + 1}`,
      companyId,
      name: String(data.name),
      urlKey: slugify(String(data.name)),
      workspaces: [],
      leadAgentId: (data.leadAgentId as string | null | undefined) ?? null,
    };
    state.projects.push(created);
    return created;
  });
  mockProjectUpdate.mockImplementation(async (id: string, patch: Record<string, unknown>) => {
    const project = state.projects.find((entry) => entry.id === id) ?? null;
    if (!project) return null;
    Object.assign(project, patch);
    return project;
  });
  mockAgentCreate.mockImplementation(async (companyId: string, data: Record<string, unknown>) => {
    const created: MutableAgent = {
      id: `agent-${state.agents.length + 1}`,
      companyId,
      name: String(data.name),
      urlKey: slugify(String(data.name)),
      role: String(data.role),
      title: (data.title as string | null | undefined) ?? null,
      reportsTo: (data.reportsTo as string | null | undefined) ?? null,
      metadata: (data.metadata as Record<string, unknown> | null | undefined) ?? null,
    };
    state.agents.push(created);
    return created;
  });
  mockAgentUpdate.mockImplementation(async (id: string, patch: Record<string, unknown>) => {
    const agent = state.agents.find((entry) => entry.id === id) ?? null;
    if (!agent) return null;
    Object.assign(agent, patch);
    return agent;
  });
  mockSetupGetView.mockImplementation(async () => state.setupView);
  mockSetupUpdate.mockImplementation(async (_companyId: string, patch: Record<string, unknown>) => {
    state.setupView = {
      ...state.setupView,
      status: (patch.status as SetupProgressView["status"] | undefined) ?? state.setupView.status,
      metadata: {
        ...state.setupView.metadata,
        ...((patch.metadata as Record<string, unknown> | undefined) ?? {}),
      },
      steps: {
        ...state.setupView.steps,
        squadReady: true,
      },
      updatedAt: new Date("2026-03-14T00:30:00.000Z"),
    };
    return state.setupView;
  });
  mockSeedDefaults.mockImplementation(async ({ presetKey }: { presetKey: string }) => {
    state.seededPresetKeys.push(presetKey);
    return {
      created: [{ id: `seed-${presetKey}` }],
      existing: [],
    };
  });

  return {
    state,
    db: createMockDb(state),
    service: teamBlueprintService(createMockDb(state)),
  };
}

describe("team blueprint apply", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects stale preview hashes when company state drifts", async () => {
    const harness = createApplyHarness({
      projects: [
        {
          id: "project-1",
          companyId: "company-1",
          name: "Primary Product",
          urlKey: "primary-product",
          workspaces: [],
          leadAgentId: null,
        },
      ],
    });

    const preview = await harness.service.preview("company-1", "small_delivery_team");
    harness.state.projects.push({
      id: "project-2",
      companyId: "company-1",
      name: "Another Project",
      urlKey: "another-project",
      workspaces: [],
      leadAgentId: null,
    });

    await expect(
      harness.service.apply(
        "company-1",
        "small_delivery_team",
        {
          previewHash: preview.previewHash,
        },
        {
          userId: "user-1",
          agentId: null,
        },
      ),
    ).rejects.toMatchObject({
      status: 409,
    });
  });

  it("applies a small delivery blueprint and rejects duplicate retries with the old preview hash", async () => {
    const harness = createApplyHarness();

    const preview = await harness.service.preview("company-1", "small_delivery_team");
    const result = await harness.service.apply(
      "company-1",
      "small_delivery_team",
      {
        previewHash: preview.previewHash,
      },
      {
        userId: "user-1",
        agentId: null,
      },
    );

    expect(result.summary).toMatchObject({
      createdProjectCount: 1,
      createdAgentCount: 3,
      updatedAgentCount: 0,
      seededRolePackCount: 1,
    });
    expect(result.projectResults).toEqual([
      expect.objectContaining({
        action: "create_new",
        label: "Primary Product",
      }),
    ]);
    expect(result.roleResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          templateKey: "tech_lead",
          action: "create_new",
          reportsToAgentId: null,
        }),
        expect.objectContaining({
          templateKey: "engineer",
          action: "create_new",
          reportsToAgentId: expect.any(String),
        }),
        expect.objectContaining({
          templateKey: "reviewer",
          action: "create_new",
          reportsToAgentId: expect.any(String),
        }),
      ]),
    );
    expect(harness.state.seededPresetKeys).toEqual(["squadrail_default_v1"]);
    expect(mockSetupUpdate).toHaveBeenCalledWith("company-1", expect.objectContaining({
      status: "squad_ready",
      metadata: expect.objectContaining({
        rolePacksSeeded: true,
        rolePackPresetKey: "squadrail_default_v1",
        teamBlueprintKey: "small_delivery_team",
        teamBlueprintPreviewHash: preview.previewHash,
      }),
    }));

    await expect(
      harness.service.apply(
        "company-1",
        "small_delivery_team",
        {
          previewHash: preview.previewHash,
        },
        {
          userId: "user-1",
          agentId: null,
        },
      ),
    ).rejects.toMatchObject({
      status: 409,
    });
  });

  it("applies standard_product_squad with mixed adopt/update results and per-project lead wiring", async () => {
    const harness = createApplyHarness({
      projects: [
        {
          id: "project-app-1",
          companyId: "company-1",
          name: "Product App",
          urlKey: "product-app",
          workspaces: [{ id: "ws-app-1" }],
          leadAgentId: null,
        },
        {
          id: "project-api-1",
          companyId: "company-1",
          name: "Product API",
          urlKey: "product-api",
          workspaces: [{ id: "ws-api-1" }],
          leadAgentId: null,
        },
      ],
      agents: [
        {
          id: "agent-pm",
          companyId: "company-1",
          name: "PM",
          urlKey: "pm",
          role: "pm",
          title: "PM",
          reportsTo: null,
          metadata: {},
        },
        {
          id: "agent-app-lead",
          companyId: "company-1",
          name: "Product App App Tech Lead",
          urlKey: "product-app-app-tech-lead",
          role: "engineer",
          title: "Tech Lead",
          reportsTo: null,
          metadata: {},
        },
        {
          id: "agent-backend-lead",
          companyId: "company-1",
          name: "Product API Backend Tech Lead",
          urlKey: "product-api-backend-tech-lead",
          role: "engineer",
          title: "Tech Lead",
          reportsTo: null,
          metadata: {},
        },
        {
          id: "agent-reviewer-app",
          companyId: "company-1",
          name: "Product App Reviewer",
          urlKey: "product-app-reviewer",
          role: "engineer",
          title: "Reviewer",
          reportsTo: null,
          metadata: {},
        },
      ],
      setupView: buildSetupView({
        selectedWorkspaceId: "ws-app-1",
        steps: {
          companyReady: true,
          squadReady: false,
          engineReady: true,
          workspaceConnected: true,
          knowledgeSeeded: true,
          firstIssueReady: false,
        },
      }),
    });

    const preview = await harness.service.preview("company-1", "standard_product_squad", {
      projectCount: 3,
      engineerPairsPerProject: 1,
      includePm: true,
    });
    const result = await harness.service.apply(
      "company-1",
      "standard_product_squad",
      {
        previewHash: preview.previewHash,
        projectCount: 3,
        engineerPairsPerProject: 1,
        includePm: true,
      },
      {
        userId: "user-1",
        agentId: null,
      },
    );

    expect(result.summary).toMatchObject({
      adoptedProjectCount: 2,
      createdProjectCount: 1,
      createdAgentCount: 6,
      updatedAgentCount: 4,
    });
    expect(result.projectResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slotKey: "product_app",
          action: "adopt_existing",
          projectId: "project-app-1",
        }),
        expect.objectContaining({
          slotKey: "product_api",
          action: "adopt_existing",
          projectId: "project-api-1",
        }),
        expect.objectContaining({
          slotKey: "product_app_2",
          action: "create_new",
          projectName: "Product App 2",
        }),
      ]),
    );
    expect(result.roleResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slotKey: "pm",
          action: "update_existing",
          agentId: "agent-pm",
        }),
        expect.objectContaining({
          slotKey: "app_tech_lead:product_app",
          action: "update_existing",
          agentId: "agent-app-lead",
          reportsToAgentId: "agent-pm",
        }),
        expect.objectContaining({
          slotKey: "backend_tech_lead:product_api",
          action: "update_existing",
          agentId: "agent-backend-lead",
          reportsToAgentId: "agent-pm",
        }),
        expect.objectContaining({
          slotKey: "app_tech_lead:product_app_2",
          action: "create_new",
        }),
        expect.objectContaining({
          slotKey: "engineer:product_api:1",
          action: "create_new",
          reportsToAgentId: "agent-backend-lead",
        }),
      ]),
    );

    const createdAppLeadTwo = result.roleResults.find((entry) => entry.slotKey === "app_tech_lead:product_app_2");
    expect(createdAppLeadTwo?.agentId).toBeTruthy();

    expect(harness.state.projects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "project-app-1",
          leadAgentId: "agent-app-lead",
        }),
        expect.objectContaining({
          id: "project-api-1",
          leadAgentId: "agent-backend-lead",
        }),
        expect.objectContaining({
          name: "Product App 2",
          leadAgentId: createdAppLeadTwo?.agentId,
        }),
      ]),
    );
  });

  it("keeps preview/apply parity for edited delivery_plus_qa parameters", async () => {
    const harness = createApplyHarness();
    const preview = await harness.service.preview("company-1", "delivery_plus_qa", {
      projectCount: 3,
      engineerPairsPerProject: 2,
      includePm: true,
      includeQa: true,
      includeCto: false,
    });

    const result = await harness.service.apply(
      "company-1",
      "delivery_plus_qa",
      {
        previewHash: preview.previewHash,
        projectCount: 3,
        engineerPairsPerProject: 2,
        includePm: true,
        includeQa: true,
        includeCto: false,
      },
      {
        userId: "user-1",
        agentId: null,
      },
    );

    expect(result.parameters).toEqual(preview.parameters);
    expect(result.summary.createdProjectCount).toBe(preview.summary.createProjectCount);
    expect(result.summary.createdAgentCount).toBe(preview.summary.missingRoleCount);
    expect(result.projectResults).toHaveLength(preview.projectDiff.length);
    expect(result.roleResults).toHaveLength(
      preview.roleDiff.reduce((total, role) => total + role.missingCount, 0),
    );
  });

  it("round-trips a built-in blueprint through export, import, saved preview, and saved apply", async () => {
    const harness = createApplyHarness();
    const blueprint = listTeamBlueprints()[2]!;
    const bundle = buildTeamBlueprintExportBundle({
      companyId: buildMockUuid(9001),
      companyName: "Example Co",
      blueprint,
    });

    const importPreview = await harness.service.previewImport("company-1", {
      source: {
        type: "inline",
        bundle,
      },
      collisionStrategy: "rename",
    });

    const importResult = await harness.service.importBlueprint("company-1", {
      source: {
        type: "inline",
        bundle,
      },
      collisionStrategy: "rename",
      previewHash: importPreview.previewHash,
    });

    const savedPreview = await harness.service.previewSavedBlueprint(
      "company-1",
      importResult.savedBlueprint.id,
      importResult.savedBlueprint.defaultPreviewRequest,
    );

    expect(savedPreview.parameters).toEqual(importPreview.preview.parameters);
    expect(savedPreview.projectDiff).toEqual(importPreview.preview.projectDiff);
    expect(savedPreview.roleDiff).toEqual(importPreview.preview.roleDiff);

    const savedApply = await harness.service.applySavedBlueprint(
      "company-1",
      importResult.savedBlueprint.id,
      {
        previewHash: savedPreview.previewHash,
        ...savedPreview.parameters,
      },
      {
        userId: "user-1",
        agentId: null,
      },
    );

    expect(savedApply.parameters).toEqual(savedPreview.parameters);
    expect(savedApply.summary.createdProjectCount).toBe(savedPreview.summary.createProjectCount);
    expect(savedApply.summary.createdAgentCount).toBe(savedPreview.summary.missingRoleCount);
    expect(mockSetupUpdate).toHaveBeenCalledWith("company-1", expect.objectContaining({
      metadata: expect.objectContaining({
        teamBlueprintSource: "saved_blueprint",
        teamBlueprintSavedBlueprintId: importResult.savedBlueprint.id,
      }),
    }));
  });

  it("uses saved blueprint library defaults when previewing a round-tripped import", async () => {
    const harness = createApplyHarness();
    const blueprint = listTeamBlueprints()[1]!;
    const bundle = buildTeamBlueprintExportBundle({
      companyId: buildMockUuid(9002),
      companyName: "Example Co",
      blueprint,
    });
    bundle.defaultPreviewRequest = {
      projectCount: 3,
      engineerPairsPerProject: 2,
      includePm: true,
      includeQa: false,
      includeCto: false,
    };

    const importPreview = await harness.service.previewImport("company-1", {
      source: {
        type: "inline",
        bundle,
      },
      collisionStrategy: "rename",
    });

    await harness.service.importBlueprint("company-1", {
      source: {
        type: "inline",
        bundle,
      },
      collisionStrategy: "rename",
      previewHash: importPreview.previewHash,
    });

    const savedBlueprint = harness.state.savedBlueprints[0]!;
    const savedPreview = await harness.service.previewSavedBlueprint("company-1", savedBlueprint.id);

    expect(savedPreview.parameters).toEqual({
      projectCount: 3,
      engineerPairsPerProject: 2,
      includePm: true,
      includeQa: false,
      includeCto: false,
    });
  });

  it("re-exports a saved blueprint with its stored default preview request", async () => {
    const harness = createApplyHarness();
    const blueprint = listTeamBlueprints()[0]!;
    const bundle = buildTeamBlueprintExportBundle({
      companyId: buildMockUuid(9100),
      companyName: "Example Co",
      blueprint,
    });
    bundle.defaultPreviewRequest = {
      projectCount: 2,
      engineerPairsPerProject: 1,
      includePm: false,
      includeQa: false,
      includeCto: false,
    };

    const importPreview = await harness.service.previewImport("company-1", {
      source: { type: "inline", bundle },
      collisionStrategy: "rename",
    });
    const importResult = await harness.service.importBlueprint("company-1", {
      source: { type: "inline", bundle },
      collisionStrategy: "rename",
      previewHash: importPreview.previewHash,
    });

    const exported = await harness.service.exportSavedBlueprint("company-1", importResult.savedBlueprint.id, "Example Co");

    expect(exported.bundle.definition.slug).toBe(importResult.savedBlueprint.definition.slug);
    expect(exported.bundle.defaultPreviewRequest).toEqual(bundle.defaultPreviewRequest);
    expect(exported.bundle.source).toMatchObject({
      companyName: "Example Co",
      blueprintLabel: importResult.savedBlueprint.definition.label,
    });
  });

  it("updates saved blueprint metadata and prevents duplicate slugs", async () => {
    const harness = createApplyHarness();
    const firstBundle = buildTeamBlueprintExportBundle({
      companyId: buildMockUuid(9101),
      companyName: "Example Co",
      blueprint: listTeamBlueprints()[0]!,
    });
    const secondBundle = buildTeamBlueprintExportBundle({
      companyId: buildMockUuid(9102),
      companyName: "Example Co",
      blueprint: listTeamBlueprints()[1]!,
    });

    const firstPreview = await harness.service.previewImport("company-1", {
      source: { type: "inline", bundle: firstBundle },
      collisionStrategy: "rename",
    });
    const firstResult = await harness.service.importBlueprint("company-1", {
      source: { type: "inline", bundle: firstBundle },
      collisionStrategy: "rename",
      previewHash: firstPreview.previewHash,
    });
    const secondPreview = await harness.service.previewImport("company-1", {
      source: { type: "inline", bundle: secondBundle },
      collisionStrategy: "rename",
    });
    const secondResult = await harness.service.importBlueprint("company-1", {
      source: { type: "inline", bundle: secondBundle },
      collisionStrategy: "rename",
      previewHash: secondPreview.previewHash,
    });

    const updated = await harness.service.updateSavedBlueprint("company-1", firstResult.savedBlueprint.id, {
      slug: "delivery-team-v2",
      label: "Delivery Team v2",
      description: "Renamed library entry",
    });

    expect(updated.definition).toMatchObject({
      slug: "delivery-team-v2",
      label: "Delivery Team v2",
      description: "Renamed library entry",
    });

    await expect(
      harness.service.updateSavedBlueprint("company-1", secondResult.savedBlueprint.id, {
        slug: "delivery-team-v2",
        label: "Duplicate Slug",
        description: null,
      }),
    ).rejects.toThrow("Saved blueprint slug already exists in this company library");
  });

  it("deletes saved blueprints from the company library", async () => {
    const harness = createApplyHarness();
    const bundle = buildTeamBlueprintExportBundle({
      companyId: buildMockUuid(9103),
      companyName: "Example Co",
      blueprint: listTeamBlueprints()[2]!,
    });

    const preview = await harness.service.previewImport("company-1", {
      source: { type: "inline", bundle },
      collisionStrategy: "rename",
    });
    const imported = await harness.service.importBlueprint("company-1", {
      source: { type: "inline", bundle },
      collisionStrategy: "rename",
      previewHash: preview.previewHash,
    });

    const result = await harness.service.deleteSavedBlueprint("company-1", imported.savedBlueprint.id);

    expect(result).toEqual({
      ok: true,
      deletedSavedBlueprintId: imported.savedBlueprint.id,
    });
    await expect(
      harness.service.previewSavedBlueprint("company-1", imported.savedBlueprint.id),
    ).rejects.toThrow("Saved team blueprint not found");
  });

  it("blocks import replace when the matching saved blueprint is already published", async () => {
    const harness = createApplyHarness();
    const bundle = buildTeamBlueprintExportBundle({
      companyId: buildMockUuid(9104),
      companyName: "Example Co",
      blueprint: listTeamBlueprints()[0]!,
    });

    const initialPreview = await harness.service.previewImport("company-1", {
      source: { type: "inline", bundle },
      collisionStrategy: "rename",
    });
    const imported = await harness.service.importBlueprint("company-1", {
      source: { type: "inline", bundle },
      collisionStrategy: "rename",
      previewHash: initialPreview.previewHash,
    });
    await harness.service.publishSavedBlueprint("company-1", imported.savedBlueprint.id);

    const replacePreview = await harness.service.previewImport("company-1", {
      source: { type: "inline", bundle },
      collisionStrategy: "replace",
    });

    expect(replacePreview.saveAction).toBe("create");
    expect(replacePreview.errors).toEqual([
      "Replace is only allowed for draft saved blueprints. Published or superseded versions must be imported as a new library entry or saved as a new version.",
    ]);

    await expect(
      harness.service.importBlueprint("company-1", {
        source: { type: "inline", bundle },
        collisionStrategy: "replace",
        previewHash: replacePreview.previewHash,
      }),
    ).rejects.toThrow("Replace is only allowed for draft saved blueprints.");
  });

  it("blocks deleting a draft saved blueprint that already has child versions", async () => {
    const harness = createApplyHarness();
    const preview = await harness.service.preview("company-1", "small_delivery_team");
    const baseVersion = await harness.service.saveBlueprint("company-1", "small_delivery_team", {
      previewHash: preview.previewHash,
      projectCount: preview.parameters.projectCount,
      engineerPairsPerProject: preview.parameters.engineerPairsPerProject,
      includePm: preview.parameters.includePm,
      includeQa: preview.parameters.includeQa,
      includeCto: preview.parameters.includeCto,
      slug: "delivery-team",
      label: "Delivery Team",
      description: "Base library defaults",
      versionNote: "Base company-local variant",
    }, "Example Co");

    const savedPreview = await harness.service.previewSavedBlueprint("company-1", baseVersion.savedBlueprint.id, {
      projectCount: 2,
      engineerPairsPerProject: 2,
    });
    await harness.service.createSavedBlueprintVersion("company-1", baseVersion.savedBlueprint.id, {
      previewHash: savedPreview.previewHash,
      projectCount: savedPreview.parameters.projectCount,
      engineerPairsPerProject: savedPreview.parameters.engineerPairsPerProject,
      includePm: savedPreview.parameters.includePm,
      includeQa: savedPreview.parameters.includeQa,
      includeCto: savedPreview.parameters.includeCto,
      versionNote: "Second draft version",
    }, "Example Co");

    await expect(
      harness.service.deleteSavedBlueprint("company-1", baseVersion.savedBlueprint.id),
    ).rejects.toThrow("Cannot delete a saved blueprint that already has child versions.");
  });

  it("blocks deleting published saved blueprints to preserve version history", async () => {
    const harness = createApplyHarness();
    const preview = await harness.service.preview("company-1", "small_delivery_team");
    const baseVersion = await harness.service.saveBlueprint("company-1", "small_delivery_team", {
      previewHash: preview.previewHash,
      projectCount: preview.parameters.projectCount,
      engineerPairsPerProject: preview.parameters.engineerPairsPerProject,
      includePm: preview.parameters.includePm,
      includeQa: preview.parameters.includeQa,
      includeCto: preview.parameters.includeCto,
      slug: "delivery-team",
      label: "Delivery Team",
      description: "Base library defaults",
      versionNote: "Base company-local variant",
    }, "Example Co");
    await harness.service.publishSavedBlueprint("company-1", baseVersion.savedBlueprint.id);

    await expect(
      harness.service.deleteSavedBlueprint("company-1", baseVersion.savedBlueprint.id),
    ).rejects.toThrow("Only draft saved blueprints can be deleted from the library.");
  });

  it("saves a built-in preview as a company-local blueprint library entry", async () => {
    const harness = createApplyHarness();
    const preview = await harness.service.preview("company-1", "standard_product_squad", {
      projectCount: 3,
      engineerPairsPerProject: 2,
      includePm: true,
      includeQa: true,
      includeCto: false,
    });

    const result = await harness.service.saveBlueprint("company-1", "standard_product_squad", {
      previewHash: preview.previewHash,
      projectCount: preview.parameters.projectCount,
      engineerPairsPerProject: preview.parameters.engineerPairsPerProject,
      includePm: preview.parameters.includePm,
      includeQa: preview.parameters.includeQa,
      includeCto: preview.parameters.includeCto,
      slug: "standard-product-squad-team",
      label: "Standard Product Squad Team",
      description: "Company-local defaults",
      versionNote: "Initial tuned defaults",
    }, "Example Co");

    expect(result.savedBlueprint.definition).toMatchObject({
      slug: "standard-product-squad-team",
      label: "Standard Product Squad Team",
      description: "Company-local defaults",
    });
    expect(result.savedBlueprint.defaultPreviewRequest).toEqual({
      projectCount: 3,
      engineerPairsPerProject: 2,
      includePm: true,
      includeQa: false,
      includeCto: false,
    });
    expect(result.savedBlueprint.sourceMetadata).toMatchObject({
      type: "company_local_authoring",
      companyName: "Example Co",
      blueprintKey: "standard_product_squad",
      version: 1,
      parentSavedBlueprintId: null,
      versionNote: "Initial tuned defaults",
    });
    expect(typeof result.savedBlueprint.sourceMetadata.lineageKey).toBe("string");
  });

  it("creates the next saved blueprint version from a reviewed preview", async () => {
    const harness = createApplyHarness();
    const preview = await harness.service.preview("company-1", "small_delivery_team", {
      projectCount: 1,
      engineerPairsPerProject: 1,
      includePm: false,
      includeQa: false,
      includeCto: false,
    });
    const baseVersion = await harness.service.saveBlueprint("company-1", "small_delivery_team", {
      previewHash: preview.previewHash,
      projectCount: preview.parameters.projectCount,
      engineerPairsPerProject: preview.parameters.engineerPairsPerProject,
      includePm: preview.parameters.includePm,
      includeQa: preview.parameters.includeQa,
      includeCto: preview.parameters.includeCto,
      slug: "delivery-team",
      label: "Delivery Team",
      description: "Base library defaults",
      versionNote: "Base company-local variant",
    }, "Example Co");

    const savedPreview = await harness.service.previewSavedBlueprint("company-1", baseVersion.savedBlueprint.id, {
      projectCount: 2,
      engineerPairsPerProject: 2,
      includePm: false,
      includeQa: false,
      includeCto: false,
    });
    const nextVersion = await harness.service.createSavedBlueprintVersion("company-1", baseVersion.savedBlueprint.id, {
      previewHash: savedPreview.previewHash,
      projectCount: savedPreview.parameters.projectCount,
      engineerPairsPerProject: savedPreview.parameters.engineerPairsPerProject,
      includePm: savedPreview.parameters.includePm,
      includeQa: savedPreview.parameters.includeQa,
      includeCto: savedPreview.parameters.includeCto,
      versionNote: "Double engineer coverage",
    }, "Example Co");

    expect(nextVersion.savedBlueprint.definition.slug).toBe("delivery-team-v2");
    expect(nextVersion.savedBlueprint.definition.label).toBe("Delivery Team v2");
    expect(nextVersion.savedBlueprint.defaultPreviewRequest).toEqual({
      projectCount: 2,
      engineerPairsPerProject: 2,
      includePm: false,
      includeQa: false,
      includeCto: false,
    });
    expect(nextVersion.savedBlueprint.sourceMetadata).toMatchObject({
      type: "saved_blueprint_version",
      companyName: "Example Co",
      blueprintKey: "small_delivery_team",
      version: 2,
      parentSavedBlueprintId: baseVersion.savedBlueprint.id,
      versionNote: "Double engineer coverage",
      lineageKey: baseVersion.savedBlueprint.sourceMetadata.lineageKey,
    });
  });

  it("publishes a saved blueprint version and supersedes the previous published lineage entry", async () => {
    const harness = createApplyHarness();
    const preview = await harness.service.preview("company-1", "small_delivery_team");
    const baseVersion = await harness.service.saveBlueprint("company-1", "small_delivery_team", {
      previewHash: preview.previewHash,
      projectCount: preview.parameters.projectCount,
      engineerPairsPerProject: preview.parameters.engineerPairsPerProject,
      includePm: preview.parameters.includePm,
      includeQa: preview.parameters.includeQa,
      includeCto: preview.parameters.includeCto,
      slug: "delivery-team",
      label: "Delivery Team",
      description: "Base library defaults",
      versionNote: "Base company-local variant",
    }, "Example Co");

    const publishedBase = await harness.service.publishSavedBlueprint("company-1", baseVersion.savedBlueprint.id);
    expect(resolveSavedTeamBlueprintLifecycleState(publishedBase.savedBlueprint)).toBe("published");
    expect(publishedBase.supersededSavedBlueprintIds).toEqual([]);

    const savedPreview = await harness.service.previewSavedBlueprint("company-1", baseVersion.savedBlueprint.id, {
      projectCount: 2,
      engineerPairsPerProject: 2,
    });
    const nextVersion = await harness.service.createSavedBlueprintVersion("company-1", baseVersion.savedBlueprint.id, {
      previewHash: savedPreview.previewHash,
      projectCount: savedPreview.parameters.projectCount,
      engineerPairsPerProject: savedPreview.parameters.engineerPairsPerProject,
      includePm: savedPreview.parameters.includePm,
      includeQa: savedPreview.parameters.includeQa,
      includeCto: savedPreview.parameters.includeCto,
      versionNote: "Double engineer coverage",
    }, "Example Co");

    const publishedNext = await harness.service.publishSavedBlueprint("company-1", nextVersion.savedBlueprint.id);
    expect(resolveSavedTeamBlueprintLifecycleState(publishedNext.savedBlueprint)).toBe("published");
    expect(publishedNext.supersededSavedBlueprintIds).toEqual([baseVersion.savedBlueprint.id]);

    const baseAfter = harness.state.savedBlueprints.find((entry) => entry.id === baseVersion.savedBlueprint.id);
    expect(baseAfter?.sourceMetadata).toMatchObject({
      lifecycleState: "superseded",
    });
    expect(describeSavedTeamBlueprintVersionChanges(
      nextVersion.savedBlueprint,
      baseVersion.savedBlueprint,
    )).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: "versionNote",
        after: "Double engineer coverage",
      }),
      expect.objectContaining({
        key: "engineerPairsPerProject",
        after: "2",
      }),
    ]));
  });

  it("rolls back project and role-pack mutations when project creation fails mid-apply", async () => {
    const harness = createApplyHarness();
    let projectCreateCalls = 0;
    mockProjectCreate.mockImplementation(async (companyId: string, data: Record<string, unknown>) => {
      projectCreateCalls += 1;
      if (projectCreateCalls === 2) {
        throw new Error("project create failed");
      }
      const created: MutableProject = {
        id: `project-${harness.state.projects.length + 1}`,
        companyId,
        name: String(data.name),
        urlKey: slugify(String(data.name)),
        workspaces: [],
        leadAgentId: null,
      };
      harness.state.projects.push(created);
      return created;
    });

    const preview = await harness.service.preview("company-1", "standard_product_squad", {
      projectCount: 3,
    });

    await expect(
      harness.service.apply(
        "company-1",
        "standard_product_squad",
        {
          previewHash: preview.previewHash,
          projectCount: 3,
        },
        {
          userId: "user-1",
          agentId: null,
        },
      ),
    ).rejects.toThrow("project create failed");

    expect(harness.state.projects).toEqual([]);
    expect(harness.state.agents).toEqual([]);
    expect(harness.state.seededPresetKeys).toEqual([]);
    expect(mockSetupUpdate).not.toHaveBeenCalled();
  });

  it("rolls back adopt/create mutations when agent update fails mid-apply", async () => {
    const harness = createApplyHarness({
      projects: [
        {
          id: "project-app-1",
          companyId: "company-1",
          name: "Product App",
          urlKey: "product-app",
          workspaces: [{ id: "ws-app-1" }],
          leadAgentId: null,
        },
        {
          id: "project-api-1",
          companyId: "company-1",
          name: "Product API",
          urlKey: "product-api",
          workspaces: [{ id: "ws-api-1" }],
          leadAgentId: null,
        },
      ],
      agents: [
        {
          id: "agent-pm",
          companyId: "company-1",
          name: "PM",
          urlKey: "pm",
          role: "pm",
          title: "PM",
          reportsTo: null,
          metadata: {},
        },
        {
          id: "agent-app-lead",
          companyId: "company-1",
          name: "Product App App Tech Lead",
          urlKey: "product-app-app-tech-lead",
          role: "engineer",
          title: "Tech Lead",
          reportsTo: null,
          metadata: {},
        },
      ],
    });
    let agentUpdateCalls = 0;
    mockAgentUpdate.mockImplementation(async (id: string, patch: Record<string, unknown>) => {
      agentUpdateCalls += 1;
      if (agentUpdateCalls === 2) {
        throw new Error("agent update failed");
      }
      const agent = harness.state.agents.find((entry) => entry.id === id) ?? null;
      if (!agent) return null;
      Object.assign(agent, patch);
      return agent;
    });

    const preview = await harness.service.preview("company-1", "standard_product_squad", {
      projectCount: 2,
    });

    await expect(
      harness.service.apply(
        "company-1",
        "standard_product_squad",
        {
          previewHash: preview.previewHash,
          projectCount: 2,
        },
        {
          userId: "user-1",
          agentId: null,
        },
      ),
    ).rejects.toThrow("agent update failed");

    expect(harness.state.projects).toEqual([
      expect.objectContaining({
        id: "project-app-1",
        leadAgentId: null,
      }),
      expect.objectContaining({
        id: "project-api-1",
        leadAgentId: null,
      }),
    ]);
    expect(harness.state.agents).toEqual([
      expect.objectContaining({
        id: "agent-pm",
        reportsTo: null,
        metadata: {},
      }),
      expect.objectContaining({
        id: "agent-app-lead",
        reportsTo: null,
        metadata: {},
      }),
    ]);
    expect(harness.state.seededPresetKeys).toEqual([]);
    expect(mockSetupUpdate).not.toHaveBeenCalled();
  });
});
