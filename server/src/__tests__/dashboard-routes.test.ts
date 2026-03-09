import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockSummary,
  mockProtocolQueue,
  mockRecoveryQueue,
  mockApplyRecoveryAction,
} = vi.hoisted(() => ({
  mockSummary: vi.fn(),
  mockProtocolQueue: vi.fn(),
  mockRecoveryQueue: vi.fn(),
  mockApplyRecoveryAction: vi.fn(),
}));

vi.mock("../services/dashboard.js", () => ({
  dashboardService: () => ({
    summary: mockSummary,
    protocolQueue: mockProtocolQueue,
    recoveryQueue: mockRecoveryQueue,
    applyRecoveryAction: mockApplyRecoveryAction,
  }),
  buildProtocolDashboardBuckets: vi.fn(),
  isProtocolDashboardStale: vi.fn(),
}));

import { dashboardRoutes } from "../routes/dashboard.js";

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
  return dashboardRoutes({} as never) as any;
}

function findRouteLayer(router: any, path: string, method: "get" | "post") {
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
  method: "get" | "post";
  params?: Record<string, string>;
  body?: unknown;
  query?: Record<string, unknown>;
  actor?: ReturnType<typeof buildBoardActor> | {
    type: "agent";
    source: "api_key";
    agentId: string;
    companyIds: string[];
    runId: string | null;
  };
}) {
  const router = createTestRouter();
  const handlers = findRouteLayer(router, input.path, input.method);
  const req = {
    params: input.params ?? {},
    body: input.body ?? {},
    query: input.query ?? {},
    actor: input.actor ?? buildBoardActor(),
  } as any;
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

describe("dashboard routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns recovery queue data", async () => {
    mockRecoveryQueue.mockResolvedValue({
      items: [],
      summary: {
        total: 0,
        byType: { violation: 0, timeout: 0, integrity: 0 },
      },
    });

    const response = await invokeRoute({
      path: "/companies/:companyId/dashboard/recovery-queue",
      method: "get",
      params: { companyId: "company-1" },
      query: { limit: "12" },
    });

    expect(response.statusCode).toBe(200);
    expect(mockRecoveryQueue).toHaveBeenCalledWith({
      companyId: "company-1",
      limit: 12,
    });
  });

  it("applies recovery actions for board actors", async () => {
    mockApplyRecoveryAction.mockResolvedValue({
      actionType: "resolve_violations",
      issueIds: ["issue-1"],
      resolvedViolationCount: 2,
      createdMessageCount: 0,
    });

    const response = await invokeRoute({
      path: "/companies/:companyId/dashboard/recovery-queue/actions",
      method: "post",
      params: { companyId: "company-1" },
      body: {
        actionType: "resolve_violations",
        issueIds: ["11111111-1111-4111-8111-111111111111"],
        recoveryTypes: ["violation"],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(mockApplyRecoveryAction).toHaveBeenCalledWith({
      companyId: "company-1",
      actionType: "resolve_violations",
      issueIds: ["11111111-1111-4111-8111-111111111111"],
      recoveryTypes: ["violation"],
      noteBody: null,
      actor: {
        userId: "user-1",
      },
    });
  });

  it("rejects recovery actions from non-board actors", async () => {
    const response = await invokeRoute({
      path: "/companies/:companyId/dashboard/recovery-queue/actions",
      method: "post",
      params: { companyId: "company-1" },
      actor: {
        type: "agent",
        source: "api_key",
        agentId: "agent-1",
        companyIds: ["company-1"],
        runId: null,
      },
      body: {
        actionType: "post_recovery_note",
        issueIds: ["11111111-1111-4111-8111-111111111111"],
        noteBody: "Recover this issue",
      },
    });

    expect(response.statusCode).toBe(403);
    expect(mockApplyRecoveryAction).not.toHaveBeenCalled();
  });
});
