function parseSeq(value) {
  return Number.isFinite(value) ? Number(value) : null;
}

function senderRole(message) {
  if (typeof message?.senderRole === "string" && message.senderRole.length > 0) {
    return message.senderRole;
  }
  if (typeof message?.sender?.role === "string" && message.sender.role.length > 0) {
    return message.sender.role;
  }
  return null;
}

function senderId(message) {
  if (typeof message?.sender?.actorId === "string" && message.sender.actorId.length > 0) {
    return message.sender.actorId;
  }
  return null;
}

function latestMessage(messages, type, predicate = () => true) {
  for (let index = (messages ?? []).length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.messageType === type && predicate(message)) return message;
  }
  return null;
}

function latestMessageOfTypes(messages, types, predicate = () => true) {
  for (let index = (messages ?? []).length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (types.includes(message?.messageType) && predicate(message)) return message;
  }
  return null;
}

function readString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function readStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function evaluateQaGateInvariant(input) {
  const messages = Array.isArray(input.messages) ? input.messages : [];
  const finalState = input.finalState ?? {};
  const expectedQaAgentId = input.expectedQaAgentId ?? null;
  const expectedReviewerId = input.expectedReviewerId ?? null;
  const requireClose = input.requireClose !== false;

  const reviewerApproval = latestMessage(messages, "APPROVE_IMPLEMENTATION", (message) => {
    if (senderRole(message) !== "reviewer") return false;
    if (expectedReviewerId && senderId(message) !== expectedReviewerId) return false;
    return true;
  });
  const reviewerApprovalSeq = parseSeq(reviewerApproval?.seq);

  const qaStart = latestMessage(messages, "START_REVIEW", (message) => {
    const seq = parseSeq(message?.seq);
    if (reviewerApprovalSeq != null && (seq == null || seq <= reviewerApprovalSeq)) return false;
    if (senderRole(message) !== "qa") return false;
    if (expectedQaAgentId && senderId(message) !== expectedQaAgentId) return false;
    return true;
  });
  const qaStartSeq = parseSeq(qaStart?.seq);

  const qaDecision = latestMessageOfTypes(messages, [
    "APPROVE_IMPLEMENTATION",
    "REQUEST_CHANGES",
    "REQUEST_HUMAN_DECISION",
  ], (message) => {
    const seq = parseSeq(message?.seq);
    if (reviewerApprovalSeq != null && (seq == null || seq <= reviewerApprovalSeq)) return false;
    if (senderRole(message) !== "qa") return false;
    if (expectedQaAgentId && senderId(message) !== expectedQaAgentId) return false;
    return true;
  });
  const qaDecisionSeq = parseSeq(qaDecision?.seq);

  const closeAfterReviewerApproval = latestMessage(messages, "CLOSE_TASK", (message) => {
    const seq = parseSeq(message?.seq);
    return reviewerApprovalSeq != null && seq != null && seq > reviewerApprovalSeq;
  });
  const closeBeforeQaDecision = latestMessage(messages, "CLOSE_TASK", (message) => {
    const seq = parseSeq(message?.seq);
    if (reviewerApprovalSeq == null || seq == null || seq <= reviewerApprovalSeq) return false;
    if (qaDecisionSeq == null) return true;
    return seq < qaDecisionSeq;
  });

  const qaDecisionPayload = qaDecision?.payload ?? {};
  const qaExecutionEvidencePresent =
    Boolean(readString(qaDecisionPayload.executionLog))
    || Boolean(readString(qaDecisionPayload.outputVerified))
    || Boolean(readString(qaDecisionPayload.sanityCommand));
  const qaFailureEvidencePresent =
    Boolean(readString(qaDecisionPayload.executionLog))
    || Boolean(readString(qaDecisionPayload.failureEvidence));
  const qaVerifiedEvidencePresent = readStringArray(qaDecisionPayload.verifiedEvidence).length > 0;
  const qaRequiredEvidencePresent = readStringArray(qaDecisionPayload.requiredEvidence).length > 0;

  const qaDecisionWorkflowValid =
    qaDecision?.messageType === "APPROVE_IMPLEMENTATION"
      ? qaDecision?.workflowStateBefore === "under_qa_review" && qaDecision?.workflowStateAfter === "approved"
      : qaDecision?.messageType === "REQUEST_CHANGES"
        ? qaDecision?.workflowStateBefore === "under_qa_review" && qaDecision?.workflowStateAfter === "changes_requested"
        : qaDecision?.messageType === "REQUEST_HUMAN_DECISION"
          ? qaDecision?.workflowStateBefore === "under_qa_review" && qaDecision?.workflowStateAfter === "awaiting_human_decision"
          : false;

  const checks = {
    reviewerApprovalRecorded: Boolean(reviewerApproval),
    reviewerApprovalRoutedToQaPending: reviewerApproval?.workflowStateAfter === "qa_pending",
    qaStartRecorded: Boolean(qaStart),
    qaStartTransitionsIntoQaReview:
      qaStart?.workflowStateBefore === "qa_pending" && qaStart?.workflowStateAfter === "under_qa_review",
    qaDecisionRecorded: Boolean(qaDecision),
    qaDecisionOrderedAfterQaStart:
      reviewerApprovalSeq != null
      && qaStartSeq != null
      && qaDecisionSeq != null
      && reviewerApprovalSeq < qaStartSeq
      && qaStartSeq < qaDecisionSeq,
    qaDecisionWorkflowValid,
    qaActorMatched:
      expectedQaAgentId == null
      || (senderId(qaStart) === expectedQaAgentId && senderId(qaDecision) === expectedQaAgentId),
    qaApprovalHasExecutionEvidence:
      qaDecision?.messageType === "APPROVE_IMPLEMENTATION" ? qaExecutionEvidencePresent : true,
    qaApprovalHasVerifiedEvidence:
      qaDecision?.messageType === "APPROVE_IMPLEMENTATION" ? qaVerifiedEvidencePresent : true,
    qaRequestChangesHasFailureEvidence:
      qaDecision?.messageType === "REQUEST_CHANGES" ? qaFailureEvidencePresent : true,
    qaRequestChangesHasRequiredEvidence:
      qaDecision?.messageType === "REQUEST_CHANGES" ? qaRequiredEvidencePresent : true,
    noCloseBeforeQaDecision: !closeBeforeQaDecision,
    finalCloseAfterQaDecision:
      requireClose
        ? Boolean(
          closeAfterReviewerApproval
          && qaDecisionSeq != null
          && parseSeq(closeAfterReviewerApproval.seq) != null
          && parseSeq(closeAfterReviewerApproval.seq) > qaDecisionSeq
        )
        : true,
    finalStateSettledAfterQaDecision:
      qaDecision?.messageType === "APPROVE_IMPLEMENTATION"
        ? ["approved", "done"].includes(finalState.workflowState ?? "")
        : qaDecision?.messageType === "REQUEST_CHANGES"
          ? [
            "changes_requested",
            "implementing",
            "submitted_for_review",
            "under_review",
            "under_qa_review",
            "approved",
            "done",
          ].includes(finalState.workflowState ?? "")
          : qaDecision?.messageType === "REQUEST_HUMAN_DECISION"
            ? ["awaiting_human_decision", "approved", "done"].includes(finalState.workflowState ?? "")
            : false,
  };

  const failures = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);

  return {
    checks,
    failures,
    observed: {
      reviewerApprovalId: reviewerApproval?.id ?? null,
      qaStartId: qaStart?.id ?? null,
      qaDecisionId: qaDecision?.id ?? null,
      qaDecisionType: qaDecision?.messageType ?? null,
      closeId: closeAfterReviewerApproval?.id ?? null,
    },
  };
}

export function assertQaGateInvariant(input) {
  const evaluation = evaluateQaGateInvariant(input);
  if (evaluation.failures.length > 0) {
    throw new Error(
      [
        "QA gate invariant failures:",
        ...evaluation.failures.map((failure) => `- ${failure}`),
      ].join("\n")
    );
  }
  return evaluation;
}
