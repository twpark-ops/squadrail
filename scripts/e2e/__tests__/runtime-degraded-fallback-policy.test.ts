import { describe, expect, it } from "vitest";
import { resolveRuntimeDegradedFallbackPolicy } from "../runtime-degraded-fallback-policy.mjs";

describe("resolveRuntimeDegradedFallbackPolicy", () => {
  it("returns null when the active run is not degraded", () => {
    expect(
      resolveRuntimeDegradedFallbackPolicy({
        runDiagnostic: {
          runtimeHealth: "normal",
        },
        closeFallbackReady: true,
      }),
    ).toBeNull();
  });

  it("prefers the latest-stage fallback when runtime is degraded", () => {
    expect(
      resolveRuntimeDegradedFallbackPolicy({
        runDiagnostic: {
          runtimeHealth: "degraded",
          runtimeDegradedState: "recovered_supervisory_invoke_stall",
        },
        reviewSubmissionFallbackReady: true,
        reviewerApprovalFallbackReady: true,
        qaApprovalFallbackReady: true,
      }),
    ).toEqual({
      reason: "qa_approval",
      runtimeDegradedState: "recovered_supervisory_invoke_stall",
      note: "runtime degraded state recovered_supervisory_invoke_stall short-circuited deterministic qa_approval fallback",
    });
  });

  it("maps reviewer-stage degraded runs to reviewer approval fallback", () => {
    expect(
      resolveRuntimeDegradedFallbackPolicy({
        runDiagnostic: {
          runtimeHealth: "degraded",
          runtimeDegradedState: "claude_stream_incomplete_retry_loop",
        },
        reviewerApprovalFallbackReady: true,
      }),
    ).toEqual({
      reason: "reviewer_approval",
      runtimeDegradedState: "claude_stream_incomplete_retry_loop",
      note: "runtime degraded state claude_stream_incomplete_retry_loop short-circuited deterministic reviewer_approval fallback",
    });
  });

  it("does not short-circuit when the degraded run already recorded helper progress", () => {
    expect(
      resolveRuntimeDegradedFallbackPolicy({
        runDiagnostic: {
          runtimeHealth: "degraded",
          runtimeDegradedState: "supervisory_invoke_stall",
          protocolProgress: {
            actorAttemptedAfterRunStart: true,
          },
          helperTrace: {
            helperTransportObserved: true,
          },
        },
        reviewerApprovalFallbackReady: true,
      }),
    ).toBeNull();
  });

  it("maps assigned-state degraded runs to engineer wake before staffing reroute", () => {
    expect(
      resolveRuntimeDegradedFallbackPolicy({
        runDiagnostic: {
          runtimeHealth: "degraded",
          runtimeDegradedState: "recovered_supervisory_invoke_stall",
        },
        routingFallbackReady: true,
        staffingFallbackReady: true,
        engineerWakeFallbackReady: true,
      }),
    ).toEqual({
      reason: "engineer_wake",
      runtimeDegradedState: "recovered_supervisory_invoke_stall",
      note: "runtime degraded state recovered_supervisory_invoke_stall short-circuited deterministic engineer_wake fallback",
    });
  });
});
