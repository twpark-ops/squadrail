function latestMessage(messages, type, predicate = () => true) {
  for (let index = (messages ?? []).length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.messageType === type && predicate(message)) return message;
  }
  return null;
}

function firstEngineerRecipientId(message) {
  const recipient = (message?.recipients ?? []).find((entry) => entry?.role === "engineer");
  if (typeof recipient?.recipientId === "string" && recipient.recipientId.length > 0) {
    return recipient.recipientId;
  }
  const payloadId = message?.payload?.newAssigneeAgentId;
  return typeof payloadId === "string" && payloadId.length > 0 ? payloadId : null;
}

function parseSeq(value) {
  return Number.isFinite(value) ? Number(value) : null;
}

export function evaluateChangeRecoveryInvariant(input) {
  const messages = Array.isArray(input.messages) ? input.messages : [];
  const finalState = input.finalState ?? {};
  const recoveryMode = input.recoveryMode ?? "any";
  const expectedRecoveryOwnerId = input.expectedRecoveryOwnerId ?? null;

  const requestChanges = latestMessage(messages, "REQUEST_CHANGES");
  const requestSeq = parseSeq(requestChanges?.seq);
  const postRequestPredicate = (message) => requestSeq == null || parseSeq(message?.seq) > requestSeq;
  const reassignAfterRequest = latestMessage(messages, "REASSIGN_TASK", postRequestPredicate);
  const ackChange = latestMessage(messages, "ACK_CHANGE_REQUEST", postRequestPredicate);
  const ackSeq = parseSeq(ackChange?.seq);
  const postAckPredicate = (message) => ackSeq == null || parseSeq(message?.seq) > ackSeq;
  const restartImplementation = latestMessage(messages, "START_IMPLEMENTATION", postAckPredicate);
  const recoveryResumeMessage =
    restartImplementation
    ?? (ackChange?.workflowStateAfter === "implementing" ? ackChange : null);
  const recoveryResumeSeq = parseSeq(recoveryResumeMessage?.seq);
  const postRecoveryResumePredicate = (message) =>
    recoveryResumeSeq == null || parseSeq(message?.seq) > recoveryResumeSeq;
  const submitAfterRecovery = latestMessage(messages, "SUBMIT_FOR_REVIEW", postRecoveryResumePredicate);
  const approvalAfterRecovery = latestMessage(messages, "APPROVE_IMPLEMENTATION", postRecoveryResumePredicate);
  const closeAfterRecovery = latestMessage(messages, "CLOSE_TASK", postRecoveryResumePredicate);

  const reassignEngineerId = firstEngineerRecipientId(reassignAfterRequest);
  const effectiveRecoveryOwnerId =
    expectedRecoveryOwnerId
    ?? reassignEngineerId
    ?? finalState.primaryEngineerAgentId
    ?? null;
  const ackSenderId = ackChange?.sender?.actorId ?? null;
  const recoveryResumeSenderId = recoveryResumeMessage?.sender?.actorId ?? null;

  const checks = {
    requestChangesRecorded: Boolean(requestChanges),
    recoveryAckRecorded: Boolean(ackChange),
    recoveryRestartRecorded: Boolean(recoveryResumeMessage),
    recoverySequenceOrdered:
      requestSeq != null
      && ackSeq != null
      && recoveryResumeSeq != null
      && requestSeq < ackSeq
      && ackSeq <= recoveryResumeSeq,
    reassignRecovery:
      recoveryMode === "reassign"
        ? Boolean(reassignAfterRequest && reassignEngineerId)
        : true,
    directOwnerRecovery:
      recoveryMode === "direct_owner"
        ? !reassignAfterRequest
        : true,
    recoveryOwnerBound: typeof finalState.primaryEngineerAgentId === "string" && finalState.primaryEngineerAgentId.length > 0,
    recoveryOwnerMatched: effectiveRecoveryOwnerId
      ? finalState.primaryEngineerAgentId === effectiveRecoveryOwnerId
      : typeof finalState.primaryEngineerAgentId === "string" && finalState.primaryEngineerAgentId.length > 0,
    recoverySenderContinuity: effectiveRecoveryOwnerId
      ? ackSenderId === effectiveRecoveryOwnerId && recoveryResumeSenderId === effectiveRecoveryOwnerId
      : Boolean(ackSenderId) && ackSenderId === recoveryResumeSenderId,
    postRecoveryResubmitted: Boolean(submitAfterRecovery),
    finalApprovalAfterRecovery: Boolean(approvalAfterRecovery),
    finalCloseAfterRecovery: Boolean(closeAfterRecovery),
  };

  const failures = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);

  return {
    checks,
    failures,
    recoveryMode,
    expectedRecoveryOwnerId,
    observed: {
      requestChangesId: requestChanges?.id ?? null,
      reassignAfterRequestId: reassignAfterRequest?.id ?? null,
      ackChangeId: ackChange?.id ?? null,
      restartImplementationId: restartImplementation?.id ?? null,
      recoveryResumeId: recoveryResumeMessage?.id ?? null,
      recoveryOwnerId: effectiveRecoveryOwnerId,
    },
  };
}

export function assertChangeRecoveryInvariant(input) {
  const evaluation = evaluateChangeRecoveryInvariant(input);
  if (evaluation.failures.length > 0) {
    throw new Error(
      [
        "Change recovery invariant failures:",
        ...evaluation.failures.map((failure) => `- ${failure}`),
      ].join("\n"),
    );
  }
  return evaluation;
}
