import {
  issueMergeCandidates,
  issueProtocolArtifacts,
  issueProtocolMessages,
  issues,
  knowledgeChunkLinks,
  knowledgeChunks,
  knowledgeDocumentVersions,
  knowledgeDocuments,
} from "@squadrail/db";
import { describe, expect, it } from "vitest";
import {
  asNumberRecord,
  asRecord,
  asStringArray,
  buildCombinedGraphMetrics,
  buildRecipientBriefEvidenceSummary,
  buildRecipientFinalizationMetrics,
  buildRecipientRetrievalHint,
  buildRetrievalBriefDraft,
  buildRetrievalRunCompletionActivityDetails,
  buildRetrievalRunCompletionEvents,
  buildTaskBriefContentJson,
  computeGraphConnectivityBoost,
  computeLinkBoost,
  computeTemporalBoost,
  computeCosineSimilarity,
  dbVectorLiteral,
  deriveRetrievalTemporalContext,
  defaultPolicyTemplate,
  listBacklinkedRelatedIssueIds,
  listDocumentVersionsForRetrieval,
  listRelatedIssueIdentifierMap,
  listRelatedIssueIdsByIdentifiers,
  normalizeEmbeddingVector,
  readConfiguredNumber,
  readMetadataString,
  renderRetrievedBriefMarkdown,
  resolveRelatedIssueSignals,
  resolveLaneAwareRetrievalPolicy,
  resolveRetrievalPolicyRerankConfig,
  shouldEscalateGraphSeed,
  type RetrievalHitView,
} from "../services/issue-retrieval.js";

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
    innerJoin: () => chain,
    leftJoin: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    then: <T>(resolve: (value: unknown[]) => T | PromiseLike<T>) =>
      Promise.resolve(shiftTableRows(selectRows, selectedTable)).then(resolve),
  };
  return chain;
}

function createIssueRetrievalDbMock(selectRows: Map<unknown, unknown[][]>) {
  return {
    select: () => createResolvedChain(selectRows),
  };
}

function makeHit(overrides: Partial<RetrievalHitView> = {}): RetrievalHitView {
  return {
    chunkId: "chunk-1",
    documentId: "doc-1",
    sourceType: "code",
    authorityLevel: "canonical",
    documentIssueId: null,
    documentProjectId: "project-1",
    path: "src/retry.ts",
    title: "Retry",
    headingPath: null,
    symbolName: "retryWorker",
    textContent: "retry worker implementation",
    documentMetadata: {},
    chunkMetadata: {},
    denseScore: 0.6,
    sparseScore: 0.4,
    rerankScore: 0.7,
    fusedScore: 1.2,
    updatedAt: new Date("2026-03-13T00:00:00.000Z"),
    modelRerankRank: null,
    graphMetadata: null,
    temporalMetadata: null,
    personalizationMetadata: null,
    saturationMetadata: null,
    diversityMetadata: null,
    ...overrides,
  };
}

describe("issue retrieval internal helpers", () => {
  it("normalizes metadata records, arrays, vectors, and configured numbers", () => {
    expect(asRecord({ quality: "high" })).toEqual({ quality: "high" });
    expect(asRecord([])).toBeNull();

    expect(asStringArray(["code", " code ", "", "test_report", 3])).toEqual(["code", "test_report"]);
    expect(asNumberRecord({ code: 1, review: 2, bad: "x", nan: Number.NaN })).toEqual({
      code: 1,
      review: 2,
    });

    expect(readConfiguredNumber(4, 1)).toBe(4);
    expect(readConfiguredNumber("bad", 1)).toBe(1);
    expect(dbVectorLiteral("1,2'3")).toBe("'1,2''3'");
    expect(normalizeEmbeddingVector([1, "2", "bad", 3])).toEqual([1, 2, 3]);
    expect(normalizeEmbeddingVector("bad")).toBeNull();
  });

  it("builds default policies and lane-aware retrieval policy adjustments", () => {
    const reviewerPolicy = defaultPolicyTemplate({
      role: "reviewer",
      eventType: "on_review_submit",
      workflowState: "submitted_for_review",
    });
    expect(reviewerPolicy.finalK).toBe(8);
    expect(reviewerPolicy.allowedSourceTypes).toContain("review");
    expect(reviewerPolicy.allowedSourceTypes).toEqual(expect.arrayContaining(["code_summary", "symbol_summary"]));

    const rerankConfig = resolveRetrievalPolicyRerankConfig({
      allowedSourceTypes: ["code", "review"],
      metadata: {
        modelRerank: {
          enabled: true,
          candidateCount: 3,
        },
      },
    });

    expect(resolveLaneAwareRetrievalPolicy({
      lane: "fast",
      policy: reviewerPolicy,
      rerankConfig,
    })).toMatchObject({
      lane: "fast",
      topKDense: 8,
      topKSparse: 8,
      rerankK: 10,
      finalK: 4,
      modelRerankCandidateCount: 3,
    });

    expect(resolveLaneAwareRetrievalPolicy({
      lane: "deep",
      policy: reviewerPolicy,
      rerankConfig,
    })).toMatchObject({
      lane: "deep",
      topKDense: 24,
      topKSparse: 24,
      rerankK: 28,
      finalK: 10,
      modelRerankCandidateCount: 8,
    });
  });

  it("escalates graph seeds only for strong direct path or symbol signals", () => {
    expect(shouldEscalateGraphSeed({
      entityType: "path",
      currentSeed: {
        entityType: "path",
        entityId: "src/retry.ts",
        seedReasons: ["signal_exact_path"],
        weight: 1,
      },
      linkReason: "protocol_changed_path",
      linkWeight: 0.9,
    })).toBe(true);

    expect(shouldEscalateGraphSeed({
      entityType: "path",
      currentSeed: {
        entityType: "path",
        entityId: "src/retry.ts",
        seedReasons: ["issue_context"],
        weight: 1,
      },
      linkReason: "protocol_changed_path",
      linkWeight: 0.9,
    })).toBe(false);

    expect(shouldEscalateGraphSeed({
      entityType: "issue",
      currentSeed: {
        entityType: "issue",
        entityId: "issue-1",
        seedReasons: ["signal_exact_path"],
        weight: 1,
      },
      linkReason: "protocol_changed_path",
      linkWeight: 0.9,
    })).toBe(false);
  });

  it("reads metadata strings and computes temporal boost variants", () => {
    expect(readMetadataString({ branchName: " main " }, "branchName")).toBe("main");
    expect(readMetadataString({ branchName: "   " }, "branchName")).toBeNull();

    const weights = resolveRetrievalPolicyRerankConfig({
      allowedSourceTypes: ["code"],
      metadata: null,
    }).weights;

    expect(computeTemporalBoost({
      hit: makeHit(),
      temporalContext: null,
      versions: [],
      weights,
    })).toMatchObject({
      score: 0,
      metadata: {
        matchType: "none",
      },
    });

    expect(computeTemporalBoost({
      hit: makeHit(),
      temporalContext: {
        branchName: "feature/retry",
        defaultBranchName: "main",
        headSha: "sha-exact",
        source: "artifact",
      },
      versions: [{
        documentId: "doc-1",
        branchName: "feature/retry",
        defaultBranchName: "main",
        commitSha: "sha-exact",
        parentCommitSha: null,
        isHead: true,
        isDefaultBranch: false,
        capturedAt: new Date("2026-03-13T00:00:00.000Z"),
        metadata: {},
      }],
      weights,
    })).toMatchObject({
      score: weights.temporalExactCommitBoost,
      metadata: {
        matchType: "exact_commit",
      },
    });

    expect(computeTemporalBoost({
      hit: makeHit(),
      temporalContext: {
        branchName: "feature/retry",
        defaultBranchName: "main",
        headSha: null,
        source: "artifact",
      },
      versions: [{
        documentId: "doc-1",
        branchName: "feature/retry",
        defaultBranchName: "main",
        commitSha: "sha-branch",
        parentCommitSha: null,
        isHead: true,
        isDefaultBranch: false,
        capturedAt: new Date("2026-03-13T00:00:00.000Z"),
        metadata: {},
      }],
      weights,
    })).toMatchObject({
      score: weights.temporalSameBranchHeadBoost,
      metadata: {
        matchType: "same_branch_head",
      },
    });

    expect(computeTemporalBoost({
      hit: makeHit(),
      temporalContext: {
        branchName: "feature/retry",
        defaultBranchName: "main",
        headSha: null,
        source: "artifact",
      },
      versions: [{
        documentId: "doc-1",
        branchName: "feature/retry",
        defaultBranchName: "main",
        commitSha: "sha-stale",
        parentCommitSha: null,
        isHead: false,
        isDefaultBranch: false,
        capturedAt: new Date("2026-03-13T00:00:00.000Z"),
        metadata: {},
      }],
      weights,
    })).toMatchObject({
      score: weights.temporalStalePenalty,
      metadata: {
        matchType: "same_branch_stale",
        stale: true,
      },
    });

    expect(computeTemporalBoost({
      hit: makeHit(),
      temporalContext: {
        branchName: "feature/retry",
        defaultBranchName: "main",
        headSha: null,
        source: "merge_candidate",
      },
      versions: [{
        documentId: "doc-1",
        branchName: "main",
        defaultBranchName: "main",
        commitSha: "sha-main",
        parentCommitSha: null,
        isHead: true,
        isDefaultBranch: true,
        capturedAt: new Date("2026-03-13T00:00:00.000Z"),
        metadata: {},
      }],
      weights,
    })).toMatchObject({
      score: weights.temporalDefaultBranchBoost,
      metadata: {
        matchType: "default_branch_head",
      },
    });

    expect(computeTemporalBoost({
      hit: makeHit(),
      temporalContext: {
        branchName: "feature/retry",
        defaultBranchName: "main",
        headSha: null,
        source: "merge_candidate",
      },
      versions: [{
        documentId: "doc-1",
        branchName: "release/1.0",
        defaultBranchName: "main",
        commitSha: "sha-foreign",
        parentCommitSha: null,
        isHead: false,
        isDefaultBranch: false,
        capturedAt: new Date("2026-03-13T00:00:00.000Z"),
        metadata: {},
      }],
      weights,
    })).toMatchObject({
      score: weights.temporalForeignBranchPenalty,
      metadata: {
        matchType: "foreign_branch",
      },
    });
  });

  it("computes related link and graph connectivity boosts", () => {
    const rerankConfig = resolveRetrievalPolicyRerankConfig({
      allowedSourceTypes: ["code"],
      metadata: null,
    });

    expect(computeLinkBoost({
      hit: makeHit(),
      links: [
        { entityType: "issue", entityId: "issue-1", linkReason: "issue", weight: 1 },
        { entityType: "issue", entityId: "issue-2", linkReason: "issue", weight: 2 },
        { entityType: "project", entityId: "project-1", linkReason: "project", weight: 1 },
        { entityType: "project", entityId: "project-2", linkReason: "project", weight: 1 },
        { entityType: "path", entityId: "src/retry.ts", linkReason: "path", weight: 1.5 },
      ],
      issueId: "issue-1",
      projectId: "project-1",
      projectAffinityIds: ["project-2"],
      signals: {
        preferredSourceTypes: ["code"],
        exactPaths: ["src/retry.ts"],
        symbolHints: [],
        tagHints: [],
        relatedIssueIds: ["issue-2"],
        relatedIssueIdentifiers: [],
        linkedIssueIds: [],
        linkedProjectIds: [],
        projectAffinityIds: ["project-1", "project-2"],
        changedPaths: [],
        issueIdentifier: "CLO-1",
      },
      weights: rerankConfig.weights,
    } as Parameters<typeof computeLinkBoost>[0])).toBe(rerankConfig.weights.linkBoostCap);

    expect(computeGraphConnectivityBoost({
      hit: makeHit({
        graphMetadata: {
          entityTypes: ["symbol"],
          entityIds: ["retryWorker"],
          seedReasons: ["signal_symbol_hint"],
          graphScore: 1,
          hopDepth: 3,
        },
      }),
      signals: {
        preferredSourceTypes: ["code"],
        exactPaths: [],
        symbolHints: [],
        tagHints: [],
        relatedIssueIds: [],
        relatedIssueIdentifiers: [],
        linkedIssueIds: [],
        linkedProjectIds: [],
        projectAffinityIds: ["project-1", "project-2"],
        changedPaths: [],
        issueIdentifier: "CLO-1",
      },
      weights: rerankConfig.weights,
    } as Parameters<typeof computeGraphConnectivityBoost>[0])).toBeGreaterThan(0);

    expect(computeGraphConnectivityBoost({
      hit: makeHit({
        sourceType: "issue",
        graphMetadata: {
          entityTypes: ["issue"],
          entityIds: ["issue-1"],
          seedReasons: ["issue_context"],
          graphScore: 1,
          hopDepth: 1,
        },
      }),
      signals: {
        preferredSourceTypes: ["issue"],
        exactPaths: [],
        symbolHints: [],
        tagHints: [],
        relatedIssueIds: [],
        relatedIssueIdentifiers: [],
        linkedIssueIds: [],
        linkedProjectIds: [],
        projectAffinityIds: ["project-1"],
        changedPaths: [],
        issueIdentifier: "CLO-1",
      },
      weights: rerankConfig.weights,
    } as Parameters<typeof computeGraphConnectivityBoost>[0])).toBe(0);
  });

  it("lists document versions and derives retrieval temporal context fallbacks", async () => {
    const db = createIssueRetrievalDbMock(new Map([
      [knowledgeDocumentVersions, [[
        {
          documentId: "doc-1",
          branchName: "main",
          defaultBranchName: "main",
          commitSha: "sha-1",
          parentCommitSha: null,
          isHead: true,
          isDefaultBranch: true,
          capturedAt: new Date("2026-03-13T00:00:00.000Z"),
          metadata: { source: "sync" },
        },
        {
          documentId: "doc-1",
          branchName: "feature/retry",
          defaultBranchName: "main",
          commitSha: "sha-2",
          parentCommitSha: "sha-1",
          isHead: false,
          isDefaultBranch: false,
          capturedAt: new Date("2026-03-12T00:00:00.000Z"),
          metadata: null,
        },
      ], []]],
      [issueProtocolArtifacts, [[
        {
          kind: "diff",
          metadata: {
            branchName: "feature/retry",
            defaultBranchName: "main",
            headSha: "sha-head",
          },
          seq: 7,
        },
      ], []]],
      [issueMergeCandidates, [[
        {
          sourceBranch: "feature/merge-candidate",
          headSha: "sha-merge",
          targetBaseBranch: "main",
        },
      ]]],
    ]));

    const versions = await listDocumentVersionsForRetrieval({
      db: db as never,
      companyId: "company-1",
      documentIds: ["doc-1"],
    });
    expect(versions.get("doc-1")).toHaveLength(2);
    expect(await listDocumentVersionsForRetrieval({
      db: db as never,
      companyId: "company-1",
      documentIds: [],
    })).toEqual(new Map());

    expect(await deriveRetrievalTemporalContext({
      db: db as never,
      companyId: "company-1",
      issueId: "issue-1",
      issueProjectId: "project-1",
      currentMessageSeq: 9,
    })).toEqual({
      branchName: "feature/retry",
      defaultBranchName: "main",
      headSha: "sha-head",
      source: "artifact",
    });

    expect(await deriveRetrievalTemporalContext({
      db: createIssueRetrievalDbMock(new Map([
        [issueProtocolArtifacts, [[]]],
        [issueMergeCandidates, [[
          {
            sourceBranch: "feature/merge-candidate",
            headSha: "sha-merge",
            targetBaseBranch: "main",
          },
        ]]],
      ])) as never,
      companyId: "company-1",
      issueId: "issue-1",
      issueProjectId: null,
      currentMessageSeq: 9,
    })).toEqual({
      branchName: "feature/merge-candidate",
      defaultBranchName: "main",
      headSha: "sha-merge",
      source: "merge_candidate",
    });

    expect(await deriveRetrievalTemporalContext({
      db: createIssueRetrievalDbMock(new Map([
        [issueProtocolArtifacts, [[]]],
        [issueMergeCandidates, [[null]]],
        [knowledgeDocumentVersions, [[
          {
            branchName: "main",
            defaultBranchName: "main",
          },
        ]]],
      ])) as never,
      companyId: "company-1",
      issueId: "issue-1",
      issueProjectId: "project-1",
      currentMessageSeq: 9,
    })).toEqual({
      branchName: null,
      defaultBranchName: "main",
      headSha: null,
      source: "default_branch",
    });
  });

  it("resolves related issue identifier and backlink signals", async () => {
    const db = createIssueRetrievalDbMock(new Map([
      [issues, [[
        { id: "issue-2", identifier: "CLO-2" },
        { id: "issue-3", identifier: null },
      ], [
        { id: "issue-4", identifier: "CLO-4" },
      ]]],
      [knowledgeChunkLinks, [[
        { documentIssueId: "issue-5" },
        { documentIssueId: "issue-5" },
      ]]],
    ]));

    expect(await listRelatedIssueIdentifierMap({
      db: db as never,
      companyId: "company-1",
      issueIds: ["issue-2", "issue-3", "issue-2"],
    })).toEqual({
      "issue-2": "CLO-2",
      "issue-3": "issue-3",
    });

    expect(await listRelatedIssueIdsByIdentifiers({
      db: db as never,
      companyId: "company-1",
      identifiers: [" clo-4 ", "CLO-4", ""],
    })).toEqual({
      "issue-4": "CLO-4",
    });

    expect(await listBacklinkedRelatedIssueIds({
      db: db as never,
      companyId: "company-1",
      issueId: "issue-1",
    })).toEqual(["issue-5"]);

    expect(await resolveRelatedIssueSignals({
      db: createIssueRetrievalDbMock(new Map([
        [issues, [[
          { id: "issue-4", identifier: "CLO-4" },
        ]]],
      ])) as never,
      companyId: "company-1",
      issueId: "issue-1",
      issueIdentifier: "CLO-1",
      signals: {
        preferredSourceTypes: ["code"],
        exactPaths: [],
        symbolHints: [],
        tagHints: [],
        relatedIssueIds: ["issue-2"],
        relatedIssueIdentifiers: [" clo-1 ", "CLO-4"],
        linkedIssueIds: [],
        linkedProjectIds: [],
        projectAffinityIds: ["project-1"],
        changedPaths: [],
        issueIdentifier: "CLO-1",
      },
      backlinkedIssueIds: ["issue-3"],
    })).toMatchObject({
      preferredSourceTypes: ["review", "protocol_message", "issue", "code"],
      relatedIssueIds: ["issue-2", "issue-4", "issue-3"],
      relatedIssueIdentifiers: ["CLO-4"],
    });
  });

  it("computes cosine similarity and renders markdown retrieval briefs", () => {
    expect(computeCosineSimilarity([1, 0], [1, 0])).toBe(1);
    expect(computeCosineSimilarity([1, 0], [0, 1])).toBe(0);
    expect(computeCosineSimilarity([1, 0], [1])).toBe(0);

    expect(renderRetrievedBriefMarkdown({
      briefScope: "engineer",
      issue: {
        identifier: "CLO-9",
        title: "Fix retry worker",
      },
      message: {
        messageType: "ASSIGN_TASK",
        workflowStateBefore: "todo",
        workflowStateAfter: "assigned",
        summary: "Implement retry worker",
      } as never,
      queryText: "retry worker implementation",
      hits: [],
    })).toContain("_No knowledge hits were selected for this brief yet._");

    const markdown = renderRetrievedBriefMarkdown({
      briefScope: "reviewer",
      issue: {
        identifier: "CLO-10",
        title: "Review retry patch",
      },
      message: {
        messageType: "SUBMIT_FOR_REVIEW",
        workflowStateBefore: "implementing",
        workflowStateAfter: "submitted_for_review",
        summary: "Ready for review",
      } as never,
      queryText: "review retry patch",
      hits: [makeHit({
        graphMetadata: {
          entityTypes: ["symbol"],
          entityIds: ["retryWorker"],
          seedReasons: ["signal_symbol_hint"],
          edgeTypes: ["calls"],
          graphScore: 1,
          hopDepth: 2,
        },
        temporalMetadata: {
          branchName: "feature/retry",
          defaultBranchName: "main",
          commitSha: "sha-1",
          matchType: "same_branch_head",
          score: 1,
          stale: false,
        },
        personalizationMetadata: {
          totalBoost: 0.5,
          sourceTypeBoost: 0.5,
          pathBoost: 0,
          symbolBoost: 0,
          scopes: ["source_type"],
          matchedSourceType: "code",
          matchedPath: null,
          matchedSymbol: null,
        },
      })],
    });

    expect(markdown).toContain("[code/canonical] Retry");
    expect(markdown).toContain("graph edges: calls");
    expect(markdown).toContain("version: same_branch_head");
    expect(markdown).toContain("personalization: 0.500");
  });

  it("builds retrieval completion helper payloads and finalization metrics", () => {
    const hit = makeHit({
      graphMetadata: {
        entityTypes: ["path"],
        entityIds: ["src/retry.ts"],
        seedReasons: ["signal_exact_path"],
        graphScore: 1,
        hopDepth: 2,
      },
    });

    expect(buildRecipientBriefEvidenceSummary({
      hits: [hit],
      maxEvidenceItems: 3,
    })).toEqual([{
      rank: 1,
      sourceType: "code",
      authorityLevel: "canonical",
      path: "src/retry.ts",
      title: "Retry",
      symbolName: "retryWorker",
      fusedScore: 1.2,
    }]);

    expect(buildRetrievalRunCompletionActivityDetails({
      retrievalRunId: "run-1",
      triggeringMessageId: "message-1",
      recipientRole: "engineer",
      recipientId: "agent-1",
      hitCount: 1,
      briefQuality: {
        confidenceLevel: "high",
        denseEnabled: true,
      },
      briefId: "brief-1",
      briefScope: "engineer",
    } as never)).toMatchObject({
      retrievalRunId: "run-1",
      briefQuality: "high",
      briefDenseEnabled: true,
    });

    expect(buildRetrievalRunCompletionEvents({
      companyId: "company-1",
      issueId: "issue-1",
      retrievalRunId: "run-1",
      recipientRole: "engineer",
      recipientId: "agent-1",
      hitCount: 1,
      briefQuality: {
        confidenceLevel: "medium",
        denseEnabled: false,
      },
      briefId: "brief-1",
      briefScope: "engineer",
      briefVersion: 2,
    } as never)).toHaveLength(2);

    expect(buildRecipientRetrievalHint({
      recipientId: "agent-1",
      recipientRole: "engineer",
      executionLane: "fast",
      retrievalRunId: "run-1",
      briefId: "brief-1",
      briefScope: "engineer",
      briefContentMarkdown: "# brief",
      hits: [hit],
      maxEvidenceItems: 1,
    })).toMatchObject({
      recipientId: "agent-1",
      briefEvidenceSummary: [{ rank: 1, path: "src/retry.ts" }],
    });

    expect(buildTaskBriefContentJson({
      eventType: "on_assignment",
      triggeringMessageId: "message-1",
      executionLane: "fast",
      queryText: "retry worker",
      dynamicSignals: {
        preferredSourceTypes: ["code"],
        exactPaths: ["src/retry.ts"],
        symbolHints: ["retryWorker"],
        tagHints: [],
        relatedIssueIds: [],
        relatedIssueIdentifiers: [],
        linkedIssueIds: [],
        linkedProjectIds: [],
        projectAffinityIds: ["project-1"],
        changedPaths: ["src/retry.ts"],
        issueIdentifier: "CLO-1",
      },
      quality: {
        confidenceLevel: "high",
      },
      hits: [hit],
    } as never)).toMatchObject({
      eventType: "on_assignment",
      hits: [{
        rank: 1,
        chunkId: "chunk-1",
        path: "src/retry.ts",
      }],
    });

    expect(buildRetrievalBriefDraft({
      eventType: "on_assignment",
      triggeringMessageId: "message-1",
      recipientRole: "engineer",
      issue: {
        identifier: "CLO-1",
        title: "Fix retry worker",
      },
      message: {
        messageType: "ASSIGN_TASK",
        workflowStateBefore: "todo",
        workflowStateAfter: "assigned",
        summary: "Implement retry worker",
      } as never,
      queryText: "retry worker",
      executionLane: "fast",
      dynamicSignals: {
        preferredSourceTypes: ["code"],
        exactPaths: ["src/retry.ts"],
        symbolHints: ["retryWorker"],
        tagHints: [],
        relatedIssueIds: [],
        relatedIssueIdentifiers: [],
        linkedIssueIds: [],
        linkedProjectIds: [],
        projectAffinityIds: ["project-1"],
        changedPaths: ["src/retry.ts"],
        issueIdentifier: "CLO-1",
      },
      quality: {
        confidenceLevel: "high",
      },
      hits: [hit],
      maxEvidenceItems: 1,
    } as never)).toMatchObject({
      briefScope: "engineer",
      contentMarkdown: expect.stringContaining("# engineer brief"),
      contentJson: expect.objectContaining({
        queryText: "retry worker",
      }),
    });

    expect(buildCombinedGraphMetrics({
      hits: [],
      edgeTraversalCount: 2,
      edgeTypeCounts: { calls: 2 },
      graphMaxDepth: 2,
      graphHopDepthCounts: { "2": 1 },
    }, {
      hits: [hit],
      edgeTraversalCount: 1,
      edgeTypeCounts: { imports: 1 },
      graphMaxDepth: 3,
      graphHopDepthCounts: { "3": 1 },
    })).toEqual({
      combinedGraphHopDepthCounts: {
        "2": 1,
        "3": 1,
      },
      combinedGraphMaxDepth: 3,
    });

    expect(buildRecipientFinalizationMetrics({
      finalHits: [hit],
      chunkGraphResult: {
        hits: [],
        edgeTraversalCount: 2,
        edgeTypeCounts: { calls: 2 },
        graphMaxDepth: 2,
        graphHopDepthCounts: { "2": 1 },
      },
      symbolGraphResult: {
        hits: [hit],
        edgeTraversalCount: 1,
        edgeTypeCounts: { imports: 1 },
        graphMaxDepth: 3,
        graphHopDepthCounts: { "3": 1 },
      },
      exactPaths: ["src/retry.ts"],
    })).toMatchObject({
      symbolGraphHitCount: 1,
      edgeTraversalCount: 3,
      graphMaxDepth: 3,
      exactPathSatisfied: true,
    });
  });
});
