function buildAgentSelfRecipient(agentId, role) {
  return {
    recipientType: "agent",
    recipientId: agentId,
    role,
  };
}

function buildAgentRecipient(agentId, role) {
  return {
    recipientType: "agent",
    recipientId: agentId,
    role,
  };
}

export function createDeterministicReviewerApprovalMessage(input) {
  const {
    issueId,
    reviewerId,
    qaAgentId = null,
    workflowStateBefore = "under_review",
    summary = "Deterministic reviewer approval after focused review",
    approvalSummary = "The implementation owner submitted focused evidence and the reviewer accepted the bounded delivery slice.",
    approvalChecklist = [
      "Focused review submission was recorded",
      "Diff and test evidence were reviewed",
      "The delivery slice stayed within the requested scope",
    ],
    verifiedEvidence = [
      "SUBMIT_FOR_REVIEW recorded in protocol",
      "Latest diff and test artifacts reviewed",
      "Focused reviewer handoff inspected",
    ],
    residualRisks = qaAgentId
      ? ["Final execution verification still depends on the QA gate."]
      : ["Merge remains external to this deterministic E2E harness."],
  } = input;

  return {
    messageType: "APPROVE_IMPLEMENTATION",
    sender: {
      actorType: "agent",
      actorId: reviewerId,
      role: "reviewer",
    },
    recipients: [
      buildAgentSelfRecipient(reviewerId, "reviewer"),
      ...(qaAgentId ? [buildAgentRecipient(qaAgentId, "qa")] : []),
    ],
    workflowStateBefore,
    workflowStateAfter: qaAgentId ? "qa_pending" : "approved",
    summary,
    requiresAck: false,
    payload: {
      approvalMode: "agent_review",
      approvalSummary,
      approvalChecklist,
      verifiedEvidence,
      residualRisks,
    },
    artifacts: [],
  };
}

export function createDeterministicQaApprovalMessage(input) {
  const {
    issueId,
    qaId,
    techLeadAgentId = null,
    workflowStateBefore = "under_qa_review",
    summary = "Deterministic QA approval after reviewer validation",
    approvalSummary = "QA confirmed the focused execution evidence remains sufficient for gate approval.",
    approvalChecklist = [
      "Execution evidence is present for the QA gate",
      "Focused validation passed",
      "The implementation scope remained local to the requested files",
    ],
    verifiedEvidence = [
      "Review handoff payload inspected",
      "Focused validation evidence reviewed",
      "Latest diff scope reviewed",
    ],
    residualRisks = [
      "Merge remains external to this deterministic E2E harness.",
    ],
    executionLog = "Focused execution evidence passed for the QA gate scenario.",
    outputVerified = "Observed focused validation evidence in the latest review submission.",
    sanityCommand = "go test ./internal/observability -count=1",
  } = input;

  return {
    messageType: "APPROVE_IMPLEMENTATION",
    sender: {
      actorType: "agent",
      actorId: qaId,
      role: "qa",
    },
    recipients: [
      buildAgentSelfRecipient(qaId, "qa"),
      ...(techLeadAgentId ? [buildAgentRecipient(techLeadAgentId, "tech_lead")] : []),
    ],
    workflowStateBefore,
    workflowStateAfter: "approved",
    summary,
    requiresAck: false,
    payload: {
      approvalMode: "agent_review",
      approvalSummary,
      approvalChecklist,
      verifiedEvidence,
      residualRisks,
      executionLog,
      outputVerified,
      sanityCommand,
    },
    artifacts: [],
  };
}
