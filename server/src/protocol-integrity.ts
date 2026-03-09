import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { resolveDefaultProtocolIntegritySecretFilePath } from "./home-paths.js";

type ProtocolIntegrityArtifact = {
  kind: string;
  uri: string;
  label?: string | null;
  metadata?: Record<string, unknown> | null;
};

type ProtocolIntegrityRecipient = {
  recipientType: string;
  recipientId: string;
  role: string;
};

export type ProtocolIntegrityEnvelope = {
  id: string;
  companyId: string;
  issueId: string;
  threadId: string;
  seq: number;
  messageType: string;
  senderActorType: string;
  senderActorId: string;
  senderRole: string;
  workflowStateBefore: string;
  workflowStateAfter: string;
  summary: string;
  payload: Record<string, unknown>;
  recipients: ProtocolIntegrityRecipient[];
  artifacts: ProtocolIntegrityArtifact[];
  causalMessageId?: string | null;
  retrievalRunId?: string | null;
  requiresAck?: boolean;
  createdAt: Date | string;
};

export type ProtocolIntegrityVerificationStatus =
  | "verified"
  | "legacy_unsealed"
  | "tampered"
  | "unsupported_algorithm";

const PROTOCOL_INTEGRITY_ALGORITHM = "hmac-sha256:v1";

function readAliasEnv(...keys: string[]) {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

function resolveProtocolIntegritySecretFilePath() {
  return readAliasEnv("SQUADRAIL_PROTOCOL_INTEGRITY_SECRET_FILE")
    ?? resolveDefaultProtocolIntegritySecretFilePath();
}

function readOrCreateFallbackSecretFile() {
  const filePath = resolveProtocolIntegritySecretFilePath();
  try {
    if (existsSync(filePath)) {
      const current = readFileSync(filePath, "utf8").trim();
      if (current.length > 0) return current;
    }

    mkdirSync(path.dirname(filePath), { recursive: true });
  } catch {
    return undefined;
  }

  try {
    const next = randomBytes(32).toString("base64url");
    writeFileSync(filePath, `${next}\n`, { encoding: "utf8", mode: 0o600 });
    return next;
  } catch {
    return undefined;
  }
}

function protocolIntegritySecret() {
  return readAliasEnv("SQUADRAIL_PROTOCOL_INTEGRITY_SECRET")
    ?? readOrCreateFallbackSecretFile()
    ?? null;
}

function normalizeValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, innerValue]) => [key, normalizeValue(innerValue)]);
    return Object.fromEntries(entries);
  }
  return value;
}

export function canonicalizeProtocolIntegrityValue(value: unknown): string {
  return JSON.stringify(normalizeValue(value));
}

function digestSha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function signPayload(secret: string, value: string) {
  return createHmac("sha256", secret).update(value).digest("hex");
}

function safeCompareHex(left: string, right: string) {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  if (leftBuffer.length !== rightBuffer.length || leftBuffer.length === 0) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function sortRecipients(recipients: ProtocolIntegrityRecipient[]) {
  return [...recipients].sort((left, right) =>
    `${left.role}:${left.recipientType}:${left.recipientId}`.localeCompare(
      `${right.role}:${right.recipientType}:${right.recipientId}`,
    ));
}

function sortArtifacts(artifacts: ProtocolIntegrityArtifact[]) {
  return [...artifacts].sort((left, right) =>
    `${left.kind}:${left.uri}:${left.label ?? ""}`.localeCompare(
      `${right.kind}:${right.uri}:${right.label ?? ""}`,
    ));
}

function buildIntegrityEnvelopeString(input: {
  message: ProtocolIntegrityEnvelope;
  previousIntegritySignature?: string | null;
  payloadSha256: string;
  integrityAlgorithm?: string | null;
}) {
  return canonicalizeProtocolIntegrityValue({
    integrityAlgorithm: input.integrityAlgorithm ?? PROTOCOL_INTEGRITY_ALGORITHM,
    previousIntegritySignature: input.previousIntegritySignature ?? null,
    payloadSha256: input.payloadSha256,
    id: input.message.id,
    companyId: input.message.companyId,
    issueId: input.message.issueId,
    threadId: input.message.threadId,
    seq: input.message.seq,
    messageType: input.message.messageType,
    senderActorType: input.message.senderActorType,
    senderActorId: input.message.senderActorId,
    senderRole: input.message.senderRole,
    workflowStateBefore: input.message.workflowStateBefore,
    workflowStateAfter: input.message.workflowStateAfter,
    summary: input.message.summary,
    payload: input.message.payload,
    recipients: sortRecipients(input.message.recipients),
    artifacts: sortArtifacts(input.message.artifacts),
    causalMessageId: input.message.causalMessageId ?? null,
    retrievalRunId: input.message.retrievalRunId ?? null,
    requiresAck: Boolean(input.message.requiresAck),
    createdAt: input.message.createdAt instanceof Date ? input.message.createdAt.toISOString() : input.message.createdAt,
  });
}

export function protocolIntegrityReady() {
  return protocolIntegritySecret() !== null;
}

export function computeProtocolPayloadSha256(payload: Record<string, unknown>) {
  return digestSha256(canonicalizeProtocolIntegrityValue(payload));
}

export function sealProtocolMessageIntegrity(input: {
  message: ProtocolIntegrityEnvelope;
  previousIntegritySignature?: string | null;
}) {
  const secret = protocolIntegritySecret();
  if (!secret) return null;

  const payloadSha256 = computeProtocolPayloadSha256(input.message.payload);
  const envelope = buildIntegrityEnvelopeString({
    message: input.message,
    previousIntegritySignature: input.previousIntegritySignature ?? null,
    payloadSha256,
  });

  return {
    integrityAlgorithm: PROTOCOL_INTEGRITY_ALGORITHM,
    previousIntegritySignature: input.previousIntegritySignature ?? null,
    payloadSha256,
    integritySignature: signPayload(secret, envelope),
  };
}

export function verifyProtocolMessageIntegrity(input: {
  message: ProtocolIntegrityEnvelope & {
    payloadSha256?: string | null;
    previousIntegritySignature?: string | null;
    integritySignature?: string | null;
    integrityAlgorithm?: string | null;
  };
  expectedPreviousIntegritySignature?: string | null;
}) {
  const algorithm = input.message.integrityAlgorithm ?? null;
  const signature = input.message.integritySignature ?? null;
  if (!algorithm || !signature) {
    return {
      status: "legacy_unsealed" as const,
      computedPayloadSha256: computeProtocolPayloadSha256(input.message.payload),
    };
  }

  if (algorithm !== PROTOCOL_INTEGRITY_ALGORITHM) {
    return {
      status: "unsupported_algorithm" as const,
      computedPayloadSha256: computeProtocolPayloadSha256(input.message.payload),
    };
  }

  const secret = protocolIntegritySecret();
  if (!secret) {
    return {
      status: "unsupported_algorithm" as const,
      computedPayloadSha256: computeProtocolPayloadSha256(input.message.payload),
    };
  }

  const computedPayloadSha256 = computeProtocolPayloadSha256(input.message.payload);
  const previousIntegritySignature = input.message.previousIntegritySignature ?? null;
  if ((input.expectedPreviousIntegritySignature ?? null) !== previousIntegritySignature) {
    return {
      status: "tampered" as const,
      computedPayloadSha256,
    };
  }

  const expectedEnvelope = buildIntegrityEnvelopeString({
    message: input.message,
    previousIntegritySignature,
    payloadSha256: computedPayloadSha256,
    integrityAlgorithm: algorithm,
  });
  const expectedSignature = signPayload(secret, expectedEnvelope);

  return {
    status:
      safeCompareHex(expectedSignature, signature)
      && computedPayloadSha256 === (input.message.payloadSha256 ?? null)
        ? ("verified" as const)
        : ("tampered" as const),
    computedPayloadSha256,
  };
}
