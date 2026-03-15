import { describe, expect, it, vi } from "vitest";
import { buildKnowledgeSummaryDrafts, syncKnowledgeSummaryDocuments } from "../services/knowledge-summary.js";

describe("knowledge summary service", () => {
  it("builds file and symbol summaries for code documents", () => {
    const drafts = buildKnowledgeSummaryDrafts({
      sourceDocumentId: "11111111-1111-1111-1111-111111111111",
      relativePath: "src/runtime/controller.ts",
      language: "typescript",
      title: "controller.ts",
      sourceType: "code",
      baseTags: ["swiftsight-cloud", "workflow"],
      codeChunks: [{
        chunkIndex: 0,
        symbolName: "controller",
        textContent: "export function controller() { return true; }",
        metadata: {},
      }],
      codeGraph: {
        symbols: [{
          symbolKey: "controller",
          symbolName: "controller",
          symbolKind: "function",
          startLine: 1,
          endLine: 1,
          metadata: { exported: true },
        }],
        edges: [{
          fromSymbolKey: "controller",
          targetSymbolName: "workflowService",
          edgeType: "calls",
        }],
      },
    });

    expect(drafts.map((draft) => draft.sourceType)).toEqual(["code_summary", "symbol_summary"]);
    expect(drafts[0]).toMatchObject({
      metadata: expect.objectContaining({
        summaryKind: "file",
        sourcePath: "src/runtime/controller.ts",
        sourceLanguage: "typescript",
        requiredKnowledgeTags: expect.arrayContaining(["swiftsight-cloud", "workflow"]),
      }),
      chunks: [
        expect.objectContaining({
          links: expect.arrayContaining([
            expect.objectContaining({ entityType: "document", linkReason: "summary_source_document" }),
            expect.objectContaining({ entityType: "path", linkReason: "summary_source_path" }),
          ]),
        }),
      ],
    });
    expect(drafts[1]?.chunks[0]).toMatchObject({
      symbolName: "controller",
      metadata: expect.objectContaining({
        summaryKind: "symbol",
        sourceSymbolName: "controller",
        sourceSymbolKind: "function",
      }),
      links: expect.arrayContaining([
        expect.objectContaining({ entityType: "symbol", linkReason: "summary_source_symbol" }),
      ]),
    });
  });

  it("syncs summary documents and updates the source document metadata", async () => {
    const createDocument = vi.fn()
      .mockResolvedValueOnce({ id: "code-summary-doc" })
      .mockResolvedValueOnce({ id: "symbol-summary-doc" });
    const deprecateSupersededDocuments = vi.fn().mockResolvedValue(1);
    const replaceDocumentChunks = vi.fn().mockImplementation(async ({ chunks }) => (
      chunks.map((chunk: Record<string, unknown>, index: number) => ({ id: `chunk-${index + 1}`, ...chunk }))
    ));
    const updateDocumentMetadata = vi.fn().mockResolvedValue(null);
    const recordDocumentVersion = vi.fn().mockResolvedValue(null);
    const generateEmbeddings = vi.fn().mockResolvedValue({
      embeddings: [[0.1, 0.2, 0.3], [0.3, 0.2, 0.1]],
      provider: "openai",
      model: "text-embedding-3-small",
      dimensions: 3,
      usage: { totalTokens: 42 },
    });

    const result = await syncKnowledgeSummaryDocuments({
      knowledge: {
        createDocument,
        deprecateSupersededDocuments,
        replaceDocumentChunks,
        updateDocumentMetadata,
        recordDocumentVersion,
      },
      embeddings: {
        generateEmbeddings,
      },
      sourceDocument: {
        id: "11111111-1111-1111-1111-111111111111",
        companyId: "company-1",
        projectId: "project-1",
        sourceType: "code",
        authorityLevel: "canonical",
        repoUrl: "https://example.com/repo.git",
        repoRef: "main",
        path: "src/runtime/controller.ts",
        title: "controller.ts",
        language: "typescript",
        rawContent: "export function controller() { return true; }",
        metadata: {
          importSource: "workspace",
          versionBranchName: "main",
          versionDefaultBranchName: "main",
          versionCommitSha: "abc123",
          versionParentCommitSha: "def456",
          versionCapturedAt: "2026-03-15T07:00:00.000Z",
          versionIsDefaultBranch: true,
        },
      },
      workspace: {
        id: "workspace-1",
        name: "Primary",
        cwd: "/workspace/runtime",
      },
      baseTags: ["swiftsight-cloud", "workflow"],
      codeChunks: [{
        chunkIndex: 0,
        symbolName: "controller",
        textContent: "export function controller() { return true; }",
        metadata: {},
      }],
      codeGraph: {
        symbols: [{
          chunkIndex: 0,
          symbolKey: "controller",
          symbolName: "controller",
          symbolKind: "function",
          metadata: { exported: true },
        }],
        edges: [],
        stats: {},
      },
      generatedAt: "2026-03-15T07:05:00.000Z",
    });

    expect(result).toEqual({
      sourceDocumentId: "11111111-1111-1111-1111-111111111111",
      createdDocuments: [
        { sourceType: "code_summary", documentId: "code-summary-doc", chunkCount: 1 },
        { sourceType: "symbol_summary", documentId: "symbol-summary-doc", chunkCount: 1 },
      ],
    });
    expect(createDocument.mock.calls.map((call) => call[0].sourceType)).toEqual(["code_summary", "symbol_summary"]);
    expect(deprecateSupersededDocuments).toHaveBeenCalledTimes(2);
    expect(replaceDocumentChunks).toHaveBeenNthCalledWith(1, expect.objectContaining({
      documentId: "code-summary-doc",
      chunks: [
        expect.objectContaining({
          embedding: [0.1, 0.2, 0.3],
        }),
      ],
    }));
    expect(updateDocumentMetadata).toHaveBeenLastCalledWith(
      "11111111-1111-1111-1111-111111111111",
      expect.objectContaining({
        summaryDocumentCount: 2,
        summarySourceTypes: ["code_summary", "symbol_summary"],
      }),
    );
    expect(recordDocumentVersion).toHaveBeenCalledTimes(2);
  });
});
