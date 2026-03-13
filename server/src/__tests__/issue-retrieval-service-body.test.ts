import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGenerateEmbeddings,
  mockGetProviderInfo,
  mockFingerprint,
  mockCreateRetrievalRun,
  mockCreateTaskBrief,
  mockGetCompatibleRetrievalCacheEntry,
  mockGetLatestTaskBrief,
  mockGetRetrievalCacheEntry,
  mockGetRetrievalPolicy,
  mockInspectRetrievalCacheEntryState,
  mockLinkRetrievalRunToBrief,
  mockListProjectKnowledgeRevisions,
  mockRecordRetrievalHits,
  mockUpsertRetrievalCacheEntry,
  mockUpdateRetrievalRunDebug,
  mockUpsertRetrievalPolicy,
  mockLoadProfile,
  mockLogActivity,
  mockPublishLiveEvent,
} = vi.hoisted(() => ({
  mockGenerateEmbeddings: vi.fn(),
  mockGetProviderInfo: vi.fn(),
  mockFingerprint: vi.fn(),
  mockCreateRetrievalRun: vi.fn(),
  mockCreateTaskBrief: vi.fn(),
  mockGetCompatibleRetrievalCacheEntry: vi.fn(),
  mockGetLatestTaskBrief: vi.fn(),
  mockGetRetrievalCacheEntry: vi.fn(),
  mockGetRetrievalPolicy: vi.fn(),
  mockInspectRetrievalCacheEntryState: vi.fn(),
  mockLinkRetrievalRunToBrief: vi.fn(),
  mockListProjectKnowledgeRevisions: vi.fn(),
  mockRecordRetrievalHits: vi.fn(),
  mockUpsertRetrievalCacheEntry: vi.fn(),
  mockUpdateRetrievalRunDebug: vi.fn(),
  mockUpsertRetrievalPolicy: vi.fn(),
  mockLoadProfile: vi.fn(),
  mockLogActivity: vi.fn(),
  mockPublishLiveEvent: vi.fn(),
}));

vi.mock("../services/knowledge-embeddings.js", () => ({
  knowledgeEmbeddingService: () => ({
    generateEmbeddings: mockGenerateEmbeddings,
    getProviderInfo: mockGetProviderInfo,
    fingerprint: mockFingerprint,
  }),
}));

vi.mock("../services/knowledge-reranking.js", () => ({
  knowledgeRerankingService: () => ({
    isConfigured: () => false,
    rerankCandidates: vi.fn(),
  }),
}));

vi.mock("../services/knowledge.js", () => ({
  knowledgeService: () => ({
    createRetrievalRun: mockCreateRetrievalRun,
    createTaskBrief: mockCreateTaskBrief,
    getCompatibleRetrievalCacheEntry: mockGetCompatibleRetrievalCacheEntry,
    getLatestTaskBrief: mockGetLatestTaskBrief,
    getRetrievalCacheEntry: mockGetRetrievalCacheEntry,
    getRetrievalPolicy: mockGetRetrievalPolicy,
    inspectRetrievalCacheEntryState: mockInspectRetrievalCacheEntryState,
    linkRetrievalRunToBrief: mockLinkRetrievalRunToBrief,
    listProjectKnowledgeRevisions: mockListProjectKnowledgeRevisions,
    recordRetrievalHits: mockRecordRetrievalHits,
    upsertRetrievalCacheEntry: mockUpsertRetrievalCacheEntry,
    updateRetrievalRunDebug: mockUpdateRetrievalRunDebug,
    upsertRetrievalPolicy: mockUpsertRetrievalPolicy,
  }),
}));

vi.mock("../services/retrieval-personalization.js", () => ({
  buildPersonalizationFingerprint: vi.fn().mockReturnValue("personalization-fingerprint"),
  computeRetrievalPersonalizationBoost: vi.fn().mockReturnValue({
    totalBoost: 0,
    sourceTypeBoost: 0,
    pathBoost: 0,
    symbolBoost: 0,
    scopes: [],
    matchedSourceType: null,
    matchedPath: null,
    matchedSymbol: null,
  }),
  retrievalPersonalizationService: () => ({
    loadProfile: mockLoadProfile,
  }),
}));

vi.mock("../services/activity-log.js", () => ({
  logActivity: mockLogActivity,
}));

vi.mock("../services/live-events.js", () => ({
  publishLiveEvent: mockPublishLiveEvent,
}));

import { issueRetrievalService } from "../services/issue-retrieval.js";

function createResolvedChain(selectResults: unknown[][]) {
  const chain = {
    from: () => chain,
    innerJoin: () => chain,
    leftJoin: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    then: <T>(resolve: (value: unknown[]) => T | PromiseLike<T>) =>
      Promise.resolve(selectResults.shift() ?? []).then(resolve),
  };
  return chain;
}

function createDbMock(selectResults: unknown[][] = [], executeResults: unknown[][] = []) {
  const queue = [...selectResults];
  const executes = [...executeResults];
  return {
    select: (..._args: unknown[]) => createResolvedChain(queue),
    execute: async (..._args: unknown[]) => executes.shift() ?? [],
  };
}

function makeCachedHit() {
  return {
    chunkId: "chunk-1",
    documentId: "doc-1",
    sourceType: "code",
    authorityLevel: "canonical",
    documentIssueId: "issue-related-1",
    documentProjectId: "project-1",
    path: "src/retry.ts",
    title: "retry.ts",
    headingPath: null,
    symbolName: "retryWorker",
    textContent: "retry worker handles exponential backoff",
    documentMetadata: {
      artifactKind: "decision",
    },
    chunkMetadata: {},
    denseScore: null,
    sparseScore: null,
    rerankScore: null,
    fusedScore: 1.8,
    updatedAt: "2026-03-13T00:00:00.000Z",
    modelRerankRank: null,
    graphMetadata: null,
    temporalMetadata: null,
    personalizationMetadata: null,
    saturationMetadata: null,
    diversityMetadata: null,
  };
}

describe("issue retrieval service body", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetProviderInfo.mockReturnValue({
      available: false,
      provider: null,
      model: null,
    });
    mockFingerprint.mockReturnValue(null);
    mockGenerateEmbeddings.mockResolvedValue({
      provider: "openai",
      model: "text-embedding-3-small",
      dimensions: 1536,
      usage: { totalTokens: 12 },
      embeddings: [],
    });
    mockGetRetrievalPolicy.mockResolvedValue({
      id: "policy-1",
      companyId: "company-1",
      role: "reviewer",
      eventType: "on_review_submit",
      workflowState: "submitted_for_review",
      allowedSourceTypes: ["code", "review", "issue", "protocol_message"],
      allowedAuthorityLevels: ["canonical", "working"],
      metadata: {},
    });
    mockUpsertRetrievalPolicy.mockResolvedValue(null);
    mockLoadProfile.mockResolvedValue({
      applied: false,
      scopes: [],
      feedbackCount: 0,
      positiveFeedbackCount: 0,
      negativeFeedbackCount: 0,
      sourceTypeBoosts: {},
      pathBoosts: {},
      symbolBoosts: {},
    });
    mockListProjectKnowledgeRevisions.mockResolvedValue([]);
    mockCreateRetrievalRun.mockResolvedValue({
      id: "retrieval-run-1",
    });
    mockGetLatestTaskBrief.mockResolvedValue(null);
    mockCreateTaskBrief.mockResolvedValue({
      id: "brief-1",
      briefVersion: 1,
      contentMarkdown: "# Reviewer brief",
    });
    mockRecordRetrievalHits.mockResolvedValue(undefined);
    mockLinkRetrievalRunToBrief.mockResolvedValue(undefined);
    mockUpdateRetrievalRunDebug.mockResolvedValue(undefined);
    mockUpsertRetrievalCacheEntry.mockResolvedValue(undefined);
    mockGetCompatibleRetrievalCacheEntry.mockResolvedValue(null);
    mockInspectRetrievalCacheEntryState.mockResolvedValue({
      state: "miss",
      reason: "miss_cold",
      latestKnownRevision: 0,
      matchedRevision: null,
      lastEntryUpdatedAt: null,
    });
  });

  it("hydrates recipient hints from cached candidate and final retrieval entries", async () => {
    const cachedHit = makeCachedHit();
    mockGetRetrievalCacheEntry
      .mockResolvedValueOnce({
        cacheKey: "candidate-cache-key",
        knowledgeRevision: 0,
        updatedAt: new Date("2026-03-13T09:00:00.000Z"),
        valueJson: {
          hits: [cachedHit],
          quality: null,
          metadata: {
            sparseHitCount: 1,
            pathHitCount: 0,
            symbolHitCount: 0,
            denseHitCount: 0,
            cacheIdentity: {
              feedbackFingerprint: "feedback-fingerprint",
            },
          },
        },
      })
      .mockResolvedValueOnce({
        cacheKey: "final-cache-key",
        knowledgeRevision: 0,
        updatedAt: new Date("2026-03-13T09:01:00.000Z"),
        valueJson: {
          hits: [cachedHit],
          quality: {
            confidenceLevel: "high",
            evidenceCount: 1,
            candidateCacheHit: true,
            finalCacheHit: true,
            candidateCacheReason: "hit",
            finalCacheReason: "hit",
            candidateCacheProvenance: "exact_key",
            finalCacheProvenance: "exact_key",
            reusedIssueIds: ["issue-related-1"],
            reusedIssueIdentifiers: ["CLO-22"],
            reuseArtifactKinds: ["decision"],
            graphHitCount: 0,
            graphMaxDepth: 0,
            graphHopDepthCounts: {},
            multiHopGraphHitCount: 0,
            organizationalMemoryHitCount: 0,
            codeHitCount: 1,
            reviewHitCount: 0,
            requestedRelatedIssueCount: 1,
            reuseHitCount: 1,
            reusedIssueCount: 1,
            reuseDecisionHitCount: 1,
            reuseFixHitCount: 0,
            reuseReviewHitCount: 0,
            reuseCloseHitCount: 0,
            sourceDiversity: 1,
            exactPathSatisfied: false,
            degradedReasons: [],
          },
          metadata: {
            graphSeedCount: 0,
            symbolGraphSeedCount: 0,
            cacheIdentity: {
              feedbackFingerprint: "feedback-fingerprint",
            },
          },
        },
      });

    const db = createDbMock([
      [],
      [],
      [],
      [],
    ]);
    const service = issueRetrievalService(db as never);

    const result = await service.handleProtocolMessage({
      companyId: "company-1",
      issueId: "issue-1",
      issue: {
        id: "issue-1",
        projectId: "project-1",
        identifier: "CLO-21",
        title: "Stabilize retry dispatch",
        description: "Need review-ready runtime evidence.",
        labels: [],
        mentionedProjects: [],
      },
      triggeringMessageId: "message-1",
      triggeringMessageSeq: 7,
      message: {
        messageType: "SUBMIT_FOR_REVIEW",
        sender: {
          actorType: "agent",
          actorId: "eng-1",
          role: "engineer",
        },
        recipients: [
          {
            recipientType: "agent",
            recipientId: "rev-1",
            role: "reviewer",
          },
        ],
        artifacts: [],
        workflowStateBefore: "implementing",
        workflowStateAfter: "submitted_for_review",
        summary: "Please review the retry stabilization patch.",
        payload: {},
      },
      actor: {
        actorType: "agent",
        actorId: "eng-1",
      },
    });

    expect(result.eventType).toBe("on_review_submit");
    expect(result.recipientHints).toEqual([
      expect.objectContaining({
        recipientId: "rev-1",
        recipientRole: "reviewer",
        retrievalRunId: "retrieval-run-1",
        briefId: "brief-1",
        briefScope: "reviewer",
        briefEvidenceSummary: [
          expect.objectContaining({
            rank: 1,
            path: "src/retry.ts",
          }),
        ],
      }),
    ]);
    expect(result.retrievalRuns).toEqual([
      {
        retrievalRunId: "retrieval-run-1",
        briefId: "brief-1",
        recipientRole: "reviewer",
        recipientId: "rev-1",
      },
    ]);
    expect(mockCreateRetrievalRun).toHaveBeenCalledWith(expect.objectContaining({
      companyId: "company-1",
      issueId: "issue-1",
      actorRole: "reviewer",
      eventType: "on_review_submit",
    }));
    expect(mockCreateTaskBrief).toHaveBeenCalledWith(expect.objectContaining({
      companyId: "company-1",
      issueId: "issue-1",
      briefScope: "reviewer",
      retrievalRunId: "retrieval-run-1",
    }));
    expect(mockRecordRetrievalHits).toHaveBeenCalledWith(expect.objectContaining({
      companyId: "company-1",
      retrievalRunId: "retrieval-run-1",
      hits: [
        expect.objectContaining({
          chunkId: "chunk-1",
          finalRank: 1,
        }),
      ],
    }));
    expect(mockLinkRetrievalRunToBrief).toHaveBeenCalledWith("retrieval-run-1", "brief-1");
    expect(mockUpdateRetrievalRunDebug).toHaveBeenCalledTimes(1);
    const retrievalRunDebugPatch = mockUpdateRetrievalRunDebug.mock.calls[0]?.[1];
    expect(mockUpdateRetrievalRunDebug.mock.calls[0]?.[0]).toBe("retrieval-run-1");
    expect(retrievalRunDebugPatch).toEqual(expect.objectContaining({
      cache: expect.objectContaining({
        candidateState: "hit",
        finalState: "hit",
        candidateHit: true,
        finalHit: true,
      }),
      quality: expect.objectContaining({
        confidenceLevel: "high",
        candidateCacheHit: true,
        finalCacheHit: true,
        codeHitCount: 1,
      }),
      topHitPath: "src/retry.ts",
      topHitSourceType: "code",
    }));
    expect(mockLogActivity).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        action: "retrieval.run.completed",
        entityId: "issue-1",
      }),
    );
    expect(mockPublishLiveEvent).toHaveBeenCalledTimes(2);
    expect(mockPublishLiveEvent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: "retrieval.run.completed",
        payload: expect.objectContaining({
          retrievalRunId: "retrieval-run-1",
          recipientId: "rev-1",
          recipientRole: "reviewer",
        }),
      }),
    );
    expect(mockPublishLiveEvent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: "issue.brief.updated",
        payload: expect.objectContaining({
          retrievalRunId: "retrieval-run-1",
          briefId: "brief-1",
          briefScope: "reviewer",
        }),
      }),
    );
  });

  it("builds retrieval results from a cold cache miss and persists embedding and hit caches", async () => {
    mockGetProviderInfo.mockReturnValue({
      available: true,
      provider: "openai",
      model: "text-embedding-3-small",
    });
    mockFingerprint.mockReturnValue("embedding-fingerprint");
    mockGenerateEmbeddings.mockResolvedValue({
      provider: "openai",
      model: "text-embedding-3-small",
      dimensions: 1536,
      usage: { totalTokens: 24 },
      embeddings: [[0.1, 0.2, 0.3]],
    });
    mockGetRetrievalCacheEntry.mockResolvedValue(null);

    const db = createDbMock([
      [],
      [],
      [],
      [],
      [],
      [],
      [],
      [],
      [],
      [],
    ], [[{ installed: false }]]);
    const service = issueRetrievalService(db as never);

    const result = await service.handleProtocolMessage({
      companyId: "company-1",
      issueId: "issue-1",
      issue: {
        id: "issue-1",
        projectId: "project-1",
        identifier: "CLO-30",
        title: "Investigate cold cache retrieval",
        description: "Need a fresh reviewer context build without cache reuse.",
        labels: [],
        mentionedProjects: [],
      },
      triggeringMessageId: "message-2",
      triggeringMessageSeq: 11,
      message: {
        messageType: "SUBMIT_FOR_REVIEW",
        sender: {
          actorType: "agent",
          actorId: "eng-2",
          role: "engineer",
        },
        recipients: [
          {
            recipientType: "agent",
            recipientId: "rev-2",
            role: "reviewer",
          },
        ],
        artifacts: [],
        workflowStateBefore: "implementing",
        workflowStateAfter: "submitted_for_review",
        summary: "Fresh retrieval should build a new brief from cold caches.",
        payload: {},
      },
      actor: {
        actorType: "agent",
        actorId: "eng-2",
      },
    });

    expect(result.eventType).toBe("on_review_submit");
    expect(result.recipientHints).toEqual([
      expect.objectContaining({
        recipientId: "rev-2",
        recipientRole: "reviewer",
        retrievalRunId: "retrieval-run-1",
        briefId: "brief-1",
        briefScope: "reviewer",
        briefEvidenceSummary: [],
      }),
    ]);
    expect(mockGenerateEmbeddings).toHaveBeenCalledWith([
      expect.stringContaining("Investigate cold cache retrieval"),
    ]);
    expect(mockGetRetrievalCacheEntry).toHaveBeenCalledWith(expect.objectContaining({
      stage: "query_embedding",
    }));
    expect(mockInspectRetrievalCacheEntryState).toHaveBeenCalledWith(expect.objectContaining({
      stage: "candidate_hits",
      knowledgeRevision: 0,
    }));
    expect(mockInspectRetrievalCacheEntryState).toHaveBeenCalledWith(expect.objectContaining({
      stage: "final_hits",
      knowledgeRevision: 0,
    }));
    expect(mockUpsertRetrievalCacheEntry).toHaveBeenCalledTimes(3);
    expect(mockUpsertRetrievalCacheEntry.mock.calls.map((call) => call[0]?.stage)).toEqual([
      "query_embedding",
      "candidate_hits",
      "final_hits",
    ]);
    expect(mockRecordRetrievalHits).not.toHaveBeenCalled();
    expect(mockUpdateRetrievalRunDebug).toHaveBeenCalledTimes(1);
    const coldMissDebugPatch = mockUpdateRetrievalRunDebug.mock.calls[0]?.[1];
    expect(coldMissDebugPatch).toEqual(expect.objectContaining({
      cache: expect.objectContaining({
        candidateState: "miss",
        finalState: "miss",
        candidateHit: false,
        finalHit: false,
        embeddingHit: false,
      }),
      quality: expect.objectContaining({
        confidenceLevel: "low",
        candidateCacheHit: false,
        finalCacheHit: false,
        evidenceCount: 0,
        denseEnabled: true,
      }),
    }));
    expect(mockPublishLiveEvent).toHaveBeenCalledTimes(2);
    expect(mockPublishLiveEvent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: "retrieval.run.completed",
        payload: expect.objectContaining({
          retrievalRunId: "retrieval-run-1",
          recipientId: "rev-2",
          hitCount: 0,
          briefQuality: "low",
          briefDenseEnabled: true,
        }),
      }),
    );
    expect(mockPublishLiveEvent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: "issue.brief.updated",
        payload: expect.objectContaining({
          retrievalRunId: "retrieval-run-1",
          briefId: "brief-1",
          briefScope: "reviewer",
        }),
      }),
    );
  });
});
