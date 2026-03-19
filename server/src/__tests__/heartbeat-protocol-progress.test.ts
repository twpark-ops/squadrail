import { describe, expect, it } from "vitest";
import { resolveProtocolRunRequirement } from "@squadrail/shared/protocol-run-requirements";
import {
  buildRequiredProtocolProgressError,
  classifyDegradedProtocolRunReason,
  hasRequiredProtocolProgress,
  isIdleProtocolWatchdogEligibleRequirement,
  isSupersededProtocolWakeReason,
  readLeaseLastProgressAt,
  shouldEnqueueRetryableAdapterFailure,
  shouldRecoverDegradedProtocolRun,
  shouldEnqueueProtocolRequiredRetry,
  shouldRecoverIdleProtocolRun,
  shouldSkipSupersededProtocolFollowup,
  shouldResetTaskSessionForWake,
} from "../services/heartbeat.js";

describe("heartbeat protocol progress helpers", () => {
  it("requires assignment progress for engineer wakes", () => {
    const requirement = resolveProtocolRunRequirement({
      protocolMessageType: "ASSIGN_TASK",
      protocolRecipientRole: "engineer",
    });

    expect(requirement?.requiredMessageTypes).toEqual([
      "ACK_ASSIGNMENT",
      "ASK_CLARIFICATION",
      "ESCALATE_BLOCKER",
      "START_IMPLEMENTATION",
    ]);
    expect(requirement?.intermediateMessageTypes).toEqual([
      "ACK_ASSIGNMENT",
    ]);
    expect(
      hasRequiredProtocolProgress({
        requirement,
        messages: [{ messageType: "NOTE" }],
      }),
    ).toBe(false);
    expect(
      hasRequiredProtocolProgress({
        requirement,
        messages: [{ messageType: "ACK_ASSIGNMENT" }],
        finalWorkflowState: "accepted",
      }),
    ).toBe(false);
    expect(
      hasRequiredProtocolProgress({
        requirement,
        messages: [{ messageType: "ACK_ASSIGNMENT" }, { messageType: "START_IMPLEMENTATION" }],
        finalWorkflowState: "implementing",
      }),
    ).toBe(true);
  });

  it("requires routing progress for supervisor assignment wakes", () => {
    const requirement = resolveProtocolRunRequirement({
      protocolMessageType: "ASSIGN_TASK",
      protocolRecipientRole: "pm",
    });

    expect(requirement?.requiredMessageTypes).toEqual([
      "REASSIGN_TASK",
      "ASK_CLARIFICATION",
      "ESCALATE_BLOCKER",
    ]);
    expect(
      hasRequiredProtocolProgress({
        requirement,
        messages: [{ messageType: "NOTE" }],
      }),
    ).toBe(false);
    expect(
      hasRequiredProtocolProgress({
        requirement,
        messages: [{ messageType: "REASSIGN_TASK" }],
      }),
    ).toBe(true);
  });

  it("builds a protocol-required error with retry context", () => {
    const requirement = resolveProtocolRunRequirement({
      protocolMessageType: "SUBMIT_FOR_REVIEW",
      protocolRecipientRole: "reviewer",
    });

    expect(requirement).not.toBeNull();
    expect(
      buildRequiredProtocolProgressError({
        requirement: requirement!,
        observedMessageTypes: ["NOTE"],
        retryEnqueued: true,
      }),
    ).toContain("A protocol-retry wake was queued automatically.");
  });

  it("forces a fresh session for protocol-required retry wakes", () => {
    expect(
      shouldResetTaskSessionForWake({
        wakeReason: "protocol_required_retry",
      }),
    ).toBe(true);
    expect(
      shouldResetTaskSessionForWake({
        protocolRequiredRetryCount: 1,
      }),
    ).toBe(true);
    expect(
      shouldResetTaskSessionForWake({
        wakeReason: "adapter_retry",
      }),
    ).toBe(false);
  });

  it("enqueues transient adapter retries only for retryable errors on active issues", () => {
    expect(
      shouldEnqueueRetryableAdapterFailure({
        adapterErrorCode: "claude_stream_incomplete",
        adapterRetryCount: 0,
        issueStatus: "in_review",
      }),
    ).toBe(true);
    expect(
      shouldEnqueueRetryableAdapterFailure({
        adapterErrorCode: "claude_stream_incomplete",
        adapterRetryCount: 2,
        issueStatus: "in_review",
      }),
    ).toBe(false);
    expect(
      shouldEnqueueRetryableAdapterFailure({
        adapterErrorCode: "claude_stream_incomplete",
        adapterRetryCount: 0,
        issueStatus: "done",
      }),
    ).toBe(false);
    expect(
      shouldEnqueueRetryableAdapterFailure({
        adapterErrorCode: "adapter_failed",
        adapterRetryCount: 0,
        issueStatus: "in_review",
      }),
    ).toBe(false);
  });

  it("does not enqueue protocol-required retry for terminal issues", () => {
    expect(
      shouldEnqueueProtocolRequiredRetry({
        protocolRetryCount: 0,
        issueStatus: "cancelled",
      }),
    ).toBe(false);
    expect(
      shouldEnqueueProtocolRequiredRetry({
        protocolRetryCount: 0,
        issueStatus: "done",
      }),
    ).toBe(false);
    expect(
      shouldEnqueueProtocolRequiredRetry({
        protocolRetryCount: 0,
        issueStatus: "in_progress",
      }),
    ).toBe(false);
    expect(
      shouldEnqueueProtocolRequiredRetry({
        protocolRetryCount: 1,
        issueStatus: "in_progress",
      }),
    ).toBe(false);
  });

  it("only enqueues protocol-required retry when the workflow state still matches the requirement lane", () => {
    const reviewRequirement = resolveProtocolRunRequirement({
      protocolMessageType: "SUBMIT_FOR_REVIEW",
      protocolRecipientRole: "reviewer",
    });
    const implementationRequirement = resolveProtocolRunRequirement({
      protocolMessageType: "START_IMPLEMENTATION",
      protocolRecipientRole: "engineer",
    });

    expect(
      shouldEnqueueProtocolRequiredRetry({
        protocolRetryCount: 0,
        issueStatus: "in_progress",
        workflowState: "submitted_for_review",
        requirement: reviewRequirement,
      }),
    ).toBe(true);
    expect(
      shouldEnqueueProtocolRequiredRetry({
        protocolRetryCount: 0,
        issueStatus: "in_progress",
        workflowState: "qa_pending",
        requirement: reviewRequirement,
      }),
    ).toBe(false);
    expect(
      shouldEnqueueProtocolRequiredRetry({
        protocolRetryCount: 0,
        issueStatus: "in_progress",
        workflowState: "implementing",
        requirement: implementationRequirement,
      }),
    ).toBe(true);
    const assignmentRequirement = resolveProtocolRunRequirement({
      protocolMessageType: "REASSIGN_TASK",
      protocolRecipientRole: "engineer",
    });
    expect(
      shouldEnqueueProtocolRequiredRetry({
        protocolRetryCount: 0,
        issueStatus: "in_progress",
        workflowState: "accepted",
        requirement: assignmentRequirement,
      }),
    ).toBe(true);
    expect(
      shouldEnqueueProtocolRequiredRetry({
        protocolRetryCount: 0,
        issueStatus: "in_progress",
        workflowState: "under_review",
        requirement: reviewRequirement,
      }),
    ).toBe(true);
    expect(
      shouldEnqueueProtocolRequiredRetry({
        protocolRetryCount: 0,
        issueStatus: "in_progress",
        workflowState: "blocked",
        requirement: implementationRequirement,
      }),
    ).toBe(false);
  });

  it("treats review start and QA start as intermediate progress until a decision follows", () => {
    const reviewRequirement = resolveProtocolRunRequirement({
      protocolMessageType: "SUBMIT_FOR_REVIEW",
      protocolRecipientRole: "reviewer",
    });
    const qaRequirement = resolveProtocolRunRequirement({
      protocolMessageType: "APPROVE_IMPLEMENTATION",
      protocolRecipientRole: "qa",
    });

    expect(
      hasRequiredProtocolProgress({
        requirement: reviewRequirement,
        messages: [{ messageType: "START_REVIEW" }],
        finalWorkflowState: "under_review",
      }),
    ).toBe(false);
    expect(
      hasRequiredProtocolProgress({
        requirement: reviewRequirement,
        messages: [{ messageType: "START_REVIEW" }, { messageType: "REQUEST_CHANGES" }],
        finalWorkflowState: "changes_requested",
      }),
    ).toBe(true);
    expect(
      hasRequiredProtocolProgress({
        requirement: qaRequirement,
        messages: [{ messageType: "START_REVIEW" }],
        finalWorkflowState: "under_qa_review",
      }),
    ).toBe(false);
    expect(
      hasRequiredProtocolProgress({
        requirement: qaRequirement,
        messages: [{ messageType: "START_REVIEW" }, { messageType: "APPROVE_IMPLEMENTATION" }],
        finalWorkflowState: "approved",
      }),
    ).toBe(true);
  });

  it("recovers idle short-lane protocol runs but leaves long implementation lanes alone", () => {
    const reviewRequirement = resolveProtocolRunRequirement({
      protocolMessageType: "SUBMIT_FOR_REVIEW",
      protocolRecipientRole: "reviewer",
    });
    const implementationRequirement = resolveProtocolRunRequirement({
      protocolMessageType: "START_IMPLEMENTATION",
      protocolRecipientRole: "engineer",
    });
    const now = new Date("2026-03-20T10:00:30Z");
    const idleCheckpoint = {
      phase: "adapter.invoke",
      lastProgressAt: "2026-03-20T10:00:00Z",
    };

    expect(readLeaseLastProgressAt(idleCheckpoint)).toBe(new Date("2026-03-20T10:00:00Z").getTime());
    expect(isIdleProtocolWatchdogEligibleRequirement(reviewRequirement)).toBe(true);
    expect(isIdleProtocolWatchdogEligibleRequirement(implementationRequirement)).toBe(false);
    expect(
      shouldRecoverIdleProtocolRun({
        runStatus: "running",
        hasRunningProcess: true,
        requirement: reviewRequirement,
        issueStatus: "in_review",
        workflowState: "submitted_for_review",
        protocolRetryCount: 0,
        checkpointJson: idleCheckpoint,
        latestEvent: {
          eventType: "adapter.invoke",
          createdAt: "2026-03-20T10:00:00Z",
        },
        startedAt: "2026-03-20T10:00:00Z",
        now,
        idleThresholdMs: 20_000,
      }),
    ).toBe(true);
    expect(
      shouldRecoverIdleProtocolRun({
        runStatus: "running",
        hasRunningProcess: true,
        requirement: implementationRequirement,
        issueStatus: "in_progress",
        workflowState: "implementing",
        protocolRetryCount: 0,
        checkpointJson: idleCheckpoint,
        latestEvent: {
          eventType: "adapter.invoke",
          createdAt: "2026-03-20T10:00:00Z",
        },
        startedAt: "2026-03-20T10:00:00Z",
        now,
        idleThresholdMs: 20_000,
      }),
    ).toBe(false);
  });

  it("escalates degraded supervisory adapter retries into protocol recovery", () => {
    const reviewRequirement = resolveProtocolRunRequirement({
      protocolMessageType: "SUBMIT_FOR_REVIEW",
      protocolRecipientRole: "reviewer",
    });
    const now = new Date("2026-03-20T10:01:05Z");

    expect(
      classifyDegradedProtocolRunReason({
        requirement: reviewRequirement,
        wakeReason: "adapter_retry",
        adapterRetryCount: 1,
        adapterRetryErrorCode: "claude_stream_incomplete",
      }),
    ).toBe("claude_stream_incomplete_retry_loop");
    expect(
      shouldRecoverDegradedProtocolRun({
        runStatus: "running",
        hasRunningProcess: true,
        requirement: reviewRequirement,
        wakeReason: "adapter_retry",
        issueStatus: "in_review",
        workflowState: "submitted_for_review",
        protocolRetryCount: 0,
        protocolDegradedRecoveryCount: 0,
        adapterRetryCount: 1,
        adapterRetryErrorCode: "claude_stream_incomplete",
        checkpointJson: {
          phase: "adapter.invoke",
          lastProgressAt: "2026-03-20T10:00:55Z",
        },
        startedAt: "2026-03-20T10:00:00Z",
        now,
        degradedThresholdMs: 20_000,
      }),
    ).toBe(true);
    expect(
      shouldRecoverDegradedProtocolRun({
        runStatus: "running",
        hasRunningProcess: true,
        requirement: reviewRequirement,
        wakeReason: "adapter_retry",
        issueStatus: "in_review",
        workflowState: "submitted_for_review",
        protocolRetryCount: 1,
        protocolDegradedRecoveryCount: 1,
        adapterRetryCount: 0,
        adapterRetryErrorCode: "claude_stream_incomplete",
        checkpointJson: {
          phase: "adapter.invoke",
        },
        startedAt: "2026-03-20T10:00:40Z",
        now,
        degradedThresholdMs: 20_000,
      }),
    ).toBe(false);
  });

  it("skips stale protocol follow-up wakes once the issue is terminal", () => {
    expect(isSupersededProtocolWakeReason("issue_ready_for_closure")).toBe(true);
    expect(isSupersededProtocolWakeReason("issue_ready_for_qa_gate")).toBe(true);
    expect(isSupersededProtocolWakeReason("protocol_required_retry")).toBe(true);
    expect(isSupersededProtocolWakeReason("heartbeat_timer")).toBe(false);
    expect(
      shouldSkipSupersededProtocolFollowup({
        wakeReason: "issue_ready_for_closure",
        issueStatus: "done",
      }),
    ).toBe(true);
    expect(
      shouldSkipSupersededProtocolFollowup({
        wakeReason: "issue_ready_for_qa_gate",
        issueStatus: "cancelled",
      }),
    ).toBe(true);
    expect(
      shouldSkipSupersededProtocolFollowup({
        wakeReason: "issue_ready_for_closure",
        issueStatus: "in_review",
      }),
    ).toBe(false);
  });

  it("skips stale adapter retries once the issue has moved beyond the original protocol lane", () => {
    expect(
      shouldSkipSupersededProtocolFollowup({
        wakeReason: "adapter_retry",
        issueStatus: "in_progress",
        workflowState: "submitted_for_review",
        protocolMessageType: "ASSIGN_TASK",
        protocolRecipientRole: "tech_lead",
      }),
    ).toBe(true);
    expect(
      shouldSkipSupersededProtocolFollowup({
        wakeReason: "adapter_retry",
        issueStatus: "todo",
        workflowState: "assigned",
        protocolMessageType: "ASSIGN_TASK",
        protocolRecipientRole: "tech_lead",
      }),
    ).toBe(false);
    expect(
      shouldSkipSupersededProtocolFollowup({
        wakeReason: "protocol_required_retry",
        issueStatus: "in_progress",
        workflowState: "implementing",
        protocolMessageType: "ASSIGN_TASK",
        protocolRecipientRole: "pm",
      }),
    ).toBe(true);
    expect(
      shouldSkipSupersededProtocolFollowup({
        wakeReason: "adapter_retry",
        issueStatus: "done",
        workflowState: "approved",
        protocolMessageType: "SUBMIT_FOR_REVIEW",
        protocolRecipientRole: "reviewer",
      }),
    ).toBe(true);
  });
});
