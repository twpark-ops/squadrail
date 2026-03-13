import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAgentCreate,
  mockAgentGetById,
  mockAgentCreateApiKey,
  mockAgentPause,
  mockAgentResume,
  mockAgentRevokeKey,
  mockAgentRollbackConfigRevision,
  mockAgentTerminate,
  mockAgentUpdatePermissions,
  mockAgentUpdate,
  mockHeartbeatCancelActiveForAgent,
  mockHeartbeatGetActiveRunForAgent,
  mockHeartbeatInvoke,
  mockHeartbeatGetRun,
  mockHeartbeatWakeup,
  mockIssueGetById,
  mockIssueGetByIdentifier,
  mockListAdapterModels,
  mockNormalizeAdapterConfigForPersistence,
  mockLogActivity,
} = vi.hoisted(() => ({
  mockAgentCreate: vi.fn(),
  mockAgentGetById: vi.fn(),
  mockAgentCreateApiKey: vi.fn(),
  mockAgentPause: vi.fn(),
  mockAgentResume: vi.fn(),
  mockAgentRevokeKey: vi.fn(),
  mockAgentRollbackConfigRevision: vi.fn(),
  mockAgentTerminate: vi.fn(),
  mockAgentUpdatePermissions: vi.fn(),
  mockAgentUpdate: vi.fn(),
  mockHeartbeatCancelActiveForAgent: vi.fn(),
  mockHeartbeatGetActiveRunForAgent: vi.fn(),
  mockHeartbeatInvoke: vi.fn(),
  mockHeartbeatGetRun: vi.fn(),
  mockHeartbeatWakeup: vi.fn(),
  mockIssueGetById: vi.fn(),
  mockIssueGetByIdentifier: vi.fn(),
  mockListAdapterModels: vi.fn(),
  mockNormalizeAdapterConfigForPersistence: vi.fn(),
  mockLogActivity: vi.fn(),
}));

vi.mock("../services/index.js", () => ({
  agentService: () => ({
    create: mockAgentCreate,
    getById: mockAgentGetById,
    createApiKey: mockAgentCreateApiKey,
    update: mockAgentUpdate,
    updatePermissions: mockAgentUpdatePermissions,
    pause: mockAgentPause,
    resume: mockAgentResume,
    terminate: mockAgentTerminate,
    rollbackConfigRevision: mockAgentRollbackConfigRevision,
    revokeKey: mockAgentRevokeKey,
    list: vi.fn(),
    resolveByReference: vi.fn(),
    getChainOfCommand: vi.fn().mockResolvedValue([]),
  }),
  accessService: () => ({
    canUser: vi.fn().mockResolvedValue(true),
    hasPermission: vi.fn().mockResolvedValue(true),
  }),
  approvalService: () => ({
    listPendingByCompany: vi.fn(),
  }),
  heartbeatService: () => ({
    cancelActiveForAgent: mockHeartbeatCancelActiveForAgent,
    getRun: mockHeartbeatGetRun,
    getActiveRunForAgent: mockHeartbeatGetActiveRunForAgent,
    invoke: mockHeartbeatInvoke,
    wakeup: mockHeartbeatWakeup,
  }),
  issueApprovalService: () => ({
    listIssuesForApproval: vi.fn(),
  }),
  issueService: () => ({
    list: vi.fn(),
    getById: mockIssueGetById,
    getByIdentifier: mockIssueGetByIdentifier,
  }),
  secretService: () => ({
    normalizeAdapterConfigForPersistence: mockNormalizeAdapterConfigForPersistence,
  }),
  logActivity: mockLogActivity,
}));

vi.mock("../adapters/index.js", () => ({
  findServerAdapter: vi.fn(),
  listAdapterModels: mockListAdapterModels,
}));

vi.mock("@squadrail/adapter-claude-local/server", () => ({
  runClaudeLogin: vi.fn(),
}));

import { agentRoutes } from "../routes/agents.js";

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

function findRouteHandlers(router: any, path: string, method: "get" | "patch" | "post" | "delete") {
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
  method: "get" | "patch" | "post" | "delete";
  params?: Record<string, string>;
  body?: unknown;
  actor?: ReturnType<typeof buildBoardActor>;
  query?: Record<string, string>;
}) {
  const router = agentRoutes({} as never) as any;
  const handlers = findRouteHandlers(router, input.path, input.method);
  const req = {
    params: input.params ?? {},
    body: input.body ?? {},
    actor: input.actor ?? buildBoardActor(),
    query: input.query ?? {},
    headers: {},
  };
  const state: { statusCode: number; body: unknown } = {
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
          if (handler.length < 3) resolve();
        } catch (error) {
          reject(error);
        }
      });
    }
    return state;
  } catch (error: any) {
    return {
      statusCode: error?.status ?? 500,
      body: { error: error?.message ?? "Unhandled error" },
    };
  }
}

describe("agent routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListAdapterModels.mockResolvedValue([
      { id: "gpt-5", label: "GPT-5" },
    ]);
    mockNormalizeAdapterConfigForPersistence.mockImplementation(async (_companyId: string, config: Record<string, unknown>) => config);
    mockHeartbeatGetRun.mockResolvedValue(null);
    mockHeartbeatGetActiveRunForAgent.mockResolvedValue(null);
    mockHeartbeatCancelActiveForAgent.mockResolvedValue(1);
    mockHeartbeatWakeup.mockResolvedValue({
      id: "run-wake-1",
      companyId: "company-1",
      agentId: "11111111-1111-4111-8111-111111111111",
      status: "queued",
    });
    mockHeartbeatInvoke.mockResolvedValue({
      id: "run-invoke-1",
      companyId: "company-1",
      agentId: "11111111-1111-4111-8111-111111111111",
      status: "queued",
    });
    mockIssueGetByIdentifier.mockResolvedValue(null);
    mockIssueGetById.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
      status: "in_progress",
      assigneeAgentId: "agent-1",
      executionRunId: "run-completed-1",
    });
    mockAgentGetById.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
      name: "Codex",
      adapterType: "codex_local",
      adapterConfig: {
        cwd: "/workspace/project",
        instructionsFilePath: "/workspace/project/AGENTS.md",
      },
    });
    mockAgentUpdate.mockImplementation(async (_id: string, patch: Record<string, unknown>) => ({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
      adapterType: "codex_local",
      adapterConfig: patch.adapterConfig,
    }));
    mockAgentCreate.mockImplementation(async (_companyId: string, input: Record<string, unknown>) => ({
      id: "new-agent-1",
      companyId: "company-1",
      name: input.name,
      role: input.role,
      adapterType: input.adapterType,
      adapterConfig: input.adapterConfig,
      status: input.status,
    }));
    mockAgentUpdatePermissions.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
      permissions: { canCreateAgents: true },
    });
    mockAgentPause.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
      status: "paused",
    });
    mockAgentResume.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
      status: "active",
    });
    mockAgentTerminate.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
      status: "terminated",
    });
    mockAgentCreateApiKey.mockResolvedValue({
      id: "key-1",
      name: "Primary key",
      token: "pcp_token",
    });
    mockAgentRevokeKey.mockResolvedValue({
      id: "key-1",
    });
    mockAgentRollbackConfigRevision.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
      adapterType: "codex_local",
      adapterConfig: {
        cwd: "/workspace/project",
      },
    });
  });

  it("lists adapter models through the public adapter route", async () => {
    const response = await invokeRoute({
      path: "/adapters/:type/models",
      method: "get",
      params: { type: "codex_local" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual([{ id: "gpt-5", label: "GPT-5" }]);
    expect(mockListAdapterModels).toHaveBeenCalledWith("codex_local");
  });

  it("resolves relative instructions paths against adapter cwd", async () => {
    const response = await invokeRoute({
      path: "/agents/:id/instructions-path",
      method: "patch",
      params: { id: "11111111-1111-4111-8111-111111111111" },
      body: {
        path: "docs/runtime/AGENTS.md",
      },
    });

    expect(response.statusCode, JSON.stringify(response.body)).toBe(200);
    expect(mockNormalizeAdapterConfigForPersistence).toHaveBeenCalledWith(
      "company-1",
      expect.objectContaining({
        cwd: "/workspace/project",
        instructionsFilePath: "/workspace/project/docs/runtime/AGENTS.md",
      }),
      { strictMode: false },
    );
    expect(mockAgentUpdate).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      expect.objectContaining({
        adapterConfig: expect.objectContaining({
          instructionsFilePath: "/workspace/project/docs/runtime/AGENTS.md",
        }),
      }),
      expect.any(Object),
    );
    expect(mockLogActivity).toHaveBeenCalledTimes(1);
  });

  it("falls back to the assignee active run when executionRunId is stale", async () => {
    mockHeartbeatGetRun
      .mockResolvedValueOnce({
        id: "run-completed-1",
        agentId: "agent-1",
        companyId: "company-1",
        status: "completed",
      })
      .mockResolvedValueOnce({
        id: "run-active-1",
        agentId: "agent-1",
        companyId: "company-1",
        status: "running",
        contextSnapshot: {
          issueId: "11111111-1111-4111-8111-111111111111",
        },
      });
    mockHeartbeatGetActiveRunForAgent.mockResolvedValue({
      id: "run-active-1",
      agentId: "agent-1",
      companyId: "company-1",
      status: "running",
      contextSnapshot: {
        issueId: "11111111-1111-4111-8111-111111111111",
      },
    });
    mockAgentGetById.mockResolvedValue({
      id: "agent-1",
      companyId: "company-1",
      name: "Engineer One",
      adapterType: "codex_local",
      adapterConfig: {
        cwd: "/workspace/project",
      },
    });

    const response = await invokeRoute({
      path: "/issues/:issueId/active-run",
      method: "get",
      params: { issueId: "11111111-1111-4111-8111-111111111111" },
    });

    expect(response.statusCode, JSON.stringify(response.body)).toBe(200);
    expect(mockIssueGetById).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111");
    expect(mockHeartbeatGetRun).toHaveBeenCalledWith("run-completed-1");
    expect(mockHeartbeatGetActiveRunForAgent).toHaveBeenCalledWith("agent-1");
    expect(response.body).toEqual(expect.objectContaining({
      id: "run-active-1",
      agentId: "agent-1",
      agentName: "Engineer One",
      adapterType: "codex_local",
    }));
  });

  it("creates agents with adapter defaults and normalized adapter config", async () => {
    const response = await invokeRoute({
      path: "/companies/:companyId/agents",
      method: "post",
      params: { companyId: "company-1" },
      body: {
        name: "Infra Lead",
        role: "engineer",
        adapterType: "codex_local",
        adapterConfig: {},
      },
    });

    expect(response.statusCode, JSON.stringify(response.body)).toBe(201);
    expect(mockNormalizeAdapterConfigForPersistence).toHaveBeenCalledWith(
      "company-1",
      expect.objectContaining({
        model: expect.any(String),
      }),
      { strictMode: false },
    );
    expect(mockAgentCreate).toHaveBeenCalledWith("company-1", expect.objectContaining({
      name: "Infra Lead",
      role: "engineer",
      status: "idle",
    }));
  });

  it("updates agent permissions through the dedicated permissions route", async () => {
    const response = await invokeRoute({
      path: "/agents/:id/permissions",
      method: "patch",
      params: { id: "11111111-1111-4111-8111-111111111111" },
      body: {
        canCreateAgents: true,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(mockAgentUpdatePermissions).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      { canCreateAgents: true },
    );
  });

  it("pauses and resumes agents while canceling active work on pause", async () => {
    const paused = await invokeRoute({
      path: "/agents/:id/pause",
      method: "post",
      params: { id: "11111111-1111-4111-8111-111111111111" },
    });
    const resumed = await invokeRoute({
      path: "/agents/:id/resume",
      method: "post",
      params: { id: "11111111-1111-4111-8111-111111111111" },
    });

    expect(paused.statusCode).toBe(200);
    expect(resumed.statusCode).toBe(200);
    expect(mockHeartbeatCancelActiveForAgent).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111");
    expect(mockAgentPause).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111");
    expect(mockAgentResume).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111");
  });

  it("creates and revokes agent api keys through the board surface", async () => {
    const created = await invokeRoute({
      path: "/agents/:id/keys",
      method: "post",
      params: { id: "11111111-1111-4111-8111-111111111111" },
      body: { name: "Primary key" },
    });
    const revoked = await invokeRoute({
      path: "/agents/:id/keys/:keyId",
      method: "delete",
      params: {
        id: "11111111-1111-4111-8111-111111111111",
        keyId: "key-1",
      },
    });

    expect(created.statusCode).toBe(201);
    expect(created.body).toEqual({
      id: "key-1",
      name: "Primary key",
      token: "pcp_token",
    });
    expect(revoked.statusCode).toBe(200);
    expect(revoked.body).toEqual({ ok: true });
    expect(mockAgentCreateApiKey).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111", "Primary key");
    expect(mockAgentRevokeKey).toHaveBeenCalledWith("key-1");
  });

  it("wakes and invokes agents through heartbeat routes", async () => {
    const wake = await invokeRoute({
      path: "/agents/:id/wakeup",
      method: "post",
      params: { id: "11111111-1111-4111-8111-111111111111" },
      body: {
        source: "on_demand",
        triggerDetail: "manual",
      },
    });
    const invoke = await invokeRoute({
      path: "/agents/:id/heartbeat/invoke",
      method: "post",
      params: { id: "11111111-1111-4111-8111-111111111111" },
    });

    expect(wake.statusCode).toBe(202);
    expect(invoke.statusCode).toBe(202);
    expect(mockHeartbeatWakeup).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      expect.objectContaining({
        source: "on_demand",
        triggerDetail: "manual",
      }),
    );
    expect(mockHeartbeatInvoke).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      "on_demand",
      expect.objectContaining({
        triggeredBy: "board",
      }),
      "manual",
      expect.any(Object),
    );
  });

  it("rolls back configuration revisions through the rollback endpoint", async () => {
    const response = await invokeRoute({
      path: "/agents/:id/config-revisions/:revisionId/rollback",
      method: "post",
      params: {
        id: "11111111-1111-4111-8111-111111111111",
        revisionId: "revision-1",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(mockAgentRollbackConfigRevision).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      "revision-1",
      {
        agentId: null,
        userId: "user-1",
      },
    );
  });
});
