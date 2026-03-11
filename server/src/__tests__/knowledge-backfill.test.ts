import { describe, expect, it } from "vitest";
import {
  buildEmbeddingMetadata,
  compareGraphRebuildDocuments,
  needsEmbeddingRefresh,
} from "../services/knowledge-backfill.js";

describe("knowledge backfill helpers", () => {
  it("detects stale embedding metadata", () => {
    expect(
      needsEmbeddingRefresh(
        {
          embeddingProvider: "openai",
          embeddingModel: "text-embedding-3-small",
          embeddingDimensions: 1536,
        },
        {
          provider: "openai",
          model: "text-embedding-3-small",
          dimensions: 1536,
        },
      ),
    ).toBe(false);

    expect(
      needsEmbeddingRefresh(
        {
          embeddingProvider: "openai",
          embeddingModel: "text-embedding-3-small",
          embeddingDimensions: 1024,
        },
        {
          provider: "openai",
          model: "text-embedding-3-small",
          dimensions: 1536,
        },
      ),
    ).toBe(true);
  });

  it("merges embedding metadata without dropping existing chunk fields", () => {
    expect(
      buildEmbeddingMetadata(
        {
          sourcePriority: "high",
        },
        {
          provider: "openai",
          model: "text-embedding-3-small",
          dimensions: 1536,
          origin: "generated",
          generatedAt: "2026-03-07T00:00:00.000Z",
        },
      ),
    ).toEqual({
      sourcePriority: "high",
      embeddingProvider: "openai",
      embeddingModel: "text-embedding-3-small",
      embeddingDimensions: 1536,
      embeddingOrigin: "generated",
      embeddingGeneratedAt: "2026-03-07T00:00:00.000Z",
    });
  });

  it("orders code graph rebuild before test reports for the same project", () => {
    const documents = [
      {
        sourceType: "test_report",
        path: "internal/storage/path_test.go",
        updatedAt: new Date("2026-03-11T05:00:00Z"),
      },
      {
        sourceType: "code",
        path: "internal/storage/path.go",
        updatedAt: new Date("2026-03-11T06:00:00Z"),
      },
      {
        sourceType: "code",
        path: "internal/storage/other.go",
        updatedAt: new Date("2026-03-11T04:00:00Z"),
      },
    ];

    const ordered = [...documents].sort(compareGraphRebuildDocuments);
    expect(ordered.map((entry) => `${entry.sourceType}:${entry.path}`)).toEqual([
      "code:internal/storage/other.go",
      "code:internal/storage/path.go",
      "test_report:internal/storage/path_test.go",
    ]);
  });
});
