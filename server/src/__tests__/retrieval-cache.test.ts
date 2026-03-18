import { describe, expect, it } from "vitest";
import {
  buildRetrievalCacheInspectionResult,
  buildRetrievalCacheIdentity,
  buildPersonalizationFingerprint,
  buildRetrievalStageCacheKey,
  normalizeRetrievalQueryText,
} from "../services/retrieval-cache.js";

const baseInput = {
  stage: "candidate_hits" as const,
  companyId: "company-1",
  issueProjectId: "project-1",
  role: "reviewer",
  eventType: "on_review",
  workflowState: "submitted_for_review",
  allowedSourceTypes: ["code", "review"],
  allowedAuthorityLevels: ["project"],
  rerankConfig: { provider: "openai", denseEnabled: true },
  dynamicSignals: {
    exactPaths: ["internal/storage/path.go", "internal/storage/path_test.go"],
    fileNames: ["path.go", "path_test.go"],
    symbolHints: ["SafeJoin", "TestSafeJoin"],
    knowledgeTags: [],
    preferredSourceTypes: ["code", "review"],
    projectAffinityIds: ["project-1"],
    relatedIssueIds: [],
    blockerCode: null,
    questionType: null,
  },
  baselineSignals: {
    exactPaths: ["internal/storage/path.go", "internal/storage/path_test.go"],
    fileNames: ["path.go", "path_test.go"],
    symbolHints: ["SafeJoin", "TestSafeJoin"],
    knowledgeTags: [],
    preferredSourceTypes: ["code", "review"],
    projectAffinityIds: ["project-1"],
    relatedIssueIds: [],
    blockerCode: null,
    questionType: null,
  },
  temporalContext: null,
  revisionSignature: "rev-1",
  personalizationFingerprint: "profile-1",
};

describe("retrieval cache normalization", () => {
  it("normalizes issue refs and uuids in query text", () => {
    expect(
      normalizeRetrievalQueryText("CLO-110 replay 508e3f11-8749-40b8-ac08-b136ec738621"),
    ).toBe("<issue> replay <uuid>");
  });

  it("reuses cache keys across issue-local replay variants", () => {
    const firstKey = buildRetrievalStageCacheKey({
      ...baseInput,
      queryText: "CLO-110 SafeJoin replay 508e3f11-8749-40b8-ac08-b136ec738621",
    });
    const secondKey = buildRetrievalStageCacheKey({
      ...baseInput,
      queryText: "CLO-111 SafeJoin replay e1476537-057e-4d58-bd9b-89333809aa78",
    });

    expect(firstKey).toBe(secondKey);
  });

  it("reuses cache identity fingerprints across issue-local replay variants", () => {
    const firstIdentity = buildRetrievalCacheIdentity({
      ...baseInput,
      queryText: "CLO-110 SafeJoin replay 508e3f11-8749-40b8-ac08-b136ec738621",
    });
    const secondIdentity = buildRetrievalCacheIdentity({
      ...baseInput,
      queryText: "CLO-111 SafeJoin replay e1476537-057e-4d58-bd9b-89333809aa78",
    });

    expect(firstIdentity).toEqual(secondIdentity);
  });

  it("reuses cache identity fingerprints across prose variants with the same structural signals", () => {
    const firstIdentity = buildRetrievalCacheIdentity({
      ...baseInput,
      queryText: "Review SafeJoin path normalization before approval.",
    });
    const secondIdentity = buildRetrievalCacheIdentity({
      ...baseInput,
      queryText: "Validate whether SafeJoin still normalizes the same path set.",
    });

    expect(firstIdentity).toEqual(secondIdentity);
  });

  it("reuses cache identity fingerprints when only symbol hints drift", () => {
    const firstIdentity = buildRetrievalCacheIdentity({
      ...baseInput,
      queryText: "Review SafeJoin nested path preservation.",
    });
    const secondIdentity = buildRetrievalCacheIdentity({
      ...baseInput,
      queryText: "Review SafeJoin nested path preservation.",
      baselineSignals: {
        ...baseInput.baselineSignals,
        symbolHints: ["SafeJoin", "TestSafeJoin", "SafeJoinRegression", "PathTraversal"],
        knowledgeTags: ["regression", "path-preservation"],
      },
    });

    expect(firstIdentity).toEqual(secondIdentity);
  });

  it("reuses cache identity fingerprints across ephemeral worktree branch names", () => {
    const firstIdentity = buildRetrievalCacheIdentity({
      ...baseInput,
      queryText: "Review SafeJoin nested path preservation.",
      temporalContext: {
        source: "artifact",
        headSha: "0f622bd257d8c15d396c09088f3ae47b98916419",
        branchName: "squadrail/project/agent/issue-a",
        defaultBranchName: "squadrail/project/agent/issue-a",
      },
    });
    const secondIdentity = buildRetrievalCacheIdentity({
      ...baseInput,
      queryText: "Review SafeJoin nested path preservation.",
      temporalContext: {
        source: "artifact",
        headSha: "0f622bd257d8c15d396c09088f3ae47b98916419",
        branchName: "squadrail/project/agent/issue-b",
        defaultBranchName: "squadrail/project/agent/issue-b",
      },
    });

    expect(firstIdentity).toEqual(secondIdentity);
  });

  it("tolerates legacy signal payloads without lexical terms", () => {
    const stageKey = buildRetrievalStageCacheKey({
      ...baseInput,
      queryText: "Review SafeJoin nested path preservation.",
      dynamicSignals: {
        ...baseInput.dynamicSignals,
        lexicalTerms: undefined as unknown as string[],
      },
    });
    const identity = buildRetrievalCacheIdentity({
      ...baseInput,
      queryText: "Review SafeJoin nested path preservation.",
      baselineSignals: {
        ...baseInput.baselineSignals,
        lexicalTerms: undefined as unknown as string[],
      },
    });

    expect(stageKey).toHaveLength(64);
    expect(identity).toMatchObject({
      queryFingerprint: expect.any(String),
      policyFingerprint: expect.any(String),
      feedbackFingerprint: "profile-1",
      revisionSignature: "rev-1",
    });
  });

  it("changes cache identity and stage keys when related issue reuse scope changes", () => {
    const firstStageKey = buildRetrievalStageCacheKey({
      ...baseInput,
      queryText: "Review SafeJoin nested path preservation.",
      dynamicSignals: {
        ...baseInput.dynamicSignals,
        relatedIssueIds: ["issue-a"],
      },
    });
    const secondStageKey = buildRetrievalStageCacheKey({
      ...baseInput,
      queryText: "Review SafeJoin nested path preservation.",
      dynamicSignals: {
        ...baseInput.dynamicSignals,
        relatedIssueIds: ["issue-b"],
      },
    });
    const firstIdentity = buildRetrievalCacheIdentity({
      ...baseInput,
      queryText: "Review SafeJoin nested path preservation.",
      baselineSignals: {
        ...baseInput.baselineSignals,
        relatedIssueIds: ["issue-a"],
      },
    });
    const secondIdentity = buildRetrievalCacheIdentity({
      ...baseInput,
      queryText: "Review SafeJoin nested path preservation.",
      baselineSignals: {
        ...baseInput.baselineSignals,
        relatedIssueIds: ["issue-b"],
      },
    });

    expect(firstStageKey).not.toBe(secondStageKey);
    expect(firstIdentity).not.toEqual(secondIdentity);
  });

  it("reuses personalization fingerprints when only feedback counters drift", () => {
    const firstFingerprint = buildPersonalizationFingerprint({
      applied: true,
      scopes: ["global", "project"],
      feedbackCount: 8,
      positiveFeedbackCount: 8,
      negativeFeedbackCount: 0,
      sourceTypeBoosts: { code: 0.41234, review: 0.1091 },
      pathBoosts: { "internal/storage/path.go": 0.6312 },
      symbolBoosts: { SafeJoin: 0.2877 },
    });
    const secondFingerprint = buildPersonalizationFingerprint({
      applied: true,
      scopes: ["project", "global"],
      feedbackCount: 12,
      positiveFeedbackCount: 12,
      negativeFeedbackCount: 0,
      sourceTypeBoosts: { code: 0.41491, review: 0.1119 },
      pathBoosts: { "internal/storage/path.go": 0.6344 },
      symbolBoosts: { SafeJoin: 0.2892 },
    });

    expect(firstFingerprint).toBe(secondFingerprint);
  });

  it("reports exact-hit cache fingerprints and provenance", () => {
    expect(buildRetrievalCacheInspectionResult({
      state: "hit",
      cacheKey: "requested-key-1234567890",
      requestedCacheKey: "requested-key-1234567890",
      matchedCacheKey: "requested-key-1234567890",
      provenance: "exact_key",
    })).toEqual({
      state: "hit",
      reason: "hit",
      provenance: "exact_key",
      matchedRevision: null,
      latestKnownRevision: null,
      lastEntryUpdatedAt: null,
      cacheKeyFingerprint: "requested-ke",
      requestedCacheKeyFingerprint: "requested-ke",
      matchedCacheKeyFingerprint: "requested-ke",
    });
  });

  it("keeps requested and matched fingerprints separate for compatible hits", () => {
    expect(buildRetrievalCacheInspectionResult({
      state: "hit",
      cacheKey: "requested-key-1234567890",
      requestedCacheKey: "requested-key-1234567890",
      matchedCacheKey: "matched-key-abcdef12345",
      provenance: "feedback_drift",
      matchedRevision: 7,
      latestKnownRevision: 7,
      lastEntryUpdatedAt: "2026-03-12T01:23:45.000Z",
    })).toEqual({
      state: "hit",
      reason: "hit",
      provenance: "feedback_drift",
      matchedRevision: 7,
      latestKnownRevision: 7,
      lastEntryUpdatedAt: "2026-03-12T01:23:45.000Z",
      cacheKeyFingerprint: "matched-key-",
      requestedCacheKeyFingerprint: "requested-ke",
      matchedCacheKeyFingerprint: "matched-key-",
    });
  });
});
