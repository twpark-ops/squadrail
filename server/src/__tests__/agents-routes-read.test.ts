import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/error-handler.js";
import { REDACTED_EVENT_VALUE } from "../redaction.js";

const {
  mockAccessCanUser,
  mockAccessHasPermission,
  mockAgentGetById,
  mockAgentGetChainOfCommand,
  mockAgentList,
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
  mockAgentGetById: vi.fn(),
  mockAgentGetChainOfCommand: vi.fn(),
  mockAgentList: vi.fn(),
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
    list: mockAgentList,
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
    getRuntimeState: mockHeartbeatGetRuntimeState,
    listTaskSessions: mockHeartbeatListTaskSessions,
    resetRuntimeSession: mockHeartbeatResetRuntimeSession,
    getRun: vi.fn(),
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

function buildAgentActor() {
  return {
    type: "agent" as const,
    source: "api_key" as const,
    agentId,
    companyId: "company-1",
    companyIds: ["company-1"],
    isInstanceAdmin: false,
    runId: "run-1",
    userId: null,
  };
}

function createApp(actor: ReturnType<typeof buildBoardActor> | ReturnType<typeof buildAgentActor> = buildBoardActor()) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.actor = actor;
    next();
  });
  app.use(agentRoutes({} as never));
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
