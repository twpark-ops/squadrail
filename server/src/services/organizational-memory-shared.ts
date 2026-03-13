import type { IssueProtocolMessageType } from "@squadrail/shared";

export const ORGANIZATIONAL_MEMORY_REVIEW_MESSAGE_TYPES = [
  "SUBMIT_FOR_REVIEW",
  "REQUEST_CHANGES",
  "APPROVE_IMPLEMENTATION",
] as const satisfies IssueProtocolMessageType[];

export const ORGANIZATIONAL_MEMORY_PROTOCOL_MESSAGE_TYPES = [
  "ASSIGN_TASK",
  "REASSIGN_TASK",
  "ASK_CLARIFICATION",
  "ANSWER_CLARIFICATION",
  "PROPOSE_PLAN",
  "ESCALATE_BLOCKER",
  "REQUEST_HUMAN_DECISION",
  "CLOSE_TASK",
  "CANCEL_TASK",
  "TIMEOUT_ESCALATION",
] as const satisfies IssueProtocolMessageType[];

const REVIEW_MESSAGE_TYPE_SET = new Set<IssueProtocolMessageType>(ORGANIZATIONAL_MEMORY_REVIEW_MESSAGE_TYPES);
const PROTOCOL_MESSAGE_TYPE_SET = new Set<IssueProtocolMessageType>(ORGANIZATIONAL_MEMORY_PROTOCOL_MESSAGE_TYPES);

export function deriveOrganizationalMemorySourceType(messageType: IssueProtocolMessageType) {
  if (REVIEW_MESSAGE_TYPE_SET.has(messageType)) return "review" as const;
  if (PROTOCOL_MESSAGE_TYPE_SET.has(messageType)) return "protocol_message" as const;
  return null;
}

export function isOrganizationalMemoryMessageType(messageType: IssueProtocolMessageType) {
  return deriveOrganizationalMemorySourceType(messageType) != null;
}
