import { approvalComments, approvals } from "@squadrail/db";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockActivatePendingApproval,
  mockCreateAgent,
  mockTerminateAgent,
} = vi.hoisted(() => ({
  mockActivatePendingApproval: vi.fn(),
  mockCreateAgent: vi.fn(),
  mockTerminateAgent: vi.fn(),
}));

vi.mock("../services/agents.js", () => ({
  agentService: () => ({
    activatePendingApproval: mockActivatePendingApproval,
    create: mockCreateAgent,
    terminate: mockTerminateAgent,
  }),
}));

import { approvalService } from "../services/approvals.js";

function createResolvedChain(rows: unknown[]) {
  const chain = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    then: <T>(resolve: (value: unknown[]) => T | PromiseLike<T>) => Promise.resolve(rows).then(resolve),
  };
  return chain;
}

function createApprovalDbMock(input: {
  selectResults?: unknown[][];
  insertResults?: unknown[][];
  updateResults?: unknown[][];
}) {
  const selectQueue = [...(input.selectResults ?? [])];
  const insertQueue = [...(input.insertResults ?? [])];
  const updateQueue = [...(input.updateResults ?? [])];
  const insertValues: Array<{ table: unknown; value: unknown }> = [];

  const db = {
    select: () => createResolvedChain(selectQueue.shift() ?? []),
    insert: (table: unknown) => ({
      values: (value: unknown) => {
        insertValues.push({ table, value });
        return {
          returning: async () => insertQueue.shift() ?? [],
        };
      },
    }),
    update: (_table: unknown) => ({
      set: (_value: unknown) => ({
        where: () => ({
          returning: async () => updateQueue.shift() ?? [],
        }),
      }),
    }),
  };

  return { db, insertValues };
}

describe("approval service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("approves a hire request and activates the pending agent when payloadAgentId exists", async () => {
    const approval = {
      id: "approval-1",
      companyId: "company-1",
      type: "hire_agent",
      status: "pending",
      payload: { agentId: "agent-1" },
    };
    const approved = {
      ...approval,
      status: "approved",
      decidedByUserId: "board-1",
    };
    const { db } = createApprovalDbMock({
      selectResults: [[approval]],
      updateResults: [[approved]],
    });
    const service = approvalService(db as never);

    const result = await service.approve("approval-1", "board-1", "Looks good");

    expect(result).toEqual(approved);
    expect(mockActivatePendingApproval).toHaveBeenCalledWith("agent-1");
    expect(mockCreateAgent).not.toHaveBeenCalled();
  });

  it("approves a hire request by creating the agent when no payload agent exists", async () => {
    const approval = {
      id: "approval-1",
      companyId: "company-1",
      type: "hire_agent",
      status: "pending",
      payload: {
        name: "QA Captain",
        role: "qa",
        adapterType: "codex_local",
        budgetMonthlyCents: 1000,
      },
    };
    const approved = {
      ...approval,
      status: "approved",
      decidedByUserId: "board-1",
    };
    const { db } = createApprovalDbMock({
      selectResults: [[approval]],
      updateResults: [[approved]],
    });
    const service = approvalService(db as never);

    await service.approve("approval-1", "board-1");

    expect(mockCreateAgent).toHaveBeenCalledWith(
      "company-1",
      expect.objectContaining({
        name: "QA Captain",
        role: "qa",
        status: "idle",
        adapterType: "codex_local",
      }),
    );
  });

  it("rejects a hire request and terminates the pending agent", async () => {
    const approval = {
      id: "approval-1",
      companyId: "company-1",
      type: "hire_agent",
      status: "pending",
      payload: { agentId: "agent-1" },
    };
    const rejected = {
      ...approval,
      status: "rejected",
      decidedByUserId: "board-1",
    };
    const { db } = createApprovalDbMock({
      selectResults: [[approval]],
      updateResults: [[rejected]],
    });
    const service = approvalService(db as never);

    const result = await service.reject("approval-1", "board-1", "Not now");

    expect(result).toEqual(rejected);
    expect(mockTerminateAgent).toHaveBeenCalledWith("agent-1");
  });

  it("requests revision, resubmits, and stores approval comments", async () => {
    const approval = {
      id: "approval-1",
      companyId: "company-1",
      type: "other",
      status: "pending",
      payload: { foo: "bar" },
    };
    const revisionRequested = {
      ...approval,
      status: "revision_requested",
      decisionNote: "Need a better plan",
    };
    const resubmitted = {
      ...approval,
      status: "pending",
      payload: { foo: "baz" },
      decisionNote: null,
      decidedByUserId: null,
      decidedAt: null,
    };
    const comment = {
      id: "comment-1",
      companyId: "company-1",
      approvalId: "approval-1",
      authorUserId: "board-1",
      authorAgentId: null,
      body: "Clarify rollout",
    };
    const { db, insertValues } = createApprovalDbMock({
      selectResults: [
        [approval],
        [revisionRequested],
        [revisionRequested],
        [approval],
      ],
      updateResults: [[revisionRequested], [resubmitted]],
      insertResults: [[comment]],
    });
    const service = approvalService(db as never);

    const requested = await service.requestRevision("approval-1", "board-1", "Need a better plan");
    const resubmittedRow = await service.resubmit("approval-1", { foo: "baz" });
    const commentRow = await service.addComment("approval-1", "Clarify rollout", { userId: "board-1" });

    expect(requested).toEqual(revisionRequested);
    expect(resubmittedRow).toEqual(resubmitted);
    expect(commentRow).toEqual(comment);
    expect(insertValues.find((entry) => entry.table === approvalComments)?.value).toMatchObject({
      companyId: "company-1",
      approvalId: "approval-1",
      authorUserId: "board-1",
      body: "Clarify rollout",
    });
    expect(insertValues.some((entry) => entry.table === approvals)).toBe(false);
  });
});
