import { describe, expect, it } from "vitest";
import type { RetrievalHitView } from "../services/issue-retrieval.js";
import {
  computeRetrievalReuseSummary,
  isExactPathSatisfied,
  summarizeBriefQuality,
} from "../services/retrieval/quality.js";

function buildHit(overrides: Partial<RetrievalHitView> = {}): RetrievalHitView {
  return {
    chunkId: overrides.chunkId ?? crypto.randomUUID(),
    documentId: overrides.documentId ?? crypto.randomUUID(),
    sourceType: overrides.sourceType ?? "issue",
    authorityLevel: overrides.authorityLevel ?? "company",
    documentIssueId: overrides.documentIssueId ?? null,
    documentProjectId: overrides.documentProjectId ?? null,
    path: overrides.path ?? null,
    title: overrides.title ?? "Evidence",
    headingPath: overrides.headingPath ?? null,
    symbolName: overrides.symbolName ?? null,
    textContent: overrides.textContent ?? "evidence",
    documentMetadata: overrides.documentMetadata ?? {},
    chunkMetadata: overrides.chunkMetadata ?? {},
    denseScore: overrides.denseScore ?? null,
    sparseScore: overrides.sparseScore ?? null,
    rerankScore: overrides.rerankScore ?? null,
    fusedScore: overrides.fusedScore ?? 1,
    updatedAt: overrides.updatedAt ?? new Date("2026-03-12T00:00:00.000Z"),
    modelRerankRank: overrides.modelRerankRank ?? null,
    graphMetadata: overrides.graphMetadata ?? null,
    temporalMetadata: overrides.temporalMetadata ?? null,
    personalizationMetadata: overrides.personalizationMetadata ?? null,
    saturationMetadata: overrides.saturationMetadata ?? null,
    diversityMetadata: overrides.diversityMetadata ?? null,
  };
}

describe("retrieval quality helpers", () => {
  it("checks whether exact paths are satisfied by final hits", () => {
    const finalHits = [
      buildHit({ path: "server/src/runtime/state.ts" }),
      buildHit({ path: "server/src/runtime/state.test.ts" }),
    ];

    expect(isExactPathSatisfied({
      finalHits,
      exactPaths: ["server/src/runtime/state.ts"],
    })).toBe(true);

    expect(isExactPathSatisfied({
      finalHits,
      exactPaths: ["server/src/runtime/recovery.ts"],
    })).toBe(false);
  });

  it("summarizes related issue reuse across artifact classes", () => {
    const summary = computeRetrievalReuseSummary({
      relatedIssueIds: ["issue-a", "issue-b", "issue-a"],
      relatedIssueIdentifierMap: {
        "issue-a": "OPS-11",
        "issue-b": "OPS-12",
      },
      finalHits: [
        buildHit({
          chunkId: "reuse-decision",
          documentIssueId: "issue-a",
          sourceType: "issue",
        }),
        buildHit({
          chunkId: "reuse-fix",
          documentIssueId: "issue-a",
          sourceType: "code",
        }),
        buildHit({
          chunkId: "reuse-review",
          documentIssueId: "issue-b",
          sourceType: "review",
        }),
        buildHit({
          chunkId: "reuse-close",
          documentIssueId: "issue-b",
          sourceType: "issue",
          documentMetadata: { messageType: "CLOSE_TASK" },
        }),
        buildHit({
          chunkId: "unrelated",
          documentIssueId: "issue-z",
          sourceType: "issue",
        }),
      ],
    });

    expect(summary).toEqual({
      requestedRelatedIssueCount: 2,
      reuseHitCount: 4,
      reusedIssueCount: 2,
      reusedIssueIds: ["issue-a", "issue-b"],
      reusedIssueIdentifiers: ["OPS-11", "OPS-12"],
      reuseArtifactKinds: ["decision", "fix", "review", "close"],
      reuseDecisionHitCount: 1,
      reuseFixHitCount: 1,
      reuseReviewHitCount: 1,
      reuseCloseHitCount: 1,
    });
  });

  it("marks degraded retrieval quality when evidence is sparse and semantic search is absent", () => {
    const quality = summarizeBriefQuality({
      finalHits: [
        buildHit({
          chunkId: "issue-hit",
          documentIssueId: "issue-a",
          sourceType: "issue",
          documentMetadata: { artifactKind: "issue_snapshot" },
        }),
        buildHit({
          chunkId: "issue-hit-2",
          documentIssueId: "issue-a",
          sourceType: "issue",
          documentMetadata: { artifactKind: "issue_snapshot" },
        }),
      ],
      queryEmbedding: null,
      sparseHitCount: 2,
      pathHitCount: 0,
      symbolHitCount: 0,
      denseHitCount: 0,
      graphSeedCount: 1,
      graphHitCount: 0,
      graphEntityTypes: [],
      symbolGraphSeedCount: 0,
      symbolGraphHitCount: 0,
      edgeTraversalCount: 0,
      edgeTypeCounts: {},
      graphMaxDepth: 0,
      graphHopDepthCounts: {},
      multiHopGraphHitCount: 0,
      temporalContext: {
        branchName: "feature/reuse",
        defaultBranchName: "main",
        headSha: "abc123",
        source: "artifact",
      },
      crossProjectRequested: true,
      candidateCacheHit: false,
      finalCacheHit: false,
      exactPathSatisfied: false,
      relatedIssueIds: ["issue-a"],
      relatedIssueIdentifierMap: { "issue-a": "OPS-88" },
    });

    expect(quality.confidenceLevel).toBe("low");
    expect(quality.reuseHitCount).toBe(2);
    expect(quality.reusedIssueIdentifiers).toEqual(["OPS-88"]);
    expect(quality.degradedReasons).toEqual(expect.arrayContaining([
      "semantic_search_unavailable",
      "low_evidence_count",
      "narrow_source_diversity",
      "cross_project_graph_empty",
      "temporal_context_unmatched",
    ]));
    expect(quality.exactPathSatisfied).toBe(false);
  });

  it("keeps high confidence when evidence is dense and diverse", () => {
    const quality = summarizeBriefQuality({
      finalHits: [
        buildHit({ chunkId: "code-a", sourceType: "code", path: "server/src/worker.ts", denseScore: 0.9 }),
        buildHit({ chunkId: "test-a", sourceType: "test_report", path: "server/src/worker.test.ts", denseScore: 0.7 }),
        buildHit({ chunkId: "review-a", sourceType: "review", denseScore: 0.6 }),
        buildHit({ chunkId: "adr-a", sourceType: "adr", denseScore: 0.5 }),
        buildHit({ chunkId: "runbook-a", sourceType: "runbook", denseScore: 0.4 }),
      ],
      queryEmbedding: [0.12, 0.34],
      sparseHitCount: 5,
      pathHitCount: 2,
      symbolHitCount: 1,
      denseHitCount: 5,
      graphSeedCount: 2,
      graphHitCount: 1,
      graphEntityTypes: ["path", "symbol"],
      symbolGraphSeedCount: 1,
      symbolGraphHitCount: 1,
      edgeTraversalCount: 3,
      edgeTypeCounts: { references: 2, owned_by: 1 },
      graphMaxDepth: 2,
      graphHopDepthCounts: { "1": 2, "2": 1 },
      multiHopGraphHitCount: 1,
      temporalContext: null,
      crossProjectRequested: false,
      candidateCacheHit: true,
      finalCacheHit: true,
      exactPathSatisfied: true,
      reuseSummary: {
        requestedRelatedIssueCount: 1,
        reuseHitCount: 1,
        reusedIssueCount: 1,
        reusedIssueIds: ["issue-a"],
        reusedIssueIdentifiers: ["OPS-21"],
        reuseArtifactKinds: ["fix"],
        reuseDecisionHitCount: 0,
        reuseFixHitCount: 1,
        reuseReviewHitCount: 0,
        reuseCloseHitCount: 0,
      },
    });

    expect(quality.confidenceLevel).toBe("high");
    expect(quality.sourceDiversity).toBe(5);
    expect(quality.candidateCacheHit).toBe(true);
    expect(quality.finalCacheHit).toBe(true);
    expect(quality.reuseArtifactKinds).toEqual(["fix"]);
    expect(quality.degradedReasons).toEqual([]);
  });
});
