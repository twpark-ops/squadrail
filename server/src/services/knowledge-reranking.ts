import { readConfigFile } from "../config-file.js";

const DEFAULT_OPENAI_RERANK_ENDPOINT = "https://api.openai.com/v1/responses";
const DEFAULT_RERANK_TIMEOUT_MS = 15_000;
const DEFAULT_RERANK_MAX_CANDIDATES = 8;

export interface KnowledgeRerankProviderInfo {
  available: boolean;
  provider: "openai" | "generic_http" | null;
  model: string | null;
  endpoint: string | null;
  maxCandidates: number;
  reason: string | null;
}

type RerankCandidateInput = {
  chunkId: string;
  sourceType: string;
  authorityLevel: string;
  path: string | null;
  symbolName: string | null;
  title: string | null;
  excerpt: string;
  fusedScore: number;
};

type KnowledgeRerankResult = {
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

type ResponsesApiPayload = {
  model?: unknown;
  output_text?: unknown;
  output?: Array<{
    content?: Array<{
      text?: unknown;
      type?: unknown;
    }>;
  }>;
  usage?: {
    input_tokens?: unknown;
    output_tokens?: unknown;
    total_tokens?: unknown;
  };
};

type GenericHttpRerankPayload = {
  provider?: unknown;
  model?: unknown;
  rankedChunkIds?: unknown;
  rationales?: unknown;
  usage?: {
    inputTokens?: unknown;
    outputTokens?: unknown;
    totalTokens?: unknown;
  };
};

type OpenAiRerankConfig = {
  provider: "openai";
  apiKey: string;
  model: string;
  endpoint: string;
  timeoutMs: number;
  maxCandidates: number;
};

type GenericHttpRerankConfig = {
  provider: "generic_http";
  model: string;
  endpoint: string;
  timeoutMs: number;
  maxCandidates: number;
  authHeaderName: string | null;
  authHeaderValue: string | null;
};

type ResolvedRerankConfig = OpenAiRerankConfig | GenericHttpRerankConfig;

function toPositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function compactText(value: string, max = 280) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1)}...`;
}

function resolveProviderName() {
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

function resolveRerankConfig(): ResolvedRerankConfig | null {
  return resolveOpenAiRerankConfig() ?? resolveGenericHttpRerankConfig();
}

function buildSystemPrompt() {
  return [
    "You rank knowledge snippets for an AI software squad workflow.",
    "Return only the most relevant chunk IDs in descending order of usefulness.",
    "Prefer canonical or latest evidence when relevance is similar.",
    "Prefer code/test chunks for implementation and review tasks when directly related to the query.",
    "Do not invent chunk IDs and do not repeat IDs.",
  ].join(" ");
}

function buildUserPrompt(input: {
  queryText: string;
  recipientRole: string;
  workflowState: string;
  summary: string;
  candidates: RerankCandidateInput[];
}) {
  return [
    `Recipient role: ${input.recipientRole}`,
    `Workflow state: ${input.workflowState}`,
    `Summary: ${input.summary}`,
    "",
    "Query:",
    input.queryText,
    "",
    "Candidates:",
    JSON.stringify(
      input.candidates.map((candidate) => ({
        chunkId: candidate.chunkId,
        sourceType: candidate.sourceType,
        authorityLevel: candidate.authorityLevel,
        path: candidate.path,
        symbolName: candidate.symbolName,
        title: candidate.title,
        fusedScore: Number(candidate.fusedScore.toFixed(3)),
        excerpt: compactText(candidate.excerpt),
      })),
      null,
      2,
    ),
  ].join("\n");
}

function buildResponsesRequestBody(input: {
  model: string;
  queryText: string;
  recipientRole: string;
  workflowState: string;
  summary: string;
  candidates: RerankCandidateInput[];
}) {
  return {
    model: input.model,
    input: [
      {
        role: "system",
        content: [{ type: "input_text", text: buildSystemPrompt() }],
      },
      {
        role: "user",
        content: [{ type: "input_text", text: buildUserPrompt(input) }],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "knowledge_rerank",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            rankedChunkIds: {
              type: "array",
              items: { type: "string" },
            },
            rationales: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  chunkId: { type: "string" },
                  reason: { type: "string" },
                },
                required: ["chunkId", "reason"],
              },
            },
          },
          required: ["rankedChunkIds", "rationales"],
        },
      },
    },
  };
}

function extractResponseText(payload: ResponsesApiPayload) {
  if (typeof payload.output_text === "string" && payload.output_text.trim().length > 0) {
    return payload.output_text;
  }
  if (!Array.isArray(payload.output)) return null;
  for (const output of payload.output) {
    if (!Array.isArray(output.content)) continue;
    for (const item of output.content) {
      if (typeof item?.text === "string" && item.text.trim().length > 0) {
        return item.text;
      }
    }
  }
  return null;
}

function parseRerankJson(value: string, allowedChunkIds: string[]) {
  const payload = JSON.parse(value) as {
    rankedChunkIds?: unknown;
    rationales?: unknown;
  };
  const allowed = new Set(allowedChunkIds);
  const rankedChunkIds = Array.isArray(payload.rankedChunkIds)
    ? payload.rankedChunkIds.filter((entry): entry is string => typeof entry === "string" && allowed.has(entry))
    : [];
  const uniqueRanked = Array.from(new Set(rankedChunkIds));
  const rationaleEntries = Array.isArray(payload.rationales) ? payload.rationales : [];
  const rationales = new Map<string, string>();
  for (const entry of rationaleEntries) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.chunkId !== "string" || !allowed.has(record.chunkId)) continue;
    if (typeof record.reason !== "string" || !record.reason.trim()) continue;
    rationales.set(record.chunkId, record.reason.trim());
  }
  return {
    rankedChunkIds: uniqueRanked,
    rationales,
  };
}

async function fetchWithTimeout(
  endpoint: string,
  init: RequestInit,
  timeoutMs: number,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(endpoint, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchOpenAiRerank(input: {
  config: OpenAiRerankConfig;
  queryText: string;
  recipientRole: string;
  workflowState: string;
  summary: string;
  candidates: RerankCandidateInput[];
}): Promise<KnowledgeRerankResult> {
  const response = await fetchWithTimeout(input.config.endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildResponsesRequestBody({
      model: input.config.model,
      queryText: input.queryText,
      recipientRole: input.recipientRole,
      workflowState: input.workflowState,
      summary: input.summary,
      candidates: input.candidates,
    })),
  }, input.config.timeoutMs);

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Rerank request failed (${response.status}): ${body.slice(0, 200)}`);
  }

  const payload = (await response.json()) as ResponsesApiPayload;
  const responseText = extractResponseText(payload);
  if (!responseText) {
    throw new Error("Rerank response did not contain structured output text");
  }

  return {
    provider: "openai",
    model: typeof payload.model === "string" ? payload.model : input.config.model,
    usage: {
      inputTokens: Number(payload.usage?.input_tokens ?? 0) || 0,
      outputTokens: Number(payload.usage?.output_tokens ?? 0) || 0,
      totalTokens: Number(payload.usage?.total_tokens ?? 0) || 0,
    },
    ...parseRerankJson(responseText, input.candidates.map((candidate) => candidate.chunkId)),
  };
}

async function fetchGenericHttpRerank(input: {
  config: GenericHttpRerankConfig;
  queryText: string;
  recipientRole: string;
  workflowState: string;
  summary: string;
  candidates: RerankCandidateInput[];
}): Promise<KnowledgeRerankResult> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (input.config.authHeaderName && input.config.authHeaderValue) {
    headers[input.config.authHeaderName] = input.config.authHeaderValue;
  }
  const response = await fetchWithTimeout(input.config.endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      provider: "generic_http",
      model: input.config.model,
      queryText: input.queryText,
      recipientRole: input.recipientRole,
      workflowState: input.workflowState,
      summary: input.summary,
      candidates: input.candidates,
    }),
  }, input.config.timeoutMs);
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Generic HTTP rerank failed (${response.status}): ${body.slice(0, 200)}`);
  }
  const payload = (await response.json()) as GenericHttpRerankPayload;
  const parsed = parseRerankJson(JSON.stringify({
    rankedChunkIds: payload.rankedChunkIds,
    rationales: payload.rationales,
  }), input.candidates.map((candidate) => candidate.chunkId));
  return {
    provider: "generic_http",
    model: typeof payload.model === "string" ? payload.model : input.config.model,
    rankedChunkIds: parsed.rankedChunkIds,
    rationales: parsed.rationales,
    usage: {
      inputTokens: Number(payload.usage?.inputTokens ?? 0) || 0,
      outputTokens: Number(payload.usage?.outputTokens ?? 0) || 0,
      totalTokens: Number(payload.usage?.totalTokens ?? 0) || 0,
    },
  };
}

export function knowledgeRerankingService() {
  return {
    getProviderInfo(): KnowledgeRerankProviderInfo {
      const providerName = resolveProviderName();
      const config = resolveRerankConfig();
      if (!config) {
        return {
          available: false,
          provider: null,
          model: null,
          endpoint: null,
          maxCandidates: DEFAULT_RERANK_MAX_CANDIDATES,
          reason: providerName === "openai"
            ? "missing_openai_model_or_api_key"
            : providerName === "generic_http"
              ? "missing_generic_http_endpoint"
              : `unsupported_provider:${providerName}`,
        };
      }

      return {
        available: true,
        provider: config.provider,
        model: config.model,
        endpoint: config.endpoint,
        maxCandidates: config.maxCandidates,
        reason: null,
      };
    },

    isConfigured() {
      return this.getProviderInfo().available;
    },

    async rerankCandidates(input: {
      queryText: string;
      recipientRole: string;
      workflowState: string;
      summary: string;
      candidates: RerankCandidateInput[];
    }) {
      const config = resolveRerankConfig();
      if (!config) {
        const providerInfo = this.getProviderInfo();
        throw new Error(
          `Knowledge reranking is not configured (${providerInfo.reason ?? "unknown"}).`,
        );
      }

      const candidates = input.candidates
        .slice(0, config.maxCandidates)
        .map((candidate) => ({
          ...candidate,
          excerpt: compactText(candidate.excerpt),
        }));

      if (config.provider === "openai") {
        return fetchOpenAiRerank({
          config,
          queryText: input.queryText,
          recipientRole: input.recipientRole,
          workflowState: input.workflowState,
          summary: input.summary,
          candidates,
        });
      }

      return fetchGenericHttpRerank({
        config,
        queryText: input.queryText,
        recipientRole: input.recipientRole,
        workflowState: input.workflowState,
        summary: input.summary,
        candidates,
      });
    },
  };
}

export {
  DEFAULT_OPENAI_RERANK_ENDPOINT,
  DEFAULT_RERANK_TIMEOUT_MS,
  DEFAULT_RERANK_MAX_CANDIDATES,
};
