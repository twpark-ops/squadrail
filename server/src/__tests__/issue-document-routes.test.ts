import { Router } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreateIssueDocumentService } = vi.hoisted(() => ({
  mockCreateIssueDocumentService: vi.fn(),
}));

vi.mock("../services/issue-documents.js", () => ({
  createIssueDocumentService: mockCreateIssueDocumentService,
}));

import { registerIssueDocumentRoutes } from "../routes/issues/documents-routes.js";

function createRouterContext() {
  const router = Router();
  const svc = {
    getById: vi.fn(),
  };
  const docService = {
    listDocuments: vi.fn(),
    getDocument: vi.fn(),
    upsertDocument: vi.fn(),
    deleteDocument: vi.fn(),
    listRevisions: vi.fn(),
  };
  mockCreateIssueDocumentService.mockReturnValue(docService);

  registerIssueDocumentRoutes({
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
      withContentPath: vi.fn(),
      scheduleIssueMemoryIngest: vi.fn(),
      ensureIssueLabelsByName: vi.fn(),
      loadIssueChangeSurface: vi.fn(),
      queueIssueWakeup: vi.fn(),
      runSingleFileUpload: vi.fn(),
      assertCanManageIssueApprovalLinks: vi.fn(),
      assertCanAssignTasks: vi.fn(),
      assertInternalWorkItemReviewer: vi.fn(),
      assertInternalWorkItemQa: vi.fn(),
      assertInternalWorkItemLeadSupervisor: vi.fn(),
      buildTaskAssignmentSender: vi.fn(),
      createAndAssignInternalWorkItem: vi.fn(),
      appendProtocolMessageAndDispatch: vi.fn(),
      buildPmProjectionRootDescription: vi.fn(),
      resolvePmIntakeAgents: vi.fn(),
      derivePmIntakeIssueTitle: vi.fn(),
      buildPmIntakeIssueDescription: vi.fn(),
      buildPmIntakeAssignment: vi.fn(),
      buildPmIntakeProjectionPreview: vi.fn(),
      buildMergeAutomationPlan: vi.fn(),
      runMergeAutomationAction: vi.fn(),
    },
    schemas: {
      mergeCandidateActionSchema: {} as never,
      mergeCandidateAutomationSchema: {} as never,
      retrievalFeedbackSchema: {} as never,
    },
    constants: {
      maxAttachmentBytes: 10 * 1024 * 1024,
      maxDocumentBodyChars: 16,
      allowedAttachmentContentTypes: new Set<string>(),
      pmIntakeLabelSpecs: [],
    },
  } as never);

  return { router, svc, docService };
}

function findHandlers(router: Router, method: "put", path: string) {
  const layer = (router as unknown as { stack: Array<Record<string, unknown>> }).stack.find(
    (entry: any) => entry.route?.path === path && entry.route?.methods?.[method] === true,
  );
  if (!layer) throw new Error(`Route ${method.toUpperCase()} ${path} not found`);
  return (layer as any).route.stack.map((entry: any) => entry.handle as Function);
}

async function invokePutRoute(input: {
  router: Router;
  path: string;
  params: Record<string, string>;
  body: Record<string, unknown>;
}) {
  const handlers = findHandlers(input.router, "put", input.path);
  const req = {
    params: input.params,
    body: input.body,
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

describe("issue-document routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects oversized document bodies before hitting the service", async () => {
    const fixture = createRouterContext();
    fixture.svc.getById.mockResolvedValue({
      id: "issue-1",
      companyId: "company-1",
    });

    const response = await invokePutRoute({
      router: fixture.router,
      path: "/companies/:companyId/issues/:issueId/documents/:key",
      params: {
        companyId: "company-1",
        issueId: "issue-1",
        key: "plan",
      },
      body: {
        title: "Plan",
        body: "0123456789abcdefX",
      },
    });

    expect(response.statusCode).toBe(422);
    expect(fixture.docService.upsertDocument).not.toHaveBeenCalled();
  });

  it("accepts document bodies within the configured limit", async () => {
    const fixture = createRouterContext();
    fixture.svc.getById.mockResolvedValue({
      id: "issue-1",
      companyId: "company-1",
    });
    fixture.docService.upsertDocument.mockResolvedValue({
      id: "doc-1",
      issueId: "issue-1",
      companyId: "company-1",
      key: "plan",
      title: "Plan",
      body: "short body",
      revisionNumber: 1,
    });

    const response = await invokePutRoute({
      router: fixture.router,
      path: "/companies/:companyId/issues/:issueId/documents/:key",
      params: {
        companyId: "company-1",
        issueId: "issue-1",
        key: "plan",
      },
      body: {
        title: "Plan",
        body: "short body",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(fixture.docService.upsertDocument).toHaveBeenCalledWith(expect.objectContaining({
      issueId: "issue-1",
      companyId: "company-1",
      key: "plan",
      title: "Plan",
      body: "short body",
    }));
  });
});
