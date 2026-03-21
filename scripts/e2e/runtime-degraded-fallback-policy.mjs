function isRuntimeDegraded(runDiagnostic) {
  if (!runDiagnostic || typeof runDiagnostic !== "object") return false;
  if (runDiagnostic.runtimeHealth === "degraded") return true;
  return typeof runDiagnostic.runtimeDegradedState === "string" && runDiagnostic.runtimeDegradedState.length > 0;
}

function buildShortCircuitNote(reason, runtimeDegradedState) {
  const stateLabel =
    typeof runtimeDegradedState === "string" && runtimeDegradedState.length > 0
      ? runtimeDegradedState
      : "runtime_degraded";
  return `runtime degraded state ${stateLabel} short-circuited deterministic ${reason} fallback`;
}

function hasRecordedProtocolProgress(runDiagnostic) {
  if (!runDiagnostic || typeof runDiagnostic !== "object") return false;
  const protocolProgress =
    typeof runDiagnostic.protocolProgress === "object" && runDiagnostic.protocolProgress !== null
      ? runDiagnostic.protocolProgress
      : null;
  const helperTrace =
    typeof runDiagnostic.helperTrace === "object" && runDiagnostic.helperTrace !== null
      ? runDiagnostic.helperTrace
      : null;
  return protocolProgress?.actorAttemptedAfterRunStart === true || helperTrace?.helperTransportObserved === true;
}

export function resolveRuntimeDegradedFallbackPolicy(input) {
  if (!isRuntimeDegraded(input?.runDiagnostic)) return null;
  if (hasRecordedProtocolProgress(input?.runDiagnostic)) return null;

  const runtimeDegradedState =
    typeof input.runDiagnostic.runtimeDegradedState === "string"
      ? input.runDiagnostic.runtimeDegradedState
      : null;

  const priorityOrder = [
    ["closeFallbackReady", "close"],
    ["qaApprovalFallbackReady", "qa_approval"],
    ["reviewerApprovalFallbackReady", "reviewer_approval"],
    ["reviewSubmissionFallbackReady", "review_submission"],
    ["implementationStartFallbackReady", "implementation_start"],
    ["engineerWakeFallbackReady", "engineer_wake"],
    ["staffingFallbackReady", "staffing_reassign"],
    ["routingFallbackReady", "routing_reassign"],
  ];

  for (const [flagKey, reason] of priorityOrder) {
    if (input?.[flagKey]) {
      return {
        reason,
        runtimeDegradedState,
        note: buildShortCircuitNote(reason, runtimeDegradedState),
      };
    }
  }

  return null;
}
