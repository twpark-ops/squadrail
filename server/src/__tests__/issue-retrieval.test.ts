import { describe, expect, it } from "vitest";
import {
  applyEvidenceDiversityGuard,
  applyGraphConnectivityGuard,
  applyPersonalizationSignals,
  applyOrganizationalBridgeGuard,
  applyModelRerankOrder,
  applyOrganizationalMemorySaturationGuard,
  buildKnowledgeRevisionSignature,
  buildQueryEmbeddingCacheKey,
  deserializeRetrievalHit,
  buildGraphExpansionSeeds,
  buildSymbolGraphExpandedHits,
  buildSymbolGraphExpansionSeeds,
  buildRetrievalQueryText,
  computeRetrievalReuseSummary,
  computeCosineSimilarity,
  deriveSemanticGraphHopDepth,
  shouldAllowGraphExactPathRediscovery,
  deriveDynamicRetrievalSignals,
  deriveBriefScope,
  deriveRetrievalEventType,
  fuseRetrievalCandidates,
  mergeGraphExpandedHits,
  readCachedBriefQualitySummary,
  readCachedEmbedding,
  readCachedRetrievalHits,
  readRetrievalCacheIdentityView,
  readRetrievalCachePayload,
  resolveRetrievalPolicyRerankConfig,
  resolveRetrievalCacheHitProvenance,
  rerankRetrievalHits,
  renderRetrievedBriefMarkdown,
  serializeRetrievalCachePayload,
  serializeRetrievalHit,
  selectProtocolRetrievalRecipients,
} from "../services/issue-retrieval.js";
import { buildHitRationale } from "../services/retrieval/scoring.js";

describe("issue retrieval helpers", () => {
  it("builds a stable query embedding cache key", () => {
    const first = buildQueryEmbeddingCacheKey({
      queryText: "Find retry worker implementation",
      embeddingFingerprint: "openai:text-embedding-3-small:1536",
    });
    const second = buildQueryEmbeddingCacheKey({
      queryText: "Find retry worker implementation",
      embeddingFingerprint: "openai:text-embedding-3-small:1536",
    });
    const different = buildQueryEmbeddingCacheKey({
      queryText: "Find retry worker tests",
      embeddingFingerprint: "openai:text-embedding-3-small:1536",
    });

    expect(first).toBe(second);
    expect(first).not.toBe(different);
  });

  it("normalizes cached embedding payloads and drops empty vectors", () => {
    expect(readCachedEmbedding({
      embedding: ["1", 2, "bad", 3],
      provider: "openai",
      model: "text-embedding-3-small",
      dimensions: 3,
      totalTokens: 42,
    })).toEqual({
      embedding: [1, 2, 3],
      provider: "openai",
      model: "text-embedding-3-small",
      dimensions: 3,
      totalTokens: 42,
    });

    expect(readCachedEmbedding({
      embedding: ["bad"],
    })).toBeNull();
  });

  it("serializes and deserializes retrieval hits with cache-safe timestamps", () => {
    const hit = {
      chunkId: "chunk-1",
      documentId: "doc-1",
      sourceType: "code",
      authorityLevel: "canonical",
      documentIssueId: "issue-1",
      documentProjectId: "project-1",
      path: "server/src/runtime.ts",
      title: "Runtime",
      headingPath: "Runtime > Retry",
      symbolName: "retryLoop",
      textContent: "retry loop implementation",
      documentMetadata: { repoRef: "github.com/acme/app" },
      chunkMetadata: { language: "ts" },
      denseScore: 0.8,
      sparseScore: 0.4,
      rerankScore: 0.9,
      fusedScore: 1.2,
      updatedAt: new Date("2026-03-13T09:00:00.000Z"),
      modelRerankRank: 1,
      graphMetadata: null,
      temporalMetadata: null,
      personalizationMetadata: null,
      saturationMetadata: null,
      diversityMetadata: null,
    } satisfies Parameters<typeof serializeRetrievalHit>[0];

    const serialized = serializeRetrievalHit(hit);
    expect(serialized.updatedAt).toBe("2026-03-13T09:00:00.000Z");
    expect(deserializeRetrievalHit(serialized)).toEqual(hit);
    expect(deserializeRetrievalHit({ chunkId: "broken" })).toBeNull();
  });

  it("hydrates cached retrieval payloads, quality, and identity views", () => {
    const payload = serializeRetrievalCachePayload({
      hits: [
        {
          chunkId: "chunk-1",
          documentId: "doc-1",
          sourceType: "code",
          authorityLevel: "canonical",
          documentIssueId: null,
          documentProjectId: "project-1",
          path: "server/src/runtime.ts",
          title: null,
          headingPath: null,
          symbolName: null,
          textContent: "runtime",
          documentMetadata: {},
          chunkMetadata: {},
          denseScore: null,
          sparseScore: null,
          rerankScore: null,
          fusedScore: 1,
          updatedAt: new Date("2026-03-13T09:10:00.000Z"),
          modelRerankRank: null,
          graphMetadata: null,
          temporalMetadata: null,
          personalizationMetadata: null,
          saturationMetadata: null,
          diversityMetadata: null,
        },
      ],
      quality: { confidenceLevel: "high" },
      metadata: {
        queryFingerprint: "query-1",
        policyFingerprint: "policy-1",
        feedbackFingerprint: "feedback-1",
        revisionSignature: "revision-1",
      },
    });

    expect(readCachedRetrievalHits(payload)).toMatchObject({
      hits: [expect.objectContaining({ chunkId: "chunk-1" })],
      quality: { confidenceLevel: "high" },
      metadata: expect.objectContaining({ queryFingerprint: "query-1" }),
    });
    expect(readRetrievalCachePayload(payload)).toMatchObject({
      hits: [expect.objectContaining({ chunkId: "chunk-1" })],
    });
    expect(readRetrievalCacheIdentityView(payload.metadata)).toEqual({
      queryFingerprint: "query-1",
      policyFingerprint: "policy-1",
      feedbackFingerprint: "feedback-1",
      revisionSignature: "revision-1",
    });
  });

  it("reads cached brief quality summaries and cache provenance", () => {
    expect(readCachedBriefQualitySummary({
      confidenceLevel: "medium",
      evidenceCount: 3,
      candidateCacheHit: true,
      candidateCacheReason: "hit",
      candidateCacheProvenance: "normalized_input",
      finalCacheHit: false,
      finalCacheReason: "miss_feedback_changed",
      finalCacheProvenance: "feedback_drift",
      reusedIssueIds: ["issue-1"],
      degradedReasons: ["cache_miss"],
    })).toMatchObject({
      confidenceLevel: "medium",
      evidenceCount: 3,
      candidateCacheHit: true,
      candidateCacheReason: "hit",
      finalCacheReason: "miss_feedback_changed",
      reusedIssueIds: ["issue-1"],
      degradedReasons: ["cache_miss"],
    });

    expect(resolveRetrievalCacheHitProvenance({
      requestedCacheKey: "a",
      matchedCacheKey: "a",
      requestedFeedbackFingerprint: "f1",
      matchedFeedbackFingerprint: "f1",
    })).toBe("exact_key");
    expect(resolveRetrievalCacheHitProvenance({
      requestedCacheKey: "a",
      matchedCacheKey: "b",
      requestedFeedbackFingerprint: "f1",
      matchedFeedbackFingerprint: "f2",
    })).toBe("feedback_drift");
    expect(resolveRetrievalCacheHitProvenance({
      requestedCacheKey: "a",
      matchedCacheKey: "b",
      requestedFeedbackFingerprint: "f1",
      matchedFeedbackFingerprint: "f1",
    })).toBe("normalized_input");
  });

  it("builds a stable knowledge revision signature from ordered project affinity", () => {
    const first = buildKnowledgeRevisionSignature({
      companyId: "company-1",
      issueProjectId: "project-1",
      projectAffinityIds: ["project-2", "project-1"],
      revisions: [
        { projectId: "project-1", revision: 4, lastHeadSha: "sha-1", lastTreeSignature: "tree-1" },
        { projectId: "project-2", revision: 2, lastHeadSha: "sha-2", lastTreeSignature: "tree-2" },
      ],
    });
    const second = buildKnowledgeRevisionSignature({
      companyId: "company-1",
      issueProjectId: "project-1",
      projectAffinityIds: ["project-2", "project-1"],
      revisions: [
        { projectId: "project-1", revision: 4, lastHeadSha: "sha-1", lastTreeSignature: "tree-1" },
        { projectId: "project-2", revision: 2, lastHeadSha: "sha-2", lastTreeSignature: "tree-2" },
      ],
    });
    const changed = buildKnowledgeRevisionSignature({
      companyId: "company-1",
      issueProjectId: "project-1",
      projectAffinityIds: ["project-2", "project-1"],
      revisions: [
        { projectId: "project-1", revision: 5, lastHeadSha: "sha-1", lastTreeSignature: "tree-1" },
        { projectId: "project-2", revision: 2, lastHeadSha: "sha-2", lastTreeSignature: "tree-2" },
      ],
    });

    expect(first).toBe(second);
    expect(first).not.toBe(changed);
  });

  it("treats issue-context and changed-path seeds as semantic multi-hop evidence", () => {
    expect(
      deriveSemanticGraphHopDepth({
        traversalHopDepth: 1,
        seedReasons: ["top_hit_changed_path"],
      }),
    ).toBe(2);
    expect(
      deriveSemanticGraphHopDepth({
        traversalHopDepth: 1,
        seedReasons: ["top_hit_issue_context"],
      }),
    ).toBe(2);
    expect(
      deriveSemanticGraphHopDepth({
        traversalHopDepth: 1,
        seedReasons: ["top_hit_path"],
      }),
    ).toBe(1);
  });

  it("allows exact-path rediscovery only for deeper graph hops driven by organizational context", () => {
    expect(
      shouldAllowGraphExactPathRediscovery({
        hopDepth: 2,
        seeds: [
          {
            entityType: "path",
            entityId: "internal/storage/path.go",
            seedBoost: 1.2,
            seedReasons: ["graph_hop:protocol_changed_path"],
          },
        ],
      }),
    ).toBe(true);

    expect(
      shouldAllowGraphExactPathRediscovery({
        hopDepth: 2,
        seeds: [
          {
            entityType: "path",
            entityId: "internal/storage/path.go",
            seedBoost: 1.2,
            seedReasons: ["top_hit_path"],
          },
        ],
      }),
    ).toBe(false);

    expect(
      shouldAllowGraphExactPathRediscovery({
        hopDepth: 1,
        seeds: [
          {
            entityType: "path",
            entityId: "internal/storage/path.go",
            seedBoost: 1.2,
            seedReasons: ["graph_hop:protocol_changed_path"],
          },
        ],
      }),
    ).toBe(false);
  });

  it("maps protocol messages to retrieval events", () => {
    expect(deriveRetrievalEventType("ASSIGN_TASK")).toBe("on_assignment");
    expect(deriveRetrievalEventType("REASSIGN_TASK")).toBe("on_assignment");
    expect(deriveRetrievalEventType("SUBMIT_FOR_REVIEW")).toBe("on_review_submit");
    expect(deriveRetrievalEventType("NOTE")).toBeNull();
  });

  it("filters unrelated personalization paths when direct exact paths already exist", () => {
    const signals = applyPersonalizationSignals({
      signals: {
        exactPaths: ["internal/storage/path.go", "internal/storage/path_test.go"],
        fileNames: ["path.go", "path_test.go"],
        symbolHints: ["SafeJoin"],
        knowledgeTags: [],
        preferredSourceTypes: ["code", "test_report", "review"],
        blockerCode: null,
        questionType: null,
        projectAffinityIds: ["project-1"],
        projectAffinityNames: ["swiftsight-agent"],
      },
      profile: {
        applied: true,
        scopes: ["project"],
        feedbackCount: 4,
        positiveFeedbackCount: 3,
        negativeFeedbackCount: 1,
        sourceTypeBoosts: { code: 0.2 },
        pathBoosts: {
          "internal/storage/path.go": 0.5,
          "internal/executor/executor.go": 0.7,
        },
        symbolBoosts: {
          SafeJoin: 0.1,
          executeTask: 0.2,
        },
      },
    });

    expect(signals.exactPaths).toContain("internal/storage/path.go");
    expect(signals.exactPaths).not.toContain("internal/executor/executor.go");
  });

  it("builds retrieval query text from issue and payload terms", () => {
    const query = buildRetrievalQueryText({
      issue: {
        identifier: "SW-101",
        title: "Improve retry policy",
        description: "Retry handling for post-processing worker",
        labels: [{ name: "backend" }, { name: "reliability" }],
      },
      recipientRole: "engineer",
      message: {
        messageType: "ASSIGN_TASK",
        sender: {
          actorType: "user",
          actorId: "board-1",
          role: "human_board",
        },
        recipients: [
          {
            recipientType: "agent",
            recipientId: "eng-1",
            role: "engineer",
          },
        ],
        workflowStateBefore: "backlog",
        workflowStateAfter: "assigned",
        summary: "Implement retry safety",
        payload: {
          goal: "Prevent duplicate processing",
          acceptanceCriteria: ["idempotency", "retry backoff"],
          definitionOfDone: ["tests added"],
          priority: "high",
          assigneeAgentId: "00000000-0000-0000-0000-000000000001",
          reviewerAgentId: "00000000-0000-0000-0000-000000000002",
        },
        artifacts: [],
      },
    });

    expect(query).toContain("SW-101");
    expect(query).toContain("Improve retry policy");
    expect(query).toContain("backend");
    expect(query).toContain("Prevent duplicate processing");
    expect(query).toContain("idempotency");
  });

  it("limits rendered brief evidence items with lane-aware cap", () => {
    const markdown = renderRetrievedBriefMarkdown({
      briefScope: "engineer",
      issue: {
        identifier: "SW-120",
        title: "Keep evidence focused",
      },
      message: {
        messageType: "ASSIGN_TASK",
        sender: {
          actorType: "user",
          actorId: "board-1",
          role: "human_board",
        },
        recipients: [
          {
            recipientType: "agent",
            recipientId: "eng-1",
            role: "engineer",
          },
        ],
        workflowStateBefore: "backlog",
        workflowStateAfter: "assigned",
        summary: "Keep evidence focused",
        payload: {
          goal: "Only the strongest evidence should surface in fast lane",
          acceptanceCriteria: ["focused brief"],
          definitionOfDone: ["brief is concise"],
          priority: "high",
          assigneeAgentId: "00000000-0000-0000-0000-000000000001",
          reviewerAgentId: "00000000-0000-0000-0000-000000000002",
        },
        artifacts: [],
      },
      queryText: "Focus on the strongest evidence only",
      maxEvidenceItems: 1,
      hits: [
        {
          chunkId: "chunk-1",
          documentId: "doc-1",
          sourceType: "code",
          authorityLevel: "working",
          documentIssueId: null,
          documentProjectId: "project-1",
          path: "src/retry.ts",
          title: "retry.ts",
          headingPath: null,
          symbolName: "retryWorker",
          textContent: "primary evidence",
          documentMetadata: {},
          chunkMetadata: {},
          denseScore: 0.9,
          sparseScore: 0.2,
          rerankScore: 1.2,
          fusedScore: 2.3,
          updatedAt: new Date("2026-03-01T00:00:00Z"),
        },
        {
          chunkId: "chunk-2",
          documentId: "doc-2",
          sourceType: "review",
          authorityLevel: "canonical",
          documentIssueId: "issue-1",
          documentProjectId: "project-1",
          path: "issues/CLO-1/review.md",
          title: "review.md",
          headingPath: null,
          symbolName: null,
          textContent: "secondary evidence",
          documentMetadata: {},
          chunkMetadata: {},
          denseScore: 0.7,
          sparseScore: 0.4,
          rerankScore: 1.1,
          fusedScore: 2.1,
          updatedAt: new Date("2026-03-01T00:00:00Z"),
        },
      ],
    });

    expect(markdown).toContain("1. [code/working] retry.ts");
    expect(markdown).not.toContain("2. [review/canonical] review.md");
  });

  it("builds graph expansion seeds from top hits and chunk links", () => {
    const seeds = buildGraphExpansionSeeds({
      hits: [
        {
          chunkId: "chunk-1",
          documentId: "doc-1",
          sourceType: "code",
          authorityLevel: "working",
          documentIssueId: null,
          documentProjectId: "project-worker",
          path: "worker/retry.ts",
          title: "Retry worker",
          headingPath: null,
          symbolName: "retryWorker",
          textContent: "retryWorker applies idempotency",
          documentMetadata: {},
          chunkMetadata: {},
          denseScore: 0.8,
          sparseScore: 0.3,
          rerankScore: 0.9,
          fusedScore: 2.1,
          updatedAt: new Date("2026-03-07T00:00:00Z"),
        },
      ],
      linkMap: new Map([
        ["chunk-1", [
          {
            chunkId: "chunk-1",
            entityType: "symbol",
            entityId: "retryWorker",
            linkReason: "workspace_import_symbol",
            weight: 0.8,
          },
          {
            chunkId: "chunk-1",
            entityType: "project",
            entityId: "project-worker",
            linkReason: "workspace_import_project",
            weight: 1,
          },
        ]],
      ]),
      signals: {
        exactPaths: ["worker/retry.ts"],
        fileNames: ["retry.ts"],
        symbolHints: ["retryWorker"],
        knowledgeTags: [],
        preferredSourceTypes: ["code", "adr"],
        projectAffinityIds: ["project-primary", "project-worker"],
        projectAffinityNames: ["swiftsight-worker"],
        blockerCode: null,
        questionType: null,
      },
    });

    expect(seeds.map((seed) => `${seed.entityType}:${seed.entityId}`)).toContain("symbol:retryWorker");
    expect(seeds.map((seed) => `${seed.entityType}:${seed.entityId}`)).toContain("path:worker/retry.ts");
    expect(seeds.map((seed) => `${seed.entityType}:${seed.entityId}`)).toContain("project:project-worker");
  });

  it("includes direct path and symbol hints as graph seeds before top-hit expansion", () => {
    const seeds = buildGraphExpansionSeeds({
      hits: [
        {
          chunkId: "chunk-issue",
          documentId: "doc-issue",
          sourceType: "issue",
          authorityLevel: "canonical",
          documentIssueId: "issue-1",
          documentProjectId: "project-worker",
          path: "issues/CLO-68/issue.md",
          title: "Issue snapshot",
          headingPath: null,
          symbolName: null,
          textContent: "SafeJoin lost nested segments",
          documentMetadata: {
            artifactKind: "issue_snapshot",
          },
          chunkMetadata: {},
          denseScore: 0.8,
          sparseScore: 0.3,
          rerankScore: 0.9,
          fusedScore: 2.1,
          updatedAt: new Date("2026-03-07T00:00:00Z"),
        },
      ],
      linkMap: new Map(),
      signals: {
        exactPaths: ["internal/storage/path.go"],
        fileNames: ["path.go"],
        symbolHints: ["SafeJoin"],
        knowledgeTags: [],
        preferredSourceTypes: ["code", "review", "issue"],
        projectAffinityIds: ["project-worker", "project-api"],
        projectAffinityNames: ["swiftsight-agent", "swiftsight-cloud"],
        blockerCode: null,
        questionType: null,
      },
    });

    expect(seeds.map((seed) => `${seed.entityType}:${seed.entityId}`)).toContain("path:internal/storage/path.go");
    expect(seeds.map((seed) => `${seed.entityType}:${seed.entityId}`)).toContain("symbol:SafeJoin");
  });

  it("adds issue-context and changed-path seeds from organizational memory hits", () => {
    const seeds = buildGraphExpansionSeeds({
      hits: [
        {
          chunkId: "chunk-review",
          documentId: "doc-review",
          sourceType: "review",
          authorityLevel: "canonical",
          documentIssueId: "issue-42",
          documentProjectId: "project-worker",
          path: "issues/CLO-90/review/submit.md",
          title: "Review submission",
          headingPath: null,
          symbolName: null,
          textContent: "Changed internal/storage/path.go and internal/storage/path_test.go",
          documentMetadata: {
            artifactKind: "review_event",
            changedPaths: ["internal/storage/path.go", "internal/storage/path_test.go"],
          },
          chunkMetadata: {},
          denseScore: 0.9,
          sparseScore: 0.4,
          rerankScore: 1.2,
          fusedScore: 2.9,
          updatedAt: new Date("2026-03-08T00:00:00Z"),
        },
      ],
      linkMap: new Map([
        ["chunk-review", [
          {
            chunkId: "chunk-review",
            entityType: "issue",
            entityId: "issue-42",
            linkReason: "protocol_related_issue",
            weight: 0.92,
          },
        ]],
      ]),
      signals: {
        exactPaths: ["internal/storage/path.go"],
        fileNames: ["path.go"],
        symbolHints: ["SafeJoin"],
        knowledgeTags: [],
        preferredSourceTypes: ["code", "review", "issue"],
        projectAffinityIds: ["project-worker"],
        projectAffinityNames: ["swiftsight-agent"],
        blockerCode: null,
        questionType: null,
      },
    });

    expect(seeds.map((seed) => `${seed.entityType}:${seed.entityId}`)).toContain("issue:issue-42");
    expect(seeds.map((seed) => `${seed.entityType}:${seed.entityId}`)).toContain("path:internal/storage/path.go");
    expect(seeds.map((seed) => `${seed.entityType}:${seed.entityId}`)).toContain("path:internal/storage/path_test.go");
  });

  it("builds symbol graph seeds from chunk symbol registry", () => {
    const seeds = buildSymbolGraphExpansionSeeds({
      hits: [
        {
          chunkId: "chunk-1",
          documentId: "doc-1",
          sourceType: "code",
          authorityLevel: "working",
          documentIssueId: null,
          documentProjectId: "project-worker",
          path: "worker/retry.ts",
          title: "Retry worker",
          headingPath: null,
          symbolName: "retryWorker",
          textContent: "retryWorker applies idempotency",
          documentMetadata: {},
          chunkMetadata: {},
          denseScore: 0.8,
          sparseScore: 0.3,
          rerankScore: 0.9,
          fusedScore: 2.1,
          updatedAt: new Date("2026-03-07T00:00:00Z"),
        },
      ],
      chunkSymbolMap: new Map([
        ["chunk-1", [
          {
            symbolId: "symbol-1",
            chunkId: "chunk-1",
            path: "worker/retry.ts",
            symbolKey: "function:retryWorker:1",
            symbolName: "retryWorker",
            symbolKind: "function",
            metadata: {
              exported: true,
            },
          },
        ]],
      ]),
    });

    expect(seeds).toEqual([
      expect.objectContaining({
        symbolId: "symbol-1",
        symbolName: "retryWorker",
      }),
    ]);
  });

  it("includes mentioned project names in retrieval query text", () => {
    const query = buildRetrievalQueryText({
      issue: {
        identifier: "SW-105",
        title: "Align CLI and worker rollout",
        description: "Need coordinated change across repos",
        labels: [{ name: "cross-project" }],
        mentionedProjects: [
          { id: "project-worker", name: "swiftsight-worker" },
          { id: "project-cli", name: "swiftcl" },
        ],
      },
      recipientRole: "tech_lead",
      message: {
        messageType: "REASSIGN_TASK",
        sender: {
          actorType: "agent",
          actorId: "cto-1",
          role: "cto",
        },
        recipients: [
          {
            recipientType: "agent",
            recipientId: "tl-1",
            role: "tech_lead",
          },
        ],
        workflowStateBefore: "assigned",
        workflowStateAfter: "assigned",
        summary: "Coordinate cross-project rollout",
        payload: {
          reason: "Worker metadata and CLI output must align",
          newAssigneeAgentId: "tl-1",
          newReviewerAgentId: "qa-1",
        },
        artifacts: [],
      },
    });

    expect(query).toContain("swiftsight-worker");
    expect(query).toContain("swiftcl");
  });

  it("caps retrieval query text for large issue descriptions", () => {
    const query = buildRetrievalQueryText({
      issue: {
        identifier: "SW-999",
        title: "Large orchestration issue",
        description: `Instruction block `.repeat(600),
        labels: [{ name: "orchestration" }, { name: "e2e" }],
      },
      recipientRole: "tech_lead",
      message: {
        messageType: "ASSIGN_TASK",
        sender: {
          actorType: "user",
          actorId: "board-1",
          role: "human_board",
        },
        recipients: [
          {
            recipientType: "agent",
            recipientId: "lead-1",
            role: "tech_lead",
          },
        ],
        workflowStateBefore: "backlog",
        workflowStateAfter: "assigned",
        summary: "Route the work to the project lead",
        payload: {
          goal: "Keep retrieval focused",
          acceptanceCriteria: ["brief still generated"],
          definitionOfDone: ["handoff remains concise"],
          priority: "high",
          assigneeAgentId: "00000000-0000-0000-0000-000000000001",
          reviewerAgentId: "00000000-0000-0000-0000-000000000002",
          requiredKnowledgeTags: Array.from({ length: 40 }, (_, index) => `signal-${index}`),
        },
        artifacts: [],
      },
    });

    expect(query.length).toBeLessThanOrEqual(2400);
    expect(query).toContain("Large orchestration issue");
    expect(query).toContain("Keep retrieval focused");
  });

  it("targets the active supervisory assignee for assignment retrieval instead of the reviewer", () => {
    const recipients = selectProtocolRetrievalRecipients({
      messageType: "ASSIGN_TASK",
      recipients: [
        {
          recipientType: "agent",
          recipientId: "pm-1",
          role: "pm",
        },
        {
          recipientType: "agent",
          recipientId: "qa-lead-1",
          role: "reviewer",
        },
      ],
    });

    expect(recipients).toEqual([
      {
        recipientType: "agent",
        recipientId: "pm-1",
        role: "pm",
      },
    ]);
  });

  it("keeps reviewer retrieval for review submission events", () => {
    const recipients = selectProtocolRetrievalRecipients({
      messageType: "SUBMIT_FOR_REVIEW",
      recipients: [
        {
          recipientType: "agent",
          recipientId: "reviewer-1",
          role: "reviewer",
        },
        {
          recipientType: "agent",
          recipientId: "tech-lead-1",
          role: "tech_lead",
        },
      ],
    });

    expect(recipients).toEqual([
      {
        recipientType: "agent",
        recipientId: "reviewer-1",
        role: "reviewer",
      },
      {
        recipientType: "agent",
        recipientId: "tech-lead-1",
        role: "tech_lead",
      },
    ]);
  });

  it("computes cosine similarity safely for stored json embeddings", () => {
    expect(computeCosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1, 6);
    expect(computeCosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0, 6);
    expect(computeCosineSimilarity([1, 0], [1, 0, 0])).toBe(0);
    expect(computeCosineSimilarity([], [])).toBe(0);
  });

  it("renders brief markdown with retrieved evidence", () => {
    const markdown = renderRetrievedBriefMarkdown({
      briefScope: deriveBriefScope({
        eventType: "on_review_submit",
        recipientRole: "reviewer",
      }),
      issue: {
        identifier: "SW-101",
        title: "Improve retry policy",
      },
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
        workflowStateBefore: "implementing",
        workflowStateAfter: "submitted_for_review",
        summary: "Implementation complete",
        payload: {
          implementationSummary: "Added idempotency and retry bounds",
          evidence: ["tests passed"],
          reviewChecklist: ["idempotency", "backoff"],
          changedFiles: ["src/retry.ts"],
          testResults: ["pnpm vitest retry"],
          residualRisks: ["No known residual risk."],
          diffSummary: "Added bounded retry logic and idempotency guards.",
        },
        artifacts: [],
      },
      queryText: "retry idempotency backoff",
      hits: [
        {
          chunkId: "chunk-1",
          documentId: "doc-1",
          sourceType: "adr",
          authorityLevel: "canonical",
          documentIssueId: "issue-1",
          documentProjectId: "project-1",
          path: "docs/adr/001-retries.md",
          title: "Retry ADR",
          headingPath: "Decision",
          symbolName: null,
          textContent: "Use bounded exponential backoff and idempotency keys for retries.",
          documentMetadata: {
            isLatestForScope: true,
          },
          chunkMetadata: {},
          denseScore: 0.77,
          sparseScore: 0.9,
          rerankScore: 0.5,
          fusedScore: 1.9,
          updatedAt: new Date("2026-03-07T00:00:00Z"),
        },
      ],
    });

    expect(markdown).toContain("# reviewer brief");
    expect(markdown).toContain("Implementation complete");
    expect(markdown).toContain("Retry ADR");
    expect(markdown).toContain("idempotency keys");
  });

  it("renders graph-linked evidence details in brief markdown", () => {
    const markdown = renderRetrievedBriefMarkdown({
      briefScope: "engineer",
      issue: {
        identifier: "SW-111",
        title: "Use connected evidence",
      },
      message: {
        messageType: "ASSIGN_TASK",
        sender: {
          actorType: "user",
          actorId: "board-1",
          role: "human_board",
        },
        recipients: [
          {
            recipientType: "agent",
            recipientId: "eng-1",
            role: "engineer",
          },
        ],
        workflowStateBefore: "backlog",
        workflowStateAfter: "assigned",
        summary: "Investigate retry worker relationship",
        payload: {
          goal: "Trace related retry evidence",
          priority: "high",
          assigneeAgentId: "00000000-0000-0000-0000-000000000001",
          reviewerAgentId: "00000000-0000-0000-0000-000000000002",
        },
        artifacts: [],
      },
      queryText: "retry worker connected evidence",
      hits: [
        {
          chunkId: "chunk-graph",
          documentId: "doc-graph",
          sourceType: "code",
          authorityLevel: "working",
          documentIssueId: null,
          documentProjectId: "project-1",
          path: "worker/retry.ts",
          title: "Retry worker",
          headingPath: null,
          symbolName: "retryWorker",
          textContent: "retryWorker references the bounded retry helper.",
          documentMetadata: {},
          chunkMetadata: {},
          denseScore: 0.5,
          sparseScore: 0.4,
          rerankScore: 0.8,
          fusedScore: 1.7,
          updatedAt: new Date("2026-03-07T00:00:00Z"),
          graphMetadata: {
            entityTypes: ["symbol", "path"],
            entityIds: ["retryWorker", "worker/retry.ts"],
            seedReasons: ["linked_symbol", "linked_path"],
            graphScore: 1.8,
            edgeTypes: ["imports", "tests"],
          },
        },
      ],
    });

    expect(markdown).toContain("graph: symbol, path");
    expect(markdown).toContain("linked_symbol");
    expect(markdown).toContain("graph edges: imports, tests");
  });

  it("fuses sparse and dense hits while preferring issue-scoped authority", () => {
    const fused = fuseRetrievalCandidates({
      issueId: "issue-1",
      projectId: "project-1",
      finalK: 3,
      sparseHits: [
        {
          chunkId: "chunk-1",
          documentId: "doc-1",
          sourceType: "adr",
          authorityLevel: "canonical",
          documentIssueId: null,
          documentProjectId: "project-1",
          path: "docs/adr/retries.md",
          title: "Retry ADR",
          headingPath: "Decision",
          symbolName: null,
          textContent: "Use bounded retries",
          documentMetadata: {
            isLatestForScope: true,
          },
          chunkMetadata: {},
          denseScore: null,
          sparseScore: 0.4,
          rerankScore: null,
          updatedAt: new Date("2026-03-07T00:00:00Z"),
        },
      ],
      denseHits: [
        {
          chunkId: "chunk-1",
          documentId: "doc-1",
          sourceType: "adr",
          authorityLevel: "canonical",
          documentIssueId: null,
          documentProjectId: "project-1",
          path: "docs/adr/retries.md",
          title: "Retry ADR",
          headingPath: "Decision",
          symbolName: null,
          textContent: "Use bounded retries",
          documentMetadata: {
            isLatestForScope: true,
          },
          chunkMetadata: {},
          denseScore: 0.6,
          sparseScore: null,
          rerankScore: null,
          updatedAt: new Date("2026-03-07T00:00:00Z"),
        },
        {
          chunkId: "chunk-2",
          documentId: "doc-2",
          sourceType: "code",
          authorityLevel: "working",
          documentIssueId: "issue-1",
          documentProjectId: "project-1",
          path: "src/retry.ts",
          title: "Retry worker",
          headingPath: null,
          symbolName: "retryWorker",
          textContent: "retryWorker applies idempotency",
          documentMetadata: {
            isLatestForScope: true,
          },
          chunkMetadata: {},
          denseScore: 0.5,
          sparseScore: null,
          rerankScore: null,
          updatedAt: new Date("2026-03-06T00:00:00Z"),
        },
      ],
    });

    expect(fused).toHaveLength(2);
    expect(fused[0]?.chunkId).toBe("chunk-2");
    expect(fused[0]?.fusedScore).toBeGreaterThan(fused[1]?.fusedScore ?? 0);
  });

  it("boosts project-affinity hits over unrelated projects", () => {
    const fused = fuseRetrievalCandidates({
      issueId: "issue-1",
      projectId: "project-primary",
      projectAffinityIds: ["project-primary", "project-worker"],
      finalK: 2,
      sparseHits: [],
      denseHits: [
        {
          chunkId: "chunk-affinity",
          documentId: "doc-affinity",
          sourceType: "code",
          authorityLevel: "working",
          documentIssueId: null,
          documentProjectId: "project-worker",
          path: "worker/retry.ts",
          title: "Worker retry",
          headingPath: null,
          symbolName: "retryWorker",
          textContent: "Worker retry policy",
          documentMetadata: {
            isLatestForScope: true,
          },
          chunkMetadata: {},
          denseScore: 0.35,
          sparseScore: null,
          rerankScore: null,
          updatedAt: new Date("2026-03-06T00:00:00Z"),
        },
        {
          chunkId: "chunk-unrelated",
          documentId: "doc-unrelated",
          sourceType: "code",
          authorityLevel: "working",
          documentIssueId: null,
          documentProjectId: "project-other",
          path: "other/retry.ts",
          title: "Other retry",
          headingPath: null,
          symbolName: "retryOther",
          textContent: "Other retry policy",
          documentMetadata: {
            isLatestForScope: true,
          },
          chunkMetadata: {},
          denseScore: 0.35,
          sparseScore: null,
          rerankScore: null,
          updatedAt: new Date("2026-03-06T00:00:00Z"),
        },
      ],
    });

    expect(fused[0]?.chunkId).toBe("chunk-affinity");
    expect((fused[0]?.fusedScore ?? 0)).toBeGreaterThan(fused[1]?.fusedScore ?? 0);
  });

  it("merges graph expansion hits without losing graph metadata", () => {
    const merged = mergeGraphExpandedHits({
      baseHits: [
        {
          chunkId: "chunk-1",
          documentId: "doc-1",
          sourceType: "code",
          authorityLevel: "working",
          documentIssueId: null,
          documentProjectId: "project-1",
          path: "src/retry.ts",
          title: "Retry worker",
          headingPath: null,
          symbolName: "retryWorker",
          textContent: "retry worker",
          documentMetadata: {},
          chunkMetadata: {},
          denseScore: 0.5,
          sparseScore: 0.2,
          rerankScore: 0.7,
          fusedScore: 1.4,
          updatedAt: new Date("2026-03-06T00:00:00Z"),
        },
      ],
      graphHits: [
        {
          chunkId: "chunk-2",
          documentId: "doc-2",
          sourceType: "test_report",
          authorityLevel: "working",
          documentIssueId: null,
          documentProjectId: "project-1",
          path: "tests/retry.test.ts",
          title: "Retry tests",
          headingPath: null,
          symbolName: "retryWorker",
          textContent: "covers retryWorker",
          documentMetadata: {},
          chunkMetadata: {},
          denseScore: null,
          sparseScore: null,
          rerankScore: 1.2,
          fusedScore: 1.6,
          updatedAt: new Date("2026-03-07T00:00:00Z"),
          graphMetadata: {
            entityTypes: ["symbol"],
            entityIds: ["retryWorker"],
            seedReasons: ["linked_symbol"],
            graphScore: 1.2,
            hopDepth: 2,
          },
        },
      ],
      finalK: 4,
    });

    expect(merged).toHaveLength(2);
    expect(merged[0]?.chunkId).toBe("chunk-2");
    expect(merged[0]?.graphMetadata?.entityTypes).toContain("symbol");
    expect(merged[0]?.graphMetadata?.hopDepth).toBe(2);
  });

  it("preserves deepest hop depth when graph metadata merges into an existing base hit", () => {
    const merged = mergeGraphExpandedHits({
      baseHits: [
        {
          chunkId: "chunk-1",
          documentId: "doc-1",
          sourceType: "code",
          authorityLevel: "working",
          documentIssueId: null,
          documentProjectId: "project-1",
          path: "src/retry.ts",
          title: "Retry worker",
          headingPath: null,
          symbolName: "retryWorker",
          textContent: "retry worker",
          documentMetadata: {},
          chunkMetadata: {},
          denseScore: 0.5,
          sparseScore: 0.2,
          rerankScore: 0.7,
          fusedScore: 1.4,
          updatedAt: new Date("2026-03-06T00:00:00Z"),
        },
      ],
      graphHits: [
        {
          chunkId: "chunk-1",
          documentId: "doc-1",
          sourceType: "code",
          authorityLevel: "working",
          documentIssueId: null,
          documentProjectId: "project-1",
          path: "src/retry.ts",
          title: "Retry worker",
          headingPath: null,
          symbolName: "retryWorker",
          textContent: "retry worker",
          documentMetadata: {},
          chunkMetadata: {},
          denseScore: null,
          sparseScore: null,
          rerankScore: 1.3,
          fusedScore: 1.9,
          updatedAt: new Date("2026-03-07T00:00:00Z"),
          graphMetadata: {
            entityTypes: ["path"],
            entityIds: ["src/retry.ts"],
            seedReasons: ["graph_escalated_path:protocol_changed_path"],
            graphScore: 1.3,
            hopDepth: 2,
          },
        },
      ],
      finalK: 2,
    });

    expect(merged).toHaveLength(1);
    expect(merged[0]?.graphMetadata?.hopDepth).toBe(2);
    expect(merged[0]?.graphMetadata?.seedReasons).toContain("graph_escalated_path:protocol_changed_path");
  });

  it("promotes exact-path code evidence when organizational memory dominates the top-k", () => {
    const adjusted = applyEvidenceDiversityGuard({
      finalK: 4,
      signals: {
        exactPaths: ["src/retry.ts"],
        fileNames: ["retry.ts"],
        symbolHints: ["retryWorker"],
        knowledgeTags: [],
        preferredSourceTypes: ["code", "test_report", "review", "issue"],
        projectAffinityIds: ["project-1"],
        projectAffinityNames: ["swiftsight-worker"],
        blockerCode: null,
        questionType: null,
      },
      hits: [
        {
          chunkId: "review-1",
          documentId: "doc-review-1",
          sourceType: "review",
          authorityLevel: "canonical",
          documentIssueId: "issue-1",
          documentProjectId: "project-1",
          path: "issues/CLO-81/review/submit.md",
          title: "Review artifact 1",
          headingPath: null,
          symbolName: null,
          textContent: "Changed src/retry.ts",
          documentMetadata: { artifactKind: "review_event", changedPaths: ["src/retry.ts"] },
          chunkMetadata: {},
          denseScore: 0.8,
          sparseScore: 0.5,
          rerankScore: 3.2,
          fusedScore: 9.4,
          updatedAt: new Date("2026-03-10T00:00:00Z"),
        },
        {
          chunkId: "review-2",
          documentId: "doc-review-2",
          sourceType: "review",
          authorityLevel: "canonical",
          documentIssueId: "issue-1",
          documentProjectId: "project-1",
          path: "issues/CLO-80/review/submit.md",
          title: "Review artifact 2",
          headingPath: null,
          symbolName: null,
          textContent: "Changed src/retry.ts",
          documentMetadata: { artifactKind: "review_event", changedPaths: ["src/retry.ts"] },
          chunkMetadata: {},
          denseScore: 0.79,
          sparseScore: 0.49,
          rerankScore: 3.1,
          fusedScore: 9.1,
          updatedAt: new Date("2026-03-09T00:00:00Z"),
        },
        {
          chunkId: "issue-1",
          documentId: "doc-issue-1",
          sourceType: "issue",
          authorityLevel: "canonical",
          documentIssueId: "issue-1",
          documentProjectId: "project-1",
          path: "issues/CLO-81/issue.md",
          title: "Issue snapshot",
          headingPath: null,
          symbolName: null,
          textContent: "Retry worker issue",
          documentMetadata: { artifactKind: "issue_snapshot" },
          chunkMetadata: {},
          denseScore: 0.5,
          sparseScore: 0.35,
          rerankScore: 2.4,
          fusedScore: 8.4,
          updatedAt: new Date("2026-03-08T00:00:00Z"),
        },
        {
          chunkId: "review-3",
          documentId: "doc-review-3",
          sourceType: "review",
          authorityLevel: "canonical",
          documentIssueId: "issue-1",
          documentProjectId: "project-1",
          path: "issues/CLO-79/review/submit.md",
          title: "Review artifact 3",
          headingPath: null,
          symbolName: null,
          textContent: "Changed src/retry.ts",
          documentMetadata: { artifactKind: "review_event", changedPaths: ["src/retry.ts"] },
          chunkMetadata: {},
          denseScore: 0.77,
          sparseScore: 0.48,
          rerankScore: 3,
          fusedScore: 8.2,
          updatedAt: new Date("2026-03-07T00:00:00Z"),
        },
        {
          chunkId: "code-1",
          documentId: "doc-code-1",
          sourceType: "code",
          authorityLevel: "working",
          documentIssueId: null,
          documentProjectId: "project-1",
          path: "src/retry.ts",
          title: "Retry worker",
          headingPath: null,
          symbolName: "retryWorker",
          textContent: "retry worker implementation",
          documentMetadata: {},
          chunkMetadata: {},
          denseScore: 0.51,
          sparseScore: 0.31,
          rerankScore: 1.6,
          fusedScore: 7.2,
          updatedAt: new Date("2026-03-06T00:00:00Z"),
        },
      ],
    });

    expect(adjusted.slice(0, 4).some((hit) => hit.sourceType === "code")).toBe(true);
    expect(adjusted.slice(0, 4).some((hit) => hit.diversityMetadata?.promotedReason === "exact_path_code")).toBe(true);
  });

  it("promotes exact-path code evidence even when the candidate sits deep in the ranked list", () => {
    const hits = Array.from({ length: 28 }, (_, index) => ({
      chunkId: `review-${index}`,
      documentId: `doc-review-${index}`,
      sourceType: "review",
      authorityLevel: "canonical",
      documentIssueId: "issue-1",
      documentProjectId: "project-1",
      path: `issues/CLO-${80 + index}/review/submit.md`,
      title: `Review artifact ${index}`,
      headingPath: null,
      symbolName: null,
      textContent: "Changed src/retry.ts",
      documentMetadata: { artifactKind: "review_event", changedPaths: ["src/retry.ts"] },
      chunkMetadata: {},
      denseScore: 0.8 - index * 0.01,
      sparseScore: 0.5,
      rerankScore: 3.2 - index * 0.03,
      fusedScore: 9.4 - index * 0.08,
      updatedAt: new Date(`2026-03-${String((index % 9) + 1).padStart(2, "0")}T00:00:00Z`),
    }));
    hits.push({
      chunkId: "code-deep",
      documentId: "doc-code-deep",
      sourceType: "code",
      authorityLevel: "working",
      documentIssueId: null,
      documentProjectId: "project-1",
      path: "src/retry.ts",
      title: "Retry worker",
      headingPath: null,
      symbolName: "retryWorker",
      textContent: "retry worker implementation",
      documentMetadata: {},
      chunkMetadata: {},
      denseScore: 0.2,
      sparseScore: 0.1,
      rerankScore: 0.6,
      fusedScore: 1.2,
      updatedAt: new Date("2026-03-02T00:00:00Z"),
    });

    const adjusted = applyEvidenceDiversityGuard({
      finalK: 4,
      signals: {
        exactPaths: ["src/retry.ts"],
        fileNames: ["retry.ts"],
        symbolHints: ["retryWorker"],
        knowledgeTags: [],
        preferredSourceTypes: ["code", "test_report", "review", "issue"],
        projectAffinityIds: ["project-1"],
        projectAffinityNames: ["swiftsight-worker"],
        blockerCode: null,
        questionType: null,
      },
      hits,
    });

    expect(adjusted.slice(0, 4).some((hit) => hit.chunkId === "code-deep")).toBe(true);
  });

  it("promotes multi-hop graph evidence into the top-k when graph hits would otherwise disappear", () => {
    const adjusted = applyGraphConnectivityGuard({
      finalK: 4,
      signals: {
        exactPaths: ["src/retry.ts"],
        fileNames: ["retry.ts"],
        symbolHints: ["retryWorker"],
        knowledgeTags: [],
        preferredSourceTypes: ["code", "test_report", "review", "issue"],
        projectAffinityIds: ["project-1", "project-2"],
        projectAffinityNames: ["swiftsight-worker", "swiftsight-agent"],
        blockerCode: null,
        questionType: null,
      },
      hits: [
        {
          chunkId: "review-1",
          documentId: "doc-review-1",
          sourceType: "review",
          authorityLevel: "canonical",
          documentIssueId: "issue-1",
          documentProjectId: "project-1",
          path: "issues/CLO-80/review/submit.md",
          title: "Review artifact 1",
          headingPath: null,
          symbolName: null,
          textContent: "Changed src/retry.ts",
          documentMetadata: { artifactKind: "review_event", changedPaths: ["src/retry.ts"] },
          chunkMetadata: {},
          denseScore: 0.82,
          sparseScore: 0.55,
          rerankScore: 3.2,
          fusedScore: 9.1,
          updatedAt: new Date("2026-03-10T00:00:00Z"),
        },
        {
          chunkId: "issue-1",
          documentId: "doc-issue-1",
          sourceType: "issue",
          authorityLevel: "canonical",
          documentIssueId: "issue-1",
          documentProjectId: "project-1",
          path: "issues/CLO-80/issue.md",
          title: "Issue snapshot",
          headingPath: null,
          symbolName: null,
          textContent: "Retry issue",
          documentMetadata: { artifactKind: "issue_snapshot" },
          chunkMetadata: {},
          denseScore: 0.6,
          sparseScore: 0.4,
          rerankScore: 2.5,
          fusedScore: 8.6,
          updatedAt: new Date("2026-03-09T00:00:00Z"),
        },
        {
          chunkId: "review-2",
          documentId: "doc-review-2",
          sourceType: "review",
          authorityLevel: "canonical",
          documentIssueId: "issue-1",
          documentProjectId: "project-1",
          path: "issues/CLO-79/review/submit.md",
          title: "Review artifact 2",
          headingPath: null,
          symbolName: null,
          textContent: "Changed src/retry.ts",
          documentMetadata: { artifactKind: "review_event", changedPaths: ["src/retry.ts"] },
          chunkMetadata: {},
          denseScore: 0.78,
          sparseScore: 0.51,
          rerankScore: 3,
          fusedScore: 8.4,
          updatedAt: new Date("2026-03-08T00:00:00Z"),
        },
        {
          chunkId: "review-3",
          documentId: "doc-review-3",
          sourceType: "review",
          authorityLevel: "canonical",
          documentIssueId: "issue-1",
          documentProjectId: "project-1",
          path: "issues/CLO-78/review/submit.md",
          title: "Review artifact 3",
          headingPath: null,
          symbolName: null,
          textContent: "Changed src/retry.ts",
          documentMetadata: { artifactKind: "review_event", changedPaths: ["src/retry.ts"] },
          chunkMetadata: {},
          denseScore: 0.75,
          sparseScore: 0.48,
          rerankScore: 2.9,
          fusedScore: 8.1,
          updatedAt: new Date("2026-03-07T00:00:00Z"),
        },
        {
          chunkId: "graph-2hop",
          documentId: "doc-graph-2hop",
          sourceType: "code",
          authorityLevel: "working",
          documentIssueId: null,
          documentProjectId: "project-2",
          path: "src/retry.ts",
          title: "Retry graph evidence",
          headingPath: null,
          symbolName: "retryWorker",
          textContent: "Retry implementation in sibling project",
          documentMetadata: {},
          chunkMetadata: {},
          denseScore: 0.45,
          sparseScore: 0.22,
          rerankScore: 1.7,
          fusedScore: 7.1,
          updatedAt: new Date("2026-03-06T00:00:00Z"),
          graphMetadata: {
            entityTypes: ["path", "project"],
            entityIds: ["src/retry.ts", "project-2"],
            seedReasons: ["graph_hop:protocol_related_issue"],
            graphScore: 1.4,
            hopDepth: 2,
          },
        },
      ],
    });

    expect(adjusted.slice(0, 4).some((hit) => hit.chunkId === "graph-2hop")).toBe(true);
    expect(adjusted.slice(0, 4).some((hit) => hit.diversityMetadata?.promotedReason === "graph_multihop_code")).toBe(true);
  });

  it("promotes related executable paths from organizational memory bridge context", () => {
    const adjusted = applyOrganizationalBridgeGuard({
      finalK: 4,
      signals: {
        exactPaths: ["internal/storage/path.go"],
        fileNames: ["path.go"],
        symbolHints: ["SafeJoin"],
        knowledgeTags: [],
        preferredSourceTypes: ["code", "test_report", "review", "issue"],
        projectAffinityIds: ["project-1"],
        projectAffinityNames: ["swiftsight-agent"],
        blockerCode: null,
        questionType: null,
      },
      hits: [
        {
          chunkId: "review-1",
          documentId: "doc-review-1",
          sourceType: "review",
          authorityLevel: "canonical",
          documentIssueId: "issue-1",
          documentProjectId: "project-1",
          path: "issues/CLO-81/review/submit.md",
          title: "Review artifact 1",
          headingPath: null,
          symbolName: null,
          textContent: "Changed internal/storage/path.go and internal/storage/path_test.go",
          documentMetadata: {
            artifactKind: "review_event",
            changedPaths: ["internal/storage/path.go", "internal/storage/path_test.go"],
          },
          chunkMetadata: {},
          denseScore: 0.8,
          sparseScore: 0.5,
          rerankScore: 3.2,
          fusedScore: 9.2,
          updatedAt: new Date("2026-03-10T00:00:00Z"),
        },
        {
          chunkId: "issue-1",
          documentId: "doc-issue-1",
          sourceType: "issue",
          authorityLevel: "canonical",
          documentIssueId: "issue-1",
          documentProjectId: "project-1",
          path: "issues/CLO-81/issue.md",
          title: "Issue snapshot",
          headingPath: null,
          symbolName: null,
          textContent: "SafeJoin fix",
          documentMetadata: { artifactKind: "issue_snapshot" },
          chunkMetadata: {},
          denseScore: 0.72,
          sparseScore: 0.41,
          rerankScore: 2.7,
          fusedScore: 8.5,
          updatedAt: new Date("2026-03-09T00:00:00Z"),
        },
        {
          chunkId: "review-2",
          documentId: "doc-review-2",
          sourceType: "review",
          authorityLevel: "canonical",
          documentIssueId: "issue-1",
          documentProjectId: "project-1",
          path: "issues/CLO-80/review/submit.md",
          title: "Review artifact 2",
          headingPath: null,
          symbolName: null,
          textContent: "Changed internal/storage/path.go",
          documentMetadata: {
            artifactKind: "review_event",
            changedPaths: ["internal/storage/path.go"],
          },
          chunkMetadata: {},
          denseScore: 0.7,
          sparseScore: 0.39,
          rerankScore: 2.6,
          fusedScore: 8.3,
          updatedAt: new Date("2026-03-08T00:00:00Z"),
        },
        {
          chunkId: "review-3",
          documentId: "doc-review-3",
          sourceType: "review",
          authorityLevel: "canonical",
          documentIssueId: "issue-1",
          documentProjectId: "project-1",
          path: "issues/CLO-79/review/submit.md",
          title: "Review artifact 3",
          headingPath: null,
          symbolName: null,
          textContent: "Changed internal/storage/path.go",
          documentMetadata: {
            artifactKind: "review_event",
            changedPaths: ["internal/storage/path.go"],
          },
          chunkMetadata: {},
          denseScore: 0.68,
          sparseScore: 0.38,
          rerankScore: 2.5,
          fusedScore: 8.1,
          updatedAt: new Date("2026-03-07T00:00:00Z"),
        },
        {
          chunkId: "code-related",
          documentId: "doc-code-related",
          sourceType: "code",
          authorityLevel: "working",
          documentIssueId: null,
          documentProjectId: "project-1",
          path: "internal/storage/path_test.go",
          title: "SafeJoin regression test",
          headingPath: null,
          symbolName: "TestSafeJoin",
          textContent: "regression coverage",
          documentMetadata: {},
          chunkMetadata: {},
          denseScore: 0.44,
          sparseScore: 0.19,
          rerankScore: 1.2,
          fusedScore: 6.2,
          updatedAt: new Date("2026-03-06T00:00:00Z"),
        },
      ],
    });

    expect(adjusted.slice(0, 4).some((hit) => hit.path === "internal/storage/path_test.go")).toBe(true);
    expect(
      adjusted
        .slice(0, 4)
        .some((hit) => hit.diversityMetadata?.promotedReason === "organizational_bridge_related_path"),
    ).toBe(true);
    expect(
      adjusted
        .slice(0, 4)
        .some((hit) => (hit.graphMetadata?.hopDepth ?? 1) > 1 && hit.path === "internal/storage/path_test.go"),
    ).toBe(true);
  });

  it("applies saturation guard to repeated organizational memory artifacts", () => {
    const adjusted = applyOrganizationalMemorySaturationGuard({
      finalK: 4,
      hits: [
        {
          chunkId: "review-1",
          documentId: "doc-review-1",
          sourceType: "review",
          authorityLevel: "canonical",
          documentIssueId: "issue-1",
          documentProjectId: "project-1",
          path: "issues/CLO-80/review/submit.md",
          title: "Review artifact 1",
          headingPath: null,
          symbolName: null,
          textContent: "Changed src/retry.ts",
          documentMetadata: { artifactKind: "review_event", changedPaths: ["src/retry.ts"] },
          chunkMetadata: {},
          denseScore: 0.8,
          sparseScore: 0.6,
          rerankScore: 3,
          fusedScore: 9,
          updatedAt: new Date("2026-03-10T00:00:00Z"),
        },
        {
          chunkId: "review-2",
          documentId: "doc-review-2",
          sourceType: "review",
          authorityLevel: "canonical",
          documentIssueId: "issue-1",
          documentProjectId: "project-1",
          path: "issues/CLO-79/review/submit.md",
          title: "Review artifact 2",
          headingPath: null,
          symbolName: null,
          textContent: "Changed src/retry.ts",
          documentMetadata: { artifactKind: "review_event", changedPaths: ["src/retry.ts"] },
          chunkMetadata: {},
          denseScore: 0.78,
          sparseScore: 0.62,
          rerankScore: 3,
          fusedScore: 8.9,
          updatedAt: new Date("2026-03-10T00:00:00Z"),
        },
        {
          chunkId: "review-3",
          documentId: "doc-review-3",
          sourceType: "review",
          authorityLevel: "canonical",
          documentIssueId: "issue-1",
          documentProjectId: "project-1",
          path: "issues/CLO-78/review/submit.md",
          title: "Review artifact 3",
          headingPath: null,
          symbolName: null,
          textContent: "Changed src/retry.ts",
          documentMetadata: { artifactKind: "review_event", changedPaths: ["src/retry.ts"] },
          chunkMetadata: {},
          denseScore: 0.77,
          sparseScore: 0.6,
          rerankScore: 3,
          fusedScore: 8.8,
          updatedAt: new Date("2026-03-10T00:00:00Z"),
        },
        {
          chunkId: "code-1",
          documentId: "doc-code-1",
          sourceType: "code",
          authorityLevel: "working",
          documentIssueId: null,
          documentProjectId: "project-1",
          path: "src/retry.ts",
          title: "retry.ts",
          headingPath: null,
          symbolName: "retryWorker",
          textContent: "function retryWorker() {}",
          documentMetadata: {},
          chunkMetadata: {},
          denseScore: 0.42,
          sparseScore: 0.25,
          rerankScore: 2.8,
          fusedScore: 8.1,
          updatedAt: new Date("2026-03-09T00:00:00Z"),
        },
      ],
    });

    expect(adjusted[0]?.chunkId).toBe("review-1");
    expect(adjusted[1]?.chunkId).toBe("code-1");
    expect(adjusted[2]?.saturationMetadata?.penalty).toBeLessThan(0);
  });

  it("prefers direct code evidence over review metadata when exact paths are available", () => {
    const reranked = rerankRetrievalHits({
      issueId: "issue-1",
      projectId: "project-1",
      finalK: 3,
      signals: {
        exactPaths: ["src/retry.ts"],
        fileNames: ["retry.ts"],
        symbolHints: ["retryWorker"],
        knowledgeTags: [],
        preferredSourceTypes: ["code", "test_report", "review", "issue"],
        projectAffinityIds: ["project-1"],
        projectAffinityNames: ["swiftsight-worker"],
        blockerCode: null,
        questionType: null,
      },
      hits: [
        {
          chunkId: "review-1",
          documentId: "doc-review-1",
          sourceType: "review",
          authorityLevel: "canonical",
          documentIssueId: "issue-1",
          documentProjectId: "project-1",
          path: "issues/CLO-81/review/submit.md",
          title: "Review artifact",
          headingPath: null,
          symbolName: null,
          textContent: "Changed src/retry.ts",
          documentMetadata: { artifactKind: "review_event", changedPaths: ["src/retry.ts"] },
          chunkMetadata: {},
          denseScore: 0.7,
          sparseScore: 0.4,
          rerankScore: 0,
          fusedScore: 7.5,
          updatedAt: new Date("2026-03-10T00:00:00Z"),
        },
        {
          chunkId: "code-1",
          documentId: "doc-code-1",
          sourceType: "code",
          authorityLevel: "working",
          documentIssueId: null,
          documentProjectId: "project-1",
          path: "src/retry.ts",
          title: "Retry worker",
          headingPath: null,
          symbolName: "retryWorker",
          textContent: "retry worker implementation",
          documentMetadata: {},
          chunkMetadata: {},
          denseScore: 0.5,
          sparseScore: 0.2,
          rerankScore: 0,
          fusedScore: 6.2,
          updatedAt: new Date("2026-03-08T00:00:00Z"),
        },
      ],
    });

    expect(reranked[0]?.sourceType).toBe("code");
    expect(reranked[0]?.path).toBe("src/retry.ts");
  });

  it("expands symbol graph hits across two hops with decay", () => {
    const result = buildSymbolGraphExpandedHits({
      symbolSeeds: [
        {
          symbolId: "seed-retry",
          chunkId: "chunk-seed",
          path: "src/retry.ts",
          symbolName: "retryWorker",
          seedBoost: 1.4,
          seedReasons: ["top_hit_symbol"],
        },
      ],
      edgeRows: [
        {
          fromSymbolId: "seed-retry",
          toSymbolId: "helper",
          edgeType: "calls",
          weight: 0.9,
        },
        {
          fromSymbolId: "helper",
          toSymbolId: "test-helper",
          edgeType: "tests",
          weight: 0.75,
        },
      ],
      targetSymbols: [
        {
          symbolId: "helper",
          chunkId: "chunk-helper",
          path: "src/helper.ts",
          symbolName: "retryHelper",
          documentId: "doc-helper",
          sourceType: "code",
          authorityLevel: "working",
          documentIssueId: null,
          documentProjectId: "project-1",
          title: "Retry helper",
          headingPath: null,
          textContent: "retry helper implementation",
          documentMetadata: {},
          chunkMetadata: {},
          updatedAt: new Date("2026-03-10T00:00:00Z"),
        },
        {
          symbolId: "test-helper",
          chunkId: "chunk-test",
          path: "tests/retry_helper.test.ts",
          symbolName: "retryHelperTest",
          documentId: "doc-test",
          sourceType: "test_report",
          authorityLevel: "working",
          documentIssueId: null,
          documentProjectId: "project-1",
          title: "Retry helper tests",
          headingPath: null,
          textContent: "retry helper tests",
          documentMetadata: {},
          chunkMetadata: {},
          updatedAt: new Date("2026-03-10T01:00:00Z"),
        },
      ],
      limit: 4,
      maxDepth: 2,
    });

    expect(result.hits).toHaveLength(2);
    expect(result.graphMaxDepth).toBe(2);
    expect(result.graphHopDepthCounts["1"]).toBe(1);
    expect(result.graphHopDepthCounts["2"]).toBe(1);
    expect(result.hits.map((hit) => hit.chunkId)).toEqual(["chunk-test", "chunk-helper"]);
    expect(result.hits[0]?.graphMetadata?.hopDepth).toBe(2);
    expect(result.hits[1]?.graphMetadata?.hopDepth).toBe(1);
    expect(result.edgeTypeCounts.calls).toBeGreaterThan(0);
    expect(result.edgeTypeCounts.tests).toBeGreaterThan(0);
  });

  it("derives dynamic retrieval signals from review payloads", () => {
    const signals = deriveDynamicRetrievalSignals({
      recipientRole: "reviewer",
      eventType: "on_review_submit",
      issue: {
        projectId: "project-1",
        mentionedProjects: [{ id: "project-worker", name: "swiftsight-worker" }],
      },
      baselineSourceTypes: ["adr", "prd", "runbook"],
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
        workflowStateBefore: "implementing",
        workflowStateAfter: "submitted_for_review",
        summary: "Review retry worker changes",
        payload: {
          implementationSummary: "Updated retryWorker and retry policy",
          evidence: ["tests passed"],
          reviewChecklist: ["idempotency", "backoff"],
          changedFiles: ["src/retry-worker.ts", "tests/retry-worker.test.ts"],
          testResults: ["pnpm vitest retry-worker"],
          residualRisks: ["Queue latency still needs production observation."],
          diffSummary: "retryWorker now uses bounded retries",
        },
        artifacts: [],
      },
    });

    expect(signals.exactPaths).toContain("src/retry-worker.ts");
    expect(signals.fileNames).toContain("retry-worker.ts");
    expect(signals.symbolHints).toContain("retryWorker");
    expect(signals.preferredSourceTypes[0]).toBe("code");
    expect(signals.preferredSourceTypes).toContain("adr");
  });

  it("collects related issue reuse hints from canonical protocol payload fields", () => {
    const signals = deriveDynamicRetrievalSignals({
      recipientRole: "reviewer",
      eventType: "on_change_request",
      issue: {
        projectId: "project-1",
        title: "Reuse prior retry decisions",
        description: null,
        mentionedProjects: [],
      },
      baselineSourceTypes: ["code", "review"],
      message: {
        messageType: "REQUEST_CHANGES",
        sender: {
          actorType: "agent",
          actorId: "rev-1",
          role: "reviewer",
        },
        recipients: [
          {
            recipientType: "agent",
            recipientId: "eng-1",
            role: "engineer",
          },
        ],
        workflowStateBefore: "under_review",
        workflowStateAfter: "changes_requested",
        summary: "Reuse prior retry decisions",
        payload: {
          reviewSummary: "Reuse prior retry decisions",
          relatedIssueIds: ["issue-a", "issue-b"],
          followUpIssueIds: ["issue-d"],
        },
        artifacts: [],
      },
    });

    expect(signals.relatedIssueIds).toEqual(["issue-a", "issue-b", "issue-d"]);
  });

  it("collects related issue identifier hints from issue text, labels, and payload", () => {
    const signals = deriveDynamicRetrievalSignals({
      recipientRole: "engineer",
      eventType: "on_assignment",
      issue: {
        projectId: "project-1",
        identifier: "CLO-140",
        title: "Follow up CLO-88 rollout verification",
        description: "Continue the CLO-91 and CLO-92 stabilization loop.",
        labels: [{ name: "follow-up:CLO-93" }],
        mentionedProjects: [],
      },
      baselineSourceTypes: ["code", "review"],
      message: {
        messageType: "ASSIGN_TASK",
        sender: {
          actorType: "agent",
          actorId: "pm-1",
          role: "pm",
        },
        recipients: [
          {
            recipientType: "agent",
            recipientId: "eng-1",
            role: "engineer",
          },
        ],
        workflowStateBefore: "todo",
        workflowStateAfter: "todo",
        summary: "Reuse CLO-94 rollout lessons",
        payload: {
          goal: "Finish the CLO-95 close loop without replaying the same regression.",
          relatedIssueIdentifiers: ["CLO-96"],
        },
        artifacts: [],
      },
    });

    expect(signals.relatedIssueIdentifiers).toHaveLength(7);
    expect(signals.relatedIssueIdentifiers).toEqual(expect.arrayContaining([
      "CLO-88",
      "CLO-91",
      "CLO-92",
      "CLO-93",
      "CLO-94",
      "CLO-95",
      "CLO-96",
    ]));
    expect(signals.preferredSourceTypes).toEqual(expect.arrayContaining(["review", "protocol_message", "issue"]));
  });

  it("derives exact paths from issue text when payload paths are absent", () => {
    const signals = deriveDynamicRetrievalSignals({
      recipientRole: "engineer",
      eventType: "on_assignment",
      issue: {
        projectId: "project-1",
        title: "Fix internal/storage/path.go retry behavior",
        description: "Update internal/storage/path.go and internal/storage/path_test.go to normalize symlink handling.",
        mentionedProjects: [],
      },
      baselineSourceTypes: ["code", "review"],
      message: {
        messageType: "REASSIGN_TASK",
        sender: {
          actorType: "agent",
          actorId: "tl-1",
          role: "tech_lead",
        },
        recipients: [
          {
            recipientType: "agent",
            recipientId: "eng-1",
            role: "engineer",
          },
        ],
        workflowStateBefore: "todo",
        workflowStateAfter: "todo",
        summary: "Please take over internal/storage/path.go cleanup",
        payload: {
          reason: "Move the fix into internal/storage/path.go and validate it in internal/storage/path_test.go.",
        },
        artifacts: [],
      },
    });

    expect(signals.exactPaths).toContain("internal/storage/path.go");
    expect(signals.exactPaths).toContain("internal/storage/path_test.go");
  });

  it("builds retrieval query text from review decision and closure contracts", () => {
    const reviewQuery = buildRetrievalQueryText({
      issue: {
        identifier: "SW-102",
        title: "Stabilize rollout close loop",
        description: "Tighten review and closure evidence",
        labels: [{ name: "review" }],
      },
      recipientRole: "engineer",
      message: {
        messageType: "REQUEST_CHANGES",
        sender: {
          actorType: "agent",
          actorId: "rev-1",
          role: "reviewer",
        },
        recipients: [
          {
            recipientType: "agent",
            recipientId: "eng-1",
            role: "engineer",
          },
        ],
        workflowStateBefore: "under_review",
        workflowStateAfter: "changes_requested",
        summary: "Need stronger verification evidence",
        payload: {
          reviewSummary: "Approval is blocked until verification evidence is complete.",
          changeRequests: [
            {
              title: "Attach rollout evidence",
              reason: "Verification summary does not mention staged rollout metrics.",
              affectedFiles: ["docs/release/checklist.md"],
              suggestedAction: "Add staged rollout metrics and rollback checkpoints.",
            },
          ],
          severity: "major",
          mustFixBeforeApprove: true,
          requiredEvidence: ["Staged rollout dashboard link", "Rollback checkpoint note"],
        },
        artifacts: [],
      },
    });

    const closeQuery = buildRetrievalQueryText({
      issue: {
        identifier: "SW-103",
        title: "Close release issue",
        description: "Document close loop",
        labels: [{ name: "release" }],
      },
      recipientRole: "tech_lead",
      message: {
        messageType: "CLOSE_TASK",
        sender: {
          actorType: "agent",
          actorId: "lead-1",
          role: "tech_lead",
        },
        recipients: [
          {
            recipientType: "role_group",
            recipientId: "human_board",
            role: "human_board",
          },
        ],
        workflowStateBefore: "approved",
        workflowStateAfter: "done",
        summary: "Close issue with delivery summary",
        payload: {
          closeReason: "completed",
          closureSummary: "Release completed after final verification and approval.",
          verificationSummary: "Reviewed test evidence, merged commit, and rollout checklist.",
          rollbackPlan: "Revert the merge commit and reopen the follow-up issue if regression appears.",
          finalArtifacts: ["release note", "monitoring link"],
          finalTestStatus: "passed",
          mergeStatus: "merged",
          remainingRisks: ["No unresolved delivery blocker remains."],
        },
        artifacts: [
          {
            kind: "commit",
            uri: "commit://abc123",
          },
        ],
      },
    });

    expect(reviewQuery).toContain("Staged rollout dashboard link");
    expect(reviewQuery).toContain("docs/release/checklist.md");
    expect(closeQuery).toContain("Release completed after final verification");
    expect(closeQuery).toContain("Revert the merge commit");
  });

  it("reranks exact path matches above generic hits", () => {
    const reranked = rerankRetrievalHits({
      issueId: "issue-1",
      projectId: "project-1",
      finalK: 2,
      signals: {
        exactPaths: ["src/retry.ts"],
        fileNames: ["retry.ts"],
        symbolHints: ["retryWorker"],
        knowledgeTags: [],
        preferredSourceTypes: ["code", "test_report", "adr"],
        blockerCode: null,
        questionType: null,
      },
      linkMap: new Map([
        ["chunk-2", [{ chunkId: "chunk-2", entityType: "path", entityId: "src/retry.ts", linkReason: "workspace_import_path", weight: 1.2 }]],
      ]),
      hits: [
        {
          chunkId: "chunk-1",
          documentId: "doc-1",
          sourceType: "adr",
          authorityLevel: "canonical",
          documentIssueId: null,
          documentProjectId: "project-1",
          path: "docs/adr/retries.md",
          title: "Retry ADR",
          headingPath: "Decision",
          symbolName: null,
          textContent: "Bounded retry guidance",
          documentMetadata: { isLatestForScope: true },
          chunkMetadata: {},
          denseScore: 0.8,
          sparseScore: 0.8,
          rerankScore: null,
          fusedScore: 2.95,
          updatedAt: new Date("2026-03-07T00:00:00Z"),
        },
        {
          chunkId: "chunk-2",
          documentId: "doc-2",
          sourceType: "code",
          authorityLevel: "working",
          documentIssueId: "issue-1",
          documentProjectId: "project-1",
          path: "src/retry.ts",
          title: "retry.ts",
          headingPath: "src/retry.ts",
          symbolName: "retryWorker",
          textContent: "function retryWorker() {}",
          documentMetadata: { isLatestForScope: true },
          chunkMetadata: {},
          denseScore: 0.3,
          sparseScore: 0.2,
          rerankScore: null,
          fusedScore: 2.0,
          updatedAt: new Date("2026-03-06T00:00:00Z"),
        },
      ],
    });

    expect(reranked[0]?.chunkId).toBe("chunk-2");
    expect(reranked[0]?.rerankScore).toBeGreaterThan(reranked[1]?.rerankScore ?? 0);
  });

  it("demotes current-issue protocol echoes below project-scoped code summaries for symptom-first queries", () => {
    const reranked = rerankRetrievalHits({
      issueId: "issue-1",
      projectId: "project-cloud",
      finalK: 2,
      signals: {
        exactPaths: [],
        fileNames: [],
        symbolHints: [],
        knowledgeTags: ["dicom-metadata", "series-name", "dicom", "metadata", "series", "name"],
        preferredSourceTypes: ["code_summary", "code", "test_report", "issue", "protocol_message"],
        blockerCode: null,
        questionType: null,
        projectAffinityIds: [],
        projectAffinityNames: [],
      },
      hits: [
        {
          chunkId: "issue-echo",
          documentId: "doc-issue",
          sourceType: "issue",
          authorityLevel: "working",
          documentIssueId: "issue-1",
          documentProjectId: "project-cloud",
          path: "issues/CLO-21/issue.md",
          title: "CLO-21 issue snapshot",
          headingPath: "issue",
          symbolName: null,
          textContent: "Siemens series_name stores SeriesDescription instead of ProtocolName.",
          documentMetadata: { artifactKind: "issue_snapshot" },
          chunkMetadata: {},
          denseScore: 0.9,
          sparseScore: 1.1,
          rerankScore: null,
          fusedScore: 3.2,
          updatedAt: new Date("2026-03-18T00:00:00Z"),
        },
        {
          chunkId: "cloud-code-summary",
          documentId: "doc-cloud-code-summary",
          sourceType: "code_summary",
          authorityLevel: "canonical",
          documentIssueId: null,
          documentProjectId: "project-cloud",
          path: "internal/server/registry/series.go",
          title: "series.go summary",
          headingPath: "internal/server/registry/series.go",
          symbolName: null,
          textContent: [
            "This go file is located at internal/server/registry/series.go.",
            "Semantic hints from the implementation include dicom, metadata, series, protocol, description, registry.",
            "Representative implementation excerpt: RegisterSeries persists series_name in the registry database. Siemens should prefer ProtocolName over SeriesDescription before persistence.",
          ].join(" "),
          documentMetadata: {
            summaryKind: "file",
            pmProjectSelection: {
              ownerTags: ["series", "protocol", "description", "registry"],
              supportTags: ["dicom", "metadata", "database"],
              avoidTags: [],
            },
            requiredKnowledgeTags: ["series", "protocol", "description", "registry"],
            tags: ["dicom", "metadata", "series", "protocol", "description", "registry"],
          },
          chunkMetadata: {},
          denseScore: 0.75,
          sparseScore: 0.7,
          rerankScore: null,
          fusedScore: 2.1,
          updatedAt: new Date("2026-03-18T00:00:00Z"),
        },
      ],
    });

    expect(reranked[0]?.chunkId).toBe("cloud-code-summary");
    expect(reranked[0]?.rerankScore).toBeGreaterThan(reranked[1]?.rerankScore ?? 0);
  });

  it("boosts branch-aligned evidence and penalizes stale versions", () => {
    const reranked = rerankRetrievalHits({
      issueId: "issue-1",
      projectId: "project-1",
      finalK: 2,
      signals: {
        exactPaths: [],
        fileNames: [],
        symbolHints: [],
        knowledgeTags: [],
        preferredSourceTypes: ["code"],
        blockerCode: null,
        questionType: null,
      },
      temporalContext: {
        branchName: "squadrail/clo-1-eng-1",
        defaultBranchName: "main",
        headSha: "abc123",
        source: "artifact",
      },
      documentVersionMap: new Map([
        ["doc-1", [
          {
            documentId: "doc-1",
            branchName: "main",
            defaultBranchName: "main",
            commitSha: "aaa111",
            parentCommitSha: null,
            isHead: true,
            isDefaultBranch: true,
            capturedAt: new Date("2026-03-10T00:00:00Z"),
            metadata: {},
          },
        ]],
        ["doc-2", [
          {
            documentId: "doc-2",
            branchName: "squadrail/clo-1-eng-1",
            defaultBranchName: "main",
            commitSha: "abc123",
            parentCommitSha: "aaa111",
            isHead: true,
            isDefaultBranch: false,
            capturedAt: new Date("2026-03-10T00:00:00Z"),
            metadata: {},
          },
        ]],
      ]),
      hits: [
        {
          chunkId: "chunk-1",
          documentId: "doc-1",
          sourceType: "code",
          authorityLevel: "canonical",
          documentIssueId: null,
          documentProjectId: "project-1",
          path: "src/retry.ts",
          title: "main branch retry",
          headingPath: "src/retry.ts",
          symbolName: "retryWorker",
          textContent: "main branch implementation",
          documentMetadata: { isLatestForScope: true },
          chunkMetadata: {},
          denseScore: 0.9,
          sparseScore: 0.8,
          rerankScore: null,
          fusedScore: 2.9,
          updatedAt: new Date("2026-03-07T00:00:00Z"),
        },
        {
          chunkId: "chunk-2",
          documentId: "doc-2",
          sourceType: "code",
          authorityLevel: "canonical",
          documentIssueId: null,
          documentProjectId: "project-1",
          path: "src/retry.ts",
          title: "issue branch retry",
          headingPath: "src/retry.ts",
          symbolName: "retryWorker",
          textContent: "issue branch implementation",
          documentMetadata: { isLatestForScope: true },
          chunkMetadata: {},
          denseScore: 0.2,
          sparseScore: 0.2,
          rerankScore: null,
          fusedScore: 1.8,
          updatedAt: new Date("2026-03-08T00:00:00Z"),
        },
      ],
    });

    expect(reranked[0]?.chunkId).toBe("chunk-2");
    expect(reranked[0]?.temporalMetadata?.matchType).toBe("exact_commit");
    expect(reranked[1]?.temporalMetadata?.matchType).toBe("default_branch_head");
  });

  it("applies role-specific personalization boosts during rerank", () => {
    const reranked = rerankRetrievalHits({
      issueId: "issue-1",
      projectId: "project-1",
      finalK: 2,
      signals: {
        exactPaths: [],
        fileNames: [],
        symbolHints: [],
        knowledgeTags: [],
        preferredSourceTypes: ["code", "adr"],
        blockerCode: null,
        questionType: null,
        projectAffinityIds: ["project-1"],
        projectAffinityNames: ["swiftsight-agent"],
      },
      personalizationProfile: {
        applied: true,
        scopes: ["global", "project"],
        feedbackCount: 8,
        positiveFeedbackCount: 6,
        negativeFeedbackCount: 2,
        sourceTypeBoosts: { code: 0.2 },
        pathBoosts: { "src/retry.ts": 0.45 },
        symbolBoosts: { retryWorker: 0.18 },
      },
      hits: [
        {
          chunkId: "chunk-1",
          documentId: "doc-1",
          sourceType: "adr",
          authorityLevel: "canonical",
          documentIssueId: null,
          documentProjectId: "project-1",
          path: "docs/adr/retries.md",
          title: "Retry ADR",
          headingPath: "Decision",
          symbolName: null,
          textContent: "Bounded retry guidance",
          documentMetadata: { isLatestForScope: true },
          chunkMetadata: {},
          denseScore: 0.8,
          sparseScore: 0.8,
          rerankScore: null,
          fusedScore: 2.95,
          updatedAt: new Date("2026-03-07T00:00:00Z"),
        },
        {
          chunkId: "chunk-2",
          documentId: "doc-2",
          sourceType: "code",
          authorityLevel: "working",
          documentIssueId: "issue-1",
          documentProjectId: "project-1",
          path: "src/retry.ts",
          title: "retry.ts",
          headingPath: "src/retry.ts",
          symbolName: "retryWorker",
          textContent: "function retryWorker() {}",
          documentMetadata: { isLatestForScope: true },
          chunkMetadata: {},
          denseScore: 0.3,
          sparseScore: 0.2,
          rerankScore: null,
          fusedScore: 2.0,
          updatedAt: new Date("2026-03-06T00:00:00Z"),
        },
      ],
    });

    expect(reranked[0]?.chunkId).toBe("chunk-2");
    expect(reranked[0]?.personalizationMetadata?.totalBoost).toBeGreaterThan(0.7);
  });

  it("stabilizes ranking so stale issue snapshots can outrank weaker review metadata when dense relevance is higher", () => {
    const reranked = rerankRetrievalHits({
      issueId: "issue-1",
      projectId: "project-1",
      finalK: 2,
      signals: {
        exactPaths: ["internal/storage/path.go"],
        fileNames: ["path.go"],
        symbolHints: ["ResolveStoragePath"],
        knowledgeTags: [],
        preferredSourceTypes: ["code", "test_report", "review", "issue"],
        blockerCode: null,
        questionType: null,
        projectAffinityIds: ["project-1"],
        projectAffinityNames: ["swiftsight-agent"],
      },
      hits: [
        {
          chunkId: "chunk-issue",
          documentId: "doc-issue",
          sourceType: "issue",
          authorityLevel: "canonical",
          documentIssueId: "issue-1",
          documentProjectId: "project-1",
          path: "issues/CLO-68/issue.md",
          title: "CLO-68 issue snapshot",
          headingPath: "Issue Snapshot",
          symbolName: null,
          textContent: "Fix path normalization in storage layer",
          documentMetadata: {
            artifactKind: "issue_snapshot",
            isLatestForScope: true,
          },
          chunkMetadata: {},
          denseScore: 0.92,
          sparseScore: 0.88,
          rerankScore: null,
          fusedScore: 4.4,
          updatedAt: new Date("2026-03-09T00:00:00Z"),
        },
        {
          chunkId: "chunk-review",
          documentId: "doc-review",
          sourceType: "review",
          authorityLevel: "canonical",
          documentIssueId: "issue-1",
          documentProjectId: "project-1",
          path: "issues/CLO-68/review/0004-submit-for-review.md",
          title: "Review artifact",
          headingPath: "Changed Files",
          symbolName: null,
          textContent: "Updated internal/storage/path.go and added tests.",
          documentMetadata: {
            artifactKind: "review_event",
            changedPaths: ["internal/storage/path.go"],
            isLatestForScope: true,
          },
          chunkMetadata: {},
          denseScore: 0.35,
          sparseScore: 0.21,
          rerankScore: null,
          fusedScore: 2.35,
          updatedAt: new Date("2026-03-10T00:00:00Z"),
        },
      ],
    });

    expect(reranked[0]?.chunkId).toBe("chunk-issue");
    expect(reranked[1]?.chunkId).toBe("chunk-review");
    expect(reranked[0]?.fusedScore).toBeGreaterThan(reranked[1]?.fusedScore ?? 0);
  });

  it("keeps direct code hits ahead of issue snapshots that only match changedPaths metadata", () => {
    const reranked = rerankRetrievalHits({
      issueId: "issue-1",
      projectId: "project-1",
      finalK: 3,
      signals: {
        exactPaths: ["internal/storage/path.go"],
        fileNames: ["path.go"],
        symbolHints: ["SafeJoin"],
        knowledgeTags: [],
        preferredSourceTypes: ["code", "test_report", "review", "issue"],
        blockerCode: null,
        questionType: null,
        projectAffinityIds: ["project-1"],
        projectAffinityNames: ["swiftsight-agent"],
      },
      hits: [
        {
          chunkId: "chunk-issue",
          documentId: "doc-issue",
          sourceType: "issue",
          authorityLevel: "canonical",
          documentIssueId: "issue-1",
          documentProjectId: "project-1",
          path: "issues/CLO-68/issue.md",
          title: "CLO-68 issue snapshot",
          headingPath: "Issue Snapshot",
          symbolName: null,
          textContent: "Fix SafeJoin to preserve nested safe paths.",
          documentMetadata: {
            artifactKind: "issue_snapshot",
            changedPaths: ["internal/storage/path.go"],
            isLatestForScope: true,
          },
          chunkMetadata: {},
          denseScore: 0.96,
          sparseScore: 0.92,
          rerankScore: null,
          fusedScore: 4.7,
          updatedAt: new Date("2026-03-10T00:00:00Z"),
        },
        {
          chunkId: "chunk-code",
          documentId: "doc-code",
          sourceType: "code",
          authorityLevel: "working",
          documentIssueId: null,
          documentProjectId: "project-1",
          path: "internal/storage/path.go",
          title: "path.go",
          headingPath: "internal/storage/path.go",
          symbolName: "SafeJoin",
          textContent: "SafeJoin joins nested relative segments safely.",
          documentMetadata: {
            isLatestForScope: true,
          },
          chunkMetadata: {},
          denseScore: 0.42,
          sparseScore: 0.28,
          rerankScore: null,
          fusedScore: 2.6,
          updatedAt: new Date("2026-03-09T00:00:00Z"),
        },
        {
          chunkId: "chunk-review",
          documentId: "doc-review",
          sourceType: "review",
          authorityLevel: "canonical",
          documentIssueId: "issue-1",
          documentProjectId: "project-1",
          path: "issues/CLO-68/review/submit.md",
          title: "Review artifact",
          headingPath: "Changed Files",
          symbolName: null,
          textContent: "Changed internal/storage/path.go and updated tests.",
          documentMetadata: {
            artifactKind: "review_event",
            changedPaths: ["internal/storage/path.go"],
            isLatestForScope: true,
          },
          chunkMetadata: {},
          denseScore: 0.31,
          sparseScore: 0.25,
          rerankScore: null,
          fusedScore: 2.3,
          updatedAt: new Date("2026-03-10T00:00:00Z"),
        },
      ],
    });

    expect(reranked[0]?.chunkId).toBe("chunk-code");
    expect(reranked[1]?.chunkId).toBe("chunk-issue");
    expect(reranked[2]?.chunkId).toBe("chunk-review");
    expect(reranked[2]?.rerankScore).toBeLessThan(reranked[0]?.rerankScore ?? 0);
  });

  it("adds explicit related issue ids as graph expansion seeds", () => {
    const seeds = buildGraphExpansionSeeds({
      hits: [],
      linkMap: new Map(),
      signals: {
        exactPaths: [],
        fileNames: [],
        symbolHints: [],
        knowledgeTags: [],
        preferredSourceTypes: ["issue", "review", "code"],
        blockerCode: null,
        questionType: null,
        projectAffinityIds: ["project-1"],
        projectAffinityNames: ["swiftsight-agent"],
        relatedIssueIds: ["issue-related-1"],
      },
    });

    expect(seeds.map((seed) => `${seed.entityType}:${seed.entityId}`)).toContain("issue:issue-related-1");
  });

  it("prefers related issue organizational memory over unrelated issue memory when direct evidence is absent", () => {
    const reranked = rerankRetrievalHits({
      issueId: "issue-1",
      projectId: "project-1",
      finalK: 2,
      signals: {
        exactPaths: [],
        fileNames: [],
        symbolHints: [],
        knowledgeTags: [],
        preferredSourceTypes: ["issue", "review", "code"],
        blockerCode: null,
        questionType: null,
        projectAffinityIds: ["project-1"],
        projectAffinityNames: ["swiftsight-agent"],
        relatedIssueIds: ["issue-related-1"],
      },
      hits: [
        {
          chunkId: "related-review",
          documentId: "doc-related-review",
          sourceType: "review",
          authorityLevel: "canonical",
          documentIssueId: "issue-related-1",
          documentProjectId: "project-1",
          path: "issues/CLO-88/review/submit.md",
          title: "Related review artifact",
          headingPath: null,
          symbolName: null,
          textContent: "Resolved the same failure mode in a sibling issue.",
          documentMetadata: { artifactKind: "review_event" },
          chunkMetadata: {},
          denseScore: 0.4,
          sparseScore: 0.3,
          rerankScore: null,
          fusedScore: 1.5,
          updatedAt: new Date("2026-03-10T00:00:00Z"),
        },
        {
          chunkId: "unrelated-review",
          documentId: "doc-unrelated-review",
          sourceType: "review",
          authorityLevel: "canonical",
          documentIssueId: "issue-unrelated-9",
          documentProjectId: "project-1",
          path: "issues/CLO-91/review/submit.md",
          title: "Unrelated review artifact",
          headingPath: null,
          symbolName: null,
          textContent: "Different regression without matching issue lineage.",
          documentMetadata: { artifactKind: "review_event" },
          chunkMetadata: {},
          denseScore: 0.4,
          sparseScore: 0.3,
          rerankScore: null,
          fusedScore: 1.5,
          updatedAt: new Date("2026-03-10T00:00:00Z"),
        },
      ],
    });

    expect(reranked[0]?.chunkId).toBe("related-review");
  });

  it("boosts related close artifacts and explains the reuse rationale", () => {
    const reranked = rerankRetrievalHits({
      issueId: "issue-1",
      projectId: "project-1",
      finalK: 2,
      signals: {
        exactPaths: [],
        fileNames: [],
        symbolHints: [],
        knowledgeTags: [],
        preferredSourceTypes: ["review", "protocol_message", "issue", "code"],
        blockerCode: null,
        questionType: null,
        projectAffinityIds: ["project-1"],
        projectAffinityNames: ["swiftsight-agent"],
        relatedIssueIds: ["issue-related-1"],
      },
      hits: [
        {
          chunkId: "related-close",
          documentId: "doc-related-close",
          sourceType: "protocol_message",
          authorityLevel: "working",
          documentIssueId: "issue-related-1",
          documentProjectId: "project-1",
          path: "issues/CLO-88/protocol/close.md",
          title: "Related close artifact",
          headingPath: null,
          symbolName: null,
          textContent: "Rollout closed after verification and rollback planning.",
          documentMetadata: { artifactKind: "protocol_event", messageType: "CLOSE_TASK" },
          chunkMetadata: {},
          denseScore: 0.32,
          sparseScore: 0.24,
          rerankScore: null,
          fusedScore: 1.3,
          updatedAt: new Date("2026-03-10T00:00:00Z"),
        },
        {
          chunkId: "unrelated-close",
          documentId: "doc-unrelated-close",
          sourceType: "protocol_message",
          authorityLevel: "working",
          documentIssueId: "issue-unrelated-9",
          documentProjectId: "project-1",
          path: "issues/CLO-99/protocol/close.md",
          title: "Unrelated close artifact",
          headingPath: null,
          symbolName: null,
          textContent: "Different close flow without the same lineage.",
          documentMetadata: { artifactKind: "protocol_event", messageType: "CLOSE_TASK" },
          chunkMetadata: {},
          denseScore: 0.32,
          sparseScore: 0.24,
          rerankScore: null,
          fusedScore: 1.3,
          updatedAt: new Date("2026-03-10T00:00:00Z"),
        },
      ],
    });

    expect(reranked[0]?.chunkId).toBe("related-close");
    expect(buildHitRationale({
      hit: reranked[0]!,
      issueId: "issue-1",
      projectId: "project-1",
      projectAffinityIds: ["project-1"],
      signals: {
        exactPaths: [],
        fileNames: [],
        symbolHints: [],
        knowledgeTags: [],
        preferredSourceTypes: ["review", "protocol_message", "issue", "code"],
        blockerCode: null,
        questionType: null,
        projectAffinityIds: ["project-1"],
        projectAffinityNames: ["swiftsight-agent"],
        relatedIssueIds: ["issue-related-1"],
      },
      weights: resolveRetrievalPolicyRerankConfig({
        allowedSourceTypes: ["review", "protocol_message", "issue", "code"],
      }).weights,
    })).toContain("reuse_close_artifact");
  });

  it("summarizes reuse evidence by related issue and artifact class", () => {
    const summary = computeRetrievalReuseSummary({
      relatedIssueIds: ["issue-related-1", "issue-related-2"],
      relatedIssueIdentifierMap: {
        "issue-related-1": "CLO-88",
        "issue-related-2": "CLO-91",
      },
      finalHits: [
        {
          chunkId: "fix-hit",
          documentId: "doc-fix",
          sourceType: "code",
          authorityLevel: "working",
          documentIssueId: "issue-related-1",
          documentProjectId: "project-1",
          path: "src/retry.ts",
          title: "retry.ts",
          headingPath: null,
          symbolName: "retryWorker",
          textContent: "Retry worker fix",
          documentMetadata: {},
          chunkMetadata: {},
          denseScore: 0.7,
          sparseScore: 0.4,
          rerankScore: 1.2,
          fusedScore: 2.3,
          updatedAt: new Date("2026-03-10T00:00:00Z"),
        },
        {
          chunkId: "review-hit",
          documentId: "doc-review",
          sourceType: "review",
          authorityLevel: "canonical",
          documentIssueId: "issue-related-1",
          documentProjectId: "project-1",
          path: "issues/CLO-88/review/submit.md",
          title: "Review artifact",
          headingPath: null,
          symbolName: null,
          textContent: "Review artifact",
          documentMetadata: { artifactKind: "review_event" },
          chunkMetadata: {},
          denseScore: 0.6,
          sparseScore: 0.5,
          rerankScore: 1.1,
          fusedScore: 2.2,
          updatedAt: new Date("2026-03-10T00:00:00Z"),
        },
        {
          chunkId: "close-hit",
          documentId: "doc-close",
          sourceType: "protocol_message",
          authorityLevel: "working",
          documentIssueId: "issue-related-2",
          documentProjectId: "project-1",
          path: "issues/CLO-91/close.md",
          title: "Close artifact",
          headingPath: null,
          symbolName: null,
          textContent: "Closed after rollout verification",
          documentMetadata: { artifactKind: "protocol_event", messageType: "CLOSE_TASK" },
          chunkMetadata: {},
          denseScore: 0.5,
          sparseScore: 0.2,
          rerankScore: 0.9,
          fusedScore: 1.8,
          updatedAt: new Date("2026-03-10T00:00:00Z"),
        },
        {
          chunkId: "decision-hit",
          documentId: "doc-decision",
          sourceType: "issue",
          authorityLevel: "canonical",
          documentIssueId: "issue-related-2",
          documentProjectId: "project-1",
          path: "issues/CLO-91/issue.md",
          title: "Issue snapshot",
          headingPath: null,
          symbolName: null,
          textContent: "Decision snapshot",
          documentMetadata: { artifactKind: "issue_snapshot" },
          chunkMetadata: {},
          denseScore: 0.4,
          sparseScore: 0.2,
          rerankScore: 0.8,
          fusedScore: 1.5,
          updatedAt: new Date("2026-03-10T00:00:00Z"),
        },
      ],
    });

    expect(summary).toMatchObject({
      requestedRelatedIssueCount: 2,
      reuseHitCount: 4,
      reusedIssueCount: 2,
      reusedIssueIds: ["issue-related-1", "issue-related-2"],
      reusedIssueIdentifiers: ["CLO-88", "CLO-91"],
      reuseArtifactKinds: ["fix", "review", "close", "decision"],
      reuseFixHitCount: 1,
      reuseReviewHitCount: 1,
      reuseCloseHitCount: 1,
      reuseDecisionHitCount: 1,
    });
  });

  it("applies policy-configured rerank weights and source preferences", () => {
    const rerankConfig = resolveRetrievalPolicyRerankConfig({
      allowedSourceTypes: ["adr", "code", "review"],
      metadata: {
        sourcePreferences: ["adr", "code", "review"],
        sourceTypeBoosts: {
          code: 3.2,
          adr: 0.2,
        },
        weights: {
          exactPathBoost: 0.25,
          fileNameBoost: 0.1,
          latestBoost: 0.05,
        },
        modelRerank: {
          enabled: true,
          candidateCount: 4,
          baseBoost: 1.8,
          decay: 0.2,
        },
      },
    });

    expect(rerankConfig.modelRerank).toMatchObject({
      enabled: true,
      candidateCount: 4,
      baseBoost: 1.8,
      decay: 0.2,
    });

    const reranked = rerankRetrievalHits({
      issueId: "issue-1",
      projectId: "project-1",
      finalK: 2,
      rerankConfig,
      signals: {
        exactPaths: ["src/retry.ts"],
        fileNames: ["retry.ts"],
        symbolHints: ["retryWorker"],
        knowledgeTags: [],
        preferredSourceTypes: ["adr", "code", "review"],
        blockerCode: null,
        questionType: null,
      },
      hits: [
        {
          chunkId: "chunk-1",
          documentId: "doc-1",
          sourceType: "adr",
          authorityLevel: "canonical",
          documentIssueId: null,
          documentProjectId: "project-1",
          path: "docs/adr/retries.md",
          title: "Retry ADR",
          headingPath: "Decision",
          symbolName: null,
          textContent: "Bounded retry guidance",
          documentMetadata: { isLatestForScope: true },
          chunkMetadata: {},
          denseScore: 0.9,
          sparseScore: 0.7,
          rerankScore: null,
          fusedScore: 2.95,
          updatedAt: new Date("2026-03-07T00:00:00Z"),
        },
        {
          chunkId: "chunk-2",
          documentId: "doc-2",
          sourceType: "code",
          authorityLevel: "working",
          documentIssueId: "issue-1",
          documentProjectId: "project-1",
          path: "src/retry.ts",
          title: "retry.ts",
          headingPath: "src/retry.ts",
          symbolName: "retryWorker",
          textContent: "function retryWorker() {}",
          documentMetadata: { isLatestForScope: true },
          chunkMetadata: {},
          denseScore: 0.3,
          sparseScore: 0.2,
          rerankScore: null,
          fusedScore: 2.0,
          updatedAt: new Date("2026-03-06T00:00:00Z"),
        },
      ],
    });

    expect(reranked[0]?.chunkId).toBe("chunk-2");
    expect(reranked[0]?.rerankScore).toBeGreaterThan(3);
  });

  it("applies model rerank order as an optional final pass", () => {
    const ordered = applyModelRerankOrder({
      finalK: 2,
      rankedChunkIds: ["chunk-2", "chunk-1"],
      modelRerank: {
        enabled: true,
        candidateCount: 4,
        baseBoost: 2,
        decay: 0.25,
      },
      hits: [
        {
          chunkId: "chunk-1",
          documentId: "doc-1",
          sourceType: "adr",
          authorityLevel: "canonical",
          documentIssueId: null,
          documentProjectId: "project-1",
          path: "docs/adr/retries.md",
          title: "Retry ADR",
          headingPath: "Decision",
          symbolName: null,
          textContent: "Bounded retry guidance",
          documentMetadata: { isLatestForScope: true },
          chunkMetadata: {},
          denseScore: 0.9,
          sparseScore: 0.8,
          rerankScore: 1.1,
          fusedScore: 4.0,
          updatedAt: new Date("2026-03-07T00:00:00Z"),
        },
        {
          chunkId: "chunk-2",
          documentId: "doc-2",
          sourceType: "code",
          authorityLevel: "working",
          documentIssueId: "issue-1",
          documentProjectId: "project-1",
          path: "src/retry.ts",
          title: "retry.ts",
          headingPath: "src/retry.ts",
          symbolName: "retryWorker",
          textContent: "function retryWorker() {}",
          documentMetadata: { isLatestForScope: true },
          chunkMetadata: {},
          denseScore: 0.4,
          sparseScore: 0.4,
          rerankScore: 1.4,
          fusedScore: 3.6,
          updatedAt: new Date("2026-03-06T00:00:00Z"),
        },
      ],
    });

    expect(ordered[0]?.chunkId).toBe("chunk-2");
    expect(ordered[0]?.modelRerankRank).toBe(1);
    expect(ordered[0]?.fusedScore).toBeGreaterThan(ordered[1]?.fusedScore ?? 0);
  });

  it("penalizes expired knowledge and prefers fresher evidence", () => {
    const rerankConfig = resolveRetrievalPolicyRerankConfig({
      allowedSourceTypes: ["runbook", "adr"],
      metadata: {
        weights: {
          freshnessWindowDays: 30,
          freshnessMaxBoost: 0.8,
          expiredPenalty: -2,
          futurePenalty: -0.5,
          supersededPenalty: -1,
        },
      },
    });

    const reranked = rerankRetrievalHits({
      issueId: "issue-1",
      projectId: "project-1",
      finalK: 2,
      rerankConfig,
      signals: {
        exactPaths: [],
        fileNames: [],
        symbolHints: [],
        knowledgeTags: [],
        preferredSourceTypes: ["runbook", "adr"],
        blockerCode: null,
        questionType: null,
      },
      hits: [
        {
          chunkId: "chunk-1",
          documentId: "doc-1",
          sourceType: "runbook",
          authorityLevel: "canonical",
          documentIssueId: null,
          documentProjectId: "project-1",
          path: "docs/runbook/retries.md",
          title: "Retry runbook",
          headingPath: "Runbook",
          symbolName: null,
          textContent: "Current retry runbook",
          documentMetadata: {
            isLatestForScope: true,
            validUntil: "2026-12-31T00:00:00.000Z",
          },
          chunkMetadata: {},
          denseScore: 0.4,
          sparseScore: 0.5,
          rerankScore: null,
          fusedScore: 2.2,
          updatedAt: new Date(),
        },
        {
          chunkId: "chunk-2",
          documentId: "doc-2",
          sourceType: "runbook",
          authorityLevel: "canonical",
          documentIssueId: null,
          documentProjectId: "project-1",
          path: "docs/runbook/retries-old.md",
          title: "Old retry runbook",
          headingPath: "Runbook",
          symbolName: null,
          textContent: "Old retry runbook",
          documentMetadata: {
            isLatestForScope: false,
            validUntil: "2024-01-01T00:00:00.000Z",
            supersededAt: "2025-01-01T00:00:00.000Z",
          },
          chunkMetadata: {},
          denseScore: 0.6,
          sparseScore: 0.7,
          rerankScore: null,
          fusedScore: 2.6,
          updatedAt: new Date("2024-01-01T00:00:00.000Z"),
        },
      ],
    });

    expect(reranked[0]?.chunkId).toBe("chunk-1");
    expect(reranked[0]?.fusedScore).toBeGreaterThan(reranked[1]?.fusedScore ?? 0);
  });
});
