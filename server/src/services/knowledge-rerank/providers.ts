import type {
  GenericHttpRerankConfig,
  KnowledgeRerankResult,
  OpenAiRerankConfig,
  RerankCandidateInput,
} from "./config.js";

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

function compactText(value: string, max = 280) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1)}...`;
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

export async function fetchOpenAiRerank(input: {
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

export async function fetchGenericHttpRerank(input: {
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
