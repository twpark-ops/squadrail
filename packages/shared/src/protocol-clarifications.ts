import {
  ISSUE_PROTOCOL_CLARIFICATION_TYPES,
  ISSUE_PROTOCOL_WORKFLOW_STATES,
  type IssueProtocolActorType,
  type IssueProtocolBlockedPhase,
  type IssueProtocolClarificationType,
  type IssueProtocolMessageType,
  type IssueProtocolRole,
  type IssueProtocolWorkflowState,
} from "./constants.js";

export interface ProtocolClarificationMessageLike {
  id: string;
  messageType: IssueProtocolMessageType;
  causalMessageId?: string | null;
  ackedAt?: Date | null;
  createdAt: Date;
  payload?: Record<string, unknown> | null;
  sender: {
    actorType: IssueProtocolActorType;
    actorId: string;
    role: IssueProtocolRole;
  };
}

export interface PendingHumanClarification {
  questionMessageId: string;
  questionType: IssueProtocolClarificationType;
  question: string;
  blocking: boolean;
  askedByActorType: Exclude<IssueProtocolActorType, "system">;
  askedByActorId: string;
  askedByRole: Exclude<IssueProtocolRole, "system">;
  createdAt: Date;
  resumeWorkflowState: IssueProtocolWorkflowState | null;
}

function readClarificationType(value: unknown): IssueProtocolClarificationType {
  return ISSUE_PROTOCOL_CLARIFICATION_TYPES.includes(value as IssueProtocolClarificationType)
    ? (value as IssueProtocolClarificationType)
    : "requirement";
}

function readWorkflowState(value: unknown): IssueProtocolWorkflowState | null {
  return ISSUE_PROTOCOL_WORKFLOW_STATES.includes(value as IssueProtocolWorkflowState)
    ? (value as IssueProtocolWorkflowState)
    : null;
}

export function resolveClarificationResumeWorkflowState(input: {
  currentWorkflowState: IssueProtocolWorkflowState;
  blockedPhase?: IssueProtocolBlockedPhase | null;
  explicitResumeWorkflowState?: IssueProtocolWorkflowState | null;
  askedByRole?: IssueProtocolRole | null;
}): IssueProtocolWorkflowState {
  if (input.explicitResumeWorkflowState) {
    return input.explicitResumeWorkflowState;
  }

  if (input.currentWorkflowState === "blocked") {
    switch (input.blockedPhase) {
      case "assignment":
        return "assigned";
      case "planning":
        return "planning";
      case "implementing":
        return "implementing";
      case "review":
        return input.askedByRole === "qa" ? "under_qa_review" : "under_review";
      case "closing":
        return "approved";
      default:
        return "implementing";
    }
  }

  if (input.currentWorkflowState === "awaiting_human_decision") {
    return input.askedByRole === "qa" ? "under_qa_review" : "under_review";
  }

  return input.currentWorkflowState;
}

export function derivePendingHumanClarifications(
  messages: ProtocolClarificationMessageLike[],
): PendingHumanClarification[] {
  const answeredIds = new Set<string>();

  for (const message of messages) {
    if (message.messageType !== "ANSWER_CLARIFICATION" || !message.causalMessageId) continue;
    answeredIds.add(message.causalMessageId);
  }

  return messages
    .flatMap((message) => {
      if (message.messageType !== "ASK_CLARIFICATION") return [];
      if (message.ackedAt || answeredIds.has(message.id)) return [];
      const payload = (message.payload ?? {}) as Record<string, unknown>;
      if (payload.requestedFrom !== "human_board") return [];
      if (message.sender.actorType === "system" || message.sender.role === "system") return [];

      return [{
        questionMessageId: message.id,
        questionType: readClarificationType(payload.questionType),
        question: typeof payload.question === "string" && payload.question.trim().length > 0
          ? payload.question.trim()
          : "Clarification requested.",
        blocking: payload.blocking === true,
        askedByActorType: message.sender.actorType as Exclude<IssueProtocolActorType, "system">,
        askedByActorId: message.sender.actorId,
        askedByRole: message.sender.role as Exclude<IssueProtocolRole, "system">,
        createdAt: message.createdAt,
        resumeWorkflowState: readWorkflowState(payload.resumeWorkflowState),
      } satisfies PendingHumanClarification];
    })
    .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
}
