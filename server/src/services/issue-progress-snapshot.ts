import type {
  IssueProgressSnapshot,
  IssueProgressPhase,
  IssueProgressOwnerRole,
  IssueProgressReviewState,
  IssueProgressQaState,
  IssueProgressSubtaskSummary,
  IssueInternalWorkItemSummary,
  IssueProtocolState,
  IssueProtocolMessage,
  IssueStatus,
} from "@squadrail/shared";

/* ── Workflow state → phase mapping ── */

function derivePhase(
  workflowState: string | null | undefined,
  issueStatus: IssueStatus,
  pendingClarificationCount: number,
): IssueProgressPhase {
  // Terminal states first
  if (workflowState === "done" || issueStatus === "done") return "done";
  if (workflowState === "cancelled" || issueStatus === "cancelled") return "cancelled";

  // If there are pending human clarifications and not terminal, override to clarification
  if (pendingClarificationCount > 0) return "clarification";

  if (workflowState === "blocked") return "blocked";

  switch (workflowState) {
    case "backlog":
    case "assigned":
      return "intake";
    case "accepted":
    case "planning":
      return "planning";
    case "implementing":
    case "changes_requested":
      return "implementing";
    case "submitted_for_review":
    case "under_review":
      return "review";
    case "qa_pending":
    case "under_qa_review":
      return "qa";
    case "merge_requested":
    case "merge_approved":
    case "deploying":
      return "merge";
    case "approved":
      return "done";
    case "awaiting_human_decision":
      return "clarification";
    default:
      break;
  }

  // Fallback from issue status when no protocol state exists
  switch (issueStatus) {
    case "backlog":
    case "todo":
      return "intake";
    case "in_progress":
      return "implementing";
    case "in_review":
      return "review";
    case "blocked":
      return "blocked";
    default:
      return "intake";
  }
}

/* ── Active owner resolution ── */

function deriveActiveOwner(
  phase: IssueProgressPhase,
  protocolState: IssueProtocolState | null,
): { role: IssueProgressOwnerRole; agentId: string | null } {
  if (!protocolState) return { role: null, agentId: null };

  switch (phase) {
    case "intake":
    case "planning":
      return {
        role: "tech_lead",
        agentId: protocolState.techLeadAgentId,
      };
    case "implementing":
      return {
        role: "engineer",
        agentId: protocolState.primaryEngineerAgentId,
      };
    case "review":
      return {
        role: "reviewer",
        agentId: protocolState.reviewerAgentId,
      };
    case "qa":
      return {
        role: "qa",
        agentId: protocolState.qaAgentId,
      };
    case "merge":
    case "done":
      return {
        role: "tech_lead",
        agentId: protocolState.techLeadAgentId,
      };
    case "blocked":
      // Try to identify who is blocked based on blockedPhase
      switch (protocolState.blockedPhase) {
        case "implementing":
          return { role: "engineer", agentId: protocolState.primaryEngineerAgentId };
        case "review":
          return { role: "reviewer", agentId: protocolState.reviewerAgentId };
        default:
          return { role: "tech_lead", agentId: protocolState.techLeadAgentId };
      }
    case "clarification":
      return { role: null, agentId: null };
    case "cancelled":
      return { role: null, agentId: null };
    default:
      return { role: null, agentId: null };
  }
}

/* ── Review state ── */

function deriveReviewState(
  workflowState: string | null | undefined,
): IssueProgressReviewState {
  switch (workflowState) {
    case "submitted_for_review":
      return "waiting_review";
    case "under_review":
      return "in_review";
    case "changes_requested":
      return "changes_requested";
    case "approved":
    case "done":
    case "merge_requested":
    case "merge_approved":
    case "deploying":
      return "approved";
    default:
      return "idle";
  }
}

/* ── QA state ── */

function deriveQaState(
  workflowState: string | null | undefined,
  qaAgentId: string | null | undefined,
): IssueProgressQaState {
  if (!qaAgentId) return "not_required";

  switch (workflowState) {
    case "qa_pending":
      return "pending";
    case "under_qa_review":
      return "running";
    case "approved":
    case "done":
    case "merge_requested":
    case "merge_approved":
    case "deploying":
      return "passed";
    default:
      return "pending";
  }
}

/* ── Subtask summary ── */

function deriveSubtaskSummary(
  workItemSummary: IssueInternalWorkItemSummary | null | undefined,
): IssueProgressSubtaskSummary {
  if (!workItemSummary) {
    return { total: 0, done: 0, open: 0, blocked: 0, inReview: 0 };
  }
  return {
    total: workItemSummary.total,
    done: workItemSummary.done + workItemSummary.cancelled,
    open: workItemSummary.todo + workItemSummary.inProgress + workItemSummary.backlog,
    blocked: workItemSummary.blocked,
    inReview: workItemSummary.inReview,
  };
}

/* ── Pending clarification count ── */

function countPendingClarifications(
  messages: IssueProtocolMessage[],
): number {
  const answeredIds = new Set<string>();
  for (const msg of messages) {
    if (msg.messageType === "ANSWER_CLARIFICATION" && msg.causalMessageId) {
      answeredIds.add(msg.causalMessageId);
    }
  }

  let count = 0;
  for (const msg of messages) {
    if (msg.messageType !== "ASK_CLARIFICATION") continue;
    if (msg.ackedAt || answeredIds.has(msg.id)) continue;
    const payload = (msg.payload ?? {}) as unknown as Record<string, unknown>;
    if (payload.requestedFrom !== "human_board") continue;
    count++;
  }
  return count;
}

/* ── Headline ── */

function buildHeadline(
  phase: IssueProgressPhase,
  subtaskSummary: IssueProgressSubtaskSummary,
  pendingClarificationCount: number,
  blockedReason: string | null,
  reviewState: IssueProgressReviewState,
  qaState: IssueProgressQaState,
): string {
  const subtaskProgress = subtaskSummary.total > 0
    ? ` (${subtaskSummary.done}/${subtaskSummary.total} subtasks done)`
    : "";

  switch (phase) {
    case "intake":
      return `Intake — waiting for assignment${subtaskProgress}`;
    case "clarification":
      return `Clarification needed — ${pendingClarificationCount} question${pendingClarificationCount !== 1 ? "s" : ""} pending`;
    case "planning":
      return `Planning in progress${subtaskProgress}`;
    case "implementing":
      return `Engineer is implementing${subtaskProgress}`;
    case "review":
      if (reviewState === "in_review") return `Code review in progress${subtaskProgress}`;
      if (reviewState === "changes_requested") return `Changes requested by reviewer${subtaskProgress}`;
      return `Waiting for review${subtaskProgress}`;
    case "qa":
      if (qaState === "running") return `QA validation in progress${subtaskProgress}`;
      return `Waiting for QA${subtaskProgress}`;
    case "merge":
      return `Merge in progress${subtaskProgress}`;
    case "blocked":
      return blockedReason
        ? `Blocked: ${blockedReason.replace(/_/g, " ")}`
        : "Blocked — waiting for resolution";
    case "done":
      return `Completed${subtaskProgress}`;
    case "cancelled":
      return "Cancelled";
    default:
      return `In progress${subtaskProgress}`;
  }
}

/* ── Latest artifact kinds ── */

function deriveLatestArtifactKinds(
  messages: IssueProtocolMessage[],
): string[] {
  const kinds = new Set<string>();
  // Scan the last 20 messages for artifact kinds
  const recent = messages.slice(-20);
  for (const msg of recent) {
    if (Array.isArray(msg.artifacts)) {
      for (const artifact of msg.artifacts) {
        if (typeof artifact.kind === "string") {
          kinds.add(artifact.kind);
        }
      }
    }
  }
  return [...kinds];
}

/* ── Main computation ── */

export function computeIssueProgressSnapshot(input: {
  issue: { status: IssueStatus };
  protocolState: IssueProtocolState | null;
  internalWorkItemSummary: IssueInternalWorkItemSummary | null | undefined;
  protocolMessages: IssueProtocolMessage[];
}): IssueProgressSnapshot {
  const { issue, protocolState, internalWorkItemSummary, protocolMessages } = input;

  const workflowState = protocolState?.workflowState ?? null;
  const pendingClarificationCount = countPendingClarifications(protocolMessages);
  const phase = derivePhase(workflowState, issue.status, pendingClarificationCount);
  const subtaskSummary = deriveSubtaskSummary(internalWorkItemSummary);
  const { role: activeOwnerRole, agentId: activeOwnerAgentId } = deriveActiveOwner(phase, protocolState);
  const blockedReason = phase === "blocked" ? (protocolState?.blockedCode ?? null) : null;
  const reviewState = deriveReviewState(workflowState);
  const qaState = deriveQaState(workflowState, protocolState?.qaAgentId);
  const latestArtifactKinds = deriveLatestArtifactKinds(protocolMessages);

  const headline = buildHeadline(
    phase,
    subtaskSummary,
    pendingClarificationCount,
    blockedReason,
    reviewState,
    qaState,
  );

  return {
    phase,
    headline,
    activeOwnerRole,
    activeOwnerAgentId,
    blockedReason,
    pendingClarificationCount,
    subtaskSummary,
    reviewState,
    qaState,
    latestArtifactKinds,
  };
}

/**
 * Simplified snapshot computation for list views where protocol messages
 * are not available. Derives phase from issue status + work item summary only.
 */
export function computeSimplifiedIssueProgressSnapshot(input: {
  issue: { status: IssueStatus };
  internalWorkItemSummary: IssueInternalWorkItemSummary | null | undefined;
}): IssueProgressSnapshot {
  const { issue, internalWorkItemSummary } = input;
  const subtaskSummary = deriveSubtaskSummary(internalWorkItemSummary);

  let phase: IssueProgressPhase;
  switch (issue.status) {
    case "backlog":
    case "todo":
      phase = "intake";
      break;
    case "in_progress":
      phase = "implementing";
      break;
    case "in_review":
      phase = "review";
      break;
    case "blocked":
      phase = "blocked";
      break;
    case "done":
      phase = "done";
      break;
    case "cancelled":
      phase = "cancelled";
      break;
    default:
      phase = "intake";
  }

  const headline = buildHeadline(phase, subtaskSummary, 0, null, "idle", "not_required");

  return {
    phase,
    headline,
    activeOwnerRole: null,
    activeOwnerAgentId: null,
    blockedReason: null,
    pendingClarificationCount: 0,
    subtaskSummary,
    reviewState: "idle",
    qaState: "not_required",
    latestArtifactKinds: [],
  };
}
