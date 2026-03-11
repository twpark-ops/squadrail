import {
  DEFAULT_OPENAI_RERANK_ENDPOINT,
  DEFAULT_RERANK_MAX_CANDIDATES,
  resolveGenericHttpRerankConfig,
  resolveOpenAiRerankConfig,
  resolveProviderName,
  resolveRerankConfig,
  type KnowledgeRerankProviderInfo,
  type RerankCandidateInput,
} from "./knowledge-rerank/config.js";
import {
  fetchGenericHttpRerank,
  fetchOpenAiRerank,
} from "./knowledge-rerank/providers.js";

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

      const candidates = input.candidates.slice(0, config.maxCandidates);

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
  resolveGenericHttpRerankConfig,
  resolveOpenAiRerankConfig,
};
