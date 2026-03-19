import { enqueueAfterDbCommit, runWithDbContext } from "@squadrail/db";
import { describe, expect, it } from "vitest";
import {
  buildHeartbeatCancellationArtifacts,
  buildHeartbeatOutcomePersistence,
  buildProcessLostError,
  buildRequiredProtocolProgressError,
  decideDispatchWatchdogAction,
  hasRequiredProtocolProgress,
  isSupersededProtocolWakeReason,
  resolveHeartbeatRunOutcome,
  isWorkflowStateEligibleForProtocolRetry,
  runDispatchWatchdogOutsideDbContext,
  scheduleDeferredRunDispatch,
  shouldEnqueueProtocolRequiredRetry,
  shouldReapHeartbeatRun,
  shouldSkipSupersededProtocolFollowup,
} from "../services/heartbeat.js";

describe("decideDispatchWatchdogAction", () => {
  it("returns noop when the run is no longer running", () => {
    expect(
      decideDispatchWatchdogAction({
        runStatus: "failed",
        leaseStatus: "launching",
        checkpointPhase: "claim.queued",
        dispatchAttempts: 0,
        hasRunningProcess: false,
      }),
    ).toBe("noop");
  });

  it("returns noop when a child process is already running", () => {
    expect(
      decideDispatchWatchdogAction({
        runStatus: "running",
        leaseStatus: "launching",
        checkpointPhase: "claim.queued",
        dispatchAttempts: 0,
        hasRunningProcess: true,
      }),
    ).toBe("noop");
  });

  it("requests redispatch when a queued run never gets claimed", () => {
    expect(
      decideDispatchWatchdogAction({
        runStatus: "queued",
        leaseStatus: "queued",
        checkpointPhase: "queue.created",
        dispatchAttempts: 0,
        hasRunningProcess: false,
      }),
    ).toBe("redispatch");
  });

  it("holds queued runs when the agent has no free execution slot", () => {
    expect(
      decideDispatchWatchdogAction({
        runStatus: "queued",
        leaseStatus: "queued",
        checkpointPhase: "queue.created",
        dispatchAttempts: 0,
        hasRunningProcess: false,
        slotBlocked: true,
      }),
    ).toBe("hold");
  });

  it("redispatches queued runs once a blocked slot opens again", () => {
    expect(
      decideDispatchWatchdogAction({
        runStatus: "queued",
        leaseStatus: "queued",
        checkpointPhase: "dispatch.waiting_for_slot",
        dispatchAttempts: 0,
        hasRunningProcess: false,
        slotBlocked: false,
      }),
    ).toBe("redispatch");
  });

  it("requests redispatch when a claimed run never entered execution", () => {
    expect(
      decideDispatchWatchdogAction({
        runStatus: "running",
        leaseStatus: "launching",
        checkpointPhase: "claim.queued",
        dispatchAttempts: 1,
        hasRunningProcess: false,
      }),
    ).toBe("redispatch");
  });

  it("fails when redispatch attempts are exhausted", () => {
    expect(
      decideDispatchWatchdogAction({
        runStatus: "running",
        leaseStatus: "launching",
        checkpointPhase: "dispatch.redispatch",
        dispatchAttempts: 2,
        hasRunningProcess: false,
      }),
    ).toBe("fail");
  });

  it("defers run dispatch until the next turn", async () => {
    const calls: string[] = [];

    scheduleDeferredRunDispatch(() => {
      calls.push("dispatched");
    });

    calls.push("scheduled");
    expect(calls).toEqual(["scheduled"]);

    await new Promise((resolve) => setImmediate(resolve));
    expect(calls).toEqual(["scheduled", "dispatched"]);
  });

  it("runs dispatch watchdog callbacks outside any inherited db transaction context", () => {
    let detachedFromDbContext: boolean | null = null;

    runWithDbContext({ kind: "tx" }, () => {
      runDispatchWatchdogOutsideDbContext(() => {
        detachedFromDbContext = enqueueAfterDbCommit(() => {
          // No-op callback for assertion only.
        });
      });
    });

    expect(detachedFromDbContext).toBe(false);
  });
});

describe("heartbeat failure and protocol retry helpers", () => {
  const reviewerRequirement = {
    key: "review_reviewer",
    protocolMessageType: "SUBMIT_FOR_REVIEW",
    recipientRole: "reviewer",
    requiredMessageTypes: ["REQUEST_CHANGES", "APPROVE_CHANGES"],
    firstActionMessageTypes: ["REQUEST_CHANGES"],
    intermediateMessageTypes: [],
  } as const;

  it("includes checkpoint phase in process-lost errors when available", () => {
    expect(
      buildProcessLostError({
        checkpointJson: {
          phase: "adapter.execute_start",
        },
      }),
    ).toBe("Process lost during adapter.execute_start -- server may have restarted");
    expect(buildProcessLostError(null)).toBe("Process lost -- server may have restarted");
  });

  it("resolves heartbeat run outcomes from cancel, timeout, and protocol failure signals", () => {
    expect(resolveHeartbeatRunOutcome({
      latestRunStatus: "cancelled",
      timedOut: false,
      exitCode: 0,
      errorMessage: null,
      protocolProgressFailure: null,
    })).toBe("cancelled");
    expect(resolveHeartbeatRunOutcome({
      latestRunStatus: "running",
      timedOut: true,
      exitCode: 0,
      errorMessage: null,
      protocolProgressFailure: null,
    })).toBe("timed_out");
    expect(resolveHeartbeatRunOutcome({
      latestRunStatus: "running",
      timedOut: false,
      exitCode: 0,
      errorMessage: null,
      protocolProgressFailure: null,
    })).toBe("succeeded");
    expect(resolveHeartbeatRunOutcome({
      latestRunStatus: "running",
      timedOut: false,
      exitCode: 0,
      errorMessage: null,
      protocolProgressFailure: {
        error: "Missing review response",
        errorCode: "protocol_required",
      },
    })).toBe("failed");
  });

  it("builds persistence patches for run outcomes and cancellations", () => {
    expect(buildHeartbeatOutcomePersistence({
      outcome: "failed",
      protocolProgressFailure: {
        error: "Missing review response",
        errorCode: "protocol_required",
      },
      adapterResult: {
        exitCode: 1,
        signal: null,
        errorMessage: null,
        errorCode: "adapter_failed",
      },
      usageJson: { costUsd: 0.12 },
      resultJson: { ok: false },
      nextSessionDisplayId: "session-2",
      nextSessionLegacyId: null,
      stdoutExcerpt: "stdout",
      stderrExcerpt: "stderr",
      logSummary: {
        bytes: 128,
        sha256: "abc123",
        compressed: true,
      },
      finishedAt: new Date("2026-03-13T01:00:00Z"),
    })).toMatchObject({
      status: "failed",
      wakeupStatus: "failed",
      runPatch: {
        error: "Missing review response",
        errorCode: "protocol_required",
        sessionIdAfter: "session-2",
        logBytes: 128,
        logCompressed: true,
      },
      wakeupPatch: {
        error: "Missing review response",
      },
    });

    expect(buildHeartbeatCancellationArtifacts({
      message: "Cancelled by control plane",
      checkpointMessage: "run cancelled by control plane",
      finishedAt: new Date("2026-03-13T01:00:00Z"),
    })).toMatchObject({
      runPatch: {
        error: "Cancelled by control plane",
        errorCode: "cancelled",
      },
      wakeupPatch: {
        error: "Cancelled by control plane",
      },
      leasePatch: {
        phase: "finalize.cancelled",
        message: "run cancelled by control plane",
      },
      eventMessage: "run cancelled",
    });
  });

  it("detects required protocol progress only when an eligible message was observed", () => {
    expect(
      hasRequiredProtocolProgress({
        requirement: reviewerRequirement,
        messages: [{ messageType: "PING" }],
      }),
    ).toBe(false);
    expect(
      hasRequiredProtocolProgress({
        requirement: reviewerRequirement,
        messages: [{ messageType: "APPROVE_CHANGES" }],
      }),
    ).toBe(true);
    expect(
      hasRequiredProtocolProgress({
        requirement: null,
        messages: [],
      }),
    ).toBe(true);
  });

  it("builds retry-aware protocol progress errors", () => {
    expect(
      buildRequiredProtocolProgressError({
        requirement: reviewerRequirement,
        observedMessageTypes: ["COMMENT"],
        retryEnqueued: true,
      }),
    ).toContain("A protocol-retry wake was queued automatically.");
  });

  it("enqueues protocol retries only while the workflow remains eligible", () => {
    expect(
      shouldEnqueueProtocolRequiredRetry({
        protocolRetryCount: 0,
        issueStatus: "in_review",
        workflowState: "submitted_for_review",
        requirement: reviewerRequirement,
      }),
    ).toBe(true);
    expect(
      shouldEnqueueProtocolRequiredRetry({
        protocolRetryCount: 2,
        issueStatus: "in_review",
        workflowState: "submitted_for_review",
        requirement: reviewerRequirement,
      }),
    ).toBe(false);
    expect(
      shouldEnqueueProtocolRequiredRetry({
        protocolRetryCount: 0,
        issueStatus: "done",
        workflowState: "submitted_for_review",
        requirement: reviewerRequirement,
      }),
    ).toBe(false);
  });

  it("maps workflow states to protocol retry eligibility by requirement key", () => {
    expect(
      isWorkflowStateEligibleForProtocolRetry({
        requirement: reviewerRequirement,
        workflowState: "submitted_for_review",
      }),
    ).toBe(true);
    expect(
      isWorkflowStateEligibleForProtocolRetry({
        requirement: reviewerRequirement,
        workflowState: "approved",
      }),
    ).toBe(false);
  });

  it("only skips superseded protocol follow-ups for terminal issues", () => {
    expect(isSupersededProtocolWakeReason("issue_ready_for_qa_gate")).toBe(true);
    expect(isSupersededProtocolWakeReason("issue_commented")).toBe(false);
    expect(
      shouldSkipSupersededProtocolFollowup({
        wakeReason: "issue_ready_for_qa_gate",
        issueStatus: "done",
      }),
    ).toBe(true);
    expect(
      shouldSkipSupersededProtocolFollowup({
        wakeReason: "issue_ready_for_qa_gate",
        issueStatus: "in_progress",
      }),
    ).toBe(false);
  });

  it("reaps only stale queued or running runs whose leases are no longer active", () => {
    const now = new Date("2026-03-12T12:00:00Z");

    expect(
      shouldReapHeartbeatRun({
        runStatus: "queued",
        runUpdatedAt: now,
        lease: {
          leaseExpiresAt: new Date("2026-03-12T12:05:00Z"),
        },
        now,
      }),
    ).toBe(false);

    expect(
      shouldReapHeartbeatRun({
        runStatus: "running",
        runUpdatedAt: new Date("2026-03-12T11:58:00Z"),
        lease: {
          leaseExpiresAt: new Date("2026-03-12T11:59:00Z"),
        },
        now,
        staleThresholdMs: 90_000,
      }),
    ).toBe(false);

    expect(
      shouldReapHeartbeatRun({
        runStatus: "running",
        runUpdatedAt: new Date("2026-03-12T11:50:00Z"),
        lease: {
          leaseExpiresAt: new Date("2026-03-12T11:55:00Z"),
        },
        now,
        staleThresholdMs: 90_000,
      }),
    ).toBe(true);
  });
});
