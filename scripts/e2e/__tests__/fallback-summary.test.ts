import { describe, expect, it } from "vitest";
import {
  aggregateFallbackSummaries,
  createFallbackTracker,
  recordFallbackEvent,
  summarizeFallbackTracker,
} from "../fallback-summary.mjs";

describe("fallback summary helpers", () => {
  it("groups fallback events by family and reason", () => {
    const tracker = createFallbackTracker();
    recordFallbackEvent(tracker, {
      reason: "routing_reassign",
      workflowState: "assigned",
      runDiagnostic: {
        runId: "run-1",
        checkpointPhase: "adapter.execute",
      },
    });
    recordFallbackEvent(tracker, { reason: "reviewer_approval", workflowState: "under_review" });
    recordFallbackEvent(tracker, { reason: "close", workflowState: "approved" });

    expect(summarizeFallbackTracker(tracker)).toEqual({
      total: 3,
      familyCounts: {
        pm_routing: 1,
        staffing_and_wake: 0,
        review_handoff: 1,
        qa_gate: 0,
        closure: 1,
      },
      reasonCounts: {
        routing_reassign: 1,
        reviewer_approval: 1,
        close: 1,
      },
      runtimeDegradedCounts: {
        adapter_retry: 0,
        claude_stream_incomplete: 0,
        recovered_supervisory_invoke_stall: 0,
      },
      runtimeDegradedTotal: 0,
      runtimeDegradedRate: 0,
      recoveredSupervisoryInvokeStallCount: 0,
      recoveredSupervisoryInvokeStallRate: 0,
      providerRuntimeDebt: false,
      events: [
        {
          family: "pm_routing",
          reason: "routing_reassign",
          workflowState: "assigned",
          note: null,
          runtimeDegradedReason: null,
          runDiagnostic: {
            runId: "run-1",
            checkpointPhase: "adapter.execute",
          },
        },
        {
          family: "review_handoff",
          reason: "reviewer_approval",
          workflowState: "under_review",
          note: null,
          runtimeDegradedReason: null,
          runDiagnostic: null,
        },
        {
          family: "closure",
          reason: "close",
          workflowState: "approved",
          note: null,
          runtimeDegradedReason: null,
          runDiagnostic: null,
        },
      ],
    });
  });

  it("tracks runtime degraded reasons from run diagnostics", () => {
    const tracker = createFallbackTracker();
    recordFallbackEvent(tracker, {
      reason: "reviewer_approval",
      runDiagnostic: {
        wakeReason: "adapter_retry",
        adapterRetryCount: 2,
      },
    });
    recordFallbackEvent(tracker, {
      reason: "qa_approval",
      runDiagnostic: {
        wakeReason: "adapter_retry",
        adapterRetryCount: 2,
        adapterRetryErrorCode: "claude_stream_incomplete",
      },
    });

    expect(summarizeFallbackTracker(tracker)).toMatchObject({
      runtimeDegradedCounts: {
        adapter_retry: 1,
        claude_stream_incomplete: 1,
        recovered_supervisory_invoke_stall: 0,
      },
      runtimeDegradedTotal: 2,
      runtimeDegradedRate: 1,
      recoveredSupervisoryInvokeStallCount: 0,
      recoveredSupervisoryInvokeStallRate: 0,
      providerRuntimeDebt: false,
    });
  });

  it("prefers explicit runtime degraded state from diagnostics", () => {
    const tracker = createFallbackTracker();
    recordFallbackEvent(tracker, {
      reason: "close",
      runDiagnostic: {
        runtimeDegradedState: "recovered_supervisory_invoke_stall",
        runtimeHealth: "degraded",
      },
    });

    expect(summarizeFallbackTracker(tracker)).toMatchObject({
      runtimeDegradedCounts: {
        adapter_retry: 0,
        claude_stream_incomplete: 0,
        recovered_supervisory_invoke_stall: 1,
      },
      runtimeDegradedTotal: 1,
      runtimeDegradedRate: 1,
      recoveredSupervisoryInvokeStallCount: 1,
      recoveredSupervisoryInvokeStallRate: 1,
      providerRuntimeDebt: true,
    });
  });

  it("aggregates scenario summaries", () => {
    const first = createFallbackTracker();
    recordFallbackEvent(first, { reason: "routing_reassign" });
    const second = createFallbackTracker();
    recordFallbackEvent(second, { reason: "qa_approval" });
    recordFallbackEvent(second, { reason: "implementation_start" });

    expect(aggregateFallbackSummaries([
      { scenario: "s1", identifier: "CLO-1", fallbackSummary: first },
      { scenario: "s2", identifier: "CLO-2", fallbackSummary: second },
    ])).toEqual({
      total: 3,
      familyCounts: {
        pm_routing: 1,
        staffing_and_wake: 1,
        review_handoff: 0,
        qa_gate: 1,
        closure: 0,
      },
      reasonCounts: {
        routing_reassign: 1,
        qa_approval: 1,
        implementation_start: 1,
      },
      runtimeDegradedCounts: {
        adapter_retry: 0,
        claude_stream_incomplete: 0,
        recovered_supervisory_invoke_stall: 0,
      },
      runtimeDegradedTotal: 0,
      runtimeDegradedRate: 0,
      recoveredSupervisoryInvokeStallCount: 0,
      recoveredSupervisoryInvokeStallRate: 0,
      providerRuntimeDebtScenarios: [],
      scenarios: [
        {
          scenario: "s1",
          identifier: "CLO-1",
          total: 1,
          familyCounts: {
            pm_routing: 1,
            staffing_and_wake: 0,
            review_handoff: 0,
            qa_gate: 0,
            closure: 0,
          },
          reasonCounts: {
            routing_reassign: 1,
          },
          runtimeDegradedCounts: {
            adapter_retry: 0,
            claude_stream_incomplete: 0,
            recovered_supervisory_invoke_stall: 0,
          },
          runtimeDegradedTotal: 0,
          runtimeDegradedRate: 0,
          recoveredSupervisoryInvokeStallCount: 0,
          recoveredSupervisoryInvokeStallRate: 0,
          providerRuntimeDebt: false,
        },
        {
          scenario: "s2",
          identifier: "CLO-2",
          total: 2,
          familyCounts: {
            pm_routing: 0,
            staffing_and_wake: 1,
            review_handoff: 0,
            qa_gate: 1,
            closure: 0,
          },
          reasonCounts: {
            qa_approval: 1,
            implementation_start: 1,
          },
          runtimeDegradedCounts: {
            adapter_retry: 0,
            claude_stream_incomplete: 0,
            recovered_supervisory_invoke_stall: 0,
          },
          runtimeDegradedTotal: 0,
          runtimeDegradedRate: 0,
          recoveredSupervisoryInvokeStallCount: 0,
          recoveredSupervisoryInvokeStallRate: 0,
          providerRuntimeDebt: false,
        },
      ],
    });
  });

  it("reports provider runtime debt scenarios when recovered supervisory stalls exist", () => {
    const tracker = createFallbackTracker();
    recordFallbackEvent(tracker, {
      reason: "implementation_start",
      runDiagnostic: {
        runtimeDegradedState: "recovered_supervisory_invoke_stall",
        runtimeHealth: "degraded",
      },
    });

    expect(aggregateFallbackSummaries([
      { scenario: "qa-loop", identifier: "CLO-175", fallbackSummary: tracker },
    ])).toMatchObject({
      total: 1,
      runtimeDegradedTotal: 1,
      runtimeDegradedRate: 1,
      recoveredSupervisoryInvokeStallCount: 1,
      recoveredSupervisoryInvokeStallRate: 1,
      providerRuntimeDebtScenarios: [
        {
          scenario: "qa-loop",
          identifier: "CLO-175",
          recoveredSupervisoryInvokeStallCount: 1,
          recoveredSupervisoryInvokeStallRate: 1,
        },
      ],
    });
  });
});
