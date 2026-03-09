import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockEnsureMembership,
  mockAccessCanUser,
  mockAccessHasPermission,
  mockIssueCreate,
  mockIssueGetById,
  mockIssueUpdate,
  mockIssueCheckout,
  mockIssueFindMentionedAgents,
  mockIssueFindMentionedProjectIds,
  mockIssueGetAncestors,
  mockIssueListInternalWorkItems,
  mockIssueGetInternalWorkItemSummary,
  mockIssueCreateInternalWorkItem,
  mockIssueRemove,
  mockHeartbeatWakeup,
  mockHeartbeatGetRun,
  mockHeartbeatCancelIssueScope,
  mockAgentGetById,
  mockProtocolGetState,
  mockProtocolAppendMessage,
  mockProtocolDispatchMessage,
  mockIssueRetrievalHandleProtocolMessage,
  mockLogActivity,
} = vi.hoisted(() => ({
  mockEnsureMembership: vi.fn(),
  mockAccessCanUser: vi.fn(),
  mockAccessHasPermission: vi.fn(),
  mockIssueCreate: vi.fn(),
  mockIssueGetById: vi.fn(),
  mockIssueUpdate: vi.fn(),
  mockIssueCheckout: vi.fn(),
  mockIssueFindMentionedAgents: vi.fn(),
  mockIssueFindMentionedProjectIds: vi.fn(),
  mockIssueGetAncestors: vi.fn(),
  mockIssueListInternalWorkItems: vi.fn(),
  mockIssueGetInternalWorkItemSummary: vi.fn(),
  mockIssueCreateInternalWorkItem: vi.fn(),
  mockIssueRemove: vi.fn(),
  mockHeartbeatWakeup: vi.fn(),
  mockHeartbeatGetRun: vi.fn(),
  mockHeartbeatCancelIssueScope: vi.fn(),
  mockAgentGetById: vi.fn(),
  mockProtocolGetState: vi.fn(),
  mockProtocolAppendMessage: vi.fn(),
  mockProtocolDispatchMessage: vi.fn(),
  mockIssueRetrievalHandleProtocolMessage: vi.fn(),
  mockLogActivity: vi.fn(),
}));

vi.mock("../services/index.js", () => ({
  accessService: () => ({
    ensureMembership: mockEnsureMembership,
    canUser: mockAccessCanUser,
    hasPermission: mockAccessHasPermission,
  }),
  agentService: () => ({
    getById: mockAgentGetById,
    list: vi.fn(),
  }),
  goalService: () => ({
    listForIssue: vi.fn(),
    getById: vi.fn(),
  }),
  heartbeatService: () => ({
    wakeup: mockHeartbeatWakeup,
    getRun: mockHeartbeatGetRun,
    cancelIssueScope: mockHeartbeatCancelIssueScope,
  }),
  issueApprovalService: () => ({
    listApprovalsForIssue: vi.fn(),
    unlink: vi.fn(),
    link: vi.fn(),
    listIssuesForApproval: vi.fn(),
    linkManyForApproval: vi.fn(),
  }),
  issueProtocolExecutionService: () => ({
    onIssueCommentCreated: vi.fn(),
    dispatchMessage: mockProtocolDispatchMessage,
  }),
  issueRetrievalService: () => ({
    buildBrief: vi.fn(),
    listBriefs: vi.fn(),
    handleProtocolMessage: mockIssueRetrievalHandleProtocolMessage,
  }),
  issueProtocolService: () => ({
    getState: mockProtocolGetState,
    listMessages: vi.fn(),
    listViolations: vi.fn(),
    listReviewCycles: vi.fn(),
    appendMessage: mockProtocolAppendMessage,
  }),
  issueService: () => ({
    create: mockIssueCreate,
    getById: mockIssueGetById,
    update: mockIssueUpdate,
    checkout: mockIssueCheckout,
    addComment: vi.fn(),
    findMentionedAgents: mockIssueFindMentionedAgents,
    findMentionedProjectIds: mockIssueFindMentionedProjectIds,
    getAncestors: mockIssueGetAncestors,
    listInternalWorkItems: mockIssueListInternalWorkItems,
    getInternalWorkItemSummary: mockIssueGetInternalWorkItemSummary,
    createInternalWorkItem: mockIssueCreateInternalWorkItem,
    list: vi.fn(),
    listComments: vi.fn(),
    listAttachments: vi.fn(),
    createAttachmentMetadata: vi.fn(),
    removeAttachment: vi.fn(),
    getAttachmentById: vi.fn(),
    linkLabels: vi.fn(),
    unlinkLabel: vi.fn(),
    listLabels: vi.fn(),
    remove: mockIssueRemove,
    release: vi.fn(),
    getProtocolState: vi.fn(),
  }),
  knowledgeService: () => ({
    upsertDocument: vi.fn(),
  }),
  projectService: () => ({
    list: vi.fn(),
    getById: vi.fn(),
    listByIds: vi.fn(),
  }),
  logActivity: mockLogActivity,
}));

import { issueRoutes } from "../routes/issues.js";

type BoardActor = {
  type: "board";
  source: "local_implicit" | "session";
  isInstanceAdmin: boolean;
  userId: string;
  companyIds: string[];
  runId: string | null;
};

type AgentActor = {
  type: "agent";
  source: "agent_jwt" | "agent_key";
  agentId: string;
  companyId: string;
  runId?: string;
};

function buildBoardActor(companyIds: string[] = ["company-1"]): BoardActor {
  return {
    type: "board",
    source: "local_implicit",
    isInstanceAdmin: true,
    userId: "user-1",
    companyIds,
    runId: null,
  };
}

function buildAgentActor(agentId = "agent-1", companyId = "company-1"): AgentActor {
  return {
    type: "agent",
    source: "agent_jwt",
    agentId,
    companyId,
  };
}

function createTestRouter() {
  return issueRoutes({} as never, {
    putObject: vi.fn(),
    deleteObject: vi.fn(),
    getObjectStream: vi.fn(),
  } as never) as any;
}

function findRouteLayer(router: any, path: string, method: "get" | "post" | "patch") {
  const layer = router.stack.find(
    (entry: any) => entry.route?.path === path && entry.route?.methods?.[method] === true,
  );
  if (!layer?.route?.stack) {
    throw new Error(`Route ${method.toUpperCase()} ${path} not found`);
  }
  return layer.route.stack.map((entry: any) => entry.handle as Function);
}

async function invokeRoute(input: {
  path: string;
  method: "get" | "post" | "patch";
  params?: Record<string, string>;
  body?: unknown;
  actor?: BoardActor;
}) {
  const router = createTestRouter();
  const handlers = findRouteLayer(router, input.path, input.method);
  const req = {
    params: input.params ?? {},
    body: input.body ?? {},
    query: {},
    actor: input.actor ?? buildBoardActor(),
  } as any;
  const state: { statusCode: number; body: unknown } = { statusCode: 200, body: undefined };
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

  try {
    for (const handler of handlers) {
      await new Promise<void>((resolve, reject) => {
        try {
          const result = handler(req, res, (error?: unknown) => {
            if (error) reject(error);
            else resolve();
          });

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
  } catch (error: any) {
    if (error?.name === "ZodError") {
      return {
        statusCode: 400,
        body: { error: "Validation error", details: error.errors ?? error.issues ?? [] },
      };
    }
    return {
      statusCode: error?.status ?? 500,
      body: { error: error?.message ?? "Unhandled error" },
    };
  }
}

describe("issue routes wakeup handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnsureMembership.mockResolvedValue(true);
    mockAccessCanUser.mockResolvedValue(true);
    mockAccessHasPermission.mockResolvedValue(true);
    mockIssueFindMentionedAgents.mockResolvedValue([]);
    mockIssueFindMentionedProjectIds.mockResolvedValue([]);
    mockIssueGetAncestors.mockResolvedValue([]);
    mockIssueListInternalWorkItems.mockResolvedValue([]);
    mockIssueGetInternalWorkItemSummary.mockResolvedValue({
      total: 0,
      backlog: 0,
      todo: 0,
      inProgress: 0,
      inReview: 0,
      blocked: 0,
      done: 0,
      cancelled: 0,
      activeAssigneeAgentIds: [],
      blockerIssueId: null,
      reviewRequestedIssueId: null,
    });
    mockAgentGetById.mockResolvedValue(null);
    mockHeartbeatGetRun.mockResolvedValue(null);
    mockHeartbeatCancelIssueScope.mockResolvedValue({
      cancelledWakeupCount: 0,
      cancelledRunCount: 0,
    });
    mockProtocolGetState.mockResolvedValue(null);
    mockProtocolAppendMessage.mockResolvedValue({
      message: { id: "protocol-message-1", seq: 1 },
      state: {},
    });
    mockProtocolDispatchMessage.mockResolvedValue(undefined);
    mockIssueRetrievalHandleProtocolMessage.mockResolvedValue({ recipientHints: [] });
  });

  it("awaits assignee wakeup on issue create", async () => {
    let wakeResolved = false;
    mockIssueCreate.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
      identifier: "CLO-101",
      title: "Create test issue",
      status: "todo",
      assigneeAgentId: "22222222-2222-4222-8222-222222222222",
    });
    mockHeartbeatWakeup.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            wakeResolved = true;
            resolve({ id: "run-1" });
          }, 0);
        }),
    );

    const response = await invokeRoute({
      path: "/companies/:companyId/issues",
      method: "post",
      params: { companyId: "company-1" },
      body: {
        title: "Create test issue",
        assigneeAgentId: "22222222-2222-4222-8222-222222222222",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(mockHeartbeatWakeup).toHaveBeenCalledWith(
      "22222222-2222-4222-8222-222222222222",
      expect.objectContaining({
        reason: "issue_assigned",
        payload: { issueId: "11111111-1111-4111-8111-111111111111", mutation: "create" },
      }),
    );
    expect(wakeResolved).toBe(true);
  });

  it("awaits assignee wakeup on issue reassignment", async () => {
    let wakeResolved = false;
    mockIssueGetById.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
      identifier: "CLO-102",
      title: "Existing issue",
      status: "todo",
      assigneeAgentId: null,
      assigneeUserId: null,
      createdByUserId: "user-1",
    });
    mockIssueUpdate.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
      identifier: "CLO-102",
      title: "Existing issue",
      status: "todo",
      assigneeAgentId: "33333333-3333-4333-8333-333333333333",
      assigneeUserId: null,
    });
    mockHeartbeatWakeup.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            wakeResolved = true;
            resolve({ id: "run-2" });
          }, 0);
        }),
    );

    const response = await invokeRoute({
      path: "/issues/:id",
      method: "patch",
      params: { id: "11111111-1111-4111-8111-111111111111" },
      body: { assigneeAgentId: "33333333-3333-4333-8333-333333333333" },
    });

    expect(response.statusCode).toBe(200);
    expect(mockHeartbeatWakeup).toHaveBeenCalledWith(
      "33333333-3333-4333-8333-333333333333",
      expect.objectContaining({
        reason: "issue_assigned",
        payload: { issueId: "11111111-1111-4111-8111-111111111111", mutation: "update" },
      }),
    );
    expect(wakeResolved).toBe(true);
  });

  it("awaits wakeup on checkout", async () => {
    let wakeResolved = false;
    mockIssueGetById.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
      identifier: "CLO-103",
      title: "Checkout issue",
      status: "todo",
    });
    mockIssueCheckout.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
      identifier: "CLO-103",
      title: "Checkout issue",
      status: "in_progress",
    });
    mockHeartbeatWakeup.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            wakeResolved = true;
            resolve({ id: "run-3" });
          }, 0);
        }),
    );

    const response = await invokeRoute({
      path: "/issues/:id/checkout",
      method: "post",
      params: { id: "11111111-1111-4111-8111-111111111111" },
      body: {
        agentId: "44444444-4444-4444-8444-444444444444",
        expectedStatuses: ["todo", "backlog", "blocked"],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(mockHeartbeatWakeup).toHaveBeenCalledWith(
      "44444444-4444-4444-8444-444444444444",
      expect.objectContaining({
        reason: "issue_checked_out",
        payload: { issueId: "11111111-1111-4111-8111-111111111111", mutation: "checkout" },
      }),
    );
    expect(wakeResolved).toBe(true);
  });

  it("returns internal work item summary on issue detail", async () => {
    mockIssueGetById.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
      identifier: "CLO-150",
      title: "Root issue",
      description: "Parent delivery issue",
      projectId: null,
      goalId: null,
      labels: [],
    });
    mockIssueListInternalWorkItems.mockResolvedValue([
      {
        id: "22222222-2222-4222-8222-222222222222",
        companyId: "company-1",
        identifier: "CLO-151",
        title: "Internal implementation item",
        status: "in_progress",
        priority: "high",
        assigneeAgentId: "engineer-1",
        hiddenAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        labels: [],
      },
    ]);
    mockIssueGetInternalWorkItemSummary.mockResolvedValue({
      total: 1,
      backlog: 0,
      todo: 0,
      inProgress: 1,
      inReview: 0,
      blocked: 0,
      done: 0,
      cancelled: 0,
      activeAssigneeAgentIds: ["engineer-1"],
      blockerIssueId: null,
      reviewRequestedIssueId: null,
    });

    const response = await invokeRoute({
      path: "/issues/:id",
      method: "get",
      params: { id: "11111111-1111-4111-8111-111111111111" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        internalWorkItems: expect.arrayContaining([
          expect.objectContaining({
            id: "22222222-2222-4222-8222-222222222222",
            title: "Internal implementation item",
          }),
        ]),
        internalWorkItemSummary: expect.objectContaining({
          total: 1,
          inProgress: 1,
        }),
      }),
    );
  });

  it("creates an internal work item and dispatches assignment protocol flow", async () => {
    mockIssueGetById
      .mockResolvedValueOnce({
        id: "11111111-1111-4111-8111-111111111111",
        companyId: "company-1",
        identifier: "CLO-160",
        title: "Root issue",
        description: "Parent delivery issue",
        projectId: null,
        goalId: null,
        labels: [],
        hiddenAt: null,
      })
      .mockResolvedValueOnce({
        id: "33333333-3333-4333-8333-333333333333",
        companyId: "company-1",
        identifier: "CLO-161",
        title: "Implement root fix",
        description: "Wire the execution path",
        projectId: null,
        goalId: null,
        status: "todo",
        priority: "high",
        assigneeAgentId: "44444444-4444-4444-8444-444444444444",
        hiddenAt: new Date().toISOString(),
        labels: [],
      });
    mockIssueCreateInternalWorkItem.mockResolvedValue({
      id: "33333333-3333-4333-8333-333333333333",
      companyId: "company-1",
      identifier: "CLO-161",
      title: "Implement root fix",
      description: "Wire the execution path",
      projectId: null,
      goalId: null,
      status: "backlog",
      priority: "high",
      assigneeAgentId: "44444444-4444-4444-8444-444444444444",
      hiddenAt: new Date().toISOString(),
      labels: [],
    });
    mockAgentGetById.mockImplementation(async (agentId: string) => {
      if (agentId === "55555555-5555-4555-8555-555555555555") {
        return {
          id: agentId,
          companyId: "company-1",
          role: "reviewer",
          status: "active",
          title: "Reviewer",
        };
      }
      if (agentId === "44444444-4444-4444-8444-444444444444") {
        return {
          id: agentId,
          companyId: "company-1",
          role: "engineer",
          status: "active",
          title: "Engineer",
        };
      }
      if (agentId === "66666666-6666-4666-8666-666666666666") {
        return {
          id: agentId,
          companyId: "company-1",
          role: "tech_lead",
          status: "active",
          title: "Cloud Tech Lead",
        };
      }
      return null;
    });
    mockProtocolGetState.mockResolvedValue({
      issueId: "11111111-1111-4111-8111-111111111111",
      techLeadAgentId: "66666666-6666-4666-8666-666666666666",
    });
    mockProtocolAppendMessage.mockResolvedValue({
      message: { id: "protocol-message-1", seq: 1 },
      state: {},
    });

    const response = await invokeRoute({
      path: "/issues/:id/internal-work-items",
      method: "post",
      params: { id: "11111111-1111-4111-8111-111111111111" },
      body: {
        title: "Implement root fix",
        description: "Wire the execution path",
        kind: "implementation",
        priority: "high",
        assigneeAgentId: "44444444-4444-4444-8444-444444444444",
        reviewerAgentId: "55555555-5555-4555-8555-555555555555",
        goal: "Stabilize the execution path",
        acceptanceCriteria: ["Assignment brief is generated"],
        definitionOfDone: ["Engineer receives the child work item"],
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.body).toEqual(
      expect.objectContaining({
        issue: expect.objectContaining({
          id: "33333333-3333-4333-8333-333333333333",
          status: "todo",
        }),
      }),
    );
    expect(mockIssueCreateInternalWorkItem).toHaveBeenCalledWith(
      expect.objectContaining({
        parentIssueId: "11111111-1111-4111-8111-111111111111",
        kind: "implementation",
        labelNames: expect.arrayContaining(["team:internal", "work:implementation", "watch:reviewer", "watch:lead"]),
      }),
    );
    expect(mockProtocolAppendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        issueId: "33333333-3333-4333-8333-333333333333",
        message: expect.objectContaining({
          messageType: "ASSIGN_TASK",
          recipients: expect.arrayContaining([
            expect.objectContaining({
              recipientId: "66666666-6666-4666-8666-666666666666",
              role: "tech_lead",
            }),
          ]),
          payload: expect.objectContaining({
            assigneeAgentId: "44444444-4444-4444-8444-444444444444",
            reviewerAgentId: "55555555-5555-4555-8555-555555555555",
          }),
        }),
      }),
    );
    expect(mockProtocolDispatchMessage).toHaveBeenCalledTimes(1);
  });

  it("rejects internal work items when assignee cannot act as engineer or tech lead", async () => {
    mockIssueGetById.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
      identifier: "CLO-162",
      title: "Root issue",
      description: "Parent delivery issue",
      projectId: null,
      goalId: null,
      labels: [],
      hiddenAt: null,
    });
    mockAgentGetById.mockImplementation(async (agentId: string) => {
      if (agentId === "44444444-4444-4444-8444-444444444444") {
        return {
          id: agentId,
          companyId: "company-1",
          role: "qa",
          status: "active",
          title: "QA",
        };
      }
      if (agentId === "55555555-5555-4555-8555-555555555555") {
        return {
          id: agentId,
          companyId: "company-1",
          role: "reviewer",
          status: "active",
          title: "Reviewer",
        };
      }
      return null;
    });

    const response = await invokeRoute({
      path: "/issues/:id/internal-work-items",
      method: "post",
      params: { id: "11111111-1111-4111-8111-111111111111" },
      body: {
        title: "Bad assignee",
        kind: "implementation",
        priority: "high",
        watchLead: false,
        assigneeAgentId: "44444444-4444-4444-8444-444444444444",
        reviewerAgentId: "55555555-5555-4555-8555-555555555555",
        acceptanceCriteria: ["Assignment brief is generated"],
        definitionOfDone: ["Engineer receives the child work item"],
      },
    });

    expect(response.statusCode).toBe(422);
    expect(mockIssueCreateInternalWorkItem).not.toHaveBeenCalled();
  });

  it("rejects internal work items when reviewer cannot act as reviewer", async () => {
    mockIssueGetById.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
      identifier: "CLO-163",
      title: "Root issue",
      description: "Parent delivery issue",
      projectId: null,
      goalId: null,
      labels: [],
      hiddenAt: null,
    });
    mockAgentGetById.mockImplementation(async (agentId: string) => {
      if (agentId === "44444444-4444-4444-8444-444444444444") {
        return {
          id: agentId,
          companyId: "company-1",
          role: "engineer",
          status: "active",
          title: "Engineer",
        };
      }
      if (agentId === "55555555-5555-4555-8555-555555555555") {
        return {
          id: agentId,
          companyId: "company-1",
          role: "pm",
          status: "active",
          title: "PM",
        };
      }
      return null;
    });

    const response = await invokeRoute({
      path: "/issues/:id/internal-work-items",
      method: "post",
      params: { id: "11111111-1111-4111-8111-111111111111" },
      body: {
        title: "Bad reviewer",
        kind: "implementation",
        priority: "high",
        watchLead: false,
        assigneeAgentId: "44444444-4444-4444-8444-444444444444",
        reviewerAgentId: "55555555-5555-4555-8555-555555555555",
        acceptanceCriteria: ["Assignment brief is generated"],
        definitionOfDone: ["Engineer receives the child work item"],
      },
    });

    expect(response.statusCode).toBe(422);
    expect(mockIssueCreateInternalWorkItem).not.toHaveBeenCalled();
  });

  it("rejects internal work items when reviewer matches assignee", async () => {
    mockIssueGetById.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
      identifier: "CLO-163A",
      title: "Root issue",
      description: "Parent delivery issue",
      projectId: null,
      goalId: null,
      labels: [],
      hiddenAt: null,
    });

    const response = await invokeRoute({
      path: "/issues/:id/internal-work-items",
      method: "post",
      params: { id: "11111111-1111-4111-8111-111111111111" },
      body: {
        title: "Self review",
        kind: "implementation",
        priority: "high",
        watchLead: false,
        assigneeAgentId: "44444444-4444-4444-8444-444444444444",
        reviewerAgentId: "44444444-4444-4444-8444-444444444444",
        acceptanceCriteria: ["Assignment brief is generated"],
        definitionOfDone: ["Engineer receives the child work item"],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(mockIssueCreateInternalWorkItem).not.toHaveBeenCalled();
  });

  it("cleans up the hidden child issue when initial protocol assignment fails", async () => {
    mockIssueGetById.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
      identifier: "CLO-164",
      title: "Root issue",
      description: "Parent delivery issue",
      projectId: null,
      goalId: null,
      labels: [],
      hiddenAt: null,
    });
    mockIssueCreateInternalWorkItem.mockResolvedValue({
      id: "33333333-3333-4333-8333-333333333333",
      companyId: "company-1",
      identifier: "CLO-165",
      title: "Implement root fix",
      description: "Wire the execution path",
      projectId: null,
      goalId: null,
      status: "backlog",
      priority: "high",
      assigneeAgentId: "44444444-4444-4444-8444-444444444444",
      hiddenAt: new Date().toISOString(),
      labels: [],
    });
    mockIssueRemove.mockResolvedValue({
      id: "33333333-3333-4333-8333-333333333333",
    });
    mockAgentGetById.mockImplementation(async (agentId: string) => {
      if (agentId === "44444444-4444-4444-8444-444444444444") {
        return {
          id: agentId,
          companyId: "company-1",
          role: "engineer",
          status: "active",
          title: "Engineer",
        };
      }
      if (agentId === "55555555-5555-4555-8555-555555555555") {
        return {
          id: agentId,
          companyId: "company-1",
          role: "reviewer",
          status: "active",
          title: "Reviewer",
        };
      }
      return null;
    });
    mockProtocolAppendMessage.mockRejectedValue(Object.assign(new Error("Protocol failed"), { status: 422 }));

    const response = await invokeRoute({
      path: "/issues/:id/internal-work-items",
      method: "post",
      params: { id: "11111111-1111-4111-8111-111111111111" },
      body: {
        title: "Implement root fix",
        kind: "implementation",
        priority: "high",
        watchLead: false,
        assigneeAgentId: "44444444-4444-4444-8444-444444444444",
        reviewerAgentId: "55555555-5555-4555-8555-555555555555",
        acceptanceCriteria: ["Assignment brief is generated"],
        definitionOfDone: ["Engineer receives the child work item"],
      },
    });

    expect(response.statusCode).toBe(422);
    expect(mockIssueRemove).toHaveBeenCalledWith("33333333-3333-4333-8333-333333333333");
  });

  it("rejects lead watch when no root tech lead is available", async () => {
    mockIssueGetById.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
      identifier: "CLO-165A",
      title: "Root issue",
      description: "Parent delivery issue",
      projectId: null,
      goalId: null,
      labels: [],
      hiddenAt: null,
    });
    mockAgentGetById.mockImplementation(async (agentId: string) => {
      if (agentId === "44444444-4444-4444-8444-444444444444") {
        return {
          id: agentId,
          companyId: "company-1",
          role: "engineer",
          status: "active",
          title: "Engineer",
        };
      }
      if (agentId === "55555555-5555-4555-8555-555555555555") {
        return {
          id: agentId,
          companyId: "company-1",
          role: "reviewer",
          status: "active",
          title: "Reviewer",
        };
      }
      return null;
    });
    mockProtocolGetState.mockResolvedValue(null);

    const response = await invokeRoute({
      path: "/issues/:id/internal-work-items",
      method: "post",
      params: { id: "11111111-1111-4111-8111-111111111111" },
      body: {
        title: "Missing lead watch owner",
        kind: "implementation",
        priority: "high",
        assigneeAgentId: "44444444-4444-4444-8444-444444444444",
        reviewerAgentId: "55555555-5555-4555-8555-555555555555",
        acceptanceCriteria: ["Assignment brief is generated"],
        definitionOfDone: ["Engineer receives the child work item"],
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.body).toEqual({ error: "Lead watch requires a root tech lead or tech lead creator" });
    expect(mockIssueCreateInternalWorkItem).not.toHaveBeenCalled();
  });

  it("allows cto agents to post task assignment protocol messages without explicit grants", async () => {
    mockAccessHasPermission.mockResolvedValue(false);
    mockIssueGetById.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
      identifier: "CLO-200",
      title: "Protocol issue",
      description: null,
      projectId: null,
      labels: [],
    });
    mockAgentGetById.mockResolvedValue({
      id: "cto-1",
      companyId: "company-1",
      role: "cto",
      title: "CTO",
      permissions: {},
    });

    const response = await invokeRoute({
      path: "/issues/:id/protocol/messages",
      method: "post",
      params: { id: "11111111-1111-4111-8111-111111111111" },
      actor: buildAgentActor("cto-1"),
      body: {
        messageType: "REASSIGN_TASK",
        sender: {
          actorType: "agent",
          actorId: "cto-1",
          role: "cto",
        },
        recipients: [
          { recipientType: "agent", recipientId: "22222222-2222-4222-8222-222222222222", role: "tech_lead" },
          { recipientType: "agent", recipientId: "33333333-3333-4333-8333-333333333333", role: "reviewer" },
        ],
        workflowStateBefore: "assigned",
        workflowStateAfter: "assigned",
        summary: "Delegate to cloud TL",
        payload: {
          reason: "Project-level ownership belongs to cloud TL",
          newAssigneeAgentId: "22222222-2222-4222-8222-222222222222",
          newReviewerAgentId: "33333333-3333-4333-8333-333333333333",
        },
        artifacts: [],
      },
    });

    expect(response.statusCode).toBe(201);
    expect(mockProtocolAppendMessage).toHaveBeenCalledTimes(1);
  });

  it("auto-attaches execution run artifacts to agent protocol messages", async () => {
    mockIssueGetById.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
      identifier: "CLO-201",
      title: "Protocol issue",
      description: null,
      projectId: "project-1",
      labels: [],
    });
    mockAgentGetById.mockResolvedValue({
      id: "eng-1",
      companyId: "company-1",
      role: "engineer",
      title: "Engineer",
      permissions: {},
    });
    mockProtocolGetState.mockResolvedValue({
      reviewerAgentId: "rev-1",
    });
    mockHeartbeatGetRun.mockResolvedValue({
      id: "run-1",
      companyId: "company-1",
      agentId: "eng-1",
      invocationSource: "automation",
      status: "running",
      startedAt: new Date("2026-03-10T00:00:00.000Z"),
      finishedAt: null,
      stdoutExcerpt: "pnpm test:run\npnpm build",
      stderrExcerpt: null,
      contextSnapshot: {
        issueId: "11111111-1111-4111-8111-111111111111",
        squadrailWorkspace: {
          cwd: "/workspace/repo",
          source: "project_isolated",
          projectId: "project-1",
          workspaceId: "workspace-1",
          repoUrl: "git@github.com:org/repo.git",
          repoRef: "main",
          workspaceUsage: "implementation",
          branchName: "squadrail/clo-201-eng-1",
        },
      },
    });

    const response = await invokeRoute({
      path: "/issues/:id/protocol/messages",
      method: "post",
      params: { id: "11111111-1111-4111-8111-111111111111" },
      actor: {
        ...buildAgentActor("eng-1"),
        runId: "run-1",
      },
      body: {
        messageType: "SUBMIT_FOR_REVIEW",
        sender: {
          actorType: "agent",
          actorId: "eng-1",
          role: "engineer",
        },
        recipients: [
          { recipientType: "agent", recipientId: "eng-1", role: "reviewer" },
        ],
        workflowStateBefore: "implementing",
        workflowStateAfter: "submitted_for_review",
        summary: "Submit for review",
        payload: {
          implementationSummary: "Done",
          evidence: ["pnpm build"],
          diffSummary: "Updated protocol path",
          changedFiles: ["server/src/routes/issues.ts"],
          testResults: ["pnpm test:run"],
          reviewChecklist: ["Protocol artifacts attached"],
          residualRisks: ["Monitor first rollout"],
        },
        artifacts: [],
      },
    });

    expect(response.statusCode).toBe(201);
    expect(mockProtocolAppendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.objectContaining({
          recipients: [
            expect.objectContaining({
              recipientType: "agent",
              recipientId: "rev-1",
              role: "reviewer",
            }),
          ],
          artifacts: expect.arrayContaining([
            expect.objectContaining({ kind: "run", uri: "run://run-1" }),
            expect.objectContaining({ kind: "test_run", uri: "run://run-1/test" }),
            expect.objectContaining({ kind: "build_run", uri: "run://run-1/build" }),
          ]),
        }),
      }),
    );
  });

  it("skips run artifact enrichment when the active run belongs to a different issue scope", async () => {
    mockIssueGetById.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
      identifier: "CLO-201",
      title: "Protocol issue",
      description: null,
      projectId: "project-1",
      labels: [],
    });
    mockAgentGetById.mockResolvedValue({
      id: "eng-1",
      companyId: "company-1",
      role: "engineer",
      title: "Engineer",
      permissions: {},
    });
    mockHeartbeatGetRun.mockResolvedValue({
      id: "run-1",
      companyId: "company-1",
      agentId: "eng-1",
      invocationSource: "automation",
      status: "running",
      startedAt: new Date("2026-03-10T00:00:00.000Z"),
      finishedAt: null,
      stdoutExcerpt: "pnpm test:run\npnpm build",
      stderrExcerpt: null,
      contextSnapshot: {
        issueId: "99999999-9999-4999-8999-999999999999",
      },
    });

    const response = await invokeRoute({
      path: "/issues/:id/protocol/messages",
      method: "post",
      params: { id: "11111111-1111-4111-8111-111111111111" },
      actor: {
        ...buildAgentActor("eng-1"),
        runId: "run-1",
      },
      body: {
        messageType: "SUBMIT_FOR_REVIEW",
        sender: {
          actorType: "agent",
          actorId: "eng-1",
          role: "engineer",
        },
        recipients: [
          { recipientType: "agent", recipientId: "rev-1", role: "reviewer" },
        ],
        workflowStateBefore: "implementing",
        workflowStateAfter: "submitted_for_review",
        summary: "Submit for review",
        payload: {
          implementationSummary: "Done",
          evidence: ["pnpm build"],
          diffSummary: "Updated protocol path",
          changedFiles: ["server/src/routes/issues.ts"],
          testResults: ["pnpm test:run"],
          reviewChecklist: ["Protocol artifacts attached"],
          residualRisks: ["Monitor first rollout"],
        },
        artifacts: [],
      },
    });

    expect(response.statusCode).toBe(201);
    expect(mockProtocolAppendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.objectContaining({
          artifacts: [],
        }),
      }),
    );
  });

  it("auto-injects the configured reviewer recipient for SUBMIT_FOR_REVIEW", async () => {
    mockIssueGetById.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
      identifier: "CLO-203",
      title: "Review recipient issue",
      description: null,
      projectId: null,
      labels: [],
    });
    mockAgentGetById.mockResolvedValue({
      id: "eng-1",
      companyId: "company-1",
      role: "engineer",
      title: "Engineer",
      permissions: {},
    });
    mockProtocolGetState.mockResolvedValue({
      reviewerAgentId: "rev-1",
    });

    const response = await invokeRoute({
      path: "/issues/:id/protocol/messages",
      method: "post",
      params: { id: "11111111-1111-4111-8111-111111111111" },
      actor: buildAgentActor("eng-1"),
      body: {
        messageType: "SUBMIT_FOR_REVIEW",
        sender: {
          actorType: "agent",
          actorId: "eng-1",
          role: "engineer",
        },
        recipients: [
          { recipientType: "agent", recipientId: "eng-1", role: "engineer" },
        ],
        workflowStateBefore: "implementing",
        workflowStateAfter: "submitted_for_review",
        summary: "Submit for review",
        payload: {
          implementationSummary: "Done",
          evidence: ["pnpm build"],
          diffSummary: "Updated protocol path",
          changedFiles: ["server/src/routes/issues.ts"],
          testResults: ["pnpm test:run"],
          reviewChecklist: ["Protocol artifacts attached"],
          residualRisks: ["Monitor first rollout"],
        },
        artifacts: [
          { kind: "diff", uri: "run://run-1/workspace-diff", label: "Workspace diff" },
        ],
      },
    });

    expect(response.statusCode).toBe(201);
    expect(mockProtocolAppendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.objectContaining({
          recipients: expect.arrayContaining([
            expect.objectContaining({
              recipientType: "agent",
              recipientId: "rev-1",
              role: "reviewer",
            }),
          ]),
        }),
      }),
    );
  });

  it("normalizes incorrect reviewer recipients for SUBMIT_FOR_REVIEW", async () => {
    mockIssueGetById.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
      identifier: "CLO-204",
      title: "Review recipient normalization issue",
      description: null,
      projectId: null,
      labels: [],
    });
    mockAgentGetById.mockResolvedValue({
      id: "eng-1",
      companyId: "company-1",
      role: "engineer",
      title: "Engineer",
      permissions: {},
    });
    mockProtocolGetState.mockResolvedValue({
      reviewerAgentId: "rev-1",
    });

    const response = await invokeRoute({
      path: "/issues/:id/protocol/messages",
      method: "post",
      params: { id: "11111111-1111-4111-8111-111111111111" },
      actor: buildAgentActor("eng-1"),
      body: {
        messageType: "SUBMIT_FOR_REVIEW",
        sender: {
          actorType: "agent",
          actorId: "eng-1",
          role: "engineer",
        },
        recipients: [
          { recipientType: "agent", recipientId: "eng-1", role: "engineer" },
          { recipientType: "agent", recipientId: "eng-1", role: "reviewer" },
        ],
        workflowStateBefore: "implementing",
        workflowStateAfter: "submitted_for_review",
        summary: "Submit for review",
        payload: {
          implementationSummary: "Done",
          evidence: ["pnpm build"],
          diffSummary: "Updated protocol path",
          changedFiles: ["server/src/routes/issues.ts"],
          testResults: ["pnpm test:run"],
          reviewChecklist: ["Protocol artifacts attached"],
          residualRisks: ["Monitor first rollout"],
        },
        artifacts: [],
      },
    });

    expect(response.statusCode).toBe(201);
    expect(mockProtocolAppendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.objectContaining({
          recipients: [
            expect.objectContaining({
              recipientType: "agent",
              recipientId: "eng-1",
              role: "engineer",
            }),
            expect.objectContaining({
              recipientType: "agent",
              recipientId: "rev-1",
              role: "reviewer",
            }),
          ],
        }),
      }),
    );
  });

  it("cancels issue-scoped heartbeat execution when CANCEL_TASK is posted", async () => {
    mockIssueGetById.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
      identifier: "CLO-202",
      title: "Cancelled issue",
      description: null,
      projectId: null,
      labels: [],
    });
    mockProtocolAppendMessage.mockResolvedValue({
      message: { id: "protocol-message-2", seq: 2 },
      state: { workflowState: "cancelled" },
    });
    mockHeartbeatCancelIssueScope.mockResolvedValue({
      cancelledWakeupCount: 2,
      cancelledRunCount: 1,
    });

    const response = await invokeRoute({
      path: "/issues/:id/protocol/messages",
      method: "post",
      params: { id: "11111111-1111-4111-8111-111111111111" },
      body: {
        messageType: "CANCEL_TASK",
        sender: {
          actorType: "user",
          actorId: "board-1",
          role: "human_board",
        },
        recipients: [
          { recipientType: "agent", recipientId: "eng-1", role: "engineer" },
          { recipientType: "agent", recipientId: "rev-1", role: "reviewer" },
        ],
        workflowStateBefore: "implementing",
        workflowStateAfter: "cancelled",
        summary: "Stop the work",
        payload: {
          reason: "Superseded by a clean rerun",
          cancelType: "manual_stop",
          replacementIssueId: null,
        },
        artifacts: [],
      },
    });

    expect(response.statusCode).toBe(201);
    expect(mockHeartbeatCancelIssueScope).toHaveBeenCalledWith({
      companyId: "company-1",
      issueId: "11111111-1111-4111-8111-111111111111",
      reason: "Issue cancelled via protocol",
    });
    expect(mockProtocolDispatchMessage).not.toHaveBeenCalled();
  });
});
