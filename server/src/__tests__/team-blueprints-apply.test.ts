import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@squadrail/db";
import type { SetupProgressView } from "@squadrail/shared";

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

import { teamBlueprintService } from "../services/team-blueprints.js";

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

function createMockDb(state: HarnessState): Db {
  const db = {
    transaction: async <T>(callback: (tx: Db) => Promise<T>) => {
      const snapshot = structuredClone({
        projects: state.projects,
        agents: state.agents,
        setupView: state.setupView,
        seededPresetKeys: state.seededPresetKeys,
      });

      try {
        return await callback(db as Db);
      } catch (error) {
        state.projects.splice(0, state.projects.length, ...snapshot.projects);
        state.agents.splice(0, state.agents.length, ...snapshot.agents);
        state.setupView = snapshot.setupView;
        state.seededPresetKeys.splice(0, state.seededPresetKeys.length, ...snapshot.seededPresetKeys);
        throw error;
      }
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
