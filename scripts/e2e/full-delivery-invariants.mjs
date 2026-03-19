const REQUIRED_MESSAGE_TYPES = [
  "ASSIGN_TASK",
  "ACK_ASSIGNMENT",
  "START_IMPLEMENTATION",
  "SUBMIT_FOR_REVIEW",
  "START_REVIEW",
  "APPROVE_IMPLEMENTATION",
  "CLOSE_TASK",
];

function messageTypes(messages) {
  return new Set((messages ?? []).map((message) => message.messageType));
}

function latestMessage(messages, messageType) {
  return [...(messages ?? [])].reverse().find((message) => message.messageType === messageType) ?? null;
}

function implementationRun(runs) {
  return (runs ?? []).find((run) => {
    const snapshot = run?.resultJson?.workspaceGitSnapshot;
    const changedFiles = Array.isArray(snapshot?.changedFiles) ? snapshot.changedFiles : [];
    return changedFiles.length > 0;
  }) ?? null;
}

function artifactKinds(message) {
  return Array.isArray(message?.artifacts) ? message.artifacts.map((artifact) => artifact.kind) : [];
}

export function evaluateCanonicalScenarioOne(input) {
  const deliverySnapshot = input.deliverySnapshot ?? {};
  const rootSnapshot = input.rootSnapshot ?? {};
  const preview = input.projectionPreview ?? {};
  const expectedProjectId = input.expectedProjectId ?? null;
  const expectedStaffing = input.expectedStaffing ?? {};

  const deliveryMessageTypeSet = messageTypes(deliverySnapshot.protocolMessages);
  const rootMessageTypeSet = messageTypes(rootSnapshot.protocolMessages);
  const latestSubmit = latestMessage(deliverySnapshot.protocolMessages, "SUBMIT_FOR_REVIEW");
  const latestClose = latestMessage(deliverySnapshot.protocolMessages, "CLOSE_TASK");
  const latestApproval = latestMessage(deliverySnapshot.protocolMessages, "APPROVE_IMPLEMENTATION");
  const runWithChanges = implementationRun(deliverySnapshot.runs);
  const submitArtifactKinds = artifactKinds(latestSubmit);
  const finalArtifacts = Array.isArray(latestClose?.payload?.finalArtifacts)
    ? latestClose.payload.finalArtifacts
    : [];

  const checks = {
    selectedProjectMatched: expectedProjectId ? preview.selectedProjectId === expectedProjectId : true,
    staffingMatched:
      (!expectedStaffing.techLeadAgentId || preview?.staffing?.techLeadAgentId === expectedStaffing.techLeadAgentId)
      && (!expectedStaffing.engineerAgentId || preview?.staffing?.implementationAssigneeAgentId === expectedStaffing.engineerAgentId)
      && (!expectedStaffing.reviewerAgentId || preview?.staffing?.reviewerAgentId === expectedStaffing.reviewerAgentId),
    projectedIssueCreated: Boolean(deliverySnapshot.issue?.id),
    finalWorkflowStateDone: deliverySnapshot.protocolState?.workflowState === "done",
    rootAssignTaskRecorded: rootMessageTypeSet.has("ASSIGN_TASK"),
    requiredMessageTypesPresent: REQUIRED_MESSAGE_TYPES.every((messageType) => deliveryMessageTypeSet.has(messageType)),
    briefsSufficient: Array.isArray(deliverySnapshot.briefs) && deliverySnapshot.briefs.length >= 2,
    implementationRunCaptured: Boolean(runWithChanges),
    submitArtifactsComplete:
      submitArtifactKinds.includes("diff")
      && submitArtifactKinds.includes("test_run")
      && submitArtifactKinds.includes("build_run"),
    approvalRecorded: Boolean(latestApproval),
    closeRecorded: Boolean(latestClose),
    closeUsesPendingExternalMerge:
      latestClose?.payload?.mergeStatus === "pending_external_merge"
      && finalArtifacts.includes("pending_external_merge"),
    implementationOwnershipMatched:
      !expectedStaffing.engineerAgentId
      || deliverySnapshot.protocolState?.primaryEngineerAgentId === expectedStaffing.engineerAgentId,
  };

  const failures = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);

  return {
    checks,
    failures,
    latestSubmit,
    latestClose,
    latestApproval,
    implementationRun: runWithChanges,
    requiredMessageTypes: REQUIRED_MESSAGE_TYPES,
  };
}

export function assertCanonicalScenarioOne(input) {
  const evaluation = evaluateCanonicalScenarioOne(input);
  if (evaluation.failures.length > 0) {
    throw new Error(
      [
        "Canonical scenario 1 invariant failures:",
        ...evaluation.failures.map((failure) => `- ${failure}`),
      ].join("\n"),
    );
  }
  return evaluation;
}
