import { beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "express";

const { mockLogActivity } = vi.hoisted(() => ({
  mockLogActivity: vi.fn(),
}));

vi.mock("../services/index.js", () => ({
  logActivity: mockLogActivity,
}));

import { registerIssueAttachmentRoutes } from "../routes/issues/attachments-routes.js";

function createRouterContext() {
  const router = Router();
  const svc = {
    getById: vi.fn(),
    listAttachments: vi.fn(),
    createAttachment: vi.fn(),
    getAttachmentById: vi.fn(),
    removeAttachment: vi.fn(),
  };
  const storage = {
    putFile: vi.fn(),
    getObject: vi.fn(),
    deleteObject: vi.fn(),
  };
  const runSingleFileUpload = vi.fn();
  const withContentPath = vi.fn((attachment: any) => ({
    ...attachment,
    contentPath: `/api/attachments/${attachment.id}/content`,
  }));

  registerIssueAttachmentRoutes({
    router,
    db: {} as never,
    storage,
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
      scheduleIssueMemoryIngest: vi.fn(),
      ensureIssueLabelsByName: vi.fn(),
      loadIssueChangeSurface: vi.fn(),
      queueIssueWakeup: vi.fn(),
      runSingleFileUpload,
      assertCanManageIssueApprovalLinks: vi.fn(),
      assertCanAssignTasks: vi.fn(),
      assertInternalWorkItemReviewer: vi.fn(),
      assertInternalWorkItemQa: vi.fn(),
      assertInternalWorkItemLeadSupervisor: vi.fn(),
      createInternalWorkItemSchema: {} as never,
      replyWithIssueSurface: vi.fn(),
      parseInternalWorkItemBody: vi.fn(),
    },
    constants: {
      maxAttachmentBytes: 4 * 1024 * 1024,
      allowedAttachmentContentTypes: new Set(["image/png", "text/plain"]),
    },
  } as never);

  return {
    router,
    svc,
    storage,
    runSingleFileUpload,
    withContentPath,
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
  body?: Record<string, unknown>;
}) {
  const handlers = findHandlers(input.router, input.method, input.path);
  const headers: Record<string, string> = {};
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
  const state: { statusCode: number; body: unknown; headers: Record<string, string>; streamed: boolean } = {
    statusCode: 200,
    body: undefined,
    headers,
    streamed: false,
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
    setHeader(name: string, value: string) {
      headers[name] = value;
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

  return { req, state };
}

describe("issue attachment routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists attachments and injects content paths", async () => {
    const fixture = createRouterContext();
    fixture.svc.getById.mockResolvedValue({
      id: "issue-1",
      companyId: "company-1",
    });
    fixture.svc.listAttachments.mockResolvedValue([
      { id: "attachment-1", issueId: "issue-1" },
    ]);

    const response = await invokeRoute({
      router: fixture.router,
      method: "get",
      path: "/issues/:id/attachments",
      params: { id: "issue-1" },
    });

    expect(response.state.statusCode).toBe(200);
    expect(response.state.body).toEqual([
      {
        id: "attachment-1",
        issueId: "issue-1",
        contentPath: "/api/attachments/attachment-1/content",
      },
    ]);
    expect(fixture.withContentPath).toHaveBeenCalled();
  });

  it("uploads attachment content, persists metadata, and logs activity", async () => {
    const fixture = createRouterContext();
    fixture.svc.getById.mockResolvedValue({
      id: "issue-1",
      companyId: "company-1",
    });
    fixture.runSingleFileUpload.mockImplementation(async (req: any) => {
      req.file = {
        mimetype: "image/png",
        buffer: Buffer.from("pngdata"),
        originalname: "evidence.png",
      };
    });
    fixture.storage.putFile.mockResolvedValue({
      provider: "local",
      objectKey: "issues/issue-1/evidence.png",
      contentType: "image/png",
      byteSize: 7,
      sha256: "hash",
      originalFilename: "evidence.png",
    });
    fixture.svc.createAttachment.mockResolvedValue({
      id: "attachment-1",
      companyId: "company-1",
      issueId: "issue-1",
      contentType: "image/png",
      byteSize: 7,
      originalFilename: "evidence.png",
      objectKey: "issues/issue-1/evidence.png",
    });

    const response = await invokeRoute({
      router: fixture.router,
      method: "post",
      path: "/companies/:companyId/issues/:issueId/attachments",
      params: { companyId: "company-1", issueId: "issue-1" },
      body: {},
    });

    expect(response.state.statusCode).toBe(201);
    expect(fixture.storage.putFile).toHaveBeenCalledWith(expect.objectContaining({
      companyId: "company-1",
      namespace: "issues/issue-1",
      contentType: "image/png",
    }));
    expect(fixture.svc.createAttachment).toHaveBeenCalledWith(expect.objectContaining({
      issueId: "issue-1",
      contentType: "image/png",
    }));
    expect(mockLogActivity).toHaveBeenCalledWith(
      {} as never,
      expect.objectContaining({
        action: "issue.attachment_added",
      }),
    );
  });

  it("rejects mismatched company scope and unsupported content types", async () => {
    const mismatch = createRouterContext();
    mismatch.svc.getById.mockResolvedValue({
      id: "issue-1",
      companyId: "company-2",
    });

    const mismatchResponse = await invokeRoute({
      router: mismatch.router,
      method: "post",
      path: "/companies/:companyId/issues/:issueId/attachments",
      params: { companyId: "company-1", issueId: "issue-1" },
      body: {},
    });

    expect(mismatchResponse.state).toEqual({
      statusCode: 422,
      body: { error: "Issue does not belong to company" },
      headers: {},
      streamed: false,
    });

    const unsupported = createRouterContext();
    unsupported.svc.getById.mockResolvedValue({
      id: "issue-1",
      companyId: "company-1",
    });
    unsupported.runSingleFileUpload.mockImplementation(async (req: any) => {
      req.file = {
        mimetype: "application/zip",
        buffer: Buffer.from("zipdata"),
        originalname: "bundle.zip",
      };
    });

    const unsupportedResponse = await invokeRoute({
      router: unsupported.router,
      method: "post",
      path: "/companies/:companyId/issues/:issueId/attachments",
      params: { companyId: "company-1", issueId: "issue-1" },
      body: {},
    });

    expect(unsupportedResponse.state.statusCode).toBe(422);
    expect(unsupportedResponse.state.body).toEqual({
      error: "Unsupported attachment type: application/zip",
    });
  });

  it("streams and deletes attachments", async () => {
    const fixture = createRouterContext();
    fixture.svc.getAttachmentById.mockResolvedValue({
      id: "attachment-1",
      companyId: "company-1",
      issueId: "issue-1",
      byteSize: 7,
      contentType: "image/png",
      objectKey: "issues/issue-1/evidence.png",
      originalFilename: "evidence.png",
    });
    fixture.storage.getObject.mockResolvedValue({
      contentType: "image/png",
      contentLength: 7,
      stream: {
        on: vi.fn(),
        pipe(res: any) {
          res.json({ streamed: true });
        },
      },
    });
    fixture.svc.removeAttachment.mockResolvedValue({
      id: "attachment-1",
      companyId: "company-1",
      issueId: "issue-1",
    });

    const streamed = await invokeRoute({
      router: fixture.router,
      method: "get",
      path: "/attachments/:attachmentId/content",
      params: { attachmentId: "attachment-1" },
    });
    const removed = await invokeRoute({
      router: fixture.router,
      method: "delete",
      path: "/attachments/:attachmentId",
      params: { attachmentId: "attachment-1" },
    });

    expect(streamed.state.headers["Content-Type"]).toBe("image/png");
    expect(streamed.state.headers["Content-Disposition"]).toContain("evidence.png");
    expect(streamed.state.body).toEqual({ streamed: true });
    expect(removed.state).toEqual({
      statusCode: 200,
      body: { ok: true },
      headers: {},
      streamed: false,
    });
    expect(fixture.storage.deleteObject).toHaveBeenCalledWith("company-1", "issues/issue-1/evidence.png");
    expect(mockLogActivity).toHaveBeenCalledWith(
      {} as never,
      expect.objectContaining({
        action: "issue.attachment_removed",
      }),
    );
  });
});
