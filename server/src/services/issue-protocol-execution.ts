import { and, eq } from "drizzle-orm";
import { issues, type Db } from "@squadrail/db";
import type { CreateIssueProtocolMessage } from "@squadrail/shared";
import { logActivity } from "./activity-log.js";
import { agentService } from "./agents.js";
import { heartbeatService } from "./heartbeat.js";

type ProtocolWakeSource = "assignment" | "automation";
type ProtocolDispatchKind = "wakeup" | "notify_only" | "skip_sender" | "skip_unsupported_adapter";

export interface ProtocolExecutionRecipientHint {
  recipientId: string;
  recipientRole: string;
  briefId?: string;
  briefScope?: string;
  retrievalRunId?: string;
  briefContentMarkdown?: string;
  briefEvidenceSummary?: Array<{
    rank?: number;
    sourceType?: string | null;
    authorityLevel?: string | null;
    path?: string | null;
    title?: string | null;
    symbolName?: string | null;
    fusedScore?: number | null;
  }>;
}

export interface ProtocolExecutionDispatchPlanItem {
  kind: ProtocolDispatchKind;
  recipientRole: string;
  recipientType: string;
  recipientId: string;
  reason: string;
  source: ProtocolWakeSource;
  contextSnapshot: Record<string, unknown>;
  payload: Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function protocolWakeHints(payload: Record<string, unknown>) {
  const hints: Record<string, unknown> = {};
  for (const key of ["timeoutCode", "reminderCode", "reviewCycle", "blockerCode", "decisionType"]) {
    if (payload[key] !== undefined) {
      hints[key] = payload[key];
    }
  }
  return hints;
}

function protocolExecutionReason(messageType: string) {
  switch (messageType) {
    case "ASSIGN_TASK":
      return "issue_assigned";
    case "REASSIGN_TASK":
      return "issue_reassigned";
    case "ACK_ASSIGNMENT":
      return "protocol_ack_assignment";
    case "ASK_CLARIFICATION":
      return "protocol_clarification_requested";
    case "PROPOSE_PLAN":
      return "protocol_plan_proposed";
    case "ESCALATE_BLOCKER":
      return "protocol_blocker_escalated";
    case "SUBMIT_FOR_REVIEW":
      return "protocol_review_requested";
    case "REQUEST_CHANGES":
      return "protocol_changes_requested";
    case "REQUEST_HUMAN_DECISION":
      return "protocol_human_decision_requested";
    case "APPROVE_IMPLEMENTATION":
      return "protocol_implementation_approved";
    case "SYSTEM_REMINDER":
      return "protocol_timeout_reminder";
    case "TIMEOUT_ESCALATION":
      return "protocol_timeout_escalation";
    default:
      return "protocol_message";
  }
}

function protocolExecutionSource(messageType: string): ProtocolWakeSource {
  if (messageType === "ASSIGN_TASK" || messageType === "REASSIGN_TASK") return "assignment";
  return "automation";
}

function shouldWakeRecipientForMessage(messageType: string, recipientRole: string) {
  if ((messageType === "ASSIGN_TASK" || messageType === "REASSIGN_TASK") && recipientRole === "reviewer") {
    return false;
  }
  return true;
}

export function shouldTransferActiveIssueExecution(input: {
  messageType: string;
  targetAgentId: string | null | undefined;
  activeRunAgentId: string | null | undefined;
  activeRunStatus: string | null | undefined;
}) {
  if (input.messageType !== "ASSIGN_TASK" && input.messageType !== "REASSIGN_TASK") return false;
  if (!input.targetAgentId || !input.activeRunAgentId || !input.activeRunStatus) return false;
  if (input.targetAgentId === input.activeRunAgentId) return false;
  return input.activeRunStatus === "running" || input.activeRunStatus === "queued";
}

export function buildProtocolExecutionDispatchPlan(input: {
  issueId: string;
  protocolMessageId: string;
  message: CreateIssueProtocolMessage;
  senderAgentId?: string | null;
  recipientHints?: ProtocolExecutionRecipientHint[];
}) {
  const reason = protocolExecutionReason(input.message.messageType);
  const source = protocolExecutionSource(input.message.messageType);
  const protocolPayload = asRecord(input.message.payload);
  const wakeHints = protocolWakeHints(protocolPayload);

  return input.message.recipients.map<ProtocolExecutionDispatchPlanItem>((recipient) => {
    const recipientHint = input.recipientHints?.find(
      (hint) => hint.recipientId === recipient.recipientId && hint.recipientRole === recipient.role,
    );
    const base = {
      recipientRole: recipient.role,
      recipientType: recipient.recipientType,
      recipientId: recipient.recipientId,
      reason,
      source,
      payload: {
        ...wakeHints,
        issueId: input.issueId,
        protocolMessageId: input.protocolMessageId,
        protocolMessageType: input.message.messageType,
        protocolWorkflowStateBefore: input.message.workflowStateBefore,
        protocolWorkflowStateAfter: input.message.workflowStateAfter,
        protocolSummary: input.message.summary,
        protocolPayload,
        ...(recipientHint?.briefId ? { latestBriefId: recipientHint.briefId } : {}),
        ...(recipientHint?.briefScope ? { latestBriefScope: recipientHint.briefScope } : {}),
        ...(recipientHint?.retrievalRunId ? { retrievalRunId: recipientHint.retrievalRunId } : {}),
        ...(recipientHint?.briefContentMarkdown || recipientHint?.briefEvidenceSummary?.length
          ? {
              taskBrief: {
                id: recipientHint?.briefId ?? null,
                scope: recipientHint?.briefScope ?? null,
                retrievalRunId: recipientHint?.retrievalRunId ?? null,
                contentMarkdown: recipientHint?.briefContentMarkdown ?? null,
                evidence: recipientHint?.briefEvidenceSummary ?? [],
              },
            }
          : {}),
      },
      contextSnapshot: {
        ...wakeHints,
        issueId: input.issueId,
        taskId: input.issueId,
        protocolMessageId: input.protocolMessageId,
        protocolMessageType: input.message.messageType,
        protocolWorkflowStateBefore: input.message.workflowStateBefore,
        protocolWorkflowStateAfter: input.message.workflowStateAfter,
        protocolSummary: input.message.summary,
        wakeReason: reason,
        source: "issue.protocol",
        protocolRecipientRole: recipient.role,
        protocolSenderRole: input.message.sender.role,
        protocolPayload,
        ...(recipientHint?.briefId ? { latestBriefId: recipientHint.briefId } : {}),
        ...(recipientHint?.briefScope ? { latestBriefScope: recipientHint.briefScope } : {}),
        ...(recipientHint?.retrievalRunId ? { retrievalRunId: recipientHint.retrievalRunId } : {}),
        ...(recipientHint?.briefContentMarkdown || recipientHint?.briefEvidenceSummary?.length
          ? {
              taskBrief: {
                id: recipientHint?.briefId ?? null,
                scope: recipientHint?.briefScope ?? null,
                retrievalRunId: recipientHint?.retrievalRunId ?? null,
                contentMarkdown: recipientHint?.briefContentMarkdown ?? null,
                evidence: recipientHint?.briefEvidenceSummary ?? [],
              },
            }
          : {}),
      },
    };

    if (recipient.recipientType !== "agent") {
      return { kind: "notify_only", ...base };
    }

    if (!shouldWakeRecipientForMessage(input.message.messageType, recipient.role)) {
      return { kind: "notify_only", ...base };
    }

    if (input.senderAgentId && recipient.recipientId === input.senderAgentId) {
      return { kind: "skip_sender", ...base };
    }

    return { kind: "wakeup", ...base };
  });
}

export function issueProtocolExecutionService(db: Db) {
  const heartbeat = heartbeatService(db);
  const agents = agentService(db);

  return {
    dispatchMessage: async (input: {
      issueId: string;
      companyId: string;
      protocolMessageId: string;
      message: CreateIssueProtocolMessage;
      recipientHints?: ProtocolExecutionRecipientHint[];
      actor: {
        actorType: "agent" | "user" | "system";
        actorId: string;
        agentId: string | null;
        runId: string | null;
      };
    }) => {
      const plan = buildProtocolExecutionDispatchPlan({
        issueId: input.issueId,
        protocolMessageId: input.protocolMessageId,
        message: input.message,
        senderAgentId: input.actor.agentId,
        recipientHints: input.recipientHints,
      });

      const primaryWakeRecipient = plan.find(
        (item) => item.kind === "wakeup" && item.recipientType === "agent",
      );

      if (primaryWakeRecipient) {
        const issueExecutionState = await db
          .select({
            executionRunId: issues.executionRunId,
          })
          .from(issues)
          .where(and(eq(issues.id, input.issueId), eq(issues.companyId, input.companyId)))
          .limit(1)
          .then((rows) => rows[0] ?? null);

        if (issueExecutionState?.executionRunId) {
          const activeRun = await heartbeat.getRun(issueExecutionState.executionRunId);
          if (
            activeRun &&
            shouldTransferActiveIssueExecution({
              messageType: input.message.messageType,
              targetAgentId: primaryWakeRecipient.recipientId,
              activeRunAgentId: activeRun.agentId,
              activeRunStatus: activeRun.status,
            })
          ) {
            await heartbeat.cancelRun(activeRun.id);
            await logActivity(db, {
              companyId: input.companyId,
              actorType: input.actor.actorType,
              actorId: input.actor.actorId,
              agentId: input.actor.agentId,
              runId: input.actor.runId,
              action: "issue.protocol_dispatch.execution_transferred",
              entityType: "issue",
              entityId: input.issueId,
              details: {
                protocolMessageId: input.protocolMessageId,
                protocolMessageType: input.message.messageType,
                fromAgentId: activeRun.agentId,
                toAgentId: primaryWakeRecipient.recipientId,
                cancelledRunId: activeRun.id,
              },
            });
          }
        }
      }

      let queued = 0;
      let notifyOnly = 0;
      let skipped = 0;

      for (const item of plan) {
        if (item.kind === "notify_only") {
          notifyOnly += 1;
          continue;
        }
        if (item.kind === "skip_sender") {
          skipped += 1;
          continue;
        }

        const recipientAgent = await agents.getById(item.recipientId);
        if (!recipientAgent) {
          skipped += 1;
          continue;
        }

        if (recipientAgent.adapterType !== "claude_local" && recipientAgent.adapterType !== "codex_local") {
          skipped += 1;
          await logActivity(db, {
            companyId: input.companyId,
            actorType: input.actor.actorType,
            actorId: input.actor.actorId,
            agentId: input.actor.agentId,
            runId: input.actor.runId,
            action: "issue.protocol_dispatch.skipped_unsupported_adapter",
            entityType: "issue",
            entityId: input.issueId,
            details: {
              protocolMessageId: input.protocolMessageId,
              protocolMessageType: input.message.messageType,
              recipientAgentId: recipientAgent.id,
              recipientAdapterType: recipientAgent.adapterType,
            },
          });
          continue;
        }

        await heartbeat.wakeup(recipientAgent.id, {
          source: item.source,
          triggerDetail: "system",
          reason: item.reason,
          payload: item.payload,
          requestedByActorType: input.actor.actorType,
          requestedByActorId: input.actor.actorId,
          contextSnapshot: item.contextSnapshot,
        });
        queued += 1;
      }

      return {
        queued,
        notifyOnly,
        skipped,
      };
    },
  };
}
