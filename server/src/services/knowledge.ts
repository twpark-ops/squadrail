import { and, desc, eq, gte, inArray, isNull, ne, or, sql } from "drizzle-orm";
import type { Db } from "@squadrail/db";
import {
  codeSymbolEdges,
  codeSymbols,
  issueProtocolMessages,
  issueTaskBriefs,
  issues,
  knowledgeChunkLinks,
  knowledgeChunks,
  knowledgeDocuments,
  knowledgeDocumentVersions,
  projectKnowledgeRevisions,
  retrievalCacheEntries,
  retrievalFeedbackEvents,
  retrievalRoleProfiles,
  projects,
  retrievalPolicies,
  retrievalRunHits,
  retrievalRuns,
} from "@squadrail/db";
import {
  ORGANIZATIONAL_MEMORY_PROTOCOL_MESSAGE_TYPES,
  ORGANIZATIONAL_MEMORY_REVIEW_MESSAGE_TYPES,
} from "./organizational-memory-shared.js";

type ReplaceDocumentChunksCodeGraph = {
  symbols: Array<{
    chunkIndex: number;
    symbolKey: string;
    symbolName: string;
    symbolKind: string;
    receiverType?: string | null;
    startLine?: number | null;
    endLine?: number | null;
    metadata?: Record<string, unknown>;
  }>;
  edges: Array<{
    fromSymbolKey: string;
    targetSymbolKey?: string | null;
    targetSymbolName?: string | null;
    targetPath?: string | null;
    edgeType: string;
    weight?: number;
    metadata?: Record<string, unknown>;
  }>;
  stats?: Record<string, unknown>;
};

type KnowledgeDocumentVersionInput = {
  companyId: string;
  documentId: string;
  projectId?: string | null;
  path?: string | null;
  repoRef?: string | null;
  branchName?: string | null;
  defaultBranchName?: string | null;
  commitSha?: string | null;
  parentCommitSha?: string | null;
  isHead?: boolean;
  isDefaultBranch?: boolean;
  capturedAt?: string | Date | null;
  metadata?: Record<string, unknown>;
};

export type KnowledgeQualityTrendSample = {
  createdAt: Date;
  lowConfidence: boolean;
  graphExpanded: boolean;
  multiHopGraphExpanded: boolean;
  candidateCacheHit: boolean;
  finalCacheHit: boolean;
  personalized: boolean;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readBoolean(value: unknown) {
  return value === true;
}

type RetrievalCacheIdentityView = {
  queryFingerprint: string | null;
  policyFingerprint: string | null;
  feedbackFingerprint: string | null;
  revisionSignature: string | null;
};

function readRetrievalCacheIdentity(value: unknown): RetrievalCacheIdentityView {
  const record = asRecord(value);
  return {
    queryFingerprint: readString(record.queryFingerprint),
    policyFingerprint: readString(record.policyFingerprint),
    feedbackFingerprint: readString(record.feedbackFingerprint),
    revisionSignature: readString(record.revisionSignature),
  };
}

export function buildKnowledgeQualityDailyTrend(input: {
  samples: KnowledgeQualityTrendSample[];
  days: number;
}) {
  const bucketMap = new Map<string, {
    date: string;
    totalRuns: number;
    lowConfidenceRuns: number;
    graphExpandedRuns: number;
    multiHopGraphExpandedRuns: number;
    candidateCacheHits: number;
    finalCacheHits: number;
    personalizedRuns: number;
  }>();

  for (let offset = input.days - 1; offset >= 0; offset -= 1) {
    const date = new Date(Date.now() - offset * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    bucketMap.set(date, {
      date,
      totalRuns: 0,
      lowConfidenceRuns: 0,
      graphExpandedRuns: 0,
      multiHopGraphExpandedRuns: 0,
      candidateCacheHits: 0,
      finalCacheHits: 0,
      personalizedRuns: 0,
    });
  }

  for (const sample of input.samples) {
    const date = sample.createdAt.toISOString().slice(0, 10);
    const bucket = bucketMap.get(date);
    if (!bucket) continue;
    bucket.totalRuns += 1;
    if (sample.lowConfidence) bucket.lowConfidenceRuns += 1;
    if (sample.graphExpanded) bucket.graphExpandedRuns += 1;
    if (sample.multiHopGraphExpanded) bucket.multiHopGraphExpandedRuns += 1;
    if (sample.candidateCacheHit) bucket.candidateCacheHits += 1;
    if (sample.finalCacheHit) bucket.finalCacheHits += 1;
    if (sample.personalized) bucket.personalizedRuns += 1;
  }

  return Array.from(bucketMap.values());
}

function buildMinimalCodeGraphFromChunks(input: {
  chunks: Array<{
    chunkIndex: number;
    symbolName?: string | null;
    metadata?: Record<string, unknown>;
  }>;
}) {
  const symbols = input.chunks
    .filter((chunk): chunk is typeof chunk & { symbolName: string } => (
      typeof chunk.symbolName === "string"
      && chunk.symbolName.trim().length > 0
      && typeof chunk.metadata?.lineStart === "number"
      && typeof chunk.metadata?.lineEnd === "number"
    ))
    .map((chunk) => ({
      chunkIndex: chunk.chunkIndex,
      symbolKey: [
        String(chunk.metadata?.receiverType ?? ""),
        String(chunk.metadata?.symbolKind ?? "symbol"),
        chunk.symbolName.trim(),
        String(chunk.metadata?.lineStart ?? ""),
      ].join(":"),
      symbolName: chunk.symbolName.trim(),
      symbolKind: String(chunk.metadata?.symbolKind ?? "symbol"),
      receiverType: typeof chunk.metadata?.receiverType === "string" ? chunk.metadata.receiverType : null,
      startLine: typeof chunk.metadata?.lineStart === "number" ? chunk.metadata.lineStart : null,
      endLine: typeof chunk.metadata?.lineEnd === "number" ? chunk.metadata.lineEnd : null,
      metadata: {
        parser: chunk.metadata?.parser,
        chunkKind: chunk.metadata?.chunkKind,
        exported: chunk.metadata?.exported === true,
        isTestFile: chunk.metadata?.isTestFile === true,
      },
    }));

  if (symbols.length === 0) return null;
  return {
    symbols,
    edges: [],
    stats: {
      mode: "minimal",
    },
  } satisfies ReplaceDocumentChunksCodeGraph;
}

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

  async function recordDocumentVersion(input: KnowledgeDocumentVersionInput) {
    const branchName = typeof input.branchName === "string" && input.branchName.trim().length > 0
      ? input.branchName.trim()
      : null;
    const commitSha = typeof input.commitSha === "string" && input.commitSha.trim().length > 0
      ? input.commitSha.trim()
      : null;
    if (!branchName && !commitSha) return null;

    const document = await db
      .select({
        id: knowledgeDocuments.id,
        companyId: knowledgeDocuments.companyId,
        projectId: knowledgeDocuments.projectId,
        path: knowledgeDocuments.path,
        repoRef: knowledgeDocuments.repoRef,
      })
      .from(knowledgeDocuments)
      .where(eq(knowledgeDocuments.id, input.documentId))
      .then((rows) => rows[0] ?? null);
    if (!document) return null;

    const projectId = input.projectId ?? document.projectId ?? null;
    const pathValue = input.path ?? document.path ?? null;
    const repoRef = input.repoRef ?? document.repoRef ?? null;
    const defaultBranchName = typeof input.defaultBranchName === "string" && input.defaultBranchName.trim().length > 0
      ? input.defaultBranchName.trim()
      : null;
    const capturedAt = input.capturedAt
      ? (input.capturedAt instanceof Date ? input.capturedAt : new Date(input.capturedAt))
      : new Date();

    if (branchName && pathValue) {
      await db
        .update(knowledgeDocumentVersions)
        .set({
          isHead: false,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(knowledgeDocumentVersions.companyId, input.companyId),
            eqNullable(knowledgeDocumentVersions.projectId, projectId),
            eqNullable(knowledgeDocumentVersions.path, pathValue),
            eqNullable(knowledgeDocumentVersions.branchName, branchName),
            ne(knowledgeDocumentVersions.documentId, input.documentId),
          ),
        );
    }

    const existing = await db
      .select()
      .from(knowledgeDocumentVersions)
      .where(
        and(
          eq(knowledgeDocumentVersions.companyId, input.companyId),
          eq(knowledgeDocumentVersions.documentId, input.documentId),
          eqNullable(knowledgeDocumentVersions.branchName, branchName),
          eqNullable(knowledgeDocumentVersions.commitSha, commitSha),
        ),
      )
      .then((rows) => rows[0] ?? null);

    const values = {
      companyId: input.companyId,
      documentId: input.documentId,
      projectId,
      path: pathValue,
      repoRef,
      branchName,
      defaultBranchName,
      commitSha,
      parentCommitSha: typeof input.parentCommitSha === "string" && input.parentCommitSha.trim().length > 0
        ? input.parentCommitSha.trim()
        : null,
      isHead: input.isHead ?? true,
      isDefaultBranch: input.isDefaultBranch === true,
      capturedAt,
      metadata: input.metadata ?? {},
      updatedAt: new Date(),
    };

    if (!existing) {
      const [created] = await db
        .insert(knowledgeDocumentVersions)
        .values(values)
        .returning();
      return created ?? null;
    }

    const [updated] = await db
      .update(knowledgeDocumentVersions)
      .set(values)
      .where(eq(knowledgeDocumentVersions.id, existing.id))
      .returning();
    return updated ?? null;
  }

  async function replaceDocumentCodeGraph(input: {
    tx: Db;
    companyId: string;
    documentId: string;
    projectId: string | null;
    documentPath: string | null;
    documentLanguage: string | null;
    chunkIdByIndex: Map<number, string>;
    codeGraph: ReplaceDocumentChunksCodeGraph | null;
  }) {
    if (!input.projectId || !input.documentPath || !input.documentLanguage || !input.codeGraph) {
      return { symbolCount: 0, edgeCount: 0 };
    }
    const documentPath = input.documentPath;
    const documentLanguage = input.documentLanguage;
    const projectId = input.projectId;

    const rawSymbolValues = input.codeGraph.symbols
      .map((symbol) => {
        const chunkId = input.chunkIdByIndex.get(symbol.chunkIndex);
        if (!chunkId) return null;
        return {
          companyId: input.companyId,
          projectId,
          documentId: input.documentId,
          chunkId,
          path: documentPath,
          language: documentLanguage,
          symbolKey: symbol.symbolKey,
          symbolName: symbol.symbolName,
          symbolKind: symbol.symbolKind,
          receiverType: symbol.receiverType ?? null,
          startLine: symbol.startLine ?? null,
          endLine: symbol.endLine ?? null,
          metadata: symbol.metadata ?? {},
        };
      })
      .filter((value): value is NonNullable<typeof value> => value !== null);

    const symbolValues = Array.from(
      rawSymbolValues.reduce((map, symbol) => {
        const key = `${symbol.path}:${symbol.symbolKey}`;
        const existing = map.get(key);
        if (!existing) {
          map.set(key, symbol);
          return map;
        }

        const existingMetadataSize = Object.keys(existing.metadata ?? {}).length;
        const nextMetadataSize = Object.keys(symbol.metadata ?? {}).length;
        const shouldReplace =
          nextMetadataSize > existingMetadataSize
          || (existing.endLine ?? 0) < (symbol.endLine ?? 0);

        if (shouldReplace) {
          map.set(key, symbol);
        }
        return map;
      }, new Map<string, (typeof rawSymbolValues)[number]>()).values(),
    );

    if (symbolValues.length === 0) {
      return { symbolCount: 0, edgeCount: 0 };
    }

    await input.tx
      .delete(codeSymbols)
      .where(and(
        eq(codeSymbols.companyId, input.companyId),
        eq(codeSymbols.projectId, projectId),
        eq(codeSymbols.path, documentPath),
      ));

    const insertedSymbols = await input.tx
      .insert(codeSymbols)
      .values(symbolValues)
      .returning({
        id: codeSymbols.id,
        path: codeSymbols.path,
        symbolKey: codeSymbols.symbolKey,
        symbolName: codeSymbols.symbolName,
        metadata: codeSymbols.metadata,
      });

    const insertedByKey = new Map(insertedSymbols.map((symbol) => [symbol.symbolKey, symbol] as const));
    const targetNames = Array.from(new Set(
      input.codeGraph.edges
        .map((edge) => edge.targetSymbolName?.trim())
        .filter((value): value is string => Boolean(value)),
    ));
    const targetPaths = Array.from(new Set(
      input.codeGraph.edges
        .map((edge) => edge.targetPath?.trim())
        .filter((value): value is string => Boolean(value)),
    ));

    const candidateSymbols = targetNames.length === 0 && targetPaths.length === 0
      ? insertedSymbols
      : await input.tx
        .select({
          id: codeSymbols.id,
          path: codeSymbols.path,
          symbolKey: codeSymbols.symbolKey,
          symbolName: codeSymbols.symbolName,
          metadata: codeSymbols.metadata,
        })
        .from(codeSymbols)
        .where(and(
          eq(codeSymbols.companyId, input.companyId),
          eq(codeSymbols.projectId, projectId),
          or(
            ...(targetNames.length > 0 ? [inArray(codeSymbols.symbolName, targetNames)] : []),
            ...(targetPaths.length > 0 ? [inArray(codeSymbols.path, targetPaths)] : []),
          ),
        ));

    const byPathAndName = new Map<string, typeof candidateSymbols>();
    const byName = new Map<string, typeof candidateSymbols>();
    const byPath = new Map<string, typeof candidateSymbols>();

    for (const symbol of [...candidateSymbols, ...insertedSymbols]) {
      const pathNameKey = `${symbol.path}:${symbol.symbolName}`;
      byPathAndName.set(pathNameKey, [...(byPathAndName.get(pathNameKey) ?? []), symbol]);
      byName.set(symbol.symbolName, [...(byName.get(symbol.symbolName) ?? []), symbol]);
      byPath.set(symbol.path, [...(byPath.get(symbol.path) ?? []), symbol]);
    }

    const rankCandidates = (
      candidates: typeof candidateSymbols,
      preferredPath?: string | null,
    ) => [...candidates].sort((left, right) => {
      const leftExported = left.metadata?.exported === true ? 1 : 0;
      const rightExported = right.metadata?.exported === true ? 1 : 0;
      if (preferredPath) {
        const leftPathMatch = left.path === preferredPath ? 1 : 0;
        const rightPathMatch = right.path === preferredPath ? 1 : 0;
        if (rightPathMatch !== leftPathMatch) return rightPathMatch - leftPathMatch;
      }
      if (rightExported !== leftExported) return rightExported - leftExported;
      return left.path.localeCompare(right.path, "en");
    });

    const edgeValues = input.codeGraph.edges.flatMap((edge) => {
      const fromSymbol = insertedByKey.get(edge.fromSymbolKey);
      if (!fromSymbol) return [];

      const exactLocalTarget = edge.targetSymbolKey ? insertedByKey.get(edge.targetSymbolKey) : null;
      const targetCandidates = exactLocalTarget
        ? [exactLocalTarget]
        : edge.targetPath && edge.targetSymbolName
          ? rankCandidates(byPathAndName.get(`${edge.targetPath}:${edge.targetSymbolName}`) ?? [], edge.targetPath)
          : edge.targetSymbolName
            ? rankCandidates(byName.get(edge.targetSymbolName) ?? [], edge.targetPath ?? null)
            : edge.targetPath
              ? rankCandidates(byPath.get(edge.targetPath) ?? [], edge.targetPath)
              : [];
      const targetSymbol = targetCandidates.find((candidate) => candidate.id !== fromSymbol.id);
      if (!targetSymbol) return [];

      return [{
        companyId: input.companyId,
        projectId,
        fromSymbolId: fromSymbol.id,
        toSymbolId: targetSymbol.id,
        edgeType: edge.edgeType,
        weight: edge.weight ?? 1,
        metadata: edge.metadata ?? {},
      }];
    });

    if (edgeValues.length > 0) {
      await input.tx.insert(codeSymbolEdges).values(edgeValues).onConflictDoNothing();
    }

    return {
      symbolCount: insertedSymbols.length,
      edgeCount: edgeValues.length,
    };
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
          totalSymbols: number;
          totalSymbolEdges: number;
          totalDocumentVersions: number;
        }>(sql`
          select
            (select count(*)::int from knowledge_documents where company_id = ${input.companyId}) as "totalDocuments",
            (select count(*)::int from knowledge_chunks where company_id = ${input.companyId}) as "totalChunks",
            (select count(*)::int from knowledge_chunk_links where company_id = ${input.companyId}) as "totalLinks",
            (select count(*)::int from code_symbols where company_id = ${input.companyId}) as "totalSymbols",
            (select count(*)::int from code_symbol_edges where company_id = ${input.companyId}) as "totalSymbolEdges",
            (select count(*)::int from knowledge_document_versions where company_id = ${input.companyId}) as "totalDocumentVersions",
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
        totalSymbols: 0,
        totalSymbolEdges: 0,
        totalDocumentVersions: 0,
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
      codeGraph?: ReplaceDocumentChunksCodeGraph | null;
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
      const document = await tx
        .select({
          id: knowledgeDocuments.id,
          projectId: knowledgeDocuments.projectId,
          path: knowledgeDocuments.path,
          language: knowledgeDocuments.language,
        })
        .from(knowledgeDocuments)
        .where(eq(knowledgeDocuments.id, input.documentId))
        .then((rows) => rows[0] ?? null);

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

      await replaceDocumentCodeGraph({
        tx: tx as unknown as Db,
        companyId: input.companyId,
        documentId: input.documentId,
        projectId: document?.projectId ?? null,
        documentPath: document?.path ?? null,
        documentLanguage: document?.language ?? null,
        chunkIdByIndex: new Map(insertedChunks.map((chunk) => [chunk.chunkIndex, chunk.id] as const)),
        codeGraph: input.codeGraph ?? buildMinimalCodeGraphFromChunks({ chunks: input.chunks }),
      });

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

    recordDocumentVersion,

    listDocumentVersions: async (input: {
      companyId: string;
      documentIds?: string[];
      projectId?: string | null;
      path?: string | null;
      branchName?: string | null;
      limit?: number;
    }) => {
      const conditions = [eq(knowledgeDocumentVersions.companyId, input.companyId)];
      if (input.documentIds && input.documentIds.length > 0) {
        conditions.push(inArray(knowledgeDocumentVersions.documentId, input.documentIds));
      }
      if (input.projectId) {
        conditions.push(eq(knowledgeDocumentVersions.projectId, input.projectId));
      }
      if (input.path) {
        conditions.push(eq(knowledgeDocumentVersions.path, input.path));
      }
      if (input.branchName) {
        conditions.push(eq(knowledgeDocumentVersions.branchName, input.branchName));
      }
      return db
        .select()
        .from(knowledgeDocumentVersions)
        .where(and(...conditions))
        .orderBy(desc(knowledgeDocumentVersions.capturedAt), desc(knowledgeDocumentVersions.updatedAt))
        .limit(input.limit ?? 500);
    },

    getProjectKnowledgeRevision: async (input: {
      companyId: string;
      projectId: string;
    }) => {
      return db
        .select()
        .from(projectKnowledgeRevisions)
        .where(
          and(
            eq(projectKnowledgeRevisions.companyId, input.companyId),
            eq(projectKnowledgeRevisions.projectId, input.projectId),
          ),
        )
        .then((rows) => rows[0] ?? null);
    },

    listProjectKnowledgeRevisions: async (input: {
      companyId: string;
      projectIds: string[];
    }) => {
      const projectIds = Array.from(new Set(input.projectIds.filter(Boolean)));
      if (projectIds.length === 0) return [];
      return db
        .select()
        .from(projectKnowledgeRevisions)
        .where(
          and(
            eq(projectKnowledgeRevisions.companyId, input.companyId),
            inArray(projectKnowledgeRevisions.projectId, projectIds),
          ),
        );
    },

    touchProjectKnowledgeRevision: async (input: {
      companyId: string;
      projectId: string;
      bump?: boolean;
      headSha?: string | null;
      treeSignature?: string | null;
      importMode?: string | null;
      importedAt?: string | Date | null;
      metadata?: Record<string, unknown>;
    }) => {
      const importedAt = input.importedAt
        ? (input.importedAt instanceof Date ? input.importedAt : new Date(input.importedAt))
        : new Date();
      const existing = await db
        .select()
        .from(projectKnowledgeRevisions)
        .where(
          and(
            eq(projectKnowledgeRevisions.companyId, input.companyId),
            eq(projectKnowledgeRevisions.projectId, input.projectId),
          ),
        )
        .then((rows) => rows[0] ?? null);

      const revision = existing ? existing.revision + (input.bump ? 1 : 0) : 1;
      const values = {
        companyId: input.companyId,
        projectId: input.projectId,
        revision,
        lastHeadSha: input.headSha ?? existing?.lastHeadSha ?? null,
        lastTreeSignature: input.treeSignature ?? existing?.lastTreeSignature ?? null,
        lastImportMode: input.importMode ?? existing?.lastImportMode ?? null,
        lastImportedAt: importedAt,
        metadata: {
          ...(existing?.metadata ?? {}),
          ...(input.metadata ?? {}),
        },
        updatedAt: new Date(),
      };

      if (!existing) {
        const [created] = await db
          .insert(projectKnowledgeRevisions)
          .values({
            ...values,
            createdAt: new Date(),
          })
          .returning();
        return created ?? null;
      }

      const [updated] = await db
        .update(projectKnowledgeRevisions)
        .set(values)
        .where(eq(projectKnowledgeRevisions.id, existing.id))
        .returning();
      return updated ?? null;
    },

    getRetrievalCacheEntry: async (input: {
      companyId: string;
      projectId?: string | null;
      stage: string;
      cacheKey: string;
      knowledgeRevision?: number;
    }) => {
      const now = new Date();
      const entry = await db
        .select()
        .from(retrievalCacheEntries)
        .where(
          and(
            eq(retrievalCacheEntries.companyId, input.companyId),
            eqNullable(retrievalCacheEntries.projectId, input.projectId ?? null),
            eq(retrievalCacheEntries.stage, input.stage),
            eq(retrievalCacheEntries.cacheKey, input.cacheKey),
            eq(retrievalCacheEntries.knowledgeRevision, input.knowledgeRevision ?? 0),
            or(isNull(retrievalCacheEntries.expiresAt), gte(retrievalCacheEntries.expiresAt, now)),
          ),
        )
        .then((rows) => rows[0] ?? null);

      if (!entry) return null;

      const [updated] = await db
        .update(retrievalCacheEntries)
        .set({
          hitCount: entry.hitCount + 1,
          lastAccessedAt: now,
          updatedAt: now,
        })
        .where(eq(retrievalCacheEntries.id, entry.id))
        .returning();
      return updated ?? entry;
    },

    getCompatibleRetrievalCacheEntry: async (input: {
      companyId: string;
      projectId?: string | null;
      stage: string;
      knowledgeRevision?: number;
      allowFeedbackDrift?: boolean;
      identity: {
        queryFingerprint: string;
        policyFingerprint: string;
        feedbackFingerprint: string;
        revisionSignature?: string | null;
      };
    }) => {
      const now = new Date();
      const revision = input.knowledgeRevision ?? 0;
      const entries = await db
        .select()
        .from(retrievalCacheEntries)
        .where(
          and(
            eq(retrievalCacheEntries.companyId, input.companyId),
            eqNullable(retrievalCacheEntries.projectId, input.projectId ?? null),
            eq(retrievalCacheEntries.stage, input.stage),
            eq(retrievalCacheEntries.knowledgeRevision, revision),
            or(isNull(retrievalCacheEntries.expiresAt), gte(retrievalCacheEntries.expiresAt, now)),
          ),
        )
        .orderBy(desc(retrievalCacheEntries.updatedAt));

      const entry = entries.find((candidate) => {
        const metadata = asRecord(asRecord(candidate.valueJson).metadata);
        const cacheIdentity = readRetrievalCacheIdentity(metadata.cacheIdentity);
        return (
          cacheIdentity.queryFingerprint === input.identity.queryFingerprint
          && cacheIdentity.policyFingerprint === input.identity.policyFingerprint
          && (
            cacheIdentity.feedbackFingerprint === input.identity.feedbackFingerprint
            || input.allowFeedbackDrift === true
          )
          && (input.identity.revisionSignature == null || cacheIdentity.revisionSignature === input.identity.revisionSignature)
        );
      }) ?? null;

      if (!entry) return null;

      const [updated] = await db
        .update(retrievalCacheEntries)
        .set({
          hitCount: entry.hitCount + 1,
          lastAccessedAt: now,
          updatedAt: now,
        })
        .where(eq(retrievalCacheEntries.id, entry.id))
        .returning();
      return updated ?? entry;
    },

    inspectRetrievalCacheEntryState: async (input: {
      companyId: string;
      projectId?: string | null;
      stage: string;
      cacheKey: string;
      knowledgeRevision?: number;
      identity?: {
        queryFingerprint: string;
        policyFingerprint: string;
        feedbackFingerprint: string;
      };
    }) => {
      const now = new Date();
      const entries = await db
        .select({
          cacheKey: retrievalCacheEntries.cacheKey,
          knowledgeRevision: retrievalCacheEntries.knowledgeRevision,
          updatedAt: retrievalCacheEntries.updatedAt,
          expiresAt: retrievalCacheEntries.expiresAt,
          valueJson: retrievalCacheEntries.valueJson,
        })
        .from(retrievalCacheEntries)
        .where(
          and(
            eq(retrievalCacheEntries.companyId, input.companyId),
            eqNullable(retrievalCacheEntries.projectId, input.projectId ?? null),
            eq(retrievalCacheEntries.stage, input.stage),
          ),
        )
        .orderBy(desc(retrievalCacheEntries.knowledgeRevision), desc(retrievalCacheEntries.updatedAt));

      if (entries.length === 0) {
        return {
          state: "miss_cold" as const,
          matchedRevision: null,
          latestKnownRevision: null,
          lastEntryUpdatedAt: null,
        };
      }

      const expectedRevision = input.knowledgeRevision ?? 0;
      const exactRevisionEntry = entries.find((entry) =>
        entry.cacheKey === input.cacheKey && entry.knowledgeRevision === expectedRevision) ?? null;
      if (exactRevisionEntry) {
        const expired = exactRevisionEntry.expiresAt != null && exactRevisionEntry.expiresAt.getTime() < now.getTime();
        if (expired) {
          return {
            state: "miss_expired" as const,
            matchedRevision: exactRevisionEntry.knowledgeRevision,
            latestKnownRevision: entries[0]?.knowledgeRevision ?? exactRevisionEntry.knowledgeRevision,
            lastEntryUpdatedAt: exactRevisionEntry.updatedAt,
          };
        }
      }

      const exactKeyEntries = entries.filter((entry) => entry.cacheKey === input.cacheKey);
      if (input.identity) {
        const sameQueryEntries = entries.filter((entry) => {
          const cacheIdentity = readRetrievalCacheIdentity(asRecord(entry.valueJson).metadata && asRecord(asRecord(entry.valueJson).metadata).cacheIdentity);
          return cacheIdentity.queryFingerprint === input.identity?.queryFingerprint;
        });
        const samePolicyEntries = sameQueryEntries.filter((entry) => {
          const cacheIdentity = readRetrievalCacheIdentity(asRecord(asRecord(entry.valueJson).metadata).cacheIdentity);
          return cacheIdentity.policyFingerprint === input.identity?.policyFingerprint;
        });
        const sameFeedbackEntries = samePolicyEntries.filter((entry) => {
          const cacheIdentity = readRetrievalCacheIdentity(asRecord(asRecord(entry.valueJson).metadata).cacheIdentity);
          return cacheIdentity.feedbackFingerprint === input.identity?.feedbackFingerprint;
        });

        const latestFor = (records: typeof entries) => records[0]?.knowledgeRevision ?? null;
        const lastUpdatedFor = (records: typeof entries) => records[0]?.updatedAt ?? null;

        if (sameFeedbackEntries.length > 0) {
          const sameRevisionEntry = sameFeedbackEntries.find((entry) => entry.knowledgeRevision === expectedRevision) ?? null;
          if (sameRevisionEntry) {
            const expired = sameRevisionEntry.expiresAt != null && sameRevisionEntry.expiresAt.getTime() < now.getTime();
            if (expired) {
              return {
                state: "miss_expired" as const,
                matchedRevision: sameRevisionEntry.knowledgeRevision,
                latestKnownRevision: latestFor(sameFeedbackEntries),
                lastEntryUpdatedAt: sameRevisionEntry.updatedAt,
              };
            }
          }
          if (sameFeedbackEntries.some((entry) => entry.knowledgeRevision !== expectedRevision)) {
            return {
              state: "miss_revision_changed" as const,
              matchedRevision: sameRevisionEntry?.knowledgeRevision ?? null,
              latestKnownRevision: latestFor(sameFeedbackEntries),
              lastEntryUpdatedAt: (sameRevisionEntry ?? sameFeedbackEntries[0])?.updatedAt ?? null,
            };
          }
        }

        if (samePolicyEntries.length > 0) {
          return {
            state: "miss_feedback_changed" as const,
            matchedRevision: samePolicyEntries.find((entry) => entry.knowledgeRevision === expectedRevision)?.knowledgeRevision ?? null,
            latestKnownRevision: latestFor(samePolicyEntries),
            lastEntryUpdatedAt: lastUpdatedFor(samePolicyEntries),
          };
        }

        if (sameQueryEntries.length > 0) {
          return {
            state: "miss_policy_changed" as const,
            matchedRevision: sameQueryEntries.find((entry) => entry.knowledgeRevision === expectedRevision)?.knowledgeRevision ?? null,
            latestKnownRevision: latestFor(sameQueryEntries),
            lastEntryUpdatedAt: lastUpdatedFor(sameQueryEntries),
          };
        }
      }

      if (exactKeyEntries.length > 0) {
        return {
          state: "miss_revision_changed" as const,
          matchedRevision: exactKeyEntries.find((entry) => entry.knowledgeRevision === expectedRevision)?.knowledgeRevision ?? null,
          latestKnownRevision: exactKeyEntries[0]?.knowledgeRevision ?? null,
          lastEntryUpdatedAt: exactKeyEntries[0]?.updatedAt ?? null,
        };
      }

      return {
        state: "miss_cold" as const,
        matchedRevision: null,
        latestKnownRevision: null,
        lastEntryUpdatedAt: null,
      };
    },

    upsertRetrievalCacheEntry: async (input: {
      companyId: string;
      projectId?: string | null;
      stage: string;
      cacheKey: string;
      knowledgeRevision?: number;
      valueJson: Record<string, unknown>;
      ttlSeconds?: number;
    }) => {
      const existing = await db
        .select()
        .from(retrievalCacheEntries)
        .where(
          and(
            eq(retrievalCacheEntries.companyId, input.companyId),
            eqNullable(retrievalCacheEntries.projectId, input.projectId ?? null),
            eq(retrievalCacheEntries.stage, input.stage),
            eq(retrievalCacheEntries.cacheKey, input.cacheKey),
            eq(retrievalCacheEntries.knowledgeRevision, input.knowledgeRevision ?? 0),
          ),
        )
        .then((rows) => rows[0] ?? null);

      const now = new Date();
      const expiresAt = typeof input.ttlSeconds === "number"
        ? new Date(now.getTime() + input.ttlSeconds * 1000)
        : null;
      const values = {
        companyId: input.companyId,
        projectId: input.projectId ?? null,
        stage: input.stage,
        cacheKey: input.cacheKey,
        knowledgeRevision: input.knowledgeRevision ?? 0,
        valueJson: input.valueJson,
        expiresAt,
        updatedAt: now,
      };

      if (!existing) {
        const [created] = await db
          .insert(retrievalCacheEntries)
          .values({
            ...values,
            createdAt: now,
            lastAccessedAt: now,
          })
          .returning();
        return created ?? null;
      }

      const [updated] = await db
        .update(retrievalCacheEntries)
        .set(values)
        .where(eq(retrievalCacheEntries.id, existing.id))
        .returning();
      return updated ?? null;
    },

    deprecateDocumentsByPaths: async (input: {
      companyId: string;
      projectId?: string | null;
      repoRef?: string | null;
      paths: string[];
      reason: string;
      metadata?: Record<string, unknown>;
    }) => {
      const paths = Array.from(new Set(input.paths.filter(Boolean)));
      if (paths.length === 0) return 0;

      const candidates = await db
        .select({
          id: knowledgeDocuments.id,
          metadata: knowledgeDocuments.metadata,
        })
        .from(knowledgeDocuments)
        .where(
          and(
            eq(knowledgeDocuments.companyId, input.companyId),
            inArray(knowledgeDocuments.path, paths),
            eqNullable(knowledgeDocuments.projectId, input.projectId ?? null),
            eqNullable(knowledgeDocuments.repoRef, input.repoRef ?? null),
            ne(knowledgeDocuments.authorityLevel, "deprecated"),
          ),
        );

      if (candidates.length === 0) return 0;

      let updatedCount = 0;
      const deprecatedAt = new Date().toISOString();
      for (const candidate of candidates) {
        const [updated] = await db
          .update(knowledgeDocuments)
          .set({
            authorityLevel: "deprecated",
            metadata: {
              ...(candidate.metadata ?? {}),
              ...(input.metadata ?? {}),
              deprecatedReason: input.reason,
              deprecatedAt,
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

    updateRetrievalRunDebug: async (retrievalRunId: string, patch: Record<string, unknown>) => {
      const existing = await db
        .select({ queryDebug: retrievalRuns.queryDebug })
        .from(retrievalRuns)
        .where(eq(retrievalRuns.id, retrievalRunId))
        .then((rows) => rows[0] ?? null);
      if (!existing) return null;

      const [updated] = await db
        .update(retrievalRuns)
        .set({
          queryDebug: {
            ...(existing.queryDebug ?? {}),
            ...patch,
          },
        })
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

    listRecentRetrievalRuns: async (input: {
      companyId: string;
      projectId?: string;
      limit?: number;
    }) => {
      const limit = Math.max(1, Math.min(input.limit ?? 8, 20));
      const rows = await db
        .select({
          retrievalRunId: retrievalRuns.id,
          companyId: retrievalRuns.companyId,
          issueId: retrievalRuns.issueId,
          actorRole: retrievalRuns.actorRole,
          eventType: retrievalRuns.eventType,
          workflowState: retrievalRuns.workflowState,
          queryText: retrievalRuns.queryText,
          queryDebug: retrievalRuns.queryDebug,
          createdAt: retrievalRuns.createdAt,
          issueIdentifier: issues.identifier,
          issueTitle: issues.title,
          issueProjectId: issues.projectId,
        })
        .from(retrievalRuns)
        .leftJoin(issues, eq(retrievalRuns.issueId, issues.id))
        .where(and(
          eq(retrievalRuns.companyId, input.companyId),
          input.projectId ? eq(issues.projectId, input.projectId) : undefined,
        ))
        .orderBy(desc(retrievalRuns.createdAt))
        .limit(limit);

      const runIds = rows.map((row) => row.retrievalRunId);
      const feedbackRows = runIds.length === 0
        ? []
        : await db
          .select({
            retrievalRunId: retrievalFeedbackEvents.retrievalRunId,
            feedbackType: retrievalFeedbackEvents.feedbackType,
            targetType: retrievalFeedbackEvents.targetType,
            weight: retrievalFeedbackEvents.weight,
            createdAt: retrievalFeedbackEvents.createdAt,
          })
          .from(retrievalFeedbackEvents)
          .where(inArray(retrievalFeedbackEvents.retrievalRunId, runIds))
          .orderBy(desc(retrievalFeedbackEvents.createdAt));

      const feedbackByRunId = new Map<string, {
        totalCount: number;
        positiveCount: number;
        negativeCount: number;
        pinnedPathCount: number;
        hiddenPathCount: number;
        lastFeedbackAt: string | null;
        feedbackTypeCounts: Record<string, number>;
      }>();
      for (const row of feedbackRows) {
        const entry = feedbackByRunId.get(row.retrievalRunId) ?? {
          totalCount: 0,
          positiveCount: 0,
          negativeCount: 0,
          pinnedPathCount: 0,
          hiddenPathCount: 0,
          lastFeedbackAt: null,
          feedbackTypeCounts: {},
        };
        entry.totalCount += 1;
        if (row.weight > 0) entry.positiveCount += 1;
        if (row.weight < 0) entry.negativeCount += 1;
        if (row.feedbackType === "operator_pin" && row.targetType === "path") entry.pinnedPathCount += 1;
        if (row.feedbackType === "operator_hide" && row.targetType === "path") entry.hiddenPathCount += 1;
        if (!entry.lastFeedbackAt || row.createdAt.getTime() > new Date(entry.lastFeedbackAt).getTime()) {
          entry.lastFeedbackAt = row.createdAt.toISOString();
        }
        entry.feedbackTypeCounts[row.feedbackType] = (entry.feedbackTypeCounts[row.feedbackType] ?? 0) + 1;
        feedbackByRunId.set(row.retrievalRunId, entry);
      }

      return Promise.all(rows.map(async (row) => {
        const queryDebug = asRecord(row.queryDebug);
        const quality = asRecord(queryDebug.quality);
        const cache = asRecord(queryDebug.cache);
        const personalization = asRecord(queryDebug.personalization);
        const topHits = (await db
          .select({
            chunkId: retrievalRunHits.chunkId,
            finalRank: retrievalRunHits.finalRank,
            fusedScore: retrievalRunHits.fusedScore,
            rationale: retrievalRunHits.rationale,
            textContent: knowledgeChunks.textContent,
            headingPath: knowledgeChunks.headingPath,
            symbolName: knowledgeChunks.symbolName,
            documentPath: knowledgeDocuments.path,
            documentTitle: knowledgeDocuments.title,
            sourceType: knowledgeDocuments.sourceType,
            authorityLevel: knowledgeDocuments.authorityLevel,
          })
          .from(retrievalRunHits)
          .innerJoin(knowledgeChunks, eq(retrievalRunHits.chunkId, knowledgeChunks.id))
          .innerJoin(knowledgeDocuments, eq(knowledgeChunks.documentId, knowledgeDocuments.id))
          .where(eq(retrievalRunHits.retrievalRunId, row.retrievalRunId))
          .orderBy(retrievalRunHits.finalRank, retrievalRunHits.id)
          .limit(5))
          .map((hit) => ({
            chunkId: hit.chunkId,
            finalRank: hit.finalRank,
            fusedScore: hit.fusedScore,
            rationale: hit.rationale,
            textContent: hit.textContent,
            headingPath: hit.headingPath,
            symbolName: hit.symbolName,
            documentPath: hit.documentPath,
            documentTitle: hit.documentTitle,
            sourceType: hit.sourceType,
            authorityLevel: hit.authorityLevel,
          }));

        const confidenceLevel = readString(quality.confidenceLevel);
        return {
          retrievalRunId: row.retrievalRunId,
          companyId: row.companyId,
          issueId: row.issueId,
          issueIdentifier: row.issueIdentifier,
          issueTitle: row.issueTitle,
          issueProjectId: row.issueProjectId,
          actorRole: row.actorRole,
          eventType: row.eventType,
          workflowState: row.workflowState,
          queryText: row.queryText,
          createdAt: row.createdAt,
          confidenceLevel:
            confidenceLevel === "high" || confidenceLevel === "medium" || confidenceLevel === "low"
              ? confidenceLevel
              : null,
          graphHitCount: readNumber(queryDebug.graphHitCount),
          graphMaxDepth: readNumber(queryDebug.graphMaxDepth),
          graphHopDepthCounts:
            queryDebug.graphHopDepthCounts && typeof queryDebug.graphHopDepthCounts === "object" && !Array.isArray(queryDebug.graphHopDepthCounts)
              ? queryDebug.graphHopDepthCounts as Record<string, number>
              : {},
          multiHopGraphHitCount: readNumber(queryDebug.multiHopGraphHitCount),
          organizationalMemoryHitCount: readNumber(quality.organizationalMemoryHitCount),
          codeHitCount: readNumber(quality.codeHitCount),
          reviewHitCount: readNumber(quality.reviewHitCount),
          candidateCacheHit: readBoolean(cache.candidateHit),
          finalCacheHit: readBoolean(cache.finalHit),
          candidateCacheState: readString(cache.candidateState),
          candidateCacheReason: readString(cache.candidateReason),
          candidateCacheMatchedRevision:
            typeof cache.candidateMatchedRevision === "number" ? cache.candidateMatchedRevision : null,
          candidateCacheLatestKnownRevision:
            typeof cache.candidateLatestKnownRevision === "number" ? cache.candidateLatestKnownRevision : null,
          candidateCacheLastEntryUpdatedAt: readString(cache.candidateLastEntryUpdatedAt),
          candidateCacheKeyFingerprint: readString(cache.candidateCacheKeyFingerprint),
          finalCacheState: readString(cache.finalState),
          finalCacheReason: readString(cache.finalReason),
          finalCacheMatchedRevision:
            typeof cache.finalMatchedRevision === "number" ? cache.finalMatchedRevision : null,
          finalCacheLatestKnownRevision:
            typeof cache.finalLatestKnownRevision === "number" ? cache.finalLatestKnownRevision : null,
          finalCacheLastEntryUpdatedAt: readString(cache.finalLastEntryUpdatedAt),
          finalCacheKeyFingerprint: readString(cache.finalCacheKeyFingerprint),
          personalizationApplied: readBoolean(personalization.applied),
          averagePersonalizationBoost: readNumber(personalization.averagePersonalizationBoost),
          topHitPath: readString(queryDebug.topHitPath),
          topHitSourceType: readString(queryDebug.topHitSourceType),
          topHitArtifactKind: readString(queryDebug.topHitArtifactKind),
          feedbackSummary: feedbackByRunId.get(row.retrievalRunId) ?? {
            totalCount: 0,
            positiveCount: 0,
            negativeCount: 0,
            pinnedPathCount: 0,
            hiddenPathCount: 0,
            lastFeedbackAt: null,
            feedbackTypeCounts: {},
          },
          topHits,
        };
      }));
    },

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

    summarizeRetrievalQuality: async (input: {
      companyId: string;
      projectId?: string;
      role?: string;
      days?: number;
      limit?: number;
    }) => {
      const days = Math.max(1, Math.min(90, input.days ?? 14));
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const retrievalConditions = [
        eq(retrievalRuns.companyId, input.companyId),
        gte(retrievalRuns.createdAt, since),
      ];
      if (input.projectId) {
        retrievalConditions.push(sql`${retrievalRuns.queryDebug} ->> 'issueProjectId' = ${input.projectId}`);
      }
      if (input.role) {
        retrievalConditions.push(eq(retrievalRuns.actorRole, input.role));
      }
      const rows = await db
        .select({
          id: retrievalRuns.id,
          issueId: retrievalRuns.issueId,
          actorRole: retrievalRuns.actorRole,
          queryDebug: retrievalRuns.queryDebug,
          createdAt: retrievalRuns.createdAt,
        })
        .from(retrievalRuns)
        .where(and(...retrievalConditions))
        .orderBy(desc(retrievalRuns.createdAt))
        .limit(input.limit ?? 1000);

      const projectIds = Array.from(new Set(
        rows
          .map((row) => {
            const debug = (row.queryDebug ?? {}) as Record<string, unknown>;
            return typeof debug.issueProjectId === "string" ? debug.issueProjectId : null;
          })
          .filter((value): value is string => Boolean(value)),
      ));

      const projectRows = projectIds.length === 0
        ? []
        : await db
          .select({ id: projects.id, name: projects.name })
          .from(projects)
          .where(inArray(projects.id, projectIds));
      const projectNameById = new Map(projectRows.map((row) => [row.id, row.name]));

      const confidenceCounts: Record<string, number> = {};
      const degradedReasonCounts: Record<string, number> = {};
      const perRole = new Map<string, {
        role: string;
        totalRuns: number;
        lowConfidenceRuns: number;
        projectMismatchCount: number;
        exactPathMissCount: number;
      }>();
      const perProject = new Map<string, {
        projectId: string;
        projectName: string | null;
        totalRuns: number;
        lowConfidenceRuns: number;
        projectMismatchCount: number;
      }>();
      const lowConfidenceSamples: Array<{
        retrievalRunId: string;
        issueId: string | null;
        actorRole: string;
        confidenceLevel: string | null;
        degradedReasons: string[];
      }> = [];
      const projectMismatchSamples: Array<{
        retrievalRunId: string;
        issueId: string | null;
        actorRole: string;
        issueProjectId: string | null;
        topHitProjectId: string | null;
        topHitPath: string | null;
      }> = [];

      let totalRuns = 0;
      let evidenceCountTotal = 0;
      let sourceDiversityTotal = 0;
      let graphHitCountTotal = 0;
      let symbolGraphHitCountTotal = 0;
      let edgeTraversalCountTotal = 0;
      let temporalHitCountTotal = 0;
      let branchAlignedTopHitCountTotal = 0;
      let personalizedRunCount = 0;
      let personalizedHitCountTotal = 0;
      let averagePersonalizationBoostTotal = 0;
      let embeddingCacheHitCount = 0;
      let candidateCacheHitCount = 0;
      let finalCacheHitCount = 0;
      let lowConfidenceRuns = 0;
      let exactPathMissCount = 0;
      let projectMismatchCount = 0;
      let staleVersionPenaltyCount = 0;
      let exactCommitMatchCount = 0;
      let graphExpandedRuns = 0;
      let symbolGraphExpandedRuns = 0;
      let multiHopGraphExpandedRuns = 0;
      let graphMaxDepthTotal = 0;
      let organizationalMemoryHitCountTotal = 0;
      let codeHitCountTotal = 0;
      let reviewHitCountTotal = 0;
      const graphEntityTypeCounts: Record<string, number> = {};
      const edgeTypeCounts: Record<string, number> = {};
      const graphHopDepthCounts: Record<string, number> = {};
      const candidateCacheMissReasonCounts: Record<string, number> = {};
      const finalCacheMissReasonCounts: Record<string, number> = {};
      const dailyTrendSamples: KnowledgeQualityTrendSample[] = [];

      for (const row of rows) {
        const debug = (row.queryDebug ?? {}) as Record<string, unknown>;
        const quality = ((debug.quality ?? {}) as Record<string, unknown>);
        const confidenceLevel = typeof quality.confidenceLevel === "string" ? quality.confidenceLevel : null;
        const evidenceCount = typeof quality.evidenceCount === "number" ? quality.evidenceCount : 0;
        const sourceDiversity = typeof quality.sourceDiversity === "number" ? quality.sourceDiversity : 0;
        const graphHitCount = typeof quality.graphHitCount === "number" ? quality.graphHitCount : 0;
        const symbolGraphHitCount = typeof quality.symbolGraphHitCount === "number" ? quality.symbolGraphHitCount : 0;
        const edgeTraversalCount = typeof quality.edgeTraversalCount === "number" ? quality.edgeTraversalCount : 0;
        const graphMaxDepth = typeof quality.graphMaxDepth === "number" ? quality.graphMaxDepth : 0;
        const multiHopGraphHitCount = typeof quality.multiHopGraphHitCount === "number"
          ? quality.multiHopGraphHitCount
          : 0;
        const temporalHitCount = typeof quality.temporalHitCount === "number" ? quality.temporalHitCount : 0;
        const branchAlignedTopHitCount = typeof quality.branchAlignedTopHitCount === "number"
          ? quality.branchAlignedTopHitCount
          : 0;
        const staleVersionPenaltyCountForRun = typeof quality.staleVersionPenaltyCount === "number"
          ? quality.staleVersionPenaltyCount
          : 0;
        const exactCommitMatchCountForRun = typeof quality.exactCommitMatchCount === "number"
          ? quality.exactCommitMatchCount
          : 0;
        const organizationalMemoryHitCountForRun = typeof quality.organizationalMemoryHitCount === "number"
          ? quality.organizationalMemoryHitCount
          : 0;
        const codeHitCountForRun = typeof quality.codeHitCount === "number" ? quality.codeHitCount : 0;
        const reviewHitCountForRun = typeof quality.reviewHitCount === "number" ? quality.reviewHitCount : 0;
        const graphEntityTypes = Array.isArray(quality.graphEntityTypes)
          ? quality.graphEntityTypes.filter((value): value is string => typeof value === "string")
          : [];
        const edgeTypes = quality.edgeTypeCounts && typeof quality.edgeTypeCounts === "object"
          ? Object.entries(quality.edgeTypeCounts as Record<string, unknown>)
            .filter((entry): entry is [string, number] => typeof entry[0] === "string" && typeof entry[1] === "number")
          : [];
        const hopDepths = quality.graphHopDepthCounts && typeof quality.graphHopDepthCounts === "object"
          ? Object.entries(quality.graphHopDepthCounts as Record<string, unknown>)
            .filter((entry): entry is [string, number] => typeof entry[0] === "string" && typeof entry[1] === "number")
          : [];
        const degradedReasons = Array.isArray(quality.degradedReasons)
          ? quality.degradedReasons.filter((value): value is string => typeof value === "string")
          : [];
        const cache = debug.cache && typeof debug.cache === "object"
          ? debug.cache as Record<string, unknown>
          : {};
        const personalization = debug.personalization && typeof debug.personalization === "object"
          ? debug.personalization as Record<string, unknown>
          : {};
        const exactPathSatisfied = debug.exactPathSatisfied === true;
        const topHitProjectId = typeof debug.topHitProjectId === "string" ? debug.topHitProjectId : null;
        const issueProjectId = typeof debug.issueProjectId === "string" ? debug.issueProjectId : null;
        const projectAffinityIds = Array.isArray(debug.projectAffinityIds)
          ? debug.projectAffinityIds.filter((value): value is string => typeof value === "string")
          : [];
        const topHitMatchesAffinity =
          topHitProjectId != null && (topHitProjectId === issueProjectId || projectAffinityIds.includes(topHitProjectId));
        const hasProjectMismatch =
          topHitProjectId != null && issueProjectId != null && !topHitMatchesAffinity;

        totalRuns += 1;
        evidenceCountTotal += evidenceCount;
        sourceDiversityTotal += sourceDiversity;
        graphHitCountTotal += graphHitCount;
        symbolGraphHitCountTotal += symbolGraphHitCount;
        edgeTraversalCountTotal += edgeTraversalCount;
        graphMaxDepthTotal += graphMaxDepth;
        organizationalMemoryHitCountTotal += organizationalMemoryHitCountForRun;
        codeHitCountTotal += codeHitCountForRun;
        reviewHitCountTotal += reviewHitCountForRun;
        temporalHitCountTotal += temporalHitCount;
        branchAlignedTopHitCountTotal += branchAlignedTopHitCount;
        if (personalization.applied === true) personalizedRunCount += 1;
        personalizedHitCountTotal += typeof personalization.personalizedHitCount === "number"
          ? personalization.personalizedHitCount
          : 0;
        averagePersonalizationBoostTotal += typeof personalization.averagePersonalizationBoost === "number"
          ? personalization.averagePersonalizationBoost
          : 0;
        if (cache.embeddingHit === true) embeddingCacheHitCount += 1;
        if (cache.candidateHit === true) candidateCacheHitCount += 1;
        if (cache.finalHit === true) finalCacheHitCount += 1;
        const candidateState = typeof cache.candidateState === "string" ? cache.candidateState : null;
        const finalState = typeof cache.finalState === "string" ? cache.finalState : null;
        if (candidateState && candidateState !== "hit") {
          candidateCacheMissReasonCounts[candidateState] = (candidateCacheMissReasonCounts[candidateState] ?? 0) + 1;
        }
        if (finalState && finalState !== "hit") {
          finalCacheMissReasonCounts[finalState] = (finalCacheMissReasonCounts[finalState] ?? 0) + 1;
        }
        staleVersionPenaltyCount += staleVersionPenaltyCountForRun;
        exactCommitMatchCount += exactCommitMatchCountForRun;
        if (graphHitCount > 0) graphExpandedRuns += 1;
        if (symbolGraphHitCount > 0) symbolGraphExpandedRuns += 1;
        if (multiHopGraphHitCount > 0) multiHopGraphExpandedRuns += 1;
        if (confidenceLevel) {
          confidenceCounts[confidenceLevel] = (confidenceCounts[confidenceLevel] ?? 0) + 1;
        }
        for (const entityType of graphEntityTypes) {
          graphEntityTypeCounts[entityType] = (graphEntityTypeCounts[entityType] ?? 0) + 1;
        }
        for (const [edgeType, count] of edgeTypes) {
          edgeTypeCounts[edgeType] = (edgeTypeCounts[edgeType] ?? 0) + count;
        }
        for (const [depth, count] of hopDepths) {
          graphHopDepthCounts[depth] = (graphHopDepthCounts[depth] ?? 0) + count;
        }
        for (const reason of degradedReasons) {
          degradedReasonCounts[reason] = (degradedReasonCounts[reason] ?? 0) + 1;
        }

        if (confidenceLevel === "low") {
          lowConfidenceRuns += 1;
          if (lowConfidenceSamples.length < 12) {
            lowConfidenceSamples.push({
              retrievalRunId: row.id,
              issueId: row.issueId ?? null,
              actorRole: row.actorRole,
              confidenceLevel,
              degradedReasons,
            });
          }
        }

        if (!exactPathSatisfied && Number(debug.exactPathCount ?? 0) > 0) {
          exactPathMissCount += 1;
        }

        if (hasProjectMismatch) {
          projectMismatchCount += 1;
          if (projectMismatchSamples.length < 12) {
            projectMismatchSamples.push({
              retrievalRunId: row.id,
              issueId: row.issueId ?? null,
              actorRole: row.actorRole,
              issueProjectId,
              topHitProjectId,
              topHitPath: typeof debug.topHitPath === "string" ? debug.topHitPath : null,
            });
          }
        }

        const roleEntry = perRole.get(row.actorRole) ?? {
          role: row.actorRole,
          totalRuns: 0,
          lowConfidenceRuns: 0,
          projectMismatchCount: 0,
          exactPathMissCount: 0,
        };
        roleEntry.totalRuns += 1;
        if (confidenceLevel === "low") roleEntry.lowConfidenceRuns += 1;
        if (hasProjectMismatch) roleEntry.projectMismatchCount += 1;
        if (!exactPathSatisfied && Number(debug.exactPathCount ?? 0) > 0) roleEntry.exactPathMissCount += 1;
        perRole.set(row.actorRole, roleEntry);

        if (issueProjectId) {
          const projectEntry = perProject.get(issueProjectId) ?? {
            projectId: issueProjectId,
            projectName: projectNameById.get(issueProjectId) ?? null,
            totalRuns: 0,
            lowConfidenceRuns: 0,
            projectMismatchCount: 0,
          };
          projectEntry.totalRuns += 1;
          if (confidenceLevel === "low") projectEntry.lowConfidenceRuns += 1;
          if (hasProjectMismatch) projectEntry.projectMismatchCount += 1;
          perProject.set(issueProjectId, projectEntry);
        }

        dailyTrendSamples.push({
          createdAt: row.createdAt,
          lowConfidence: confidenceLevel === "low",
          graphExpanded: graphHitCount > 0,
          multiHopGraphExpanded: multiHopGraphHitCount > 0,
          candidateCacheHit: cache.candidateHit === true,
          finalCacheHit: cache.finalHit === true,
          personalized: personalization.applied === true,
        });
      }

      const feedbackStatsConditions = [
        eq(retrievalFeedbackEvents.companyId, input.companyId),
        gte(retrievalFeedbackEvents.createdAt, since),
      ];
      if (input.projectId) {
        feedbackStatsConditions.push(eq(retrievalFeedbackEvents.projectId, input.projectId));
      }
      if (input.role) {
        feedbackStatsConditions.push(eq(retrievalFeedbackEvents.actorRole, input.role));
      }

      const feedbackStats = await db
        .select({
          eventCount: sql<number>`count(*)`,
          positiveCount: sql<number>`coalesce(sum(case when ${retrievalFeedbackEvents.weight} > 0 then 1 else 0 end), 0)`,
          negativeCount: sql<number>`coalesce(sum(case when ${retrievalFeedbackEvents.weight} < 0 then 1 else 0 end), 0)`,
        })
        .from(retrievalFeedbackEvents)
        .where(and(...feedbackStatsConditions))
        .then((result) => result[0] ?? { eventCount: 0, positiveCount: 0, negativeCount: 0 });
      const feedbackTypeCounts = await db
        .select({
          feedbackType: retrievalFeedbackEvents.feedbackType,
          count: sql<number>`count(*)`,
        })
        .from(retrievalFeedbackEvents)
        .where(and(...feedbackStatsConditions))
        .groupBy(retrievalFeedbackEvents.feedbackType)
        .then((rows) => Object.fromEntries(rows.map((row) => [row.feedbackType, row.count])));

      const profileConditions = [eq(retrievalRoleProfiles.companyId, input.companyId)];
      if (input.projectId) {
        profileConditions.push(sql`(${retrievalRoleProfiles.projectId} = ${input.projectId} or ${retrievalRoleProfiles.projectId} is null)`);
      }
      if (input.role) {
        profileConditions.push(eq(retrievalRoleProfiles.role, input.role));
      }

      const profileCount = await db
        .select({ count: sql<number>`count(*)` })
        .from(retrievalRoleProfiles)
        .where(and(...profileConditions))
        .then((result) => result[0]?.count ?? 0);

      const issueScopeConditions = [eq(issues.companyId, input.companyId)];
      if (input.projectId) {
        issueScopeConditions.push(eq(issues.projectId, input.projectId));
      }

      const issueDocConditions = [
        eq(knowledgeDocuments.companyId, input.companyId),
        eq(knowledgeDocuments.sourceType, "issue"),
        ne(knowledgeDocuments.authorityLevel, "deprecated"),
        sql`coalesce(${knowledgeDocuments.metadata} ->> 'isLatestForScope', 'true') <> 'false'`,
      ];
      const protocolDocConditions = [
        eq(knowledgeDocuments.companyId, input.companyId),
        eq(knowledgeDocuments.sourceType, "protocol_message"),
        ne(knowledgeDocuments.authorityLevel, "deprecated"),
      ];
      const reviewDocConditions = [
        eq(knowledgeDocuments.companyId, input.companyId),
        eq(knowledgeDocuments.sourceType, "review"),
        ne(knowledgeDocuments.authorityLevel, "deprecated"),
      ];
      if (input.projectId) {
        issueDocConditions.push(eq(knowledgeDocuments.projectId, input.projectId));
        protocolDocConditions.push(eq(knowledgeDocuments.projectId, input.projectId));
        reviewDocConditions.push(eq(knowledgeDocuments.projectId, input.projectId));
      }

      const [
        issueTotalItems,
        issueActiveDocumentCount,
        issueLinkedDocumentCount,
        issueMissingIssueLinkCount,
        protocolTotalItems,
        protocolActiveDocumentCount,
        protocolLinkedDocumentCount,
        protocolMissingMessageLinkCount,
        reviewTotalItems,
        reviewActiveDocumentCount,
        reviewLinkedDocumentCount,
        reviewMissingMessageLinkCount,
      ] = await Promise.all([
        db
          .select({ count: sql<number>`count(*)` })
          .from(issues)
          .where(and(...issueScopeConditions))
          .then((rows) => rows[0]?.count ?? 0),
        db
          .select({ count: sql<number>`count(distinct ${knowledgeDocuments.issueId})` })
          .from(knowledgeDocuments)
          .where(and(...issueDocConditions))
          .then((rows) => rows[0]?.count ?? 0),
        db
          .select({ count: sql<number>`count(distinct ${knowledgeDocuments.issueId})` })
          .from(knowledgeDocuments)
          .where(and(
            ...issueDocConditions,
            sql`${knowledgeDocuments.issueId} is not null`,
          ))
          .then((rows) => rows[0]?.count ?? 0),
        db
          .select({ count: sql<number>`count(*)` })
          .from(knowledgeDocuments)
          .where(and(
            ...issueDocConditions,
            sql`${knowledgeDocuments.issueId} is null`,
          ))
          .then((rows) => rows[0]?.count ?? 0),
        db
          .select({ count: sql<number>`count(*)` })
          .from(issueProtocolMessages)
          .innerJoin(issues, eq(issueProtocolMessages.issueId, issues.id))
          .where(and(
            ...issueScopeConditions,
            inArray(
              issueProtocolMessages.messageType,
              [...ORGANIZATIONAL_MEMORY_PROTOCOL_MESSAGE_TYPES] as typeof issueProtocolMessages.$inferSelect.messageType[],
            ),
          ))
          .then((rows) => rows[0]?.count ?? 0),
        db
          .select({ count: sql<number>`count(*)` })
          .from(knowledgeDocuments)
          .where(and(...protocolDocConditions))
          .then((rows) => rows[0]?.count ?? 0),
        db
          .select({ count: sql<number>`count(distinct ${knowledgeDocuments.messageId})` })
          .from(knowledgeDocuments)
          .where(and(
            ...protocolDocConditions,
            sql`${knowledgeDocuments.messageId} is not null`,
          ))
          .then((rows) => rows[0]?.count ?? 0),
        db
          .select({ count: sql<number>`count(distinct ${knowledgeDocuments.messageId})` })
          .from(knowledgeDocuments)
          .where(and(
            ...protocolDocConditions,
            sql`${knowledgeDocuments.messageId} is null`,
          ))
          .then((rows) => rows[0]?.count ?? 0),
        db
          .select({ count: sql<number>`count(*)` })
          .from(issueProtocolMessages)
          .innerJoin(issues, eq(issueProtocolMessages.issueId, issues.id))
          .where(and(
            ...issueScopeConditions,
            inArray(
              issueProtocolMessages.messageType,
              [...ORGANIZATIONAL_MEMORY_REVIEW_MESSAGE_TYPES] as typeof issueProtocolMessages.$inferSelect.messageType[],
            ),
          ))
          .then((rows) => rows[0]?.count ?? 0),
        db
          .select({ count: sql<number>`count(distinct ${knowledgeDocuments.messageId})` })
          .from(knowledgeDocuments)
          .where(and(...reviewDocConditions))
          .then((rows) => rows[0]?.count ?? 0),
        db
          .select({ count: sql<number>`count(distinct ${knowledgeDocuments.messageId})` })
          .from(knowledgeDocuments)
          .where(and(
            ...reviewDocConditions,
            sql`${knowledgeDocuments.messageId} is not null`,
          ))
          .then((rows) => rows[0]?.count ?? 0),
        db
          .select({ count: sql<number>`count(*)` })
          .from(knowledgeDocuments)
          .where(and(
            ...reviewDocConditions,
            sql`${knowledgeDocuments.messageId} is null`,
          ))
          .then((rows) => rows[0]?.count ?? 0),
      ]);

      const readinessFailures = [
        ...(multiHopGraphExpandedRuns > 0 ? [] : ["multi_hop_graph"]),
        ...(candidateCacheHitCount > 0 || finalCacheHitCount > 0 ? [] : ["retrieval_cache"]),
        ...(codeHitCountTotal > 0 ? [] : ["code_evidence"]),
        ...(reviewHitCountTotal > 0 ? [] : ["review_evidence"]),
        ...(issueTotalItems > 0 && issueLinkedDocumentCount < issueTotalItems ? ["issue_memory_coverage"] : []),
        ...(protocolTotalItems > 0 && protocolLinkedDocumentCount < protocolTotalItems ? ["protocol_memory_coverage"] : []),
        ...(reviewTotalItems > 0 && reviewLinkedDocumentCount < reviewTotalItems ? ["review_memory_coverage"] : []),
      ];

      return {
        companyId: input.companyId,
        projectId: input.projectId ?? null,
        role: input.role ?? null,
        windowDays: days,
        generatedAt: new Date().toISOString(),
        totalRuns,
        lowConfidenceRuns,
        exactPathMissCount,
        projectMismatchCount,
        averageEvidenceCount: totalRuns > 0 ? evidenceCountTotal / totalRuns : 0,
        averageSourceDiversity: totalRuns > 0 ? sourceDiversityTotal / totalRuns : 0,
        averageGraphHitCount: totalRuns > 0 ? graphHitCountTotal / totalRuns : 0,
        averageOrganizationalMemoryHitCount: totalRuns > 0 ? organizationalMemoryHitCountTotal / totalRuns : 0,
        averageCodeHitCount: totalRuns > 0 ? codeHitCountTotal / totalRuns : 0,
        averageReviewHitCount: totalRuns > 0 ? reviewHitCountTotal / totalRuns : 0,
        averageSymbolGraphHitCount: totalRuns > 0 ? symbolGraphHitCountTotal / totalRuns : 0,
        averageEdgeTraversalCount: totalRuns > 0 ? edgeTraversalCountTotal / totalRuns : 0,
        averageGraphMaxDepth: totalRuns > 0 ? graphMaxDepthTotal / totalRuns : 0,
        averageTemporalHitCount: totalRuns > 0 ? temporalHitCountTotal / totalRuns : 0,
        averageBranchAlignedTopHitCount: totalRuns > 0 ? branchAlignedTopHitCountTotal / totalRuns : 0,
        profileAppliedRunCount: personalizedRunCount,
        averagePersonalizedHitCount: totalRuns > 0 ? personalizedHitCountTotal / totalRuns : 0,
        averagePersonalizationBoost: totalRuns > 0 ? averagePersonalizationBoostTotal / totalRuns : 0,
        cacheHitRate: totalRuns > 0 ? embeddingCacheHitCount / totalRuns : 0,
        embeddingCacheHitRate: totalRuns > 0 ? embeddingCacheHitCount / totalRuns : 0,
        candidateCacheHitRate: totalRuns > 0 ? candidateCacheHitCount / totalRuns : 0,
        finalCacheHitRate: totalRuns > 0 ? finalCacheHitCount / totalRuns : 0,
        candidateCacheMissReasonCounts,
        finalCacheMissReasonCounts,
        feedbackEventCount: Number(feedbackStats.eventCount ?? 0),
        positiveFeedbackCount: Number(feedbackStats.positiveCount ?? 0),
        negativeFeedbackCount: Number(feedbackStats.negativeCount ?? 0),
        feedbackCoverageRate: totalRuns > 0 ? personalizedRunCount / totalRuns : 0,
        profileCount,
        staleVersionPenaltyCount,
        exactCommitMatchCount,
        graphExpandedRuns,
        symbolGraphExpandedRuns,
        multiHopGraphExpandedRuns,
        confidenceCounts,
        degradedReasonCounts,
        graphEntityTypeCounts,
        edgeTypeCounts,
        graphHopDepthCounts,
        feedbackTypeCounts,
        dailyTrend: buildKnowledgeQualityDailyTrend({
          samples: dailyTrendSamples,
          days,
        }),
        organizationalMemoryCoverage: {
          issue: {
            totalItems: issueTotalItems,
            activeDocumentCount: issueActiveDocumentCount,
            linkedDocumentCount: issueLinkedDocumentCount,
            missingLinkCount: issueMissingIssueLinkCount,
            coverageRate:
              issueTotalItems > 0
                ? issueLinkedDocumentCount / issueTotalItems
                : 0,
          },
          protocol: {
            totalItems: protocolTotalItems,
            activeDocumentCount: protocolActiveDocumentCount,
            linkedDocumentCount: protocolLinkedDocumentCount,
            missingLinkCount: protocolMissingMessageLinkCount,
            coverageRate:
              protocolTotalItems > 0
                ? protocolLinkedDocumentCount / protocolTotalItems
                : 0,
          },
          review: {
            totalItems: reviewTotalItems,
            activeDocumentCount: reviewActiveDocumentCount,
            linkedDocumentCount: reviewLinkedDocumentCount,
            missingLinkCount: reviewMissingMessageLinkCount,
            coverageRate:
              reviewTotalItems > 0
                ? reviewLinkedDocumentCount / reviewTotalItems
                : 0,
          },
        },
        readinessGate: {
          status: readinessFailures.length === 0 ? "pass" : "warn",
          failures: readinessFailures,
        },
        perRole: Array.from(perRole.values()).sort((left, right) => right.totalRuns - left.totalRuns),
        perProject: Array.from(perProject.values()).sort((left, right) => right.totalRuns - left.totalRuns),
        samples: {
          lowConfidence: lowConfidenceSamples,
          projectMismatch: projectMismatchSamples,
        },
      };
    },
  };
}
