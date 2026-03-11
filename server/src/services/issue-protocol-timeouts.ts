import { desc, inArray } from "drizzle-orm";
import type { Db } from "@squadrail/db";
import { issueProtocolMessages, issueProtocolState } from "@squadrail/db";
import type {
  IssueProtocolParticipantRole,
  IssueProtocolRole,
  IssueProtocolTimeoutCode,
  IssueProtocolWorkflowState,
} from "@squadrail/shared";
import { logActivity } from "./activity-log.js";
import { logger } from "../middleware/logger.js";
import { issueProtocolExecutionService } from "./issue-protocol-execution.js";
import { issueProtocolService } from "./issue-protocol.js";

const WORKER_ACTOR_ID = "issue_protocol_timeout_worker";
const MS = {
  minute: 60 * 1000,
  hour: 60 * 60 * 1000,
} as const;

type Recipient = {
  recipientType: "agent" | "role_group";
  recipientId: string;
  role: IssueProtocolParticipantRole;
};

type TimeoutRule = {
  timeoutCode: IssueProtocolTimeoutCode;
  states: IssueProtocolWorkflowState[];
  reminderAfterMs: number;
  escalationAfterMs: number;
  reminderRole: IssueProtocolParticipantRole;
  escalationRole: IssueProtocolParticipantRole;
  baselineMessageTypes?: string[];
};

const TIMEOUT_RULES: TimeoutRule[] = [
  {
    timeoutCode: "assignment_ack_timeout",
    states: ["assigned"],
    reminderAfterMs: 30 * MS.minute,
    escalationAfterMs: 2 * MS.hour,
    reminderRole: "engineer",
    escalationRole: "tech_lead",
  },
  {
    timeoutCode: "plan_start_timeout",
    states: ["accepted", "planning"],
    reminderAfterMs: 2 * MS.hour,
    escalationAfterMs: 6 * MS.hour,
    reminderRole: "engineer",
    escalationRole: "tech_lead",
    baselineMessageTypes: ["ACK_ASSIGNMENT", "PROPOSE_PLAN"],
  },
  {
    timeoutCode: "progress_stale",
    states: ["implementing"],
    reminderAfterMs: 4 * MS.hour,
    escalationAfterMs: 12 * MS.hour,
    reminderRole: "engineer",
    escalationRole: "tech_lead",
    baselineMessageTypes: ["START_IMPLEMENTATION", "ACK_CHANGE_REQUEST", "REPORT_PROGRESS"],
  },
  {
    timeoutCode: "review_start_timeout",
    states: ["submitted_for_review"],
    reminderAfterMs: 2 * MS.hour,
    escalationAfterMs: 6 * MS.hour,
    reminderRole: "reviewer",
    escalationRole: "tech_lead",
    baselineMessageTypes: ["SUBMIT_FOR_REVIEW"],
  },
  {
    timeoutCode: "review_start_timeout",
    states: ["qa_pending"],
    reminderAfterMs: 2 * MS.hour,
    escalationAfterMs: 6 * MS.hour,
    reminderRole: "qa",
    escalationRole: "tech_lead",
    baselineMessageTypes: ["APPROVE_IMPLEMENTATION"],
  },
  {
    timeoutCode: "review_decision_timeout",
    states: ["under_review"],
    reminderAfterMs: 4 * MS.hour,
    escalationAfterMs: 12 * MS.hour,
    reminderRole: "reviewer",
    escalationRole: "tech_lead",
    baselineMessageTypes: ["START_REVIEW"],
  },
  {
    timeoutCode: "review_decision_timeout",
    states: ["under_qa_review"],
    reminderAfterMs: 4 * MS.hour,
    escalationAfterMs: 12 * MS.hour,
    reminderRole: "qa",
    escalationRole: "tech_lead",
    baselineMessageTypes: ["START_REVIEW"],
  },
  {
    timeoutCode: "changes_ack_timeout",
    states: ["changes_requested"],
    reminderAfterMs: 2 * MS.hour,
    escalationAfterMs: 8 * MS.hour,
    reminderRole: "engineer",
    escalationRole: "tech_lead",
    baselineMessageTypes: ["REQUEST_CHANGES"],
  },
  {
    timeoutCode: "blocked_resolution_timeout",
    states: ["blocked"],
    reminderAfterMs: 2 * MS.hour,
    escalationAfterMs: 8 * MS.hour,
    reminderRole: "tech_lead",
    escalationRole: "human_board",
    baselineMessageTypes: ["ESCALATE_BLOCKER"],
  },
  {
    timeoutCode: "close_timeout",
    states: ["approved"],
    reminderAfterMs: 4 * MS.hour,
    escalationAfterMs: 24 * MS.hour,
    reminderRole: "tech_lead",
    escalationRole: "human_board",
    baselineMessageTypes: ["APPROVE_IMPLEMENTATION"],
  },
  {
    timeoutCode: "human_decision_timeout",
    states: ["awaiting_human_decision"],
    reminderAfterMs: 8 * MS.hour,
    escalationAfterMs: 24 * MS.hour,
    reminderRole: "human_board",
    escalationRole: "human_board",
    baselineMessageTypes: ["REQUEST_HUMAN_DECISION"],
  },
];

export function resolveTimeoutRulesForState(workflowState: IssueProtocolWorkflowState) {
  return TIMEOUT_RULES.filter((rule) => rule.states.includes(workflowState));
}

function resolveRecipient(
  state: typeof issueProtocolState.$inferSelect,
  role: IssueProtocolParticipantRole,
): Recipient | null {
  if (role === "engineer" && state.primaryEngineerAgentId) {
    return { recipientType: "agent", recipientId: state.primaryEngineerAgentId, role };
  }
  if (role === "reviewer" && state.reviewerAgentId) {
    return { recipientType: "agent", recipientId: state.reviewerAgentId, role };
  }
  if (role === "qa" && state.qaAgentId) {
    return { recipientType: "agent", recipientId: state.qaAgentId, role };
  }
  if (role === "tech_lead" && state.techLeadAgentId) {
    return { recipientType: "agent", recipientId: state.techLeadAgentId, role };
  }
  if (role === "human_board") {
    return { recipientType: "role_group", recipientId: "human_board", role };
  }
  return null;
}

function hasSystemMessageSince(
  messages: Array<typeof issueProtocolMessages.$inferSelect>,
  opts: {
    messageType: "SYSTEM_REMINDER" | "TIMEOUT_ESCALATION";
    codeField: "reminderCode" | "timeoutCode";
    code: IssueProtocolTimeoutCode;
    since: Date;
  },
) {
  return messages.some((message) => {
    if (message.messageType !== opts.messageType) return false;
    if (message.createdAt < opts.since) return false;
    const payload = message.payload as Record<string, unknown> | null;
    return payload?.[opts.codeField] === opts.code;
  });
}

function latestRelevantTimestamp(
  state: typeof issueProtocolState.$inferSelect,
  messages: Array<typeof issueProtocolMessages.$inferSelect>,
  rule: TimeoutRule,
) {
  if (!rule.baselineMessageTypes || rule.baselineMessageTypes.length === 0) {
    return state.lastTransitionAt;
  }

  const latestMessage = messages
    .filter((message) => rule.baselineMessageTypes?.includes(message.messageType))
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0];

  if (!latestMessage) return state.lastTransitionAt;
  return latestMessage.createdAt > state.lastTransitionAt ? latestMessage.createdAt : state.lastTransitionAt;
}

export function issueProtocolTimeoutService(db: Db) {
  const protocol = issueProtocolService(db);
  const execution = issueProtocolExecutionService(db);

  async function appendAndDispatchSystemMessage(input: {
    issueId: string;
    companyId: string;
    message: Parameters<typeof protocol.appendMessage>[0]["message"];
  }) {
    const result = await protocol.appendMessage({
      issueId: input.issueId,
      mirrorToComments: false,
      message: input.message,
    });

    try {
      await execution.dispatchMessage({
        issueId: input.issueId,
        companyId: input.companyId,
        protocolMessageId: result.message.id,
        message: input.message,
        actor: {
          actorType: "system",
          actorId: WORKER_ACTOR_ID,
          agentId: null,
          runId: null,
        },
      });
    } catch (err) {
      logger.warn(
        { err, issueId: input.issueId, protocolMessageType: input.message.messageType },
        "failed to dispatch timeout protocol execution wakeups",
      );
    }

    return result;
  }

  return {
    tick: async (now: Date) => {
      const candidateStates = await db
        .select()
        .from(issueProtocolState)
        .where(inArray(issueProtocolState.workflowState, TIMEOUT_RULES.flatMap((rule) => rule.states)));

      const issueIds = candidateStates.map((state) => state.issueId);
      const messages = issueIds.length === 0
        ? []
        : await db
            .select()
            .from(issueProtocolMessages)
            .where(inArray(issueProtocolMessages.issueId, issueIds))
            .orderBy(desc(issueProtocolMessages.createdAt));

      const messagesByIssueId = new Map<string, Array<typeof issueProtocolMessages.$inferSelect>>();
      for (const message of messages) {
        const existing = messagesByIssueId.get(message.issueId) ?? [];
        existing.push(message);
        messagesByIssueId.set(message.issueId, existing);
      }

      let remindersSent = 0;
      let escalationsSent = 0;

      for (const state of candidateStates) {
        const stateMessages = messagesByIssueId.get(state.issueId) ?? [];
        const applicableRules = resolveTimeoutRulesForState(state.workflowState as IssueProtocolWorkflowState);

        for (const rule of applicableRules) {
          const baselineAt = latestRelevantTimestamp(state, stateMessages, rule);
          const elapsedMs = now.getTime() - baselineAt.getTime();
          const reminderRecipient = resolveRecipient(state, rule.reminderRole);
          const escalationRecipient = resolveRecipient(state, rule.escalationRole);

          const reminderExists = hasSystemMessageSince(stateMessages, {
            messageType: "SYSTEM_REMINDER",
            codeField: "reminderCode",
            code: rule.timeoutCode,
            since: baselineAt,
          });
          const escalationExists = hasSystemMessageSince(stateMessages, {
            messageType: "TIMEOUT_ESCALATION",
            codeField: "timeoutCode",
            code: rule.timeoutCode,
            since: baselineAt,
          });

          const shouldSendEscalation = !escalationExists && escalationRecipient && elapsedMs >= rule.escalationAfterMs;
          const shouldSendReminder =
            !shouldSendEscalation && !reminderExists && reminderRecipient && elapsedMs >= rule.reminderAfterMs;

          if (shouldSendReminder) {
            await appendAndDispatchSystemMessage({
              issueId: state.issueId,
              companyId: state.companyId,
              message: {
                messageType: "SYSTEM_REMINDER",
                sender: {
                  actorType: "system",
                  actorId: WORKER_ACTOR_ID,
                  role: "system",
                },
                recipients: [reminderRecipient],
                workflowStateBefore: state.workflowState as IssueProtocolWorkflowState,
                workflowStateAfter: state.workflowState as IssueProtocolWorkflowState,
                summary: `Timeout reminder: ${rule.timeoutCode}`,
                payload: {
                  reminderCode: rule.timeoutCode,
                  reminderMessage: `Timeout reminder for ${rule.timeoutCode}`,
                  dueAt: baselineAt.toISOString(),
                },
                artifacts: [],
                requiresAck: false,
              },
            });

            await logActivity(db, {
              companyId: state.companyId,
              actorType: "system",
              actorId: WORKER_ACTOR_ID,
              action: "issue.protocol_timeout.reminder",
              entityType: "issue",
              entityId: state.issueId,
              details: {
                timeoutCode: rule.timeoutCode,
                workflowState: state.workflowState,
                recipientRole: reminderRecipient.role,
                recipientId: reminderRecipient.recipientId,
              },
            });
            remindersSent += 1;
          }

          if (shouldSendEscalation) {
            await appendAndDispatchSystemMessage({
              issueId: state.issueId,
              companyId: state.companyId,
              message: {
                messageType: "TIMEOUT_ESCALATION",
                sender: {
                  actorType: "system",
                  actorId: WORKER_ACTOR_ID,
                  role: "system",
                },
                recipients: [escalationRecipient],
                workflowStateBefore: state.workflowState as IssueProtocolWorkflowState,
                workflowStateAfter: state.workflowState as IssueProtocolWorkflowState,
                summary: `Timeout escalation: ${rule.timeoutCode}`,
                payload: {
                  timeoutCode: rule.timeoutCode,
                  expiredActorRole: rule.reminderRole,
                  nextEscalationTarget: rule.escalationRole as IssueProtocolRole,
                },
                artifacts: [],
                requiresAck: false,
              },
            });

            await logActivity(db, {
              companyId: state.companyId,
              actorType: "system",
              actorId: WORKER_ACTOR_ID,
              action: "issue.protocol_timeout.escalated",
              entityType: "issue",
              entityId: state.issueId,
              details: {
                timeoutCode: rule.timeoutCode,
                workflowState: state.workflowState,
                recipientRole: escalationRecipient.role,
                recipientId: escalationRecipient.recipientId,
              },
            });
            escalationsSent += 1;
          }
        }
      }

      return {
        scanned: candidateStates.length,
        remindersSent,
        escalationsSent,
      };
    },
  };
}
