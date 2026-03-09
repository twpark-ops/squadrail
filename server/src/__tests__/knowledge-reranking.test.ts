import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_OPENAI_RERANK_ENDPOINT,
  knowledgeRerankingService,
} from "../services/knowledge-reranking.js";

describe("knowledge reranking service", () => {
  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.SQUADRAIL_KNOWLEDGE_OPENAI_API_KEY;
    delete process.env.SQUADRAIL_KNOWLEDGE_RERANK_MODEL;
    delete process.env.SQUADRAIL_KNOWLEDGE_RERANK_PROVIDER;
    delete process.env.SQUADRAIL_KNOWLEDGE_RERANK_ENDPOINT;
    vi.restoreAllMocks();
  });

  it("reports unavailable provider info when no rerank model exists", () => {
    const service = knowledgeRerankingService();
    expect(service.getProviderInfo()).toEqual({
      available: false,
      provider: null,
      model: null,
      endpoint: null,
      maxCandidates: 8,
    });
  });

  it("calls the responses endpoint and parses ranked chunk ids", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.SQUADRAIL_KNOWLEDGE_RERANK_MODEL = "gpt-4.1-mini";

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        model: "gpt-4.1-mini",
        output_text: JSON.stringify({
          rankedChunkIds: ["chunk-2", "chunk-1"],
          rationales: [
            { chunkId: "chunk-2", reason: "Direct code match" },
            { chunkId: "chunk-1", reason: "Canonical ADR context" },
          ],
        }),
        usage: {
          input_tokens: 48,
          output_tokens: 18,
          total_tokens: 66,
        },
      }),
    } as Response);

    const service = knowledgeRerankingService();
    const result = await service.rerankCandidates({
      queryText: "retry worker idempotency backoff",
      recipientRole: "reviewer",
      workflowState: "submitted_for_review",
      summary: "Review retry worker changes",
      candidates: [
        {
          chunkId: "chunk-1",
          sourceType: "adr",
          authorityLevel: "canonical",
          path: "docs/adr/retries.md",
          symbolName: null,
          title: "Retry ADR",
          excerpt: "Use bounded retries and idempotency keys.",
          fusedScore: 3.2,
        },
        {
          chunkId: "chunk-2",
          sourceType: "code",
          authorityLevel: "working",
          path: "src/retry.ts",
          symbolName: "retryWorker",
          title: "retry.ts",
          excerpt: "function retryWorker() { return boundedRetry(); }",
          fusedScore: 2.9,
        },
      ],
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe(DEFAULT_OPENAI_RERANK_ENDPOINT);
    expect(init).toMatchObject({
      method: "POST",
    });
    expect(result.model).toBe("gpt-4.1-mini");
    expect(result.rankedChunkIds).toEqual(["chunk-2", "chunk-1"]);
    expect(result.rationales.get("chunk-2")).toBe("Direct code match");
    expect(result.usage.totalTokens).toBe(66);
  });
});
