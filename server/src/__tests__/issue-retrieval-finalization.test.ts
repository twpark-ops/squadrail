import { describe, expect, it } from "vitest";
import {
  buildCombinedGraphMetrics,
  buildRetrievalBriefDraft,
  buildRetrievalCompletionArtifacts,
  buildRecipientBriefEvidenceSummary,
  buildRecipientRetrievalHint,
  resolveRecipientBriefQuality,
  buildTaskBriefContentJson,
  buildRetrievalRunCompletionActivityDetails,
  buildRetrievalRunCompletionEvents,
  buildRetrievalRunDebugPatch,
} from "../services/issue-retrieval.js";

function makeHit(overrides: Record<string, unknown> = {}) {
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
    textContent: "retry worker handles backoff",
    documentMetadata: {
      artifactKind: "decision",
    },
    chunkMetadata: {},
    denseScore: 0.82,
    sparseScore: 0.31,
    rerankScore: 1.15,
    fusedScore: 2.1,
    updatedAt: new Date("2026-03-12T00:00:00Z"),
    graphMetadata: {
      entityTypes: ["path", "symbol"],
      entityIds: ["src/retry.ts", "retryWorker"],
      seedReasons: ["protocol_related_issue"],
      graphScore: 1.4,
      edgeTypes: ["calls"],
      hopDepth: 2,
    },
    temporalMetadata: {
      branchName: "main",
      defaultBranchName: "main",
      commitSha: "abc123",
      matchType: "same_branch_head",
      score: 0.8,
      stale: false,
    },
    personalizationMetadata: {
      totalBoost: 0.4,
      sourceTypeBoost: 0.1,
      pathBoost: 0.2,
      symbolBoost: 0.1,
      scopes: ["project"],
      matchedSourceType: "code",
      matchedPath: "src/retry.ts",
      matchedSymbol: "retryWorker",
    },
    ...overrides,
  };
}

function makeQuality() {
  return {
    confidenceLevel: "high" as const,
    evidenceCount: 2,
    denseEnabled: true,
    denseHitCount: 2,
    sparseHitCount: 1,
    pathHitCount: 1,
    symbolHitCount: 1,
    graphSeedCount: 3,
    graphHitCount: 1,
    graphEntityTypes: ["path", "symbol"],
    symbolGraphSeedCount: 1,
    symbolGraphHitCount: 1,
    edgeTraversalCount: 4,
    edgeTypeCounts: { calls: 1 },
    graphMaxDepth: 2,
    graphHopDepthCounts: { "1": 1, "2": 1 },
    multiHopGraphHitCount: 1,
    temporalContextAvailable: true,
    temporalHitCount: 1,
    branchAlignedTopHitCount: 1,
    staleVersionPenaltyCount: 0,
    exactCommitMatchCount: 0,
    personalizationApplied: true,
    personalizedHitCount: 1,
    averagePersonalizationBoost: 0.4,
    organizationalMemoryHitCount: 0,
    codeHitCount: 1,
    reviewHitCount: 0,
    requestedRelatedIssueCount: 2,
    reuseHitCount: 1,
    reusedIssueCount: 1,
    reusedIssueIds: ["issue-related-1"],
    reusedIssueIdentifiers: ["SW-101"],
    reuseArtifactKinds: ["decision"],
    reuseDecisionHitCount: 1,
    reuseFixHitCount: 0,
    reuseReviewHitCount: 0,
    reuseCloseHitCount: 0,
    sourceDiversity: 1,
    candidateCacheHit: true,
    finalCacheHit: false,
    candidateCacheReason: "hit",
    finalCacheReason: "miss_cold",
    candidateCacheProvenance: "exact_key",
    finalCacheProvenance: null,
    exactPathSatisfied: true,
    degradedReasons: [],
  };
}

describe("issue retrieval finalization builders", () => {
  it("caps evidence summaries and builds recipient hints", () => {
    const hits = [
      makeHit(),
      makeHit({
        chunkId: "chunk-2",
        path: "src/retry_test.ts",
        title: "retry_test.ts",
        symbolName: "retryWorkerTest",
        fusedScore: 1.6,
      }),
    ];

    expect(buildRecipientBriefEvidenceSummary({ hits, maxEvidenceItems: 1 })).toEqual([
      {
        rank: 1,
        sourceType: "code",
        authorityLevel: "canonical",
        path: "src/retry.ts",
        title: "retry.ts",
        symbolName: "retryWorker",
        fusedScore: 2.1,
      },
    ]);

    expect(
      buildRecipientRetrievalHint({
        recipientId: "agent-1",
        recipientRole: "engineer",
        executionLane: "fast",
        retrievalRunId: "retrieval-1",
        briefId: "brief-1",
        briefScope: "engineer",
        briefContentMarkdown: "# brief",
        hits,
        maxEvidenceItems: 1,
      }),
    ).toMatchObject({
      recipientId: "agent-1",
      recipientRole: "engineer",
      executionLane: "fast",
      retrievalRunId: "retrieval-1",
      briefId: "brief-1",
      briefScope: "engineer",
      briefContentMarkdown: "# brief",
      briefEvidenceSummary: [
        {
          rank: 1,
          path: "src/retry.ts",
        },
      ],
    });
  });

  it("builds task brief JSON with ranked hit summaries", () => {
    const quality = makeQuality();
    const hits = [
      makeHit(),
      makeHit({
        chunkId: "chunk-2",
        documentId: "doc-2",
        path: "src/retry_test.ts",
        title: "retry_test.ts",
        sourceType: "test_report",
        authorityLevel: "working",
        fusedScore: 1.5,
      }),
    ];

    expect(
      buildTaskBriefContentJson({
        eventType: "on_review",
        triggeringMessageId: "message-1",
        executionLane: "thorough",
        queryText: "review retry worker evidence",
        dynamicSignals: {
          exactPaths: ["src/retry.ts"],
          symbolHints: ["retryWorker"],
        },
        quality,
        hits,
      }),
    ).toMatchObject({
      eventType: "on_review",
      triggeringMessageId: "message-1",
      executionLane: "thorough",
      queryText: "review retry worker evidence",
      dynamicSignals: {
        exactPaths: ["src/retry.ts"],
        symbolHints: ["retryWorker"],
      },
      quality,
      hits: [
        {
          rank: 1,
          chunkId: "chunk-1",
          documentId: "doc-1",
          path: "src/retry.ts",
          graphMetadata: {
            entityTypes: ["path", "symbol"],
          },
        },
        {
          rank: 2,
          chunkId: "chunk-2",
          documentId: "doc-2",
          sourceType: "test_report",
          authorityLevel: "working",
          path: "src/retry_test.ts",
          graphMetadata: {
            entityTypes: ["path", "symbol"],
          },
        },
      ],
    });
  });

  it("builds a retrieval brief draft for the target recipient", () => {
    const quality = makeQuality();

    expect(
      buildRetrievalBriefDraft({
        eventType: "on_review",
        triggeringMessageId: "message-1",
        recipientRole: "reviewer",
        issue: {
          identifier: "SW-101",
          title: "Retry worker stalls under backpressure",
        },
        message: {
          id: "message-1",
          issueId: "issue-1",
          companyId: "company-1",
          senderRole: "engineer",
          senderId: "agent-1",
          messageType: "SUBMIT_FOR_REVIEW",
          summary: "Please review the retry patch.",
          workflowStateBefore: "in_progress",
          workflowStateAfter: "submitted_for_review",
          payload: {},
          mentionsJson: [],
          metadata: {},
          createdAt: new Date("2026-03-12T00:00:00Z"),
        },
        queryText: "review retry worker patch and evidence",
        executionLane: "thorough",
        dynamicSignals: {
          exactPaths: ["src/retry.ts"],
          symbolHints: ["retryWorker"],
        },
        quality,
        hits: [makeHit()],
        maxEvidenceItems: 3,
      }),
    ).toMatchObject({
      briefScope: "reviewer",
      contentJson: {
        eventType: "on_review",
        triggeringMessageId: "message-1",
      },
    });
  });

  it("builds retrieval debug patches with reuse, graph, cache, and personalization metadata", () => {
    const quality = makeQuality();
    const hit = makeHit();

    const patch = buildRetrievalRunDebugPatch({
      quality,
      finalHits: [hit],
      relatedIssueIds: ["issue-related-1", "issue-related-2"],
      relatedIssueIdentifiers: ["SW-101", "SW-102"],
      reuseSummary: {
        requestedRelatedIssueCount: 2,
        reuseHitCount: 1,
        reusedIssueCount: 1,
        reusedIssueIds: ["issue-related-1"],
        reusedIssueIdentifiers: ["SW-101"],
        reuseArtifactKinds: ["decision"],
        reuseDecisionHitCount: 1,
        reuseFixHitCount: 0,
        reuseReviewHitCount: 0,
        reuseCloseHitCount: 0,
      },
      graphSeeds: [{ entityType: "path" }, { entityType: "symbol" }],
      symbolGraphSeeds: [{ entityType: "symbol" }],
      briefGraphHits: [hit],
      symbolGraphHitCount: 1,
      edgeTraversalCount: 4,
      edgeTypeCounts: { calls: 1 },
      graphMaxDepth: 2,
      graphHopDepthCounts: { "1": 1, "2": 1 },
      multiHopGraphHitCount: 1,
      temporalContext: {
        branchName: "main",
      },
      queryEmbeddingCacheHit: true,
      candidateCacheHit: true,
      finalCacheHit: false,
      revisionSignature: "rev-1",
      candidateCacheInspection: {
        state: "hit",
        reason: "hit",
        provenance: "exact_key",
        matchedRevision: "rev-1",
        latestKnownRevision: "rev-1",
        lastEntryUpdatedAt: "2026-03-12T00:00:00.000Z",
        cacheKeyFingerprint: "cache-a",
        requestedCacheKeyFingerprint: "cache-a",
        matchedCacheKeyFingerprint: "cache-a",
      },
      finalCacheInspection: {
        state: "miss",
        reason: "miss_cold",
        provenance: null,
        matchedRevision: null,
        latestKnownRevision: "rev-1",
        lastEntryUpdatedAt: null,
        cacheKeyFingerprint: "cache-b",
        requestedCacheKeyFingerprint: "cache-b",
        matchedCacheKeyFingerprint: null,
      },
      exactPathSatisfied: true,
      personalizationProfile: {
        applied: true,
        scopes: ["project"],
        feedbackCount: 3,
        positiveFeedbackCount: 2,
        negativeFeedbackCount: 1,
        sourceTypeBoosts: { code: 0.1 },
        pathBoosts: { "src/retry.ts": 0.2 },
        symbolBoosts: { retryWorker: 0.1 },
      },
    });

    expect(patch).toMatchObject({
      quality,
      topHitProjectId: "project-1",
      topHitPath: "src/retry.ts",
      topHitSourceType: "code",
      topHitArtifactKind: "decision",
      relatedIssueIds: ["issue-related-1", "issue-related-2"],
      relatedIssueIdentifiers: ["SW-101", "SW-102"],
      reusedIssueIds: ["issue-related-1"],
      reuseDecisionHitCount: 1,
      graphSeedCount: 3,
      graphSeedTypes: ["path", "symbol", "symbol_graph"],
      graphHitCount: 1,
      symbolGraphHitCount: 1,
      graphMaxDepth: 2,
      multiHopGraphHitCount: 1,
      exactPathSatisfied: true,
      cache: {
        embeddingHit: true,
        candidateHit: true,
        finalHit: false,
        revisionSignature: "rev-1",
        candidateState: "hit",
        finalState: "miss",
      },
      personalization: {
        applied: true,
        feedbackCount: 3,
        sourceTypeKeyCount: 1,
        pathKeyCount: 1,
        symbolKeyCount: 1,
        personalizedHitCount: 1,
        averagePersonalizationBoost: 0.4,
      },
    });
  });

  it("builds completion artifacts from the final brief and selected hits", () => {
    const quality = makeQuality();

    expect(
      buildRetrievalCompletionArtifacts({
        companyId: "company-1",
        issueId: "issue-1",
        retrievalRunId: "retrieval-1",
        triggeringMessageId: "message-1",
        recipientRole: "engineer",
        recipientId: "agent-1",
        executionLane: "fast",
        brief: {
          id: "brief-1",
          briefScope: "engineer_assignment",
          briefVersion: 4,
          contentMarkdown: "# engineer brief",
        },
        finalHits: [makeHit()],
        briefQuality: quality,
        relatedIssueIds: ["issue-related-1"],
        relatedIssueIdentifiers: ["SW-101"],
        reuseSummary: {
          requestedRelatedIssueCount: 1,
          reuseHitCount: 1,
          reusedIssueCount: 1,
          reusedIssueIds: ["issue-related-1"],
          reusedIssueIdentifiers: ["SW-101"],
          reuseArtifactKinds: ["decision"],
          reuseDecisionHitCount: 1,
          reuseFixHitCount: 0,
          reuseReviewHitCount: 0,
          reuseCloseHitCount: 0,
        },
        graphSeeds: [{ entityType: "path" }],
        symbolGraphSeeds: [{ entityType: "symbol" }],
        briefGraphHits: [makeHit()],
        symbolGraphHitCount: 1,
        edgeTraversalCount: 4,
        edgeTypeCounts: { calls: 1 },
        graphMaxDepth: 2,
        graphHopDepthCounts: { "1": 1, "2": 1 },
        multiHopGraphHitCount: 1,
        temporalContext: {
          branchName: "main",
        },
        queryEmbeddingCacheHit: true,
        candidateCacheHit: true,
        finalCacheHit: false,
        revisionSignature: "rev-1",
        candidateCacheInspection: {
          state: "hit",
          reason: "exact",
          provenance: "exact_key",
          matchedRevision: 7,
          latestKnownRevision: 7,
          lastEntryUpdatedAt: "2026-03-12T00:00:00.000Z",
          cacheKeyFingerprint: "candidate-cache",
          requestedCacheKeyFingerprint: "candidate-requested",
          matchedCacheKeyFingerprint: "candidate-matched",
        },
        finalCacheInspection: {
          state: "miss_cold",
          reason: "cold",
          provenance: null,
          matchedRevision: null,
          latestKnownRevision: 7,
          lastEntryUpdatedAt: null,
          cacheKeyFingerprint: "final-cache",
          requestedCacheKeyFingerprint: "final-requested",
          matchedCacheKeyFingerprint: null,
        },
        exactPathSatisfied: true,
        personalizationProfile: {
          applied: true,
          scopes: ["project"],
          feedbackCount: 2,
          positiveFeedbackCount: 2,
          negativeFeedbackCount: 0,
          sourceTypeBoosts: { code: 0.1 },
          pathBoosts: { "src/retry.ts": 0.2 },
          symbolBoosts: { retryWorker: 0.1 },
        },
        maxEvidenceItems: 2,
      }),
    ).toMatchObject({
      activityDetails: {
        retrievalRunId: "retrieval-1",
        briefId: "brief-1",
        briefScope: "engineer_assignment",
      },
      completionEvents: [
        {
          type: "retrieval.run.completed",
          payload: {
            issueId: "issue-1",
          },
        },
        {
          type: "issue.brief.updated",
          payload: {
            briefId: "brief-1",
            briefVersion: 4,
          },
        },
      ],
      recipientHint: {
        briefId: "brief-1",
        briefScope: "engineer_assignment",
      },
      retrievalRunDebugPatch: {
        relatedIssueIds: ["issue-related-1"],
        relatedIssueIdentifiers: ["SW-101"],
      },
    });
  });

  it("builds activity details and paired completion events", () => {
    const quality = makeQuality();

    expect(
      buildRetrievalRunCompletionActivityDetails({
        retrievalRunId: "retrieval-1",
        triggeringMessageId: "message-1",
        recipientRole: "reviewer",
        recipientId: "agent-2",
        hitCount: 2,
        briefQuality: quality,
        briefId: "brief-1",
        briefScope: "reviewer",
      }),
    ).toEqual({
      retrievalRunId: "retrieval-1",
      triggeringMessageId: "message-1",
      recipientRole: "reviewer",
      recipientId: "agent-2",
      hitCount: 2,
      briefQuality: "high",
      briefDenseEnabled: true,
      briefId: "brief-1",
      briefScope: "reviewer",
    });

    expect(
      buildRetrievalRunCompletionEvents({
        companyId: "company-1",
        issueId: "issue-1",
        retrievalRunId: "retrieval-1",
        recipientRole: "reviewer",
        recipientId: "agent-2",
        hitCount: 2,
        briefQuality: quality,
        briefId: "brief-1",
        briefScope: "reviewer",
        briefVersion: 4,
      }),
    ).toEqual([
      {
        companyId: "company-1",
        type: "retrieval.run.completed",
        payload: {
          issueId: "issue-1",
          retrievalRunId: "retrieval-1",
          recipientRole: "reviewer",
          recipientId: "agent-2",
          hitCount: 2,
          briefQuality: "high",
          briefDenseEnabled: true,
        },
      },
      {
        companyId: "company-1",
        type: "issue.brief.updated",
        payload: {
          issueId: "issue-1",
          briefId: "brief-1",
          briefScope: "reviewer",
          briefVersion: 4,
          retrievalRunId: "retrieval-1",
        },
      },
    ]);
  });

  it("combines chunk and symbol graph metrics without dropping overlapping hop counts", () => {
    expect(
      buildCombinedGraphMetrics(
        {
          hits: [],
          edgeTraversalCount: 2,
          graphMaxDepth: 2,
          graphHopDepthCounts: { "1": 2, "2": 1 },
          graphEntityTypeCounts: {},
        },
        {
          hits: [],
          edgeTraversalCount: 3,
          edgeTypeCounts: { calls: 2 },
          graphMaxDepth: 4,
          graphHopDepthCounts: { "2": 3, "3": 1 },
        },
      ),
    ).toEqual({
      combinedGraphHopDepthCounts: {
        "1": 2,
        "2": 4,
        "3": 1,
      },
      combinedGraphMaxDepth: 4,
    });
  });

  it("resolves brief quality from retrieval stage inputs when no prior quality exists", () => {
    const quality = resolveRecipientBriefQuality({
      finalHits: [makeHit()],
      queryEmbedding: [0.2, 0.4, 0.6],
      sparseHitCount: 2,
      pathHitCount: 1,
      symbolHitCount: 1,
      denseHitCount: 1,
      graphSeedCount: 3,
      symbolGraphSeedCount: 1,
      symbolGraphHitCount: 1,
      edgeTraversalCount: 4,
      edgeTypeCounts: { calls: 1 },
      graphMaxDepth: 2,
      graphHopDepthCounts: { "1": 1, "2": 1 },
      temporalContext: {
        branchName: "main",
        defaultBranchName: "main",
        headSha: "abc123",
        source: "artifact",
      },
      exactPaths: ["src/retry.ts"],
      projectAffinityIds: ["project-1", "project-2"],
      candidateCacheHit: true,
      finalCacheHit: false,
      candidateCacheInspection: {
        reason: "hit",
        provenance: "exact_key",
      },
      finalCacheInspection: {
        reason: "miss_cold",
        provenance: null,
      },
      relatedIssueIds: ["issue-related-1", "issue-related-2"],
      relatedIssueIdentifierMap: {
        "issue-related-1": "SW-101",
        "issue-related-2": "SW-102",
      },
      reuseSummary: {
        requestedRelatedIssueCount: 2,
        reuseHitCount: 1,
        reusedIssueCount: 1,
        reusedIssueIds: ["issue-related-1"],
        reusedIssueIdentifiers: ["SW-101"],
        reuseArtifactKinds: ["decision"],
        reuseDecisionHitCount: 1,
        reuseFixHitCount: 0,
        reuseReviewHitCount: 0,
        reuseCloseHitCount: 0,
      },
      existingBriefQuality: null,
    });

    expect(quality).toMatchObject({
      candidateCacheHit: true,
      finalCacheHit: false,
      candidateCacheReason: "hit",
      finalCacheReason: "miss_cold",
      exactPathSatisfied: true,
      requestedRelatedIssueCount: 2,
      reuseHitCount: 1,
      reusedIssueIdentifiers: ["SW-101"],
    });
  });

  it("patches existing brief quality with latest cache and reuse traces", () => {
    const quality = resolveRecipientBriefQuality({
      finalHits: [makeHit()],
      queryEmbedding: [0.2, 0.4, 0.6],
      sparseHitCount: 2,
      pathHitCount: 1,
      symbolHitCount: 1,
      denseHitCount: 1,
      graphSeedCount: 3,
      symbolGraphSeedCount: 1,
      symbolGraphHitCount: 1,
      edgeTraversalCount: 4,
      edgeTypeCounts: { calls: 1 },
      graphMaxDepth: 2,
      graphHopDepthCounts: { "1": 1, "2": 1 },
      temporalContext: {
        branchName: "main",
        defaultBranchName: "main",
        headSha: "abc123",
        source: "artifact",
      },
      exactPaths: ["src/retry.ts"],
      projectAffinityIds: ["project-1"],
      candidateCacheHit: false,
      finalCacheHit: true,
      candidateCacheInspection: {
        reason: "miss_policy_changed",
        provenance: null,
      },
      finalCacheInspection: {
        reason: "hit",
        provenance: "normalized_input",
      },
      relatedIssueIds: ["issue-related-1"],
      relatedIssueIdentifierMap: {
        "issue-related-1": "SW-101",
      },
      reuseSummary: {
        requestedRelatedIssueCount: 1,
        reuseHitCount: 1,
        reusedIssueCount: 1,
        reusedIssueIds: ["issue-related-1"],
        reusedIssueIdentifiers: ["SW-101"],
        reuseArtifactKinds: ["decision"],
        reuseDecisionHitCount: 1,
        reuseFixHitCount: 0,
        reuseReviewHitCount: 0,
        reuseCloseHitCount: 0,
      },
      existingBriefQuality: makeQuality(),
    });

    expect(quality).toMatchObject({
      confidenceLevel: "high",
      candidateCacheHit: false,
      finalCacheHit: true,
      candidateCacheReason: "miss_policy_changed",
      finalCacheReason: "hit",
      finalCacheProvenance: "normalized_input",
      reuseHitCount: 1,
      reusedIssueIdentifiers: ["SW-101"],
    });
  });
});
