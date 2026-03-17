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

  it("includes symbol name tokens in ownerTags via CamelCase splitting", () => {
    // The camelCase splitter uses /([a-z])([A-Z])/ so it only splits on
    // lowercase→uppercase boundaries.  "WorkflowMatcher" → "Workflow_Matcher"
    // → ["workflow", "matcher"].  "DeliveryQueue" → "Delivery_Queue" → ["delivery", "queue"].
    // All-uppercase prefixes like "PACS" have no lowercase→uppercase boundary
    // and stay as one token, so we use a mixed-case symbol name instead.
    const drafts = buildKnowledgeSummaryDrafts({
      sourceDocumentId: "22222222-2222-2222-2222-222222222222",
      relativePath: "src/domain/workflow-matcher.ts",
      language: "typescript",
      sourceType: "code",
      baseTags: ["project-x"],
      codeChunks: [{
        chunkIndex: 0,
        symbolName: "WorkflowMatcher",
        textContent: "export class WorkflowMatcher {}",
        metadata: {},
      }],
      codeGraph: {
        symbols: [
          {
            symbolKey: "WorkflowMatcher",
            symbolName: "WorkflowMatcher",
            symbolKind: "class",
            startLine: 1,
            endLine: 5,
            metadata: { exported: true },
          },
          {
            symbolKey: "DeliveryQueue",
            symbolName: "DeliveryQueue",
            symbolKind: "class",
            startLine: 7,
            endLine: 12,
            metadata: { exported: true },
          },
        ],
        edges: [],
      },
    });

    const fileDraft = drafts.find((d) => d.metadata.summaryKind === "file");
    expect(fileDraft).toBeDefined();
    const ownerTags = fileDraft!.metadata.requiredKnowledgeTags;
    expect(ownerTags).toEqual(expect.arrayContaining(["workflow", "matcher"]));
    expect(ownerTags).toEqual(expect.arrayContaining(["delivery", "queue"]));
  });

  it("includes dependency target tokens in ownerTags", () => {
    const drafts = buildKnowledgeSummaryDrafts({
      sourceDocumentId: "33333333-3333-3333-3333-333333333333",
      relativePath: "src/services/handler.ts",
      language: "typescript",
      sourceType: "code",
      baseTags: ["core"],
      codeChunks: [{
        chunkIndex: 0,
        symbolName: "handler",
        textContent: "export function handler() {}",
        metadata: {},
      }],
      codeGraph: {
        symbols: [{
          symbolKey: "handler",
          symbolName: "handler",
          symbolKind: "function",
          startLine: 1,
          endLine: 1,
          metadata: { exported: true },
        }],
        edges: [
          {
            fromSymbolKey: "handler",
            targetSymbolName: "workflowService",
            edgeType: "calls",
          },
          {
            fromSymbolKey: "handler",
            targetSymbolName: "dicomParser",
            edgeType: "calls",
          },
        ],
      },
    });

    const fileDraft = drafts.find((d) => d.metadata.summaryKind === "file");
    expect(fileDraft).toBeDefined();
    const ownerTags = fileDraft!.metadata.requiredKnowledgeTags;
    expect(ownerTags).toEqual(expect.arrayContaining(["workflow"]));
    expect(ownerTags).toEqual(expect.arrayContaining(["service"]));
    expect(ownerTags).toEqual(expect.arrayContaining(["dicom"]));
    expect(ownerTags).toEqual(expect.arrayContaining(["parser"]));
  });

  it("includes semantic content hints from code comments for PM project selection", () => {
    const drafts = buildKnowledgeSummaryDrafts({
      sourceDocumentId: "77777777-7777-7777-7777-777777777777",
      relativePath: "internal/server/registry/series.go",
      language: "go",
      sourceType: "code",
      baseTags: ["swiftsight-cloud"],
      codeChunks: [{
        chunkIndex: 0,
        symbolName: "RegisterSeries",
        textContent: [
          "// RegisterSeries persists series_name in the registry database.",
          "// Siemens should prefer ProtocolName over SeriesDescription before persistence.",
          "func RegisterSeries() {}",
        ].join("\n"),
        metadata: {},
      }],
      codeGraph: {
        symbols: [{
          symbolKey: "RegisterSeries",
          symbolName: "RegisterSeries",
          symbolKind: "function",
          startLine: 1,
          endLine: 3,
          metadata: { exported: true },
        }],
        edges: [],
      },
    });

    const fileDraft = drafts.find((draft) => draft.metadata.summaryKind === "file");
    expect(fileDraft).toBeDefined();
    const ownerTags = fileDraft!.metadata.requiredKnowledgeTags;
    expect(ownerTags).toEqual(expect.arrayContaining(["series"]));
    expect(ownerTags).toEqual(expect.arrayContaining(["protocol"]));
    expect(ownerTags).toEqual(expect.arrayContaining(["description"]));
    expect(ownerTags).toEqual(expect.arrayContaining(["registry"]));
    expect(fileDraft!.rawContent).toContain("series_name");
    expect(fileDraft!.rawContent).toContain("ProtocolName");
    expect(fileDraft!.rawContent).toContain("SeriesDescription");
  });

  it("handles null/undefined symbolNames gracefully", () => {
    const drafts = buildKnowledgeSummaryDrafts({
      sourceDocumentId: "44444444-4444-4444-4444-444444444444",
      relativePath: "src/utils/safe-parse.ts",
      language: "typescript",
      sourceType: "code",
      baseTags: ["utils"],
      codeChunks: [{
        chunkIndex: 0,
        symbolName: "safeParse",
        textContent: "export function safeParse() {}",
        metadata: {},
      }],
      codeGraph: {
        symbols: [
          {
            symbolKey: "null-symbol",
            symbolName: null as unknown as string,
            symbolKind: "function",
            startLine: 1,
            endLine: 1,
          },
          {
            symbolKey: "undef-symbol",
            symbolName: undefined as unknown as string,
            symbolKind: "function",
            startLine: 2,
            endLine: 2,
          },
          {
            symbolKey: "ValidName",
            symbolName: "ValidName",
            symbolKind: "function",
            startLine: 3,
            endLine: 3,
            metadata: { exported: true },
          },
        ],
        edges: [],
      },
    });

    // Should not crash and should produce drafts
    expect(drafts.length).toBeGreaterThan(0);
    const fileDraft = drafts.find((d) => d.metadata.summaryKind === "file");
    expect(fileDraft).toBeDefined();
    const ownerTags = fileDraft!.metadata.requiredKnowledgeTags;
    expect(ownerTags).toEqual(expect.arrayContaining(["valid"]));
    expect(ownerTags).toEqual(expect.arrayContaining(["name"]));
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
