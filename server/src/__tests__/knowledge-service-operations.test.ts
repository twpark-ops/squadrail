import {
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
}) {
  const selectRows = input.selectRows ?? new Map();
  const insertRows = input.insertRows ?? new Map();
  const updateRows = input.updateRows ?? new Map();
  const insertValues: Array<{ table: unknown; value: unknown }> = [];
  const updateSets: Array<{ table: unknown; value: unknown }> = [];

  const db = {
    select: () => createResolvedChain(selectRows),
    insert: (table: unknown) => ({
      values: (value: unknown) => {
        insertValues.push({ table, value });
        const chain = {
          onConflictDoUpdate: () => chain,
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
  };

  return {
    db,
    insertValues,
    updateSets,
  };
}

describe("knowledge service operations", () => {
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
