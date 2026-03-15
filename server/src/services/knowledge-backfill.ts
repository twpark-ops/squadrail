import type { Db } from "@squadrail/db";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { knowledgeDocuments } from "@squadrail/db";
import { logActivity } from "./activity-log.js";
import { knowledgeEmbeddingService } from "./knowledge-embeddings.js";
import { buildCodeGraphForWorkspaceFile } from "./knowledge-import.js";
import { syncKnowledgeSummaryDocuments } from "./knowledge-summary.js";
import { knowledgeService } from "./knowledge.js";
import { projectService } from "./projects.js";
import { inspectWorkspaceVersionContext } from "./workspace-git-snapshot.js";

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

function readString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function compareGraphRebuildDocuments(
  left: { sourceType: string; path: string | null; updatedAt: Date },
  right: { sourceType: string; path: string | null; updatedAt: Date },
) {
  const sourcePriority = (sourceType: string) => {
    if (sourceType === "code") return 0;
    if (sourceType === "test_report") return 1;
    return 2;
  };

  const sourceDiff = sourcePriority(left.sourceType) - sourcePriority(right.sourceType);
  if (sourceDiff !== 0) return sourceDiff;

  const pathDiff = String(left.path ?? "").localeCompare(String(right.path ?? ""), "en");
  if (pathDiff !== 0) return pathDiff;

  return left.updatedAt.getTime() - right.updatedAt.getTime();
}

export function knowledgeBackfillService(db: Db) {
  const knowledge = knowledgeService(db);
  const embeddings = knowledgeEmbeddingService();
  const projects = projectService(db);

  async function recordVersionFromDocumentMetadata(document: {
    id: string;
    companyId: string;
    projectId: string | null;
    path: string | null;
    repoRef: string | null;
    metadata: Record<string, unknown> | null;
  }) {
    const metadata = document.metadata ?? {};
    return knowledge.recordDocumentVersion({
      companyId: document.companyId,
      documentId: document.id,
      projectId: document.projectId,
      path: document.path,
      repoRef: document.repoRef,
      branchName: readString(metadata.versionBranchName),
      defaultBranchName: readString(metadata.versionDefaultBranchName),
      commitSha: readString(metadata.versionCommitSha),
      parentCommitSha: readString(metadata.versionParentCommitSha),
      isHead: metadata.versionIsHead !== false,
      isDefaultBranch: metadata.versionIsDefaultBranch === true,
      capturedAt: readString(metadata.versionCapturedAt),
      metadata: {
        source: readString(metadata.importSource) ?? "backfill",
      },
    });
  }

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
      const replacementChunks = chunks.map((chunk, index) => ({
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
      }));
      const codeGraph = document.path && document.language && document.rawContent
        ? buildCodeGraphForWorkspaceFile({
          relativePath: document.path,
          content: document.rawContent,
          language: document.language,
          chunks: replacementChunks,
        })
        : null;

      const replacedChunks = await knowledge.replaceDocumentChunks({
        companyId: document.companyId,
        documentId: document.id,
        codeGraph,
        chunks: replacementChunks,
      });

      await knowledge.updateDocumentMetadata(document.id, {
        embeddingProvider: result.provider,
        embeddingModel: result.model,
        embeddingDimensions: result.dimensions,
        embeddingOrigin: origin,
        embeddingGeneratedAt: generatedAt,
        embeddingChunkCount: replacedChunks.length,
        codeGraphSymbolCount: codeGraph?.symbols.length ?? 0,
        codeGraphEdgeCount: codeGraph?.edges.length ?? 0,
        embeddingTotalTokens: result.usage.totalTokens,
      });
      await recordVersionFromDocumentMetadata(document);

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

    async rebuildDocumentGraph(input: {
      documentId: string;
      actor: {
        actorType: "agent" | "user" | "system";
        actorId: string;
        agentId?: string;
        runId?: string;
      };
    }) {
      const document = await knowledge.getDocumentById(input.documentId);
      if (!document) return null;
      if (!document.path || !document.language || !document.rawContent) {
        return {
          documentId: document.id,
          companyId: document.companyId,
          chunkCount: 0,
          symbolCount: 0,
          edgeCount: 0,
          skipped: true,
        };
      }
      if (!["code", "test_report"].includes(document.sourceType)) {
        return {
          documentId: document.id,
          companyId: document.companyId,
          chunkCount: 0,
          symbolCount: 0,
          edgeCount: 0,
          skipped: true,
        };
      }

      const chunks = await knowledge.listDocumentChunksWithLinks(document.id);
      if (chunks.length === 0) {
        return {
          documentId: document.id,
          companyId: document.companyId,
          chunkCount: 0,
          symbolCount: 0,
          edgeCount: 0,
          skipped: true,
        };
      }

      const replacementChunks = chunks.map((chunk) => ({
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
        embedding: Array.isArray(chunk.embedding) ? chunk.embedding : [],
        metadata: chunk.metadata ?? {},
        links: chunk.links,
      }));
      const codeGraph = buildCodeGraphForWorkspaceFile({
        relativePath: document.path,
        content: document.rawContent,
        language: document.language,
        chunks: replacementChunks,
      });

      const replacedChunks = await knowledge.replaceDocumentChunks({
        companyId: document.companyId,
        documentId: document.id,
        codeGraph,
        chunks: replacementChunks,
      });

      await knowledge.updateDocumentMetadata(document.id, {
        codeGraphSymbolCount: codeGraph?.symbols.length ?? 0,
        codeGraphEdgeCount: codeGraph?.edges.length ?? 0,
        codeGraphRebuiltAt: new Date().toISOString(),
      });
      await recordVersionFromDocumentMetadata(document);
      await syncKnowledgeSummaryDocuments({
        knowledge,
        embeddings,
        sourceDocument: {
          id: document.id,
          companyId: document.companyId,
          projectId: document.projectId,
          sourceType: document.sourceType,
          authorityLevel: "canonical",
          repoUrl: null,
          repoRef: document.repoRef,
          path: document.path,
          language: document.language,
          rawContent: document.rawContent,
          metadata: document.metadata,
        },
        baseTags: Array.isArray(document.metadata?.tags)
          ? document.metadata.tags.filter((value): value is string => typeof value === "string")
          : [],
        codeChunks: replacementChunks,
        codeGraph,
      });

      await logActivity(db, {
        companyId: document.companyId,
        actorType: input.actor.actorType,
        actorId: input.actor.actorId,
        agentId: input.actor.agentId,
        runId: input.actor.runId,
        action: "knowledge.document.graph_rebuilt",
        entityType: "project",
        entityId: document.projectId ?? document.issueId ?? document.id,
        details: {
          documentId: document.id,
          chunkCount: replacedChunks.length,
          symbolCount: codeGraph?.symbols.length ?? 0,
          edgeCount: codeGraph?.edges.length ?? 0,
        },
      });

      return {
        documentId: document.id,
        companyId: document.companyId,
        chunkCount: replacedChunks.length,
        symbolCount: codeGraph?.symbols.length ?? 0,
        edgeCount: codeGraph?.edges.length ?? 0,
        skipped: false,
      };
    },

    async rebuildCompanyCodeGraph(input: {
      companyId: string;
      projectIds?: string[];
      limit?: number;
    }) {
      const projectIds = Array.from(new Set((input.projectIds ?? []).filter(Boolean)));
      const documents = await db
        .select({
          id: knowledgeDocuments.id,
          path: knowledgeDocuments.path,
          sourceType: knowledgeDocuments.sourceType,
          updatedAt: knowledgeDocuments.updatedAt,
        })
        .from(knowledgeDocuments)
        .where(and(
          eq(knowledgeDocuments.companyId, input.companyId),
          projectIds.length > 0 ? inArray(knowledgeDocuments.projectId, projectIds) : sql`true`,
          inArray(knowledgeDocuments.sourceType, ["code", "test_report"]),
          ne(knowledgeDocuments.authorityLevel, "deprecated"),
          sql`coalesce(${knowledgeDocuments.metadata} ->> 'isLatestForScope', 'true') <> 'false'`,
        ))
        .orderBy(desc(knowledgeDocuments.updatedAt))
        .limit(input.limit ?? 500);

      const orderedDocuments = [...documents].sort(compareGraphRebuildDocuments);

      let processed = 0;
      let skipped = 0;
      for (const document of orderedDocuments) {
        const result = await this.rebuildDocumentGraph({
          documentId: document.id,
          actor: {
            actorType: "system",
            actorId: "knowledge_graph_backfill",
          },
        });
        if (!result || result.skipped) {
          skipped += 1;
          continue;
        }
        processed += 1;
      }

      return {
        companyId: input.companyId,
        scanned: orderedDocuments.length,
        processed,
        skipped,
      };
    },

    async rebuildCompanyDocumentVersions(input: {
      companyId: string;
      projectIds?: string[];
      limit?: number;
    }) {
      const selectedProjectIds = Array.from(new Set((input.projectIds ?? []).filter(Boolean)));
      const companyProjects = (await projects.list(input.companyId))
        .filter((project) => selectedProjectIds.length === 0 || selectedProjectIds.includes(project.id));
      let scanned = 0;
      let processed = 0;
      let skipped = 0;

      for (const project of companyProjects) {
        const workspace = project.primaryWorkspace ?? project.workspaces.find((entry: { cwd?: string | null }) => Boolean(entry.cwd)) ?? null;
        if (!workspace?.cwd) continue;

        const versionContext = await inspectWorkspaceVersionContext({ cwd: workspace.cwd });
        if (!versionContext?.branchName && !versionContext?.headSha) continue;
        let processedForProject = 0;

        const documents = await db
          .select({
            id: knowledgeDocuments.id,
            companyId: knowledgeDocuments.companyId,
            projectId: knowledgeDocuments.projectId,
            path: knowledgeDocuments.path,
            repoRef: knowledgeDocuments.repoRef,
            metadata: knowledgeDocuments.metadata,
          })
          .from(knowledgeDocuments)
          .where(and(
            eq(knowledgeDocuments.companyId, input.companyId),
            eq(knowledgeDocuments.projectId, project.id),
            ne(knowledgeDocuments.authorityLevel, "deprecated"),
            sql`coalesce(${knowledgeDocuments.metadata} ->> 'importSource', '') = 'workspace'`,
          ))
          .orderBy(desc(knowledgeDocuments.updatedAt))
          .limit(input.limit ?? 1000);

        for (const document of documents) {
          scanned += 1;
          if (!document.path) {
            skipped += 1;
            continue;
          }

          await knowledge.updateDocumentMetadata(document.id, {
            versionBranchName: versionContext.branchName,
            versionDefaultBranchName: versionContext.defaultBranchName,
            versionCommitSha: versionContext.headSha,
            versionParentCommitSha: versionContext.parentCommitSha,
            versionCapturedAt: versionContext.capturedAt,
            versionIsDefaultBranch: versionContext.isDefaultBranch,
            versionIsHead: true,
          });
          await knowledge.recordDocumentVersion({
            companyId: document.companyId,
            documentId: document.id,
            projectId: document.projectId,
            path: document.path,
            repoRef: document.repoRef,
            branchName: versionContext.branchName,
            defaultBranchName: versionContext.defaultBranchName,
            commitSha: versionContext.headSha,
            parentCommitSha: versionContext.parentCommitSha,
            isHead: true,
            isDefaultBranch: versionContext.isDefaultBranch,
            capturedAt: versionContext.capturedAt,
            metadata: {
              source: "version_backfill",
              workspaceId: workspace.id,
              workspaceName: workspace.name,
            },
          });
          processed += 1;
          processedForProject += 1;
        }

        if (processedForProject > 0) {
          await knowledge.touchProjectKnowledgeRevision({
            companyId: input.companyId,
            projectId: project.id,
            bump: true,
            headSha: versionContext.headSha,
            treeSignature: versionContext.treeSignature,
            importMode: "version_backfill",
            importedAt: versionContext.capturedAt,
            metadata: {
              workspaceId: workspace.id,
              workspaceName: workspace.name,
              processedDocuments: processedForProject,
            },
          });
        }
      }

      return {
        companyId: input.companyId,
        scanned,
        processed,
        skipped,
      };
    },
  };
}

export { buildEmbeddingMetadata };
