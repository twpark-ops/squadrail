import { createHash } from "node:crypto";
import type {
  RetrievalCacheInspectionResult,
  RetrievalCacheState,
  RetrievalSignals,
  RetrievalTemporalContext,
} from "./issue-retrieval.js";

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

const ISSUE_REFERENCE_PATTERN = /\b[A-Z][A-Z0-9]{1,9}-\d+\b/g;
const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;

export function hashString(value: string) {
  return sha256(value);
}

export function normalizeRetrievalQueryText(value: string) {
  return value
    .replace(UUID_PATTERN, "<uuid>")
    .replace(ISSUE_REFERENCE_PATTERN, "<issue>")
    .replace(/\s+/g, " ")
    .trim();
}

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  }
  if (!value || typeof value !== "object") {
    return JSON.stringify(value);
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

function roundBoost(value: number) {
  return Math.round(value * 100) / 100;
}

function normalizeBoostFingerprintMap(input: Record<string, number>) {
  return Object.fromEntries(
    Object.entries(input)
      .map(([key, value]) => [key, roundBoost(value)] as const)
      .filter(([, value]) => Math.abs(value) >= 0.01)
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey)),
  );
}

export interface RetrievalCacheIdentity {
  queryFingerprint: string;
  policyFingerprint: string;
  feedbackFingerprint: string;
  revisionSignature: string;
}

function toStableCacheSignals(input: RetrievalSignals) {
  return {
    exactPaths: [...input.exactPaths].sort(),
    fileNames: [...input.fileNames].sort(),
    lexicalTerms: [...input.lexicalTerms].sort(),
    preferredSourceTypes: [...input.preferredSourceTypes].sort(),
    projectAffinityIds: [...input.projectAffinityIds].sort(),
    relatedIssueIds: [...(input.relatedIssueIds ?? [])].sort(),
    blockerCode: input.blockerCode,
    questionType: input.questionType,
  };
}

function toStableTemporalContext(input: RetrievalTemporalContext | null) {
  if (!input) return null;
  return {
    source: input.source,
    headSha: input.headSha ?? null,
  };
}

export function buildRetrievalStageCacheKey(input: {
  stage: "candidate_hits" | "final_hits";
  queryText: string;
  companyId: string;
  issueProjectId: string | null;
  executionLane?: string | null;
  role: string;
  eventType: string;
  workflowState: string;
  allowedSourceTypes: string[];
  allowedAuthorityLevels: string[];
  rerankConfig: Record<string, unknown>;
  dynamicSignals: RetrievalSignals;
  temporalContext: RetrievalTemporalContext | null;
  revisionSignature: string;
  personalizationFingerprint?: string;
}) {
  return sha256(stableJson({
    stage: input.stage,
    companyId: input.companyId,
    issueProjectId: input.issueProjectId,
    executionLane: input.executionLane ?? null,
    queryText: normalizeRetrievalQueryText(input.queryText),
    role: input.role,
    eventType: input.eventType,
    workflowState: input.workflowState,
    allowedSourceTypes: [...input.allowedSourceTypes].sort(),
    allowedAuthorityLevels: [...input.allowedAuthorityLevels].sort(),
    rerankConfig: input.rerankConfig,
    dynamicSignals: {
      exactPaths: [...input.dynamicSignals.exactPaths].sort(),
      fileNames: [...input.dynamicSignals.fileNames].sort(),
      lexicalTerms: [...input.dynamicSignals.lexicalTerms].sort(),
      symbolHints: [...input.dynamicSignals.symbolHints].sort(),
      knowledgeTags: [...input.dynamicSignals.knowledgeTags].sort(),
      preferredSourceTypes: [...input.dynamicSignals.preferredSourceTypes].sort(),
      projectAffinityIds: [...input.dynamicSignals.projectAffinityIds].sort(),
      relatedIssueIds: [...(input.dynamicSignals.relatedIssueIds ?? [])].sort(),
      blockerCode: input.dynamicSignals.blockerCode,
      questionType: input.dynamicSignals.questionType,
    },
    temporalContext: input.temporalContext,
    revisionSignature: input.revisionSignature,
    personalizationFingerprint: input.personalizationFingerprint ?? null,
  }));
}

export function buildPersonalizationFingerprint(input: {
  applied: boolean;
  scopes: string[];
  feedbackCount: number;
  positiveFeedbackCount: number;
  negativeFeedbackCount: number;
  sourceTypeBoosts: Record<string, number>;
  pathBoosts: Record<string, number>;
  symbolBoosts: Record<string, number>;
}) {
  return sha256(stableJson({
    applied: input.applied,
    scopes: [...input.scopes].sort(),
    sourceTypeBoosts: normalizeBoostFingerprintMap(input.sourceTypeBoosts),
    pathBoosts: normalizeBoostFingerprintMap(input.pathBoosts),
    symbolBoosts: normalizeBoostFingerprintMap(input.symbolBoosts),
  }));
}

export function buildRetrievalCacheIdentity(input: {
  stage: "candidate_hits" | "final_hits";
  queryText: string;
  companyId: string;
  issueProjectId: string | null;
  executionLane?: string | null;
  role: string;
  eventType: string;
  workflowState: string;
  baselineSignals: RetrievalSignals;
  temporalContext: RetrievalTemporalContext | null;
  allowedSourceTypes: string[];
  allowedAuthorityLevels: string[];
  rerankConfig: Record<string, unknown>;
  revisionSignature: string;
  personalizationFingerprint?: string;
}): RetrievalCacheIdentity {
  const queryFingerprint = sha256(stableJson({
    stage: input.stage,
    companyId: input.companyId,
    issueProjectId: input.issueProjectId,
    executionLane: input.executionLane ?? null,
    role: input.role,
    eventType: input.eventType,
    workflowState: input.workflowState,
    baselineSignals: toStableCacheSignals(input.baselineSignals),
    temporalContext: toStableTemporalContext(input.temporalContext),
  }));
  const policyFingerprint = sha256(stableJson({
    allowedSourceTypes: [...input.allowedSourceTypes].sort(),
    allowedAuthorityLevels: [...input.allowedAuthorityLevels].sort(),
    rerankConfig: input.rerankConfig,
  }));
  return {
    queryFingerprint,
    policyFingerprint,
    feedbackFingerprint: input.personalizationFingerprint ?? "none",
    revisionSignature: input.revisionSignature,
  };
}

export function buildRetrievalCacheInspectionResult(input: {
  state: RetrievalCacheState;
  cacheKey: string;
  requestedCacheKey?: string;
  matchedCacheKey?: string | null;
  provenance?: RetrievalCacheInspectionResult["provenance"];
  matchedRevision?: number | null;
  latestKnownRevision?: number | null;
  lastEntryUpdatedAt?: Date | string | null;
}): RetrievalCacheInspectionResult {
  const updatedAtValue = input.lastEntryUpdatedAt;
  const updatedAt = updatedAtValue instanceof Date
    ? updatedAtValue.toISOString()
    : typeof updatedAtValue === "string"
      ? updatedAtValue
      : null;
  const requestedCacheKey = input.requestedCacheKey ?? input.cacheKey;
  const matchedCacheKey = input.matchedCacheKey ?? (input.state === "hit" ? input.cacheKey : null);
  const primaryCacheKey = matchedCacheKey ?? requestedCacheKey;
  return {
    state: input.state,
    reason: input.state,
    provenance: input.provenance ?? null,
    matchedRevision: input.matchedRevision ?? null,
    latestKnownRevision: input.latestKnownRevision ?? null,
    lastEntryUpdatedAt: updatedAt,
    cacheKeyFingerprint: primaryCacheKey.slice(0, 12),
    requestedCacheKeyFingerprint: requestedCacheKey.slice(0, 12),
    matchedCacheKeyFingerprint: matchedCacheKey ? matchedCacheKey.slice(0, 12) : null,
  };
}
