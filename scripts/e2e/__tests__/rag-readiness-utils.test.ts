import { describe, expect, it } from "vitest";
import {
  collectNonReadyProjectIds,
  extractJsonTail,
  findLatestBriefByScope,
  isKnowledgeSetupReady,
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
            multiHopGraphHitCount: 1,
            candidateCacheHit: true,
            finalCacheHit: true,
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
      multiHopGraphHitCount: 1,
      candidateCacheHit: true,
      finalCacheHit: true,
      personalizationApplied: true,
      personalizedHitCount: 2,
      averagePersonalizationBoost: 0.31,
      degradedReasons: ["narrow_source_diversity"],
      hitPaths: ["internal/observability/tracing.go"],
    });
  });
});
