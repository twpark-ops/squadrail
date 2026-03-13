import { knowledgeDocuments } from "@squadrail/db";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetProviderInfo,
  mockGenerateEmbeddings,
  mockGetDocumentById,
  mockListDocumentChunksWithLinks,
  mockReplaceDocumentChunks,
  mockUpdateDocumentMetadata,
  mockRecordDocumentVersion,
  mockListDocumentsNeedingEmbeddingRefresh,
  mockTouchProjectKnowledgeRevision,
  mockProjectList,
  mockLogActivity,
  mockBuildCodeGraphForWorkspaceFile,
  mockInspectWorkspaceVersionContext,
} = vi.hoisted(() => ({
  mockGetProviderInfo: vi.fn(),
  mockGenerateEmbeddings: vi.fn(),
  mockGetDocumentById: vi.fn(),
  mockListDocumentChunksWithLinks: vi.fn(),
  mockReplaceDocumentChunks: vi.fn(),
  mockUpdateDocumentMetadata: vi.fn(),
  mockRecordDocumentVersion: vi.fn(),
  mockListDocumentsNeedingEmbeddingRefresh: vi.fn(),
  mockTouchProjectKnowledgeRevision: vi.fn(),
  mockProjectList: vi.fn(),
  mockLogActivity: vi.fn(),
  mockBuildCodeGraphForWorkspaceFile: vi.fn(),
  mockInspectWorkspaceVersionContext: vi.fn(),
}));

vi.mock("../services/knowledge-embeddings.js", () => ({
  knowledgeEmbeddingService: () => ({
    getProviderInfo: mockGetProviderInfo,
    generateEmbeddings: mockGenerateEmbeddings,
  }),
}));

vi.mock("../services/knowledge.js", () => ({
  knowledgeService: () => ({
    getDocumentById: mockGetDocumentById,
    listDocumentChunksWithLinks: mockListDocumentChunksWithLinks,
    replaceDocumentChunks: mockReplaceDocumentChunks,
    updateDocumentMetadata: mockUpdateDocumentMetadata,
    recordDocumentVersion: mockRecordDocumentVersion,
    listDocumentsNeedingEmbeddingRefresh: mockListDocumentsNeedingEmbeddingRefresh,
    touchProjectKnowledgeRevision: mockTouchProjectKnowledgeRevision,
  }),
}));

vi.mock("../services/projects.js", () => ({
  projectService: () => ({
    list: mockProjectList,
  }),
}));

vi.mock("../services/activity-log.js", () => ({
  logActivity: mockLogActivity,
}));

vi.mock("../services/knowledge-import.js", () => ({
  buildCodeGraphForWorkspaceFile: mockBuildCodeGraphForWorkspaceFile,
}));

vi.mock("../services/workspace-git-snapshot.js", () => ({
  inspectWorkspaceVersionContext: mockInspectWorkspaceVersionContext,
}));

import { knowledgeBackfillService } from "../services/knowledge-backfill.js";

function shiftTableRows(queueMap: Map<unknown, unknown[][]>, table: unknown) {
  const queue = queueMap.get(table);
  return queue?.shift() ?? [];
}

function createResolvedSelectChain(selectRows: Map<unknown, unknown[][]>) {
  let selectedTable: unknown = null;
  const chain = {
    from: (table: unknown) => {
      selectedTable = table;
      return chain;
    },
    where: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    then: <T>(resolve: (value: unknown[]) => T | PromiseLike<T>) =>
      Promise.resolve(shiftTableRows(selectRows, selectedTable)).then(resolve),
  };
  return chain;
}

function createKnowledgeBackfillDbMock(input?: {
  selectRows?: Map<unknown, unknown[][]>;
}) {
  const selectRows = input?.selectRows ?? new Map();
  return {
    db: {
      select: () => createResolvedSelectChain(selectRows),
    },
  };
}

function buildDocument(overrides: Record<string, unknown> = {}) {
  return {
    id: "doc-1",
    companyId: "company-1",
    projectId: "project-1",
    issueId: null,
    path: "src/runtime.ts",
    repoRef: "main",
    language: "typescript",
    rawContent: "export const runtime = true;",
    sourceType: "code",
    metadata: {
      importSource: "workspace",
      versionBranchName: "main",
      versionDefaultBranchName: "main",
      versionCommitSha: "abc123",
      versionParentCommitSha: "def456",
      versionCapturedAt: "2026-03-13T10:00:00.000Z",
      versionIsDefaultBranch: true,
      versionIsHead: true,
    },
    ...overrides,
  };
}

describe("knowledge backfill service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetProviderInfo.mockReturnValue({
      available: true,
      provider: "openai",
      model: "text-embedding-3-small",
      dimensions: 1536,
    });
    mockGetDocumentById.mockResolvedValue(buildDocument());
    mockListDocumentChunksWithLinks.mockResolvedValue([]);
    mockReplaceDocumentChunks.mockResolvedValue([]);
    mockUpdateDocumentMetadata.mockResolvedValue(null);
    mockRecordDocumentVersion.mockResolvedValue(null);
    mockListDocumentsNeedingEmbeddingRefresh.mockResolvedValue([]);
    mockTouchProjectKnowledgeRevision.mockResolvedValue(null);
    mockProjectList.mockResolvedValue([]);
    mockLogActivity.mockResolvedValue(null);
    mockBuildCodeGraphForWorkspaceFile.mockReturnValue(null);
    mockInspectWorkspaceVersionContext.mockResolvedValue(null);
  });

  it("updates metadata only when a document has no chunks to reembed", async () => {
    const { db } = createKnowledgeBackfillDbMock();
    const service = knowledgeBackfillService(db as never);

    const result = await service.reembedDocument({
      documentId: "doc-1",
      actor: {
        actorType: "system",
        actorId: "knowledge_backfill_worker",
      },
      origin: "backfill",
    });

    expect(result).toMatchObject({
      documentId: "doc-1",
      chunkCount: 0,
      provider: "openai",
    });
    expect(mockUpdateDocumentMetadata).toHaveBeenCalledWith("doc-1", expect.objectContaining({
      embeddingChunkCount: 0,
      embeddingOrigin: "backfill",
    }));
    expect(mockGenerateEmbeddings).not.toHaveBeenCalled();
  });

  it("replaces chunks, rebuilds graph metadata, and records activity on reembed", async () => {
    mockListDocumentChunksWithLinks.mockResolvedValue([
      {
        chunkIndex: 0,
        headingPath: "Runtime",
        symbolName: "runtimeWorker",
        tokenCount: 12,
        textContent: "export const runtime = true;",
        metadata: { sourceType: "code" },
        links: [{ entityType: "path", entityId: "src/runtime.ts", linkReason: "code" }],
      },
    ]);
    mockGenerateEmbeddings.mockResolvedValue({
      embeddings: [[0.1, 0.2, 0.3]],
      provider: "openai",
      model: "text-embedding-3-small",
      dimensions: 1536,
      usage: { totalTokens: 128 },
    });
    mockBuildCodeGraphForWorkspaceFile.mockReturnValue({
      symbols: [{ id: "symbol-1" }],
      edges: [{ from: "symbol-1", to: "symbol-2" }],
    });
    mockReplaceDocumentChunks.mockImplementation(async ({ chunks }: { chunks: unknown[] }) => chunks);

    const { db } = createKnowledgeBackfillDbMock();
    const service = knowledgeBackfillService(db as never);

    const result = await service.reembedDocument({
      documentId: "doc-1",
      actor: {
        actorType: "agent",
        actorId: "agent-1",
        runId: "run-1",
      },
      origin: "regenerated",
    });

    expect(result).toMatchObject({
      documentId: "doc-1",
      chunkCount: 1,
      totalTokens: 128,
    });
    expect(mockReplaceDocumentChunks).toHaveBeenCalledWith(expect.objectContaining({
      documentId: "doc-1",
      codeGraph: expect.objectContaining({
        symbols: [{ id: "symbol-1" }],
      }),
      chunks: [
        expect.objectContaining({
          embedding: [0.1, 0.2, 0.3],
        }),
      ],
    }));
    expect(mockUpdateDocumentMetadata).toHaveBeenCalledWith("doc-1", expect.objectContaining({
      codeGraphSymbolCount: 1,
      codeGraphEdgeCount: 1,
      embeddingChunkCount: 1,
      embeddingTotalTokens: 128,
      embeddingOrigin: "regenerated",
    }));
    expect(mockRecordDocumentVersion).toHaveBeenCalled();
    expect(mockLogActivity).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "knowledge.document.reembedded",
      runId: "run-1",
    }));
  });

  it("skips the periodic tick when no embedding provider is configured", async () => {
    mockGetProviderInfo.mockReturnValue({
      available: false,
      provider: null,
      model: null,
      dimensions: 0,
    });
    const { db } = createKnowledgeBackfillDbMock();
    const service = knowledgeBackfillService(db as never);

    await expect(service.tick()).resolves.toEqual({
      enabled: false,
      scanned: 0,
      processed: 0,
      failed: 0,
    });
  });

  it("counts processed and failed documents during periodic tick", async () => {
    const { db } = createKnowledgeBackfillDbMock();
    const service = knowledgeBackfillService(db as never);
    mockListDocumentsNeedingEmbeddingRefresh.mockResolvedValue([
      { id: "doc-1" },
      { id: "doc-2" },
    ]);
    const reembedSpy = vi.spyOn(service, "reembedDocument")
      .mockResolvedValueOnce({
        documentId: "doc-1",
        companyId: "company-1",
        chunkCount: 2,
        provider: "openai",
        model: "text-embedding-3-small",
        dimensions: 1536,
      } as never)
      .mockRejectedValueOnce(new Error("provider timeout"));

    const result = await service.tick({ limit: 10 });

    expect(result).toEqual({
      enabled: true,
      scanned: 2,
      processed: 1,
      failed: 1,
    });
    expect(reembedSpy).toHaveBeenCalledTimes(2);
  });

  it("rebuilds code graph metadata for code documents with persisted chunks", async () => {
    mockListDocumentChunksWithLinks.mockResolvedValue([
      {
        chunkIndex: 0,
        headingPath: "Runtime",
        symbolName: "runtimeWorker",
        tokenCount: 12,
        textContent: "export const runtime = true;",
        embedding: [0.1, 0.2],
        metadata: { sourceType: "code" },
        links: [],
      },
    ]);
    mockBuildCodeGraphForWorkspaceFile.mockReturnValue({
      symbols: [{ id: "symbol-1" }, { id: "symbol-2" }],
      edges: [{ from: "symbol-1", to: "symbol-2" }],
    });
    mockReplaceDocumentChunks.mockImplementation(async ({ chunks }: { chunks: unknown[] }) => chunks);

    const { db } = createKnowledgeBackfillDbMock();
    const service = knowledgeBackfillService(db as never);

    const result = await service.rebuildDocumentGraph({
      documentId: "doc-1",
      actor: {
        actorType: "system",
        actorId: "knowledge_graph_backfill",
      },
    });

    expect(result).toEqual({
      documentId: "doc-1",
      companyId: "company-1",
      chunkCount: 1,
      symbolCount: 2,
      edgeCount: 1,
      skipped: false,
    });
    expect(mockUpdateDocumentMetadata).toHaveBeenCalledWith("doc-1", expect.objectContaining({
      codeGraphSymbolCount: 2,
      codeGraphEdgeCount: 1,
      codeGraphRebuiltAt: expect.any(String),
    }));
  });

  it("rebuilds company code graph in deterministic priority order", async () => {
    const { db } = createKnowledgeBackfillDbMock({
      selectRows: new Map([
        [knowledgeDocuments, [[
          {
            id: "doc-test",
            path: "src/runtime.test.ts",
            sourceType: "test_report",
            updatedAt: new Date("2026-03-13T11:00:00.000Z"),
          },
          {
            id: "doc-code-b",
            path: "src/zeta.ts",
            sourceType: "code",
            updatedAt: new Date("2026-03-13T12:00:00.000Z"),
          },
          {
            id: "doc-code-a",
            path: "src/alpha.ts",
            sourceType: "code",
            updatedAt: new Date("2026-03-13T10:00:00.000Z"),
          },
        ]]],
      ]),
    });
    const service = knowledgeBackfillService(db as never);
    const rebuildSpy = vi.spyOn(service, "rebuildDocumentGraph")
      .mockResolvedValueOnce({ skipped: false } as never)
      .mockResolvedValueOnce({ skipped: false } as never)
      .mockResolvedValueOnce({ skipped: true } as never);

    const result = await service.rebuildCompanyCodeGraph({
      companyId: "company-1",
      limit: 10,
    });

    expect(rebuildSpy.mock.calls.map((call) => call[0].documentId)).toEqual([
      "doc-code-a",
      "doc-code-b",
      "doc-test",
    ]);
    expect(result).toEqual({
      companyId: "company-1",
      scanned: 3,
      processed: 2,
      skipped: 1,
    });
  });

  it("records workspace version metadata for current project documents", async () => {
    mockProjectList.mockResolvedValue([
      {
        id: "project-1",
        name: "Runtime",
        primaryWorkspace: {
          id: "workspace-1",
          name: "runtime",
          cwd: "/repo/runtime",
        },
        workspaces: [],
      },
      {
        id: "project-2",
        name: "No Workspace",
        primaryWorkspace: null,
        workspaces: [],
      },
    ]);
    mockInspectWorkspaceVersionContext.mockResolvedValue({
      branchName: "main",
      defaultBranchName: "main",
      headSha: "abc123",
      parentCommitSha: "def456",
      capturedAt: "2026-03-13T12:00:00.000Z",
      isDefaultBranch: true,
      treeSignature: "tree-1",
    });
    const { db } = createKnowledgeBackfillDbMock({
      selectRows: new Map([
        [knowledgeDocuments, [[
          {
            id: "doc-1",
            companyId: "company-1",
            projectId: "project-1",
            path: "src/runtime.ts",
            repoRef: "main",
            metadata: { importSource: "workspace" },
          },
          {
            id: "doc-2",
            companyId: "company-1",
            projectId: "project-1",
            path: null,
            repoRef: "main",
            metadata: { importSource: "workspace" },
          },
        ]]],
      ]),
    });
    const service = knowledgeBackfillService(db as never);

    const result = await service.rebuildCompanyDocumentVersions({
      companyId: "company-1",
      limit: 10,
    });

    expect(result).toEqual({
      companyId: "company-1",
      scanned: 2,
      processed: 1,
      skipped: 1,
    });
    expect(mockUpdateDocumentMetadata).toHaveBeenCalledWith("doc-1", expect.objectContaining({
      versionCommitSha: "abc123",
      versionBranchName: "main",
    }));
    expect(mockRecordDocumentVersion).toHaveBeenCalledWith(expect.objectContaining({
      documentId: "doc-1",
      branchName: "main",
      commitSha: "abc123",
      metadata: expect.objectContaining({
        workspaceId: "workspace-1",
      }),
    }));
    expect(mockTouchProjectKnowledgeRevision).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "project-1",
      headSha: "abc123",
      metadata: expect.objectContaining({
        processedDocuments: 1,
      }),
    }));
  });
});
