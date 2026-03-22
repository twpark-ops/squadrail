import { describe, expect, it } from "vitest";
import {
  collectNonReadyProjectIds,
  extractJsonTail,
  findLatestBriefByScope,
  isKnowledgeSetupReady,
  summarizeCitationCoverageGate,
  summarizeProtocolCitationCoverage,
  summarizeKnowledgeQualityGate,
  summarizeBriefQuality,
} from "../rag-readiness-utils.mjs";

describe("rag-readiness-utils", () => {
  it("extracts the trailing JSON payload from stdout", () => {
    const stdout = [
      "log line",
      "another line",
      JSON.stringify([{ issueId: "ISS-1", ok: true }], null, 2),
    ].join("\n");
    expect(extractJsonTail(stdout)).toEqual([{ issueId: "ISS-1", ok: true }]);
  });

  it("extracts the outer summary array when nested arrays and objects appear later in the text", () => {
    const stdout = [
      "noise",
      JSON.stringify(
        [
          {
            issueId: "ISS-2",
            merge: {
              remainingRisks: ["pending merge", "platform variance"],
            },
            checkpoints: [{ label: "qa-review", ok: true }],
          },
        ],
        null,
        2,
      ),
    ].join("\n");
    expect(extractJsonTail(stdout)).toEqual([
      {
        issueId: "ISS-2",
        merge: {
          remainingRisks: ["pending merge", "platform variance"],
        },
        checkpoints: [{ label: "qa-review", ok: true }],
      },
    ]);
  });

  it("detects whether knowledge setup is ready", () => {
    const ready = {
      activeJobCount: 0,
      projects: [
        { projectId: "a", projectStatus: "ready" },
        { projectId: "b", projectStatus: "ready" },
      ],
    };
    const notReady = {
      activeJobCount: 1,
      projects: [{ projectId: "a", projectStatus: "needs_import" }],
    };
    expect(isKnowledgeSetupReady(ready)).toBe(true);
    expect(isKnowledgeSetupReady(notReady)).toBe(false);
    expect(collectNonReadyProjectIds(notReady)).toEqual(["a"]);
  });

  it("finds the latest brief by scope and normalizes quality", () => {
    const briefs = [
      {
        briefScope: "reviewer",
        retrievalRunId: "run-older",
        createdAt: "2026-03-11T00:00:00.000Z",
        contentJson: {
          quality: {
            confidenceLevel: "medium",
          },
          hits: [{ path: "docs/old.md" }],
        },
      },
      {
        briefScope: "reviewer",
        retrievalRunId: "run-newer",
        createdAt: "2026-03-11T00:05:00.000Z",
        contentJson: {
          quality: {
            confidenceLevel: "high",
            graphHitCount: 3,
            graphMaxDepth: 2,
            graphHopDepthCounts: { 1: 2, 2: 1 },
            multiHopGraphHitCount: 1,
            candidateCacheHit: true,
            finalCacheHit: true,
            candidateCacheReason: "hit",
            finalCacheReason: "hit",
            exactPathSatisfied: true,
            personalizationApplied: true,
            personalizedHitCount: 2,
            averagePersonalizationBoost: 0.31,
            degradedReasons: ["narrow_source_diversity"],
          },
          hits: [{ path: "internal/observability/tracing.go" }],
        },
      },
    ];

    const latest = findLatestBriefByScope(briefs, "reviewer");
    expect(latest?.retrievalRunId).toBe("run-newer");
    expect(summarizeBriefQuality(latest)).toEqual({
      briefScope: "reviewer",
      retrievalRunId: "run-newer",
      confidenceLevel: "high",
      graphHitCount: 3,
      graphMaxDepth: 2,
      graphHopDepthCounts: { 1: 2, 2: 1 },
      multiHopGraphHitCount: 1,
      candidateCacheHit: true,
      finalCacheHit: true,
      candidateCacheReason: "hit",
      finalCacheReason: "hit",
      exactPathSatisfied: true,
      personalizationApplied: true,
      personalizedHitCount: 2,
      averagePersonalizationBoost: 0.31,
      organizationalMemoryHitCount: 0,
      codeHitCount: 0,
      reviewHitCount: 0,
      executableEvidenceHitCount: 0,
      degradedReasons: ["narrow_source_diversity"],
      hitPaths: ["internal/observability/tracing.go"],
      hitSourceTypes: [],
      topHitPath: "internal/observability/tracing.go",
      topHitSourceType: null,
      topHitArtifactKind: null,
    });
  });

  it("summarizes project-scoped knowledge quality gate payloads", () => {
    expect(summarizeKnowledgeQualityGate({
      totalRuns: 4,
      candidateCacheHitRate: 0.5,
      finalCacheHitRate: 0.25,
      multiHopGraphExpandedRuns: 2,
      readinessGate: {
        status: "pass",
        failures: [],
      },
      perProject: [{ projectId: "proj-1" }],
      perRole: [{ role: "reviewer" }],
    })).toEqual({
      status: "pass",
      failures: [],
      functionalStatus: null,
      functionalFailures: [],
      historicalStatus: null,
      historicalFailures: [],
      totalRuns: 4,
      candidateCacheHitRate: 0.5,
      finalCacheHitRate: 0.25,
      multiHopGraphExpandedRuns: 2,
      matchingProjectCount: 1,
      matchingRoleCount: 1,
    });
  });

  it("splits functional readiness from historical hygiene failures", () => {
    expect(summarizeKnowledgeQualityGate({
      totalRuns: 2,
      readinessGate: {
        status: "warn",
        failures: ["issue_memory_coverage"],
      },
      functionalReadinessGate: {
        status: "pass",
        failures: [],
      },
      historicalHygieneGate: {
        status: "warn",
        failures: ["issue_memory_coverage"],
      },
      perProject: [{ projectId: "proj-1" }],
      perRole: [{ role: "engineer" }],
    })).toEqual({
      status: "warn",
      failures: ["issue_memory_coverage"],
      functionalStatus: "pass",
      functionalFailures: [],
      historicalStatus: "warn",
      historicalFailures: ["issue_memory_coverage"],
      totalRuns: 2,
      candidateCacheHitRate: 0,
      finalCacheHitRate: 0,
      multiHopGraphExpandedRuns: 0,
      matchingProjectCount: 1,
      matchingRoleCount: 1,
    });
  });

  it("summarizes protocol citation coverage across review and close messages", () => {
    expect(summarizeProtocolCitationCoverage([
      {
        messageType: "APPROVE_IMPLEMENTATION",
        createdAt: "2026-03-23T08:00:00.000Z",
        payload: {
          evidenceCitations: [
            {
              retrievalRunId: "run-1",
              briefId: "brief-1",
              citedPaths: ["src/query.ts"],
              citedSourceTypes: ["code", "code_summary"],
              citedSummaryKinds: ["module"],
            },
          ],
        },
      },
      {
        messageType: "CLOSE_TASK",
        createdAt: "2026-03-23T08:05:00.000Z",
        payload: {
          evidenceCitations: [
            {
              retrievalRunId: "run-2",
              briefId: "brief-2",
              citedPaths: ["docs/release.md"],
              citedSourceTypes: ["review"],
              citedSummaryKinds: ["file"],
            },
          ],
        },
      },
    ])).toEqual({
      messageCount: 2,
      citationCount: 2,
      messageTypeCounts: {
        CLOSE_TASK: 1,
        APPROVE_IMPLEMENTATION: 1,
      },
      retrievalRunIds: ["run-2", "run-1"],
      briefIds: ["brief-2", "brief-1"],
      citedPaths: ["docs/release.md", "src/query.ts"],
      citedSourceTypes: ["review", "code", "code_summary"],
      citedSummaryKinds: ["file", "module"],
      latestMessageType: "CLOSE_TASK",
      latestMessageAt: new Date("2026-03-23T08:05:00.000Z"),
    });
  });

  it("fails the citation gate when retrieval provenance is missing", () => {
    expect(
      summarizeCitationCoverageGate(
        {
          messageCount: 1,
          citationCount: 1,
          messageTypeCounts: { APPROVE_IMPLEMENTATION: 1 },
          retrievalRunIds: [],
          citedPaths: [],
          citedSourceTypes: ["code"],
        },
        {
          requiredMessageTypes: ["APPROVE_IMPLEMENTATION", "CLOSE_TASK"],
          requiredSourceTypes: ["code", "review"],
        },
      ),
    ).toEqual({
      status: "fail",
      failures: [
        "citation_retrieval_run_missing",
        "citation_path_missing",
        "citation_message_type_missing:CLOSE_TASK",
      ],
      messageCount: 1,
      citationCount: 1,
      retrievalRunCount: 0,
      citedPathCount: 0,
      citedSourceTypeCount: 1,
    });
  });

  it("passes the citation gate when review and close payloads cite evidence", () => {
    expect(
      summarizeCitationCoverageGate(
        {
          messageCount: 2,
          citationCount: 2,
          messageTypeCounts: {
            APPROVE_IMPLEMENTATION: 1,
            CLOSE_TASK: 1,
          },
          retrievalRunIds: ["run-1", "run-2"],
          citedPaths: ["src/query.ts"],
          citedSourceTypes: ["code", "review"],
        },
        {
          requiredMessageTypes: ["APPROVE_IMPLEMENTATION", "CLOSE_TASK"],
          requiredSourceTypes: ["code", "review"],
        },
      ),
    ).toEqual({
      status: "pass",
      failures: [],
      messageCount: 2,
      citationCount: 2,
      retrievalRunCount: 2,
      citedPathCount: 1,
      citedSourceTypeCount: 2,
    });
  });
});
