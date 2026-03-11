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
    delete process.env.SQUADRAIL_KNOWLEDGE_RERANK_AUTH_HEADER_NAME;
    delete process.env.SQUADRAIL_KNOWLEDGE_RERANK_AUTH_HEADER_VALUE;
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
      reason: "missing_openai_model_or_api_key",
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

  it("supports generic_http provider contracts", async () => {
    process.env.SQUADRAIL_KNOWLEDGE_RERANK_PROVIDER = "generic_http";
    process.env.SQUADRAIL_KNOWLEDGE_RERANK_ENDPOINT = "http://127.0.0.1:9999/rerank";
    process.env.SQUADRAIL_KNOWLEDGE_RERANK_MODEL = "proxy-rerank";
    process.env.SQUADRAIL_KNOWLEDGE_RERANK_AUTH_HEADER_NAME = "x-rerank-key";
    process.env.SQUADRAIL_KNOWLEDGE_RERANK_AUTH_HEADER_VALUE = "secret";

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        provider: "generic_http",
        model: "proxy-rerank",
        rankedChunkIds: ["chunk-1"],
        rationales: [
          { chunkId: "chunk-1", reason: "Proxy ranked direct match first" },
        ],
        usage: {
          inputTokens: 21,
          outputTokens: 5,
          totalTokens: 26,
        },
      }),
    } as Response);

    const service = knowledgeRerankingService();
    expect(service.getProviderInfo()).toEqual({
      available: true,
      provider: "generic_http",
      model: "proxy-rerank",
      endpoint: "http://127.0.0.1:9999/rerank",
      maxCandidates: 8,
      reason: null,
    });

    const result = await service.rerankCandidates({
      queryText: "pin the retry worker implementation path",
      recipientRole: "reviewer",
      workflowState: "under_review",
      summary: "Review retrieval cache change",
      candidates: [
        {
          chunkId: "chunk-1",
          sourceType: "code",
          authorityLevel: "working",
          path: "src/retry.ts",
          symbolName: "retryWorker",
          title: "retry.ts",
          excerpt: "function retryWorker() { return boundedRetry(); }",
          fusedScore: 3.1,
        },
      ],
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe("http://127.0.0.1:9999/rerank");
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-rerank-key": "secret",
      },
    });
    expect(result.provider).toBe("generic_http");
    expect(result.rankedChunkIds).toEqual(["chunk-1"]);
    expect(result.rationales.get("chunk-1")).toBe("Proxy ranked direct match first");
    expect(result.usage.totalTokens).toBe(26);
  });
});
