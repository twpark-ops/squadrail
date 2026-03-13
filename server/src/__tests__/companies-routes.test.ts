import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockEnsureMembership,
  mockCompanyCreate,
  mockCompanyList,
  mockCompanyStats,
  mockCompanyGetById,
  mockCompanyUpdate,
  mockCompanyArchive,
  mockCompanyRemove,
  mockPortabilityExportBundle,
  mockPortabilityPreviewImport,
  mockPortabilityImportBundle,
  mockSetupGetView,
  mockSetupUpdate,
  mockWorkflowTemplatesGetView,
  mockWorkflowTemplatesUpdateConfig,
  mockOperatingAlertsGetView,
  mockOperatingAlertsUpdateConfig,
  mockOperatingAlertsSendTest,
  mockKnowledgeSetupGetOrgSync,
  mockKnowledgeSetupRepairOrgSync,
  mockKnowledgeSetupGetKnowledgeSetup,
  mockKnowledgeSetupRunKnowledgeSync,
  mockKnowledgeSetupGetKnowledgeSyncJob,
  mockOrgMemoryBackfillCompany,
  mockDoctorRun,
  mockListRolePacks,
  mockListPresets,
  mockGetRolePack,
  mockListRolePackRevisions,
  mockSeedDefaults,
  mockCreateDraftRevision,
  mockRestoreRolePackRevision,
  mockSimulateRolePack,
  mockCreateCustomRolePack,
  mockLogActivity,
} = vi.hoisted(() => ({
  mockEnsureMembership: vi.fn(),
  mockCompanyCreate: vi.fn(),
  mockCompanyList: vi.fn(),
  mockCompanyStats: vi.fn(),
  mockCompanyGetById: vi.fn(),
  mockCompanyUpdate: vi.fn(),
  mockCompanyArchive: vi.fn(),
  mockCompanyRemove: vi.fn(),
  mockPortabilityExportBundle: vi.fn(),
  mockPortabilityPreviewImport: vi.fn(),
  mockPortabilityImportBundle: vi.fn(),
  mockSetupGetView: vi.fn(),
  mockSetupUpdate: vi.fn(),
  mockWorkflowTemplatesGetView: vi.fn(),
  mockWorkflowTemplatesUpdateConfig: vi.fn(),
  mockOperatingAlertsGetView: vi.fn(),
  mockOperatingAlertsUpdateConfig: vi.fn(),
  mockOperatingAlertsSendTest: vi.fn(),
  mockKnowledgeSetupGetOrgSync: vi.fn(),
  mockKnowledgeSetupRepairOrgSync: vi.fn(),
  mockKnowledgeSetupGetKnowledgeSetup: vi.fn(),
  mockKnowledgeSetupRunKnowledgeSync: vi.fn(),
  mockKnowledgeSetupGetKnowledgeSyncJob: vi.fn(),
  mockOrgMemoryBackfillCompany: vi.fn(),
  mockDoctorRun: vi.fn(),
  mockListRolePacks: vi.fn(),
  mockListPresets: vi.fn(),
  mockGetRolePack: vi.fn(),
  mockListRolePackRevisions: vi.fn(),
  mockSeedDefaults: vi.fn(),
  mockCreateDraftRevision: vi.fn(),
  mockRestoreRolePackRevision: vi.fn(),
  mockSimulateRolePack: vi.fn(),
  mockCreateCustomRolePack: vi.fn(),
  mockLogActivity: vi.fn(),
}));

vi.mock("../services/index.js", () => ({
  accessService: () => ({
    ensureMembership: mockEnsureMembership,
  }),
  companyPortabilityService: () => ({
    exportBundle: mockPortabilityExportBundle,
    previewImport: mockPortabilityPreviewImport,
    importBundle: mockPortabilityImportBundle,
  }),
  companyService: () => ({
    create: mockCompanyCreate,
    list: mockCompanyList,
    stats: mockCompanyStats,
    getById: mockCompanyGetById,
    update: mockCompanyUpdate,
    archive: mockCompanyArchive,
    remove: mockCompanyRemove,
  }),
  doctorService: () => ({
    run: mockDoctorRun,
  }),
  organizationalMemoryService: () => ({
    backfillCompany: mockOrgMemoryBackfillCompany,
  }),
  knowledgeSetupService: () => ({
    getOrgSync: mockKnowledgeSetupGetOrgSync,
    repairOrgSync: mockKnowledgeSetupRepairOrgSync,
    getKnowledgeSetup: mockKnowledgeSetupGetKnowledgeSetup,
    runKnowledgeSync: mockKnowledgeSetupRunKnowledgeSync,
    getKnowledgeSyncJob: mockKnowledgeSetupGetKnowledgeSyncJob,
  }),
  logActivity: mockLogActivity,
  operatingAlertService: () => ({
    getView: mockOperatingAlertsGetView,
    updateConfig: mockOperatingAlertsUpdateConfig,
    sendTestAlert: mockOperatingAlertsSendTest,
  }),
  workflowTemplateService: () => ({
    getView: mockWorkflowTemplatesGetView,
    updateConfig: mockWorkflowTemplatesUpdateConfig,
  }),
  rolePackService: () => ({
    listPresets: mockListPresets,
    listRolePacks: mockListRolePacks,
    getRolePack: mockGetRolePack,
    listRevisions: mockListRolePackRevisions,
    seedDefaults: mockSeedDefaults,
    createCustomRolePack: mockCreateCustomRolePack,
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

function findRouteLayer(router: any, path: string, method: "get" | "post" | "patch" | "delete") {
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
  method: "get" | "post" | "patch" | "delete";
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
      statusCode: error?.name === "ZodError" ? 400 : (error?.status ?? 500),
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

  it("returns workflow templates for the requested company", async () => {
    mockWorkflowTemplatesGetView.mockResolvedValue({
      companyId: "company-1",
      templates: [
        {
          id: "default-close-task",
          actionType: "CLOSE_TASK",
          label: "Default Close",
          description: null,
          summary: "Board closed {issueIdentifier}",
          fields: {
            closureSummary: "Close with rollback context",
          },
          scope: "default",
        },
      ],
      companyTemplates: [],
      updatedAt: new Date("2026-03-13T00:00:00.000Z"),
    });

    const response = await invokeRoute({
      path: "/:companyId/workflow-templates",
      method: "get",
      params: { companyId: "company-1" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      companyId: "company-1",
      templates: [
        expect.objectContaining({
          id: "default-close-task",
          actionType: "CLOSE_TASK",
        }),
      ],
    });
    expect(mockWorkflowTemplatesGetView).toHaveBeenCalledWith("company-1");
  });

  it("updates workflow templates and records activity", async () => {
    mockWorkflowTemplatesUpdateConfig.mockResolvedValue({
      companyId: "company-1",
      templates: [
        {
          id: "company-close-task",
          actionType: "CLOSE_TASK",
          label: "Release close",
          description: "Human close template",
          summary: "Board closed {issueIdentifier}",
          fields: {
            closureSummary: "Human-reviewed close",
            rollbackPlan: "Reopen or revert if rollout regresses",
          },
          scope: "company",
        },
        {
          id: "company-follow-up",
          actionType: "CREATE_FOLLOW_UP",
          label: "Recovery follow-up",
          description: "Escalate recovery path",
          summary: "Create a recovery follow-up for {issueIdentifier}",
          fields: {
            title: "Recovery follow-up",
          },
          scope: "company",
        },
      ],
      companyTemplates: [
        {
          id: "company-close-task",
          actionType: "CLOSE_TASK",
          label: "Release close",
          description: "Human close template",
          summary: "Board closed {issueIdentifier}",
          fields: {
            closureSummary: "Human-reviewed close",
            rollbackPlan: "Reopen or revert if rollout regresses",
          },
          scope: "company",
        },
        {
          id: "company-follow-up",
          actionType: "CREATE_FOLLOW_UP",
          label: "Recovery follow-up",
          description: "Escalate recovery path",
          summary: "Create a recovery follow-up for {issueIdentifier}",
          fields: {
            title: "Recovery follow-up",
          },
          scope: "company",
        },
      ],
      updatedAt: new Date("2026-03-13T00:00:00.000Z"),
    });

    const response = await invokeRoute({
      path: "/:companyId/workflow-templates",
      method: "patch",
      params: { companyId: "company-1" },
      body: {
        templates: [
          {
            id: "company-close-task",
            actionType: "CLOSE_TASK",
            label: "Release close",
            description: "Human close template",
            summary: "Board closed {issueIdentifier}",
            fields: {
              closureSummary: "Human-reviewed close",
              rollbackPlan: "Reopen or revert if rollout regresses",
            },
          },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(mockWorkflowTemplatesUpdateConfig).toHaveBeenCalledWith("company-1", {
      templates: [
        {
          id: "company-close-task",
          actionType: "CLOSE_TASK",
          label: "Release close",
          description: "Human close template",
          summary: "Board closed {issueIdentifier}",
          fields: {
            closureSummary: "Human-reviewed close",
            rollbackPlan: "Reopen or revert if rollout regresses",
          },
        },
      ],
    });
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "company.workflow_templates.updated",
        companyId: "company-1",
        details: {
          templateCount: 2,
          actionTypes: ["CLOSE_TASK", "CREATE_FOLLOW_UP"],
        },
      }),
    );
  });

  it("rejects workflow template updates with duplicate IDs before hitting the service", async () => {
    const response = await invokeRoute({
      path: "/:companyId/workflow-templates",
      method: "patch",
      params: { companyId: "company-1" },
      body: {
        templates: [
          {
            id: "company-shared-template",
            actionType: "ASSIGN_TASK",
            label: "Assignment",
            description: null,
            summary: null,
            fields: {},
          },
          {
            id: "company-shared-template",
            actionType: "CLOSE_TASK",
            label: "Close",
            description: null,
            summary: null,
            fields: {},
          },
        ],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(mockWorkflowTemplatesUpdateConfig).not.toHaveBeenCalled();
  });

  it("returns operating alert settings for the requested company", async () => {
    mockOperatingAlertsGetView.mockResolvedValue({
      companyId: "company-1",
      config: {
        enabled: true,
        minSeverity: "high",
        cooldownMinutes: 15,
        destinations: [],
      },
      recentDeliveries: [
        {
          id: "delivery-1",
          status: "delivered",
          severity: "high",
          reason: "dependency_blocked",
          intent: "operator_required",
          summary: "Dispatch is blocked by unresolved dependency work.",
          detail: "Waiting on CLO-99",
          dedupeKey: "dependency_blocked:issue-1",
          destinationLabel: "Ops Slack",
          destinationType: "slack_webhook",
          responseStatus: 200,
          deliveredAt: "2026-03-13T00:10:00.000Z",
          issue: {
            id: "issue-1",
            identifier: "CLO-220",
            title: "Change surface issue",
          },
        },
      ],
    });

    const response = await invokeRoute({
      path: "/:companyId/operating-alerts",
      method: "get",
      params: { companyId: "company-1" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      companyId: "company-1",
      config: {
        enabled: true,
        minSeverity: "high",
      },
      recentDeliveries: [
        expect.objectContaining({
          dedupeKey: "dependency_blocked:issue-1",
          issue: {
            id: "issue-1",
            identifier: "CLO-220",
            title: "Change surface issue",
          },
        }),
      ],
    });
    expect(mockOperatingAlertsGetView).toHaveBeenCalledWith("company-1");
  });

  it("updates operating alert settings and records activity", async () => {
    mockOperatingAlertsUpdateConfig.mockResolvedValue({
      companyId: "company-1",
      config: {
        enabled: true,
        minSeverity: "critical",
        cooldownMinutes: 30,
        destinations: [
          {
            id: "dest-1",
            label: "Ops Slack",
            type: "slack_webhook",
            url: "https://hooks.slack.com/services/test",
            enabled: true,
            authHeaderName: null,
            authHeaderValue: null,
          },
        ],
      },
      recentDeliveries: [],
    });

    const response = await invokeRoute({
      path: "/:companyId/operating-alerts",
      method: "patch",
      params: { companyId: "company-1" },
      body: {
        enabled: true,
        minSeverity: "critical",
        cooldownMinutes: 30,
        destinations: [
          {
            id: "dest-1",
            label: "Ops Slack",
            type: "slack_webhook",
            url: "https://hooks.slack.com/services/test",
          },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(mockOperatingAlertsUpdateConfig).toHaveBeenCalledWith("company-1", {
      enabled: true,
      minSeverity: "critical",
      cooldownMinutes: 30,
      destinations: [
        {
          id: "dest-1",
          label: "Ops Slack",
          type: "slack_webhook",
          url: "https://hooks.slack.com/services/test",
          enabled: true,
        },
      ],
    });
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "company.operating_alerts.updated",
        companyId: "company-1",
      }),
    );
  });

  it("sends a test operating alert and returns a 202 response", async () => {
    mockOperatingAlertsSendTest.mockResolvedValue({
      companyId: "company-1",
      attemptedCount: 1,
      deliveredCount: 1,
      failedCount: 0,
      records: [],
    });

    const response = await invokeRoute({
      path: "/:companyId/operating-alerts/test",
      method: "post",
      params: { companyId: "company-1" },
      body: {
        severity: "high",
      },
    });

    expect(response.statusCode).toBe(202);
    expect(mockOperatingAlertsSendTest).toHaveBeenCalledWith("company-1", {
      severity: "high",
    });
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "company.operating_alerts.test_requested",
        companyId: "company-1",
      }),
    );
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

  it("returns org sync status for the requested company", async () => {
    mockKnowledgeSetupGetOrgSync.mockResolvedValue({
      companyId: "company-1",
      templateKey: "cloud-swiftsight",
      templateConfigured: true,
      canonicalVersion: "cloud-swiftsight-18a-v1",
      canonicalAgentCount: 18,
      liveAgentCount: 13,
      matchedAgentCount: 13,
      status: "repairable",
      missingAgents: [],
      extraAgents: [],
      mismatchedAgents: [],
      generatedAt: "2026-03-11T00:00:00.000Z",
    });

    const response = await invokeRoute({
      path: "/:companyId/org-sync",
      method: "get",
      params: { companyId: "company-1" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      companyId: "company-1",
      status: "repairable",
      canonicalAgentCount: 18,
    });
    expect(mockKnowledgeSetupGetOrgSync).toHaveBeenCalledWith("company-1");
  });

  it("repairs org sync drift and records activity", async () => {
    mockKnowledgeSetupRepairOrgSync.mockResolvedValue({
      companyId: "company-1",
      createdAgentIds: ["agent-created"],
      updatedAgentIds: ["agent-updated"],
      pausedAgentIds: ["agent-paused"],
      adoptedAgentIds: ["agent-adopted"],
      statusBefore: "repairable",
      statusAfter: "in_sync",
      orgSync: {
        companyId: "company-1",
        templateKey: "cloud-swiftsight",
        templateConfigured: true,
        canonicalVersion: "cloud-swiftsight-18a-v1",
        canonicalAgentCount: 18,
        liveAgentCount: 18,
        matchedAgentCount: 18,
        status: "in_sync",
        missingAgents: [],
        extraAgents: [],
        mismatchedAgents: [],
        generatedAt: "2026-03-11T00:00:00.000Z",
      },
    });

    const response = await invokeRoute({
      path: "/:companyId/org-sync/repair",
      method: "post",
      params: { companyId: "company-1" },
      body: {
        createMissing: true,
        adoptLegacySingleEngineers: true,
        repairMismatches: true,
        pauseLegacyExtras: true,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(mockKnowledgeSetupRepairOrgSync).toHaveBeenCalledWith(
      "company-1",
      {
        createMissing: true,
        adoptLegacySingleEngineers: true,
        repairMismatches: true,
        pauseLegacyExtras: true,
      },
      expect.objectContaining({
        actorType: "user",
        actorId: "user-1",
      }),
    );
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "company.org_sync_repaired",
        companyId: "company-1",
      }),
    );
  });

  it("returns knowledge setup view for the requested company", async () => {
    mockKnowledgeSetupGetKnowledgeSetup.mockResolvedValue({
      companyId: "company-1",
      generatedAt: "2026-03-11T00:00:00.000Z",
      cache: {
        state: "fresh",
        refreshInFlight: false,
        freshUntil: "2026-03-11T00:00:15.000Z",
        staleUntil: "2026-03-11T00:02:00.000Z",
        lastRefreshStartedAt: "2026-03-11T00:00:00.000Z",
        lastRefreshCompletedAt: "2026-03-11T00:00:01.000Z",
        lastRefreshErrorAt: null,
        lastRefreshError: null,
      },
      setupProgressStatus: "first_issue_ready",
      orgSync: {
        companyId: "company-1",
        templateKey: "cloud-swiftsight",
        templateConfigured: true,
        canonicalVersion: "cloud-swiftsight-18a-v1",
        canonicalAgentCount: 18,
        liveAgentCount: 18,
        matchedAgentCount: 18,
        status: "in_sync",
        missingAgents: [],
        extraAgents: [],
        mismatchedAgents: [],
        generatedAt: "2026-03-11T00:00:00.000Z",
      },
      projects: [],
      activeJobCount: 0,
      latestJob: null,
      recentJobs: [],
    });

    const response = await invokeRoute({
      path: "/:companyId/knowledge-setup",
      method: "get",
      params: { companyId: "company-1" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      companyId: "company-1",
      setupProgressStatus: "first_issue_ready",
      activeJobCount: 0,
      cache: {
        state: "fresh",
        refreshInFlight: false,
      },
    });
    expect(mockKnowledgeSetupGetKnowledgeSetup).toHaveBeenCalledWith("company-1");
  });

  it("starts a company knowledge sync job and records activity", async () => {
    mockKnowledgeSetupRunKnowledgeSync.mockResolvedValue({
      id: "job-1",
      companyId: "company-1",
      status: "running",
      selectedProjectIds: ["11111111-1111-4111-8111-111111111111"],
      optionsJson: {
        rebuildGraph: true,
        rebuildVersions: true,
        backfillPersonalization: true,
      },
      summaryJson: {},
      error: null,
      startedAt: "2026-03-11T00:00:00.000Z",
      completedAt: null,
      createdAt: "2026-03-11T00:00:00.000Z",
      updatedAt: "2026-03-11T00:00:00.000Z",
      projectRuns: [],
    });

    const response = await invokeRoute({
      path: "/:companyId/knowledge-sync",
      method: "post",
      params: { companyId: "company-1" },
      body: {
        projectIds: ["11111111-1111-4111-8111-111111111111"],
        rebuildGraph: true,
        rebuildVersions: true,
        backfillPersonalization: true,
      },
    });

    expect(response.statusCode).toBe(201);
    expect(mockKnowledgeSetupRunKnowledgeSync).toHaveBeenCalledWith(
      "company-1",
      {
        projectIds: ["11111111-1111-4111-8111-111111111111"],
        forceFull: false,
        rebuildGraph: true,
        rebuildVersions: true,
        backfillPersonalization: true,
      },
      expect.objectContaining({
        actorType: "user",
        actorId: "user-1",
      }),
    );
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "knowledge.sync_requested",
        companyId: "company-1",
      }),
    );
  });

  it("returns a knowledge sync job by id", async () => {
    mockKnowledgeSetupGetKnowledgeSyncJob.mockResolvedValue({
      id: "job-1",
      companyId: "company-1",
      status: "completed",
      selectedProjectIds: [],
      optionsJson: {},
      summaryJson: {},
      error: null,
      startedAt: "2026-03-11T00:00:00.000Z",
      completedAt: "2026-03-11T00:10:00.000Z",
      createdAt: "2026-03-11T00:00:00.000Z",
      updatedAt: "2026-03-11T00:10:00.000Z",
      projectRuns: [],
    });

    const response = await invokeRoute({
      path: "/:companyId/knowledge-sync/:jobId",
      method: "get",
      params: { companyId: "company-1", jobId: "job-1" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      id: "job-1",
      companyId: "company-1",
      status: "completed",
    });
    expect(mockKnowledgeSetupGetKnowledgeSyncJob).toHaveBeenCalledWith("company-1", "job-1");
  });

  it("runs organizational memory backfill for a company", async () => {
    mockOrgMemoryBackfillCompany.mockResolvedValue({
      companyId: "company-1",
      issueScanned: 12,
      issueDocumentCount: 12,
      messageScanned: 20,
      protocolDocumentCount: 9,
      reviewDocumentCount: 6,
      completedAt: "2026-03-11T00:00:00.000Z",
    });

    const response = await invokeRoute({
      path: "/:companyId/organizational-memory/backfill",
      method: "post",
      params: { companyId: "company-1" },
      body: {
        issueLimit: 25,
        messageLimit: 50,
      },
    });

    expect(response.statusCode).toBe(202);
    expect(mockOrgMemoryBackfillCompany).toHaveBeenCalledWith({
      companyId: "company-1",
      issueLimit: 25,
      messageLimit: 50,
      issueIds: undefined,
      messageIds: undefined,
    });
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "knowledge.organizational_memory.backfilled",
        companyId: "company-1",
      }),
    );
  });

  it("returns 404 when a knowledge sync job cannot be found", async () => {
    mockKnowledgeSetupGetKnowledgeSyncJob.mockResolvedValue(null);

    const response = await invokeRoute({
      path: "/:companyId/knowledge-sync/:jobId",
      method: "get",
      params: { companyId: "company-1", jobId: "missing-job" },
    });

    expect(response.statusCode).toBe(404);
    expect(response.body).toMatchObject({
      error: "Knowledge sync job not found",
    });
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

  it("creates a custom role pack and records activity", async () => {
    mockCreateCustomRolePack.mockResolvedValue({
      id: "role-pack-custom",
      companyId: "company-1",
      scopeType: "company",
      scopeId: "custom:release-captain",
      roleKey: "custom",
      displayName: "Release Captain",
      baseRoleKey: "tech_lead",
      customRoleName: "Release Captain",
      customRoleDescription: "Own release orchestration",
      customRoleSlug: "release-captain",
      status: "published",
      metadata: {},
      createdAt: new Date("2026-03-13T00:00:00.000Z"),
      updatedAt: new Date("2026-03-13T00:00:00.000Z"),
      latestRevision: null,
      latestFiles: [],
    });

    const response = await invokeRoute({
      path: "/:companyId/role-packs/custom-roles",
      method: "post",
      params: { companyId: "company-1" },
      body: {
        roleName: "Release Captain",
        roleSlug: "release-captain",
        baseRoleKey: "tech_lead",
        description: "Own release orchestration",
        publish: true,
      },
    });

    expect(response.statusCode).toBe(201);
    expect(mockCreateCustomRolePack).toHaveBeenCalledWith({
      companyId: "company-1",
      actor: {
        userId: "user-1",
        agentId: null,
      },
      customRole: {
        roleName: "Release Captain",
        roleSlug: "release-captain",
        baseRoleKey: "tech_lead",
        description: "Own release orchestration",
        publish: true,
      },
    });
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "role_pack.custom_role.created",
        companyId: "company-1",
      }),
    );
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

  it("lists and filters companies and stats for non-admin board actors", async () => {
    mockCompanyList.mockResolvedValue([
      { id: "company-1", name: "Alpha" },
      { id: "company-2", name: "Beta" },
    ]);
    mockCompanyStats.mockResolvedValue({
      "company-1": { issueCount: 10 },
      "company-2": { issueCount: 20 },
    });

    const actor = {
      ...buildBoardActor(["company-1"]),
      source: "session" as const,
      isInstanceAdmin: false,
    };

    const listed = await invokeRoute({
      path: "/",
      method: "get",
      actor,
    });
    const stats = await invokeRoute({
      path: "/stats",
      method: "get",
      actor,
    });

    expect(listed.statusCode).toBe(200);
    expect(listed.body).toEqual([{ id: "company-1", name: "Alpha" }]);
    expect(stats.statusCode).toBe(200);
    expect(stats.body).toEqual({
      "company-1": { issueCount: 10 },
    });
  });

  it("serves company detail, update, archive, and delete flows", async () => {
    mockCompanyGetById.mockResolvedValueOnce({
      id: "company-1",
      name: "Alpha",
    }).mockResolvedValueOnce(null);
    mockCompanyUpdate.mockResolvedValue({
      id: "company-1",
      name: "Alpha Prime",
    });
    mockCompanyArchive.mockResolvedValue({
      id: "company-1",
      archivedAt: "2026-03-13T01:00:00.000Z",
    });
    mockCompanyRemove.mockResolvedValue({
      id: "company-1",
    });

    const detail = await invokeRoute({
      path: "/:companyId",
      method: "get",
      params: { companyId: "company-1" },
    });
    const missing = await invokeRoute({
      path: "/:companyId",
      method: "get",
      params: { companyId: "company-404" },
    });
    const updated = await invokeRoute({
      path: "/:companyId",
      method: "patch",
      params: { companyId: "company-1" },
      body: { name: "Alpha Prime" },
    });
    const archived = await invokeRoute({
      path: "/:companyId/archive",
      method: "post",
      params: { companyId: "company-1" },
    });
    const removed = await invokeRoute({
      path: "/:companyId",
      method: "delete",
      params: { companyId: "company-1" },
    });

    expect(detail.statusCode).toBe(200);
    expect(detail.body).toEqual({ id: "company-1", name: "Alpha" });
    expect(missing.statusCode).toBe(404);
    expect(updated.statusCode).toBe(200);
    expect(updated.body).toEqual({ id: "company-1", name: "Alpha Prime" });
    expect(archived.statusCode).toBe(200);
    expect(removed.statusCode).toBe(200);
    expect(removed.body).toEqual({ ok: true });
  });

  it("runs doctor validation and portability export/preview/import routes", async () => {
    mockDoctorRun.mockResolvedValue({
      companyId: "company-1",
      status: "ok",
    });
    mockPortabilityExportBundle.mockResolvedValue({
      manifest: { schemaVersion: 1 },
      files: { "COMPANY.md": "# Company" },
      warnings: [],
    });
    mockPortabilityPreviewImport.mockResolvedValue({
      include: { company: true, projects: false, agents: false },
      targetCompanyId: null,
      targetCompanyName: "Imported Company",
      collisionStrategy: "rename",
      selectedProjectSlugs: [],
      selectedAgentSlugs: [],
      plan: {
        companyAction: "create",
        projectPlans: [],
        agentPlans: [],
      },
      requiredSecrets: [],
      warnings: [],
      errors: [],
    });
    mockPortabilityImportBundle.mockResolvedValue({
      company: { id: "company-imported", name: "Imported Company", action: "created" },
      projects: [],
      agents: [],
      warnings: [],
    });

    const badDoctor = await invokeRoute({
      path: "/:companyId/doctor",
      method: "get",
      params: { companyId: "company-1" },
      query: { workspaceId: "not-a-uuid" },
    });
    const goodDoctor = await invokeRoute({
      path: "/:companyId/doctor",
      method: "get",
      params: { companyId: "company-1" },
      query: { deep: "true", workspaceId: "11111111-1111-4111-8111-111111111111" },
    });
    const exported = await invokeRoute({
      path: "/:companyId/export",
      method: "post",
      params: { companyId: "company-1" },
      body: { include: { company: true, projects: false, agents: false } },
    });
    const preview = await invokeRoute({
      path: "/import/preview",
      method: "post",
      body: {
        include: { company: true, projects: false, agents: false },
        target: {
          mode: "new_company",
          newCompanyName: "Imported Company",
        },
        source: {
          type: "inline",
          manifest: {
            schemaVersion: 1,
            generatedAt: "2026-03-13T00:00:00.000Z",
            source: {
              companyId: "11111111-1111-4111-8111-111111111111",
              companyName: "Source Co",
            },
            includes: { company: true, projects: false, agents: false },
            company: {
              path: "COMPANY.md",
              name: "Source Co",
              description: null,
              brandColor: null,
              requireBoardApprovalForNewAgents: false,
            },
            projects: [],
            agents: [],
            requiredSecrets: [],
          },
          files: {
            "COMPANY.md": "---\nkind: company\n---\n\n# Source Co\n",
          },
        },
      },
    });
    const imported = await invokeRoute({
      path: "/import",
      method: "post",
      body: {
        include: { company: true, projects: false, agents: false },
        target: {
          mode: "new_company",
          newCompanyName: "Imported Company",
        },
        source: {
          type: "inline",
          manifest: {
            schemaVersion: 1,
            generatedAt: "2026-03-13T00:00:00.000Z",
            source: {
              companyId: "11111111-1111-4111-8111-111111111111",
              companyName: "Source Co",
            },
            includes: { company: true, projects: false, agents: false },
            company: {
              path: "COMPANY.md",
              name: "Source Co",
              description: null,
              brandColor: null,
              requireBoardApprovalForNewAgents: false,
            },
            projects: [],
            agents: [],
            requiredSecrets: [],
          },
          files: {
            "COMPANY.md": "---\nkind: company\n---\n\n# Source Co\n",
          },
        },
      },
    });

    expect(badDoctor.statusCode).toBe(400);
    expect(goodDoctor.statusCode).toBe(200);
    expect(mockDoctorRun).toHaveBeenCalledWith({
      companyId: "company-1",
      workspaceId: "11111111-1111-4111-8111-111111111111",
      deep: true,
    });
    expect(exported.statusCode).toBe(200);
    expect(preview.statusCode).toBe(200);
    expect(imported.statusCode).toBe(200);
    expect(mockPortabilityExportBundle).toHaveBeenCalledWith("company-1", {
      include: { company: true, projects: false, agents: false },
    });
    expect(mockPortabilityImportBundle).toHaveBeenCalled();
  });
});
