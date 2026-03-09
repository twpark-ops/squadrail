import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_OPENAI_EMBEDDING_MODEL,
  knowledgeEmbeddingService,
  normalizeEmbeddingInput,
} from "../services/knowledge-embeddings.js";

describe("knowledge embedding service", () => {
  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.SQUADRAIL_KNOWLEDGE_OPENAI_API_KEY;
    delete process.env.SQUADRAIL_KNOWLEDGE_EMBEDDING_MODEL;
    delete process.env.SQUADRAIL_KNOWLEDGE_EMBEDDING_PROVIDER;
    vi.restoreAllMocks();
  });

  it("normalizes blank embedding input safely", () => {
    expect(normalizeEmbeddingInput("   \n\t ")).toBe("[blank]");
    expect(normalizeEmbeddingInput("hello\nworld")).toBe("hello world");
  });

  it("reports unavailable provider info when no API key exists", () => {
    const service = knowledgeEmbeddingService();
    expect(service.getProviderInfo()).toEqual({
      available: false,
      provider: null,
      model: null,
      dimensions: 1536,
      endpoint: null,
    });
  });

  it("calls OpenAI embeddings endpoint and returns vectors", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        model: DEFAULT_OPENAI_EMBEDDING_MODEL,
        usage: {
          prompt_tokens: 12,
          total_tokens: 12,
        },
        data: [
          {
            index: 0,
            embedding: Array.from({ length: 1536 }, (_, index) => index / 1000),
          },
        ],
      }),
    } as Response);

    const service = knowledgeEmbeddingService();
    const result = await service.generateEmbeddings(["retry policy"]);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe("https://api.openai.com/v1/embeddings");
    expect(init).toMatchObject({
      method: "POST",
    });
    expect(result.provider).toBe("openai");
    expect(result.model).toBe(DEFAULT_OPENAI_EMBEDDING_MODEL);
    expect(result.dimensions).toBe(1536);
    expect(result.embeddings[0]).toHaveLength(1536);
    expect(result.usage.totalTokens).toBe(12);
  });
});
