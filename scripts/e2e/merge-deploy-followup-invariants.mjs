function latestMessage(messages, messageType) {
  return [...(messages ?? [])].reverse().find((message) => message?.messageType === messageType) ?? null;
}

function toTimestamp(value) {
  if (typeof value !== "string" || value.length === 0) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readLogContent(logResult) {
  if (!logResult) return "";
  if (typeof logResult.content === "string") return logResult.content;
  if (Array.isArray(logResult.content)) {
    return logResult.content
      .map((entry) => {
        if (typeof entry === "string") return entry;
        if (entry && typeof entry === "object" && typeof entry.text === "string") return entry.text;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function findRunByProtocolMessageType(runs, messageType) {
  return (runs ?? []).find((run) => {
    const protocolProgress = run?.resultJson?.protocolProgress;
    return protocolProgress?.protocolMessageType === messageType;
  }) ?? null;
}

export function findCloseFollowupRun(deliverySnapshot) {
  const latestClose = latestMessage(deliverySnapshot?.protocolMessages, "CLOSE_TASK");
  const latestApproval = latestMessage(deliverySnapshot?.protocolMessages, "APPROVE_IMPLEMENTATION");
  const directProtocolRun = findRunByProtocolMessageType(deliverySnapshot?.runs, "CLOSE_TASK");
  if (directProtocolRun?.runId) {
    return directProtocolRun;
  }

  const closeSenderId =
    latestClose?.sender?.actorType === "agent" && typeof latestClose?.sender?.actorId === "string"
      ? latestClose.sender.actorId
      : (deliverySnapshot?.protocolState?.techLeadAgentId ?? null);
  const approvalTimestamp = toTimestamp(latestApproval?.createdAt ?? null);

  const candidateRuns = [...(deliverySnapshot?.runs ?? [])]
    .filter((run) => {
      if (!run?.runId) return false;
      if (closeSenderId && run.agentId !== closeSenderId) return false;
      const createdTimestamp = toTimestamp(run.createdAt ?? null) ?? toTimestamp(run.startedAt ?? null);
      if (approvalTimestamp !== null && createdTimestamp !== null && createdTimestamp < approvalTimestamp) {
        return false;
      }
      return true;
    })
    .sort((left, right) => {
      const leftTimestamp = toTimestamp(left?.createdAt ?? null) ?? toTimestamp(left?.startedAt ?? null) ?? 0;
      const rightTimestamp = toTimestamp(right?.createdAt ?? null) ?? toTimestamp(right?.startedAt ?? null) ?? 0;
      return rightTimestamp - leftTimestamp;
    });

  return candidateRuns[0] ?? null;
}

function findTaskSessionForIssue(sessions, issueId) {
  if (!issueId) return null;
  return (sessions ?? []).find((session) => session?.taskKey === issueId) ?? null;
}

export function evaluateMergeDeployFollowupScenario(input) {
  const deliverySnapshot = input.deliverySnapshot ?? {};
  const changeSurface = input.changeSurface ?? {};
  const issueId = input.issueId ?? deliverySnapshot.issue?.id ?? null;
  const latestClose = latestMessage(deliverySnapshot.protocolMessages, "CLOSE_TASK");
  const latestApproval = latestMessage(deliverySnapshot.protocolMessages, "APPROVE_IMPLEMENTATION");
  const mergeCandidate = changeSurface.mergeCandidate ?? null;
  const closeRun = input.closeRun ?? findCloseFollowupRun(deliverySnapshot);
  const closeRunLog = readLogContent(input.closeRunLog);
  const closeWakeEvidenceMatched = input.closeWakeEvidence?.matched === true;
  const techLeadSession = findTaskSessionForIssue(input.techLeadSessions, issueId);
  const reviewerSession = findTaskSessionForIssue(input.reviewerSessions, issueId);
  const changeSurfaceFiles = Array.isArray(changeSurface.changedFiles) ? changeSurface.changedFiles : [];
  const mergeCandidateFiles = Array.isArray(mergeCandidate?.changedFiles) ? mergeCandidate.changedFiles : [];
  const closeRunProgressSatisfied =
    closeRun?.resultJson?.protocolProgress?.protocolMessageType === "CLOSE_TASK"
    && closeRun?.resultJson?.protocolProgress?.satisfied === true;
  const reviewerSessionNotReused =
    Boolean(techLeadSession?.sessionDisplayId)
    && Boolean(reviewerSession?.sessionDisplayId)
    && techLeadSession.sessionDisplayId !== reviewerSession.sessionDisplayId;
  const expectedCloseAgentId = deliverySnapshot?.protocolState?.techLeadAgentId ?? null;
  const closeRunOwnedByTechLead =
    Boolean(closeRun?.runId)
    && (
      !expectedCloseAgentId
      || closeRun?.agentId === expectedCloseAgentId
    );
  const closeRunIndicatesDedicatedFollowup =
    Boolean(closeRun?.runId)
    && closeRunOwnedByTechLead
    && reviewerSessionNotReused;

  const checks = {
    mergeCandidateSurfacePresent: Boolean(mergeCandidate),
    mergeCandidatePendingState: mergeCandidate?.state === "pending",
    mergeCandidateAnchoredToClose:
      Boolean(mergeCandidate?.closeMessageId)
      && Boolean(latestClose?.id)
      && mergeCandidate.closeMessageId === latestClose.id,
    mergeCandidateProvenancePreserved:
      Boolean(mergeCandidate?.sourceBranch)
      && Boolean(mergeCandidate?.headSha)
      && Boolean(mergeCandidate?.workspacePath)
      && Boolean(mergeCandidate?.diffStat)
      && mergeCandidateFiles.length > 0
      && mergeCandidateFiles.every((file) => changeSurfaceFiles.includes(file)),
    mergeCandidateSummariesRetained:
      mergeCandidate?.closeSummary === (latestClose?.payload?.closureSummary ?? null)
      && mergeCandidate?.verificationSummary === (latestClose?.payload?.verificationSummary ?? null)
      && mergeCandidate?.approvalSummary === (latestApproval?.payload?.approvalSummary ?? null)
      && mergeCandidate?.rollbackPlan === (latestClose?.payload?.rollbackPlan ?? null),
    deploySurfaceSignalsPresent:
      Array.isArray(mergeCandidate?.remainingRisks)
      && mergeCandidate.remainingRisks.length > 0
      && typeof mergeCandidate?.verificationSummary === "string"
      && (
        Boolean(mergeCandidate?.gateStatus)
        || mergeCandidate?.state === "pending"
      ),
    closeRunCaptured: Boolean(closeRun?.runId),
    closeRunObserved:
      closeRunProgressSatisfied
      || (Boolean(latestClose?.id) && Boolean(closeRun?.runId)),
    closeFollowupWakeCaptured:
      closeWakeEvidenceMatched
      || closeRunIndicatesDedicatedFollowup
      || (
      issueId
        ? closeRunLog.includes(`Skipping saved session resume for task "${issueId}" because wake reason is issue_ready_for_closure.`)
        : closeRunLog.includes("wake reason is issue_ready_for_closure")
      ),
    taskSessionsCaptured: Boolean(techLeadSession && reviewerSession),
    reviewerSessionNotReused,
  };

  const failures = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);

  return {
    checks,
    failures,
    latestClose,
    latestApproval,
    mergeCandidate,
    closeRun,
    techLeadSession,
    reviewerSession,
  };
}

export function assertMergeDeployFollowupScenario(input) {
  const evaluation = evaluateMergeDeployFollowupScenario(input);
  if (evaluation.failures.length > 0) {
    throw new Error(
      [
        "Merge/deploy follow-up invariant failures:",
        ...evaluation.failures.map((failure) => `- ${failure}`),
      ].join("\n"),
    );
  }
  return evaluation;
}
