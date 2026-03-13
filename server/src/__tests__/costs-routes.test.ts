import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const AGENT_ID = "22222222-2222-4222-8222-222222222222";

const {
  mockCreateCostEvent,
  mockCostSummary,
  mockCostsByAgent,
  mockCostsByProject,
  mockUpdateCompany,
  mockGetAgentById,
  mockUpdateAgent,
  mockLogActivity,
} = vi.hoisted(() => ({
  mockCreateCostEvent: vi.fn(),
  mockCostSummary: vi.fn(),
  mockCostsByAgent: vi.fn(),
  mockCostsByProject: vi.fn(),
  mockUpdateCompany: vi.fn(),
  mockGetAgentById: vi.fn(),
  mockUpdateAgent: vi.fn(),
  mockLogActivity: vi.fn(),
}));

vi.mock("../services/index.js", () => ({
  costService: () => ({
    createEvent: mockCreateCostEvent,
    summary: mockCostSummary,
    byAgent: mockCostsByAgent,
    byProject: mockCostsByProject,
  }),
  companyService: () => ({
    update: mockUpdateCompany,
  }),
  agentService: () => ({
    getById: mockGetAgentById,
    update: mockUpdateAgent,
  }),
  logActivity: mockLogActivity,
}));

import { costRoutes } from "../routes/costs.js";

function createApp(actorKind: "board" | "agent" = "board") {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actorKind === "agent"
      ? {
          type: "agent",
          source: "api_key",
          agentId: AGENT_ID,
          companyId: COMPANY_ID,
          userId: null,
          companyIds: [COMPANY_ID],
          runId: "run-1",
        }
      : {
          type: "board",
          source: "local_implicit",
          isInstanceAdmin: true,
          userId: "user-1",
          companyIds: [COMPANY_ID],
          runId: null,
        };
    next();
  });
  app.use(costRoutes({} as never));
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err?.status ?? 500).json({ error: err?.message ?? "Unhandled error" });
  });
  return app;
}

describe("cost routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("prevents agents from reporting costs for a different agent", async () => {
    const app = createApp("agent");

    const response = await request(app)
      .post(`/companies/${COMPANY_ID}/cost-events`)
      .send({
        agentId: "33333333-3333-4333-8333-333333333333",
        provider: "openai",
        model: "gpt-5",
        inputTokens: 10,
        outputTokens: 20,
        costCents: 12,
        occurredAt: "2026-03-13T10:00:00.000Z",
      });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      error: "Agent can only report its own costs",
    });
    expect(mockCreateCostEvent).not.toHaveBeenCalled();
  });

  it("creates cost events and returns the persisted event", async () => {
    mockCreateCostEvent.mockResolvedValue({
      id: "cost-1",
      companyId: COMPANY_ID,
      agentId: AGENT_ID,
      provider: "openai",
      model: "gpt-5",
      costCents: 12,
    });
    const app = createApp();

    const response = await request(app)
      .post(`/companies/${COMPANY_ID}/cost-events`)
      .send({
        agentId: AGENT_ID,
        provider: "openai",
        model: "gpt-5",
        inputTokens: 10,
        outputTokens: 20,
        costCents: 12,
        occurredAt: "2026-03-13T10:00:00.000Z",
      });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      id: "cost-1",
      provider: "openai",
      model: "gpt-5",
      costCents: 12,
    });
    expect(mockCreateCostEvent).toHaveBeenCalledWith(COMPANY_ID, expect.objectContaining({
      agentId: AGENT_ID,
      occurredAt: new Date("2026-03-13T10:00:00.000Z"),
    }));
  });

  it("returns summary and aggregation views for the requested range", async () => {
    mockCostSummary.mockResolvedValue({ totalCostCents: 100 });
    mockCostsByAgent.mockResolvedValue([{ agentId: AGENT_ID, totalCostCents: 70 }]);
    mockCostsByProject.mockResolvedValue([{ projectId: "project-1", totalCostCents: 30 }]);
    const app = createApp();

    const [summaryResponse, byAgentResponse, byProjectResponse] = await Promise.all([
      request(app).get(`/companies/${COMPANY_ID}/costs/summary`).query({
        from: "2026-03-01T00:00:00.000Z",
        to: "2026-03-31T00:00:00.000Z",
      }),
      request(app).get(`/companies/${COMPANY_ID}/costs/by-agent`),
      request(app).get(`/companies/${COMPANY_ID}/costs/by-project`),
    ]);

    expect(summaryResponse.status).toBe(200);
    expect(summaryResponse.body).toEqual({ totalCostCents: 100 });
    expect(byAgentResponse.body).toEqual([{ agentId: AGENT_ID, totalCostCents: 70 }]);
    expect(byProjectResponse.body).toEqual([{ projectId: "project-1", totalCostCents: 30 }]);
  });

  it("updates both company and agent monthly budgets", async () => {
    mockUpdateCompany.mockResolvedValue({
      id: COMPANY_ID,
      budgetMonthlyCents: 50_000,
    });
    mockGetAgentById.mockResolvedValue({
      id: AGENT_ID,
      companyId: COMPANY_ID,
    });
    mockUpdateAgent.mockResolvedValue({
      id: AGENT_ID,
      companyId: COMPANY_ID,
      budgetMonthlyCents: 10_000,
    });
    const app = createApp();

    const [companyResponse, agentResponse] = await Promise.all([
      request(app)
        .patch(`/companies/${COMPANY_ID}/budgets`)
        .send({ budgetMonthlyCents: 50_000 }),
      request(app)
        .patch(`/agents/${AGENT_ID}/budgets`)
        .send({ budgetMonthlyCents: 10_000 }),
    ]);

    expect(companyResponse.status).toBe(200);
    expect(companyResponse.body).toEqual({
      id: COMPANY_ID,
      budgetMonthlyCents: 50_000,
    });
    expect(agentResponse.status).toBe(200);
    expect(agentResponse.body).toEqual({
      id: AGENT_ID,
      companyId: COMPANY_ID,
      budgetMonthlyCents: 10_000,
    });
  });
});
