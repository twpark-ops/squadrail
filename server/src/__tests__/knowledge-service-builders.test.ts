import { describe, expect, it } from "vitest";
import {
  buildMinimalCodeGraphFromChunks,
  buildKnowledgeDocumentVersionValues,
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
});
