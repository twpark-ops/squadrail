import { describe, expect, it } from "vitest";
import {
  attachResolvedWorkspaceContextToRunContext,
  buildDeferredIssueWakePayload,
  buildDeferredWakePromotionPlan,
  buildHeartbeatCancellationArtifacts,
  buildHeartbeatOutcomePersistence,
  buildHeartbeatRunQueuedEvent,
  buildProcessLostError,
  buildRequiredProtocolProgressError,
  buildTaskSessionUpsertSet,
  buildWakeupRequestValues,
  computeLeaseExpiresAt,
  decideDispatchWatchdogAction,
  describeSessionResetReason,
  deriveCommentId,
  deriveTaskKey,
  enrichWakeContextSnapshot,
  hasRequiredProtocolProgress,
  isSupersededProtocolWakeReason,
  isWorkflowStateEligibleForProtocolRetry,
  mergeCoalescedContextSnapshot,
  mergeRunResultJson,
  normalizeAgentNameKey,
  normalizeIssuePriorityValue,
  normalizeMaxConcurrentRuns,
  normalizeSessionParams,
  parseHeartbeatPolicyConfig,
  parseIssueAssigneeAdapterOverrides,
  priorityClassFromRank,
  priorityRank,
  readNonEmptyString,
  refreshPromotedIssueExecutionContextSnapshot,
  resolveHeartbeatRunOutcome,
  resolveNextSessionState,
  selectWakeupCoalescedRun,
  shouldBypassIssueExecutionLock,
  shouldEnqueueProtocolRequiredRetry,
  shouldQueueFollowupIssueExecution,
  shouldReapHeartbeatRun,
  shouldResetTaskSessionForWake,
  shouldSkipSupersededProtocolFollowup,
  toEpochMillis,
  truncateDisplayId,
} from "../services/heartbeat.js";

describe("heartbeat internal helpers", () => {
  it("normalizes heartbeat concurrency and runtime policy config", () => {
    expect(normalizeMaxConcurrentRuns(undefined)).toBe(1);
    expect(normalizeMaxConcurrentRuns(0)).toBe(1);
    expect(normalizeMaxConcurrentRuns(25)).toBe(10);
    expect(normalizeMaxConcurrentRuns(2.8)).toBe(2);

    expect(parseHeartbeatPolicyConfig({
      heartbeat: {
        enabled: false,
        intervalSec: -5,
        wakeOnAssignment: false,
        maxConcurrentRuns: 4.9,
      },
    })).toEqual({
      enabled: false,
      intervalSec: 0,
      wakeOnDemand: false,
      maxConcurrentRuns: 4,
    });
  });

  it("reads normalized strings and issue priorities", () => {
    expect(readNonEmptyString("  retry ")).toBe("  retry ");
    expect(readNonEmptyString("   ")).toBeNull();
    expect(readNonEmptyString(null)).toBeNull();

    expect(normalizeIssuePriorityValue("CRITICAL")).toBe("critical");
    expect(normalizeIssuePriorityValue("medium")).toBe("medium");
    expect(normalizeIssuePriorityValue("later")).toBeNull();
  });

  it("maps priority ranks to dispatch classes", () => {
    expect(priorityRank("critical")).toBe(3);
    expect(priorityRank("high")).toBe(2);
    expect(priorityRank("medium")).toBe(1);
    expect(priorityRank(null)).toBe(0);

    expect(priorityClassFromRank(4)).toBe("critical");
    expect(priorityClassFromRank(2)).toBe("high");
    expect(priorityClassFromRank(1)).toBe("normal");
    expect(priorityClassFromRank(0)).toBe("low");
  });

  it("parses assignee overrides and task/comment keys from wake context", () => {
    expect(parseIssueAssigneeAdapterOverrides(null)).toBeNull();
    expect(parseIssueAssigneeAdapterOverrides({
      adapterConfig: {
        sandboxMode: "workspace-write",
      },
      useProjectWorkspace: true,
    })).toEqual({
      adapterConfig: {
        sandboxMode: "workspace-write",
      },
      useProjectWorkspace: true,
    });
    expect(parseIssueAssigneeAdapterOverrides({
      adapterConfig: {},
      useProjectWorkspace: "bad",
    })).toBeNull();

    expect(deriveTaskKey(
      { taskKey: "task-1", taskId: "task-2", issueId: "issue-1" },
      { taskId: "task-3" },
    )).toBe("task-1");
    expect(deriveTaskKey(
      {},
      { taskId: "task-3", issueId: "issue-2" },
    )).toBe("task-3");
    expect(deriveCommentId(
      { wakeCommentId: "comment-1", commentId: "comment-2" },
      { commentId: "comment-3" },
    )).toBe("comment-1");
    expect(deriveCommentId(
      {},
      { commentId: "comment-3" },
    )).toBe("comment-3");
  });

  it("normalizes display/session ids and lease timestamps", () => {
    expect(truncateDisplayId("session-123", 20)).toBe("session-123");
    expect(truncateDisplayId("abcdefghijklmnopqrstuvwxyz", 10)).toBe("abcdefghij");
    expect(truncateDisplayId(null)).toBeNull();

    const now = new Date("2026-03-13T12:00:00.000Z");
    expect(toEpochMillis(now)).toBe(now.getTime());
    expect(toEpochMillis("2026-03-13T12:01:00.000Z")).toBe(new Date("2026-03-13T12:01:00.000Z").getTime());
    expect(toEpochMillis("not-a-date")).toBeNull();

    expect(computeLeaseExpiresAt(now).toISOString()).toBe("2026-03-13T12:00:45.000Z");
    expect(normalizeSessionParams({})).toBeNull();
    expect(normalizeSessionParams({ sessionId: "session-1" })).toEqual({ sessionId: "session-1" });
    expect(normalizeAgentNameKey("  QA Lead  ")).toBe("qa lead");
    expect(normalizeAgentNameKey("   ")).toBeNull();
  });

  it("merges run results and attaches resolved workspace context", () => {
    expect(mergeRunResultJson({ exitCode: 0 }, null)).toEqual({ exitCode: 0 });
    expect(mergeRunResultJson({ exitCode: 0 }, { signal: "SIGTERM" })).toEqual({
      exitCode: 0,
      signal: "SIGTERM",
    });

    const context = attachResolvedWorkspaceContextToRunContext({
      contextSnapshot: {},
      resolvedWorkspace: {
        cwd: "/tmp/worktree",
        source: "project_shared",
        projectId: "project-1",
        workspaceId: "workspace-1",
        repoUrl: "git@github.com:acme/app.git",
        repoRef: "github.com/acme/app",
        executionPolicy: "shared_branch",
        workspaceUsage: "primary",
        branchName: "feature/retry",
        workspaceState: "ready",
        hasLocalChanges: false,
        workspaceHints: [{ projectId: "project-1", cwd: "/tmp/worktree" }],
      },
    });

    expect(context).toMatchObject({
      projectId: "project-1",
      squadrailWorkspace: expect.objectContaining({
        cwd: "/tmp/worktree",
        source: "project_shared",
      }),
      squadrailWorkspaces: [{ projectId: "project-1", cwd: "/tmp/worktree" }],
    });
    expect(buildTaskSessionUpsertSet({
      sessionParamsJson: { sessionId: "runtime-1" },
      sessionDisplayId: "runtime-1",
      lastRunId: "run-1",
      lastError: null,
    }, new Date("2026-03-13T12:00:00.000Z"))).toMatchObject({
      sessionParamsJson: { sessionId: "runtime-1" },
      sessionDisplayId: "runtime-1",
      lastRunId: "run-1",
      lastError: null,
    });
  });

  it("refreshes promoted protocol context with the current workflow state", () => {
    expect(refreshPromotedIssueExecutionContextSnapshot({
      contextSnapshot: {
        issueId: "issue-1",
        protocolMessageType: "APPROVE_IMPLEMENTATION",
        protocolRecipientRole: "qa",
        protocolWorkflowStateBefore: "under_review",
        protocolWorkflowStateAfter: "qa_pending",
        protocolRequiredRetryCount: 2,
      },
      currentWorkflowState: "under_qa_review",
    })).toMatchObject({
      protocolWorkflowStateBefore: "under_qa_review",
      protocolWorkflowStateAfter: "under_qa_review",
      protocolRequiredRetryCount: 2,
    });

    expect(refreshPromotedIssueExecutionContextSnapshot({
      contextSnapshot: {
        issueId: "issue-1",
      },
      currentWorkflowState: "under_qa_review",
    })).toEqual({
      issueId: "issue-1",
    });
  });

  it("derives session reset reasons, coalesced wake context, and follow-up execution rules", () => {
    expect(shouldResetTaskSessionForWake({
      wakeReason: "issue_assigned",
    })).toBe(true);
    expect(describeSessionResetReason({
      wakeReason: "issue_assigned",
    })).toBe("wake reason is issue_assigned");
    expect(shouldResetTaskSessionForWake({
      wakeReason: "issue_ready_for_closure",
    })).toBe(true);
    expect(describeSessionResetReason({
      wakeReason: "issue_ready_for_closure",
    })).toBe("wake reason is issue_ready_for_closure");
    expect(shouldResetTaskSessionForWake({
      wakeSource: "on_demand",
      wakeTriggerDetail: "manual",
    })).toBe(true);
    expect(describeSessionResetReason({
      wakeSource: "on_demand",
      wakeTriggerDetail: "manual",
    })).toBe("this is a manual invoke");

    const enriched = enrichWakeContextSnapshot({
      contextSnapshot: {},
      reason: "issue_comment_mentioned",
      source: "automation",
      triggerDetail: "system",
      payload: {
        issueId: "issue-1",
        commentId: "comment-1",
        priority: "critical",
      },
    });
    expect(enriched.contextSnapshot).toMatchObject({
      wakeReason: "issue_comment_mentioned",
      issueId: "issue-1",
      taskId: "issue-1",
      taskKey: "issue-1",
      commentId: "comment-1",
      wakeCommentId: "comment-1",
      wakeSource: "automation",
      wakeTriggerDetail: "system",
      issuePriority: "critical",
    });

    expect(mergeCoalescedContextSnapshot(
      { previous: true, commentId: "old" },
      { wakeCommentId: "comment-2", taskId: "issue-2" },
    )).toMatchObject({
      previous: true,
      taskId: "issue-2",
      commentId: "comment-2",
      wakeCommentId: "comment-2",
    });

    expect(shouldQueueFollowupIssueExecution({
      sameExecutionAgent: true,
      activeExecutionRunStatus: "running",
      wakeCommentId: "comment-2",
      contextSnapshot: {},
    })).toBe(true);
    expect(shouldQueueFollowupIssueExecution({
      sameExecutionAgent: true,
      activeExecutionRunStatus: "queued",
      wakeCommentId: null,
      contextSnapshot: { forceFollowupRun: true },
    })).toBe(true);
    expect(shouldBypassIssueExecutionLock({
      reason: null,
      contextSnapshot: { wakeReason: "issue_comment_mentioned" },
    })).toBe(true);
  });

  it("selects coalesced wake targets and promotes deferred wake payloads", () => {
    expect(selectWakeupCoalescedRun({
      activeRuns: [
        {
          id: "run-queued",
          status: "queued",
          contextSnapshot: { taskKey: "issue:1" },
        },
        {
          id: "run-running",
          status: "running",
          contextSnapshot: { taskId: "issue:1" },
        },
      ],
      taskKey: "issue:1",
      wakeCommentId: null,
    })).toMatchObject({
      sameScopeQueuedRun: { id: "run-queued" },
      sameScopeRunningRun: { id: "run-running" },
      shouldQueueFollowupForCommentWake: false,
      coalescedTargetRun: { id: "run-queued" },
    });

    expect(selectWakeupCoalescedRun({
      activeRuns: [
        {
          id: "run-running",
          status: "running",
          contextSnapshot: { taskKey: "issue:2" },
        },
      ],
      taskKey: "issue:2",
      wakeCommentId: "comment-1",
    })).toMatchObject({
      sameScopeQueuedRun: null,
      sameScopeRunningRun: { id: "run-running" },
      shouldQueueFollowupForCommentWake: true,
      coalescedTargetRun: null,
    });

    const deferredPayload = buildDeferredIssueWakePayload({
      payload: { source: "manual" },
      issueId: "issue-9",
      contextSnapshot: { taskKey: "issue:9" },
    });
    expect(deferredPayload).toMatchObject({
      issueId: "issue-9",
      source: "manual",
    });

    expect(buildDeferredWakePromotionPlan({
      deferredPayload,
      deferredReason: null,
      deferredSource: "automation",
      deferredTriggerDetail: "callback",
    })).toMatchObject({
      promotedReason: "issue_execution_promoted",
      promotedSource: "automation",
      promotedTriggerDetail: "callback",
      promotedPayload: { source: "manual", issueId: "issue-9" },
      promotedTaskKey: "issue:9",
    });
  });

  it("builds wakeup requests, queued events, and next session state transitions", () => {
    expect(buildWakeupRequestValues({
      companyId: "company-1",
      agentId: "agent-1",
      source: "on_demand",
      triggerDetail: "manual",
      reason: "manual_test",
      payload: { issueId: "issue-1" },
      status: "queued",
      requestedByActorType: "user",
      requestedByActorId: "user-1",
      coalescedCount: 2,
    })).toMatchObject({
      companyId: "company-1",
      agentId: "agent-1",
      source: "on_demand",
      triggerDetail: "manual",
      status: "queued",
      requestedByActorType: "user",
      requestedByActorId: "user-1",
      coalescedCount: 2,
    });

    expect(buildHeartbeatRunQueuedEvent({
      companyId: "company-1",
      runId: "run-1",
      agentId: "agent-1",
      invocationSource: "on_demand",
      triggerDetail: "manual",
      wakeupRequestId: "wake-1",
    })).toMatchObject({
      companyId: "company-1",
      type: "heartbeat.run.queued",
      payload: {
        runId: "run-1",
        agentId: "agent-1",
      },
    });

    const codec = {
      deserialize: (raw: unknown) => raw as Record<string, unknown> | null,
      serialize: (params: Record<string, unknown> | null) => params,
      getDisplayId: (params: Record<string, unknown> | null) => (params?.display as string | null) ?? null,
    };

    expect(resolveNextSessionState({
      codec,
      adapterResult: {
        clearSession: false,
        sessionParams: { sessionId: "session-2", display: "display-2" },
      },
      previousParams: { sessionId: "session-1", display: "display-1" },
      previousDisplayId: "display-1",
      previousLegacySessionId: "session-1",
    } as never)).toEqual({
      params: { sessionId: "session-2", display: "display-2" },
      displayId: "display-2",
      legacySessionId: "session-2",
    });

    expect(resolveNextSessionState({
      codec,
      adapterResult: {
        clearSession: true,
      },
      previousParams: { sessionId: "session-1", display: "display-1" },
      previousDisplayId: "display-1",
      previousLegacySessionId: "session-1",
    } as never)).toEqual({
      params: null,
      displayId: null,
      legacySessionId: null,
    });
  });

  it("resolves run outcome, persistence artifacts, protocol retry gates, and watchdog decisions", () => {
    expect(buildProcessLostError({
      checkpointJson: { phase: "dispatch.redispatch" },
    })).toBe("Process lost during dispatch.redispatch -- server may have restarted");
    expect(resolveHeartbeatRunOutcome({
      latestRunStatus: null,
      timedOut: false,
      exitCode: 0,
      errorMessage: null,
      protocolProgressFailure: null,
    })).toBe("succeeded");
    expect(resolveHeartbeatRunOutcome({
      latestRunStatus: null,
      timedOut: true,
      exitCode: 0,
      errorMessage: null,
      protocolProgressFailure: null,
    })).toBe("timed_out");

    expect(buildHeartbeatOutcomePersistence({
      outcome: "failed",
      protocolProgressFailure: {
        error: "missing review handoff",
        errorCode: "protocol_missing",
      },
      adapterResult: {
        exitCode: 1,
        signal: null,
        errorMessage: "adapter failed",
        errorCode: "adapter_failed",
      },
      usageJson: { tokens: 10 },
      resultJson: { success: false },
      nextSessionDisplayId: "display-2",
      nextSessionLegacyId: "session-2",
      stdoutExcerpt: "stdout",
      stderrExcerpt: "stderr",
      logSummary: { bytes: 42, sha256: "abc", compressed: true },
      finishedAt: new Date("2026-03-13T12:01:00.000Z"),
    })).toMatchObject({
      status: "failed",
      wakeupStatus: "failed",
      runPatch: {
        error: "missing review handoff",
        errorCode: "protocol_missing",
        sessionIdAfter: "display-2",
        logBytes: 42,
        logSha256: "abc",
        logCompressed: true,
      },
    });

    expect(buildHeartbeatCancellationArtifacts({
      message: "Cancelled due to pause",
      checkpointMessage: "pause requested",
      finishedAt: new Date("2026-03-13T12:02:00.000Z"),
    })).toMatchObject({
      lastError: "Cancelled due to pause",
      eventMessage: "run cancelled",
      leasePatch: {
        phase: "finalize.cancelled",
      },
    });

    const requirement = {
      key: "review_reviewer",
      protocolMessageType: "SUBMIT_FOR_REVIEW",
      recipientRole: "reviewer",
      requiredMessageTypes: ["REVIEW_COMMENT", "APPROVE_REVIEW"],
      firstActionMessageTypes: ["REVIEW_COMMENT"],
      intermediateMessageTypes: [],
    } as const;

    expect(hasRequiredProtocolProgress({
      requirement,
      messages: [{ messageType: "APPROVE_REVIEW" }],
    })).toBe(true);
    expect(buildRequiredProtocolProgressError({
      requirement,
      observedMessageTypes: ["COMMENT"],
      retryEnqueued: true,
    })).toContain("A protocol-retry wake was queued automatically.");
    expect(isWorkflowStateEligibleForProtocolRetry({
      requirement,
      workflowState: "submitted_for_review",
    })).toBe(true);
    expect(shouldEnqueueProtocolRequiredRetry({
      protocolRetryCount: 0,
      issueStatus: "todo",
      workflowState: "submitted_for_review",
      requirement,
    })).toBe(true);
    expect(isSupersededProtocolWakeReason("issue_ready_for_qa_gate")).toBe(true);
    expect(shouldSkipSupersededProtocolFollowup({
      wakeReason: "issue_ready_for_qa_gate",
      issueStatus: "done",
    })).toBe(true);

    expect(shouldReapHeartbeatRun({
      runStatus: "queued",
      runUpdatedAt: "2026-03-13T12:00:00.000Z",
      lease: {
        status: "launching",
        leaseExpiresAt: "2026-03-13T12:00:30.000Z",
      },
      now: new Date("2026-03-13T12:00:10.000Z"),
    })).toBe(false);
    expect(shouldReapHeartbeatRun({
      runStatus: "running",
      runUpdatedAt: "2026-03-13T11:00:00.000Z",
      lease: {
        status: "launching",
        leaseExpiresAt: "2026-03-13T11:10:00.000Z",
      },
      now: new Date("2026-03-13T12:00:10.000Z"),
      staleThresholdMs: 1000,
    })).toBe(true);

    expect(decideDispatchWatchdogAction({
      runStatus: "queued",
      leaseStatus: "queued",
      checkpointPhase: "dispatch.waiting_for_slot",
      dispatchAttempts: 0,
      hasRunningProcess: false,
      slotBlocked: true,
    })).toBe("hold");
    expect(decideDispatchWatchdogAction({
      runStatus: "running",
      leaseStatus: "launching",
      checkpointPhase: "claim.queued",
      dispatchAttempts: 2,
      hasRunningProcess: false,
    })).toBe("fail");
  });
});
