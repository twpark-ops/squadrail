import { readConfigFile } from "../config-file.js";

const DEFAULT_OPENAI_RERANK_ENDPOINT = "https://api.openai.com/v1/responses";
const DEFAULT_RERANK_TIMEOUT_MS = 15_000;
const DEFAULT_RERANK_MAX_CANDIDATES = 8;

export interface KnowledgeRerankProviderInfo {
  available: boolean;
  provider: "openai" | null;
  model: string | null;
  endpoint: string | null;
  maxCandidates: number;
}

type OpenAiRerankConfig = {
  provider: "openai";
  apiKey: string;
  model: string;
  endpoint: string;
  timeoutMs: number;
  maxCandidates: number;
};

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

function resolveOpenAiRerankConfig(): OpenAiRerankConfig | null {
  const config = readConfigFile();
  const providerOverride =
    process.env.SQUADRAIL_KNOWLEDGE_RERANK_PROVIDER?.trim() ||
    process.env.SQUADRAIL_KNOWLEDGE_RERANK_PROVIDER?.trim();
  const providerFromConfig = config?.llm?.provider?.trim();
  const provider = providerOverride || providerFromConfig || "openai";
  if (provider !== "openai") return null;

  const model =
    process.env.SQUADRAIL_KNOWLEDGE_RERANK_MODEL?.trim() ||
    process.env.SQUADRAIL_KNOWLEDGE_RERANK_MODEL?.trim();
  if (!model) return null;

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
    model,
    endpoint:
      process.env.SQUADRAIL_KNOWLEDGE_RERANK_ENDPOINT?.trim() ||
      process.env.SQUADRAIL_KNOWLEDGE_RERANK_ENDPOINT?.trim() ||
      DEFAULT_OPENAI_RERANK_ENDPOINT,
    timeoutMs: toPositiveInt(
      process.env.SQUADRAIL_KNOWLEDGE_RERANK_TIMEOUT_MS,
      DEFAULT_RERANK_TIMEOUT_MS,
    ),
    maxCandidates: Math.min(
      24,
      toPositiveInt(
        process.env.SQUADRAIL_KNOWLEDGE_RERANK_MAX_CANDIDATES,
        DEFAULT_RERANK_MAX_CANDIDATES,
      ),
    ),
  };
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
        content: [
          {
            type: "input_text",
            text: buildSystemPrompt(),
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: buildUserPrompt(input),
          },
        ],
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
              items: {
                type: "string",
              },
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

async function fetchOpenAiRerank(input: {
  config: OpenAiRerankConfig;
  queryText: string;
  recipientRole: string;
  workflowState: string;
  summary: string;
  candidates: RerankCandidateInput[];
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.config.timeoutMs);

  try {
    const response = await fetch(input.config.endpoint, {
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
      signal: controller.signal,
    });

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
      model: typeof payload.model === "string" ? payload.model : input.config.model,
      usage: {
        inputTokens: Number(payload.usage?.input_tokens ?? 0) || 0,
        outputTokens: Number(payload.usage?.output_tokens ?? 0) || 0,
        totalTokens: Number(payload.usage?.total_tokens ?? 0) || 0,
      },
      ...parseRerankJson(responseText, input.candidates.map((candidate) => candidate.chunkId)),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function knowledgeRerankingService() {
  return {
    getProviderInfo(): KnowledgeRerankProviderInfo {
      const config = resolveOpenAiRerankConfig();
      if (!config) {
        return {
          available: false,
          provider: null,
          model: null,
          endpoint: null,
          maxCandidates: DEFAULT_RERANK_MAX_CANDIDATES,
        };
      }

      return {
        available: true,
        provider: config.provider,
        model: config.model,
        endpoint: config.endpoint,
        maxCandidates: config.maxCandidates,
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
      const config = resolveOpenAiRerankConfig();
      if (!config) {
        throw new Error(
          "Knowledge reranking is not configured. Set SQUADRAIL_KNOWLEDGE_RERANK_MODEL and OPENAI_API_KEY.",
        );
      }

      const candidates = input.candidates
        .slice(0, config.maxCandidates)
        .map((candidate) => ({
          ...candidate,
          excerpt: compactText(candidate.excerpt),
        }));
      const result = await fetchOpenAiRerank({
        config,
        queryText: input.queryText,
        recipientRole: input.recipientRole,
        workflowState: input.workflowState,
        summary: input.summary,
        candidates,
      });

      return {
        provider: config.provider,
        model: result.model,
        rankedChunkIds: result.rankedChunkIds,
        rationales: result.rationales,
        usage: result.usage,
      };
    },
  };
}

export {
  DEFAULT_OPENAI_RERANK_ENDPOINT,
  resolveOpenAiRerankConfig,
};
