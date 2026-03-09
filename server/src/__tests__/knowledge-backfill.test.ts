import { describe, expect, it } from "vitest";
import { buildEmbeddingMetadata, needsEmbeddingRefresh } from "../services/knowledge-backfill.js";

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
});
