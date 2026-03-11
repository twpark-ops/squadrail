import { describe, expect, it } from "vitest";
import { buildKnowledgeQualityDailyTrend } from "../services/knowledge.js";

describe("knowledge quality daily trend", () => {
  it("builds fixed daily buckets and aggregates cache, graph, and personalization counts", () => {
    const trend = buildKnowledgeQualityDailyTrend({
      days: 3,
      samples: [
        {
          createdAt: new Date("2026-03-09T12:00:00Z"),
          lowConfidence: false,
          graphExpanded: true,
          multiHopGraphExpanded: false,
          candidateCacheHit: true,
          finalCacheHit: false,
          personalized: true,
        },
        {
          createdAt: new Date("2026-03-09T18:30:00Z"),
          lowConfidence: true,
          graphExpanded: true,
          multiHopGraphExpanded: true,
          candidateCacheHit: false,
          finalCacheHit: true,
          personalized: false,
        },
        {
          createdAt: new Date("2026-03-10T09:00:00Z"),
          lowConfidence: false,
          graphExpanded: false,
          multiHopGraphExpanded: false,
          candidateCacheHit: false,
          finalCacheHit: false,
          personalized: true,
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
    });
    expect(march10).toMatchObject({
      totalRuns: 1,
      lowConfidenceRuns: 0,
      graphExpandedRuns: 0,
      multiHopGraphExpandedRuns: 0,
      candidateCacheHits: 0,
      finalCacheHits: 0,
      personalizedRuns: 1,
    });
  });
});
