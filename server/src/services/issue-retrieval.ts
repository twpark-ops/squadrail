import path from "node:path";
import { and, desc, eq, inArray, not, or, sql } from "drizzle-orm";
import type { Db } from "@squadrail/db";
import {
  codeSymbolEdges,
  codeSymbols,
  issueMergeCandidates,
  issueProtocolArtifacts,
  issueProtocolMessages,
  issues,
  knowledgeChunkLinks,
  knowledgeChunks,
  knowledgeDocumentVersions,
  knowledgeDocuments,
} from "@squadrail/db";
import {
  KNOWLEDGE_CODE_REUSE_SOURCE_TYPES,
  KNOWLEDGE_PM_CANONICAL_SOURCE_TYPES,
  KNOWLEDGE_SUMMARY_SOURCE_TYPES,
  type CreateIssueProtocolMessage,
} from "@squadrail/shared";
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
  applyTopHitConcreteEvidenceGuard,
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
  buildRetrievalQueryText,
  deriveBriefScope,
  deriveDynamicRetrievalSignals,
  deriveRetrievalEventType,
  selectProtocolRetrievalRecipients,
  type RetrievalBriefScope,
  type RetrievalEventType,
  type RetrievalTargetRole,
} from "./retrieval/query.js";
import {
  computeRetrievalReuseSummary,
  isExactPathSatisfied,
  summarizeBriefQuality,
  type BriefQualitySummary,
  type RetrievalReuseSummary,
} from "./retrieval/quality.js";
import {
  buildHitRationale,
  computeAuthorityBoost,
  computeCurrentIssueArtifactPenalty,
  computeDocumentPathBoost,
  computeExecutablePathBridgeBoost,
  computeFreshnessBoost,
  computeLatestBoost,
  computeOrganizationalMemoryPenalty,
  computeRelatedIssueReuseBoost,
  computeScopeBoost,
  computeSummaryMetadataBoost,
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
  normalizeIssueIdentifier,
  normalizeHintPath,
  truncateRetrievalSegment,
  uniqueNonEmpty,
} from "./retrieval/shared.js";

export {
  applyEvidenceDiversityGuard,
  applyGraphConnectivityGuard,
  applyOrganizationalBridgeGuard,
  applyOrganizationalMemorySaturationGuard,
  applyTopHitConcreteEvidenceGuard,
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
export {
  buildRetrievalQueryText,
  deriveBriefScope,
  deriveDynamicRetrievalSignals,
  deriveRetrievalEventType,
  selectProtocolRetrievalRecipients,
} from "./retrieval/query.js";
export { computeRetrievalReuseSummary } from "./retrieval/quality.js";
export { fuseRetrievalCandidates } from "./retrieval/scoring.js";

const QUERY_EMBEDDING_CACHE_TTL_SECONDS = 24 * 60 * 60;
const CANDIDATE_HIT_CACHE_TTL_SECONDS = 20 * 60;
const FINAL_HIT_CACHE_TTL_SECONDS = 10 * 60;
const CHUNK_GRAPH_EXPANSION_MAX_HOPS = 3;

export function buildQueryEmbeddingCacheKey(input: {
  queryText: string;
  embeddingFingerprint: string;
}) {
  return hashString(`${input.embeddingFingerprint}\n${input.queryText}`);
}

export function readCachedEmbedding(entryValue: Record<string, unknown> | null | undefined) {
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
      | "top_hit_executable_evidence"
      | "organizational_bridge_exact_path"
      | "organizational_bridge_related_path"
      | "graph_multihop_code"
      | "graph_multihop_context";
    replacedSourceType: string | null;
  } | null;
}

export function serializeRetrievalHit(hit: RetrievalHitView) {
  return {
    ...hit,
    updatedAt: hit.updatedAt.toISOString(),
  };
}

export function deserializeRetrievalHit(value: unknown): RetrievalHitView | null {
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

export function readCachedRetrievalHits(value: unknown) {
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

export interface RetrievalCachePayload {
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

export function readRetrievalCachePayload(value: unknown): RetrievalCachePayload | null {
  const payload = readCachedRetrievalHits(value);
  if (!payload) return null;
  return payload;
}

export function serializeRetrievalCachePayload(input: RetrievalCachePayload) {
  return {
    hits: input.hits.map((hit) => serializeRetrievalHit(hit)),
    quality: input.quality ?? null,
    metadata: input.metadata,
  };
}

export function readCachedBriefQualitySummary(value: Record<string, unknown> | null | undefined): BriefQualitySummary | null {
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
    requestedRelatedIssueCount: typeof value.requestedRelatedIssueCount === "number" ? value.requestedRelatedIssueCount : 0,
    reuseHitCount: typeof value.reuseHitCount === "number" ? value.reuseHitCount : 0,
    reusedIssueCount: typeof value.reusedIssueCount === "number" ? value.reusedIssueCount : 0,
    reusedIssueIds: Array.isArray(value.reusedIssueIds)
      ? value.reusedIssueIds.filter((entry): entry is string => typeof entry === "string")
      : [],
    reusedIssueIdentifiers: Array.isArray(value.reusedIssueIdentifiers)
      ? value.reusedIssueIdentifiers.filter((entry): entry is string => typeof entry === "string")
      : [],
    reuseArtifactKinds: Array.isArray(value.reuseArtifactKinds)
      ? value.reuseArtifactKinds.filter((entry): entry is string => typeof entry === "string")
      : [],
    reuseDecisionHitCount: typeof value.reuseDecisionHitCount === "number" ? value.reuseDecisionHitCount : 0,
    reuseFixHitCount: typeof value.reuseFixHitCount === "number" ? value.reuseFixHitCount : 0,
    reuseReviewHitCount: typeof value.reuseReviewHitCount === "number" ? value.reuseReviewHitCount : 0,
    reuseCloseHitCount: typeof value.reuseCloseHitCount === "number" ? value.reuseCloseHitCount : 0,
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
  lexicalTerms: string[];
  symbolHints: string[];
  knowledgeTags: string[];
  preferredSourceTypes: string[];
  projectAffinityIds: string[];
  projectAffinityNames: string[];
  relatedIssueIds?: string[];
  relatedIssueIdentifiers?: string[];
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

export interface RetrievalCacheIdentityView {
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
  summaryOwnerTagMatchBoost: 0.75,
  summarySupportTagMatchBoost: 0.35,
  summaryAvoidTagPenalty: -0.9,
  summaryFileContextBoost: 0.16,
  summarySymbolContextBoost: 0.12,
  summaryMaxBoost: 1.9,
  summaryMinBoost: -1.9,
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
  relatedIssueDecisionBoost: 0.2,
  relatedIssueFixBoost: 0.32,
  relatedIssueReviewBoost: 0.42,
  relatedIssueCloseBoost: 0.48,
} as const satisfies RetrievalRerankWeights;

export function readRetrievalCacheIdentityView(value: unknown): RetrievalCacheIdentityView {
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

export function resolveRetrievalCacheHitProvenance(input: {
  requestedCacheKey: string;
  matchedCacheKey: string;
  requestedFeedbackFingerprint: string | null;
  matchedFeedbackFingerprint: string | null;
}): RetrievalCacheHitProvenance {
  if (input.requestedCacheKey === input.matchedCacheKey) return "exact_key";
  if (input.requestedFeedbackFingerprint !== input.matchedFeedbackFingerprint) return "feedback_drift";
  return "normalized_input";
}

export function buildKnowledgeRevisionSignature(input: {
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

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function asStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return uniqueNonEmpty(value.filter((entry): entry is string => typeof entry === "string"));
}

export function asNumberRecord(value: unknown) {
  const record = asRecord(value);
  if (!record) return {};

  const numericEntries = Object.entries(record).filter(([, candidate]) =>
    typeof candidate === "number" && Number.isFinite(candidate),
  );
  return Object.fromEntries(numericEntries) as Record<string, number>;
}

export function readConfiguredNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function dbVectorLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

export function normalizeEmbeddingVector(values: unknown) {
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
    summaryOwnerTagMatchBoost: readConfiguredNumber(
      weightsRecord.summaryOwnerTagMatchBoost,
      DEFAULT_RETRIEVAL_RERANK_WEIGHTS.summaryOwnerTagMatchBoost,
    ),
    summarySupportTagMatchBoost: readConfiguredNumber(
      weightsRecord.summarySupportTagMatchBoost,
      DEFAULT_RETRIEVAL_RERANK_WEIGHTS.summarySupportTagMatchBoost,
    ),
    summaryAvoidTagPenalty: readConfiguredNumber(
      weightsRecord.summaryAvoidTagPenalty,
      DEFAULT_RETRIEVAL_RERANK_WEIGHTS.summaryAvoidTagPenalty,
    ),
    summaryFileContextBoost: readConfiguredNumber(
      weightsRecord.summaryFileContextBoost,
      DEFAULT_RETRIEVAL_RERANK_WEIGHTS.summaryFileContextBoost,
    ),
    summarySymbolContextBoost: readConfiguredNumber(
      weightsRecord.summarySymbolContextBoost,
      DEFAULT_RETRIEVAL_RERANK_WEIGHTS.summarySymbolContextBoost,
    ),
    summaryMaxBoost: readConfiguredNumber(
      weightsRecord.summaryMaxBoost,
      DEFAULT_RETRIEVAL_RERANK_WEIGHTS.summaryMaxBoost,
    ),
    summaryMinBoost: readConfiguredNumber(
      weightsRecord.summaryMinBoost,
      DEFAULT_RETRIEVAL_RERANK_WEIGHTS.summaryMinBoost,
    ),
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
    relatedIssueDecisionBoost: readConfiguredNumber(
      weightsRecord.relatedIssueDecisionBoost,
      DEFAULT_RETRIEVAL_RERANK_WEIGHTS.relatedIssueDecisionBoost,
    ),
    relatedIssueFixBoost: readConfiguredNumber(
      weightsRecord.relatedIssueFixBoost,
      DEFAULT_RETRIEVAL_RERANK_WEIGHTS.relatedIssueFixBoost,
    ),
    relatedIssueReviewBoost: readConfiguredNumber(
      weightsRecord.relatedIssueReviewBoost,
      DEFAULT_RETRIEVAL_RERANK_WEIGHTS.relatedIssueReviewBoost,
    ),
    relatedIssueCloseBoost: readConfiguredNumber(
      weightsRecord.relatedIssueCloseBoost,
      DEFAULT_RETRIEVAL_RERANK_WEIGHTS.relatedIssueCloseBoost,
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

type RetrievalCacheInspectionSummary = {
  state: string;
  reason: string | null;
  provenance: string | null;
  matchedRevision: number | string | null;
  latestKnownRevision: number | string | null;
  lastEntryUpdatedAt: string | null;
  cacheKeyFingerprint: string;
  requestedCacheKeyFingerprint: string;
  matchedCacheKeyFingerprint: string | null;
};

export function buildRecipientBriefEvidenceSummary(input: {
  hits: RetrievalHitView[];
  maxEvidenceItems: number;
}) {
  return input.hits.slice(0, input.maxEvidenceItems).map((hit, index) => ({
    rank: index + 1,
    sourceType: hit.sourceType,
    authorityLevel: hit.authorityLevel,
    path: hit.path,
    title: hit.title,
    symbolName: hit.symbolName,
    fusedScore: hit.fusedScore,
  }));
}

export function buildRetrievalRunDebugPatch(input: {
  quality: BriefQualitySummary;
  finalHits: RetrievalHitView[];
  relatedIssueIds: string[];
  relatedIssueIdentifiers: string[];
  reuseSummary: RetrievalReuseSummary | null;
  graphSeeds: Array<{ entityType: string }>;
  symbolGraphSeeds: Array<unknown>;
  briefGraphHits: RetrievalHitView[];
  symbolGraphHitCount: number;
  edgeTraversalCount: number;
  edgeTypeCounts: Record<string, number>;
  graphMaxDepth: number;
  graphHopDepthCounts: Record<string, number>;
  multiHopGraphHitCount: number;
  temporalContext: Record<string, unknown> | null;
  queryEmbeddingCacheHit: boolean;
  candidateCacheHit: boolean;
  finalCacheHit: boolean;
  revisionSignature: string | null;
  candidateCacheInspection: RetrievalCacheInspectionSummary;
  finalCacheInspection: RetrievalCacheInspectionSummary;
  exactPathSatisfied: boolean;
  personalizationProfile: RetrievalPersonalizationProfile;
}) {
  return {
    quality: input.quality,
    hitProjectIds: uniqueNonEmpty(input.finalHits.map((hit) => hit.documentProjectId ?? "")),
    topHitProjectId: input.finalHits[0]?.documentProjectId ?? null,
    topHitPath: input.finalHits[0]?.path ?? null,
    topHitSourceType: input.finalHits[0]?.sourceType ?? null,
    topHitArtifactKind: readMetadataString(input.finalHits[0]?.documentMetadata ?? {}, "artifactKind"),
    relatedIssueIds: input.relatedIssueIds,
    relatedIssueIdentifiers: input.relatedIssueIdentifiers,
    reusedIssueIds: input.reuseSummary?.reusedIssueIds ?? [],
    reusedIssueIdentifiers: input.reuseSummary?.reusedIssueIdentifiers ?? [],
    reuseArtifactKinds: input.reuseSummary?.reuseArtifactKinds ?? [],
    reuseHitCount: input.reuseSummary?.reuseHitCount ?? 0,
    reuseDecisionHitCount: input.reuseSummary?.reuseDecisionHitCount ?? 0,
    reuseFixHitCount: input.reuseSummary?.reuseFixHitCount ?? 0,
    reuseReviewHitCount: input.reuseSummary?.reuseReviewHitCount ?? 0,
    reuseCloseHitCount: input.reuseSummary?.reuseCloseHitCount ?? 0,
    graphSeedCount: input.graphSeeds.length + input.symbolGraphSeeds.length,
    graphSeedTypes: uniqueNonEmpty([
      ...input.graphSeeds.map((seed) => seed.entityType),
      ...(input.symbolGraphSeeds.length > 0 ? ["symbol_graph"] : []),
    ]),
    graphHitCount: input.briefGraphHits.length,
    graphEntityTypes: uniqueNonEmpty(input.briefGraphHits.flatMap((hit) => hit.graphMetadata?.entityTypes ?? [])),
    symbolGraphSeedCount: input.symbolGraphSeeds.length,
    symbolGraphHitCount: input.symbolGraphHitCount,
    edgeTraversalCount: input.edgeTraversalCount,
    edgeTypeCounts: input.edgeTypeCounts,
    graphMaxDepth: input.graphMaxDepth,
    graphHopDepthCounts: input.graphHopDepthCounts,
    multiHopGraphHitCount: input.multiHopGraphHitCount,
    temporalContext: input.temporalContext,
    cache: {
      embeddingHit: input.queryEmbeddingCacheHit,
      candidateHit: input.candidateCacheHit,
      finalHit: input.finalCacheHit,
      revisionSignature: input.revisionSignature,
      candidateState: input.candidateCacheInspection.state,
      candidateReason: input.candidateCacheInspection.reason,
      candidateProvenance: input.candidateCacheInspection.provenance,
      candidateMatchedRevision: input.candidateCacheInspection.matchedRevision,
      candidateLatestKnownRevision: input.candidateCacheInspection.latestKnownRevision,
      candidateLastEntryUpdatedAt: input.candidateCacheInspection.lastEntryUpdatedAt,
      candidateCacheKeyFingerprint: input.candidateCacheInspection.cacheKeyFingerprint,
      candidateRequestedCacheKeyFingerprint: input.candidateCacheInspection.requestedCacheKeyFingerprint,
      candidateMatchedCacheKeyFingerprint: input.candidateCacheInspection.matchedCacheKeyFingerprint,
      finalState: input.finalCacheInspection.state,
      finalReason: input.finalCacheInspection.reason,
      finalProvenance: input.finalCacheInspection.provenance,
      finalMatchedRevision: input.finalCacheInspection.matchedRevision,
      finalLatestKnownRevision: input.finalCacheInspection.latestKnownRevision,
      finalLastEntryUpdatedAt: input.finalCacheInspection.lastEntryUpdatedAt,
      finalCacheKeyFingerprint: input.finalCacheInspection.cacheKeyFingerprint,
      finalRequestedCacheKeyFingerprint: input.finalCacheInspection.requestedCacheKeyFingerprint,
      finalMatchedCacheKeyFingerprint: input.finalCacheInspection.matchedCacheKeyFingerprint,
    },
    exactPathSatisfied: input.exactPathSatisfied,
    personalization: {
      applied: input.personalizationProfile.applied,
      scopes: input.personalizationProfile.scopes,
      feedbackCount: input.personalizationProfile.feedbackCount,
      positiveFeedbackCount: input.personalizationProfile.positiveFeedbackCount,
      negativeFeedbackCount: input.personalizationProfile.negativeFeedbackCount,
      sourceTypeKeyCount: Object.keys(input.personalizationProfile.sourceTypeBoosts).length,
      pathKeyCount: Object.keys(input.personalizationProfile.pathBoosts).length,
      symbolKeyCount: Object.keys(input.personalizationProfile.symbolBoosts).length,
      personalizedHitCount: input.quality.personalizedHitCount,
      averagePersonalizationBoost: input.quality.averagePersonalizationBoost,
    },
  };
}

export function buildRetrievalRunCompletionActivityDetails(input: {
  retrievalRunId: string;
  triggeringMessageId: string;
  recipientRole: string;
  recipientId: string;
  hitCount: number;
  briefQuality: BriefQualitySummary;
  briefId: string;
  briefScope: string;
}) {
  return {
    retrievalRunId: input.retrievalRunId,
    triggeringMessageId: input.triggeringMessageId,
    recipientRole: input.recipientRole,
    recipientId: input.recipientId,
    hitCount: input.hitCount,
    briefQuality: input.briefQuality.confidenceLevel,
    briefDenseEnabled: input.briefQuality.denseEnabled,
    briefId: input.briefId,
    briefScope: input.briefScope,
  };
}

export function buildRetrievalRunCompletionEvents(input: {
  companyId: string;
  issueId: string;
  retrievalRunId: string;
  recipientRole: string;
  recipientId: string;
  hitCount: number;
  briefQuality: BriefQualitySummary;
  briefId: string;
  briefScope: string;
  briefVersion: number;
}) {
  return [
    {
      companyId: input.companyId,
      type: "retrieval.run.completed" as const,
      payload: {
        issueId: input.issueId,
        retrievalRunId: input.retrievalRunId,
        recipientRole: input.recipientRole,
        recipientId: input.recipientId,
        hitCount: input.hitCount,
        briefQuality: input.briefQuality.confidenceLevel,
        briefDenseEnabled: input.briefQuality.denseEnabled,
      },
    },
    {
      companyId: input.companyId,
      type: "issue.brief.updated" as const,
      payload: {
        issueId: input.issueId,
        briefId: input.briefId,
        briefScope: input.briefScope,
        briefVersion: input.briefVersion,
        retrievalRunId: input.retrievalRunId,
      },
    },
  ];
}

export function buildRecipientRetrievalHint(input: {
  recipientId: string;
  recipientRole: string;
  executionLane: ExecutionLane;
  retrievalRunId: string;
  briefId: string;
  briefScope: string;
  briefContentMarkdown: string;
  hits: RetrievalHitView[];
  maxEvidenceItems: number;
}) {
  return {
    recipientId: input.recipientId,
    recipientRole: input.recipientRole,
    executionLane: input.executionLane,
    retrievalRunId: input.retrievalRunId,
    briefId: input.briefId,
    briefScope: input.briefScope,
    briefContentMarkdown: input.briefContentMarkdown,
    briefEvidenceSummary: buildRecipientBriefEvidenceSummary({
      hits: input.hits,
      maxEvidenceItems: input.maxEvidenceItems,
    }),
  } satisfies RecipientRetrievalHint;
}

export function buildTaskBriefContentJson(input: {
  eventType: RetrievalEventType;
  triggeringMessageId: string;
  executionLane: ExecutionLane;
  queryText: string;
  dynamicSignals: RetrievalSignals;
  quality: BriefQualitySummary;
  hits: RetrievalHitView[];
}) {
  return {
    eventType: input.eventType,
    triggeringMessageId: input.triggeringMessageId,
    executionLane: input.executionLane,
    queryText: input.queryText,
    dynamicSignals: input.dynamicSignals,
    quality: input.quality,
    hits: input.hits.map((hit, index) => ({
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
  };
}

export function buildRetrievalBriefDraft(input: {
  eventType: RetrievalEventType;
  triggeringMessageId: string;
  recipientRole: string;
  issue: {
    identifier: string | null;
    title: string;
  };
  message: CreateIssueProtocolMessage;
  queryText: string;
  executionLane: ExecutionLane;
  dynamicSignals: RetrievalSignals;
  quality: BriefQualitySummary;
  hits: RetrievalHitView[];
  maxEvidenceItems: number;
}) {
  const briefScope = deriveBriefScope({
    eventType: input.eventType,
    recipientRole: input.recipientRole,
  });

  // QA execution gate: pin runbook/test_report to the top of the brief and
  // warn when no runbook is available.
  let briefHits = input.hits;
  if (briefScope === "qa") {
    const hasRunbookHit = input.hits.some((hit) => hit.sourceType === "runbook");
    if (!hasRunbookHit && !input.quality.degradedReasons.includes("qa_runbook_missing")) {
      input.quality.degradedReasons.push("qa_runbook_missing");
    }
    // Pin runbook and test_report hits to the top so QA reads execution
    // context before code/issue/review evidence.
    const pinnedTypes = new Set(["runbook", "test_report"]);
    const pinned = input.hits.filter((hit) => pinnedTypes.has(hit.sourceType));
    const rest = input.hits.filter((hit) => !pinnedTypes.has(hit.sourceType));
    briefHits = [...pinned, ...rest];
  }

  return {
    briefScope,
    contentMarkdown: renderRetrievedBriefMarkdown({
      briefScope,
      issue: input.issue,
      message: input.message,
      queryText: input.queryText,
      hits: briefHits,
      maxEvidenceItems: input.maxEvidenceItems,
    }),
    contentJson: buildTaskBriefContentJson({
      eventType: input.eventType,
      triggeringMessageId: input.triggeringMessageId,
      executionLane: input.executionLane,
      queryText: input.queryText,
      dynamicSignals: input.dynamicSignals,
      quality: input.quality,
      hits: input.hits,
    }),
  };
}

export function buildRetrievalCompletionArtifacts(input: {
  companyId: string;
  issueId: string;
  retrievalRunId: string;
  triggeringMessageId: string;
  recipientRole: string;
  recipientId: string;
  executionLane: ExecutionLane;
  brief: {
    id: string;
    briefScope: string;
    briefVersion: number;
    contentMarkdown: string;
  };
  finalHits: RetrievalHitView[];
  briefQuality: BriefQualitySummary;
  relatedIssueIds: string[];
  relatedIssueIdentifiers: string[];
  reuseSummary: RetrievalReuseSummary | null;
  graphSeeds: Array<{ entityType: string }>;
  symbolGraphSeeds: Array<unknown>;
  briefGraphHits: RetrievalHitView[];
  symbolGraphHitCount: number;
  edgeTraversalCount: number;
  edgeTypeCounts: Record<string, number>;
  graphMaxDepth: number;
  graphHopDepthCounts: Record<string, number>;
  multiHopGraphHitCount: number;
  temporalContext: Record<string, unknown> | null;
  queryEmbeddingCacheHit: boolean;
  candidateCacheHit: boolean;
  finalCacheHit: boolean;
  revisionSignature: string | null;
  candidateCacheInspection: RetrievalCacheInspectionSummary;
  finalCacheInspection: RetrievalCacheInspectionSummary;
  exactPathSatisfied: boolean;
  personalizationProfile: RetrievalPersonalizationProfile;
  maxEvidenceItems: number;
}) {
  const retrievalRunDebugPatch = buildRetrievalRunDebugPatch({
    quality: input.briefQuality,
    finalHits: input.finalHits,
    relatedIssueIds: input.relatedIssueIds,
    relatedIssueIdentifiers: input.relatedIssueIdentifiers,
    reuseSummary: input.reuseSummary,
    graphSeeds: input.graphSeeds,
    symbolGraphSeeds: input.symbolGraphSeeds,
    briefGraphHits: input.briefGraphHits,
    symbolGraphHitCount: input.symbolGraphHitCount,
    edgeTraversalCount: input.edgeTraversalCount,
    edgeTypeCounts: input.edgeTypeCounts,
    graphMaxDepth: input.graphMaxDepth,
    graphHopDepthCounts: input.graphHopDepthCounts,
    multiHopGraphHitCount: input.multiHopGraphHitCount,
    temporalContext: input.temporalContext,
    queryEmbeddingCacheHit: input.queryEmbeddingCacheHit,
    candidateCacheHit: input.candidateCacheHit,
    finalCacheHit: input.finalCacheHit,
    revisionSignature: input.revisionSignature,
    candidateCacheInspection: input.candidateCacheInspection,
    finalCacheInspection: input.finalCacheInspection,
    exactPathSatisfied: input.exactPathSatisfied,
    personalizationProfile: input.personalizationProfile,
  });

  return {
    retrievalRunDebugPatch,
    activityDetails: buildRetrievalRunCompletionActivityDetails({
      retrievalRunId: input.retrievalRunId,
      triggeringMessageId: input.triggeringMessageId,
      recipientRole: input.recipientRole,
      recipientId: input.recipientId,
      hitCount: input.finalHits.length,
      briefQuality: input.briefQuality,
      briefId: input.brief.id,
      briefScope: input.brief.briefScope,
    }),
    completionEvents: buildRetrievalRunCompletionEvents({
      companyId: input.companyId,
      issueId: input.issueId,
      retrievalRunId: input.retrievalRunId,
      recipientRole: input.recipientRole,
      recipientId: input.recipientId,
      hitCount: input.finalHits.length,
      briefQuality: input.briefQuality,
      briefId: input.brief.id,
      briefScope: input.brief.briefScope,
      briefVersion: input.brief.briefVersion,
    }),
    recipientHint: buildRecipientRetrievalHint({
      recipientId: input.recipientId,
      recipientRole: input.recipientRole,
      executionLane: input.executionLane,
      retrievalRunId: input.retrievalRunId,
      briefId: input.brief.id,
      briefScope: input.brief.briefScope,
      briefContentMarkdown: input.brief.contentMarkdown,
      hits: input.finalHits,
      maxEvidenceItems: input.maxEvidenceItems,
    }),
  };
}

export function buildRetrievalCompletionPersistencePlan(input: {
  retrievalRunId: string;
  briefId: string;
  recipientRole: string;
  recipientId: string;
  artifacts: ReturnType<typeof buildRetrievalCompletionArtifacts>;
}) {
  return {
    retrievalRunLink: {
      retrievalRunId: input.retrievalRunId,
      briefId: input.briefId,
    },
    retrievalRunDebugPatch: input.artifacts.retrievalRunDebugPatch,
    activityDetails: input.artifacts.activityDetails,
    completionEvents: input.artifacts.completionEvents,
    recipientHint: input.artifacts.recipientHint,
    retrievalRunRecord: {
      retrievalRunId: input.retrievalRunId,
      briefId: input.briefId,
      recipientRole: input.recipientRole,
      recipientId: input.recipientId,
    },
  };
}

export async function applyRetrievalCompletionPersistencePlan(input: {
  db: Db;
  companyId: string;
  issueId: string;
  actor: {
    actorType: "user" | "agent" | "system";
    actorId: string;
  };
  plan: ReturnType<typeof buildRetrievalCompletionPersistencePlan>;
  knowledge: Pick<ReturnType<typeof knowledgeService>, "linkRetrievalRunToBrief" | "updateRetrievalRunDebug">;
  recipientHints: RecipientRetrievalHint[];
  retrievalRuns: Array<{
    retrievalRunId: string;
    briefId: string;
    recipientRole: string;
    recipientId: string;
  }>;
  logActivityFn?: typeof logActivity;
  publishEvent?: typeof publishLiveEvent;
}) {
  const logActivityFn = input.logActivityFn ?? logActivity;
  const publishEvent = input.publishEvent ?? publishLiveEvent;

  await input.knowledge.linkRetrievalRunToBrief(
    input.plan.retrievalRunLink.retrievalRunId,
    input.plan.retrievalRunLink.briefId,
  );
  await input.knowledge.updateRetrievalRunDebug(
    input.plan.retrievalRunLink.retrievalRunId,
    input.plan.retrievalRunDebugPatch,
  );
  await logActivityFn(input.db, {
    companyId: input.companyId,
    actorType: input.actor.actorType,
    actorId: input.actor.actorId,
    action: "retrieval.run.completed",
    entityType: "issue",
    entityId: input.issueId,
    details: input.plan.activityDetails,
  });

  for (const event of input.plan.completionEvents) publishEvent(event);
  input.recipientHints.push(input.plan.recipientHint);
  input.retrievalRuns.push(input.plan.retrievalRunRecord);
}

export function buildCombinedGraphMetrics(
  chunkGraphResult: ChunkGraphExpansionResult,
  symbolGraphResult: {
    hits: RetrievalHitView[];
    edgeTraversalCount: number;
    edgeTypeCounts: Record<string, number>;
    graphMaxDepth: number;
    graphHopDepthCounts: Record<string, number>;
  },
) {
  return {
    combinedGraphHopDepthCounts: {
      ...chunkGraphResult.graphHopDepthCounts,
      ...Object.fromEntries(
        Object.entries(symbolGraphResult.graphHopDepthCounts).map(([key, value]) => [
          key,
          (chunkGraphResult.graphHopDepthCounts[key] ?? 0) + value,
        ]),
      ),
    },
    combinedGraphMaxDepth: Math.max(chunkGraphResult.graphMaxDepth, symbolGraphResult.graphMaxDepth),
  };
}

export function buildRecipientFinalizationMetrics(input: {
  finalHits: RetrievalHitView[];
  chunkGraphResult: ChunkGraphExpansionResult;
  symbolGraphResult: {
    hits: RetrievalHitView[];
    edgeTraversalCount: number;
    edgeTypeCounts: Record<string, number>;
    graphMaxDepth: number;
    graphHopDepthCounts: Record<string, number>;
  };
  exactPaths: string[];
}) {
  const combinedGraphMetrics = buildCombinedGraphMetrics(input.chunkGraphResult, input.symbolGraphResult);
  return {
    briefGraphHits: input.finalHits.filter((hit) => hit.graphMetadata != null),
    symbolGraphHitCount: input.symbolGraphResult.hits.length,
    edgeTraversalCount: input.chunkGraphResult.edgeTraversalCount + input.symbolGraphResult.edgeTraversalCount,
    edgeTypeCounts: input.symbolGraphResult.edgeTypeCounts,
    graphMaxDepth: combinedGraphMetrics.combinedGraphMaxDepth,
    graphHopDepthCounts: combinedGraphMetrics.combinedGraphHopDepthCounts,
    multiHopGraphHitCount: input.finalHits.filter((hit) => (hit.graphMetadata?.hopDepth ?? 1) > 1).length,
    exactPathSatisfied: isExactPathSatisfied({
      finalHits: input.finalHits,
      exactPaths: input.exactPaths,
    }),
  };
}

export function resolveRecipientBriefQuality(input: {
  finalHits: RetrievalHitView[];
  queryEmbedding: number[] | null;
  sparseHitCount: number;
  pathHitCount: number;
  symbolHitCount: number;
  denseHitCount: number;
  graphSeedCount: number;
  symbolGraphSeedCount: number;
  symbolGraphHitCount: number;
  edgeTraversalCount: number;
  edgeTypeCounts: Record<string, number>;
  graphMaxDepth: number;
  graphHopDepthCounts: Record<string, number>;
  temporalContext: RetrievalTemporalContext | null;
  exactPaths: string[];
  projectAffinityIds: string[];
  candidateCacheHit: boolean;
  finalCacheHit: boolean;
  candidateCacheInspection: Pick<RetrievalCacheInspectionResult, "reason" | "provenance">;
  finalCacheInspection: Pick<RetrievalCacheInspectionResult, "reason" | "provenance">;
  relatedIssueIds: string[];
  relatedIssueIdentifierMap: Record<string, string>;
  reuseSummary: RetrievalReuseSummary;
  existingBriefQuality: BriefQualitySummary | null;
}): BriefQualitySummary {
  const graphHits = input.finalHits.filter((hit) => hit.graphMetadata != null);
  const multiHopGraphHitCount = input.finalHits.filter((hit) => (hit.graphMetadata?.hopDepth ?? 1) > 1).length;
  const exactPathSatisfied = isExactPathSatisfied({
    finalHits: input.finalHits,
    exactPaths: input.exactPaths,
  });

  if (!input.existingBriefQuality) {
    return summarizeBriefQuality({
      finalHits: input.finalHits,
      queryEmbedding: input.queryEmbedding,
      sparseHitCount: input.sparseHitCount,
      pathHitCount: input.pathHitCount,
      symbolHitCount: input.symbolHitCount,
      denseHitCount: input.denseHitCount,
      graphSeedCount: input.graphSeedCount,
      graphHitCount: graphHits.length,
      graphEntityTypes: uniqueNonEmpty(graphHits.flatMap((hit) => hit.graphMetadata?.entityTypes ?? [])),
      symbolGraphSeedCount: input.symbolGraphSeedCount,
      symbolGraphHitCount: input.symbolGraphHitCount,
      edgeTraversalCount: input.edgeTraversalCount,
      edgeTypeCounts: input.edgeTypeCounts,
      graphMaxDepth: input.graphMaxDepth,
      graphHopDepthCounts: input.graphHopDepthCounts,
      multiHopGraphHitCount,
      temporalContext: input.temporalContext,
      crossProjectRequested: input.projectAffinityIds.length > 1,
      candidateCacheHit: input.candidateCacheHit,
      finalCacheHit: input.finalCacheHit,
      candidateCacheInspection: input.candidateCacheInspection,
      finalCacheInspection: input.finalCacheInspection,
      exactPathSatisfied,
      relatedIssueIds: input.relatedIssueIds,
      relatedIssueIdentifierMap: input.relatedIssueIdentifierMap,
      reuseSummary: input.reuseSummary,
    });
  }

  return {
    ...input.existingBriefQuality,
    candidateCacheHit: input.candidateCacheHit,
    finalCacheHit: input.finalCacheHit,
    candidateCacheReason: input.candidateCacheInspection.reason,
    finalCacheReason: input.finalCacheInspection.reason,
    candidateCacheProvenance: input.candidateCacheInspection.provenance,
    finalCacheProvenance: input.finalCacheInspection.provenance,
    exactPathSatisfied,
    requestedRelatedIssueCount: input.reuseSummary.requestedRelatedIssueCount,
    reuseHitCount: input.reuseSummary.reuseHitCount,
    reusedIssueCount: input.reuseSummary.reusedIssueCount,
    reusedIssueIds: input.reuseSummary.reusedIssueIds,
    reusedIssueIdentifiers: input.reuseSummary.reusedIssueIdentifiers,
    reuseArtifactKinds: input.reuseSummary.reuseArtifactKinds,
    reuseDecisionHitCount: input.reuseSummary.reuseDecisionHitCount,
    reuseFixHitCount: input.reuseSummary.reuseFixHitCount,
    reuseReviewHitCount: input.reuseSummary.reuseReviewHitCount,
    reuseCloseHitCount: input.reuseSummary.reuseCloseHitCount,
  };
}

export function defaultPolicyTemplate(input: {
  role: RetrievalTargetRole;
  eventType: RetrievalEventType;
  workflowState: string;
}) {
  const engineerSources = [...KNOWLEDGE_CODE_REUSE_SOURCE_TYPES, "review", "adr", "runbook", "issue"];
  const reviewerSources = [...KNOWLEDGE_CODE_REUSE_SOURCE_TYPES, "review", "adr", "runbook", "issue"];
  const leadSources = [...KNOWLEDGE_PM_CANONICAL_SOURCE_TYPES, "issue", "protocol_message", "review", "code"];
  const boardSources = ["prd", "adr", "issue", "review", "protocol_message", "runbook", ...KNOWLEDGE_SUMMARY_SOURCE_TYPES];
  const ctoSources = [...KNOWLEDGE_PM_CANONICAL_SOURCE_TYPES, "issue", "review", "protocol_message"];
  const pmSources = ["prd", "issue", "adr", "runbook", "protocol_message", "review", ...KNOWLEDGE_SUMMARY_SOURCE_TYPES];
  // QA sources: runbook first — QA must know HOW to execute before reviewing evidence.
  const qaSources = ["runbook", "test_report", "issue", "review", "code", "adr", ...KNOWLEDGE_SUMMARY_SOURCE_TYPES];

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

export function resolveLaneAwareRetrievalPolicy(input: {
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

export function shouldEscalateGraphSeed(input: {
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

export function readMetadataString(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export async function listDocumentVersionsForRetrieval(input: {
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

export async function deriveRetrievalTemporalContext(input: {
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

export function computeTemporalBoost(input: {
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

export function computeLinkBoost(input: {
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
    if (link.entityType === "issue" && (input.signals.relatedIssueIds ?? []).includes(link.entityId)) {
      score += Math.max(
        input.weights.issueLinkMinBoost * 0.75,
        link.weight * input.weights.issueLinkWeightMultiplier * 0.75,
      );
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

export function computeGraphConnectivityBoost(input: {
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

export async function listRelatedIssueIdentifierMap(input: {
  db: Db;
  companyId: string;
  issueIds: string[];
}) {
  const issueIds = uniqueNonEmpty(input.issueIds);
  if (issueIds.length === 0) return {} as Record<string, string>;

  const rows = await input.db
    .select({
      id: issues.id,
      identifier: issues.identifier,
    })
    .from(issues)
    .where(and(
      eq(issues.companyId, input.companyId),
      inArray(issues.id, issueIds),
    ));

  return Object.fromEntries(
    rows.map((row) => [row.id, row.identifier ?? row.id] as const),
  );
}

export async function listRelatedIssueIdsByIdentifiers(input: {
  db: Db;
  companyId: string;
  identifiers: string[];
}) {
  const identifiers = uniqueNonEmpty(input.identifiers.map((identifier) => normalizeIssueIdentifier(identifier)));
  if (identifiers.length === 0) return {} as Record<string, string>;

  const rows = await input.db
    .select({
      id: issues.id,
      identifier: issues.identifier,
    })
    .from(issues)
    .where(and(
      eq(issues.companyId, input.companyId),
      inArray(issues.identifier, identifiers),
    ));

  return Object.fromEntries(
    rows
      .filter((row): row is typeof row & { identifier: string } => typeof row.identifier === "string" && row.identifier.length > 0)
      .map((row) => [row.id, row.identifier] as const),
  );
}

export async function listBacklinkedRelatedIssueIds(input: {
  db: Db;
  companyId: string;
  issueId: string;
}) {
  const rows = await input.db
    .select({
      documentIssueId: knowledgeDocuments.issueId,
    })
    .from(knowledgeChunkLinks)
    .innerJoin(knowledgeChunks, eq(knowledgeChunkLinks.chunkId, knowledgeChunks.id))
    .innerJoin(knowledgeDocuments, eq(knowledgeChunks.documentId, knowledgeDocuments.id))
    .where(and(
      eq(knowledgeChunkLinks.companyId, input.companyId),
      eq(knowledgeChunkLinks.entityType, "issue"),
      eq(knowledgeChunkLinks.entityId, input.issueId),
      sql`${knowledgeDocuments.issueId} is not null`,
      sql`${knowledgeDocuments.issueId} <> ${input.issueId}`,
      sql`${knowledgeDocuments.authorityLevel} <> 'deprecated'`,
    ))
    .orderBy(desc(knowledgeChunkLinks.weight), desc(knowledgeDocuments.updatedAt))
    .limit(24);

  return uniqueNonEmpty(
    rows.map((row) => (typeof row.documentIssueId === "string" ? row.documentIssueId : null)),
  );
}

export async function resolveRelatedIssueSignals(input: {
  db: Db;
  companyId: string;
  issueId: string;
  issueIdentifier: string | null;
  signals: RetrievalSignals;
  backlinkedIssueIds: string[];
}) {
  const currentIssueIdentifier = input.issueIdentifier ? normalizeIssueIdentifier(input.issueIdentifier) : null;
  const referencedIdentifiers = uniqueNonEmpty((input.signals.relatedIssueIdentifiers ?? [])
    .map((identifier) => normalizeIssueIdentifier(identifier))
    .filter((identifier) => identifier !== currentIssueIdentifier));
  const identifierMatches = await listRelatedIssueIdsByIdentifiers({
    db: input.db,
    companyId: input.companyId,
    identifiers: referencedIdentifiers,
  });
  const relatedIssueIds = uniqueNonEmpty([
    ...(input.signals.relatedIssueIds ?? []),
    ...Object.keys(identifierMatches),
    ...input.backlinkedIssueIds,
  ]).filter((issueId) => issueId !== input.issueId);

  return {
    ...input.signals,
    preferredSourceTypes: relatedIssueIds.length > 0
      ? uniqueNonEmpty(["review", "protocol_message", "issue", ...input.signals.preferredSourceTypes])
      : input.signals.preferredSourceTypes,
    relatedIssueIds,
    relatedIssueIdentifiers: uniqueNonEmpty([
      ...referencedIdentifiers,
      ...Object.values(identifierMatches),
    ]),
  } satisfies RetrievalSignals;
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
      const currentIssueArtifactPenalty = computeCurrentIssueArtifactPenalty({
        hit,
        issueId: input.issueId,
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
        + computeSummaryMetadataBoost(hit, input.signals, rerankConfig.weights)
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
        + computeRelatedIssueReuseBoost({
          hit,
          signals: input.signals,
          weights: rerankConfig.weights,
        })
        + organizationalMemoryPenalty
        + currentIssueArtifactPenalty;
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
    hits: applyTopHitConcreteEvidenceGuard({
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
    lexicalTerms: string[];
    allowedSourceTypes: string[];
    allowedAuthorityLevels: string[];
    limit: number;
  }) {
    const fullTextQuery = sql`plainto_tsquery('simple', ${input.queryText})`;
    const lexicalSearchQuery = uniqueNonEmpty(input.lexicalTerms)
      .slice(0, 24)
      .map((term) => `"${term.replace(/"/g, " ").trim()}"`)
      .join(" OR ");
    const lexicalTokenQuery = lexicalSearchQuery.length > 0
      ? sql`websearch_to_tsquery('simple', ${lexicalSearchQuery})`
      : null;
    const lexicalMatch = lexicalTokenQuery
      ? sql<boolean>`${knowledgeChunks.searchTsv} @@ ${lexicalTokenQuery}`
      : sql<boolean>`false`;
    const strictMatch = sql<boolean>`${knowledgeChunks.searchTsv} @@ ${fullTextQuery}`;
    const sparseScore = lexicalTokenQuery
      ? sql<number>`(
          case when ${lexicalMatch} then ts_rank_cd(${knowledgeChunks.searchTsv}, ${lexicalTokenQuery}) else 0 end
          + case when ${strictMatch} then ts_rank_cd(${knowledgeChunks.searchTsv}, ${fullTextQuery}) * 0.35 else 0 end
        )`
      : sql<number>`case when ${strictMatch} then ts_rank_cd(${knowledgeChunks.searchTsv}, ${fullTextQuery}) else 0 end`;
    const allScopedProjectIds = uniqueNonEmpty([
      input.projectId ?? "",
      ...input.projectAffinityIds,
    ]);
    const scopeMatch = allScopedProjectIds.length > 0
      ? or(eq(knowledgeDocuments.issueId, input.issueId), inArray(knowledgeDocuments.projectId, allScopedProjectIds))
      : eq(knowledgeDocuments.issueId, input.issueId);
    const scopeRank = allScopedProjectIds.length > 0
      ? sql<number>`case
          when ${knowledgeDocuments.issueId} = ${input.issueId} then 2
          when ${knowledgeDocuments.projectId} = ${input.projectId} then 1
          when ${knowledgeDocuments.projectId} in ${sql`(${sql.join(allScopedProjectIds.map((value) => sql`${value}`), sql`, `)})`} then 0.75
          else 0
        end`
      : sql<number>`case when ${knowledgeDocuments.issueId} = ${input.issueId} then 1 else 0 end`;
    const sparseMatch = lexicalTokenQuery ? or(lexicalMatch, strictMatch) : scopeMatch;

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
          sparseMatch,
        ),
      )
      .orderBy(desc(scopeRank), desc(sparseScore), desc(knowledgeDocuments.updatedAt))
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
    relatedIssueIds: string[];
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
                relatedIssueIds: input.relatedIssueIds,
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
      let backlinkedRelatedIssueIdsPromise: Promise<string[]> | null = null;
      const getBacklinkedRelatedIssueIds = () => {
        if (!backlinkedRelatedIssueIdsPromise) {
          backlinkedRelatedIssueIdsPromise = listBacklinkedRelatedIssueIds({
            db,
            companyId: input.companyId,
            issueId: input.issueId,
          });
        }
        return backlinkedRelatedIssueIdsPromise;
      };

      const prepareRecipientRetrievalContext = async (recipient: (typeof uniqueRecipients)[number]) => {
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
        const rawBaselineSignals = deriveDynamicRetrievalSignals({
          message: input.message,
          issue: input.issue,
          recipientRole: recipient.role,
          eventType,
          baselineSourceTypes: rerankConfig.preferredSourceTypes,
        });
        const baselineSignals = await resolveRelatedIssueSignals({
          db,
          companyId: input.companyId,
          issueId: input.issueId,
          issueIdentifier: input.issue.identifier,
          signals: rawBaselineSignals,
          backlinkedIssueIds: await getBacklinkedRelatedIssueIds(),
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
        const relatedIssueIds = dynamicSignals.relatedIssueIds ?? [];
        const relatedIssueIdentifierMap = await listRelatedIssueIdentifierMap({
          db,
          companyId: input.companyId,
          issueIds: relatedIssueIds,
        });
        const relatedIssueIdentifiers = relatedIssueIds.map(
          (issueId) => relatedIssueIdentifierMap[issueId] ?? issueId,
        );

        return {
          policy,
          rerankConfig,
          personalizationProfile,
          queryText,
          baselineSignals,
          executionLane,
          lanePolicy,
          laneRerankConfig,
          temporalContext,
          primaryKnowledgeRevision,
          revisionSignature,
          personalizationFingerprint,
          dynamicSignals,
          relatedIssueIds,
          relatedIssueIdentifierMap,
          relatedIssueIdentifiers,
        };
      };
      type PreparedRecipientRetrievalContext = Awaited<ReturnType<typeof prepareRecipientRetrievalContext>>;

      const resolveRecipientQueryEmbedding = async (
        context: Pick<PreparedRecipientRetrievalContext, "queryText">,
      ) => {
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
                queryText: context.queryText,
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
              const embeddingResult = await embeddings.generateEmbeddings([context.queryText]);
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
            console.error(
              "[RETRIEVAL] Embedding provider not available. Dense search disabled. " +
              "Set OPENAI_API_KEY or SQUADRAIL_KNOWLEDGE_OPENAI_API_KEY environment variable."
            );
          }
        } catch (err) {
          console.error(
            "[RETRIEVAL] Embedding generation failed:",
            err instanceof Error ? err.message : String(err)
          );
          queryEmbeddingDebug = {
            denseEnabled: false,
            embeddingError: err instanceof Error ? err.message : String(err),
          };
        }

        return {
          queryEmbedding,
          queryEmbeddingDebug,
        };
      };

      const resolveRecipientCandidateStage = async (
        recipient: (typeof uniqueRecipients)[number],
        context: PreparedRecipientRetrievalContext,
        queryEmbedding: number[] | null,
      ) => {
        const cachePolicyConfig = {
          ...context.laneRerankConfig,
          denseEnabled: Boolean(queryEmbedding),
        };
        const candidateCacheIdentity = buildRetrievalCacheIdentity({
          stage: "candidate_hits",
          queryText: context.queryText,
          companyId: input.companyId,
          issueProjectId: input.issue.projectId,
          executionLane: context.executionLane,
          role: recipient.role,
          eventType,
          workflowState: input.message.workflowStateAfter,
          baselineSignals: context.baselineSignals,
          temporalContext: context.temporalContext,
          allowedSourceTypes: context.policy.allowedSourceTypes,
          allowedAuthorityLevels: context.policy.allowedAuthorityLevels,
          rerankConfig: cachePolicyConfig,
          revisionSignature: context.revisionSignature,
          personalizationFingerprint: context.personalizationFingerprint,
        });
        const finalCacheIdentity = buildRetrievalCacheIdentity({
          stage: "final_hits",
          queryText: context.queryText,
          companyId: input.companyId,
          issueProjectId: input.issue.projectId,
          executionLane: context.executionLane,
          role: recipient.role,
          eventType,
          workflowState: input.message.workflowStateAfter,
          baselineSignals: context.baselineSignals,
          temporalContext: context.temporalContext,
          allowedSourceTypes: context.policy.allowedSourceTypes,
          allowedAuthorityLevels: context.policy.allowedAuthorityLevels,
          rerankConfig: cachePolicyConfig,
          revisionSignature: context.revisionSignature,
          personalizationFingerprint: context.personalizationFingerprint,
        });
        const candidateCacheKey = buildRetrievalStageCacheKey({
          stage: "candidate_hits",
          queryText: context.queryText,
          companyId: input.companyId,
          issueProjectId: input.issue.projectId,
          executionLane: context.executionLane,
          role: recipient.role,
          eventType,
          workflowState: input.message.workflowStateAfter,
          allowedSourceTypes: context.policy.allowedSourceTypes,
          allowedAuthorityLevels: context.policy.allowedAuthorityLevels,
          rerankConfig: cachePolicyConfig,
          dynamicSignals: context.dynamicSignals,
          temporalContext: context.temporalContext,
          revisionSignature: context.revisionSignature,
          personalizationFingerprint: context.personalizationFingerprint,
        });
        const finalCacheKey = buildRetrievalStageCacheKey({
          stage: "final_hits",
          queryText: context.queryText,
          companyId: input.companyId,
          issueProjectId: input.issue.projectId,
          executionLane: context.executionLane,
          role: recipient.role,
          eventType,
          workflowState: input.message.workflowStateAfter,
          allowedSourceTypes: context.policy.allowedSourceTypes,
          allowedAuthorityLevels: context.policy.allowedAuthorityLevels,
          rerankConfig: cachePolicyConfig,
          dynamicSignals: context.dynamicSignals,
          temporalContext: context.temporalContext,
          revisionSignature: context.revisionSignature,
          personalizationFingerprint: context.personalizationFingerprint,
        });

        const exactCandidateCacheEntry = await knowledge.getRetrievalCacheEntry({
          companyId: input.companyId,
          projectId: input.issue.projectId,
          stage: "candidate_hits",
          cacheKey: candidateCacheKey,
          knowledgeRevision: context.primaryKnowledgeRevision,
        });
        const candidateCacheEntry = exactCandidateCacheEntry ?? await knowledge.getCompatibleRetrievalCacheEntry({
          companyId: input.companyId,
          projectId: input.issue.projectId,
          stage: "candidate_hits",
          knowledgeRevision: context.primaryKnowledgeRevision,
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
              knowledgeRevision: context.primaryKnowledgeRevision,
              identity: candidateCacheIdentity,
            })),
          });
        const cachedCandidatePayload = readRetrievalCachePayload(candidateCacheEntry?.valueJson);

        const exactFinalCacheEntry = await knowledge.getRetrievalCacheEntry({
          companyId: input.companyId,
          projectId: input.issue.projectId,
          stage: "final_hits",
          cacheKey: finalCacheKey,
          knowledgeRevision: context.primaryKnowledgeRevision,
        });
        const finalCacheEntry = exactFinalCacheEntry ?? await knowledge.getCompatibleRetrievalCacheEntry({
          companyId: input.companyId,
          projectId: input.issue.projectId,
          stage: "final_hits",
          knowledgeRevision: context.primaryKnowledgeRevision,
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
              knowledgeRevision: context.primaryKnowledgeRevision,
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
              projectAffinityIds: context.dynamicSignals.projectAffinityIds,
              queryText: context.queryText,
              lexicalTerms: context.dynamicSignals.lexicalTerms,
              allowedSourceTypes: context.policy.allowedSourceTypes,
              allowedAuthorityLevels: context.policy.allowedAuthorityLevels,
              limit: context.lanePolicy.topKSparse,
            }),
            queryPathKnowledge({
              companyId: input.companyId,
              exactPaths: context.dynamicSignals.exactPaths,
              allowedSourceTypes: context.policy.allowedSourceTypes,
              allowedAuthorityLevels: context.policy.allowedAuthorityLevels,
              limit: Math.min(context.lanePolicy.rerankK, Math.max(context.dynamicSignals.exactPaths.length * 2, 6)),
            }),
            querySymbolKnowledge({
              companyId: input.companyId,
              symbolHints: context.dynamicSignals.symbolHints,
              allowedSourceTypes: context.policy.allowedSourceTypes,
              allowedAuthorityLevels: context.policy.allowedAuthorityLevels,
              limit: Math.min(context.lanePolicy.rerankK, Math.max(context.dynamicSignals.symbolHints.length, 6)),
            }),
            queryEmbedding
              ? queryDenseKnowledge({
                companyId: input.companyId,
                issueId: input.issueId,
                projectId: input.issue.projectId,
                projectAffinityIds: context.dynamicSignals.projectAffinityIds,
                queryEmbedding,
                allowedSourceTypes: context.policy.allowedSourceTypes,
                allowedAuthorityLevels: context.policy.allowedAuthorityLevels,
                limit: context.lanePolicy.topKDense,
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
            projectAffinityIds: context.dynamicSignals.projectAffinityIds,
            relatedIssueIds: context.relatedIssueIds,
            finalK: Math.max(context.lanePolicy.rerankK, context.lanePolicy.finalK),
          });
          await knowledge.upsertRetrievalCacheEntry({
            companyId: input.companyId,
            projectId: input.issue.projectId,
            stage: "candidate_hits",
            cacheKey: candidateCacheKey,
            knowledgeRevision: context.primaryKnowledgeRevision,
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

        return {
          candidateCacheHit,
          candidateCacheInspection,
          cachedFinalPayload,
          cachePolicyConfig,
          denseHitCount,
          denseHits,
          finalCacheIdentity,
          finalCacheInspection,
          finalCacheKey,
          hits,
          pathHitCount,
          pathHits,
          sparseHitCount,
          sparseHits,
          symbolHitCount,
          symbolHits,
          denseEnabled: Boolean(queryEmbedding),
        };
      };
      type ResolvedRecipientCandidateStage = Awaited<ReturnType<typeof resolveRecipientCandidateStage>>;

      const resolveRecipientFinalStage = async (input2: {
        recipient: (typeof uniqueRecipients)[number];
        context: PreparedRecipientRetrievalContext;
        stage: ResolvedRecipientCandidateStage;
        queryEmbedding: number[] | null;
      }) => {
        let finalHits: RetrievalHitView[] = [];
        let briefQuality: BriefQualitySummary | null = null;
        let reuseSummary: RetrievalReuseSummary | null = null;
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
        const finalCacheHit = Boolean(input2.stage.cachedFinalPayload);

        if (input2.stage.cachedFinalPayload) {
          finalHits = input2.stage.cachedFinalPayload.hits;
          briefQuality = readCachedBriefQualitySummary(input2.stage.cachedFinalPayload.quality);
          return {
            finalHits,
            briefQuality,
            reuseSummary,
            graphSeeds,
            chunkGraphResult,
            symbolGraphSeeds,
            symbolGraphResult,
            finalCacheHit,
          };
        }

        const linkMap = await listRetrievalLinks(input2.stage.hits.map((hit) => hit.chunkId));
        const initialDocumentVersionMap = await listDocumentVersionsForRetrieval({
          db,
          companyId: input.companyId,
          documentIds: uniqueNonEmpty(input2.stage.hits.map((hit) => hit.documentId)),
        });
        const initialRerankedHits = rerankRetrievalHits({
          hits: input2.stage.hits,
          signals: input2.context.dynamicSignals,
          issueId: input.issueId,
          projectId: input.issue.projectId,
          projectAffinityIds: input2.context.dynamicSignals.projectAffinityIds,
          linkMap,
          temporalContext: input2.context.temporalContext,
          documentVersionMap: initialDocumentVersionMap,
          finalK: input2.context.lanePolicy.finalK,
          rerankConfig: input2.context.laneRerankConfig,
          personalizationProfile: input2.context.personalizationProfile,
        });
        graphSeeds = buildGraphExpansionSeeds({
          hits: initialRerankedHits,
          linkMap,
          signals: input2.context.dynamicSignals,
        });
        const chunkGraphLimit = Math.min(
          Math.max(input2.context.lanePolicy.finalK * 3, graphSeeds.length * 3, 12),
          30,
        );
        chunkGraphResult = await queryGraphExpansionKnowledge({
          companyId: input.companyId,
          issueId: input.issueId,
          projectId: input.issue.projectId,
          projectAffinityIds: input2.context.dynamicSignals.projectAffinityIds,
          relatedIssueIds: input2.context.relatedIssueIds,
          seeds: graphSeeds,
          allowedSourceTypes: input2.context.policy.allowedSourceTypes,
          allowedAuthorityLevels: input2.context.policy.allowedAuthorityLevels,
          excludeChunkIds: input2.stage.hits.map((hit) => hit.chunkId),
          limit: chunkGraphLimit,
          maxHops: input2.context.lanePolicy.chunkGraphMaxHops,
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
            baseHits: input2.stage.hits,
            graphHits: chunkGraphResult.hits,
            finalK: Math.max(input2.context.lanePolicy.rerankK, input2.context.lanePolicy.finalK) + chunkGraphResult.hits.length,
          })
          : input2.stage.hits;
        const rerankedHits = chunkGraphResult.hits.length > 0
          ? rerankRetrievalHits({
            hits: graphExpandedCandidates,
            signals: input2.context.dynamicSignals,
            issueId: input.issueId,
            projectId: input.issue.projectId,
            projectAffinityIds: input2.context.dynamicSignals.projectAffinityIds,
            linkMap: combinedLinkMap,
            temporalContext: input2.context.temporalContext,
            documentVersionMap: await listDocumentVersionsForRetrieval({
              db,
              companyId: input.companyId,
              documentIds: uniqueNonEmpty(graphExpandedCandidates.map((hit) => hit.documentId)),
            }),
            finalK: input2.context.lanePolicy.finalK,
            rerankConfig: input2.context.laneRerankConfig,
            personalizationProfile: input2.context.personalizationProfile,
          })
          : initialRerankedHits;
        const chunkSymbolMap = await listChunkSymbols(rerankedHits.map((hit) => hit.chunkId));
        symbolGraphSeeds = buildSymbolGraphExpansionSeeds({
          hits: rerankedHits,
          chunkSymbolMap,
        });
        const symbolGraphLimit = Math.min(
          Math.max(input2.context.lanePolicy.finalK * 3, symbolGraphSeeds.length * 3, 12),
          30,
        );
        symbolGraphResult = await querySymbolGraphExpansionKnowledge({
          companyId: input.companyId,
          symbolSeeds: symbolGraphSeeds,
          excludeChunkIds: rerankedHits.map((hit) => hit.chunkId),
          allowedSourceTypes: input2.context.policy.allowedSourceTypes,
          allowedAuthorityLevels: input2.context.policy.allowedAuthorityLevels,
          limit: symbolGraphLimit,
        });
        const symbolGraphLinkMap = symbolGraphResult.hits.length > 0
          ? await listRetrievalLinks(symbolGraphResult.hits.map((hit) => hit.chunkId))
          : new Map<string, RetrievalLinkView[]>();
        const symbolCombinedLinkMap = new Map(combinedLinkMap);
        for (const [chunkId, links] of symbolGraphLinkMap.entries()) {
          symbolCombinedLinkMap.set(chunkId, links);
        }
        const mergedSymbolCandidates = mergeGraphExpandedHits({
          baseHits: rerankedHits,
          graphHits: symbolGraphResult.hits,
          finalK: Math.max(input2.context.lanePolicy.rerankK, input2.context.lanePolicy.finalK) + symbolGraphResult.hits.length,
        });
        const symbolExpandedHits = symbolGraphResult.hits.length > 0
          ? rerankRetrievalHits({
            hits: mergedSymbolCandidates,
            signals: input2.context.dynamicSignals,
            issueId: input.issueId,
            projectId: input.issue.projectId,
            projectAffinityIds: input2.context.dynamicSignals.projectAffinityIds,
            linkMap: symbolCombinedLinkMap,
            temporalContext: input2.context.temporalContext,
            documentVersionMap: await listDocumentVersionsForRetrieval({
              db,
              companyId: input.companyId,
              documentIds: uniqueNonEmpty(mergedSymbolCandidates.map((hit) => hit.documentId)),
            }),
            finalK: input2.context.lanePolicy.finalK,
            rerankConfig: input2.context.laneRerankConfig,
            personalizationProfile: input2.context.personalizationProfile,
          })
          : rerankedHits;
        finalHits = symbolExpandedHits;
        if (
          input2.context.laneRerankConfig.modelRerank.enabled
          && modelReranker.isConfigured()
          && symbolExpandedHits.length > 1
        ) {
          try {
            const modelResult = await modelReranker.rerankCandidates({
              queryText: input2.context.queryText,
              recipientRole: input2.recipient.role,
              workflowState: input.message.workflowStateAfter,
              summary: input.message.summary,
              candidates: symbolExpandedHits
                .slice(0, input2.context.lanePolicy.modelRerankCandidateCount)
                .map((hit) => ({
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
              finalK: input2.context.lanePolicy.finalK,
              modelRerank: input2.context.laneRerankConfig.modelRerank,
            });
          } catch {
            finalHits = symbolExpandedHits;
          }
        }
        finalHits = applyGraphConnectivityGuard({
          hits: applyOrganizationalBridgeGuard({
            hits: applyEvidenceDiversityGuard({
              hits: finalHits,
              finalK: input2.context.lanePolicy.finalK,
              signals: input2.context.dynamicSignals,
            }),
            finalK: input2.context.lanePolicy.finalK,
            signals: input2.context.dynamicSignals,
          }),
          finalK: input2.context.lanePolicy.finalK,
          signals: input2.context.dynamicSignals,
        }).slice(0, input2.context.lanePolicy.finalK);
        if (input2.stage.pathHits.length > 0) {
          const exactPathFallbackHits = rerankRetrievalHits({
            hits: input2.stage.pathHits.map((hit) => ({
              ...hit,
              fusedScore: hit.fusedScore ?? 0,
            })),
            signals: input2.context.dynamicSignals,
            issueId: input.issueId,
            projectId: input.issue.projectId,
            projectAffinityIds: input2.context.dynamicSignals.projectAffinityIds,
            linkMap: symbolCombinedLinkMap,
            temporalContext: input2.context.temporalContext,
            documentVersionMap: await listDocumentVersionsForRetrieval({
              db,
              companyId: input.companyId,
              documentIds: uniqueNonEmpty(input2.stage.pathHits.map((hit) => hit.documentId)),
            }),
            finalK: Math.max(input2.context.lanePolicy.finalK, input2.stage.pathHits.length),
            rerankConfig: input2.context.laneRerankConfig,
            personalizationProfile: input2.context.personalizationProfile,
          }).filter((hit) => isExecutableEvidenceSourceType(hit.sourceType));
          finalHits = applyGraphConnectivityGuard({
            hits: applyEvidenceDiversityGuard({
              hits: appendUniqueRetrievalHits(finalHits, exactPathFallbackHits),
              finalK: input2.context.lanePolicy.finalK,
              signals: input2.context.dynamicSignals,
            }),
            finalK: input2.context.lanePolicy.finalK,
            signals: input2.context.dynamicSignals,
          }).slice(0, input2.context.lanePolicy.finalK);
        }

        reuseSummary = computeRetrievalReuseSummary({
          relatedIssueIds: input2.context.relatedIssueIds,
          relatedIssueIdentifierMap: input2.context.relatedIssueIdentifierMap,
          finalHits,
        });
        const graphHits = finalHits.filter((hit) => hit.graphMetadata != null);
        const multiHopGraphHitCount = finalHits.filter((hit) => (hit.graphMetadata?.hopDepth ?? 1) > 1).length;
        const exactPathSatisfied = isExactPathSatisfied({
          finalHits,
          exactPaths: input2.context.dynamicSignals.exactPaths,
        });
        const combinedGraphMetrics = buildCombinedGraphMetrics(chunkGraphResult, symbolGraphResult);
        briefQuality = summarizeBriefQuality({
          finalHits,
          queryEmbedding: input2.queryEmbedding,
          sparseHitCount: input2.stage.sparseHitCount,
          pathHitCount: input2.stage.pathHitCount,
          symbolHitCount: input2.stage.symbolHitCount,
          denseHitCount: input2.stage.denseHitCount,
          graphSeedCount: graphSeeds.length + symbolGraphSeeds.length,
          graphHitCount: graphHits.length,
          graphEntityTypes: uniqueNonEmpty(graphHits.flatMap((hit) => hit.graphMetadata?.entityTypes ?? [])),
          symbolGraphSeedCount: symbolGraphSeeds.length,
          symbolGraphHitCount: symbolGraphResult.hits.length,
          edgeTraversalCount: chunkGraphResult.edgeTraversalCount + symbolGraphResult.edgeTraversalCount,
          edgeTypeCounts: symbolGraphResult.edgeTypeCounts,
          graphMaxDepth: combinedGraphMetrics.combinedGraphMaxDepth,
          graphHopDepthCounts: combinedGraphMetrics.combinedGraphHopDepthCounts,
          multiHopGraphHitCount,
          temporalContext: input2.context.temporalContext,
          crossProjectRequested: input2.context.dynamicSignals.projectAffinityIds.length > 1,
          candidateCacheHit: input2.stage.candidateCacheHit,
          finalCacheHit: false,
          candidateCacheInspection: input2.stage.candidateCacheInspection,
          finalCacheInspection: input2.stage.finalCacheInspection,
          exactPathSatisfied,
          relatedIssueIds: input2.context.relatedIssueIds,
          relatedIssueIdentifierMap: input2.context.relatedIssueIdentifierMap,
          reuseSummary,
        });

        await knowledge.upsertRetrievalCacheEntry({
          companyId: input.companyId,
          projectId: input.issue.projectId,
          stage: "final_hits",
          cacheKey: input2.stage.finalCacheKey,
          knowledgeRevision: input2.context.primaryKnowledgeRevision,
          ttlSeconds: FINAL_HIT_CACHE_TTL_SECONDS,
          valueJson: serializeRetrievalCachePayload({
            hits: finalHits,
            quality: briefQuality as unknown as Record<string, unknown>,
            metadata: {
              graphSeedCount: graphSeeds.length,
              symbolGraphSeedCount: symbolGraphSeeds.length,
              cacheIdentity: input2.stage.finalCacheIdentity,
            },
          }),
        });

        return {
          finalHits,
          briefQuality,
          reuseSummary,
          graphSeeds,
          chunkGraphResult,
          symbolGraphSeeds,
          symbolGraphResult,
          finalCacheHit,
        };
      };

      type ResolvedRecipientFinalStage = Awaited<ReturnType<typeof resolveRecipientFinalStage>>;

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
        const recipientContext = await prepareRecipientRetrievalContext(recipient);
        const {
          policy,
          rerankConfig,
          personalizationProfile,
          queryText,
          baselineSignals,
          executionLane,
          lanePolicy,
          laneRerankConfig,
          temporalContext,
          primaryKnowledgeRevision,
          revisionSignature,
          dynamicSignals,
          relatedIssueIds,
          relatedIssueIdentifierMap,
          relatedIssueIdentifiers,
        } = recipientContext;
        const { queryEmbedding, queryEmbeddingDebug } = await resolveRecipientQueryEmbedding({
          queryText,
        });

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
            relatedIssueIds,
            relatedIssueIdentifiers,
            reuseHitCount: 0,
            reuseDecisionHitCount: 0,
            reuseFixHitCount: 0,
            reuseReviewHitCount: 0,
            reuseCloseHitCount: 0,
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
        const candidateStage = await resolveRecipientCandidateStage(
          recipient,
          recipientContext,
          queryEmbedding,
        );
        const {
          candidateCacheHit,
          candidateCacheInspection,
          denseHitCount,
          finalCacheInspection,
          hits,
          pathHitCount,
          sparseHitCount,
          symbolHitCount,
        } = candidateStage;

        console.log("[RETRIEVAL] Fused candidates:", hits.length);
        let {
          finalHits,
          briefQuality,
          reuseSummary,
          graphSeeds,
          chunkGraphResult,
          symbolGraphSeeds,
          symbolGraphResult,
          finalCacheHit,
        } = await resolveRecipientFinalStage({
          recipient,
          context: recipientContext,
          stage: candidateStage,
          queryEmbedding,
        });

        if (!reuseSummary) {
          reuseSummary = computeRetrievalReuseSummary({
            relatedIssueIds,
            relatedIssueIdentifierMap,
            finalHits,
          });
        }
        const combinedGraphMetrics = buildCombinedGraphMetrics(
          chunkGraphResult,
          symbolGraphResult,
        );
        briefQuality = resolveRecipientBriefQuality({
          finalHits,
          queryEmbedding,
          sparseHitCount: candidateStage.sparseHitCount,
          pathHitCount: candidateStage.pathHitCount,
          symbolHitCount: candidateStage.symbolHitCount,
          denseHitCount: candidateStage.denseHitCount,
          graphSeedCount: graphSeeds.length + symbolGraphSeeds.length,
          symbolGraphSeedCount: symbolGraphSeeds.length,
          symbolGraphHitCount: symbolGraphResult.hits.length,
          edgeTraversalCount: chunkGraphResult.edgeTraversalCount + symbolGraphResult.edgeTraversalCount,
          edgeTypeCounts: symbolGraphResult.edgeTypeCounts,
          graphMaxDepth: combinedGraphMetrics.combinedGraphMaxDepth,
          graphHopDepthCounts: combinedGraphMetrics.combinedGraphHopDepthCounts,
          temporalContext: recipientContext.temporalContext,
          exactPaths: recipientContext.dynamicSignals.exactPaths,
          projectAffinityIds: recipientContext.dynamicSignals.projectAffinityIds,
          candidateCacheHit: candidateStage.candidateCacheHit,
          finalCacheHit,
          candidateCacheInspection: candidateStage.candidateCacheInspection,
          finalCacheInspection: candidateStage.finalCacheInspection,
          relatedIssueIds: recipientContext.relatedIssueIds,
          relatedIssueIdentifierMap: recipientContext.relatedIssueIdentifierMap,
          reuseSummary,
          existingBriefQuality: briefQuality,
        });

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

        const resolvedBriefQuality = briefQuality;
        const finalizationMetrics = buildRecipientFinalizationMetrics({
          finalHits,
          chunkGraphResult,
          symbolGraphResult,
          exactPaths: dynamicSignals.exactPaths,
        });
        const briefDraft = buildRetrievalBriefDraft({
          eventType,
          triggeringMessageId: input.triggeringMessageId,
          recipientRole: recipient.role,
          issue: input.issue,
          message: input.message,
          queryText,
          executionLane,
          dynamicSignals,
          quality: briefQuality,
          hits: finalHits,
          maxEvidenceItems: lanePolicy.maxEvidenceItems,
        });

        const latestBrief = await knowledge.getLatestTaskBrief(input.issueId, briefDraft.briefScope);
        const brief = await knowledge.createTaskBrief({
          companyId: input.companyId,
          issueId: input.issueId,
          briefScope: briefDraft.briefScope,
          briefVersion: (latestBrief?.briefVersion ?? 0) + 1,
          generatedFromMessageSeq: input.triggeringMessageSeq,
          workflowState: input.message.workflowStateAfter,
          contentMarkdown: briefDraft.contentMarkdown,
          contentJson: briefDraft.contentJson,
          retrievalRunId: retrievalRun.id,
        });

        console.log("[RETRIEVAL] Brief created:", {
          briefId: brief.id,
          briefScope: briefDraft.briefScope,
          briefVersion: brief.briefVersion,
          hitCount: finalHits.length,
          retrievalRunId: retrievalRun.id,
        });
        const completionArtifacts = buildRetrievalCompletionArtifacts({
          companyId: input.companyId,
          issueId: input.issueId,
          retrievalRunId: retrievalRun.id,
          triggeringMessageId: input.triggeringMessageId,
          recipientRole: recipient.role,
          recipientId: recipient.recipientId,
          executionLane,
          brief: {
            id: brief.id,
            briefScope: briefDraft.briefScope,
            briefVersion: brief.briefVersion,
            contentMarkdown: brief.contentMarkdown,
          },
          finalHits,
          briefQuality: resolvedBriefQuality,
          relatedIssueIds,
          relatedIssueIdentifiers,
          reuseSummary,
          graphSeeds,
          symbolGraphSeeds,
          briefGraphHits: finalizationMetrics.briefGraphHits,
          symbolGraphHitCount: finalizationMetrics.symbolGraphHitCount,
          edgeTraversalCount: finalizationMetrics.edgeTraversalCount,
          edgeTypeCounts: finalizationMetrics.edgeTypeCounts,
          graphMaxDepth: finalizationMetrics.graphMaxDepth,
          graphHopDepthCounts: finalizationMetrics.graphHopDepthCounts,
          multiHopGraphHitCount: finalizationMetrics.multiHopGraphHitCount,
          temporalContext,
          queryEmbeddingCacheHit: queryEmbeddingDebug.embeddingCacheHit === true,
          candidateCacheHit,
          finalCacheHit,
          revisionSignature,
          candidateCacheInspection,
          finalCacheInspection,
          exactPathSatisfied: finalizationMetrics.exactPathSatisfied,
          personalizationProfile,
          maxEvidenceItems: lanePolicy.maxEvidenceItems,
        });
        const persistencePlan = buildRetrievalCompletionPersistencePlan({
          retrievalRunId: retrievalRun.id,
          briefId: brief.id,
          recipientRole: recipient.role,
          recipientId: recipient.recipientId,
          artifacts: completionArtifacts,
        });
        await applyRetrievalCompletionPersistencePlan({
          db,
          companyId: input.companyId,
          issueId: input.issueId,
          actor: input.actor,
          plan: persistencePlan,
          knowledge,
          recipientHints,
          retrievalRuns,
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
