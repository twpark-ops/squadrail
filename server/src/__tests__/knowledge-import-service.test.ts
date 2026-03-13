import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockProjectGetById,
  mockGetProjectKnowledgeRevision,
  mockCreateDocument,
  mockDeprecateSupersededDocuments,
  mockReplaceDocumentChunks,
  mockUpdateDocumentMetadata,
  mockRecordDocumentVersion,
  mockDeprecateDocumentsByPaths,
  mockTouchProjectKnowledgeRevision,
  mockGetProviderInfo,
  mockGenerateEmbeddings,
  mockInspectWorkspaceVersionContext,
  mockListWorkspaceChangedPaths,
  mockLogActivity,
} = vi.hoisted(() => ({
  mockProjectGetById: vi.fn(),
  mockGetProjectKnowledgeRevision: vi.fn(),
  mockCreateDocument: vi.fn(),
  mockDeprecateSupersededDocuments: vi.fn(),
  mockReplaceDocumentChunks: vi.fn(),
  mockUpdateDocumentMetadata: vi.fn(),
  mockRecordDocumentVersion: vi.fn(),
  mockDeprecateDocumentsByPaths: vi.fn(),
  mockTouchProjectKnowledgeRevision: vi.fn(),
  mockGetProviderInfo: vi.fn(),
  mockGenerateEmbeddings: vi.fn(),
  mockInspectWorkspaceVersionContext: vi.fn(),
  mockListWorkspaceChangedPaths: vi.fn(),
  mockLogActivity: vi.fn(),
}));

vi.mock("../services/activity-log.js", () => ({
  logActivity: mockLogActivity,
}));

vi.mock("../services/knowledge-embeddings.js", () => ({
  knowledgeEmbeddingService: () => ({
    getProviderInfo: mockGetProviderInfo,
    generateEmbeddings: mockGenerateEmbeddings,
  }),
}));

vi.mock("../services/knowledge.js", () => ({
  knowledgeService: () => ({
    getProjectKnowledgeRevision: mockGetProjectKnowledgeRevision,
    createDocument: mockCreateDocument,
    deprecateSupersededDocuments: mockDeprecateSupersededDocuments,
    replaceDocumentChunks: mockReplaceDocumentChunks,
    updateDocumentMetadata: mockUpdateDocumentMetadata,
    recordDocumentVersion: mockRecordDocumentVersion,
    deprecateDocumentsByPaths: mockDeprecateDocumentsByPaths,
    touchProjectKnowledgeRevision: mockTouchProjectKnowledgeRevision,
  }),
}));

vi.mock("../services/projects.js", () => ({
  projectService: () => ({
    getById: mockProjectGetById,
  }),
}));

vi.mock("../services/workspace-git-snapshot.js", () => ({
  inspectWorkspaceVersionContext: mockInspectWorkspaceVersionContext,
  listWorkspaceChangedPaths: mockListWorkspaceChangedPaths,
}));

import { knowledgeImportService } from "../services/knowledge-import.js";

describe("knowledge import service", () => {
  const tempRoots: string[] = [];
  const originalAllowedRoots = process.env.SQUADRAIL_ALLOWED_WORKSPACE_ROOTS;

  afterEach(async () => {
    await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
    tempRoots.length = 0;
    if (originalAllowedRoots === undefined) delete process.env.SQUADRAIL_ALLOWED_WORKSPACE_ROOTS;
    else process.env.SQUADRAIL_ALLOWED_WORKSPACE_ROOTS = originalAllowedRoots;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetProviderInfo.mockReturnValue({
      available: true,
      provider: "openai",
      model: "text-embedding-3-small",
    });
    mockGenerateEmbeddings.mockImplementation(async (texts: string[]) => ({
      provider: "openai",
      model: "text-embedding-3-small",
      dimensions: 2,
      usage: { totalTokens: texts.length * 10 },
      embeddings: texts.map(() => [0.1, 0.2]),
    }));
    mockCreateDocument.mockResolvedValue({ id: "document-1" });
    mockDeprecateSupersededDocuments.mockResolvedValue(0);
    mockReplaceDocumentChunks.mockImplementation(async ({ chunks }: { chunks: Array<Record<string, unknown>> }) => (
      chunks.map((chunk, index) => ({ id: `chunk-${index + 1}`, ...chunk }))
    ));
    mockUpdateDocumentMetadata.mockResolvedValue(undefined);
    mockRecordDocumentVersion.mockResolvedValue(undefined);
    mockDeprecateDocumentsByPaths.mockResolvedValue(0);
    mockTouchProjectKnowledgeRevision.mockResolvedValue({ revision: 3 });
  });

  it("requires an embedding provider before importing", async () => {
    mockGetProviderInfo.mockReturnValue({
      available: false,
      provider: null,
      model: null,
    });
    const service = knowledgeImportService({} as never);

    await expect(service.importProjectWorkspace({ projectId: "project-1" })).rejects.toThrow(
      "Knowledge embedding provider is not configured",
    );
  });

  it("returns null when the target project cannot be found", async () => {
    mockProjectGetById.mockResolvedValue(null);
    const service = knowledgeImportService({} as never);

    await expect(service.importProjectWorkspace({ projectId: "missing-project" })).resolves.toBeNull();
  });

  it("skips unchanged workspaces when the stored tree signature still matches", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "knowledge-import-service-"));
    tempRoots.push(workspaceRoot);
    process.env.SQUADRAIL_ALLOWED_WORKSPACE_ROOTS = workspaceRoot;
    await mkdir(path.join(workspaceRoot, "src"), { recursive: true });
    await writeFile(path.join(workspaceRoot, "src", "controller.ts"), "export function controller() { return true; }\n");

    mockProjectGetById.mockResolvedValue({
      id: "project-1",
      companyId: "company-1",
      primaryWorkspace: {
        id: "workspace-1",
        name: "Primary",
        cwd: workspaceRoot,
        repoUrl: "https://example.com/runtime.git",
        repoRef: "main",
      },
      workspaces: [
        {
          id: "workspace-1",
          name: "Primary",
          cwd: workspaceRoot,
          repoUrl: "https://example.com/runtime.git",
          repoRef: "main",
        },
      ],
    });
    mockGetProjectKnowledgeRevision.mockResolvedValue({
      revision: 4,
      lastHeadSha: "sha-same",
      lastTreeSignature: "tree-same",
    });
    mockInspectWorkspaceVersionContext.mockResolvedValue({
      branchName: "main",
      defaultBranchName: "main",
      headSha: "sha-same",
      parentCommitSha: "sha-parent",
      treeSignature: "tree-same",
      capturedAt: new Date("2026-03-13T00:00:00.000Z"),
      isDefaultBranch: true,
    });

    const service = knowledgeImportService({} as never);
    const result = await service.importProjectWorkspace({ projectId: "project-1" });

    expect(result).toEqual({
      projectId: "project-1",
      workspaceId: "workspace-1",
      workspaceName: "Primary",
      cwd: workspaceRoot,
      scannedFiles: 1,
      importedFiles: 0,
      skippedFiles: 0,
      deprecatedFiles: 0,
      documents: [],
      importMode: "skipped_unchanged",
      changedPathCount: 0,
      knowledgeRevision: 4,
    });
    expect(mockCreateDocument).not.toHaveBeenCalled();
    expect(mockLogActivity).not.toHaveBeenCalled();
  });

  it("imports changed files, skips secrets, and deprecates removed paths", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "knowledge-import-service-"));
    tempRoots.push(workspaceRoot);
    process.env.SQUADRAIL_ALLOWED_WORKSPACE_ROOTS = workspaceRoot;
    await mkdir(path.join(workspaceRoot, "src"), { recursive: true });
    await mkdir(path.join(workspaceRoot, "docs"), { recursive: true });
    await Promise.all([
      writeFile(
        path.join(workspaceRoot, "src", "controller.ts"),
        [
          "import { runJob } from './worker';",
          "",
          "export function controller() {",
          "  return runJob();",
          "}",
        ].join("\n"),
      ),
      writeFile(path.join(workspaceRoot, "docs", "runbook.md"), "# Runtime runbook\n"),
      writeFile(path.join(workspaceRoot, ".env.production"), "API_KEY=secret-value\n"),
    ]);

    mockProjectGetById.mockResolvedValue({
      id: "project-1",
      companyId: "company-1",
      primaryWorkspace: {
        id: "workspace-1",
        name: "Primary",
        cwd: workspaceRoot,
        repoUrl: "https://example.com/runtime.git",
        repoRef: "main",
      },
      workspaces: [
        {
          id: "workspace-1",
          name: "Primary",
          cwd: workspaceRoot,
          repoUrl: "https://example.com/runtime.git",
          repoRef: "main",
        },
      ],
    });
    mockGetProjectKnowledgeRevision.mockResolvedValue({
      revision: 2,
      lastHeadSha: "sha-old",
      lastTreeSignature: "tree-old",
    });
    mockInspectWorkspaceVersionContext.mockResolvedValue({
      branchName: "main",
      defaultBranchName: "main",
      headSha: "sha-new",
      parentCommitSha: "sha-parent",
      treeSignature: "tree-new",
      capturedAt: new Date("2026-03-13T00:00:00.000Z"),
      isDefaultBranch: true,
    });
    mockListWorkspaceChangedPaths.mockResolvedValue([
      "src/controller.ts",
      "src/deleted.ts",
    ]);
    mockDeprecateDocumentsByPaths.mockResolvedValue(1);
    mockTouchProjectKnowledgeRevision.mockResolvedValue({ revision: 3 });

    const service = knowledgeImportService({} as never);
    const result = await service.importProjectWorkspace({ projectId: "project-1" });

    expect(result).toEqual(expect.objectContaining({
      projectId: "project-1",
      workspaceId: "workspace-1",
      workspaceName: "Primary",
      importedFiles: 1,
      deprecatedFiles: 1,
      importMode: "incremental",
      changedPathCount: 2,
      knowledgeRevision: 3,
    }));
    expect(result?.documents).toEqual([
      expect.objectContaining({
        documentId: "document-1",
        path: "src/controller.ts",
      }),
    ]);
    expect(mockCreateDocument).toHaveBeenCalledTimes(1);
    expect(mockCreateDocument).toHaveBeenCalledWith(expect.objectContaining({
      companyId: "company-1",
      sourceType: "code",
      path: "src/controller.ts",
      metadata: expect.objectContaining({
        workspaceId: "workspace-1",
        versionCommitSha: "sha-new",
      }),
    }));
    expect(mockReplaceDocumentChunks).toHaveBeenCalledWith(expect.objectContaining({
      companyId: "company-1",
      documentId: "document-1",
      chunks: expect.arrayContaining([
        expect.objectContaining({
          links: expect.arrayContaining([
            expect.objectContaining({ entityType: "project", entityId: "project-1" }),
            expect.objectContaining({ entityType: "workspace", entityId: "workspace-1" }),
            expect.objectContaining({ entityType: "path", entityId: "src/controller.ts" }),
          ]),
        }),
      ]),
    }));
    expect(mockDeprecateDocumentsByPaths).toHaveBeenCalledWith(expect.objectContaining({
      companyId: "company-1",
      projectId: "project-1",
      paths: ["src/deleted.ts"],
      reason: "workspace_path_removed",
    }));
    expect(mockLogActivity).toHaveBeenCalledWith(
      {} as never,
      expect.objectContaining({
        action: "knowledge.workspace.imported",
        entityId: "project-1",
        details: expect.objectContaining({
          importedFiles: 1,
          deprecatedFiles: 1,
          importMode: "incremental",
        }),
      }),
    );
  });
});
