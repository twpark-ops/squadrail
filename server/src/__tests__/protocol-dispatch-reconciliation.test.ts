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

describe("protocol dispatch reconciliation service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("re-dispatches the latest protocol message when no active evidence exists", async () => {
    const dispatchMessage = vi.fn().mockResolvedValue({
      queued: 1,
      notifyOnly: 0,
      skipped: 0,
    });
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
      listCandidates: async () => [{
        issueId: "issue-1",
        companyId: "company-1",
        projectId: null,
        issueStatus: "in_progress",
        workflowState: "submitted_for_review",
        lastProtocolMessageId: "msg-1",
        blockedByMessageId: null,
      }],
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
    expect(result).toMatchObject({
      scanned: 1,
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

  it("skips reconciliation when active dispatch evidence already exists", async () => {
    const dispatchMessage = vi.fn();

    const service = protocolDispatchReconciliationService({} as never, {
      listCandidates: async () => [{
        issueId: "issue-2",
        companyId: "company-1",
        projectId: null,
        issueStatus: "in_progress",
        workflowState: "submitted_for_review",
        lastProtocolMessageId: "msg-2",
        blockedByMessageId: null,
      }],
      loadMessages: async () => new Map([
        ["msg-2", {
          id: "msg-2",
          ...makeMessage(),
        }],
      ]),
      hasDispatchEvidence: async () => true,
      dispatchMessage,
      loadIssueContext: async () => null,
    });

    const result = await service.reconcilePendingDispatches();

    expect(dispatchMessage).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      scanned: 1,
      reconciled: 0,
      skippedWithEvidence: 1,
    });
  });

  it("preserves pre-retrieval reroute semantics for local-trusted assignment messages", async () => {
    const dispatchMessage = vi.fn().mockResolvedValue({
      queued: 1,
      notifyOnly: 0,
      skipped: 0,
    });
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
      listCandidates: async () => [{
        issueId: "issue-3",
        companyId: "company-1",
        projectId: "project-1",
        issueStatus: "todo",
        workflowState: "assigned",
        lastProtocolMessageId: "msg-assign-1",
        blockedByMessageId: null,
      }],
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
    });

    const result = await service.reconcilePendingDispatches();

    expect(applyPreRetrievalReroute).toHaveBeenCalledTimes(1);
    expect(dispatchMessage).toHaveBeenCalledWith(expect.objectContaining({
      protocolMessageId: "msg-reroute-1",
      message: expect.objectContaining({
        messageType: "REASSIGN_TASK",
      }),
      actor: expect.objectContaining({
        actorId: "lead-1",
      }),
    }));
    expect(result.reconciled).toBe(1);
  });

  it("skips messages that no longer have wake targets", async () => {
    const dispatchMessage = vi.fn();

    const service = protocolDispatchReconciliationService({} as never, {
      listCandidates: async () => [{
        issueId: "issue-4",
        companyId: "company-1",
        projectId: null,
        issueStatus: "in_progress",
        workflowState: "accepted",
        lastProtocolMessageId: "msg-4",
        blockedByMessageId: null,
      }],
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
    });

    const result = await service.reconcilePendingDispatches();

    expect(dispatchMessage).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      reconciled: 0,
      skippedNoWakeTargets: 1,
    });
  });
});
