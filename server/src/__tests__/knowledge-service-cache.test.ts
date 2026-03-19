import { describe, expect, it } from "vitest";
import { knowledgeService } from "../services/knowledge.js";

function createResolvedChain<T>(rows: T) {
  const chain = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    groupBy: () => chain,
    innerJoin: () => chain,
    leftJoin: () => chain,
    then: <R>(resolve: (value: T) => R | PromiseLike<R>) => Promise.resolve(rows).then(resolve),
  };
  return chain;
}

function createKnowledgeDbMock(input: {
  selectResults?: unknown[][];
  insertResults?: unknown[][];
  updateResults?: unknown[][];
}) {
  const selectResults = [...(input.selectResults ?? [])];
  const insertResults = [...(input.insertResults ?? [])];
  const updateResults = [...(input.updateResults ?? [])];
  const insertValues: unknown[] = [];
  const updateSets: unknown[] = [];

  const db = {
    select: () => createResolvedChain(selectResults.shift() ?? []),
    insert: () => ({
      values: (value: unknown) => {
        insertValues.push(value);
        return {
          returning: async () => insertResults.shift() ?? [],
        };
      },
    }),
    update: () => ({
      set: (value: unknown) => {
        updateSets.push(value);
        return {
          where: () => ({
            returning: async () => updateResults.shift() ?? [],
          }),
        };
      },
    }),
  };

  return {
    db,
    insertValues,
    updateSets,
  };
}

function createCacheEntry(input: {
  id: string;
  cacheKey: string;
  knowledgeRevision: number;
  queryFingerprint: string;
  policyFingerprint: string;
  feedbackFingerprint: string;
  updatedAt?: Date;
  expiresAt?: Date | null;
  hitCount?: number;
  valueJson?: Record<string, unknown>;
}) {
  return {
    id: input.id,
    cacheKey: input.cacheKey,
    knowledgeRevision: input.knowledgeRevision,
    updatedAt: input.updatedAt ?? new Date("2026-03-12T12:00:00Z"),
    expiresAt: input.expiresAt ?? null,
    hitCount: input.hitCount ?? 0,
    valueJson: input.valueJson ?? {
      metadata: {
        cacheIdentity: {
          queryFingerprint: input.queryFingerprint,
          policyFingerprint: input.policyFingerprint,
          feedbackFingerprint: input.feedbackFingerprint,
          revisionSignature: "rev-1",
        },
      },
    },
  };
}

describe("knowledge service cache and revision flows", () => {
  it("creates an initial project knowledge revision row", async () => {
    const { db, insertValues } = createKnowledgeDbMock({
      selectResults: [[]],
      insertResults: [[{
        id: "rev-1",
        revision: 1,
        metadata: { source: "initial" },
      }]],
    });
    const service = knowledgeService(db as never);

    const result = await service.touchProjectKnowledgeRevision({
      companyId: "company-1",
      projectId: "project-1",
      importMode: "bootstrap",
      headSha: "abc123",
      treeSignature: "tree-1",
      metadata: { source: "initial" },
      importedAt: "2026-03-12T12:00:00Z",
    });

    expect(result).toMatchObject({
      id: "rev-1",
      revision: 1,
    });
    expect(insertValues[0]).toMatchObject({
      companyId: "company-1",
      projectId: "project-1",
      revision: 1,
      lastHeadSha: "abc123",
      lastTreeSignature: "tree-1",
      lastImportMode: "bootstrap",
      metadata: {
        source: "initial",
      },
    });
  });

  it("bumps an existing project knowledge revision and merges metadata", async () => {
    const { db, updateSets } = createKnowledgeDbMock({
      selectResults: [[{
        id: "rev-1",
        revision: 4,
        lastHeadSha: "prev-head",
        lastTreeSignature: "prev-tree",
        lastImportMode: "nightly",
        metadata: {
          previous: true,
        },
      }]],
      updateResults: [[{
        id: "rev-1",
        revision: 5,
      }]],
    });
    const service = knowledgeService(db as never);

    const result = await service.touchProjectKnowledgeRevision({
      companyId: "company-1",
      projectId: "project-1",
      bump: true,
      treeSignature: "tree-2",
      metadata: { refreshed: true },
      importedAt: "2026-03-12T12:30:00Z",
    });

    expect(result).toMatchObject({
      id: "rev-1",
      revision: 5,
    });
    expect(updateSets[0]).toMatchObject({
      revision: 5,
      lastHeadSha: "prev-head",
      lastTreeSignature: "tree-2",
      lastImportMode: "nightly",
      metadata: {
        previous: true,
        refreshed: true,
      },
    });
  });

  it("distinguishes feedback, policy, revision, and expiry cache misses", async () => {
    const feedbackChanged = createKnowledgeDbMock({
      selectResults: [[createCacheEntry({
        id: "entry-1",
        cacheKey: "cache-a",
        knowledgeRevision: 7,
        queryFingerprint: "query-1",
        policyFingerprint: "policy-1",
        feedbackFingerprint: "feedback-1",
      })]],
    });
    const feedbackService = knowledgeService(feedbackChanged.db as never);
    await expect(
      feedbackService.inspectRetrievalCacheEntryState({
        companyId: "company-1",
        stage: "final_hits",
        cacheKey: "cache-b",
        knowledgeRevision: 7,
        identity: {
          queryFingerprint: "query-1",
          policyFingerprint: "policy-1",
          feedbackFingerprint: "feedback-2",
        },
      }),
    ).resolves.toMatchObject({
      state: "miss_feedback_changed",
      matchedRevision: 7,
      latestKnownRevision: 7,
    });

    const policyChanged = createKnowledgeDbMock({
      selectResults: [[createCacheEntry({
        id: "entry-2",
        cacheKey: "cache-a",
        knowledgeRevision: 7,
        queryFingerprint: "query-1",
        policyFingerprint: "policy-1",
        feedbackFingerprint: "feedback-1",
      })]],
    });
    const policyService = knowledgeService(policyChanged.db as never);
    await expect(
      policyService.inspectRetrievalCacheEntryState({
        companyId: "company-1",
        stage: "final_hits",
        cacheKey: "cache-b",
        knowledgeRevision: 7,
        identity: {
          queryFingerprint: "query-1",
          policyFingerprint: "policy-2",
          feedbackFingerprint: "feedback-2",
        },
      }),
    ).resolves.toMatchObject({
      state: "miss_policy_changed",
      matchedRevision: 7,
      latestKnownRevision: 7,
    });

    const revisionChanged = createKnowledgeDbMock({
      selectResults: [[createCacheEntry({
        id: "entry-3",
        cacheKey: "cache-a",
        knowledgeRevision: 6,
        queryFingerprint: "query-1",
        policyFingerprint: "policy-1",
        feedbackFingerprint: "feedback-1",
      })]],
    });
    const revisionService = knowledgeService(revisionChanged.db as never);
    await expect(
      revisionService.inspectRetrievalCacheEntryState({
        companyId: "company-1",
        stage: "final_hits",
        cacheKey: "cache-a",
        knowledgeRevision: 7,
        identity: {
          queryFingerprint: "query-1",
          policyFingerprint: "policy-1",
          feedbackFingerprint: "feedback-1",
        },
      }),
    ).resolves.toMatchObject({
      state: "miss_revision_changed",
      matchedRevision: null,
      latestKnownRevision: 6,
    });

    const expired = createKnowledgeDbMock({
      selectResults: [[createCacheEntry({
        id: "entry-4",
        cacheKey: "cache-a",
        knowledgeRevision: 7,
        queryFingerprint: "query-1",
        policyFingerprint: "policy-1",
        feedbackFingerprint: "feedback-1",
        expiresAt: new Date("2026-03-12T03:59:00Z"),
      })]],
    });
    const expiredService = knowledgeService(expired.db as never);
    await expect(
      expiredService.inspectRetrievalCacheEntryState({
        companyId: "company-1",
        stage: "final_hits",
        cacheKey: "cache-a",
        knowledgeRevision: 7,
        identity: {
          queryFingerprint: "query-1",
          policyFingerprint: "policy-1",
          feedbackFingerprint: "feedback-1",
        },
      }),
    ).resolves.toMatchObject({
      state: "miss_expired",
      matchedRevision: 7,
      latestKnownRevision: 7,
    });
  });

  it("reuses compatible cache entries across feedback drift and bumps hit counters", async () => {
    const { db, updateSets } = createKnowledgeDbMock({
      selectResults: [[createCacheEntry({
        id: "entry-1",
        cacheKey: "cache-a",
        knowledgeRevision: 7,
        queryFingerprint: "query-1",
        policyFingerprint: "policy-1",
        feedbackFingerprint: "feedback-1",
        hitCount: 3,
      })]],
      updateResults: [[{
        id: "entry-1",
        hitCount: 4,
      }]],
    });
    const service = knowledgeService(db as never);

    const result = await service.getCompatibleRetrievalCacheEntry({
      companyId: "company-1",
      stage: "final_hits",
      knowledgeRevision: 7,
      allowFeedbackDrift: true,
      identity: {
        queryFingerprint: "query-1",
        policyFingerprint: "policy-1",
        feedbackFingerprint: "feedback-2",
        revisionSignature: "rev-1",
      },
    });

    expect(result).toMatchObject({
      id: "entry-1",
      hitCount: 4,
    });
    expect(updateSets[0]).toMatchObject({
      hitCount: 4,
    });
  });

  it("increments hit counters when an exact retrieval cache entry is reused", async () => {
    const { db, updateSets } = createKnowledgeDbMock({
      selectResults: [[createCacheEntry({
        id: "entry-hit",
        cacheKey: "cache-hit",
        knowledgeRevision: 11,
        queryFingerprint: "query-1",
        policyFingerprint: "policy-1",
        feedbackFingerprint: "feedback-1",
        hitCount: 6,
      })]],
      updateResults: [[{
        id: "entry-hit",
        hitCount: 7,
        cacheKey: "cache-hit",
      }]],
    });
    const service = knowledgeService(db as never);

    const result = await service.getRetrievalCacheEntry({
      companyId: "company-1",
      stage: "candidate_hits",
      cacheKey: "cache-hit",
      knowledgeRevision: 11,
    });

    expect(result).toMatchObject({
      id: "entry-hit",
      hitCount: 7,
    });
    expect(updateSets[0]).toMatchObject({
      hitCount: 7,
      lastAccessedAt: expect.any(Date),
      updatedAt: expect.any(Date),
    });
  });

  it("returns null when compatible cache revision signatures diverge", async () => {
    const { db, updateSets } = createKnowledgeDbMock({
      selectResults: [[createCacheEntry({
        id: "entry-sig",
        cacheKey: "cache-sig",
        knowledgeRevision: 7,
        queryFingerprint: "query-1",
        policyFingerprint: "policy-1",
        feedbackFingerprint: "feedback-1",
      })]],
    });
    const service = knowledgeService(db as never);

    const result = await service.getCompatibleRetrievalCacheEntry({
      companyId: "company-1",
      stage: "final_hits",
      knowledgeRevision: 7,
      identity: {
        queryFingerprint: "query-1",
        policyFingerprint: "policy-1",
        feedbackFingerprint: "feedback-1",
        revisionSignature: "rev-2",
      },
    });

    expect(result).toBeNull();
    expect(updateSets).toEqual([]);
  });

  it("reuses compatible cache entries across revision signature drift when reviewer feedback drift is allowed", async () => {
    const { db, updateSets } = createKnowledgeDbMock({
      selectResults: [[createCacheEntry({
        id: "entry-sig-drift",
        cacheKey: "cache-sig-drift",
        knowledgeRevision: 7,
        queryFingerprint: "query-1",
        policyFingerprint: "policy-1",
        feedbackFingerprint: "feedback-1",
        hitCount: 4,
      })]],
      updateResults: [[{
        id: "entry-sig-drift",
        hitCount: 5,
      }]],
    });
    const service = knowledgeService(db as never);

    const result = await service.getCompatibleRetrievalCacheEntry({
      companyId: "company-1",
      stage: "final_hits",
      knowledgeRevision: 7,
      allowFeedbackDrift: true,
      allowRevisionSignatureDrift: true,
      identity: {
        queryFingerprint: "query-1",
        policyFingerprint: "policy-1",
        feedbackFingerprint: "feedback-2",
        revisionSignature: "rev-2",
      },
    });

    expect(result).toMatchObject({
      id: "entry-sig-drift",
      hitCount: 5,
    });
    expect(updateSets[0]).toMatchObject({
      hitCount: 5,
      lastAccessedAt: expect.any(Date),
      updatedAt: expect.any(Date),
    });
  });

  it("reuses compatible cache entries across knowledge revision drift when reviewer cache reuse is enabled", async () => {
    const { db, updateSets } = createKnowledgeDbMock({
      selectResults: [[createCacheEntry({
        id: "entry-revision-drift",
        cacheKey: "cache-revision-drift",
        knowledgeRevision: 6,
        queryFingerprint: "query-1",
        policyFingerprint: "policy-1",
        feedbackFingerprint: "feedback-1",
        hitCount: 8,
      })]],
      updateResults: [[{
        id: "entry-revision-drift",
        hitCount: 9,
        knowledgeRevision: 6,
      }]],
    });
    const service = knowledgeService(db as never);

    const result = await service.getCompatibleRetrievalCacheEntry({
      companyId: "company-1",
      stage: "candidate_hits",
      knowledgeRevision: 7,
      allowKnowledgeRevisionDrift: true,
      identity: {
        queryFingerprint: "query-1",
        policyFingerprint: "policy-1",
        feedbackFingerprint: "feedback-1",
        revisionSignature: "rev-1",
      },
    });

    expect(result).toMatchObject({
      id: "entry-revision-drift",
      hitCount: 9,
      knowledgeRevision: 6,
    });
    expect(updateSets[0]).toMatchObject({
      hitCount: 9,
      lastAccessedAt: expect.any(Date),
      updatedAt: expect.any(Date),
    });
  });

  it("updates existing cache entries in place when the stage key already exists", async () => {
    const { db, updateSets } = createKnowledgeDbMock({
      selectResults: [[{
        id: "entry-1",
      }]],
      updateResults: [[{
        id: "entry-1",
        cacheKey: "cache-a",
      }]],
    });
    const service = knowledgeService(db as never);

    const result = await service.upsertRetrievalCacheEntry({
      companyId: "company-1",
      projectId: "project-1",
      stage: "candidate_hits",
      cacheKey: "cache-a",
      knowledgeRevision: 9,
      valueJson: {
        metadata: {
          cacheIdentity: {
            queryFingerprint: "query-1",
            policyFingerprint: "policy-1",
            feedbackFingerprint: "feedback-1",
          },
        },
      },
      ttlSeconds: 120,
    });

    expect(result).toMatchObject({
      id: "entry-1",
      cacheKey: "cache-a",
    });
    expect(updateSets[0]).toMatchObject({
      companyId: "company-1",
      projectId: "project-1",
      stage: "candidate_hits",
      cacheKey: "cache-a",
      knowledgeRevision: 9,
    });
    expect(updateSets[0]).toHaveProperty("expiresAt");
  });

  it("creates cache entries when no prior stage key exists", async () => {
    const { db, insertValues } = createKnowledgeDbMock({
      selectResults: [[]],
      insertResults: [[{
        id: "entry-new",
        cacheKey: "cache-b",
        knowledgeRevision: 11,
      }]],
    });
    const service = knowledgeService(db as never);

    const result = await service.upsertRetrievalCacheEntry({
      companyId: "company-1",
      projectId: "project-1",
      stage: "final_hits",
      cacheKey: "cache-b",
      knowledgeRevision: 11,
      valueJson: {
        metadata: {
          cacheIdentity: {
            queryFingerprint: "query-2",
            policyFingerprint: "policy-2",
            feedbackFingerprint: "feedback-2",
          },
        },
      },
    });

    expect(result).toMatchObject({
      id: "entry-new",
      cacheKey: "cache-b",
      knowledgeRevision: 11,
    });
    expect(insertValues[0]).toMatchObject({
      companyId: "company-1",
      projectId: "project-1",
      stage: "final_hits",
      cacheKey: "cache-b",
      knowledgeRevision: 11,
    });
    expect(insertValues[0]).toHaveProperty("createdAt");
    expect(insertValues[0]).toHaveProperty("lastAccessedAt");
  });
});
