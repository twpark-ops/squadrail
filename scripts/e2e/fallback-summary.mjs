const FALLBACK_REASON_TO_FAMILY = {
  routing_reassign: "pm_routing",
  staffing_reassign: "staffing_and_wake",
  engineer_wake: "staffing_and_wake",
  implementation_start: "staffing_and_wake",
  review_submission: "review_handoff",
  reviewer_approval: "review_handoff",
  qa_approval: "qa_gate",
  close: "closure",
  human_decision: "closure",
  implementation_recovery: "staffing_and_wake",
};

function createEmptyRuntimeDegradedCounts() {
  return {
    adapter_retry: 0,
    claude_stream_incomplete: 0,
    recovered_supervisory_invoke_stall: 0,
  };
}

function createEmptyFamilyCounts() {
  return {
    pm_routing: 0,
    staffing_and_wake: 0,
    review_handoff: 0,
    qa_gate: 0,
    closure: 0,
  };
}

export function createFallbackTracker() {
  return { events: [] };
}

function inferRuntimeDegradedReason(runDiagnostic) {
  if (!runDiagnostic || typeof runDiagnostic !== "object") return null;
  const runtimeDegradedState =
    typeof runDiagnostic.runtimeDegradedState === "string" ? runDiagnostic.runtimeDegradedState : null;
  if (runtimeDegradedState === "recovered_supervisory_invoke_stall") {
    return "recovered_supervisory_invoke_stall";
  }
  if (runtimeDegradedState === "claude_stream_incomplete_retry_loop") {
    return "claude_stream_incomplete";
  }
  if (runtimeDegradedState === "adapter_retry_loop") {
    return "adapter_retry";
  }
  const adapterRetryErrorCode =
    typeof runDiagnostic.adapterRetryErrorCode === "string" ? runDiagnostic.adapterRetryErrorCode : null;
  if (adapterRetryErrorCode === "claude_stream_incomplete") {
    return "claude_stream_incomplete";
  }
  const wakeReason = typeof runDiagnostic.wakeReason === "string" ? runDiagnostic.wakeReason : null;
  if (wakeReason === "adapter_retry") {
    return "adapter_retry";
  }
  return null;
}

export function recordFallbackEvent(tracker, input) {
  if (!tracker || !Array.isArray(tracker.events)) {
    throw new Error("fallback tracker is not initialized");
  }
  const reason = typeof input?.reason === "string" ? input.reason : null;
  const family = reason ? (FALLBACK_REASON_TO_FAMILY[reason] ?? "unknown") : "unknown";
  const runDiagnostic =
    input?.runDiagnostic && typeof input.runDiagnostic === "object"
      ? input.runDiagnostic
      : null;
  tracker.events.push({
    family,
    reason,
    workflowState: typeof input?.workflowState === "string" ? input.workflowState : null,
    note: typeof input?.note === "string" ? input.note : null,
    runtimeDegradedReason: inferRuntimeDegradedReason(runDiagnostic),
    runDiagnostic,
  });
}

export function summarizeFallbackTracker(tracker) {
  const events = Array.isArray(tracker?.events) ? tracker.events : [];
  const familyCounts = createEmptyFamilyCounts();
  const reasonCounts = {};
  const runtimeDegradedCounts = createEmptyRuntimeDegradedCounts();

  for (const event of events) {
    if (event?.family && Object.hasOwn(familyCounts, event.family)) {
      familyCounts[event.family] += 1;
    }
    if (typeof event?.reason === "string" && event.reason.length > 0) {
      reasonCounts[event.reason] = (reasonCounts[event.reason] ?? 0) + 1;
    }
    if (typeof event?.runtimeDegradedReason === "string" && Object.hasOwn(runtimeDegradedCounts, event.runtimeDegradedReason)) {
      runtimeDegradedCounts[event.runtimeDegradedReason] += 1;
    }
  }

  return {
    total: events.length,
    familyCounts,
    reasonCounts,
    runtimeDegradedCounts,
    events,
  };
}

export function aggregateFallbackSummaries(results) {
  const familyCounts = createEmptyFamilyCounts();
  const reasonCounts = {};
  const runtimeDegradedCounts = createEmptyRuntimeDegradedCounts();
  const scenarios = [];

  for (const result of Array.isArray(results) ? results : []) {
    const summary = summarizeFallbackTracker(result?.fallbackSummary);
    scenarios.push({
      scenario: result?.scenario ?? null,
      identifier: result?.identifier ?? null,
      total: summary.total,
      familyCounts: summary.familyCounts,
      reasonCounts: summary.reasonCounts,
      runtimeDegradedCounts: summary.runtimeDegradedCounts,
    });
    for (const [family, count] of Object.entries(summary.familyCounts)) {
      familyCounts[family] += count;
    }
    for (const [reason, count] of Object.entries(summary.reasonCounts)) {
      reasonCounts[reason] = (reasonCounts[reason] ?? 0) + count;
    }
    for (const [reason, count] of Object.entries(summary.runtimeDegradedCounts)) {
      runtimeDegradedCounts[reason] += count;
    }
  }

  return {
    total: scenarios.reduce((sum, entry) => sum + entry.total, 0),
    familyCounts,
    reasonCounts,
    runtimeDegradedCounts,
    scenarios,
  };
}
