import { issueProtocolState, issues } from "@squadrail/db";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockHeartbeatGetRun,
  mockHeartbeatCancelRun,
  mockHeartbeatWakeup,
  mockAgentGetById,
  mockLogActivity,
  mockResolveIssueDependencyGraphMetadata,
  mockHasBlockingIssueDependencies,
  mockBuildIssueDependencyBlockingSummary,
  mockCanDispatchProtocolToAdapter,
  mockLoadInternalWorkItemSupervisorContext,
} = vi.hoisted(() => ({
  mockHeartbeatGetRun: vi.fn(),
  mockHeartbeatCancelRun: vi.fn(),
  mockHeartbeatWakeup: vi.fn(),
  mockAgentGetById: vi.fn(),
  mockLogActivity: vi.fn(),
  mockResolveIssueDependencyGraphMetadata: vi.fn(),
  mockHasBlockingIssueDependencies: vi.fn(),
  mockBuildIssueDependencyBlockingSummary: vi.fn(),
  mockCanDispatchProtocolToAdapter: vi.fn(),
  mockLoadInternalWorkItemSupervisorContext: vi.fn(),
}));

vi.mock("../services/heartbeat.js", () => ({
  heartbeatService: () => ({
    getRun: mockHeartbeatGetRun,
    cancelRun: mockHeartbeatCancelRun,
    wakeup: mockHeartbeatWakeup,
  }),
}));

vi.mock("../services/agents.js", () => ({
  agentService: () => ({
    getById: mockAgentGetById,
  }),
}));

vi.mock("../services/activity-log.js", () => ({
  logActivity: mockLogActivity,
}));

vi.mock("../services/internal-work-item-supervision.js", () => ({
  loadInternalWorkItemSupervisorContext: mockLoadInternalWorkItemSupervisorContext,
  getInternalWorkItemKind: () => null,
  isLeadWatchEnabled: () => false,
  isReviewerWatchEnabled: () => false,
  buildInternalWorkItemDispatchMetadata: () => ({}),
  leadSupervisorProtocolReason: () => null,
  reviewerWatchReason: () => "issue_watch_assigned",
}));

vi.mock("../services/issue-dependency-graph.js", () => ({
  resolveIssueDependencyGraphMetadata: mockResolveIssueDependencyGraphMetadata,
  hasBlockingIssueDependencies: mockHasBlockingIssueDependencies,
  buildIssueDependencyBlockingSummary: mockBuildIssueDependencyBlockingSummary,
  readIssueDependencyGraphMetadata: () => null,
}));

vi.mock("../adapters/index.js", () => ({
  canDispatchProtocolToAdapter: mockCanDispatchProtocolToAdapter,
}));

import { issueProtocolExecutionService } from "../services/issue-protocol-execution.js";

function createResolvedChain(rows: unknown[]) {
  const chain = {
    from: () => chain,
    where: () => chain,
    innerJoin: () => chain,
    leftJoin: () => chain,
    limit: () => chain,
    then: <T>(resolve: (value: unknown[]) => T | PromiseLike<T>) =>
      Promise.resolve(rows).then(resolve),
  };
  return chain;
}

function createIssueProtocolExecutionDbMock(input: {
  selectResults?: unknown[][];
  updateResults?: unknown[][];
}) {
  const selectQueue = [...(input.selectResults ?? [])];
  const updateQueue = [...(input.updateResults ?? [])];
  const updateSets: Array<{ table: unknown; value: unknown }> = [];

  const db = {
    select: () => createResolvedChain(selectQueue.shift() ?? []),
    update: (table: unknown) => ({
      set: (value: unknown) => {
        updateSets.push({ table, value });
        return {
          where: () => ({
            returning: async () => updateQueue.shift() ?? [],
          }),
        };
      },
    }),
    transaction: async <T>(callback: (tx: typeof db) => Promise<T>) => callback(db),
  };

  return {
    db,
    updateSets,
  };
}

function makeAssignmentMessage(input?: {
  messageType?: "ASSIGN_TASK" | "REASSIGN_TASK";
  recipients?: Array<{ recipientType: "agent"; recipientId: string; role: "engineer" | "reviewer" }>;
}) {
  return {
    messageType: input?.messageType ?? "ASSIGN_TASK",
    sender: {
      actorType: "user",
      actorId: "board-1",
      role: "human_board",
    },
    recipients: input?.recipients ?? [
      {
        recipientType: "agent",
        recipientId: "eng-1",
        role: "engineer",
      },
    ],
    workflowStateBefore: "backlog",
    workflowStateAfter: "assigned",
    summary: "Assign implementation",
    payload: {
      goal: "Ship runtime change",
      acceptanceCriteria: ["tests pass"],
      definitionOfDone: ["merged"],
      priority: "high",
      assigneeAgentId: "eng-1",
    },
    artifacts: [],
  } as const;
}

describe("issue protocol execution service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveIssueDependencyGraphMetadata.mockResolvedValue(null);
    mockHasBlockingIssueDependencies.mockReturnValue(false);
    mockBuildIssueDependencyBlockingSummary.mockReturnValue("dependency blocked");
    mockCanDispatchProtocolToAdapter.mockReturnValue(true);
    mockLoadInternalWorkItemSupervisorContext.mockResolvedValue(null);
  });

  it("blocks dispatch when issue dependencies are unresolved", async () => {
    const dependencyGraph = {
      blockingIssueIds: ["dep-1"],
    };
    mockResolveIssueDependencyGraphMetadata.mockResolvedValue(dependencyGraph);
    mockHasBlockingIssueDependencies.mockReturnValue(true);

    const { db, updateSets } = createIssueProtocolExecutionDbMock({
      selectResults: [
        [{
          workflowState: "assigned",
          metadata: {},
        }],
      ],
    });
    const service = issueProtocolExecutionService(db as never);

    const result = await service.dispatchMessage({
      issueId: "issue-1",
      companyId: "company-1",
      protocolMessageId: "msg-1",
      message: makeAssignmentMessage(),
      actor: {
        actorType: "user",
        actorId: "board-1",
        agentId: null,
        runId: null,
      },
    });

    expect(result).toEqual({
      queued: 0,
      notifyOnly: 0,
      skipped: 1,
    });
    expect(updateSets).toContainEqual({
      table: issueProtocolState,
      value: expect.objectContaining({
        workflowState: "blocked",
        coarseIssueStatus: "blocked",
        blockedCode: "dependency_wait",
        blockedByMessageId: "msg-1",
      }),
    });
    expect(updateSets).toContainEqual({
      table: issues,
      value: expect.objectContaining({
        status: "blocked",
      }),
    });
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "issue.protocol_dispatch.blocked_by_dependency",
        entityId: "issue-1",
      }),
    );
    expect(mockHeartbeatWakeup).not.toHaveBeenCalled();
  });

  it("transfers active execution to the new assignee before waking the recipient", async () => {
    mockHeartbeatGetRun.mockResolvedValue({
      id: "run-active",
      agentId: "eng-old",
      status: "running",
    });
    mockAgentGetById.mockResolvedValue({
      id: "eng-new",
      adapterType: "codex_local",
    });

    const { db } = createIssueProtocolExecutionDbMock({
      selectResults: [
        [{
          workflowState: "assigned",
          metadata: {},
        }],
        [{
          executionRunId: "run-active",
        }],
      ],
    });
    const service = issueProtocolExecutionService(db as never);

    const result = await service.dispatchMessage({
      issueId: "issue-1",
      companyId: "company-1",
      protocolMessageId: "msg-2",
      message: makeAssignmentMessage({
        messageType: "REASSIGN_TASK",
        recipients: [
          {
            recipientType: "agent",
            recipientId: "eng-new",
            role: "engineer",
          },
        ],
      }),
      actor: {
        actorType: "user",
        actorId: "board-1",
        agentId: null,
        runId: null,
      },
    });

    expect(result).toEqual({
      queued: 1,
      notifyOnly: 0,
      skipped: 0,
    });
    expect(mockHeartbeatCancelRun).toHaveBeenCalledWith("run-active");
    expect(mockHeartbeatWakeup).toHaveBeenCalledWith(
      "eng-new",
      expect.objectContaining({
        source: "assignment",
        reason: "issue_reassigned",
      }),
    );
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "issue.protocol_dispatch.execution_transferred",
        details: expect.objectContaining({
          fromAgentId: "eng-old",
          toAgentId: "eng-new",
        }),
      }),
    );
  });

  it("counts notify-only recipients and skips unsupported adapters", async () => {
    mockAgentGetById.mockResolvedValue({
      id: "eng-1",
      adapterType: "http",
    });
    mockCanDispatchProtocolToAdapter.mockReturnValue(false);

    const { db } = createIssueProtocolExecutionDbMock({
      selectResults: [
        [{
          workflowState: "assigned",
          metadata: {},
        }],
        [{
          executionRunId: null,
        }],
      ],
    });
    const service = issueProtocolExecutionService(db as never);

    const result = await service.dispatchMessage({
      issueId: "issue-1",
      companyId: "company-1",
      protocolMessageId: "msg-3",
      message: makeAssignmentMessage({
        recipients: [
          {
            recipientType: "agent",
            recipientId: "eng-1",
            role: "engineer",
          },
          {
            recipientType: "agent",
            recipientId: "reviewer-1",
            role: "reviewer",
          },
        ],
      }),
      actor: {
        actorType: "user",
        actorId: "board-1",
        agentId: null,
        runId: null,
      },
    });

    expect(result).toEqual({
      queued: 0,
      notifyOnly: 1,
      skipped: 1,
    });
    expect(mockHeartbeatWakeup).not.toHaveBeenCalled();
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "issue.protocol_dispatch.skipped_unsupported_adapter",
      }),
    );
  });
});
