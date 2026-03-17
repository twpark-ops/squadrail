import { Router } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerIssueDeliverablesRoutes } from "../routes/issues/deliverables-routes.js";

function makeAttachment(overrides: Record<string, unknown> = {}) {
  return {
    id: "att-1",
    issueId: "issue-1",
    companyId: "company-1",
    objectKey: "uploads/file.pdf",
    originalFilename: "file.pdf",
    contentType: "application/pdf",
    byteSize: 12345,
    createdAt: new Date("2026-03-15T10:00:00Z"),
    ...overrides,
  };
}

function makeChangeSurface(overrides: Record<string, unknown> = {}) {
  return {
    diffArtifact: null,
    approvalArtifact: null,
    latestRunArtifact: null,
    workspaceBindingArtifact: null,
    verificationArtifacts: [],
    ...overrides,
  };
}

function makeArtifact(overrides: Record<string, unknown> = {}) {
  return {
    messageId: "msg-1",
    kind: "diff",
    label: "PR #42 diff",
    uri: "https://github.com/org/repo/pull/42.diff",
    createdAt: new Date("2026-03-15T12:00:00Z"),
    messageType: "SUBMIT_DIFF",
    metadata: null,
    ...overrides,
  };
}

function createRouterContext() {
  const router = Router();
  const svc = {
    getById: vi.fn(),
    listAttachments: vi.fn(),
  };
  const withContentPath = vi.fn((attachment: Record<string, unknown>) => ({
    ...attachment,
    contentPath: `/content/${attachment.objectKey as string}`,
  }));
  const loadIssueChangeSurface = vi.fn();

  registerIssueDeliverablesRoutes({
    router,
    db: {} as never,
    storage: {} as never,
    services: {
      svc,
      agentsSvc: {} as never,
      knowledge: {} as never,
      projectsSvc: {} as never,
      issueApprovalsSvc: {} as never,
      protocolSvc: {} as never,
      retrievalPersonalization: {} as never,
      mergeCandidatesSvc: {} as never,
    },
    helpers: {
      withContentPath,
      loadIssueChangeSurface,
      scheduleIssueMemoryIngest: vi.fn(),
      ensureIssueLabelsByName: vi.fn(),
      queueIssueWakeup: vi.fn(),
      runSingleFileUpload: vi.fn(),
      assertCanManageIssueApprovalLinks: vi.fn(),
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
    withContentPath,
    loadIssueChangeSurface,
  };
}

function findHandlers(router: Router, method: "get", path: string) {
  const layer = (router as unknown as { stack: Array<Record<string, unknown>> }).stack.find(
    (entry: any) => entry.route?.path === path && entry.route?.methods?.[method] === true,
  );
  if (!layer) throw new Error(`Route ${method.toUpperCase()} ${path} not found`);
  return (layer as any).route.stack.map((entry: any) => entry.handle as Function);
}

async function invokeRoute(input: {
  router: Router;
  path: string;
  params?: Record<string, string>;
}) {
  const handlers = findHandlers(input.router, "get", input.path);
  const req = {
    params: input.params ?? {},
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
        const result = handler(req, res, (error?: unknown) => (error ? reject(error) : resolve()));
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

describe("issue-deliverables route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when the issue does not exist", async () => {
    const fixture = createRouterContext();
    fixture.svc.getById.mockResolvedValue(null);

    const response = await invokeRoute({
      router: fixture.router,
      path: "/issues/:id/deliverables",
      params: { id: "issue-1" },
    });

    expect(response).toEqual({
      statusCode: 404,
      body: { error: "Issue not found" },
    });
  });

  it("returns an empty array when there are no attachments or artifacts", async () => {
    const fixture = createRouterContext();
    fixture.svc.getById.mockResolvedValue({
      id: "issue-1",
      companyId: "company-1",
    });
    fixture.svc.listAttachments.mockResolvedValue([]);
    fixture.loadIssueChangeSurface.mockResolvedValue(makeChangeSurface());

    const response = await invokeRoute({
      router: fixture.router,
      path: "/issues/:id/deliverables",
      params: { id: "issue-1" },
    });

    expect(response).toEqual({
      statusCode: 200,
      body: [],
    });
    expect(fixture.svc.listAttachments).toHaveBeenCalledWith("issue-1");
  });

  it("maps attachments and artifacts into sorted deliverables", async () => {
    const fixture = createRouterContext();
    fixture.svc.getById.mockResolvedValue({
      id: "issue-1",
      companyId: "company-1",
    });
    fixture.svc.listAttachments.mockResolvedValue([
      makeAttachment({
        id: "att-1",
        originalFilename: "design.png",
        contentType: "image/png",
        objectKey: "uploads/design.png",
        byteSize: 54321,
        createdAt: new Date("2026-03-15T10:00:00Z"),
      }),
    ]);
    fixture.loadIssueChangeSurface.mockResolvedValue(
      makeChangeSurface({
        diffArtifact: makeArtifact({
          kind: "diff",
          label: "PR diff",
          uri: "https://github.com/org/repo/pull/42.diff",
          createdAt: new Date("2026-03-16T12:00:00Z"),
        }),
      }),
    );

    const response = await invokeRoute({
      router: fixture.router,
      path: "/issues/:id/deliverables",
      params: { id: "issue-1" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual([
      expect.objectContaining({
        source: "protocol_artifact",
        kind: "diff",
        label: "PR diff",
        href: "https://github.com/org/repo/pull/42.diff",
      }),
      expect.objectContaining({
        id: "att-1",
        source: "attachment",
        kind: "file",
        label: "design.png",
        href: "/content/uploads/design.png",
        contentType: "image/png",
        metadata: {
          byteSize: 54321,
          objectKey: "uploads/design.png",
        },
      }),
    ]);
    expect(fixture.withContentPath).toHaveBeenCalledTimes(1);
  });
});
