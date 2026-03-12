import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/error-handler.js";

const {
  mockActivityCreate,
  mockActivityForIssue,
  mockActivityIssuesForRun,
  mockActivityList,
  mockActivityRunsForIssue,
  mockIssueGetById,
  mockIssueGetByIdentifier,
} = vi.hoisted(() => ({
  mockActivityCreate: vi.fn(),
  mockActivityForIssue: vi.fn(),
  mockActivityIssuesForRun: vi.fn(),
  mockActivityList: vi.fn(),
  mockActivityRunsForIssue: vi.fn(),
  mockIssueGetById: vi.fn(),
  mockIssueGetByIdentifier: vi.fn(),
}));

vi.mock("../services/activity.js", () => ({
  activityService: () => ({
    list: mockActivityList,
    create: mockActivityCreate,
    forIssue: mockActivityForIssue,
    runsForIssue: mockActivityRunsForIssue,
    issuesForRun: mockActivityIssuesForRun,
  }),
}));

vi.mock("../services/index.js", () => ({
  issueService: () => ({
    getById: mockIssueGetById,
    getByIdentifier: mockIssueGetByIdentifier,
  }),
}));

import { activityRoutes } from "../routes/activity.js";

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

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.actor = buildBoardActor();
    next();
  });
  app.use(activityRoutes({} as never));
  app.use(errorHandler);
  return app;
}

describe("activity routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIssueGetByIdentifier.mockResolvedValue(null);
    mockIssueGetById.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
    });
  });

  it("lists company activity with query filters", async () => {
    mockActivityList.mockResolvedValue([{ id: "event-1" }]);

    const app = createApp();
    const response = await request(app)
      .get("/companies/company-1/activity")
      .query({
        agentId: "agent-1",
        entityType: "issue",
        entityId: "issue-1",
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual([{ id: "event-1" }]);
    expect(mockActivityList).toHaveBeenCalledWith({
      companyId: "company-1",
      agentId: "agent-1",
      entityType: "issue",
      entityId: "issue-1",
    });
  });

  it("sanitizes secret-like details when creating activity", async () => {
    mockActivityCreate.mockImplementation(async (input) => input);

    const app = createApp();
    const response = await request(app)
      .post("/companies/company-1/activity")
      .send({
        actorId: "board-1",
        action: "deployment.created",
        entityType: "project",
        entityId: "project-1",
        details: {
          apiKey: "raw-secret",
          nested: {
            password: "nested-secret",
          },
        },
      });

    expect(response.status).toBe(201);
    expect(mockActivityCreate).toHaveBeenCalledWith(expect.objectContaining({
      companyId: "company-1",
      actorType: "system",
      actorId: "board-1",
      details: {
        apiKey: "***REDACTED***",
        nested: {
          password: "***REDACTED***",
        },
      },
    }));
  });

  it("resolves issue identifiers before listing issue activity", async () => {
    mockIssueGetByIdentifier.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
    });
    mockActivityForIssue.mockResolvedValue([{ id: "event-2" }]);

    const app = createApp();
    const response = await request(app).get("/issues/CLO-39/activity");

    expect(response.status).toBe(200);
    expect(mockIssueGetByIdentifier).toHaveBeenCalledWith("CLO-39");
    expect(mockIssueGetById).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111");
    expect(mockActivityForIssue).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111");
    expect(response.body).toEqual([{ id: "event-2" }]);
  });

  it("returns 404 when the issue does not exist", async () => {
    mockIssueGetById.mockResolvedValue(null);

    const app = createApp();
    const response = await request(app).get("/issues/11111111-1111-4111-8111-111111111111/activity");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Issue not found" });
  });

  it("returns issue runs for an existing issue", async () => {
    mockActivityRunsForIssue.mockResolvedValue([
      { runId: "run-1", status: "running" },
    ]);

    const app = createApp();
    const response = await request(app).get("/issues/11111111-1111-4111-8111-111111111111/runs");

    expect(response.status).toBe(200);
    expect(mockActivityRunsForIssue).toHaveBeenCalledWith(
      "company-1",
      "11111111-1111-4111-8111-111111111111",
    );
    expect(response.body).toEqual([
      { runId: "run-1", status: "running" },
    ]);
  });

  it("returns issues linked to a heartbeat run", async () => {
    mockActivityIssuesForRun.mockResolvedValue([
      { issueId: "issue-1", identifier: "CLO-1" },
    ]);

    const app = createApp();
    const response = await request(app).get("/heartbeat-runs/run-1/issues");

    expect(response.status).toBe(200);
    expect(mockActivityIssuesForRun).toHaveBeenCalledWith("run-1");
    expect(response.body).toEqual([
      { issueId: "issue-1", identifier: "CLO-1" },
    ]);
  });
});
