import { describe, expect, it } from "vitest";
import {
  assertChangeRecoveryInvariant,
  evaluateChangeRecoveryInvariant,
} from "../change-recovery-invariants.mjs";

function makeMessage(type, seq, overrides = {}) {
  return {
    id: `${type}-${seq}`,
    seq,
    messageType: type,
    sender: {
      actorId: "unknown",
      role: "engineer",
    },
    recipients: [],
    payload: {},
    ...overrides,
  };
}

describe("change recovery invariants", () => {
  it("passes a TL-direct recovery loop after reviewer requested changes", () => {
    const evaluation = assertChangeRecoveryInvariant({
      recoveryMode: "direct_owner",
      expectedRecoveryOwnerId: "tl-1",
      finalState: {
        primaryEngineerAgentId: "tl-1",
      },
      messages: [
        makeMessage("REQUEST_CHANGES", 7, {
          sender: { actorId: "rev-1", role: "reviewer" },
        }),
        makeMessage("ACK_CHANGE_REQUEST", 8, {
          sender: { actorId: "tl-1", role: "engineer" },
        }),
        makeMessage("START_IMPLEMENTATION", 9, {
          sender: { actorId: "tl-1", role: "engineer" },
        }),
        makeMessage("SUBMIT_FOR_REVIEW", 10, {
          sender: { actorId: "tl-1", role: "engineer" },
        }),
        makeMessage("APPROVE_IMPLEMENTATION", 11, {
          sender: { actorId: "qa-1", role: "qa" },
        }),
        makeMessage("CLOSE_TASK", 12, {
          sender: { actorId: "tl-1", role: "tech_lead" },
        }),
      ],
    });

    expect(evaluation.failures).toEqual([]);
    expect(evaluation.checks.directOwnerRecovery).toBe(true);
    expect(evaluation.checks.recoverySenderContinuity).toBe(true);
  });

  it("passes a reassignment recovery loop when a new engineer is staffed from changes_requested", () => {
    const evaluation = assertChangeRecoveryInvariant({
      recoveryMode: "reassign",
      finalState: {
        primaryEngineerAgentId: "eng-2",
      },
      messages: [
        makeMessage("REQUEST_CHANGES", 5, {
          sender: { actorId: "rev-1", role: "reviewer" },
        }),
        makeMessage("REASSIGN_TASK", 6, {
          sender: { actorId: "lead-1", role: "tech_lead" },
          recipients: [
            { recipientId: "eng-2", role: "engineer" },
            { recipientId: "rev-1", role: "reviewer" },
          ],
          payload: {
            newAssigneeAgentId: "eng-2",
          },
        }),
        makeMessage("ACK_CHANGE_REQUEST", 7, {
          sender: { actorId: "eng-2", role: "engineer" },
        }),
        makeMessage("START_IMPLEMENTATION", 8, {
          sender: { actorId: "eng-2", role: "engineer" },
        }),
        makeMessage("SUBMIT_FOR_REVIEW", 9, {
          sender: { actorId: "eng-2", role: "engineer" },
        }),
        makeMessage("APPROVE_IMPLEMENTATION", 10, {
          sender: { actorId: "rev-1", role: "reviewer" },
        }),
        makeMessage("CLOSE_TASK", 11, {
          sender: { actorId: "lead-1", role: "tech_lead" },
        }),
      ],
    });

    expect(evaluation.failures).toEqual([]);
    expect(evaluation.checks.reassignRecovery).toBe(true);
    expect(evaluation.checks.recoveryOwnerMatched).toBe(true);
  });

  it("treats ACK_CHANGE_REQUEST as the recovery resume when implementation restarts without a second START_IMPLEMENTATION", () => {
    const evaluation = assertChangeRecoveryInvariant({
      recoveryMode: "reassign",
      finalState: {
        primaryEngineerAgentId: "eng-2",
      },
      messages: [
        makeMessage("REQUEST_CHANGES", 5, {
          sender: { actorId: "rev-1", role: "reviewer" },
        }),
        makeMessage("REASSIGN_TASK", 6, {
          sender: { actorId: "lead-1", role: "tech_lead" },
          recipients: [
            { recipientId: "eng-2", role: "engineer" },
            { recipientId: "rev-1", role: "reviewer" },
          ],
          payload: {
            newAssigneeAgentId: "eng-2",
          },
        }),
        makeMessage("ACK_CHANGE_REQUEST", 7, {
          sender: { actorId: "eng-2", role: "engineer" },
          workflowStateAfter: "implementing",
        }),
        makeMessage("SUBMIT_FOR_REVIEW", 8, {
          sender: { actorId: "eng-2", role: "engineer" },
        }),
        makeMessage("APPROVE_IMPLEMENTATION", 9, {
          sender: { actorId: "qa-1", role: "qa" },
        }),
        makeMessage("CLOSE_TASK", 10, {
          sender: { actorId: "lead-1", role: "tech_lead" },
        }),
      ],
    });

    expect(evaluation.failures).toEqual([]);
    expect(evaluation.checks.recoveryRestartRecorded).toBe(true);
    expect(evaluation.checks.recoverySenderContinuity).toBe(true);
  });

  it("reports owner continuity and ordering failures when recovery is malformed", () => {
    const evaluation = evaluateChangeRecoveryInvariant({
      recoveryMode: "direct_owner",
      expectedRecoveryOwnerId: "tl-1",
      finalState: {
        primaryEngineerAgentId: "eng-2",
      },
      messages: [
        makeMessage("REQUEST_CHANGES", 9, {
          sender: { actorId: "rev-1", role: "reviewer" },
        }),
        makeMessage("ACK_CHANGE_REQUEST", 8, {
          sender: { actorId: "eng-2", role: "engineer" },
        }),
        makeMessage("START_IMPLEMENTATION", 10, {
          sender: { actorId: "eng-2", role: "engineer" },
        }),
      ],
    });

    expect(evaluation.failures).toEqual(
      expect.arrayContaining([
        "recoverySequenceOrdered",
        "recoveryOwnerMatched",
        "recoverySenderContinuity",
        "postRecoveryResubmitted",
        "finalApprovalAfterRecovery",
        "finalCloseAfterRecovery",
      ]),
    );
  });
});
