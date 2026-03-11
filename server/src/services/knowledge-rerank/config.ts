import { readConfigFile } from "../../config-file.js";

export const DEFAULT_OPENAI_RERANK_ENDPOINT = "https://api.openai.com/v1/responses";
export const DEFAULT_RERANK_TIMEOUT_MS = 15_000;
export const DEFAULT_RERANK_MAX_CANDIDATES = 8;

export interface KnowledgeRerankProviderInfo {
  available: boolean;
  provider: "openai" | "generic_http" | null;
  model: string | null;
  endpoint: string | null;
  maxCandidates: number;
  reason: string | null;
}

export type RerankCandidateInput = {
  chunkId: string;
  sourceType: string;
  authorityLevel: string;
  path: string | null;
  symbolName: string | null;
  title: string | null;
  excerpt: string;
  fusedScore: number;
};

export type KnowledgeRerankResult = {
  provider: "openai" | "generic_http";
  model: string;
  rankedChunkIds: string[];
  rationales: Map<string, string>;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
};

export type OpenAiRerankConfig = {
  provider: "openai";
  apiKey: string;
  model: string;
  endpoint: string;
  timeoutMs: number;
  maxCandidates: number;
};

export type GenericHttpRerankConfig = {
  provider: "generic_http";
  model: string;
  endpoint: string;
  timeoutMs: number;
  maxCandidates: number;
  authHeaderName: string | null;
  authHeaderValue: string | null;
};

export type ResolvedRerankConfig = OpenAiRerankConfig | GenericHttpRerankConfig;

function toPositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

export function resolveProviderName() {
  const config = readConfigFile();
  const providerOverride = process.env.SQUADRAIL_KNOWLEDGE_RERANK_PROVIDER?.trim();
  const providerFromConfig = config?.llm?.provider?.trim();
  return providerOverride || providerFromConfig || "openai";
}

export function resolveOpenAiRerankConfig(): OpenAiRerankConfig | null {
  const config = readConfigFile();
  if (resolveProviderName() !== "openai") return null;

  const model = process.env.SQUADRAIL_KNOWLEDGE_RERANK_MODEL?.trim();
  if (!model) return null;

  const envApiKey =
    process.env.SQUADRAIL_KNOWLEDGE_OPENAI_API_KEY?.trim()
    || process.env.OPENAI_API_KEY?.trim();
  const configApiKey = config?.llm?.provider === "openai" ? config.llm.apiKey?.trim() : undefined;
  const apiKey = envApiKey || configApiKey;
  if (!apiKey) return null;

  return {
    provider: "openai",
    apiKey,
    model,
    endpoint: process.env.SQUADRAIL_KNOWLEDGE_RERANK_ENDPOINT?.trim() || DEFAULT_OPENAI_RERANK_ENDPOINT,
    timeoutMs: toPositiveInt(process.env.SQUADRAIL_KNOWLEDGE_RERANK_TIMEOUT_MS, DEFAULT_RERANK_TIMEOUT_MS),
    maxCandidates: Math.min(24, toPositiveInt(process.env.SQUADRAIL_KNOWLEDGE_RERANK_MAX_CANDIDATES, DEFAULT_RERANK_MAX_CANDIDATES)),
  };
}

export function resolveGenericHttpRerankConfig(): GenericHttpRerankConfig | null {
  if (resolveProviderName() !== "generic_http") return null;
  const endpoint = process.env.SQUADRAIL_KNOWLEDGE_RERANK_ENDPOINT?.trim();
  if (!endpoint) return null;

  return {
    provider: "generic_http",
    model: process.env.SQUADRAIL_KNOWLEDGE_RERANK_MODEL?.trim() || "generic-http-rerank",
    endpoint,
    timeoutMs: toPositiveInt(process.env.SQUADRAIL_KNOWLEDGE_RERANK_TIMEOUT_MS, DEFAULT_RERANK_TIMEOUT_MS),
    maxCandidates: Math.min(24, toPositiveInt(process.env.SQUADRAIL_KNOWLEDGE_RERANK_MAX_CANDIDATES, DEFAULT_RERANK_MAX_CANDIDATES)),
    authHeaderName: process.env.SQUADRAIL_KNOWLEDGE_RERANK_AUTH_HEADER_NAME?.trim() || null,
    authHeaderValue: process.env.SQUADRAIL_KNOWLEDGE_RERANK_AUTH_HEADER_VALUE?.trim() || null,
  };
}

export function resolveRerankConfig(): ResolvedRerankConfig | null {
  return resolveOpenAiRerankConfig() ?? resolveGenericHttpRerankConfig();
}
