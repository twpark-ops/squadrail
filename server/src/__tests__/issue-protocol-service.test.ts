import { issueProtocolViolations } from "@squadrail/db";
import { describe, expect, it } from "vitest";
import { issueProtocolService } from "../services/issue-protocol.js";

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

  const db = {
    select: () => createResolvedChain(selectQueue.shift() ?? []),
    insert: (table: unknown) => ({
      values: (value: unknown) => {
        insertValues.push({ table, value });
        const next = insertQueue.shift();
        if (next instanceof Error) throw next;
        return {
          returning: async () => next ?? [],
        };
      },
    }),
    update: (table: unknown) => ({
      set: (value: unknown) => {
        updateValues.push({ table, value });
        const next = updateQueue.shift();
        if (next instanceof Error) throw next;
        return {
          where: () => ({
            returning: async () => next ?? [],
          }),
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
});
