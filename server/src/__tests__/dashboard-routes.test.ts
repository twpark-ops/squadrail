import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockSummary,
  mockProtocolQueue,
  mockAgentPerformance,
  mockTeamSupervision,
  mockRecoveryQueue,
  mockApplyRecoveryAction,
} = vi.hoisted(() => ({
  mockSummary: vi.fn(),
  mockProtocolQueue: vi.fn(),
  mockAgentPerformance: vi.fn(),
  mockTeamSupervision: vi.fn(),
  mockRecoveryQueue: vi.fn(),
  mockApplyRecoveryAction: vi.fn(),
}));

vi.mock("../services/dashboard.js", () => ({
  dashboardService: () => ({
    summary: mockSummary,
    protocolQueue: mockProtocolQueue,
    agentPerformance: mockAgentPerformance,
    teamSupervision: mockTeamSupervision,
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

  it("returns summary data with attention and knowledge aggregates", async () => {
    mockSummary.mockResolvedValue({
      companyId: "company-1",
      agents: { active: 3, running: 1, paused: 0, error: 0 },
      tasks: { open: 4, inProgress: 2, blocked: 1, done: 3 },
      costs: {
        monthSpendCents: 100,
        monthBudgetCents: 500,
        monthUtilizationPercent: 20,
      },
      protocol: {
        workflowCounts: {},
        executionQueueCount: 2,
        reviewQueueCount: 3,
        handoffBlockerCount: 1,
        blockedQueueCount: 1,
        awaitingHumanDecisionCount: 1,
        readyToCloseCount: 1,
        staleQueueCount: 1,
        openViolationCount: 2,
        protocolMessagesLast24h: 8,
      },
      executionReliability: {
        runningRuns: 1,
        queuedRuns: 2,
        dispatchRedispatchesLast24h: 0,
        dispatchTimeoutsLast24h: 1,
        processLostLast24h: 0,
        workspaceBlockedLast24h: 1,
        priorityPreemptionsLast24h: 1,
      },
      attention: {
        urgentIssueCount: 5,
        reviewPressureCount: 4,
        staleWorkCount: 2,
        runtimeRiskCount: 2,
      },
      knowledge: {
        totalDocuments: 12,
        connectedDocuments: 8,
        linkedChunks: 18,
        totalLinks: 32,
        activeProjects: 2,
        lowConfidenceRuns7d: 3,
      },
      pendingApprovals: 1,
      staleTasks: 1,
    });

    const response = await invokeRoute({
      path: "/companies/:companyId/dashboard",
      method: "get",
      params: { companyId: "company-1" },
    });

    expect(response.statusCode).toBe(200);
    expect(mockSummary).toHaveBeenCalledWith("company-1");
    expect(response.body).toMatchObject({
      attention: {
        urgentIssueCount: 5,
        reviewPressureCount: 4,
      },
      knowledge: {
        totalDocuments: 12,
        lowConfidenceRuns7d: 3,
      },
    });
  });

  it("returns recovery queue data", async () => {
    mockRecoveryQueue.mockResolvedValue({
      summary: {
        totalCases: 1,
        repeatedCases: 1,
        retryableCases: 0,
        operatorRequiredCases: 1,
        blockedCases: 0,
      },
      items: [
        {
          issueId: "issue-1",
          identifier: "CLO-1",
          title: "Dispatch timeout",
          workflowState: "blocked",
          recoveryType: "runtime",
          failureFamily: "dispatch",
          retryability: "operator_required",
          severity: "high",
          code: "dispatch_timeout",
          summary: "Dispatch watchdog timed out.",
          nextAction: "Inspect adapter cold-start and watchdog events.",
          operatorActionLabel: "Review repeated runtime failure",
          occurrenceCount24h: 2,
          repeated: true,
          lastSeenAt: new Date("2026-03-12T00:00:00.000Z"),
          createdAt: new Date("2026-03-12T00:00:00.000Z"),
        },
      ],
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
    expect(response.body).toMatchObject({
      summary: {
        totalCases: 1,
        repeatedCases: 1,
        operatorRequiredCases: 1,
      },
      items: [
        {
          issueId: "issue-1",
          failureFamily: "dispatch",
          retryability: "operator_required",
          occurrenceCount24h: 2,
        },
      ],
    });
  });

  it("returns agent performance feed data", async () => {
    mockAgentPerformance.mockResolvedValue({
      companyId: "company-1",
      generatedAt: new Date("2026-03-12T00:00:00.000Z").toISOString(),
      summary: {
        totalAgents: 2,
        healthyAgents: 1,
        warningAgents: 1,
        riskAgents: 0,
        priorityPreemptions7d: 3,
      },
      items: [
        {
          agentId: "agent-1",
          name: "Engineer One",
          title: "Senior Engineer",
          role: "engineer",
          status: "active",
          adapterType: "codex_local",
          lastHeartbeatAt: new Date("2026-03-12T00:00:00.000Z"),
          openIssueCount: 2,
          completedIssueCount30d: 6,
          reviewBounceCount30d: 1,
          qaBounceCount30d: 0,
          runningCount: 1,
          queuedCount: 0,
          totalRuns7d: 12,
          successfulRuns7d: 11,
          failedRuns7d: 1,
          timedOutRuns7d: 0,
          cancelledRuns7d: 0,
          successRate7d: 91.7,
          averageRunDurationMs7d: 220000,
          priorityPreemptions7d: 2,
          health: "warning",
          summaryText: "Recent change-request loops suggest review pressure is rising.",
        },
      ],
    });

    const response = await invokeRoute({
      path: "/companies/:companyId/dashboard/agent-performance",
      method: "get",
      params: { companyId: "company-1" },
      query: { limit: "10" },
    });

    expect(response.statusCode).toBe(200);
    expect(mockAgentPerformance).toHaveBeenCalledWith({
      companyId: "company-1",
      limit: 10,
    });
    expect(response.body).toMatchObject({
      summary: {
        totalAgents: 2,
        priorityPreemptions7d: 3,
      },
      items: [
        {
          agentId: "agent-1",
          successRate7d: 91.7,
          health: "warning",
        },
      ],
    });
  });

  it("returns team supervision feed data", async () => {
    mockTeamSupervision.mockResolvedValue({
      companyId: "company-1",
      generatedAt: new Date("2026-03-12T00:00:00.000Z").toISOString(),
      summary: {
        total: 2,
        blocked: 1,
        review: 1,
        active: 0,
        queued: 0,
      },
      items: [],
    });

    const response = await invokeRoute({
      path: "/companies/:companyId/dashboard/team-supervision",
      method: "get",
      params: { companyId: "company-1" },
      query: { limit: "15" },
    });

    expect(response.statusCode).toBe(200);
    expect(mockTeamSupervision).toHaveBeenCalledWith({
      companyId: "company-1",
      limit: 15,
    });
    expect(response.body).toMatchObject({
      summary: {
        total: 2,
        blocked: 1,
      },
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
