import { describe, expect, it } from "vitest";
import {
  buildDeprecatedDocumentMetadata,
  buildKnowledgeChunkInsertValues,
  buildKnowledgeChunkLinkValues,
  buildKnowledgeGraphView,
  buildMinimalCodeGraphFromChunks,
  buildKnowledgeDocumentVersionValues,
  buildKnowledgeQualityDailyTrend,
  buildProjectKnowledgeRevisionValues,
  buildRetrievalPolicyUpdateSet,
  buildRetrievalPolicyValues,
  buildRetrievalRunValues,
  buildTaskBriefValues,
  mergeRetrievalRunDebugPatch,
} from "../services/knowledge.js";

describe("knowledge service builders", () => {
  it("normalizes document version values and rejects empty version coordinates", () => {
    expect(
      buildKnowledgeDocumentVersionValues({
        companyId: "company-1",
        documentId: "doc-1",
        branchName: "   ",
        commitSha: null,
      }),
    ).toBeNull();

    const now = new Date("2026-03-12T10:00:00Z");
    const values = buildKnowledgeDocumentVersionValues({
      companyId: "company-1",
      documentId: "doc-1",
      projectId: "project-1",
      path: "src/retry.ts",
      repoRef: "github.com/acme/app",
      branchName: " main ",
      defaultBranchName: " trunk ",
      commitSha: " abc123 ",
      parentCommitSha: " def456 ",
      isHead: false,
      isDefaultBranch: true,
      metadata: { source: "sync" },
      now,
    });

    expect(values).toMatchObject({
      companyId: "company-1",
      documentId: "doc-1",
      projectId: "project-1",
      path: "src/retry.ts",
      repoRef: "github.com/acme/app",
      branchName: "main",
      defaultBranchName: "trunk",
      commitSha: "abc123",
      parentCommitSha: "def456",
      isHead: false,
      isDefaultBranch: true,
      metadata: { source: "sync" },
      updatedAt: now,
      capturedAt: now,
    });
  });

  it("builds task brief and retrieval run insert values with stable defaults", () => {
    expect(
      buildTaskBriefValues({
        companyId: "company-1",
        issueId: "issue-1",
        briefScope: "engineer",
        briefVersion: 3,
        generatedFromMessageSeq: 12,
        workflowState: "assigned",
        contentMarkdown: "# brief",
      }),
    ).toMatchObject({
      companyId: "company-1",
      issueId: "issue-1",
      briefScope: "engineer",
      briefVersion: 3,
      generatedFromMessageSeq: 12,
      workflowState: "assigned",
      contentMarkdown: "# brief",
      contentJson: {},
      retrievalRunId: null,
    });

    expect(
      buildRetrievalRunValues({
        companyId: "company-1",
        actorType: "agent",
        actorId: "agent-1",
        actorRole: "engineer",
        eventType: "on_assignment",
        workflowState: "assigned",
        queryText: "find retry logic",
      }),
    ).toMatchObject({
      companyId: "company-1",
      actorType: "agent",
      actorId: "agent-1",
      actorRole: "engineer",
      eventType: "on_assignment",
      workflowState: "assigned",
      queryText: "find retry logic",
      issueId: null,
      triggeringMessageId: null,
      policyId: null,
      queryDebug: {},
      finalBriefId: null,
    });
  });

  it("builds retrieval policy insert and update values from the same normalized defaults", () => {
    const values = buildRetrievalPolicyValues({
      companyId: "company-1",
      role: "reviewer",
      eventType: "on_review_submit",
      workflowState: "submitted_for_review",
      allowedSourceTypes: ["code", "review"],
      allowedAuthorityLevels: ["canonical", "working"],
      metadata: { source: "custom" },
    });

    expect(values).toMatchObject({
      companyId: "company-1",
      role: "reviewer",
      eventType: "on_review_submit",
      workflowState: "submitted_for_review",
      topKDense: 20,
      topKSparse: 20,
      rerankK: 20,
      finalK: 8,
      allowedSourceTypes: ["code", "review"],
      allowedAuthorityLevels: ["canonical", "working"],
      metadata: { source: "custom" },
    });

    const updatedAt = new Date("2026-03-12T11:00:00Z");
    expect(buildRetrievalPolicyUpdateSet(values, updatedAt)).toMatchObject({
      topKDense: 20,
      topKSparse: 20,
      rerankK: 20,
      finalK: 8,
      allowedSourceTypes: ["code", "review"],
      allowedAuthorityLevels: ["canonical", "working"],
      metadata: { source: "custom" },
      updatedAt,
    });
  });

  it("builds project knowledge revision values with merged metadata and bump semantics", () => {
    const now = new Date("2026-03-13T08:00:00Z");
    expect(buildProjectKnowledgeRevisionValues({
      companyId: "company-1",
      projectId: "project-1",
      existing: {
        revision: 4,
        lastHeadSha: "old-head",
        lastTreeSignature: "old-tree",
        lastImportMode: "bootstrap",
        metadata: {
          source: "previous",
        },
      },
      bump: true,
      headSha: "new-head",
      metadata: {
        source: "sync",
        actor: "test",
      },
      now,
    })).toMatchObject({
      companyId: "company-1",
      projectId: "project-1",
      revision: 5,
      lastHeadSha: "new-head",
      lastTreeSignature: "old-tree",
      lastImportMode: "bootstrap",
      metadata: {
        source: "sync",
        actor: "test",
      },
      updatedAt: now,
      lastImportedAt: now,
    });
  });

  it("builds deprecated metadata patches without dropping prior flags", () => {
    expect(buildDeprecatedDocumentMetadata({
      existingMetadata: {
        existing: true,
      },
      metadata: {
        source: "sync",
      },
      reason: "bootstrap_removed",
      deprecatedAt: "2026-03-13T08:00:00.000Z",
    })).toEqual({
      existing: true,
      source: "sync",
      deprecatedReason: "bootstrap_removed",
      deprecatedAt: "2026-03-13T08:00:00.000Z",
      isLatestForScope: false,
    });
  });

  it("builds chunk insert and link values with normalized defaults", () => {
    const chunkValues = buildKnowledgeChunkInsertValues({
      companyId: "company-1",
      documentId: "doc-1",
      chunks: [{
        chunkIndex: 0,
        headingPath: "Retry > Worker",
        symbolName: "retryWorker",
        tokenCount: 42,
        textContent: "retry worker handles backoff",
        embedding: [0.1, 0.2],
        metadata: { source: "sync" },
      }],
    });
    expect(chunkValues).toHaveLength(1);
    expect(chunkValues[0]).toMatchObject({
      companyId: "company-1",
      documentId: "doc-1",
      chunkIndex: 0,
      headingPath: "Retry > Worker",
      symbolName: "retryWorker",
      tokenCount: 42,
      textContent: "retry worker handles backoff",
      embedding: [0.1, 0.2],
      metadata: { source: "sync" },
    });
    expect(chunkValues[0]?.searchTsv).toBeTruthy();

    expect(buildKnowledgeChunkLinkValues({
      companyId: "company-1",
      insertedChunks: [{ id: "chunk-1" }],
      chunks: [{
        links: [{
          entityType: "issue",
          entityId: "issue-1",
          linkReason: "related_issue",
        }],
      }],
    })).toEqual([{
      companyId: "company-1",
      chunkId: "chunk-1",
      entityType: "issue",
      entityId: "issue-1",
      linkReason: "related_issue",
      weight: 1,
    }]);
  });

  it("merges retrieval debug patches without dropping prior keys", () => {
    expect(
      mergeRetrievalRunDebugPatch(
        {
          cache: {
            candidateHit: true,
          },
          quality: {
            confidenceLevel: "medium",
          },
        },
        {
          quality: {
            confidenceLevel: "high",
          },
          reuseHitCount: 2,
        },
      ),
    ).toEqual({
      cache: {
        candidateHit: true,
      },
      quality: {
        confidenceLevel: "high",
      },
      reuseHitCount: 2,
    });
  });

  it("builds a minimal code graph from chunk symbol metadata", () => {
    expect(
      buildMinimalCodeGraphFromChunks({
        chunks: [
          {
            chunkIndex: 0,
            symbolName: " RetryWorker ",
            metadata: {
              lineStart: 3,
              lineEnd: 18,
              symbolKind: "function",
              parser: "typescript_ast",
              exported: true,
            },
          },
          {
            chunkIndex: 1,
            symbolName: "",
            metadata: {
              lineStart: 20,
              lineEnd: 24,
            },
          },
        ],
      }),
    ).toEqual({
      symbols: [
        {
          chunkIndex: 0,
          symbolKey: ":function:RetryWorker:3",
          symbolName: "RetryWorker",
          symbolKind: "function",
          receiverType: null,
          startLine: 3,
          endLine: 18,
          metadata: {
            parser: "typescript_ast",
            chunkKind: undefined,
            exported: true,
            isTestFile: false,
          },
        },
      ],
      edges: [],
      stats: {
        mode: "minimal",
      },
    });
  });

  it("builds graph views and daily quality trend buckets", () => {
    expect(buildKnowledgeGraphView({
      companyId: "company-1",
      projectId: "project-1",
      projects: [{
        projectId: "project-1",
        projectName: "Retry API",
        documentCount: 2,
        linkCount: 3,
      }],
      documents: [{
        documentId: "doc-1",
        projectId: "project-1",
        projectName: "Retry API",
        title: "Retry design",
        path: "docs/retry.md",
        sourceType: "adr",
        authorityLevel: "canonical",
        language: "markdown",
        chunkCount: 3,
        linkCount: 2,
      }],
      entityEdges: [{
        documentId: "doc-1",
        entityType: "issue",
        entityId: "CLO-1",
        weight: 2,
      }],
      generatedAt: "2026-03-13T00:00:00.000Z",
    })).toMatchObject({
      summary: {
        projectNodeCount: 1,
        documentNodeCount: 1,
        entityNodeCount: 1,
        edgeCount: 2,
      },
      nodes: expect.arrayContaining([
        expect.objectContaining({ id: "project:project-1", kind: "project" }),
        expect.objectContaining({ id: "document:doc-1", kind: "document" }),
        expect.objectContaining({ id: "entity:issue:CLO-1", kind: "entity" }),
      ]),
    });

    expect(buildKnowledgeQualityDailyTrend({
      now: new Date("2026-03-13T00:00:00.000Z"),
      days: 2,
      samples: [{
        createdAt: new Date("2026-03-13T10:00:00.000Z"),
        lowConfidence: true,
        graphExpanded: true,
        multiHopGraphExpanded: false,
        candidateCacheHit: true,
        finalCacheHit: false,
        personalized: true,
        reused: true,
        actorRole: "engineer",
        issueProjectId: "project-1",
        topHitSourceType: "code",
        candidateCacheReason: "fresh",
        finalCacheReason: "miss",
        candidateCacheProvenance: "candidate_cache",
        finalCacheProvenance: "recompute",
      }],
    } as never)).toEqual([
      expect.objectContaining({
        date: "2026-03-12",
        totalRuns: 0,
      }),
      expect.objectContaining({
        date: "2026-03-13",
        totalRuns: 1,
        lowConfidenceRuns: 1,
        graphExpandedRuns: 1,
        candidateCacheHits: 1,
        personalizedRuns: 1,
        reuseRuns: 1,
        roleCounts: { engineer: 1 },
        projectCounts: { "project-1": 1 },
        topHitSourceTypeCounts: { code: 1 },
      }),
    ]);
  });
});
