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
        { targetType: "path", targetId: "src/legacy.ts", weight: -0.7, feedbackType: "merge_rejected" },
        { targetType: "path", targetId: "src/important.ts", weight: 1, feedbackType: "operator_pin" },
        { targetType: "path", targetId: "docs/noisy.md", weight: -0.6, feedbackType: "operator_hide" },
      ],
    });

    expect(profile.stats.feedbackCount).toBe(8);
    expect(profile.stats.positiveFeedbackCount).toBe(5);
    expect(profile.stats.negativeFeedbackCount).toBe(3);
    expect(profile.stats.mergeRejectedCount).toBe(1);
    expect(profile.stats.operatorPinCount).toBe(1);
    expect(profile.stats.operatorHideCount).toBe(1);
    expect(profile.pathBoosts["src/retry.ts"]).toBeGreaterThan(0);
    expect(profile.pathBoosts["src/important.ts"]).toBeGreaterThan(0);
    expect(profile.pathBoosts["docs/adr/retries.md"]).toBeUndefined();
    expect(profile.pathBoosts["docs/noisy.md"]).toBeUndefined();
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
          mergeRejectedCount: 0,
          operatorPinCount: 0,
          operatorHideCount: 0,
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
          mergeRejectedCount: 0,
          operatorPinCount: 0,
          operatorHideCount: 0,
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

  it("does not apply path personalization to organizational memory hits", () => {
    const boost = computeRetrievalPersonalizationBoost({
      hit: {
        sourceType: "issue",
        path: "issues/CLO-65/issue.md",
        symbolName: null,
      },
      profile: {
        applied: true,
        scopes: ["project"],
        feedbackCount: 4,
        positiveFeedbackCount: 4,
        negativeFeedbackCount: 0,
        sourceTypeBoosts: { issue: 0.14 },
        pathBoosts: { "issues/CLO-65/issue.md": 0.55 },
        symbolBoosts: {},
      },
    });

    expect(boost.applied).toBe(true);
    expect(boost.sourceTypeBoost).toBe(0.14);
    expect(boost.pathBoost).toBe(0);
    expect(boost.matchedPath).toBeNull();
  });
});
