import { createHash } from "node:crypto";
import path from "node:path";
import type { KnowledgeSummaryMetadata, KnowledgeSummarySourceType } from "@squadrail/shared";

type SummarySourceChunk = {
  chunkIndex: number;
  symbolName: string | null;
  textContent: string;
  metadata: Record<string, unknown>;
};

type SummarySourceSymbol = {
  symbolKey: string;
  symbolName: string;
  symbolKind: string;
  startLine?: number | null;
  endLine?: number | null;
  metadata?: Record<string, unknown>;
};

type SummarySourceEdge = {
  fromSymbolKey: string;
  targetSymbolKey?: string | null;
  targetSymbolName?: string | null;
  targetPath?: string | null;
  edgeType: string;
};

type SummarySourceGraph = {
  symbols: SummarySourceSymbol[];
  edges: SummarySourceEdge[];
};

type KnowledgeSummaryDraftChunk = {
  chunkIndex: number;
  headingPath: string | null;
  symbolName: string | null;
  tokenCount: number;
  textContent: string;
  searchText: string;
  metadata: Record<string, unknown>;
  links: Array<{
    entityType: string;
    entityId: string;
    linkReason: string;
    weight?: number;
  }>;
};

export type KnowledgeSummaryDraft = {
  sourceType: KnowledgeSummarySourceType;
  title: string;
  path: string;
  rawContent: string;
  metadata: KnowledgeSummaryMetadata;
  chunks: KnowledgeSummaryDraftChunk[];
};

type SummarySyncCodeGraph = {
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

type SummarySyncKnowledgeApi = {
  createDocument: (input: {
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
  }) => Promise<{ id: string } | null>;
  deprecateSupersededDocuments: (input: {
    companyId: string;
    sourceType: string;
    path: string;
    projectId?: string | null;
    repoRef?: string | null;
    keepDocumentId: string;
    supersededByDocumentId: string;
  }) => Promise<number>;
  replaceDocumentChunks: (input: {
    companyId: string;
    documentId: string;
    chunks: Array<{
      chunkIndex: number;
      headingPath: string | null;
      symbolName: string | null;
      tokenCount: number;
      textContent: string;
      searchText: string;
      embedding: number[];
      metadata?: Record<string, unknown>;
      links?: Array<{
        entityType: string;
        entityId: string;
        linkReason: string;
        weight?: number;
      }>;
    }>;
    codeGraph?: SummarySyncCodeGraph | null;
  }) => Promise<Array<{ id: string }>>;
  updateDocumentMetadata: (documentId: string, metadata: Record<string, unknown>) => Promise<unknown>;
  recordDocumentVersion: (input: {
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
    capturedAt?: string | null;
    metadata?: Record<string, unknown>;
  }) => Promise<unknown>;
};

type SummarySyncEmbeddingApi = {
  generateEmbeddings: (texts: string[]) => Promise<{
    embeddings: number[][];
    provider: string;
    model: string;
    dimensions: number;
    usage: { totalTokens: number };
  }>;
};

export type SyncKnowledgeSummaryDocumentsInput = {
  knowledge: SummarySyncKnowledgeApi;
  embeddings: SummarySyncEmbeddingApi;
  sourceDocument: {
    id: string;
    companyId: string;
    projectId: string | null;
    sourceType: string;
    authorityLevel: string;
    repoUrl?: string | null;
    repoRef?: string | null;
    path: string | null;
    title?: string | null;
    language: string | null;
    rawContent: string;
    metadata?: Record<string, unknown> | null;
  };
  workspace?: {
    id?: string | null;
    name?: string | null;
    cwd?: string | null;
  } | null;
  baseTags?: string[];
  codeChunks: SummarySourceChunk[];
  codeGraph: SummarySourceGraph | null;
  generatedAt?: string;
};

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function estimateTokenCount(value: string) {
  return Math.max(1, Math.ceil(value.trim().length / 4));
}

function compactWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function truncateText(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function uniqueStrings(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    ordered.push(trimmed);
  }
  return ordered;
}

function readBoolean(value: unknown) {
  return value === true;
}

const PROJECT_SELECTION_CONTENT_STOPWORDS = new Set([
  "package",
  "import",
  "return",
  "returns",
  "true",
  "false",
  "const",
  "class",
  "type",
  "types",
  "interface",
  "struct",
  "string",
  "strings",
  "value",
  "values",
  "input",
  "inputs",
  "output",
  "outputs",
  "file",
  "files",
  "line",
  "lines",
  "located",
  "defines",
  "top",
  "level",
  "symbol",
  "symbols",
  "exported",
  "surface",
  "local",
  "code",
  "graph",
  "summary",
  "source",
  "path",
  "language",
  "function",
  "functions",
  "method",
  "methods",
  "helper",
  "helpers",
  "using",
  "used",
  "with",
  "without",
  "from",
  "into",
  "the",
  "this",
  "that",
  "these",
  "those",
  "should",
  "before",
  "over",
  "prefer",
  "none",
  "unknown",
  "detected",
  "strong",
  "associated",
  "dependency",
  "dependencies",
  "target",
  "targets",
  "context",
  "tags",
  "main",
  "base",
  "create",
  "created",
  "update",
  "updated",
  "build",
  "built",
  "persists",
  "list",
  "lists",
  "item",
  "items",
  "number",
  "numbers",
  "count",
  "counts",
]);

function splitSemanticTokens(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_./:-]+/g, " ")
    .split(/[^a-zA-Z0-9]+/)
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length >= 3 && token.length <= 32)
    .filter((token) => !/^\d+$/.test(token));
}

function extractProjectSelectionContentHints(values: string[]) {
  const counts = new Map<string, { count: number; firstSeen: number }>();
  let index = 0;
  for (const value of values) {
    for (const token of splitSemanticTokens(value)) {
      if (PROJECT_SELECTION_CONTENT_STOPWORDS.has(token)) continue;
      const existing = counts.get(token);
      if (existing) {
        existing.count += 1;
      } else {
        counts.set(token, { count: 1, firstSeen: index });
      }
      index += 1;
    }
  }

  return [...counts.entries()]
    .sort((left, right) => {
      if (left[1].count !== right[1].count) return right[1].count - left[1].count;
      return left[1].firstSeen - right[1].firstSeen;
    })
    .map(([token]) => token)
    .slice(0, 8);
}

function extractSemanticExcerpt(values: string[]) {
  for (const value of values) {
    const compact = compactWhitespace(value);
    if (compact.length < 24) continue;
    return truncateText(compact, 240);
  }
  return null;
}

function basenameWithoutExtension(filePath: string) {
  return path.posix.basename(filePath).replace(/\.[^.]+$/, "");
}

function formatList(items: string[], fallback: string) {
  if (items.length === 0) return fallback;
  return items.join(", ");
}

function deriveProjectSelectionTags(input: {
  baseTags: string[];
  relativePath: string;
  language: string;
  symbolNames?: string[];
  dependencyTargets?: string[];
  contentHints?: string[];
}) {
  const fileBase = basenameWithoutExtension(input.relativePath);
  const pathSegments = input.relativePath.split("/").filter(Boolean);
  const genericTags = new Set([
    "code",
    "test_report",
    "code_summary",
    input.language.toLowerCase(),
  ]);

  // Extract semantic tokens from symbol names (e.g. WorkflowMatcher → workflow, matcher)
  const symbolTokens = uniqueStrings(
    (input.symbolNames ?? []).filter(Boolean).flatMap((name) =>
      String(name).replace(/([a-z])([A-Z])/g, "$1_$2").split(/[^a-zA-Z0-9]+/).filter((t) => t.length >= 3),
    ).map((t) => t.toLowerCase()),
  );

  // Dependency targets provide cross-file domain signals
  const depTokens = uniqueStrings(
    (input.dependencyTargets ?? []).filter(Boolean).flatMap((name) =>
      String(name).replace(/([a-z])([A-Z])/g, "$1_$2").split(/[^a-zA-Z0-9]+/).filter((t) => t.length >= 3),
    ).map((t) => t.toLowerCase()),
  );

  const specificTags = uniqueStrings([
    ...input.baseTags.filter((tag) => !genericTags.has(tag.toLowerCase())),
    ...(input.contentHints ?? []),
    ...pathSegments.slice(0, 3),
    fileBase,
    ...symbolTokens.slice(0, 6),
    ...depTokens.slice(0, 4),
  ]);

  return {
    ownerTags: specificTags.slice(0, 10),
    supportTags: uniqueStrings([
      input.language,
      ...input.baseTags,
      ...specificTags,
      ...symbolTokens,
      ...depTokens,
    ]).slice(0, 16),
    avoidTags: [] as string[],
  };
}

function buildEdgeIndex(graph: SummarySourceGraph | null) {
  const map = new Map<string, SummarySourceEdge[]>();
  for (const edge of graph?.edges ?? []) {
    const bucket = map.get(edge.fromSymbolKey) ?? [];
    bucket.push(edge);
    map.set(edge.fromSymbolKey, bucket);
  }
  return map;
}

function summarizeDependencies(edges: SummarySourceEdge[]) {
  return uniqueStrings(edges.flatMap((edge) => [
    edge.targetSymbolName ?? null,
    edge.targetPath ? basenameWithoutExtension(edge.targetPath) : null,
  ])).slice(0, 6);
}

function buildCodeSummaryText(input: {
  relativePath: string;
  language: string;
  symbols: SummarySourceSymbol[];
  baseTags: string[];
  dependencyTargets: string[];
  contentHints: string[];
  semanticExcerpt?: string | null;
}) {
  const exportedSymbols = input.symbols
    .filter((symbol) => readBoolean(symbol.metadata?.exported))
    .map((symbol) => symbol.symbolName);
  const primarySymbols = input.symbols.slice(0, 6).map((symbol) => symbol.symbolName);

  return [
    `This ${input.language} file is located at ${input.relativePath}.`,
    `It defines ${input.symbols.length} top-level symbol(s): ${formatList(primarySymbols, "no named symbols detected")}.`,
    exportedSymbols.length > 0
      ? `Its exported surface is ${formatList(exportedSymbols.slice(0, 6), "not exposed")}.`
      : "No exported surface was detected from the parsed top-level symbols.",
    input.dependencyTargets.length > 0
      ? `The local code graph suggests dependencies on ${formatList(input.dependencyTargets, "unknown dependencies")}.`
      : "The local code graph did not surface strong dependency targets for this file.",
    input.contentHints.length > 0
      ? `Semantic hints from the implementation include ${formatList(input.contentHints, "none")}.`
      : null,
    input.semanticExcerpt
      ? `Representative implementation excerpt: ${input.semanticExcerpt}.`
      : null,
    `Context tags: ${formatList(input.baseTags.slice(0, 8), "none")}.`,
  ].filter((value): value is string => typeof value === "string" && value.length > 0).join(" ");
}

function buildSymbolSummaryText(input: {
  relativePath: string;
  symbol: SummarySourceSymbol;
  dependencyTargets: string[];
  baseTags: string[];
}) {
  const lineRange = input.symbol.startLine && input.symbol.endLine
    ? `lines ${input.symbol.startLine}-${input.symbol.endLine}`
    : "unknown line range";
  const exportedText = readBoolean(input.symbol.metadata?.exported) ? "It is exported." : "It is not exported.";

  return [
    `${input.symbol.symbolName} is a ${input.symbol.symbolKind} in ${input.relativePath} (${lineRange}).`,
    exportedText,
    input.dependencyTargets.length > 0
      ? `It is associated with ${formatList(input.dependencyTargets, "unknown dependencies")}.`
      : "No strong dependency targets were detected for this symbol from the local code graph.",
    `Context tags: ${formatList(input.baseTags.slice(0, 8), "none")}.`,
  ].join(" ");
}

export function buildKnowledgeSummaryDrafts(input: {
  sourceDocumentId: string;
  relativePath: string;
  language: string;
  title?: string | null;
  sourceType: string;
  baseTags?: string[];
  codeChunks: SummarySourceChunk[];
  codeGraph: SummarySourceGraph | null;
}): KnowledgeSummaryDraft[] {
  if (input.sourceType !== "code") return [];

  const baseTags = uniqueStrings([
    ...(input.baseTags ?? []),
    input.language,
    "code_summary",
    basenameWithoutExtension(input.relativePath),
  ]);
  const symbols = input.codeGraph?.symbols ?? [];
  const edgeIndex = buildEdgeIndex(input.codeGraph);
  const allDependencyTargets = summarizeDependencies(input.codeGraph?.edges ?? []);
  const contentHints = extractProjectSelectionContentHints([
    ...input.codeChunks.slice(0, 6).map((chunk) => chunk.textContent.slice(0, 800)),
    input.title ?? "",
  ]);
  const semanticExcerpt = extractSemanticExcerpt(
    input.codeChunks.slice(0, 3).map((chunk) => chunk.textContent.slice(0, 1200)),
  );
  const projectSelection = deriveProjectSelectionTags({
    baseTags,
    relativePath: input.relativePath,
    language: input.language,
    symbolNames: symbols.slice(0, 10).map((s) => s.symbolName),
    dependencyTargets: allDependencyTargets,
    contentHints,
  });
  const sharedMetadataBase = {
    summaryVersion: 1 as const,
    sourceDocumentId: input.sourceDocumentId,
    sourcePath: input.relativePath,
    sourceLanguage: input.language,
    tags: baseTags,
    requiredKnowledgeTags: projectSelection.ownerTags,
    pmProjectSelection: projectSelection,
  };

  const codeSummaryText = buildCodeSummaryText({
    relativePath: input.relativePath,
    language: input.language,
    symbols,
    baseTags,
    dependencyTargets: summarizeDependencies(input.codeGraph?.edges ?? []),
    contentHints,
    semanticExcerpt,
  });

  const drafts: KnowledgeSummaryDraft[] = [{
    sourceType: "code_summary",
    title: `${input.title ?? path.posix.basename(input.relativePath)} summary`,
    path: input.relativePath,
    rawContent: codeSummaryText,
    metadata: {
      ...sharedMetadataBase,
      summaryKind: "file",
    } satisfies KnowledgeSummaryMetadata,
    chunks: [{
      chunkIndex: 0,
      headingPath: input.relativePath,
      symbolName: null,
      tokenCount: estimateTokenCount(codeSummaryText),
      textContent: codeSummaryText,
      searchText: [
        input.relativePath,
        path.posix.basename(input.relativePath),
        ...baseTags,
        ...contentHints,
        ...(semanticExcerpt ? [semanticExcerpt] : []),
        ...symbols.slice(0, 8).map((symbol) => symbol.symbolName),
        codeSummaryText,
      ].filter(Boolean).join("\n"),
      metadata: {
        summaryVersion: 1,
        summaryKind: "file",
        sourcePath: input.relativePath,
        sourceLanguage: input.language,
        tags: baseTags,
      },
      links: [
        {
          entityType: "document",
          entityId: input.sourceDocumentId,
          linkReason: "summary_source_document",
          weight: 1,
        },
        {
          entityType: "path",
          entityId: input.relativePath,
          linkReason: "summary_source_path",
          weight: 1.15,
        },
      ],
    }],
  }];

  if (symbols.length > 0) {
    const symbolChunks = symbols.map((symbol, chunkIndex) => {
      const dependencyTargets = summarizeDependencies(edgeIndex.get(symbol.symbolKey) ?? []);
      const textContent = buildSymbolSummaryText({
        relativePath: input.relativePath,
        symbol,
        dependencyTargets,
        baseTags,
      });
      return {
        chunkIndex,
        headingPath: input.relativePath,
        symbolName: symbol.symbolName,
        tokenCount: estimateTokenCount(textContent),
        textContent,
        searchText: [
          input.relativePath,
          symbol.symbolName,
          symbol.symbolKind,
          ...dependencyTargets,
          ...baseTags,
          textContent,
        ].filter(Boolean).join("\n"),
        metadata: {
          summaryVersion: 1,
          summaryKind: "symbol",
          sourcePath: input.relativePath,
          sourceLanguage: input.language,
          sourceSymbolName: symbol.symbolName,
          sourceSymbolKind: symbol.symbolKind,
          lineStart: symbol.startLine ?? null,
          lineEnd: symbol.endLine ?? null,
          tags: uniqueStrings([...baseTags, symbol.symbolKind, symbol.symbolName]),
        },
        links: [
          {
            entityType: "document",
            entityId: input.sourceDocumentId,
            linkReason: "summary_source_document",
            weight: 1,
          },
          {
            entityType: "path",
            entityId: input.relativePath,
            linkReason: "summary_source_path",
            weight: 1.15,
          },
          {
            entityType: "symbol",
            entityId: symbol.symbolName,
            linkReason: "summary_source_symbol",
            weight: 1.2,
          },
        ],
      } satisfies KnowledgeSummaryDraftChunk;
    });

    drafts.push({
      sourceType: "symbol_summary",
      title: `${input.title ?? path.posix.basename(input.relativePath)} symbols`,
      path: input.relativePath,
      rawContent: symbolChunks.map((chunk) => chunk.textContent).join("\n\n"),
      metadata: {
        ...sharedMetadataBase,
        summaryKind: "symbol",
      } satisfies KnowledgeSummaryMetadata,
      chunks: symbolChunks,
    });
  }

  return drafts;
}

export async function syncKnowledgeSummaryDocuments(input: SyncKnowledgeSummaryDocumentsInput) {
  if (!input.sourceDocument.path || !input.sourceDocument.language) {
    return {
      sourceDocumentId: input.sourceDocument.id,
      createdDocuments: [] as Array<{ sourceType: KnowledgeSummarySourceType; documentId: string; chunkCount: number }>,
    };
  }

  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const drafts = buildKnowledgeSummaryDrafts({
    sourceDocumentId: input.sourceDocument.id,
    relativePath: input.sourceDocument.path,
    language: input.sourceDocument.language,
    title: input.sourceDocument.title,
    sourceType: input.sourceDocument.sourceType,
    baseTags: input.baseTags,
    codeChunks: input.codeChunks,
    codeGraph: input.codeGraph,
  });

  const createdDocuments: Array<{ sourceType: KnowledgeSummarySourceType; documentId: string; chunkCount: number }> = [];
  for (const draft of drafts) {
    const document = await input.knowledge.createDocument({
      companyId: input.sourceDocument.companyId,
      sourceType: draft.sourceType,
      authorityLevel: input.sourceDocument.authorityLevel,
      contentSha256: sha256(draft.rawContent),
      rawContent: draft.rawContent,
      repoUrl: input.sourceDocument.repoUrl ?? null,
      repoRef: input.sourceDocument.repoRef ?? null,
      projectId: input.sourceDocument.projectId,
      path: draft.path,
      title: draft.title,
      language: input.sourceDocument.language,
      metadata: {
        importSource: input.sourceDocument.metadata?.importSource ?? "workspace_summary",
        workspaceId: input.workspace?.id ?? null,
        workspaceName: input.workspace?.name ?? null,
        cwd: input.workspace?.cwd ?? null,
        versionBranchName: input.sourceDocument.metadata?.versionBranchName ?? null,
        versionDefaultBranchName: input.sourceDocument.metadata?.versionDefaultBranchName ?? null,
        versionCommitSha: input.sourceDocument.metadata?.versionCommitSha ?? null,
        versionParentCommitSha: input.sourceDocument.metadata?.versionParentCommitSha ?? null,
        versionCapturedAt: input.sourceDocument.metadata?.versionCapturedAt ?? generatedAt,
        versionIsDefaultBranch: input.sourceDocument.metadata?.versionIsDefaultBranch ?? false,
        sourceDocumentId: input.sourceDocument.id,
        isLatestForScope: true,
        ...draft.metadata,
      },
    });
    if (!document) continue;

    await input.knowledge.deprecateSupersededDocuments({
      companyId: input.sourceDocument.companyId,
      sourceType: draft.sourceType,
      path: draft.path,
      projectId: input.sourceDocument.projectId,
      repoRef: input.sourceDocument.repoRef ?? null,
      keepDocumentId: document.id,
      supersededByDocumentId: document.id,
    });

    const embeddingResult = await input.embeddings.generateEmbeddings(draft.chunks.map((chunk) => chunk.textContent));
    const replacedChunks = await input.knowledge.replaceDocumentChunks({
      companyId: input.sourceDocument.companyId,
      documentId: document.id,
      chunks: draft.chunks.map((chunk, index) => ({
        ...chunk,
        embedding: embeddingResult.embeddings[index]!,
        metadata: {
          ...chunk.metadata,
          embeddingProvider: embeddingResult.provider,
          embeddingModel: embeddingResult.model,
          embeddingDimensions: embeddingResult.dimensions,
          embeddingOrigin: "summary_import",
          embeddingGeneratedAt: generatedAt,
        },
      })),
    });

    await input.knowledge.updateDocumentMetadata(document.id, {
      importSource: input.sourceDocument.metadata?.importSource ?? "workspace_summary",
      workspaceId: input.workspace?.id ?? null,
      workspaceName: input.workspace?.name ?? null,
      cwd: input.workspace?.cwd ?? null,
      sourceDocumentId: input.sourceDocument.id,
      summarySyncedAt: generatedAt,
      embeddingProvider: embeddingResult.provider,
      embeddingModel: embeddingResult.model,
      embeddingDimensions: embeddingResult.dimensions,
      embeddingOrigin: "summary_import",
      embeddingGeneratedAt: generatedAt,
      embeddingChunkCount: replacedChunks.length,
      embeddingTotalTokens: embeddingResult.usage.totalTokens,
      isLatestForScope: true,
      ...draft.metadata,
    });
    await input.knowledge.recordDocumentVersion({
      companyId: input.sourceDocument.companyId,
      documentId: document.id,
      projectId: input.sourceDocument.projectId,
      path: draft.path,
      repoRef: input.sourceDocument.repoRef ?? null,
      branchName: String(input.sourceDocument.metadata?.versionBranchName ?? "") || null,
      defaultBranchName: String(input.sourceDocument.metadata?.versionDefaultBranchName ?? "") || null,
      commitSha: String(input.sourceDocument.metadata?.versionCommitSha ?? "") || null,
      parentCommitSha: String(input.sourceDocument.metadata?.versionParentCommitSha ?? "") || null,
      isHead: input.sourceDocument.metadata?.versionIsHead !== false,
      isDefaultBranch: input.sourceDocument.metadata?.versionIsDefaultBranch === true,
      capturedAt: String(input.sourceDocument.metadata?.versionCapturedAt ?? "") || generatedAt,
      metadata: {
        source: "summary_import",
        sourceDocumentId: input.sourceDocument.id,
        workspaceId: input.workspace?.id ?? null,
        workspaceName: input.workspace?.name ?? null,
      },
    });

    createdDocuments.push({
      sourceType: draft.sourceType,
      documentId: document.id,
      chunkCount: replacedChunks.length,
    });
  }

  if (createdDocuments.length > 0) {
    await input.knowledge.updateDocumentMetadata(input.sourceDocument.id, {
      summarySyncedAt: generatedAt,
      summaryDocumentCount: createdDocuments.length,
      summarySourceTypes: createdDocuments.map((entry) => entry.sourceType),
    });
  }

  return {
    sourceDocumentId: input.sourceDocument.id,
    createdDocuments,
  };
}
