import { Router } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerIssueProtocolReadRoutes } from "../routes/issues/protocol-read-routes.js";

function createRouterContext() {
  const router = Router();
  const svc = {
    getById: vi.fn(),
  };
  const protocolSvc = {
    getState: vi.fn(),
    listMessages: vi.fn(),
    listReviewCycles: vi.fn(),
    listViolations: vi.fn(),
  };
  const knowledge = {
    getLatestTaskBrief: vi.fn(),
    listTaskBriefs: vi.fn(),
  };

  registerIssueProtocolReadRoutes({
    router,
    db: {} as never,
    storage: {} as never,
    services: {
      svc,
      agentsSvc: {} as never,
      knowledge,
      projectsSvc: {} as never,
      issueApprovalsSvc: {} as never,
      protocolSvc,
      retrievalPersonalization: {} as never,
      mergeCandidatesSvc: {} as never,
    },
    helpers: {} as never,
    constants: {} as never,
  } as never);

  return {
    router,
    svc,
    protocolSvc,
    knowledge,
  };
}

function findHandlers(router: any, path: string) {
  const layer = router.stack.find((entry: any) => (
    entry.route?.path === path && entry.route?.methods?.get === true
  ));
  if (!layer) throw new Error(`Route GET ${path} not found`);
  return layer.route.stack.map((entry: any) => entry.handle as Function);
}

async function invokeRoute(input: {
  router: any;
  path: string;
  params?: Record<string, string>;
  query?: Record<string, string>;
}) {
  const handlers = findHandlers(input.router, input.path);
  const req = {
    params: input.params ?? {},
    query: input.query ?? {},
    actor: {
      type: "board",
      source: "local_implicit",
      isInstanceAdmin: true,
      userId: "user-1",
      companyIds: ["company-1"],
      runId: null,
    },
  } as any;
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
        const result = handler(req, res, (error?: unknown) => error ? reject(error) : resolve());
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

describe("protocol read routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when the issue does not exist", async () => {
    const fixture = createRouterContext();
    fixture.svc.getById.mockResolvedValue(null);

    const response = await invokeRoute({
      router: fixture.router,
      path: "/issues/:id/protocol/state",
      params: { id: "issue-1" },
    });

    expect(response).toEqual({
      statusCode: 404,
      body: { error: "Issue not found" },
    });
  });

  it("reads protocol state, messages, cycles, and violations", async () => {
    const fixture = createRouterContext();
    fixture.svc.getById.mockResolvedValue({
      id: "issue-1",
      companyId: "company-1",
    });
    fixture.protocolSvc.getState.mockResolvedValue({ workflowState: "under_review" });
    fixture.protocolSvc.listMessages.mockResolvedValue([{ id: "message-1" }]);
    fixture.protocolSvc.listReviewCycles.mockResolvedValue([{ id: "cycle-1" }]);
    fixture.protocolSvc.listViolations.mockResolvedValue([{ id: "violation-1" }]);

    const state = await invokeRoute({
      router: fixture.router,
      path: "/issues/:id/protocol/state",
      params: { id: "issue-1" },
    });
    const messages = await invokeRoute({
      router: fixture.router,
      path: "/issues/:id/protocol/messages",
      params: { id: "issue-1" },
    });
    const cycles = await invokeRoute({
      router: fixture.router,
      path: "/issues/:id/protocol/review-cycles",
      params: { id: "issue-1" },
    });
    const violations = await invokeRoute({
      router: fixture.router,
      path: "/issues/:id/protocol/violations",
      params: { id: "issue-1" },
      query: { status: "open" },
    });

    expect(state.body).toEqual({ workflowState: "under_review" });
    expect(messages.body).toEqual([{ id: "message-1" }]);
    expect(cycles.body).toEqual([{ id: "cycle-1" }]);
    expect(violations.body).toEqual([{ id: "violation-1" }]);
    expect(fixture.protocolSvc.listViolations).toHaveBeenCalledWith({
      issueId: "issue-1",
      status: "open",
    });
  });

  it("returns latest brief for scoped requests and 404 when it is missing", async () => {
    const fixture = createRouterContext();
    fixture.svc.getById.mockResolvedValue({
      id: "issue-1",
      companyId: "company-1",
    });
    fixture.knowledge.getLatestTaskBrief.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: "brief-1",
      briefScope: "reviewer",
    });

    const missing = await invokeRoute({
      router: fixture.router,
      path: "/issues/:id/protocol/briefs",
      params: { id: "issue-1" },
      query: { latest: "true", scope: "reviewer" },
    });
    const found = await invokeRoute({
      router: fixture.router,
      path: "/issues/:id/protocol/briefs",
      params: { id: "issue-1" },
      query: { latest: "true", scope: "reviewer" },
    });

    expect(missing).toEqual({
      statusCode: 404,
      body: { error: "Brief not found" },
    });
    expect(found).toEqual({
      statusCode: 200,
      body: {
        id: "brief-1",
        briefScope: "reviewer",
      },
    });
  });

  it("lists task briefs when latest mode is not requested", async () => {
    const fixture = createRouterContext();
    fixture.svc.getById.mockResolvedValue({
      id: "issue-1",
      companyId: "company-1",
    });
    fixture.knowledge.listTaskBriefs.mockResolvedValue([
      { id: "brief-1" },
      { id: "brief-2" },
    ]);

    const response = await invokeRoute({
      router: fixture.router,
      path: "/issues/:id/protocol/briefs",
      params: { id: "issue-1" },
      query: { scope: "qa" },
    });

    expect(response).toEqual({
      statusCode: 200,
      body: [{ id: "brief-1" }, { id: "brief-2" }],
    });
    expect(fixture.knowledge.listTaskBriefs).toHaveBeenCalledWith({
      issueId: "issue-1",
      briefScope: "qa",
      limit: 20,
    });
  });
});
