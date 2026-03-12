import {
  knowledgeChunks,
  knowledgeChunkLinks,
  knowledgeDocumentVersions,
  knowledgeDocuments,
  projectKnowledgeRevisions,
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
  const deletedTables: unknown[] = [];
  const executeCalls: unknown[] = [];

  const db = {
    select: () => createResolvedChain(selectRows),
    insert: (table: unknown) => ({
      values: (value: unknown) => {
        insertValues.push({ table, value });
        const chain = {
          onConflictDoUpdate: () => chain,
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
});
