import { agentRuntimeState, agents, agentTaskSessions, agentWakeupRequests, heartbeatRunEvents, heartbeatRunLeases, heartbeatRuns, issues } from "@squadrail/db";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockEnqueueAfterDbCommit,
  mockPublishLiveEvent,
  mockRunWithoutDbContext,
} = vi.hoisted(() => ({
  mockEnqueueAfterDbCommit: vi.fn(),
  mockPublishLiveEvent: vi.fn(),
  mockRunWithoutDbContext: vi.fn(),
}));

vi.mock("@squadrail/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@squadrail/db")>();
  return {
    ...actual,
    enqueueAfterDbCommit: mockEnqueueAfterDbCommit,
    runWithoutDbContext: mockRunWithoutDbContext,
  };
});

vi.mock("../services/live-events.js", () => ({
  publishLiveEvent: mockPublishLiveEvent,
}));

import { heartbeatService } from "../services/heartbeat.js";

function shiftTableRows(queueMap: Map<unknown, unknown[][]>, table: unknown) {
  const queue = queueMap.get(table);
  return queue?.shift() ?? [];
}

function createResolvedSelectChain(selectRows: Map<unknown, unknown[][]>) {
  let selectedTable: unknown = null;
  const chain = {
    from: (table: unknown) => {
      selectedTable = table;
      return chain;
    },
    where: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    then: <T>(resolve: (value: unknown[]) => T | PromiseLike<T>) =>
      Promise.resolve(shiftTableRows(selectRows, selectedTable)).then(resolve),
  };
  return chain;
}

function createHeartbeatDbMock(input: {
  selectRows?: Map<unknown, unknown[][]>;
  insertRows?: Map<unknown, unknown[][]>;
  updateRows?: Map<unknown, unknown[][]>;
  deleteRows?: Map<unknown, unknown[][]>;
}) {
  const selectRows = input.selectRows ?? new Map();
  const insertRows = input.insertRows ?? new Map();
  const updateRows = input.updateRows ?? new Map();
  const deleteRows = input.deleteRows ?? new Map();
  const insertValues: Array<{ table: unknown; value: unknown }> = [];
  const updateSets: Array<{ table: unknown; value: unknown }> = [];
  const conflictSets: Array<{ table: unknown; value: unknown }> = [];
  const deletedTables: unknown[] = [];

  const db = {
    select: () => createResolvedSelectChain(selectRows),
    insert: (table: unknown) => ({
      values: (value: unknown) => {
        insertValues.push({ table, value });
        const chain = {
          onConflictDoUpdate: (config: { set: unknown }) => {
            conflictSets.push({ table, value: config.set });
            return chain;
          },
          onConflictDoNothing: () => chain,
          returning: async () => shiftTableRows(insertRows, table),
          then: <T>(resolve: (value: unknown[]) => T | PromiseLike<T>) =>
            Promise.resolve([]).then(resolve),
        };
        return chain;
      },
    }),
    update: (table: unknown) => ({
      set: (value: unknown) => {
        updateSets.push({ table, value });
        const chain = {
          where: () => chain,
          returning: async () => shiftTableRows(updateRows, table),
          then: <T>(resolve: (value: unknown[]) => T | PromiseLike<T>) =>
            Promise.resolve([]).then(resolve),
        };
        return chain;
      },
    }),
    delete: (table: unknown) => ({
      where: () => {
        deletedTables.push(table);
        return {
          returning: async () => shiftTableRows(deleteRows, table),
        };
      },
    }),
    transaction: async <T>(callback: (tx: typeof db) => Promise<T>) => callback(db),
    execute: async () => [],
  };

  return {
    db,
    insertValues,
    updateSets,
    conflictSets,
    deletedTables,
  };
}

function makeAgent(overrides: Record<string, unknown> = {}) {
  return {
    id: "agent-1",
    companyId: "company-1",
    name: "Engineer One",
    status: "active",
    adapterType: "codex_local",
    runtimeConfig: {
      heartbeat: {
        enabled: true,
        intervalSec: 60,
        wakeOnDemand: true,
        maxConcurrentRuns: 1,
      },
    },
    createdAt: new Date("2026-03-12T00:00:00Z"),
    lastHeartbeatAt: new Date("2026-03-12T00:00:00Z"),
    ...overrides,
  };
}

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    companyId: "company-1",
    agentId: "agent-1",
    invocationSource: "on_demand",
    triggerDetail: "manual",
    wakeupRequestId: "wake-1",
    status: "queued",
    contextSnapshot: {},
    createdAt: new Date("2026-03-12T00:00:00Z"),
    updatedAt: new Date("2026-03-12T00:00:00Z"),
    ...overrides,
  };
}

describe("heartbeat service flow coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnqueueAfterDbCommit.mockReturnValue(true);
    mockRunWithoutDbContext.mockImplementation((fn: () => unknown) => fn());
  });

  it("queues a standalone wakeup run and links the wakeup request", async () => {
    const { db, insertValues, updateSets, conflictSets } = createHeartbeatDbMock({
      selectRows: new Map([
        [agents, [[makeAgent()]]],
        [heartbeatRuns, [[]]],
        [agentRuntimeState, [[]]],
      ]),
      insertRows: new Map([
        [agentWakeupRequests, [[{ id: "wake-1" }]]],
        [heartbeatRuns, [[makeRun()]]],
      ]),
    });
    const service = heartbeatService(db as never);

    const run = await service.wakeup("agent-1", {
      source: "on_demand",
      triggerDetail: "manual",
      reason: "manual_test",
      contextSnapshot: {
        projectId: "project-1",
      },
    });

    expect(run).toMatchObject({
      id: "run-1",
      wakeupRequestId: "wake-1",
      status: "queued",
    });
    expect(insertValues.find((entry) => entry.table === agentWakeupRequests)?.value).toMatchObject({
      companyId: "company-1",
      agentId: "agent-1",
      source: "on_demand",
      triggerDetail: "manual",
      reason: "manual_test",
      status: "queued",
    });
    expect(insertValues.find((entry) => entry.table === heartbeatRuns)?.value).toMatchObject({
      companyId: "company-1",
      agentId: "agent-1",
      wakeupRequestId: "wake-1",
      contextSnapshot: {
        projectId: "project-1",
        wakeReason: "manual_test",
        wakeSource: "on_demand",
        wakeTriggerDetail: "manual",
      },
    });
    expect(updateSets.find((entry) => entry.table === agentWakeupRequests)?.value).toMatchObject({
      runId: "run-1",
    });
    expect(conflictSets.find((entry) => entry.table === heartbeatRunLeases)?.value).toMatchObject({
      status: "queued",
      checkpointJson: {
        phase: "queue.created",
      },
    });
    expect(mockPublishLiveEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: "heartbeat.run.queued",
    }));
  });

  it("coalesces wakeups onto an existing queued run in the same task scope", async () => {
    const existingRun = makeRun({
      id: "run-existing",
      contextSnapshot: {
        issueId: "issue-1",
      },
    });
    const mergedRun = {
      ...existingRun,
      contextSnapshot: {
        issueId: "issue-1",
        commentId: "comment-2",
        wakeCommentId: "comment-2",
        wakeReason: "issue_comment_mentioned",
        wakeSource: "automation",
        wakeTriggerDetail: "system",
      },
    };
    const { db, insertValues, updateSets } = createHeartbeatDbMock({
      selectRows: new Map([
        [agents, [[makeAgent()]]],
        [heartbeatRuns, [[existingRun]]],
      ]),
      updateRows: new Map([
        [heartbeatRuns, [[mergedRun]]],
      ]),
    });
    const service = heartbeatService(db as never);

    const run = await service.wakeup("agent-1", {
      source: "automation",
      triggerDetail: "system",
      reason: "issue_comment_mentioned",
      payload: {
        issueId: "issue-1",
        commentId: "comment-2",
      },
      contextSnapshot: {
        issueId: "issue-1",
      },
    });

    expect(run).toMatchObject({
      id: "run-existing",
      contextSnapshot: {
        wakeCommentId: "comment-2",
      },
    });
    expect(updateSets.find((entry) => entry.table === heartbeatRuns)?.value).toMatchObject({
      contextSnapshot: {
        issueId: "issue-1",
        commentId: "comment-2",
        wakeCommentId: "comment-2",
      },
    });
    expect(insertValues.find((entry) => entry.table === agentWakeupRequests)?.value).toMatchObject({
      status: "coalesced",
      runId: "run-existing",
      reason: "issue_comment_mentioned",
    });
  });

  it("ticks timers only for elapsed enabled agents", async () => {
    const now = new Date("2026-03-12T12:00:00Z");
    const pausedAgent = makeAgent({
      id: "agent-paused",
      status: "paused",
    });
    const dueAgent = makeAgent({
      id: "agent-due",
      lastHeartbeatAt: new Date("2026-03-12T10:00:00Z"),
    });
    const notDueAgent = makeAgent({
      id: "agent-not-due",
      lastHeartbeatAt: new Date("2026-03-12T11:59:30Z"),
    });
    const { db, insertValues } = createHeartbeatDbMock({
      selectRows: new Map([
        [agents, [[pausedAgent, dueAgent, notDueAgent], [dueAgent]]],
        [heartbeatRuns, [[]]],
        [agentRuntimeState, [[]]],
      ]),
      insertRows: new Map([
        [agentWakeupRequests, [[{ id: "wake-timer-1" }]]],
        [heartbeatRuns, [[makeRun({
          id: "run-timer-1",
          agentId: "agent-due",
          wakeupRequestId: "wake-timer-1",
          invocationSource: "timer",
          triggerDetail: "system",
        })]]],
      ]),
    });
    const service = heartbeatService(db as never);

    const summary = await service.tickTimers(now);

    expect(summary).toEqual({
      checked: 2,
      enqueued: 1,
      skipped: 0,
    });
    expect(insertValues.find((entry) => entry.table === heartbeatRuns)?.value).toMatchObject({
      agentId: "agent-due",
      invocationSource: "timer",
      triggerDetail: "system",
      contextSnapshot: {
        source: "scheduler",
        reason: "interval_elapsed",
        wakeReason: "heartbeat_timer",
        wakeSource: "timer",
        wakeTriggerDetail: "system",
      },
    });
  });

  it("returns zero cancellation counts when an issue has no active wakeups or runs", async () => {
    const { db } = createHeartbeatDbMock({
      selectRows: new Map([
        [agentWakeupRequests, [[]]],
        [heartbeatRuns, [[]]],
      ]),
    });
    const service = heartbeatService(db as never);

    await expect(
      service.cancelIssueScope({
        companyId: "company-1",
        issueId: "issue-404",
      }),
    ).resolves.toEqual({
      cancelledWakeupCount: 0,
      cancelledRunCount: 0,
    });
  });

  it("cancels active issue-scoped wakeups and queued runs, then idles the agent", async () => {
    const activeRun = makeRun({
      id: "run-cancel-1",
      wakeupRequestId: "wake-cancel-1",
      status: "queued",
      contextSnapshot: {
        issueId: "issue-1",
      },
    });
    const cancelledRun = {
      ...activeRun,
      status: "cancelled",
      finishedAt: new Date("2026-03-13T05:00:00Z"),
      error: "Cancelled by control plane",
      errorCode: "cancelled",
    };
    const updatedAgent = {
      ...makeAgent(),
      status: "idle",
      lastHeartbeatAt: new Date("2026-03-13T05:00:00Z"),
    };
    const { db, updateSets, insertValues, conflictSets } = createHeartbeatDbMock({
      selectRows: new Map([
        [agentWakeupRequests, [[{ id: "wake-cancel-1" }]]],
        [heartbeatRuns, [[activeRun], [activeRun], [activeRun], [{ count: 0 }]]],
        [issues, [[]]],
        [agents, [[makeAgent()]]],
      ]),
      updateRows: new Map([
        [heartbeatRuns, [[cancelledRun]]],
        [agents, [[updatedAgent]]],
      ]),
    });
    const service = heartbeatService(db as never);

    await expect(
      service.cancelIssueScope({
        companyId: "company-1",
        issueId: "issue-1",
      }),
    ).resolves.toEqual({
      cancelledWakeupCount: 1,
      cancelledRunCount: 1,
    });

    expect(updateSets.find((entry) => entry.table === agentWakeupRequests)?.value).toMatchObject({
      status: "cancelled",
      error: "Cancelled by control plane",
    });
    expect(conflictSets.find((entry) => entry.table === heartbeatRunLeases)?.value).toMatchObject({
      status: "cancelled",
      checkpointJson: {
        phase: "finalize.cancelled",
      },
      lastError: "Cancelled by control plane",
    });
    expect(insertValues.find((entry) => entry.table === heartbeatRunEvents)?.value).toMatchObject({
      runId: "run-cancel-1",
      eventType: "lifecycle",
      message: "run cancelled",
    });
    expect(updateSets.find((entry) => entry.table === agents)?.value).toMatchObject({
      status: "idle",
    });
    expect(mockPublishLiveEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: "agent.status",
      payload: expect.objectContaining({
        agentId: "agent-1",
        status: "idle",
        outcome: "cancelled",
      }),
    }));
  });

  it("still cancels the targeted issue scope even when other active work remains queued", async () => {
    const activeRun = makeRun({
      id: "run-cancel-2",
      wakeupRequestId: "wake-cancel-2",
      status: "queued",
      contextSnapshot: {
        issueId: "issue-2",
      },
    });
    const cancelledRun = {
      ...activeRun,
      status: "cancelled",
      finishedAt: new Date("2026-03-13T05:05:00Z"),
      error: "Cancelled by control plane",
      errorCode: "cancelled",
    };
    const { db, updateSets } = createHeartbeatDbMock({
      selectRows: new Map([
        [agentWakeupRequests, [[{ id: "wake-cancel-2" }]]],
        [heartbeatRuns, [[activeRun], [activeRun], [activeRun], [{ count: 1 }]]],
        [issues, [[]]],
        [agents, [[makeAgent()]]],
      ]),
      updateRows: new Map([
        [heartbeatRuns, [[cancelledRun]]],
      ]),
    });
    const service = heartbeatService(db as never);

    await expect(
      service.cancelIssueScope({
        companyId: "company-1",
        issueId: "issue-2",
      }),
    ).resolves.toEqual({
      cancelledWakeupCount: 1,
      cancelledRunCount: 1,
    });

    expect(updateSets.find((entry) => entry.table === agentWakeupRequests)?.value).toMatchObject({
      status: "cancelled",
      error: "Cancelled by control plane",
    });
    expect(updateSets.find((entry) => entry.table === heartbeatRuns)?.value).toMatchObject({
      status: "cancelled",
      errorCode: "cancelled",
    });
  });

  it("ensures runtime state and prefers the latest task session display id", async () => {
    const ensuredState = {
      agentId: "agent-1",
      companyId: "company-1",
      adapterType: "codex_local",
      sessionId: "runtime-session-1",
      stateJson: {},
      updatedAt: new Date("2026-03-12T12:00:00Z"),
    };
    const latestTaskSession = {
      id: "task-session-1",
      companyId: "company-1",
      agentId: "agent-1",
      adapterType: "codex_local",
      taskKey: "issue:1",
      sessionDisplayId: "task-session-display",
      sessionParamsJson: { sessionId: "task-session-1" },
      updatedAt: new Date("2026-03-12T12:05:00Z"),
      createdAt: new Date("2026-03-12T12:00:00Z"),
    };
    const { db, insertValues } = createHeartbeatDbMock({
      selectRows: new Map([
        [agentRuntimeState, [[], []]],
        [agents, [[makeAgent()]]],
        [agentTaskSessions, [[latestTaskSession]]],
      ]),
      insertRows: new Map([
        [agentRuntimeState, [[ensuredState]]],
      ]),
    });
    const service = heartbeatService(db as never);

    const state = await service.getRuntimeState("agent-1");

    expect(state).toMatchObject({
      agentId: "agent-1",
      sessionId: "runtime-session-1",
      sessionDisplayId: "task-session-display",
      sessionParamsJson: {
        sessionId: "task-session-1",
      },
    });
    expect(insertValues.find((entry) => entry.table === agentRuntimeState)?.value).toMatchObject({
      agentId: "agent-1",
      companyId: "company-1",
      adapterType: "codex_local",
      stateJson: {},
    });
  });

  it("lists task sessions for an agent in descending freshness order", async () => {
    const sessions = [
      {
        id: "task-session-2",
        companyId: "company-1",
        agentId: "agent-1",
        adapterType: "codex_local",
        taskKey: "issue:2",
        sessionDisplayId: "display-2",
        updatedAt: new Date("2026-03-13T06:00:00Z"),
        createdAt: new Date("2026-03-13T05:00:00Z"),
      },
      {
        id: "task-session-1",
        companyId: "company-1",
        agentId: "agent-1",
        adapterType: "codex_local",
        taskKey: "issue:1",
        sessionDisplayId: "display-1",
        updatedAt: new Date("2026-03-13T05:30:00Z"),
        createdAt: new Date("2026-03-13T05:00:00Z"),
      },
    ];
    const { db } = createHeartbeatDbMock({
      selectRows: new Map([
        [agents, [[makeAgent()]]],
        [agentTaskSessions, [sessions]],
      ]),
    });
    const service = heartbeatService(db as never);

    const result = await service.listTaskSessions("agent-1");

    expect(result).toEqual(sessions);
  });

  it("returns the newest running heartbeat run for an agent", async () => {
    const runningRun = makeRun({
      id: "run-running-1",
      status: "running",
      startedAt: new Date("2026-03-13T06:15:00Z"),
    });
    const { db } = createHeartbeatDbMock({
      selectRows: new Map([
        [heartbeatRuns, [[runningRun]]],
      ]),
    });
    const service = heartbeatService(db as never);

    const result = await service.getActiveRunForAgent("agent-1");

    expect(result).toMatchObject({
      id: "run-running-1",
      status: "running",
    });
  });

  it("resets runtime session globally and clears task sessions when no task key is provided", async () => {
    const existingState = {
      agentId: "agent-1",
      companyId: "company-1",
      adapterType: "codex_local",
      sessionId: "runtime-session-1",
      lastError: "previous error",
      stateJson: {
        session: "active",
      },
      updatedAt: new Date("2026-03-13T05:10:00Z"),
    };
    const updatedState = {
      ...existingState,
      sessionId: null,
      lastError: null,
      stateJson: {},
      updatedAt: new Date("2026-03-13T05:15:00Z"),
    };
    const { db, updateSets, deletedTables } = createHeartbeatDbMock({
      selectRows: new Map([
        [agents, [[makeAgent()]]],
        [agentRuntimeState, [[existingState]]],
      ]),
      updateRows: new Map([
        [agentRuntimeState, [[updatedState]]],
      ]),
      deleteRows: new Map([
        [agentTaskSessions, [[{ id: "task-session-1" }]]],
      ]),
    });
    const service = heartbeatService(db as never);

    const result = await service.resetRuntimeSession("agent-1");

    expect(result).toMatchObject({
      agentId: "agent-1",
      sessionDisplayId: null,
      sessionParamsJson: null,
      clearedTaskSessions: 1,
    });
    expect(deletedTables).toEqual([agentTaskSessions]);
    expect(updateSets.find((entry) => entry.table === agentRuntimeState)?.value).toMatchObject({
      sessionId: null,
      lastError: null,
      stateJson: {},
    });
  });

  it("cancels superseded follow-up wakeups while excluding the active run that should remain", async () => {
    const supersededRun = makeRun({
      id: "run-superseded-1",
      wakeupRequestId: "wake-superseded-1",
      status: "queued",
      contextSnapshot: {
        issueId: "issue-3",
        wakeReason: "protocol_required_retry",
      },
    });
    const cancelledRun = {
      ...supersededRun,
      status: "cancelled",
      finishedAt: new Date("2026-03-13T05:20:00Z"),
      error: "Cancelled stale protocol follow-up",
      errorCode: "cancelled",
    };
    const updatedAgent = {
      ...makeAgent(),
      status: "idle",
      lastHeartbeatAt: new Date("2026-03-13T05:20:00Z"),
    };
    const { db, updateSets } = createHeartbeatDbMock({
      selectRows: new Map([
        [agentWakeupRequests, [[{ id: "wake-superseded-1" }]]],
        [heartbeatRuns, [[supersededRun], [supersededRun], [supersededRun], [{ count: 0 }]]],
        [issues, [[]]],
        [agents, [[makeAgent()]]],
      ]),
      updateRows: new Map([
        [heartbeatRuns, [[cancelledRun]]],
        [agents, [[updatedAgent]]],
      ]),
    });
    const service = heartbeatService(db as never);

    const result = await service.cancelSupersededIssueFollowups({
      companyId: "company-1",
      issueId: "issue-3",
      excludeRunId: "run-keep",
    });

    expect(result).toEqual({
      cancelledWakeupCount: 1,
      cancelledRunCount: 1,
    });
    expect(updateSets.find((entry) => entry.table === agentWakeupRequests)?.value).toMatchObject({
      status: "cancelled",
      error: "Cancelled stale protocol follow-up",
    });
    expect(updateSets.find((entry) => entry.table === heartbeatRuns)?.value).toMatchObject({
      status: "cancelled",
      errorCode: "cancelled",
    });
  });
});
