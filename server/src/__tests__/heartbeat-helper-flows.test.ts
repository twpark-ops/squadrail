import { describe, expect, it } from "vitest";
import {
  buildDeferredIssueWakePayload,
  buildDeferredWakePromotionPlan,
  buildHeartbeatRunQueuedEvent,
  buildTaskSessionUpsertSet,
  buildWakeupRequestValues,
  describeSessionResetReason,
  insertOrRefetchSingleton,
  mergeCoalescedContextSnapshot,
  resolveNextSessionState,
  selectWakeupCoalescedRun,
  shouldBypassIssueExecutionLock,
  shouldQueueFollowupIssueExecution,
} from "../services/heartbeat.js";

describe("heartbeat helper flows", () => {
  it("builds session upsert sets and refetches singleton rows when inserts race", async () => {
    const updatedAt = new Date("2026-03-13T10:00:00.000Z");
    expect(buildTaskSessionUpsertSet({
      sessionParamsJson: { sessionId: "sess-1" },
      sessionDisplayId: "sess-1",
      lastRunId: "run-1",
      lastError: null,
    }, updatedAt)).toEqual({
      sessionParamsJson: { sessionId: "sess-1" },
      sessionDisplayId: "sess-1",
      lastRunId: "run-1",
      lastError: null,
      updatedAt,
    });

    await expect(insertOrRefetchSingleton({
      insert: async () => ({ id: "row-1" }),
      refetch: async () => ({ id: "row-2" }),
    })).resolves.toEqual({ id: "row-1" });

    await expect(insertOrRefetchSingleton({
      insert: async () => null,
      refetch: async () => ({ id: "row-2" }),
    })).resolves.toEqual({ id: "row-2" });
  });

  it("derives session reset reasons and coalesces follow-up wakes", () => {
    expect(describeSessionResetReason({
      wakeReason: "protocol_required_retry",
    })).toBe("wake reason is protocol_required_retry");
    expect(describeSessionResetReason({
      protocolRequiredRetryCount: 2,
    })).toBe("a protocol-required retry is forcing a fresh session");
    expect(describeSessionResetReason({
      wakeSource: "timer",
    })).toBe("wake source is timer");
    expect(describeSessionResetReason({
      wakeSource: "on_demand",
      wakeTriggerDetail: "manual",
    })).toBe("this is a manual invoke");
    expect(describeSessionResetReason({
      wakeSource: "automation",
    })).toBeNull();

    expect(shouldQueueFollowupIssueExecution({
      sameExecutionAgent: true,
      activeExecutionRunStatus: "running",
      wakeCommentId: "comment-1",
      contextSnapshot: {},
    })).toBe(true);
    expect(shouldQueueFollowupIssueExecution({
      sameExecutionAgent: false,
      activeExecutionRunStatus: "running",
      wakeCommentId: "comment-1",
      contextSnapshot: { forceFollowupRun: true },
    })).toBe(false);
    expect(shouldQueueFollowupIssueExecution({
      sameExecutionAgent: true,
      activeExecutionRunStatus: "idle",
      wakeCommentId: null,
      contextSnapshot: { forceFollowupRun: true },
    })).toBe(true);
    expect(shouldBypassIssueExecutionLock({
      reason: "issue_comment_mentioned",
      contextSnapshot: {},
    })).toBe(true);
    expect(shouldBypassIssueExecutionLock({
      reason: null,
      contextSnapshot: { wakeReason: "issue_comment_mentioned" },
    })).toBe(true);

    expect(selectWakeupCoalescedRun({
      activeRuns: [
        {
          id: "run-queued",
          status: "queued",
          contextSnapshot: { taskKey: "issue-1" },
        },
        {
          id: "run-running",
          status: "running",
          contextSnapshot: { issueId: "issue-1" },
        },
      ],
      taskKey: "issue-1",
      wakeCommentId: "comment-1",
    })).toEqual(expect.objectContaining({
      sameScopeQueuedRun: expect.objectContaining({ id: "run-queued" }),
      sameScopeRunningRun: expect.objectContaining({ id: "run-running" }),
      shouldQueueFollowupForCommentWake: false,
      coalescedTargetRun: expect.objectContaining({ id: "run-queued" }),
    }));

    expect(selectWakeupCoalescedRun({
      activeRuns: [
        {
          id: "run-running",
          status: "running",
          contextSnapshot: { issueId: "issue-2" },
        },
      ],
      taskKey: "issue-2",
      wakeCommentId: "comment-2",
    })).toEqual(expect.objectContaining({
      sameScopeQueuedRun: null,
      sameScopeRunningRun: expect.objectContaining({ id: "run-running" }),
      shouldQueueFollowupForCommentWake: true,
      coalescedTargetRun: null,
    }));
  });

  it("promotes deferred wakes and resolves next session state transitions", () => {
    const deferredPayload = buildDeferredIssueWakePayload({
      payload: { commentId: "comment-1" },
      issueId: "issue-1",
      contextSnapshot: {
        taskKey: "issue-1",
        issuePriority: "high",
      },
    });

    expect(deferredPayload).toEqual({
      commentId: "comment-1",
      issueId: "issue-1",
      _squadrailWakeContext: {
        taskKey: "issue-1",
        issuePriority: "high",
      },
    });

    expect(buildDeferredWakePromotionPlan({
      deferredPayload,
      deferredReason: "issue_ready_for_closure",
      deferredSource: "automation",
      deferredTriggerDetail: "system",
    })).toEqual(expect.objectContaining({
      promotedReason: "issue_ready_for_closure",
      promotedSource: "automation",
      promotedTriggerDetail: "system",
      promotedPayload: {
        commentId: "comment-1",
        issueId: "issue-1",
      },
      promotedContextSnapshot: expect.objectContaining({
        wakeReason: "issue_ready_for_closure",
        wakeSource: "automation",
        wakeTriggerDetail: "system",
        commentId: "comment-1",
        wakeCommentId: "comment-1",
      }),
      promotedTaskKey: "issue-1",
    }));

    const codec = {
      serialize(params: Record<string, unknown> | null) {
        return params;
      },
      deserialize(raw: unknown) {
        return raw as Record<string, unknown> | null;
      },
      getDisplayId(params: Record<string, unknown> | null) {
        return typeof params?.displayId === "string" ? params.displayId : null;
      },
    };

    expect(resolveNextSessionState({
      codec,
      adapterResult: {
        clearSession: true,
      } as never,
      previousParams: { sessionId: "sess-1" },
      previousDisplayId: "sess-1",
      previousLegacySessionId: "sess-1",
    })).toEqual({
      params: null,
      displayId: null,
      legacySessionId: null,
    });

    expect(resolveNextSessionState({
      codec,
      adapterResult: {
        sessionParams: {
          displayId: "display-2",
          sessionId: "sess-2",
        },
      } as never,
      previousParams: { sessionId: "sess-1" },
      previousDisplayId: "sess-1",
      previousLegacySessionId: "sess-1",
    })).toEqual({
      params: {
        displayId: "display-2",
        sessionId: "sess-2",
      },
      displayId: "display-2",
      legacySessionId: "sess-2",
    });
  });

  it("builds normalized wakeup persistence payloads and queue events", () => {
    expect(mergeCoalescedContextSnapshot(
      { issueId: "issue-1", wakeReason: "existing" },
      { commentId: "comment-3", extra: true },
    )).toEqual({
      issueId: "issue-1",
      wakeReason: "existing",
      commentId: "comment-3",
      wakeCommentId: "comment-3",
      extra: true,
    });

    expect(buildWakeupRequestValues({
      companyId: "company-1",
      agentId: "agent-1",
      source: "automation",
      triggerDetail: "system",
      reason: "issue_ready_for_closure",
      payload: { issueId: "issue-1" },
      status: "queued",
      requestedByActorType: "system",
      requestedByActorId: "scheduler",
      idempotencyKey: "wake-1",
      coalescedCount: 2,
    })).toEqual({
      companyId: "company-1",
      agentId: "agent-1",
      source: "automation",
      triggerDetail: "system",
      reason: "issue_ready_for_closure",
      payload: { issueId: "issue-1" },
      status: "queued",
      requestedByActorType: "system",
      requestedByActorId: "scheduler",
      idempotencyKey: "wake-1",
      runId: null,
      finishedAt: null,
      coalescedCount: 2,
    });

    expect(buildHeartbeatRunQueuedEvent({
      companyId: "company-1",
      runId: "run-1",
      agentId: "agent-1",
      invocationSource: "automation",
      triggerDetail: "system",
      wakeupRequestId: "wake-1",
    })).toEqual({
      companyId: "company-1",
      type: "heartbeat.run.queued",
      payload: {
        runId: "run-1",
        agentId: "agent-1",
        invocationSource: "automation",
        triggerDetail: "system",
        wakeupRequestId: "wake-1",
      },
    });
  });
});
