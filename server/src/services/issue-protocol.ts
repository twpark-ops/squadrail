import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "@squadrail/db";
import {
  issueComments,
  issueMergeCandidates,
  issueProtocolArtifacts,
  issueProtocolMessages,
  issueProtocolRecipients,
  issueProtocolState,
  issueProtocolThreads,
  issueProtocolViolations,
  issueReviewCycles,
  issues,
  projects,
} from "@squadrail/db";
import type {
  CreateIssueProtocolMessage,
  CreateIssueProtocolViolation,
  IssueProtocolArtifact,
  IssueProtocolMessageType,
  IssueProtocolRole,
  IssueProtocolWorkflowState,
  IssueStatus,
} from "@squadrail/shared";
import { conflict, notFound, unprocessable } from "../errors.js";
import { evaluateProtocolEvidenceRequirement } from "./issue-protocol-policy.js";
import {
  buildMergeCandidateGateStatus,
  buildMergeCandidatePrBridge,
  mergeCandidateRequiresGateEnforcement,
} from "./merge-candidate-gates.js";
import { summarizeIssueFailureLearning } from "./failure-learning.js";
import {
  sealProtocolMessageIntegrity,
  verifyProtocolMessageIntegrity,
} from "../protocol-integrity.js";
import { resolveIssueDependencyGraphMetadata } from "./issue-dependency-graph.js";

const MESSAGE_RULES: Record<
  IssueProtocolMessageType,
  {
    from: IssueProtocolWorkflowState[] | "*";
    to: IssueProtocolWorkflowState | "same";
    roles: IssueProtocolRole[];
    stateChanging: boolean;
  }
> = {
  ASSIGN_TASK: { from: ["backlog"], to: "assigned", roles: ["tech_lead", "cto", "pm", "human_board"], stateChanging: true },
  ACK_ASSIGNMENT: { from: ["assigned"], to: "accepted", roles: ["engineer"], stateChanging: true },
  ASK_CLARIFICATION: { from: "*", to: "same", roles: ["tech_lead", "engineer", "reviewer", "cto", "pm", "qa"], stateChanging: false },
  PROPOSE_PLAN: { from: ["accepted", "planning"], to: "planning", roles: ["engineer"], stateChanging: true },
  START_IMPLEMENTATION: {
    from: ["accepted", "planning", "changes_requested"],
    to: "implementing",
    roles: ["engineer"],
    stateChanging: true,
  },
  REPORT_PROGRESS: { from: ["implementing"], to: "same", roles: ["engineer"], stateChanging: false },
  ESCALATE_BLOCKER: {
    from: ["assigned", "planning", "implementing", "under_review"],
    to: "blocked",
    roles: ["engineer", "reviewer", "tech_lead", "cto", "pm", "qa"],
    stateChanging: true,
  },
  SUBMIT_FOR_REVIEW: {
    from: ["implementing"],
    to: "submitted_for_review",
    roles: ["engineer"],
    stateChanging: true,
  },
  START_REVIEW: {
    from: ["submitted_for_review", "qa_pending"],
    to: "same",
    roles: ["reviewer", "tech_lead", "qa", "system"],
    stateChanging: true,
  },
  REQUEST_CHANGES: {
    from: ["under_review", "under_qa_review", "awaiting_human_decision"],
    to: "changes_requested",
    roles: ["reviewer", "tech_lead", "qa", "human_board"],
    stateChanging: true,
  },
  ACK_CHANGE_REQUEST: {
    from: ["changes_requested"],
    to: "implementing",
    roles: ["engineer"],
    stateChanging: true,
  },
  REQUEST_HUMAN_DECISION: {
    from: ["under_review", "under_qa_review", "blocked"],
    to: "awaiting_human_decision",
    roles: ["reviewer", "tech_lead", "cto", "pm", "qa", "system"],
    stateChanging: true,
  },
  APPROVE_IMPLEMENTATION: {
    from: ["under_review", "under_qa_review", "awaiting_human_decision"],
    to: "same",
    roles: ["reviewer", "tech_lead", "cto", "qa", "human_board"],
    stateChanging: true,
  },
  CLOSE_TASK: {
    from: ["approved"],
    to: "done",
    roles: ["tech_lead", "cto", "pm", "human_board", "system"],
    stateChanging: true,
  },
  REASSIGN_TASK: {
    from: ["assigned", "accepted", "planning", "implementing", "blocked"],
    to: "assigned",
    roles: ["tech_lead", "cto", "pm", "human_board"],
    stateChanging: true,
  },
  CANCEL_TASK: {
    from: "*",
    to: "cancelled",
    roles: ["tech_lead", "cto", "pm", "human_board"],
    stateChanging: true,
  },
  NOTE: { from: "*", to: "same", roles: ["tech_lead", "engineer", "reviewer", "cto", "pm", "qa", "human_board"], stateChanging: false },
  SYSTEM_REMINDER: { from: "*", to: "same", roles: ["system"], stateChanging: false },
  TIMEOUT_ESCALATION: { from: "*", to: "same", roles: ["system"], stateChanging: false },
  RECORD_PROTOCOL_VIOLATION: { from: "*", to: "same", roles: ["system"], stateChanging: false },
};

export function mapProtocolStateToIssueStatus(state: IssueProtocolWorkflowState): IssueStatus {
  switch (state) {
    case "backlog":
      return "backlog";
    case "assigned":
      return "todo";
    case "accepted":
    case "planning":
    case "implementing":
      return "in_progress";
    case "submitted_for_review":
    case "under_review":
    case "qa_pending":
    case "under_qa_review":
    case "changes_requested":
    case "awaiting_human_decision":
    case "approved":
      return "in_review";
    case "blocked":
      return "blocked";
    case "done":
      return "done";
    case "cancelled":
      return "cancelled";
  }
}

export function applyProjectedIssueStatus(status: IssueStatus): Partial<typeof issues.$inferInsert> {
  const patch: Partial<typeof issues.$inferInsert> = { status, updatedAt: new Date() };
  if (status === "in_progress" && !patch.startedAt) patch.startedAt = new Date();
  if (status === "done") patch.completedAt = new Date();
  if (status === "cancelled") patch.cancelledAt = new Date();
  return patch;
}

function buildRecoveryReopenIssuePatch(status: IssueStatus): Partial<typeof issues.$inferInsert> {
  return {
    ...applyProjectedIssueStatus(status),
    completedAt: null,
    cancelledAt: null,
    checkoutRunId: null,
  };
}

export function renderMirrorComment(input: CreateIssueProtocolMessage) {
  const recipients = input.recipients.map((recipient) => `${recipient.role}:${recipient.recipientId}`).join(", ");
  const payload = JSON.stringify(input.payload, null, 2);
  return [
    `**Protocol ${input.messageType}**`,
    "",
    `- state: \`${input.workflowStateBefore}\` -> \`${input.workflowStateAfter}\``,
    `- summary: ${input.summary}`,
    `- recipients: ${recipients}`,
    "",
    "```json",
    payload,
    "```",
  ].join("\n");
}

function normalizeIntegrityRecipients(
  recipients: Array<{
    recipientType: string;
    recipientId: string;
    role: string;
  }>,
) {
  return recipients.map((recipient) => ({
    recipientType: recipient.recipientType,
    recipientId: recipient.recipientId,
    role: recipient.role,
  }));
}

function normalizeIntegrityArtifacts(
  artifacts: Array<{
    kind: string;
    uri: string;
    label?: string | null;
    metadata?: Record<string, unknown> | null;
  }>,
) {
  return artifacts.map((artifact) => ({
    kind: artifact.kind,
    uri: artifact.uri,
    label: artifact.label ?? null,
    metadata: artifact.metadata ?? {},
  }));
}

function findRecipientRoleForAgent(
  recipients: Array<{
    recipientType: string;
    recipientId: string;
    role: string;
  }>,
  agentId: string | null | undefined,
): IssueProtocolRole | null {
  if (!agentId) return null;
  const match = recipients.find(
    (recipient) => recipient.recipientType === "agent" && recipient.recipientId === agentId,
  );
  if (!match) return null;
  return match.role as IssueProtocolRole;
}

function firstRecipientIdForRole(
  recipients: Array<{
    recipientType: string;
    recipientId: string;
    role: string;
  }>,
  role: IssueProtocolRole,
): string | null {
  const match = recipients.find(
    (recipient) => recipient.recipientType === "agent" && recipient.role === role,
  );
  return match?.recipientId ?? null;
}

export function validateHumanBoardProtocolIntervention(input: {
  messageType: IssueProtocolMessageType;
  senderRole: IssueProtocolRole;
  workflowStateBefore: IssueProtocolWorkflowState;
}) {
  if (
    input.messageType === "REQUEST_CHANGES"
    && input.senderRole === "human_board"
    && input.workflowStateBefore !== "awaiting_human_decision"
  ) {
    return "Human board can request changes only after REQUEST_HUMAN_DECISION";
  }
  return null;
}

export function validateProtocolRecipientContract(message: CreateIssueProtocolMessage) {
  const payload = message.payload as Record<string, unknown>;

  if (message.messageType === "ASSIGN_TASK") {
    const assigneeAgentId = payload.assigneeAgentId as string;
    const reviewerAgentId = payload.reviewerAgentId as string;
    const qaAgentId = payload.qaAgentId as string | null | undefined;
    const assigneeInRecipients = message.recipients.find(
      (recipient) => recipient.recipientType === "agent" && recipient.recipientId === assigneeAgentId,
    );
    if (!assigneeInRecipients) {
      return "assigneeAgentId must be in recipients list";
    }
    if (reviewerAgentId === assigneeAgentId) {
      return "Reviewer must be different from assignee";
    }
    if (qaAgentId && qaAgentId === assigneeAgentId) {
      return "QA must be different from assignee";
    }
    if (qaAgentId && qaAgentId === reviewerAgentId) {
      return "QA must be different from reviewer";
    }
  }

  if (message.messageType === "REASSIGN_TASK") {
    const newAssigneeAgentId = payload.newAssigneeAgentId as string;
    const newReviewerAgentId = payload.newReviewerAgentId as string | null | undefined;
    const newQaAgentId = payload.newQaAgentId as string | null | undefined;
    const newAssigneeInRecipients = message.recipients.find(
      (recipient) => recipient.recipientType === "agent" && recipient.recipientId === newAssigneeAgentId,
    );
    if (!newAssigneeInRecipients) {
      return "newAssigneeAgentId must be in recipients list";
    }
    if (message.recipients.length > 0 && message.recipients[0].recipientId !== newAssigneeAgentId) {
      return "newAssignee must be first recipient for proper transfer logic";
    }
    if (newReviewerAgentId && newReviewerAgentId === newAssigneeAgentId) {
      return "Reviewer must be different from assignee";
    }
    if (newQaAgentId && newQaAgentId === newAssigneeAgentId) {
      return "QA must be different from assignee";
    }
    if (newQaAgentId && newReviewerAgentId && newQaAgentId === newReviewerAgentId) {
      return "QA must be different from reviewer";
    }
  }

  if (message.messageType === "START_IMPLEMENTATION") {
    const hasSelfEngineerRecipient = message.recipients.some(
      (recipient) =>
        recipient.recipientType === "agent"
        && recipient.role === "engineer"
        && recipient.recipientId === message.sender.actorId,
    );
    if (!hasSelfEngineerRecipient) {
      return "START_IMPLEMENTATION must include the assigned engineer as a recipient";
    }
  }

  return null;
}

type ProtocolOwnershipState = {
  techLeadAgentId: string | null;
  primaryEngineerAgentId: string | null;
  reviewerAgentId: string | null;
  qaAgentId: string | null;
};

export function resolveExpectedWorkflowStateAfter(input: {
  before: IssueProtocolWorkflowState;
  currentState: typeof issueProtocolState.$inferSelect | null;
  message: CreateIssueProtocolMessage;
  rule: {
    to: IssueProtocolWorkflowState | "same";
  };
}) {
  if (input.message.messageType === "START_REVIEW") {
    return input.before === "qa_pending" ? "under_qa_review" : "under_review";
  }

  if (input.message.messageType === "APPROVE_IMPLEMENTATION") {
    const payload = input.message.payload as Record<string, unknown>;
    const approvalMode = payload.approvalMode;
    const humanOverride = approvalMode === "human_override" || input.message.sender.role === "human_board";
    const qaRequired = Boolean(input.currentState?.qaAgentId);

    if (input.before === "under_review" && qaRequired && !humanOverride && input.message.sender.role !== "qa") {
      return "qa_pending";
    }

    return "approved";
  }

  return input.rule.to === "same" ? input.before : input.rule.to;
}

export function resolveProtocolOwnershipForMessage(input: {
  currentState: ProtocolOwnershipState | null;
  message: CreateIssueProtocolMessage;
  fallbackTechLeadAgentId?: string | null;
}) {
  const currentPayload = input.message.payload as Record<string, unknown>;
  const assignTargetAgentId =
    input.message.messageType === "ASSIGN_TASK"
      ? String(currentPayload.assigneeAgentId)
      : input.message.messageType === "REASSIGN_TASK"
        ? String(currentPayload.newAssigneeAgentId)
        : null;
  const assignTargetRole = findRecipientRoleForAgent(input.message.recipients, assignTargetAgentId);
  const explicitTechLeadRecipientId = firstRecipientIdForRole(input.message.recipients, "tech_lead");

  const techLeadAgentId =
    input.message.messageType === "ASSIGN_TASK"
      ? assignTargetRole === "tech_lead"
        ? assignTargetAgentId
        : input.message.sender.role === "tech_lead"
          ? input.message.sender.actorId
          : explicitTechLeadRecipientId ?? input.currentState?.techLeadAgentId ?? input.fallbackTechLeadAgentId ?? null
      : input.message.messageType === "REASSIGN_TASK"
        ? assignTargetRole === "tech_lead"
          ? assignTargetAgentId
          : input.currentState?.techLeadAgentId ?? input.fallbackTechLeadAgentId ?? null
        : input.currentState?.techLeadAgentId ?? null;

  const primaryEngineerAgentId =
    input.message.messageType === "ASSIGN_TASK"
      ? assignTargetRole === "engineer"
        ? assignTargetAgentId
        : null
      : input.message.messageType === "REASSIGN_TASK"
        ? assignTargetRole === "engineer"
          ? assignTargetAgentId
          : null
        : input.currentState?.primaryEngineerAgentId ?? null;

  const reviewerAgentId =
    input.message.messageType === "ASSIGN_TASK"
      ? String(currentPayload.reviewerAgentId)
      : input.message.messageType === "REASSIGN_TASK"
        ? (currentPayload.newReviewerAgentId as string | null | undefined) ?? input.currentState?.reviewerAgentId ?? null
        : input.currentState?.reviewerAgentId ?? null;

  const qaAgentId =
    input.message.messageType === "ASSIGN_TASK"
      ? (currentPayload.qaAgentId as string | null | undefined) ?? null
      : input.message.messageType === "REASSIGN_TASK"
        ? (currentPayload.newQaAgentId as string | null | undefined) ?? input.currentState?.qaAgentId ?? null
        : input.currentState?.qaAgentId ?? null;

  return {
    techLeadAgentId,
    primaryEngineerAgentId,
    reviewerAgentId,
    qaAgentId,
  };
}

async function getOpenReviewCycle(tx: any, issueId: string) {
  return tx
    .select()
    .from(issueReviewCycles)
    .where(and(eq(issueReviewCycles.issueId, issueId), isNull(issueReviewCycles.closedAt)))
    .orderBy(desc(issueReviewCycles.openedAt))
    .then((rows: Array<typeof issueReviewCycles.$inferSelect>) => rows[0] ?? null);
}

async function getLatestSubmittedReviewMessage(tx: any, issueId: string) {
  return tx
    .select()
    .from(issueProtocolMessages)
    .where(and(eq(issueProtocolMessages.issueId, issueId), eq(issueProtocolMessages.messageType, "SUBMIT_FOR_REVIEW")))
    .orderBy(desc(issueProtocolMessages.seq))
    .then((rows: Array<typeof issueProtocolMessages.$inferSelect>) => rows[0] ?? null);
}

async function getMessageArtifacts(
  tx: any,
  messageId: string,
): Promise<Array<Pick<IssueProtocolArtifact, "kind" | "metadata">>> {
  return tx
    .select({ kind: issueProtocolArtifacts.artifactKind, metadata: issueProtocolArtifacts.metadata })
    .from(issueProtocolArtifacts)
    .where(eq(issueProtocolArtifacts.messageId, messageId));
}

export function issueProtocolService(db: Db) {
  async function ensurePrimaryThread(tx: any, companyId: string, issueId: string) {
    const existing = await tx
      .select()
      .from(issueProtocolThreads)
      .where(and(eq(issueProtocolThreads.issueId, issueId), eq(issueProtocolThreads.threadType, "primary")))
      .then((rows: Array<typeof issueProtocolThreads.$inferSelect>) => rows[0] ?? null);

    if (existing) return existing;

    const [created] = await tx
      .insert(issueProtocolThreads)
      .values({
        companyId,
        issueId,
        threadType: "primary",
        title: "Primary protocol thread",
      })
      .returning();
    return created;
  }

  async function validateMessage(
    currentState: typeof issueProtocolState.$inferSelect | null,
    message: CreateIssueProtocolMessage,
  ) {
    const rule = MESSAGE_RULES[message.messageType];
    if (!rule.roles.includes(message.sender.role)) {
      throw unprocessable(`Sender role ${message.sender.role} cannot send ${message.messageType}`);
    }

    const effectiveState = (currentState?.workflowState as IssueProtocolWorkflowState | undefined) ?? null;
    if (!effectiveState && message.messageType !== "ASSIGN_TASK") {
      throw conflict("Protocol state is not initialized; first protocol message must be ASSIGN_TASK");
    }
    if (effectiveState && message.workflowStateBefore !== effectiveState) {
      throw conflict(`Expected protocol state ${effectiveState}, got ${message.workflowStateBefore}`);
    }

    const before = effectiveState ?? message.workflowStateBefore;
    if (message.messageType === "CLOSE_TASK" && before !== "approved") {
      throw conflict("Cannot close task before approval");
    }
    if (rule.from !== "*" && !rule.from.includes(before)) {
      throw conflict(`Message ${message.messageType} cannot run from state ${before}`);
    }

    const expectedAfter = resolveExpectedWorkflowStateAfter({
      before,
      currentState,
      message,
      rule,
    });
    if (message.workflowStateAfter !== expectedAfter) {
      throw conflict(`Message ${message.messageType} must transition to ${expectedAfter}`);
    }

    if (rule.stateChanging === false && message.workflowStateBefore !== message.workflowStateAfter) {
      throw conflict(`Message ${message.messageType} cannot change state`);
    }

    const humanBoardOverrideViolation = validateHumanBoardProtocolIntervention({
      messageType: message.messageType,
      senderRole: message.sender.role,
      workflowStateBefore: before,
    });
    if (humanBoardOverrideViolation) {
      throw unprocessable(humanBoardOverrideViolation);
    }

    if (message.sender.role === "engineer" && currentState?.primaryEngineerAgentId) {
      if (message.sender.actorId !== currentState.primaryEngineerAgentId) {
        throw unprocessable("Only the assigned engineer can send this protocol message");
      }
    }

    if (message.sender.role === "reviewer" && currentState?.reviewerAgentId) {
      if (message.sender.actorId !== currentState.reviewerAgentId) {
        throw unprocessable("Only the assigned reviewer can send this protocol message");
      }
    }

    if (message.sender.role === "qa" && currentState?.qaAgentId) {
      if (message.sender.actorId !== currentState.qaAgentId) {
        throw unprocessable("Only the assigned QA agent can send this protocol message");
      }
    }

    if (message.messageType === "START_REVIEW" && before === "submitted_for_review" && message.sender.role === "qa") {
      throw unprocessable("QA cannot start the primary review lane before reviewer approval");
    }

    if (message.sender.role === "tech_lead" && currentState?.techLeadAgentId) {
      if (message.sender.actorId !== currentState.techLeadAgentId) {
        throw unprocessable("Only the assigned tech lead can send this protocol message");
      }
    }

    const recipientContractViolation = validateProtocolRecipientContract(message);
    if (recipientContractViolation) {
      throw unprocessable(recipientContractViolation);
    }
  }

  async function validateEvidenceRequirements(tx: any, issueId: string, message: CreateIssueProtocolMessage) {
    if (message.messageType === "APPROVE_IMPLEMENTATION") {
      const latestSubmit = await getLatestSubmittedReviewMessage(tx, issueId);
      if (!latestSubmit) {
        throw conflict("Cannot approve implementation without SUBMIT_FOR_REVIEW");
      }
      const violation = evaluateProtocolEvidenceRequirement({
        message,
        latestReviewPayload: latestSubmit.payload as Record<string, unknown> | null,
        latestReviewArtifacts: await getMessageArtifacts(tx, latestSubmit.id),
      });
      if (violation) {
        throw unprocessable(violation.message);
      }
      return;
    }

    const mergeCandidateRecord = message.messageType === "CLOSE_TASK"
      ? await tx
        .select()
        .from(issueMergeCandidates)
        .where(eq(issueMergeCandidates.issueId, issueId))
        .then((rows: Array<{ automationMetadata?: Record<string, unknown> | null }>) => rows[0] ?? null)
      : null;
    const prBridge = buildMergeCandidatePrBridge({
      automationMetadata: mergeCandidateRecord?.automationMetadata ?? null,
    });
    const gateStatus = buildMergeCandidateGateStatus({ prBridge });
    const issueRow = await tx
      .select({
        companyId: issues.companyId,
      })
      .from(issues)
      .where(eq(issues.id, issueId))
      .then((rows: Array<{ companyId: string }>) => rows[0] ?? null);
    const failureLearningGate = issueRow
      ? await summarizeIssueFailureLearning(tx as Db, {
        companyId: issueRow.companyId,
        issueId,
      })
      : null;
    const violation = evaluateProtocolEvidenceRequirement({
      message,
      mergeGateStatus: gateStatus,
      failureLearningGate,
      enforceMergeGate: mergeCandidateRequiresGateEnforcement({ prBridge, gateStatus }),
    });
    if (!violation) return;

    if (violation.violationCode === "close_without_verification") {
      throw conflict(violation.message);
    }
    throw unprocessable(violation.message);
  }

  return {
    getState: async (issueId: string) =>
      db
        .select()
        .from(issueProtocolState)
        .where(eq(issueProtocolState.issueId, issueId))
        .then((rows) => rows[0] ?? null),

    listReviewCycles: async (issueId: string) =>
      db
        .select()
        .from(issueReviewCycles)
        .where(eq(issueReviewCycles.issueId, issueId))
        .orderBy(desc(issueReviewCycles.cycleNumber), desc(issueReviewCycles.openedAt)),

    listViolations: async (input: {
      issueId: string;
      status?: string | null;
    }) =>
      db
        .select()
        .from(issueProtocolViolations)
        .where(
          input.status
            ? and(eq(issueProtocolViolations.issueId, input.issueId), eq(issueProtocolViolations.status, input.status))
            : eq(issueProtocolViolations.issueId, input.issueId),
        )
        .orderBy(desc(issueProtocolViolations.createdAt)),

    listMessages: async (issueId: string) => {
      const messages = await db
        .select()
        .from(issueProtocolMessages)
        .where(eq(issueProtocolMessages.issueId, issueId))
        .orderBy(asc(issueProtocolMessages.seq));

      const messageIds = messages.map((message) => message.id);
      const [recipients, artifacts] = messageIds.length === 0
        ? [[], []]
        : await Promise.all([
            db
              .select()
              .from(issueProtocolRecipients)
              .where(inArray(issueProtocolRecipients.messageId, messageIds)),
            db
              .select()
              .from(issueProtocolArtifacts)
              .where(inArray(issueProtocolArtifacts.messageId, messageIds)),
          ]);

      const recipientsByMessageId = new Map<string, Array<typeof issueProtocolRecipients.$inferSelect>>();
      for (const row of recipients) {
        const existing = recipientsByMessageId.get(row.messageId) ?? [];
        existing.push(row);
        recipientsByMessageId.set(row.messageId, existing);
      }

      const artifactsByMessageId = new Map<string, Array<typeof issueProtocolArtifacts.$inferSelect>>();
      for (const row of artifacts) {
        const existing = artifactsByMessageId.get(row.messageId) ?? [];
        existing.push(row);
        artifactsByMessageId.set(row.messageId, existing);
      }

      let previousIntegritySignature: string | null = null;

      return messages.map((message) => {
        const hydratedRecipients = normalizeIntegrityRecipients(
          (recipientsByMessageId.get(message.id) ?? []).map((recipient) => ({
            recipientType: recipient.recipientType,
            recipientId: recipient.recipientId,
            role: recipient.recipientRole,
          })),
        );
        const hydratedArtifacts = normalizeIntegrityArtifacts(
          (artifactsByMessageId.get(message.id) ?? []).map((artifact) => ({
            kind: artifact.artifactKind,
            uri: artifact.artifactUri,
            label: artifact.label,
            metadata: artifact.metadata,
          })),
        );
        const integrity = verifyProtocolMessageIntegrity({
          message: {
            ...message,
            payload: message.payload ?? {},
            recipients: hydratedRecipients,
            artifacts: hydratedArtifacts,
          },
          expectedPreviousIntegritySignature: previousIntegritySignature,
        });
        previousIntegritySignature = message.integritySignature ?? previousIntegritySignature;

        return {
          ...message,
          integrityStatus: integrity.status,
          sender: {
            actorType: message.senderActorType,
            actorId: message.senderActorId,
            role: message.senderRole,
          },
          recipients: hydratedRecipients,
          artifacts: hydratedArtifacts,
        };
      });
    },

    appendMessage: async (input: {
      issueId: string;
      message: CreateIssueProtocolMessage;
      mirrorToComments?: boolean;
      authorAgentId?: string | null;
      authorUserId?: string | null;
    }) => {
      const issue = await db
        .select()
        .from(issues)
        .where(eq(issues.id, input.issueId))
        .then((rows) => rows[0] ?? null);

      if (!issue) throw notFound("Issue not found");

      const fallbackTechLeadAgentId = issue.projectId
        ? await db
          .select({ leadAgentId: projects.leadAgentId })
          .from(projects)
          .where(eq(projects.id, issue.projectId))
          .then((rows) => rows[0]?.leadAgentId ?? null)
        : null;

      return db.transaction(async (tx) => {
        // Use SELECT FOR UPDATE to prevent race conditions when multiple protocol messages arrive concurrently
        const currentState = await tx
          .select()
          .from(issueProtocolState)
          .where(eq(issueProtocolState.issueId, issue.id))
          .for("update")
          .then((rows: Array<typeof issueProtocolState.$inferSelect>) => rows[0] ?? null);

        await validateMessage(currentState, input.message);
        await validateEvidenceRequirements(tx, issue.id, input.message);

        const thread = await ensurePrimaryThread(tx, issue.companyId, issue.id);
        const lastMessage = await tx
          .select()
          .from(issueProtocolMessages)
          .where(eq(issueProtocolMessages.threadId, thread.id))
          .orderBy(desc(issueProtocolMessages.seq))
          .then((rows: Array<typeof issueProtocolMessages.$inferSelect>) => rows[0] ?? null);
        const seq = (lastMessage?.seq ?? 0) + 1;

        const [createdMessage] = await tx
          .insert(issueProtocolMessages)
          .values({
            companyId: issue.companyId,
            issueId: issue.id,
            threadId: thread.id,
            seq,
            messageType: input.message.messageType,
            senderActorType: input.message.sender.actorType,
            senderActorId: input.message.sender.actorId,
            senderRole: input.message.sender.role,
            workflowStateBefore: input.message.workflowStateBefore,
            workflowStateAfter: input.message.workflowStateAfter,
            summary: input.message.summary,
            payload: input.message.payload as Record<string, unknown>,
            causalMessageId: input.message.causalMessageId ?? null,
            retrievalRunId: input.message.retrievalRunId ?? null,
            requiresAck: input.message.requiresAck ?? false,
          })
          .returning();

        const insertedRecipients = normalizeIntegrityRecipients(input.message.recipients);
        if (insertedRecipients.length > 0) {
          await tx.insert(issueProtocolRecipients).values(
            insertedRecipients.map((recipient) => ({
              companyId: issue.companyId,
              messageId: createdMessage.id,
              recipientType: recipient.recipientType,
              recipientId: recipient.recipientId,
              recipientRole: recipient.role,
            })),
          );
        }

        const insertedArtifacts = normalizeIntegrityArtifacts(input.message.artifacts ?? []);
        if (insertedArtifacts.length > 0) {
          await tx.insert(issueProtocolArtifacts).values(
            insertedArtifacts.map((artifact) => ({
              companyId: issue.companyId,
              messageId: createdMessage.id,
              artifactKind: artifact.kind,
              artifactUri: artifact.uri,
              label: artifact.label ?? null,
              metadata: artifact.metadata ?? {},
            })),
          );
        }

        const sealedIntegrity = sealProtocolMessageIntegrity({
          message: {
            ...createdMessage,
            payload: createdMessage.payload ?? {},
            recipients: insertedRecipients,
            artifacts: insertedArtifacts,
          },
          previousIntegritySignature: lastMessage?.integritySignature ?? null,
        });

        let sealedMessage = createdMessage;
        if (sealedIntegrity) {
          [sealedMessage] = await tx
            .update(issueProtocolMessages)
            .set({
              payloadSha256: sealedIntegrity.payloadSha256,
              previousIntegritySignature: sealedIntegrity.previousIntegritySignature,
              integrityAlgorithm: sealedIntegrity.integrityAlgorithm,
              integritySignature: sealedIntegrity.integritySignature,
            })
            .where(eq(issueProtocolMessages.id, createdMessage.id))
            .returning();
        }

        if (input.message.causalMessageId) {
          await tx
            .update(issueProtocolMessages)
            .set({ ackedAt: new Date() })
            .where(eq(issueProtocolMessages.id, input.message.causalMessageId));
        }

        if (input.message.messageType === "START_REVIEW") {
          const openCycle = await getOpenReviewCycle(tx, issue.id);
          if (openCycle) {
            throw conflict("An active review cycle already exists");
          }
          const latestSubmit = await getLatestSubmittedReviewMessage(tx, issue.id);
          if (!latestSubmit) {
            throw conflict("Cannot start review without SUBMIT_FOR_REVIEW");
          }
          const payload = input.message.payload as Record<string, unknown>;
          const reviewCycle = typeof payload.reviewCycle === "number" ? payload.reviewCycle : 1;
          await tx.insert(issueReviewCycles).values({
            companyId: issue.companyId,
            issueId: issue.id,
            cycleNumber: reviewCycle,
            reviewerAgentId:
              input.message.sender.actorType === "agent"
                && (input.message.sender.role === "reviewer" || input.message.sender.role === "qa")
                ? input.message.sender.actorId
                : null,
            reviewerUserId: input.message.sender.actorType === "user" ? input.message.sender.actorId : null,
            submittedMessageId: latestSubmit.id,
          });
        }

        if (input.message.messageType === "REQUEST_CHANGES" || input.message.messageType === "APPROVE_IMPLEMENTATION") {
          const openCycle = await getOpenReviewCycle(tx, issue.id);
          if (!openCycle) {
            throw conflict("No active review cycle found");
          }
          await tx
            .update(issueReviewCycles)
            .set({
              closedAt: new Date(),
              outcome: input.message.messageType === "REQUEST_CHANGES" ? "changes_requested" : "approved",
              outcomeMessageId: createdMessage.id,
            })
            .where(eq(issueReviewCycles.id, openCycle.id));
        }

        const workflowState = input.message.workflowStateAfter;
        const coarseIssueStatus = mapProtocolStateToIssueStatus(workflowState);
        const currentPayload = input.message.payload as Record<string, unknown>;
        const resolvedOwnership = resolveProtocolOwnershipForMessage({
          currentState: currentState
            ? {
                techLeadAgentId: currentState.techLeadAgentId,
                primaryEngineerAgentId: currentState.primaryEngineerAgentId,
                reviewerAgentId: currentState.reviewerAgentId,
                qaAgentId: currentState.qaAgentId ?? null,
              }
            : null,
          message: input.message,
          fallbackTechLeadAgentId,
        });

        const dependencyGraph = await resolveIssueDependencyGraphMetadata(tx, {
          companyId: issue.companyId,
          issueId: issue.id,
          payload: currentPayload,
          existingMetadata: currentState?.metadata ?? {},
        });
        const previousMetadata = currentState?.metadata ?? {};
        const { dependencyBlock: _previousDependencyBlock, ...metadataWithoutDependencyBlock } = previousMetadata;
        const nextMetadata =
          dependencyGraph
            ? {
                ...metadataWithoutDependencyBlock,
                dependencyGraph,
              }
            : metadataWithoutDependencyBlock;

        const nextStateValues: typeof issueProtocolState.$inferInsert = {
          issueId: issue.id,
          companyId: issue.companyId,
          workflowState,
          coarseIssueStatus,
          techLeadAgentId: resolvedOwnership.techLeadAgentId,
          primaryEngineerAgentId: resolvedOwnership.primaryEngineerAgentId,
          reviewerAgentId: resolvedOwnership.reviewerAgentId,
          qaAgentId: resolvedOwnership.qaAgentId,
          currentReviewCycle:
            input.message.messageType === "START_REVIEW"
              ? Number(currentPayload.reviewCycle ?? (currentState?.currentReviewCycle ?? 0) + 1)
              : currentState?.currentReviewCycle ?? 0,
          lastProtocolMessageId: sealedMessage.id,
          lastTransitionAt: new Date(),
          blockedPhase:
            workflowState === "blocked"
              ? currentState?.workflowState === "under_review"
                || currentState?.workflowState === "under_qa_review"
                ? "review"
                : currentState?.workflowState === "planning"
                  ? "planning"
                  : currentState?.workflowState === "assigned"
                    ? "assignment"
                    : "implementing"
              : null,
          blockedCode: workflowState === "blocked" ? String(currentPayload.blockerCode ?? "") : null,
          blockedByMessageId: workflowState === "blocked" ? sealedMessage.id : null,
          metadata: nextMetadata,
        };

        if (currentState) {
          await tx
            .update(issueProtocolState)
            .set(nextStateValues)
            .where(eq(issueProtocolState.issueId, issue.id));
        } else {
          await tx.insert(issueProtocolState).values(nextStateValues);
        }

        const issuePatch = applyProjectedIssueStatus(coarseIssueStatus);
        issuePatch.assigneeAgentId = nextStateValues.primaryEngineerAgentId ?? nextStateValues.techLeadAgentId ?? null;
        await tx.update(issues).set(issuePatch).where(eq(issues.id, issue.id));

        if (input.mirrorToComments !== false) {
          await tx.insert(issueComments).values({
            companyId: issue.companyId,
            issueId: issue.id,
            authorAgentId: input.authorAgentId ?? null,
            authorUserId: input.authorUserId ?? null,
            body: renderMirrorComment(input.message),
          });
        }

        return {
          message: {
            ...sealedMessage,
            integrityStatus: sealedIntegrity ? "verified" : "legacy_unsealed",
          },
          state: nextStateValues,
        };
      });
    },

    createViolation: async (input: {
      issueId: string;
      violation: CreateIssueProtocolViolation;
    }) => {
      const issue = await db
        .select({ id: issues.id, companyId: issues.companyId })
        .from(issues)
        .where(eq(issues.id, input.issueId))
        .then((rows) => rows[0] ?? null);

      if (!issue) throw notFound("Issue not found");

      const [created] = await db
        .insert(issueProtocolViolations)
        .values({
          companyId: issue.companyId,
          issueId: issue.id,
          threadId: input.violation.threadId ?? null,
          messageId: input.violation.messageId ?? null,
          violationCode: input.violation.violationCode,
          severity: input.violation.severity,
          detectedByActorType: input.violation.detectedByActorType,
          detectedByActorId: input.violation.detectedByActorId,
          status: input.violation.status,
          details: input.violation.details,
        })
        .returning();
      return created;
    },

    reopenForRecovery: async (issueId: string) => {
      const issue = await db
        .select()
        .from(issues)
        .where(eq(issues.id, issueId))
        .then((rows) => rows[0] ?? null);

      if (!issue) throw notFound("Issue not found");

      return db.transaction(async (tx) => {
        const currentState = await tx
          .select()
          .from(issueProtocolState)
          .where(eq(issueProtocolState.issueId, issueId))
          .for("update")
          .then((rows: Array<typeof issueProtocolState.$inferSelect>) => rows[0] ?? null);

        if (!currentState) {
          const [reopenedIssue] = await tx
            .update(issues)
            .set(buildRecoveryReopenIssuePatch("todo"))
            .where(eq(issues.id, issueId))
            .returning();

          return {
            issue: reopenedIssue ?? issue,
            state: null,
            reopenedFromWorkflowState: null,
            nextWorkflowState: null,
            wakeAssigneeAgentId: reopenedIssue?.assigneeAgentId ?? issue.assigneeAgentId ?? null,
          };
        }

        if (currentState.workflowState !== "done" && currentState.workflowState !== "cancelled") {
          throw conflict("Issue protocol is not in a terminal state");
        }

        const nextWorkflowState: IssueProtocolWorkflowState = "assigned";
        const coarseIssueStatus = mapProtocolStateToIssueStatus(nextWorkflowState);
        const nextMetadata = {
          ...(currentState.metadata ?? {}),
          recoveryReopen: {
            lastReopenedAt: new Date().toISOString(),
            reopenedFromWorkflowState: currentState.workflowState,
          },
        } satisfies Record<string, unknown>;

        const [updatedState] = await tx
          .update(issueProtocolState)
          .set({
            workflowState: nextWorkflowState,
            coarseIssueStatus,
            lastTransitionAt: new Date(),
            blockedPhase: null,
            blockedCode: null,
            blockedByMessageId: null,
            metadata: nextMetadata,
          })
          .where(eq(issueProtocolState.issueId, issueId))
          .returning();

        const [reopenedIssue] = await tx
          .update(issues)
          .set({
            ...buildRecoveryReopenIssuePatch(coarseIssueStatus),
            assigneeAgentId: currentState.primaryEngineerAgentId ?? currentState.techLeadAgentId ?? issue.assigneeAgentId,
            assigneeUserId: null,
          })
          .where(eq(issues.id, issueId))
          .returning();

        return {
          issue: reopenedIssue ?? issue,
          state: updatedState ?? currentState,
          reopenedFromWorkflowState: currentState.workflowState,
          nextWorkflowState,
          wakeAssigneeAgentId:
            reopenedIssue?.assigneeAgentId
            ?? currentState.primaryEngineerAgentId
            ?? currentState.techLeadAgentId
            ?? issue.assigneeAgentId
            ?? null,
        };
      });
    },
  };
}
