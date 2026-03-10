import { describe, expect, it } from "vitest";
import {
  aggregateRetrievalFeedbackProfile,
  computeRetrievalPersonalizationBoost,
  mergeRetrievalPersonalizationProfiles,
} from "../services/retrieval-personalization.js";

describe("retrieval personalization", () => {
  it("aggregates approval and change-request feedback into explainable boosts", () => {
    const profile = aggregateRetrievalFeedbackProfile({
      now: new Date("2026-03-10T12:00:00Z"),
      events: [
        { targetType: "path", targetId: "src/retry.ts", weight: 1.2, feedbackType: "approved" },
        { targetType: "path", targetId: "src/retry.ts", weight: 0.8, feedbackType: "merge_completed" },
        { targetType: "symbol", targetId: "retryWorker", weight: 0.9, feedbackType: "approved" },
        { targetType: "source_type", targetId: "code", weight: 0.6, feedbackType: "approved" },
        { targetType: "path", targetId: "docs/adr/retries.md", weight: -0.9, feedbackType: "request_changes" },
      ],
    });

    expect(profile.stats.feedbackCount).toBe(5);
    expect(profile.stats.positiveFeedbackCount).toBe(4);
    expect(profile.stats.negativeFeedbackCount).toBe(1);
    expect(profile.pathBoosts["src/retry.ts"]).toBeGreaterThan(0);
    expect(profile.pathBoosts["docs/adr/retries.md"]).toBeLessThan(0);
    expect(profile.symbolBoosts.retryWorker).toBeGreaterThan(0);
    expect(profile.sourceTypeBoosts.code).toBeGreaterThan(0);
  });

  it("merges global and project profiles with project preference", () => {
    const merged = mergeRetrievalPersonalizationProfiles({
      globalProfile: {
        version: 1,
        sourceTypeBoosts: { code: 0.2 },
        pathBoosts: { "src/retry.ts": 0.15 },
        symbolBoosts: {},
        stats: {
          feedbackCount: 3,
          positiveFeedbackCount: 3,
          negativeFeedbackCount: 0,
          mergeCompletedCount: 1,
          lastFeedbackAt: "2026-03-10T00:00:00Z",
        },
        generatedAt: "2026-03-10T00:00:00Z",
      },
      projectProfile: {
        version: 1,
        sourceTypeBoosts: { code: 0.25 },
        pathBoosts: { "src/retry.ts": 0.3 },
        symbolBoosts: { retryWorker: 0.18 },
        stats: {
          feedbackCount: 4,
          positiveFeedbackCount: 3,
          negativeFeedbackCount: 1,
          mergeCompletedCount: 1,
          lastFeedbackAt: "2026-03-10T06:00:00Z",
        },
        generatedAt: "2026-03-10T06:00:00Z",
      },
    });

    expect(merged.applied).toBe(true);
    expect(merged.scopes).toEqual(["global", "project"]);
    expect(merged.pathBoosts["src/retry.ts"]).toBeGreaterThan(0.4);
    expect(merged.symbolBoosts.retryWorker).toBeGreaterThan(0);
  });

  it("computes hit-level personalization boost from merged profile", () => {
    const boost = computeRetrievalPersonalizationBoost({
      hit: {
        sourceType: "code",
        path: "./src/retry.ts",
        symbolName: "retryWorker",
      },
      profile: {
        applied: true,
        scopes: ["global", "project"],
        feedbackCount: 7,
        positiveFeedbackCount: 6,
        negativeFeedbackCount: 1,
        sourceTypeBoosts: { code: 0.22 },
        pathBoosts: { "src/retry.ts": 0.33 },
        symbolBoosts: { retryWorker: 0.14 },
      },
    });

    expect(boost.applied).toBe(true);
    expect(boost.totalBoost).toBeCloseTo(0.69, 5);
    expect(boost.matchedPath).toBe("src/retry.ts");
    expect(boost.matchedSourceType).toBe("code");
    expect(boost.matchedSymbol).toBe("retryWorker");
  });
});
