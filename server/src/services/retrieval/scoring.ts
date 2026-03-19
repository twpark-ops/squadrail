import path from "node:path";
import { isKnowledgeSummarySourceType } from "@squadrail/shared";
import type {
  RetrievalHitView,
  RetrievalPolicyRerankConfig,
  RetrievalSignals,
} from "../issue-retrieval.js";
import {
  classifyOrganizationalArtifact,
  isExecutableEvidenceSourceType,
} from "../retrieval-evidence-guards.js";
import {
  classifyReuseArtifactKind,
  metadataStringArray,
  normalizeHintPath,
  uniqueNonEmpty,
} from "./shared.js";

export interface RetrievalRerankWeights {
  sourceTypeBaseBoost: number;
  sourceTypeDecay: number;
  sourceTypeMinBoost: number;
  exactPathBoost: number;
  exactPathCodeBridgeBoost: number;
  exactPathTestBridgeBoost: number;
  fileNameBoost: number;
  metadataExactPathBoostMultiplier: number;
  metadataFileNameBoostMultiplier: number;
  symbolExactBoost: number;
  symbolPartialBoost: number;
  tagMatchBoostPerTag: number;
  tagMatchMaxBoost: number;
  summaryOwnerTagMatchBoost: number;
  summarySupportTagMatchBoost: number;
  summaryAvoidTagPenalty: number;
  summaryFileContextBoost: number;
  summarySymbolContextBoost: number;
  summaryMaxBoost: number;
  summaryMinBoost: number;
  latestBoost: number;
  issueLinkMinBoost: number;
  issueLinkWeightMultiplier: number;
  projectLinkMinBoost: number;
  projectLinkWeightMultiplier: number;
  pathLinkMinBoost: number;
  pathLinkWeightMultiplier: number;
  linkBoostCap: number;
  graphMultiHopBoost: number;
  graphExecutableBridgeBoost: number;
  graphCrossProjectBoost: number;
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
  organizationalIssueMissPenalty: number;
  organizationalProtocolMissPenalty: number;
  organizationalReviewMissPenalty: number;
  relatedIssueDecisionBoost: number;
  relatedIssueFixBoost: number;
  relatedIssueReviewBoost: number;
  relatedIssueCloseBoost: number;
}

export type RetrievalPathBoostKind = "none" | "direct" | "metadata_exact" | "metadata_file";

export interface RetrievalPathBoostResult {
  score: number;
  kind: RetrievalPathBoostKind;
}

type RetrievalCandidate = Omit<RetrievalHitView, "fusedScore"> & {
  fusedScore?: number;
};

function parseIsoDate(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function clampScore(value: number | null | undefined) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Number(value));
}

export function computeScopeBoost(input: {
  hitIssueId: string | null;
  hitProjectId: string | null;
  issueId: string;
  projectId: string | null;
  projectAffinityIds?: string[];
  relatedIssueIds?: string[];
}) {
  if (input.hitIssueId === input.issueId) return 2;
  if (input.hitIssueId && (input.relatedIssueIds ?? []).includes(input.hitIssueId)) return 1.15;
  if (input.projectId && input.hitProjectId === input.projectId) return 1;
  if (input.hitProjectId && (input.projectAffinityIds ?? []).includes(input.hitProjectId)) return 0.8;
  return 0;
}

export function computeAuthorityBoost(authorityLevel: string) {
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

export function fuseRetrievalCandidates(input: {
  sparseHits: RetrievalCandidate[];
  denseHits: RetrievalCandidate[];
  issueId: string;
  projectId: string | null;
  projectAffinityIds?: string[];
  relatedIssueIds?: string[];
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
        relatedIssueIds: input.relatedIssueIds,
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

export function computeSourceTypeBoost(input: {
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

export function computeExecutablePathBridgeBoost(input: {
  hit: RetrievalHitView;
  pathBoost: RetrievalPathBoostResult;
  weights: RetrievalRerankWeights;
}) {
  if (input.pathBoost.kind !== "direct") return 0;
  if (input.hit.sourceType === "code") return input.weights.exactPathCodeBridgeBoost;
  if (input.hit.sourceType === "test_report") return input.weights.exactPathTestBridgeBoost;
  return 0;
}

export function computeDocumentPathBoost(
  hit: RetrievalHitView,
  signals: RetrievalSignals,
  weights: RetrievalRerankWeights,
): RetrievalPathBoostResult {
  const directBoost = computePathBoost(hit.path, signals, weights);
  if (directBoost > 0) {
    return {
      score: directBoost,
      kind: "direct",
    };
  }

  const changedPaths = metadataStringArray(hit.documentMetadata, ["changedPaths"]).map(normalizeHintPath);
  if (changedPaths.length === 0) {
    return {
      score: 0,
      kind: "none",
    };
  }
  const artifactClass = classifyOrganizationalArtifact(hit);
  const exactMultiplier =
    artifactClass === "issue"
      ? 0.2
      : artifactClass === "protocol"
        ? 0.35
        : artifactClass === "review"
          ? 0.7
          : weights.metadataExactPathBoostMultiplier;
  const fileMultiplier =
    artifactClass === "issue"
      ? 0.14
      : artifactClass === "protocol"
        ? 0.26
        : artifactClass === "review"
          ? 0.56
          : weights.metadataFileNameBoostMultiplier;
  if (changedPaths.some((candidate) => signals.exactPaths.includes(candidate))) {
    return {
      score: weights.exactPathBoost * exactMultiplier,
      kind: "metadata_exact",
    };
  }

  const changedFileNames = uniqueNonEmpty(changedPaths.map((candidate) => path.posix.basename(candidate)));
  if (changedFileNames.some((fileName) => signals.fileNames.includes(fileName))) {
    return {
      score: weights.fileNameBoost * fileMultiplier,
      kind: "metadata_file",
    };
  }
  return {
    score: 0,
    kind: "none",
  };
}

export function computeSymbolBoost(symbolName: string | null, signals: RetrievalSignals, weights: RetrievalRerankWeights) {
  if (!symbolName) return 0;
  const normalized = symbolName.toLowerCase();
  if (signals.symbolHints.some((hint) => hint.toLowerCase() === normalized)) return weights.symbolExactBoost;
  if (signals.symbolHints.some((hint) => normalized.includes(hint.toLowerCase()) || hint.toLowerCase().includes(normalized))) {
    return weights.symbolPartialBoost;
  }
  return 0;
}

export function computeOrganizationalMemoryPenalty(input: {
  hit: RetrievalHitView;
  signals: RetrievalSignals;
  weights: RetrievalRerankWeights;
  pathBoost: RetrievalPathBoostResult;
  symbolBoost: number;
}) {
  const needsImplementationContext = input.signals.exactPaths.length > 0 || input.signals.symbolHints.length > 0;
  if (!needsImplementationContext) return 0;

  const artifactClass = classifyOrganizationalArtifact(input.hit);
  if (!artifactClass) return 0;
  if (input.pathBoost.kind === "direct" || input.symbolBoost > 0) return 0;
  if (artifactClass === "issue") {
    return input.weights.organizationalIssueMissPenalty;
  }
  if (artifactClass === "protocol") {
    return input.weights.organizationalProtocolMissPenalty;
  }
  if (artifactClass === "review") {
    return input.weights.organizationalReviewMissPenalty;
  }
  return 0;
}

export function computeCurrentIssueArtifactPenalty(input: {
  hit: RetrievalHitView;
  issueId: string;
  pathBoost: RetrievalPathBoostResult;
  symbolBoost: number;
}) {
  if (input.hit.documentIssueId !== input.issueId) return 0;
  if (input.pathBoost.kind === "direct" || input.symbolBoost > 0) return 0;

  switch (classifyOrganizationalArtifact(input.hit)) {
    case "issue": {
      const denseScore = clampScore(input.hit.denseScore);
      const sparseScore = clampScore(input.hit.sparseScore);
      const semanticRelief =
        input.pathBoost.kind === "none" && denseScore >= 0.75 && (denseScore + sparseScore) >= 1.4
          ? 0.95
          : 0;
      return -1.8 + semanticRelief;
    }
    case "protocol":
      return -1.35;
    case "review":
      return -0.95;
    default:
      return 0;
  }
}

export function computeTagBoost(hit: RetrievalHitView, signals: RetrievalSignals, weights: RetrievalRerankWeights) {
  if (signals.knowledgeTags.length === 0) return 0;
  const tags = uniqueNonEmpty([
    ...metadataStringArray(hit.documentMetadata, ["tags", "requiredKnowledgeTags"]),
    ...metadataStringArray(hit.chunkMetadata, ["tags", "requiredKnowledgeTags"]),
  ]).map((value) => value.toLowerCase());
  if (tags.length === 0) return 0;
  const matches = signals.knowledgeTags.filter((tag) => tags.includes(tag.toLowerCase())).length;
  return Math.min(weights.tagMatchMaxBoost, matches * weights.tagMatchBoostPerTag);
}

function readProjectSelectionTags(metadata: Record<string, unknown>) {
  const selection = metadata.pmProjectSelection;
  if (!selection || typeof selection !== "object" || Array.isArray(selection)) {
    return {
      ownerTags: [] as string[],
      supportTags: [] as string[],
      avoidTags: [] as string[],
    };
  }

  const record = selection as Record<string, unknown>;
  return {
    ownerTags: metadataStringArray(record, ["ownerTags"]).map((value) => value.toLowerCase()),
    supportTags: metadataStringArray(record, ["supportTags"]).map((value) => value.toLowerCase()),
    avoidTags: metadataStringArray(record, ["avoidTags"]).map((value) => value.toLowerCase()),
  };
}

export function computeSummaryMetadataBoost(hit: RetrievalHitView, signals: RetrievalSignals, weights: RetrievalRerankWeights) {
  if (!isKnowledgeSummarySourceType(hit.sourceType)) return 0;

  const normalizedKnowledgeTags = uniqueNonEmpty(signals.knowledgeTags).map((value) => value.toLowerCase());
  const documentSelection = readProjectSelectionTags(hit.documentMetadata);
  const chunkSelection = readProjectSelectionTags(hit.chunkMetadata);
  const ownerTags = uniqueNonEmpty([...documentSelection.ownerTags, ...chunkSelection.ownerTags]);
  const supportTags = uniqueNonEmpty([...documentSelection.supportTags, ...chunkSelection.supportTags]);
  const avoidTags = uniqueNonEmpty([...documentSelection.avoidTags, ...chunkSelection.avoidTags]);

  let score = 0;
  if (normalizedKnowledgeTags.length > 0) {
    const ownerMatches = normalizedKnowledgeTags.filter((tag) => ownerTags.includes(tag)).length;
    const supportMatches = normalizedKnowledgeTags.filter((tag) => supportTags.includes(tag)).length;
    const avoidMatches = normalizedKnowledgeTags.filter((tag) => avoidTags.includes(tag)).length;

    score += ownerMatches * weights.summaryOwnerTagMatchBoost;
    score += supportMatches * weights.summarySupportTagMatchBoost;
    score += avoidMatches * weights.summaryAvoidTagPenalty;
  }

  const summaryKind = typeof hit.chunkMetadata.summaryKind === "string"
    ? hit.chunkMetadata.summaryKind
    : typeof hit.documentMetadata.summaryKind === "string"
      ? hit.documentMetadata.summaryKind
      : null;
  if (summaryKind === "file" || summaryKind === "module") {
    score += weights.summaryFileContextBoost;
  } else if (summaryKind === "symbol") {
    score += weights.summarySymbolContextBoost;
  }

  return Math.min(weights.summaryMaxBoost, Math.max(weights.summaryMinBoost, score));
}

export function computeLatestBoost(hit: RetrievalHitView, weights: RetrievalRerankWeights) {
  if (hit.documentMetadata.isLatestForScope === true) return weights.latestBoost;
  return 0;
}

export function computeRelatedIssueReuseBoost(input: {
  hit: RetrievalHitView;
  signals: RetrievalSignals;
  weights: RetrievalRerankWeights;
}) {
  if (!input.hit.documentIssueId || !(input.signals.relatedIssueIds ?? []).includes(input.hit.documentIssueId)) {
    return 0;
  }

  switch (classifyReuseArtifactKind(input.hit)) {
    case "close":
      return input.weights.relatedIssueCloseBoost;
    case "review":
      return input.weights.relatedIssueReviewBoost;
    case "fix":
      return input.weights.relatedIssueFixBoost;
    default:
      return input.weights.relatedIssueDecisionBoost;
  }
}

export function computeFreshnessBoost(hit: RetrievalHitView, weights: RetrievalRerankWeights, now = new Date()) {
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

export function buildHitRationale(input: {
  hit: RetrievalHitView;
  issueId: string;
  projectId: string | null;
  projectAffinityIds?: string[];
  signals: RetrievalSignals;
  weights: RetrievalRerankWeights;
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
    relatedIssueIds: input.signals.relatedIssueIds,
  });
  if (scopeBoost >= 2) reasons.push("issue_scoped");
  else if (input.hit.documentIssueId && (input.signals.relatedIssueIds ?? []).includes(input.hit.documentIssueId)) reasons.push("related_issue_reuse");
  else if (scopeBoost >= 1) reasons.push("project_scoped");
  else if (scopeBoost > 0) reasons.push("project_affinity");
  if (computeAuthorityBoost(input.hit.authorityLevel) > 0) reasons.push("high_authority");
  if ((input.hit.rerankScore ?? 0) > 0) reasons.push("heuristic_rerank");
  if ((input.hit.modelRerankRank ?? 0) > 0) reasons.push("model_rerank");
  const pathBoost = computeDocumentPathBoost(input.hit, input.signals, input.weights);
  const symbolBoost = computeSymbolBoost(input.hit.symbolName, input.signals, input.weights);
  if (pathBoost.score > 0) reasons.push(pathBoost.kind === "direct" ? "path_match" : "metadata_path_match");
  if (computeExecutablePathBridgeBoost({
    hit: input.hit,
    pathBoost,
    weights: input.weights,
  }) > 0) reasons.push("executable_path_bridge");
  if (symbolBoost > 0) reasons.push("symbol_match");
  if (computeTagBoost(input.hit, input.signals, input.weights) > 0) reasons.push("tag_match");
  const summaryMetadataBoost = computeSummaryMetadataBoost(input.hit, input.signals, input.weights);
  if (summaryMetadataBoost > 0) reasons.push("summary_metadata_match");
  if (summaryMetadataBoost < 0) reasons.push("summary_avoid_penalty");
  const relatedIssueReuseBoost = computeRelatedIssueReuseBoost({
    hit: input.hit,
    signals: input.signals,
    weights: input.weights,
  });
  if (relatedIssueReuseBoost > 0) {
    reasons.push(`reuse_${classifyReuseArtifactKind(input.hit)}_artifact`);
  }
  const freshnessBoost = computeFreshnessBoost(input.hit, input.weights);
  if (freshnessBoost > 0) reasons.push("fresh_content");
  if (freshnessBoost < 0) reasons.push("stale_or_invalid");
  if (computeOrganizationalMemoryPenalty({
    hit: input.hit,
    signals: input.signals,
    weights: input.weights,
    pathBoost,
    symbolBoost,
  }) < 0) reasons.push("organizational_memory_penalty");
  if (computeCurrentIssueArtifactPenalty({
    hit: input.hit,
    issueId: input.issueId,
    pathBoost,
    symbolBoost,
  }) < 0) reasons.push("current_issue_self_echo_penalty");
  for (const entityType of uniqueNonEmpty(input.hit.graphMetadata?.entityTypes ?? [])) {
    reasons.push(`graph_${entityType}_link`);
  }
  for (const edgeType of uniqueNonEmpty(input.hit.graphMetadata?.edgeTypes ?? [])) {
    reasons.push(`graph_edge_${edgeType}`);
  }
  if ((input.hit.graphMetadata?.hopDepth ?? 1) > 1) reasons.push("graph_multihop");
  if ((input.hit.graphMetadata?.hopDepth ?? 1) > 1 && isExecutableEvidenceSourceType(input.hit.sourceType)) {
    reasons.push("graph_executable_bridge");
  }
  if ((input.hit.personalizationMetadata?.sourceTypeBoost ?? 0) !== 0) reasons.push("personalized_source_type");
  if ((input.hit.personalizationMetadata?.pathBoost ?? 0) !== 0) reasons.push("personalized_path");
  if ((input.hit.personalizationMetadata?.symbolBoost ?? 0) !== 0) reasons.push("personalized_symbol");
  if ((input.hit.saturationMetadata?.penalty ?? 0) < 0) reasons.push("organizational_memory_saturation");
  if (input.hit.diversityMetadata?.promotedReason) reasons.push("evidence_diversity_guard");
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
