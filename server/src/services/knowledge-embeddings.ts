import { KNOWLEDGE_EMBEDDING_DIMENSIONS } from "@squadrail/db";
import { readConfigFile } from "../config-file.js";

const DEFAULT_OPENAI_EMBEDDING_MODEL = "text-embedding-3-small";
const DEFAULT_OPENAI_EMBEDDINGS_ENDPOINT = "https://api.openai.com/v1/embeddings";
const DEFAULT_EMBEDDING_TIMEOUT_MS = 15_000;
const DEFAULT_EMBEDDING_BATCH_SIZE = 32;

export interface KnowledgeEmbeddingProviderInfo {
  available: boolean;
  provider: "openai" | null;
  model: string | null;
  dimensions: number;
  endpoint: string | null;
}

type OpenAiEmbeddingConfig = {
  provider: "openai";
  apiKey: string;
  model: string;
  endpoint: string;
  dimensions: number;
  timeoutMs: number;
  batchSize: number;
};

type EmbeddingsResponse = {
  model?: unknown;
  usage?: {
    prompt_tokens?: unknown;
    total_tokens?: unknown;
  };
  data?: Array<{
    index?: unknown;
    embedding?: unknown;
  }>;
};

function toPositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function normalizeEmbeddingInput(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : "[blank]";
}

function resolveOpenAiEmbeddingConfig(): OpenAiEmbeddingConfig | null {
  const config = readConfigFile();
  const providerOverride =
    process.env.SQUADRAIL_KNOWLEDGE_EMBEDDING_PROVIDER?.trim() ||
    process.env.SQUADRAIL_KNOWLEDGE_EMBEDDING_PROVIDER?.trim();
  const providerFromConfig = config?.llm?.provider?.trim();
  const provider = providerOverride || providerFromConfig || "openai";
  if (provider !== "openai") return null;

  const envApiKey =
    process.env.SQUADRAIL_KNOWLEDGE_OPENAI_API_KEY?.trim() ||
    process.env.SQUADRAIL_KNOWLEDGE_OPENAI_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim();
  const configApiKey =
    config?.llm?.provider === "openai"
      ? config.llm.apiKey?.trim()
      : undefined;
  const apiKey = envApiKey || configApiKey;
  if (!apiKey) return null;

  return {
    provider: "openai",
    apiKey,
    model:
      process.env.SQUADRAIL_KNOWLEDGE_EMBEDDING_MODEL?.trim() ||
      process.env.SQUADRAIL_KNOWLEDGE_EMBEDDING_MODEL?.trim() ||
      DEFAULT_OPENAI_EMBEDDING_MODEL,
    endpoint:
      process.env.SQUADRAIL_KNOWLEDGE_EMBEDDING_ENDPOINT?.trim() ||
      process.env.SQUADRAIL_KNOWLEDGE_EMBEDDING_ENDPOINT?.trim() ||
      DEFAULT_OPENAI_EMBEDDINGS_ENDPOINT,
    dimensions: KNOWLEDGE_EMBEDDING_DIMENSIONS,
    timeoutMs: toPositiveInt(
      process.env.SQUADRAIL_KNOWLEDGE_EMBEDDING_TIMEOUT_MS,
      DEFAULT_EMBEDDING_TIMEOUT_MS,
    ),
    batchSize: Math.min(
      128,
      toPositiveInt(
        process.env.SQUADRAIL_KNOWLEDGE_EMBEDDING_BATCH_SIZE,
        DEFAULT_EMBEDDING_BATCH_SIZE,
      ),
    ),
  };
}

function buildRequestBody(config: OpenAiEmbeddingConfig, inputs: string[]) {
  return {
    model: config.model,
    input: inputs,
    encoding_format: "float",
    ...(config.model.startsWith("text-embedding-3")
      ? { dimensions: config.dimensions }
      : {}),
  };
}

function parseEmbeddingVector(
  value: unknown,
  expectedDimensions: number,
): number[] {
  if (!Array.isArray(value) || value.length !== expectedDimensions) {
    throw new Error(`Embedding dimension mismatch (expected ${expectedDimensions})`);
  }

  return value.map((entry) => {
    const numeric = Number(entry);
    if (!Number.isFinite(numeric)) {
      throw new Error("Embedding payload contained a non-numeric value");
    }
    return numeric;
  });
}

async function fetchOpenAiEmbeddings(
  config: OpenAiEmbeddingConfig,
  inputs: string[],
): Promise<{ model: string; embeddings: number[][]; promptTokens: number; totalTokens: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(config.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildRequestBody(config, inputs)),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Embedding request failed (${response.status}): ${body.slice(0, 200)}`);
    }

    const payload = (await response.json()) as EmbeddingsResponse;
    const items = Array.isArray(payload.data) ? payload.data.slice() : [];
    const ordered = items.sort((a, b) => Number(a.index ?? 0) - Number(b.index ?? 0));
    if (ordered.length !== inputs.length) {
      throw new Error(`Embedding response count mismatch (expected ${inputs.length}, received ${ordered.length})`);
    }

    return {
      model: typeof payload.model === "string" ? payload.model : config.model,
      embeddings: ordered.map((item) => parseEmbeddingVector(item.embedding, config.dimensions)),
      promptTokens: Number(payload.usage?.prompt_tokens ?? 0) || 0,
      totalTokens: Number(payload.usage?.total_tokens ?? 0) || 0,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function knowledgeEmbeddingService() {
  return {
    getProviderInfo(): KnowledgeEmbeddingProviderInfo {
      const config = resolveOpenAiEmbeddingConfig();
      if (!config) {
        return {
          available: false,
          provider: null,
          model: null,
          dimensions: KNOWLEDGE_EMBEDDING_DIMENSIONS,
          endpoint: null,
        };
      }

      return {
        available: true,
        provider: config.provider,
        model: config.model,
        dimensions: config.dimensions,
        endpoint: config.endpoint,
      };
    },

    isConfigured() {
      return this.getProviderInfo().available;
    },

    fingerprint() {
      const info = this.getProviderInfo();
      if (!info.available || !info.provider || !info.model) return null;
      return `${info.provider}:${info.model}:${info.dimensions}`;
    },

    async generateEmbeddings(texts: string[]) {
      const config = resolveOpenAiEmbeddingConfig();
      if (!config) {
        throw new Error(
          "Knowledge embeddings are not configured. Set OPENAI_API_KEY or SQUADRAIL_KNOWLEDGE_OPENAI_API_KEY.",
        );
      }

      const normalized = texts.map(normalizeEmbeddingInput);
      const embeddings: number[][] = [];
      let promptTokens = 0;
      let totalTokens = 0;
      let responseModel = config.model;

      for (let start = 0; start < normalized.length; start += config.batchSize) {
        const batch = normalized.slice(start, start + config.batchSize);
        const result = await fetchOpenAiEmbeddings(config, batch);
        responseModel = result.model || responseModel;
        promptTokens += result.promptTokens;
        totalTokens += result.totalTokens;
        embeddings.push(...result.embeddings);
      }

      return {
        provider: config.provider,
        model: responseModel,
        dimensions: config.dimensions,
        embeddings,
        usage: {
          promptTokens,
          totalTokens,
        },
      };
    },
  };
}

export {
  DEFAULT_OPENAI_EMBEDDING_MODEL,
  normalizeEmbeddingInput,
  resolveOpenAiEmbeddingConfig,
};
