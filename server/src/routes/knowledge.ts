import { Router } from "express";
import { z } from "zod";
import type { Db } from "@squadrail/db";
import { KNOWLEDGE_EMBEDDING_DIMENSIONS } from "@squadrail/db";
import {
  knowledgeBackfillService,
  knowledgeEmbeddingService,
  knowledgeImportService,
  knowledgeService,
  logActivity,
  projectService,
  setupProgressService,
} from "../services/index.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";

const createKnowledgeDocumentSchema = z.object({
  companyId: z.string().uuid(),
  sourceType: z.string().min(1),
  authorityLevel: z.string().min(1),
  contentSha256: z.string().min(1),
  rawContent: z.string().min(1),
  repoUrl: z.string().min(1).nullable().optional(),
  repoRef: z.string().min(1).nullable().optional(),
  projectId: z.string().uuid().nullable().optional(),
  issueId: z.string().uuid().nullable().optional(),
  messageId: z.string().uuid().nullable().optional(),
  path: z.string().min(1).nullable().optional(),
  title: z.string().min(1).nullable().optional(),
  language: z.string().min(1).nullable().optional(),
  metadata: z.record(z.unknown()).optional(),
}).strict();

const createKnowledgeChunkLinkSchema = z.object({
  entityType: z.string().min(1),
  entityId: z.string().min(1),
  linkReason: z.string().min(1),
  weight: z.number().positive().optional(),
}).strict();

const replaceKnowledgeChunksSchema = z.object({
  generateEmbeddings: z.boolean().optional(),
  regenerateEmbeddings: z.boolean().optional(),
  chunks: z.array(z.object({
    chunkIndex: z.number().int().min(0),
    headingPath: z.string().min(1).nullable().optional(),
    symbolName: z.string().min(1).nullable().optional(),
    tokenCount: z.number().int().min(0),
    textContent: z.string().min(1),
    searchText: z.string().min(1).optional(),
    embedding: z.array(z.number()).length(KNOWLEDGE_EMBEDDING_DIMENSIONS).optional(),
    metadata: z.record(z.unknown()).optional(),
    links: z.array(createKnowledgeChunkLinkSchema).optional(),
  }).strict()).default([]),
}).strict();

const reembedKnowledgeDocumentSchema = z.object({
  force: z.boolean().optional(),
}).strict().optional();

const importProjectWorkspaceSchema = z.object({
  workspaceId: z.string().uuid().optional(),
  maxFiles: z.number().int().min(1).max(500).optional(),
}).strict().optional();

const listDocumentsSchema = z.object({
  companyId: z.string().uuid(),
  projectId: z.string().uuid().optional(),
  sourceType: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

const knowledgeOverviewSchema = z.object({
  companyId: z.string().uuid(),
});

const knowledgeQualitySchema = z.object({
  companyId: z.string().uuid(),
  days: z.coerce.number().int().min(1).max(90).optional(),
  limit: z.coerce.number().int().min(1).max(5000).optional(),
});

const listDocumentChunksSchema = z.object({
  includeLinks: z.coerce.boolean().optional(),
});

const listRetrievalPoliciesSchema = z.object({
  companyId: z.string().uuid(),
  role: z.string().min(1).optional(),
  eventType: z.string().min(1).optional(),
  workflowState: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const upsertRetrievalPolicySchema = z.object({
  companyId: z.string().uuid(),
  role: z.string().min(1),
  eventType: z.string().min(1),
  workflowState: z.string().min(1),
  topKDense: z.number().int().min(1).max(200).optional(),
  topKSparse: z.number().int().min(1).max(200).optional(),
  rerankK: z.number().int().min(1).max(200).optional(),
  finalK: z.number().int().min(1).max(50).optional(),
  allowedSourceTypes: z.array(z.string().min(1)).min(1),
  allowedAuthorityLevels: z.array(z.string().min(1)).min(1),
  metadata: z.record(z.unknown()).optional(),
}).strict();

export function knowledgeRoutes(db: Db) {
  const router = Router();
  const knowledge = knowledgeService(db);
  const embeddings = knowledgeEmbeddingService();
  const backfill = knowledgeBackfillService(db);
  const imports = knowledgeImportService(db);
  const projects = projectService(db);
  const setup = setupProgressService(db);

  router.get("/knowledge/documents", async (req, res) => {
    const parsed = listDocumentsSchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation error", details: parsed.error.issues });
      return;
    }

    assertCompanyAccess(req, parsed.data.companyId);
    const documents = await knowledge.listDocuments(parsed.data);
    res.json(documents);
  });

  router.get("/knowledge/overview", async (req, res) => {
    const parsed = knowledgeOverviewSchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation error", details: parsed.error.issues });
      return;
    }

    assertCompanyAccess(req, parsed.data.companyId);
    const overview = await knowledge.getOverview(parsed.data);
    res.json(overview);
  });

  router.get("/knowledge/quality", async (req, res) => {
    const parsed = knowledgeQualitySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation error", details: parsed.error.issues });
      return;
    }

    assertCompanyAccess(req, parsed.data.companyId);
    const summary = await knowledge.summarizeRetrievalQuality(parsed.data);
    res.json(summary);
  });

  router.post("/knowledge/documents", async (req, res) => {
    const parsed = createKnowledgeDocumentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation error", details: parsed.error.issues });
      return;
    }

    const actor = getActorInfo(req);
    assertCompanyAccess(req, parsed.data.companyId);

    const document = await knowledge.createDocument(parsed.data);
    if (!document) {
      res.status(500).json({ error: "Failed to create knowledge document" });
      return;
    }

    await logActivity(db, {
      companyId: parsed.data.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "knowledge.document.upserted",
      entityType: "project",
      entityId: parsed.data.projectId ?? parsed.data.issueId ?? document.id,
      details: {
        documentId: document.id,
        sourceType: document.sourceType,
        authorityLevel: document.authorityLevel,
        issueId: document.issueId,
        projectId: document.projectId,
      },
    });

    res.status(201).json(document);
  });

  router.get("/knowledge/documents/:id", async (req, res) => {
    const document = await knowledge.getDocumentById(req.params.id);
    if (!document) {
      res.status(404).json({ error: "Knowledge document not found" });
      return;
    }

    assertCompanyAccess(req, document.companyId);
    res.json(document);
  });

  router.get("/knowledge/documents/:id/chunks", async (req, res) => {
    const document = await knowledge.getDocumentById(req.params.id);
    if (!document) {
      res.status(404).json({ error: "Knowledge document not found" });
      return;
    }

    const parsed = listDocumentChunksSchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation error", details: parsed.error.issues });
      return;
    }

    assertCompanyAccess(req, document.companyId);
    const chunks = parsed.data.includeLinks
      ? await knowledge.listDocumentChunksWithLinks(document.id)
      : await knowledge.listDocumentChunks(document.id);
    res.json(chunks);
  });

  router.get("/knowledge/retrieval-runs/:id/hits", async (req, res) => {
    const retrievalRun = await knowledge.getRetrievalRunById(req.params.id);
    if (!retrievalRun) {
      res.status(404).json({ error: "Retrieval run not found" });
      return;
    }

    assertCompanyAccess(req, retrievalRun.companyId);
    const hits = await knowledge.listRetrievalRunHits(retrievalRun.id);
    res.json({
      retrievalRun,
      hits,
    });
  });

  router.post("/knowledge/documents/:id/chunks", async (req, res) => {
    const document = await knowledge.getDocumentById(req.params.id);
    if (!document) {
      res.status(404).json({ error: "Knowledge document not found" });
      return;
    }

    assertCompanyAccess(req, document.companyId);
    const parsed = replaceKnowledgeChunksSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation error", details: parsed.error.issues });
      return;
    }

    const actor = getActorInfo(req);
    const shouldRegenerateAll = parsed.data.regenerateEmbeddings === true;
    const missingEmbedding = parsed.data.chunks.some((chunk) => !chunk.embedding);
    const shouldGenerateMissing = parsed.data.generateEmbeddings !== false && missingEmbedding;
    const shouldGenerateEmbeddings = shouldRegenerateAll || shouldGenerateMissing;

    if (missingEmbedding && !shouldGenerateEmbeddings) {
      res.status(400).json({
        error: "Embedding is required for every chunk when automatic generation is disabled",
      });
      return;
    }

    let preparedChunks = parsed.data.chunks.map((chunk) => ({
      ...chunk,
      metadata: chunk.metadata ?? {},
    }));

    if (shouldGenerateEmbeddings) {
      const providerInfo = embeddings.getProviderInfo();
      if (!providerInfo.available || !providerInfo.provider || !providerInfo.model) {
        res.status(409).json({
          error: "Knowledge embedding provider is not configured",
          hint: "Set OPENAI_API_KEY or SQUADRAIL_KNOWLEDGE_OPENAI_API_KEY, or provide embeddings explicitly.",
        });
        return;
      }

      const embeddingInputs = preparedChunks
        .map((chunk, index) => ({ index, text: chunk.textContent }))
        .filter(({ index }) => shouldRegenerateAll || !preparedChunks[index]?.embedding);
      const embeddingResult = await embeddings.generateEmbeddings(embeddingInputs.map((entry) => entry.text));
      const generatedAt = new Date().toISOString();
      const embeddingByIndex = new Map<number, number[]>();
      embeddingInputs.forEach((entry, idx) => {
        embeddingByIndex.set(entry.index, embeddingResult.embeddings[idx]!);
      });

      preparedChunks = preparedChunks.map((chunk, index) => ({
        ...chunk,
        embedding: embeddingByIndex.get(index) ?? chunk.embedding,
        metadata: {
          ...chunk.metadata,
          embeddingProvider: embeddingResult.provider,
          embeddingModel: embeddingResult.model,
          embeddingDimensions: embeddingResult.dimensions,
          embeddingOrigin: shouldRegenerateAll ? "regenerated" : "generated",
          embeddingGeneratedAt: generatedAt,
        },
      }));
    }

    const chunks = await knowledge.replaceDocumentChunks({
      companyId: document.companyId,
      documentId: document.id,
      chunks: preparedChunks.map((chunk) => ({
        ...chunk,
        embedding: chunk.embedding!,
      })),
    });

    if (shouldGenerateEmbeddings && chunks.length > 0) {
      const embeddingMetadata = preparedChunks[0]?.metadata ?? {};
      await knowledge.updateDocumentMetadata(document.id, {
        embeddingProvider: embeddingMetadata.embeddingProvider,
        embeddingModel: embeddingMetadata.embeddingModel,
        embeddingDimensions: embeddingMetadata.embeddingDimensions,
        embeddingOrigin: embeddingMetadata.embeddingOrigin,
        embeddingGeneratedAt: embeddingMetadata.embeddingGeneratedAt,
        embeddingChunkCount: chunks.length,
      });
    }

    await logActivity(db, {
      companyId: document.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "knowledge.document.chunks_replaced",
      entityType: "project",
      entityId: document.projectId ?? document.issueId ?? document.id,
      details: {
        documentId: document.id,
        chunkCount: chunks.length,
        generatedEmbeddings: shouldGenerateEmbeddings,
      },
    });

    res.status(201).json({
      documentId: document.id,
      chunkCount: chunks.length,
      chunks,
    });
  });

  router.post("/knowledge/documents/:id/reembed", async (req, res) => {
    const document = await knowledge.getDocumentById(req.params.id);
    if (!document) {
      res.status(404).json({ error: "Knowledge document not found" });
      return;
    }

    assertCompanyAccess(req, document.companyId);
    const parsed = reembedKnowledgeDocumentSchema.safeParse(req.body === undefined ? undefined : req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation error", details: parsed.error.issues });
      return;
    }

    if (!embeddings.isConfigured()) {
      res.status(409).json({
        error: "Knowledge embedding provider is not configured",
        hint: "Set OPENAI_API_KEY or SQUADRAIL_KNOWLEDGE_OPENAI_API_KEY before re-embedding documents.",
      });
      return;
    }

    const actor = getActorInfo(req);
    const result = await backfill.reembedDocument({
      documentId: document.id,
      actor: {
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId ?? undefined,
        runId: actor.runId ?? undefined,
      },
      origin: parsed.data?.force ? "regenerated" : "backfill",
    });
    if (!result) {
      res.status(404).json({ error: "Knowledge document not found" });
      return;
    }

    res.status(201).json(result);
  });

  router.get("/knowledge/retrieval-policies", async (req, res) => {
    const parsed = listRetrievalPoliciesSchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation error", details: parsed.error.issues });
      return;
    }

    assertCompanyAccess(req, parsed.data.companyId);
    const policies = await knowledge.listRetrievalPolicies(parsed.data);
    res.json(policies);
  });

  router.put("/knowledge/retrieval-policies", async (req, res) => {
    const parsed = upsertRetrievalPolicySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation error", details: parsed.error.issues });
      return;
    }

    const actor = getActorInfo(req);
    assertCompanyAccess(req, parsed.data.companyId);

    const policy = await knowledge.upsertRetrievalPolicy(parsed.data);
    await logActivity(db, {
      companyId: parsed.data.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "knowledge.retrieval_policy.upserted",
      entityType: "company",
      entityId: parsed.data.companyId,
      details: {
        policyId: policy.id,
        role: policy.role,
        eventType: policy.eventType,
        workflowState: policy.workflowState,
      },
    });

    res.status(201).json(policy);
  });

  router.post("/knowledge/projects/:projectId/import-workspace", async (req, res) => {
    const projectId = req.params.projectId as string;
    const project = await projects.getById(projectId);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    assertCompanyAccess(req, project.companyId);
    const parsed = importProjectWorkspaceSchema.safeParse(req.body === undefined ? undefined : req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation error", details: parsed.error.issues });
      return;
    }

    if (!embeddings.isConfigured()) {
      res.status(409).json({
        error: "Knowledge embedding provider is not configured",
        hint: "Set OPENAI_API_KEY or SQUADRAIL_KNOWLEDGE_OPENAI_API_KEY before importing a project workspace.",
      });
      return;
    }

    const result = await imports.importProjectWorkspace({
      projectId,
      workspaceId: parsed.data?.workspaceId,
      maxFiles: parsed.data?.maxFiles,
    });
    if (!result) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    await setup.update(project.companyId, {
      selectedWorkspaceId: result.workspaceId,
      metadata: {
        knowledgeSeeded: result.importedFiles > 0,
      },
    });

    res.status(201).json(result);
  });

  return router;
}
