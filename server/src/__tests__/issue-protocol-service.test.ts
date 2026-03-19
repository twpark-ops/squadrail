import {
  issueComments,
  issueProtocolMessages,
  issueProtocolRecipients,
  issueProtocolState,
  issueProtocolThreads,
  issueProtocolViolations,
  issueReviewCycles,
  issues,
} from "@squadrail/db";
import { describe, expect, it, vi } from "vitest";
import { issueProtocolService } from "../services/issue-protocol.js";

vi.mock("../services/issue-dependency-graph.js", () => ({
  resolveIssueDependencyGraphMetadata: vi.fn().mockResolvedValue(null),
}));

vi.mock("../services/issue-protocol-policy.js", () => ({
  evaluateProtocolEvidenceRequirement: vi.fn().mockReturnValue(null),
}));

vi.mock("../services/failure-learning.js", () => ({
  summarizeIssueFailureLearning: vi.fn().mockResolvedValue(null),
}));

vi.mock("../services/merge-candidate-gates.js", () => ({
  buildMergeCandidateGateStatus: vi.fn().mockReturnValue(null),
  buildMergeCandidatePrBridge: vi.fn().mockReturnValue(null),
  mergeCandidateRequiresGateEnforcement: vi.fn().mockReturnValue(false),
}));

function createResolvedChain(rows: unknown[]) {
  const chain = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    innerJoin: () => chain,
    leftJoin: () => chain,
    for: () => chain,
    then: <T>(resolve: (value: unknown[]) => T | PromiseLike<T>) =>
      Promise.resolve(rows).then(resolve),
  };
  return chain;
}

function createIssueProtocolDbMock(input: {
  selectResults?: unknown[][];
  insertResults?: Array<unknown[] | Error>;
  updateResults?: Array<unknown[] | Error>;
}) {
  const selectQueue = [...(input.selectResults ?? [])];
  const insertQueue = [...(input.insertResults ?? [])];
  const updateQueue = [...(input.updateResults ?? [])];
  const insertValues: Array<{ table: unknown; value: unknown }> = [];
  const updateValues: Array<{ table: unknown; value: unknown }> = [];

  function nextMutationResult(queue: Array<unknown[] | Error>) {
    const next = queue.shift();
    if (next instanceof Error) throw next;
    return {
      returning: async () => next ?? [],
      then: <T>(resolve: (value: undefined) => T | PromiseLike<T>) => Promise.resolve(undefined).then(resolve),
    };
  }

  const db = {
    select: () => createResolvedChain(selectQueue.shift() ?? []),
    insert: (table: unknown) => ({
      values: (value: unknown) => {
        insertValues.push({ table, value });
        return nextMutationResult(insertQueue);
      },
    }),
    update: (table: unknown) => ({
      set: (value: unknown) => {
        updateValues.push({ table, value });
        return {
          where: () => nextMutationResult(updateQueue),
        };
      },
    }),
    transaction: async <T>(callback: (tx: typeof db) => Promise<T>) => callback(db),
  };

  return {
    db,
    insertValues,
    updateValues,
  };
}

describe("issue protocol service", () => {
  it("returns the current protocol state for an issue", async () => {
    const { db } = createIssueProtocolDbMock({
      selectResults: [[{
        issueId: "issue-1",
        workflowState: "implementing",
        reviewerAgentId: "rev-1",
      }]],
    });
    const service = issueProtocolService(db as never);

    const state = await service.getState("issue-1");

    expect(state).toMatchObject({
      issueId: "issue-1",
      workflowState: "implementing",
      reviewerAgentId: "rev-1",
    });
  });

  it("lists review cycles in descending cycle order", async () => {
    const { db } = createIssueProtocolDbMock({
      selectResults: [[
        {
          id: "cycle-2",
          issueId: "issue-1",
          cycleNumber: 2,
          openedAt: new Date("2026-03-13T10:00:00.000Z"),
        },
        {
          id: "cycle-1",
          issueId: "issue-1",
          cycleNumber: 1,
          openedAt: new Date("2026-03-12T10:00:00.000Z"),
        },
      ]],
    });
    const service = issueProtocolService(db as never);

    const cycles = await service.listReviewCycles("issue-1");

    expect(cycles).toEqual([
      expect.objectContaining({ id: "cycle-2", cycleNumber: 2 }),
      expect.objectContaining({ id: "cycle-1", cycleNumber: 1 }),
    ]);
  });

  it("filters protocol violations by status", async () => {
    const { db } = createIssueProtocolDbMock({
      selectResults: [[
        {
          id: "violation-1",
          issueId: "issue-1",
          status: "open",
          violationCode: "close_without_verification",
        },
      ]],
    });
    const service = issueProtocolService(db as never);

    const violations = await service.listViolations({
      issueId: "issue-1",
      status: "open",
    });

    expect(violations).toEqual([
      expect.objectContaining({
        id: "violation-1",
        status: "open",
        violationCode: "close_without_verification",
      }),
    ]);
  });

  it("hydrates protocol messages with recipients, artifacts, and legacy integrity status", async () => {
    const { db } = createIssueProtocolDbMock({
      selectResults: [
        [
          {
            id: "message-1",
            issueId: "issue-1",
            seq: 1,
            messageType: "NOTE",
            senderActorType: "agent",
            senderActorId: "lead-1",
            senderRole: "tech_lead",
            workflowStateBefore: "blocked",
            workflowStateAfter: "blocked",
            summary: "Capture blocker context",
            payload: {
              noteType: "context",
              body: "Need dependency issue to land.",
            },
            integrityAlgorithm: null,
            integritySignature: null,
            previousIntegritySignature: null,
          },
        ],
        [
          {
            id: "recipient-1",
            messageId: "message-1",
            recipientType: "agent",
            recipientId: "eng-1",
            recipientRole: "engineer",
          },
        ],
        [
          {
            id: "artifact-1",
            messageId: "message-1",
            artifactKind: "log",
            artifactUri: "file:///tmp/run.log",
            label: "Runtime log",
            metadata: { lines: 20 },
          },
        ],
      ],
    });
    const service = issueProtocolService(db as never);

    const messages = await service.listMessages("issue-1");

    expect(messages).toEqual([
      expect.objectContaining({
        id: "message-1",
        integrityStatus: "legacy_unsealed",
        sender: {
          actorType: "agent",
          actorId: "lead-1",
          role: "tech_lead",
        },
        recipients: [
          {
            recipientType: "agent",
            recipientId: "eng-1",
            role: "engineer",
          },
        ],
        artifacts: [
          {
            kind: "log",
            uri: "file:///tmp/run.log",
            label: "Runtime log",
            metadata: { lines: 20 },
          },
        ],
      }),
    ]);
  });

  it("returns an empty protocol timeline when the issue has no messages yet", async () => {
    const { db } = createIssueProtocolDbMock({
      selectResults: [[]],
    });
    const service = issueProtocolService(db as never);

    const messages = await service.listMessages("issue-empty");

    expect(messages).toEqual([]);
  });

  it("creates a protocol violation with the issue company context", async () => {
    const { db, insertValues } = createIssueProtocolDbMock({
      selectResults: [[{
        id: "issue-1",
        companyId: "company-1",
      }]],
      insertResults: [[{
        id: "violation-1",
        issueId: "issue-1",
        companyId: "company-1",
        violationCode: "close_without_verification",
        status: "open",
      }]],
    });
    const service = issueProtocolService(db as never);

    const violation = await service.createViolation({
      issueId: "issue-1",
      violation: {
        threadId: null,
        messageId: "message-1",
        violationCode: "close_without_verification",
        severity: "high",
        detectedByActorType: "system",
        detectedByActorId: "protocol-gate",
        status: "open",
        details: { reason: "Missing verification summary" },
      },
    });

    expect(violation).toMatchObject({
      id: "violation-1",
      issueId: "issue-1",
      companyId: "company-1",
      violationCode: "close_without_verification",
    });
    expect(insertValues).toContainEqual({
      table: issueProtocolViolations,
      value: expect.objectContaining({
        companyId: "company-1",
        issueId: "issue-1",
        messageId: "message-1",
        violationCode: "close_without_verification",
      }),
    });
  });

  it("rejects protocol violations for missing issues", async () => {
    const { db, insertValues } = createIssueProtocolDbMock({
      selectResults: [[]],
    });
    const service = issueProtocolService(db as never);

    await expect(service.createViolation({
      issueId: "issue-missing",
      violation: {
        threadId: null,
        messageId: null,
        violationCode: "close_without_verification",
        severity: "high",
        detectedByActorType: "system",
        detectedByActorId: "protocol-gate",
        status: "open",
        details: {},
      },
    })).rejects.toThrow("Issue not found");

    expect(insertValues).toHaveLength(0);
  });

  it("reopens a terminal protocol state into assigned delivery state for recovery", async () => {
    const issue = {
      id: "issue-1",
      companyId: "company-1",
      identifier: "CLO-900",
      title: "Rolled back issue",
      description: null,
      status: "done",
      priority: "high",
      assigneeAgentId: "eng-1",
      completedAt: new Date("2026-03-13T08:00:00.000Z"),
      cancelledAt: null,
      checkoutRunId: "run-1",
    };
    const currentState = {
      issueId: "issue-1",
      companyId: "company-1",
      workflowState: "done",
      coarseIssueStatus: "done",
      techLeadAgentId: "lead-1",
      primaryEngineerAgentId: "eng-1",
      reviewerAgentId: "rev-1",
      qaAgentId: null,
      currentReviewCycle: 1,
      lastProtocolMessageId: "close-1",
      lastTransitionAt: new Date("2026-03-13T08:00:00.000Z"),
      blockedPhase: null,
      blockedCode: null,
      blockedByMessageId: null,
      metadata: {},
    };
    const updatedState = {
      ...currentState,
      workflowState: "assigned",
      coarseIssueStatus: "todo",
      metadata: {
        recoveryReopen: {
          lastReopenedAt: "2026-03-13T09:00:00.000Z",
          reopenedFromWorkflowState: "done",
        },
      },
    };
    const reopenedIssue = {
      ...issue,
      status: "todo",
      completedAt: null,
      checkoutRunId: null,
      assigneeUserId: null,
    };
    const { db, updateValues } = createIssueProtocolDbMock({
      selectResults: [[issue], [currentState]],
      updateResults: [[updatedState], [reopenedIssue]],
    });
    const service = issueProtocolService(db as never);

    const reopened = await service.reopenForRecovery("issue-1");

    expect(reopened).toMatchObject({
      issue: expect.objectContaining({
        id: "issue-1",
        status: "todo",
      }),
      reopenedFromWorkflowState: "done",
      nextWorkflowState: "assigned",
      wakeAssigneeAgentId: "eng-1",
    });
    expect(updateValues).toContainEqual({
      table: expect.anything(),
      value: expect.objectContaining({
        workflowState: "assigned",
        coarseIssueStatus: "todo",
        blockedPhase: null,
        blockedCode: null,
      }),
    });
    expect(updateValues).toContainEqual({
      table: expect.anything(),
      value: expect.objectContaining({
        status: "todo",
        completedAt: null,
        cancelledAt: null,
        checkoutRunId: null,
        assigneeAgentId: "eng-1",
        assigneeUserId: null,
      }),
    });
  });

  it("rejects recovery reopen when the protocol is not terminal", async () => {
    const { db } = createIssueProtocolDbMock({
      selectResults: [[{
        id: "issue-1",
        companyId: "company-1",
        status: "in_review",
      }], [{
        issueId: "issue-1",
        companyId: "company-1",
        workflowState: "under_review",
        metadata: {},
      }]],
    });
    const service = issueProtocolService(db as never);

    await expect(service.reopenForRecovery("issue-1")).rejects.toThrow("Issue protocol is not in a terminal state");
  });

  it("answers a blocked human clarification request, acks the question, and resumes execution", async () => {
    const issue = {
      id: "issue-clarify",
      companyId: "company-1",
      projectId: null,
      assigneeAgentId: "eng-1",
      status: "blocked",
    };
    const currentState = {
      issueId: "issue-clarify",
      companyId: "company-1",
      workflowState: "blocked",
      coarseIssueStatus: "blocked",
      techLeadAgentId: "lead-1",
      primaryEngineerAgentId: "eng-1",
      reviewerAgentId: "rev-1",
      qaAgentId: null,
      currentReviewCycle: 1,
      blockedPhase: "implementing",
      blockedCode: "human_clarification",
      blockedByMessageId: "question-1",
      metadata: {},
    };
    const thread = {
      id: "thread-clarify",
      issueId: "issue-clarify",
      companyId: "company-1",
      threadType: "primary",
      title: "Primary protocol thread",
    };
    const lastMessage = {
      id: "message-3",
      issueId: "issue-clarify",
      threadId: "thread-clarify",
      seq: 3,
      integritySignature: null,
    };
    const clarificationMessage = {
      id: "question-1",
      issueId: "issue-clarify",
      threadId: "thread-clarify",
      seq: 2,
      messageType: "ASK_CLARIFICATION",
      senderActorType: "agent",
      senderActorId: "eng-1",
      senderRole: "engineer",
      ackedAt: null,
      payload: {
        questionType: "requirement",
        question: "Which project should own this request?",
        blocking: true,
        requestedFrom: "human_board",
        resumeWorkflowState: "implementing",
      },
    };
    const createdMessage = {
      id: "message-4",
      issueId: "issue-clarify",
      threadId: "thread-clarify",
      seq: 4,
      messageType: "ANSWER_CLARIFICATION",
      senderActorType: "user",
      senderActorId: "board-1",
      senderRole: "human_board",
      workflowStateBefore: "blocked",
      workflowStateAfter: "implementing",
      summary: "Board answered clarification",
      payload: {
        answer: "Use the swiftsight-cloud project.",
        nextStep: "Resume routing through the cloud TL lane.",
      },
      integritySignature: null,
    };
    const sealedMessage = {
      ...createdMessage,
      payloadSha256: "sha",
      previousIntegritySignature: null,
      integrityAlgorithm: "sha256:hmac-v1",
      integritySignature: "sig-1",
    };
    const { db, insertValues, updateValues } = createIssueProtocolDbMock({
      selectResults: [
        [issue],
        [currentState],
        [clarificationMessage],
        [thread],
        [lastMessage],
      ],
      insertResults: [[createdMessage], [], []],
      updateResults: [[sealedMessage], [], [], []],
    });
    const service = issueProtocolService(db as never);

    const appended = await service.appendMessage({
      issueId: "issue-clarify",
      authorUserId: "board-1",
      message: {
        messageType: "ANSWER_CLARIFICATION",
        sender: {
          actorType: "user",
          actorId: "board-1",
          role: "human_board",
        },
        recipients: [
          {
            recipientType: "agent",
            recipientId: "eng-1",
            role: "engineer",
          },
        ],
        workflowStateBefore: "blocked",
        workflowStateAfter: "blocked",
        summary: "Board answered clarification",
        causalMessageId: "question-1",
        payload: {
          answer: "Use the swiftsight-cloud project.",
          nextStep: "Resume routing through the cloud TL lane.",
        },
        artifacts: [],
      },
    });

    expect(appended.message).toMatchObject({
      id: "message-4",
      messageType: "ANSWER_CLARIFICATION",
      integrityStatus: "verified",
    });
    expect(appended.state).toMatchObject({
      workflowState: "implementing",
      coarseIssueStatus: "in_progress",
      blockedPhase: null,
      blockedCode: null,
      blockedByMessageId: null,
    });
    expect(insertValues).toContainEqual({
      table: issueProtocolRecipients,
      value: [
        {
          companyId: "company-1",
          messageId: "message-4",
          recipientType: "agent",
          recipientId: "eng-1",
          recipientRole: "engineer",
        },
      ],
    });
    expect(updateValues).toContainEqual({
      table: issueProtocolMessages,
      value: expect.objectContaining({
        ackedAt: expect.any(Date),
      }),
    });
  });

  it("rejects clarification answers from the wrong actor role", async () => {
    const issue = {
      id: "issue-clarify-2",
      companyId: "company-1",
      projectId: null,
      assigneeAgentId: "eng-1",
      status: "in_progress",
    };
    const currentState = {
      issueId: "issue-clarify-2",
      companyId: "company-1",
      workflowState: "implementing",
      coarseIssueStatus: "in_progress",
      techLeadAgentId: "lead-1",
      primaryEngineerAgentId: "eng-1",
      reviewerAgentId: "rev-1",
      qaAgentId: null,
      currentReviewCycle: 1,
      metadata: {},
    };
    const clarificationMessage = {
      id: "question-2",
      issueId: "issue-clarify-2",
      messageType: "ASK_CLARIFICATION",
      senderActorType: "agent",
      senderActorId: "rev-1",
      senderRole: "reviewer",
      ackedAt: null,
      payload: {
        questionType: "review_feedback",
        question: "Should QA review this before close?",
        blocking: true,
        requestedFrom: "reviewer",
      },
    };
    const { db } = createIssueProtocolDbMock({
      selectResults: [
        [issue],
        [currentState],
        [clarificationMessage],
      ],
    });
    const service = issueProtocolService(db as never);

    await expect(service.appendMessage({
      issueId: "issue-clarify-2",
      authorUserId: "board-1",
      message: {
        messageType: "ANSWER_CLARIFICATION",
        sender: {
          actorType: "user",
          actorId: "board-1",
          role: "human_board",
        },
        recipients: [
          {
            recipientType: "agent",
            recipientId: "eng-1",
            role: "engineer",
          },
        ],
        workflowStateBefore: "implementing",
        workflowStateAfter: "implementing",
        summary: "Board answered clarification",
        causalMessageId: "question-2",
        payload: {
          answer: "Yes, keep QA in the loop.",
        },
        artifacts: [],
      },
    })).rejects.toThrow("Clarification answer must be sent by the requested reviewer actor");
  });

  it("keeps implementation state when a reassignment reaffirms the active engineer", async () => {
    const issue = {
      id: "issue-reassign-implementing",
      companyId: "company-1",
      projectId: null,
      assigneeAgentId: "eng-1",
      status: "in_progress",
    };
    const currentState = {
      issueId: "issue-reassign-implementing",
      companyId: "company-1",
      workflowState: "implementing",
      coarseIssueStatus: "in_progress",
      techLeadAgentId: "lead-1",
      primaryEngineerAgentId: "eng-1",
      reviewerAgentId: "rev-1",
      qaAgentId: null,
      currentReviewCycle: 0,
      metadata: {},
    };
    const thread = {
      id: "thread-reassign-implementing",
      issueId: "issue-reassign-implementing",
      companyId: "company-1",
      threadType: "primary",
      title: "Primary protocol thread",
    };
    const lastMessage = {
      id: "message-reassign-implementing-1",
      issueId: "issue-reassign-implementing",
      threadId: "thread-reassign-implementing",
      seq: 1,
      integritySignature: null,
    };
    const createdMessage = {
      id: "message-reassign-implementing-2",
      issueId: "issue-reassign-implementing",
      threadId: "thread-reassign-implementing",
      seq: 2,
      messageType: "REASSIGN_TASK",
      senderActorType: "agent",
      senderActorId: "lead-1",
      senderRole: "tech_lead",
      workflowStateBefore: "implementing",
      workflowStateAfter: "implementing",
      summary: "Keep implementation on the already active engineer",
      payload: {
        reason: "Reconfirm the staffed engineer without regressing the active implementation lane.",
        newAssigneeAgentId: "eng-1",
        newReviewerAgentId: "rev-1",
      },
      integritySignature: null,
    };
    const sealedMessage = {
      ...createdMessage,
      payloadSha256: "sha",
      previousIntegritySignature: null,
      integrityAlgorithm: "sha256:hmac-v1",
      integritySignature: "sig-reassign-implementing",
    };
    const { db, insertValues, updateValues } = createIssueProtocolDbMock({
      selectResults: [
        [issue],
        [currentState],
        [thread],
        [lastMessage],
      ],
      insertResults: [[createdMessage], [], []],
      updateResults: [[sealedMessage], [], []],
    });
    const service = issueProtocolService(db as never);

    const appended = await service.appendMessage({
      issueId: "issue-reassign-implementing",
      authorAgentId: "lead-1",
      message: {
        messageType: "REASSIGN_TASK",
        sender: {
          actorType: "agent",
          actorId: "lead-1",
          role: "tech_lead",
        },
        recipients: [
          {
            recipientType: "agent",
            recipientId: "eng-1",
            role: "engineer",
          },
          {
            recipientType: "agent",
            recipientId: "rev-1",
            role: "reviewer",
          },
        ],
        workflowStateBefore: "implementing",
        workflowStateAfter: "assigned",
        summary: "Keep implementation on the already active engineer",
        payload: {
          reason: "Reconfirm the staffed engineer without regressing the active implementation lane.",
          newAssigneeAgentId: "eng-1",
          newReviewerAgentId: "rev-1",
        },
        artifacts: [],
      },
    });

    expect(appended.state).toMatchObject({
      workflowState: "implementing",
      coarseIssueStatus: "in_progress",
      primaryEngineerAgentId: "eng-1",
      techLeadAgentId: "lead-1",
      reviewerAgentId: "rev-1",
    });
    expect(insertValues).toContainEqual({
      table: issueProtocolMessages,
      value: expect.objectContaining({
        workflowStateBefore: "implementing",
        workflowStateAfter: "implementing",
      }),
    });
    expect(updateValues).toContainEqual({
      table: issueProtocolState,
      value: expect.objectContaining({
        workflowState: "implementing",
        coarseIssueStatus: "in_progress",
      }),
    });
  });

  it("binds the tech lead into primary engineer ownership when direct implementation starts", async () => {
    const issue = {
      id: "issue-direct-tl-start",
      companyId: "company-1",
      projectId: null,
      assigneeAgentId: "lead-1",
      status: "todo",
    };
    const currentState = {
      issueId: "issue-direct-tl-start",
      companyId: "company-1",
      workflowState: "accepted",
      coarseIssueStatus: "todo",
      techLeadAgentId: "lead-1",
      primaryEngineerAgentId: null,
      reviewerAgentId: "rev-1",
      qaAgentId: null,
      currentReviewCycle: 0,
      metadata: {},
    };
    const thread = {
      id: "thread-direct-tl-start",
      issueId: "issue-direct-tl-start",
      companyId: "company-1",
      threadType: "primary",
      title: "Primary protocol thread",
    };
    const lastMessage = {
      id: "message-direct-tl-start-1",
      issueId: "issue-direct-tl-start",
      threadId: "thread-direct-tl-start",
      seq: 1,
      integritySignature: null,
    };
    const createdMessage = {
      id: "message-direct-tl-start-2",
      issueId: "issue-direct-tl-start",
      threadId: "thread-direct-tl-start",
      seq: 2,
      messageType: "START_IMPLEMENTATION",
      senderActorType: "agent",
      senderActorId: "lead-1",
      senderRole: "engineer",
      workflowStateBefore: "accepted",
      workflowStateAfter: "implementing",
      summary: "Tech lead starts direct implementation",
      payload: {
        implementationMode: "direct",
      },
      integritySignature: null,
    };
    const sealedMessage = {
      ...createdMessage,
      payloadSha256: "sha",
      previousIntegritySignature: null,
      integrityAlgorithm: "sha256:hmac-v1",
      integritySignature: "sig-direct-tl-start",
    };
    const { db, updateValues } = createIssueProtocolDbMock({
      selectResults: [
        [issue],
        [currentState],
        [thread],
        [lastMessage],
      ],
      insertResults: [[createdMessage], [], []],
      updateResults: [[sealedMessage], [], []],
    });
    const service = issueProtocolService(db as never);

    const appended = await service.appendMessage({
      issueId: "issue-direct-tl-start",
      authorAgentId: "lead-1",
      message: {
        messageType: "START_IMPLEMENTATION",
        sender: {
          actorType: "agent",
          actorId: "lead-1",
          role: "engineer",
        },
        recipients: [
          {
            recipientType: "agent",
            recipientId: "lead-1",
            role: "engineer",
          },
        ],
        workflowStateBefore: "accepted",
        workflowStateAfter: "implementing",
        summary: "Tech lead starts direct implementation",
        payload: {
          implementationMode: "direct",
        },
        artifacts: [],
      },
    });

    expect(appended.state).toMatchObject({
      workflowState: "implementing",
      techLeadAgentId: "lead-1",
      primaryEngineerAgentId: "lead-1",
      reviewerAgentId: "rev-1",
    });
    expect(updateValues).toContainEqual({
      table: issueProtocolState,
      value: expect.objectContaining({
        workflowState: "implementing",
        primaryEngineerAgentId: "lead-1",
      }),
    });
  });

  it("allows reassignment from changes_requested so a missing engineer can resume the review loop", async () => {
    const issue = {
      id: "issue-changes-reassign",
      companyId: "company-1",
      projectId: null,
      assigneeAgentId: "lead-1",
      status: "in_review",
    };
    const currentState = {
      issueId: "issue-changes-reassign",
      companyId: "company-1",
      workflowState: "changes_requested",
      coarseIssueStatus: "in_review",
      techLeadAgentId: "lead-1",
      primaryEngineerAgentId: null,
      reviewerAgentId: "rev-1",
      qaAgentId: null,
      currentReviewCycle: 1,
      metadata: {},
    };
    const thread = {
      id: "thread-changes-reassign",
      issueId: "issue-changes-reassign",
      companyId: "company-1",
      threadType: "primary",
      title: "Primary protocol thread",
    };
    const lastMessage = {
      id: "message-changes-reassign-1",
      issueId: "issue-changes-reassign",
      threadId: "thread-changes-reassign",
      seq: 7,
      integritySignature: null,
    };
    const createdMessage = {
      id: "message-changes-reassign-2",
      issueId: "issue-changes-reassign",
      threadId: "thread-changes-reassign",
      seq: 8,
      messageType: "REASSIGN_TASK",
      senderActorType: "agent",
      senderActorId: "lead-1",
      senderRole: "tech_lead",
      workflowStateBefore: "changes_requested",
      workflowStateAfter: "assigned",
      summary: "Assign an engineer to address requested changes",
      payload: {
        reason: "Resume implementation after review changes were requested.",
        newAssigneeAgentId: "eng-2",
        newReviewerAgentId: "rev-1",
      },
      integritySignature: null,
    };
    const sealedMessage = {
      ...createdMessage,
      payloadSha256: "sha",
      previousIntegritySignature: null,
      integrityAlgorithm: "sha256:hmac-v1",
      integritySignature: "sig-changes-reassign",
    };
    const { db, updateValues } = createIssueProtocolDbMock({
      selectResults: [
        [issue],
        [currentState],
        [thread],
        [lastMessage],
      ],
      insertResults: [[createdMessage], [], []],
      updateResults: [[sealedMessage], [], []],
    });
    const service = issueProtocolService(db as never);

    const appended = await service.appendMessage({
      issueId: "issue-changes-reassign",
      authorAgentId: "lead-1",
      message: {
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
          {
            recipientType: "agent",
            recipientId: "rev-1",
            role: "reviewer",
          },
        ],
        workflowStateBefore: "changes_requested",
        workflowStateAfter: "assigned",
        summary: "Assign an engineer to address requested changes",
        payload: {
          reason: "Resume implementation after review changes were requested.",
          newAssigneeAgentId: "eng-2",
          newReviewerAgentId: "rev-1",
        },
        artifacts: [],
      },
    });

    expect(appended.state).toMatchObject({
      workflowState: "assigned",
      coarseIssueStatus: "todo",
      techLeadAgentId: "lead-1",
      primaryEngineerAgentId: "eng-2",
      reviewerAgentId: "rev-1",
    });
    expect(updateValues).toContainEqual({
      table: issueProtocolState,
      value: expect.objectContaining({
        workflowState: "assigned",
        primaryEngineerAgentId: "eng-2",
      }),
    });
  });

  it("keeps the direct TL owner when ACK_CHANGE_REQUEST resumes changes_requested work", async () => {
    const issue = {
      id: "issue-direct-recovery",
      companyId: "company-1",
      projectId: null,
      assigneeAgentId: "lead-1",
      status: "in_review",
    };
    const currentState = {
      issueId: "issue-direct-recovery",
      companyId: "company-1",
      workflowState: "changes_requested",
      coarseIssueStatus: "in_review",
      techLeadAgentId: "lead-1",
      primaryEngineerAgentId: "lead-1",
      reviewerAgentId: "rev-1",
      qaAgentId: null,
      currentReviewCycle: 1,
      metadata: {},
    };
    const thread = {
      id: "thread-direct-recovery",
      issueId: "issue-direct-recovery",
      companyId: "company-1",
      threadType: "primary",
      title: "Primary protocol thread",
    };
    const lastMessage = {
      id: "message-direct-recovery-1",
      issueId: "issue-direct-recovery",
      threadId: "thread-direct-recovery",
      seq: 9,
      integritySignature: null,
    };
    const createdMessage = {
      id: "message-direct-recovery-2",
      issueId: "issue-direct-recovery",
      threadId: "thread-direct-recovery",
      seq: 10,
      messageType: "ACK_CHANGE_REQUEST",
      senderActorType: "agent",
      senderActorId: "lead-1",
      senderRole: "engineer",
      workflowStateBefore: "changes_requested",
      workflowStateAfter: "implementing",
      summary: "Direct owner acknowledges requested changes",
      payload: {
        changeRequestIds: ["req-1"],
        plannedFixOrder: ["refresh evidence", "resubmit focused review"],
      },
      integritySignature: null,
    };
    const sealedMessage = {
      ...createdMessage,
      payloadSha256: "sha",
      previousIntegritySignature: null,
      integrityAlgorithm: "sha256:hmac-v1",
      integritySignature: "sig-direct-recovery",
    };
    const { db, updateValues } = createIssueProtocolDbMock({
      selectResults: [
        [issue],
        [currentState],
        [thread],
        [lastMessage],
      ],
      insertResults: [[createdMessage], [], []],
      updateResults: [[sealedMessage], [], []],
    });
    const service = issueProtocolService(db as never);

    const appended = await service.appendMessage({
      issueId: "issue-direct-recovery",
      authorAgentId: "lead-1",
      message: {
        messageType: "ACK_CHANGE_REQUEST",
        sender: {
          actorType: "agent",
          actorId: "lead-1",
          role: "engineer",
        },
        recipients: [
          {
            recipientType: "agent",
            recipientId: "lead-1",
            role: "engineer",
          },
          {
            recipientType: "agent",
            recipientId: "rev-1",
            role: "reviewer",
          },
        ],
        workflowStateBefore: "changes_requested",
        workflowStateAfter: "implementing",
        summary: "Direct owner acknowledges requested changes",
        payload: {
          changeRequestIds: ["req-1"],
          plannedFixOrder: ["refresh evidence", "resubmit focused review"],
        },
        artifacts: [],
      },
    });

    expect(appended.state).toMatchObject({
      workflowState: "implementing",
      coarseIssueStatus: "in_progress",
      techLeadAgentId: "lead-1",
      primaryEngineerAgentId: "lead-1",
      reviewerAgentId: "rev-1",
    });
    expect(updateValues).toContainEqual({
      table: issueProtocolState,
      value: expect.objectContaining({
        workflowState: "implementing",
        primaryEngineerAgentId: "lead-1",
      }),
    });
  });

  it("rejects reassignment back to the tech lead after implementation has started", async () => {
    const issue = {
      id: "issue-reassign-to-lead",
      companyId: "company-1",
      projectId: null,
      assigneeAgentId: "eng-1",
      status: "in_progress",
    };
    const currentState = {
      issueId: "issue-reassign-to-lead",
      companyId: "company-1",
      workflowState: "implementing",
      coarseIssueStatus: "in_progress",
      techLeadAgentId: "lead-1",
      primaryEngineerAgentId: "eng-1",
      reviewerAgentId: "rev-1",
      qaAgentId: null,
      currentReviewCycle: 0,
      metadata: {},
    };
    const { db } = createIssueProtocolDbMock({
      selectResults: [
        [issue],
        [currentState],
      ],
    });
    const service = issueProtocolService(db as never);

    await expect(service.appendMessage({
      issueId: "issue-reassign-to-lead",
      authorAgentId: "lead-1",
      message: {
        messageType: "REASSIGN_TASK",
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
          {
            recipientType: "agent",
            recipientId: "rev-1",
            role: "reviewer",
          },
        ],
        workflowStateBefore: "implementing",
        workflowStateAfter: "assigned",
        summary: "Attempt to send the active implementation back to the TL",
        payload: {
          reason: "Retrying staffing after implementation has already started.",
          newAssigneeAgentId: "lead-1",
          newReviewerAgentId: "rev-1",
        },
        artifacts: [],
      },
    })).rejects.toThrow("Cannot reassign an active implementation back to the tech lead");
  });

  it("keeps the staffed engineer when a PM retry reaffirms the same tech lead", async () => {
    const issue = {
      id: "issue-pm-retry-routing",
      companyId: "company-1",
      projectId: null,
      assigneeAgentId: "eng-1",
      status: "todo",
    };
    const currentState = {
      issueId: "issue-pm-retry-routing",
      companyId: "company-1",
      workflowState: "assigned",
      coarseIssueStatus: "todo",
      techLeadAgentId: "lead-1",
      primaryEngineerAgentId: "eng-1",
      reviewerAgentId: "rev-2",
      qaAgentId: "qa-1",
      currentReviewCycle: 0,
      metadata: {},
    };
    const thread = {
      id: "thread-pm-retry-routing",
      issueId: "issue-pm-retry-routing",
      companyId: "company-1",
      threadType: "primary",
      title: "Primary protocol thread",
    };
    const lastMessage = {
      id: "message-pm-retry-routing-3",
      issueId: "issue-pm-retry-routing",
      threadId: "thread-pm-retry-routing",
      seq: 3,
      integritySignature: null,
    };
    const createdMessage = {
      id: "message-pm-retry-routing-4",
      issueId: "issue-pm-retry-routing",
      threadId: "thread-pm-retry-routing",
      seq: 4,
      messageType: "REASSIGN_TASK",
      senderActorType: "agent",
      senderActorId: "pm-1",
      senderRole: "pm",
      workflowStateBefore: "assigned",
      workflowStateAfter: "assigned",
      summary: "PM retry reaffirms TL without undoing engineer staffing",
      payload: {
        reason: "Adapter retry wake from PM after TL already staffed engineer.",
        newAssigneeAgentId: "lead-1",
        newReviewerAgentId: "rev-1",
        newQaAgentId: "qa-2",
      },
      integritySignature: null,
    };
    const sealedMessage = {
      ...createdMessage,
      payloadSha256: "sha",
      previousIntegritySignature: null,
      integrityAlgorithm: "sha256:hmac-v1",
      integritySignature: "sig-pm-retry-routing",
    };
    const { db, updateValues } = createIssueProtocolDbMock({
      selectResults: [
        [issue],
        [currentState],
        [thread],
        [lastMessage],
      ],
      insertResults: [[createdMessage], [], []],
      updateResults: [[sealedMessage], [], []],
    });
    const service = issueProtocolService(db as never);

    const appended = await service.appendMessage({
      issueId: "issue-pm-retry-routing",
      authorAgentId: "pm-1",
      message: {
        messageType: "REASSIGN_TASK",
        sender: {
          actorType: "agent",
          actorId: "pm-1",
          role: "pm",
        },
        recipients: [
          {
            recipientType: "agent",
            recipientId: "lead-1",
            role: "tech_lead",
          },
          {
            recipientType: "agent",
            recipientId: "rev-1",
            role: "reviewer",
          },
          {
            recipientType: "agent",
            recipientId: "qa-2",
            role: "qa",
          },
        ],
        workflowStateBefore: "assigned",
        workflowStateAfter: "assigned",
        summary: "PM retry reaffirms TL without undoing engineer staffing",
        payload: {
          reason: "Adapter retry wake from PM after TL already staffed engineer.",
          newAssigneeAgentId: "lead-1",
          newReviewerAgentId: "rev-1",
          newQaAgentId: "qa-2",
        },
        artifacts: [],
      },
    });

    expect(appended.state).toMatchObject({
      workflowState: "assigned",
      coarseIssueStatus: "todo",
      techLeadAgentId: "lead-1",
      primaryEngineerAgentId: "eng-1",
      reviewerAgentId: "rev-2",
      qaAgentId: "qa-1",
    });
    expect(updateValues).toContainEqual({
      table: issueProtocolState,
      value: expect.objectContaining({
        techLeadAgentId: "lead-1",
        primaryEngineerAgentId: "eng-1",
        reviewerAgentId: "rev-2",
        qaAgentId: "qa-1",
      }),
    });
  });

  it("opens a review cycle when START_REVIEW is appended", async () => {
    const issue = {
      id: "issue-review",
      companyId: "company-1",
      projectId: null,
      assigneeAgentId: "eng-1",
    };
    const currentState = {
      issueId: "issue-review",
      companyId: "company-1",
      workflowState: "submitted_for_review",
      coarseIssueStatus: "in_review",
      techLeadAgentId: "lead-1",
      primaryEngineerAgentId: "eng-1",
      reviewerAgentId: "rev-1",
      qaAgentId: null,
      currentReviewCycle: 1,
      metadata: {},
    };
    const thread = {
      id: "thread-1",
      issueId: "issue-review",
      companyId: "company-1",
      threadType: "primary",
      title: "Primary protocol thread",
    };
    const lastMessage = {
      id: "message-4",
      issueId: "issue-review",
      threadId: "thread-1",
      seq: 4,
      integritySignature: null,
    };
    const submittedMessage = {
      id: "submit-1",
      issueId: "issue-review",
      threadId: "thread-1",
      seq: 3,
      messageType: "SUBMIT_FOR_REVIEW",
    };
    const createdMessage = {
      id: "message-5",
      issueId: "issue-review",
      threadId: "thread-1",
      seq: 5,
      messageType: "START_REVIEW",
      senderActorType: "agent",
      senderActorId: "rev-1",
      senderRole: "reviewer",
      workflowStateBefore: "submitted_for_review",
      workflowStateAfter: "under_review",
      summary: "Start review",
      payload: { reviewCycle: 2 },
      integritySignature: null,
    };
    const sealedMessage = {
      ...createdMessage,
      payloadSha256: "sha",
      previousIntegritySignature: null,
      integrityAlgorithm: "sha256:hmac-v1",
      integritySignature: "sig-1",
    };
    const { db, insertValues, updateValues } = createIssueProtocolDbMock({
      selectResults: [
        [issue],
        [currentState],
        [{ companyId: "company-1" }],
        [thread],
        [lastMessage],
        [],
        [submittedMessage],
        [],
      ],
      insertResults: [[createdMessage]],
      updateResults: [[sealedMessage]],
    });
    const service = issueProtocolService(db as never);

    const appended = await service.appendMessage({
      issueId: "issue-review",
      authorAgentId: "rev-1",
      message: {
        messageType: "START_REVIEW",
        sender: {
          actorType: "agent",
          actorId: "rev-1",
          role: "reviewer",
        },
        recipients: [
          {
            recipientType: "agent",
            recipientId: "rev-1",
            role: "reviewer",
          },
        ],
        workflowStateBefore: "submitted_for_review",
        workflowStateAfter: "under_review",
        summary: "Start review",
        payload: { reviewCycle: 2 },
        artifacts: [],
      },
    });

    expect(appended.message).toMatchObject({
      id: "message-5",
      integrityStatus: "verified",
    });
    expect(appended.state).toMatchObject({
      workflowState: "under_review",
      coarseIssueStatus: "in_review",
      currentReviewCycle: 2,
    });
    expect(insertValues).toContainEqual({
      table: issueProtocolRecipients,
      value: [
        {
          companyId: "company-1",
          messageId: "message-5",
          recipientType: "agent",
          recipientId: "rev-1",
          recipientRole: "reviewer",
        },
      ],
    });
    expect(insertValues).toContainEqual({
      table: issueReviewCycles,
      value: expect.objectContaining({
        issueId: "issue-review",
        cycleNumber: 2,
        reviewerAgentId: "rev-1",
        submittedMessageId: "submit-1",
      }),
    });
    expect(updateValues).toContainEqual({
      table: issueProtocolState,
      value: expect.objectContaining({
        workflowState: "under_review",
        currentReviewCycle: 2,
      }),
    });
    expect(updateValues).toContainEqual({
      table: issues,
      value: expect.objectContaining({
        status: "in_review",
        assigneeAgentId: "eng-1",
      }),
    });
    expect(insertValues).toContainEqual({
      table: issueComments,
      value: expect.objectContaining({
        issueId: "issue-review",
        authorAgentId: "rev-1",
      }),
    });
  });

  it("allows a QA-role agent to start the primary review lane when that agent is the assigned reviewer", async () => {
    const issue = {
      id: "issue-review-qa-reviewer",
      companyId: "company-1",
      projectId: null,
      assigneeAgentId: "eng-1",
    };
    const currentState = {
      issueId: "issue-review-qa-reviewer",
      companyId: "company-1",
      workflowState: "submitted_for_review",
      coarseIssueStatus: "in_review",
      techLeadAgentId: "lead-1",
      primaryEngineerAgentId: "eng-1",
      reviewerAgentId: "qa-1",
      qaAgentId: null,
      currentReviewCycle: 0,
      metadata: {},
    };
    const thread = {
      id: "thread-review-qa-reviewer",
      issueId: "issue-review-qa-reviewer",
      companyId: "company-1",
      threadType: "primary",
      title: "Primary protocol thread",
    };
    const lastMessage = {
      id: "message-review-qa-reviewer-4",
      issueId: "issue-review-qa-reviewer",
      threadId: "thread-review-qa-reviewer",
      seq: 4,
      integritySignature: null,
    };
    const submittedMessage = {
      id: "submit-review-qa-reviewer-1",
      issueId: "issue-review-qa-reviewer",
      threadId: "thread-review-qa-reviewer",
      seq: 3,
      messageType: "SUBMIT_FOR_REVIEW",
    };
    const createdMessage = {
      id: "message-review-qa-reviewer-5",
      issueId: "issue-review-qa-reviewer",
      threadId: "thread-review-qa-reviewer",
      seq: 5,
      messageType: "START_REVIEW",
      senderActorType: "agent",
      senderActorId: "qa-1",
      senderRole: "qa",
      workflowStateBefore: "submitted_for_review",
      workflowStateAfter: "under_review",
      summary: "QA reviewer starts primary review",
      payload: { reviewCycle: 1 },
      integritySignature: null,
    };
    const sealedMessage = {
      ...createdMessage,
      payloadSha256: "sha",
      previousIntegritySignature: null,
      integrityAlgorithm: "sha256:hmac-v1",
      integritySignature: "sig-review-qa-reviewer",
    };
    const { db, insertValues, updateValues } = createIssueProtocolDbMock({
      selectResults: [
        [issue],
        [currentState],
        [{ companyId: "company-1" }],
        [thread],
        [lastMessage],
        [],
        [submittedMessage],
        [],
      ],
      insertResults: [[createdMessage]],
      updateResults: [[sealedMessage]],
    });
    const service = issueProtocolService(db as never);

    const appended = await service.appendMessage({
      issueId: "issue-review-qa-reviewer",
      authorAgentId: "qa-1",
      message: {
        messageType: "START_REVIEW",
        sender: {
          actorType: "agent",
          actorId: "qa-1",
          role: "qa",
        },
        recipients: [
          {
            recipientType: "agent",
            recipientId: "qa-1",
            role: "reviewer",
          },
        ],
        workflowStateBefore: "submitted_for_review",
        workflowStateAfter: "under_review",
        summary: "QA reviewer starts primary review",
        payload: { reviewCycle: 1 },
        artifacts: [],
      },
    });

    expect(appended.message).toMatchObject({
      id: "message-review-qa-reviewer-5",
      integrityStatus: "verified",
    });
    expect(appended.state).toMatchObject({
      workflowState: "under_review",
      coarseIssueStatus: "in_review",
      currentReviewCycle: 1,
    });
    expect(insertValues).toContainEqual({
      table: issueReviewCycles,
      value: expect.objectContaining({
        issueId: "issue-review-qa-reviewer",
        cycleNumber: 1,
        reviewerAgentId: "qa-1",
        submittedMessageId: "submit-review-qa-reviewer-1",
      }),
    });
    expect(updateValues).toContainEqual({
      table: issueProtocolState,
      value: expect.objectContaining({
        workflowState: "under_review",
        currentReviewCycle: 1,
      }),
    });
  });

  it("opens a fresh QA gate review cycle from qa_pending and increments the cycle when payload omits reviewCycle", async () => {
    const issue = {
      id: "issue-qa-gate-review",
      companyId: "company-1",
      projectId: null,
      assigneeAgentId: "eng-1",
    };
    const currentState = {
      issueId: "issue-qa-gate-review",
      companyId: "company-1",
      workflowState: "qa_pending",
      coarseIssueStatus: "in_review",
      techLeadAgentId: "lead-1",
      primaryEngineerAgentId: "eng-1",
      reviewerAgentId: "rev-1",
      qaAgentId: "qa-1",
      currentReviewCycle: 2,
      metadata: {},
    };
    const thread = {
      id: "thread-qa-gate-review",
      issueId: "issue-qa-gate-review",
      companyId: "company-1",
      threadType: "primary",
      title: "Primary protocol thread",
    };
    const lastMessage = {
      id: "message-qa-gate-review-9",
      issueId: "issue-qa-gate-review",
      threadId: "thread-qa-gate-review",
      seq: 9,
      integritySignature: null,
    };
    const submittedMessage = {
      id: "submit-qa-gate-review-2",
      issueId: "issue-qa-gate-review",
      threadId: "thread-qa-gate-review",
      seq: 8,
      messageType: "SUBMIT_FOR_REVIEW",
    };
    const createdMessage = {
      id: "message-qa-gate-review-10",
      issueId: "issue-qa-gate-review",
      threadId: "thread-qa-gate-review",
      seq: 10,
      messageType: "START_REVIEW",
      senderActorType: "agent",
      senderActorId: "qa-1",
      senderRole: "qa",
      workflowStateBefore: "qa_pending",
      workflowStateAfter: "under_qa_review",
      summary: "QA starts gate review",
      payload: {
        reviewFocus: ["Verify resubmitted recovery evidence"],
      },
      integritySignature: null,
    };
    const sealedMessage = {
      ...createdMessage,
      payloadSha256: "sha",
      previousIntegritySignature: null,
      integrityAlgorithm: "sha256:hmac-v1",
      integritySignature: "sig-qa-gate-review",
    };
    const { db, insertValues, updateValues } = createIssueProtocolDbMock({
      selectResults: [
        [issue],
        [currentState],
        [{ companyId: "company-1" }],
        [thread],
        [lastMessage],
        [],
        [submittedMessage],
        [],
      ],
      insertResults: [[createdMessage]],
      updateResults: [[sealedMessage]],
    });
    const service = issueProtocolService(db as never);

    const appended = await service.appendMessage({
      issueId: "issue-qa-gate-review",
      authorAgentId: "qa-1",
      message: {
        messageType: "START_REVIEW",
        sender: {
          actorType: "agent",
          actorId: "qa-1",
          role: "qa",
        },
        recipients: [
          {
            recipientType: "agent",
            recipientId: "qa-1",
            role: "qa",
          },
        ],
        workflowStateBefore: "qa_pending",
        workflowStateAfter: "under_qa_review",
        summary: "QA starts gate review",
        payload: {
          reviewFocus: ["Verify resubmitted recovery evidence"],
        },
        artifacts: [],
      },
    });

    expect(appended.state).toMatchObject({
      workflowState: "under_qa_review",
      coarseIssueStatus: "in_review",
      currentReviewCycle: 3,
    });
    expect(insertValues).toContainEqual({
      table: issueReviewCycles,
      value: expect.objectContaining({
        issueId: "issue-qa-gate-review",
        cycleNumber: 3,
        reviewerAgentId: "qa-1",
        submittedMessageId: "submit-qa-gate-review-2",
      }),
    });
    expect(updateValues).toContainEqual({
      table: issueProtocolState,
      value: expect.objectContaining({
        workflowState: "under_qa_review",
        currentReviewCycle: 3,
      }),
    });
  });

  it("closes the active review cycle when REQUEST_CHANGES is appended", async () => {
    const issue = {
      id: "issue-changes",
      companyId: "company-1",
      projectId: null,
      assigneeAgentId: "eng-2",
    };
    const currentState = {
      issueId: "issue-changes",
      companyId: "company-1",
      workflowState: "under_review",
      coarseIssueStatus: "in_review",
      techLeadAgentId: "lead-2",
      primaryEngineerAgentId: "eng-2",
      reviewerAgentId: "rev-2",
      qaAgentId: null,
      currentReviewCycle: 3,
      metadata: {},
    };
    const thread = {
      id: "thread-2",
      issueId: "issue-changes",
      companyId: "company-1",
      threadType: "primary",
      title: "Primary protocol thread",
    };
    const lastMessage = {
      id: "message-8",
      issueId: "issue-changes",
      threadId: "thread-2",
      seq: 8,
      integritySignature: null,
    };
    const openCycle = {
      id: "cycle-open",
      issueId: "issue-changes",
      cycleNumber: 3,
      closedAt: null,
    };
    const createdMessage = {
      id: "message-9",
      issueId: "issue-changes",
      threadId: "thread-2",
      seq: 9,
      messageType: "REQUEST_CHANGES",
      senderActorType: "agent",
      senderActorId: "rev-2",
      senderRole: "reviewer",
      workflowStateBefore: "under_review",
      workflowStateAfter: "changes_requested",
      summary: "Need more rollback evidence",
      payload: {
        reviewSummary: "Need more rollback evidence",
        changeRequests: [],
      },
      integritySignature: null,
    };
    const sealedMessage = {
      ...createdMessage,
      payloadSha256: "sha",
      previousIntegritySignature: null,
      integrityAlgorithm: "sha256:hmac-v1",
      integritySignature: "sig-2",
    };
    const { db, insertValues, updateValues } = createIssueProtocolDbMock({
      selectResults: [
        [issue],
        [currentState],
        [{ companyId: "company-1" }],
        [thread],
        [lastMessage],
        [openCycle],
      ],
      insertResults: [[createdMessage]],
      updateResults: [[sealedMessage]],
    });
    const service = issueProtocolService(db as never);

    const appended = await service.appendMessage({
      issueId: "issue-changes",
      authorAgentId: "rev-2",
      message: {
        messageType: "REQUEST_CHANGES",
        sender: {
          actorType: "agent",
          actorId: "rev-2",
          role: "reviewer",
        },
        recipients: [
          {
            recipientType: "agent",
            recipientId: "eng-2",
            role: "engineer",
          },
        ],
        workflowStateBefore: "under_review",
        workflowStateAfter: "changes_requested",
        summary: "Need more rollback evidence",
        payload: {
          reviewSummary: "Need more rollback evidence",
          changeRequests: [],
        },
        artifacts: [],
      },
    });

    expect(appended.state).toMatchObject({
      workflowState: "changes_requested",
      coarseIssueStatus: "in_review",
      primaryEngineerAgentId: "eng-2",
    });
    expect(updateValues).toContainEqual({
      table: issueReviewCycles,
      value: expect.objectContaining({
        outcome: "changes_requested",
        outcomeMessageId: "message-9",
        closedAt: expect.any(Date),
      }),
    });
    expect(insertValues).toContainEqual({
      table: issueComments,
      value: expect.objectContaining({
        issueId: "issue-changes",
        authorAgentId: "rev-2",
      }),
    });
  });

  it("rejects START_REVIEW when an active review cycle already exists", async () => {
    const issue = {
      id: "issue-review-active",
      companyId: "company-1",
      projectId: null,
      assigneeAgentId: "eng-1",
    };
    const currentState = {
      issueId: "issue-review-active",
      companyId: "company-1",
      workflowState: "submitted_for_review",
      coarseIssueStatus: "in_review",
      techLeadAgentId: "lead-1",
      primaryEngineerAgentId: "eng-1",
      reviewerAgentId: "rev-1",
      qaAgentId: null,
      currentReviewCycle: 2,
      metadata: {},
    };
    const thread = {
      id: "thread-1",
      issueId: "issue-review-active",
      companyId: "company-1",
      threadType: "primary",
      title: "Primary protocol thread",
    };
    const lastMessage = {
      id: "message-9",
      issueId: "issue-review-active",
      threadId: "thread-1",
      seq: 9,
      integritySignature: null,
    };
    const createdMessage = {
      id: "message-10",
      issueId: "issue-review-active",
      threadId: "thread-1",
      seq: 10,
      messageType: "START_REVIEW",
      senderActorType: "agent",
      senderActorId: "rev-1",
      senderRole: "reviewer",
      workflowStateBefore: "submitted_for_review",
      workflowStateAfter: "under_review",
      summary: "Start review",
      payload: { reviewCycle: 3 },
      integritySignature: null,
    };
    const sealedMessage = {
      ...createdMessage,
      payloadSha256: "sha",
      previousIntegritySignature: null,
      integrityAlgorithm: "sha256:hmac-v1",
      integritySignature: "sig-10",
    };
    const { db } = createIssueProtocolDbMock({
      selectResults: [
        [issue],
        [currentState],
        [{ companyId: "company-1" }],
        [thread],
        [lastMessage],
        [{ id: "cycle-open", issueId: "issue-review-active", closedAt: null }],
      ],
      insertResults: [[createdMessage]],
      updateResults: [[sealedMessage]],
    });
    const service = issueProtocolService(db as never);

    await expect(service.appendMessage({
      issueId: "issue-review-active",
      authorAgentId: "rev-1",
      message: {
        messageType: "START_REVIEW",
        sender: {
          actorType: "agent",
          actorId: "rev-1",
          role: "reviewer",
        },
        recipients: [],
        artifacts: [],
        workflowStateBefore: "submitted_for_review",
        workflowStateAfter: "under_review",
        summary: "Start review",
        payload: { reviewCycle: 3 },
      },
    })).rejects.toThrow("An active review cycle already exists");
  });

  it("rejects START_REVIEW when the requested review cycle number already exists", async () => {
    const issue = {
      id: "issue-review-duplicate-cycle",
      companyId: "company-1",
      projectId: null,
      assigneeAgentId: "eng-1",
    };
    const currentState = {
      issueId: "issue-review-duplicate-cycle",
      companyId: "company-1",
      workflowState: "qa_pending",
      coarseIssueStatus: "in_review",
      techLeadAgentId: "lead-1",
      primaryEngineerAgentId: "eng-1",
      reviewerAgentId: "rev-1",
      qaAgentId: "qa-1",
      currentReviewCycle: 2,
      metadata: {},
    };
    const thread = {
      id: "thread-review-duplicate-cycle",
      issueId: "issue-review-duplicate-cycle",
      companyId: "company-1",
      threadType: "primary",
      title: "Primary protocol thread",
    };
    const lastMessage = {
      id: "message-review-duplicate-cycle-9",
      issueId: "issue-review-duplicate-cycle",
      threadId: "thread-review-duplicate-cycle",
      seq: 9,
      integritySignature: null,
    };
    const submittedMessage = {
      id: "submit-review-duplicate-cycle-2",
      issueId: "issue-review-duplicate-cycle",
      threadId: "thread-review-duplicate-cycle",
      seq: 8,
      messageType: "SUBMIT_FOR_REVIEW",
    };
    const createdMessage = {
      id: "message-review-duplicate-cycle-10",
      issueId: "issue-review-duplicate-cycle",
      threadId: "thread-review-duplicate-cycle",
      seq: 10,
      messageType: "START_REVIEW",
      senderActorType: "agent",
      senderActorId: "qa-1",
      senderRole: "qa",
      workflowStateBefore: "qa_pending",
      workflowStateAfter: "under_qa_review",
      summary: "Retry QA start with duplicate cycle",
      payload: { reviewCycle: 2 },
      integritySignature: null,
    };
    const sealedMessage = {
      ...createdMessage,
      payloadSha256: "sha",
      previousIntegritySignature: null,
      integrityAlgorithm: "sha256:hmac-v1",
      integritySignature: "sig-review-duplicate-cycle",
    };
    const { db } = createIssueProtocolDbMock({
      selectResults: [
        [issue],
        [currentState],
        [{ companyId: "company-1" }],
        [thread],
        [lastMessage],
        [],
        [submittedMessage],
        [{ id: "cycle-2", issueId: "issue-review-duplicate-cycle", cycleNumber: 2 }],
      ],
      insertResults: [[createdMessage]],
      updateResults: [[sealedMessage]],
    });
    const service = issueProtocolService(db as never);

    await expect(service.appendMessage({
      issueId: "issue-review-duplicate-cycle",
      authorAgentId: "qa-1",
      message: {
        messageType: "START_REVIEW",
        sender: {
          actorType: "agent",
          actorId: "qa-1",
          role: "qa",
        },
        recipients: [
          {
            recipientType: "agent",
            recipientId: "qa-1",
            role: "qa",
          },
        ],
        workflowStateBefore: "qa_pending",
        workflowStateAfter: "under_qa_review",
        summary: "Retry QA start with duplicate cycle",
        payload: { reviewCycle: 2 },
        artifacts: [],
      },
    })).rejects.toThrow("Review cycle 2 already exists");
  });

  it("rejects START_REVIEW when review has not been submitted yet", async () => {
    const issue = {
      id: "issue-review-missing-submit",
      companyId: "company-1",
      projectId: null,
      assigneeAgentId: "eng-1",
    };
    const currentState = {
      issueId: "issue-review-missing-submit",
      companyId: "company-1",
      workflowState: "submitted_for_review",
      coarseIssueStatus: "in_review",
      techLeadAgentId: "lead-1",
      primaryEngineerAgentId: "eng-1",
      reviewerAgentId: "rev-1",
      qaAgentId: null,
      currentReviewCycle: 0,
      metadata: {},
    };
    const thread = {
      id: "thread-1",
      issueId: "issue-review-missing-submit",
      companyId: "company-1",
      threadType: "primary",
      title: "Primary protocol thread",
    };
    const lastMessage = {
      id: "message-1",
      issueId: "issue-review-missing-submit",
      threadId: "thread-1",
      seq: 1,
      integritySignature: null,
    };
    const createdMessage = {
      id: "message-2",
      issueId: "issue-review-missing-submit",
      threadId: "thread-1",
      seq: 2,
      messageType: "START_REVIEW",
      senderActorType: "agent",
      senderActorId: "rev-1",
      senderRole: "reviewer",
      workflowStateBefore: "submitted_for_review",
      workflowStateAfter: "under_review",
      summary: "Start review",
      payload: { reviewCycle: 1 },
      integritySignature: null,
    };
    const sealedMessage = {
      ...createdMessage,
      payloadSha256: "sha",
      previousIntegritySignature: null,
      integrityAlgorithm: "sha256:hmac-v1",
      integritySignature: "sig-2",
    };
    const { db } = createIssueProtocolDbMock({
      selectResults: [
        [issue],
        [currentState],
        [{ companyId: "company-1" }],
        [thread],
        [lastMessage],
        [],
        [],
      ],
      insertResults: [[createdMessage]],
      updateResults: [[sealedMessage]],
    });
    const service = issueProtocolService(db as never);

    await expect(service.appendMessage({
      issueId: "issue-review-missing-submit",
      authorAgentId: "rev-1",
      message: {
        messageType: "START_REVIEW",
        sender: {
          actorType: "agent",
          actorId: "rev-1",
          role: "reviewer",
        },
        recipients: [],
        artifacts: [],
        workflowStateBefore: "submitted_for_review",
        workflowStateAfter: "under_review",
        summary: "Start review",
        payload: { reviewCycle: 1 },
      },
    })).rejects.toThrow("Cannot start review without SUBMIT_FOR_REVIEW");
  });

  it("rejects REQUEST_CHANGES when there is no active review cycle", async () => {
    const issue = {
      id: "issue-review-no-open-cycle",
      companyId: "company-1",
      projectId: null,
      assigneeAgentId: "eng-1",
    };
    const currentState = {
      issueId: "issue-review-no-open-cycle",
      companyId: "company-1",
      workflowState: "under_review",
      coarseIssueStatus: "in_review",
      techLeadAgentId: "lead-1",
      primaryEngineerAgentId: "eng-1",
      reviewerAgentId: "rev-1",
      qaAgentId: null,
      currentReviewCycle: 1,
      metadata: {},
    };
    const thread = {
      id: "thread-1",
      issueId: "issue-review-no-open-cycle",
      companyId: "company-1",
      threadType: "primary",
      title: "Primary protocol thread",
    };
    const lastMessage = {
      id: "message-4",
      issueId: "issue-review-no-open-cycle",
      threadId: "thread-1",
      seq: 4,
      integritySignature: null,
    };
    const createdMessage = {
      id: "message-5",
      issueId: "issue-review-no-open-cycle",
      threadId: "thread-1",
      seq: 5,
      messageType: "REQUEST_CHANGES",
      senderActorType: "agent",
      senderActorId: "rev-1",
      senderRole: "reviewer",
      workflowStateBefore: "under_review",
      workflowStateAfter: "changes_requested",
      summary: "Need a follow-up patch",
      payload: {},
      integritySignature: null,
    };
    const sealedMessage = {
      ...createdMessage,
      payloadSha256: "sha",
      previousIntegritySignature: null,
      integrityAlgorithm: "sha256:hmac-v1",
      integritySignature: "sig-5",
    };
    const { db } = createIssueProtocolDbMock({
      selectResults: [
        [issue],
        [currentState],
        [{ companyId: "company-1" }],
        [thread],
        [lastMessage],
        [],
      ],
      insertResults: [[createdMessage]],
      updateResults: [[sealedMessage]],
    });
    const service = issueProtocolService(db as never);

    await expect(service.appendMessage({
      issueId: "issue-review-no-open-cycle",
      authorAgentId: "rev-1",
      message: {
        messageType: "REQUEST_CHANGES",
        sender: {
          actorType: "agent",
          actorId: "rev-1",
          role: "reviewer",
        },
        recipients: [],
        artifacts: [],
        workflowStateBefore: "under_review",
        workflowStateAfter: "changes_requested",
        summary: "Need a follow-up patch",
        payload: {},
      },
    })).rejects.toThrow("No active review cycle found");
  });
});
