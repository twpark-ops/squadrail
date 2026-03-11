import { classifyOrganizationalArtifact } from "../retrieval-evidence-guards.js";
import { metadataStringArray, normalizeHintPath, uniqueNonEmpty } from "./shared.js";
import type {
  RetrievalChunkSymbolView,
  RetrievalGraphSeed,
  RetrievalHitView,
  RetrievalLinkView,
  RetrievalSignals,
  RetrievalSymbolGraphSeed,
} from "../issue-retrieval.js";

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

  for (const exactPath of input.signals.exactPaths.slice(0, Math.min(maxSeeds, 6))) {
    pushSeed({
      entityType: "path",
      entityId: normalizeHintPath(exactPath),
      seedBoost: 1.9,
      seedReasons: ["signal_exact_path"],
    });
  }

  for (const symbolHint of input.signals.symbolHints
    .filter((hint) => hint.trim().length >= 3)
    .slice(0, Math.min(maxSeeds, 6))) {
    pushSeed({
      entityType: "symbol",
      entityId: symbolHint,
      seedBoost: 1.4,
      seedReasons: ["signal_symbol_hint"],
    });
  }

  if (crossProjectRequested) {
    for (const projectId of input.signals.projectAffinityIds.slice(0, Math.min(maxSeeds, 4))) {
      pushSeed({
        entityType: "project",
        entityId: projectId,
        seedBoost: 0.7,
        seedReasons: ["signal_project_affinity"],
      });
    }
  }

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
    if (hit.documentIssueId && classifyOrganizationalArtifact(hit) != null) {
      pushSeed({
        entityType: "issue",
        entityId: hit.documentIssueId,
        seedBoost: hit.sourceType === "review" ? 1.15 : 0.95,
        seedReasons: ["top_hit_issue_context"],
      });
    }

    for (const changedPath of metadataStringArray(hit.documentMetadata, ["changedPaths"]).slice(0, 3)) {
      pushSeed({
        entityType: "path",
        entityId: normalizeHintPath(changedPath),
        seedBoost: 1.15,
        seedReasons: ["top_hit_changed_path"],
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
      } else if (link.entityType === "issue") {
        pushSeed({
          entityType: "issue",
          entityId: link.entityId,
          seedBoost: Math.max(0.78, link.weight * 0.72),
          seedReasons: ["linked_issue_context"],
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

export function deriveSemanticGraphHopDepth(input: {
  traversalHopDepth: number;
  seedReasons: string[];
}) {
  const normalizedReasons = input.seedReasons;
  const derivedContextHop = normalizedReasons.some((reason) =>
    reason === "top_hit_issue_context"
    || reason === "linked_issue_context"
    || reason === "top_hit_changed_path")
    ? 1
    : 0;
  return Math.max(1, input.traversalHopDepth + derivedContextHop);
}

export function shouldAllowGraphExactPathRediscovery(input: {
  hopDepth: number;
  seeds: RetrievalGraphSeed[];
}) {
  if (input.hopDepth <= 1) return false;
  return input.seeds.some((seed) =>
    seed.entityType === "path"
    && seed.seedReasons.some((reason) =>
      reason === "linked_issue_context"
      || reason === "top_hit_issue_context"
      || reason === "top_hit_changed_path"
      || reason.startsWith("graph_hop:")
      || reason.startsWith("graph_escalated_")));
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
          hopDepth: [existing.graphMetadata?.hopDepth, hit.graphMetadata?.hopDepth]
            .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
            .sort((left, right) => right - left)[0],
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
