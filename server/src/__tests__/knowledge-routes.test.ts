import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockProjectGetById,
  mockEmbeddingsIsConfigured,
  mockImportProjectWorkspace,
  mockSetupUpdate,
  mockGetRetrievalRunById,
  mockListRetrievalRunHits,
} = vi.hoisted(() => ({
  mockProjectGetById: vi.fn(),
  mockEmbeddingsIsConfigured: vi.fn(),
  mockImportProjectWorkspace: vi.fn(),
  mockSetupUpdate: vi.fn(),
  mockGetRetrievalRunById: vi.fn(),
  mockListRetrievalRunHits: vi.fn(),
}));

vi.mock("../services/index.js", () => ({
  knowledgeBackfillService: () => ({
    reembedDocument: vi.fn(),
  }),
  knowledgeEmbeddingService: () => ({
    isConfigured: mockEmbeddingsIsConfigured,
  }),
  knowledgeImportService: () => ({
    importProjectWorkspace: mockImportProjectWorkspace,
  }),
  knowledgeService: () => ({
    createDocument: vi.fn(),
    getDocumentById: vi.fn(),
    getRetrievalRunById: mockGetRetrievalRunById,
    listDocumentChunks: vi.fn(),
    listRetrievalRunHits: mockListRetrievalRunHits,
    replaceDocumentChunks: vi.fn(),
    updateDocumentMetadata: vi.fn(),
    listRetrievalPolicies: vi.fn(),
    upsertRetrievalPolicy: vi.fn(),
  }),
  logActivity: vi.fn(),
  projectService: () => ({
    getById: mockProjectGetById,
  }),
  setupProgressService: () => ({
    update: mockSetupUpdate,
  }),
}));

import { knowledgeRoutes } from "../routes/knowledge.js";

function buildBoardActor(companyIds: string[] = ["company-1"]) {
  return {
    type: "board" as const,
    source: "local_implicit" as const,
    isInstanceAdmin: true,
    userId: "user-1",
    companyIds,
    runId: null,
  };
}

function findRouteLayer(router: any, path: string, method: "get" | "post") {
  const layer = router.stack.find(
    (entry: any) => entry.route?.path === path && entry.route?.methods?.[method] === true,
  );
  if (!layer?.route?.stack) {
    throw new Error(`Route ${method.toUpperCase()} ${path} not found`);
  }
  return layer.route.stack.map((entry: any) => entry.handle as Function);
}

async function invokeImportRoute(input: {
  params: Record<string, string>;
  body?: unknown;
}) {
  const router = knowledgeRoutes({} as never) as any;
  const handlers = findRouteLayer(router, "/knowledge/projects/:projectId/import-workspace", "post");
  const req = {
    params: input.params,
    body: input.body ?? {},
    actor: buildBoardActor(),
  };
  const state: { statusCode: number; body: unknown } = {
    statusCode: 200,
    body: undefined,
  };
  const res = {
    status(code: number) {
      state.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      state.body = payload;
      return this;
    },
  };

  try {
    for (const handler of handlers) {
      await new Promise<void>((resolve, reject) => {
        try {
          const result = handler(req, res, (error?: unknown) => {
            if (error) reject(error);
            else resolve();
          });
          if (result && typeof result.then === "function") {
            result.then(() => resolve(), reject);
            return;
          }
          if (handler.length < 3) resolve();
        } catch (error) {
          reject(error);
        }
      });
    }
    return state;
  } catch (error: any) {
    return {
      statusCode: error?.status ?? 500,
      body: { error: error?.message ?? "Unhandled error" },
    };
  }
}

async function invokeRetrievalHitsRoute(input: {
  params: Record<string, string>;
}) {
  const router = knowledgeRoutes({} as never) as any;
  const handlers = findRouteLayer(router, "/knowledge/retrieval-runs/:id/hits", "get");
  const req = {
    params: input.params,
    actor: buildBoardActor(),
  };
  const state: { statusCode: number; body: unknown } = {
    statusCode: 200,
    body: undefined,
  };
  const res = {
    status(code: number) {
      state.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      state.body = payload;
      return this;
    },
  };

  try {
    for (const handler of handlers) {
      await new Promise<void>((resolve, reject) => {
        try {
          const result = handler(req, res, (error?: unknown) => {
            if (error) reject(error);
            else resolve();
          });
          if (result && typeof result.then === "function") {
            result.then(() => resolve(), reject);
            return;
          }
          if (handler.length < 3) resolve();
        } catch (error) {
          reject(error);
        }
      });
    }
    return state;
  } catch (error: any) {
    return {
      statusCode: error?.status ?? 500,
      body: { error: error?.message ?? "Unhandled error" },
    };
  }
}

describe("knowledge routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates setup progress after importing workspace knowledge", async () => {
    mockProjectGetById.mockResolvedValue({
      id: "project-1",
      companyId: "company-1",
    });
    mockEmbeddingsIsConfigured.mockReturnValue(true);
    mockImportProjectWorkspace.mockResolvedValue({
      projectId: "project-1",
      workspaceId: "11111111-1111-4111-8111-111111111111",
      workspaceName: "main",
      cwd: "/tmp/project",
      scannedFiles: 5,
      importedFiles: 3,
      skippedFiles: 2,
      documents: [],
    });

    const response = await invokeImportRoute({
      params: { projectId: "project-1" },
      body: {
        workspaceId: "11111111-1111-4111-8111-111111111111",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(mockImportProjectWorkspace).toHaveBeenCalledWith({
      projectId: "project-1",
      workspaceId: "11111111-1111-4111-8111-111111111111",
      maxFiles: undefined,
    });
    expect(mockSetupUpdate).toHaveBeenCalledWith("company-1", {
      selectedWorkspaceId: "11111111-1111-4111-8111-111111111111",
      metadata: {
        knowledgeSeeded: true,
      },
    });
  });

  it("returns retrieval hits for a retrieval run", async () => {
    mockGetRetrievalRunById.mockResolvedValue({
      id: "retrieval-1",
      companyId: "company-1",
    });
    mockListRetrievalRunHits.mockResolvedValue([
      {
        chunkId: "chunk-1",
        path: "src/retry.ts",
        fusedScore: 0.91,
      },
    ]);

    const response = await invokeRetrievalHitsRoute({
      params: { id: "retrieval-1" },
    });

    expect(response.statusCode).toBe(200);
    expect(mockGetRetrievalRunById).toHaveBeenCalledWith("retrieval-1");
    expect(mockListRetrievalRunHits).toHaveBeenCalledWith("retrieval-1");
    expect(response.body).toEqual({
      retrievalRun: {
        id: "retrieval-1",
        companyId: "company-1",
      },
      hits: [
        {
          chunkId: "chunk-1",
          path: "src/retry.ts",
          fusedScore: 0.91,
        },
      ],
    });
  });
});
