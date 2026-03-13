import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/error-handler.js";
import { REDACTED_EVENT_VALUE } from "../redaction.js";

const {
  mockAccessCanUser,
  mockAccessHasPermission,
  mockHeartbeatCancelRun,
  mockHeartbeatGetRun,
  mockHeartbeatList,
  mockHeartbeatListEvents,
  mockHeartbeatReadLog,
  mockAgentGetById,
  mockAgentGetChainOfCommand,
  mockAgentGetConfigRevision,
  mockAgentList,
  mockAgentListConfigRevisions,
  mockAgentOrgForCompany,
  mockHeartbeatGetRuntimeState,
  mockHeartbeatListTaskSessions,
  mockHeartbeatResetRuntimeSession,
  mockIssueGetById,
  mockIssueGetByIdentifier,
  mockLogActivity,
} = vi.hoisted(() => ({
  mockAccessCanUser: vi.fn(),
  mockAccessHasPermission: vi.fn(),
  mockHeartbeatCancelRun: vi.fn(),
  mockHeartbeatGetRun: vi.fn(),
  mockHeartbeatList: vi.fn(),
  mockHeartbeatListEvents: vi.fn(),
  mockHeartbeatReadLog: vi.fn(),
  mockAgentGetById: vi.fn(),
  mockAgentGetChainOfCommand: vi.fn(),
  mockAgentGetConfigRevision: vi.fn(),
  mockAgentList: vi.fn(),
  mockAgentListConfigRevisions: vi.fn(),
  mockAgentOrgForCompany: vi.fn(),
  mockHeartbeatGetRuntimeState: vi.fn(),
  mockHeartbeatListTaskSessions: vi.fn(),
  mockHeartbeatResetRuntimeSession: vi.fn(),
  mockIssueGetById: vi.fn(),
  mockIssueGetByIdentifier: vi.fn(),
  mockLogActivity: vi.fn(),
}));

vi.mock("../services/index.js", () => ({
  agentService: () => ({
    getById: mockAgentGetById,
    getChainOfCommand: mockAgentGetChainOfCommand,
    getConfigRevision: mockAgentGetConfigRevision,
    list: mockAgentList,
    listConfigRevisions: mockAgentListConfigRevisions,
    orgForCompany: mockAgentOrgForCompany,
    resolveByReference: vi.fn(),
  }),
  accessService: () => ({
    canUser: mockAccessCanUser,
    hasPermission: mockAccessHasPermission,
  }),
  approvalService: () => ({
    listPendingByCompany: vi.fn(),
  }),
  heartbeatService: () => ({
    cancelRun: mockHeartbeatCancelRun,
    getRun: mockHeartbeatGetRun,
    getRuntimeState: mockHeartbeatGetRuntimeState,
    list: mockHeartbeatList,
    listEvents: mockHeartbeatListEvents,
    listTaskSessions: mockHeartbeatListTaskSessions,
    readLog: mockHeartbeatReadLog,
    resetRuntimeSession: mockHeartbeatResetRuntimeSession,
    getActiveRunForAgent: vi.fn(),
  }),
  issueApprovalService: () => ({
    listIssuesForApproval: vi.fn(),
  }),
  issueService: () => ({
    list: vi.fn(),
    getById: mockIssueGetById,
    getByIdentifier: mockIssueGetByIdentifier,
  }),
  logActivity: mockLogActivity,
  secretService: () => ({
    normalizeAdapterConfigForPersistence: vi.fn(),
  }),
}));

vi.mock("../adapters/index.js", () => ({
  findServerAdapter: vi.fn(),
  listAdapterModels: vi.fn().mockResolvedValue([]),
}));

vi.mock("@squadrail/adapter-claude-local/server", () => ({
  runClaudeLogin: vi.fn(),
}));

import { agentRoutes } from "../routes/agents.js";

const agentId = "11111111-1111-4111-8111-111111111111";

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

function buildAgentActor(overrides?: Partial<{
  agentId: string;
  companyId: string;
  companyIds: string[];
  runId: string;
}>) {
  return {
    type: "agent" as const,
    source: "api_key" as const,
    agentId: overrides?.agentId ?? agentId,
    companyId: overrides?.companyId ?? "company-1",
    companyIds: overrides?.companyIds ?? ["company-1"],
    isInstanceAdmin: false,
    runId: overrides?.runId ?? "run-1",
    userId: null,
  };
}

function createApp(actor: ReturnType<typeof buildBoardActor> | ReturnType<typeof buildAgentActor> = buildBoardActor()) {
  return createAppWithDb({} as never, actor);
}

function createResolvedChain(rows: unknown[]) {
  const chain = {
    from: () => chain,
    innerJoin: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    then: <T>(resolve: (value: unknown[]) => T | PromiseLike<T>) =>
      Promise.resolve(rows).then(resolve),
  };
  return chain;
}

function createAgentsDbMock(selectResults: unknown[][] = []) {
  const selectQueue = [...selectResults];
  return {
    select: (..._args: unknown[]) => createResolvedChain(selectQueue.shift() ?? []),
  };
}

function createAppWithDb(
  db: unknown,
  actor: ReturnType<typeof buildBoardActor> | ReturnType<typeof buildAgentActor> = buildBoardActor(),
) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.actor = actor;
    next();
  });
  app.use(agentRoutes(db as never));
  app.use(errorHandler);
  return app;
}

describe("agent routes read paths", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccessCanUser.mockResolvedValue(true);
    mockAccessHasPermission.mockResolvedValue(true);
    mockIssueGetById.mockResolvedValue(null);
    mockIssueGetByIdentifier.mockResolvedValue(null);
    mockAgentGetById.mockResolvedValue({
      id: agentId,
      companyId: "company-1",
      name: "Engineer One",
      role: "engineer",
      title: "Implementation Engineer",
      status: "active",
      reportsTo: null,
      adapterType: "codex_local",
      adapterConfig: {
        cwd: "/workspace/project",
        apiKey: "sensitive-adapter-key",
      },
      runtimeConfig: {
        authToken: "sensitive-runtime-token",
      },
      permissions: {
        canCreateAgents: true,
      },
      updatedAt: "2026-03-12T00:00:00.000Z",
    });
    mockAgentGetChainOfCommand.mockResolvedValue([
      {
        id: "manager-1",
        name: "Lead One",
      },
    ]);
    mockAgentListConfigRevisions.mockResolvedValue([
      {
        id: "revision-1",
        beforeConfig: {
          adapterConfig: { apiKey: "before-secret" },
          runtimeConfig: { authToken: "before-runtime-secret" },
          metadata: { token: "before-metadata-secret" },
        },
        afterConfig: {
          adapterConfig: { apiKey: "after-secret" },
          runtimeConfig: { authToken: "after-runtime-secret" },
          metadata: { token: "after-metadata-secret" },
        },
      },
    ]);
    mockAgentGetConfigRevision.mockResolvedValue({
      id: "revision-1",
      beforeConfig: {
        adapterConfig: { apiKey: "before-secret" },
        runtimeConfig: { authToken: "before-runtime-secret" },
        metadata: { token: "before-metadata-secret" },
      },
      afterConfig: {
        adapterConfig: { apiKey: "after-secret" },
        runtimeConfig: { authToken: "after-runtime-secret" },
        metadata: { token: "after-metadata-secret" },
      },
    });
    mockAgentList.mockResolvedValue([
      {
        id: agentId,
        companyId: "company-1",
        name: "Engineer One",
        adapterConfig: {
          cwd: "/workspace/project",
        },
      },
    ]);
    mockAgentOrgForCompany.mockResolvedValue([
      {
        id: agentId,
        name: "Engineer One",
        role: "engineer",
        status: "active",
        internalOnly: true,
        reports: [
          {
            id: "child-1",
            name: "Reviewer One",
            role: "reviewer",
            status: "active",
            hiddenField: "ignored",
            reports: [],
          },
        ],
      },
    ]);
    mockHeartbeatGetRuntimeState.mockResolvedValue({
      agentId,
      status: "running",
    });
    mockHeartbeatList.mockResolvedValue([
      {
        id: "run-list-1",
        companyId: "company-1",
        agentId,
        status: "queued",
      },
    ]);
    mockHeartbeatCancelRun.mockResolvedValue({
      id: "run-cancel-1",
      companyId: "company-1",
      agentId,
      status: "cancelled",
    });
    mockHeartbeatListEvents.mockResolvedValue([
      {
        id: "event-1",
        runId: "run-cancel-1",
        seq: 1,
        payload: {
          apiKey: "sensitive-api-key",
        },
      },
    ]);
    mockHeartbeatReadLog.mockResolvedValue({
      runId: "run-cancel-1",
      store: "local_file",
      logRef: "logs/run-cancel-1.log",
      content: "line-1",
      truncated: false,
    });
    mockHeartbeatGetRun.mockResolvedValue(null);
    mockHeartbeatListTaskSessions.mockResolvedValue([
      {
        id: "session-1",
        taskKey: "issue:CLO-1",
        sessionParamsJson: {
          apiKey: "session-secret",
        },
      },
    ]);
    mockHeartbeatResetRuntimeSession.mockResolvedValue({
      agentId,
      reset: true,
    });
  });

  it("lists company agents for board actors", async () => {
    const app = createApp();
    const response = await request(app).get("/companies/company-1/agents");

    expect(response.status).toBe(200);
    expect(mockAgentList).toHaveBeenCalledWith("company-1");
    expect(response.body).toEqual([
      {
        id: agentId,
        companyId: "company-1",
        name: "Engineer One",
        adapterConfig: {
          cwd: "/workspace/project",
        },
      },
    ]);
  });

  it("redacts company agent configs for agent actors without config-read permission", async () => {
    mockAccessHasPermission.mockResolvedValue(false);
    mockAgentGetById.mockResolvedValueOnce({
      id: "viewer-agent",
      companyId: "company-1",
      permissions: {},
    });
    const app = createApp(buildAgentActor({ agentId: "viewer-agent" }));
    const response = await request(app).get("/companies/company-1/agents");

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      {
        id: agentId,
        companyId: "company-1",
        name: "Engineer One",
        adapterConfig: {},
        runtimeConfig: {},
      },
    ]);
  });

  it("returns a lean org tree for the company", async () => {
    const app = createApp();
    const response = await request(app).get("/companies/company-1/org");

    expect(response.status).toBe(200);
    expect(mockAgentOrgForCompany).toHaveBeenCalledWith("company-1");
    expect(response.body).toEqual([
      {
        id: agentId,
        name: "Engineer One",
        role: "engineer",
        status: "active",
        reports: [
          {
            id: "child-1",
            name: "Reviewer One",
            role: "reviewer",
            status: "active",
            reports: [],
          },
        ],
      },
    ]);
  });

  it("returns the current agent profile for authenticated agents", async () => {
    const app = createApp(buildAgentActor());
    const response = await request(app).get("/agents/me");

    expect(response.status).toBe(200);
    expect(mockAgentGetById).toHaveBeenCalledWith(agentId);
    expect(response.body).toEqual(expect.objectContaining({
      id: agentId,
      chainOfCommand: [
        {
          id: "manager-1",
          name: "Lead One",
        },
      ],
    }));
  });

  it("returns 401 for /agents/me when the caller is not an agent", async () => {
    const app = createApp();
    const response = await request(app).get("/agents/me");

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Agent authentication required" });
  });

  it("returns full agent details with chain of command", async () => {
    const app = createApp();
    const response = await request(app).get(`/agents/${agentId}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      id: agentId,
      name: "Engineer One",
      chainOfCommand: [
        {
          id: "manager-1",
          name: "Lead One",
        },
      ],
    }));
  });

  it("redacts sibling agent configuration when the caller lacks creator permission", async () => {
    mockAccessHasPermission.mockResolvedValue(false);
    mockAgentGetById
      .mockResolvedValueOnce({
        id: agentId,
        companyId: "company-1",
        name: "Engineer One",
        role: "engineer",
        title: "Implementation Engineer",
        status: "active",
        reportsTo: null,
        adapterType: "codex_local",
        adapterConfig: {
          cwd: "/workspace/project",
          apiKey: "sensitive-adapter-key",
        },
        runtimeConfig: {
          authToken: "sensitive-runtime-token",
        },
        permissions: {
          canCreateAgents: true,
        },
        updatedAt: "2026-03-12T00:00:00.000Z",
      })
      .mockResolvedValueOnce({
        id: "viewer-agent",
        companyId: "company-1",
        name: "Reviewer One",
        role: "reviewer",
        permissions: {},
      });
    const app = createApp(buildAgentActor({ agentId: "viewer-agent" }));
    const response = await request(app).get(`/agents/${agentId}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      id: agentId,
      adapterConfig: {},
      runtimeConfig: {},
      chainOfCommand: [
        {
          id: "manager-1",
          name: "Lead One",
        },
      ],
    }));
  });

  it("redacts secrets from configuration payloads", async () => {
    const app = createApp();
    const response = await request(app).get(`/agents/${agentId}/configuration`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      id: agentId,
      adapterConfig: {
        cwd: "/workspace/project",
        apiKey: REDACTED_EVENT_VALUE,
      },
      runtimeConfig: {
        authToken: REDACTED_EVENT_VALUE,
      },
    }));
  });

  it("lists config revisions with sensitive snapshots redacted", async () => {
    const app = createApp();
    const response = await request(app).get(`/agents/${agentId}/config-revisions`);

    expect(response.status).toBe(200);
    expect(mockAgentListConfigRevisions).toHaveBeenCalledWith(agentId);
    expect(response.body).toEqual([
      expect.objectContaining({
        id: "revision-1",
        beforeConfig: {
          adapterConfig: { apiKey: REDACTED_EVENT_VALUE },
          runtimeConfig: { authToken: REDACTED_EVENT_VALUE },
          metadata: { token: "before-metadata-secret" },
        },
        afterConfig: {
          adapterConfig: { apiKey: REDACTED_EVENT_VALUE },
          runtimeConfig: { authToken: REDACTED_EVENT_VALUE },
          metadata: { token: "after-metadata-secret" },
        },
      }),
    ]);
  });

  it("returns 404 when a requested config revision does not exist", async () => {
    mockAgentGetConfigRevision.mockResolvedValueOnce(null);
    const app = createApp();
    const response = await request(app).get(`/agents/${agentId}/config-revisions/revision-missing`);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Revision not found" });
  });

  it("returns redacted task session payloads", async () => {
    const app = createApp();
    const response = await request(app).get(`/agents/${agentId}/task-sessions`);

    expect(response.status).toBe(200);
    expect(mockHeartbeatListTaskSessions).toHaveBeenCalledWith(agentId);
    expect(response.body).toEqual([
      {
        id: "session-1",
        taskKey: "issue:CLO-1",
        sessionParamsJson: {
          apiKey: REDACTED_EVENT_VALUE,
        },
      },
    ]);
  });

  it("returns runtime state for an agent", async () => {
    const app = createApp();
    const response = await request(app).get(`/agents/${agentId}/runtime-state`);

    expect(response.status).toBe(200);
    expect(mockHeartbeatGetRuntimeState).toHaveBeenCalledWith(agentId);
    expect(response.body).toEqual({
      agentId,
      status: "running",
    });
  });

  it("lists heartbeat runs with company-scoped filters", async () => {
    const app = createApp();
    const response = await request(app)
      .get("/companies/company-1/heartbeat-runs")
      .query({ agentId, limit: "5000" });

    expect(response.status).toBe(200);
    expect(mockHeartbeatList).toHaveBeenCalledWith("company-1", agentId, 1000);
    expect(response.body).toEqual([
      expect.objectContaining({
        id: "run-list-1",
        status: "queued",
      }),
    ]);
  });

  it("cancels heartbeat runs and records activity", async () => {
    const app = createApp();
    const response = await request(app).post("/heartbeat-runs/run-cancel-1/cancel");

    expect(response.status).toBe(200);
    expect(mockHeartbeatCancelRun).toHaveBeenCalledWith("run-cancel-1");
    expect(mockLogActivity).toHaveBeenCalledWith(
      {} as never,
      expect.objectContaining({
        companyId: "company-1",
        action: "heartbeat.cancelled",
        entityId: "run-cancel-1",
        details: { agentId },
      }),
    );
  });

  it("returns redacted heartbeat event payloads and log reads", async () => {
    mockHeartbeatGetRun.mockResolvedValue({
      id: "run-cancel-1",
      companyId: "company-1",
      status: "running",
      logStore: "local_file",
      logRef: "logs/run-cancel-1.log",
    });
    const app = createApp();

    const events = await request(app).get("/heartbeat-runs/run-cancel-1/events").query({ afterSeq: "NaN", limit: "NaN" });
    const log = await request(app).get("/heartbeat-runs/run-cancel-1/log").query({ offset: "NaN", limitBytes: "NaN" });

    expect(events.status).toBe(200);
    expect(mockHeartbeatListEvents).toHaveBeenCalledWith("run-cancel-1", 0, 200);
    expect(events.body).toEqual([
      expect.objectContaining({
        seq: 1,
        payload: { apiKey: REDACTED_EVENT_VALUE },
      }),
    ]);
    expect(log.status).toBe(200);
    expect(mockHeartbeatReadLog).toHaveBeenCalledWith("run-cancel-1", {
      offset: 0,
      limitBytes: 256000,
    });
    expect(log.body).toEqual(expect.objectContaining({
      runId: "run-cancel-1",
      content: "line-1",
    }));
  });

  it("returns live runs from company and issue views", async () => {
    const db = createAgentsDbMock([
      [{
        id: "run-live-1",
        status: "running",
        invocationSource: "on_demand",
        triggerDetail: "manual",
        createdAt: "2026-03-13T00:00:00.000Z",
        agentId,
        agentName: "Engineer One",
        adapterType: "codex_local",
        issueId: "issue-1",
      }],
      [{
        id: "run-finished-1",
        status: "completed",
        invocationSource: "timer",
        triggerDetail: "system",
        createdAt: "2026-03-12T23:00:00.000Z",
        agentId,
        agentName: "Engineer One",
        adapterType: "codex_local",
        issueId: "issue-1",
      }],
      [{
        id: "run-live-issue-1",
        status: "running",
        invocationSource: "on_demand",
        triggerDetail: "manual",
        createdAt: "2026-03-13T00:00:00.000Z",
        agentId,
        agentName: "Engineer One",
        adapterType: "codex_local",
      }],
    ]);
    mockIssueGetById.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
      status: "in_progress",
      assigneeAgentId: agentId,
      executionRunId: null,
    });
    const app = createAppWithDb(db);

    const companyRuns = await request(app).get("/companies/company-1/live-runs").query({ minCount: "2" });
    const issueRuns = await request(app).get("/issues/11111111-1111-4111-8111-111111111111/live-runs");

    expect(companyRuns.status).toBe(200);
    expect(companyRuns.body).toEqual([
      expect.objectContaining({ id: "run-live-1", status: "running" }),
      expect.objectContaining({ id: "run-finished-1", status: "completed" }),
    ]);
    expect(issueRuns.status).toBe(200);
    expect(issueRuns.body).toEqual([
      expect.objectContaining({
        id: "run-live-issue-1",
        agentName: "Engineer One",
      }),
    ]);
  });

  it("resets the runtime session and records activity", async () => {
    const app = createApp();
    const response = await request(app)
      .post(`/agents/${agentId}/runtime-state/reset-session`)
      .send({
        taskKey: " issue:CLO-99 ",
      });

    expect(response.status).toBe(200);
    expect(mockHeartbeatResetRuntimeSession).toHaveBeenCalledWith(agentId, {
      taskKey: "issue:CLO-99",
    });
    expect(mockLogActivity).toHaveBeenCalledWith(
      {} as never,
      expect.objectContaining({
        companyId: "company-1",
        action: "agent.runtime_session_reset",
        entityId: agentId,
        details: {
          taskKey: "issue:CLO-99",
        },
      }),
    );
    expect(response.body).toEqual({
      agentId,
      reset: true,
    });
  });
});
