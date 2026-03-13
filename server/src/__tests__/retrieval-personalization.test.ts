import { describe, expect, it } from "vitest";
import {
  aggregateRetrievalFeedbackProfile,
  buildDirectTargetFeedbackEvents,
  buildFeedbackEvents,
  computeRetrievalPersonalizationBoost,
  describeManualFeedback,
  describeMergeOutcomeFeedback,
  describeProtocolFeedback,
  fallbackBriefScopes,
  mergeRetrievalPersonalizationProfiles,
  isPersonalizablePathTarget,
  mergeBoostMaps,
  normalizeBoost,
  normalizePath,
  parseRoleProfileJson,
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

  it("normalizes paths, filters documentation targets, and clamps boost magnitudes", () => {
    expect(normalizePath("./src/retry.ts")).toBe("src/retry.ts");
    expect(isPersonalizablePathTarget("docs/adr/retries.md")).toBe(false);
    expect(isPersonalizablePathTarget("src/runtime/retry.ts")).toBe(true);
    expect(normalizeBoost({ targetType: "source_type", rawWeight: 100 })).toBe(0.65);
    expect(normalizeBoost({ targetType: "path", rawWeight: -100 })).toBe(-0.55);
  });

  it("parses persisted profiles and merges global/project boosts with project preference", () => {
    const parsed = parseRoleProfileJson({
      sourceTypeBoosts: { code: 0.2, test_report: "bad" },
      pathBoosts: { "src/retry.ts": 0.3 },
      symbolBoosts: { retryWorker: 0.15 },
      stats: {
        feedbackCount: 4,
        positiveFeedbackCount: 3,
        negativeFeedbackCount: 1,
        lastFeedbackAt: "2026-03-10T00:00:00.000Z",
      },
      generatedAt: "2026-03-10T00:00:00.000Z",
    });

    expect(parsed).toMatchObject({
      sourceTypeBoosts: { code: 0.2 },
      pathBoosts: { "src/retry.ts": 0.3 },
      symbolBoosts: { retryWorker: 0.15 },
      stats: expect.objectContaining({
        feedbackCount: 4,
        positiveFeedbackCount: 3,
        negativeFeedbackCount: 1,
      }),
    });

    expect(mergeBoostMaps({
      global: { code: 0.2, test_report: -0.1 },
      project: { code: 0.25 },
      targetType: "source_type",
    })).toEqual({
      code: 0.4875,
      test_report: -0.1,
    });
  });

  it("classifies protocol, manual, and merge-outcome feedback descriptors", () => {
    expect(describeProtocolFeedback({
      messageType: "REQUEST_CHANGES",
      payload: {},
    } as any)).toEqual({
      feedbackType: "request_changes",
      baseWeight: -1,
    });
    expect(describeProtocolFeedback({
      messageType: "CLOSE_TASK",
      payload: { mergeStatus: "merged" },
    } as any)).toEqual({
      feedbackType: "merge_completed",
      baseWeight: 1.2,
    });
    expect(describeProtocolFeedback({
      messageType: "CLOSE_TASK",
      payload: { mergeStatus: "local_only" },
    } as any)).toEqual({
      feedbackType: "approved",
      baseWeight: 0.75,
    });
    expect(describeProtocolFeedback({
      messageType: "REPORT_PROGRESS",
      payload: {},
    } as any)).toBeNull();
    expect(describeManualFeedback("operator_pin")).toEqual({
      feedbackType: "operator_pin",
      baseWeight: 1.05,
    });
    expect(describeManualFeedback("operator_hide")).toEqual({
      feedbackType: "operator_hide",
      baseWeight: -0.9,
    });
    expect(describeMergeOutcomeFeedback("merge_rejected")).toEqual({
      feedbackType: "merge_rejected",
      baseWeight: -1.05,
    });
  });

  it("derives fallback brief scopes for reviewer, closure, and human board flows", () => {
    expect(fallbackBriefScopes({
      senderRole: "reviewer",
      messageType: "REQUEST_CHANGES",
    })).toEqual(["reviewer"]);
    expect(fallbackBriefScopes({
      senderRole: "human_board",
      messageType: "CLOSE_TASK",
    })).toEqual(["closure", "global", "qa", "reviewer", "tech_lead", "pm", "cto"]);
    expect(fallbackBriefScopes({
      senderRole: "unknown_role",
      messageType: "START_REVIEW",
    })).toEqual(["reviewer"]);
  });

  it("builds ranked feedback events from retrieval hits", () => {
    const events = buildFeedbackEvents({
      companyId: "company-1",
      projectId: "project-1",
      issueId: "issue-1",
      retrievalRunId: "run-1",
      feedbackMessageId: "message-1",
      actorRole: "reviewer",
      eventType: "review",
      feedbackType: "approved",
      baseWeight: 1,
      hits: [
        {
          chunkId: "chunk-1",
          finalRank: 1,
          sourceType: "code",
          documentPath: "./src/runtime/retry.ts",
          symbolName: "retryWorker",
          rationale: "best match",
          fusedScore: 0.91,
        },
        {
          chunkId: "chunk-2",
          finalRank: 6,
          sourceType: "issue",
          documentPath: "issues/CLO-1/issue.md",
          symbolName: null,
          rationale: null,
          fusedScore: 0.44,
        },
      ],
    });

    expect(events.filter((event) => event.targetType === "chunk")).toHaveLength(2);
    expect(events.filter((event) => event.targetType === "source_type")).toHaveLength(2);
    expect(events.filter((event) => event.targetType === "path")).toEqual([
      expect.objectContaining({
        targetId: "src/runtime/retry.ts",
        targetType: "path",
      }),
    ]);
    expect(events.filter((event) => event.targetType === "symbol")).toEqual([
      expect.objectContaining({
        targetId: "retryWorker",
        targetType: "symbol",
      }),
    ]);
    expect(events[0]?.metadata).toEqual(expect.objectContaining({
      finalRank: 1,
      fusedScore: 0.91,
    }));
  });

  it("builds direct target feedback events and promotes code source-type once for path targets", () => {
    const events = buildDirectTargetFeedbackEvents({
      companyId: "company-1",
      projectId: null,
      issueId: "issue-1",
      retrievalRunId: "run-1",
      feedbackMessageId: null,
      actorRole: "qa",
      eventType: "review",
      feedbackType: "operator_pin",
      baseWeight: 0.8,
      targetType: "path",
      targetIds: ["src/runtime.ts", "docs/adr.md", "  ", "src/worker.ts"],
      metadata: { origin: "operator" },
    });

    expect(events.filter((event) => event.targetType === "path")).toHaveLength(3);
    expect(events.filter((event) => event.targetType === "source_type")).toEqual([
      expect.objectContaining({
        targetType: "source_type",
        targetId: "code",
        weight: 0.576,
        metadata: expect.objectContaining({
          origin: "operator",
          promotedByPathFeedback: true,
        }),
      }),
    ]);
  });
});
