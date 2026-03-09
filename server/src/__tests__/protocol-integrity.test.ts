import { afterEach, describe, expect, it } from "vitest";
import {
  canonicalizeProtocolIntegrityValue,
  computeProtocolPayloadSha256,
  protocolIntegrityReady,
  sealProtocolMessageIntegrity,
  verifyProtocolMessageIntegrity,
} from "../protocol-integrity.js";

const ORIGINAL_SECRET = process.env.SQUADRAIL_PROTOCOL_INTEGRITY_SECRET;

function buildEnvelope(overrides: Partial<Parameters<typeof sealProtocolMessageIntegrity>[0]["message"]> = {}) {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    companyId: "00000000-0000-0000-0000-000000000002",
    issueId: "00000000-0000-0000-0000-000000000003",
    threadId: "00000000-0000-0000-0000-000000000004",
    seq: 1,
    messageType: "ASSIGN_TASK",
    senderActorType: "user",
    senderActorId: "local-board",
    senderRole: "human_board",
    workflowStateBefore: "backlog",
    workflowStateAfter: "assigned",
    summary: "Assign the task",
    payload: {
      goal: "Close the loop",
      acceptanceCriteria: ["tests"],
    },
    recipients: [
      {
        recipientType: "agent",
        recipientId: "eng-1",
        role: "engineer",
      },
    ],
    artifacts: [],
    causalMessageId: null,
    retrievalRunId: null,
    requiresAck: false,
    createdAt: new Date("2026-03-08T00:00:00.000Z"),
    ...overrides,
  };
}

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.SQUADRAIL_PROTOCOL_INTEGRITY_SECRET;
  else process.env.SQUADRAIL_PROTOCOL_INTEGRITY_SECRET = ORIGINAL_SECRET;
});

describe("protocol integrity", () => {
  it("canonicalizes payload objects deterministically", () => {
    const left = canonicalizeProtocolIntegrityValue({ b: 2, a: { d: 4, c: 3 } });
    const right = canonicalizeProtocolIntegrityValue({ a: { c: 3, d: 4 }, b: 2 });
    expect(left).toBe(right);
  });

  it("seals and verifies protocol messages with a chain", () => {
    process.env.SQUADRAIL_PROTOCOL_INTEGRITY_SECRET = "integrity-secret";
    expect(protocolIntegrityReady()).toBe(true);

    const firstEnvelope = buildEnvelope();
    const firstSeal = sealProtocolMessageIntegrity({ message: firstEnvelope });
    expect(firstSeal).not.toBeNull();

    const secondEnvelope = buildEnvelope({
      id: "00000000-0000-0000-0000-000000000010",
      seq: 2,
      messageType: "ACK_ASSIGNMENT",
      senderActorType: "agent",
      senderActorId: "eng-1",
      senderRole: "engineer",
      workflowStateBefore: "assigned",
      workflowStateAfter: "accepted",
      summary: "Engineer accepted assignment",
      payload: {
        accepted: true,
        understoodScope: "Retry safety and verification",
      },
      recipients: [
        {
          recipientType: "agent",
          recipientId: "lead-1",
          role: "tech_lead",
        },
      ],
    });
    const secondSeal = sealProtocolMessageIntegrity({
      message: secondEnvelope,
      previousIntegritySignature: firstSeal?.integritySignature ?? null,
    });
    expect(secondSeal).not.toBeNull();

    const firstVerification = verifyProtocolMessageIntegrity({
      message: {
        ...firstEnvelope,
        ...firstSeal,
      },
      expectedPreviousIntegritySignature: null,
    });
    const secondVerification = verifyProtocolMessageIntegrity({
      message: {
        ...secondEnvelope,
        ...secondSeal,
      },
      expectedPreviousIntegritySignature: firstSeal?.integritySignature ?? null,
    });

    expect(firstVerification.status).toBe("verified");
    expect(secondVerification.status).toBe("verified");
    expect(firstSeal?.payloadSha256).toBe(computeProtocolPayloadSha256(firstEnvelope.payload));
  });

  it("marks modified payloads as tampered", () => {
    process.env.SQUADRAIL_PROTOCOL_INTEGRITY_SECRET = "integrity-secret";

    const envelope = buildEnvelope();
    const seal = sealProtocolMessageIntegrity({ message: envelope });

    const verification = verifyProtocolMessageIntegrity({
      message: {
        ...envelope,
        ...seal,
        payload: {
          ...envelope.payload,
          goal: "Modified after write",
        },
      },
      expectedPreviousIntegritySignature: null,
    });

    expect(verification.status).toBe("tampered");
  });
});
