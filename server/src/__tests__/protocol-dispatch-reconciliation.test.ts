import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateIssueProtocolMessage } from "@squadrail/shared";

const { mockLogActivity } = vi.hoisted(() => ({
  mockLogActivity: vi.fn(),
}));

vi.mock("../services/activity-log.js", () => ({
  logActivity: mockLogActivity,
}));

import { protocolDispatchReconciliationService } from "../services/protocol-dispatch-reconciliation.js";

function makeMessage(input?: Partial<CreateIssueProtocolMessage>): CreateIssueProtocolMessage {
  return {
    messageType: "SUBMIT_FOR_REVIEW",
    sender: {
      actorType: "agent",
      actorId: "eng-1",
      role: "engineer",
    },
    recipients: [
      {
        recipientType: "agent",
        recipientId: "rev-1",
        role: "reviewer",
      },
    ],
    workflowStateBefore: "implementing",
    workflowStateAfter: "submitted_for_review",
    summary: "Submit for review",
    payload: {
      reviewCycle: 1,
    },
    artifacts: [],
    ...input,
  };
}

function makeIssueSnapshot(input?: Partial<{
  issueId: string;
  companyId: string;
  projectId: string | null;
  issueStatus: string;
  workflowState: string;
  blockedByMessageId: string | null;
}>) {
  return {
    issueId: "issue-1",
    companyId: "company-1",
    projectId: null,
    issueStatus: "in_progress",
    workflowState: "submitted_for_review",
    blockedByMessageId: null,
    ...input,
  };
}

describe("protocol dispatch reconciliation service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("re-dispatches due outbox entries when no active evidence exists", async () => {
    const dispatchMessage = vi.fn().mockResolvedValue({
      queued: 1,
      notifyOnly: 0,
      skipped: 0,
    });
    const markOutboxDispatched = vi.fn().mockResolvedValue(undefined);
    const buildRecipientHints = vi.fn().mockResolvedValue([
      {
        recipientId: "rev-1",
        recipientRole: "reviewer",
        briefId: "brief-1",
        briefScope: "reviewer",
        briefContentMarkdown: "# reviewer brief",
      },
    ]);

    const service = protocolDispatchReconciliationService({} as never, {
      listPendingOutboxEntries: async () => [{
        id: "outbox-1",
        companyId: "company-1",
        issueId: "issue-1",
        protocolMessageId: "msg-1",
        status: "pending",
        attemptCount: 0,
        notBefore: new Date("2026-03-22T00:00:00.000Z"),
        lastAttemptAt: null,
        dispatchedAt: null,
        settledAt: null,
        lastError: null,
        dispatchResult: {},
        createdAt: new Date("2026-03-22T00:00:00.000Z"),
        updatedAt: new Date("2026-03-22T00:00:00.000Z"),
      }],
      listLegacyCandidates: async () => [],
      loadIssueSnapshot: async () => makeIssueSnapshot(),
      loadMessages: async () => new Map([
        ["msg-1", {
          id: "msg-1",
          ...makeMessage(),
        }],
      ]),
      hasDispatchEvidence: async () => false,
      buildRecipientHints,
      dispatchMessage,
      loadIssueContext: async () => null,
      markOutboxDispatched,
    });

    const result = await service.reconcilePendingDispatches();

    expect(dispatchMessage).toHaveBeenCalledWith(expect.objectContaining({
      issueId: "issue-1",
      companyId: "company-1",
      protocolMessageId: "msg-1",
      recipientHints: expect.arrayContaining([
        expect.objectContaining({
          recipientId: "rev-1",
          briefId: "brief-1",
        }),
      ]),
      actor: expect.objectContaining({
        actorType: "agent",
        actorId: "eng-1",
        agentId: "eng-1",
      }),
    }));
    expect(markOutboxDispatched).toHaveBeenCalledWith({
      protocolMessageId: "msg-1",
      dispatchResult: expect.objectContaining({
        reason: "reconciled_dispatch",
        queued: 1,
      }),
    });
    expect(result).toMatchObject({
      scanned: 1,
      pendingOutbox: 1,
      reconciled: 1,
      skippedWithEvidence: 0,
      skippedNoWakeTargets: 0,
    });
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "issue.protocol_dispatch.reconciled",
        entityId: "issue-1",
      }),
    );
  });

  it("settles a due outbox entry when existing dispatch evidence already exists", async () => {
    const dispatchMessage = vi.fn();
    const markOutboxDispatched = vi.fn().mockResolvedValue(undefined);

    const service = protocolDispatchReconciliationService({} as never, {
      listPendingOutboxEntries: async () => [{
        id: "outbox-2",
        companyId: "company-1",
        issueId: "issue-2",
        protocolMessageId: "msg-2",
        status: "pending",
        attemptCount: 0,
        notBefore: new Date("2026-03-22T00:00:00.000Z"),
        lastAttemptAt: null,
        dispatchedAt: null,
        settledAt: null,
        lastError: null,
        dispatchResult: {},
        createdAt: new Date("2026-03-22T00:00:00.000Z"),
        updatedAt: new Date("2026-03-22T00:00:00.000Z"),
      }],
      listLegacyCandidates: async () => [],
      loadIssueSnapshot: async () => makeIssueSnapshot({ issueId: "issue-2" }),
      loadMessages: async () => new Map([
        ["msg-2", {
          id: "msg-2",
          ...makeMessage(),
        }],
      ]),
      hasDispatchEvidence: async () => true,
      dispatchMessage,
      loadIssueContext: async () => null,
      markOutboxDispatched,
    });

    const result = await service.reconcilePendingDispatches();

    expect(dispatchMessage).not.toHaveBeenCalled();
    expect(markOutboxDispatched).toHaveBeenCalledWith({
      protocolMessageId: "msg-2",
      dispatchResult: {
        reason: "existing_dispatch_evidence",
      },
    });
    expect(result).toMatchObject({
      scanned: 1,
      pendingOutbox: 1,
      reconciled: 0,
      skippedWithEvidence: 1,
    });
  });

  it("preserves pre-retrieval reroute semantics for tracked outbox messages", async () => {
    const dispatchMessage = vi.fn().mockResolvedValue({
      queued: 1,
      notifyOnly: 0,
      skipped: 0,
    });
    const markOutboxNoAction = vi.fn().mockResolvedValue(undefined);
    const markOutboxDispatched = vi.fn().mockResolvedValue(undefined);
    const applyPreRetrievalReroute = vi.fn().mockResolvedValue({
      rerouteProtocolMessageId: "msg-reroute-1",
      rerouteProtocolMessageSeq: 2,
      rerouteMessage: makeMessage({
        messageType: "REASSIGN_TASK",
        sender: {
          actorType: "agent",
          actorId: "lead-1",
          role: "tech_lead",
        },
        recipients: [
          {
            recipientType: "agent",
            recipientId: "eng-2",
            role: "engineer",
          },
        ],
        workflowStateBefore: "assigned",
        workflowStateAfter: "assigned",
        summary: "Local-trusted deterministic routing reassign",
      }),
      actor: {
        actorType: "agent",
        actorId: "lead-1",
        agentId: "lead-1",
        runId: null,
      },
    });

    const service = protocolDispatchReconciliationService({} as never, {
      listPendingOutboxEntries: async () => [{
        id: "outbox-3",
        companyId: "company-1",
        issueId: "issue-3",
        protocolMessageId: "msg-assign-1",
        status: "pending",
        attemptCount: 0,
        notBefore: new Date("2026-03-22T00:00:00.000Z"),
        lastAttemptAt: null,
        dispatchedAt: null,
        settledAt: null,
        lastError: null,
        dispatchResult: {},
        createdAt: new Date("2026-03-22T00:00:00.000Z"),
        updatedAt: new Date("2026-03-22T00:00:00.000Z"),
      }],
      listLegacyCandidates: async () => [],
      loadIssueSnapshot: async () => makeIssueSnapshot({
        issueId: "issue-3",
        projectId: "project-1",
        issueStatus: "todo",
        workflowState: "assigned",
      }),
      loadMessages: async () => new Map([
        ["msg-assign-1", {
          id: "msg-assign-1",
          ...makeMessage({
            messageType: "ASSIGN_TASK",
            sender: {
              actorType: "user",
              actorId: "board-1",
              role: "human_board",
            },
            recipients: [
              {
                recipientType: "agent",
                recipientId: "lead-1",
                role: "tech_lead",
              },
            ],
            workflowStateBefore: "backlog",
            workflowStateAfter: "assigned",
            summary: "Assign to TL",
            payload: {
              assigneeAgentId: "lead-1",
            },
          }),
        }],
      ]),
      hasDispatchEvidence: async () => false,
      dispatchMessage,
      loadIssueContext: async () => null,
      applyPreRetrievalReroute,
      markOutboxNoAction,
      markOutboxDispatched,
    });

    const result = await service.reconcilePendingDispatches();

    expect(applyPreRetrievalReroute).toHaveBeenCalledTimes(1);
    expect(markOutboxNoAction).toHaveBeenCalledWith({
      protocolMessageId: "msg-assign-1",
      dispatchResult: {
        reason: "rerouted_before_retrieval",
        rerouteProtocolMessageId: "msg-reroute-1",
      },
    });
    expect(dispatchMessage).toHaveBeenCalledWith(expect.objectContaining({
      protocolMessageId: "msg-reroute-1",
      message: expect.objectContaining({
        messageType: "REASSIGN_TASK",
      }),
      actor: expect.objectContaining({
        actorId: "lead-1",
      }),
    }));
    expect(markOutboxDispatched).toHaveBeenCalledWith({
      protocolMessageId: "msg-reroute-1",
      dispatchResult: expect.objectContaining({
        reason: "reconciled_dispatch",
      }),
    });
    expect(result.reconciled).toBe(1);
  });

  it("settles no-action for tracked messages that no longer have wake targets", async () => {
    const dispatchMessage = vi.fn();
    const markOutboxNoAction = vi.fn().mockResolvedValue(undefined);

    const service = protocolDispatchReconciliationService({} as never, {
      listPendingOutboxEntries: async () => [{
        id: "outbox-4",
        companyId: "company-1",
        issueId: "issue-4",
        protocolMessageId: "msg-4",
        status: "pending",
        attemptCount: 0,
        notBefore: new Date("2026-03-22T00:00:00.000Z"),
        lastAttemptAt: null,
        dispatchedAt: null,
        settledAt: null,
        lastError: null,
        dispatchResult: {},
        createdAt: new Date("2026-03-22T00:00:00.000Z"),
        updatedAt: new Date("2026-03-22T00:00:00.000Z"),
      }],
      listLegacyCandidates: async () => [],
      loadIssueSnapshot: async () => makeIssueSnapshot({
        issueId: "issue-4",
        workflowState: "accepted",
      }),
      loadMessages: async () => new Map([
        ["msg-4", {
          id: "msg-4",
          ...makeMessage({
            messageType: "ANSWER_CLARIFICATION",
            sender: {
              actorType: "agent",
              actorId: "lead-1",
              role: "tech_lead",
            },
            recipients: [
              {
                recipientType: "agent",
                recipientId: "lead-1",
                role: "tech_lead",
              },
            ],
            workflowStateBefore: "waiting_for_clarification",
            workflowStateAfter: "accepted",
            summary: "Answered clarification",
          }),
        }],
      ]),
      hasDispatchEvidence: async () => false,
      dispatchMessage,
      loadIssueContext: async () => null,
      markOutboxNoAction,
    });

    const result = await service.reconcilePendingDispatches();

    expect(dispatchMessage).not.toHaveBeenCalled();
    expect(markOutboxNoAction).toHaveBeenCalledWith({
      protocolMessageId: "msg-4",
      dispatchResult: {
        reason: "no_wakeup_targets",
      },
    });
    expect(result).toMatchObject({
      reconciled: 0,
      settledNoAction: 1,
      skippedNoWakeTargets: 1,
    });
  });
});
