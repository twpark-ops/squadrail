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
    summary: "Deterministic reviewer approval after the recovery resubmission",
    requiresAck: false,
    payload: {
      approvalMode: "agent_review",
      approvalSummary:
        "The implementation owner completed the requested recovery cycle and resubmitted focused evidence for final review.",
      approvalChecklist: [
        "REQUEST_CHANGES was acknowledged",
        "The same implementation owner resumed execution",
        "A focused post-recovery review submission was recorded",
      ],
      verifiedEvidence: [
        "ACK_CHANGE_REQUEST recorded in protocol",
        "Post-recovery SUBMIT_FOR_REVIEW recorded in protocol",
        "Latest diff and test artifacts reviewed",
      ],
      residualRisks: [
        qaAgentId
          ? "Final execution verification still depends on the QA gate."
          : "Merge remains external to this deterministic E2E harness.",
      ],
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
    summary: "Deterministic QA approval after reviewer recovery validation",
    requiresAck: false,
    payload: {
      approvalMode: "agent_review",
      approvalSummary:
        "QA confirmed the requested recovery evidence and the focused observability validation remain sufficient after resubmission.",
      approvalChecklist: [
        "Recovery evidence was present after REQUEST_CHANGES",
        "Focused observability validation passed",
        "The implementation scope remained local to the requested files",
      ],
      verifiedEvidence: [
        "Review handoff payload inspected",
        "Change-request follow-up evidence inspected",
        "Focused test evidence reviewed",
      ],
      residualRisks: [
        "Build stamping may still be absent in local builds, so deterministic fallback remains expected.",
      ],
      executionLog: "go test ./internal/observability -count=1 passed in the recovery resubmission evidence.",
      outputVerified: "Observed focused observability validation evidence in the latest review submission.",
      sanityCommand: "go test ./internal/observability -count=1",
    },
    artifacts: [],
  };
}
