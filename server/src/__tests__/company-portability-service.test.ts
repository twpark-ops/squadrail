import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCompanyGetById,
  mockCompanyCreate,
  mockCompanyUpdate,
  mockProjectList,
  mockProjectCreate,
  mockProjectUpdate,
  mockProjectListWorkspaces,
  mockProjectCreateWorkspace,
  mockProjectUpdateWorkspace,
  mockAgentList,
  mockAgentCreate,
  mockAgentUpdate,
  mockAccessEnsureMembership,
} = vi.hoisted(() => ({
  mockCompanyGetById: vi.fn(),
  mockCompanyCreate: vi.fn(),
  mockCompanyUpdate: vi.fn(),
  mockProjectList: vi.fn(),
  mockProjectCreate: vi.fn(),
  mockProjectUpdate: vi.fn(),
  mockProjectListWorkspaces: vi.fn(),
  mockProjectCreateWorkspace: vi.fn(),
  mockProjectUpdateWorkspace: vi.fn(),
  mockAgentList: vi.fn(),
  mockAgentCreate: vi.fn(),
  mockAgentUpdate: vi.fn(),
  mockAccessEnsureMembership: vi.fn(),
}));

vi.mock("../services/companies.js", () => ({
  companyService: () => ({
    getById: mockCompanyGetById,
    create: mockCompanyCreate,
    update: mockCompanyUpdate,
  }),
}));

vi.mock("../services/projects.js", () => ({
  projectService: () => ({
    list: mockProjectList,
    create: mockProjectCreate,
    update: mockProjectUpdate,
    listWorkspaces: mockProjectListWorkspaces,
    createWorkspace: mockProjectCreateWorkspace,
    updateWorkspace: mockProjectUpdateWorkspace,
  }),
}));

vi.mock("../services/agents.js", () => ({
  agentService: () => ({
    list: mockAgentList,
    create: mockAgentCreate,
    update: mockAgentUpdate,
  }),
}));

vi.mock("../services/access.js", () => ({
  accessService: () => ({
    ensureMembership: mockAccessEnsureMembership,
  }),
}));

import { companyPortabilityService } from "../services/company-portability.js";

describe("company portability service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCompanyUpdate.mockImplementation(async (_id: string, patch: Record<string, unknown>) => ({
      id: "company-1",
      name: String(patch.name ?? "Acme"),
    }));
    mockProjectUpdate.mockImplementation(async (id: string, patch: Record<string, unknown>) => ({
      id,
      companyId: "company-1",
      urlKey: "runtime",
      workspaces: [],
      primaryWorkspace: null,
      goalIds: [],
      goals: [],
      ...patch,
    }));
    mockProjectCreate.mockImplementation(async (companyId: string, patch: Record<string, unknown>) => ({
      id: "project-created-1",
      companyId,
      urlKey: "runtime",
      workspaces: [],
      primaryWorkspace: null,
      goalIds: [],
      goals: [],
      ...patch,
    }));
    mockProjectListWorkspaces.mockResolvedValue([]);
    mockProjectCreateWorkspace.mockResolvedValue(null);
    mockProjectUpdateWorkspace.mockResolvedValue(null);
    mockAgentCreate.mockImplementation(async (companyId: string, patch: Record<string, unknown>) => ({
      id: "agent-created-1",
      companyId,
      name: String(patch.name ?? "Agent"),
      ...patch,
    }));
    mockAgentUpdate.mockImplementation(async (id: string, patch: Record<string, unknown>) => ({
      id,
      companyId: "company-1",
      name: String(patch.name ?? "Agent"),
      ...patch,
    }));
    mockAccessEnsureMembership.mockResolvedValue(null);
  });

  it("loads GitHub tree sources with main->master fallback and records source warnings", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith("/main/squadrail.manifest.json")) {
        return {
          ok: false,
          status: 404,
          json: async () => ({}),
          text: async () => "",
        };
      }
      if (url.endsWith("/master/squadrail.manifest.json")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            schemaVersion: 1,
            generatedAt: "2026-03-13T11:00:00.000Z",
            source: { companyId: "11111111-1111-4111-8111-111111111111", companyName: "Source Co" },
            includes: { company: true, projects: false, agents: true },
            company: {
              path: "COMPANY.md",
              name: "Source Co",
              description: null,
              brandColor: null,
              requireBoardApprovalForNewAgents: false,
            },
            projects: [],
            agents: [
              {
                slug: "release-captain",
                name: "Release Captain",
                path: "agents/release-captain/AGENTS.md",
                role: "tech_lead",
                title: null,
                icon: null,
                capabilities: null,
                reportsToSlug: null,
                adapterType: "codex_local",
                adapterConfig: {},
                runtimeConfig: {},
                permissions: {},
                budgetMonthlyCents: 0,
                metadata: null,
              },
            ],
            requiredSecrets: [],
          }),
          text: async () => "",
        };
      }
      if (url.endsWith("/master/COMPANY.md")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({}),
          text: async () => "---\nkind: company\n---\n\n# Source Co\n",
        };
      }
      if (url.endsWith("/master/agents/release-captain/AGENTS.md")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({}),
          text: async () => "---\nkind: agent\n---\n\n# Release Captain\n",
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const service = companyPortabilityService({} as never);

    const preview = await service.previewImport({
      include: { company: true, projects: false, agents: true },
      target: {
        mode: "new_company",
        newCompanyName: "Imported Source",
      },
      source: {
        type: "github",
        url: "https://github.com/acme/squadrail/tree/main",
      },
    });

    expect(preview.warnings).toContain("GitHub ref main not found; falling back to master.");
    expect(preview.selectedAgentSlugs).toEqual(["release-captain"]);
    expect(preview.errors).toEqual([]);

    vi.unstubAllGlobals();
  });

  it("surfaces inline preview errors when selected agents are missing or files are absent", async () => {
    const service = companyPortabilityService({} as never);

    const preview = await service.previewImport({
      include: { company: true, projects: false, agents: true },
      target: {
        mode: "new_company",
        newCompanyName: "Imported Source",
      },
      agents: ["missing-agent", "release-captain"],
      source: {
        type: "inline",
        manifest: {
          schemaVersion: 1,
          generatedAt: "2026-03-13T11:00:00.000Z",
          source: { companyId: "11111111-1111-4111-8111-111111111111", companyName: "Source Co" },
          includes: { company: true, projects: false, agents: true },
          company: {
            path: "COMPANY.md",
            name: "Source Co",
            description: null,
            brandColor: null,
            requireBoardApprovalForNewAgents: false,
          },
          projects: [],
          agents: [
            {
              slug: "release-captain",
              name: "Release Captain",
              path: "agents/release-captain/AGENTS.md",
              role: "tech_lead",
              title: null,
              icon: null,
              capabilities: null,
              reportsToSlug: null,
              adapterType: "codex_local",
              adapterConfig: {},
              runtimeConfig: {},
              permissions: {},
              budgetMonthlyCents: 0,
              metadata: null,
            },
          ],
          requiredSecrets: [],
        },
        files: {},
      },
    });

    expect(preview.errors).toEqual([
      "Selected agent slug not found in manifest: missing-agent",
      "Missing markdown file for agent release-captain: agents/release-captain/AGENTS.md",
    ]);
  });

  it("exports company bundles with portable agent config, workspaces, and secret requirements", async () => {
    mockCompanyGetById.mockResolvedValue({
      id: "company-1",
      name: "Acme",
      description: "Runtime org",
      brandColor: "#0ea5e9",
      requireBoardApprovalForNewAgents: true,
    });
    mockProjectList.mockResolvedValue([
      {
        id: "project-1",
        companyId: "company-1",
        urlKey: "runtime",
        name: "Runtime",
        description: "Core runtime",
        status: "in_progress",
        leadAgentId: "agent-1",
        targetDate: null,
        color: "#0ea5e9",
        archivedAt: null,
        workspaces: [
          {
            name: "runtime",
            cwd: "/repo/runtime",
            repoUrl: "https://github.com/acme/runtime",
            repoRef: "main",
            metadata: null,
            executionPolicy: null,
            isPrimary: true,
          },
        ],
      },
    ]);
    mockAgentList.mockResolvedValue([
      {
        id: "agent-1",
        name: "Release Captain",
        role: "tech_lead",
        title: "Release Captain",
        icon: "rocket",
        capabilities: "Coordinate releases",
        reportsTo: null,
        adapterType: "codex_local",
        adapterConfig: {
          promptTemplate: "# AGENTS\n\nDrive delivery.",
          env: {
            OPENAI_API_KEY: { type: "secret_ref", secretId: "secret-1", version: "latest" },
            LOG_LEVEL: { type: "plain", value: "debug" },
          },
        },
        runtimeConfig: {
          heartbeat: {
            intervalSec: 3600,
          },
        },
        permissions: { canCreateAgents: true },
        budgetMonthlyCents: 1000,
        metadata: { team: "runtime" },
        status: "idle",
      },
      {
        id: "agent-2",
        name: "Legacy",
        role: "engineer",
        title: null,
        icon: null,
        capabilities: null,
        reportsTo: null,
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
        budgetMonthlyCents: 0,
        metadata: null,
        status: "terminated",
      },
    ]);
    const service = companyPortabilityService({} as never);

    const exported = await service.exportBundle("company-1", {
      include: { company: true, projects: true, agents: true },
    });

    expect(exported.manifest.company).toMatchObject({
      path: "COMPANY.md",
      name: "Acme",
    });
    expect(exported.manifest.projects).toEqual([
      expect.objectContaining({
        slug: "runtime",
        leadAgentSlug: "release-captain",
      }),
    ]);
    expect(exported.manifest.agents).toEqual([
      expect.objectContaining({
        slug: "release-captain",
        adapterConfig: {
          env: {
            LOG_LEVEL: { type: "plain", value: "debug" },
          },
          promptTemplate: "# AGENTS\n\nDrive delivery.",
        },
      }),
    ]);
    expect(exported.manifest.requiredSecrets).toEqual([
      expect.objectContaining({
        key: "OPENAI_API_KEY",
        agentSlug: "release-captain",
      }),
    ]);
    expect(exported.files["COMPANY.md"]).toContain("# Agents");
    expect(exported.files["agents/release-captain/AGENTS.md"]).toContain("# AGENTS");
    expect(exported.warnings).toEqual([
      "Skipped 1 terminated agent from export.",
    ]);
  });

  it("builds rename-based preview plans against an existing company", async () => {
    mockCompanyGetById.mockResolvedValue({
      id: "company-1",
      name: "Acme",
    });
    mockProjectList.mockResolvedValue([
      {
        id: "project-existing-1",
        companyId: "company-1",
        urlKey: "runtime",
        name: "Runtime",
      },
    ]);
    mockAgentList.mockResolvedValue([
      {
        id: "agent-existing-1",
        companyId: "company-1",
        name: "Release Captain",
      },
    ]);
    const service = companyPortabilityService({} as never);

    const preview = await service.previewImport({
      include: { company: true, projects: true, agents: true },
      collisionStrategy: "rename",
      target: {
        mode: "existing_company",
        companyId: "company-1",
      },
      source: {
        type: "inline",
        manifest: {
          schemaVersion: 1,
          generatedAt: "2026-03-13T11:00:00.000Z",
          source: { companyId: "00000000-0000-0000-0000-000000000111", companyName: "Source Co" },
          includes: { company: true, projects: true, agents: true },
          company: {
            path: "COMPANY.md",
            name: "Source Co",
            description: null,
            brandColor: null,
            requireBoardApprovalForNewAgents: true,
          },
          projects: [
            {
              slug: "runtime",
              name: "Runtime",
              description: null,
              status: "backlog",
              leadAgentSlug: null,
              targetDate: null,
              color: null,
              archivedAt: null,
              workspaces: [],
            },
          ],
          agents: [
            {
              slug: "release-captain",
              name: "Release Captain",
              path: "agents/release-captain/AGENTS.md",
              role: "tech_lead",
              title: null,
              icon: null,
              capabilities: null,
              reportsToSlug: null,
              adapterType: "codex_local",
              adapterConfig: {},
              runtimeConfig: {},
              permissions: {},
              budgetMonthlyCents: 0,
              metadata: null,
            },
          ],
          requiredSecrets: [],
        },
        files: {
          "agents/release-captain/AGENTS.md": "---\nkind: \"agent\"\n---\n\n# AGENTS\n",
        },
      },
    });

    expect(preview.plan.companyAction).toBe("update");
    expect(preview.plan.projectPlans).toEqual([
      expect.objectContaining({
        slug: "runtime",
        action: "create",
        plannedName: "Runtime 2",
        reason: "Existing slug matched; rename strategy.",
      }),
    ]);
    expect(preview.plan.agentPlans).toEqual([
      expect.objectContaining({
        slug: "release-captain",
        action: "create",
        plannedName: "Release Captain 2",
        reason: "Existing slug matched; rename strategy.",
      }),
    ]);
  });

  it("imports a bundle into a new company and creates agents, projects, and memberships", async () => {
    mockCompanyCreate.mockResolvedValue({
      id: "company-new-1",
      name: "Imported Runtime",
    });
    mockCompanyGetById.mockResolvedValue(null);
    mockProjectList.mockResolvedValue([]);
    mockAgentList.mockResolvedValue([]);
    mockProjectCreate.mockResolvedValue({
      id: "project-new-1",
      companyId: "company-new-1",
      urlKey: "runtime",
      name: "Runtime",
      workspaces: [],
      primaryWorkspace: null,
      goalIds: [],
      goals: [],
    });
    mockAgentCreate
      .mockResolvedValueOnce({
        id: "agent-pm-1",
        companyId: "company-new-1",
        name: "PM",
      })
      .mockResolvedValueOnce({
        id: "agent-qa-1",
        companyId: "company-new-1",
        name: "QA",
      });
    const service = companyPortabilityService({} as never);

    const result = await service.importBundle({
      include: { company: true, projects: true, agents: true },
      collisionStrategy: "rename",
      target: {
        mode: "new_company",
        newCompanyName: "Imported Runtime",
      },
      source: {
        type: "inline",
        manifest: {
          schemaVersion: 1,
          generatedAt: "2026-03-13T11:00:00.000Z",
          source: { companyId: "00000000-0000-0000-0000-000000000111", companyName: "Source Co" },
          includes: { company: true, projects: true, agents: true },
          company: {
            path: "COMPANY.md",
            name: "Source Co",
            description: "Source description",
            brandColor: "#0ea5e9",
            requireBoardApprovalForNewAgents: true,
          },
          projects: [
            {
              slug: "runtime",
              name: "Runtime",
              description: "Core runtime",
              status: "backlog",
              leadAgentSlug: "pm",
              targetDate: null,
              color: "#0ea5e9",
              archivedAt: null,
              workspaces: [
                {
                  name: "runtime",
                  cwd: "/repo/runtime",
                  repoUrl: null,
                  repoRef: null,
                  metadata: null,
                  executionPolicy: null,
                  isPrimary: true,
                },
              ],
            },
          ],
          agents: [
            {
              slug: "pm",
              name: "PM",
              path: "agents/pm/AGENTS.md",
              role: "pm",
              title: "PM",
              icon: null,
              capabilities: "Plan work",
              reportsToSlug: null,
              adapterType: "codex_local",
              adapterConfig: {},
              runtimeConfig: {},
              permissions: {},
              budgetMonthlyCents: 0,
              metadata: null,
            },
            {
              slug: "qa",
              name: "QA",
              path: "agents/qa/AGENTS.md",
              role: "qa",
              title: "QA",
              icon: null,
              capabilities: "Verify work",
              reportsToSlug: "pm",
              adapterType: "codex_local",
              adapterConfig: {},
              runtimeConfig: {},
              permissions: {},
              budgetMonthlyCents: 0,
              metadata: null,
            },
          ],
          requiredSecrets: [],
        },
        files: {
          "agents/pm/AGENTS.md": "---\nkind: \"agent\"\n---\n\nPM instructions",
          "agents/qa/AGENTS.md": "---\nkind: \"agent\"\n---\n\nQA instructions",
        },
      },
    }, "board-1");

    expect(mockCompanyCreate).toHaveBeenCalledWith(expect.objectContaining({
      name: "Imported Runtime",
    }));
    expect(mockAccessEnsureMembership).toHaveBeenCalledWith(
      "company-new-1",
      "user",
      "board-1",
      "owner",
      "active",
    );
    expect(mockProjectCreate).toHaveBeenCalledWith(
      "company-new-1",
      expect.objectContaining({
        name: "Runtime",
        leadAgentId: "agent-pm-1",
      }),
    );
    expect(mockProjectCreateWorkspace).toHaveBeenCalledWith(
      "project-new-1",
      expect.objectContaining({
        name: "runtime",
        cwd: "/repo/runtime",
        isPrimary: true,
      }),
    );
    expect(mockAgentUpdate).toHaveBeenCalledWith("agent-qa-1", { reportsTo: "agent-pm-1" });
    expect(result.company).toEqual({
      id: "company-new-1",
      name: "Imported Runtime",
      action: "created",
    });
    expect(result.projects).toEqual([
      expect.objectContaining({
        slug: "runtime",
        id: "project-new-1",
        action: "created",
      }),
    ]);
    expect(result.agents).toEqual([
      expect.objectContaining({ slug: "pm", action: "created" }),
      expect.objectContaining({ slug: "qa", action: "created" }),
    ]);
  });
});
