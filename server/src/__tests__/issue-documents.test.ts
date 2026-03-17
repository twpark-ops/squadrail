import { describe, expect, it, vi } from "vitest";
import { createIssueDocumentService } from "../services/issue-documents.js";

// ---------------------------------------------------------------------------
// Helpers – lightweight DB mock that mirrors the drizzle query-builder chain
// ---------------------------------------------------------------------------

function createResolvedChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    returning: async () => rows,
    then: <T>(resolve: (v: unknown[]) => T | PromiseLike<T>) =>
      Promise.resolve(rows).then(resolve),
  };
  return chain;
}

function createMutationResult(rows: unknown[]) {
  return {
    values: () => ({
      returning: async () => rows,
      then: <T>(resolve: (v: unknown[]) => T | PromiseLike<T>) =>
        Promise.resolve(rows).then(resolve),
    }),
    set: () => ({
      where: () => ({
        returning: async () => rows,
        then: <T>(resolve: (v: unknown[]) => T | PromiseLike<T>) =>
          Promise.resolve(rows).then(resolve),
      }),
    }),
    where: () => ({
      returning: async () => rows,
      then: <T>(resolve: (v: unknown[]) => T | PromiseLike<T>) =>
        Promise.resolve(rows).then(resolve),
    }),
  };
}

function makeDocRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "doc-1",
    issueId: "issue-1",
    companyId: "company-1",
    key: "plan",
    title: "Plan",
    format: "markdown",
    body: "# Plan\nSome content",
    revisionNumber: 1,
    createdByAgentId: null,
    createdByUserId: "user-1",
    createdAt: new Date("2026-03-15T10:00:00Z"),
    updatedAt: new Date("2026-03-15T10:00:00Z"),
    ...overrides,
  };
}

function makeRevisionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "rev-1",
    documentId: "doc-1",
    revisionNumber: 1,
    title: "Plan",
    body: "# Plan\nSome content",
    createdByAgentId: null,
    createdByUserId: "user-1",
    createdAt: new Date("2026-03-15T10:00:00Z"),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("issue-documents service", () => {
  it("listDocuments returns empty array for issue with no documents", async () => {
    const db = {
      select: () => createResolvedChain([]),
    } as never;

    const svc = createIssueDocumentService(db);
    const result = await svc.listDocuments("issue-no-docs");

    expect(result).toEqual([]);
  });

  it("upsertDocument creates a new document with revision 1", async () => {
    const createdRow = makeDocRow({ revisionNumber: 1 });
    const insertedRevision = makeRevisionRow();

    // Transaction mock: first select returns [] (no existing), then insert
    const txSelectQueue: unknown[][] = [[]]; // no existing doc
    const txInsertQueue: unknown[][] = [[createdRow], [insertedRevision]];

    const tx = {
      select: () => {
        const rows = txSelectQueue.shift() ?? [];
        return createResolvedChain(rows);
      },
      insert: () => ({
        values: () => ({
          returning: async () => txInsertQueue.shift() ?? [],
        }),
      }),
    };

    const db = {
      transaction: async <T>(cb: (tx: typeof tx) => Promise<T>) => cb(tx),
    } as never;

    const svc = createIssueDocumentService(db);
    const result = await svc.upsertDocument({
      issueId: "issue-1",
      companyId: "company-1",
      key: "plan",
      title: "Plan",
      body: "# Plan\nSome content",
      authorUserId: "user-1",
    });

    expect(result.revisionNumber).toBe(1);
    expect(result.key).toBe("plan");
    expect(result.title).toBe("Plan");
    expect(result.body).toBe("# Plan\nSome content");
  });

  it("upsertDocument with matching baseRevisionNumber creates revision 2", async () => {
    const existingRow = makeDocRow({ revisionNumber: 1 });
    const updatedRow = makeDocRow({ revisionNumber: 2, body: "Updated body" });
    const newRevision = makeRevisionRow({ revisionNumber: 2, body: "Updated body" });

    const txSelectQueue: unknown[][] = [[existingRow]];
    const txInsertQueue: unknown[][] = [[newRevision]];
    const txUpdateQueue: unknown[][] = [[updatedRow]];

    const tx = {
      select: () => {
        const rows = txSelectQueue.shift() ?? [];
        return createResolvedChain(rows);
      },
      insert: () => ({
        values: () => ({
          returning: async () => txInsertQueue.shift() ?? [],
        }),
      }),
      update: () => ({
        set: () => ({
          where: () => ({
            returning: async () => txUpdateQueue.shift() ?? [],
          }),
        }),
      }),
    };

    const db = {
      transaction: async <T>(cb: (tx: typeof tx) => Promise<T>) => cb(tx),
    } as never;

    const svc = createIssueDocumentService(db);
    const result = await svc.upsertDocument({
      issueId: "issue-1",
      companyId: "company-1",
      key: "plan",
      body: "Updated body",
      baseRevisionNumber: 1,
      authorUserId: "user-1",
    });

    expect(result.revisionNumber).toBe(2);
    expect(result.body).toBe("Updated body");
  });

  it("upsertDocument with stale baseRevisionNumber throws 409-like error", async () => {
    const existingRow = makeDocRow({ revisionNumber: 3 });

    const tx = {
      select: () => createResolvedChain([existingRow]),
    };

    const db = {
      transaction: async <T>(cb: (tx: typeof tx) => Promise<T>) => cb(tx),
    } as never;

    const svc = createIssueDocumentService(db);

    await expect(
      svc.upsertDocument({
        issueId: "issue-1",
        companyId: "company-1",
        key: "plan",
        body: "Stale update",
        baseRevisionNumber: 1,
        authorUserId: "user-1",
      }),
    ).rejects.toThrow(/modified/i);
  });

  it("deleteDocument removes the document", async () => {
    const deletedRow = makeDocRow();
    const deleteFn = vi.fn(() => ({
      where: () => ({
        returning: async () => [deletedRow],
      }),
    }));

    const db = {
      delete: deleteFn,
    } as never;

    const svc = createIssueDocumentService(db);
    await expect(svc.deleteDocument("issue-1", "plan")).resolves.toBeUndefined();
    expect(deleteFn).toHaveBeenCalled();
  });

  it("listRevisions returns all revisions ordered by number", async () => {
    const docId = "doc-1";
    const rev1 = makeRevisionRow({ id: "rev-1", documentId: docId, revisionNumber: 1 });
    const rev2 = makeRevisionRow({ id: "rev-2", documentId: docId, revisionNumber: 2, body: "v2" });
    const rev3 = makeRevisionRow({ id: "rev-3", documentId: docId, revisionNumber: 3, body: "v3" });

    // First call: select document id; Second call: select revisions
    const selectQueue: unknown[][] = [
      [{ id: docId }],
      [rev3, rev2, rev1], // newest first
    ];

    const db = {
      select: () => {
        const rows = selectQueue.shift() ?? [];
        return createResolvedChain(rows);
      },
    } as never;

    const svc = createIssueDocumentService(db);
    const result = await svc.listRevisions("issue-1", "plan");

    expect(result).toHaveLength(3);
    expect(result[0].revisionNumber).toBe(3);
    expect(result[1].revisionNumber).toBe(2);
    expect(result[2].revisionNumber).toBe(1);
  });

  it("returns an empty list for issues without documents", async () => {
    const db = {
      select: () => createResolvedChain([]),
    } as never;

    const svc = createIssueDocumentService(db);
    const result = await svc.listDocuments("issue-nonexistent");

    expect(result).toEqual([]);
  });
});
