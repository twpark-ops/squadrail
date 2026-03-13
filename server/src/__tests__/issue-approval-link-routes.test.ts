import { Router } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockLogActivity } = vi.hoisted(() => ({
  mockLogActivity: vi.fn(),
}));

vi.mock("../services/index.js", () => ({
  logActivity: mockLogActivity,
}));

import { registerIssueApprovalRoutes } from "../routes/issues/approvals-routes.js";

function createRouterContext() {
  const router = Router();
  const svc = {
    getById: vi.fn(),
  };
  const issueApprovalsSvc = {
    listApprovalsForIssue: vi.fn(),
    link: vi.fn(),
    unlink: vi.fn(),
  };
  const assertCanManageIssueApprovalLinks = vi.fn();

  registerIssueApprovalRoutes({
    router,
    db: {} as never,
    storage: {} as never,
    services: {
      svc,
      agentsSvc: {} as never,
      knowledge: {} as never,
      projectsSvc: {} as never,
      issueApprovalsSvc,
      protocolSvc: {} as never,
      retrievalPersonalization: {} as never,
      mergeCandidatesSvc: {} as never,
    },
    helpers: {
      withContentPath: ((value: unknown) => value) as never,
      scheduleIssueMemoryIngest: vi.fn(),
      ensureIssueLabelsByName: vi.fn(),
      loadIssueChangeSurface: vi.fn(),
      queueIssueWakeup: vi.fn(),
      runSingleFileUpload: vi.fn(),
      assertCanManageIssueApprovalLinks,
      assertCanAssignTasks: vi.fn(),
      assertInternalWorkItemReviewer: vi.fn(),
      assertInternalWorkItemQa: vi.fn(),
      assertInternalWorkItemLeadSupervisor: vi.fn(),
      createInternalWorkItemSchema: {} as never,
      replyWithIssueSurface: vi.fn(),
      parseInternalWorkItemBody: vi.fn(),
    },
    constants: {} as never,
  } as never);

  return {
    router,
    svc,
    issueApprovalsSvc,
    assertCanManageIssueApprovalLinks,
  };
}

function findHandlers(router: any, method: "get" | "post" | "delete", path: string) {
  const layer = router.stack.find((entry: any) => (
    entry.route?.path === path && entry.route?.methods?.[method] === true
  ));
  if (!layer) throw new Error(`Route ${method.toUpperCase()} ${path} not found`);
  return layer.route.stack.map((entry: any) => entry.handle as Function);
}

async function invokeRoute(input: {
  router: any;
  method: "get" | "post" | "delete";
  path: string;
  params?: Record<string, string>;
  body?: unknown;
}) {
  const handlers = findHandlers(input.router, input.method, input.path);
  const req = {
    params: input.params ?? {},
    body: input.body ?? {},
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

describe("issue approval link routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when the issue does not exist", async () => {
    const fixture = createRouterContext();
    fixture.svc.getById.mockResolvedValue(null);

    const response = await invokeRoute({
      router: fixture.router,
      method: "get",
      path: "/issues/:id/approvals",
      params: { id: "issue-1" },
    });

    expect(response).toEqual({
      statusCode: 404,
      body: { error: "Issue not found" },
    });
  });

  it("links approvals and returns the refreshed approval list", async () => {
    const fixture = createRouterContext();
    fixture.svc.getById.mockResolvedValue({
      id: "issue-1",
      companyId: "company-1",
    });
    fixture.assertCanManageIssueApprovalLinks.mockResolvedValue(true);
    fixture.issueApprovalsSvc.listApprovalsForIssue.mockResolvedValue([
      { id: "approval-1" },
    ]);

    const response = await invokeRoute({
      router: fixture.router,
      method: "post",
      path: "/issues/:id/approvals",
      params: { id: "issue-1" },
      body: {
        approvalId: "22222222-2222-4222-8222-222222222222",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.body).toEqual([{ id: "approval-1" }]);
    expect(fixture.issueApprovalsSvc.link).toHaveBeenCalledWith(
      "issue-1",
      "22222222-2222-4222-8222-222222222222",
      { agentId: null, userId: "user-1" },
    );
    expect(mockLogActivity).toHaveBeenCalledWith(
      {} as never,
      expect.objectContaining({
        companyId: "company-1",
        action: "issue.approval_linked",
      }),
    );
  });

  it("unlinks approvals through the management surface", async () => {
    const fixture = createRouterContext();
    fixture.svc.getById.mockResolvedValue({
      id: "issue-1",
      companyId: "company-1",
    });
    fixture.assertCanManageIssueApprovalLinks.mockResolvedValue(true);

    const response = await invokeRoute({
      router: fixture.router,
      method: "delete",
      path: "/issues/:id/approvals/:approvalId",
      params: {
        id: "issue-1",
        approvalId: "approval-1",
      },
    });

    expect(response).toEqual({
      statusCode: 200,
      body: { ok: true },
    });
    expect(fixture.issueApprovalsSvc.unlink).toHaveBeenCalledWith("issue-1", "approval-1");
    expect(mockLogActivity).toHaveBeenCalledWith(
      {} as never,
      expect.objectContaining({
        companyId: "company-1",
        action: "issue.approval_unlinked",
      }),
    );
  });
});
