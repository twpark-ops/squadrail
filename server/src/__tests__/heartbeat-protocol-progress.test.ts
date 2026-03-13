import { describe, expect, it } from "vitest";
import { resolveProtocolRunRequirement } from "@squadrail/shared/protocol-run-requirements";
import {
  buildRequiredProtocolProgressError,
  hasRequiredProtocolProgress,
  isSupersededProtocolWakeReason,
  shouldEnqueueRetryableAdapterFailure,
  shouldEnqueueProtocolRequiredRetry,
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
    expect(
      shouldEnqueueProtocolRequiredRetry({
        protocolRetryCount: 0,
        issueStatus: "in_progress",
        workflowState: "blocked",
        requirement: implementationRequirement,
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
});
