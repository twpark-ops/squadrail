function hasNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function clarifiedChildren(childResults) {
  return (childResults ?? []).filter((child) =>
    hasNonEmptyString(child?.askMessageId)
    || hasNonEmptyString(child?.answerMessageId)
    || (child?.clarificationMode ?? "none") !== "none",
  );
}

export function evaluateClarificationLoopInvariant(input) {
  const expectedClarificationMode = input.expectedClarificationMode ?? "human_board";
  const childResults = Array.isArray(input.childResults) ? input.childResults : [];
  const requiresRetrievalAfterResume = input.requiresRetrievalAfterResume === true;
  const expectedClarification = expectedClarificationMode !== "none";
  const clarified = clarifiedChildren(childResults);
  const matchingChildren = clarified.filter((child) => child?.clarificationMode === expectedClarificationMode);

  const checks = {
    clarificationModeMatched: expectedClarification
      ? matchingChildren.length > 0
      : clarified.length === 0 && childResults.every((child) => (child?.clarificationMode ?? "none") === "none"),
    clarificationRecorded: expectedClarification
      ? matchingChildren.every((child) => hasNonEmptyString(child?.askMessageId))
      : clarified.every((child) => !hasNonEmptyString(child?.askMessageId)),
    answerRecorded: expectedClarification
      ? matchingChildren.every((child) => hasNonEmptyString(child?.answerMessageId))
      : clarified.every((child) => !hasNonEmptyString(child?.answerMessageId)),
    answerLinked: expectedClarification
      ? matchingChildren.every((child) =>
        hasNonEmptyString(child?.askMessageId)
        && hasNonEmptyString(child?.answerMessageId)
        && child?.answerCausalMessageId === child?.askMessageId
        && Number.isFinite(child?.askMessageSeq)
        && Number.isFinite(child?.answerMessageSeq)
        && Number(child.answerMessageSeq) > Number(child.askMessageSeq))
      : true,
    closeBlockedWhilePending: expectedClarification
      ? matchingChildren.every((child) => child?.closeBlockedWhileClarificationPending === true)
      : true,
    resumedToImplementing: expectedClarification
      ? matchingChildren.every((child) => child?.resumedWorkflowState === "implementing")
      : true,
    retrievalAfterResume: expectedClarification && requiresRetrievalAfterResume
      ? matchingChildren.every((child) =>
        Array.isArray(child?.retrievalRunIdsAfterClarification)
        && child.retrievalRunIdsAfterClarification.length > 0)
      : true,
  };

  const failures = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);

  return {
    checks,
    failures,
    expectedClarificationMode,
    clarifiedChildCount: clarified.length,
    matchingChildCount: matchingChildren.length,
    requiresRetrievalAfterResume,
  };
}

export function assertClarificationLoopInvariant(input) {
  const evaluation = evaluateClarificationLoopInvariant(input);
  if (evaluation.failures.length > 0) {
    throw new Error(
      [
        "Clarification loop invariant failures:",
        ...evaluation.failures.map((failure) => `- ${failure}`),
      ].join("\n"),
    );
  }
  return evaluation;
}
