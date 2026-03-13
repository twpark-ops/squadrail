import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAgentCreate,
  mockApprovalCreate,
  mockLinkManyForApproval,
  mockResolveAdapterConfigForPersistence,
  mockIssueGetByIdentifier,
} = vi.hoisted(() => ({
  mockAgentCreate: vi.fn(),
  mockApprovalCreate: vi.fn(),
  mockLinkManyForApproval: vi.fn(),
  mockResolveAdapterConfigForPersistence: vi.fn(),
  mockIssueGetByIdentifier: vi.fn(),
}));

vi.mock("../services/index.js", () => ({
  agentService: () => ({
    create: mockAgentCreate,
    getById: vi.fn(),
    resolveByReference: vi.fn(),
    getChainOfCommand: vi.fn().mockResolvedValue([]),
  }),
  accessService: () => ({
    canUser: vi.fn().mockResolvedValue(true),
    hasPermission: vi.fn().mockResolvedValue(true),
  }),
  approvalService: () => ({
    create: mockApprovalCreate,
    listPendingByCompany: vi.fn(),
    getById: vi.fn(),
  }),
  heartbeatService: () => ({}),
  issueApprovalService: () => ({
    linkManyForApproval: mockLinkManyForApproval,
    listIssuesForApproval: vi.fn(),
  }),
  issueService: () => ({
    getById: vi.fn(),
    getByIdentifier: mockIssueGetByIdentifier,
  }),
  secretService: () => ({
    normalizeAdapterConfigForPersistence: mockResolveAdapterConfigForPersistence,
  }),
  logActivity: vi.fn(),
}));

vi.mock("../adapters/index.js", () => ({
  findServerAdapter: vi.fn(),
  listAdapterModels: vi.fn(),
}));

vi.mock("@squadrail/adapter-claude-local/server", () => ({
  runClaudeLogin: vi.fn(),
}));

import { agentRoutes } from "../routes/agents.js";

function createResolvedChain(rows: unknown[]) {
  const chain = {
    from: () => chain,
    innerJoin: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    then: <T>(resolve: (value: unknown[]) => T | PromiseLike<T>) => Promise.resolve(rows).then(resolve),
  };
  return chain;
}

function createDbMock(selectResults: unknown[][]) {
  const selectQueue = [...selectResults];
  return {
    select: (..._args: unknown[]) => createResolvedChain(selectQueue.shift() ?? []),
  };
}

function buildBoardActor() {
  return {
    type: "board" as const,
    source: "local_implicit" as const,
    isInstanceAdmin: true,
    userId: "user-1",
    companyIds: ["company-1"],
    runId: null,
  };
}

function findRouteHandlers(router: any, path: string, method: "get" | "post") {
  const layer = router.stack.find(
    (entry: any) => entry.route?.path === path && entry.route?.methods?.[method] === true,
  );
  if (!layer?.route?.stack) {
    throw new Error(`Route ${method.toUpperCase()} ${path} not found`);
  }
  return layer.route.stack.map((entry: any) => entry.handle as Function);
}

async function invokeRoute(input: {
  db: unknown;
  path: string;
  method: "get" | "post";
  params?: Record<string, string>;
  body?: unknown;
  query?: Record<string, unknown>;
}) {
  const router = agentRoutes(input.db as never) as any;
  const handlers = findRouteHandlers(router, input.path, input.method);
  const req = {
    params: input.params ?? {},
    body: input.body ?? {},
    query: input.query ?? {},
    actor: buildBoardActor(),
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
}

describe("agent routes with db-backed flows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveAdapterConfigForPersistence.mockImplementation(async (_companyId: string, config: Record<string, unknown>) => config);
    mockAgentCreate.mockResolvedValue({
      id: "agent-1",
      companyId: "company-1",
      name: "Runtime Agent",
      role: "engineer",
      adapterType: "codex_local",
      adapterConfig: { cwd: "/workspace/runtime" },
      runtimeConfig: {},
      metadata: {},
      budgetMonthlyCents: 0,
    });
    mockApprovalCreate.mockResolvedValue({
      id: "approval-1",
      companyId: "company-1",
      type: "hire_agent",
      status: "pending",
    });
  });

  it("creates pending agent hires and links unique source issues when approval is required", async () => {
    const db = createDbMock([
      [
        {
          id: "company-1",
          requireBoardApprovalForNewAgents: true,
        },
      ],
    ]);

    const response = await invokeRoute({
      db,
      path: "/companies/:companyId/agent-hires",
      method: "post",
      params: { companyId: "company-1" },
      body: {
        name: "Runtime Agent",
        role: "engineer",
        adapterType: "codex_local",
        adapterConfig: {
          cwd: "/workspace/runtime",
        },
        sourceIssueIds: [
          "11111111-1111-4111-8111-111111111111",
          "11111111-1111-4111-8111-111111111111",
          "22222222-2222-4222-8222-222222222222",
        ],
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.body).toEqual(expect.objectContaining({
      agent: expect.objectContaining({
        id: "agent-1",
      }),
      approval: expect.objectContaining({
        id: "approval-1",
        status: "pending",
      }),
    }));
    expect(mockAgentCreate).toHaveBeenCalledWith("company-1", expect.objectContaining({
      name: "Runtime Agent",
      role: "engineer",
      status: "pending_approval",
    }));
    expect(mockApprovalCreate).toHaveBeenCalledWith("company-1", expect.objectContaining({
      status: "pending",
      payload: expect.objectContaining({
        name: "Runtime Agent",
        agentId: "agent-1",
      }),
    }));
    expect(mockLinkManyForApproval).toHaveBeenCalledWith("approval-1", [
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    ], {
      agentId: null,
      userId: "user-1",
    });
  });

  it("pads live-runs responses with recent runs when minCount exceeds active count", async () => {
    const db = createDbMock([
      [
        {
          id: "run-active-1",
          status: "running",
          invocationSource: "on_demand",
          triggerDetail: "manual",
          startedAt: new Date("2026-03-13T00:00:00.000Z"),
          finishedAt: null,
          createdAt: new Date("2026-03-13T00:00:00.000Z"),
          agentId: "agent-1",
          agentName: "Runtime Agent",
          adapterType: "codex_local",
          issueId: "issue-1",
        },
      ],
      [
        {
          id: "run-recent-1",
          status: "succeeded",
          invocationSource: "automation",
          triggerDetail: "approval",
          startedAt: new Date("2026-03-12T23:00:00.000Z"),
          finishedAt: new Date("2026-03-12T23:10:00.000Z"),
          createdAt: new Date("2026-03-12T23:00:00.000Z"),
          agentId: "agent-2",
          agentName: "QA Agent",
          adapterType: "claude_local",
          issueId: "issue-2",
        },
      ],
    ]);

    const response = await invokeRoute({
      db,
      path: "/companies/:companyId/live-runs",
      method: "get",
      params: { companyId: "company-1" },
      query: { minCount: "2" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual([
      expect.objectContaining({ id: "run-active-1", status: "running" }),
      expect.objectContaining({ id: "run-recent-1", status: "succeeded" }),
    ]);
  });

  it("lists issue live-runs after resolving issue identifiers through the issue service", async () => {
    mockIssueGetByIdentifier.mockResolvedValue({
      id: "issue-1",
      companyId: "company-1",
      identifier: "CLO-101",
    });
    const db = createDbMock([
      [
        {
          id: "run-1",
          status: "running",
          invocationSource: "automation",
          triggerDetail: "assignment",
          startedAt: new Date("2026-03-13T00:00:00.000Z"),
          finishedAt: null,
          createdAt: new Date("2026-03-13T00:00:00.000Z"),
          agentId: "agent-1",
          agentName: "Runtime Agent",
          adapterType: "codex_local",
        },
      ],
    ]);

    const response = await invokeRoute({
      db,
      path: "/issues/:issueId/live-runs",
      method: "get",
      params: { issueId: "CLO-101" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual([
      expect.objectContaining({
        id: "run-1",
        agentName: "Runtime Agent",
      }),
    ]);
    expect(mockIssueGetByIdentifier).toHaveBeenCalledWith("CLO-101");
  });
});
