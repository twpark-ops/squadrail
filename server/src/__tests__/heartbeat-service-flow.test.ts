import { agentRuntimeState, agents, agentTaskSessions, agentWakeupRequests, heartbeatRunEvents, heartbeatRunLeases, heartbeatRuns, issues } from "@squadrail/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runningProcesses } from "@squadrail/adapter-utils/server-utils";

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
    runningProcesses.clear();
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

  it("queues wakeups for visible subtask issues", async () => {
    const { db, insertValues, updateSets } = createHeartbeatDbMock({
      selectRows: new Map([
        [agents, [[makeAgent()]]],
        [issues, [[{
          id: "issue-subtask",
          companyId: "company-1",
          priority: "high",
          parentId: "root-issue-1",
          executionRunId: null,
          executionAgentNameKey: null,
        }]]],
        [heartbeatRuns, [[]]],
        [agentRuntimeState, [[]]],
      ]),
      insertRows: new Map([
        [agentWakeupRequests, [[{ id: "wake-subtask-1" }]]],
        [heartbeatRuns, [[makeRun({ id: "run-subtask-1" })]]],
      ]),
    });
    const service = heartbeatService(db as never);

    const run = await service.wakeup("agent-1", {
      source: "automation",
      triggerDetail: "system",
      reason: "protocol_review_requested",
      payload: {
        issueId: "issue-subtask",
      },
      contextSnapshot: {
        issueId: "issue-subtask",
        wakeReason: "protocol_review_requested",
      },
    });

    expect(run).toMatchObject({
      id: "run-subtask-1",
      wakeupRequestId: "wake-1",
      status: "queued",
    });
    expect(insertValues.find((entry) => entry.table === agentWakeupRequests)?.value).toMatchObject({
      status: "queued",
      reason: "protocol_review_requested",
    });
    expect(insertValues.find((entry) => entry.table === heartbeatRuns)?.value).toMatchObject({
      wakeupRequestId: "wake-subtask-1",
      contextSnapshot: expect.objectContaining({
        issueId: "issue-subtask",
      }),
    });
    expect(updateSets.find((entry) => entry.table === agentWakeupRequests)?.value).toMatchObject({
      runId: "run-subtask-1",
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

  it("cancels active issue-scoped wakeups and claimed runs, then idles the agent", async () => {
    const activeRun = makeRun({
      id: "run-cancel-1",
      wakeupRequestId: "wake-cancel-1",
      status: "claimed",
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

  it("keeps the excluded active run when cancelling an issue scope", async () => {
    const excludedRun = makeRun({
      id: "run-excluded-1",
      wakeupRequestId: "wake-excluded-1",
      status: "running",
      contextSnapshot: {
        issueId: "issue-3",
      },
    });
    const queuedRun = makeRun({
      id: "run-cancel-3",
      wakeupRequestId: "wake-cancel-3",
      status: "queued",
      contextSnapshot: {
        issueId: "issue-3",
      },
    });
    const cancelledRun = {
      ...queuedRun,
      status: "cancelled",
      finishedAt: new Date("2026-03-13T05:10:00Z"),
      error: "Cancelled by control plane",
      errorCode: "cancelled",
    };
    const { db, updateSets } = createHeartbeatDbMock({
      selectRows: new Map([
        [agentWakeupRequests, [[{ id: "wake-cancel-3" }]]],
        [heartbeatRuns, [[excludedRun, queuedRun], [queuedRun], [queuedRun], [{ count: 0 }]]],
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
        issueId: "issue-3",
        excludeRunId: "run-excluded-1",
      }),
    ).resolves.toEqual({
      cancelledWakeupCount: 1,
      cancelledRunCount: 1,
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

  it("resets only task-scoped sessions without wiping runtime state when a task key is provided", async () => {
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

    const result = await service.resetRuntimeSession("agent-1", { taskKey: "issue:1" });

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
    });
    expect(updateSets.find((entry) => entry.table === agentRuntimeState)?.value).not.toHaveProperty("stateJson");
  });

  it("cancels superseded follow-up wakeups and claimed runs while excluding the active run that should remain", async () => {
    const supersededRun = makeRun({
      id: "run-superseded-1",
      wakeupRequestId: "wake-superseded-1",
      status: "claimed",
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

  it("invokes an agent through the wakeup wrapper with actor context", async () => {
    const { db, insertValues } = createHeartbeatDbMock({
      selectRows: new Map([
        [agents, [[makeAgent()]]],
        [heartbeatRuns, [[]]],
        [agentRuntimeState, [[]]],
      ]),
      insertRows: new Map([
        [agentWakeupRequests, [[{ id: "wake-invoke-1" }]]],
        [heartbeatRuns, [[makeRun({
          id: "run-invoke-1",
          wakeupRequestId: "wake-invoke-1",
          invocationSource: "on_demand",
          triggerDetail: "manual",
        })]]],
      ]),
    });
    const service = heartbeatService(db as never);

    const run = await service.invoke(
      "agent-1",
      "on_demand",
      { source: "manual.invoke" },
      "manual",
      { actorType: "user", actorId: "board-1" },
    );

    expect(run).toMatchObject({
      id: "run-invoke-1",
      wakeupRequestId: "wake-invoke-1",
      invocationSource: "on_demand",
    });
    expect(insertValues.find((entry) => entry.table === agentWakeupRequests)?.value).toMatchObject({
      source: "on_demand",
      triggerDetail: "manual",
      requestedByActorType: "user",
      requestedByActorId: "board-1",
    });
  });

  it("ticks timers for overdue active agents and skips recent, disabled, or paused agents", async () => {
    const overdueAgent = makeAgent({
      id: "agent-overdue",
      lastHeartbeatAt: new Date("2026-03-13T04:00:00Z"),
      runtimeConfig: {
        heartbeat: {
          enabled: true,
          intervalSec: 60,
          wakeOnDemand: true,
          maxConcurrentRuns: 1,
        },
      },
    });
    const recentAgent = makeAgent({
      id: "agent-recent",
      lastHeartbeatAt: new Date("2026-03-13T05:59:30Z"),
    });
    const pausedAgent = makeAgent({
      id: "agent-paused",
      status: "paused",
    });
    const disabledAgent = makeAgent({
      id: "agent-disabled",
      runtimeConfig: {
        heartbeat: {
          enabled: false,
          intervalSec: 60,
        },
      },
    });
    const { db, insertValues } = createHeartbeatDbMock({
      selectRows: new Map([
        [agents, [[overdueAgent, recentAgent, pausedAgent, disabledAgent], [overdueAgent]]],
        [heartbeatRuns, [[]]],
        [agentRuntimeState, [[]]],
      ]),
      insertRows: new Map([
        [agentWakeupRequests, [[{ id: "wake-timer-1" }]]],
        [heartbeatRuns, [[makeRun({
          id: "run-timer-1",
          agentId: "agent-overdue",
          invocationSource: "timer",
          triggerDetail: "system",
          wakeupRequestId: "wake-timer-1",
        })]]],
      ]),
    });
    const service = heartbeatService(db as never);

    const result = await service.tickTimers(new Date("2026-03-13T06:00:00Z"));

    expect(result).toEqual({
      checked: 2,
      enqueued: 1,
      skipped: 0,
    });
    expect(insertValues.find((entry) => entry.table === agentWakeupRequests)?.value).toMatchObject({
      agentId: "agent-overdue",
      source: "timer",
      triggerDetail: "system",
      reason: "heartbeat_timer",
    });
  });

  it("cancels queued or running work for a paused agent", async () => {
    const queuedRun = makeRun({
      id: "run-pause-1",
      wakeupRequestId: "wake-pause-1",
      status: "queued",
    });
    const cancelledRun = {
      ...queuedRun,
      status: "cancelled",
      finishedAt: new Date("2026-03-13T05:30:00Z"),
      error: "Cancelled due to agent pause",
      errorCode: "cancelled",
    };
    const { db, updateSets, conflictSets } = createHeartbeatDbMock({
      selectRows: new Map([
        [heartbeatRuns, [[queuedRun]]],
        [issues, [[]]],
      ]),
      updateRows: new Map([
        [heartbeatRuns, [[cancelledRun]]],
      ]),
    });
    const service = heartbeatService(db as never);

    const cancelledCount = await service.cancelActiveForAgent("agent-1");

    expect(cancelledCount).toBe(1);
    expect(updateSets.find((entry) => entry.table === heartbeatRuns)?.value).toMatchObject({
      status: "cancelled",
      errorCode: "cancelled",
    });
    expect(updateSets.find((entry) => entry.table === agentWakeupRequests)?.value).toMatchObject({
      status: "cancelled",
      error: "Cancelled due to agent pause",
    });
    expect(conflictSets.find((entry) => entry.table === heartbeatRunLeases)?.value).toMatchObject({
      status: "cancelled",
      checkpointJson: expect.objectContaining({
        phase: "finalize.cancelled",
      }),
    });
  });

  it("reaps stale queued or running runs that no longer have a live process", async () => {
    const staleQueuedRun = makeRun({
      id: "run-stale-queued",
      wakeupRequestId: "wake-stale-queued",
      status: "queued",
      updatedAt: new Date("2026-03-13T00:00:00Z"),
    });
    const staleRunningRun = makeRun({
      id: "run-stale-running",
      wakeupRequestId: "wake-stale-running",
      status: "running",
      updatedAt: new Date("2026-03-13T00:00:00Z"),
    });
    const failedQueuedRun = {
      ...staleQueuedRun,
      status: "failed",
      finishedAt: new Date("2026-03-13T06:00:00Z"),
      error: "Process lost during queue.created -- server may have restarted",
      errorCode: "process_lost",
    };
    const failedRunningRun = {
      ...staleRunningRun,
      status: "failed",
      finishedAt: new Date("2026-03-13T06:00:00Z"),
      error: "Process lost during adapter.execute_start -- server may have restarted",
      errorCode: "process_lost",
    };
    const { db, updateSets, conflictSets } = createHeartbeatDbMock({
      selectRows: new Map([
        [heartbeatRuns, [[staleQueuedRun, staleRunningRun]]],
        [heartbeatRunLeases, [[
          {
            runId: "run-stale-queued",
            status: "queued",
            heartbeatAt: null,
            leaseExpiresAt: null,
            updatedAt: new Date("2026-03-13T00:00:00Z"),
            checkpointJson: { phase: "queue.created" },
          },
          {
            runId: "run-stale-running",
            status: "executing",
            heartbeatAt: new Date("2026-03-13T00:00:00Z"),
            leaseExpiresAt: new Date("2026-03-13T00:01:00Z"),
            updatedAt: new Date("2026-03-13T00:00:00Z"),
            checkpointJson: { phase: "adapter.execute_start" },
          },
        ]]],
      ]),
      updateRows: new Map([
        [heartbeatRuns, [[failedQueuedRun], [failedRunningRun]]],
      ]),
    });
    const service = heartbeatService(db as never);

    const result = await service.reapOrphanedRuns({ staleThresholdMs: 1 });

    expect(result).toEqual({
      reaped: 2,
      runIds: ["run-stale-queued", "run-stale-running"],
    });
    expect(updateSets.filter((entry) => entry.table === heartbeatRuns)).toHaveLength(2);
    expect(updateSets.filter((entry) => entry.table === agentWakeupRequests)).toEqual([
      expect.objectContaining({
        value: expect.objectContaining({
          status: "failed",
          error: "Process lost during queue.created -- server may have restarted",
        }),
      }),
      expect.objectContaining({
        value: expect.objectContaining({
          status: "failed",
          error: "Process lost during adapter.execute_start -- server may have restarted",
        }),
      }),
    ]);
    expect(conflictSets.filter((entry) => entry.table === heartbeatRunLeases)).toEqual([
      expect.objectContaining({
        value: expect.objectContaining({
          status: "lost",
          checkpointJson: expect.objectContaining({ phase: "queue.created" }),
        }),
      }),
      expect.objectContaining({
        value: expect.objectContaining({
          status: "lost",
          checkpointJson: expect.objectContaining({ phase: "adapter.execute_start" }),
        }),
      }),
    ]);
  });

  it("does not reap fresh runs that still hold a healthy lease", async () => {
    const healthyRun = makeRun({
      id: "run-healthy",
      wakeupRequestId: "wake-healthy",
      status: "running",
      updatedAt: new Date(),
    });
    const { db, updateSets, conflictSets } = createHeartbeatDbMock({
      selectRows: new Map([
        [heartbeatRuns, [[healthyRun]]],
        [heartbeatRunLeases, [[{
          runId: "run-healthy",
          status: "executing",
          heartbeatAt: new Date(),
          leaseExpiresAt: new Date(Date.now() + 60_000),
          updatedAt: new Date(),
          checkpointJson: { phase: "adapter.execute_start" },
        }]]],
      ]),
    });
    const service = heartbeatService(db as never);

    const result = await service.reapOrphanedRuns({ staleThresholdMs: 60_000 });

    expect(result).toEqual({
      reaped: 0,
      runIds: [],
    });
    expect(updateSets).toEqual([]);
    expect(conflictSets).toEqual([]);
  });
});

describe("concurrency and execution lock guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnqueueAfterDbCommit.mockReturnValue(true);
    mockRunWithoutDbContext.mockImplementation((fn: () => unknown) => fn());
  });

  it("defers wakeup when issue already has an active execution run by another agent", async () => {
    // agent-2 owns a running heartbeat run on the issue; agent-1 tries to wake the same issue
    const activeRunByAgent2 = makeRun({
      id: "run-agent2-active",
      agentId: "agent-2",
      status: "running",
      contextSnapshot: { issueId: "issue-locked" },
    });
    const { db, insertValues } = createHeartbeatDbMock({
      selectRows: new Map([
        // getAgent(agent-1)
        [agents, [[makeAgent({ id: "agent-1", name: "Engineer One" })], [{ name: "Engineer Two" }]]],
        // issue lookup inside transaction
        [issues, [[{
          id: "issue-locked",
          companyId: "company-1",
          priority: "high",
          parentId: null,
          executionRunId: "run-agent2-active",
          executionAgentNameKey: "engineer two",
        }]]],
        // heartbeatRuns lookup for activeExecutionRun (by executionRunId)
        [heartbeatRuns, [[activeRunByAgent2]]],
        // agentWakeupRequests lookup for existing deferred (none)
        [agentWakeupRequests, [[]]],
        // agentRuntimeState for resolveSessionBefore
        [agentRuntimeState, [[]]],
        // agentTaskSessions
        [agentTaskSessions, [[]]],
      ]),
    });
    const service = heartbeatService(db as never);

    const run = await service.wakeup("agent-1", {
      source: "automation",
      triggerDetail: "system",
      reason: "protocol_required_retry",
      payload: { issueId: "issue-locked" },
      contextSnapshot: { issueId: "issue-locked" },
    });

    // Wakeup returns null because execution is deferred
    expect(run).toBeNull();
    // A deferred wakeup request should have been inserted
    const deferredInsert = insertValues.find(
      (entry) =>
        entry.table === agentWakeupRequests &&
        (entry.value as Record<string, unknown>).status === "deferred_issue_execution",
    );
    expect(deferredInsert).toBeDefined();
    expect(deferredInsert!.value).toMatchObject({
      agentId: "agent-1",
      reason: "issue_execution_deferred",
      status: "deferred_issue_execution",
    });
    // No heartbeat run should have been created
    expect(insertValues.some((entry) => entry.table === heartbeatRuns)).toBe(false);
  });

  it("coalesces same-agent wakeup when execution run is already active (no new run created)", async () => {
    // agent-1 has a queued run on the issue; agent-1 sends another wakeup (no commentId, no forceFollowup)
    const existingRunByAgent1 = makeRun({
      id: "run-agent1-queued",
      agentId: "agent-1",
      status: "queued",
      contextSnapshot: { issueId: "issue-coalesce" },
    });
    const mergedRun = {
      ...existingRunByAgent1,
      contextSnapshot: {
        issueId: "issue-coalesce",
        wakeReason: "protocol_required_retry",
        wakeSource: "automation",
        wakeTriggerDetail: "system",
      },
    };
    const { db, insertValues, updateSets } = createHeartbeatDbMock({
      selectRows: new Map([
        // getAgent(agent-1)
        [agents, [[makeAgent({ id: "agent-1", name: "Engineer One" })], [{ name: "Engineer One" }]]],
        // issue lookup inside transaction
        [issues, [[{
          id: "issue-coalesce",
          companyId: "company-1",
          priority: "medium",
          parentId: null,
          executionRunId: "run-agent1-queued",
          executionAgentNameKey: "engineer one",
        }]]],
        // heartbeatRuns lookup for activeExecutionRun (the queued run by agent-1)
        [heartbeatRuns, [[existingRunByAgent1]]],
        // agentRuntimeState for resolveSessionBefore
        [agentRuntimeState, [[]]],
        // agentTaskSessions
        [agentTaskSessions, [[]]],
      ]),
      updateRows: new Map([
        // update heartbeatRuns with merged context snapshot
        [heartbeatRuns, [[mergedRun]]],
      ]),
    });
    const service = heartbeatService(db as never);

    const run = await service.wakeup("agent-1", {
      source: "automation",
      triggerDetail: "system",
      reason: "protocol_required_retry",
      payload: { issueId: "issue-coalesce" },
      contextSnapshot: { issueId: "issue-coalesce" },
    });

    // Coalesced: existing run is returned
    expect(run).toMatchObject({
      id: "run-agent1-queued",
      contextSnapshot: expect.objectContaining({
        issueId: "issue-coalesce",
      }),
    });
    // The wakeup request should be recorded as coalesced
    const coalescedInsert = insertValues.find(
      (entry) =>
        entry.table === agentWakeupRequests &&
        (entry.value as Record<string, unknown>).status === "coalesced",
    );
    expect(coalescedInsert).toBeDefined();
    expect(coalescedInsert!.value).toMatchObject({
      reason: "issue_execution_same_name",
      status: "coalesced",
      runId: "run-agent1-queued",
    });
    // The existing run's contextSnapshot should have been merged (via update)
    expect(updateSets.find((entry) => entry.table === heartbeatRuns)?.value).toMatchObject({
      contextSnapshot: expect.objectContaining({
        issueId: "issue-coalesce",
      }),
    });
    // No new heartbeat run was inserted
    expect(insertValues.some((entry) => entry.table === heartbeatRuns)).toBe(false);
  });

  it("clears stale executionRunId when referenced run is terminal and creates a new run", async () => {
    // issue has executionRunId pointing to a completed (terminal) run
    const completedRun = makeRun({
      id: "run-completed",
      agentId: "agent-1",
      status: "completed",
      contextSnapshot: { issueId: "issue-stale" },
    });
    const newCreatedRun = makeRun({
      id: "run-fresh-1",
      agentId: "agent-1",
      status: "queued",
      wakeupRequestId: "wake-stale-1",
      contextSnapshot: {
        issueId: "issue-stale",
        wakeReason: "protocol_required_retry",
        wakeSource: "automation",
        wakeTriggerDetail: "system",
      },
    });
    const { db, insertValues, updateSets } = createHeartbeatDbMock({
      selectRows: new Map([
        // getAgent(agent-1)
        [agents, [[makeAgent({ id: "agent-1", name: "Engineer One" })]]],
        // issue lookup inside transaction
        [issues, [[{
          id: "issue-stale",
          companyId: "company-1",
          priority: "high",
          parentId: null,
          executionRunId: "run-completed",
          executionAgentNameKey: "engineer one",
        }]]],
        // heartbeatRuns: first query is the existing executionRunId run (completed/terminal)
        // second query is the legacy run lookup (none found)
        [heartbeatRuns, [[completedRun], []]],
        // agentRuntimeState for resolveSessionBefore
        [agentRuntimeState, [[]]],
        // agentTaskSessions
        [agentTaskSessions, [[]]],
      ]),
      insertRows: new Map([
        // agentWakeupRequests insert (the new queued request)
        [agentWakeupRequests, [[{ id: "wake-stale-1" }]]],
        // heartbeatRuns insert (the new run)
        [heartbeatRuns, [[newCreatedRun]]],
      ]),
    });
    const service = heartbeatService(db as never);

    const run = await service.wakeup("agent-1", {
      source: "automation",
      triggerDetail: "system",
      reason: "protocol_required_retry",
      payload: { issueId: "issue-stale" },
      contextSnapshot: { issueId: "issue-stale" },
    });

    // New run should be created after stale lock is cleared
    expect(run).toMatchObject({
      id: "run-fresh-1",
      status: "queued",
      wakeupRequestId: "wake-stale-1",
    });
    // The stale executionRunId should have been cleared first
    const issueUpdateClearingLock = updateSets.find(
      (entry) =>
        entry.table === issues &&
        (entry.value as Record<string, unknown>).executionRunId === null,
    );
    expect(issueUpdateClearingLock).toBeDefined();
    expect(issueUpdateClearingLock!.value).toMatchObject({
      executionRunId: null,
      executionAgentNameKey: null,
      executionLockedAt: null,
    });
    // Then the new run should be linked to the issue
    const issueUpdateNewLock = updateSets.find(
      (entry) =>
        entry.table === issues &&
        (entry.value as Record<string, unknown>).executionRunId === "run-fresh-1",
    );
    expect(issueUpdateNewLock).toBeDefined();
    expect(issueUpdateNewLock!.value).toMatchObject({
      executionRunId: "run-fresh-1",
      executionAgentNameKey: "engineer one",
    });
    // A new heartbeat run was inserted
    expect(insertValues.some((entry) => entry.table === heartbeatRuns)).toBe(true);
    expect(mockPublishLiveEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: "heartbeat.run.queued",
    }));
  });
});
