import { and, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import type { Db } from "@squadrail/db";
import {
  issueTaskBriefs,
  knowledgeChunkLinks,
  knowledgeChunks,
  knowledgeDocuments,
  retrievalPolicies,
  retrievalRunHits,
  retrievalRuns,
} from "@squadrail/db";

export function knowledgeService(db: Db) {
  function eqNullable<TColumn>(column: TColumn, value: string | null | undefined) {
    return value == null ? isNull(column as never) : eq(column as never, value);
  }

  async function hasPgVectorSupport(dbOrTx: Db) {
    const rows = await dbOrTx.execute<{ installed: boolean }>(
      sql`select exists (select 1 from pg_extension where extname = 'vector') as installed`,
    );
    return Boolean(rows[0]?.installed ?? false);
  }

  function formatVectorLiteral(values: number[]) {
    return `[${values.map((value) => Number(value).toString()).join(",")}]`;
  }

  async function syncChunkEmbeddingVectors(dbOrTx: Db, chunks: Array<{ id: string; embedding: number[] }>) {
    if (chunks.length === 0) return;
    if (!(await hasPgVectorSupport(dbOrTx))) return;

    for (const chunk of chunks) {
      if (!Array.isArray(chunk.embedding) || chunk.embedding.length === 0) continue;
      const vectorLiteral = formatVectorLiteral(chunk.embedding);
      await dbOrTx.execute(sql`
        UPDATE knowledge_chunks
        SET embedding_vector = ${vectorLiteral}::vector
        WHERE id = ${chunk.id}
      `);
    }
  }

  return {
    createDocument: async (input: {
      companyId: string;
      sourceType: string;
      authorityLevel: string;
      contentSha256: string;
      rawContent: string;
      repoUrl?: string | null;
      repoRef?: string | null;
      projectId?: string | null;
      issueId?: string | null;
      messageId?: string | null;
      path?: string | null;
      title?: string | null;
      language?: string | null;
      metadata?: Record<string, unknown>;
    }) => {
      const [created] = await db
        .insert(knowledgeDocuments)
        .values({
          companyId: input.companyId,
          sourceType: input.sourceType,
          authorityLevel: input.authorityLevel,
          contentSha256: input.contentSha256,
          rawContent: input.rawContent,
          repoUrl: input.repoUrl ?? null,
          repoRef: input.repoRef ?? null,
          projectId: input.projectId ?? null,
          issueId: input.issueId ?? null,
          messageId: input.messageId ?? null,
          path: input.path ?? null,
          title: input.title ?? null,
          language: input.language ?? null,
          metadata: input.metadata ?? {},
        })
        .onConflictDoNothing()
        .returning();
      if (created) return created;

      return db
        .select()
        .from(knowledgeDocuments)
        .where(
          and(
            eq(knowledgeDocuments.companyId, input.companyId),
            eq(knowledgeDocuments.sourceType, input.sourceType),
            eq(knowledgeDocuments.contentSha256, input.contentSha256),
            eqNullable(knowledgeDocuments.repoUrl, input.repoUrl ?? null),
            eqNullable(knowledgeDocuments.repoRef, input.repoRef ?? null),
            eqNullable(knowledgeDocuments.path, input.path ?? null),
          ),
        )
        .then((rows) => rows[0] ?? null);
    },

    getDocumentById: async (documentId: string) =>
      db
        .select()
        .from(knowledgeDocuments)
        .where(eq(knowledgeDocuments.id, documentId))
        .then((rows) => rows[0] ?? null),

    listDocuments: async (input: {
      companyId: string;
      projectId?: string | null;
      sourceType?: string | null;
      limit?: number;
    }) => {
      const conditions = [eq(knowledgeDocuments.companyId, input.companyId)];

      if (input.projectId) {
        conditions.push(eq(knowledgeDocuments.projectId, input.projectId));
      }

      if (input.sourceType) {
        conditions.push(eq(knowledgeDocuments.sourceType, input.sourceType));
      }

      return db
        .select()
        .from(knowledgeDocuments)
        .where(and(...conditions))
        .orderBy(desc(knowledgeDocuments.updatedAt))
        .limit(input.limit ?? 200);
    },

    getOverview: async (input: {
      companyId: string;
    }) => {
      const [totalsRow, projectRows, sourceRows, authorityRows, languageRows, entityTypeRows] = await Promise.all([
        db.execute<{
          totalDocuments: number;
          totalChunks: number;
          totalLinks: number;
          linkedChunks: number;
          connectedDocuments: number;
        }>(sql`
          select
            (select count(*)::int from knowledge_documents where company_id = ${input.companyId}) as "totalDocuments",
            (select count(*)::int from knowledge_chunks where company_id = ${input.companyId}) as "totalChunks",
            (select count(*)::int from knowledge_chunk_links where company_id = ${input.companyId}) as "totalLinks",
            (select count(distinct chunk_id)::int from knowledge_chunk_links where company_id = ${input.companyId}) as "linkedChunks",
            (
              select count(distinct kc.document_id)::int
              from knowledge_chunk_links kcl
              join knowledge_chunks kc on kc.id = kcl.chunk_id
              where kcl.company_id = ${input.companyId}
            ) as "connectedDocuments"
        `),
        db.execute<{
          projectId: string;
          projectName: string;
          documentCount: number;
          chunkCount: number;
          linkCount: number;
          lastUpdatedAt: string | null;
        }>(sql`
          select
            p.id as "projectId",
            p.name as "projectName",
            count(distinct d.id)::int as "documentCount",
            count(distinct kc.id)::int as "chunkCount",
            count(kcl.id)::int as "linkCount",
            max(d.updated_at)::text as "lastUpdatedAt"
          from projects p
          left join knowledge_documents d
            on d.project_id = p.id
            and d.company_id = ${input.companyId}
          left join knowledge_chunks kc
            on kc.document_id = d.id
            and kc.company_id = ${input.companyId}
          left join knowledge_chunk_links kcl
            on kcl.chunk_id = kc.id
            and kcl.company_id = ${input.companyId}
          where p.company_id = ${input.companyId}
          group by p.id, p.name
          order by count(distinct d.id) desc, p.name asc
        `),
        db.execute<{ key: string; count: number }>(sql`
          select
            source_type as key,
            count(*)::int as count
          from knowledge_documents
          where company_id = ${input.companyId}
          group by source_type
          order by count desc, key asc
        `),
        db.execute<{ key: string; count: number }>(sql`
          select
            authority_level as key,
            count(*)::int as count
          from knowledge_documents
          where company_id = ${input.companyId}
          group by authority_level
          order by count desc, key asc
        `),
        db.execute<{ key: string; count: number }>(sql`
          select
            coalesce(language, 'unknown') as key,
            count(*)::int as count
          from knowledge_documents
          where company_id = ${input.companyId}
          group by coalesce(language, 'unknown')
          order by count desc, key asc
        `),
        db.execute<{ key: string; count: number }>(sql`
          select
            entity_type as key,
            count(*)::int as count
          from knowledge_chunk_links
          where company_id = ${input.companyId}
          group by entity_type
          order by count desc, key asc
        `),
      ]);

      const totals = totalsRow[0] ?? {
        totalDocuments: 0,
        totalChunks: 0,
        totalLinks: 0,
        linkedChunks: 0,
        connectedDocuments: 0,
      };

      return {
        ...totals,
        activeProjects: projectRows.filter((row) => row.documentCount > 0).length,
        projectCoverage: projectRows,
        sourceTypeDistribution: sourceRows,
        authorityDistribution: authorityRows,
        languageDistribution: languageRows,
        linkEntityDistribution: entityTypeRows,
      };
    },

    listDocumentChunks: async (documentId: string) =>
      db
        .select()
        .from(knowledgeChunks)
        .where(eq(knowledgeChunks.documentId, documentId))
        .orderBy(knowledgeChunks.chunkIndex),

    listDocumentChunksWithLinks: async (documentId: string) => {
      const chunks = await db
        .select()
        .from(knowledgeChunks)
        .where(eq(knowledgeChunks.documentId, documentId))
        .orderBy(knowledgeChunks.chunkIndex);

      if (chunks.length === 0) return [];

      const links = await db
        .select()
        .from(knowledgeChunkLinks)
        .where(inArray(knowledgeChunkLinks.chunkId, chunks.map((chunk) => chunk.id)));

      const linksByChunkId = new Map<string, typeof links>();
      for (const link of links) {
        const current = linksByChunkId.get(link.chunkId) ?? [];
        current.push(link);
        linksByChunkId.set(link.chunkId, current);
      }

      return chunks.map((chunk) => ({
        ...chunk,
        links: (linksByChunkId.get(chunk.id) ?? []).map((link) => ({
          entityType: link.entityType,
          entityId: link.entityId,
          linkReason: link.linkReason,
          weight: link.weight,
        })),
      }));
    },

    replaceDocumentChunks: async (input: {
      companyId: string;
      documentId: string;
      chunks: Array<{
        chunkIndex: number;
        headingPath?: string | null;
        symbolName?: string | null;
        tokenCount: number;
        textContent: string;
        searchText?: string;
        embedding: number[];
        metadata?: Record<string, unknown>;
        links?: Array<{
          entityType: string;
          entityId: string;
          linkReason: string;
          weight?: number;
        }>;
      }>;
    }) => db.transaction(async (tx) => {
      await tx.delete(knowledgeChunks).where(eq(knowledgeChunks.documentId, input.documentId));

      if (input.chunks.length === 0) return [];

      const insertedChunks = await tx
        .insert(knowledgeChunks)
        .values(
          input.chunks.map((chunk) => ({
            companyId: input.companyId,
            documentId: input.documentId,
            chunkIndex: chunk.chunkIndex,
            headingPath: chunk.headingPath ?? null,
            symbolName: chunk.symbolName ?? null,
            tokenCount: chunk.tokenCount,
            textContent: chunk.textContent,
            searchTsv: sql`to_tsvector('simple', ${chunk.searchText ?? [
              chunk.headingPath ?? "",
              chunk.symbolName ?? "",
              chunk.textContent,
            ].filter(Boolean).join("\n")})`,
            embedding: chunk.embedding,
            metadata: chunk.metadata ?? {},
          })),
        )
        .returning();

      const links = insertedChunks.flatMap((chunk, idx) =>
        (input.chunks[idx]?.links ?? []).map((link) => ({
          companyId: input.companyId,
          chunkId: chunk.id,
          entityType: link.entityType,
          entityId: link.entityId,
          linkReason: link.linkReason,
          weight: link.weight ?? 1,
        })),
      );

      if (links.length > 0) {
        await tx.insert(knowledgeChunkLinks).values(links);
      }

      await syncChunkEmbeddingVectors(
        tx as unknown as Db,
        insertedChunks.map((chunk, index) => ({
          id: chunk.id,
          embedding: input.chunks[index]?.embedding ?? [],
        })),
      );

      return insertedChunks;
    }),

    updateDocumentMetadata: async (documentId: string, metadataPatch: Record<string, unknown>) => {
      const current = await db
        .select({
          id: knowledgeDocuments.id,
          metadata: knowledgeDocuments.metadata,
        })
        .from(knowledgeDocuments)
        .where(eq(knowledgeDocuments.id, documentId))
        .then((rows) => rows[0] ?? null);
      if (!current) return null;

      const [updated] = await db
        .update(knowledgeDocuments)
        .set({
          metadata: {
            ...(current.metadata ?? {}),
            ...metadataPatch,
          },
          updatedAt: new Date(),
        })
        .where(eq(knowledgeDocuments.id, documentId))
        .returning();
      return updated ?? null;
    },

    deprecateSupersededDocuments: async (input: {
      companyId: string;
      sourceType: string;
      path: string;
      projectId?: string | null;
      repoRef?: string | null;
      keepDocumentId: string;
      supersededByDocumentId: string;
    }) => {
      const candidates = await db
        .select({
          id: knowledgeDocuments.id,
          metadata: knowledgeDocuments.metadata,
        })
        .from(knowledgeDocuments)
        .where(
          and(
            eq(knowledgeDocuments.companyId, input.companyId),
            eq(knowledgeDocuments.sourceType, input.sourceType),
            eq(knowledgeDocuments.path, input.path),
            eqNullable(knowledgeDocuments.projectId, input.projectId ?? null),
            eqNullable(knowledgeDocuments.repoRef, input.repoRef ?? null),
            ne(knowledgeDocuments.id, input.keepDocumentId),
            ne(knowledgeDocuments.authorityLevel, "deprecated"),
          ),
        );

      if (candidates.length === 0) return 0;

      let updatedCount = 0;
      const supersededAt = new Date().toISOString();
      for (const candidate of candidates) {
        const [updated] = await db
          .update(knowledgeDocuments)
          .set({
            authorityLevel: "deprecated",
            metadata: {
              ...(candidate.metadata ?? {}),
              supersededByDocumentId: input.supersededByDocumentId,
              supersededAt,
              isLatestForScope: false,
            },
            updatedAt: new Date(),
          })
          .where(eq(knowledgeDocuments.id, candidate.id))
          .returning();
        if (updated) updatedCount += 1;
      }

      return updatedCount;
    },

    listDocumentsNeedingEmbeddingRefresh: async (input: {
      embeddingProvider: string;
      embeddingModel: string;
      embeddingDimensions: number;
      limit?: number;
    }) => {
      const providerMismatch = sql<boolean>`coalesce(${knowledgeChunks.metadata} ->> 'embeddingProvider', '') <> ${input.embeddingProvider}`;
      const modelMismatch = sql<boolean>`coalesce(${knowledgeChunks.metadata} ->> 'embeddingModel', '') <> ${input.embeddingModel}`;
      const dimensionsMismatch = sql<boolean>`coalesce(${knowledgeChunks.metadata} ->> 'embeddingDimensions', '') <> ${String(input.embeddingDimensions)}`;

      return db
        .select({
          id: knowledgeDocuments.id,
          companyId: knowledgeDocuments.companyId,
          projectId: knowledgeDocuments.projectId,
          issueId: knowledgeDocuments.issueId,
          sourceType: knowledgeDocuments.sourceType,
          title: knowledgeDocuments.title,
          path: knowledgeDocuments.path,
          updatedAt: knowledgeDocuments.updatedAt,
        })
        .from(knowledgeDocuments)
        .innerJoin(knowledgeChunks, eq(knowledgeChunks.documentId, knowledgeDocuments.id))
        .where(or(providerMismatch, modelMismatch, dimensionsMismatch))
        .groupBy(
          knowledgeDocuments.id,
          knowledgeDocuments.companyId,
          knowledgeDocuments.projectId,
          knowledgeDocuments.issueId,
          knowledgeDocuments.sourceType,
          knowledgeDocuments.title,
          knowledgeDocuments.path,
          knowledgeDocuments.updatedAt,
        )
        .orderBy(desc(knowledgeDocuments.updatedAt))
        .limit(input.limit ?? 10);
    },

    createTaskBrief: async (input: {
      companyId: string;
      issueId: string;
      briefScope: string;
      briefVersion: number;
      generatedFromMessageSeq: number;
      workflowState: string;
      contentMarkdown: string;
      contentJson?: Record<string, unknown>;
      retrievalRunId?: string | null;
    }) => {
      const [created] = await db
        .insert(issueTaskBriefs)
        .values({
          companyId: input.companyId,
          issueId: input.issueId,
          briefScope: input.briefScope,
          briefVersion: input.briefVersion,
          generatedFromMessageSeq: input.generatedFromMessageSeq,
          workflowState: input.workflowState,
          contentMarkdown: input.contentMarkdown,
          contentJson: input.contentJson ?? {},
          retrievalRunId: input.retrievalRunId ?? null,
        })
        .returning();
      return created;
    },

    getLatestTaskBrief: async (issueId: string, briefScope: string) =>
      db
        .select()
        .from(issueTaskBriefs)
        .where(and(eq(issueTaskBriefs.issueId, issueId), eq(issueTaskBriefs.briefScope, briefScope)))
        .orderBy(desc(issueTaskBriefs.briefVersion), desc(issueTaskBriefs.createdAt))
        .then((rows) => rows[0] ?? null),

    listTaskBriefs: async (input: {
      issueId: string;
      briefScope?: string | null;
      limit?: number;
    }) =>
      db
        .select()
        .from(issueTaskBriefs)
        .where(
          input.briefScope
            ? and(eq(issueTaskBriefs.issueId, input.issueId), eq(issueTaskBriefs.briefScope, input.briefScope))
            : eq(issueTaskBriefs.issueId, input.issueId),
        )
        .orderBy(desc(issueTaskBriefs.createdAt), desc(issueTaskBriefs.briefVersion))
        .limit(input.limit ?? 20),

    upsertRetrievalPolicy: async (input: {
      companyId: string;
      role: string;
      eventType: string;
      workflowState: string;
      topKDense?: number;
      topKSparse?: number;
      rerankK?: number;
      finalK?: number;
      allowedSourceTypes: string[];
      allowedAuthorityLevels: string[];
      metadata?: Record<string, unknown>;
    }) => {
      const [created] = await db
        .insert(retrievalPolicies)
        .values({
          companyId: input.companyId,
          role: input.role,
          eventType: input.eventType,
          workflowState: input.workflowState,
          topKDense: input.topKDense ?? 20,
          topKSparse: input.topKSparse ?? 20,
          rerankK: input.rerankK ?? 20,
          finalK: input.finalK ?? 8,
          allowedSourceTypes: input.allowedSourceTypes,
          allowedAuthorityLevels: input.allowedAuthorityLevels,
          metadata: input.metadata ?? {},
        })
        .onConflictDoUpdate({
          target: [
            retrievalPolicies.companyId,
            retrievalPolicies.role,
            retrievalPolicies.eventType,
            retrievalPolicies.workflowState,
          ],
          set: {
            topKDense: input.topKDense ?? 20,
            topKSparse: input.topKSparse ?? 20,
            rerankK: input.rerankK ?? 20,
            finalK: input.finalK ?? 8,
            allowedSourceTypes: input.allowedSourceTypes,
            allowedAuthorityLevels: input.allowedAuthorityLevels,
            metadata: input.metadata ?? {},
            updatedAt: new Date(),
          },
        })
        .returning();
      return created;
    },

    getRetrievalPolicy: async (input: {
      companyId: string;
      role: string;
      eventType: string;
      workflowState: string;
    }) =>
      db
        .select()
        .from(retrievalPolicies)
        .where(
          and(
            eq(retrievalPolicies.companyId, input.companyId),
            eq(retrievalPolicies.role, input.role),
            eq(retrievalPolicies.eventType, input.eventType),
            eq(retrievalPolicies.workflowState, input.workflowState),
          ),
        )
        .then((rows) => rows[0] ?? null),

    listRetrievalPolicies: async (input: {
      companyId: string;
      role?: string | null;
      eventType?: string | null;
      workflowState?: string | null;
      limit?: number;
    }) => {
      const conditions = [eq(retrievalPolicies.companyId, input.companyId)];
      if (input.role) conditions.push(eq(retrievalPolicies.role, input.role));
      if (input.eventType) conditions.push(eq(retrievalPolicies.eventType, input.eventType));
      if (input.workflowState) conditions.push(eq(retrievalPolicies.workflowState, input.workflowState));

      return db
        .select()
        .from(retrievalPolicies)
        .where(and(...conditions))
        .orderBy(
          retrievalPolicies.role,
          retrievalPolicies.eventType,
          retrievalPolicies.workflowState,
          desc(retrievalPolicies.updatedAt),
        )
        .limit(input.limit ?? 100);
    },

    createRetrievalRun: async (input: {
      companyId: string;
      actorType: string;
      actorId: string;
      actorRole: string;
      eventType: string;
      workflowState: string;
      queryText: string;
      queryDebug?: Record<string, unknown>;
      issueId?: string | null;
      triggeringMessageId?: string | null;
      policyId?: string | null;
      finalBriefId?: string | null;
    }) => {
      const [created] = await db
        .insert(retrievalRuns)
        .values({
          companyId: input.companyId,
          issueId: input.issueId ?? null,
          triggeringMessageId: input.triggeringMessageId ?? null,
          actorType: input.actorType,
          actorId: input.actorId,
          actorRole: input.actorRole,
          eventType: input.eventType,
          workflowState: input.workflowState,
          policyId: input.policyId ?? null,
          queryText: input.queryText,
          queryDebug: input.queryDebug ?? {},
          finalBriefId: input.finalBriefId ?? null,
        })
        .returning();
      return created;
    },

    linkRetrievalRunToBrief: async (retrievalRunId: string, briefId: string) => {
      const [updated] = await db
        .update(retrievalRuns)
        .set({ finalBriefId: briefId })
        .where(eq(retrievalRuns.id, retrievalRunId))
        .returning();
      return updated ?? null;
    },

    getRetrievalRunById: async (retrievalRunId: string) =>
      db
        .select()
        .from(retrievalRuns)
        .where(eq(retrievalRuns.id, retrievalRunId))
        .then((rows) => rows[0] ?? null),

    listRetrievalRunHits: async (retrievalRunId: string) =>
      db
        .select({
          id: retrievalRunHits.id,
          companyId: retrievalRunHits.companyId,
          retrievalRunId: retrievalRunHits.retrievalRunId,
          chunkId: retrievalRunHits.chunkId,
          denseScore: retrievalRunHits.denseScore,
          sparseScore: retrievalRunHits.sparseScore,
          rerankScore: retrievalRunHits.rerankScore,
          fusedScore: retrievalRunHits.fusedScore,
          finalRank: retrievalRunHits.finalRank,
          selected: retrievalRunHits.selected,
          rationale: retrievalRunHits.rationale,
          textContent: knowledgeChunks.textContent,
          headingPath: knowledgeChunks.headingPath,
          symbolName: knowledgeChunks.symbolName,
          chunkMetadata: knowledgeChunks.metadata,
          documentId: knowledgeChunks.documentId,
          documentPath: knowledgeDocuments.path,
          documentTitle: knowledgeDocuments.title,
          sourceType: knowledgeDocuments.sourceType,
          authorityLevel: knowledgeDocuments.authorityLevel,
          documentMetadata: knowledgeDocuments.metadata,
        })
        .from(retrievalRunHits)
        .innerJoin(knowledgeChunks, eq(retrievalRunHits.chunkId, knowledgeChunks.id))
        .innerJoin(knowledgeDocuments, eq(knowledgeChunks.documentId, knowledgeDocuments.id))
        .where(eq(retrievalRunHits.retrievalRunId, retrievalRunId))
        .orderBy(retrievalRunHits.finalRank, retrievalRunHits.id),

    recordRetrievalHits: async (input: {
      companyId: string;
      retrievalRunId: string;
      hits: Array<{
        chunkId: string;
        denseScore?: number | null;
        sparseScore?: number | null;
        rerankScore?: number | null;
        fusedScore?: number | null;
        finalRank?: number | null;
        selected?: boolean;
        rationale?: string | null;
      }>;
    }) => {
      if (input.hits.length === 0) return [];

      return db
        .insert(retrievalRunHits)
        .values(
          input.hits.map((hit) => ({
            companyId: input.companyId,
            retrievalRunId: input.retrievalRunId,
            chunkId: hit.chunkId,
            denseScore: hit.denseScore ?? null,
            sparseScore: hit.sparseScore ?? null,
            rerankScore: hit.rerankScore ?? null,
            fusedScore: hit.fusedScore ?? null,
            finalRank: hit.finalRank ?? null,
            selected: hit.selected ?? false,
            rationale: hit.rationale ?? null,
          })),
        )
        .returning();
    },
  };
}
