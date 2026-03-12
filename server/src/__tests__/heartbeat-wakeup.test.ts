import { describe, expect, it } from "vitest";
import {
  buildDeferredIssueWakePayload,
  buildHeartbeatRunQueuedEvent,
  buildWakeupRequestValues,
  describeSessionResetReason,
  enrichWakeContextSnapshot,
  mergeCoalescedContextSnapshot,
  selectWakeupCoalescedRun,
  shouldBypassIssueExecutionLock,
} from "../services/heartbeat.js";

describe("heartbeat wakeup helpers", () => {
  it("enriches wake context from reason, payload, and trigger metadata", () => {
    const result = enrichWakeContextSnapshot({
      contextSnapshot: {},
      reason: "issue_comment_mentioned",
      source: "automation",
      triggerDetail: "system",
      payload: {
        issueId: "issue-1",
        commentId: "comment-1",
      },
    });

    expect(result.issueIdFromPayload).toBe("issue-1");
    expect(result.commentIdFromPayload).toBe("comment-1");
    expect(result.taskKey).toBe("issue-1");
    expect(result.wakeCommentId).toBe("comment-1");
    expect(result.contextSnapshot).toMatchObject({
      wakeReason: "issue_comment_mentioned",
      issueId: "issue-1",
      taskId: "issue-1",
      taskKey: "issue-1",
      commentId: "comment-1",
      wakeCommentId: "comment-1",
      wakeSource: "automation",
      wakeTriggerDetail: "system",
    });
  });

  it("merges coalesced context and promotes the latest comment id", () => {
    const merged = mergeCoalescedContextSnapshot(
      {
        taskKey: "issue-1",
        wakeReason: "timer",
        commentId: "old-comment",
      },
      {
        forceFollowupRun: true,
        commentId: "new-comment",
      },
    );

    expect(merged).toMatchObject({
      taskKey: "issue-1",
      wakeReason: "timer",
      forceFollowupRun: true,
      commentId: "new-comment",
      wakeCommentId: "new-comment",
    });
  });

  it("describes reset reason and execution-lock bypass consistently", () => {
    expect(
      describeSessionResetReason({
        protocolRequiredRetryCount: 1,
      }),
    ).toBe("a protocol-required retry is forcing a fresh session");
    expect(
      describeSessionResetReason({
        wakeSource: "on_demand",
        wakeTriggerDetail: "manual",
      }),
    ).toBe("this is a manual invoke");

    expect(
      shouldBypassIssueExecutionLock({
        reason: "issue_comment_mentioned",
        contextSnapshot: {},
      }),
    ).toBe(true);
    expect(
      shouldBypassIssueExecutionLock({
        reason: "issue_assigned",
        contextSnapshot: {
          wakeReason: "issue_comment_mentioned",
        },
      }),
    ).toBe(true);
    expect(
      shouldBypassIssueExecutionLock({
        reason: "issue_assigned",
        contextSnapshot: {},
      }),
    ).toBe(false);
  });

  it("prefers queued same-scope runs and preserves comment follow-up queues", () => {
    const queuedTarget = selectWakeupCoalescedRun({
      activeRuns: [
        {
          id: "run-queued",
          status: "queued",
          contextSnapshot: {
            taskKey: "issue-1",
          },
        },
        {
          id: "run-running",
          status: "running",
          contextSnapshot: {
            taskKey: "issue-1",
          },
        },
      ],
      taskKey: "issue-1",
      wakeCommentId: null,
    });

    expect(queuedTarget.coalescedTargetRun?.id).toBe("run-queued");
    expect(queuedTarget.shouldQueueFollowupForCommentWake).toBe(false);

    const commentWakeTarget = selectWakeupCoalescedRun({
      activeRuns: [
        {
          id: "run-running",
          status: "running",
          contextSnapshot: {
            taskKey: "issue-2",
          },
        },
      ],
      taskKey: "issue-2",
      wakeCommentId: "comment-2",
    });

    expect(commentWakeTarget.sameScopeRunningRun?.id).toBe("run-running");
    expect(commentWakeTarget.shouldQueueFollowupForCommentWake).toBe(true);
    expect(commentWakeTarget.coalescedTargetRun).toBeNull();
  });

  it("builds deferred wake payloads, wakeup request values, and queue events", () => {
    const deferredPayload = buildDeferredIssueWakePayload({
      payload: { commentId: "comment-3" },
      issueId: "issue-3",
      contextSnapshot: { wakeReason: "issue_watch_assigned" },
    });
    expect(deferredPayload).toMatchObject({
      issueId: "issue-3",
      commentId: "comment-3",
      _squadrailWakeContext: {
        wakeReason: "issue_watch_assigned",
      },
    });

    const requestValues = buildWakeupRequestValues({
      companyId: "company-1",
      agentId: "agent-1",
      source: "automation",
      triggerDetail: null,
      reason: "issue_execution_deferred",
      payload: deferredPayload,
      status: "deferred_issue_execution",
    });
    expect(requestValues).toMatchObject({
      companyId: "company-1",
      agentId: "agent-1",
      source: "automation",
      triggerDetail: null,
      reason: "issue_execution_deferred",
      status: "deferred_issue_execution",
      requestedByActorType: null,
      requestedByActorId: null,
      idempotencyKey: null,
      runId: null,
      finishedAt: null,
    });
    expect(requestValues.coalescedCount).toBeUndefined();

    const queuedEvent = buildHeartbeatRunQueuedEvent({
      companyId: "company-1",
      runId: "run-1",
      agentId: "agent-1",
      invocationSource: "automation",
      triggerDetail: "system",
      wakeupRequestId: "wake-1",
    });
    expect(queuedEvent).toEqual({
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
