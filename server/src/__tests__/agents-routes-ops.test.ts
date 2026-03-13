import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetById,
  mockListKeys,
  mockListConfigRevisions,
  mockGetConfigRevision,
  mockOrgForCompany,
  mockTerminate,
  mockRemove,
  mockNormalizeAdapterConfigForPersistence,
  mockResolveAdapterConfigForRuntime,
  mockGetRuntimeState,
  mockListTaskSessions,
  mockResetRuntimeSession,
  mockListHeartbeatRuns,
  mockCancelRun,
  mockCancelActiveForAgent,
  mockGetRun,
  mockListEvents,
  mockReadLog,
  mockFindServerAdapter,
  mockRunClaudeLogin,
  mockLogActivity,
} = vi.hoisted(() => ({
  mockGetById: vi.fn(),
  mockListKeys: vi.fn(),
  mockListConfigRevisions: vi.fn(),
  mockGetConfigRevision: vi.fn(),
  mockOrgForCompany: vi.fn(),
  mockTerminate: vi.fn(),
  mockRemove: vi.fn(),
  mockNormalizeAdapterConfigForPersistence: vi.fn(),
  mockResolveAdapterConfigForRuntime: vi.fn(),
  mockGetRuntimeState: vi.fn(),
  mockListTaskSessions: vi.fn(),
  mockResetRuntimeSession: vi.fn(),
  mockListHeartbeatRuns: vi.fn(),
  mockCancelRun: vi.fn(),
  mockCancelActiveForAgent: vi.fn(),
  mockGetRun: vi.fn(),
  mockListEvents: vi.fn(),
  mockReadLog: vi.fn(),
  mockFindServerAdapter: vi.fn(),
  mockRunClaudeLogin: vi.fn(),
  mockLogActivity: vi.fn(),
}));

vi.mock("../services/index.js", () => ({
  agentService: () => ({
    getById: mockGetById,
    listKeys: mockListKeys,
    listConfigRevisions: mockListConfigRevisions,
    getConfigRevision: mockGetConfigRevision,
    orgForCompany: mockOrgForCompany,
    terminate: mockTerminate,
    remove: mockRemove,
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
    getRuntimeState: mockGetRuntimeState,
    listTaskSessions: mockListTaskSessions,
    resetRuntimeSession: mockResetRuntimeSession,
    list: mockListHeartbeatRuns,
    cancelRun: mockCancelRun,
    cancelActiveForAgent: mockCancelActiveForAgent,
    getRun: mockGetRun,
    listEvents: mockListEvents,
    readLog: mockReadLog,
  }),
  issueApprovalService: () => ({
    listIssuesForApproval: vi.fn(),
  }),
  issueService: () => ({
    getById: vi.fn(),
    getByIdentifier: vi.fn(),
  }),
  secretService: () => ({
    normalizeAdapterConfigForPersistence: mockNormalizeAdapterConfigForPersistence,
    resolveAdapterConfigForRuntime: mockResolveAdapterConfigForRuntime,
  }),
  logActivity: mockLogActivity,
}));

vi.mock("../adapters/index.js", () => ({
  findServerAdapter: mockFindServerAdapter,
  listAdapterModels: vi.fn(),
}));

vi.mock("@squadrail/adapter-claude-local/server", () => ({
  runClaudeLogin: mockRunClaudeLogin,
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

function findRouteHandlers(router: any, path: string, method: "get" | "post" | "delete") {
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
  method: "get" | "post" | "delete";
  params?: Record<string, string>;
  body?: unknown;
  query?: Record<string, unknown>;
  actor?: ReturnType<typeof buildBoardActor>;
}) {
  const router = agentRoutes({} as never) as any;
  const handlers = findRouteHandlers(router, input.path, input.method);
  const req = {
    params: input.params ?? {},
    body: input.body ?? {},
    query: input.query ?? {},
    actor: input.actor ?? buildBoardActor(),
  };
  const state: { statusCode: number; body: unknown } = { statusCode: 200, body: undefined };
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

describe("agent route operational surfaces", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNormalizeAdapterConfigForPersistence.mockImplementation(async (_companyId: string, config: Record<string, unknown>) => config);
    mockResolveAdapterConfigForRuntime.mockImplementation(async (_companyId: string, config: Record<string, unknown>) => ({
      ...config,
      resolved: true,
    }));
    mockGetById.mockResolvedValue({
      id: "agent-1",
      companyId: "company-1",
      name: "Runtime Captain",
      adapterType: "codex_local",
      adapterConfig: { cwd: "/workspace/runtime" },
    });
    mockListKeys.mockResolvedValue([{ id: "key-1", name: "Primary" }]);
    mockListConfigRevisions.mockResolvedValue([
      {
        id: "revision-1",
        adapterConfigSnapshot: { apiKey: "secret", cwd: "/workspace/runtime" },
        runtimeConfigSnapshot: { token: "secret" },
      },
    ]);
    mockGetConfigRevision.mockResolvedValue({
      id: "revision-1",
      adapterConfigSnapshot: { apiKey: "secret", cwd: "/workspace/runtime" },
      runtimeConfigSnapshot: { token: "secret" },
    });
    mockOrgForCompany.mockResolvedValue([{ id: "agent-1", name: "Runtime Captain", reports: [] }]);
    mockGetRuntimeState.mockResolvedValue({ status: "idle", workspace: "/workspace/runtime" });
    mockListTaskSessions.mockResolvedValue([
      { id: "session-1", taskKey: "task-1", sessionParamsJson: { token: "secret", ok: true } },
    ]);
    mockResetRuntimeSession.mockResolvedValue({ reset: true });
    mockTerminate.mockResolvedValue({ id: "agent-1", companyId: "company-1", status: "terminated" });
    mockRemove.mockResolvedValue({ id: "agent-1", companyId: "company-1" });
    mockListHeartbeatRuns.mockResolvedValue([{ id: "run-1", agentId: "agent-1", status: "running" }]);
    mockCancelRun.mockResolvedValue({ id: "run-1", companyId: "company-1", agentId: "agent-1" });
    mockCancelActiveForAgent.mockResolvedValue(1);
    mockGetRun.mockResolvedValue({ id: "run-1", companyId: "company-1", agentId: "agent-1" });
    mockListEvents.mockResolvedValue([{ seq: 1, payload: { secret: "value", ok: true } }]);
    mockReadLog.mockResolvedValue({ offset: 0, nextOffset: 12, text: "runtime log" });
    mockRunClaudeLogin.mockResolvedValue({ launched: true });
  });

  it("tests adapter environments through runtime-resolved config", async () => {
    const adapterTestEnvironment = vi.fn().mockResolvedValue({ ok: true, checks: ["cwd"] });
    mockFindServerAdapter.mockReturnValue({ testEnvironment: adapterTestEnvironment });

    const response = await invokeRoute({
      path: "/companies/:companyId/adapters/:type/test-environment",
      method: "post",
      params: { companyId: "company-1", type: "codex_local" },
      body: {
        adapterConfig: {
          cwd: "/workspace/runtime",
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ ok: true, checks: ["cwd"] });
    expect(mockNormalizeAdapterConfigForPersistence).toHaveBeenCalledWith(
      "company-1",
      { cwd: "/workspace/runtime" },
      { strictMode: false },
    );
    expect(mockResolveAdapterConfigForRuntime).toHaveBeenCalledWith(
      "company-1",
      { cwd: "/workspace/runtime" },
    );
    expect(adapterTestEnvironment).toHaveBeenCalledWith(expect.objectContaining({
      companyId: "company-1",
      adapterType: "codex_local",
      config: expect.objectContaining({ resolved: true }),
    }));
  });

  it("serves org trees, agent configurations, and config revisions with redaction", async () => {
    const org = await invokeRoute({
      path: "/companies/:companyId/org",
      method: "get",
      params: { companyId: "company-1" },
    });
    const configuration = await invokeRoute({
      path: "/agents/:id/configuration",
      method: "get",
      params: { id: "agent-1" },
    });
    const revisions = await invokeRoute({
      path: "/agents/:id/config-revisions",
      method: "get",
      params: { id: "agent-1" },
    });
    const revision = await invokeRoute({
      path: "/agents/:id/config-revisions/:revisionId",
      method: "get",
      params: { id: "agent-1", revisionId: "revision-1" },
    });

    expect(org.body).toEqual([
      expect.objectContaining({
        id: "agent-1",
        name: "Runtime Captain",
        reports: [],
      }),
    ]);
    expect(configuration.body).toEqual(expect.objectContaining({
      id: "agent-1",
      companyId: "company-1",
      adapterConfig: { cwd: "/workspace/runtime" },
    }));
    expect(revisions.body).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "revision-1",
        adapterConfigSnapshot: expect.objectContaining({ cwd: "/workspace/runtime" }),
      }),
    ]));
    expect(revision.body).toEqual(expect.objectContaining({
      id: "revision-1",
      adapterConfigSnapshot: expect.objectContaining({ cwd: "/workspace/runtime" }),
    }));
  });

  it("returns runtime state, redacted task sessions, and reset responses", async () => {
    const runtime = await invokeRoute({
      path: "/agents/:id/runtime-state",
      method: "get",
      params: { id: "agent-1" },
    });
    const sessions = await invokeRoute({
      path: "/agents/:id/task-sessions",
      method: "get",
      params: { id: "agent-1" },
    });
    const reset = await invokeRoute({
      path: "/agents/:id/runtime-state/reset-session",
      method: "post",
      params: { id: "agent-1" },
      body: {
        taskKey: " task-1 ",
      },
    });

    expect(runtime.body).toEqual({ status: "idle", workspace: "/workspace/runtime" });
    expect(sessions.body).toEqual([
      expect.objectContaining({
        id: "session-1",
        taskKey: "task-1",
        sessionParamsJson: { token: "secret", ok: true },
      }),
    ]);
    expect(reset.body).toEqual({ reset: true });
    expect(mockResetRuntimeSession).toHaveBeenCalledWith("agent-1", { taskKey: "task-1" });
  });

  it("terminates, deletes, and lists keys for agent lifecycle management", async () => {
    const terminate = await invokeRoute({
      path: "/agents/:id/terminate",
      method: "post",
      params: { id: "agent-1" },
    });
    const keys = await invokeRoute({
      path: "/agents/:id/keys",
      method: "get",
      params: { id: "agent-1" },
    });
    const deleted = await invokeRoute({
      path: "/agents/:id",
      method: "delete",
      params: { id: "agent-1" },
    });

    expect(terminate.statusCode).toBe(200);
    expect(keys.body).toEqual([{ id: "key-1", name: "Primary" }]);
    expect(deleted.body).toEqual({ ok: true });
    expect(mockTerminate).toHaveBeenCalledWith("agent-1");
    expect(mockRemove).toHaveBeenCalledWith("agent-1");
    expect(mockListKeys).toHaveBeenCalledWith("agent-1");
    expect(mockCancelActiveForAgent).toHaveBeenCalledWith("agent-1");
  });

  it("supports claude login only for claude-local agents", async () => {
    const rejected = await invokeRoute({
      path: "/agents/:id/claude-login",
      method: "post",
      params: { id: "agent-1" },
    });

    mockGetById.mockResolvedValueOnce({
      id: "agent-claude",
      companyId: "company-1",
      name: "Claude",
      adapterType: "claude_local",
      adapterConfig: { cwd: "/workspace/claude" },
    });

    const accepted = await invokeRoute({
      path: "/agents/:id/claude-login",
      method: "post",
      params: { id: "agent-claude" },
    });

    expect(rejected.statusCode).toBe(400);
    expect(rejected.body).toEqual({ error: "Login is only supported for claude_local agents" });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.body).toEqual({ launched: true });
    expect(mockResolveAdapterConfigForRuntime).toHaveBeenCalledWith(
      "company-1",
      { cwd: "/workspace/claude" },
    );
    expect(mockRunClaudeLogin).toHaveBeenCalledWith(expect.objectContaining({
      runId: expect.stringMatching(/^claude-login-/),
      agent: expect.objectContaining({
        id: "agent-claude",
        adapterType: "claude_local",
      }),
      config: expect.objectContaining({ resolved: true }),
    }));
  });

  it("lists heartbeat runs and exposes run cancellation, events, and logs", async () => {
    const listed = await invokeRoute({
      path: "/companies/:companyId/heartbeat-runs",
      method: "get",
      params: { companyId: "company-1" },
      query: { agentId: "agent-1", limit: "25" },
    });
    const cancelled = await invokeRoute({
      path: "/heartbeat-runs/:runId/cancel",
      method: "post",
      params: { runId: "run-1" },
    });
    const events = await invokeRoute({
      path: "/heartbeat-runs/:runId/events",
      method: "get",
      params: { runId: "run-1" },
      query: { afterSeq: "1", limit: "50" },
    });
    const log = await invokeRoute({
      path: "/heartbeat-runs/:runId/log",
      method: "get",
      params: { runId: "run-1" },
      query: { offset: "5", limitBytes: "2048" },
    });

    expect(listed.body).toEqual([{ id: "run-1", agentId: "agent-1", status: "running" }]);
    expect(cancelled.body).toEqual({ id: "run-1", companyId: "company-1", agentId: "agent-1" });
    expect(events.body).toEqual([
      expect.objectContaining({
        seq: 1,
        payload: { ok: true, secret: "***REDACTED***" },
      }),
    ]);
    expect(log.body).toEqual({ offset: 0, nextOffset: 12, text: "runtime log" });
    expect(mockListHeartbeatRuns).toHaveBeenCalledWith("company-1", "agent-1", 25);
    expect(mockCancelRun).toHaveBeenCalledWith("run-1");
    expect(mockListEvents).toHaveBeenCalledWith("run-1", 1, 50);
    expect(mockReadLog).toHaveBeenCalledWith("run-1", { offset: 5, limitBytes: 2048 });
  });
});
