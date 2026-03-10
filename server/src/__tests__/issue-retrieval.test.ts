import { describe, expect, it } from "vitest";
import {
  applyModelRerankOrder,
  buildGraphExpansionSeeds,
  buildRetrievalQueryText,
  computeCosineSimilarity,
  deriveDynamicRetrievalSignals,
  deriveBriefScope,
  deriveRetrievalEventType,
  fuseRetrievalCandidates,
  mergeGraphExpandedHits,
  resolveRetrievalPolicyRerankConfig,
  rerankRetrievalHits,
  renderRetrievedBriefMarkdown,
  selectProtocolRetrievalRecipients,
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
          },
        },
      ],
    });

    expect(markdown).toContain("graph: symbol, path");
    expect(markdown).toContain("linked_symbol");
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
          },
        },
      ],
      finalK: 4,
    });

    expect(merged).toHaveLength(2);
    expect(merged[0]?.chunkId).toBe("chunk-2");
    expect(merged[0]?.graphMetadata?.entityTypes).toContain("symbol");
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
