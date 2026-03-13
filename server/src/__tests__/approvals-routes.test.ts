import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const APPROVAL_ID = "22222222-2222-4222-8222-222222222222";
const AGENT_ID = "33333333-3333-4333-8333-333333333333";
const ISSUE_ID = "44444444-4444-4444-8444-444444444444";
const ISSUE_ID_2 = "55555555-5555-4555-8555-555555555555";

const {
  mockListApprovals,
  mockGetApprovalById,
  mockCreateApproval,
  mockApproveApproval,
  mockRejectApproval,
  mockRequestRevision,
  mockResubmitApproval,
  mockListApprovalComments,
  mockAddApprovalComment,
  mockListIssuesForApproval,
  mockLinkManyForApproval,
  mockNormalizeHireApprovalPayload,
  mockWakeup,
  mockLogActivity,
} = vi.hoisted(() => ({
  mockListApprovals: vi.fn(),
  mockGetApprovalById: vi.fn(),
  mockCreateApproval: vi.fn(),
  mockApproveApproval: vi.fn(),
  mockRejectApproval: vi.fn(),
  mockRequestRevision: vi.fn(),
  mockResubmitApproval: vi.fn(),
  mockListApprovalComments: vi.fn(),
  mockAddApprovalComment: vi.fn(),
  mockListIssuesForApproval: vi.fn(),
  mockLinkManyForApproval: vi.fn(),
  mockNormalizeHireApprovalPayload: vi.fn(),
  mockWakeup: vi.fn(),
  mockLogActivity: vi.fn(),
}));

vi.mock("../services/index.js", () => ({
  approvalService: () => ({
    list: mockListApprovals,
    getById: mockGetApprovalById,
    create: mockCreateApproval,
    approve: mockApproveApproval,
    reject: mockRejectApproval,
    requestRevision: mockRequestRevision,
    resubmit: mockResubmitApproval,
    listComments: mockListApprovalComments,
    addComment: mockAddApprovalComment,
  }),
  heartbeatService: () => ({
    wakeup: mockWakeup,
  }),
  issueApprovalService: () => ({
    listIssuesForApproval: mockListIssuesForApproval,
    linkManyForApproval: mockLinkManyForApproval,
  }),
  logActivity: mockLogActivity,
  secretService: () => ({
    normalizeHireApprovalPayloadForPersistence: mockNormalizeHireApprovalPayload,
  }),
}));

import { approvalRoutes } from "../routes/approvals.js";

function buildActor(kind: "board" | "agent" = "board") {
  if (kind === "agent") {
    return {
      type: "agent" as const,
      source: "api_key" as const,
      agentId: AGENT_ID,
      companyId: COMPANY_ID,
      userId: null,
      companyIds: [COMPANY_ID],
      runId: "run-1",
    };
  }
  return {
    type: "board" as const,
    source: "local_implicit" as const,
    isInstanceAdmin: true,
    userId: "user-1",
    companyIds: [COMPANY_ID],
    runId: null,
  };
}

function createApp(actorKind: "board" | "agent" = "board") {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = buildActor(actorKind);
    next();
  });
  app.use(approvalRoutes({} as never));
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err?.status ?? 500).json({ error: err?.message ?? "Unhandled error" });
  });
  return app;
}

describe("approval routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates hire approvals, normalizes payload, and links unique issues", async () => {
    mockNormalizeHireApprovalPayload.mockResolvedValue({
      provider: "local_encrypted",
      envBindings: [{ envName: "OPENAI_API_KEY" }],
    });
    mockCreateApproval.mockResolvedValue({
      id: APPROVAL_ID,
      companyId: COMPANY_ID,
      type: "hire_agent",
      payload: { provider: "local_encrypted" },
      status: "pending",
      requestedByAgentId: null,
      requestedByUserId: "user-1",
    });
    const app = createApp();

    const response = await request(app)
      .post(`/companies/${COMPANY_ID}/approvals`)
      .send({
        type: "hire_agent",
        payload: { apiKey: "secret" },
        issueIds: [ISSUE_ID, ISSUE_ID, ISSUE_ID_2],
      });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      id: APPROVAL_ID,
      companyId: COMPANY_ID,
      type: "hire_agent",
      status: "pending",
    });
    expect(mockNormalizeHireApprovalPayload).toHaveBeenCalledWith(
      COMPANY_ID,
      { apiKey: "secret" },
      { strictMode: false },
    );
    expect(mockCreateApproval).toHaveBeenCalledWith(
      COMPANY_ID,
      expect.objectContaining({
        type: "hire_agent",
        requestedByUserId: "user-1",
      }),
    );
    expect(mockLinkManyForApproval).toHaveBeenCalledWith(
      APPROVAL_ID,
      [ISSUE_ID, ISSUE_ID_2],
      { agentId: null, userId: "user-1" },
    );
  });

  it("lists approvals with redacted payloads and reports missing approval lookups", async () => {
    mockListApprovals.mockResolvedValue([
      {
        id: APPROVAL_ID,
        companyId: COMPANY_ID,
        type: "hire_agent",
        payload: { apiKey: "secret", safe: true },
        status: "pending",
      },
    ]);
    mockGetApprovalById.mockResolvedValueOnce(null);
    const app = createApp();

    const listed = await request(app).get(`/companies/${COMPANY_ID}/approvals`).query({ status: "pending" });
    const missing = await request(app).get(`/approvals/${APPROVAL_ID}`);

    expect(listed.status).toBe(200);
    expect(listed.body).toEqual([
      expect.objectContaining({
        id: APPROVAL_ID,
        payload: { apiKey: "***REDACTED***", safe: true },
      }),
    ]);
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ error: "Approval not found" });
  });

  it("approves an approval and queues a requester wakeup for linked issues", async () => {
    mockApproveApproval.mockResolvedValue({
      id: APPROVAL_ID,
      companyId: COMPANY_ID,
      type: "hire_agent",
      payload: {},
      status: "approved",
      requestedByAgentId: AGENT_ID,
    });
    mockListIssuesForApproval.mockResolvedValue([
      { id: ISSUE_ID },
      { id: ISSUE_ID_2 },
    ]);
    mockWakeup.mockResolvedValue({ id: "run-approval" });
    const app = createApp();

    const response = await request(app)
      .post(`/approvals/${APPROVAL_ID}/approve`)
      .send({ decisionNote: "Looks good" });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: APPROVAL_ID,
      status: "approved",
    });
    expect(mockWakeup).toHaveBeenCalledWith(AGENT_ID, expect.objectContaining({
      reason: "approval_approved",
      payload: expect.objectContaining({
        approvalId: APPROVAL_ID,
        issueId: ISSUE_ID,
        issueIds: [ISSUE_ID, ISSUE_ID_2],
      }),
    }));
  });

  it("prevents other agents from resubmitting an approval they did not request", async () => {
    mockGetApprovalById.mockResolvedValue({
      id: APPROVAL_ID,
      companyId: COMPANY_ID,
      type: "hire_agent",
      payload: {},
      status: "revision_requested",
      requestedByAgentId: "66666666-6666-4666-8666-666666666666",
    });
    const app = createApp("agent");

    const response = await request(app)
      .post(`/approvals/${APPROVAL_ID}/resubmit`)
      .send({
        payload: { provider: "local_encrypted" },
      });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      error: "Only requesting agent can resubmit this approval",
    });
    expect(mockResubmitApproval).not.toHaveBeenCalled();
  });

  it("adds approval comments through the company-scoped actor surface", async () => {
    mockGetApprovalById.mockResolvedValue({
      id: APPROVAL_ID,
      companyId: COMPANY_ID,
      type: "hire_agent",
      payload: {},
      status: "pending",
      requestedByAgentId: null,
    });
    mockAddApprovalComment.mockResolvedValue({
      id: "comment-1",
      approvalId: APPROVAL_ID,
      body: "Please attach the workspace path.",
    });
    const app = createApp();

    const response = await request(app)
      .post(`/approvals/${APPROVAL_ID}/comments`)
      .send({ body: "Please attach the workspace path." });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      id: "comment-1",
      approvalId: APPROVAL_ID,
      body: "Please attach the workspace path.",
    });
    expect(mockAddApprovalComment).toHaveBeenCalledWith(
      APPROVAL_ID,
      "Please attach the workspace path.",
      { agentId: undefined, userId: "user-1" },
    );
  });

  it("rejects, requests revision, and resubmits approvals with normalized payloads", async () => {
    mockRejectApproval.mockResolvedValue({
      id: APPROVAL_ID,
      companyId: COMPANY_ID,
      type: "hire_agent",
      payload: {},
      status: "rejected",
    });
    mockRequestRevision.mockResolvedValue({
      id: APPROVAL_ID,
      companyId: COMPANY_ID,
      type: "hire_agent",
      payload: {},
      status: "revision_requested",
    });
    mockGetApprovalById.mockResolvedValue({
      id: APPROVAL_ID,
      companyId: COMPANY_ID,
      type: "hire_agent",
      payload: {},
      status: "revision_requested",
      requestedByAgentId: AGENT_ID,
    });
    mockNormalizeHireApprovalPayload.mockResolvedValue({
      provider: "local_encrypted",
      envBindings: [{ envName: "OPENAI_API_KEY" }],
    });
    mockResubmitApproval.mockResolvedValue({
      id: APPROVAL_ID,
      companyId: COMPANY_ID,
      type: "hire_agent",
      payload: { provider: "local_encrypted" },
      status: "pending",
    });

    const boardApp = createApp();
    const agentApp = createApp("agent");

    const rejected = await request(boardApp)
      .post(`/approvals/${APPROVAL_ID}/reject`)
      .send({ decisionNote: "Need more context" });
    const revisionRequested = await request(boardApp)
      .post(`/approvals/${APPROVAL_ID}/request-revision`)
      .send({ decisionNote: "Add workspace path" });
    const resubmitted = await request(agentApp)
      .post(`/approvals/${APPROVAL_ID}/resubmit`)
      .send({
        payload: { apiKey: "secret" },
      });

    expect(rejected.status).toBe(200);
    expect(revisionRequested.status).toBe(200);
    expect(resubmitted.status).toBe(200);
    expect(mockNormalizeHireApprovalPayload).toHaveBeenCalledWith(
      COMPANY_ID,
      { apiKey: "secret" },
      { strictMode: false },
    );
    expect(mockResubmitApproval).toHaveBeenCalledWith(APPROVAL_ID, {
      provider: "local_encrypted",
      envBindings: [{ envName: "OPENAI_API_KEY" }],
    });
  });
});
