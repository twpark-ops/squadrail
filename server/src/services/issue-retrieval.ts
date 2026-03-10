import { createHash } from "node:crypto";
import path from "node:path";
import { and, desc, eq, inArray, not, or, sql } from "drizzle-orm";
import type { Db } from "@squadrail/db";
import {
  codeSymbolEdges,
  codeSymbols,
  issueMergeCandidates,
  issueProtocolArtifacts,
  issueProtocolMessages,
  knowledgeChunkLinks,
  knowledgeChunks,
  knowledgeDocumentVersions,
  knowledgeDocuments,
} from "@squadrail/db";
import type { CreateIssueProtocolMessage } from "@squadrail/shared";
import { knowledgeEmbeddingService } from "./knowledge-embeddings.js";
import { knowledgeRerankingService } from "./knowledge-reranking.js";
import { knowledgeService } from "./knowledge.js";
import { logActivity } from "./activity-log.js";
import { publishLiveEvent } from "./live-events.js";
import {
  computeRetrievalPersonalizationBoost,
  retrievalPersonalizationService,
  type RetrievalPersonalizationProfile,
} from "./retrieval-personalization.js";

const RETRIEVAL_EVENT_BY_MESSAGE_TYPE = {
  ASSIGN_TASK: "on_assignment",
  REASSIGN_TASK: "on_assignment",
  ACK_ASSIGNMENT: "on_acceptance",
  ASK_CLARIFICATION: "on_progress_report",
  PROPOSE_PLAN: "on_plan_requested",
  REPORT_PROGRESS: "on_progress_report",
  ESCALATE_BLOCKER: "on_blocker",
  SUBMIT_FOR_REVIEW: "on_review_submit",
  START_REVIEW: "on_review_start",
  REQUEST_CHANGES: "on_change_request",
  APPROVE_IMPLEMENTATION: "on_approval",
  CLOSE_TASK: "on_close",
} as const satisfies Partial<Record<CreateIssueProtocolMessage["messageType"], string>>;

const QUERY_EMBEDDING_CACHE_TTL_SECONDS = 24 * 60 * 60;

type RetrievalEventType = (typeof RETRIEVAL_EVENT_BY_MESSAGE_TYPE)[keyof typeof RETRIEVAL_EVENT_BY_MESSAGE_TYPE];

type RetrievalTargetRole = "engineer" | "reviewer" | "tech_lead" | "cto" | "pm" | "qa" | "human_board";
type RetrievalBriefScope = "global" | "engineer" | "reviewer" | "tech_lead" | "cto" | "pm" | "qa" | "closure";

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function buildQueryEmbeddingCacheKey(input: {
  queryText: string;
  embeddingFingerprint: string;
}) {
  return sha256(`${input.embeddingFingerprint}\n${input.queryText}`);
}

function readCachedEmbedding(entryValue: Record<string, unknown> | null | undefined) {
  const embedding = Array.isArray(entryValue?.embedding)
    ? entryValue.embedding.map((value) => Number(value)).filter((value) => Number.isFinite(value))
    : [];
  if (embedding.length === 0) return null;
  return {
    embedding,
    provider: typeof entryValue?.provider === "string" ? entryValue.provider : null,
    model: typeof entryValue?.model === "string" ? entryValue.model : null,
    dimensions: typeof entryValue?.dimensions === "number" ? entryValue.dimensions : embedding.length,
    totalTokens: typeof entryValue?.totalTokens === "number" ? entryValue.totalTokens : null,
  };
}

export interface RetrievalHitView {
  chunkId: string;
  documentId: string;
  sourceType: string;
  authorityLevel: string;
  documentIssueId: string | null;
  documentProjectId: string | null;
  path: string | null;
  title: string | null;
  headingPath: string | null;
  symbolName: string | null;
  textContent: string;
  documentMetadata: Record<string, unknown>;
  chunkMetadata: Record<string, unknown>;
  denseScore: number | null;
  sparseScore: number | null;
  rerankScore: number | null;
  fusedScore: number;
  updatedAt: Date;
  modelRerankRank?: number | null;
  graphMetadata?: {
    entityTypes: string[];
    entityIds: string[];
    seedReasons: string[];
    graphScore: number;
    edgeTypes?: string[];
    hopDepth?: number;
  } | null;
  temporalMetadata?: {
    branchName: string | null;
    defaultBranchName: string | null;
    commitSha: string | null;
    matchType: "exact_commit" | "same_branch_head" | "same_branch_stale" | "default_branch_head" | "foreign_branch" | "none";
    score: number;
    stale: boolean;
  } | null;
  personalizationMetadata?: {
    totalBoost: number;
    sourceTypeBoost: number;
    pathBoost: number;
    symbolBoost: number;
    scopes: string[];
    matchedSourceType: string | null;
    matchedPath: string | null;
    matchedSymbol: string | null;
  } | null;
}

interface IssueRetrievalIssueSnapshot {
  id: string;
  projectId: string | null;
  identifier: string | null;
  title: string;
  description: string | null;
  labels?: Array<{ name: string }>;
  mentionedProjects?: Array<{ id: string; name: string }>;
}

interface RecipientRetrievalHint {
  recipientId: string;
  recipientRole: string;
  retrievalRunId: string;
  briefId: string;
  briefScope: string;
  briefContentMarkdown?: string;
  briefEvidenceSummary?: Array<{
    rank?: number;
    sourceType?: string | null;
    authorityLevel?: string | null;
    path?: string | null;
    title?: string | null;
    symbolName?: string | null;
    fusedScore?: number | null;
  }>;
}

interface RetrievalLinkView {
  chunkId: string;
  entityType: string;
  entityId: string;
  linkReason: string;
  weight: number;
}

interface RetrievalSignals {
  exactPaths: string[];
  fileNames: string[];
  symbolHints: string[];
  knowledgeTags: string[];
  preferredSourceTypes: string[];
  projectAffinityIds: string[];
  projectAffinityNames: string[];
  blockerCode: string | null;
  questionType: string | null;
}

interface RetrievalRerankWeights {
  sourceTypeBaseBoost: number;
  sourceTypeDecay: number;
  sourceTypeMinBoost: number;
  exactPathBoost: number;
  fileNameBoost: number;
  symbolExactBoost: number;
  symbolPartialBoost: number;
  tagMatchBoostPerTag: number;
  tagMatchMaxBoost: number;
  latestBoost: number;
  issueLinkMinBoost: number;
  issueLinkWeightMultiplier: number;
  projectLinkMinBoost: number;
  projectLinkWeightMultiplier: number;
  pathLinkMinBoost: number;
  pathLinkWeightMultiplier: number;
  linkBoostCap: number;
  freshnessWindowDays: number;
  freshnessMaxBoost: number;
  expiredPenalty: number;
  futurePenalty: number;
  supersededPenalty: number;
  temporalExactCommitBoost: number;
  temporalSameBranchHeadBoost: number;
  temporalDefaultBranchBoost: number;
  temporalForeignBranchPenalty: number;
  temporalStalePenalty: number;
}

interface RetrievalPolicyRerankConfig {
  preferredSourceTypes: string[];
  sourceTypeBoosts: Record<string, number>;
  weights: RetrievalRerankWeights;
  modelRerank: {
    enabled: boolean;
    candidateCount: number;
    baseBoost: number;
    decay: number;
  };
}

interface BriefQualitySummary {
  confidenceLevel: "high" | "medium" | "low";
  evidenceCount: number;
  denseEnabled: boolean;
  denseHitCount: number;
  sparseHitCount: number;
  pathHitCount: number;
  symbolHitCount: number;
  graphSeedCount: number;
  graphHitCount: number;
  graphEntityTypes: string[];
  symbolGraphSeedCount: number;
  symbolGraphHitCount: number;
  edgeTraversalCount: number;
  edgeTypeCounts: Record<string, number>;
  graphMaxDepth: number;
  graphHopDepthCounts: Record<string, number>;
  multiHopGraphHitCount: number;
  temporalContextAvailable: boolean;
  temporalHitCount: number;
  branchAlignedTopHitCount: number;
  staleVersionPenaltyCount: number;
  exactCommitMatchCount: number;
  personalizationApplied: boolean;
  personalizedHitCount: number;
  averagePersonalizationBoost: number;
  sourceDiversity: number;
  degradedReasons: string[];
}

interface RetrievalGraphSeed {
  entityType: "symbol" | "path" | "project";
  entityId: string;
  seedBoost: number;
  seedReasons: string[];
}

interface RetrievalChunkSymbolView {
  symbolId: string;
  chunkId: string;
  path: string;
  symbolKey: string;
  symbolName: string;
  symbolKind: string;
  metadata: Record<string, unknown>;
}

export interface RetrievalSymbolGraphSeed {
  symbolId: string;
  chunkId: string;
  path: string;
  symbolName: string;
  seedBoost: number;
  seedReasons: string[];
}

interface RetrievalTemporalContext {
  branchName: string | null;
  defaultBranchName: string | null;
  headSha: string | null;
  source: "artifact" | "merge_candidate" | "default_branch";
}

interface RetrievalDocumentVersionView {
  documentId: string;
  branchName: string | null;
  defaultBranchName: string | null;
  commitSha: string | null;
  parentCommitSha: string | null;
  isHead: boolean;
  isDefaultBranch: boolean;
  capturedAt: Date;
  metadata: Record<string, unknown>;
}

const DEFAULT_RETRIEVAL_RERANK_WEIGHTS = {
  sourceTypeBaseBoost: 1.25,
  sourceTypeDecay: 0.15,
  sourceTypeMinBoost: 0.15,
  exactPathBoost: 2.5,
  fileNameBoost: 0.9,
  symbolExactBoost: 1.3,
  symbolPartialBoost: 0.45,
  tagMatchBoostPerTag: 0.4,
  tagMatchMaxBoost: 1.2,
  latestBoost: 0.35,
  issueLinkMinBoost: 0.2,
  issueLinkWeightMultiplier: 0.8,
  projectLinkMinBoost: 0.1,
  projectLinkWeightMultiplier: 0.5,
  pathLinkMinBoost: 0.2,
  pathLinkWeightMultiplier: 1,
  linkBoostCap: 2.5,
  freshnessWindowDays: 21,
  freshnessMaxBoost: 0.45,
  expiredPenalty: -1.2,
  futurePenalty: -0.4,
  supersededPenalty: -0.8,
  temporalExactCommitBoost: 1.8,
  temporalSameBranchHeadBoost: 0.85,
  temporalDefaultBranchBoost: 0.25,
  temporalForeignBranchPenalty: -0.35,
  temporalStalePenalty: -0.45,
} as const satisfies RetrievalRerankWeights;

function summarizeBriefQuality(input: {
  finalHits: RetrievalHitView[];
  queryEmbedding: number[] | null;
  sparseHitCount: number;
  pathHitCount: number;
  symbolHitCount: number;
  denseHitCount: number;
  graphSeedCount: number;
  graphHitCount: number;
  graphEntityTypes: string[];
  symbolGraphSeedCount: number;
  symbolGraphHitCount: number;
  edgeTraversalCount: number;
  edgeTypeCounts: Record<string, number>;
  graphMaxDepth: number;
  graphHopDepthCounts: Record<string, number>;
  multiHopGraphHitCount: number;
  temporalContext: RetrievalTemporalContext | null;
  crossProjectRequested: boolean;
}): BriefQualitySummary {
  const evidenceCount = input.finalHits.length;
  const sourceDiversity = new Set(
    input.finalHits.map((hit) => hit.sourceType).filter((sourceType) => sourceType.trim().length > 0),
  ).size;
  const degradedReasons: string[] = [];
  if (!input.queryEmbedding) {
    degradedReasons.push("semantic_search_unavailable");
  } else if (input.denseHitCount === 0) {
    degradedReasons.push("semantic_search_empty");
  }
  if (evidenceCount === 0) {
    degradedReasons.push("no_retrieval_hits");
  } else if (evidenceCount < 3) {
    degradedReasons.push("low_evidence_count");
  }
  if (evidenceCount > 0 && sourceDiversity < 2) {
    degradedReasons.push("narrow_source_diversity");
  }
  if (input.crossProjectRequested && input.graphHitCount === 0) {
    degradedReasons.push("cross_project_graph_empty");
  }

  const temporalHitCount = input.finalHits.filter((hit) => (hit.temporalMetadata?.score ?? 0) > 0).length;
  const personalizedHits = input.finalHits.filter((hit) => (hit.personalizationMetadata?.totalBoost ?? 0) !== 0);
  const averagePersonalizationBoost =
    personalizedHits.length > 0
      ? personalizedHits.reduce((total, hit) => total + Math.abs(hit.personalizationMetadata?.totalBoost ?? 0), 0)
        / personalizedHits.length
      : 0;
  const branchAlignedTopHitCount = input.finalHits
    .slice(0, 3)
    .filter((hit) =>
      hit.temporalMetadata?.matchType === "exact_commit"
      || hit.temporalMetadata?.matchType === "same_branch_head"
      || hit.temporalMetadata?.matchType === "default_branch_head"
    )
    .length;
  const staleVersionPenaltyCount = input.finalHits.filter((hit) => hit.temporalMetadata?.stale === true).length;
  const exactCommitMatchCount = input.finalHits.filter((hit) => hit.temporalMetadata?.matchType === "exact_commit").length;
  if (input.temporalContext && temporalHitCount === 0) {
    degradedReasons.push("temporal_context_unmatched");
  }

  let confidenceLevel: BriefQualitySummary["confidenceLevel"] = "low";
  if (evidenceCount >= 5 && Boolean(input.queryEmbedding) && input.denseHitCount > 0 && sourceDiversity >= 2) {
    confidenceLevel = "high";
  } else if (evidenceCount >= 3) {
    confidenceLevel = "medium";
  }
  if (confidenceLevel === "high" && input.crossProjectRequested && input.graphHitCount === 0) {
    confidenceLevel = "medium";
  }

  return {
    confidenceLevel,
    evidenceCount,
    denseEnabled: Boolean(input.queryEmbedding),
    denseHitCount: input.denseHitCount,
    sparseHitCount: input.sparseHitCount,
    pathHitCount: input.pathHitCount,
    symbolHitCount: input.symbolHitCount,
    graphSeedCount: input.graphSeedCount,
    graphHitCount: input.graphHitCount,
    graphEntityTypes: input.graphEntityTypes,
    symbolGraphSeedCount: input.symbolGraphSeedCount,
    symbolGraphHitCount: input.symbolGraphHitCount,
    edgeTraversalCount: input.edgeTraversalCount,
    edgeTypeCounts: input.edgeTypeCounts,
    graphMaxDepth: input.graphMaxDepth,
    graphHopDepthCounts: input.graphHopDepthCounts,
    multiHopGraphHitCount: input.multiHopGraphHitCount,
    temporalContextAvailable: Boolean(input.temporalContext),
    temporalHitCount,
    branchAlignedTopHitCount,
    staleVersionPenaltyCount,
    exactCommitMatchCount,
    personalizationApplied: personalizedHits.length > 0,
    personalizedHitCount: personalizedHits.length,
    averagePersonalizationBoost,
    sourceDiversity,
    degradedReasons,
  };
}

function uniqueNonEmpty(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    ordered.push(trimmed);
  }
  return ordered;
}

function compactWhitespace(value: string, max = 220) {
  const compacted = value.replace(/\s+/g, " ").trim();
  if (compacted.length <= max) return compacted;
  return `${compacted.slice(0, max - 1)}...`;
}

function truncateRetrievalSegment(value: string, max: number) {
  const compacted = value.replace(/\s+/g, " ").trim();
  if (compacted.length <= max) return compacted;
  return `${compacted.slice(0, Math.max(0, max - 3))}...`;
}

function normalizeHintPath(value: string) {
  const normalized = value.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  return path.posix.normalize(normalized);
}

function basenameWithoutExtension(filePath: string) {
  const base = path.posix.basename(filePath);
  return base.replace(/\.[^.]+$/, "");
}

function extractIdentifierHints(values: string[]) {
  const identifiers: string[] = [];
  for (const value of values) {
    const matches = value.match(/\b[A-Za-z_][A-Za-z0-9_]{2,}\b/g) ?? [];
    for (const match of matches) {
      if (!/[A-Z_]/.test(match) && match === match.toLowerCase()) continue;
      identifiers.push(match);
    }
  }
  return uniqueNonEmpty(identifiers);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return uniqueNonEmpty(value.filter((entry): entry is string => typeof entry === "string"));
}

function asNumberRecord(value: unknown) {
  const record = asRecord(value);
  if (!record) return {};

  const numericEntries = Object.entries(record).filter(([, candidate]) =>
    typeof candidate === "number" && Number.isFinite(candidate),
  );
  return Object.fromEntries(numericEntries) as Record<string, number>;
}

function readConfiguredNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function parseIsoDate(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function metadataStringArray(metadata: Record<string, unknown>, keys: string[]) {
  const values: string[] = [];
  for (const key of keys) {
    const candidate = metadata[key];
    if (!Array.isArray(candidate)) continue;
    for (const item of candidate) {
      if (typeof item === "string" && item.trim().length > 0) {
        values.push(item.trim());
      }
    }
  }
  return uniqueNonEmpty(values);
}

function clampScore(value: number | null | undefined) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Number(value));
}

function dbVectorLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function computeScopeBoost(input: {
  hitIssueId: string | null;
  hitProjectId: string | null;
  issueId: string;
  projectId: string | null;
  projectAffinityIds?: string[];
}) {
  if (input.hitIssueId === input.issueId) return 2;
  if (input.projectId && input.hitProjectId === input.projectId) return 1;
  if (input.hitProjectId && (input.projectAffinityIds ?? []).includes(input.hitProjectId)) return 0.8;
  return 0;
}

function computeAuthorityBoost(authorityLevel: string) {
  switch (authorityLevel) {
    case "canonical":
      return 0.35;
    case "working":
      return 0.15;
    case "draft":
      return -0.2;
    case "deprecated":
      return -1;
    default:
      return 0;
  }
}

function normalizeEmbeddingVector(values: unknown) {
  if (!Array.isArray(values)) return null;

  const normalized = values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  return normalized.length > 0 ? normalized : null;
}

export function computeCosineSimilarity(leftInput: unknown, rightInput: unknown) {
  const left = normalizeEmbeddingVector(leftInput);
  const right = normalizeEmbeddingVector(rightInput);
  if (!left || !right || left.length === 0 || right.length === 0 || left.length !== right.length) {
    return 0;
  }

  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index]!;
    const rightValue = right[index]!;
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) return 0;
  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

function extractPayloadTerms(message: CreateIssueProtocolMessage) {
  const payload = message.payload as Record<string, unknown>;

  switch (message.messageType) {
    case "ASSIGN_TASK":
      return uniqueNonEmpty([
        String(payload.goal ?? ""),
        ...((payload.acceptanceCriteria as string[] | undefined) ?? []),
        ...((payload.definitionOfDone as string[] | undefined) ?? []),
        ...((payload.requiredKnowledgeTags as string[] | undefined) ?? []),
      ]);
    case "ACK_ASSIGNMENT":
      return uniqueNonEmpty([
        String(payload.understoodScope ?? ""),
        ...((payload.initialRisks as string[] | undefined) ?? []),
      ]);
    case "ASK_CLARIFICATION":
      return uniqueNonEmpty([
        String(payload.question ?? ""),
        ...((payload.proposedAssumptions as string[] | undefined) ?? []),
      ]);
    case "PROPOSE_PLAN":
      return uniqueNonEmpty([
        String(payload.planSummary ?? ""),
        ...(((payload.steps as Array<Record<string, unknown>> | undefined) ?? []).map((step) => String(step.title ?? ""))),
        ...((payload.risks as string[] | undefined) ?? []),
      ]);
    case "REPORT_PROGRESS":
      return uniqueNonEmpty([
        ...((payload.completedItems as string[] | undefined) ?? []),
        ...((payload.nextSteps as string[] | undefined) ?? []),
        ...((payload.changedFiles as string[] | undefined) ?? []),
        String(payload.testSummary ?? ""),
      ]);
    case "ESCALATE_BLOCKER":
      return uniqueNonEmpty([
        String(payload.blockerCode ?? ""),
        String(payload.blockingReason ?? ""),
        String(payload.requestedAction ?? ""),
      ]);
    case "SUBMIT_FOR_REVIEW":
      return uniqueNonEmpty([
        String(payload.implementationSummary ?? ""),
        ...((payload.reviewChecklist as string[] | undefined) ?? []),
        ...((payload.changedFiles as string[] | undefined) ?? []),
        ...((payload.testResults as string[] | undefined) ?? []),
        ...((payload.residualRisks as string[] | undefined) ?? []),
        String(payload.diffSummary ?? ""),
      ]);
    case "START_REVIEW":
      return uniqueNonEmpty([
        ...((payload.reviewFocus as string[] | undefined) ?? []),
      ]);
    case "REQUEST_CHANGES":
      return uniqueNonEmpty([
        String(payload.reviewSummary ?? ""),
        ...((payload.requiredEvidence as string[] | undefined) ?? []),
        ...(((payload.changeRequests as Array<Record<string, unknown>> | undefined) ?? []).flatMap((request) => [
          String(request.title ?? ""),
          String(request.reason ?? ""),
          ...(((request.affectedFiles as string[] | undefined) ?? [])),
          String(request.suggestedAction ?? ""),
        ])),
      ]);
    case "APPROVE_IMPLEMENTATION":
      return uniqueNonEmpty([
        String(payload.approvalSummary ?? ""),
        ...((payload.approvalChecklist as string[] | undefined) ?? []),
        ...((payload.verifiedEvidence as string[] | undefined) ?? []),
        ...((payload.residualRisks as string[] | undefined) ?? []),
        ...((payload.followUpActions as string[] | undefined) ?? []),
      ]);
    case "CLOSE_TASK":
      return uniqueNonEmpty([
        String(payload.closeReason ?? ""),
        String(payload.closureSummary ?? ""),
        String(payload.verificationSummary ?? ""),
        String(payload.rollbackPlan ?? ""),
        ...((payload.finalArtifacts as string[] | undefined) ?? []),
        ...((payload.remainingRisks as string[] | undefined) ?? []),
      ]);
    default:
      return [];
  }
}

export function deriveRetrievalEventType(messageType: CreateIssueProtocolMessage["messageType"]) {
  if (!(messageType in RETRIEVAL_EVENT_BY_MESSAGE_TYPE)) return null;
  return RETRIEVAL_EVENT_BY_MESSAGE_TYPE[messageType as keyof typeof RETRIEVAL_EVENT_BY_MESSAGE_TYPE];
}

export function deriveBriefScope(input: {
  eventType: RetrievalEventType;
  recipientRole: string;
}): RetrievalBriefScope {
  if (input.eventType === "on_close") return "closure";
  if (input.recipientRole === "reviewer") return "reviewer";
  if (input.recipientRole === "tech_lead") return "tech_lead";
  if (input.recipientRole === "cto") return "cto";
  if (input.recipientRole === "pm") return "pm";
  if (input.recipientRole === "qa") return "qa";
  if (input.recipientRole === "human_board") return "global";
  return "engineer";
}

export function selectProtocolRetrievalRecipients(input: {
  messageType: string;
  recipients: Array<{
    recipientType: string;
    recipientId: string;
    role: string;
  }>;
}) {
  const shouldInclude = (recipientRole: string) => {
    if (input.messageType === "ASSIGN_TASK" || input.messageType === "REASSIGN_TASK") {
      return (
        recipientRole === "engineer"
        || recipientRole === "tech_lead"
        || recipientRole === "pm"
        || recipientRole === "cto"
        || recipientRole === "qa"
      );
    }

    return (
      recipientRole === "engineer"
      || recipientRole === "reviewer"
      || recipientRole === "tech_lead"
      || recipientRole === "pm"
      || recipientRole === "cto"
      || recipientRole === "qa"
      || recipientRole === "human_board"
    );
  };

  return input.recipients.filter(
    (recipient, index, all) =>
      shouldInclude(recipient.role)
      && all.findIndex(
        (candidate) =>
          candidate.recipientId === recipient.recipientId
          && candidate.role === recipient.role
          && candidate.recipientType === recipient.recipientType,
      ) === index,
  );
}

export function buildRetrievalQueryText(input: {
  issue: {
    title: string;
    description: string | null;
    identifier: string | null;
    labels?: Array<{ name: string }>;
    mentionedProjects?: Array<{ id: string; name: string }>;
  };
  message: CreateIssueProtocolMessage;
  recipientRole: string;
}) {
  const payloadTerms = extractPayloadTerms(input.message);
  const querySegments = uniqueNonEmpty([
    truncateRetrievalSegment(input.issue.identifier ?? "", 64),
    truncateRetrievalSegment(input.issue.title, 180),
    truncateRetrievalSegment(input.issue.description ?? "", 1200),
    truncateRetrievalSegment(input.message.summary, 320),
    input.message.messageType,
    input.message.workflowStateAfter,
    input.recipientRole,
    ...((input.issue.labels ?? []).map((label) => truncateRetrievalSegment(label.name, 64))),
    ...((input.issue.mentionedProjects ?? []).map((project) => truncateRetrievalSegment(project.name, 96))),
    ...payloadTerms.slice(0, 16).map((term) => truncateRetrievalSegment(term, 180)),
  ]);

  const budgetedSegments: string[] = [];
  let consumed = 0;
  const maxQueryLength = 2400;
  for (const segment of querySegments) {
    const projected = consumed + segment.length + (budgetedSegments.length > 0 ? 1 : 0);
    if (projected > maxQueryLength) break;
    budgetedSegments.push(segment);
    consumed = projected;
  }

  return budgetedSegments.join("\n");
}

export function deriveDynamicRetrievalSignals(input: {
  message: CreateIssueProtocolMessage;
  issue: {
    projectId: string | null;
    mentionedProjects?: Array<{ id: string; name: string }>;
  };
  recipientRole: string;
  eventType: RetrievalEventType;
  baselineSourceTypes?: string[];
}) {
  const payload = input.message.payload as Record<string, unknown>;
  const preferredSourceTypesByRole: Record<string, string[]> = {
    engineer: ["code", "adr", "runbook", "issue", "review", "test_report"],
    reviewer: ["code", "test_report", "review", "issue", "adr", "runbook"],
    tech_lead: ["adr", "prd", "issue", "runbook", "review", "code"],
    human_board: ["prd", "adr", "issue", "review", "runbook", "protocol_message"],
  };
  const baselineSourceTypes = uniqueNonEmpty([
    ...(input.baselineSourceTypes ?? []),
    ...(preferredSourceTypesByRole[input.recipientRole] ?? preferredSourceTypesByRole.engineer),
  ]);

  const exactPaths = uniqueNonEmpty([
    ...((payload.changedFiles as string[] | undefined) ?? []),
    ...(((payload.changeRequests as Array<Record<string, unknown>> | undefined) ?? []).flatMap((request) => (
      (request.affectedFiles as string[] | undefined) ?? []
    ))),
    ...((payload.relatedArtifacts as string[] | undefined) ?? []),
  ]).map(normalizeHintPath);
  const fileNames = uniqueNonEmpty(exactPaths.map((entry) => path.posix.basename(entry)));
  const knowledgeTags = uniqueNonEmpty([
    ...((payload.requiredKnowledgeTags as string[] | undefined) ?? []),
    ...((payload.reviewChecklist as string[] | undefined) ?? []),
    ...((payload.reviewFocus as string[] | undefined) ?? []),
    ...((payload.requiredEvidence as string[] | undefined) ?? []),
    ...((payload.approvalChecklist as string[] | undefined) ?? []),
    ...((payload.verifiedEvidence as string[] | undefined) ?? []),
  ]);
  const identifierHints = extractIdentifierHints([
    ...knowledgeTags,
    ...exactPaths.map(basenameWithoutExtension),
    String(payload.question ?? ""),
    String(payload.blockerCode ?? ""),
    String(payload.implementationSummary ?? ""),
    String(payload.diffSummary ?? ""),
    String(payload.reviewSummary ?? ""),
    String(payload.approvalSummary ?? ""),
    String(payload.closureSummary ?? ""),
    String(payload.verificationSummary ?? ""),
  ]);

  const preferredSourceTypes = uniqueNonEmpty([
    ...(exactPaths.length > 0 ? ["code"] : []),
    ...(input.eventType === "on_review_submit" || input.eventType === "on_review_start" || input.eventType === "on_change_request"
      ? ["code", "test_report", "review"]
      : []),
    ...((payload.questionType === "requirement" || payload.questionType === "scope") ? ["prd", "issue"] : []),
    ...(String(payload.blockerCode ?? "").includes("architecture") ? ["adr", "runbook"] : []),
    ...baselineSourceTypes,
  ]);

  const projectAffinityIds = uniqueNonEmpty([
    input.issue.projectId ?? "",
    ...((input.issue.mentionedProjects ?? []).map((project) => project.id)),
  ]);
  const projectAffinityNames = uniqueNonEmpty([
    ...((input.issue.mentionedProjects ?? []).map((project) => project.name)),
  ]);

  return {
    exactPaths,
    fileNames,
    symbolHints: uniqueNonEmpty([...identifierHints, ...exactPaths.map(basenameWithoutExtension)]),
    knowledgeTags,
    preferredSourceTypes,
    projectAffinityIds,
    projectAffinityNames,
    blockerCode: typeof payload.blockerCode === "string" ? payload.blockerCode : null,
    questionType: typeof payload.questionType === "string" ? payload.questionType : null,
  } satisfies RetrievalSignals;
}

export function resolveRetrievalPolicyRerankConfig(input: {
  allowedSourceTypes: string[];
  metadata?: Record<string, unknown> | null;
}) {
  const metadata = asRecord(input.metadata) ?? {};
  const weightsRecord = asRecord(metadata.weights) ?? {};
  const modelRerankRecord = asRecord(metadata.modelRerank) ?? {};
  const preferredSourceTypes = uniqueNonEmpty([
    ...asStringArray(metadata.sourcePreferences),
    ...input.allowedSourceTypes,
  ]);
  const weights = {
    sourceTypeBaseBoost: readConfiguredNumber(weightsRecord.sourceTypeBaseBoost, DEFAULT_RETRIEVAL_RERANK_WEIGHTS.sourceTypeBaseBoost),
    sourceTypeDecay: readConfiguredNumber(weightsRecord.sourceTypeDecay, DEFAULT_RETRIEVAL_RERANK_WEIGHTS.sourceTypeDecay),
    sourceTypeMinBoost: readConfiguredNumber(weightsRecord.sourceTypeMinBoost, DEFAULT_RETRIEVAL_RERANK_WEIGHTS.sourceTypeMinBoost),
    exactPathBoost: readConfiguredNumber(weightsRecord.exactPathBoost, DEFAULT_RETRIEVAL_RERANK_WEIGHTS.exactPathBoost),
    fileNameBoost: readConfiguredNumber(weightsRecord.fileNameBoost, DEFAULT_RETRIEVAL_RERANK_WEIGHTS.fileNameBoost),
    symbolExactBoost: readConfiguredNumber(weightsRecord.symbolExactBoost, DEFAULT_RETRIEVAL_RERANK_WEIGHTS.symbolExactBoost),
    symbolPartialBoost: readConfiguredNumber(weightsRecord.symbolPartialBoost, DEFAULT_RETRIEVAL_RERANK_WEIGHTS.symbolPartialBoost),
    tagMatchBoostPerTag: readConfiguredNumber(weightsRecord.tagMatchBoostPerTag, DEFAULT_RETRIEVAL_RERANK_WEIGHTS.tagMatchBoostPerTag),
    tagMatchMaxBoost: readConfiguredNumber(weightsRecord.tagMatchMaxBoost, DEFAULT_RETRIEVAL_RERANK_WEIGHTS.tagMatchMaxBoost),
    latestBoost: readConfiguredNumber(weightsRecord.latestBoost, DEFAULT_RETRIEVAL_RERANK_WEIGHTS.latestBoost),
    issueLinkMinBoost: readConfiguredNumber(weightsRecord.issueLinkMinBoost, DEFAULT_RETRIEVAL_RERANK_WEIGHTS.issueLinkMinBoost),
    issueLinkWeightMultiplier: readConfiguredNumber(weightsRecord.issueLinkWeightMultiplier, DEFAULT_RETRIEVAL_RERANK_WEIGHTS.issueLinkWeightMultiplier),
    projectLinkMinBoost: readConfiguredNumber(weightsRecord.projectLinkMinBoost, DEFAULT_RETRIEVAL_RERANK_WEIGHTS.projectLinkMinBoost),
    projectLinkWeightMultiplier: readConfiguredNumber(weightsRecord.projectLinkWeightMultiplier, DEFAULT_RETRIEVAL_RERANK_WEIGHTS.projectLinkWeightMultiplier),
    pathLinkMinBoost: readConfiguredNumber(weightsRecord.pathLinkMinBoost, DEFAULT_RETRIEVAL_RERANK_WEIGHTS.pathLinkMinBoost),
    pathLinkWeightMultiplier: readConfiguredNumber(weightsRecord.pathLinkWeightMultiplier, DEFAULT_RETRIEVAL_RERANK_WEIGHTS.pathLinkWeightMultiplier),
    linkBoostCap: readConfiguredNumber(weightsRecord.linkBoostCap, DEFAULT_RETRIEVAL_RERANK_WEIGHTS.linkBoostCap),
    freshnessWindowDays: readConfiguredNumber(weightsRecord.freshnessWindowDays, DEFAULT_RETRIEVAL_RERANK_WEIGHTS.freshnessWindowDays),
    freshnessMaxBoost: readConfiguredNumber(weightsRecord.freshnessMaxBoost, DEFAULT_RETRIEVAL_RERANK_WEIGHTS.freshnessMaxBoost),
    expiredPenalty: readConfiguredNumber(weightsRecord.expiredPenalty, DEFAULT_RETRIEVAL_RERANK_WEIGHTS.expiredPenalty),
    futurePenalty: readConfiguredNumber(weightsRecord.futurePenalty, DEFAULT_RETRIEVAL_RERANK_WEIGHTS.futurePenalty),
    supersededPenalty: readConfiguredNumber(weightsRecord.supersededPenalty, DEFAULT_RETRIEVAL_RERANK_WEIGHTS.supersededPenalty),
    temporalExactCommitBoost: readConfiguredNumber(weightsRecord.temporalExactCommitBoost, DEFAULT_RETRIEVAL_RERANK_WEIGHTS.temporalExactCommitBoost),
    temporalSameBranchHeadBoost: readConfiguredNumber(weightsRecord.temporalSameBranchHeadBoost, DEFAULT_RETRIEVAL_RERANK_WEIGHTS.temporalSameBranchHeadBoost),
    temporalDefaultBranchBoost: readConfiguredNumber(weightsRecord.temporalDefaultBranchBoost, DEFAULT_RETRIEVAL_RERANK_WEIGHTS.temporalDefaultBranchBoost),
    temporalForeignBranchPenalty: readConfiguredNumber(weightsRecord.temporalForeignBranchPenalty, DEFAULT_RETRIEVAL_RERANK_WEIGHTS.temporalForeignBranchPenalty),
    temporalStalePenalty: readConfiguredNumber(weightsRecord.temporalStalePenalty, DEFAULT_RETRIEVAL_RERANK_WEIGHTS.temporalStalePenalty),
  } satisfies RetrievalRerankWeights;

  return {
    preferredSourceTypes,
    sourceTypeBoosts: asNumberRecord(metadata.sourceTypeBoosts),
    weights,
    modelRerank: {
      enabled: modelRerankRecord.enabled === true,
      candidateCount: Math.max(2, Math.floor(readConfiguredNumber(modelRerankRecord.candidateCount, 6))),
      baseBoost: readConfiguredNumber(modelRerankRecord.baseBoost, 1.5),
      decay: readConfiguredNumber(modelRerankRecord.decay, 0.15),
    },
  } satisfies RetrievalPolicyRerankConfig;
}

export function renderRetrievedBriefMarkdown(input: {
  briefScope: RetrievalBriefScope;
  issue: {
    identifier: string | null;
    title: string;
  };
  message: CreateIssueProtocolMessage;
  queryText: string;
  hits: RetrievalHitView[];
}) {
  const lines = [
    `# ${input.briefScope} brief`,
    "",
    `- issue: ${input.issue.identifier ? `${input.issue.identifier} ` : ""}${input.issue.title}`,
    `- messageType: ${input.message.messageType}`,
    `- workflow: ${input.message.workflowStateBefore} -> ${input.message.workflowStateAfter}`,
    `- summary: ${input.message.summary}`,
    "",
    "## Retrieval Query",
    "```text",
    input.queryText,
    "```",
  ];

  if (input.hits.length === 0) {
    lines.push("", "## Retrieved Evidence", "", "_No knowledge hits were selected for this brief yet._");
    return lines.join("\n");
  }

  lines.push("", "## Retrieved Evidence", "");
  input.hits.slice(0, 6).forEach((hit, index) => {
    const label = hit.title ?? hit.path ?? hit.symbolName ?? hit.chunkId;
    lines.push(
      `${index + 1}. [${hit.sourceType}/${hit.authorityLevel}] ${label}`,
      `   - score: ${hit.fusedScore.toFixed(3)}`,
      `   - lexical: ${(hit.sparseScore ?? 0).toFixed(3)} | semantic: ${(hit.denseScore ?? 0).toFixed(3)}`,
      `   - path: ${hit.path ?? "-"}`,
      ...(hit.graphMetadata
        ? [
          `   - graph: ${hit.graphMetadata.entityTypes.join(", ")} (${hit.graphMetadata.seedReasons.join(", ")})`,
          ...(hit.graphMetadata.edgeTypes?.length
            ? [`   - graph edges: ${hit.graphMetadata.edgeTypes.join(", ")}`]
            : []),
        ]
        : []),
      ...(hit.temporalMetadata && hit.temporalMetadata.matchType !== "none"
        ? [
          `   - version: ${hit.temporalMetadata.matchType} (${hit.temporalMetadata.branchName ?? hit.temporalMetadata.defaultBranchName ?? "-"})`,
        ]
        : []),
      ...(hit.personalizationMetadata && hit.personalizationMetadata.totalBoost !== 0
        ? [
          `   - personalization: ${hit.personalizationMetadata.totalBoost.toFixed(3)} (${hit.personalizationMetadata.scopes.join(", ")})`,
        ]
        : []),
      `   - excerpt: ${compactWhitespace(hit.textContent)}`,
    );
  });

  return lines.join("\n");
}

function defaultPolicyTemplate(input: {
  role: RetrievalTargetRole;
  eventType: RetrievalEventType;
  workflowState: string;
}) {
  const engineerSources = ["code", "adr", "issue", "review", "test_report", "runbook"];
  const reviewerSources = ["issue", "review", "code", "test_report", "adr", "runbook"];
  const leadSources = ["prd", "adr", "runbook", "issue", "protocol_message", "review", "code"];
  const boardSources = ["prd", "adr", "issue", "review", "protocol_message", "runbook"];
  const ctoSources = ["prd", "adr", "runbook", "issue", "review", "protocol_message"];
  const pmSources = ["prd", "issue", "adr", "runbook", "protocol_message", "review"];
  const qaSources = ["test_report", "issue", "review", "code", "adr", "runbook"];

  const sourceMap: Record<RetrievalTargetRole, string[]> = {
    engineer: engineerSources,
    reviewer: reviewerSources,
    tech_lead: leadSources,
    cto: ctoSources,
    pm: pmSources,
    qa: qaSources,
    human_board: boardSources,
  };

  return {
    role: input.role,
    eventType: input.eventType,
    workflowState: input.workflowState,
    topKDense: 20,
    topKSparse: 20,
    rerankK: 20,
    finalK: input.role === "reviewer" ? 8 : 6,
    allowedSourceTypes: sourceMap[input.role],
    allowedAuthorityLevels: ["canonical", "working"],
    metadata: {
      source: "default",
      sourcePreferences: sourceMap[input.role],
      weights: DEFAULT_RETRIEVAL_RERANK_WEIGHTS,
      modelRerank: {
        enabled: false,
        candidateCount: input.role === "reviewer" ? 8 : 6,
        baseBoost: 1.5,
        decay: 0.15,
      },
    },
  };
}

type RetrievalCandidate = Omit<RetrievalHitView, "fusedScore"> & {
  fusedScore?: number;
};

export function fuseRetrievalCandidates(input: {
  sparseHits: RetrievalCandidate[];
  denseHits: RetrievalCandidate[];
  issueId: string;
  projectId: string | null;
  projectAffinityIds?: string[];
  finalK: number;
}) {
  const merged = new Map<string, RetrievalCandidate>();

  const upsert = (candidate: RetrievalCandidate) => {
    const existing = merged.get(candidate.chunkId);
    if (!existing) {
      merged.set(candidate.chunkId, candidate);
      return;
    }

    merged.set(candidate.chunkId, {
      ...existing,
      ...candidate,
      denseScore: candidate.denseScore ?? existing.denseScore ?? null,
      sparseScore: candidate.sparseScore ?? existing.sparseScore ?? null,
      updatedAt:
        candidate.updatedAt > existing.updatedAt
          ? candidate.updatedAt
          : existing.updatedAt,
    });
  };

  for (const hit of input.sparseHits) upsert(hit);
  for (const hit of input.denseHits) upsert(hit);

  return Array.from(merged.values())
    .map((candidate) => {
      const scopeBoost = computeScopeBoost({
        hitIssueId: candidate.documentIssueId,
        hitProjectId: candidate.documentProjectId,
        issueId: input.issueId,
        projectId: input.projectId,
        projectAffinityIds: input.projectAffinityIds,
      });
      const authorityBoost = computeAuthorityBoost(candidate.authorityLevel);
      const fusedScore = clampScore(candidate.sparseScore) + clampScore(candidate.denseScore) + scopeBoost + authorityBoost;
      return {
        ...candidate,
        rerankScore: candidate.rerankScore ?? null,
        fusedScore,
      } satisfies RetrievalHitView;
    })
    .sort((left, right) => {
      if (right.fusedScore !== left.fusedScore) return right.fusedScore - left.fusedScore;
      return right.updatedAt.getTime() - left.updatedAt.getTime();
    })
    .slice(0, input.finalK);
}

function computeSourceTypeBoost(input: {
  sourceType: string;
  preferredSourceTypes: string[];
  rerankConfig: RetrievalPolicyRerankConfig;
}) {
  const explicit = input.rerankConfig.sourceTypeBoosts[input.sourceType];
  if (Number.isFinite(explicit)) return explicit;
  const index = input.preferredSourceTypes.indexOf(input.sourceType);
  if (index < 0) return 0;
  return Math.max(
    input.rerankConfig.weights.sourceTypeMinBoost,
    input.rerankConfig.weights.sourceTypeBaseBoost - index * input.rerankConfig.weights.sourceTypeDecay,
  );
}

function computePathBoost(hitPath: string | null, signals: RetrievalSignals, weights: RetrievalRerankWeights) {
  if (!hitPath) return 0;
  const normalized = normalizeHintPath(hitPath);
  if (signals.exactPaths.includes(normalized)) return weights.exactPathBoost;
  const baseName = path.posix.basename(normalized);
  if (signals.fileNames.includes(baseName)) return weights.fileNameBoost;
  return 0;
}

function computeSymbolBoost(symbolName: string | null, signals: RetrievalSignals, weights: RetrievalRerankWeights) {
  if (!symbolName) return 0;
  const normalized = symbolName.toLowerCase();
  if (signals.symbolHints.some((hint) => hint.toLowerCase() === normalized)) return weights.symbolExactBoost;
  if (signals.symbolHints.some((hint) => normalized.includes(hint.toLowerCase()) || hint.toLowerCase().includes(normalized))) {
    return weights.symbolPartialBoost;
  }
  return 0;
}

function computeTagBoost(hit: RetrievalHitView, signals: RetrievalSignals, weights: RetrievalRerankWeights) {
  if (signals.knowledgeTags.length === 0) return 0;
  const tags = uniqueNonEmpty([
    ...metadataStringArray(hit.documentMetadata, ["tags", "requiredKnowledgeTags"]),
    ...metadataStringArray(hit.chunkMetadata, ["tags", "requiredKnowledgeTags"]),
  ]).map((value) => value.toLowerCase());
  if (tags.length === 0) return 0;
  const matches = signals.knowledgeTags.filter((tag) => tags.includes(tag.toLowerCase())).length;
  return Math.min(weights.tagMatchMaxBoost, matches * weights.tagMatchBoostPerTag);
}

function computeLatestBoost(hit: RetrievalHitView, weights: RetrievalRerankWeights) {
  if (hit.documentMetadata.isLatestForScope === true) return weights.latestBoost;
  return 0;
}

function computeFreshnessBoost(hit: RetrievalHitView, weights: RetrievalRerankWeights, now = new Date()) {
  let score = 0;
  const validFrom = parseIsoDate(hit.documentMetadata.validFrom);
  const validUntil = parseIsoDate(hit.documentMetadata.validUntil);
  const supersededAt = parseIsoDate(hit.documentMetadata.supersededAt);

  if (validFrom && validFrom.getTime() > now.getTime()) {
    score += weights.futurePenalty;
  }
  if (validUntil && validUntil.getTime() < now.getTime()) {
    score += weights.expiredPenalty;
  }
  if (supersededAt) {
    score += weights.supersededPenalty;
  }

  const freshnessWindowMs = Math.max(1, weights.freshnessWindowDays) * 24 * 60 * 60 * 1000;
  const ageMs = Math.max(0, now.getTime() - hit.updatedAt.getTime());
  const freshnessRatio = Math.max(0, 1 - ageMs / freshnessWindowMs);
  if (freshnessRatio > 0) {
    score += freshnessRatio * weights.freshnessMaxBoost;
  }

  return score;
}

function readMetadataString(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

async function listDocumentVersionsForRetrieval(input: {
  db: Db;
  companyId: string;
  documentIds: string[];
}) {
  if (input.documentIds.length === 0) return new Map<string, RetrievalDocumentVersionView[]>();

  const rows = await input.db
    .select({
      documentId: knowledgeDocumentVersions.documentId,
      branchName: knowledgeDocumentVersions.branchName,
      defaultBranchName: knowledgeDocumentVersions.defaultBranchName,
      commitSha: knowledgeDocumentVersions.commitSha,
      parentCommitSha: knowledgeDocumentVersions.parentCommitSha,
      isHead: knowledgeDocumentVersions.isHead,
      isDefaultBranch: knowledgeDocumentVersions.isDefaultBranch,
      capturedAt: knowledgeDocumentVersions.capturedAt,
      metadata: knowledgeDocumentVersions.metadata,
    })
    .from(knowledgeDocumentVersions)
    .where(
      and(
        eq(knowledgeDocumentVersions.companyId, input.companyId),
        inArray(knowledgeDocumentVersions.documentId, input.documentIds),
      ),
    )
    .orderBy(desc(knowledgeDocumentVersions.capturedAt), desc(knowledgeDocumentVersions.updatedAt));

  const byDocumentId = new Map<string, RetrievalDocumentVersionView[]>();
  for (const row of rows) {
    const current = byDocumentId.get(row.documentId) ?? [];
    current.push({
      documentId: row.documentId,
      branchName: row.branchName,
      defaultBranchName: row.defaultBranchName,
      commitSha: row.commitSha,
      parentCommitSha: row.parentCommitSha,
      isHead: row.isHead,
      isDefaultBranch: row.isDefaultBranch,
      capturedAt: row.capturedAt,
      metadata: row.metadata ?? {},
    });
    byDocumentId.set(row.documentId, current);
  }
  return byDocumentId;
}

async function deriveRetrievalTemporalContext(input: {
  db: Db;
  companyId: string;
  issueId: string;
  issueProjectId: string | null;
  currentMessageSeq: number;
}) {
  const artifactRows = await input.db
    .select({
      kind: issueProtocolArtifacts.artifactKind,
      metadata: issueProtocolArtifacts.metadata,
      seq: issueProtocolMessages.seq,
    })
    .from(issueProtocolArtifacts)
    .innerJoin(issueProtocolMessages, eq(issueProtocolMessages.id, issueProtocolArtifacts.messageId))
    .where(
      and(
        eq(issueProtocolMessages.companyId, input.companyId),
        eq(issueProtocolMessages.issueId, input.issueId),
        sql`${issueProtocolMessages.seq} <= ${input.currentMessageSeq}`,
        or(
          eq(issueProtocolArtifacts.artifactKind, "diff"),
          eq(issueProtocolArtifacts.artifactKind, "doc"),
        ),
      ),
    )
    .orderBy(desc(issueProtocolMessages.seq));

  for (const row of artifactRows) {
    const metadata = row.metadata ?? {};
    const branchName = readMetadataString(metadata, "branchName");
    const headSha = readMetadataString(metadata, "headSha");
    const defaultBranchName = readMetadataString(metadata, "defaultBranchName");
    const bindingType = readMetadataString(metadata, "bindingType");

    if (row.kind === "diff" && (branchName || headSha)) {
      return {
        branchName,
        defaultBranchName: defaultBranchName ?? branchName,
        headSha,
        source: "artifact",
      } satisfies RetrievalTemporalContext;
    }
    if (row.kind === "doc" && bindingType === "implementation_workspace" && (branchName || headSha)) {
      return {
        branchName,
        defaultBranchName: defaultBranchName ?? branchName,
        headSha,
        source: "artifact",
      } satisfies RetrievalTemporalContext;
    }
  }

  const mergeCandidate = await input.db
    .select({
      sourceBranch: issueMergeCandidates.sourceBranch,
      headSha: issueMergeCandidates.headSha,
      targetBaseBranch: issueMergeCandidates.targetBaseBranch,
    })
    .from(issueMergeCandidates)
    .where(eq(issueMergeCandidates.issueId, input.issueId))
    .then((rows) => rows[0] ?? null);
  if (mergeCandidate && (mergeCandidate.sourceBranch || mergeCandidate.headSha)) {
    return {
      branchName: mergeCandidate.sourceBranch,
      defaultBranchName: mergeCandidate.targetBaseBranch,
      headSha: mergeCandidate.headSha,
      source: "merge_candidate",
    } satisfies RetrievalTemporalContext;
  }

  if (input.issueProjectId) {
    const defaultVersion = await input.db
      .select({
        branchName: knowledgeDocumentVersions.branchName,
        defaultBranchName: knowledgeDocumentVersions.defaultBranchName,
      })
      .from(knowledgeDocumentVersions)
      .where(
        and(
          eq(knowledgeDocumentVersions.companyId, input.companyId),
          eq(knowledgeDocumentVersions.projectId, input.issueProjectId),
          eq(knowledgeDocumentVersions.isDefaultBranch, true),
          eq(knowledgeDocumentVersions.isHead, true),
        ),
      )
      .orderBy(desc(knowledgeDocumentVersions.capturedAt))
      .limit(1)
      .then((rows) => rows[0] ?? null);
    if (defaultVersion) {
      return {
        branchName: null,
        defaultBranchName: defaultVersion.defaultBranchName ?? defaultVersion.branchName,
        headSha: null,
        source: "default_branch",
      } satisfies RetrievalTemporalContext;
    }
  }

  return null;
}

function computeTemporalBoost(input: {
  hit: RetrievalHitView;
  temporalContext: RetrievalTemporalContext | null;
  versions: RetrievalDocumentVersionView[];
  weights: RetrievalRerankWeights;
}) {
  if (!input.temporalContext || input.versions.length === 0) {
    return {
      score: 0,
      metadata: {
        branchName: null,
        defaultBranchName: input.temporalContext?.defaultBranchName ?? null,
        commitSha: null,
        matchType: "none",
        score: 0,
        stale: false,
      } satisfies NonNullable<RetrievalHitView["temporalMetadata"]>,
    };
  }

  const exactCommit = input.temporalContext.headSha
    ? input.versions.find((version) => version.commitSha === input.temporalContext?.headSha)
    : null;
  if (exactCommit) {
    return {
      score: input.weights.temporalExactCommitBoost,
      metadata: {
        branchName: exactCommit.branchName,
        defaultBranchName: exactCommit.defaultBranchName,
        commitSha: exactCommit.commitSha,
        matchType: "exact_commit",
        score: input.weights.temporalExactCommitBoost,
        stale: false,
      } satisfies NonNullable<RetrievalHitView["temporalMetadata"]>,
    };
  }

  const sameBranchVersions = input.temporalContext.branchName
    ? input.versions.filter((version) => version.branchName === input.temporalContext?.branchName)
    : [];
  const sameBranchHead = sameBranchVersions.find((version) => version.isHead);
  if (sameBranchHead) {
    return {
      score: input.weights.temporalSameBranchHeadBoost,
      metadata: {
        branchName: sameBranchHead.branchName,
        defaultBranchName: sameBranchHead.defaultBranchName,
        commitSha: sameBranchHead.commitSha,
        matchType: "same_branch_head",
        score: input.weights.temporalSameBranchHeadBoost,
        stale: false,
      } satisfies NonNullable<RetrievalHitView["temporalMetadata"]>,
    };
  }

  const sameBranchStale = sameBranchVersions[0] ?? null;
  if (sameBranchStale) {
    return {
      score: input.weights.temporalStalePenalty,
      metadata: {
        branchName: sameBranchStale.branchName,
        defaultBranchName: sameBranchStale.defaultBranchName,
        commitSha: sameBranchStale.commitSha,
        matchType: "same_branch_stale",
        score: input.weights.temporalStalePenalty,
        stale: true,
      } satisfies NonNullable<RetrievalHitView["temporalMetadata"]>,
    };
  }

  const defaultBranchHead = input.versions.find((version) =>
    version.isHead
    && (
      version.isDefaultBranch
      || (
        input.temporalContext?.defaultBranchName != null
        && version.branchName === input.temporalContext.defaultBranchName
      )
    ));
  if (defaultBranchHead) {
    return {
      score: input.weights.temporalDefaultBranchBoost,
      metadata: {
        branchName: defaultBranchHead.branchName,
        defaultBranchName: defaultBranchHead.defaultBranchName,
        commitSha: defaultBranchHead.commitSha,
        matchType: "default_branch_head",
        score: input.weights.temporalDefaultBranchBoost,
        stale: false,
      } satisfies NonNullable<RetrievalHitView["temporalMetadata"]>,
    };
  }

  const foreignBranch = input.versions[0] ?? null;
  if (foreignBranch) {
    return {
      score: input.weights.temporalForeignBranchPenalty,
      metadata: {
        branchName: foreignBranch.branchName,
        defaultBranchName: foreignBranch.defaultBranchName,
        commitSha: foreignBranch.commitSha,
        matchType: "foreign_branch",
        score: input.weights.temporalForeignBranchPenalty,
        stale: false,
      } satisfies NonNullable<RetrievalHitView["temporalMetadata"]>,
    };
  }

  return {
    score: 0,
    metadata: {
      branchName: null,
      defaultBranchName: input.temporalContext.defaultBranchName,
      commitSha: null,
      matchType: "none",
      score: 0,
      stale: false,
    } satisfies NonNullable<RetrievalHitView["temporalMetadata"]>,
  };
}

function computeLinkBoost(input: {
  hit: RetrievalHitView;
  links: RetrievalLinkView[];
  issueId: string;
  projectId: string | null;
  projectAffinityIds?: string[];
  signals: RetrievalSignals;
  weights: RetrievalRerankWeights;
}) {
  let score = 0;
  for (const link of input.links) {
    if (link.entityType === "issue" && link.entityId === input.issueId) {
      score += Math.max(input.weights.issueLinkMinBoost, link.weight * input.weights.issueLinkWeightMultiplier);
    }
    if (input.projectId && link.entityType === "project" && link.entityId === input.projectId) {
      score += Math.max(input.weights.projectLinkMinBoost, link.weight * input.weights.projectLinkWeightMultiplier);
    }
    if (
      link.entityType === "project"
      && (input.projectAffinityIds ?? []).includes(link.entityId)
    ) {
      score += Math.max(input.weights.projectLinkMinBoost, link.weight * input.weights.projectLinkWeightMultiplier);
    }
    if (link.entityType === "path" && input.signals.exactPaths.includes(normalizeHintPath(link.entityId))) {
      score += Math.max(input.weights.pathLinkMinBoost, link.weight * input.weights.pathLinkWeightMultiplier);
    }
  }
  return Math.min(input.weights.linkBoostCap, score);
}

export function rerankRetrievalHits(input: {
  hits: RetrievalHitView[];
  signals: RetrievalSignals;
  issueId: string;
  projectId: string | null;
  projectAffinityIds?: string[];
  linkMap?: Map<string, RetrievalLinkView[]>;
  temporalContext?: RetrievalTemporalContext | null;
  documentVersionMap?: Map<string, RetrievalDocumentVersionView[]>;
  finalK: number;
  rerankConfig?: RetrievalPolicyRerankConfig;
  personalizationProfile?: RetrievalPersonalizationProfile | null;
}) {
  const rerankConfig = input.rerankConfig ?? resolveRetrievalPolicyRerankConfig({
    allowedSourceTypes: input.signals.preferredSourceTypes,
  });
  return input.hits
    .map((hit) => {
      const temporal = computeTemporalBoost({
        hit,
        temporalContext: input.temporalContext ?? null,
        versions: input.documentVersionMap?.get(hit.documentId) ?? [],
        weights: rerankConfig.weights,
      });
      const rerankScore =
        computeSourceTypeBoost({
          sourceType: hit.sourceType,
          preferredSourceTypes: input.signals.preferredSourceTypes,
          rerankConfig,
        })
        + computePathBoost(hit.path, input.signals, rerankConfig.weights)
        + computeSymbolBoost(hit.symbolName, input.signals, rerankConfig.weights)
        + computeTagBoost(hit, input.signals, rerankConfig.weights)
        + computeLatestBoost(hit, rerankConfig.weights)
        + computeFreshnessBoost(hit, rerankConfig.weights)
        + temporal.score
        + computeLinkBoost({
          hit,
          links: input.linkMap?.get(hit.chunkId) ?? [],
          issueId: input.issueId,
          projectId: input.projectId,
          projectAffinityIds: input.projectAffinityIds ?? input.signals.projectAffinityIds,
          signals: input.signals,
          weights: rerankConfig.weights,
        });
      const personalization = computeRetrievalPersonalizationBoost({
        hit: {
          sourceType: hit.sourceType,
          path: hit.path,
          symbolName: hit.symbolName,
        },
        profile: input.personalizationProfile ?? null,
      });
      return {
        ...hit,
        temporalMetadata: temporal.metadata,
        personalizationMetadata: personalization.applied
          ? {
            totalBoost: personalization.totalBoost,
            sourceTypeBoost: personalization.sourceTypeBoost,
            pathBoost: personalization.pathBoost,
            symbolBoost: personalization.symbolBoost,
            scopes: personalization.scopes,
            matchedSourceType: personalization.matchedSourceType,
            matchedPath: personalization.matchedPath,
            matchedSymbol: personalization.matchedSymbol,
          }
          : null,
        rerankScore: rerankScore + personalization.totalBoost,
        fusedScore: hit.fusedScore + rerankScore + personalization.totalBoost,
      };
    })
    .sort((left, right) => {
      if (right.fusedScore !== left.fusedScore) return right.fusedScore - left.fusedScore;
      return right.updatedAt.getTime() - left.updatedAt.getTime();
    })
    .slice(0, input.finalK);
}

export function buildGraphExpansionSeeds(input: {
  hits: RetrievalHitView[];
  linkMap?: Map<string, RetrievalLinkView[]>;
  signals: RetrievalSignals;
  maxSeedHits?: number;
  maxSeeds?: number;
}) {
  const seedMap = new Map<string, RetrievalGraphSeed>();
  const crossProjectRequested = input.signals.projectAffinityIds.length > 1;
  const maxSeedHits = input.maxSeedHits ?? 4;
  const maxSeeds = input.maxSeeds ?? 8;

  const pushSeed = (seed: RetrievalGraphSeed) => {
    const key = `${seed.entityType}:${seed.entityId}`;
    const existing = seedMap.get(key);
    if (!existing) {
      seedMap.set(key, {
        ...seed,
        seedReasons: uniqueNonEmpty(seed.seedReasons),
      });
      return;
    }

    seedMap.set(key, {
      ...existing,
      seedBoost: Math.max(existing.seedBoost, seed.seedBoost),
      seedReasons: uniqueNonEmpty([...existing.seedReasons, ...seed.seedReasons]),
    });
  };

  for (const hit of input.hits.slice(0, maxSeedHits)) {
    if (hit.symbolName) {
      pushSeed({
        entityType: "symbol",
        entityId: hit.symbolName,
        seedBoost: 1.4,
        seedReasons: ["top_hit_symbol"],
      });
    }
    if (hit.path) {
      pushSeed({
        entityType: "path",
        entityId: normalizeHintPath(hit.path),
        seedBoost: 1.05,
        seedReasons: ["top_hit_path"],
      });
    }

    for (const link of input.linkMap?.get(hit.chunkId) ?? []) {
      if (link.entityType === "symbol") {
        pushSeed({
          entityType: "symbol",
          entityId: link.entityId,
          seedBoost: Math.max(1, link.weight + 0.45),
          seedReasons: ["linked_symbol"],
        });
      } else if (link.entityType === "path") {
        pushSeed({
          entityType: "path",
          entityId: normalizeHintPath(link.entityId),
          seedBoost: Math.max(0.8, link.weight),
          seedReasons: ["linked_path"],
        });
      } else if (link.entityType === "project" && crossProjectRequested) {
        pushSeed({
          entityType: "project",
          entityId: link.entityId,
          seedBoost: Math.max(0.55, link.weight * 0.6),
          seedReasons: ["project_affinity_link"],
        });
      }
    }
  }

  return Array.from(seedMap.values())
    .sort((left, right) => right.seedBoost - left.seedBoost)
    .slice(0, maxSeeds);
}

export function buildSymbolGraphExpansionSeeds(input: {
  hits: RetrievalHitView[];
  chunkSymbolMap: Map<string, RetrievalChunkSymbolView[]>;
  maxSeedHits?: number;
  maxSeeds?: number;
}) {
  const seedMap = new Map<string, RetrievalSymbolGraphSeed>();
  const maxSeedHits = input.maxSeedHits ?? 4;
  const maxSeeds = input.maxSeeds ?? 8;

  const pushSeed = (seed: RetrievalSymbolGraphSeed) => {
    const existing = seedMap.get(seed.symbolId);
    if (!existing) {
      seedMap.set(seed.symbolId, {
        ...seed,
        seedReasons: uniqueNonEmpty(seed.seedReasons),
      });
      return;
    }
    seedMap.set(seed.symbolId, {
      ...existing,
      seedBoost: Math.max(existing.seedBoost, seed.seedBoost),
      seedReasons: uniqueNonEmpty([...existing.seedReasons, ...seed.seedReasons]),
    });
  };

  for (const hit of input.hits.slice(0, maxSeedHits)) {
    for (const symbol of input.chunkSymbolMap.get(hit.chunkId) ?? []) {
      pushSeed({
        symbolId: symbol.symbolId,
        chunkId: symbol.chunkId,
        path: symbol.path,
        symbolName: symbol.symbolName,
        seedBoost: 1.2 + (hit.graphMetadata ? 0.25 : 0),
        seedReasons: [
          hit.graphMetadata ? "graph_expanded_symbol" : "top_hit_symbol_graph",
          hit.symbolName && hit.symbolName === symbol.symbolName ? "top_hit_symbol_match" : null,
        ].filter((value): value is string => value !== null),
      });
    }
  }

  return Array.from(seedMap.values())
    .sort((left, right) => right.seedBoost - left.seedBoost)
    .slice(0, maxSeeds);
}

export function mergeGraphExpandedHits(input: {
  baseHits: RetrievalHitView[];
  graphHits: RetrievalHitView[];
  finalK: number;
}) {
  const merged = new Map<string, RetrievalHitView>();

  for (const hit of input.baseHits) {
    merged.set(hit.chunkId, hit);
  }

  for (const hit of input.graphHits) {
    const existing = merged.get(hit.chunkId);
    if (!existing) {
      merged.set(hit.chunkId, hit);
      continue;
    }

    merged.set(hit.chunkId, {
      ...existing,
      fusedScore: Math.max(existing.fusedScore, hit.fusedScore),
      rerankScore: Math.max(existing.rerankScore ?? 0, hit.rerankScore ?? 0),
      graphMetadata: hit.graphMetadata || existing.graphMetadata
        ? {
          entityTypes: uniqueNonEmpty([...(existing.graphMetadata?.entityTypes ?? []), ...(hit.graphMetadata?.entityTypes ?? [])]),
          entityIds: uniqueNonEmpty([...(existing.graphMetadata?.entityIds ?? []), ...(hit.graphMetadata?.entityIds ?? [])]),
          seedReasons: uniqueNonEmpty([...(existing.graphMetadata?.seedReasons ?? []), ...(hit.graphMetadata?.seedReasons ?? [])]),
          graphScore: Math.max(existing.graphMetadata?.graphScore ?? 0, hit.graphMetadata?.graphScore ?? 0),
          edgeTypes: uniqueNonEmpty([...(existing.graphMetadata?.edgeTypes ?? []), ...(hit.graphMetadata?.edgeTypes ?? [])]),
        }
        : null,
    });
  }

  return Array.from(merged.values())
    .sort((left, right) => {
      if (right.fusedScore !== left.fusedScore) return right.fusedScore - left.fusedScore;
      return right.updatedAt.getTime() - left.updatedAt.getTime();
    })
    .slice(0, input.finalK);
}

export function buildSymbolGraphExpandedHits(input: {
  symbolSeeds: RetrievalSymbolGraphSeed[];
  edgeRows: Array<{
    fromSymbolId: string;
    toSymbolId: string;
    edgeType: string;
    weight: number;
  }>;
  targetSymbols: Array<{
    symbolId: string;
    chunkId: string;
    path: string;
    symbolName: string;
    documentId: string;
    sourceType: string;
    authorityLevel: string;
    documentIssueId: string | null;
    documentProjectId: string | null;
    title: string | null;
    headingPath: string | null;
    textContent: string;
    documentMetadata: Record<string, unknown>;
    chunkMetadata: Record<string, unknown>;
    updatedAt: Date;
  }>;
  limit: number;
  maxDepth: number;
}) {
  const seedById = new Map(input.symbolSeeds.map((seed) => [seed.symbolId, seed] as const));
  const targetById = new Map(input.targetSymbols.map((target) => [target.symbolId, target] as const));
  const adjacency = new Map<string, Array<{ targetId: string; edgeType: string; weight: number }>>();
  for (const row of input.edgeRows) {
    const forward = adjacency.get(row.fromSymbolId) ?? [];
    forward.push({
      targetId: row.toSymbolId,
      edgeType: row.edgeType,
      weight: row.weight,
    });
    adjacency.set(row.fromSymbolId, forward);

    const reverse = adjacency.get(row.toSymbolId) ?? [];
    reverse.push({
      targetId: row.fromSymbolId,
      edgeType: row.edgeType,
      weight: row.weight,
    });
    adjacency.set(row.toSymbolId, reverse);
  }

  const edgeTypeCounts: Record<string, number> = {};
  const bestBySymbol = new Map<string, {
    score: number;
    seedReasons: string[];
    edgeTypes: string[];
    depth: number;
  }>();
  let frontier = input.symbolSeeds.map((seed) => ({
    symbolId: seed.symbolId,
    score: seed.seedBoost,
    seedReasons: seed.seedReasons,
    edgeTypes: [] as string[],
    depth: 0,
  }));

  for (let depth = 1; depth <= input.maxDepth; depth += 1) {
    const nextBySymbol = new Map<string, {
      symbolId: string;
      score: number;
      seedReasons: string[];
      edgeTypes: string[];
      depth: number;
    }>();
    for (const current of frontier) {
      for (const edge of adjacency.get(current.symbolId) ?? []) {
        edgeTypeCounts[edge.edgeType] = (edgeTypeCounts[edge.edgeType] ?? 0) + 1;
        const edgeBoost = edge.edgeType === "tests" ? 1.25 : edge.edgeType === "imports" ? 0.92 : 0.8;
        const depthDecay = depth === 1 ? 1 : 0.72;
        const nextScore = Math.min(5.25, current.score + Math.max(0.18, edge.weight * edgeBoost) * depthDecay);
        const nextEntry = {
          symbolId: edge.targetId,
          score: nextScore,
          seedReasons: current.seedReasons,
          edgeTypes: uniqueNonEmpty([...current.edgeTypes, edge.edgeType]),
          depth,
        };
        const existingFrontier = nextBySymbol.get(edge.targetId);
        if (!existingFrontier || existingFrontier.score < nextScore) {
          nextBySymbol.set(edge.targetId, nextEntry);
        }
        if (seedById.has(edge.targetId)) continue;
        const existingBest = bestBySymbol.get(edge.targetId);
        if (!existingBest || existingBest.score < nextScore) {
          bestBySymbol.set(edge.targetId, {
            score: nextScore,
            seedReasons: nextEntry.seedReasons,
            edgeTypes: nextEntry.edgeTypes,
            depth,
          });
        }
      }
    }
    frontier = Array.from(nextBySymbol.values());
    if (frontier.length === 0) break;
  }

  const graphHopDepthCounts: Record<string, number> = {};
  const grouped = new Map<string, RetrievalHitView>();
  for (const [symbolId, expansion] of bestBySymbol.entries()) {
    const target = targetById.get(symbolId);
    if (!target) continue;
    graphHopDepthCounts[String(expansion.depth)] = (graphHopDepthCounts[String(expansion.depth)] ?? 0) + 1;
    const existing = grouped.get(target.chunkId);
    if (!existing) {
      grouped.set(target.chunkId, {
        chunkId: target.chunkId,
        documentId: target.documentId,
        sourceType: target.sourceType,
        authorityLevel: target.authorityLevel,
        documentIssueId: target.documentIssueId,
        documentProjectId: target.documentProjectId,
        path: target.path,
        title: target.title,
        headingPath: target.headingPath,
        symbolName: target.symbolName,
        textContent: target.textContent,
        documentMetadata: target.documentMetadata,
        chunkMetadata: target.chunkMetadata,
        denseScore: null,
        sparseScore: null,
        rerankScore: expansion.score,
        fusedScore: expansion.score,
        updatedAt: target.updatedAt,
        graphMetadata: {
          entityTypes: ["symbol"],
          entityIds: [target.symbolName],
          seedReasons: expansion.seedReasons,
          graphScore: expansion.score,
          edgeTypes: expansion.edgeTypes,
          hopDepth: expansion.depth,
        },
      });
      continue;
    }

    grouped.set(target.chunkId, {
      ...existing,
      fusedScore: Math.max(existing.fusedScore, expansion.score),
      rerankScore: Math.max(existing.rerankScore ?? 0, expansion.score),
      graphMetadata: {
        entityTypes: uniqueNonEmpty([...(existing.graphMetadata?.entityTypes ?? []), "symbol"]),
        entityIds: uniqueNonEmpty([...(existing.graphMetadata?.entityIds ?? []), target.symbolName]),
        seedReasons: uniqueNonEmpty([...(existing.graphMetadata?.seedReasons ?? []), ...expansion.seedReasons]),
        graphScore: Math.max(existing.graphMetadata?.graphScore ?? 0, expansion.score),
        edgeTypes: uniqueNonEmpty([...(existing.graphMetadata?.edgeTypes ?? []), ...expansion.edgeTypes]),
        hopDepth: Math.min(existing.graphMetadata?.hopDepth ?? expansion.depth, expansion.depth),
      },
    });
  }

  const hits = Array.from(grouped.values())
    .sort((left, right) => {
      if (right.fusedScore !== left.fusedScore) return right.fusedScore - left.fusedScore;
      return right.updatedAt.getTime() - left.updatedAt.getTime();
    })
    .slice(0, input.limit);

  return {
    hits,
    edgeTraversalCount: input.edgeRows.length,
    edgeTypeCounts,
    graphMaxDepth: hits.reduce((max, hit) => Math.max(max, hit.graphMetadata?.hopDepth ?? 1), 0),
    graphHopDepthCounts,
  };
}

export function applyModelRerankOrder(input: {
  hits: RetrievalHitView[];
  rankedChunkIds: string[];
  finalK: number;
  modelRerank: RetrievalPolicyRerankConfig["modelRerank"];
}) {
  if (input.rankedChunkIds.length === 0) return input.hits.slice(0, input.finalK);

  const rankByChunkId = new Map<string, number>();
  const maxBaseFusedScore = input.hits.reduce((max, hit) => Math.max(max, hit.fusedScore), 0);
  input.rankedChunkIds.forEach((chunkId, index) => {
    if (!rankByChunkId.has(chunkId)) rankByChunkId.set(chunkId, index);
  });

  return input.hits
    .map((hit) => {
      const rank = rankByChunkId.get(hit.chunkId);
      if (rank == null) return hit;
      const modelBoost = Math.max(0, input.modelRerank.baseBoost - rank * input.modelRerank.decay);
      const priorityScore =
        maxBaseFusedScore
        + input.modelRerank.baseBoost
        - rank * Math.max(0.01, input.modelRerank.decay);
      const fusedScore = Math.max(hit.fusedScore + modelBoost, priorityScore);
      return {
        ...hit,
        rerankScore: (hit.rerankScore ?? 0) + (fusedScore - hit.fusedScore),
        fusedScore,
        modelRerankRank: rank + 1,
      } satisfies RetrievalHitView;
    })
    .sort((left, right) => {
      const leftRank = rankByChunkId.get(left.chunkId);
      const rightRank = rankByChunkId.get(right.chunkId);
      if (leftRank != null || rightRank != null) {
        if (leftRank == null) return 1;
        if (rightRank == null) return -1;
        if (leftRank !== rightRank) return leftRank - rightRank;
      }
      if (right.fusedScore !== left.fusedScore) return right.fusedScore - left.fusedScore;
      return right.updatedAt.getTime() - left.updatedAt.getTime();
    })
    .slice(0, input.finalK);
}

function buildHitRationale(input: {
  hit: RetrievalHitView;
  issueId: string;
  projectId: string | null;
  projectAffinityIds?: string[];
  signals: RetrievalSignals;
}) {
  const reasons: string[] = [];
  if ((input.hit.sparseScore ?? 0) > 0) reasons.push("lexical_match");
  if ((input.hit.denseScore ?? 0) > 0) reasons.push("semantic_match");
  const scopeBoost = computeScopeBoost({
    hitIssueId: input.hit.documentIssueId,
    hitProjectId: input.hit.documentProjectId,
    issueId: input.issueId,
    projectId: input.projectId,
    projectAffinityIds: input.projectAffinityIds,
  });
  if (scopeBoost >= 2) reasons.push("issue_scoped");
  else if (scopeBoost >= 1) reasons.push("project_scoped");
  else if (scopeBoost > 0) reasons.push("project_affinity");
  if (computeAuthorityBoost(input.hit.authorityLevel) > 0) reasons.push("high_authority");
  if ((input.hit.rerankScore ?? 0) > 0) reasons.push("heuristic_rerank");
  if ((input.hit.modelRerankRank ?? 0) > 0) reasons.push("model_rerank");
  if (computePathBoost(input.hit.path, input.signals, DEFAULT_RETRIEVAL_RERANK_WEIGHTS) > 0) reasons.push("path_match");
  if (computeSymbolBoost(input.hit.symbolName, input.signals, DEFAULT_RETRIEVAL_RERANK_WEIGHTS) > 0) reasons.push("symbol_match");
  if (computeTagBoost(input.hit, input.signals, DEFAULT_RETRIEVAL_RERANK_WEIGHTS) > 0) reasons.push("tag_match");
  const freshnessBoost = computeFreshnessBoost(input.hit, DEFAULT_RETRIEVAL_RERANK_WEIGHTS);
  if (freshnessBoost > 0) reasons.push("fresh_content");
  if (freshnessBoost < 0) reasons.push("stale_or_invalid");
  for (const entityType of uniqueNonEmpty(input.hit.graphMetadata?.entityTypes ?? [])) {
    reasons.push(`graph_${entityType}_link`);
  }
  for (const edgeType of uniqueNonEmpty(input.hit.graphMetadata?.edgeTypes ?? [])) {
    reasons.push(`graph_edge_${edgeType}`);
  }
  if ((input.hit.personalizationMetadata?.sourceTypeBoost ?? 0) !== 0) reasons.push("personalized_source_type");
  if ((input.hit.personalizationMetadata?.pathBoost ?? 0) !== 0) reasons.push("personalized_path");
  if ((input.hit.personalizationMetadata?.symbolBoost ?? 0) !== 0) reasons.push("personalized_symbol");
  switch (input.hit.temporalMetadata?.matchType) {
    case "exact_commit":
      reasons.push("exact_commit_match");
      break;
    case "same_branch_head":
      reasons.push("same_branch_head");
      break;
    case "same_branch_stale":
      reasons.push("same_branch_stale");
      break;
    case "default_branch_head":
      reasons.push("default_branch_head");
      break;
    case "foreign_branch":
      reasons.push("foreign_branch_penalty");
      break;
    default:
      break;
  }
  return reasons.join(", ") || "ranked";
}

export function issueRetrievalService(db: Db) {
  const knowledge = knowledgeService(db);
  const embeddings = knowledgeEmbeddingService();
  const modelReranker = knowledgeRerankingService();
  const personalization = retrievalPersonalizationService(db);
  let vectorExtensionInstalledPromise: Promise<boolean> | null = null;

  async function hasDbVectorSupport() {
    if (!vectorExtensionInstalledPromise) {
      vectorExtensionInstalledPromise = db
        .execute<{ installed: boolean }>(sql`select exists (select 1 from pg_extension where extname = 'vector') as installed`)
        .then((rows) => Boolean(rows[0]?.installed ?? false))
        .catch(() => false);
    }
    return vectorExtensionInstalledPromise;
  }

  function formatVectorLiteral(values: number[]) {
    return `[${values.map((value) => Number(value).toString()).join(",")}]`;
  }

  async function querySparseKnowledge(input: {
    companyId: string;
    issueId: string;
    projectId: string | null;
    projectAffinityIds: string[];
    queryText: string;
    allowedSourceTypes: string[];
    allowedAuthorityLevels: string[];
    limit: number;
  }) {
    const tsQuery = sql`plainto_tsquery('simple', ${input.queryText})`;
    const sparseScore = sql<number>`ts_rank_cd(${knowledgeChunks.searchTsv}, ${tsQuery})`;
    const lexicalMatch = sql<boolean>`${knowledgeChunks.searchTsv} @@ ${tsQuery}`;
    const allScopedProjectIds = uniqueNonEmpty([
      input.projectId ?? "",
      ...input.projectAffinityIds,
    ]);
    const scopeMatch = allScopedProjectIds.length > 0
      ? or(eq(knowledgeDocuments.issueId, input.issueId), inArray(knowledgeDocuments.projectId, allScopedProjectIds))
      : eq(knowledgeDocuments.issueId, input.issueId);

    return db
      .select({
        chunkId: knowledgeChunks.id,
        documentId: knowledgeDocuments.id,
        sourceType: knowledgeDocuments.sourceType,
        authorityLevel: knowledgeDocuments.authorityLevel,
        documentIssueId: knowledgeDocuments.issueId,
        documentProjectId: knowledgeDocuments.projectId,
        path: knowledgeDocuments.path,
        title: knowledgeDocuments.title,
        headingPath: knowledgeChunks.headingPath,
        symbolName: knowledgeChunks.symbolName,
        textContent: knowledgeChunks.textContent,
        documentMetadata: knowledgeDocuments.metadata,
        chunkMetadata: knowledgeChunks.metadata,
        denseScore: sql<number | null>`null`,
        sparseScore,
        rerankScore: sql<number | null>`null`,
        updatedAt: knowledgeDocuments.updatedAt,
      })
      .from(knowledgeChunks)
      .innerJoin(knowledgeDocuments, eq(knowledgeChunks.documentId, knowledgeDocuments.id))
      .where(
        and(
          eq(knowledgeChunks.companyId, input.companyId),
          inArray(knowledgeDocuments.sourceType, input.allowedSourceTypes),
          inArray(knowledgeDocuments.authorityLevel, input.allowedAuthorityLevels),
          or(lexicalMatch, scopeMatch),
        ),
      )
      .orderBy(desc(sparseScore), desc(knowledgeDocuments.updatedAt))
      .limit(input.limit);
  }

  async function queryDenseKnowledge(input: {
    companyId: string;
    issueId: string;
    projectId: string | null;
    projectAffinityIds: string[];
    queryEmbedding: number[];
    allowedSourceTypes: string[];
    allowedAuthorityLevels: string[];
    limit: number;
  }) {
    const allScopedProjectIds = uniqueNonEmpty([
      input.projectId ?? "",
      ...input.projectAffinityIds,
    ]);
    if (await hasDbVectorSupport()) {
      try {
        const queryVectorLiteral = formatVectorLiteral(input.queryEmbedding);
        const queryVector = sql.raw(`${dbVectorLiteral(queryVectorLiteral)}::vector`);
        const embeddingVectorColumn = sql.raw(`"knowledge_chunks"."embedding_vector"`);
        const denseScore = sql<number>`1 - (${embeddingVectorColumn} <=> ${queryVector})`;
        const scopeRank = allScopedProjectIds.length > 0
          ? sql<number>`case
              when ${knowledgeDocuments.issueId} = ${input.issueId} then 2
              when ${knowledgeDocuments.projectId} = ${input.projectId} then 1
              when ${knowledgeDocuments.projectId} in ${sql`(${sql.join(allScopedProjectIds.map((value) => sql`${value}`), sql`, `)})`} then 0.75
              else 0
            end`
          : sql<number>`case when ${knowledgeDocuments.issueId} = ${input.issueId} then 1 else 0 end`;

        return db
          .select({
            chunkId: knowledgeChunks.id,
            documentId: knowledgeDocuments.id,
            sourceType: knowledgeDocuments.sourceType,
            authorityLevel: knowledgeDocuments.authorityLevel,
            documentIssueId: knowledgeDocuments.issueId,
            documentProjectId: knowledgeDocuments.projectId,
            path: knowledgeDocuments.path,
            title: knowledgeDocuments.title,
            headingPath: knowledgeChunks.headingPath,
            symbolName: knowledgeChunks.symbolName,
            textContent: knowledgeChunks.textContent,
            documentMetadata: knowledgeDocuments.metadata,
            chunkMetadata: knowledgeChunks.metadata,
            denseScore,
            sparseScore: sql<number | null>`null`,
            rerankScore: sql<number | null>`null`,
            updatedAt: knowledgeDocuments.updatedAt,
          })
          .from(knowledgeChunks)
          .innerJoin(knowledgeDocuments, eq(knowledgeChunks.documentId, knowledgeDocuments.id))
          .where(
            and(
              eq(knowledgeChunks.companyId, input.companyId),
              inArray(knowledgeDocuments.sourceType, input.allowedSourceTypes),
              inArray(knowledgeDocuments.authorityLevel, input.allowedAuthorityLevels),
              sql`${embeddingVectorColumn} is not null`,
            ),
          )
          .orderBy(desc(scopeRank), desc(denseScore), desc(knowledgeDocuments.updatedAt))
          .limit(input.limit);
      } catch {
        // Fall back to application-side cosine reranking when pgvector is unavailable at query time.
      }
    }

    const scopeRank = allScopedProjectIds.length > 0
      ? sql<number>`case
          when ${knowledgeDocuments.issueId} = ${input.issueId} then 2
          when ${knowledgeDocuments.projectId} = ${input.projectId} then 1
          when ${knowledgeDocuments.projectId} in ${sql`(${sql.join(allScopedProjectIds.map((value) => sql`${value}`), sql`, `)})`} then 0.75
          else 0
        end`
      : sql<number>`case when ${knowledgeDocuments.issueId} = ${input.issueId} then 1 else 0 end`;
    const candidateLimit = Math.max(input.limit * 20, 200);

    const rows = await db
      .select({
        chunkId: knowledgeChunks.id,
        documentId: knowledgeDocuments.id,
        sourceType: knowledgeDocuments.sourceType,
        authorityLevel: knowledgeDocuments.authorityLevel,
        documentIssueId: knowledgeDocuments.issueId,
        documentProjectId: knowledgeDocuments.projectId,
        path: knowledgeDocuments.path,
        title: knowledgeDocuments.title,
        headingPath: knowledgeChunks.headingPath,
        symbolName: knowledgeChunks.symbolName,
        textContent: knowledgeChunks.textContent,
        embedding: knowledgeChunks.embedding,
        documentMetadata: knowledgeDocuments.metadata,
        chunkMetadata: knowledgeChunks.metadata,
        updatedAt: knowledgeDocuments.updatedAt,
      })
      .from(knowledgeChunks)
      .innerJoin(knowledgeDocuments, eq(knowledgeChunks.documentId, knowledgeDocuments.id))
      .where(
        and(
          eq(knowledgeChunks.companyId, input.companyId),
          inArray(knowledgeDocuments.sourceType, input.allowedSourceTypes),
          inArray(knowledgeDocuments.authorityLevel, input.allowedAuthorityLevels),
        ),
      )
      .orderBy(desc(scopeRank), desc(knowledgeDocuments.updatedAt))
      .limit(candidateLimit);

    return rows
      .map((row) => {
        const denseScore = computeCosineSimilarity(input.queryEmbedding, row.embedding);
        return {
          chunkId: row.chunkId,
          documentId: row.documentId,
          sourceType: row.sourceType,
          authorityLevel: row.authorityLevel,
          documentIssueId: row.documentIssueId,
          documentProjectId: row.documentProjectId,
          path: row.path,
          title: row.title,
          headingPath: row.headingPath,
          symbolName: row.symbolName,
          textContent: row.textContent,
          documentMetadata: row.documentMetadata,
          chunkMetadata: row.chunkMetadata,
          denseScore,
          sparseScore: null,
          rerankScore: null,
          updatedAt: row.updatedAt,
        };
      })
      .filter((row) => row.denseScore > 0)
      .sort((left, right) => {
        const scoreDelta = (right.denseScore ?? 0) - (left.denseScore ?? 0);
        if (scoreDelta !== 0) return scoreDelta;
        return right.updatedAt.getTime() - left.updatedAt.getTime();
      })
      .slice(0, input.limit);
  }

  async function queryPathKnowledge(input: {
    companyId: string;
    exactPaths: string[];
    allowedSourceTypes: string[];
    allowedAuthorityLevels: string[];
    limit: number;
  }) {
    if (input.exactPaths.length === 0) return [];

    return db
      .select({
        chunkId: knowledgeChunks.id,
        documentId: knowledgeDocuments.id,
        sourceType: knowledgeDocuments.sourceType,
        authorityLevel: knowledgeDocuments.authorityLevel,
        documentIssueId: knowledgeDocuments.issueId,
        documentProjectId: knowledgeDocuments.projectId,
        path: knowledgeDocuments.path,
        title: knowledgeDocuments.title,
        headingPath: knowledgeChunks.headingPath,
        symbolName: knowledgeChunks.symbolName,
        textContent: knowledgeChunks.textContent,
        documentMetadata: knowledgeDocuments.metadata,
        chunkMetadata: knowledgeChunks.metadata,
        denseScore: sql<number | null>`null`,
        sparseScore: sql<number | null>`null`,
        rerankScore: sql<number | null>`null`,
        updatedAt: knowledgeDocuments.updatedAt,
      })
      .from(knowledgeChunks)
      .innerJoin(knowledgeDocuments, eq(knowledgeChunks.documentId, knowledgeDocuments.id))
      .where(
        and(
          eq(knowledgeChunks.companyId, input.companyId),
          inArray(knowledgeDocuments.sourceType, input.allowedSourceTypes),
          inArray(knowledgeDocuments.authorityLevel, input.allowedAuthorityLevels),
          inArray(knowledgeDocuments.path, input.exactPaths),
        ),
      )
      .orderBy(desc(knowledgeDocuments.updatedAt))
      .limit(input.limit);
  }

  async function querySymbolKnowledge(input: {
    companyId: string;
    symbolHints: string[];
    allowedSourceTypes: string[];
    allowedAuthorityLevels: string[];
    limit: number;
  }) {
    if (input.symbolHints.length === 0) return [];

    return db
      .select({
        chunkId: knowledgeChunks.id,
        documentId: knowledgeDocuments.id,
        sourceType: knowledgeDocuments.sourceType,
        authorityLevel: knowledgeDocuments.authorityLevel,
        documentIssueId: knowledgeDocuments.issueId,
        documentProjectId: knowledgeDocuments.projectId,
        path: knowledgeDocuments.path,
        title: knowledgeDocuments.title,
        headingPath: knowledgeChunks.headingPath,
        symbolName: knowledgeChunks.symbolName,
        textContent: knowledgeChunks.textContent,
        documentMetadata: knowledgeDocuments.metadata,
        chunkMetadata: knowledgeChunks.metadata,
        denseScore: sql<number | null>`null`,
        sparseScore: sql<number | null>`null`,
        rerankScore: sql<number | null>`null`,
        updatedAt: knowledgeDocuments.updatedAt,
      })
      .from(knowledgeChunks)
      .innerJoin(knowledgeDocuments, eq(knowledgeChunks.documentId, knowledgeDocuments.id))
      .where(
        and(
          eq(knowledgeChunks.companyId, input.companyId),
          inArray(knowledgeDocuments.sourceType, input.allowedSourceTypes),
          inArray(knowledgeDocuments.authorityLevel, input.allowedAuthorityLevels),
          inArray(knowledgeChunks.symbolName, input.symbolHints),
        ),
      )
      .orderBy(desc(knowledgeDocuments.updatedAt))
      .limit(input.limit);
  }

  async function listRetrievalLinks(chunkIds: string[]) {
    if (chunkIds.length === 0) return new Map<string, RetrievalLinkView[]>();
    const rows = await db
      .select({
        chunkId: knowledgeChunkLinks.chunkId,
        entityType: knowledgeChunkLinks.entityType,
        entityId: knowledgeChunkLinks.entityId,
        linkReason: knowledgeChunkLinks.linkReason,
        weight: knowledgeChunkLinks.weight,
      })
      .from(knowledgeChunkLinks)
      .where(inArray(knowledgeChunkLinks.chunkId, chunkIds));

    const linkMap = new Map<string, RetrievalLinkView[]>();
    for (const row of rows) {
      const current = linkMap.get(row.chunkId) ?? [];
      current.push(row);
      linkMap.set(row.chunkId, current);
    }
    return linkMap;
  }

  async function listChunkSymbols(chunkIds: string[]) {
    if (chunkIds.length === 0) return new Map<string, RetrievalChunkSymbolView[]>();
    const rows = await db
      .select({
        symbolId: codeSymbols.id,
        chunkId: codeSymbols.chunkId,
        path: codeSymbols.path,
        symbolKey: codeSymbols.symbolKey,
        symbolName: codeSymbols.symbolName,
        symbolKind: codeSymbols.symbolKind,
        metadata: codeSymbols.metadata,
      })
      .from(codeSymbols)
      .where(inArray(codeSymbols.chunkId, chunkIds));

    const symbolMap = new Map<string, RetrievalChunkSymbolView[]>();
    for (const row of rows) {
      const current = symbolMap.get(row.chunkId) ?? [];
      current.push(row);
      symbolMap.set(row.chunkId, current);
    }
    return symbolMap;
  }

  async function queryGraphExpansionKnowledge(input: {
    companyId: string;
    issueId: string;
    projectId: string | null;
    projectAffinityIds: string[];
    seeds: RetrievalGraphSeed[];
    allowedSourceTypes: string[];
    allowedAuthorityLevels: string[];
    excludeChunkIds: string[];
    limit: number;
  }) {
    if (input.seeds.length === 0) return [];

    const seedByKey = new Map<string, RetrievalGraphSeed>(
      input.seeds.map((seed) => [`${seed.entityType}:${seed.entityId}`, seed] as const),
    );
    const pairConditions = input.seeds.map((seed) =>
      and(
        eq(knowledgeChunkLinks.entityType, seed.entityType),
        eq(knowledgeChunkLinks.entityId, seed.entityId),
      ),
    );
    const conditions = [
      eq(knowledgeChunkLinks.companyId, input.companyId),
      inArray(knowledgeDocuments.sourceType, input.allowedSourceTypes),
      inArray(knowledgeDocuments.authorityLevel, input.allowedAuthorityLevels),
      or(...pairConditions),
    ];
    if (input.excludeChunkIds.length > 0) {
      conditions.push(not(inArray(knowledgeChunks.id, input.excludeChunkIds)));
    }

    const rows = await db
      .select({
        chunkId: knowledgeChunks.id,
        documentId: knowledgeDocuments.id,
        sourceType: knowledgeDocuments.sourceType,
        authorityLevel: knowledgeDocuments.authorityLevel,
        documentIssueId: knowledgeDocuments.issueId,
        documentProjectId: knowledgeDocuments.projectId,
        path: knowledgeDocuments.path,
        title: knowledgeDocuments.title,
        headingPath: knowledgeChunks.headingPath,
        symbolName: knowledgeChunks.symbolName,
        textContent: knowledgeChunks.textContent,
        documentMetadata: knowledgeDocuments.metadata,
        chunkMetadata: knowledgeChunks.metadata,
        updatedAt: knowledgeDocuments.updatedAt,
        entityType: knowledgeChunkLinks.entityType,
        entityId: knowledgeChunkLinks.entityId,
        linkReason: knowledgeChunkLinks.linkReason,
        linkWeight: knowledgeChunkLinks.weight,
      })
      .from(knowledgeChunkLinks)
      .innerJoin(knowledgeChunks, eq(knowledgeChunkLinks.chunkId, knowledgeChunks.id))
      .innerJoin(knowledgeDocuments, eq(knowledgeChunks.documentId, knowledgeDocuments.id))
      .where(and(...conditions))
      .orderBy(desc(knowledgeChunkLinks.weight), desc(knowledgeDocuments.updatedAt))
      .limit(Math.max(input.limit * 10, 60));

    const grouped = new Map<string, RetrievalHitView>();
    for (const row of rows) {
      const seed = seedByKey.get(`${row.entityType}:${row.entityId}`);
      if (!seed) continue;

      const existing = grouped.get(row.chunkId);
      const graphScore = Math.min(4, seed.seedBoost + Math.max(0.2, row.linkWeight * 0.6));
      if (!existing) {
        grouped.set(row.chunkId, {
          chunkId: row.chunkId,
          documentId: row.documentId,
          sourceType: row.sourceType,
          authorityLevel: row.authorityLevel,
          documentIssueId: row.documentIssueId,
          documentProjectId: row.documentProjectId,
          path: row.path,
          title: row.title,
          headingPath: row.headingPath,
          symbolName: row.symbolName,
          textContent: row.textContent,
          documentMetadata: row.documentMetadata,
          chunkMetadata: row.chunkMetadata,
          denseScore: null,
          sparseScore: null,
          rerankScore: graphScore,
          fusedScore:
            graphScore
            + computeScopeBoost({
              hitIssueId: row.documentIssueId,
              hitProjectId: row.documentProjectId,
              issueId: input.issueId,
              projectId: input.projectId,
              projectAffinityIds: input.projectAffinityIds,
            })
            + computeAuthorityBoost(row.authorityLevel),
          updatedAt: row.updatedAt,
          graphMetadata: {
            entityTypes: [row.entityType],
            entityIds: [row.entityId],
            seedReasons: uniqueNonEmpty([...seed.seedReasons, row.linkReason]),
            graphScore,
          },
        });
        continue;
      }

      const nextGraphScore = Math.min(4, (existing.graphMetadata?.graphScore ?? 0) + graphScore);
      grouped.set(row.chunkId, {
        ...existing,
        rerankScore: Math.max(existing.rerankScore ?? 0, nextGraphScore),
        fusedScore: Math.max(existing.fusedScore, existing.fusedScore + graphScore * 0.25),
        graphMetadata: {
          entityTypes: uniqueNonEmpty([...(existing.graphMetadata?.entityTypes ?? []), row.entityType]),
          entityIds: uniqueNonEmpty([...(existing.graphMetadata?.entityIds ?? []), row.entityId]),
          seedReasons: uniqueNonEmpty([...(existing.graphMetadata?.seedReasons ?? []), ...seed.seedReasons, row.linkReason]),
          graphScore: nextGraphScore,
        },
      });
    }

    return Array.from(grouped.values())
      .sort((left, right) => {
        if (right.fusedScore !== left.fusedScore) return right.fusedScore - left.fusedScore;
        return right.updatedAt.getTime() - left.updatedAt.getTime();
      })
      .slice(0, input.limit);
  }

  async function querySymbolGraphExpansionKnowledge(input: {
    companyId: string;
    symbolSeeds: RetrievalSymbolGraphSeed[];
    excludeChunkIds: string[];
    allowedSourceTypes: string[];
    allowedAuthorityLevels: string[];
    limit: number;
  }) {
    if (input.symbolSeeds.length === 0) {
      return {
        hits: [] as RetrievalHitView[],
        edgeTraversalCount: 0,
        edgeTypeCounts: {} as Record<string, number>,
        graphMaxDepth: 0,
        graphHopDepthCounts: {} as Record<string, number>,
      };
    }

    const seedById = new Map(input.symbolSeeds.map((seed) => [seed.symbolId, seed] as const));
    const seedIds = input.symbolSeeds.map((seed) => seed.symbolId);

    const firstHopEdges = await db
      .select({
        fromSymbolId: codeSymbolEdges.fromSymbolId,
        toSymbolId: codeSymbolEdges.toSymbolId,
        edgeType: codeSymbolEdges.edgeType,
        weight: codeSymbolEdges.weight,
      })
      .from(codeSymbolEdges)
      .where(and(
        eq(codeSymbolEdges.companyId, input.companyId),
        or(
          inArray(codeSymbolEdges.fromSymbolId, seedIds),
          inArray(codeSymbolEdges.toSymbolId, seedIds),
        ),
      ))
      .orderBy(desc(codeSymbolEdges.weight))
      .limit(Math.max(input.limit * 12, 96));

    if (firstHopEdges.length === 0) {
      return {
        hits: [] as RetrievalHitView[],
        edgeTraversalCount: 0,
        edgeTypeCounts: {} as Record<string, number>,
        graphMaxDepth: 0,
        graphHopDepthCounts: {} as Record<string, number>,
      };
    }

    const firstHopIds = Array.from(new Set(
      firstHopEdges.map((row) => (seedById.has(row.fromSymbolId) ? row.toSymbolId : row.fromSymbolId)),
    ));
    const secondHopEdges = firstHopIds.length === 0
      ? []
      : await db
        .select({
          fromSymbolId: codeSymbolEdges.fromSymbolId,
          toSymbolId: codeSymbolEdges.toSymbolId,
          edgeType: codeSymbolEdges.edgeType,
          weight: codeSymbolEdges.weight,
        })
        .from(codeSymbolEdges)
        .where(and(
          eq(codeSymbolEdges.companyId, input.companyId),
          or(
            inArray(codeSymbolEdges.fromSymbolId, firstHopIds),
            inArray(codeSymbolEdges.toSymbolId, firstHopIds),
          ),
        ))
        .orderBy(desc(codeSymbolEdges.weight))
        .limit(Math.max(input.limit * 16, 128));
    const edgeRows = [...firstHopEdges, ...secondHopEdges];
    const targetSymbolIds = Array.from(new Set(
      edgeRows
        .flatMap((row) => [row.fromSymbolId, row.toSymbolId])
        .filter((symbolId) => !seedById.has(symbolId)),
    ));
    const targetSymbols = targetSymbolIds.length === 0
      ? []
      : await db
        .select({
          symbolId: codeSymbols.id,
          chunkId: codeSymbols.chunkId,
          path: codeSymbols.path,
          symbolKey: codeSymbols.symbolKey,
          symbolName: codeSymbols.symbolName,
          symbolKind: codeSymbols.symbolKind,
          metadata: codeSymbols.metadata,
          documentId: knowledgeDocuments.id,
          sourceType: knowledgeDocuments.sourceType,
          authorityLevel: knowledgeDocuments.authorityLevel,
          documentIssueId: knowledgeDocuments.issueId,
          documentProjectId: knowledgeDocuments.projectId,
          title: knowledgeDocuments.title,
          headingPath: knowledgeChunks.headingPath,
          textContent: knowledgeChunks.textContent,
          documentMetadata: knowledgeDocuments.metadata,
          chunkMetadata: knowledgeChunks.metadata,
          updatedAt: knowledgeDocuments.updatedAt,
        })
        .from(codeSymbols)
        .innerJoin(knowledgeChunks, eq(codeSymbols.chunkId, knowledgeChunks.id))
        .innerJoin(knowledgeDocuments, eq(knowledgeChunks.documentId, knowledgeDocuments.id))
        .where(and(
          inArray(codeSymbols.id, targetSymbolIds),
          inArray(knowledgeDocuments.sourceType, input.allowedSourceTypes),
          inArray(knowledgeDocuments.authorityLevel, input.allowedAuthorityLevels),
          ...(input.excludeChunkIds.length > 0 ? [not(inArray(knowledgeChunks.id, input.excludeChunkIds))] : []),
        ));

    return buildSymbolGraphExpandedHits({
      symbolSeeds: input.symbolSeeds,
      edgeRows,
      targetSymbols,
      limit: input.limit,
      maxDepth: 2,
    });
  }

  return {
    handleProtocolMessage: async (input: {
      companyId: string;
      issueId: string;
      issue: IssueRetrievalIssueSnapshot;
      triggeringMessageId: string;
      triggeringMessageSeq: number;
      message: CreateIssueProtocolMessage;
      actor: {
        actorType: "agent" | "user" | "system";
        actorId: string;
      };
    }) => {
      console.log("[RETRIEVAL] Starting retrieval for message:", {
        messageType: input.message.messageType,
        issueId: input.issueId,
        recipientCount: input.message.recipients.length,
      });

      const eventType = deriveRetrievalEventType(input.message.messageType);
      if (!eventType) {
        console.log("[RETRIEVAL] No event type mapped for message type:", input.message.messageType);
        return {
          eventType: null,
          recipientHints: [] as RecipientRetrievalHint[],
          retrievalRuns: [],
        };
      }

      console.log("[RETRIEVAL] Event type derived:", eventType);

      const uniqueRecipients = selectProtocolRetrievalRecipients({
        messageType: input.message.messageType,
        recipients: input.message.recipients,
      });

      const recipientHints: RecipientRetrievalHint[] = [];
      const retrievalRuns: Array<{ retrievalRunId: string; briefId: string; recipientRole: string; recipientId: string }> = [];

      console.log("[RETRIEVAL] Processing recipients:", {
        count: uniqueRecipients.length,
        roles: uniqueRecipients.map(r => r.role),
      });

      for (const recipient of uniqueRecipients) {
        console.log("[RETRIEVAL] Processing recipient:", {
          role: recipient.role,
          recipientId: recipient.recipientId,
        });
        const policy =
          await knowledge.getRetrievalPolicy({
            companyId: input.companyId,
            role: recipient.role,
            eventType,
            workflowState: input.message.workflowStateAfter,
          })
          ?? await knowledge.upsertRetrievalPolicy({
            companyId: input.companyId,
            ...defaultPolicyTemplate({
              role: recipient.role as RetrievalTargetRole,
              eventType,
              workflowState: input.message.workflowStateAfter,
            }),
          });
        const rerankConfig = resolveRetrievalPolicyRerankConfig({
          allowedSourceTypes: policy.allowedSourceTypes,
          metadata: policy.metadata,
        });
        const personalizationProfile = await personalization.loadProfile({
          companyId: input.companyId,
          projectId: input.issue.projectId,
          role: recipient.role,
          eventType,
        });

        const queryText = buildRetrievalQueryText({
          issue: input.issue,
          message: input.message,
          recipientRole: recipient.role,
        });

        console.log("[RETRIEVAL] Query generated:", {
          role: recipient.role,
          queryLength: queryText.length,
          queryPreview: queryText.substring(0, 100),
        });
        const dynamicSignals = deriveDynamicRetrievalSignals({
          message: input.message,
          issue: input.issue,
          recipientRole: recipient.role,
          eventType,
          baselineSourceTypes: rerankConfig.preferredSourceTypes,
        });
        const temporalContext = await deriveRetrievalTemporalContext({
          db,
          companyId: input.companyId,
          issueId: input.issueId,
          issueProjectId: input.issue.projectId,
          currentMessageSeq: input.triggeringMessageSeq,
        });

        let queryEmbedding: number[] | null = null;
        let queryEmbeddingDebug: Record<string, unknown> = {
          denseEnabled: false,
          embeddingCacheHit: false,
        };
        try {
          const providerInfo = embeddings.getProviderInfo();
          if (providerInfo.available) {
            const embeddingFingerprint = embeddings.fingerprint();
            const cacheKey = embeddingFingerprint
              ? buildQueryEmbeddingCacheKey({
                queryText,
                embeddingFingerprint,
              })
              : null;
            const cachedEmbedding = cacheKey
              ? readCachedEmbedding(
                (await knowledge.getRetrievalCacheEntry({
                  companyId: input.companyId,
                  projectId: input.issue.projectId,
                  stage: "query_embedding",
                  cacheKey,
                  knowledgeRevision: 0,
                }))?.valueJson,
              )
              : null;

            if (cachedEmbedding) {
              queryEmbedding = cachedEmbedding.embedding;
              queryEmbeddingDebug = {
                denseEnabled: true,
                embeddingProvider: cachedEmbedding.provider,
                embeddingModel: cachedEmbedding.model,
                embeddingDimensions: cachedEmbedding.dimensions,
                embeddingTotalTokens: cachedEmbedding.totalTokens,
                embeddingCacheHit: true,
                embeddingCacheKey: cacheKey,
              };
            } else {
              const embeddingResult = await embeddings.generateEmbeddings([queryText]);
              queryEmbedding = embeddingResult.embeddings[0] ?? null;
              queryEmbeddingDebug = {
                denseEnabled: Boolean(queryEmbedding),
                embeddingProvider: embeddingResult.provider,
                embeddingModel: embeddingResult.model,
                embeddingDimensions: embeddingResult.dimensions,
                embeddingTotalTokens: embeddingResult.usage.totalTokens,
                embeddingCacheHit: false,
                embeddingCacheKey: cacheKey,
              };

              if (cacheKey && queryEmbedding) {
                await knowledge.upsertRetrievalCacheEntry({
                  companyId: input.companyId,
                  projectId: input.issue.projectId,
                  stage: "query_embedding",
                  cacheKey,
                  knowledgeRevision: 0,
                  ttlSeconds: QUERY_EMBEDDING_CACHE_TTL_SECONDS,
                  valueJson: {
                    embedding: queryEmbedding,
                    provider: embeddingResult.provider,
                    model: embeddingResult.model,
                    dimensions: embeddingResult.dimensions,
                    totalTokens: embeddingResult.usage.totalTokens,
                  },
                });
              }
            }
          } else {
            // CRITICAL: Embedding provider not configured
            console.error(
              "[RETRIEVAL] Embedding provider not available. Dense search disabled. " +
              "Set OPENAI_API_KEY or SQUADRAIL_KNOWLEDGE_OPENAI_API_KEY environment variable."
            );
          }
        } catch (err) {
          // CRITICAL: Embedding generation failed
          console.error(
            "[RETRIEVAL] Embedding generation failed:",
            err instanceof Error ? err.message : String(err)
          );
          queryEmbeddingDebug = {
            denseEnabled: false,
            embeddingError: err instanceof Error ? err.message : String(err),
          };
        }

        const retrievalRun = await knowledge.createRetrievalRun({
          companyId: input.companyId,
          issueId: input.issueId,
          triggeringMessageId: input.triggeringMessageId,
          actorType: recipient.recipientType === "agent" ? "agent" : "user",
          actorId: recipient.recipientId,
          actorRole: recipient.role,
          eventType,
          workflowState: input.message.workflowStateAfter,
          policyId: policy.id,
          queryText,
          queryDebug: {
            messageType: input.message.messageType,
            summary: input.message.summary,
            recipientRole: recipient.role,
            issueProjectId: input.issue.projectId,
            mentionedProjectIds: (input.issue.mentionedProjects ?? []).map((project) => project.id),
            mentionedProjectNames: (input.issue.mentionedProjects ?? []).map((project) => project.name),
            projectAffinityIds: dynamicSignals.projectAffinityIds,
            exactPathCount: dynamicSignals.exactPaths.length,
            symbolHintCount: dynamicSignals.symbolHints.length,
            preferredSourceTypes: dynamicSignals.preferredSourceTypes,
            policySourcePreferences: rerankConfig.preferredSourceTypes,
            modelRerankEnabled: rerankConfig.modelRerank.enabled,
            graphSeedCount: 0,
            graphSeedTypes: [],
            symbolGraphSeedCount: 0,
            symbolGraphHitCount: 0,
            edgeTraversalCount: 0,
            edgeTypeCounts: {},
            graphMaxDepth: 0,
            graphHopDepthCounts: {},
            multiHopGraphHitCount: 0,
            temporalContext,
            cache: {
              embeddingHit: queryEmbeddingDebug.embeddingCacheHit === true,
            },
            personalization: {
              applied: personalizationProfile.applied,
              scopes: personalizationProfile.scopes,
              feedbackCount: personalizationProfile.feedbackCount,
              positiveFeedbackCount: personalizationProfile.positiveFeedbackCount,
              negativeFeedbackCount: personalizationProfile.negativeFeedbackCount,
              sourceTypeKeyCount: Object.keys(personalizationProfile.sourceTypeBoosts).length,
              pathKeyCount: Object.keys(personalizationProfile.pathBoosts).length,
              symbolKeyCount: Object.keys(personalizationProfile.symbolBoosts).length,
            },
            ...queryEmbeddingDebug,
          },
        });

        // Parallelize all knowledge queries to reduce latency (80-300ms -> 50-200ms)
        const [sparseHits, pathHits, symbolHits, denseHits] = await Promise.all([
          querySparseKnowledge({
            companyId: input.companyId,
            issueId: input.issueId,
            projectId: input.issue.projectId,
            projectAffinityIds: dynamicSignals.projectAffinityIds,
            queryText,
            allowedSourceTypes: policy.allowedSourceTypes,
            allowedAuthorityLevels: policy.allowedAuthorityLevels,
            limit: policy.topKSparse,
          }),
          queryPathKnowledge({
            companyId: input.companyId,
            exactPaths: dynamicSignals.exactPaths,
            allowedSourceTypes: policy.allowedSourceTypes,
            allowedAuthorityLevels: policy.allowedAuthorityLevels,
            limit: Math.min(policy.rerankK, Math.max(dynamicSignals.exactPaths.length * 2, 6)),
          }),
          querySymbolKnowledge({
            companyId: input.companyId,
            symbolHints: dynamicSignals.symbolHints,
            allowedSourceTypes: policy.allowedSourceTypes,
            allowedAuthorityLevels: policy.allowedAuthorityLevels,
            limit: Math.min(policy.rerankK, Math.max(dynamicSignals.symbolHints.length, 6)),
          }),
          queryEmbedding
            ? queryDenseKnowledge({
              companyId: input.companyId,
              issueId: input.issueId,
              projectId: input.issue.projectId,
              projectAffinityIds: dynamicSignals.projectAffinityIds,
              queryEmbedding,
              allowedSourceTypes: policy.allowedSourceTypes,
              allowedAuthorityLevels: policy.allowedAuthorityLevels,
              limit: policy.topKDense,
            })
            : Promise.resolve([]),
        ]);

        console.log("[RETRIEVAL] Sparse hits:", sparseHits.length);
        console.log("[RETRIEVAL] Path hits:", pathHits.length);
        console.log("[RETRIEVAL] Symbol hits:", symbolHits.length);
        console.log("[RETRIEVAL] Dense hits:", denseHits.length);

        const hits = fuseRetrievalCandidates({
          sparseHits: [...sparseHits, ...pathHits, ...symbolHits],
          denseHits,
          issueId: input.issueId,
          projectId: input.issue.projectId,
          projectAffinityIds: dynamicSignals.projectAffinityIds,
          finalK: Math.max(policy.rerankK, policy.finalK),
        });
        console.log("[RETRIEVAL] Fused candidates:", hits.length);
        const linkMap = await listRetrievalLinks(hits.map((hit) => hit.chunkId));
        const initialDocumentVersionMap = await listDocumentVersionsForRetrieval({
          db,
          companyId: input.companyId,
          documentIds: uniqueNonEmpty(hits.map((hit) => hit.documentId)),
        });
        const initialRerankedHits = rerankRetrievalHits({
          hits,
          signals: dynamicSignals,
          issueId: input.issueId,
          projectId: input.issue.projectId,
          projectAffinityIds: dynamicSignals.projectAffinityIds,
          linkMap,
          temporalContext,
          documentVersionMap: initialDocumentVersionMap,
          finalK: policy.finalK,
          rerankConfig,
          personalizationProfile,
        });
        const graphSeeds = buildGraphExpansionSeeds({
          hits: initialRerankedHits,
          linkMap,
          signals: dynamicSignals,
        });
        const legacyGraphHits = await queryGraphExpansionKnowledge({
          companyId: input.companyId,
          issueId: input.issueId,
          projectId: input.issue.projectId,
          projectAffinityIds: dynamicSignals.projectAffinityIds,
          seeds: graphSeeds,
          allowedSourceTypes: policy.allowedSourceTypes,
          allowedAuthorityLevels: policy.allowedAuthorityLevels,
          excludeChunkIds: hits.map((hit) => hit.chunkId),
          limit: Math.min(Math.max(policy.finalK, 6), Math.max(graphSeeds.length * 2, 6)),
        });
        const graphLinkMap = legacyGraphHits.length > 0
          ? await listRetrievalLinks(legacyGraphHits.map((hit) => hit.chunkId))
          : new Map<string, RetrievalLinkView[]>();
        const combinedLinkMap = new Map(linkMap);
        for (const [chunkId, links] of graphLinkMap.entries()) {
          combinedLinkMap.set(chunkId, links);
        }
        const rerankedHits = legacyGraphHits.length > 0
          ? rerankRetrievalHits({
            hits: mergeGraphExpandedHits({
              baseHits: hits,
              graphHits: legacyGraphHits,
              finalK: Math.max(policy.rerankK, policy.finalK) + legacyGraphHits.length,
            }),
            signals: dynamicSignals,
            issueId: input.issueId,
            projectId: input.issue.projectId,
            projectAffinityIds: dynamicSignals.projectAffinityIds,
            linkMap: combinedLinkMap,
            temporalContext,
            documentVersionMap: await listDocumentVersionsForRetrieval({
              db,
              companyId: input.companyId,
              documentIds: uniqueNonEmpty(
                mergeGraphExpandedHits({
                  baseHits: hits,
                  graphHits: legacyGraphHits,
                  finalK: Math.max(policy.rerankK, policy.finalK) + legacyGraphHits.length,
                }).map((hit) => hit.documentId),
              ),
            }),
            finalK: policy.finalK,
            rerankConfig,
            personalizationProfile,
          })
          : initialRerankedHits;
        const chunkSymbolMap = await listChunkSymbols(rerankedHits.map((hit) => hit.chunkId));
        const symbolGraphSeeds = buildSymbolGraphExpansionSeeds({
          hits: rerankedHits,
          chunkSymbolMap,
        });
        const symbolGraphResult = await querySymbolGraphExpansionKnowledge({
          companyId: input.companyId,
          symbolSeeds: symbolGraphSeeds,
          excludeChunkIds: rerankedHits.map((hit) => hit.chunkId),
          allowedSourceTypes: policy.allowedSourceTypes,
          allowedAuthorityLevels: policy.allowedAuthorityLevels,
          limit: Math.min(Math.max(policy.finalK, 6), Math.max(symbolGraphSeeds.length * 2, 6)),
        });
        const symbolGraphLinkMap = symbolGraphResult.hits.length > 0
          ? await listRetrievalLinks(symbolGraphResult.hits.map((hit) => hit.chunkId))
          : new Map<string, RetrievalLinkView[]>();
        const symbolCombinedLinkMap = new Map(combinedLinkMap);
        for (const [chunkId, links] of symbolGraphLinkMap.entries()) {
          symbolCombinedLinkMap.set(chunkId, links);
        }
        const symbolExpandedHits = symbolGraphResult.hits.length > 0
          ? rerankRetrievalHits({
            hits: mergeGraphExpandedHits({
              baseHits: rerankedHits,
              graphHits: symbolGraphResult.hits,
              finalK: Math.max(policy.rerankK, policy.finalK) + symbolGraphResult.hits.length,
            }),
            signals: dynamicSignals,
            issueId: input.issueId,
            projectId: input.issue.projectId,
            projectAffinityIds: dynamicSignals.projectAffinityIds,
            linkMap: symbolCombinedLinkMap,
            temporalContext,
            documentVersionMap: await listDocumentVersionsForRetrieval({
              db,
              companyId: input.companyId,
              documentIds: uniqueNonEmpty(
                mergeGraphExpandedHits({
                  baseHits: rerankedHits,
                  graphHits: symbolGraphResult.hits,
                  finalK: Math.max(policy.rerankK, policy.finalK) + symbolGraphResult.hits.length,
                }).map((hit) => hit.documentId),
              ),
            }),
            finalK: policy.finalK,
            rerankConfig,
            personalizationProfile,
          })
          : rerankedHits;
        let finalHits: RetrievalHitView[] = symbolExpandedHits;
        if (rerankConfig.modelRerank.enabled && modelReranker.isConfigured() && symbolExpandedHits.length > 1) {
          try {
            const modelResult = await modelReranker.rerankCandidates({
              queryText,
              recipientRole: recipient.role,
              workflowState: input.message.workflowStateAfter,
              summary: input.message.summary,
              candidates: symbolExpandedHits.slice(0, rerankConfig.modelRerank.candidateCount).map((hit) => ({
                chunkId: hit.chunkId,
                sourceType: hit.sourceType,
                authorityLevel: hit.authorityLevel,
                path: hit.path,
                symbolName: hit.symbolName,
                title: hit.title,
                excerpt: hit.textContent,
                fusedScore: hit.fusedScore,
              })),
            });
            finalHits = applyModelRerankOrder({
              hits: symbolExpandedHits,
              rankedChunkIds: modelResult.rankedChunkIds,
              finalK: policy.finalK,
              modelRerank: rerankConfig.modelRerank,
            });
          } catch {
            finalHits = symbolExpandedHits;
          }
        }

        if (finalHits.length > 0) {
          await knowledge.recordRetrievalHits({
            companyId: input.companyId,
            retrievalRunId: retrievalRun.id,
            hits: finalHits.map((hit, index) => ({
              chunkId: hit.chunkId,
              denseScore: hit.denseScore,
              sparseScore: hit.sparseScore,
              rerankScore: hit.rerankScore,
              fusedScore: hit.fusedScore,
              finalRank: index + 1,
              selected: true,
              rationale: buildHitRationale({
                hit,
                issueId: input.issueId,
                projectId: input.issue.projectId,
                projectAffinityIds: dynamicSignals.projectAffinityIds,
                signals: dynamicSignals,
              }),
            })),
          });
        }

        const briefScope = deriveBriefScope({
          eventType,
          recipientRole: recipient.role,
        });
        console.log("[RETRIEVAL] Brief scope:", briefScope);
        const graphHits = finalHits.filter((hit) => hit.graphMetadata != null);
        const multiHopGraphHitCount = finalHits.filter((hit) => (hit.graphMetadata?.hopDepth ?? 1) > 1).length;
        const briefQuality = summarizeBriefQuality({
          finalHits,
          queryEmbedding,
          sparseHitCount: sparseHits.length,
          pathHitCount: pathHits.length,
          symbolHitCount: symbolHits.length,
          denseHitCount: denseHits.length,
          graphSeedCount: graphSeeds.length + symbolGraphSeeds.length,
          graphHitCount: graphHits.length,
          graphEntityTypes: uniqueNonEmpty(graphHits.flatMap((hit) => hit.graphMetadata?.entityTypes ?? [])),
          symbolGraphSeedCount: symbolGraphSeeds.length,
          symbolGraphHitCount: symbolGraphResult.hits.length,
          edgeTraversalCount: symbolGraphResult.edgeTraversalCount,
          edgeTypeCounts: symbolGraphResult.edgeTypeCounts,
          graphMaxDepth: symbolGraphResult.graphMaxDepth,
          graphHopDepthCounts: symbolGraphResult.graphHopDepthCounts,
          multiHopGraphHitCount,
          temporalContext,
          crossProjectRequested: dynamicSignals.projectAffinityIds.length > 1,
        });

        const latestBrief = await knowledge.getLatestTaskBrief(input.issueId, briefScope);
        const brief = await knowledge.createTaskBrief({
          companyId: input.companyId,
          issueId: input.issueId,
          briefScope,
          briefVersion: (latestBrief?.briefVersion ?? 0) + 1,
          generatedFromMessageSeq: input.triggeringMessageSeq,
          workflowState: input.message.workflowStateAfter,
          contentMarkdown: renderRetrievedBriefMarkdown({
            briefScope,
            issue: input.issue,
            message: input.message,
            queryText,
            hits: finalHits,
          }),
          contentJson: {
            eventType,
            triggeringMessageId: input.triggeringMessageId,
            queryText,
            dynamicSignals,
            quality: briefQuality,
            hits: finalHits.map((hit, index) => ({
              rank: index + 1,
              chunkId: hit.chunkId,
              documentId: hit.documentId,
              sourceType: hit.sourceType,
              authorityLevel: hit.authorityLevel,
              path: hit.path,
              title: hit.title,
              denseScore: hit.denseScore,
              sparseScore: hit.sparseScore,
              rerankScore: hit.rerankScore,
              fusedScore: hit.fusedScore,
              graphMetadata: hit.graphMetadata ?? null,
              temporalMetadata: hit.temporalMetadata ?? null,
              personalizationMetadata: hit.personalizationMetadata ?? null,
            })),
          },
          retrievalRunId: retrievalRun.id,
        });

        console.log("[RETRIEVAL] Brief created:", {
          briefId: brief.id,
          briefScope,
          briefVersion: brief.briefVersion,
          hitCount: finalHits.length,
          retrievalRunId: retrievalRun.id,
        });

        await knowledge.linkRetrievalRunToBrief(retrievalRun.id, brief.id);
        await knowledge.updateRetrievalRunDebug(retrievalRun.id, {
          quality: briefQuality,
          hitProjectIds: uniqueNonEmpty(finalHits.map((hit) => hit.documentProjectId ?? "")),
          topHitProjectId: finalHits[0]?.documentProjectId ?? null,
          topHitPath: finalHits[0]?.path ?? null,
          graphSeedCount: graphSeeds.length + symbolGraphSeeds.length,
          graphSeedTypes: uniqueNonEmpty([
            ...graphSeeds.map((seed) => seed.entityType),
            ...(symbolGraphSeeds.length > 0 ? ["symbol_graph"] : []),
          ]),
          graphHitCount: graphHits.length,
          graphEntityTypes: uniqueNonEmpty(graphHits.flatMap((hit) => hit.graphMetadata?.entityTypes ?? [])),
          symbolGraphSeedCount: symbolGraphSeeds.length,
          symbolGraphHitCount: symbolGraphResult.hits.length,
          edgeTraversalCount: symbolGraphResult.edgeTraversalCount,
          edgeTypeCounts: symbolGraphResult.edgeTypeCounts,
          graphMaxDepth: symbolGraphResult.graphMaxDepth,
          graphHopDepthCounts: symbolGraphResult.graphHopDepthCounts,
          multiHopGraphHitCount,
          temporalContext,
          exactPathSatisfied: dynamicSignals.exactPaths.length === 0
            ? true
            : finalHits.some((hit) => {
              const candidatePath = hit.path ? normalizeHintPath(hit.path) : null;
              return candidatePath != null && dynamicSignals.exactPaths.includes(candidatePath);
            }),
          personalization: {
            applied: personalizationProfile.applied,
            scopes: personalizationProfile.scopes,
            feedbackCount: personalizationProfile.feedbackCount,
            positiveFeedbackCount: personalizationProfile.positiveFeedbackCount,
            negativeFeedbackCount: personalizationProfile.negativeFeedbackCount,
            sourceTypeKeyCount: Object.keys(personalizationProfile.sourceTypeBoosts).length,
            pathKeyCount: Object.keys(personalizationProfile.pathBoosts).length,
            symbolKeyCount: Object.keys(personalizationProfile.symbolBoosts).length,
            personalizedHitCount: briefQuality.personalizedHitCount,
            averagePersonalizationBoost: briefQuality.averagePersonalizationBoost,
          },
        });

        await logActivity(db, {
          companyId: input.companyId,
          actorType: input.actor.actorType,
          actorId: input.actor.actorId,
          action: "retrieval.run.completed",
          entityType: "issue",
          entityId: input.issueId,
          details: {
            retrievalRunId: retrievalRun.id,
            triggeringMessageId: input.triggeringMessageId,
            recipientRole: recipient.role,
            recipientId: recipient.recipientId,
            hitCount: finalHits.length,
            briefQuality: briefQuality.confidenceLevel,
            briefDenseEnabled: briefQuality.denseEnabled,
            briefId: brief.id,
            briefScope,
          },
        });

        publishLiveEvent({
          companyId: input.companyId,
          type: "retrieval.run.completed",
          payload: {
            issueId: input.issueId,
            retrievalRunId: retrievalRun.id,
            recipientRole: recipient.role,
            recipientId: recipient.recipientId,
            hitCount: finalHits.length,
            briefQuality: briefQuality.confidenceLevel,
            briefDenseEnabled: briefQuality.denseEnabled,
          },
        });

        publishLiveEvent({
          companyId: input.companyId,
          type: "issue.brief.updated",
          payload: {
            issueId: input.issueId,
            briefId: brief.id,
            briefScope,
            briefVersion: brief.briefVersion,
            retrievalRunId: retrievalRun.id,
          },
        });

        recipientHints.push({
          recipientId: recipient.recipientId,
          recipientRole: recipient.role,
          retrievalRunId: retrievalRun.id,
          briefId: brief.id,
          briefScope,
          briefContentMarkdown: brief.contentMarkdown,
          briefEvidenceSummary: finalHits.slice(0, 6).map((hit, index) => ({
            rank: index + 1,
            sourceType: hit.sourceType,
            authorityLevel: hit.authorityLevel,
            path: hit.path,
            title: hit.title,
            symbolName: hit.symbolName,
            fusedScore: hit.fusedScore,
          })),
        });
        retrievalRuns.push({
          retrievalRunId: retrievalRun.id,
          briefId: brief.id,
          recipientRole: recipient.role,
          recipientId: recipient.recipientId,
        });
      }

      return {
        eventType,
        recipientHints,
        retrievalRuns,
      };
    },
  };
}
