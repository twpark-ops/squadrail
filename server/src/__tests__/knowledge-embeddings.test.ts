import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createEmbeddingBatches,
  DEFAULT_OPENAI_EMBEDDING_MODEL,
  estimateEmbeddingTokenUsage,
  knowledgeEmbeddingService,
  normalizeEmbeddingInput,
  shrinkEmbeddingInputForRetry,
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

  it("truncates oversized embedding input to a safe token budget", () => {
    const oversized = Array.from({ length: 6505 }, (_, index) => `token${index}`).join(" ");
    const normalized = normalizeEmbeddingInput(oversized);
    const tokens = normalized.split(" ").filter(Boolean);

    expect(tokens.length).toBeLessThanOrEqual(4001);
    expect(normalized.endsWith("[truncated]")).toBe(true);
  });

  it("truncates oversized embedding input by character length before token overflow", () => {
    const oversized = "x".repeat(25_000);
    const normalized = normalizeEmbeddingInput(oversized);

    expect(normalized.length).toBeLessThanOrEqual(12_012);
    expect(normalized.endsWith("[truncated]")).toBe(true);
  });

  it("estimates token usage conservatively for batching", () => {
    expect(estimateEmbeddingTokenUsage("hello world")).toBeGreaterThanOrEqual(2);
    expect(estimateEmbeddingTokenUsage("x".repeat(120))).toBeGreaterThanOrEqual(30);
  });

  it("splits embedding batches before exceeding the token budget", () => {
    const large = "token ".repeat(1500).trim();
    const batches = createEmbeddingBatches({
      texts: [large, large, large],
      maxBatchSize: 32,
      maxBatchTokens: 6000,
    });

    expect(batches).toHaveLength(2);
    expect(batches[0]).toHaveLength(2);
    expect(batches[1]).toHaveLength(1);
  });

  it("shrinks a single embedding input for retry without dropping it", () => {
    const original = "token ".repeat(2000).trim();
    const reduced = shrinkEmbeddingInputForRetry(original);

    expect(reduced.length).toBeLessThan(original.length);
    expect(reduced.endsWith("[truncated]")).toBe(true);
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

  it("splits large embedding jobs into multiple API calls when token budget would overflow", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const payload = JSON.parse(String(init?.body ?? "{}")) as {
        input?: string[];
      };
      const inputs = Array.isArray(payload.input) ? payload.input : [];
      return {
        ok: true,
        json: async () => ({
          model: DEFAULT_OPENAI_EMBEDDING_MODEL,
          usage: {
            prompt_tokens: inputs.length * 10,
            total_tokens: inputs.length * 10,
          },
          data: inputs.map((_, index) => ({
            index,
            embedding: Array.from({ length: 1536 }, () => 0.001 * (index + 1)),
          })),
        }),
      } as Response;
    });

    const service = knowledgeEmbeddingService();
    const large = "token ".repeat(1500).trim();
    const result = await service.generateEmbeddings([large, large, large]);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const firstPayload = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body ?? "{}")) as { input?: string[] };
    const secondPayload = JSON.parse(String(fetchSpy.mock.calls[1]?.[1]?.body ?? "{}")) as { input?: string[] };
    expect(firstPayload.input).toHaveLength(2);
    expect(secondPayload.input).toHaveLength(1);
    expect(result.embeddings).toHaveLength(3);
  });

  it("retries oversized embedding requests by splitting the batch on context-limit errors", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const payload = JSON.parse(String(init?.body ?? "{}")) as {
        input?: string[];
      };
      const inputs = Array.isArray(payload.input) ? payload.input : [];
      if (inputs.length > 1) {
        return {
          ok: false,
          status: 400,
          text: async () => JSON.stringify({
            error: {
              message: "This model's maximum context length is 8192 tokens, however you requested 9000 tokens.",
            },
          }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({
          model: DEFAULT_OPENAI_EMBEDDING_MODEL,
          usage: {
            prompt_tokens: 10,
            total_tokens: 10,
          },
          data: [{
            index: 0,
            embedding: Array.from({ length: 1536 }, () => 0.01),
          }],
        }),
      } as Response;
    });

    const service = knowledgeEmbeddingService();
    const result = await service.generateEmbeddings(["alpha", "beta", "gamma"]);

    expect(fetchSpy).toHaveBeenCalledTimes(5);
    expect(result.embeddings).toHaveLength(3);
  });

  it("retries a single oversized embedding input by shrinking it", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const payload = JSON.parse(String(init?.body ?? "{}")) as {
        input?: string[];
      };
      const inputs = Array.isArray(payload.input) ? payload.input : [];
      const first = inputs[0] ?? "";
      if (first.length > 5000) {
        return {
          ok: false,
          status: 400,
          text: async () => JSON.stringify({
            error: {
              message: "This model's maximum context length is 8192 tokens, however you requested 9000 tokens.",
            },
          }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({
          model: DEFAULT_OPENAI_EMBEDDING_MODEL,
          usage: {
            prompt_tokens: 10,
            total_tokens: 10,
          },
          data: [{
            index: 0,
            embedding: Array.from({ length: 1536 }, () => 0.02),
          }],
        }),
      } as Response;
    });

    const service = knowledgeEmbeddingService();
    const result = await service.generateEmbeddings(["token ".repeat(2000).trim()]);

    expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    const retryPayload = JSON.parse(
      String(fetchSpy.mock.calls.at(-1)?.[1]?.body ?? "{}"),
    ) as { input?: string[] };
    expect(retryPayload.input?.[0]?.endsWith("[truncated]")).toBe(true);
    expect(result.embeddings).toHaveLength(1);
  });
});
