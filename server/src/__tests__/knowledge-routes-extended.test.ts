import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/error-handler.js";

const {
  mockBuildCodeGraphForWorkspaceFile,
  mockCreateDocument,
  mockEmbeddingsGenerateEmbeddings,
  mockEmbeddingsGetProviderInfo,
  mockEmbeddingsIsConfigured,
  mockGetDocumentById,
  mockGetRetrievalRunById,
  mockListDocumentChunks,
  mockListDocumentChunksWithLinks,
  mockListDocuments,
  mockListRetrievalPolicies,
  mockLogActivity,
  mockRecordDocumentVersion,
  mockRecordManualFeedback,
  mockReembedDocument,
  mockReplaceDocumentChunks,
  mockTouchProjectKnowledgeRevision,
  mockUpdateDocumentMetadata,
  mockUpsertRetrievalPolicy,
} = vi.hoisted(() => ({
  mockBuildCodeGraphForWorkspaceFile: vi.fn(),
  mockCreateDocument: vi.fn(),
  mockEmbeddingsGenerateEmbeddings: vi.fn(),
  mockEmbeddingsGetProviderInfo: vi.fn(),
  mockEmbeddingsIsConfigured: vi.fn(),
  mockGetDocumentById: vi.fn(),
  mockGetRetrievalRunById: vi.fn(),
  mockListDocumentChunks: vi.fn(),
  mockListDocumentChunksWithLinks: vi.fn(),
  mockListDocuments: vi.fn(),
  mockListRetrievalPolicies: vi.fn(),
  mockLogActivity: vi.fn(),
  mockRecordDocumentVersion: vi.fn(),
  mockRecordManualFeedback: vi.fn(),
  mockReembedDocument: vi.fn(),
  mockReplaceDocumentChunks: vi.fn(),
  mockTouchProjectKnowledgeRevision: vi.fn(),
  mockUpdateDocumentMetadata: vi.fn(),
  mockUpsertRetrievalPolicy: vi.fn(),
}));

vi.mock("../services/index.js", () => ({
  buildCodeGraphForWorkspaceFile: mockBuildCodeGraphForWorkspaceFile,
  knowledgeBackfillService: () => ({
    reembedDocument: mockReembedDocument,
  }),
  knowledgeEmbeddingService: () => ({
    isConfigured: mockEmbeddingsIsConfigured,
    getProviderInfo: mockEmbeddingsGetProviderInfo,
    generateEmbeddings: mockEmbeddingsGenerateEmbeddings,
  }),
  knowledgeImportService: () => ({
    importProjectWorkspace: vi.fn(),
  }),
  knowledgeService: () => ({
    createDocument: mockCreateDocument,
    recordDocumentVersion: mockRecordDocumentVersion,
    touchProjectKnowledgeRevision: mockTouchProjectKnowledgeRevision,
    getDocumentById: mockGetDocumentById,
    listDocuments: mockListDocuments,
    listDocumentChunks: mockListDocumentChunks,
    listDocumentChunksWithLinks: mockListDocumentChunksWithLinks,
    getRetrievalRunById: mockGetRetrievalRunById,
    replaceDocumentChunks: mockReplaceDocumentChunks,
    updateDocumentMetadata: mockUpdateDocumentMetadata,
    listRetrievalPolicies: mockListRetrievalPolicies,
    upsertRetrievalPolicy: mockUpsertRetrievalPolicy,
  }),
  retrievalPersonalizationService: () => ({
    recordManualFeedback: mockRecordManualFeedback,
  }),
  logActivity: mockLogActivity,
  projectService: () => ({
    getById: vi.fn(),
  }),
  setupProgressService: () => ({
    update: vi.fn(),
  }),
}));

import { knowledgeRoutes } from "../routes/knowledge.js";

function buildBoardActor(companyIds: string[] = ["11111111-1111-4111-8111-111111111111"]) {
  return {
    type: "board" as const,
    source: "local_implicit" as const,
    isInstanceAdmin: true,
    userId: "user-1",
    companyIds,
    runId: null,
  };
}

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.actor = buildBoardActor();
    next();
  });
  app.use(knowledgeRoutes({} as never));
  app.use(errorHandler);
  return app;
}

describe("knowledge routes extended coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEmbeddingsIsConfigured.mockReturnValue(true);
    mockEmbeddingsGetProviderInfo.mockReturnValue({
      available: true,
      provider: "openai",
      model: "text-embedding-3-small",
    });
    mockBuildCodeGraphForWorkspaceFile.mockReturnValue({
      symbols: [],
      edges: [],
      stats: { mode: "mock" },
    });
    mockGetDocumentById.mockResolvedValue({
      id: "document-1",
      companyId: "11111111-1111-4111-8111-111111111111",
      projectId: "22222222-2222-4222-8222-222222222222",
      issueId: null,
      path: "src/runtime.ts",
      repoRef: "refs/heads/main",
      language: "ts",
      rawContent: "export const run = true;",
      metadata: {
        versionCommitSha: "abc123",
        versionCapturedAt: "2026-03-12T00:00:00.000Z",
        importSource: "workspace_sync",
      },
    });
    mockEmbeddingsGenerateEmbeddings.mockResolvedValue({
      embeddings: [[0.1, 0.2, 0.3]],
      provider: "openai",
      model: "text-embedding-3-small",
      dimensions: 3,
    });
    mockReplaceDocumentChunks.mockResolvedValue([
      {
        id: "chunk-1",
        chunkIndex: 0,
      },
    ]);
    mockReembedDocument.mockResolvedValue({
      documentId: "document-1",
      chunkCount: 1,
      origin: "backfill",
    });
  });

  it("validates list document queries", async () => {
    const app = createApp();
    const response = await request(app).get("/knowledge/documents").query({
      companyId: "not-a-uuid",
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Validation error");
  });

  it("lists knowledge documents with normalized filters", async () => {
    mockListDocuments.mockResolvedValue([{ id: "document-1" }]);

    const app = createApp();
    const response = await request(app).get("/knowledge/documents").query({
      companyId: "11111111-1111-4111-8111-111111111111",
      projectId: "22222222-2222-4222-8222-222222222222",
      sourceType: "code",
      limit: "25",
    });

    expect(response.status).toBe(200);
    expect(mockListDocuments).toHaveBeenCalledWith({
      companyId: "11111111-1111-4111-8111-111111111111",
      projectId: "22222222-2222-4222-8222-222222222222",
      sourceType: "code",
      limit: 25,
    });
    expect(response.body).toEqual([{ id: "document-1" }]);
  });

  it("returns 500 when document creation fails", async () => {
    mockCreateDocument.mockResolvedValue(null);

    const app = createApp();
    const response = await request(app).post("/knowledge/documents").send({
      companyId: "11111111-1111-4111-8111-111111111111",
      sourceType: "code",
      authorityLevel: "workspace",
      contentSha256: "sha256",
      rawContent: "export const run = true;",
      projectId: "22222222-2222-4222-8222-222222222222",
      path: "src/runtime.ts",
      title: "runtime.ts",
      language: "ts",
    });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: "Failed to create knowledge document" });
  });

  it("records document versions and project revisions for successful document creation", async () => {
    mockCreateDocument.mockResolvedValue({
      id: "document-1",
      companyId: "11111111-1111-4111-8111-111111111111",
      projectId: "22222222-2222-4222-8222-222222222222",
      issueId: null,
      sourceType: "code",
      authorityLevel: "workspace",
      metadata: {
        versionCommitSha: "abc123",
        versionCapturedAt: "2026-03-12T00:00:00.000Z",
        importSource: "manual_create",
      },
    });

    const app = createApp();
    const response = await request(app).post("/knowledge/documents").send({
      companyId: "11111111-1111-4111-8111-111111111111",
      sourceType: "code",
      authorityLevel: "workspace",
      contentSha256: "sha256",
      rawContent: "export const run = true;",
      projectId: "22222222-2222-4222-8222-222222222222",
      path: "src/runtime.ts",
      title: "runtime.ts",
      language: "ts",
    });

    expect(response.status).toBe(201);
    expect(mockRecordDocumentVersion).toHaveBeenCalledTimes(1);
    expect(mockTouchProjectKnowledgeRevision).toHaveBeenCalledWith(expect.objectContaining({
      companyId: "11111111-1111-4111-8111-111111111111",
      projectId: "22222222-2222-4222-8222-222222222222",
      importMode: "manual_create",
    }));
    expect(mockLogActivity).toHaveBeenCalledTimes(1);
  });

  it("returns 404 for missing knowledge documents", async () => {
    mockGetDocumentById.mockResolvedValue(null);

    const app = createApp();
    const response = await request(app).get("/knowledge/documents/document-1");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Knowledge document not found" });
  });

  it("rejects invalid retrieval feedback payloads", async () => {
    const app = createApp();
    const response = await request(app).post("/knowledge/retrieval-runs/run-1/feedback").send({
      feedbackType: "operator_pin",
      targetType: "path",
      targetIds: [],
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Validation error");
  });

  it("returns 404 when retrieval feedback targets an unknown run", async () => {
    mockGetRetrievalRunById.mockResolvedValue(null);

    const app = createApp();
    const response = await request(app).post("/knowledge/retrieval-runs/run-1/feedback").send({
      feedbackType: "operator_hide",
      targetType: "path",
      targetIds: ["src/runtime.ts"],
    });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Retrieval run not found" });
    expect(mockRecordManualFeedback).not.toHaveBeenCalled();
  });

  it("requires embeddings when automatic generation is disabled", async () => {
    const app = createApp();
    const response = await request(app).post("/knowledge/documents/document-1/chunks").send({
      generateEmbeddings: false,
      chunks: [
        {
          chunkIndex: 0,
          tokenCount: 12,
          textContent: "runtime chunk",
        },
      ],
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: "Embedding is required for every chunk when automatic generation is disabled",
    });
  });

  it("returns 409 when embeddings are needed but no provider is configured", async () => {
    mockEmbeddingsGetProviderInfo.mockReturnValue({
      available: false,
      provider: null,
      model: null,
    });

    const app = createApp();
    const response = await request(app).post("/knowledge/documents/document-1/chunks").send({
      chunks: [
        {
          chunkIndex: 0,
          tokenCount: 12,
          textContent: "runtime chunk",
        },
      ],
    });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: "Knowledge embedding provider is not configured",
      hint: "Set OPENAI_API_KEY or SQUADRAIL_KNOWLEDGE_OPENAI_API_KEY, or provide embeddings explicitly.",
    });
  });

  it("generates embeddings and replaces document chunks", async () => {
    const app = createApp();
    const response = await request(app).post("/knowledge/documents/document-1/chunks").send({
      chunks: [
        {
          chunkIndex: 0,
          headingPath: "API",
          symbolName: "run",
          tokenCount: 12,
          textContent: "runtime chunk",
          metadata: {
            lineStart: 1,
            lineEnd: 5,
            symbolKind: "function",
          },
        },
      ],
    });

    expect(response.status).toBe(201);
    expect(mockEmbeddingsGenerateEmbeddings).toHaveBeenCalledWith(["runtime chunk"]);
    expect(mockReplaceDocumentChunks).toHaveBeenCalledWith(expect.objectContaining({
      companyId: "11111111-1111-4111-8111-111111111111",
      documentId: "document-1",
      chunks: [
        expect.objectContaining({
          chunkIndex: 0,
          embedding: [0.1, 0.2, 0.3],
        }),
      ],
    }));
    expect(mockUpdateDocumentMetadata).toHaveBeenCalledWith("document-1", expect.objectContaining({
      embeddingProvider: "openai",
      embeddingModel: "text-embedding-3-small",
      embeddingChunkCount: 1,
    }));
    expect(mockRecordDocumentVersion).toHaveBeenCalledTimes(1);
    expect(mockTouchProjectKnowledgeRevision).toHaveBeenCalledWith(expect.objectContaining({
      importMode: "manual_replace",
      metadata: {
        documentId: "document-1",
        chunkCount: 1,
      },
    }));
    expect(mockLogActivity).toHaveBeenCalledTimes(1);
    expect(response.body).toEqual(expect.objectContaining({
      documentId: "document-1",
      chunkCount: 1,
    }));
  });

  it("returns 409 when re-embedding is requested without a configured provider", async () => {
    mockEmbeddingsIsConfigured.mockReturnValue(false);

    const app = createApp();
    const response = await request(app).post("/knowledge/documents/document-1/reembed").send({});

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: "Knowledge embedding provider is not configured",
      hint: "Set OPENAI_API_KEY or SQUADRAIL_KNOWLEDGE_OPENAI_API_KEY before re-embedding documents.",
    });
  });

  it("re-embeds a document when the provider is configured", async () => {
    const app = createApp();
    const response = await request(app).post("/knowledge/documents/document-1/reembed").send({
      force: true,
    });

    expect(response.status).toBe(201);
    expect(mockReembedDocument).toHaveBeenCalledWith(expect.objectContaining({
      documentId: "document-1",
      origin: "regenerated",
    }));
    expect(response.body).toEqual({
      documentId: "document-1",
      chunkCount: 1,
      origin: "backfill",
    });
  });

  it("validates retrieval policy queries", async () => {
    const app = createApp();
    const response = await request(app).get("/knowledge/retrieval-policies").query({
      companyId: "company-1",
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Validation error");
  });

  it("lists retrieval policies for a company", async () => {
    mockListRetrievalPolicies.mockResolvedValue([{ id: "policy-1" }]);

    const app = createApp();
    const response = await request(app).get("/knowledge/retrieval-policies").query({
      companyId: "11111111-1111-4111-8111-111111111111",
      role: "reviewer",
      eventType: "review_requested",
      workflowState: "in_review",
      limit: "20",
    });

    expect(response.status).toBe(200);
    expect(mockListRetrievalPolicies).toHaveBeenCalledWith({
      companyId: "11111111-1111-4111-8111-111111111111",
      role: "reviewer",
      eventType: "review_requested",
      workflowState: "in_review",
      limit: 20,
    });
    expect(response.body).toEqual([{ id: "policy-1" }]);
  });

  it("validates retrieval policy upserts", async () => {
    const app = createApp();
    const response = await request(app).put("/knowledge/retrieval-policies").send({
      companyId: "11111111-1111-4111-8111-111111111111",
      role: "reviewer",
      eventType: "review_requested",
      workflowState: "in_review",
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Validation error");
  });

  it("upserts retrieval policies and logs activity", async () => {
    mockUpsertRetrievalPolicy.mockResolvedValue({
      id: "policy-1",
      role: "reviewer",
      eventType: "review_requested",
      workflowState: "in_review",
    });

    const app = createApp();
    const response = await request(app).put("/knowledge/retrieval-policies").send({
      companyId: "11111111-1111-4111-8111-111111111111",
      role: "reviewer",
      eventType: "review_requested",
      workflowState: "in_review",
      topKDense: 20,
      topKSparse: 10,
      rerankK: 12,
      finalK: 6,
      allowedSourceTypes: ["code", "review"],
      allowedAuthorityLevels: ["workspace", "review"],
    });

    expect(response.status).toBe(201);
    expect(mockUpsertRetrievalPolicy).toHaveBeenCalledWith({
      companyId: "11111111-1111-4111-8111-111111111111",
      role: "reviewer",
      eventType: "review_requested",
      workflowState: "in_review",
      topKDense: 20,
      topKSparse: 10,
      rerankK: 12,
      finalK: 6,
      allowedSourceTypes: ["code", "review"],
      allowedAuthorityLevels: ["workspace", "review"],
    });
    expect(mockLogActivity).toHaveBeenCalledTimes(1);
    expect(response.body).toEqual({
      id: "policy-1",
      role: "reviewer",
      eventType: "review_requested",
      workflowState: "in_review",
    });
  });
});
