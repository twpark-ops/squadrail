import { describe, expect, it } from "vitest";
import {
  buildMergeCandidateGateStatus,
  buildMergeCandidatePrBridge,
  mergeCandidateRequiresGateEnforcement,
} from "../services/merge-candidate-gates.js";

describe("merge candidate gates", () => {
  it("normalizes persisted PR bridge metadata and computes required check summary", () => {
    const prBridge = buildMergeCandidatePrBridge({
      automationMetadata: {
        prBridge: {
          provider: "github",
          repoOwner: "acme",
          repoName: "swiftsight",
          repoUrl: "https://github.com/acme/swiftsight",
          remoteUrl: "https://github.com/acme/swiftsight.git",
          number: 42,
          externalId: "4200",
          url: "https://github.com/acme/swiftsight/pull/42",
          title: "CLO-42: PR bridge",
          state: "draft",
          mergeability: "blocked",
          headBranch: "squadrail/clo-42",
          baseBranch: "main",
          headSha: "abc123",
          reviewDecision: "changes_requested",
          commentCount: 3,
          reviewCommentCount: 2,
          lastSyncedAt: "2026-03-12T03:00:00.000Z",
          checks: [
            {
              name: "pr-verify",
              status: "success",
              required: true,
            },
            {
              name: "integration",
              status: "pending",
              required: true,
            },
          ],
        },
      },
    });

    expect(prBridge).toEqual(
      expect.objectContaining({
        provider: "github",
        number: 42,
        reviewDecision: "changes_requested",
      }),
    );
    expect(prBridge?.checkSummary).toEqual(
      expect.objectContaining({
        total: 2,
        requiredTotal: 2,
        requiredPassing: 1,
        requiredPending: 1,
      }),
    );
  });

  it("marks merge as blocked when required checks or review decisions are unresolved", () => {
    const prBridge = buildMergeCandidatePrBridge({
      automationMetadata: {
        prBridge: {
          provider: "github",
          repoOwner: "acme",
          repoName: "swiftsight",
          repoUrl: "https://github.com/acme/swiftsight",
          remoteUrl: "https://github.com/acme/swiftsight.git",
          number: 42,
          externalId: "4200",
          url: "https://github.com/acme/swiftsight/pull/42",
          title: "CLO-42: PR bridge",
          state: "open",
          mergeability: "blocked",
          headBranch: "squadrail/clo-42",
          baseBranch: "main",
          headSha: "abc123",
          reviewDecision: "changes_requested",
          lastSyncedAt: "2026-03-12T03:00:00.000Z",
          checks: [
            {
              name: "pr-verify",
              status: "pending",
              required: true,
            },
          ],
        },
      },
    });

    const gateStatus = buildMergeCandidateGateStatus({ prBridge });

    expect(gateStatus).toEqual(
      expect.objectContaining({
        mergeReady: false,
        ciReady: false,
        requiredChecksConfigured: true,
      }),
    );
    expect(gateStatus?.blockingReasons).toEqual(
      expect.arrayContaining([
        "Required checks still pending (1).",
        "PR mergeability is blocked by repository policy.",
        "PR still has requested changes.",
      ]),
    );
    expect(mergeCandidateRequiresGateEnforcement({ prBridge, gateStatus })).toBe(true);
  });
});
