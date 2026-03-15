import { describe, expect, it } from "vitest";
import type { RetrievalHitView, RetrievalSignals } from "../services/issue-retrieval.js";
import {
  buildHitRationale,
  computeSummaryMetadataBoost,
  type RetrievalRerankWeights,
} from "../services/retrieval/scoring.js";

function makeWeights(overrides: Partial<RetrievalRerankWeights> = {}): RetrievalRerankWeights {
  return {
    sourceTypeBaseBoost: 1.25,
    sourceTypeDecay: 0.15,
    sourceTypeMinBoost: 0.15,
    exactPathBoost: 2.5,
    exactPathCodeBridgeBoost: 1.4,
    exactPathTestBridgeBoost: 1.15,
    fileNameBoost: 0.9,
    metadataExactPathBoostMultiplier: 0.85,
    metadataFileNameBoostMultiplier: 0.7,
    symbolExactBoost: 1.3,
    symbolPartialBoost: 0.45,
    tagMatchBoostPerTag: 0.4,
    tagMatchMaxBoost: 1.2,
    summaryOwnerTagMatchBoost: 0.75,
    summarySupportTagMatchBoost: 0.35,
    summaryAvoidTagPenalty: -0.9,
    summaryFileContextBoost: 0.16,
    summarySymbolContextBoost: 0.12,
    summaryMaxBoost: 1.9,
    summaryMinBoost: -1.9,
    latestBoost: 0.35,
    issueLinkMinBoost: 0.2,
    issueLinkWeightMultiplier: 0.8,
    projectLinkMinBoost: 0.1,
    projectLinkWeightMultiplier: 0.5,
    pathLinkMinBoost: 0.2,
    pathLinkWeightMultiplier: 1,
    linkBoostCap: 2.5,
    graphMultiHopBoost: 0.55,
    graphExecutableBridgeBoost: 0.4,
    graphCrossProjectBoost: 0.3,
    freshnessWindowDays: 21,
    freshnessMaxBoost: 0.45,
    expiredPenalty: -1.2,
    futurePenalty: -0.4,
    supersededPenalty: -0.8,
    temporalExactCommitBoost: 1.8,
    temporalSameBranchHeadBoost: 0.85,
    temporalDefaultBranchBoost: 0.25,
    temporalForeignBranchPenalty: -0.35,
    temporalStalePenalty: -0.45,
    organizationalIssueMissPenalty: -1.1,
    organizationalProtocolMissPenalty: -0.45,
    organizationalReviewMissPenalty: -1.35,
    relatedIssueDecisionBoost: 0.2,
    relatedIssueFixBoost: 0.32,
    relatedIssueReviewBoost: 0.42,
    relatedIssueCloseBoost: 0.48,
    ...overrides,
  };
}

function makeSignals(overrides: Partial<RetrievalSignals> = {}): RetrievalSignals {
  return {
    exactPaths: [],
    fileNames: [],
    symbolHints: [],
    knowledgeTags: ["swiftcl", "artifact-routing"],
    preferredSourceTypes: ["code_summary", "symbol_summary", "code"],
    projectAffinityIds: [],
    projectAffinityNames: [],
    blockerCode: null,
    questionType: null,
    ...overrides,
  };
}

function makeHit(overrides: Partial<RetrievalHitView> = {}): RetrievalHitView {
  return {
    chunkId: "chunk-1",
    documentId: "doc-1",
    sourceType: "code_summary",
    authorityLevel: "canonical",
    documentIssueId: null,
    documentProjectId: "project-1",
    path: "src/routing/policy.ts",
    title: "policy.ts summary",
    headingPath: "src/routing/policy.ts",
    symbolName: null,
    textContent: "Summary text",
    documentMetadata: {
      summaryKind: "file",
      pmProjectSelection: {
        ownerTags: ["swiftcl", "artifact-routing"],
        supportTags: ["swiftsight-cloud"],
        avoidTags: ["swiftsight-report-server"],
      },
    },
    chunkMetadata: {},
    denseScore: 0.6,
    sparseScore: 0.4,
    rerankScore: 0.8,
    fusedScore: 1.4,
    updatedAt: new Date("2026-03-15T00:00:00.000Z"),
    modelRerankRank: null,
    graphMetadata: null,
    temporalMetadata: null,
    personalizationMetadata: null,
    saturationMetadata: null,
    diversityMetadata: null,
    ...overrides,
  };
}

describe("retrieval scoring", () => {
  it("boosts summary hits using project-selection metadata", () => {
    const boost = computeSummaryMetadataBoost(
      makeHit(),
      makeSignals(),
      makeWeights(),
    );

    expect(boost).toBeGreaterThan(1);
  });

  it("penalizes summary hits that match avoid tags", () => {
    const boost = computeSummaryMetadataBoost(
      makeHit({
        documentMetadata: {
          summaryKind: "file",
          pmProjectSelection: {
            ownerTags: [],
            supportTags: [],
            avoidTags: ["artifact-routing"],
          },
        },
      }),
      makeSignals({ knowledgeTags: ["artifact-routing"] }),
      makeWeights({ summaryFileContextBoost: 0 }),
    );

    expect(boost).toBeLessThan(0);
  });

  it("adds summary-specific rationale when metadata matches", () => {
    const rationale = buildHitRationale({
      hit: makeHit(),
      issueId: "issue-1",
      projectId: "project-1",
      signals: makeSignals(),
      weights: makeWeights(),
    });

    expect(rationale).toContain("summary_metadata_match");
  });
});
