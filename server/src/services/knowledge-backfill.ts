import type { Db } from "@squadrail/db";
import { logActivity } from "./activity-log.js";
import { knowledgeEmbeddingService } from "./knowledge-embeddings.js";
import { knowledgeService } from "./knowledge.js";

export function needsEmbeddingRefresh(
  metadata: Record<string, unknown> | null | undefined,
  expected: {
    provider: string;
    model: string;
    dimensions: number;
  },
) {
  return (
    String(metadata?.embeddingProvider ?? "") !== expected.provider
    || String(metadata?.embeddingModel ?? "") !== expected.model
    || String(metadata?.embeddingDimensions ?? "") !== String(expected.dimensions)
  );
}

function buildEmbeddingMetadata(
  metadata: Record<string, unknown> | null | undefined,
  input: {
    provider: string;
    model: string;
    dimensions: number;
    origin: "generated" | "regenerated" | "backfill";
    generatedAt: string;
  },
) {
  return {
    ...(metadata ?? {}),
    embeddingProvider: input.provider,
    embeddingModel: input.model,
    embeddingDimensions: input.dimensions,
    embeddingOrigin: input.origin,
    embeddingGeneratedAt: input.generatedAt,
  };
}

export function knowledgeBackfillService(db: Db) {
  const knowledge = knowledgeService(db);
  const embeddings = knowledgeEmbeddingService();

  return {
    async reembedDocument(input: {
      documentId: string;
      actor: {
        actorType: "agent" | "user" | "system";
        actorId: string;
        agentId?: string;
        runId?: string;
      };
      origin?: "generated" | "regenerated" | "backfill";
    }) {
      const providerInfo = embeddings.getProviderInfo();
      if (!providerInfo.available || !providerInfo.provider || !providerInfo.model) {
        throw new Error("Knowledge embedding provider is not configured");
      }

      const document = await knowledge.getDocumentById(input.documentId);
      if (!document) return null;

      const chunks = await knowledge.listDocumentChunksWithLinks(document.id);
      if (chunks.length === 0) {
        await knowledge.updateDocumentMetadata(document.id, {
          embeddingProvider: providerInfo.provider,
          embeddingModel: providerInfo.model,
          embeddingDimensions: providerInfo.dimensions,
          embeddingGeneratedAt: new Date().toISOString(),
          embeddingOrigin: input.origin ?? "backfill",
          embeddingChunkCount: 0,
        });
        return {
          documentId: document.id,
          companyId: document.companyId,
          chunkCount: 0,
          provider: providerInfo.provider,
          model: providerInfo.model,
          dimensions: providerInfo.dimensions,
        };
      }

      const result = await embeddings.generateEmbeddings(chunks.map((chunk) => chunk.textContent));
      const generatedAt = new Date().toISOString();
      const origin = input.origin ?? "backfill";

      const replacedChunks = await knowledge.replaceDocumentChunks({
        companyId: document.companyId,
        documentId: document.id,
        chunks: chunks.map((chunk, index) => ({
          chunkIndex: chunk.chunkIndex,
          headingPath: chunk.headingPath,
          symbolName: chunk.symbolName,
          tokenCount: chunk.tokenCount,
          textContent: chunk.textContent,
          searchText: [
            chunk.headingPath ?? "",
            chunk.symbolName ?? "",
            chunk.textContent,
          ].filter(Boolean).join("\n"),
          embedding: result.embeddings[index]!,
          metadata: buildEmbeddingMetadata(chunk.metadata, {
            provider: result.provider,
            model: result.model,
            dimensions: result.dimensions,
            origin,
            generatedAt,
          }),
          links: chunk.links,
        })),
      });

      await knowledge.updateDocumentMetadata(document.id, {
        embeddingProvider: result.provider,
        embeddingModel: result.model,
        embeddingDimensions: result.dimensions,
        embeddingOrigin: origin,
        embeddingGeneratedAt: generatedAt,
        embeddingChunkCount: replacedChunks.length,
        embeddingTotalTokens: result.usage.totalTokens,
      });

      await logActivity(db, {
        companyId: document.companyId,
        actorType: input.actor.actorType,
        actorId: input.actor.actorId,
        agentId: input.actor.agentId,
        runId: input.actor.runId,
        action: "knowledge.document.reembedded",
        entityType: "project",
        entityId: document.projectId ?? document.issueId ?? document.id,
        details: {
          documentId: document.id,
          chunkCount: replacedChunks.length,
          provider: result.provider,
          model: result.model,
          dimensions: result.dimensions,
          totalTokens: result.usage.totalTokens,
          origin,
        },
      });

      return {
        documentId: document.id,
        companyId: document.companyId,
        chunkCount: replacedChunks.length,
        provider: result.provider,
        model: result.model,
        dimensions: result.dimensions,
        totalTokens: result.usage.totalTokens,
      };
    },

    async tick(input?: {
      limit?: number;
    }) {
      const providerInfo = embeddings.getProviderInfo();
      if (!providerInfo.available || !providerInfo.provider || !providerInfo.model) {
        return {
          enabled: false,
          scanned: 0,
          processed: 0,
          failed: 0,
        };
      }

      const staleDocuments = await knowledge.listDocumentsNeedingEmbeddingRefresh({
        embeddingProvider: providerInfo.provider,
        embeddingModel: providerInfo.model,
        embeddingDimensions: providerInfo.dimensions,
        limit: input?.limit ?? 5,
      });

      let processed = 0;
      let failed = 0;
      for (const document of staleDocuments) {
        try {
          const result = await this.reembedDocument({
            documentId: document.id,
            actor: {
              actorType: "system",
              actorId: "knowledge_backfill_worker",
            },
            origin: "backfill",
          });
          if (result) processed += 1;
        } catch {
          failed += 1;
        }
      }

      return {
        enabled: true,
        scanned: staleDocuments.length,
        processed,
        failed,
      };
    },
  };
}

export { buildEmbeddingMetadata };
