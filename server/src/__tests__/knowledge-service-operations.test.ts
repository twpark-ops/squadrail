import {
  knowledgeChunks,
  knowledgeChunkLinks,
  knowledgeDocumentVersions,
  knowledgeDocuments,
  projectKnowledgeRevisions,
  retrievalPolicies,
  retrievalRuns,
  retrievalCacheEntries,
} from "@squadrail/db";
import { describe, expect, it } from "vitest";
import { knowledgeService } from "../services/knowledge.js";

function shiftTableRows(queueMap: Map<unknown, unknown[][]>, table: unknown) {
  const queue = queueMap.get(table);
  return queue?.shift() ?? [];
}

function createResolvedChain(selectRows: Map<unknown, unknown[][]>) {
  let selectedTable: unknown = null;
  const chain = {
    from: (table: unknown) => {
      selectedTable = table;
      return chain;
    },
    where: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    groupBy: () => chain,
    innerJoin: () => chain,
    leftJoin: () => chain,
    then: <T>(resolve: (value: unknown[]) => T | PromiseLike<T>) =>
      Promise.resolve(shiftTableRows(selectRows, selectedTable)).then(resolve),
  };
  return chain;
}

function createKnowledgeDbMock(input: {
  selectRows?: Map<unknown, unknown[][]>;
  insertRows?: Map<unknown, unknown[][]>;
  updateRows?: Map<unknown, unknown[][]>;
  executeResults?: unknown[][];
}) {
  const selectRows = input.selectRows ?? new Map();
  const insertRows = input.insertRows ?? new Map();
  const updateRows = input.updateRows ?? new Map();
  const executeResults = [...(input.executeResults ?? [])];
  const insertValues: Array<{ table: unknown; value: unknown }> = [];
  const updateSets: Array<{ table: unknown; value: unknown }> = [];
  const conflictSets: Array<{ table: unknown; value: unknown }> = [];
  const deletedTables: unknown[] = [];
  const executeCalls: unknown[] = [];

  const db = {
    select: () => createResolvedChain(selectRows),
    insert: (table: unknown) => ({
      values: (value: unknown) => {
        insertValues.push({ table, value });
        const chain = {
          onConflictDoUpdate: (config: { set: unknown }) => {
            conflictSets.push({ table, value: config.set });
            return chain;
          },
          onConflictDoNothing: () => chain,
          returning: async () => shiftTableRows(insertRows, table),
          then: <T>(resolve: (value: unknown[]) => T | PromiseLike<T>) =>
            Promise.resolve([]).then(resolve),
        };
        return chain;
      },
    }),
    update: (table: unknown) => ({
      set: (value: unknown) => {
        updateSets.push({ table, value });
        const chain = {
          where: () => chain,
          returning: async () => shiftTableRows(updateRows, table),
          then: <T>(resolve: (value: unknown[]) => T | PromiseLike<T>) =>
            Promise.resolve([]).then(resolve),
        };
        return chain;
      },
    }),
    delete: (table: unknown) => ({
      where: async () => {
        deletedTables.push(table);
        return [];
      },
    }),
    transaction: async <T>(callback: (tx: typeof db) => Promise<T>) => callback(db),
    execute: async (value: unknown) => {
      executeCalls.push(value);
      return executeResults.shift() ?? [];
    },
  };

  return {
    db,
    insertValues,
    updateSets,
    conflictSets,
    deletedTables,
    executeCalls,
  };
}

describe("knowledge service operations", () => {
  it("falls back to the existing document when createDocument hits a uniqueness conflict", async () => {
    const existing = {
      id: "doc-existing",
      companyId: "company-1",
      sourceType: "issue_snapshot",
      contentSha256: "sha-1",
      repoUrl: "https://github.com/acme/app",
      repoRef: "github.com/acme/app",
      path: "src/retry.ts",
    };
    const { db, insertValues } = createKnowledgeDbMock({
      selectRows: new Map([
        [knowledgeDocuments, [[existing]]],
      ]),
      insertRows: new Map([
        [knowledgeDocuments, [[]]],
      ]),
    });
    const service = knowledgeService(db as never);

    const result = await service.createDocument({
      companyId: "company-1",
      sourceType: "issue_snapshot",
      authorityLevel: "canonical",
      contentSha256: "sha-1",
      rawContent: "snapshot",
      repoUrl: "https://github.com/acme/app",
      repoRef: "github.com/acme/app",
      path: "src/retry.ts",
    });

    expect(result).toEqual(existing);
    expect(insertValues[0]?.value).toMatchObject({
      companyId: "company-1",
      sourceType: "issue_snapshot",
      authorityLevel: "canonical",
      contentSha256: "sha-1",
      path: "src/retry.ts",
    });
  });

  it("records a new document version and clears prior head markers for the same branch path", async () => {
    const { db, insertValues, updateSets } = createKnowledgeDbMock({
      selectRows: new Map([
        [knowledgeDocuments, [[{
          id: "doc-1",
          companyId: "company-1",
          projectId: "project-1",
          path: "src/retry.ts",
          repoRef: "github.com/acme/app",
        }]]],
        [knowledgeDocumentVersions, [[]]],
      ]),
      insertRows: new Map([
        [knowledgeDocumentVersions, [[{
          id: "version-1",
          documentId: "doc-1",
          branchName: "main",
          commitSha: "abc123",
        }]]],
      ]),
    });
    const service = knowledgeService(db as never);

    const result = await service.recordDocumentVersion({
      companyId: "company-1",
      documentId: "doc-1",
      branchName: " main ",
      defaultBranchName: " trunk ",
      commitSha: " abc123 ",
      parentCommitSha: " def456 ",
      metadata: { source: "sync" },
    });

    expect(result).toMatchObject({
      id: "version-1",
      branchName: "main",
      commitSha: "abc123",
    });
    expect(updateSets[0]?.value).toMatchObject({
      isHead: false,
    });
    expect(insertValues[0]?.value).toMatchObject({
      companyId: "company-1",
      documentId: "doc-1",
      projectId: "project-1",
      path: "src/retry.ts",
      repoRef: "github.com/acme/app",
      branchName: "main",
      defaultBranchName: "trunk",
      commitSha: "abc123",
      parentCommitSha: "def456",
      isHead: true,
      metadata: { source: "sync" },
    });
  });

  it("updates an existing document version when the coordinates already exist", async () => {
    const { db, updateSets } = createKnowledgeDbMock({
      selectRows: new Map([
        [knowledgeDocuments, [[{
          id: "doc-1",
          companyId: "company-1",
          projectId: "project-1",
          path: "src/retry.ts",
          repoRef: "github.com/acme/app",
        }]]],
        [knowledgeDocumentVersions, [[{
          id: "version-1",
          companyId: "company-1",
          documentId: "doc-1",
          branchName: "main",
          commitSha: "abc123",
        }]]],
      ]),
      updateRows: new Map([
        [knowledgeDocumentVersions, [[{
          id: "version-1",
          branchName: "main",
          commitSha: "abc123",
          metadata: { source: "refresh" },
        }]]],
      ]),
    });
    const service = knowledgeService(db as never);

    const result = await service.recordDocumentVersion({
      companyId: "company-1",
      documentId: "doc-1",
      branchName: "main",
      commitSha: "abc123",
      metadata: { source: "refresh" },
    });

    expect(result).toMatchObject({
      id: "version-1",
      metadata: { source: "refresh" },
    });
    expect(updateSets[1]?.value).toMatchObject({
      companyId: "company-1",
      documentId: "doc-1",
      branchName: "main",
      commitSha: "abc123",
      metadata: { source: "refresh" },
    });
  });

  it("increments cache hit counts when a retrieval cache entry is reused", async () => {
    const { db, updateSets } = createKnowledgeDbMock({
      selectRows: new Map([
        [retrievalCacheEntries, [[{
          id: "cache-1",
          companyId: "company-1",
          stage: "candidate_hits",
          cacheKey: "cache-a",
          knowledgeRevision: 7,
          hitCount: 3,
          expiresAt: null,
          valueJson: {},
        }]]],
      ]),
      updateRows: new Map([
        [retrievalCacheEntries, [[{
          id: "cache-1",
          hitCount: 4,
        }]]],
      ]),
    });
    const service = knowledgeService(db as never);

    const result = await service.getRetrievalCacheEntry({
      companyId: "company-1",
      stage: "candidate_hits",
      cacheKey: "cache-a",
      knowledgeRevision: 7,
    });

    expect(result).toMatchObject({
      id: "cache-1",
      hitCount: 4,
    });
    expect(updateSets[0]?.value).toMatchObject({
      hitCount: 4,
    });
  });

  it("builds the knowledge overview with active project counts and distributions", async () => {
    const { db, executeCalls } = createKnowledgeDbMock({
      executeResults: [
        [{
          totalDocuments: 2,
          totalChunks: 5,
          totalLinks: 4,
          linkedChunks: 3,
          connectedDocuments: 2,
          totalSymbols: 1,
          totalSymbolEdges: 1,
          totalDocumentVersions: 2,
        }],
        [
          {
            projectId: "project-1",
            projectName: "Runtime",
            documentCount: 2,
            chunkCount: 5,
            linkCount: 4,
            lastUpdatedAt: "2026-03-13T00:00:00.000Z",
          },
          {
            projectId: "project-2",
            projectName: "Idle",
            documentCount: 0,
            chunkCount: 0,
            linkCount: 0,
            lastUpdatedAt: null,
          },
        ],
        [{ key: "code", count: 2 }],
        [{ key: "canonical", count: 2 }],
        [{ key: "ts", count: 2 }],
        [{ key: "issue", count: 4 }],
      ],
    });
    const service = knowledgeService(db as never);

    const overview = await service.getOverview({
      companyId: "company-1",
    });

    expect(overview).toMatchObject({
      totalDocuments: 2,
      totalChunks: 5,
      totalLinks: 4,
      activeProjects: 1,
      sourceTypeDistribution: [{ key: "code", count: 2 }],
      authorityDistribution: [{ key: "canonical", count: 2 }],
      languageDistribution: [{ key: "ts", count: 2 }],
      linkEntityDistribution: [{ key: "issue", count: 4 }],
    });
    expect(overview.projectCoverage).toEqual([
      expect.objectContaining({
        projectId: "project-1",
        documentCount: 2,
      }),
      expect.objectContaining({
        projectId: "project-2",
        documentCount: 0,
      }),
    ]);
    expect(executeCalls).toHaveLength(6);
  });

  it("builds a graph slice from document and entity edge rows", async () => {
    const { db } = createKnowledgeDbMock({
      selectRows: new Map([
        [knowledgeChunkLinks, [[
          {
            documentId: "doc-1",
            entityType: "symbol",
            entityId: "retryWorker",
            weight: 3,
          },
        ]]],
      ]),
      executeResults: [[
        {
          documentId: "doc-1",
          projectId: "project-1",
          projectName: "Runtime",
          title: "retry.ts",
          path: "src/retry.ts",
          sourceType: "code",
          authorityLevel: "canonical",
          language: "ts",
          chunkCount: 2,
          linkCount: 3,
        },
      ]],
    });
    const service = knowledgeService(db as never);

    const graph = await service.getGraph({
      companyId: "company-1",
      projectId: "project-1",
    });

    expect(graph.summary).toEqual({
      projectNodeCount: 1,
      documentNodeCount: 1,
      entityNodeCount: 1,
      edgeCount: 2,
    });
    expect(graph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "project:project-1",
        label: "Runtime",
      }),
      expect.objectContaining({
        id: "document:doc-1",
        label: "retry.ts",
      }),
      expect.objectContaining({
        id: "entity:symbol:retryWorker",
        label: "retryWorker",
      }),
    ]));
  });

  it("hydrates chunk links alongside the chunk list for a document", async () => {
    const { db } = createKnowledgeDbMock({
      selectRows: new Map([
        [knowledgeChunks, [[
          {
            id: "chunk-1",
            documentId: "doc-1",
            chunkIndex: 0,
            textContent: "retry worker",
          },
          {
            id: "chunk-2",
            documentId: "doc-1",
            chunkIndex: 1,
            textContent: "backoff logic",
          },
        ]]],
        [knowledgeChunkLinks, [[
          {
            chunkId: "chunk-1",
            entityType: "issue",
            entityId: "issue-1",
            linkReason: "related_context",
            weight: 2,
          },
        ]]],
      ]),
    });
    const service = knowledgeService(db as never);

    const chunks = await service.listDocumentChunksWithLinks("doc-1");

    expect(chunks).toEqual([
      expect.objectContaining({
        id: "chunk-1",
        links: [
          {
            entityType: "issue",
            entityId: "issue-1",
            linkReason: "related_context",
            weight: 2,
          },
        ],
      }),
      expect.objectContaining({
        id: "chunk-2",
        links: [],
      }),
    ]);
  });

  it("bumps project knowledge revisions while merging prior metadata", async () => {
    const { db, updateSets } = createKnowledgeDbMock({
      selectRows: new Map([
        [projectKnowledgeRevisions, [[{
          id: "rev-1",
          companyId: "company-1",
          projectId: "project-1",
          revision: 4,
          lastHeadSha: "old-head",
          lastTreeSignature: "old-tree",
          lastImportMode: "bootstrap",
          metadata: {
            source: "previous",
          },
        }]]],
      ]),
      updateRows: new Map([
        [projectKnowledgeRevisions, [[{
          id: "rev-1",
          revision: 5,
          lastHeadSha: "new-head",
          metadata: {
            source: "sync",
            actor: "test",
          },
        }]]],
      ]),
    });
    const service = knowledgeService(db as never);

    const result = await service.touchProjectKnowledgeRevision({
      companyId: "company-1",
      projectId: "project-1",
      bump: true,
      headSha: "new-head",
      metadata: {
        source: "sync",
        actor: "test",
      },
    });

    expect(result).toMatchObject({
      id: "rev-1",
      revision: 5,
      lastHeadSha: "new-head",
      metadata: {
        source: "sync",
        actor: "test",
      },
    });
    expect(updateSets[0]?.value).toMatchObject({
      revision: 5,
      lastHeadSha: "new-head",
      lastTreeSignature: "old-tree",
      lastImportMode: "bootstrap",
      metadata: {
        source: "sync",
        actor: "test",
      },
    });
  });

  it("returns early when replaceDocumentChunks receives no chunks", async () => {
    const { db, deletedTables, insertValues } = createKnowledgeDbMock({
      selectRows: new Map([
        [knowledgeDocuments, [[{
          id: "doc-1",
          projectId: "project-1",
          path: "src/retry.ts",
          language: "typescript",
        }]]],
      ]),
    });
    const service = knowledgeService(db as never);

    const result = await service.replaceDocumentChunks({
      companyId: "company-1",
      documentId: "doc-1",
      chunks: [],
    });

    expect(result).toEqual([]);
    expect(deletedTables).toEqual([knowledgeChunks]);
    expect(insertValues).toEqual([]);
  });

  it("replaces populated document chunks, writes links, and skips vector sync when pgvector is unavailable", async () => {
    const { db, deletedTables, insertValues, executeCalls } = createKnowledgeDbMock({
      selectRows: new Map([
        [knowledgeDocuments, [[{
          id: "doc-1",
          projectId: "project-1",
          path: "src/retry.ts",
          language: "typescript",
        }]]],
      ]),
      insertRows: new Map([
        [knowledgeChunks, [[{
          id: "chunk-1",
          documentId: "doc-1",
          chunkIndex: 0,
        }]]],
      ]),
      executeResults: [[{ installed: false }]],
    });
    const service = knowledgeService(db as never);

    const inserted = await service.replaceDocumentChunks({
      companyId: "company-1",
      documentId: "doc-1",
      codeGraph: null,
      chunks: [{
        chunkIndex: 0,
        tokenCount: 42,
        textContent: "retry worker handles backoff",
        embedding: [0.1, 0.2],
        links: [{
          entityType: "issue",
          entityId: "issue-1",
          linkReason: "related_issue",
        }],
      }],
    });

    expect(inserted).toEqual([{
      id: "chunk-1",
      documentId: "doc-1",
      chunkIndex: 0,
    }]);
    expect(deletedTables).toEqual([knowledgeChunks]);
    expect(insertValues.find((entry) => entry.table === knowledgeChunks)?.value).toMatchObject([{
      companyId: "company-1",
      documentId: "doc-1",
      chunkIndex: 0,
      tokenCount: 42,
      textContent: "retry worker handles backoff",
      embedding: [0.1, 0.2],
    }]);
    expect(insertValues.find((entry) => entry.table === knowledgeChunkLinks)?.value).toEqual([{
      companyId: "company-1",
      chunkId: "chunk-1",
      entityType: "issue",
      entityId: "issue-1",
      linkReason: "related_issue",
      weight: 1,
    }]);
    expect(executeCalls).toHaveLength(1);
  });

  it("deprecates matching documents by path and merges metadata for each update", async () => {
    const { db, updateSets } = createKnowledgeDbMock({
      selectRows: new Map([
        [knowledgeDocuments, [[
          {
            id: "doc-1",
            metadata: { existing: true },
          },
          {
            id: "doc-2",
            metadata: {},
          },
        ]]],
      ]),
      updateRows: new Map([
        [knowledgeDocuments, [[{ id: "doc-1" }], [{ id: "doc-2" }]]],
      ]),
    });
    const service = knowledgeService(db as never);

    const updated = await service.deprecateDocumentsByPaths({
      companyId: "company-1",
      projectId: "project-1",
      repoRef: "github.com/acme/app",
      paths: ["src/retry.ts", "src/retry.ts", "src/retry_test.ts"],
      reason: "bootstrap_removed",
      metadata: { source: "sync" },
    });

    expect(updated).toBe(2);
    expect(updateSets[0]?.value).toMatchObject({
      authorityLevel: "deprecated",
      metadata: {
        existing: true,
        source: "sync",
        deprecatedReason: "bootstrap_removed",
        isLatestForScope: false,
      },
    });
    expect(updateSets[1]?.value).toMatchObject({
      authorityLevel: "deprecated",
      metadata: {
        source: "sync",
        deprecatedReason: "bootstrap_removed",
        isLatestForScope: false,
      },
    });
  });

  it("deprecates superseded documents while preserving the replacement id in metadata", async () => {
    const { db, updateSets } = createKnowledgeDbMock({
      selectRows: new Map([
        [knowledgeDocuments, [[{
          id: "doc-old-1",
          metadata: { importedBy: "nightly" },
        }]]],
      ]),
      updateRows: new Map([
        [knowledgeDocuments, [[{ id: "doc-old-1" }]]],
      ]),
    });
    const service = knowledgeService(db as never);

    const updated = await service.deprecateSupersededDocuments({
      companyId: "company-1",
      sourceType: "code",
      path: "src/retry.ts",
      projectId: "project-1",
      repoRef: "github.com/acme/app",
      keepDocumentId: "doc-new-1",
      supersededByDocumentId: "doc-new-1",
    });

    expect(updated).toBe(1);
    expect(updateSets[0]?.value).toMatchObject({
      authorityLevel: "deprecated",
      metadata: {
        importedBy: "nightly",
        supersededByDocumentId: "doc-new-1",
        isLatestForScope: false,
      },
    });
  });

  it("returns project revisions only when at least one project id remains after deduplication", async () => {
    const { db } = createKnowledgeDbMock({
      selectRows: new Map([
        [projectKnowledgeRevisions, [[{
          id: "rev-1",
          projectId: "project-1",
          revision: 3,
        }]]],
      ]),
    });
    const service = knowledgeService(db as never);

    await expect(
      service.listProjectKnowledgeRevisions({
        companyId: "company-1",
        projectIds: [],
      }),
    ).resolves.toEqual([]);

    await expect(
      service.listProjectKnowledgeRevisions({
        companyId: "company-1",
        projectIds: ["project-1", "", "project-1"],
      }),
    ).resolves.toEqual([
      {
        id: "rev-1",
        projectId: "project-1",
        revision: 3,
      },
    ]);
  });

  it("upserts retrieval policies with normalized defaults and update sets", async () => {
    const { db, insertValues, conflictSets } = createKnowledgeDbMock({
      insertRows: new Map([
        [retrievalPolicies, [[{
          id: "policy-1",
          companyId: "company-1",
          role: "engineer",
          eventType: "on_assignment",
          workflowState: "assigned",
        }]]],
      ]),
    });
    const service = knowledgeService(db as never);

    const policy = await service.upsertRetrievalPolicy({
      companyId: "company-1",
      role: "engineer",
      eventType: "on_assignment",
      workflowState: "assigned",
      allowedSourceTypes: ["code", "review"],
      allowedAuthorityLevels: ["canonical", "working"],
      metadata: {
        rationale: "favor implementation evidence",
      },
    });

    expect(policy).toMatchObject({
      id: "policy-1",
      companyId: "company-1",
      role: "engineer",
      eventType: "on_assignment",
      workflowState: "assigned",
    });
    expect(insertValues.find((entry) => entry.table === retrievalPolicies)?.value).toMatchObject({
      topKDense: 20,
      topKSparse: 20,
      rerankK: 20,
      finalK: 8,
      allowedSourceTypes: ["code", "review"],
      allowedAuthorityLevels: ["canonical", "working"],
    });
    expect(conflictSets.find((entry) => entry.table === retrievalPolicies)?.value).toMatchObject({
      topKDense: 20,
      topKSparse: 20,
      rerankK: 20,
      finalK: 8,
      updatedAt: expect.any(Date),
    });
  });

  it("links retrieval runs to briefs and merges debug patches", async () => {
    const { db, updateSets } = createKnowledgeDbMock({
      selectRows: new Map([
        [retrievalRuns, [[{
          queryDebug: {
            quality: {
              confidenceLevel: "medium",
            },
            cache: {
              candidateHit: false,
            },
          },
        }]]],
      ]),
      updateRows: new Map([
        [retrievalRuns, [[{
          id: "retrieval-1",
          finalBriefId: "brief-1",
        }], [{
          id: "retrieval-1",
          queryDebug: {
            quality: {
              confidenceLevel: "medium",
            },
            cache: {
              candidateHit: true,
            },
          },
        }]]],
      ]),
    });
    const service = knowledgeService(db as never);

    const linked = await service.linkRetrievalRunToBrief("retrieval-1", "brief-1");
    const patched = await service.updateRetrievalRunDebug("retrieval-1", {
      cache: {
        candidateHit: true,
      },
    });

    expect(linked).toMatchObject({
      id: "retrieval-1",
      finalBriefId: "brief-1",
    });
    expect(patched).toMatchObject({
      id: "retrieval-1",
      queryDebug: {
        quality: {
          confidenceLevel: "medium",
        },
        cache: {
          candidateHit: true,
        },
      },
    });
    expect(updateSets[0]).toEqual({
      table: retrievalRuns,
      value: {
        finalBriefId: "brief-1",
      },
    });
    expect(updateSets[1]).toEqual({
      table: retrievalRuns,
      value: {
        queryDebug: {
          quality: {
            confidenceLevel: "medium",
          },
          cache: {
            candidateHit: true,
          },
        },
      },
    });
  });

  it("returns documents and retrieval policy reads through direct service helpers", async () => {
    const document = {
      id: "doc-1",
      companyId: "company-1",
      projectId: "project-1",
      sourceType: "code",
      path: "server/src/runtime.ts",
      updatedAt: new Date("2026-03-13T09:00:00.000Z"),
    };
    const policy = {
      id: "policy-1",
      companyId: "company-1",
      role: "engineer",
      eventType: "on_assignment",
      workflowState: "assigned",
      allowedSourceTypes: ["code"],
      allowedAuthorityLevels: ["canonical"],
      updatedAt: new Date("2026-03-13T09:00:00.000Z"),
    };
    const { db } = createKnowledgeDbMock({
      selectRows: new Map([
        [knowledgeDocuments, [[document], [document]]],
        [retrievalPolicies, [[policy], [policy]]],
      ]),
    });
    const service = knowledgeService(db as never);

    const byId = await service.getDocumentById("doc-1");
    const listed = await service.listDocuments({
      companyId: "company-1",
      projectId: "project-1",
      sourceType: "code",
      limit: 10,
    });
    const foundPolicy = await service.getRetrievalPolicy({
      companyId: "company-1",
      role: "engineer",
      eventType: "on_assignment",
      workflowState: "assigned",
    });
    const policies = await service.listRetrievalPolicies({
      companyId: "company-1",
      role: "engineer",
      limit: 10,
    });

    expect(byId).toEqual(document);
    expect(listed).toEqual([document]);
    expect(foundPolicy).toEqual(policy);
    expect(policies).toEqual([policy]);
  });

  it("returns retrieval runs by id without mutating the record", async () => {
    const retrievalRun = {
      id: "retrieval-1",
      companyId: "company-1",
      actorType: "agent",
      actorId: "eng-1",
      actorRole: "engineer",
      eventType: "on_assignment",
      workflowState: "assigned",
      queryText: "find retry worker",
      queryDebug: {
        quality: {
          confidenceLevel: "high",
        },
      },
      createdAt: new Date("2026-03-13T09:30:00.000Z"),
    };
    const { db } = createKnowledgeDbMock({
      selectRows: new Map([
        [retrievalRuns, [[retrievalRun]]],
      ]),
    });
    const service = knowledgeService(db as never);

    const found = await service.getRetrievalRunById("retrieval-1");

    expect(found).toEqual(retrievalRun);
  });
});
