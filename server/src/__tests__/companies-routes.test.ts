import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockEnsureMembership,
  mockCompanyCreate,
  mockSetupGetView,
  mockSetupUpdate,
  mockDoctorRun,
  mockListRolePacks,
  mockListPresets,
  mockGetRolePack,
  mockListRolePackRevisions,
  mockSeedDefaults,
  mockCreateDraftRevision,
  mockRestoreRolePackRevision,
  mockSimulateRolePack,
  mockLogActivity,
} = vi.hoisted(() => ({
  mockEnsureMembership: vi.fn(),
  mockCompanyCreate: vi.fn(),
  mockSetupGetView: vi.fn(),
  mockSetupUpdate: vi.fn(),
  mockDoctorRun: vi.fn(),
  mockListRolePacks: vi.fn(),
  mockListPresets: vi.fn(),
  mockGetRolePack: vi.fn(),
  mockListRolePackRevisions: vi.fn(),
  mockSeedDefaults: vi.fn(),
  mockCreateDraftRevision: vi.fn(),
  mockRestoreRolePackRevision: vi.fn(),
  mockSimulateRolePack: vi.fn(),
  mockLogActivity: vi.fn(),
}));

vi.mock("../services/index.js", () => ({
  accessService: () => ({
    ensureMembership: mockEnsureMembership,
  }),
  companyPortabilityService: () => ({
    exportBundle: vi.fn(),
    previewImport: vi.fn(),
    importBundle: vi.fn(),
  }),
  companyService: () => ({
    create: mockCompanyCreate,
    list: vi.fn(),
    stats: vi.fn(),
    getById: vi.fn(),
    update: vi.fn(),
    archive: vi.fn(),
    remove: vi.fn(),
  }),
  doctorService: () => ({
    run: mockDoctorRun,
  }),
  logActivity: mockLogActivity,
  rolePackService: () => ({
    listPresets: mockListPresets,
    listRolePacks: mockListRolePacks,
    getRolePack: mockGetRolePack,
    listRevisions: mockListRolePackRevisions,
    seedDefaults: mockSeedDefaults,
    createDraftRevision: mockCreateDraftRevision,
    restoreRevision: mockRestoreRolePackRevision,
    simulateRolePack: mockSimulateRolePack,
  }),
  setupProgressService: () => ({
    getView: mockSetupGetView,
    update: mockSetupUpdate,
  }),
}));

import { companyRoutes } from "../routes/companies.js";

type TestRequest = {
  params: Record<string, string>;
  body: unknown;
  query: Record<string, unknown>;
  actor: ReturnType<typeof buildBoardActor>;
};

function buildBoardActor(companyIds: string[] = ["company-1"]) {
  return {
    type: "board" as const,
    source: "local_implicit" as const,
    isInstanceAdmin: true,
    userId: "user-1",
    companyIds,
    runId: null,
  };
}

function createTestRouter() {
  return companyRoutes({} as never, {
    deploymentMode: "local_trusted",
    deploymentExposure: "private",
    authReady: true,
    protocolTimeoutsEnabled: true,
    knowledgeBackfillEnabled: true,
  }) as any;
}

function findRouteLayer(router: any, path: string, method: "get" | "post" | "patch") {
  const layer = router.stack.find(
    (entry: any) => entry.route?.path === path && entry.route?.methods?.[method] === true,
  );
  if (!layer?.route?.stack) {
    throw new Error(`Route ${method.toUpperCase()} ${path} not found`);
  }
  return layer.route.stack.map((entry: any) => entry.handle as Function);
}

async function invokeRoute(input: {
  path: string;
  method: "get" | "post" | "patch";
  params?: Record<string, string>;
  body?: unknown;
  query?: Record<string, unknown>;
  actor?: ReturnType<typeof buildBoardActor>;
}) {
  const router = createTestRouter();
  const handlers = findRouteLayer(router, input.path, input.method);
  const req: TestRequest = {
    params: input.params ?? {},
    body: input.body ?? {},
    query: input.query ?? {},
    actor: input.actor ?? buildBoardActor(),
  };
  const state: {
    statusCode: number;
    body: unknown;
  } = {
    statusCode: 200,
    body: undefined,
  };
  const res = {
    status(code: number) {
      state.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      state.body = payload;
      return this;
    },
  };

  try {
    for (const handler of handlers) {
      await new Promise<void>((resolve, reject) => {
        try {
          const result = handler(req, res, (error?: unknown) => {
            if (error) reject(error);
            else resolve();
          });

          if (result && typeof result.then === "function") {
            result.then(() => resolve(), reject);
            return;
          }

          if (handler.length < 3) {
            resolve();
          }
        } catch (error) {
          reject(error);
        }
      });
    }

    return state;
  } catch (error: any) {
    return {
      statusCode: error?.status ?? 500,
      body: {
        error: error?.message ?? "Unhandled error",
      },
    };
  }
}

describe("company routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns setup progress for the requested company", async () => {
    mockSetupGetView.mockResolvedValue({
      companyId: "company-1",
      status: "engine_ready",
      selectedEngine: "claude_local",
      selectedWorkspaceId: null,
      metadata: {},
      steps: {
        companyReady: true,
        squadReady: true,
        engineReady: true,
        workspaceConnected: false,
        knowledgeSeeded: false,
        firstIssueReady: false,
      },
      createdAt: new Date("2026-03-07T00:00:00.000Z"),
      updatedAt: new Date("2026-03-07T00:00:00.000Z"),
    });

    const response = await invokeRoute({
      path: "/:companyId/setup-progress",
      method: "get",
      params: { companyId: "company-1" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      companyId: "company-1",
      status: "engine_ready",
      selectedEngine: "claude_local",
    });
    expect(mockSetupGetView).toHaveBeenCalledWith("company-1");
  });

  it("updates setup progress and records activity", async () => {
    mockSetupUpdate.mockResolvedValue({
      companyId: "company-1",
      status: "workspace_connected",
      selectedEngine: "claude_local",
      selectedWorkspaceId: "11111111-1111-4111-8111-111111111111",
      metadata: {},
      steps: {
        companyReady: true,
        squadReady: true,
        engineReady: true,
        workspaceConnected: true,
        knowledgeSeeded: false,
        firstIssueReady: false,
      },
      createdAt: new Date("2026-03-07T00:00:00.000Z"),
      updatedAt: new Date("2026-03-07T01:00:00.000Z"),
    });

    const response = await invokeRoute({
      path: "/:companyId/setup-progress",
      method: "patch",
      params: { companyId: "company-1" },
      body: {
        selectedEngine: "claude_local",
        selectedWorkspaceId: "11111111-1111-4111-8111-111111111111",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(mockSetupUpdate).toHaveBeenCalledWith("company-1", {
      selectedEngine: "claude_local",
      selectedWorkspaceId: "11111111-1111-4111-8111-111111111111",
    });
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "setup.progress.updated",
        companyId: "company-1",
      }),
    );
  });

  it("runs doctor checks with validated query params", async () => {
    mockDoctorRun.mockResolvedValue({
      status: "pass",
      companyId: "company-1",
      selectedEngine: "codex_local",
      workspace: null,
      checkedAt: "2026-03-07T00:00:00.000Z",
      checks: [],
      summary: {
        pass: 3,
        warn: 0,
        fail: 0,
      },
    });

    const response = await invokeRoute({
      path: "/:companyId/doctor",
      method: "get",
      params: { companyId: "company-1" },
      query: {
        deep: "true",
        workspaceId: "11111111-1111-4111-8111-111111111111",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(mockDoctorRun).toHaveBeenCalledWith({
      companyId: "company-1",
      workspaceId: "11111111-1111-4111-8111-111111111111",
      deep: true,
    });
  });

  it("returns role pack revisions for the requested pack", async () => {
    mockListRolePackRevisions.mockResolvedValue([
      {
        id: "revision-1",
        rolePackSetId: "role-pack-1",
        version: 3,
        status: "published",
        message: "Tighten review criteria",
        createdByUserId: "user-1",
        createdByAgentId: null,
        createdAt: new Date("2026-03-08T00:00:00.000Z"),
        publishedAt: new Date("2026-03-08T00:00:00.000Z"),
        files: [
          {
            id: "file-1",
            revisionId: "revision-1",
            filename: "ROLE.md",
            content: "# Reviewer",
            checksumSha256: "abc",
            createdAt: new Date("2026-03-08T00:00:00.000Z"),
          },
        ],
      },
    ]);

    const response = await invokeRoute({
      path: "/:companyId/role-packs/:rolePackSetId/revisions",
      method: "get",
      params: { companyId: "company-1", rolePackSetId: "role-pack-1" },
    });

    expect(response.statusCode).toBe(200);
    expect(mockListRolePackRevisions).toHaveBeenCalledWith({
      companyId: "company-1",
      rolePackSetId: "role-pack-1",
    });
    expect(response.body).toMatchObject([
      {
        id: "revision-1",
        version: 3,
        status: "published",
      },
    ]);
  });

  it("restores a role pack revision as a new revision", async () => {
    mockRestoreRolePackRevision.mockResolvedValue({
      id: "role-pack-1",
      companyId: "company-1",
      scopeType: "company",
      scopeId: null,
      roleKey: "engineer",
      status: "published",
      metadata: {},
      createdAt: new Date("2026-03-08T00:00:00.000Z"),
      updatedAt: new Date("2026-03-08T00:00:00.000Z"),
      latestRevision: {
        id: "revision-2",
        rolePackSetId: "role-pack-1",
        version: 2,
        status: "draft",
        message: "Restore v1 for rollback review",
        createdByUserId: "user-1",
        createdByAgentId: null,
        createdAt: new Date("2026-03-08T01:00:00.000Z"),
        publishedAt: null,
      },
      latestFiles: [],
    });

    const response = await invokeRoute({
      path: "/:companyId/role-packs/:rolePackSetId/revisions/:revisionId/restore",
      method: "post",
      params: {
        companyId: "company-1",
        rolePackSetId: "role-pack-1",
        revisionId: "revision-1",
      },
      body: {
        message: "Restore v1 for rollback review",
        status: "draft",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(mockRestoreRolePackRevision).toHaveBeenCalledWith({
      companyId: "company-1",
      rolePackSetId: "role-pack-1",
      revisionId: "revision-1",
      actor: {
        userId: "user-1",
        agentId: null,
      },
      restore: {
        message: "Restore v1 for rollback review",
        status: "draft",
      },
    });
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "role_pack.revision.restored",
        companyId: "company-1",
      }),
    );
  });

  it("simulates a role pack with compiled prompt output", async () => {
    mockSimulateRolePack.mockResolvedValue({
      rolePackSetId: "role-pack-1",
      roleKey: "engineer",
      presetKey: "example_product_squad_v1",
      revisionId: "revision-9",
      revisionVersion: 9,
      scenario: {
        workflowState: "implementing",
        messageType: "START_IMPLEMENTATION",
        issueTitle: "Ship smoke hardening",
        issueSummary: "Validate the current draft against delivery expectations.",
        taskBrief: "Keep the slice reversible.",
        retrievalSummary: null,
        acceptanceCriteria: ["Evidence included"],
        changedFiles: ["ui/src/pages/Dashboard.tsx"],
        reviewFindings: [],
        blockerCode: null,
      },
      compiledFiles: [],
      runtimePrompt: "Runtime prompt",
      checklist: ["Verify evidence"],
      guardrails: ["Do not widen scope."],
      suggestedMessages: [
        {
          messageType: "SUBMIT_FOR_REVIEW",
          reason: "Implementation is ready for review.",
          summaryTemplate: "Submit with evidence",
        },
      ],
    });

    const response = await invokeRoute({
      path: "/:companyId/role-packs/:rolePackSetId/simulate",
      method: "post",
      params: { companyId: "company-1", rolePackSetId: "role-pack-1" },
      body: {
        scenario: {
          workflowState: "implementing",
          messageType: "START_IMPLEMENTATION",
          issueTitle: "Ship smoke hardening",
          issueSummary: "Validate the current draft against delivery expectations.",
          acceptanceCriteria: ["Evidence included"],
          changedFiles: ["ui/src/pages/Dashboard.tsx"],
          reviewFindings: [],
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(mockSimulateRolePack).toHaveBeenCalledWith({
      companyId: "company-1",
      rolePackSetId: "role-pack-1",
      simulation: {
        scenario: {
          workflowState: "implementing",
          messageType: "START_IMPLEMENTATION",
          issueTitle: "Ship smoke hardening",
          issueSummary: "Validate the current draft against delivery expectations.",
          acceptanceCriteria: ["Evidence included"],
          changedFiles: ["ui/src/pages/Dashboard.tsx"],
          reviewFindings: [],
        },
      },
    });
    expect(response.body).toMatchObject({
      rolePackSetId: "role-pack-1",
      roleKey: "engineer",
      suggestedMessages: [
        expect.objectContaining({
          messageType: "SUBMIT_FOR_REVIEW",
        }),
      ],
    });
  });

  it("rejects invalid doctor queries before calling the service", async () => {
    const response = await invokeRoute({
      path: "/:companyId/doctor",
      method: "get",
      params: { companyId: "company-1" },
      query: {
        workspaceId: "not-a-uuid",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(mockDoctorRun).not.toHaveBeenCalled();
  });

  it("seeds role packs and advances setup progress", async () => {
    mockSeedDefaults.mockResolvedValue({
      presetKey: "squadrail_default_v1",
      created: [
        { id: "rp-tech-lead", roleKey: "tech_lead" },
        { id: "rp-engineer", roleKey: "engineer" },
        { id: "rp-reviewer", roleKey: "reviewer" },
      ],
      existing: [],
    });
    mockSetupUpdate.mockResolvedValue({
      companyId: "company-1",
      status: "squad_ready",
      selectedEngine: null,
      selectedWorkspaceId: null,
      metadata: {
        rolePacksSeeded: true,
        rolePackPresetKey: "squadrail_default_v1",
      },
      steps: {
        companyReady: true,
        squadReady: true,
        engineReady: false,
        workspaceConnected: false,
        knowledgeSeeded: false,
        firstIssueReady: false,
      },
      createdAt: new Date("2026-03-07T00:00:00.000Z"),
      updatedAt: new Date("2026-03-07T00:00:00.000Z"),
    });

    const response = await invokeRoute({
      path: "/:companyId/role-packs/seed-defaults",
      method: "post",
      params: { companyId: "company-1" },
      body: {},
    });

    expect(response.statusCode).toBe(201);
    expect(mockSeedDefaults).toHaveBeenCalledWith({
      companyId: "company-1",
      force: undefined,
      presetKey: undefined,
      actor: {
        userId: "user-1",
        agentId: null,
      },
    });
    expect(mockSetupUpdate).toHaveBeenCalledWith("company-1", {
      status: "squad_ready",
      metadata: {
        rolePacksSeeded: true,
        rolePackPresetKey: "squadrail_default_v1",
      },
    });
  });

  it("initializes setup progress when creating a company", async () => {
    mockCompanyCreate.mockResolvedValue({
      id: "company-2",
      name: "Acme",
      issuePrefix: "ACME",
    });

    const response = await invokeRoute({
      path: "/",
      method: "post",
      body: { name: "Acme" },
    });

    expect(response.statusCode).toBe(201);
    expect(mockEnsureMembership).toHaveBeenCalledWith(
      "company-2",
      "user",
      "user-1",
      "owner",
      "active",
    );
    expect(mockSetupUpdate).toHaveBeenCalledWith("company-2", {
      status: "company_ready",
    });
  });
});
