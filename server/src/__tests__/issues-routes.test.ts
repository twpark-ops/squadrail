import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockEnqueueAfterDbCommit,
  mockEnsureMembership,
  mockAccessCanUser,
  mockAccessHasPermission,
  mockIssueCreate,
  mockIssueGetById,
  mockIssueUpdate,
  mockIssueCheckout,
  mockIssueAddComment,
  mockIssueFindMentionedAgents,
  mockIssueFindMentionedProjectIds,
  mockIssueGetAncestors,
  mockIssueListInternalWorkItems,
  mockIssueGetInternalWorkItemSummary,
  mockIssueCreateInternalWorkItem,
  mockIssueRemove,
  mockIssueListLabels,
  mockIssueCreateLabel,
  mockHeartbeatWakeup,
  mockHeartbeatGetRun,
  mockHeartbeatCancelIssueScope,
  mockHeartbeatCancelSupersededIssueFollowups,
  mockAgentGetById,
  mockAgentList,
  mockResolvePmIntakeAgents,
  mockDerivePmIntakeIssueTitle,
  mockBuildPmIntakeIssueDescription,
  mockBuildPmIntakeAssignment,
  mockProjectGetById,
  mockProtocolGetState,
  mockProtocolListMessages,
  mockProtocolAppendMessage,
  mockProtocolCreateViolation,
  mockProtocolDispatchMessage,
  mockIssueRetrievalHandleProtocolMessage,
  mockOrgMemoryBackfillCompany,
  mockOrgMemoryIngestIssueSnapshot,
  mockOrgMemoryIngestProtocolMessage,
  mockRetrievalPersonalizationRecordProtocolFeedback,
  mockRetrievalPersonalizationRecordManualFeedback,
  mockRetrievalPersonalizationRecordMergeCandidateOutcomeFeedback,
  mockRetrievalPersonalizationSummarizeIssueFeedback,
  mockMergeCandidateGetByIssueId,
  mockMergeCandidateUpsertDecision,
  mockMergeCandidatePatchAutomationMetadata,
  mockMergeCandidateDeleteByIssueId,
  mockBuildMergeAutomationPlan,
  mockRunMergeAutomationAction,
  mockRunWithoutDbContext,
  mockLogActivity,
  mockKnowledgeListTaskBriefs,
  mockSummarizeIssueFailureLearning,
} = vi.hoisted(() => ({
  mockEnqueueAfterDbCommit: vi.fn(),
  mockEnsureMembership: vi.fn(),
  mockAccessCanUser: vi.fn(),
  mockAccessHasPermission: vi.fn(),
  mockIssueCreate: vi.fn(),
  mockIssueGetById: vi.fn(),
  mockIssueUpdate: vi.fn(),
  mockIssueCheckout: vi.fn(),
  mockIssueAddComment: vi.fn(),
  mockIssueFindMentionedAgents: vi.fn(),
  mockIssueFindMentionedProjectIds: vi.fn(),
  mockIssueGetAncestors: vi.fn(),
  mockIssueListInternalWorkItems: vi.fn(),
  mockIssueGetInternalWorkItemSummary: vi.fn(),
  mockIssueCreateInternalWorkItem: vi.fn(),
  mockIssueRemove: vi.fn(),
  mockIssueListLabels: vi.fn(),
  mockIssueCreateLabel: vi.fn(),
  mockHeartbeatWakeup: vi.fn(),
  mockHeartbeatGetRun: vi.fn(),
  mockHeartbeatCancelIssueScope: vi.fn(),
  mockHeartbeatCancelSupersededIssueFollowups: vi.fn(),
  mockAgentGetById: vi.fn(),
  mockAgentList: vi.fn(),
  mockResolvePmIntakeAgents: vi.fn(),
  mockDerivePmIntakeIssueTitle: vi.fn(),
  mockBuildPmIntakeIssueDescription: vi.fn(),
  mockBuildPmIntakeAssignment: vi.fn(),
  mockProjectGetById: vi.fn(),
  mockProtocolGetState: vi.fn(),
  mockProtocolListMessages: vi.fn(),
  mockProtocolAppendMessage: vi.fn(),
  mockProtocolCreateViolation: vi.fn(),
  mockProtocolDispatchMessage: vi.fn(),
  mockIssueRetrievalHandleProtocolMessage: vi.fn(),
  mockOrgMemoryBackfillCompany: vi.fn(),
  mockOrgMemoryIngestIssueSnapshot: vi.fn(),
  mockOrgMemoryIngestProtocolMessage: vi.fn(),
  mockRetrievalPersonalizationRecordProtocolFeedback: vi.fn(),
  mockRetrievalPersonalizationRecordManualFeedback: vi.fn(),
  mockRetrievalPersonalizationRecordMergeCandidateOutcomeFeedback: vi.fn(),
  mockRetrievalPersonalizationSummarizeIssueFeedback: vi.fn(),
  mockMergeCandidateGetByIssueId: vi.fn(),
  mockMergeCandidateUpsertDecision: vi.fn(),
  mockMergeCandidatePatchAutomationMetadata: vi.fn(),
  mockMergeCandidateDeleteByIssueId: vi.fn(),
  mockBuildMergeAutomationPlan: vi.fn(),
  mockRunMergeAutomationAction: vi.fn(),
  mockRunWithoutDbContext: vi.fn(),
  mockLogActivity: vi.fn(),
  mockKnowledgeListTaskBriefs: vi.fn(),
  mockSummarizeIssueFailureLearning: vi.fn(),
}));

vi.mock("@squadrail/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@squadrail/db")>();
  return {
    ...actual,
    enqueueAfterDbCommit: mockEnqueueAfterDbCommit,
    runWithoutDbContext: mockRunWithoutDbContext,
  };
});

vi.mock("../services/index.js", () => ({
  accessService: () => ({
    ensureMembership: mockEnsureMembership,
    canUser: mockAccessCanUser,
    hasPermission: mockAccessHasPermission,
  }),
  agentService: () => ({
    getById: mockAgentGetById,
    list: mockAgentList,
  }),
  goalService: () => ({
    listForIssue: vi.fn(),
    getById: vi.fn(),
  }),
  heartbeatService: () => ({
    wakeup: mockHeartbeatWakeup,
    getRun: mockHeartbeatGetRun,
    cancelIssueScope: mockHeartbeatCancelIssueScope,
    cancelSupersededIssueFollowups: mockHeartbeatCancelSupersededIssueFollowups,
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
  organizationalMemoryService: () => ({
    ingestIssueSnapshot: mockOrgMemoryIngestIssueSnapshot,
    ingestProtocolMessage: mockOrgMemoryIngestProtocolMessage,
    backfillCompany: mockOrgMemoryBackfillCompany,
  }),
  resolvePmIntakeAgents: mockResolvePmIntakeAgents,
  derivePmIntakeIssueTitle: mockDerivePmIntakeIssueTitle,
  buildPmIntakeIssueDescription: mockBuildPmIntakeIssueDescription,
  buildPmIntakeAssignment: mockBuildPmIntakeAssignment,
  retrievalPersonalizationService: () => ({
    recordProtocolFeedback: mockRetrievalPersonalizationRecordProtocolFeedback,
    recordManualFeedback: mockRetrievalPersonalizationRecordManualFeedback,
    recordMergeCandidateOutcomeFeedback: mockRetrievalPersonalizationRecordMergeCandidateOutcomeFeedback,
    summarizeIssueFeedback: mockRetrievalPersonalizationSummarizeIssueFeedback,
    loadProfile: vi.fn(),
    backfillProtocolFeedback: vi.fn(),
  }),
  issueProtocolService: () => ({
    getState: mockProtocolGetState,
    listMessages: mockProtocolListMessages,
    listViolations: vi.fn(),
    listReviewCycles: vi.fn(),
    appendMessage: mockProtocolAppendMessage,
    createViolation: mockProtocolCreateViolation,
  }),
  issueMergeCandidateService: () => ({
    getByIssueId: mockMergeCandidateGetByIssueId,
    upsertDecision: mockMergeCandidateUpsertDecision,
    patchAutomationMetadata: mockMergeCandidatePatchAutomationMetadata,
    deleteByIssueId: mockMergeCandidateDeleteByIssueId,
  }),
  issueService: () => ({
    create: mockIssueCreate,
    getById: mockIssueGetById,
    update: mockIssueUpdate,
    checkout: mockIssueCheckout,
    addComment: mockIssueAddComment,
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
    listLabels: mockIssueListLabels,
    createLabel: mockIssueCreateLabel,
    remove: mockIssueRemove,
    release: vi.fn(),
    getProtocolState: vi.fn(),
  }),
  knowledgeService: () => ({
    upsertDocument: vi.fn(),
    listTaskBriefs: mockKnowledgeListTaskBriefs,
  }),
  projectService: () => ({
    list: vi.fn(),
    getById: mockProjectGetById,
    listByIds: vi.fn(),
  }),
  buildMergeAutomationPlan: mockBuildMergeAutomationPlan,
  runMergeAutomationAction: mockRunMergeAutomationAction,
  logActivity: mockLogActivity,
}));

vi.mock("../services/issue-merge-candidates.js", () => ({
  issueMergeCandidateService: () => ({
    getByIssueId: mockMergeCandidateGetByIssueId,
    upsertDecision: mockMergeCandidateUpsertDecision,
    patchAutomationMetadata: mockMergeCandidatePatchAutomationMetadata,
    deleteByIssueId: mockMergeCandidateDeleteByIssueId,
  }),
}));

vi.mock("../services/failure-learning.js", () => ({
  summarizeIssueFailureLearning: mockSummarizeIssueFailureLearning,
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
  headers?: Record<string, string>;
}) {
  const router = createTestRouter();
  const handlers = findRouteLayer(router, input.path, input.method);
  const req = {
    params: input.params ?? {},
    body: input.body ?? {},
    query: {},
    actor: input.actor ?? buildBoardActor(),
    header(name: string) {
      const headers = input.headers ?? {};
      const matched = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
      return matched?.[1];
    },
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
    mockEnqueueAfterDbCommit.mockReturnValue(false);
    mockRunWithoutDbContext.mockImplementation((fn: () => unknown) => fn());
    mockEnsureMembership.mockResolvedValue(true);
    mockAccessCanUser.mockResolvedValue(true);
    mockAccessHasPermission.mockResolvedValue(true);
    mockIssueFindMentionedAgents.mockResolvedValue([]);
    mockIssueFindMentionedProjectIds.mockResolvedValue([]);
    mockIssueAddComment.mockResolvedValue({
      id: "comment-1",
      companyId: "company-1",
      issueId: "11111111-1111-4111-8111-111111111111",
      body: "comment",
      createdAt: new Date("2026-03-11T00:00:00.000Z"),
      updatedAt: new Date("2026-03-11T00:00:00.000Z"),
    });
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
    mockAgentList.mockResolvedValue([]);
    mockHeartbeatGetRun.mockResolvedValue(null);
    mockHeartbeatCancelIssueScope.mockResolvedValue({
      cancelledWakeupCount: 0,
      cancelledRunCount: 0,
    });
    mockProtocolGetState.mockResolvedValue(null);
    mockProtocolListMessages.mockResolvedValue([]);
    mockProtocolAppendMessage.mockResolvedValue({
      message: { id: "protocol-message-1", seq: 1 },
      state: {},
    });
    mockProjectGetById.mockResolvedValue({
      id: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
      companyId: "company-1",
      name: "swiftsight-agent",
    });
    mockProjectGetById.mockResolvedValue(null);
    mockProtocolCreateViolation.mockResolvedValue({
      id: "violation-1",
      companyId: "company-1",
      issueId: "11111111-1111-4111-8111-111111111111",
      violationCode: "payload_schema_mismatch",
    });
    mockProtocolDispatchMessage.mockResolvedValue(undefined);
    mockIssueRetrievalHandleProtocolMessage.mockResolvedValue({ recipientHints: [] });
    mockIssueListLabels.mockResolvedValue([]);
    mockIssueCreateLabel.mockImplementation(async (_companyId: string, input: { name: string; color: string }) => ({
      id: `${input.name}-id`,
      companyId: "company-1",
      name: input.name,
      color: input.color,
    }));
    mockResolvePmIntakeAgents.mockImplementation(() => ({
      pmAgent: {
        id: "pm-1",
        companyId: "company-1",
        name: "SwiftSight PM",
        role: "pm",
        status: "active",
        reportsTo: null,
        title: "PM",
      },
      reviewerAgent: {
        id: "qa-1",
        companyId: "company-1",
        name: "QA Lead",
        role: "qa",
        status: "active",
        reportsTo: null,
        title: "QA Lead",
      },
    }));
    mockDerivePmIntakeIssueTitle.mockImplementation(({ request }: { request: string }) => request);
    mockBuildPmIntakeIssueDescription.mockImplementation(({ request }: { request: string }) => request);
    mockBuildPmIntakeAssignment.mockImplementation((input: any) => ({
      summary: `PM intake: structure and route "${input.title}"`,
      payload: {
        goal: input.title,
        acceptanceCriteria: ["Clarify scope"],
        definitionOfDone: ["Route to TL"],
        priority: input.priority,
        assigneeAgentId: input.pmAgentId,
        reviewerAgentId: input.reviewerAgentId,
        deadlineAt: input.requestedDueAt ?? null,
        relatedIssueIds: input.relatedIssueIds,
        requiredKnowledgeTags: input.requiredKnowledgeTags,
      },
    }));
    mockOrgMemoryIngestIssueSnapshot.mockResolvedValue({
      issueId: "11111111-1111-4111-8111-111111111111",
      sourceType: "issue",
    });
    mockOrgMemoryIngestProtocolMessage.mockResolvedValue({
      messageId: "protocol-message-1",
      issueId: "11111111-1111-4111-8111-111111111111",
      sourceType: "protocol_message",
    });
    mockOrgMemoryBackfillCompany.mockResolvedValue({
      companyId: "company-1",
      issueScannedCount: 0,
      issueDocumentCount: 0,
      protocolScannedCount: 0,
      protocolDocumentCount: 0,
      reviewDocumentCount: 0,
    });
    mockRetrievalPersonalizationRecordProtocolFeedback.mockResolvedValue({
      ok: true,
      feedbackEventCount: 0,
      profiledRunCount: 0,
      retrievalRunIds: [],
    });
    mockRetrievalPersonalizationRecordManualFeedback.mockResolvedValue({
      ok: true,
      feedbackEventCount: 2,
      profiledRunCount: 1,
      retrievalRunIds: ["retrieval-run-1"],
    });
    mockRetrievalPersonalizationRecordMergeCandidateOutcomeFeedback.mockResolvedValue({
      ok: true,
      feedbackEventCount: 6,
      profiledRunCount: 2,
      retrievalRunIds: ["retrieval-run-1", "retrieval-run-2"],
    });
    mockRetrievalPersonalizationSummarizeIssueFeedback.mockResolvedValue({
      positiveCount: 0,
      negativeCount: 0,
      pinnedPathCount: 0,
      hiddenPathCount: 0,
      lastFeedbackAt: null,
      feedbackTypeCounts: {},
    });
    mockKnowledgeListTaskBriefs.mockResolvedValue([]);
    mockSummarizeIssueFailureLearning.mockResolvedValue({
      closeReady: true,
      retryability: "clean",
      failureFamily: null,
      blockingReasons: [],
      summary: "No unresolved repeated runtime failure signal is blocking close.",
      suggestedActions: [],
      repeatedFailureCount24h: 0,
      lastSeenAt: null,
    });
    mockProjectGetById.mockResolvedValue(null);
    mockMergeCandidateGetByIssueId.mockResolvedValue(null);
    mockMergeCandidateUpsertDecision.mockResolvedValue(null);
    mockMergeCandidatePatchAutomationMetadata.mockResolvedValue(null);
    mockMergeCandidateDeleteByIssueId.mockResolvedValue(null);
    mockBuildMergeAutomationPlan.mockResolvedValue({
      issueId: "11111111-1111-4111-8111-111111111111",
      identifier: "CLO-000",
      title: "Plan",
      candidateState: "pending",
      projectId: "project-1",
      projectName: "Project",
      sourceBranch: "squadrail/test",
      sourceHeadSha: "abc123",
      sourceWorkspacePath: "/tmp/source",
      sourceHeadCurrent: "abc123",
      baseWorkspaceId: "workspace-1",
      baseWorkspaceName: "Base",
      baseWorkspacePath: "/tmp/base",
      targetBaseBranch: "main",
      targetStartRef: "main",
      integrationBranchName: "squadrail/merge/clo-000",
      automationWorktreePath: "/tmp/merge-worktree",
      remoteName: "origin",
      remoteUrl: "git@example.com:repo.git",
      checks: {
        hasPendingCandidate: true,
        hasProject: true,
        hasBaseWorkspace: true,
        baseWorkspaceIsGit: true,
        hasSourceWorkspace: true,
        sourceWorkspaceIsGit: true,
        hasSourceBranch: true,
        sourceHeadMatches: true,
        hasTargetBaseBranch: true,
        hasRemote: true,
      },
      warnings: [],
      canAutomate: true,
      automationMetadata: {},
    });
    mockRunMergeAutomationAction.mockResolvedValue({
      actionType: "prepare_merge",
      ok: true,
      plan: {
        issueId: "11111111-1111-4111-8111-111111111111",
      },
      automationMetadataPatch: {
        lastAutomationAction: "prepare_merge",
      },
    });
  });

  it("dispatches async agent protocol messages immediately when no db context is active", async () => {
    mockIssueGetById.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
      identifier: "CLO-250",
      title: "Async reassignment issue",
      description: null,
      projectId: null,
      labels: [],
    });
    mockAgentGetById.mockResolvedValue({
      id: "lead-1",
      companyId: "company-1",
      role: "engineer",
      title: "Tech Lead",
      permissions: {},
    });
    mockIssueRetrievalHandleProtocolMessage.mockResolvedValue({
      recipientHints: [
        {
          recipientId: "22222222-2222-4222-8222-222222222222",
          recipientRole: "engineer",
          retrievalRunId: "retrieval-run-1",
          briefId: "brief-1",
          briefScope: "engineer",
        },
      ],
    });

    const response = await invokeRoute({
      path: "/issues/:id/protocol/messages",
      method: "post",
      params: { id: "11111111-1111-4111-8111-111111111111" },
      actor: {
        ...buildAgentActor("lead-1"),
        runId: "run-async-1",
      },
      headers: {
        "x-squadrail-dispatch-mode": "async",
      },
      body: {
        messageType: "REASSIGN_TASK",
        sender: {
          actorType: "agent",
          actorId: "lead-1",
          role: "tech_lead",
        },
        recipients: [
          { recipientType: "agent", recipientId: "22222222-2222-4222-8222-222222222222", role: "engineer" },
          { recipientType: "agent", recipientId: "33333333-3333-4333-8333-333333333333", role: "reviewer" },
        ],
        workflowStateBefore: "assigned",
        workflowStateAfter: "assigned",
        summary: "Route work to engineer",
        payload: {
          reason: "Tech lead staffing handoff",
          newAssigneeAgentId: "22222222-2222-4222-8222-222222222222",
          newReviewerAgentId: "33333333-3333-4333-8333-333333333333",
        },
        artifacts: [],
      },
    });

    expect(response.statusCode).toBe(201);
    expect(mockEnqueueAfterDbCommit).toHaveBeenCalledTimes(2);
    expect(mockRunWithoutDbContext).toHaveBeenCalledTimes(2);
    expect(mockIssueRetrievalHandleProtocolMessage).toHaveBeenCalledTimes(1);
    expect(mockProtocolDispatchMessage).toHaveBeenCalledTimes(1);
  });

  it("defers async agent protocol dispatch until after db commit when a context callback is available", async () => {
    let queuedCallback: (() => void) | null = null;
    mockEnqueueAfterDbCommit.mockImplementation((callback: () => void) => {
      queuedCallback = callback;
      return true;
    });
    mockIssueGetById.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
      identifier: "CLO-251",
      title: "Deferred async protocol issue",
      description: null,
      projectId: null,
      labels: [],
    });
    mockAgentGetById.mockResolvedValue({
      id: "lead-1",
      companyId: "company-1",
      role: "engineer",
      title: "Tech Lead",
      permissions: {},
    });

    const response = await invokeRoute({
      path: "/issues/:id/protocol/messages",
      method: "post",
      params: { id: "11111111-1111-4111-8111-111111111111" },
      actor: {
        ...buildAgentActor("lead-1"),
        runId: "run-async-2",
      },
      headers: {
        "x-squadrail-dispatch-mode": "async",
      },
      body: {
        messageType: "ACK_ASSIGNMENT",
        sender: {
          actorType: "agent",
          actorId: "lead-1",
          role: "tech_lead",
        },
        recipients: [
          { recipientType: "agent", recipientId: "lead-1", role: "tech_lead" },
        ],
        workflowStateBefore: "assigned",
        workflowStateAfter: "accepted",
        summary: "Acknowledged",
        payload: {
          accepted: true,
          understoodScope: "Will staff the issue",
          initialRisks: [],
        },
        artifacts: [],
      },
    });

    expect(response.statusCode).toBe(201);
    expect(mockEnqueueAfterDbCommit).toHaveBeenCalledTimes(2);
    expect(mockProtocolDispatchMessage).not.toHaveBeenCalled();
    expect(mockRunWithoutDbContext).not.toHaveBeenCalled();

    expect(queuedCallback).not.toBeNull();
    await queuedCallback?.();

    expect(mockRunWithoutDbContext).toHaveBeenCalledTimes(1);
    expect(mockProtocolDispatchMessage).toHaveBeenCalledTimes(1);
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

    expect(response.statusCode, JSON.stringify(response.body)).toBe(201);
    expect(mockHeartbeatWakeup).toHaveBeenCalledWith(
      "22222222-2222-4222-8222-222222222222",
      expect.objectContaining({
        reason: "issue_assigned",
        payload: { issueId: "11111111-1111-4111-8111-111111111111", mutation: "create" },
      }),
    );
    expect(wakeResolved).toBe(true);
  });

  it("ingests organizational memory after issue create", async () => {
    mockIssueCreate.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
      identifier: "CLO-101",
      title: "Create test issue",
      status: "todo",
      assigneeAgentId: null,
    });
    mockOrgMemoryIngestIssueSnapshot.mockResolvedValue({
      issueId: "11111111-1111-4111-8111-111111111111",
      sourceType: "issue",
    });

    const response = await invokeRoute({
      path: "/companies/:companyId/issues",
      method: "post",
      params: { companyId: "company-1" },
      body: {
        title: "Create test issue",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(mockEnqueueAfterDbCommit).toHaveBeenCalledTimes(1);
    expect(mockRunWithoutDbContext).toHaveBeenCalledTimes(1);
    expect(mockOrgMemoryIngestIssueSnapshot).toHaveBeenCalledWith({
      issueId: "11111111-1111-4111-8111-111111111111",
      mutation: "create",
    });
  });

  it("upgrades an assignee wakeup to issue_comment_mentioned when the assignee is explicitly mentioned", async () => {
    mockIssueGetById.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
      identifier: "CLO-182",
      title: "Recovery issue",
      status: "in_progress",
      assigneeAgentId: "22222222-2222-4222-8222-222222222222",
      executionRunId: null,
    });
    mockIssueFindMentionedAgents.mockResolvedValue(["22222222-2222-4222-8222-222222222222"]);
    mockProtocolGetState.mockResolvedValue({
      workflowState: "implementing",
      reviewerAgentId: "rev-1",
      qaAgentId: "qa-1",
    });

    const response = await invokeRoute({
      path: "/issues/:id/comments",
      method: "post",
      params: { id: "11111111-1111-4111-8111-111111111111" },
      body: {
        body: "@swiftcl-codex-engineer please recover and resubmit",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(mockHeartbeatWakeup).toHaveBeenCalledWith(
      "22222222-2222-4222-8222-222222222222",
      expect.objectContaining({
        reason: "issue_comment_mentioned",
        payload: expect.objectContaining({
          issueId: "11111111-1111-4111-8111-111111111111",
          commentId: "comment-1",
        }),
        contextSnapshot: expect.objectContaining({
          issueId: "11111111-1111-4111-8111-111111111111",
          wakeReason: "issue_comment_mentioned",
          source: "comment.mention",
          protocolRecipientRole: "engineer",
          protocolWorkflowStateAfter: "implementing",
        }),
      }),
    );
  });

  it("adds implementation protocol context when an update comment mentions the assignee during changes_requested", async () => {
    mockIssueGetById.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
      identifier: "CLO-183",
      title: "Recovery issue via patch",
      description: "Existing issue",
      status: "in_progress",
      assigneeAgentId: "22222222-2222-4222-8222-222222222222",
      assigneeUserId: null,
      createdByUserId: "user-1",
    });
    mockIssueUpdate.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
      identifier: "CLO-183",
      title: "Recovery issue via patch",
      description: "Existing issue",
      status: "in_progress",
      assigneeAgentId: "22222222-2222-4222-8222-222222222222",
      assigneeUserId: null,
    });
    mockIssueAddComment.mockResolvedValue({
      id: "comment-1",
      body: "@swiftcl-codex-engineer please retry review submission",
    });
    mockIssueFindMentionedAgents.mockResolvedValue(["22222222-2222-4222-8222-222222222222"]);
    mockProtocolGetState.mockResolvedValue({
      workflowState: "changes_requested",
      reviewerAgentId: "rev-1",
      qaAgentId: "qa-1",
    });

    const response = await invokeRoute({
      path: "/issues/:id",
      method: "patch",
      params: { id: "11111111-1111-4111-8111-111111111111" },
      body: {
        comment: "@swiftcl-codex-engineer please retry review submission",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(mockHeartbeatWakeup).toHaveBeenCalledWith(
      "22222222-2222-4222-8222-222222222222",
      expect.objectContaining({
        reason: "issue_comment_mentioned",
        contextSnapshot: expect.objectContaining({
          issueId: "11111111-1111-4111-8111-111111111111",
          protocolRecipientRole: "engineer",
          protocolWorkflowStateAfter: "changes_requested",
          wakeReason: "issue_comment_mentioned",
        }),
      }),
    );
  });

  it("creates a PM intake issue and assigns it into the PM lane", async () => {
    mockAgentList.mockResolvedValue([
      {
        id: "pm-1",
        companyId: "company-1",
        name: "SwiftSight PM",
        role: "pm",
        status: "active",
        reportsTo: null,
        title: "PM",
      },
      {
        id: "qa-1",
        companyId: "company-1",
        name: "QA Lead",
        role: "qa",
        status: "active",
        reportsTo: null,
        title: "QA Lead",
      },
    ]);
    mockIssueCreate.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
      identifier: "CLO-150",
      title: "Build a bulk export flow",
      description: "## Human Intake Request",
      projectId: null,
      status: "backlog",
      priority: "high",
      assigneeAgentId: "pm-1",
      assigneeUserId: null,
      labels: [
        { id: "workflow:intake-id", name: "workflow:intake", color: "#2563EB" },
        { id: "lane:pm-id", name: "lane:pm", color: "#0F766E" },
        { id: "source:human_request-id", name: "source:human_request", color: "#7C3AED" },
      ],
    });
    mockIssueGetById.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
      identifier: "CLO-150",
      title: "Build a bulk export flow",
      description: "## Human Intake Request",
      projectId: null,
      status: "backlog",
      priority: "high",
      assigneeAgentId: "pm-1",
      assigneeUserId: null,
      labels: [
        { id: "workflow:intake-id", name: "workflow:intake", color: "#2563EB" },
        { id: "lane:pm-id", name: "lane:pm", color: "#0F766E" },
        { id: "source:human_request-id", name: "source:human_request", color: "#7C3AED" },
      ],
    });

    const response = await invokeRoute({
      path: "/companies/:companyId/intake/issues",
      method: "post",
      params: { companyId: "company-1" },
      body: {
        request: "Build a bulk export flow for cloud studies with audit logs.",
        priority: "high",
        requiredKnowledgeTags: ["cloud", "export"],
      },
    });

    expect(response.statusCode, JSON.stringify(response.body)).toBe(201);
    expect(mockIssueCreate).toHaveBeenCalledWith(
      "company-1",
      expect.objectContaining({
        title: "Build a bulk export flow for cloud studies with audit logs.",
        assigneeAgentId: "pm-1",
        labelIds: expect.arrayContaining([
          "workflow:intake-id",
          "lane:pm-id",
          "source:human_request-id",
        ]),
      }),
    );
    expect(mockProtocolAppendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        issueId: "11111111-1111-4111-8111-111111111111",
        message: expect.objectContaining({
          messageType: "ASSIGN_TASK",
          recipients: expect.arrayContaining([
            expect.objectContaining({ recipientId: "pm-1", role: "pm" }),
            expect.objectContaining({ recipientId: "qa-1", role: "reviewer" }),
          ]),
        }),
      }),
    );
    expect(mockRunWithoutDbContext).toHaveBeenCalledTimes(3);
  });

  it("rejects PM intake when no active PM is available", async () => {
    mockAgentList.mockResolvedValue([
      {
        id: "qa-1",
        companyId: "company-1",
        name: "QA Lead",
        role: "qa",
        status: "active",
        reportsTo: null,
        title: "QA Lead",
      },
    ]);
    mockResolvePmIntakeAgents.mockImplementation(() => {
      const error = new Error("No active PM agent is available for intake routing") as Error & { status?: number };
      error.status = 409;
      throw error;
    });

    const response = await invokeRoute({
      path: "/companies/:companyId/intake/issues",
      method: "post",
      params: { companyId: "company-1" },
      body: {
        request: "Build a bulk export flow for cloud studies with audit logs.",
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.body).toEqual({
      error: "No active PM agent is available for intake routing",
    });
  });

  it("projects a PM intake issue into a TL lane with child work items and QA gate ownership", async () => {
    mockIssueGetById
      .mockResolvedValueOnce({
        id: "11111111-1111-4111-8111-111111111111",
        companyId: "company-1",
        identifier: "CLO-151",
        title: "Human intake issue",
        description: "## Human Intake Request",
        projectId: null,
        status: "todo",
        priority: "high",
        parentId: null,
        hiddenAt: null,
        labels: [],
      })
      .mockResolvedValueOnce({
        id: "33333333-3333-4333-8333-333333333333",
        companyId: "company-1",
        identifier: "CLO-152",
        title: "Design cloud export flow",
        description: "Projected child work item",
        projectId: null,
        goalId: null,
        status: "todo",
        priority: "high",
        assigneeAgentId: "eng-1",
        hiddenAt: new Date().toISOString(),
        labels: [],
      });
    mockIssueUpdate.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
      identifier: "CLO-151",
      title: "Cloud export intake",
      description: "## Intake Structuring Snapshot",
      projectId: null,
      status: "todo",
      priority: "high",
      parentId: null,
      hiddenAt: null,
      labels: [],
    });
    mockIssueCreateInternalWorkItem.mockResolvedValue({
      id: "33333333-3333-4333-8333-333333333333",
      companyId: "company-1",
      identifier: "CLO-152",
      title: "Design cloud export flow",
      description: "Projected child work item",
      projectId: null,
      goalId: null,
      status: "backlog",
      priority: "high",
      assigneeAgentId: "eng-1",
      hiddenAt: new Date().toISOString(),
      labels: [],
    });
    mockProtocolGetState.mockResolvedValue({
      issueId: "11111111-1111-4111-8111-111111111111",
      workflowState: "assigned",
      techLeadAgentId: "pm-1",
      reviewerAgentId: "qa-lead-1",
      qaAgentId: null,
    });
    mockAgentGetById.mockImplementation(async (agentId: string) => {
      if (agentId === "pm-1") {
        return {
          id: agentId,
          companyId: "company-1",
          role: "pm",
          status: "active",
          title: "PM",
          permissions: {},
        };
      }
      if (agentId === "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa") {
        return {
          id: agentId,
          companyId: "company-1",
          role: "manager",
          status: "active",
          title: "Tech Lead",
          permissions: {},
        };
      }
      if (agentId === "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb") {
        return {
          id: agentId,
          companyId: "company-1",
          role: "reviewer",
          status: "active",
          title: "Reviewer",
          permissions: {},
        };
      }
      if (agentId === "cccccccc-cccc-4ccc-8ccc-cccccccccccc") {
        return {
          id: agentId,
          companyId: "company-1",
          role: "qa",
          status: "active",
          title: "QA Engineer",
          permissions: {},
        };
      }
      if (agentId === "dddddddd-dddd-4ddd-8ddd-dddddddddddd") {
        return {
          id: agentId,
          companyId: "company-1",
          role: "engineer",
          status: "active",
          title: "Engineer",
          permissions: {},
        };
      }
      return null;
    });
    mockProtocolAppendMessage.mockResolvedValue({
      message: { id: "protocol-message-1", seq: 1 },
      state: { workflowState: "assigned" },
    });
    mockProjectGetById.mockImplementation(async (projectId: string) => {
      if (projectId === "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb") {
        return {
          id: projectId,
          companyId: "company-1",
          name: "swiftsight-cloud",
        };
      }
      if (projectId === "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa") {
        return {
          id: projectId,
          companyId: "company-1",
          name: "swiftsight-agent",
        };
      }
      return null;
    });

    const response = await invokeRoute({
      path: "/issues/:id/intake/projection",
      method: "post",
      params: { id: "11111111-1111-4111-8111-111111111111" },
      actor: buildAgentActor("pm-1"),
      body: {
        reason: "Structure the intake and route execution into the cloud TL lane.",
        techLeadAgentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        reviewerAgentId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        qaAgentId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        root: {
          structuredTitle: "Cloud export intake",
          projectId: "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb",
          executionSummary: "Build a scoped export delivery plan for cloud studies and audit logs.",
          acceptanceCriteria: ["Scope is explicit", "Audit trail is covered"],
          definitionOfDone: ["TL lane owns the work", "Child execution item exists"],
        },
        workItems: [
          {
            title: "Design cloud export flow",
            kind: "plan",
            projectId: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
            priority: "high",
            assigneeAgentId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            reviewerAgentId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            qaAgentId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            acceptanceCriteria: ["Design covers audit trail"],
            definitionOfDone: ["Plan is ready for implementation"],
          },
        ],
      },
    });

    expect(response.statusCode, JSON.stringify(response.body)).toBe(201);
    expect(mockIssueUpdate).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      expect.objectContaining({
        title: "Cloud export intake",
        projectId: "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb",
        priority: "high",
      }),
    );
    expect(mockIssueCreateInternalWorkItem).toHaveBeenCalledWith(
      expect.objectContaining({
        parentIssueId: "11111111-1111-4111-8111-111111111111",
        projectId: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
      }),
    );
    expect(mockProtocolAppendMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        issueId: "11111111-1111-4111-8111-111111111111",
        message: expect.objectContaining({
          messageType: "REASSIGN_TASK",
          payload: expect.objectContaining({
            newAssigneeAgentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            newReviewerAgentId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            newQaAgentId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          }),
        }),
      }),
    );
    expect(mockProtocolAppendMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        issueId: "33333333-3333-4333-8333-333333333333",
        message: expect.objectContaining({
          messageType: "ASSIGN_TASK",
          payload: expect.objectContaining({
            assigneeAgentId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            reviewerAgentId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            qaAgentId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          }),
        }),
      }),
    );
    expect(response.body).toEqual(
      expect.objectContaining({
        projectedWorkItems: [
          expect.objectContaining({
            id: "33333333-3333-4333-8333-333333333333",
          }),
        ],
        intakeProjection: {
          techLeadAgentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          reviewerAgentId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          qaAgentId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          coordinationOnly: false,
        },
      }),
    );
  });

  it("projects coordinated intake issues without reassigning the root execution lane", async () => {
    mockAgentGetById.mockImplementation(async (agentId: string) => {
      if (agentId === "pm-1") {
        return {
          id: agentId,
          companyId: "company-1",
          role: "pm",
          status: "active",
          title: "PM",
          permissions: {},
        };
      }
      if (agentId === "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa") {
        return {
          id: agentId,
          companyId: "company-1",
          role: "manager",
          status: "active",
          title: "Tech Lead",
          permissions: {},
        };
      }
      if (agentId === "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb") {
        return {
          id: agentId,
          companyId: "company-1",
          role: "reviewer",
          status: "active",
          title: "Reviewer",
          permissions: {},
        };
      }
      if (agentId === "dddddddd-dddd-4ddd-8ddd-dddddddddddd") {
        return {
          id: agentId,
          companyId: "company-1",
          role: "engineer",
          status: "active",
          title: "Engineer",
          permissions: {},
        };
      }
      return null;
    });
    mockIssueGetById.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
      identifier: "CLO-300",
      title: "Coordinated intake root",
      description: "Human request",
      status: "todo",
      priority: "high",
      projectId: null,
      parentId: null,
      hiddenAt: null,
      goalId: null,
      assigneeAgentId: null,
      assigneeUserId: null,
      createdByAgentId: null,
      createdByUserId: "board-user",
      requestDepth: 0,
      checkoutRunId: null,
      executionRunId: null,
      executionAgentNameKey: null,
      executionLockedAt: null,
      startedAt: null,
      completedAt: null,
      cancelledAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      labels: [],
      parent: null,
      children: [],
    });
    mockIssueUpdate.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
      identifier: "CLO-300",
      title: "Coordinated intake root",
      description: "Projected root",
      status: "todo",
      priority: "high",
      projectId: null,
    });
    mockProtocolGetState.mockResolvedValue({
      workflowState: "assigned",
      techLeadAgentId: null,
      reviewerAgentId: null,
      qaAgentId: null,
    });
    mockProjectGetById.mockResolvedValue(null);
    mockIssueCreateInternalWorkItem.mockResolvedValue({
      id: "33333333-3333-4333-8333-333333333333",
      identifier: "CLO-301",
      title: "Child work item",
      status: "backlog",
      priority: "high",
      projectId: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
    });
    mockProtocolAppendMessage.mockResolvedValue({
      message: { id: "child-message-1", seq: 1 },
      state: { workflowState: "assigned" },
    });

    const response = await invokeRoute({
      path: "/issues/:id/intake/projection",
      method: "post",
      params: { id: "11111111-1111-4111-8111-111111111111" },
      actor: buildAgentActor("pm-1"),
      body: {
        reason: "Project the root into coordinated child work items only.",
        techLeadAgentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        reviewerAgentId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        coordinationOnly: true,
        root: {
          structuredTitle: "Coordinated intake root",
          projectId: null,
          executionSummary: "Coordinate child delivery only.",
          acceptanceCriteria: ["Child work items exist"],
          definitionOfDone: ["Children run independently"],
        },
        workItems: [
          {
            title: "Child work item",
            kind: "implementation",
            projectId: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
            priority: "high",
            watchLead: false,
            assigneeAgentId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            reviewerAgentId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            acceptanceCriteria: ["Scoped child work"],
            definitionOfDone: ["Child is ready"],
          },
        ],
      },
    });

    expect(response.statusCode, JSON.stringify(response.body)).toBe(201);
    expect(mockProtocolAppendMessage).toHaveBeenCalledTimes(1);
    expect(mockProtocolAppendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        issueId: "33333333-3333-4333-8333-333333333333",
        message: expect.objectContaining({
          messageType: "ASSIGN_TASK",
          recipients: [
            expect.objectContaining({
              recipientId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
              role: "engineer",
            }),
            expect.objectContaining({
              recipientId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
              role: "reviewer",
            }),
          ],
        }),
      }),
    );
    const childAssignmentCall = mockProtocolAppendMessage.mock.calls[0]?.[0];
    expect(
      childAssignmentCall?.message?.recipients?.some(
        (recipient: { recipientId: string; role: string }) =>
          recipient.recipientId === "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" && recipient.role === "tech_lead",
      ),
    ).toBe(false);
    expect(response.body).toEqual(
      expect.objectContaining({
        protocol: null,
        warnings: [],
        intakeProjection: {
          techLeadAgentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          reviewerAgentId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          qaAgentId: null,
          coordinationOnly: true,
        },
      }),
    );
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

  it("ingests organizational memory after issue update", async () => {
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
      status: "blocked",
      assigneeAgentId: null,
      assigneeUserId: null,
    });
    mockOrgMemoryIngestIssueSnapshot.mockResolvedValue({
      issueId: "11111111-1111-4111-8111-111111111111",
      sourceType: "issue",
    });

    const response = await invokeRoute({
      path: "/issues/:id",
      method: "patch",
      params: { id: "11111111-1111-4111-8111-111111111111" },
      body: { status: "blocked" },
    });

    expect(response.statusCode).toBe(200);
    expect(mockRunWithoutDbContext).toHaveBeenCalledTimes(1);
    expect(mockOrgMemoryIngestIssueSnapshot).toHaveBeenCalledWith({
      issueId: "11111111-1111-4111-8111-111111111111",
      mutation: "update",
    });
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
        projectId: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
        priority: "high",
        assigneeAgentId: "44444444-4444-4444-8444-444444444444",
        reviewerAgentId: "55555555-5555-4555-8555-555555555555",
        goal: "Stabilize the execution path",
        acceptanceCriteria: ["Assignment brief is generated"],
        definitionOfDone: ["Engineer receives the child work item"],
      },
    });

    expect(response.statusCode, JSON.stringify(response.body)).toBe(201);
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
        projectId: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
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

  it("allows supervisory agent protocol routing without board-level tasks:assign permission", async () => {
    mockAccessHasPermission.mockResolvedValue(false);
    mockIssueGetById.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
      identifier: "CLO-170",
      title: "PM-routed issue",
      description: null,
      projectId: null,
      labels: [],
      status: "todo",
      assigneeAgentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      assigneeUserId: null,
      createdByUserId: "user-1",
    });
    mockAgentGetById.mockResolvedValue({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      companyId: "company-1",
      role: "pm",
      status: "active",
      title: "PM",
    });
    mockProtocolAppendMessage.mockResolvedValue({
      message: { id: "protocol-message-2", seq: 2 },
      state: { workflowState: "assigned" },
    });

    const response = await invokeRoute({
      path: "/issues/:id/protocol/messages",
      method: "post",
      params: { id: "11111111-1111-4111-8111-111111111111" },
      actor: buildAgentActor("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
      body: {
        messageType: "REASSIGN_TASK",
        sender: {
          actorType: "agent",
          actorId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          role: "pm",
        },
        recipients: [
          {
            recipientType: "agent",
            recipientId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            role: "tech_lead",
          },
          {
            recipientType: "agent",
            recipientId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            role: "reviewer",
          },
        ],
        workflowStateBefore: "assigned",
        workflowStateAfter: "assigned",
        summary: "PM routes the issue into the project TL lane",
        requiresAck: false,
        payload: {
          reason: "Product scope is clarified and ready for TL staffing.",
          newAssigneeAgentId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          newReviewerAgentId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        },
        artifacts: [],
      },
    });

    expect(response.statusCode, JSON.stringify(response.body)).toBe(201);
    expect(mockProtocolAppendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        issueId: "11111111-1111-4111-8111-111111111111",
        message: expect.objectContaining({
          messageType: "REASSIGN_TASK",
          sender: expect.objectContaining({
            role: "pm",
          }),
        }),
      }),
    );
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
          acceptanceCriteria: ["Cloud TL owns staffing", "QA remains explicit reviewer"],
          definitionOfDone: ["Implementation delegated", "QA handoff preserved"],
          implementationGuidance: "Route to the project engineer before any repo inspection.",
          risks: ["Cross-project scope drift if reviewer is not preserved"],
        },
        artifacts: [],
      },
    });

    expect(response.statusCode, JSON.stringify(response.body)).toBe(201);
    expect(mockProtocolAppendMessage).toHaveBeenCalledTimes(1);
  });

  it("normalizes related issue aliases before validating and dispatching protocol messages", async () => {
    mockIssueGetById.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
      identifier: "CLO-202",
      title: "Protocol issue",
      description: null,
      projectId: "project-1",
      labels: [],
    });
    mockAgentGetById.mockResolvedValue({
      id: "rev-1",
      companyId: "company-1",
      role: "reviewer",
      title: "Reviewer",
      permissions: {},
    });

    const response = await invokeRoute({
      path: "/issues/:id/protocol/messages",
      method: "post",
      params: { id: "11111111-1111-4111-8111-111111111111" },
      actor: buildAgentActor("rev-1"),
      body: {
        messageType: "REQUEST_CHANGES",
        sender: {
          actorType: "agent",
          actorId: "rev-1",
          role: "reviewer",
        },
        recipients: [
          { recipientType: "agent", recipientId: "eng-1", role: "engineer" },
        ],
        workflowStateBefore: "under_review",
        workflowStateAfter: "changes_requested",
        summary: "Reuse the prior retry fixes",
        payload: {
          reviewSummary: "Reuse the prior retry fixes",
          changeRequests: [
            {
              title: "Preserve bounded retry logic",
              reason: "Recent retry regressions match earlier closure findings",
              affectedFiles: ["server/src/jobs/retry_worker.ts"],
            },
          ],
          severity: "high",
          mustFixBeforeApprove: true,
          requiredEvidence: ["pnpm vitest retry-worker"],
          relatedIssueIdentifiers: ["CLO-101", "CLO-102"],
          linkedIssueIds: [
            "22222222-2222-4222-8222-222222222222",
            "33333333-3333-4333-8333-333333333333",
          ],
          relatedIssueIds: [
            "11111111-1111-4111-8111-111111111111",
            "22222222-2222-4222-8222-222222222222",
          ],
        },
        artifacts: [],
      },
    });

    expect(response.statusCode, JSON.stringify(response.body)).toBe(201);

    const appendInput = mockProtocolAppendMessage.mock.calls[0]?.[0];
    expect(appendInput?.message.payload).toEqual(expect.objectContaining({
      relatedIssueIds: [
        "11111111-1111-4111-8111-111111111111",
        "22222222-2222-4222-8222-222222222222",
        "33333333-3333-4333-8333-333333333333",
      ],
      relatedIssueIdentifiers: ["CLO-101", "CLO-102"],
    }));
    expect(appendInput?.message.payload).not.toHaveProperty("linkedIssueIds");

    const retrievalInput = mockIssueRetrievalHandleProtocolMessage.mock.calls[0]?.[0];
    expect(retrievalInput?.message.payload).toEqual(expect.objectContaining({
      relatedIssueIds: [
        "11111111-1111-4111-8111-111111111111",
        "22222222-2222-4222-8222-222222222222",
        "33333333-3333-4333-8333-333333333333",
      ],
      relatedIssueIdentifiers: ["CLO-101", "CLO-102"],
    }));
    expect(retrievalInput?.message.payload).not.toHaveProperty("linkedIssueIds");
  });

  it("skips retrieval brief generation for ACK_ASSIGNMENT while still dispatching", async () => {
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
      id: "eng-1",
      companyId: "company-1",
      role: "engineer",
      title: "Engineer",
      permissions: {},
    });

    const response = await invokeRoute({
      path: "/issues/:id/protocol/messages",
      method: "post",
      params: { id: "11111111-1111-4111-8111-111111111111" },
      actor: buildAgentActor("eng-1"),
      body: {
        messageType: "ACK_ASSIGNMENT",
        sender: {
          actorType: "agent",
          actorId: "eng-1",
          role: "engineer",
        },
        recipients: [
          { recipientType: "agent", recipientId: "eng-1", role: "engineer" },
        ],
        workflowStateBefore: "assigned",
        workflowStateAfter: "assigned",
        summary: "Assignment acknowledged",
        payload: {
          accepted: true,
          understoodScope: "Implement SafeJoin fix",
          initialRisks: ["Need filesystem-safe path handling"],
        },
        artifacts: [],
      },
    });

    expect(response.statusCode).toBe(201);
    expect(mockIssueRetrievalHandleProtocolMessage).not.toHaveBeenCalled();
    expect(mockProtocolDispatchMessage).toHaveBeenCalledTimes(1);
  });

  it("keeps retrieval brief generation for SUBMIT_FOR_REVIEW handoff messages", async () => {
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
    expect(mockIssueRetrievalHandleProtocolMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        issueId: "11111111-1111-4111-8111-111111111111",
        message: expect.objectContaining({
          messageType: "SUBMIT_FOR_REVIEW",
        }),
      }),
    );
  });

  it("ingests organizational memory after high-signal protocol messages", async () => {
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
    mockProtocolAppendMessage.mockResolvedValue({
      message: {
        id: "message-1",
        seq: 12,
      },
      state: { workflowState: "submitted_for_review" },
      mirroredComment: null,
    });
    mockOrgMemoryIngestProtocolMessage.mockResolvedValue({
      messageId: "message-1",
      sourceType: "review",
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
        artifacts: [
          { kind: "diff", uri: "run://run-1/workspace-diff", label: "Workspace diff" },
        ],
      },
    });

    expect(response.statusCode).toBe(201);
    expect(mockEnqueueAfterDbCommit).toHaveBeenCalledTimes(1);
    expect(mockRunWithoutDbContext).toHaveBeenCalled();
    expect(mockOrgMemoryIngestProtocolMessage).toHaveBeenCalledWith({
      messageId: "message-1",
    });
  });

  it("returns change surface derived from protocol artifacts", async () => {
    mockIssueGetById.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
      identifier: "CLO-220",
      title: "Change surface issue",
      status: "done",
    });
    mockMergeCandidateGetByIssueId.mockResolvedValue({
      state: "pending",
      closeMessageId: "close-1",
      sourceBranch: "squadrail/clo-220",
      workspacePath: "/tmp/worktree",
      headSha: "abc123",
      diffStat: "1 file changed, 8 insertions(+)",
      targetBaseBranch: "main",
      mergeCommitSha: "deadbeef220",
      operatorNote: "Wait for external repository checks before merge.",
      resolvedAt: null,
      automationMetadata: {
        lastPlanWarnings: ["Manual merge preflight still sees overlapping edits."],
        prBridge: {
          provider: "github",
          repoOwner: "acme",
          repoName: "swiftsight",
          repoUrl: "https://github.com/acme/swiftsight",
          remoteUrl: "https://github.com/acme/swiftsight.git",
          number: 42,
          externalId: "1042",
          url: "https://github.com/acme/swiftsight/pull/42",
          title: "Draft: CLO-220",
          state: "draft",
          mergeability: "blocked",
          headBranch: "squadrail/clo-220",
          baseBranch: "main",
          headSha: "abc123",
          reviewDecision: "changes_requested",
          commentCount: 2,
          reviewCommentCount: 1,
          lastSyncedAt: "2026-03-10T11:06:00.000Z",
          checks: [
            {
              name: "pr-verify",
              status: "failure",
              conclusion: "failure",
              summary: "PR verify failed",
              detailsUrl: "https://github.com/acme/swiftsight/actions/runs/1",
              required: true,
            },
          ],
          checkSummary: {
            total: 1,
            passing: 0,
            failing: 1,
            pending: 0,
            requiredTotal: 1,
            requiredPassing: 0,
            requiredFailing: 1,
            requiredPending: 0,
          },
        },
        revertAssist: {
          lastActionSummary: "Created recovery follow-up CLO-221",
          lastActionAt: "2026-03-10T11:10:00.000Z",
          lastCreatedIssueId: "issue-221",
          lastCreatedIssueIdentifier: "CLO-221",
        },
      },
    });
    mockKnowledgeListTaskBriefs.mockResolvedValue([
      {
        id: "brief-1",
        briefScope: "reviewer",
        retrievalRunId: "retrieval-1",
        createdAt: "2026-03-10T10:59:00.000Z",
        contentJson: {
          quality: {
            confidenceLevel: "high",
            graphHitCount: 2,
            multiHopGraphHitCount: 1,
            personalizationApplied: true,
            candidateCacheHit: true,
            finalCacheHit: false,
          },
        },
      },
    ]);
    mockRetrievalPersonalizationSummarizeIssueFeedback.mockResolvedValue({
      positiveCount: 1,
      negativeCount: 0,
      pinnedPathCount: 1,
      hiddenPathCount: 0,
      lastFeedbackAt: "2026-03-10T10:58:00.000Z",
      feedbackTypeCounts: {
        operator_pin: 1,
      },
    });
    mockSummarizeIssueFailureLearning.mockResolvedValue({
      closeReady: false,
      retryability: "operator_required",
      failureFamily: "runtime_process",
      blockingReasons: [
        "Resolve repeated runtime failure before close.",
      ],
      summary: "Repeated runtime failures still require operator review.",
      suggestedActions: [
        "Inspect the latest failed run before closing.",
      ],
      repeatedFailureCount24h: 2,
      lastSeenAt: "2026-03-10T10:57:00.000Z",
    });
    mockProtocolListMessages.mockResolvedValue([
      {
        id: "approve-1",
        messageType: "APPROVE_IMPLEMENTATION",
        summary: "Approved",
        createdAt: "2026-03-10T11:00:00.000Z",
        payload: {
          approvalSummary: "Approved for merge",
        },
        artifacts: [
          {
            kind: "approval",
            uri: "approval://1",
            label: "Approval artifact",
            metadata: {},
          },
        ],
      },
      {
        id: "close-1",
        messageType: "CLOSE_TASK",
        summary: "Closed",
        createdAt: "2026-03-10T11:05:00.000Z",
        payload: {
          mergeStatus: "pending_external_merge",
          closureSummary: "Ready for operator merge",
          verificationSummary: "Focused tests passed",
          rollbackPlan: "Revert the commit",
          remainingRisks: ["Needs external merge"],
          boardTemplateId: "company-close-template",
          boardTemplateLabel: "Release close",
          boardTemplateScope: "company",
          followUpIssueIds: ["issue-221"],
        },
        artifacts: [
          {
            kind: "doc",
            uri: "workspace://binding",
            label: "Workspace binding",
            metadata: {
              bindingType: "implementation_workspace",
              cwd: "/tmp/worktree",
              branchName: "squadrail/clo-220",
              headSha: "abc123",
              source: "project_isolated",
              workspaceState: "fresh",
            },
          },
          {
            kind: "diff",
            uri: "run://diff",
            label: "Diff artifact",
            metadata: {
              branchName: "squadrail/clo-220",
              headSha: "abc123",
              changedFiles: ["src/change.ts"],
              statusEntries: ["M src/change.ts"],
              diffStat: "1 file changed, 8 insertions(+)",
            },
          },
          {
            kind: "test_run",
            uri: "run://test",
            label: "Focused test",
            metadata: {},
          },
        ],
      },
    ]);

    const response = await invokeRoute({
      path: "/issues/:id/change-surface",
      method: "get",
      params: { id: "11111111-1111-4111-8111-111111111111" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      branchName: "squadrail/clo-220",
      workspacePath: "/tmp/worktree",
      changedFiles: ["src/change.ts"],
      retrievalContext: {
        latestRuns: [
          expect.objectContaining({
            briefId: "brief-1",
            retrievalRunId: "retrieval-1",
            confidenceLevel: "high",
            candidateCacheHit: true,
          }),
        ],
        feedbackSummary: {
          positiveCount: 1,
          pinnedPathCount: 1,
          feedbackTypeCounts: {
            operator_pin: 1,
          },
        },
      },
      mergeCandidate: {
        state: "pending",
        sourceBranch: "squadrail/clo-220",
        targetBaseBranch: "main",
        mergeCommitSha: "deadbeef220",
        templateTrace: {
          id: "company-close-template",
          label: "Release close",
          scope: "company",
        },
        prBridge: expect.objectContaining({
          provider: "github",
          number: 42,
          mergeability: "blocked",
        }),
        gateStatus: expect.objectContaining({
          mergeReady: false,
          closeReady: false,
          blockingReasons: expect.arrayContaining([
            "Required checks failing (1).",
            "PR mergeability is blocked by repository policy.",
            "PR still has requested changes.",
          ]),
        }),
        failureAssist: expect.objectContaining({
          status: "watch",
          retryability: "operator_required",
          failureFamily: "runtime_process",
          repeatedFailureCount24h: 2,
        }),
        revertAssist: expect.objectContaining({
          status: "ready",
          mergeCommitSha: "deadbeef220",
          followUpIssueIds: ["issue-221"],
          lastCreatedIssueIdentifier: "CLO-221",
        }),
      },
    });
  });

  it("records manual retrieval feedback for a retrieval run", async () => {
    mockIssueGetById.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
      identifier: "CLO-220",
      title: "Feedback issue",
      status: "in_review",
      projectId: "project-1",
    });

    const response = await invokeRoute({
      path: "/issues/:id/retrieval-feedback",
      method: "post",
      params: { id: "11111111-1111-4111-8111-111111111111" },
      body: {
        retrievalRunId: "22222222-2222-4222-8222-222222222222",
        feedbackType: "operator_pin",
        targetType: "path",
        targetIds: ["src/retry.ts"],
        noteBody: "Keep this path near the top",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(mockRetrievalPersonalizationRecordManualFeedback).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: "company-1",
        issueId: "11111111-1111-4111-8111-111111111111",
        issueProjectId: "project-1",
        retrievalRunId: "22222222-2222-4222-8222-222222222222",
        feedbackType: "operator_pin",
        targetType: "path",
        targetIds: ["src/retry.ts"],
      }),
    );
    expect(response.body).toEqual(
      expect.objectContaining({
        ok: true,
        feedbackEventCount: 2,
      }),
    );
  });

  it("records merge candidate operator decisions", async () => {
    mockIssueGetById.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
      identifier: "CLO-221",
      title: "Merge candidate issue",
      status: "done",
      projectId: "project-1",
    });
    mockProtocolListMessages.mockResolvedValue([
      {
        id: "approve-1",
        messageType: "APPROVE_IMPLEMENTATION",
        summary: "Approved",
        createdAt: "2026-03-10T11:00:00.000Z",
        payload: {
          approvalSummary: "Approved for merge",
        },
        artifacts: [
          {
            kind: "approval",
            uri: "approval://1",
            label: "Approval artifact",
            metadata: {},
          },
        ],
      },
      {
        id: "close-1",
        messageType: "CLOSE_TASK",
        summary: "Closed",
        createdAt: "2026-03-10T11:05:00.000Z",
        payload: {
          mergeStatus: "pending_external_merge",
          closureSummary: "Ready for operator merge",
          verificationSummary: "Focused tests passed",
          rollbackPlan: "Revert the commit",
          remainingRisks: ["Needs external merge"],
        },
        artifacts: [
          {
            kind: "doc",
            uri: "workspace://binding",
            label: "Workspace binding",
            metadata: {
              bindingType: "implementation_workspace",
              cwd: "/tmp/worktree",
              branchName: "squadrail/clo-221",
              headSha: "def456",
              source: "project_isolated",
              workspaceState: "fresh",
            },
          },
          {
            kind: "diff",
            uri: "run://diff",
            label: "Diff artifact",
            metadata: {
              branchName: "squadrail/clo-221",
              headSha: "def456",
              changedFiles: ["src/merge.ts"],
              statusEntries: ["M src/merge.ts"],
              diffStat: "1 file changed, 12 insertions(+)",
            },
          },
        ],
      },
    ]);
    mockMergeCandidateGetByIssueId
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        state: "merged",
        closeMessageId: "close-1",
        sourceBranch: "squadrail/clo-221",
        workspacePath: "/tmp/worktree",
        headSha: "def456",
        diffStat: "1 file changed, 12 insertions(+)",
        targetBaseBranch: "main",
        mergeCommitSha: "fedcba",
        operatorNote: "Merged by operator",
        resolvedAt: "2026-03-10T12:00:00.000Z",
      });
    mockMergeCandidateUpsertDecision.mockResolvedValue({
      id: "merge-1",
      issueId: "11111111-1111-4111-8111-111111111111",
      state: "merged",
    });

    const response = await invokeRoute({
      path: "/issues/:id/merge-candidate/actions",
      method: "post",
      params: { id: "11111111-1111-4111-8111-111111111111" },
      body: {
        actionType: "mark_merged",
        targetBaseBranch: "main",
        mergeCommitSha: "fedcba",
        noteBody: "Merged by operator",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(mockMergeCandidateUpsertDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: "company-1",
        issueId: "11111111-1111-4111-8111-111111111111",
        closeMessageId: "close-1",
        state: "merged",
        sourceBranch: "squadrail/clo-221",
        workspacePath: "/tmp/worktree",
        headSha: "def456",
        diffStat: "1 file changed, 12 insertions(+)",
        targetBaseBranch: "main",
        mergeCommitSha: "fedcba",
        operatorActorType: "user",
        operatorActorId: "user-1",
        operatorNote: "Merged by operator",
      }),
    );
    expect(mockRetrievalPersonalizationRecordMergeCandidateOutcomeFeedback).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: "company-1",
        issueId: "11111111-1111-4111-8111-111111111111",
        issueProjectId: "project-1",
        closeMessageId: "close-1",
        outcome: "merge_completed",
        changedFiles: ["src/merge.ts"],
        mergeCommitSha: "fedcba",
        mergeStatus: "merged",
      }),
    );
    expect(response.body).toEqual(
      expect.objectContaining({
        state: "merged",
        sourceBranch: "squadrail/clo-221",
        targetBaseBranch: "main",
        mergeCommitSha: "fedcba",
      }),
    );
  });

  it("blocks mark_merged when synced PR checks are still pending", async () => {
    mockIssueGetById.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
      identifier: "CLO-221",
      title: "Merge candidate issue",
      status: "done",
      projectId: "project-1",
    });
    mockProtocolListMessages.mockResolvedValue([
      {
        id: "approve-1",
        messageType: "APPROVE_IMPLEMENTATION",
        summary: "Approved",
        createdAt: "2026-03-10T11:00:00.000Z",
        payload: {
          approvalSummary: "Approved for merge",
        },
        artifacts: [
          {
            kind: "approval",
            uri: "approval://1",
            label: "Approval artifact",
            metadata: {},
          },
        ],
      },
      {
        id: "close-1",
        messageType: "CLOSE_TASK",
        summary: "Closed",
        createdAt: "2026-03-10T11:05:00.000Z",
        payload: {
          mergeStatus: "pending_external_merge",
          closureSummary: "Ready for operator merge",
          verificationSummary: "Focused tests passed",
          rollbackPlan: "Revert the commit",
          remainingRisks: [],
        },
        artifacts: [
          {
            kind: "diff",
            uri: "run://diff",
            label: "Diff artifact",
            metadata: {
              branchName: "squadrail/clo-221",
              headSha: "def456",
              changedFiles: ["src/merge.ts"],
              statusEntries: ["M src/merge.ts"],
              diffStat: "1 file changed, 12 insertions(+)",
            },
          },
        ],
      },
    ]);
    mockMergeCandidateGetByIssueId.mockResolvedValue({
      state: "pending",
      closeMessageId: "close-1",
      sourceBranch: "squadrail/clo-221",
      workspacePath: "/tmp/worktree",
      headSha: "def456",
      diffStat: "1 file changed, 12 insertions(+)",
      targetBaseBranch: "main",
      mergeCommitSha: null,
      automationMetadata: {
        prBridge: {
          provider: "github",
          repoOwner: "acme",
          repoName: "swiftsight",
          remoteUrl: "https://github.com/acme/swiftsight.git",
          repoUrl: "https://github.com/acme/swiftsight",
          number: 42,
          externalId: "4200",
          url: "https://github.com/acme/swiftsight/pull/42",
          title: "CLO-221: Merge candidate issue",
          state: "draft",
          mergeability: "blocked",
          headBranch: "squadrail/clo-221",
          baseBranch: "main",
          headSha: "def456",
          lastSyncedAt: "2026-03-12T03:00:00.000Z",
          checks: [
            {
              name: "pr-verify",
              status: "pending",
              required: true,
            },
          ],
        },
      },
      operatorNote: null,
      resolvedAt: null,
    });

    const response = await invokeRoute({
      path: "/issues/:id/merge-candidate/actions",
      method: "post",
      params: { id: "11111111-1111-4111-8111-111111111111" },
      body: {
        actionType: "mark_merged",
        targetBaseBranch: "main",
        mergeCommitSha: "fedcba",
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.body).toEqual(
      expect.objectContaining({
        error: "Merge candidate is blocked by synced PR checks",
        blockingReasons: expect.arrayContaining(["Required checks still pending (1)."]),
      }),
    );
    expect(mockMergeCandidateUpsertDecision).not.toHaveBeenCalled();
  });

  it("creates a revert follow-up from merge recovery assist", async () => {
    mockIssueGetById.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
      identifier: "CLO-240",
      title: "Merged issue",
      status: "done",
      projectId: "project-1",
      priority: "high",
    });
    mockProtocolListMessages.mockResolvedValue([
      {
        id: "close-1",
        messageType: "CLOSE_TASK",
        summary: "Closed",
        createdAt: "2026-03-10T11:05:00.000Z",
        payload: {
          mergeStatus: "pending_external_merge",
          closureSummary: "Merged externally",
          verificationSummary: "Focused tests passed",
          rollbackPlan: "Revert the merge commit if rollout regresses",
          followUpIssueIds: ["CLO-222"],
        },
        artifacts: [],
      },
    ]);
    mockMergeCandidateGetByIssueId.mockResolvedValue({
      state: "pending",
      closeMessageId: "close-1",
      sourceBranch: "squadrail/clo-240",
      workspacePath: "/tmp/worktree",
      headSha: "abc240",
      diffStat: "1 file changed",
      targetBaseBranch: "main",
      mergeCommitSha: "fed240",
      automationMetadata: {},
      operatorNote: null,
      resolvedAt: null,
    });
    mockIssueCreate.mockResolvedValue({
      id: "followup-1",
      companyId: "company-1",
      identifier: "CLO-241",
      title: "Recovery follow-up",
      description: "Recovery plan",
      status: "backlog",
      priority: "high",
    });

    const response = await invokeRoute({
      path: "/issues/:id/merge-candidate/recovery",
      method: "post",
      params: { id: "11111111-1111-4111-8111-111111111111" },
      body: {
        actionType: "create_revert_followup",
        title: "Recovery follow-up",
        body: "Recovery plan",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(mockIssueCreate).toHaveBeenCalledWith(
      "company-1",
      expect.objectContaining({
        projectId: "project-1",
        title: "Recovery follow-up",
        description: "Recovery plan",
        status: "backlog",
        priority: "high",
      }),
    );
    expect(mockMergeCandidatePatchAutomationMetadata).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      expect.objectContaining({
        revertAssist: expect.objectContaining({
          lastActionType: "create_revert_followup",
          lastCreatedIssueId: "followup-1",
          lastCreatedIssueIdentifier: "CLO-241",
        }),
      }),
    );
    expect(response.body).toEqual(
      expect.objectContaining({
        actionType: "create_revert_followup",
        createdIssueId: "followup-1",
        createdIssueIdentifier: "CLO-241",
        reopened: false,
      }),
    );
  });

  it("reopens an issue with rollback context from merge recovery assist", async () => {
    mockIssueGetById.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
      identifier: "CLO-242",
      title: "Merged issue",
      status: "done",
      projectId: "project-1",
      priority: "high",
    });
    mockProtocolListMessages.mockResolvedValue([
      {
        id: "close-1",
        messageType: "CLOSE_TASK",
        summary: "Closed",
        createdAt: "2026-03-10T11:05:00.000Z",
        payload: {
          mergeStatus: "pending_external_merge",
          closureSummary: "Merged externally",
          verificationSummary: "Focused tests passed",
          rollbackPlan: "Revert the merge commit if rollout regresses",
        },
        artifacts: [],
      },
    ]);
    mockMergeCandidateGetByIssueId.mockResolvedValue({
      state: "pending",
      closeMessageId: "close-1",
      sourceBranch: "squadrail/clo-242",
      workspacePath: "/tmp/worktree",
      headSha: "abc242",
      diffStat: "1 file changed",
      targetBaseBranch: "main",
      mergeCommitSha: "fed242",
      automationMetadata: {},
      operatorNote: "Operator requested rollback review",
      resolvedAt: null,
    });
    mockIssueUpdate.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
      identifier: "CLO-242",
      title: "Merged issue",
      status: "todo",
      projectId: "project-1",
    });
    mockIssueAddComment.mockResolvedValue({
      id: "comment-rollback-1",
      companyId: "company-1",
      issueId: "11111111-1111-4111-8111-111111111111",
      body: "## Recovery Context",
      createdAt: new Date("2026-03-13T00:00:00.000Z"),
      updatedAt: new Date("2026-03-13T00:00:00.000Z"),
    });

    const response = await invokeRoute({
      path: "/issues/:id/merge-candidate/recovery",
      method: "post",
      params: { id: "11111111-1111-4111-8111-111111111111" },
      body: {
        actionType: "reopen_with_rollback_context",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(mockIssueUpdate).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111", { status: "todo" });
    expect(mockIssueAddComment).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      expect.stringContaining("## Recovery Context"),
      {
        agentId: undefined,
        userId: "user-1",
      },
    );
    expect(mockMergeCandidatePatchAutomationMetadata).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      expect.objectContaining({
        revertAssist: expect.objectContaining({
          lastActionType: "reopen_with_rollback_context",
          lastActionSummary: "Reopened issue with rollback context",
          lastCommentId: "comment-rollback-1",
        }),
      }),
    );
    expect(response.body).toEqual(
      expect.objectContaining({
        actionType: "reopen_with_rollback_context",
        reopened: true,
        commentId: "comment-rollback-1",
      }),
    );
  });

  it("builds a merge automation plan for a pending candidate", async () => {
    mockIssueGetById.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
      identifier: "CLO-222",
      title: "Merge plan issue",
      status: "done",
      projectId: "project-1",
    });
    mockProtocolListMessages.mockResolvedValue([
      {
        id: "close-1",
        messageType: "CLOSE_TASK",
        summary: "Closed",
        createdAt: "2026-03-10T11:05:00.000Z",
        payload: {
          mergeStatus: "pending_external_merge",
          closureSummary: "Ready for automation",
          verificationSummary: "Tests passed",
          rollbackPlan: "Revert",
        },
        artifacts: [],
      },
    ]);
    mockProjectGetById.mockResolvedValue({
      id: "project-1",
      name: "Project One",
      primaryWorkspace: {
        id: "workspace-1",
        name: "Base",
        cwd: "/tmp/base",
        repoRef: "main",
      },
    });

    const response = await invokeRoute({
      path: "/issues/:id/merge-candidate/plan",
      method: "get",
      params: { id: "11111111-1111-4111-8111-111111111111" },
    });

    expect(response.statusCode).toBe(200);
    expect(mockBuildMergeAutomationPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        issue: expect.objectContaining({
          id: "11111111-1111-4111-8111-111111111111",
          projectId: "project-1",
        }),
        project: expect.objectContaining({
          id: "project-1",
        }),
      }),
    );
    expect(response.body).toEqual(expect.objectContaining({
      issueId: "11111111-1111-4111-8111-111111111111",
      targetBaseBranch: "main",
    }));
  });

  it("runs merge automation and stores automation metadata", async () => {
    mockIssueGetById.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
      identifier: "CLO-223",
      title: "Merge automation issue",
      status: "done",
      projectId: "project-1",
    });
    mockProtocolListMessages.mockResolvedValue([
      {
        id: "close-1",
        messageType: "CLOSE_TASK",
        summary: "Closed",
        createdAt: "2026-03-10T11:05:00.000Z",
        payload: {
          mergeStatus: "pending_external_merge",
          closureSummary: "Ready for automation",
          verificationSummary: "Tests passed",
          rollbackPlan: "Revert",
        },
        artifacts: [],
      },
    ]);
    mockProjectGetById.mockResolvedValue({
      id: "project-1",
      name: "Project One",
      primaryWorkspace: {
        id: "workspace-1",
        name: "Base",
        cwd: "/tmp/base",
        repoRef: "main",
      },
    });
    mockRunMergeAutomationAction.mockResolvedValue({
      actionType: "export_patch",
      ok: true,
      plan: {
        issueId: "11111111-1111-4111-8111-111111111111",
        targetBaseBranch: "main",
      },
      patchPath: "/tmp/export.patch",
      automationMetadataPatch: {
        lastAutomationAction: "export_patch",
        lastPatchPath: "/tmp/export.patch",
      },
    });

    const response = await invokeRoute({
      path: "/issues/:id/merge-candidate/automation",
      method: "post",
      params: { id: "11111111-1111-4111-8111-111111111111" },
      body: {
        actionType: "export_patch",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(mockRunMergeAutomationAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "export_patch",
      }),
    );
    expect(mockMergeCandidatePatchAutomationMetadata).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      expect.objectContaining({
        lastAutomationAction: "export_patch",
      }),
    );
    expect(response.body).toEqual(
      expect.objectContaining({
        result: expect.objectContaining({
          actionType: "export_patch",
          patchPath: "/tmp/export.patch",
        }),
      }),
    );
  });

  it("runs PR bridge sync automation and stores external review metadata", async () => {
    mockIssueGetById.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
      identifier: "CLO-223",
      title: "Merge automation issue",
      status: "done",
      projectId: "project-1",
    });
    mockProtocolListMessages.mockResolvedValue([
      {
        id: "close-1",
        messageType: "CLOSE_TASK",
        summary: "Closed",
        createdAt: "2026-03-10T11:05:00.000Z",
        payload: {
          mergeStatus: "pending_external_merge",
          closureSummary: "Ready for automation",
          verificationSummary: "Tests passed",
          rollbackPlan: "Revert",
        },
        artifacts: [],
      },
    ]);
    mockProjectGetById.mockResolvedValue({
      id: "project-1",
      name: "Project One",
      primaryWorkspace: {
        id: "workspace-1",
        name: "Base",
        cwd: "/tmp/base",
        repoRef: "main",
      },
    });
    mockRunMergeAutomationAction.mockResolvedValue({
      actionType: "sync_pr_bridge",
      ok: true,
      plan: {
        issueId: "11111111-1111-4111-8111-111111111111",
        targetBaseBranch: "main",
      },
      externalProvider: "github",
      externalNumber: 42,
      externalUrl: "https://github.com/acme/swiftsight/pull/42",
      automationMetadataPatch: {
        lastAutomationAction: "sync_pr_bridge",
        prBridge: {
          provider: "github",
          number: 42,
        },
      },
    });

    const response = await invokeRoute({
      path: "/issues/:id/merge-candidate/automation",
      method: "post",
      params: { id: "11111111-1111-4111-8111-111111111111" },
      body: {
        actionType: "sync_pr_bridge",
        targetBaseBranch: "main",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(mockRunMergeAutomationAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "sync_pr_bridge",
      }),
    );
    expect(mockMergeCandidatePatchAutomationMetadata).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      expect.objectContaining({
        lastAutomationAction: "sync_pr_bridge",
        prBridge: expect.objectContaining({
          provider: "github",
          number: 42,
        }),
      }),
    );
    expect(response.body).toEqual(
      expect.objectContaining({
        result: expect.objectContaining({
          actionType: "sync_pr_bridge",
          externalProvider: "github",
          externalNumber: 42,
          externalUrl: "https://github.com/acme/swiftsight/pull/42",
        }),
      }),
    );
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

  it("persists a pending merge candidate when CLOSE_TASK requests external merge", async () => {
    mockIssueGetById.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
      identifier: "CLO-230",
      title: "Pending merge issue",
      description: null,
      projectId: "project-1",
      labels: [],
      status: "done",
    });
    mockAgentGetById.mockResolvedValue({
      id: "lead-1",
      companyId: "company-1",
      role: "tech_lead",
      title: "Cloud Tech Lead",
      permissions: {},
    });
    mockProtocolAppendMessage.mockResolvedValue({
      message: { id: "close-1", seq: 7 },
      state: { workflowState: "done" },
    });
    mockProtocolListMessages.mockResolvedValue([
      {
        id: "approve-1",
        messageType: "APPROVE_IMPLEMENTATION",
        summary: "Approved",
        createdAt: "2026-03-10T11:00:00.000Z",
        payload: {
          approvalSummary: "Approved for merge",
        },
        artifacts: [
          {
            kind: "approval",
            uri: "approval://1",
            label: "Approval artifact",
            metadata: {},
          },
        ],
      },
      {
        id: "close-1",
        messageType: "CLOSE_TASK",
        summary: "Closed",
        createdAt: "2026-03-10T11:05:00.000Z",
        payload: {
          mergeStatus: "pending_external_merge",
          closureSummary: "Ready for external merge",
          verificationSummary: "Focused tests passed",
          rollbackPlan: "Revert the patch",
        },
        artifacts: [
          {
            kind: "doc",
            uri: "workspace://binding",
            label: "Workspace binding",
            metadata: {
              bindingType: "implementation_workspace",
              cwd: "/tmp/worktree",
              branchName: "squadrail/clo-230",
              headSha: "abc123",
              source: "project_isolated",
              workspaceState: "fresh",
            },
          },
          {
            kind: "diff",
            uri: "run://diff",
            label: "Diff artifact",
            metadata: {
              branchName: "squadrail/clo-230",
              headSha: "abc123",
              changedFiles: ["src/merge.ts"],
              statusEntries: ["M src/merge.ts"],
              diffStat: "1 file changed, 4 insertions(+)",
            },
          },
        ],
      },
    ]);

    const response = await invokeRoute({
      path: "/issues/:id/protocol/messages",
      method: "post",
      params: { id: "11111111-1111-4111-8111-111111111111" },
      actor: buildAgentActor("lead-1"),
      body: {
        messageType: "CLOSE_TASK",
        sender: {
          actorType: "agent",
          actorId: "lead-1",
          role: "tech_lead",
        },
        recipients: [
          { recipientType: "agent", recipientId: "lead-1", role: "tech_lead" },
        ],
        workflowStateBefore: "approved",
        workflowStateAfter: "done",
        summary: "Close pending merge",
        payload: {
          closeReason: "completed",
          finalTestStatus: "passed",
          mergeStatus: "pending_external_merge",
          closureSummary: "Ready for external merge",
          verificationSummary: "Focused tests passed",
          rollbackPlan: "Revert the patch",
          finalArtifacts: ["Diff prepared for external merge"],
        },
        artifacts: [],
      },
    });

    expect(response.statusCode).toBe(201);
    expect(mockHeartbeatCancelSupersededIssueFollowups).toHaveBeenCalledWith({
      companyId: "company-1",
      issueId: "11111111-1111-4111-8111-111111111111",
      excludeRunId: null,
      reason: "Issue closed via protocol",
    });
    expect(mockMergeCandidateUpsertDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        issueId: "11111111-1111-4111-8111-111111111111",
        state: "pending",
        closeMessageId: "close-1",
        sourceBranch: "squadrail/clo-230",
        workspacePath: "/tmp/worktree",
        headSha: "abc123",
      }),
    );
  });

  it("records board workflow template trace in protocol activity logs", async () => {
    mockIssueGetById.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
      identifier: "CLO-231",
      title: "Template traced close",
      description: null,
      projectId: "project-1",
      labels: [],
      status: "done",
    });
    mockAgentGetById.mockResolvedValue({
      id: "lead-1",
      companyId: "company-1",
      role: "tech_lead",
      title: "Cloud Tech Lead",
      permissions: {},
    });
    mockProtocolAppendMessage.mockResolvedValue({
      message: { id: "close-template-1", seq: 8 },
      state: { workflowState: "done" },
    });

    const response = await invokeRoute({
      path: "/issues/:id/protocol/messages",
      method: "post",
      params: { id: "11111111-1111-4111-8111-111111111111" },
      actor: buildAgentActor("lead-1"),
      body: {
        messageType: "CLOSE_TASK",
        sender: {
          actorType: "agent",
          actorId: "lead-1",
          role: "tech_lead",
        },
        recipients: [
          { recipientType: "agent", recipientId: "lead-1", role: "tech_lead" },
        ],
        workflowStateBefore: "approved",
        workflowStateAfter: "done",
        summary: "Close with board template trace",
        payload: {
          closeReason: "completed",
          finalTestStatus: "passed",
          mergeStatus: "pending_external_merge",
          closureSummary: "Ready for external merge",
          verificationSummary: "Focused tests passed",
          rollbackPlan: "Revert the patch",
          finalArtifacts: ["Diff prepared for external merge"],
          boardTemplateId: "company-close-template",
          boardTemplateLabel: "Release close",
          boardTemplateScope: "company",
        },
        artifacts: [],
      },
    });

    expect(response.statusCode).toBe(201);
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "issue.protocol_message.created",
        details: expect.objectContaining({
          boardTemplateId: "company-close-template",
          boardTemplateLabel: "Release close",
          boardTemplateScope: "company",
        }),
      }),
    );
  });

  it("returns immediately for async agent protocol dispatch mode", async () => {
    mockIssueGetById.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
      identifier: "CLO-205",
      title: "Async protocol issue",
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
    mockProtocolAppendMessage.mockResolvedValue({
      message: { id: "protocol-message-3", seq: 3 },
      state: { workflowState: "submitted_for_review" },
    });
    let dispatchResolved = false;
    mockProtocolDispatchMessage.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            dispatchResolved = true;
            resolve(undefined);
          }, 50);
        }),
    );

    const startedAt = Date.now();
    const response = await invokeRoute({
      path: "/issues/:id/protocol/messages",
      method: "post",
      params: { id: "11111111-1111-4111-8111-111111111111" },
      actor: buildAgentActor("eng-1"),
      headers: { "x-squadrail-dispatch-mode": "async" },
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
          evidence: ["go test ./pkg/foo passed"],
          diffSummary: "Updated runtime boundary",
          changedFiles: ["server/src/routes/issues.ts"],
          testResults: ["go test ./pkg/foo"],
          reviewChecklist: ["Protocol post returns quickly"],
          residualRisks: ["Nightly dispatch still depends on downstream reviewer availability"],
        },
        artifacts: [],
      },
    });

    expect(response.statusCode, JSON.stringify(response.body)).toBe(201);
    expect(Date.now() - startedAt).toBeLessThan(50);
    expect(response.body).toEqual(
      expect.objectContaining({
        message: expect.objectContaining({
          id: "protocol-message-3",
        }),
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 70));
    expect(dispatchResolved).toBe(true);
  });

  it("normalizes legacy approval mode aliases before protocol validation", async () => {
    mockIssueGetById.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
      identifier: "CLO-206",
      title: "Approval alias issue",
      description: null,
      projectId: null,
      labels: [],
    });
    mockProtocolAppendMessage.mockResolvedValue({
      message: { id: "protocol-message-4", seq: 4 },
      state: { workflowState: "approved" },
    });
    mockAgentGetById.mockResolvedValue({
      id: "rev-1",
      companyId: "company-1",
      role: "qa",
      title: "QA Reviewer",
      permissions: {},
    });

    const response = await invokeRoute({
      path: "/issues/:id/protocol/messages",
      method: "post",
      params: { id: "11111111-1111-4111-8111-111111111111" },
      actor: buildAgentActor("rev-1"),
      body: {
        messageType: "APPROVE_IMPLEMENTATION",
        sender: {
          actorType: "agent",
          actorId: "rev-1",
          role: "reviewer",
        },
        recipients: [
          { recipientType: "agent", recipientId: "eng-1", role: "engineer" },
        ],
        workflowStateBefore: "under_review",
        workflowStateAfter: "approved",
        summary: "Approve with legacy alias",
        payload: {
          approvalMode: "full",
          approvalSummary: "Legacy alias should be normalized before validation.",
          approvalChecklist: ["Focused review completed"],
          verifiedEvidence: ["go test ./pkg/swiftcl -count=1"],
          residualRisks: ["External merge still pending"],
        },
        artifacts: [],
      },
    });

    expect(response.statusCode, JSON.stringify(response.body)).toBe(201);
    expect(mockProtocolAppendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.objectContaining({
          messageType: "APPROVE_IMPLEMENTATION",
          payload: expect.objectContaining({
            approvalMode: "agent_review",
          }),
        }),
      }),
    );
  });
});
