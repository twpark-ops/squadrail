import { describe, expect, it } from "vitest";
import type { RetrievalHitView, RetrievalSignals } from "../services/issue-retrieval.js";
import {
  classifyOrganizationalArtifact,
  isExecutableEvidenceSourceType,
  appendUniqueRetrievalHits,
  applyOrganizationalMemorySaturationGuard,
  applyEvidenceDiversityGuard,
  applyOrganizationalBridgeGuard,
  applyGraphConnectivityGuard,
  buildFeedbackPathLabel,
} from "../services/retrieval-evidence-guards.js";

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function buildHit(overrides: Partial<RetrievalHitView> = {}): RetrievalHitView {
  return {
    chunkId: overrides.chunkId ?? crypto.randomUUID(),
    documentId: overrides.documentId ?? crypto.randomUUID(),
    sourceType: overrides.sourceType ?? "issue",
    authorityLevel: overrides.authorityLevel ?? "company",
    documentIssueId: overrides.documentIssueId ?? null,
    documentProjectId: overrides.documentProjectId ?? null,
    path: overrides.path ?? null,
    title: overrides.title ?? null,
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

function buildSignals(overrides: Partial<RetrievalSignals> = {}): RetrievalSignals {
  return {
    exactPaths: overrides.exactPaths ?? [],
    fileNames: overrides.fileNames ?? [],
    symbolHints: overrides.symbolHints ?? [],
    knowledgeTags: overrides.knowledgeTags ?? [],
    preferredSourceTypes: overrides.preferredSourceTypes ?? [],
    projectAffinityIds: overrides.projectAffinityIds ?? [],
    projectAffinityNames: overrides.projectAffinityNames ?? [],
    blockerCode: overrides.blockerCode ?? null,
    questionType: overrides.questionType ?? null,
  };
}

/* ------------------------------------------------------------------ */
/*  classifyOrganizationalArtifact                                    */
/* ------------------------------------------------------------------ */

describe("classifyOrganizationalArtifact", () => {
  it('returns "issue" when sourceType is issue', () => {
    const hit = buildHit({ sourceType: "issue" });
    expect(classifyOrganizationalArtifact(hit)).toBe("issue");
  });

  it('returns "issue" when artifactKind metadata is issue_snapshot', () => {
    const hit = buildHit({
      sourceType: "code",
      documentMetadata: { artifactKind: "issue_snapshot" },
    });
    expect(classifyOrganizationalArtifact(hit)).toBe("issue");
  });

  it('returns "review" when sourceType is review', () => {
    const hit = buildHit({ sourceType: "review" });
    expect(classifyOrganizationalArtifact(hit)).toBe("review");
  });

  it('returns "review" when artifactKind metadata is review_event', () => {
    const hit = buildHit({
      sourceType: "code",
      documentMetadata: { artifactKind: "review_event" },
    });
    expect(classifyOrganizationalArtifact(hit)).toBe("review");
  });

  it('returns "protocol" when sourceType is protocol_message', () => {
    const hit = buildHit({ sourceType: "protocol_message" });
    expect(classifyOrganizationalArtifact(hit)).toBe("protocol");
  });

  it("returns null for non-organizational source types", () => {
    const hit = buildHit({ sourceType: "code" });
    expect(classifyOrganizationalArtifact(hit)).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/*  isExecutableEvidenceSourceType                                    */
/* ------------------------------------------------------------------ */

describe("isExecutableEvidenceSourceType", () => {
  it("returns true for code and test_report", () => {
    expect(isExecutableEvidenceSourceType("code")).toBe(true);
    expect(isExecutableEvidenceSourceType("test_report")).toBe(true);
  });

  it("returns false for non-executable source types", () => {
    expect(isExecutableEvidenceSourceType("issue")).toBe(false);
    expect(isExecutableEvidenceSourceType("review")).toBe(false);
    expect(isExecutableEvidenceSourceType("protocol_message")).toBe(false);
    expect(isExecutableEvidenceSourceType("")).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  appendUniqueRetrievalHits                                         */
/* ------------------------------------------------------------------ */

describe("appendUniqueRetrievalHits", () => {
  it("appends fallback hits that are not already present", () => {
    const base = [buildHit({ chunkId: "a" }), buildHit({ chunkId: "b" })];
    const fallback = [buildHit({ chunkId: "c" }), buildHit({ chunkId: "d" })];
    const result = appendUniqueRetrievalHits(base, fallback);
    expect(result.map((h) => h.chunkId)).toEqual(["a", "b", "c", "d"]);
  });

  it("deduplicates hits already present in base", () => {
    const base = [buildHit({ chunkId: "a" }), buildHit({ chunkId: "b" })];
    const fallback = [buildHit({ chunkId: "b" }), buildHit({ chunkId: "c" })];
    const result = appendUniqueRetrievalHits(base, fallback);
    expect(result.map((h) => h.chunkId)).toEqual(["a", "b", "c"]);
  });
});

/* ------------------------------------------------------------------ */
/*  applyOrganizationalMemorySaturationGuard                          */
/* ------------------------------------------------------------------ */

describe("applyOrganizationalMemorySaturationGuard", () => {
  it("applies a penalty to repeated organizational hits sharing the same path", () => {
    // Two issue hits referencing the same path — the second should be penalized
    const hits = [
      buildHit({
        chunkId: "first",
        sourceType: "issue",
        path: "server/src/worker.ts",
        fusedScore: 5,
      }),
      buildHit({
        chunkId: "second",
        sourceType: "issue",
        path: "server/src/worker.ts",
        fusedScore: 4.5,
      }),
    ];

    const result = applyOrganizationalMemorySaturationGuard({ hits, finalK: 2 });
    const first = result.find((h) => h.chunkId === "first")!;
    const second = result.find((h) => h.chunkId === "second")!;

    // First hit has no penalty (repeatedPathCount === 0)
    expect(first.saturationMetadata?.penalty).toBe(0);
    // Second hit is penalized (repeatedPathCount >= 1)
    expect(second.saturationMetadata!.penalty).toBeLessThan(0);
    expect(second.fusedScore).toBeLessThan(4.5);
  });

  it("preserves the first occurrence without penalty", () => {
    const hits = [
      buildHit({
        chunkId: "only",
        sourceType: "issue",
        path: "server/src/worker.ts",
        fusedScore: 5,
      }),
    ];
    const result = applyOrganizationalMemorySaturationGuard({ hits, finalK: 2 });
    const hit = result.find((h) => h.chunkId === "only")!;
    expect(hit.saturationMetadata?.penalty).toBe(0);
    expect(hit.fusedScore).toBe(5);
  });

  it("does not penalize non-organizational hits", () => {
    const hits = [
      buildHit({
        chunkId: "code1",
        sourceType: "code",
        path: "server/src/worker.ts",
        fusedScore: 5,
      }),
      buildHit({
        chunkId: "code2",
        sourceType: "code",
        path: "server/src/worker.ts",
        fusedScore: 4,
      }),
    ];
    const result = applyOrganizationalMemorySaturationGuard({ hits, finalK: 2 });
    // Both should have saturationMetadata === null (non-organizational)
    for (const hit of result) {
      expect(hit.saturationMetadata).toBeNull();
      expect(hit.fusedScore).toBeGreaterThanOrEqual(4);
    }
  });
});

/* ------------------------------------------------------------------ */
/*  applyEvidenceDiversityGuard                                       */
/* ------------------------------------------------------------------ */

describe("applyEvidenceDiversityGuard", () => {
  it("promotes a code hit from outside finalK when executable evidence is missing in the window", () => {
    // Selected window: 2 issue hits, no executable evidence
    // Outside window: 1 code hit that matches exactPaths
    const hits = [
      buildHit({ chunkId: "iss-1", sourceType: "issue", fusedScore: 5 }),
      buildHit({ chunkId: "iss-2", sourceType: "issue", fusedScore: 4 }),
      buildHit({ chunkId: "code-1", sourceType: "code", path: "server/worker.ts", fusedScore: 3 }),
    ];
    const signals = buildSignals({ exactPaths: ["server/worker.ts"] });

    const result = applyEvidenceDiversityGuard({ hits, finalK: 2, signals });
    const selected = result.slice(0, 2);
    // The code hit should have been promoted into the selected window
    expect(selected.some((h) => h.chunkId === "code-1")).toBe(true);
    expect(selected.find((h) => h.chunkId === "code-1")!.diversityMetadata?.promotedReason).toBe("exact_path_code");
  });

  it("does not promote when executable evidence already exists in the window", () => {
    const hits = [
      buildHit({ chunkId: "code-1", sourceType: "code", path: "server/worker.ts", fusedScore: 5 }),
      buildHit({ chunkId: "iss-1", sourceType: "issue", fusedScore: 4 }),
      buildHit({ chunkId: "code-2", sourceType: "code", path: "server/worker.ts", fusedScore: 3 }),
    ];
    const signals = buildSignals({ exactPaths: ["server/worker.ts"] });

    const result = applyEvidenceDiversityGuard({ hits, finalK: 2, signals });
    // No change — executable evidence already in window
    expect(result.slice(0, 2).map((h) => h.chunkId)).toEqual(["code-1", "iss-1"]);
  });

  it("returns hits unchanged when exactPaths is empty", () => {
    const hits = [
      buildHit({ chunkId: "a", fusedScore: 5 }),
      buildHit({ chunkId: "b", fusedScore: 4 }),
    ];
    const signals = buildSignals({ exactPaths: [] });
    const result = applyEvidenceDiversityGuard({ hits, finalK: 1, signals });
    expect(result).toBe(hits);
  });
});

/* ------------------------------------------------------------------ */
/*  applyOrganizationalBridgeGuard                                    */
/* ------------------------------------------------------------------ */

describe("applyOrganizationalBridgeGuard", () => {
  it("promotes a companion-path code hit into the selected window", () => {
    // exactPaths references a .ts file; a companion .test.ts code hit sits outside the window
    const hits = [
      buildHit({ chunkId: "iss-1", sourceType: "issue", fusedScore: 10, documentMetadata: { changedPaths: ["src/worker.ts"] } }),
      buildHit({ chunkId: "iss-2", sourceType: "review", fusedScore: 9 }),
      // Outside finalK=2:
      buildHit({ chunkId: "test-1", sourceType: "code", path: "src/worker.test.ts", fusedScore: 3 }),
    ];
    const signals = buildSignals({ exactPaths: ["src/worker.ts"] });

    const result = applyOrganizationalBridgeGuard({ hits, finalK: 2, signals });
    const selected = result.slice(0, 2);
    // The companion test file should have been promoted
    expect(selected.some((h) => h.chunkId === "test-1")).toBe(true);
    const promoted = selected.find((h) => h.chunkId === "test-1")!;
    expect(promoted.diversityMetadata?.promotedReason).toBe("organizational_bridge_related_path");
  });

  it("returns hits unchanged when there are no bridge paths", () => {
    const hits = [
      buildHit({ chunkId: "a", sourceType: "code", fusedScore: 5 }),
      buildHit({ chunkId: "b", sourceType: "code", fusedScore: 4 }),
      buildHit({ chunkId: "c", sourceType: "code", fusedScore: 3 }),
    ];
    const signals = buildSignals({ exactPaths: [] });
    const result = applyOrganizationalBridgeGuard({ hits, finalK: 2, signals });
    expect(result).toBe(hits);
  });
});

/* ------------------------------------------------------------------ */
/*  applyGraphConnectivityGuard                                       */
/* ------------------------------------------------------------------ */

describe("applyGraphConnectivityGuard", () => {
  it("promotes a multi-hop hit when none exist in the selected window", () => {
    // Selected window: two single-hop hits
    // Outside window: one multi-hop code hit
    const hits = [
      buildHit({ chunkId: "single-1", sourceType: "issue", fusedScore: 10, graphMetadata: { entityTypes: [], entityIds: [], seedReasons: [], graphScore: 1, hopDepth: 1 } }),
      buildHit({ chunkId: "single-2", sourceType: "issue", fusedScore: 9, graphMetadata: { entityTypes: [], entityIds: [], seedReasons: [], graphScore: 1, hopDepth: 1 } }),
      // Outside finalK:
      buildHit({ chunkId: "multi-1", sourceType: "code", path: "src/worker.ts", fusedScore: 4, graphMetadata: { entityTypes: ["path"], entityIds: ["src/worker.ts"], seedReasons: ["graph_hop"], graphScore: 2, hopDepth: 2 } }),
    ];
    const signals = buildSignals({ exactPaths: ["src/worker.ts"] });

    const result = applyGraphConnectivityGuard({ hits, finalK: 2, signals });
    const selected = result.slice(0, 2);
    expect(selected.some((h) => h.chunkId === "multi-1")).toBe(true);
    const promoted = selected.find((h) => h.chunkId === "multi-1")!;
    expect(promoted.diversityMetadata?.promotedReason).toBe("graph_multihop_code");
  });

  it("does not promote when multi-hop hit already exists in the window", () => {
    const hits = [
      buildHit({ chunkId: "multi-1", sourceType: "code", fusedScore: 10, graphMetadata: { entityTypes: [], entityIds: [], seedReasons: [], graphScore: 2, hopDepth: 2 } }),
      buildHit({ chunkId: "single-1", sourceType: "issue", fusedScore: 9 }),
      buildHit({ chunkId: "multi-2", sourceType: "code", fusedScore: 4, graphMetadata: { entityTypes: [], entityIds: [], seedReasons: [], graphScore: 2, hopDepth: 3 } }),
    ];
    const signals = buildSignals();

    const result = applyGraphConnectivityGuard({ hits, finalK: 2, signals });
    // No change — multi-hop already in window
    expect(result).toBe(hits);
  });
});

/* ------------------------------------------------------------------ */
/*  buildFeedbackPathLabel                                            */
/* ------------------------------------------------------------------ */

describe("buildFeedbackPathLabel", () => {
  it("returns the basename from a normalized path", () => {
    expect(buildFeedbackPathLabel("server/src/worker.ts")).toBe("worker.ts");
    expect(buildFeedbackPathLabel("./server\\src\\handler.go")).toBe("handler.go");
  });

  it("returns null for null input", () => {
    expect(buildFeedbackPathLabel(null)).toBeNull();
  });

  it("handles paths with leading ./ and backslashes", () => {
    expect(buildFeedbackPathLabel(".\\dir\\file.js")).toBe("file.js");
  });
});
