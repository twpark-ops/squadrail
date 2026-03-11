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
  buildPersonalizationFingerprint,
  buildRetrievalCacheIdentity,
  buildRetrievalCacheInspectionResult,
  buildRetrievalStageCacheKey,
  hashString,
  stableJson,
} from "./retrieval-cache.js";
import {
  applyExecutionLanePolicy,
  resolveExecutionLane,
  type ExecutionLane,
} from "./execution-lanes.js";
import {
  appendUniqueRetrievalHits,
  applyEvidenceDiversityGuard,
  applyGraphConnectivityGuard,
  applyOrganizationalBridgeGuard,
  applyOrganizationalMemorySaturationGuard,
  classifyOrganizationalArtifact,
  isExecutableEvidenceSourceType,
} from "./retrieval-evidence-guards.js";
import {
  computeRetrievalPersonalizationBoost,
  retrievalPersonalizationService,
  type RetrievalPersonalizationProfile,
} from "./retrieval-personalization.js";
import {
  buildGraphExpansionSeeds,
  buildSymbolGraphExpandedHits,
  buildSymbolGraphExpansionSeeds,
  deriveSemanticGraphHopDepth,
  mergeGraphExpandedHits,
  shouldAllowGraphExactPathRediscovery,
} from "./retrieval/graph.js";
import { applyModelRerankOrder } from "./retrieval/model-rerank.js";
import {
  buildHitRationale,
  computeAuthorityBoost,
  computeDocumentPathBoost,
  computeExecutablePathBridgeBoost,
  computeFreshnessBoost,
  computeLatestBoost,
  computeOrganizationalMemoryPenalty,
  computeScopeBoost,
  computeSourceTypeBoost,
  computeSymbolBoost,
  computeTagBoost,
  fuseRetrievalCandidates,
  type RetrievalPathBoostResult,
  type RetrievalRerankWeights,
} from "./retrieval/scoring.js";
import {
  basenameWithoutExtension,
  compactWhitespace,
  metadataStringArray,
  normalizeHintPath,
  truncateRetrievalSegment,
  uniqueNonEmpty,
} from "./retrieval/shared.js";

export {
  applyEvidenceDiversityGuard,
  applyGraphConnectivityGuard,
  applyOrganizationalBridgeGuard,
  applyOrganizationalMemorySaturationGuard,
} from "./retrieval-evidence-guards.js";
export {
  buildGraphExpansionSeeds,
  buildSymbolGraphExpandedHits,
  buildSymbolGraphExpansionSeeds,
  deriveSemanticGraphHopDepth,
  mergeGraphExpandedHits,
  shouldAllowGraphExactPathRediscovery,
} from "./retrieval/graph.js";
export { applyModelRerankOrder } from "./retrieval/model-rerank.js";
export { fuseRetrievalCandidates } from "./retrieval/scoring.js";

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
const CANDIDATE_HIT_CACHE_TTL_SECONDS = 20 * 60;
const FINAL_HIT_CACHE_TTL_SECONDS = 10 * 60;
const CHUNK_GRAPH_EXPANSION_MAX_HOPS = 3;

type RetrievalEventType = (typeof RETRIEVAL_EVENT_BY_MESSAGE_TYPE)[keyof typeof RETRIEVAL_EVENT_BY_MESSAGE_TYPE];

type RetrievalTargetRole = "engineer" | "reviewer" | "tech_lead" | "cto" | "pm" | "qa" | "human_board";
type RetrievalBriefScope = "global" | "engineer" | "reviewer" | "tech_lead" | "cto" | "pm" | "qa" | "closure";

export function buildQueryEmbeddingCacheKey(input: {
  queryText: string;
  embeddingFingerprint: string;
}) {
  return hashString(`${input.embeddingFingerprint}\n${input.queryText}`);
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
  saturationMetadata?: {
    penalty: number;
    repeatedPathCount: number;
    repeatedSourceTypeCount: number;
    artifactClass: "issue" | "protocol" | "review" | null;
  } | null;
  diversityMetadata?: {
    promotedReason:
      | "exact_path_code"
      | "exact_path_test_report"
      | "organizational_bridge_exact_path"
      | "organizational_bridge_related_path"
      | "graph_multihop_code"
      | "graph_multihop_context";
    replacedSourceType: string | null;
  } | null;
}

function serializeRetrievalHit(hit: RetrievalHitView) {
  return {
    ...hit,
    updatedAt: hit.updatedAt.toISOString(),
  };
}

function deserializeRetrievalHit(value: unknown): RetrievalHitView | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const chunkId = typeof record.chunkId === "string" ? record.chunkId : null;
  const documentId = typeof record.documentId === "string" ? record.documentId : null;
  const sourceType = typeof record.sourceType === "string" ? record.sourceType : null;
  const authorityLevel = typeof record.authorityLevel === "string" ? record.authorityLevel : null;
  if (!chunkId || !documentId || !sourceType || !authorityLevel) return null;

  const readNumber = (input: unknown) => (typeof input === "number" && Number.isFinite(input) ? input : null);
  const updatedAt = typeof record.updatedAt === "string" ? new Date(record.updatedAt) : null;
  if (!updatedAt || Number.isNaN(updatedAt.getTime())) return null;

  return {
    chunkId,
    documentId,
    sourceType,
    authorityLevel,
    documentIssueId: typeof record.documentIssueId === "string" ? record.documentIssueId : null,
    documentProjectId: typeof record.documentProjectId === "string" ? record.documentProjectId : null,
    path: typeof record.path === "string" ? record.path : null,
    title: typeof record.title === "string" ? record.title : null,
    headingPath: typeof record.headingPath === "string" ? record.headingPath : null,
    symbolName: typeof record.symbolName === "string" ? record.symbolName : null,
    textContent: typeof record.textContent === "string" ? record.textContent : "",
    documentMetadata: (record.documentMetadata && typeof record.documentMetadata === "object" && !Array.isArray(record.documentMetadata))
      ? record.documentMetadata as Record<string, unknown>
      : {},
    chunkMetadata: (record.chunkMetadata && typeof record.chunkMetadata === "object" && !Array.isArray(record.chunkMetadata))
      ? record.chunkMetadata as Record<string, unknown>
      : {},
    denseScore: readNumber(record.denseScore),
    sparseScore: readNumber(record.sparseScore),
    rerankScore: readNumber(record.rerankScore),
    fusedScore: typeof record.fusedScore === "number" ? record.fusedScore : 0,
    updatedAt,
    modelRerankRank: readNumber(record.modelRerankRank),
    graphMetadata: (record.graphMetadata && typeof record.graphMetadata === "object" && !Array.isArray(record.graphMetadata))
      ? record.graphMetadata as RetrievalHitView["graphMetadata"]
      : null,
    temporalMetadata: (record.temporalMetadata && typeof record.temporalMetadata === "object" && !Array.isArray(record.temporalMetadata))
      ? record.temporalMetadata as RetrievalHitView["temporalMetadata"]
      : null,
    personalizationMetadata:
      (record.personalizationMetadata && typeof record.personalizationMetadata === "object" && !Array.isArray(record.personalizationMetadata))
        ? record.personalizationMetadata as RetrievalHitView["personalizationMetadata"]
        : null,
    saturationMetadata:
      (record.saturationMetadata && typeof record.saturationMetadata === "object" && !Array.isArray(record.saturationMetadata))
        ? record.saturationMetadata as RetrievalHitView["saturationMetadata"]
        : null,
    diversityMetadata:
      (record.diversityMetadata && typeof record.diversityMetadata === "object" && !Array.isArray(record.diversityMetadata))
        ? record.diversityMetadata as RetrievalHitView["diversityMetadata"]
        : null,
  };
}

function readCachedRetrievalHits(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const hits = Array.isArray(record.hits)
    ? record.hits.map(deserializeRetrievalHit).filter((hit): hit is RetrievalHitView => hit != null)
    : [];
  if (hits.length === 0) return null;
  return {
    hits,
    quality:
      record.quality && typeof record.quality === "object" && !Array.isArray(record.quality)
        ? record.quality as Record<string, unknown>
        : null,
    metadata:
      record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
        ? record.metadata as Record<string, unknown>
        : {},
  };
}

interface RetrievalCachePayload {
  hits: RetrievalHitView[];
  quality: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
}

export type RetrievalCacheState =
  | "hit"
  | "miss_cold"
  | "miss_revision_changed"
  | "miss_expired"
  | "miss_policy_changed"
  | "miss_feedback_changed";

export type RetrievalCacheHitProvenance =
  | "exact_key"
  | "normalized_input"
  | "feedback_drift";

export interface RetrievalCacheInspectionResult {
  state: RetrievalCacheState;
  reason: RetrievalCacheState;
  provenance: RetrievalCacheHitProvenance | null;
  matchedRevision: number | null;
  latestKnownRevision: number | null;
  lastEntryUpdatedAt: string | null;
  cacheKeyFingerprint: string;
  requestedCacheKeyFingerprint: string;
  matchedCacheKeyFingerprint: string | null;
}

interface ChunkGraphExpansionResult {
  hits: RetrievalHitView[];
  edgeTraversalCount: number;
  graphMaxDepth: number;
  graphHopDepthCounts: Record<string, number>;
  graphEntityTypeCounts: Record<string, number>;
}

function readRetrievalCachePayload(value: unknown): RetrievalCachePayload | null {
  const payload = readCachedRetrievalHits(value);
  if (!payload) return null;
  return payload;
}

function serializeRetrievalCachePayload(input: RetrievalCachePayload) {
  return {
    hits: input.hits.map((hit) => serializeRetrievalHit(hit)),
    quality: input.quality ?? null,
    metadata: input.metadata,
  };
}

function readCachedBriefQualitySummary(value: Record<string, unknown> | null | undefined): BriefQualitySummary | null {
  if (!value) return null;
  const confidenceLevel = typeof value.confidenceLevel === "string" ? value.confidenceLevel : null;
  if (confidenceLevel !== "high" && confidenceLevel !== "medium" && confidenceLevel !== "low") return null;
  const candidateCacheReason =
    value.candidateCacheReason === "hit"
    || value.candidateCacheReason === "miss_cold"
    || value.candidateCacheReason === "miss_revision_changed"
    || value.candidateCacheReason === "miss_expired"
    || value.candidateCacheReason === "miss_policy_changed"
    || value.candidateCacheReason === "miss_feedback_changed"
      ? value.candidateCacheReason
      : null;
  const finalCacheReason =
    value.finalCacheReason === "hit"
    || value.finalCacheReason === "miss_cold"
    || value.finalCacheReason === "miss_revision_changed"
    || value.finalCacheReason === "miss_expired"
    || value.finalCacheReason === "miss_policy_changed"
    || value.finalCacheReason === "miss_feedback_changed"
      ? value.finalCacheReason
      : null;
  const candidateCacheProvenance =
    value.candidateCacheProvenance === "exact_key"
    || value.candidateCacheProvenance === "normalized_input"
    || value.candidateCacheProvenance === "feedback_drift"
      ? value.candidateCacheProvenance
      : null;
  const finalCacheProvenance =
    value.finalCacheProvenance === "exact_key"
    || value.finalCacheProvenance === "normalized_input"
    || value.finalCacheProvenance === "feedback_drift"
      ? value.finalCacheProvenance
      : null;
  return {
    confidenceLevel,
    evidenceCount: typeof value.evidenceCount === "number" ? value.evidenceCount : 0,
    denseEnabled: value.denseEnabled === true,
    denseHitCount: typeof value.denseHitCount === "number" ? value.denseHitCount : 0,
    sparseHitCount: typeof value.sparseHitCount === "number" ? value.sparseHitCount : 0,
    pathHitCount: typeof value.pathHitCount === "number" ? value.pathHitCount : 0,
    symbolHitCount: typeof value.symbolHitCount === "number" ? value.symbolHitCount : 0,
    graphSeedCount: typeof value.graphSeedCount === "number" ? value.graphSeedCount : 0,
    graphHitCount: typeof value.graphHitCount === "number" ? value.graphHitCount : 0,
    graphEntityTypes: Array.isArray(value.graphEntityTypes) ? value.graphEntityTypes.filter((entry): entry is string => typeof entry === "string") : [],
    symbolGraphSeedCount: typeof value.symbolGraphSeedCount === "number" ? value.symbolGraphSeedCount : 0,
    symbolGraphHitCount: typeof value.symbolGraphHitCount === "number" ? value.symbolGraphHitCount : 0,
    edgeTraversalCount: typeof value.edgeTraversalCount === "number" ? value.edgeTraversalCount : 0,
    edgeTypeCounts: value.edgeTypeCounts && typeof value.edgeTypeCounts === "object" && !Array.isArray(value.edgeTypeCounts)
      ? value.edgeTypeCounts as Record<string, number>
      : {},
    graphMaxDepth: typeof value.graphMaxDepth === "number" ? value.graphMaxDepth : 0,
    graphHopDepthCounts: value.graphHopDepthCounts && typeof value.graphHopDepthCounts === "object" && !Array.isArray(value.graphHopDepthCounts)
      ? value.graphHopDepthCounts as Record<string, number>
      : {},
    multiHopGraphHitCount: typeof value.multiHopGraphHitCount === "number" ? value.multiHopGraphHitCount : 0,
    temporalContextAvailable: value.temporalContextAvailable === true,
    temporalHitCount: typeof value.temporalHitCount === "number" ? value.temporalHitCount : 0,
    branchAlignedTopHitCount: typeof value.branchAlignedTopHitCount === "number" ? value.branchAlignedTopHitCount : 0,
    staleVersionPenaltyCount: typeof value.staleVersionPenaltyCount === "number" ? value.staleVersionPenaltyCount : 0,
    exactCommitMatchCount: typeof value.exactCommitMatchCount === "number" ? value.exactCommitMatchCount : 0,
    personalizationApplied: value.personalizationApplied === true,
    personalizedHitCount: typeof value.personalizedHitCount === "number" ? value.personalizedHitCount : 0,
    averagePersonalizationBoost: typeof value.averagePersonalizationBoost === "number" ? value.averagePersonalizationBoost : 0,
    organizationalMemoryHitCount:
      typeof value.organizationalMemoryHitCount === "number" ? value.organizationalMemoryHitCount : 0,
    codeHitCount: typeof value.codeHitCount === "number" ? value.codeHitCount : 0,
    reviewHitCount: typeof value.reviewHitCount === "number" ? value.reviewHitCount : 0,
    sourceDiversity: typeof value.sourceDiversity === "number" ? value.sourceDiversity : 0,
    candidateCacheHit: value.candidateCacheHit === true,
    finalCacheHit: value.finalCacheHit === true,
    candidateCacheReason,
    finalCacheReason,
    candidateCacheProvenance,
    finalCacheProvenance,
    exactPathSatisfied: value.exactPathSatisfied !== false,
    degradedReasons: Array.isArray(value.degradedReasons) ? value.degradedReasons.filter((entry): entry is string => typeof entry === "string") : [],
  };
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
  executionLane: ExecutionLane;
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

export interface RetrievalLinkView {
  chunkId: string;
  entityType: string;
  entityId: string;
  linkReason: string;
  weight: number;
}

export interface RetrievalSignals {
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

interface LaneAwareRetrievalPolicy {
  lane: ExecutionLane;
  topKDense: number;
  topKSparse: number;
  rerankK: number;
  finalK: number;
  modelRerankCandidateCount: number;
  chunkGraphMaxHops: number;
  maxEvidenceItems: number;
}

export function applyPersonalizationSignals(input: {
  signals: RetrievalSignals;
  profile: RetrievalPersonalizationProfile;
  maxPaths?: number;
  maxSymbols?: number;
  maxSourceTypes?: number;
}) {
  if (!input.profile.applied) return input.signals;

  const directExactPaths = input.signals.exactPaths.map(normalizeHintPath);
  const directDirectories = new Set(directExactPaths.map((value) => path.posix.dirname(value)));
  const directBasenames = new Set(directExactPaths.map((value) => path.posix.basename(value)));
  const directStemNames = new Set(directExactPaths.map(basenameWithoutExtension));

  const boostedPaths = Object.entries(input.profile.pathBoosts)
    .filter((entry) => entry[1] > 0.04)
    .sort((left, right) => right[1] - left[1])
    .slice(0, input.maxPaths ?? 6)
    .map(([pathValue]) => normalizeHintPath(pathValue))
    .filter((candidatePath) => {
      if (directExactPaths.length === 0) return true;
      const candidateDir = path.posix.dirname(candidatePath);
      const candidateBase = path.posix.basename(candidatePath);
      const candidateStem = basenameWithoutExtension(candidatePath);
      return (
        directExactPaths.includes(candidatePath)
        || directDirectories.has(candidateDir)
        || directBasenames.has(candidateBase)
        || directStemNames.has(candidateStem)
      );
    });
  const boostedSymbols = Object.entries(input.profile.symbolBoosts)
    .filter((entry) => entry[1] > 0.04)
    .sort((left, right) => right[1] - left[1])
    .slice(0, input.maxSymbols ?? 8)
    .map(([symbolValue]) => symbolValue.trim())
    .filter((value) => value.length > 0);
  const boostedSourceTypes = Object.entries(input.profile.sourceTypeBoosts)
    .filter((entry) => entry[1] > 0.04)
    .sort((left, right) => right[1] - left[1])
    .slice(0, input.maxSourceTypes ?? 4)
    .map(([sourceType]) => sourceType.trim())
    .filter((value) => value.length > 0);

  return {
    ...input.signals,
    exactPaths: uniqueNonEmpty([...boostedPaths, ...input.signals.exactPaths]),
    fileNames: uniqueNonEmpty([
      ...boostedPaths.map((value) => path.posix.basename(value)),
      ...input.signals.fileNames,
    ]),
    symbolHints: uniqueNonEmpty([
      ...boostedSymbols,
      ...boostedPaths.map(basenameWithoutExtension),
      ...input.signals.symbolHints,
    ]),
    preferredSourceTypes: uniqueNonEmpty([
      ...(boostedPaths.length > 0 ? ["code"] : []),
      ...boostedSourceTypes,
      ...input.signals.preferredSourceTypes,
    ]),
  } satisfies RetrievalSignals;
}

export interface RetrievalPolicyRerankConfig {
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

type RetrievalCandidate = Omit<RetrievalHitView, "fusedScore"> & {
  fusedScore?: number;
};

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
  organizationalMemoryHitCount: number;
  codeHitCount: number;
  reviewHitCount: number;
  sourceDiversity: number;
  candidateCacheHit: boolean;
  finalCacheHit: boolean;
  candidateCacheReason: RetrievalCacheState | null;
  finalCacheReason: RetrievalCacheState | null;
  candidateCacheProvenance: RetrievalCacheHitProvenance | null;
  finalCacheProvenance: RetrievalCacheHitProvenance | null;
  exactPathSatisfied: boolean;
  degradedReasons: string[];
}

interface RetrievalCacheIdentityView {
  queryFingerprint: string | null;
  policyFingerprint: string | null;
  feedbackFingerprint: string | null;
  revisionSignature: string | null;
}

export interface RetrievalGraphSeed {
  entityType: "symbol" | "path" | "project" | "issue";
  entityId: string;
  seedBoost: number;
  seedReasons: string[];
}

export interface RetrievalChunkSymbolView {
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

export interface RetrievalTemporalContext {
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
  exactPathCodeBridgeBoost: 1.4,
  exactPathTestBridgeBoost: 1.15,
  fileNameBoost: 0.9,
  metadataExactPathBoostMultiplier: 0.85,
  metadataFileNameBoostMultiplier: 0.7,
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
  graphMultiHopBoost: 0.55,
  graphExecutableBridgeBoost: 0.4,
  graphCrossProjectBoost: 0.3,
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
  organizationalIssueMissPenalty: -1.1,
  organizationalProtocolMissPenalty: -0.45,
  organizationalReviewMissPenalty: -1.35,
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
  candidateCacheHit?: boolean;
  finalCacheHit?: boolean;
  candidateCacheInspection?: Pick<RetrievalCacheInspectionResult, "reason" | "provenance">;
  finalCacheInspection?: Pick<RetrievalCacheInspectionResult, "reason" | "provenance">;
  exactPathSatisfied?: boolean;
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
  const organizationalMemoryHitCount = input.finalHits.filter((hit) => classifyOrganizationalArtifact(hit) != null).length;
  const codeHitCount = input.finalHits.filter((hit) => hit.sourceType === "code").length;
  const reviewHitCount = input.finalHits.filter((hit) => hit.sourceType === "review").length;
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
    organizationalMemoryHitCount,
    codeHitCount,
    reviewHitCount,
    sourceDiversity,
    candidateCacheHit: input.candidateCacheHit === true,
    finalCacheHit: input.finalCacheHit === true,
    candidateCacheReason: input.candidateCacheInspection?.reason ?? null,
    finalCacheReason: input.finalCacheInspection?.reason ?? null,
    candidateCacheProvenance: input.candidateCacheInspection?.provenance ?? null,
    finalCacheProvenance: input.finalCacheInspection?.provenance ?? null,
    exactPathSatisfied: input.exactPathSatisfied !== false,
    degradedReasons,
  };
}

function readRetrievalCacheIdentityView(value: unknown): RetrievalCacheIdentityView {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      queryFingerprint: null,
      policyFingerprint: null,
      feedbackFingerprint: null,
      revisionSignature: null,
    };
  }
  const record = value as Record<string, unknown>;
  return {
    queryFingerprint: typeof record.queryFingerprint === "string" ? record.queryFingerprint : null,
    policyFingerprint: typeof record.policyFingerprint === "string" ? record.policyFingerprint : null,
    feedbackFingerprint: typeof record.feedbackFingerprint === "string" ? record.feedbackFingerprint : null,
    revisionSignature: typeof record.revisionSignature === "string" ? record.revisionSignature : null,
  };
}

function resolveRetrievalCacheHitProvenance(input: {
  requestedCacheKey: string;
  matchedCacheKey: string;
  requestedFeedbackFingerprint: string | null;
  matchedFeedbackFingerprint: string | null;
}): RetrievalCacheHitProvenance {
  if (input.requestedCacheKey === input.matchedCacheKey) return "exact_key";
  if (input.requestedFeedbackFingerprint !== input.matchedFeedbackFingerprint) return "feedback_drift";
  return "normalized_input";
}

function isExactPathSatisfied(input: {
  finalHits: RetrievalHitView[];
  exactPaths: string[];
}) {
  if (input.exactPaths.length === 0) return true;
  return input.finalHits.some((hit) => {
    const candidatePath = hit.path ? normalizeHintPath(hit.path) : null;
    return candidatePath != null && input.exactPaths.includes(candidatePath);
  });
}

function buildKnowledgeRevisionSignature(input: {
  companyId: string;
  issueProjectId: string | null;
  projectAffinityIds: string[];
  revisions: Array<{
    projectId: string;
    revision: number;
    lastHeadSha: string | null;
    lastTreeSignature: string | null;
  }>;
}): string {
  const orderedProjectIds = uniqueNonEmpty([
    input.issueProjectId,
    ...input.projectAffinityIds,
  ]);
  const revisionByProjectId = new Map(
    input.revisions.map((revision) => [revision.projectId, revision] as const),
  );
  return hashString(stableJson({
    companyId: input.companyId,
    orderedProjectIds,
    revisions: orderedProjectIds.map((projectId) => {
      const revision = revisionByProjectId.get(projectId);
      return {
        projectId,
        revision: revision?.revision ?? 0,
        lastHeadSha: revision?.lastHeadSha ?? null,
        lastTreeSignature: revision?.lastTreeSignature ?? null,
      };
    }),
  }));
}

function extractPathHintsFromTextValues(values: Array<string | null | undefined>) {
  const pathPattern = /\b(?:[A-Za-z0-9_.-]+\/)+(?:[A-Za-z0-9_.-]+\.[A-Za-z0-9]+)\b/g;
  const results: string[] = [];
  for (const value of values) {
    if (typeof value !== "string" || value.trim().length === 0) continue;
    const matches = value.match(pathPattern) ?? [];
    for (const match of matches) {
      results.push(normalizeHintPath(match));
    }
  }
  return uniqueNonEmpty(results);
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

function dbVectorLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
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
    title?: string | null;
    description?: string | null;
    mentionedProjects?: Array<{ id: string; name: string }>;
  };
  recipientRole: string;
  eventType: RetrievalEventType;
  baselineSourceTypes?: string[];
}) {
  const payload = input.message.payload as Record<string, unknown>;
  const preferredSourceTypesByRole: Record<string, string[]> = {
    engineer: ["code", "test_report", "review", "adr", "runbook", "issue"],
    reviewer: ["code", "test_report", "review", "adr", "runbook", "issue"],
    tech_lead: ["adr", "prd", "issue", "runbook", "review", "code"],
    human_board: ["prd", "adr", "issue", "review", "runbook", "protocol_message"],
  };
  const baselineSourceTypes = uniqueNonEmpty([
    ...(preferredSourceTypesByRole[input.recipientRole] ?? preferredSourceTypesByRole.engineer),
    ...(input.baselineSourceTypes ?? []),
  ]);

  const textDerivedPaths = extractPathHintsFromTextValues([
    input.issue.title,
    input.issue.description,
    input.message.summary,
    typeof payload.goal === "string" ? payload.goal : null,
    typeof payload.reason === "string" ? payload.reason : null,
    typeof payload.implementationSummary === "string" ? payload.implementationSummary : null,
    typeof payload.diffSummary === "string" ? payload.diffSummary : null,
    typeof payload.reviewSummary === "string" ? payload.reviewSummary : null,
    typeof payload.approvalSummary === "string" ? payload.approvalSummary : null,
    typeof payload.closureSummary === "string" ? payload.closureSummary : null,
    typeof payload.verificationSummary === "string" ? payload.verificationSummary : null,
    ...((payload.requiredEvidence as string[] | undefined) ?? []),
    ...((payload.reviewChecklist as string[] | undefined) ?? []),
    ...((payload.testResults as string[] | undefined) ?? []),
    ...((payload.residualRisks as string[] | undefined) ?? []),
    ...((payload.changedFiles as string[] | undefined) ?? []),
    ...(((payload.changeRequests as Array<Record<string, unknown>> | undefined) ?? []).flatMap((request) => [
      typeof request.title === "string" ? request.title : null,
      typeof request.reason === "string" ? request.reason : null,
      typeof request.suggestedAction === "string" ? request.suggestedAction : null,
      ...(((request.affectedFiles as string[] | undefined) ?? [])),
    ])),
  ]);
  const exactPaths = uniqueNonEmpty([
    ...((payload.changedFiles as string[] | undefined) ?? []),
    ...(((payload.changeRequests as Array<Record<string, unknown>> | undefined) ?? []).flatMap((request) => (
      (request.affectedFiles as string[] | undefined) ?? []
    ))),
    ...((payload.relatedArtifacts as string[] | undefined) ?? []),
    ...textDerivedPaths,
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
    exactPathCodeBridgeBoost: readConfiguredNumber(
      weightsRecord.exactPathCodeBridgeBoost,
      DEFAULT_RETRIEVAL_RERANK_WEIGHTS.exactPathCodeBridgeBoost,
    ),
    exactPathTestBridgeBoost: readConfiguredNumber(
      weightsRecord.exactPathTestBridgeBoost,
      DEFAULT_RETRIEVAL_RERANK_WEIGHTS.exactPathTestBridgeBoost,
    ),
    fileNameBoost: readConfiguredNumber(weightsRecord.fileNameBoost, DEFAULT_RETRIEVAL_RERANK_WEIGHTS.fileNameBoost),
    metadataExactPathBoostMultiplier: readConfiguredNumber(
      weightsRecord.metadataExactPathBoostMultiplier,
      DEFAULT_RETRIEVAL_RERANK_WEIGHTS.metadataExactPathBoostMultiplier,
    ),
    metadataFileNameBoostMultiplier: readConfiguredNumber(
      weightsRecord.metadataFileNameBoostMultiplier,
      DEFAULT_RETRIEVAL_RERANK_WEIGHTS.metadataFileNameBoostMultiplier,
    ),
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
    graphMultiHopBoost: readConfiguredNumber(weightsRecord.graphMultiHopBoost, DEFAULT_RETRIEVAL_RERANK_WEIGHTS.graphMultiHopBoost),
    graphExecutableBridgeBoost: readConfiguredNumber(
      weightsRecord.graphExecutableBridgeBoost,
      DEFAULT_RETRIEVAL_RERANK_WEIGHTS.graphExecutableBridgeBoost,
    ),
    graphCrossProjectBoost: readConfiguredNumber(
      weightsRecord.graphCrossProjectBoost,
      DEFAULT_RETRIEVAL_RERANK_WEIGHTS.graphCrossProjectBoost,
    ),
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
    organizationalIssueMissPenalty: readConfiguredNumber(
      weightsRecord.organizationalIssueMissPenalty,
      DEFAULT_RETRIEVAL_RERANK_WEIGHTS.organizationalIssueMissPenalty,
    ),
    organizationalProtocolMissPenalty: readConfiguredNumber(
      weightsRecord.organizationalProtocolMissPenalty,
      DEFAULT_RETRIEVAL_RERANK_WEIGHTS.organizationalProtocolMissPenalty,
    ),
    organizationalReviewMissPenalty: readConfiguredNumber(
      weightsRecord.organizationalReviewMissPenalty,
      DEFAULT_RETRIEVAL_RERANK_WEIGHTS.organizationalReviewMissPenalty,
    ),
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
  maxEvidenceItems?: number;
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
  input.hits.slice(0, input.maxEvidenceItems ?? 6).forEach((hit, index) => {
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
  const engineerSources = ["code", "test_report", "review", "adr", "runbook", "issue"];
  const reviewerSources = ["code", "test_report", "review", "adr", "runbook", "issue"];
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

function resolveLaneAwareRetrievalPolicy(input: {
  lane: ExecutionLane;
  policy: {
    topKDense: number;
    topKSparse: number;
    rerankK: number;
    finalK: number;
  };
  rerankConfig: RetrievalPolicyRerankConfig;
}) {
  return applyExecutionLanePolicy({
    lane: input.lane,
    topKDense: input.policy.topKDense,
    topKSparse: input.policy.topKSparse,
    rerankK: input.policy.rerankK,
    finalK: input.policy.finalK,
    modelRerankCandidateCount: input.rerankConfig.modelRerank.candidateCount,
  }) satisfies LaneAwareRetrievalPolicy;
}

function shouldEscalateGraphSeed(input: {
  entityType: RetrievalGraphSeed["entityType"];
  currentSeed: RetrievalGraphSeed;
  linkReason: string;
  linkWeight: number;
}) {
  if (input.entityType !== "path" && input.entityType !== "symbol") return false;
  if (input.linkWeight < 0.7) return false;
  const hasDirectSignal = input.currentSeed.seedReasons.some((reason) =>
    reason === "signal_exact_path"
    || reason === "signal_symbol_hint"
    || reason === "linked_path"
    || reason === "linked_symbol");
  if (!hasDirectSignal) return false;
  return (
    input.linkReason === "protocol_changed_path"
    || input.linkReason === "protocol_issue_context"
    || input.linkReason === "protocol_related_issue"
    || input.linkReason === "issue_snapshot"
  );
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

function computeGraphConnectivityBoost(input: {
  hit: RetrievalHitView;
  signals: RetrievalSignals;
  weights: RetrievalRerankWeights;
}) {
  const hopDepth = input.hit.graphMetadata?.hopDepth ?? 1;
  if (hopDepth <= 1) return 0;

  let score = Math.min(1.8, (hopDepth - 1) * input.weights.graphMultiHopBoost);
  if (isExecutableEvidenceSourceType(input.hit.sourceType)) {
    score += input.weights.graphExecutableBridgeBoost;
  }
  if (input.signals.projectAffinityIds.length > 1) {
    score += input.weights.graphCrossProjectBoost;
  }
  return score;
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
  const scoredHits = input.hits
    .map((hit) => {
      const pathBoost = computeDocumentPathBoost(hit, input.signals, rerankConfig.weights);
      const symbolBoost = computeSymbolBoost(hit.symbolName, input.signals, rerankConfig.weights);
      const executablePathBridgeBoost = computeExecutablePathBridgeBoost({
        hit,
        pathBoost,
        weights: rerankConfig.weights,
      });
      const organizationalMemoryPenalty = computeOrganizationalMemoryPenalty({
        hit,
        signals: input.signals,
        weights: rerankConfig.weights,
        pathBoost,
        symbolBoost,
      });
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
        + pathBoost.score
        + executablePathBridgeBoost
        + symbolBoost
        + computeTagBoost(hit, input.signals, rerankConfig.weights)
        + computeLatestBoost(hit, rerankConfig.weights)
        + computeFreshnessBoost(hit, rerankConfig.weights)
        + temporal.score
        + computeGraphConnectivityBoost({
          hit,
          signals: input.signals,
          weights: rerankConfig.weights,
        })
        + computeLinkBoost({
          hit,
          links: input.linkMap?.get(hit.chunkId) ?? [],
          issueId: input.issueId,
          projectId: input.projectId,
          projectAffinityIds: input.projectAffinityIds ?? input.signals.projectAffinityIds,
          signals: input.signals,
          weights: rerankConfig.weights,
        })
        + organizationalMemoryPenalty;
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
    });

  return applyGraphConnectivityGuard({
    hits: applyOrganizationalBridgeGuard({
      hits: applyEvidenceDiversityGuard({
        hits: applyOrganizationalMemorySaturationGuard({
          hits: scoredHits,
          finalK: input.finalK,
        }),
        finalK: input.finalK,
        signals: input.signals,
      }),
      finalK: input.finalK,
      signals: input.signals,
    }),
    finalK: input.finalK,
    signals: input.signals,
  }).slice(0, input.finalK);
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
    maxHops?: number;
  }) {
    if (input.seeds.length === 0) {
      return {
        hits: [] as RetrievalHitView[],
        edgeTraversalCount: 0,
        graphMaxDepth: 0,
        graphHopDepthCounts: {} as Record<string, number>,
        graphEntityTypeCounts: {} as Record<string, number>,
      };
    }

    const queryRowsForSeeds = async (seeds: RetrievalGraphSeed[], excludeChunkIds: string[]) => {
      const pairConditions = seeds.map((seed) =>
        and(
          eq(knowledgeChunkLinks.entityType, seed.entityType),
          eq(knowledgeChunkLinks.entityId, seed.entityId),
        ),
      );
      if (pairConditions.length === 0) return [];

      const conditions = [
        eq(knowledgeChunkLinks.companyId, input.companyId),
        inArray(knowledgeDocuments.sourceType, input.allowedSourceTypes),
        inArray(knowledgeDocuments.authorityLevel, input.allowedAuthorityLevels),
        or(...pairConditions),
      ];
      if (excludeChunkIds.length > 0) {
        conditions.push(not(inArray(knowledgeChunks.id, excludeChunkIds)));
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
      return rows.filter((row): row is typeof rows[number] & { entityId: string } => typeof row.entityId === "string" && row.entityId.length > 0);
    };

    const queryRowsForExactPathSeeds = async (
      seeds: RetrievalGraphSeed[],
      excludeChunkIds: string[],
      options?: { allowVisitedChunkMatches?: boolean },
    ) => {
      const pathSeeds = uniqueNonEmpty(
        seeds
          .filter((seed) => seed.entityType === "path")
          .map((seed) => normalizeHintPath(seed.entityId)),
      );
      if (pathSeeds.length === 0) return [];

      const conditions = [
        eq(knowledgeChunks.companyId, input.companyId),
        inArray(knowledgeDocuments.sourceType, input.allowedSourceTypes),
        inArray(knowledgeDocuments.authorityLevel, input.allowedAuthorityLevels),
        inArray(knowledgeDocuments.path, pathSeeds),
      ];
      if (!options?.allowVisitedChunkMatches && excludeChunkIds.length > 0) {
        conditions.push(not(inArray(knowledgeChunks.id, excludeChunkIds)));
      }

      const executablePriority = sql<number>`
        case
          when ${knowledgeDocuments.sourceType} = 'code' then 3
          when ${knowledgeDocuments.sourceType} = 'test_report' then 2
          when ${knowledgeDocuments.sourceType} = 'review' then 1
          else 0
        end
      `;

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
          entityType: sql<string>`'path'`,
          entityId: knowledgeDocuments.path,
          linkReason: sql<string>`'path_document_match'`,
          linkWeight: sql<number>`
            case
              when ${knowledgeDocuments.sourceType} = 'code' then 1.18
              when ${knowledgeDocuments.sourceType} = 'test_report' then 1.08
              else 0.72
            end
          `,
        })
        .from(knowledgeChunks)
        .innerJoin(knowledgeDocuments, eq(knowledgeChunks.documentId, knowledgeDocuments.id))
        .where(and(...conditions))
        .orderBy(desc(executablePriority), desc(knowledgeDocuments.updatedAt))
        .limit(Math.max(input.limit * 12, 96));
      return rows.filter((row): row is typeof rows[number] & { entityId: string } => typeof row.entityId === "string" && row.entityId.length > 0);
    };

    const buildHits = (
      rows: Awaited<ReturnType<typeof queryRowsForSeeds>>,
      seeds: Map<string, RetrievalGraphSeed>,
      hopDepth: number,
    ) => {
      const grouped = new Map<string, RetrievalHitView>();
      for (const row of rows) {
        const seed = seeds.get(`${row.entityType}:${row.entityId}`);
        if (!seed) continue;
        const graphHopDepth = deriveSemanticGraphHopDepth({
          traversalHopDepth: hopDepth,
          seedReasons: seed.seedReasons,
        });

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
              hopDepth: graphHopDepth,
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
            seedReasons: uniqueNonEmpty([
              ...(existing.graphMetadata?.seedReasons ?? []),
              ...seed.seedReasons,
              row.linkReason,
            ]),
            graphScore: nextGraphScore,
            hopDepth: Math.max(existing.graphMetadata?.hopDepth ?? graphHopDepth, graphHopDepth),
          },
        });
      }
      return Array.from(grouped.values());
    };

    const listLinksForGraphExpansion = async (chunkIds: string[]) => {
      if (chunkIds.length === 0) return [];
      const rows = await db
        .select({
          chunkId: knowledgeChunkLinks.chunkId,
          entityType: knowledgeChunkLinks.entityType,
          entityId: knowledgeChunkLinks.entityId,
          linkReason: knowledgeChunkLinks.linkReason,
          weight: knowledgeChunkLinks.weight,
        })
        .from(knowledgeChunkLinks)
        .where(and(
          eq(knowledgeChunkLinks.companyId, input.companyId),
          inArray(knowledgeChunkLinks.chunkId, chunkIds),
        ))
        .orderBy(desc(knowledgeChunkLinks.weight))
        .limit(Math.max(input.limit * 16, 120));
      return rows.filter((row): row is typeof rows[number] & { entityId: string } => typeof row.entityId === "string" && row.entityId.length > 0);
    };

    let frontierSeeds = input.seeds;
    let excludedChunkIds = uniqueNonEmpty(input.excludeChunkIds);
    const visitedSeedState = new Map<string, {
      seedBoost: number;
      seedReasons: string[];
      escalationUsed: boolean;
    }>(input.seeds.map((seed) => [
      `${seed.entityType}:${seed.entityId}`,
      {
        seedBoost: seed.seedBoost,
        seedReasons: seed.seedReasons,
        escalationUsed: false,
      },
    ] as const));
    let hits: RetrievalHitView[] = [];
    let edgeTraversalCount = 0;

    const maxGraphHops = Math.max(1, input.maxHops ?? CHUNK_GRAPH_EXPANSION_MAX_HOPS);

    for (let hopDepth = 1; hopDepth <= maxGraphHops; hopDepth += 1) {
      if (frontierSeeds.length === 0) break;

      const frontierSeedMap = new Map(frontierSeeds.map((seed) => [`${seed.entityType}:${seed.entityId}`, seed] as const));
      const allowVisitedExactPathMatches = shouldAllowGraphExactPathRediscovery({
        hopDepth,
        seeds: frontierSeeds,
      });
      const [linkedHopRows, exactPathHopRows] = await Promise.all([
        queryRowsForSeeds(frontierSeeds, excludedChunkIds),
        queryRowsForExactPathSeeds(frontierSeeds, excludedChunkIds, {
          allowVisitedChunkMatches: allowVisitedExactPathMatches,
        }),
      ]);
      const hopRows = [...linkedHopRows, ...exactPathHopRows];
      edgeTraversalCount += hopRows.length;

      const hopHits = buildHits(hopRows, frontierSeedMap, hopDepth);
      hits = mergeGraphExpandedHits({
        baseHits: hits,
        graphHits: hopHits,
        finalK: Math.max(input.limit, hits.length + hopHits.length),
      });
      excludedChunkIds = uniqueNonEmpty([
        ...excludedChunkIds,
        ...hopHits.map((hit) => hit.chunkId),
      ]);

      if (hopDepth === maxGraphHops || hopRows.length === 0) {
        frontierSeeds = [];
        continue;
      }

      const discoveredLinks = await listLinksForGraphExpansion(hopRows.map((row) => row.chunkId));
      edgeTraversalCount += discoveredLinks.length;

      const nextSeedMap = new Map<string, RetrievalGraphSeed>();
      for (const link of discoveredLinks) {
        if (link.entityType !== "symbol" && link.entityType !== "path" && link.entityType !== "project" && link.entityType !== "issue") continue;
        const key = `${link.entityType}:${link.entityId}`;
        const visited = visitedSeedState.get(key);
        const escalationAllowed = visited != null && shouldEscalateGraphSeed({
          entityType: link.entityType as RetrievalGraphSeed["entityType"],
          currentSeed: {
            entityType: link.entityType as RetrievalGraphSeed["entityType"],
            entityId: link.entityId,
            seedBoost: visited.seedBoost,
            seedReasons: visited.seedReasons,
          },
          linkReason: link.linkReason,
          linkWeight: link.weight,
        }) && visited.escalationUsed === false;
        if (visited && !escalationAllowed) continue;

        const current = nextSeedMap.get(key);
        const nextSeed: RetrievalGraphSeed = {
          entityType: link.entityType as RetrievalGraphSeed["entityType"],
          entityId: link.entityId,
          seedBoost: escalationAllowed
            ? Math.min(3.1, Math.max((visited?.seedBoost ?? 0) + 0.45, link.weight * (0.88 - hopDepth * 0.05)))
            : Math.min(2.8, Math.max(0.45, link.weight * (0.78 - hopDepth * 0.08))),
          seedReasons: uniqueNonEmpty([
            escalationAllowed
              ? `graph_escalated_${link.entityType}:${link.linkReason}`
              : `graph_hop:${link.linkReason}`,
          ]),
        };
        if (!current) {
          nextSeedMap.set(key, nextSeed);
          continue;
        }
        nextSeedMap.set(key, {
          ...current,
          seedBoost: Math.max(current.seedBoost, nextSeed.seedBoost),
          seedReasons: uniqueNonEmpty([...current.seedReasons, ...nextSeed.seedReasons]),
        });
      }

      frontierSeeds = Array.from(nextSeedMap.values())
        .sort((left, right) => right.seedBoost - left.seedBoost)
        .slice(0, Math.max(input.limit * 4, 48));
      for (const seed of frontierSeeds) {
        const key = `${seed.entityType}:${seed.entityId}`;
        const existing = visitedSeedState.get(key);
        visitedSeedState.set(key, {
          seedBoost: Math.max(existing?.seedBoost ?? 0, seed.seedBoost),
          seedReasons: uniqueNonEmpty([...(existing?.seedReasons ?? []), ...seed.seedReasons]),
          escalationUsed: Boolean(existing?.escalationUsed)
            || seed.seedReasons.some((reason) => reason.startsWith("graph_escalated_")),
        });
      }
    }

    hits = hits
      .sort((left, right) => {
        if (right.fusedScore !== left.fusedScore) return right.fusedScore - left.fusedScore;
        return right.updatedAt.getTime() - left.updatedAt.getTime();
      })
      .slice(0, input.limit);

    const graphHopDepthCounts: Record<string, number> = {};
    const graphEntityTypeCounts: Record<string, number> = {};
    for (const hit of hits) {
      const hopDepth = hit.graphMetadata?.hopDepth ?? 1;
      graphHopDepthCounts[String(hopDepth)] = (graphHopDepthCounts[String(hopDepth)] ?? 0) + 1;
      for (const entityType of hit.graphMetadata?.entityTypes ?? []) {
        graphEntityTypeCounts[entityType] = (graphEntityTypeCounts[entityType] ?? 0) + 1;
      }
    }

    return {
      hits,
      edgeTraversalCount,
      graphMaxDepth: hits.reduce((max, hit) => Math.max(max, hit.graphMetadata?.hopDepth ?? 1), 0),
      graphHopDepthCounts,
      graphEntityTypeCounts,
    };
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
        const baselineSignals = deriveDynamicRetrievalSignals({
          message: input.message,
          issue: input.issue,
          recipientRole: recipient.role,
          eventType,
          baselineSourceTypes: rerankConfig.preferredSourceTypes,
        });
        const executionLane = resolveExecutionLane({
          issueProjectId: input.issue.projectId,
          mentionedProjectCount: (input.issue.mentionedProjects ?? []).length,
          labelNames: (input.issue.labels ?? []).map((label) => label.name),
          recipientRole: recipient.role as "engineer" | "reviewer" | "tech_lead" | "pm" | "cto" | "qa" | "human_board",
          messageType: input.message.messageType,
          workflowStateAfter: input.message.workflowStateAfter,
          blockerCode: baselineSignals.blockerCode,
          questionType: baselineSignals.questionType,
          exactPaths: baselineSignals.exactPaths,
          acceptanceCriteriaCount: Array.isArray((input.message.payload as Record<string, unknown>).acceptanceCriteria)
            ? ((input.message.payload as Record<string, unknown>).acceptanceCriteria as unknown[]).length
            : 0,
          symbolHintCount: baselineSignals.symbolHints.length,
          internalWorkItemKind: null,
        });
        const lanePolicy = resolveLaneAwareRetrievalPolicy({
          lane: executionLane,
          policy,
          rerankConfig,
        });
        const laneRerankConfig = {
          ...rerankConfig,
          modelRerank: {
            ...rerankConfig.modelRerank,
            candidateCount: lanePolicy.modelRerankCandidateCount,
          },
        } satisfies RetrievalPolicyRerankConfig;
        const temporalContext = await deriveRetrievalTemporalContext({
          db,
          companyId: input.companyId,
          issueId: input.issueId,
          issueProjectId: input.issue.projectId,
          currentMessageSeq: input.triggeringMessageSeq,
        });
        const relevantProjectIds = uniqueNonEmpty([
          input.issue.projectId,
          ...baselineSignals.projectAffinityIds,
        ]);
        const projectRevisions = relevantProjectIds.length === 0
          ? []
          : await knowledge.listProjectKnowledgeRevisions({
            companyId: input.companyId,
            projectIds: relevantProjectIds,
          });
        const revisionSignature = buildKnowledgeRevisionSignature({
          companyId: input.companyId,
          issueProjectId: input.issue.projectId,
          projectAffinityIds: baselineSignals.projectAffinityIds,
          revisions: projectRevisions.map((revision) => ({
            projectId: revision.projectId,
            revision: revision.revision,
            lastHeadSha: revision.lastHeadSha ?? null,
            lastTreeSignature: revision.lastTreeSignature ?? null,
          })),
        });
        const primaryKnowledgeRevision = projectRevisions.find((revision) => revision.projectId === input.issue.projectId)?.revision ?? 0;
        const personalizationFingerprint = buildPersonalizationFingerprint(personalizationProfile);
        const dynamicSignals = applyPersonalizationSignals({
          signals: baselineSignals,
          profile: personalizationProfile,
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
            executionLane,
            issueProjectId: input.issue.projectId,
            mentionedProjectIds: (input.issue.mentionedProjects ?? []).map((project) => project.id),
            mentionedProjectNames: (input.issue.mentionedProjects ?? []).map((project) => project.name),
            projectAffinityIds: dynamicSignals.projectAffinityIds,
            exactPathCount: dynamicSignals.exactPaths.length,
            symbolHintCount: dynamicSignals.symbolHints.length,
            preferredSourceTypes: dynamicSignals.preferredSourceTypes,
            policySourcePreferences: rerankConfig.preferredSourceTypes,
            modelRerankEnabled: laneRerankConfig.modelRerank.enabled,
            lanePolicy: {
              topKDense: lanePolicy.topKDense,
              topKSparse: lanePolicy.topKSparse,
              rerankK: lanePolicy.rerankK,
              finalK: lanePolicy.finalK,
              chunkGraphMaxHops: lanePolicy.chunkGraphMaxHops,
            },
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
              candidateHit: false,
              finalHit: false,
              revisionSignature,
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
              injectedExactPathCount: Math.max(dynamicSignals.exactPaths.length - baselineSignals.exactPaths.length, 0),
              injectedSymbolHintCount: Math.max(dynamicSignals.symbolHints.length - baselineSignals.symbolHints.length, 0),
              injectedSourceTypeCount: Math.max(dynamicSignals.preferredSourceTypes.length - baselineSignals.preferredSourceTypes.length, 0),
            },
            ...queryEmbeddingDebug,
          },
        });

        const cachePolicyConfig = {
          ...laneRerankConfig,
          denseEnabled: Boolean(queryEmbedding),
        };
        const candidateCacheIdentity = buildRetrievalCacheIdentity({
          stage: "candidate_hits",
          queryText,
          companyId: input.companyId,
          issueProjectId: input.issue.projectId,
          executionLane,
          role: recipient.role,
          eventType,
          workflowState: input.message.workflowStateAfter,
          baselineSignals,
          temporalContext,
          allowedSourceTypes: policy.allowedSourceTypes,
          allowedAuthorityLevels: policy.allowedAuthorityLevels,
          rerankConfig: cachePolicyConfig,
          revisionSignature,
          personalizationFingerprint,
        });
        const finalCacheIdentity = buildRetrievalCacheIdentity({
          stage: "final_hits",
          queryText,
          companyId: input.companyId,
          issueProjectId: input.issue.projectId,
          executionLane,
          role: recipient.role,
          eventType,
          workflowState: input.message.workflowStateAfter,
          baselineSignals,
          temporalContext,
          allowedSourceTypes: policy.allowedSourceTypes,
          allowedAuthorityLevels: policy.allowedAuthorityLevels,
          rerankConfig: cachePolicyConfig,
          revisionSignature,
          personalizationFingerprint,
        });
        const candidateCacheKey = buildRetrievalStageCacheKey({
          stage: "candidate_hits",
          queryText,
          companyId: input.companyId,
          issueProjectId: input.issue.projectId,
          executionLane,
          role: recipient.role,
          eventType,
          workflowState: input.message.workflowStateAfter,
          allowedSourceTypes: policy.allowedSourceTypes,
          allowedAuthorityLevels: policy.allowedAuthorityLevels,
          rerankConfig: cachePolicyConfig,
          dynamicSignals,
          temporalContext,
          revisionSignature,
          personalizationFingerprint,
        });
        const finalCacheKey = buildRetrievalStageCacheKey({
          stage: "final_hits",
          queryText,
          companyId: input.companyId,
          issueProjectId: input.issue.projectId,
          executionLane,
          role: recipient.role,
          eventType,
          workflowState: input.message.workflowStateAfter,
          allowedSourceTypes: policy.allowedSourceTypes,
          allowedAuthorityLevels: policy.allowedAuthorityLevels,
          rerankConfig: cachePolicyConfig,
          dynamicSignals,
          temporalContext,
          revisionSignature,
          personalizationFingerprint,
        });

        const exactCandidateCacheEntry = await knowledge.getRetrievalCacheEntry({
          companyId: input.companyId,
          projectId: input.issue.projectId,
          stage: "candidate_hits",
          cacheKey: candidateCacheKey,
          knowledgeRevision: primaryKnowledgeRevision,
        });
        const candidateCacheEntry = exactCandidateCacheEntry ?? await knowledge.getCompatibleRetrievalCacheEntry({
          companyId: input.companyId,
          projectId: input.issue.projectId,
          stage: "candidate_hits",
          knowledgeRevision: primaryKnowledgeRevision,
          allowFeedbackDrift: true,
          identity: candidateCacheIdentity,
        });
        const candidateCacheInspection = candidateCacheEntry
          ? (() => {
            const entry = candidateCacheEntry!;
            const entryValue = asRecord(entry.valueJson);
            const entryMetadata = asRecord(entryValue?.metadata);
            const matchedIdentity = readRetrievalCacheIdentityView(
              entryMetadata?.cacheIdentity,
            );
            return buildRetrievalCacheInspectionResult({
              state: "hit",
              cacheKey: candidateCacheKey,
              requestedCacheKey: candidateCacheKey,
              matchedCacheKey: entry.cacheKey,
              provenance: resolveRetrievalCacheHitProvenance({
                requestedCacheKey: candidateCacheKey,
                matchedCacheKey: entry.cacheKey,
                requestedFeedbackFingerprint: candidateCacheIdentity.feedbackFingerprint,
                matchedFeedbackFingerprint: matchedIdentity.feedbackFingerprint,
              }),
              matchedRevision: entry.knowledgeRevision,
              latestKnownRevision: entry.knowledgeRevision,
              lastEntryUpdatedAt: entry.updatedAt,
            });
          })()
          : buildRetrievalCacheInspectionResult({
            cacheKey: candidateCacheKey,
            requestedCacheKey: candidateCacheKey,
            matchedCacheKey: null,
            ...(await knowledge.inspectRetrievalCacheEntryState({
              companyId: input.companyId,
              projectId: input.issue.projectId,
              stage: "candidate_hits",
              cacheKey: candidateCacheKey,
              knowledgeRevision: primaryKnowledgeRevision,
              identity: candidateCacheIdentity,
            })),
          });
        const cachedCandidatePayload = readRetrievalCachePayload(candidateCacheEntry?.valueJson);

        const exactFinalCacheEntry = await knowledge.getRetrievalCacheEntry({
          companyId: input.companyId,
          projectId: input.issue.projectId,
          stage: "final_hits",
          cacheKey: finalCacheKey,
          knowledgeRevision: primaryKnowledgeRevision,
        });
        const finalCacheEntry = exactFinalCacheEntry ?? await knowledge.getCompatibleRetrievalCacheEntry({
          companyId: input.companyId,
          projectId: input.issue.projectId,
          stage: "final_hits",
          knowledgeRevision: primaryKnowledgeRevision,
          allowFeedbackDrift: true,
          identity: finalCacheIdentity,
        });
        const finalCacheInspection = finalCacheEntry
          ? (() => {
            const entry = finalCacheEntry!;
            const entryValue = asRecord(entry.valueJson);
            const entryMetadata = asRecord(entryValue?.metadata);
            const matchedIdentity = readRetrievalCacheIdentityView(
              entryMetadata?.cacheIdentity,
            );
            return buildRetrievalCacheInspectionResult({
              state: "hit",
              cacheKey: finalCacheKey,
              requestedCacheKey: finalCacheKey,
              matchedCacheKey: entry.cacheKey,
              provenance: resolveRetrievalCacheHitProvenance({
                requestedCacheKey: finalCacheKey,
                matchedCacheKey: entry.cacheKey,
                requestedFeedbackFingerprint: finalCacheIdentity.feedbackFingerprint,
                matchedFeedbackFingerprint: matchedIdentity.feedbackFingerprint,
              }),
              matchedRevision: entry.knowledgeRevision,
              latestKnownRevision: entry.knowledgeRevision,
              lastEntryUpdatedAt: entry.updatedAt,
            });
          })()
          : buildRetrievalCacheInspectionResult({
            cacheKey: finalCacheKey,
            requestedCacheKey: finalCacheKey,
            matchedCacheKey: null,
            ...(await knowledge.inspectRetrievalCacheEntryState({
              companyId: input.companyId,
              projectId: input.issue.projectId,
              stage: "final_hits",
              cacheKey: finalCacheKey,
              knowledgeRevision: primaryKnowledgeRevision,
              identity: finalCacheIdentity,
            })),
          });
        const cachedFinalPayload = readRetrievalCachePayload(finalCacheEntry?.valueJson);

        let sparseHits: RetrievalCandidate[] = [];
        let pathHits: RetrievalCandidate[] = [];
        let symbolHits: RetrievalCandidate[] = [];
        let denseHits: RetrievalCandidate[] = [];
        let sparseHitCount = 0;
        let pathHitCount = 0;
        let symbolHitCount = 0;
        let denseHitCount = 0;
        let hits: RetrievalHitView[] = [];
        let candidateCacheHit = false;

        if (cachedCandidatePayload) {
          candidateCacheHit = true;
          hits = cachedCandidatePayload.hits;
          sparseHitCount = Number(cachedCandidatePayload.metadata.sparseHitCount ?? 0);
          pathHitCount = Number(cachedCandidatePayload.metadata.pathHitCount ?? 0);
          symbolHitCount = Number(cachedCandidatePayload.metadata.symbolHitCount ?? 0);
          denseHitCount = Number(cachedCandidatePayload.metadata.denseHitCount ?? 0);
        } else {
          [sparseHits, pathHits, symbolHits, denseHits] = await Promise.all([
            querySparseKnowledge({
              companyId: input.companyId,
              issueId: input.issueId,
              projectId: input.issue.projectId,
              projectAffinityIds: dynamicSignals.projectAffinityIds,
              queryText,
              allowedSourceTypes: policy.allowedSourceTypes,
              allowedAuthorityLevels: policy.allowedAuthorityLevels,
              limit: lanePolicy.topKSparse,
            }),
            queryPathKnowledge({
              companyId: input.companyId,
              exactPaths: dynamicSignals.exactPaths,
              allowedSourceTypes: policy.allowedSourceTypes,
              allowedAuthorityLevels: policy.allowedAuthorityLevels,
              limit: Math.min(lanePolicy.rerankK, Math.max(dynamicSignals.exactPaths.length * 2, 6)),
            }),
            querySymbolKnowledge({
              companyId: input.companyId,
              symbolHints: dynamicSignals.symbolHints,
              allowedSourceTypes: policy.allowedSourceTypes,
              allowedAuthorityLevels: policy.allowedAuthorityLevels,
              limit: Math.min(lanePolicy.rerankK, Math.max(dynamicSignals.symbolHints.length, 6)),
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
                limit: lanePolicy.topKDense,
              })
              : Promise.resolve([]),
          ]);

          sparseHitCount = sparseHits.length;
          pathHitCount = pathHits.length;
          symbolHitCount = symbolHits.length;
          denseHitCount = denseHits.length;
          console.log("[RETRIEVAL] Sparse hits:", sparseHitCount);
          console.log("[RETRIEVAL] Path hits:", pathHitCount);
          console.log("[RETRIEVAL] Symbol hits:", symbolHitCount);
          console.log("[RETRIEVAL] Dense hits:", denseHitCount);

          hits = fuseRetrievalCandidates({
            sparseHits: [...sparseHits, ...pathHits, ...symbolHits],
            denseHits,
            issueId: input.issueId,
            projectId: input.issue.projectId,
            projectAffinityIds: dynamicSignals.projectAffinityIds,
            finalK: Math.max(lanePolicy.rerankK, lanePolicy.finalK),
          });
          await knowledge.upsertRetrievalCacheEntry({
            companyId: input.companyId,
            projectId: input.issue.projectId,
            stage: "candidate_hits",
            cacheKey: candidateCacheKey,
            knowledgeRevision: primaryKnowledgeRevision,
            ttlSeconds: CANDIDATE_HIT_CACHE_TTL_SECONDS,
            valueJson: serializeRetrievalCachePayload({
              hits,
              quality: null,
              metadata: {
                sparseHitCount,
                pathHitCount,
                symbolHitCount,
                denseHitCount,
                cacheIdentity: candidateCacheIdentity,
              },
            }),
          });
        }

        console.log("[RETRIEVAL] Fused candidates:", hits.length);
        let finalHits: RetrievalHitView[] = [];
        let briefQuality: BriefQualitySummary | null = null;
        let graphSeeds: RetrievalGraphSeed[] = [];
        let chunkGraphResult: ChunkGraphExpansionResult = {
          hits: [],
          edgeTraversalCount: 0,
          graphMaxDepth: 0,
          graphHopDepthCounts: {},
          graphEntityTypeCounts: {},
        };
        let symbolGraphSeeds: RetrievalSymbolGraphSeed[] = [];
        let symbolGraphResult = {
          hits: [] as RetrievalHitView[],
          edgeTraversalCount: 0,
          edgeTypeCounts: {} as Record<string, number>,
          graphMaxDepth: 0,
          graphHopDepthCounts: {} as Record<string, number>,
        };
        const finalCacheHit = Boolean(cachedFinalPayload);

        if (cachedFinalPayload) {
          finalHits = cachedFinalPayload.hits;
          briefQuality = readCachedBriefQualitySummary(cachedFinalPayload.quality);
        } else {
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
              finalK: lanePolicy.finalK,
              rerankConfig: laneRerankConfig,
              personalizationProfile,
            });
          graphSeeds = buildGraphExpansionSeeds({
            hits: initialRerankedHits,
            linkMap,
            signals: dynamicSignals,
          });
          const chunkGraphLimit = Math.min(
            Math.max(lanePolicy.finalK * 3, graphSeeds.length * 3, 12),
            30,
          );
          chunkGraphResult = await queryGraphExpansionKnowledge({
            companyId: input.companyId,
            issueId: input.issueId,
            projectId: input.issue.projectId,
            projectAffinityIds: dynamicSignals.projectAffinityIds,
            seeds: graphSeeds,
            allowedSourceTypes: policy.allowedSourceTypes,
            allowedAuthorityLevels: policy.allowedAuthorityLevels,
            excludeChunkIds: hits.map((hit) => hit.chunkId),
            limit: chunkGraphLimit,
            maxHops: lanePolicy.chunkGraphMaxHops,
          });
          const graphLinkMap = chunkGraphResult.hits.length > 0
            ? await listRetrievalLinks(chunkGraphResult.hits.map((hit) => hit.chunkId))
            : new Map<string, RetrievalLinkView[]>();
          const combinedLinkMap = new Map(linkMap);
          for (const [chunkId, links] of graphLinkMap.entries()) {
            combinedLinkMap.set(chunkId, links);
          }
          const graphExpandedCandidates = chunkGraphResult.hits.length > 0
            ? mergeGraphExpandedHits({
              baseHits: hits,
              graphHits: chunkGraphResult.hits,
              finalK: Math.max(lanePolicy.rerankK, lanePolicy.finalK) + chunkGraphResult.hits.length,
            })
            : hits;
          const rerankedHits = chunkGraphResult.hits.length > 0
            ? rerankRetrievalHits({
              hits: graphExpandedCandidates,
              signals: dynamicSignals,
              issueId: input.issueId,
              projectId: input.issue.projectId,
              projectAffinityIds: dynamicSignals.projectAffinityIds,
              linkMap: combinedLinkMap,
              temporalContext,
              documentVersionMap: await listDocumentVersionsForRetrieval({
                db,
                companyId: input.companyId,
                documentIds: uniqueNonEmpty(graphExpandedCandidates.map((hit) => hit.documentId)),
              }),
              finalK: lanePolicy.finalK,
              rerankConfig: laneRerankConfig,
              personalizationProfile,
            })
            : initialRerankedHits;
          const chunkSymbolMap = await listChunkSymbols(rerankedHits.map((hit) => hit.chunkId));
          symbolGraphSeeds = buildSymbolGraphExpansionSeeds({
            hits: rerankedHits,
            chunkSymbolMap,
          });
          const symbolGraphLimit = Math.min(
            Math.max(lanePolicy.finalK * 3, symbolGraphSeeds.length * 3, 12),
            30,
          );
          symbolGraphResult = await querySymbolGraphExpansionKnowledge({
            companyId: input.companyId,
            symbolSeeds: symbolGraphSeeds,
            excludeChunkIds: rerankedHits.map((hit) => hit.chunkId),
            allowedSourceTypes: policy.allowedSourceTypes,
            allowedAuthorityLevels: policy.allowedAuthorityLevels,
            limit: symbolGraphLimit,
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
                  finalK: Math.max(lanePolicy.rerankK, lanePolicy.finalK) + symbolGraphResult.hits.length,
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
                    finalK: Math.max(lanePolicy.rerankK, lanePolicy.finalK) + symbolGraphResult.hits.length,
                  }).map((hit) => hit.documentId),
                ),
              }),
              finalK: lanePolicy.finalK,
              rerankConfig: laneRerankConfig,
              personalizationProfile,
            })
            : rerankedHits;
          finalHits = symbolExpandedHits;
          if (laneRerankConfig.modelRerank.enabled && modelReranker.isConfigured() && symbolExpandedHits.length > 1) {
            try {
              const modelResult = await modelReranker.rerankCandidates({
                queryText,
                recipientRole: recipient.role,
                workflowState: input.message.workflowStateAfter,
                summary: input.message.summary,
                candidates: symbolExpandedHits.slice(0, lanePolicy.modelRerankCandidateCount).map((hit) => ({
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
                finalK: lanePolicy.finalK,
                modelRerank: laneRerankConfig.modelRerank,
              });
            } catch {
              finalHits = symbolExpandedHits;
            }
          } else {
            finalHits = symbolExpandedHits;
          }
          finalHits = applyGraphConnectivityGuard({
              hits: applyOrganizationalBridgeGuard({
                hits: applyEvidenceDiversityGuard({
                  hits: finalHits,
                  finalK: lanePolicy.finalK,
                  signals: dynamicSignals,
                }),
                finalK: lanePolicy.finalK,
                signals: dynamicSignals,
              }),
              finalK: lanePolicy.finalK,
              signals: dynamicSignals,
            }).slice(0, lanePolicy.finalK);
          if (pathHits.length > 0) {
            const exactPathFallbackHits = rerankRetrievalHits({
              hits: pathHits.map((hit) => ({
                ...hit,
                fusedScore: hit.fusedScore ?? 0,
              })),
              signals: dynamicSignals,
              issueId: input.issueId,
              projectId: input.issue.projectId,
              projectAffinityIds: dynamicSignals.projectAffinityIds,
              linkMap: symbolCombinedLinkMap,
              temporalContext,
              documentVersionMap: await listDocumentVersionsForRetrieval({
                db,
                companyId: input.companyId,
                documentIds: uniqueNonEmpty(pathHits.map((hit) => hit.documentId)),
              }),
              finalK: Math.max(lanePolicy.finalK, pathHits.length),
              rerankConfig: laneRerankConfig,
              personalizationProfile,
            }).filter((hit) => isExecutableEvidenceSourceType(hit.sourceType));
            finalHits = applyGraphConnectivityGuard({
              hits: applyEvidenceDiversityGuard({
                hits: appendUniqueRetrievalHits(finalHits, exactPathFallbackHits),
                finalK: lanePolicy.finalK,
                signals: dynamicSignals,
              }),
              finalK: lanePolicy.finalK,
              signals: dynamicSignals,
            }).slice(0, lanePolicy.finalK);
          }

          const graphHits = finalHits.filter((hit) => hit.graphMetadata != null);
          const multiHopGraphHitCount = finalHits.filter((hit) => (hit.graphMetadata?.hopDepth ?? 1) > 1).length;
          const exactPathSatisfied = isExactPathSatisfied({
            finalHits,
            exactPaths: dynamicSignals.exactPaths,
          });
          briefQuality = summarizeBriefQuality({
            finalHits,
            queryEmbedding,
            sparseHitCount,
            pathHitCount,
            symbolHitCount,
            denseHitCount,
            graphSeedCount: graphSeeds.length + symbolGraphSeeds.length,
            graphHitCount: graphHits.length,
            graphEntityTypes: uniqueNonEmpty(graphHits.flatMap((hit) => hit.graphMetadata?.entityTypes ?? [])),
            symbolGraphSeedCount: symbolGraphSeeds.length,
            symbolGraphHitCount: symbolGraphResult.hits.length,
            edgeTraversalCount: chunkGraphResult.edgeTraversalCount + symbolGraphResult.edgeTraversalCount,
            edgeTypeCounts: symbolGraphResult.edgeTypeCounts,
            graphMaxDepth: Math.max(chunkGraphResult.graphMaxDepth, symbolGraphResult.graphMaxDepth),
            graphHopDepthCounts: {
              ...chunkGraphResult.graphHopDepthCounts,
              ...Object.fromEntries(
                Object.entries(symbolGraphResult.graphHopDepthCounts).map(([key, value]) => [
                  key,
                  (chunkGraphResult.graphHopDepthCounts[key] ?? 0) + value,
                ]),
              ),
            },
            multiHopGraphHitCount,
            temporalContext,
            crossProjectRequested: dynamicSignals.projectAffinityIds.length > 1,
            candidateCacheHit,
            finalCacheHit: false,
            candidateCacheInspection,
            finalCacheInspection,
            exactPathSatisfied,
          });

          await knowledge.upsertRetrievalCacheEntry({
            companyId: input.companyId,
            projectId: input.issue.projectId,
            stage: "final_hits",
            cacheKey: finalCacheKey,
            knowledgeRevision: primaryKnowledgeRevision,
            ttlSeconds: FINAL_HIT_CACHE_TTL_SECONDS,
            valueJson: serializeRetrievalCachePayload({
              hits: finalHits,
              quality: briefQuality as unknown as Record<string, unknown>,
              metadata: {
                graphSeedCount: graphSeeds.length,
                symbolGraphSeedCount: symbolGraphSeeds.length,
                cacheIdentity: finalCacheIdentity,
              },
            }),
          });
        }

        if (!briefQuality) {
          const exactPathSatisfied = isExactPathSatisfied({
            finalHits,
            exactPaths: dynamicSignals.exactPaths,
          });
          briefQuality = summarizeBriefQuality({
            finalHits,
            queryEmbedding,
            sparseHitCount,
            pathHitCount,
            symbolHitCount,
            denseHitCount,
            graphSeedCount: graphSeeds.length + symbolGraphSeeds.length,
            graphHitCount: finalHits.filter((hit) => hit.graphMetadata != null).length,
            graphEntityTypes: uniqueNonEmpty(finalHits.flatMap((hit) => hit.graphMetadata?.entityTypes ?? [])),
            symbolGraphSeedCount: symbolGraphSeeds.length,
            symbolGraphHitCount: symbolGraphResult.hits.length,
            edgeTraversalCount: chunkGraphResult.edgeTraversalCount + symbolGraphResult.edgeTraversalCount,
            edgeTypeCounts: symbolGraphResult.edgeTypeCounts,
            graphMaxDepth: Math.max(chunkGraphResult.graphMaxDepth, symbolGraphResult.graphMaxDepth),
            graphHopDepthCounts: {
              ...chunkGraphResult.graphHopDepthCounts,
              ...Object.fromEntries(
                Object.entries(symbolGraphResult.graphHopDepthCounts).map(([key, value]) => [
                  key,
                  (chunkGraphResult.graphHopDepthCounts[key] ?? 0) + value,
                ]),
              ),
            },
            multiHopGraphHitCount: finalHits.filter((hit) => (hit.graphMetadata?.hopDepth ?? 1) > 1).length,
            temporalContext,
            crossProjectRequested: dynamicSignals.projectAffinityIds.length > 1,
            candidateCacheHit,
            finalCacheHit,
            candidateCacheInspection,
            finalCacheInspection,
            exactPathSatisfied,
          });
        } else {
          briefQuality = {
            ...briefQuality,
            candidateCacheHit,
            finalCacheHit,
            candidateCacheReason: candidateCacheInspection.reason,
            finalCacheReason: finalCacheInspection.reason,
            candidateCacheProvenance: candidateCacheInspection.provenance,
            finalCacheProvenance: finalCacheInspection.provenance,
            exactPathSatisfied: isExactPathSatisfied({
              finalHits,
              exactPaths: dynamicSignals.exactPaths,
            }),
          };
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
                weights: DEFAULT_RETRIEVAL_RERANK_WEIGHTS,
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
        const combinedGraphHopDepthCounts = {
          ...chunkGraphResult.graphHopDepthCounts,
          ...Object.fromEntries(
            Object.entries(symbolGraphResult.graphHopDepthCounts).map(([key, value]) => [
              key,
              (chunkGraphResult.graphHopDepthCounts[key] ?? 0) + value,
            ]),
          ),
        };
        const combinedGraphMaxDepth = Math.max(chunkGraphResult.graphMaxDepth, symbolGraphResult.graphMaxDepth);
        if (!briefQuality) {
          const exactPathSatisfied = isExactPathSatisfied({
            finalHits,
            exactPaths: dynamicSignals.exactPaths,
          });
          briefQuality = summarizeBriefQuality({
            finalHits,
            queryEmbedding,
            sparseHitCount,
            pathHitCount,
            symbolHitCount,
            denseHitCount,
            graphSeedCount: graphSeeds.length + symbolGraphSeeds.length,
            graphHitCount: graphHits.length,
            graphEntityTypes: uniqueNonEmpty(graphHits.flatMap((hit) => hit.graphMetadata?.entityTypes ?? [])),
            symbolGraphSeedCount: symbolGraphSeeds.length,
            symbolGraphHitCount: symbolGraphResult.hits.length,
            edgeTraversalCount: chunkGraphResult.edgeTraversalCount + symbolGraphResult.edgeTraversalCount,
            edgeTypeCounts: symbolGraphResult.edgeTypeCounts,
            graphMaxDepth: combinedGraphMaxDepth,
            graphHopDepthCounts: combinedGraphHopDepthCounts,
            multiHopGraphHitCount,
            temporalContext,
            crossProjectRequested: dynamicSignals.projectAffinityIds.length > 1,
            candidateCacheHit,
            finalCacheHit,
            candidateCacheInspection,
            finalCacheInspection,
            exactPathSatisfied,
          });
        }
        const resolvedBriefQuality = briefQuality;

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
            maxEvidenceItems: lanePolicy.maxEvidenceItems,
          }),
          contentJson: {
            eventType,
            triggeringMessageId: input.triggeringMessageId,
            executionLane,
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
          quality: resolvedBriefQuality,
          hitProjectIds: uniqueNonEmpty(finalHits.map((hit) => hit.documentProjectId ?? "")),
          topHitProjectId: finalHits[0]?.documentProjectId ?? null,
          topHitPath: finalHits[0]?.path ?? null,
          topHitSourceType: finalHits[0]?.sourceType ?? null,
          topHitArtifactKind: readMetadataString(finalHits[0]?.documentMetadata ?? {}, "artifactKind"),
          graphSeedCount: graphSeeds.length + symbolGraphSeeds.length,
          graphSeedTypes: uniqueNonEmpty([
            ...graphSeeds.map((seed) => seed.entityType),
            ...(symbolGraphSeeds.length > 0 ? ["symbol_graph"] : []),
          ]),
          graphHitCount: graphHits.length,
          graphEntityTypes: uniqueNonEmpty(graphHits.flatMap((hit) => hit.graphMetadata?.entityTypes ?? [])),
          symbolGraphSeedCount: symbolGraphSeeds.length,
          symbolGraphHitCount: symbolGraphResult.hits.length,
          edgeTraversalCount: chunkGraphResult.edgeTraversalCount + symbolGraphResult.edgeTraversalCount,
          edgeTypeCounts: symbolGraphResult.edgeTypeCounts,
          graphMaxDepth: combinedGraphMaxDepth,
          graphHopDepthCounts: combinedGraphHopDepthCounts,
          multiHopGraphHitCount,
          temporalContext,
          cache: {
            embeddingHit: queryEmbeddingDebug.embeddingCacheHit === true,
            candidateHit: candidateCacheHit,
            finalHit: finalCacheHit,
            revisionSignature,
            candidateState: candidateCacheInspection.state,
            candidateReason: candidateCacheInspection.reason,
            candidateProvenance: candidateCacheInspection.provenance,
            candidateMatchedRevision: candidateCacheInspection.matchedRevision,
            candidateLatestKnownRevision: candidateCacheInspection.latestKnownRevision,
            candidateLastEntryUpdatedAt: candidateCacheInspection.lastEntryUpdatedAt,
            candidateCacheKeyFingerprint: candidateCacheInspection.cacheKeyFingerprint,
            candidateRequestedCacheKeyFingerprint: candidateCacheInspection.requestedCacheKeyFingerprint,
            candidateMatchedCacheKeyFingerprint: candidateCacheInspection.matchedCacheKeyFingerprint,
            finalState: finalCacheInspection.state,
            finalReason: finalCacheInspection.reason,
            finalProvenance: finalCacheInspection.provenance,
            finalMatchedRevision: finalCacheInspection.matchedRevision,
            finalLatestKnownRevision: finalCacheInspection.latestKnownRevision,
            finalLastEntryUpdatedAt: finalCacheInspection.lastEntryUpdatedAt,
            finalCacheKeyFingerprint: finalCacheInspection.cacheKeyFingerprint,
            finalRequestedCacheKeyFingerprint: finalCacheInspection.requestedCacheKeyFingerprint,
            finalMatchedCacheKeyFingerprint: finalCacheInspection.matchedCacheKeyFingerprint,
          },
          exactPathSatisfied: isExactPathSatisfied({
            finalHits,
            exactPaths: dynamicSignals.exactPaths,
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
            personalizedHitCount: resolvedBriefQuality.personalizedHitCount,
            averagePersonalizationBoost: resolvedBriefQuality.averagePersonalizationBoost,
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
            briefQuality: resolvedBriefQuality.confidenceLevel,
            briefDenseEnabled: resolvedBriefQuality.denseEnabled,
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
            briefQuality: resolvedBriefQuality.confidenceLevel,
            briefDenseEnabled: resolvedBriefQuality.denseEnabled,
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
          executionLane,
          retrievalRunId: retrievalRun.id,
          briefId: brief.id,
          briefScope,
          briefContentMarkdown: brief.contentMarkdown,
          briefEvidenceSummary: finalHits.slice(0, lanePolicy.maxEvidenceItems).map((hit, index) => ({
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
