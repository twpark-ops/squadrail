import { describe, expect, it } from "vitest";
import { buildKnowledgeQualityDailyTrend } from "../services/knowledge.js";

describe("knowledge quality daily trend", () => {
  it("builds fixed daily buckets and aggregates cache, graph, and personalization counts", () => {
    const trend = buildKnowledgeQualityDailyTrend({
      days: 3,
      now: new Date("2026-03-11T00:00:00Z"),
      samples: [
        {
          createdAt: new Date("2026-03-09T12:00:00Z"),
          lowConfidence: false,
          graphExpanded: true,
          multiHopGraphExpanded: false,
          candidateCacheHit: true,
          finalCacheHit: false,
          personalized: true,
          reused: false,
          actorRole: "reviewer",
          issueProjectId: "project-a",
          topHitSourceType: "code",
          candidateCacheReason: "hit",
          finalCacheReason: "miss_cold",
          candidateCacheProvenance: "exact_key",
          finalCacheProvenance: null,
        },
        {
          createdAt: new Date("2026-03-09T18:30:00Z"),
          lowConfidence: true,
          graphExpanded: true,
          multiHopGraphExpanded: true,
          candidateCacheHit: false,
          finalCacheHit: true,
          personalized: false,
          reused: true,
          actorRole: "engineer",
          issueProjectId: "project-a",
          topHitSourceType: "review",
          candidateCacheReason: "miss_feedback_changed",
          finalCacheReason: "hit",
          candidateCacheProvenance: null,
          finalCacheProvenance: "feedback_drift",
        },
        {
          createdAt: new Date("2026-03-10T09:00:00Z"),
          lowConfidence: false,
          graphExpanded: false,
          multiHopGraphExpanded: false,
          candidateCacheHit: false,
          finalCacheHit: false,
          personalized: true,
          reused: true,
          actorRole: "reviewer",
          issueProjectId: "project-b",
          topHitSourceType: "code",
          candidateCacheReason: "miss_policy_changed",
          finalCacheReason: "miss_revision_changed",
          candidateCacheProvenance: null,
          finalCacheProvenance: null,
        },
      ],
    });

    expect(trend).toHaveLength(3);
    const march9 = trend.find((entry) => entry.date === "2026-03-09");
    const march10 = trend.find((entry) => entry.date === "2026-03-10");

    expect(march9).toMatchObject({
      totalRuns: 2,
      lowConfidenceRuns: 1,
      graphExpandedRuns: 2,
      multiHopGraphExpandedRuns: 1,
      candidateCacheHits: 1,
      finalCacheHits: 1,
      personalizedRuns: 1,
      reuseRuns: 1,
      roleCounts: {
        reviewer: 1,
        engineer: 1,
      },
      projectCounts: {
        "project-a": 2,
      },
      topHitSourceTypeCounts: {
        code: 1,
        review: 1,
      },
      candidateCacheReasonCounts: {
        hit: 1,
        miss_feedback_changed: 1,
      },
      finalCacheReasonCounts: {
        miss_cold: 1,
        hit: 1,
      },
      candidateCacheProvenanceCounts: {
        exact_key: 1,
      },
      finalCacheProvenanceCounts: {
        feedback_drift: 1,
      },
    });
    expect(march10).toMatchObject({
      totalRuns: 1,
      lowConfidenceRuns: 0,
      graphExpandedRuns: 0,
      multiHopGraphExpandedRuns: 0,
      candidateCacheHits: 0,
      finalCacheHits: 0,
      personalizedRuns: 1,
      reuseRuns: 1,
      roleCounts: {
        reviewer: 1,
      },
      projectCounts: {
        "project-b": 1,
      },
      topHitSourceTypeCounts: {
        code: 1,
      },
      candidateCacheReasonCounts: {
        miss_policy_changed: 1,
      },
      finalCacheReasonCounts: {
        miss_revision_changed: 1,
      },
    });
  });

  it("ignores out-of-window samples and empty dimensions while preserving empty buckets", () => {
    const trend = buildKnowledgeQualityDailyTrend({
      days: 2,
      now: new Date("2026-03-11T00:00:00Z"),
      samples: [
        {
          createdAt: new Date("2026-03-11T03:00:00Z"),
          lowConfidence: false,
          graphExpanded: false,
          multiHopGraphExpanded: false,
          candidateCacheHit: false,
          finalCacheHit: false,
          personalized: false,
          reused: false,
          actorRole: null,
          issueProjectId: null,
          topHitSourceType: null,
          candidateCacheReason: null,
          finalCacheReason: null,
          candidateCacheProvenance: null,
          finalCacheProvenance: null,
        },
        {
          createdAt: new Date("2026-03-08T23:59:59Z"),
          lowConfidence: true,
          graphExpanded: true,
          multiHopGraphExpanded: true,
          candidateCacheHit: true,
          finalCacheHit: true,
          personalized: true,
          reused: true,
          actorRole: "reviewer",
          issueProjectId: "project-old",
          topHitSourceType: "review",
          candidateCacheReason: "hit",
          finalCacheReason: "hit",
          candidateCacheProvenance: "exact_key",
          finalCacheProvenance: "exact_key",
        },
      ],
    });

    expect(trend).toHaveLength(2);
    expect(trend[0]).toMatchObject({
      date: "2026-03-10",
      totalRuns: 0,
      roleCounts: {},
      projectCounts: {},
    });
    expect(trend[1]).toMatchObject({
      date: "2026-03-11",
      totalRuns: 1,
      roleCounts: {},
      projectCounts: {},
      topHitSourceTypeCounts: {},
      candidateCacheReasonCounts: {},
      finalCacheReasonCounts: {},
    });
  });
});
