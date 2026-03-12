import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockListGoals,
  mockGetGoalById,
  mockCreateGoal,
  mockUpdateGoal,
  mockRemoveGoal,
  mockLogActivity,
} = vi.hoisted(() => ({
  mockListGoals: vi.fn(),
  mockGetGoalById: vi.fn(),
  mockCreateGoal: vi.fn(),
  mockUpdateGoal: vi.fn(),
  mockRemoveGoal: vi.fn(),
  mockLogActivity: vi.fn(),
}));

vi.mock("../services/index.js", () => ({
  goalService: () => ({
    list: mockListGoals,
    getById: mockGetGoalById,
    create: mockCreateGoal,
    update: mockUpdateGoal,
    remove: mockRemoveGoal,
  }),
  logActivity: mockLogActivity,
}));

import { goalRoutes } from "../routes/goals.js";

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
  return goalRoutes({} as never) as any;
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
}) {
  const router = createTestRouter();
  const handlers = findRouteLayer(router, input.path, input.method);
  const req = {
    params: input.params ?? {},
    body: input.body ?? {},
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

describe("goal routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a goal with planning fields", async () => {
    mockCreateGoal.mockResolvedValue({
      id: "goal-1",
      companyId: "company-1",
      title: "Ship planning layer",
      description: null,
      level: "team",
      status: "active",
      progressPercent: 35,
      targetDate: new Date("2026-03-20T00:00:00.000Z"),
      sprintName: "Sprint 14",
      capacityTargetPoints: 20,
      capacityCommittedPoints: 8,
      parentId: null,
      ownerAgentId: null,
      createdAt: new Date("2026-03-13T00:00:00.000Z"),
      updatedAt: new Date("2026-03-13T00:00:00.000Z"),
    });

    const response = await invokeRoute({
      path: "/companies/:companyId/goals",
      method: "post",
      params: { companyId: "company-1" },
      body: {
        title: "Ship planning layer",
        level: "team",
        status: "active",
        progressPercent: 35,
        targetDate: "2026-03-20T00:00:00.000Z",
        sprintName: "Sprint 14",
        capacityTargetPoints: 20,
        capacityCommittedPoints: 8,
      },
    });

    expect(response.statusCode).toBe(201);
    expect(mockCreateGoal).toHaveBeenCalledWith("company-1", expect.objectContaining({
      title: "Ship planning layer",
      progressPercent: 35,
      sprintName: "Sprint 14",
      capacityTargetPoints: 20,
      capacityCommittedPoints: 8,
      targetDate: expect.any(Date),
    }));
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "goal.created",
        companyId: "company-1",
      }),
    );
  });

  it("updates a goal planning window", async () => {
    mockGetGoalById.mockResolvedValue({
      id: "goal-1",
      companyId: "company-1",
      title: "Ship planning layer",
      description: null,
      level: "team",
      status: "active",
      progressPercent: 35,
      targetDate: new Date("2026-03-20T00:00:00.000Z"),
      sprintName: "Sprint 14",
      capacityTargetPoints: 20,
      capacityCommittedPoints: 8,
      parentId: null,
      ownerAgentId: null,
      createdAt: new Date("2026-03-13T00:00:00.000Z"),
      updatedAt: new Date("2026-03-13T00:00:00.000Z"),
    });
    mockUpdateGoal.mockResolvedValue({
      id: "goal-1",
      companyId: "company-1",
      title: "Ship planning layer",
      description: null,
      level: "team",
      status: "active",
      progressPercent: 70,
      targetDate: new Date("2026-03-27T00:00:00.000Z"),
      sprintName: "Sprint 15",
      capacityTargetPoints: 20,
      capacityCommittedPoints: 14,
      parentId: null,
      ownerAgentId: null,
      createdAt: new Date("2026-03-13T00:00:00.000Z"),
      updatedAt: new Date("2026-03-14T00:00:00.000Z"),
    });

    const response = await invokeRoute({
      path: "/goals/:id",
      method: "patch",
      params: { id: "goal-1" },
      body: {
        progressPercent: 70,
        targetDate: "2026-03-27T00:00:00.000Z",
        sprintName: "Sprint 15",
        capacityCommittedPoints: 14,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(mockUpdateGoal).toHaveBeenCalledWith("goal-1", expect.objectContaining({
      progressPercent: 70,
      sprintName: "Sprint 15",
      capacityCommittedPoints: 14,
      targetDate: expect.any(Date),
    }));
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "goal.updated",
        entityId: "goal-1",
      }),
    );
  });
});
