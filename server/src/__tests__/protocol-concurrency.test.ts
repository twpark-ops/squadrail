import {
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

describe("protocol concurrency awareness", () => {
  it("rejects protocol message when issue state has already advanced (stale workflowStateBefore)", async () => {
    // Current state is "implementing", but the message arrives with workflowStateBefore: "assigned"
    // This simulates a race where state advanced between the caller reading the state and sending a message
    const issue = {
      id: "issue-race",
      companyId: "company-1",
      projectId: null,
      assigneeAgentId: "eng-1",
      status: "in_progress",
    };
    const currentState = {
      issueId: "issue-race",
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
    const { db } = createIssueProtocolDbMock({
      selectResults: [
        // issues select (issue lookup)
        [issue],
        // issueProtocolState select (current state with FOR UPDATE)
        [currentState],
      ],
    });
    const service = issueProtocolService(db as never);

    // The message claims state was "assigned" but the DB says "implementing"
    await expect(
      service.appendMessage({
        issueId: "issue-race",
        authorAgentId: "eng-1",
        message: {
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
          workflowStateBefore: "assigned",
          workflowStateAfter: "under_review",
          summary: "Work submitted for review",
          payload: {},
          artifacts: [],
        },
      }),
    ).rejects.toThrow("Expected protocol state implementing, got assigned");
  });

  it("rejects protocol message when state is uninitialized and message is not ASSIGN_TASK", async () => {
    // Protocol state does not exist yet (null); any message other than ASSIGN_TASK should be rejected
    const issue = {
      id: "issue-uninit",
      companyId: "company-1",
      projectId: null,
      assigneeAgentId: "eng-1",
      status: "open",
    };
    const { db } = createIssueProtocolDbMock({
      selectResults: [
        // issues select
        [issue],
        // issueProtocolState select (no state yet)
        [],
      ],
    });
    const service = issueProtocolService(db as never);

    await expect(
      service.appendMessage({
        issueId: "issue-uninit",
        authorAgentId: "eng-1",
        message: {
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
          workflowStateAfter: "under_review",
          summary: "Work submitted for review",
          payload: {},
          artifacts: [],
        },
      }),
    ).rejects.toThrow("Protocol state is not initialized; first protocol message must be ASSIGN_TASK");
  });

  it("rejects non-state-changing message that attempts to alter workflow state", async () => {
    // A message type that has stateChanging: false should not be able to send
    // workflowStateBefore !== workflowStateAfter
    const issue = {
      id: "issue-nochange",
      companyId: "company-1",
      projectId: null,
      assigneeAgentId: "eng-1",
      status: "in_progress",
    };
    const currentState = {
      issueId: "issue-nochange",
      companyId: "company-1",
      workflowState: "implementing",
      coarseIssueStatus: "in_progress",
      techLeadAgentId: "lead-1",
      primaryEngineerAgentId: "eng-1",
      reviewerAgentId: null,
      qaAgentId: null,
      currentReviewCycle: 1,
      metadata: {},
    };
    const { db } = createIssueProtocolDbMock({
      selectResults: [
        // issues select
        [issue],
        // issueProtocolState select
        [currentState],
      ],
    });
    const service = issueProtocolService(db as never);

    // REPORT_PROGRESS is a non-state-changing message type
    await expect(
      service.appendMessage({
        issueId: "issue-nochange",
        authorAgentId: "eng-1",
        message: {
          messageType: "REPORT_PROGRESS",
          sender: {
            actorType: "agent",
            actorId: "eng-1",
            role: "engineer",
          },
          recipients: [],
          workflowStateBefore: "implementing",
          workflowStateAfter: "under_review",
          summary: "Progress note that sneaks in a state change",
          payload: {},
          artifacts: [],
        },
      }),
    ).rejects.toThrow(/must transition/i);
  });

  it("rejects message from wrong engineer actor when primaryEngineerAgentId is set", async () => {
    // An engineer message must come from the assigned primaryEngineerAgentId
    const issue = {
      id: "issue-wrong-eng",
      companyId: "company-1",
      projectId: null,
      assigneeAgentId: "eng-1",
      status: "in_progress",
    };
    const currentState = {
      issueId: "issue-wrong-eng",
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
    const { db } = createIssueProtocolDbMock({
      selectResults: [
        // issues select
        [issue],
        // issueProtocolState select
        [currentState],
      ],
    });
    const service = issueProtocolService(db as never);

    await expect(
      service.appendMessage({
        issueId: "issue-wrong-eng",
        authorAgentId: "eng-impersonator",
        message: {
          messageType: "REPORT_PROGRESS",
          sender: {
            actorType: "agent",
            actorId: "eng-impersonator",
            role: "engineer",
          },
          recipients: [],
          workflowStateBefore: "implementing",
          workflowStateAfter: "implementing",
          summary: "Impersonated progress note",
          payload: {},
          artifacts: [],
        },
      }),
    ).rejects.toThrow("Only the assigned engineer can send this protocol message");
  });
});
