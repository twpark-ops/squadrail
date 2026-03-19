import type {
  IssueProtocolMessageType,
  IssueProtocolParticipantRole,
} from "./constants.js";

export interface ProtocolRunRequirement {
  key:
    | "assignment_engineer"
    | "assignment_supervisor"
    | "reassignment_engineer"
    | "reassignment_supervisor"
    | "implementation_engineer"
    | "change_request_engineer"
    | "review_reviewer"
    | "qa_gate_reviewer"
    | "approval_tech_lead";
  protocolMessageType: IssueProtocolMessageType;
  recipientRole: IssueProtocolParticipantRole;
  requiredMessageTypes: IssueProtocolMessageType[];
  firstActionMessageTypes: IssueProtocolMessageType[];
  intermediateMessageTypes: IssueProtocolMessageType[];
  description: string;
}

function normalizeMessageType(value: string | null | undefined): IssueProtocolMessageType | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim() as IssueProtocolMessageType
    : null;
}

function normalizeRecipientRole(value: string | null | undefined): IssueProtocolParticipantRole | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim() as IssueProtocolParticipantRole
    : null;
}

export function resolveProtocolRunRequirement(input: {
  protocolMessageType?: string | null;
  protocolRecipientRole?: string | null;
}): ProtocolRunRequirement | null {
  const protocolMessageType = normalizeMessageType(input.protocolMessageType);
  const recipientRole = normalizeRecipientRole(input.protocolRecipientRole);

  if (!protocolMessageType || !recipientRole) return null;

  if (protocolMessageType === "ASSIGN_TASK" && recipientRole === "engineer") {
    return {
      key: "assignment_engineer",
      protocolMessageType,
      recipientRole,
      requiredMessageTypes: ["ACK_ASSIGNMENT", "ASK_CLARIFICATION", "ESCALATE_BLOCKER", "START_IMPLEMENTATION"],
      firstActionMessageTypes: ["ACK_ASSIGNMENT", "ASK_CLARIFICATION", "ESCALATE_BLOCKER"],
      intermediateMessageTypes: ["ACK_ASSIGNMENT"],
      description: "assignment acceptance or escalation",
    };
  }

  if (
    protocolMessageType === "ASSIGN_TASK"
    && (recipientRole === "tech_lead" || recipientRole === "pm" || recipientRole === "cto")
  ) {
    return {
      key: "assignment_supervisor",
      protocolMessageType,
      recipientRole,
      requiredMessageTypes: ["REASSIGN_TASK", "ASK_CLARIFICATION", "ESCALATE_BLOCKER"],
      firstActionMessageTypes: ["REASSIGN_TASK", "ASK_CLARIFICATION", "ESCALATE_BLOCKER"],
      intermediateMessageTypes: [],
      description: "routing, clarification, or escalation",
    };
  }

  if (protocolMessageType === "REASSIGN_TASK" && recipientRole === "engineer") {
    return {
      key: "reassignment_engineer",
      protocolMessageType,
      recipientRole,
      requiredMessageTypes: ["ACK_ASSIGNMENT", "ASK_CLARIFICATION", "ESCALATE_BLOCKER", "START_IMPLEMENTATION"],
      firstActionMessageTypes: ["ACK_ASSIGNMENT", "ASK_CLARIFICATION", "ESCALATE_BLOCKER"],
      intermediateMessageTypes: ["ACK_ASSIGNMENT"],
      description: "reassignment acceptance or escalation",
    };
  }

  if (
    protocolMessageType === "REASSIGN_TASK"
    && (recipientRole === "tech_lead" || recipientRole === "pm" || recipientRole === "cto")
  ) {
    return {
      key: "reassignment_supervisor",
      protocolMessageType,
      recipientRole,
      requiredMessageTypes: ["REASSIGN_TASK", "ASK_CLARIFICATION", "ESCALATE_BLOCKER"],
      firstActionMessageTypes: ["REASSIGN_TASK", "ASK_CLARIFICATION", "ESCALATE_BLOCKER"],
      intermediateMessageTypes: [],
      description: "re-routing, clarification, or escalation",
    };
  }

  if (protocolMessageType === "START_IMPLEMENTATION" && recipientRole === "engineer") {
    return {
      key: "implementation_engineer",
      protocolMessageType,
      recipientRole,
      requiredMessageTypes: ["SUBMIT_FOR_REVIEW", "REPORT_PROGRESS", "ASK_CLARIFICATION", "ESCALATE_BLOCKER"],
      firstActionMessageTypes: ["SUBMIT_FOR_REVIEW", "REPORT_PROGRESS", "ASK_CLARIFICATION", "ESCALATE_BLOCKER"],
      intermediateMessageTypes: [],
      description: "implementation progress or review handoff",
    };
  }

  if (protocolMessageType === "REQUEST_CHANGES" && recipientRole === "engineer") {
    return {
      key: "change_request_engineer",
      protocolMessageType,
      recipientRole,
      requiredMessageTypes: ["ACK_CHANGE_REQUEST", "SUBMIT_FOR_REVIEW", "ASK_CLARIFICATION", "ESCALATE_BLOCKER"],
      firstActionMessageTypes: ["ACK_CHANGE_REQUEST", "ASK_CLARIFICATION", "ESCALATE_BLOCKER"],
      intermediateMessageTypes: ["ACK_CHANGE_REQUEST"],
      description: "change-request acknowledgement or escalation",
    };
  }

  if (protocolMessageType === "SUBMIT_FOR_REVIEW" && recipientRole === "reviewer") {
    return {
      key: "review_reviewer",
      protocolMessageType,
      recipientRole,
      requiredMessageTypes: ["START_REVIEW", "APPROVE_IMPLEMENTATION", "REQUEST_CHANGES", "REQUEST_HUMAN_DECISION"],
      firstActionMessageTypes: ["START_REVIEW", "REQUEST_CHANGES", "REQUEST_HUMAN_DECISION"],
      intermediateMessageTypes: ["START_REVIEW"],
      description: "review start or review decision",
    };
  }

  if (protocolMessageType === "APPROVE_IMPLEMENTATION" && recipientRole === "qa") {
    return {
      key: "qa_gate_reviewer",
      protocolMessageType,
      recipientRole,
      requiredMessageTypes: ["START_REVIEW", "APPROVE_IMPLEMENTATION", "REQUEST_CHANGES", "REQUEST_HUMAN_DECISION"],
      firstActionMessageTypes: ["START_REVIEW"],
      intermediateMessageTypes: ["START_REVIEW"],
      description: "QA gate review start and decision",
    };
  }

  if (protocolMessageType === "APPROVE_IMPLEMENTATION" && recipientRole === "tech_lead") {
    return {
      key: "approval_tech_lead",
      protocolMessageType,
      recipientRole,
      requiredMessageTypes: ["CLOSE_TASK", "REQUEST_HUMAN_DECISION"],
      firstActionMessageTypes: ["CLOSE_TASK", "REQUEST_HUMAN_DECISION"],
      intermediateMessageTypes: [],
      description: "closing decision",
    };
  }

  return null;
}
