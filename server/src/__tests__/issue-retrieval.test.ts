import { describe, expect, it } from "vitest";
import {
  applyModelRerankOrder,
  buildRetrievalQueryText,
  computeCosineSimilarity,
  deriveDynamicRetrievalSignals,
  deriveBriefScope,
  deriveRetrievalEventType,
  fuseRetrievalCandidates,
  resolveRetrievalPolicyRerankConfig,
  rerankRetrievalHits,
  renderRetrievedBriefMarkdown,
} from "../services/issue-retrieval.js";

describe("issue retrieval helpers", () => {
  it("maps protocol messages to retrieval events", () => {
    expect(deriveRetrievalEventType("ASSIGN_TASK")).toBe("on_assignment");
    expect(deriveRetrievalEventType("REASSIGN_TASK")).toBe("on_assignment");
    expect(deriveRetrievalEventType("SUBMIT_FOR_REVIEW")).toBe("on_review_submit");
    expect(deriveRetrievalEventType("NOTE")).toBeNull();
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

  it("derives dynamic retrieval signals from review payloads", () => {
    const signals = deriveDynamicRetrievalSignals({
      recipientRole: "reviewer",
      eventType: "on_review_submit",
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
