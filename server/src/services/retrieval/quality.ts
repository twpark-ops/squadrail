import type {
  RetrievalCacheInspectionResult,
  RetrievalHitView,
  RetrievalTemporalContext,
} from "../issue-retrieval.js";
import { classifyReuseArtifactKind, normalizeHintPath, uniqueNonEmpty } from "./shared.js";
import { classifyOrganizationalArtifact } from "../retrieval-evidence-guards.js";

export interface RetrievalReuseSummary {
  requestedRelatedIssueCount: number;
  reuseHitCount: number;
  reusedIssueCount: number;
  reusedIssueIds: string[];
  reusedIssueIdentifiers: string[];
  reuseArtifactKinds: string[];
  reuseDecisionHitCount: number;
  reuseFixHitCount: number;
  reuseReviewHitCount: number;
  reuseCloseHitCount: number;
}

export interface BriefQualitySummary {
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
  requestedRelatedIssueCount: number;
  reuseHitCount: number;
  reusedIssueCount: number;
  reusedIssueIds: string[];
  reusedIssueIdentifiers: string[];
  reuseArtifactKinds: string[];
  reuseDecisionHitCount: number;
  reuseFixHitCount: number;
  reuseReviewHitCount: number;
  reuseCloseHitCount: number;
  sourceDiversity: number;
  candidateCacheHit: boolean;
  finalCacheHit: boolean;
  candidateCacheReason: RetrievalCacheInspectionResult["reason"] | null;
  finalCacheReason: RetrievalCacheInspectionResult["reason"] | null;
  candidateCacheProvenance: RetrievalCacheInspectionResult["provenance"] | null;
  finalCacheProvenance: RetrievalCacheInspectionResult["provenance"] | null;
  exactPathSatisfied: boolean;
  degradedReasons: string[];
}

export function computeRetrievalReuseSummary(input: {
  relatedIssueIds: string[];
  relatedIssueIdentifierMap?: Record<string, string>;
  finalHits: RetrievalHitView[];
}): RetrievalReuseSummary {
  const relatedIssueIds = uniqueNonEmpty(input.relatedIssueIds);
  const relatedIssueIdSet = new Set(relatedIssueIds);
  const reuseHits = input.finalHits.filter((hit) =>
    hit.documentIssueId != null && relatedIssueIdSet.has(hit.documentIssueId),
  );
  const reusedIssueIds = uniqueNonEmpty(
    reuseHits.map((hit) => hit.documentIssueId).filter((value): value is string => typeof value === "string"),
  );
  const reusedIssueIdentifiers = uniqueNonEmpty(
    reusedIssueIds.map((issueId) => input.relatedIssueIdentifierMap?.[issueId] ?? issueId),
  );
  const reuseArtifactKinds = uniqueNonEmpty(reuseHits.map((hit) => classifyReuseArtifactKind(hit)));

  let reuseDecisionHitCount = 0;
  let reuseFixHitCount = 0;
  let reuseReviewHitCount = 0;
  let reuseCloseHitCount = 0;
  for (const hit of reuseHits) {
    switch (classifyReuseArtifactKind(hit)) {
      case "fix":
        reuseFixHitCount += 1;
        break;
      case "review":
        reuseReviewHitCount += 1;
        break;
      case "close":
        reuseCloseHitCount += 1;
        break;
      default:
        reuseDecisionHitCount += 1;
        break;
    }
  }

  return {
    requestedRelatedIssueCount: relatedIssueIds.length,
    reuseHitCount: reuseHits.length,
    reusedIssueCount: reusedIssueIds.length,
    reusedIssueIds,
    reusedIssueIdentifiers,
    reuseArtifactKinds,
    reuseDecisionHitCount,
    reuseFixHitCount,
    reuseReviewHitCount,
    reuseCloseHitCount,
  };
}

export function isExactPathSatisfied(input: {
  finalHits: RetrievalHitView[];
  exactPaths: string[];
}) {
  if (input.exactPaths.length === 0) return true;
  return input.finalHits.some((hit) => {
    const candidatePath = hit.path ? normalizeHintPath(hit.path) : null;
    return candidatePath != null && input.exactPaths.includes(candidatePath);
  });
}

export function summarizeBriefQuality(input: {
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
  relatedIssueIds?: string[];
  relatedIssueIdentifierMap?: Record<string, string>;
  reuseSummary?: RetrievalReuseSummary;
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
      || hit.temporalMetadata?.matchType === "default_branch_head",
    )
    .length;
  const staleVersionPenaltyCount = input.finalHits.filter((hit) => hit.temporalMetadata?.stale === true).length;
  const exactCommitMatchCount = input.finalHits.filter((hit) => hit.temporalMetadata?.matchType === "exact_commit").length;
  const organizationalMemoryHitCount = input.finalHits.filter((hit) => classifyOrganizationalArtifact(hit) != null).length;
  const codeHitCount = input.finalHits.filter((hit) => hit.sourceType === "code").length;
  const reviewHitCount = input.finalHits.filter((hit) => hit.sourceType === "review").length;
  const reuseSummary = input.reuseSummary ?? computeRetrievalReuseSummary({
    relatedIssueIds: input.relatedIssueIds ?? [],
    relatedIssueIdentifierMap: input.relatedIssueIdentifierMap,
    finalHits: input.finalHits,
  });
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
    requestedRelatedIssueCount: reuseSummary.requestedRelatedIssueCount,
    reuseHitCount: reuseSummary.reuseHitCount,
    reusedIssueCount: reuseSummary.reusedIssueCount,
    reusedIssueIds: reuseSummary.reusedIssueIds,
    reusedIssueIdentifiers: reuseSummary.reusedIssueIdentifiers,
    reuseArtifactKinds: reuseSummary.reuseArtifactKinds,
    reuseDecisionHitCount: reuseSummary.reuseDecisionHitCount,
    reuseFixHitCount: reuseSummary.reuseFixHitCount,
    reuseReviewHitCount: reuseSummary.reuseReviewHitCount,
    reuseCloseHitCount: reuseSummary.reuseCloseHitCount,
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
