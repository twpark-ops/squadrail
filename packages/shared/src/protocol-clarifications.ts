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
  ackedAt?: Date | string | null;
  createdAt: Date | string;
  workflowStateAfter?: IssueProtocolWorkflowState | null;
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

export interface ResolvedHumanClarification {
  questionMessageId: string;
  answerMessageId: string;
  questionType: IssueProtocolClarificationType;
  question: string;
  answer: string;
  nextStep: string | null;
  blocking: boolean;
  askedByActorType: Exclude<IssueProtocolActorType, "system">;
  askedByActorId: string;
  askedByRole: Exclude<IssueProtocolRole, "system">;
  answeredByActorType: Exclude<IssueProtocolActorType, "system">;
  answeredByActorId: string;
  answeredByRole: Exclude<IssueProtocolRole, "system">;
  answeredAt: Date;
  resumeWorkflowState: IssueProtocolWorkflowState | null;
}

function readClarificationType(value: unknown): IssueProtocolClarificationType {
  return ISSUE_PROTOCOL_CLARIFICATION_TYPES.includes(value as IssueProtocolClarificationType)
    ? (value as IssueProtocolClarificationType)
    : "requirement";
}

function normalizeDate(value: Date | string | null | undefined) {
  if (!value) return new Date(0);
  return value instanceof Date ? value : new Date(value);
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
        createdAt: normalizeDate(message.createdAt),
        resumeWorkflowState: readWorkflowState(payload.resumeWorkflowState),
      } satisfies PendingHumanClarification];
    })
    .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
}

export function deriveLatestHumanClarificationResolution(
  messages: ProtocolClarificationMessageLike[],
): ResolvedHumanClarification | null {
  const asks = new Map<string, PendingHumanClarification>();

  for (const message of messages) {
    if (message.messageType !== "ASK_CLARIFICATION") continue;
    const payload = (message.payload ?? {}) as Record<string, unknown>;
    if (payload.requestedFrom !== "human_board") continue;
    if (message.sender.actorType === "system" || message.sender.role === "system") continue;
    asks.set(message.id, {
      questionMessageId: message.id,
      questionType: readClarificationType(payload.questionType),
      question: typeof payload.question === "string" && payload.question.trim().length > 0
        ? payload.question.trim()
        : "Clarification requested.",
      blocking: payload.blocking === true,
      askedByActorType: message.sender.actorType as Exclude<IssueProtocolActorType, "system">,
      askedByActorId: message.sender.actorId,
      askedByRole: message.sender.role as Exclude<IssueProtocolRole, "system">,
      createdAt: normalizeDate(message.createdAt),
      resumeWorkflowState: readWorkflowState(payload.resumeWorkflowState),
    });
  }

  return [...messages]
    .sort((left, right) => normalizeDate(right.createdAt).getTime() - normalizeDate(left.createdAt).getTime())
    .flatMap((message) => {
      if (message.messageType !== "ANSWER_CLARIFICATION") return [];
      if (!message.causalMessageId) return [];
      if (message.sender.actorType === "system" || message.sender.role === "system") return [];
      const question = asks.get(message.causalMessageId);
      if (!question) return [];
      const payload = (message.payload ?? {}) as Record<string, unknown>;
      const answer = typeof payload.answer === "string" && payload.answer.trim().length > 0
        ? payload.answer.trim()
        : "Clarification answered.";
      const nextStep = typeof payload.nextStep === "string" && payload.nextStep.trim().length > 0
        ? payload.nextStep.trim()
        : null;
      return [{
        questionMessageId: question.questionMessageId,
        answerMessageId: message.id,
        questionType: question.questionType,
        question: question.question,
        answer,
        nextStep,
        blocking: question.blocking,
        askedByActorType: question.askedByActorType,
        askedByActorId: question.askedByActorId,
        askedByRole: question.askedByRole,
        answeredByActorType: message.sender.actorType as Exclude<IssueProtocolActorType, "system">,
        answeredByActorId: message.sender.actorId,
        answeredByRole: message.sender.role as Exclude<IssueProtocolRole, "system">,
        answeredAt: normalizeDate(message.createdAt),
        resumeWorkflowState: readWorkflowState(message.workflowStateAfter) ?? question.resumeWorkflowState,
      } satisfies ResolvedHumanClarification];
    })[0] ?? null;
}
