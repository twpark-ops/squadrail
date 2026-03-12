import { describe, expect, it } from "vitest";
import { buildIssueFailureLearningGateStatus } from "../services/failure-learning.js";

describe("failure learning gate", () => {
  it("keeps close ready when a later successful run cleared earlier failures", () => {
    const gate = buildIssueFailureLearningGateStatus({
      runs: [
        {
          status: "failed",
          errorCode: "dispatch_timeout",
          updatedAt: "2026-03-12T01:00:00.000Z",
          finishedAt: "2026-03-12T01:00:00.000Z",
        },
        {
          status: "succeeded",
          errorCode: null,
          updatedAt: "2026-03-12T02:00:00.000Z",
          finishedAt: "2026-03-12T02:00:00.000Z",
        },
      ],
    });

    expect(gate).toEqual(
      expect.objectContaining({
        closeReady: true,
        retryability: "clean",
      }),
    );
  });

  it("blocks close when dispatch timeout repeats after the last successful run", () => {
    const gate = buildIssueFailureLearningGateStatus({
      runs: [
        {
          status: "failed",
          errorCode: "dispatch_timeout",
          updatedAt: "2026-03-12T03:00:00.000Z",
          finishedAt: "2026-03-12T03:00:00.000Z",
        },
        {
          status: "timed_out",
          errorCode: "dispatch_timeout",
          updatedAt: "2026-03-12T04:00:00.000Z",
          finishedAt: "2026-03-12T04:00:00.000Z",
        },
      ],
    });

    expect(gate).toEqual(
      expect.objectContaining({
        closeReady: false,
        retryability: "operator_required",
        failureFamily: "dispatch",
        repeatedFailureCount24h: 2,
      }),
    );
  });

  it("marks workspace-required as a blocked close signal immediately", () => {
    const gate = buildIssueFailureLearningGateStatus({
      runs: [
        {
          status: "failed",
          errorCode: "workspace_required",
          updatedAt: "2026-03-12T04:30:00.000Z",
          finishedAt: "2026-03-12T04:30:00.000Z",
        },
      ],
    });

    expect(gate).toEqual(
      expect.objectContaining({
        closeReady: false,
        retryability: "blocked",
        failureFamily: "workspace",
      }),
    );
  });
});
