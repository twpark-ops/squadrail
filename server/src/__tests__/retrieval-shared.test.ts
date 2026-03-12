import { describe, expect, it } from "vitest";
import type { RetrievalHitView } from "../services/issue-retrieval.js";
import {
  classifyReuseArtifactKind,
  compactWhitespace,
  extractIssueIdentifiers,
  metadataStringArray,
  normalizeHintPath,
  truncateRetrievalSegment,
  uniqueNonEmpty,
} from "../services/retrieval/shared.js";

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

describe("retrieval shared helpers", () => {
  it("deduplicates and trims string lists", () => {
    expect(uniqueNonEmpty([" foo ", "bar", "", "foo", "  ", "bar"])).toEqual(["foo", "bar"]);
  });

  it("normalizes and truncates text helpers", () => {
    expect(normalizeHintPath("./server\\src\\worker.ts")).toBe("server/src/worker.ts");
    expect(compactWhitespace("retry   worker\n\nsummary", 40)).toBe("retry worker summary");
    expect(truncateRetrievalSegment("a".repeat(20), 10)).toBe("aaaaaaa...");
  });

  it("extracts issue identifiers and metadata arrays", () => {
    expect(extractIssueIdentifiers([
      "See ops-10 and OPS-11 for context",
      "OPS-11 already closed",
      null,
      undefined,
    ])).toEqual(["OPS-10", "OPS-11"]);

    expect(metadataStringArray(
      {
        changedPaths: ["server/src/worker.ts", "", 12],
        secondaryPaths: ["docs/runbook.md"],
      },
      ["missing", "changedPaths", "secondaryPaths"],
    )).toEqual(["server/src/worker.ts", "docs/runbook.md"]);
  });

  it("classifies reuse artifact kinds from hit metadata", () => {
    expect(classifyReuseArtifactKind(buildHit({
      sourceType: "code",
      path: "server/src/worker.ts",
    }))).toBe("fix");

    expect(classifyReuseArtifactKind(buildHit({
      sourceType: "review",
    }))).toBe("review");

    expect(classifyReuseArtifactKind(buildHit({
      sourceType: "issue",
      documentMetadata: { messageType: "CLOSE_TASK" },
    }))).toBe("close");

    expect(classifyReuseArtifactKind(buildHit({
      sourceType: "issue",
    }))).toBe("decision");
  });
});
