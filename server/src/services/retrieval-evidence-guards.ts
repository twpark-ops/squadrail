import path from "node:path";
import type { RetrievalHitView, RetrievalSignals } from "./issue-retrieval.js";

function normalizeHintPath(value: string) {
  return value.replaceAll("\\", "/").replace(/^\.\/+/, "").trim();
}

function metadataStringArray(metadata: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = metadata[key];
    if (!Array.isArray(value)) continue;
    return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
  }
  return [] as string[];
}

function uniqueNonEmpty(values: string[]) {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

export function classifyOrganizationalArtifact(hit: RetrievalHitView): "issue" | "protocol" | "review" | null {
  const artifactKind = typeof hit.documentMetadata.artifactKind === "string" ? hit.documentMetadata.artifactKind : null;
  if (artifactKind === "issue_snapshot" || hit.sourceType === "issue") return "issue";
  if (artifactKind === "protocol_event" || hit.sourceType === "protocol_message") return "protocol";
  if (artifactKind === "review_event" || hit.sourceType === "review") return "review";
  return null;
}

export function isExecutableEvidenceSourceType(sourceType: string) {
  return sourceType === "code" || sourceType === "test_report";
}

function deriveOrganizationalMemorySaturationPath(hit: RetrievalHitView) {
  const changedPaths = metadataStringArray(hit.documentMetadata, ["changedPaths"]).map(normalizeHintPath);
  const primaryChangedPath = changedPaths[0] ?? null;
  if (primaryChangedPath) return primaryChangedPath;
  return hit.path ? normalizeHintPath(hit.path) : null;
}

function matchesDirectExactPath(hit: RetrievalHitView, signals: RetrievalSignals) {
  if (!hit.path) return false;
  return signals.exactPaths.includes(normalizeHintPath(hit.path));
}

export function appendUniqueRetrievalHits(baseHits: RetrievalHitView[], fallbackHits: RetrievalHitView[]) {
  const seen = new Set(baseHits.map((hit) => hit.chunkId));
  const appended = [...baseHits];
  for (const hit of fallbackHits) {
    if (seen.has(hit.chunkId)) continue;
    seen.add(hit.chunkId);
    appended.push(hit);
  }
  return appended;
}

export function applyOrganizationalMemorySaturationGuard(input: {
  hits: RetrievalHitView[];
  finalK: number;
}) {
  const inspectionLimit = Math.max(input.finalK * 4, input.finalK + 12);
  const inspected = input.hits.slice(0, inspectionLimit);
  const rest = input.hits.slice(inspectionLimit);
  const pathCounts = new Map<string, number>();
  const sourceCounts = new Map<string, number>();

  const adjusted = inspected.map((hit) => {
    const artifactClass = classifyOrganizationalArtifact(hit);
    if (!artifactClass) {
      return {
        ...hit,
        saturationMetadata: null,
      } satisfies RetrievalHitView;
    }

    const normalizedPath = deriveOrganizationalMemorySaturationPath(hit);
    const repeatedPathCount = normalizedPath ? (pathCounts.get(normalizedPath) ?? 0) : 0;
    const repeatedSourceTypeCount = sourceCounts.get(hit.sourceType) ?? 0;
    let penalty = 0;

    if (repeatedPathCount >= 1) {
      penalty -= Math.min(2.2, 0.92 * repeatedPathCount * (artifactClass === "review" ? 1.15 : 1));
    }
    if (repeatedSourceTypeCount >= 3) {
      penalty -= Math.min(0.8, 0.18 * (repeatedSourceTypeCount - 2));
    }

    if (normalizedPath) {
      pathCounts.set(normalizedPath, repeatedPathCount + 1);
    }
    sourceCounts.set(hit.sourceType, repeatedSourceTypeCount + 1);

    if (penalty === 0) {
      return {
        ...hit,
        saturationMetadata: {
          penalty: 0,
          repeatedPathCount,
          repeatedSourceTypeCount,
          artifactClass,
        },
      } satisfies RetrievalHitView;
    }

    return {
      ...hit,
      fusedScore: hit.fusedScore + penalty,
      rerankScore: (hit.rerankScore ?? 0) + penalty,
      saturationMetadata: {
        penalty,
        repeatedPathCount,
        repeatedSourceTypeCount,
        artifactClass,
      },
    } satisfies RetrievalHitView;
  });

  return [...adjusted, ...rest].sort((left, right) => {
    if (right.fusedScore !== left.fusedScore) return right.fusedScore - left.fusedScore;
    return right.updatedAt.getTime() - left.updatedAt.getTime();
  });
}

export function applyEvidenceDiversityGuard(input: {
  hits: RetrievalHitView[];
  finalK: number;
  signals: RetrievalSignals;
}) {
  if (input.finalK <= 0 || input.signals.exactPaths.length === 0) return input.hits;
  if (input.hits.length <= input.finalK) return input.hits;

  const selected = input.hits.slice(0, input.finalK);
  if (selected.some((hit) => isExecutableEvidenceSourceType(hit.sourceType) && matchesDirectExactPath(hit, input.signals))) {
    return input.hits;
  }

  const promotedCandidate = input.hits.find((hit, index) =>
    index >= input.finalK
    && isExecutableEvidenceSourceType(hit.sourceType)
    && matchesDirectExactPath(hit, input.signals));
  if (!promotedCandidate) return input.hits;

  const replacementIndex = [...selected]
    .map((hit, index) => ({ hit, index }))
    .reverse()
    .find(({ hit }) => classifyOrganizationalArtifact(hit) != null)?.index ?? (selected.length - 1);
  const replaced = selected[replacementIndex] ?? null;
  const promotedReason = promotedCandidate.sourceType === "test_report" ? "exact_path_test_report" : "exact_path_code";
  const promoted = {
    ...promotedCandidate,
    diversityMetadata: {
      promotedReason,
      replacedSourceType: replaced?.sourceType ?? null,
    },
  } satisfies RetrievalHitView;

  const adjustedSelected = selected.map((hit, index) => (index === replacementIndex ? promoted : hit));
  let promotedRemoved = false;
  const remainingHits = input.hits.filter((hit) => {
    if (!promotedRemoved && hit.chunkId === promotedCandidate.chunkId) {
      promotedRemoved = true;
      return false;
    }
    return true;
  });

  return [...adjustedSelected, ...remainingHits.slice(input.finalK)];
}

function deriveCompanionPathCandidates(pathValue: string) {
  const normalized = normalizeHintPath(pathValue);
  const dirname = path.posix.dirname(normalized);
  const basename = path.posix.basename(normalized);

  const joinPath = (value: string) => (dirname === "." ? value : path.posix.join(dirname, value));
  const companions = new Set<string>();

  if (basename.endsWith("_test.go")) {
    companions.add(joinPath(`${basename.slice(0, -"_test.go".length)}.go`));
  } else if (basename.endsWith(".go")) {
    companions.add(joinPath(`${basename.slice(0, -".go".length)}_test.go`));
  }

  for (const suffix of [".test.ts", ".spec.ts", ".test.tsx", ".spec.tsx", ".test.js", ".spec.js", ".test.jsx", ".spec.jsx"]) {
    if (basename.endsWith(suffix)) {
      const stem = basename.slice(0, -suffix.length);
      const extension = suffix.includes("tsx") ? ".tsx"
        : suffix.includes("ts") ? ".ts"
          : suffix.includes("jsx") ? ".jsx"
            : ".js";
      companions.add(joinPath(`${stem}${extension}`));
    }
  }

  if (basename.endsWith(".ts") && !basename.endsWith(".d.ts")) {
    const stem = basename.slice(0, -".ts".length);
    companions.add(joinPath(`${stem}.test.ts`));
    companions.add(joinPath(`${stem}.spec.ts`));
  }
  if (basename.endsWith(".tsx")) {
    const stem = basename.slice(0, -".tsx".length);
    companions.add(joinPath(`${stem}.test.tsx`));
    companions.add(joinPath(`${stem}.spec.tsx`));
  }
  if (basename.endsWith(".js")) {
    const stem = basename.slice(0, -".js".length);
    companions.add(joinPath(`${stem}.test.js`));
    companions.add(joinPath(`${stem}.spec.js`));
  }
  if (basename.endsWith(".jsx")) {
    const stem = basename.slice(0, -".jsx".length);
    companions.add(joinPath(`${stem}.test.jsx`));
    companions.add(joinPath(`${stem}.spec.jsx`));
  }

  companions.delete(normalized);
  return [...companions];
}

function collectOrganizationalBridgePaths(input: {
  hits: RetrievalHitView[];
  signals: RetrievalSignals;
  finalK: number;
}) {
  const inspected = input.hits.slice(0, Math.max(input.finalK * 4, input.finalK + 12));
  const exactPathSet = new Set(input.signals.exactPaths.map(normalizeHintPath));
  const directBridgePaths = new Set<string>();
  const relatedBridgePaths = new Set<string>();

  for (const exactPath of exactPathSet) {
    directBridgePaths.add(exactPath);
    for (const companionPath of deriveCompanionPathCandidates(exactPath)) {
      if (!exactPathSet.has(companionPath)) relatedBridgePaths.add(companionPath);
    }
  }

  for (const hit of inspected) {
    if (classifyOrganizationalArtifact(hit) == null) continue;
    for (const changedPath of metadataStringArray(hit.documentMetadata, ["changedPaths"])) {
      const normalized = normalizeHintPath(changedPath);
      if (exactPathSet.has(normalized)) directBridgePaths.add(normalized);
      else relatedBridgePaths.add(normalized);
      for (const companionPath of deriveCompanionPathCandidates(normalized)) {
        if (!exactPathSet.has(companionPath)) relatedBridgePaths.add(companionPath);
      }
    }
  }

  return {
    directBridgePaths,
    relatedBridgePaths,
  };
}

type OrganizationalBridgeMatchType = "direct" | "related" | null;

function matchOrganizationalBridgePath(input: {
  hit: RetrievalHitView;
  directBridgePaths: Set<string>;
  relatedBridgePaths: Set<string>;
}) : OrganizationalBridgeMatchType {
  if (!isExecutableEvidenceSourceType(input.hit.sourceType) || !input.hit.path) return null;
  const normalized = normalizeHintPath(input.hit.path);
  if (input.relatedBridgePaths.has(normalized)) return "related";
  if (input.directBridgePaths.has(normalized)) return "direct";
  return null;
}

function annotateOrganizationalBridgeHit(input: {
  hit: RetrievalHitView;
  matchType: Exclude<OrganizationalBridgeMatchType, null>;
  replacedSourceType?: string | null;
}) {
  const promotedReason = input.matchType === "related"
    ? "organizational_bridge_related_path"
    : "organizational_bridge_exact_path";
  const graphBoost = input.matchType === "related" ? 0.95 : 0.55;
  return {
    ...input.hit,
    rerankScore: (input.hit.rerankScore ?? 0) + graphBoost,
    fusedScore: input.hit.fusedScore + graphBoost,
    graphMetadata: {
      entityTypes: uniqueNonEmpty([...(input.hit.graphMetadata?.entityTypes ?? []), "path"]),
      entityIds: uniqueNonEmpty([...(input.hit.graphMetadata?.entityIds ?? []), input.hit.path ? normalizeHintPath(input.hit.path) : ""]),
      seedReasons: uniqueNonEmpty([
        ...(input.hit.graphMetadata?.seedReasons ?? []),
        promotedReason,
      ]),
      graphScore: (input.hit.graphMetadata?.graphScore ?? 0) + graphBoost,
      hopDepth: Math.max(input.hit.graphMetadata?.hopDepth ?? 1, 2),
    },
    diversityMetadata: {
      promotedReason,
      replacedSourceType: input.replacedSourceType ?? input.hit.diversityMetadata?.replacedSourceType ?? null,
    },
  } satisfies RetrievalHitView;
}

export function applyOrganizationalBridgeGuard(input: {
  hits: RetrievalHitView[];
  finalK: number;
  signals: RetrievalSignals;
}) {
  if (input.finalK <= 0 || input.hits.length <= input.finalK) return input.hits;

  const { directBridgePaths, relatedBridgePaths } = collectOrganizationalBridgePaths(input);
  if (directBridgePaths.size === 0 && relatedBridgePaths.size === 0) return input.hits;

  const selected = input.hits.slice(0, input.finalK);
  const selectedAnnotated = selected.map((hit) => {
    const matchType = matchOrganizationalBridgePath({
      hit,
      directBridgePaths,
      relatedBridgePaths,
    });
    return matchType ? annotateOrganizationalBridgeHit({ hit, matchType }) : hit;
  });

  if (selectedAnnotated.some((hit) => hit.diversityMetadata?.promotedReason === "organizational_bridge_related_path")) {
    return [...selectedAnnotated, ...input.hits.slice(input.finalK)];
  }

  const promotedCandidate = input.hits
    .slice(input.finalK)
    .map((hit) => ({
      hit,
      matchType: matchOrganizationalBridgePath({
        hit,
        directBridgePaths,
        relatedBridgePaths,
      }),
    }))
    .filter((entry): entry is { hit: RetrievalHitView; matchType: Exclude<OrganizationalBridgeMatchType, null> } => entry.matchType !== null)
    .sort((left, right) => {
      const leftRelated = left.matchType === "related" ? 1 : 0;
      const rightRelated = right.matchType === "related" ? 1 : 0;
      if (rightRelated !== leftRelated) return rightRelated - leftRelated;
      const leftExecutable = isExecutableEvidenceSourceType(left.hit.sourceType) ? 1 : 0;
      const rightExecutable = isExecutableEvidenceSourceType(right.hit.sourceType) ? 1 : 0;
      if (rightExecutable !== leftExecutable) return rightExecutable - leftExecutable;
      if (right.hit.fusedScore !== left.hit.fusedScore) return right.hit.fusedScore - left.hit.fusedScore;
      return right.hit.updatedAt.getTime() - left.hit.updatedAt.getTime();
    })[0];

  if (!promotedCandidate) {
    return [...selectedAnnotated, ...input.hits.slice(input.finalK)];
  }

  const replacementIndex = [...selectedAnnotated]
    .map((hit, index) => ({ hit, index }))
    .reverse()
    .find(({ hit }) =>
      classifyOrganizationalArtifact(hit) != null
      || !isExecutableEvidenceSourceType(hit.sourceType))?.index ?? (selectedAnnotated.length - 1);
  const replaced = selectedAnnotated[replacementIndex] ?? null;
  const promoted = annotateOrganizationalBridgeHit({
    hit: promotedCandidate.hit,
    matchType: promotedCandidate.matchType,
    replacedSourceType: replaced?.sourceType ?? null,
  });
  const adjustedSelected = selectedAnnotated.map((hit, index) => (index === replacementIndex ? promoted : hit));
  let promotedRemoved = false;
  const remainingHits = input.hits.filter((hit) => {
    if (!promotedRemoved && hit.chunkId === promotedCandidate.hit.chunkId) {
      promotedRemoved = true;
      return false;
    }
    return true;
  });

  return [...adjustedSelected, ...remainingHits.slice(input.finalK)];
}

export function applyGraphConnectivityGuard(input: {
  hits: RetrievalHitView[];
  finalK: number;
  signals: RetrievalSignals;
}) {
  if (input.finalK <= 0 || input.hits.length <= input.finalK) return input.hits;

  const selected = input.hits.slice(0, input.finalK);
  if (selected.some((hit) => (hit.graphMetadata?.hopDepth ?? 1) > 1)) {
    return input.hits;
  }

  const promotedCandidate = input.hits
    .slice(input.finalK)
    .filter((hit) => (hit.graphMetadata?.hopDepth ?? 1) > 1)
    .sort((left, right) => {
      const leftExecutable = isExecutableEvidenceSourceType(left.sourceType) ? 1 : 0;
      const rightExecutable = isExecutableEvidenceSourceType(right.sourceType) ? 1 : 0;
      if (rightExecutable !== leftExecutable) return rightExecutable - leftExecutable;
      const leftPathMatch = matchesDirectExactPath(left, input.signals) ? 1 : 0;
      const rightPathMatch = matchesDirectExactPath(right, input.signals) ? 1 : 0;
      if (rightPathMatch !== leftPathMatch) return rightPathMatch - leftPathMatch;
      if (right.fusedScore !== left.fusedScore) return right.fusedScore - left.fusedScore;
      return right.updatedAt.getTime() - left.updatedAt.getTime();
    })[0];
  if (!promotedCandidate) return input.hits;

  const replacementIndex = [...selected]
    .map((hit, index) => ({ hit, index }))
    .reverse()
    .find(({ hit }) => classifyOrganizationalArtifact(hit) != null || !isExecutableEvidenceSourceType(hit.sourceType))?.index
      ?? (selected.length - 1);
  const replaced = selected[replacementIndex] ?? null;
  const promoted = {
    ...promotedCandidate,
    diversityMetadata: {
      promotedReason: isExecutableEvidenceSourceType(promotedCandidate.sourceType) ? "graph_multihop_code" : "graph_multihop_context",
      replacedSourceType: replaced?.sourceType ?? null,
    },
  } satisfies RetrievalHitView;
  const adjustedSelected = selected.map((hit, index) => (index === replacementIndex ? promoted : hit));
  let promotedRemoved = false;
  const remainingHits = input.hits.filter((hit) => {
    if (!promotedRemoved && hit.chunkId === promotedCandidate.chunkId) {
      promotedRemoved = true;
      return false;
    }
    return true;
  });

  return [...adjustedSelected, ...remainingHits.slice(input.finalK)];
}

export function buildFeedbackPathLabel(pathValue: string | null) {
  if (!pathValue) return null;
  return path.posix.basename(normalizeHintPath(pathValue));
}
