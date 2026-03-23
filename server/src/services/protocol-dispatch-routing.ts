import { and, eq } from "drizzle-orm";
import { agents, issueProtocolState, projects, type Db } from "@squadrail/db";
import type { CreateIssueProtocolMessage } from "@squadrail/shared";
import { loadConfig } from "../config.js";
import { logActivity } from "./activity-log.js";
import { selectPreferredEngineerAgentId } from "./issue-protocol-auto-assist.js";

function readNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function shouldDispatchBeforeProtocolRetrieval(message: CreateIssueProtocolMessage) {
  if (loadConfig().deploymentMode !== "local_trusted") return false;
  if (message.messageType !== "ASSIGN_TASK" && message.messageType !== "REASSIGN_TASK") return false;
  return message.recipients.some(
    (recipient) =>
      recipient.recipientType === "agent"
      && (recipient.role === "tech_lead" || recipient.role === "pm" || recipient.role === "cto"),
  );
}

export function resolvePreRetrievalAutoAssistRecipient(message: CreateIssueProtocolMessage) {
  if (!shouldDispatchBeforeProtocolRetrieval(message)) return null;
  return message.recipients.find(
    (recipient) =>
      recipient.recipientType === "agent"
      && (recipient.role === "tech_lead" || recipient.role === "pm" || recipient.role === "cto"),
  ) ?? null;
}

export async function maybeApplyPreRetrievalSupervisorReroute(input: {
  db: Db;
  protocolSvc: {
    appendMessage: (input: {
      issueId: string;
      message: CreateIssueProtocolMessage;
      mirrorToComments?: boolean;
      authorAgentId?: string | null;
      authorUserId?: string | null;
    }) => Promise<{ message: { id: string; seq: number } }>;
  };
  issue: { id: string; companyId: string; projectId: string | null };
  protocolMessageId: string;
  message: CreateIssueProtocolMessage;
}): Promise<{
  rerouteMessage: CreateIssueProtocolMessage;
  rerouteProtocolMessageId: string;
  rerouteProtocolMessageSeq: number;
  actor: {
    actorType: "agent";
    actorId: string;
    agentId: string;
    runId: null;
  };
} | null> {
  const supervisoryRecipient = resolvePreRetrievalAutoAssistRecipient(input.message);
  if (!supervisoryRecipient || supervisoryRecipient.role !== "tech_lead") return null;
  if (typeof (input.db as { select?: unknown }).select !== "function") return null;

  const [project, state, engineerCandidates] = await Promise.all([
    input.issue.projectId
      ? input.db
          .select({
            leadAgentId: projects.leadAgentId,
            name: projects.name,
          })
          .from(projects)
          .where(eq(projects.id, input.issue.projectId))
          .limit(1)
          .then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
    input.db
      .select({
        reviewerAgentId: issueProtocolState.reviewerAgentId,
        qaAgentId: issueProtocolState.qaAgentId,
      })
      .from(issueProtocolState)
      .where(and(eq(issueProtocolState.issueId, input.issue.id), eq(issueProtocolState.companyId, input.issue.companyId)))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    input.db
      .select({
        id: agents.id,
        reportsTo: agents.reportsTo,
        adapterType: agents.adapterType,
        metadata: agents.metadata,
      })
      .from(agents)
      .where(and(eq(agents.companyId, input.issue.companyId), eq(agents.role, "engineer"))),
  ]);

  const preferredEngineerAgentId = selectPreferredEngineerAgentId({
    candidates: engineerCandidates,
    managerAgentId: project?.leadAgentId ?? supervisoryRecipient.recipientId,
    projectKeys: [project?.name],
    excludeAgentIds: [supervisoryRecipient.recipientId, project?.leadAgentId ?? null],
  });
  if (!preferredEngineerAgentId || preferredEngineerAgentId === supervisoryRecipient.recipientId) {
    return null;
  }

  const reviewerAgentId =
    state?.reviewerAgentId && state.reviewerAgentId !== preferredEngineerAgentId
      ? state.reviewerAgentId
      : supervisoryRecipient.recipientId;
  const qaAgentId = state?.qaAgentId ?? null;
  const recipients: CreateIssueProtocolMessage["recipients"] = [
    {
      recipientType: "agent",
      recipientId: preferredEngineerAgentId,
      role: "engineer",
    },
  ];
  if (reviewerAgentId && reviewerAgentId !== preferredEngineerAgentId) {
    recipients.push({
      recipientType: "agent",
      recipientId: reviewerAgentId,
      role: "reviewer",
    });
  }
  if (qaAgentId && qaAgentId !== preferredEngineerAgentId && qaAgentId !== reviewerAgentId) {
    recipients.push({
      recipientType: "agent",
      recipientId: qaAgentId,
      role: "qa",
    });
  }

  const rerouteMessage: CreateIssueProtocolMessage = {
    messageType: "REASSIGN_TASK",
    sender: {
      actorType: "agent",
      actorId: supervisoryRecipient.recipientId,
      role: "tech_lead",
    },
    recipients,
    workflowStateBefore: "assigned",
    workflowStateAfter: "assigned",
    summary: "Local-trusted deterministic routing reassign",
    requiresAck: false,
    payload: {
      reason: "local_trusted_pre_retrieval_auto_assist",
      newAssigneeAgentId: preferredEngineerAgentId,
      ...(reviewerAgentId ? { newReviewerAgentId: reviewerAgentId } : {}),
      ...(qaAgentId ? { newQaAgentId: qaAgentId } : {}),
    },
    artifacts: [],
  };

  const rerouteResult = await input.protocolSvc.appendMessage({
    issueId: input.issue.id,
    message: rerouteMessage,
    mirrorToComments: true,
    authorAgentId: supervisoryRecipient.recipientId,
    authorUserId: null,
  });

  await logActivity(input.db, {
    companyId: input.issue.companyId,
    actorType: "system",
    actorId: "local_protocol_auto_assist",
    agentId: supervisoryRecipient.recipientId,
    runId: null,
    action: "issue.protocol_dispatch.auto_assist_preempted",
    entityType: "issue",
    entityId: input.issue.id,
    details: {
      protocolMessageId: input.protocolMessageId,
      messageType: input.message.messageType,
      rerouteProtocolMessageId: rerouteResult.message.id,
      recipientAgentId: preferredEngineerAgentId,
      reviewerAgentId,
      qaAgentId,
    },
  });

  return {
    rerouteMessage,
    rerouteProtocolMessageId: rerouteResult.message.id,
    rerouteProtocolMessageSeq: rerouteResult.message.seq,
    actor: {
      actorType: "agent",
      actorId: supervisoryRecipient.recipientId,
      agentId: supervisoryRecipient.recipientId,
      runId: null,
    },
  };
}

export function buildProtocolDispatchReconciliationActor(message: {
  sender: { actorType: string; actorId: string; role: string };
}) {
  return {
    actorType:
      message.sender.actorType === "agent" || message.sender.actorType === "user"
        ? message.sender.actorType
        : "system",
    actorId: message.sender.actorId,
    agentId: message.sender.actorType === "agent" ? readNonEmptyString(message.sender.actorId) : null,
    runId: null,
  } as const;
}
