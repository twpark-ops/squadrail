import { describe, expect, it } from "vitest";
import { resolveProtocolRunRequirement } from "@squadrail/shared/protocol-run-requirements";
import {
  buildRequiredProtocolProgressError,
  hasRequiredProtocolProgress,
  shouldEnqueueProtocolRequiredRetry,
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
    ).toBe(true);
    expect(
      shouldEnqueueProtocolRequiredRetry({
        protocolRetryCount: 1,
        issueStatus: "in_progress",
      }),
    ).toBe(false);
  });
});
