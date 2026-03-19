import { and, eq } from "drizzle-orm";
import { issueProtocolState, issues, type Db } from "@squadrail/db";
import type { CreateIssueProtocolMessage } from "@squadrail/shared";
import { canDispatchProtocolToAdapter } from "../adapters/index.js";
import { logActivity } from "./activity-log.js";
import { agentService } from "./agents.js";
import { heartbeatService } from "./heartbeat.js";
import {
  buildInternalWorkItemDispatchMetadata,
  getInternalWorkItemKind,
  isLeadWatchEnabled,
  isReviewerWatchEnabled,
  leadSupervisorProtocolReason,
  loadInternalWorkItemSupervisorContext,
  reviewerWatchReason,
  type InternalWorkItemSupervisorContext,
} from "./internal-work-item-supervision.js";
import {
  buildIssueDependencyBlockingSummary,
  hasBlockingIssueDependencies,
  readIssueDependencyGraphMetadata,
  resolveIssueDependencyGraphMetadata,
} from "./issue-dependency-graph.js";

type ProtocolWakeSource = "assignment" | "automation";
type ProtocolDispatchKind = "wakeup" | "notify_only" | "skip_sender" | "skip_unsupported_adapter";
type ProtocolDispatchMode =
  | "default"
  | "reviewer_watch"
  | "lead_supervisor"
  | "qa_gate_followup"
  | "approval_close_followup";

export interface ProtocolExecutionRecipientHint {
  recipientId: string;
  recipientRole: string;
  executionLane?: string;
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

function summarizeProtocolArtifact(artifact: CreateIssueProtocolMessage["artifacts"][number]) {
  const metadata = asRecord(artifact.metadata);
  const summary: Record<string, unknown> = {
    kind: artifact.kind,
    label: artifact.label ?? null,
    uri: artifact.uri,
  };

  for (const key of [
    "bindingType",
    "cwd",
    "branchName",
    "headSha",
    "diffStat",
    "runId",
    "runStatus",
    "captureConfidence",
    "workspaceState",
    "hasLocalChanges",
    "observedStatus",
    "confidence",
  ] as const) {
    if (metadata[key] !== undefined) {
      summary[key] = metadata[key];
    }
  }

  if (Array.isArray(metadata.changedFiles)) {
    summary.changedFiles = metadata.changedFiles.filter((value): value is string => typeof value === "string");
  }

  return summary;
}

function buildReviewSubmissionSnapshot(
  message: CreateIssueProtocolMessage,
  protocolPayload: Record<string, unknown>,
) {
  if (message.messageType !== "SUBMIT_FOR_REVIEW") {
    return null;
  }

  const artifacts = message.artifacts.map((artifact) => summarizeProtocolArtifact(artifact));
  const implementationWorkspace =
    artifacts.find(
      (artifact) => artifact.kind === "doc" && artifact.bindingType === "implementation_workspace",
    ) ?? null;
  const diffArtifact = artifacts.find((artifact) => artifact.kind === "diff") ?? null;
  const verificationArtifacts = artifacts.filter(
    (artifact) => artifact.kind === "test_run" || artifact.kind === "build_run",
  );

  return {
    summary: message.summary,
    implementationSummary: protocolPayload.implementationSummary ?? null,
    diffSummary: protocolPayload.diffSummary ?? null,
    changedFiles: Array.isArray(protocolPayload.changedFiles)
      ? protocolPayload.changedFiles.filter((value): value is string => typeof value === "string")
      : [],
    reviewChecklist: Array.isArray(protocolPayload.reviewChecklist)
      ? protocolPayload.reviewChecklist.filter((value): value is string => typeof value === "string")
      : [],
    testResults: Array.isArray(protocolPayload.testResults)
      ? protocolPayload.testResults.filter((value): value is string => typeof value === "string")
      : [],
    evidence: Array.isArray(protocolPayload.evidence)
      ? protocolPayload.evidence.filter((value): value is string => typeof value === "string")
      : [],
    residualRisks: Array.isArray(protocolPayload.residualRisks)
      ? protocolPayload.residualRisks.filter((value): value is string => typeof value === "string")
      : [],
    implementationWorkspace,
    diffArtifact,
    verificationArtifacts,
    artifacts,
  };
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
    case "ANSWER_CLARIFICATION":
      return "protocol_clarification_answered";
    case "PROPOSE_PLAN":
      return "protocol_plan_proposed";
    case "START_IMPLEMENTATION":
      return "protocol_implementation_started";
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

function dependencyBlockedPhase(targetWorkflowState: string | null | undefined) {
  if (targetWorkflowState === "under_review" || targetWorkflowState === "under_qa_review") {
    return "review" as const;
  }
  if (targetWorkflowState === "planning") return "planning" as const;
  if (targetWorkflowState === "assigned") return "assignment" as const;
  return "implementing" as const;
}

function shouldWakeRecipientForMessage(messageType: string, recipientRole: string) {
  if (messageType === "CANCEL_TASK") {
    return false;
  }
  if (
    (messageType === "ASSIGN_TASK" || messageType === "REASSIGN_TASK")
    && (recipientRole === "reviewer" || recipientRole === "qa")
  ) {
    return false;
  }
  return true;
}

function buildDispatchPlanBase(input: {
  issueId: string;
  protocolMessageId: string;
  message: CreateIssueProtocolMessage;
  protocolPayload: Record<string, unknown>;
  wakeHints: Record<string, unknown>;
  source: ProtocolWakeSource;
  reason: string;
  recipient: CreateIssueProtocolMessage["recipients"][number];
  recipientHint?: ProtocolExecutionRecipientHint;
  issueContext?: InternalWorkItemSupervisorContext | null;
  dispatchMode?: ProtocolDispatchMode;
  forceFollowupRun?: boolean;
  forceFreshAdapterSession?: boolean;
}) {
  const internalMetadata = buildInternalWorkItemDispatchMetadata(input.issueContext);
  const reviewSubmission = buildReviewSubmissionSnapshot(input.message, input.protocolPayload);
  const dispatchMetadata =
    {
      ...(input.dispatchMode && input.dispatchMode !== "default"
        ? { protocolDispatchMode: input.dispatchMode }
        : {}),
      ...(input.forceFollowupRun ? { forceFollowupRun: true } : {}),
      ...(input.forceFreshAdapterSession ? { forceFreshAdapterSession: true } : {}),
    };

  return {
    recipientRole: input.recipient.role,
    recipientType: input.recipient.recipientType,
    recipientId: input.recipient.recipientId,
    reason: input.reason,
    source: input.source,
    payload: {
      ...input.wakeHints,
      issueId: input.issueId,
      protocolMessageId: input.protocolMessageId,
      protocolMessageType: input.message.messageType,
      protocolWorkflowStateBefore: input.message.workflowStateBefore,
      protocolWorkflowStateAfter: input.message.workflowStateAfter,
      protocolSummary: input.message.summary,
      protocolPayload: input.protocolPayload,
      ...internalMetadata,
      ...dispatchMetadata,
      ...(reviewSubmission ? { reviewSubmission } : {}),
      ...(input.recipientHint?.briefId ? { latestBriefId: input.recipientHint.briefId } : {}),
      ...(input.recipientHint?.briefScope ? { latestBriefScope: input.recipientHint.briefScope } : {}),
      ...(input.recipientHint?.retrievalRunId ? { retrievalRunId: input.recipientHint.retrievalRunId } : {}),
      ...(input.recipientHint?.executionLane ? { executionLane: input.recipientHint.executionLane } : {}),
      ...(input.recipientHint?.briefContentMarkdown || input.recipientHint?.briefEvidenceSummary?.length
        ? {
            taskBrief: {
              id: input.recipientHint?.briefId ?? null,
              scope: input.recipientHint?.briefScope ?? null,
              retrievalRunId: input.recipientHint?.retrievalRunId ?? null,
              executionLane: input.recipientHint?.executionLane ?? null,
              contentMarkdown: input.recipientHint?.briefContentMarkdown ?? null,
              evidence: input.recipientHint?.briefEvidenceSummary ?? [],
            },
          }
        : {}),
    },
    contextSnapshot: {
      ...input.wakeHints,
      issueId: input.issueId,
      taskId: input.issueId,
      protocolMessageId: input.protocolMessageId,
      protocolMessageType: input.message.messageType,
      protocolWorkflowStateBefore: input.message.workflowStateBefore,
      protocolWorkflowStateAfter: input.message.workflowStateAfter,
      protocolSummary: input.message.summary,
      wakeReason: input.reason,
      source: "issue.protocol",
      protocolRecipientRole: input.recipient.role,
      protocolSenderRole: input.message.sender.role,
      protocolPayload: input.protocolPayload,
      ...internalMetadata,
      ...dispatchMetadata,
      ...(reviewSubmission ? { reviewSubmission } : {}),
      ...(input.recipientHint?.briefId ? { latestBriefId: input.recipientHint.briefId } : {}),
      ...(input.recipientHint?.briefScope ? { latestBriefScope: input.recipientHint.briefScope } : {}),
      ...(input.recipientHint?.retrievalRunId ? { retrievalRunId: input.recipientHint.retrievalRunId } : {}),
      ...(input.recipientHint?.executionLane ? { executionLane: input.recipientHint.executionLane } : {}),
      ...(input.recipientHint?.briefContentMarkdown || input.recipientHint?.briefEvidenceSummary?.length
        ? {
            taskBrief: {
              id: input.recipientHint?.briefId ?? null,
              scope: input.recipientHint?.briefScope ?? null,
              retrievalRunId: input.recipientHint?.retrievalRunId ?? null,
              executionLane: input.recipientHint?.executionLane ?? null,
              contentMarkdown: input.recipientHint?.briefContentMarkdown ?? null,
              evidence: input.recipientHint?.briefEvidenceSummary ?? [],
            },
          }
        : {}),
    },
  };
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
  issueContext?: InternalWorkItemSupervisorContext | null;
}) {
  const reason = protocolExecutionReason(input.message.messageType);
  const source = protocolExecutionSource(input.message.messageType);
  const protocolPayload = asRecord(input.message.payload);
  const wakeHints = protocolWakeHints(protocolPayload);
  const internalWorkItemKind = getInternalWorkItemKind(input.issueContext);

  const plan = input.message.recipients.map<ProtocolExecutionDispatchPlanItem>((recipient) => {
    const recipientHint = input.recipientHints?.find(
      (hint) => hint.recipientId === recipient.recipientId && hint.recipientRole === recipient.role,
    );
    // Engineer self-START coalesces into the active run instead of forcing a
    // separate followup. The workspace override ensures the single run still
    // resolves to the implementation workspace.
    const engineerSelfStart =
      recipient.recipientType === "agent"
      && recipient.role === "engineer"
      && input.message.messageType === "START_IMPLEMENTATION"
      && Boolean(input.senderAgentId)
      && recipient.recipientId === input.senderAgentId;
    // Change-request recovery must always land in a fresh followup run. If it
    // coalesces into the active implementation run, the prior SUBMIT_FOR_REVIEW
    // can incorrectly satisfy the protocol progress requirement without an
    // explicit ACK_CHANGE_REQUEST recovery cycle.
    const engineerChangeRequestRecovery =
      recipient.recipientType === "agent"
      && recipient.role === "engineer"
      && input.message.messageType === "REQUEST_CHANGES";
    const leadChangeRequestWatchOnly =
      recipient.recipientType === "agent"
      && recipient.role === "tech_lead"
      && input.message.messageType === "REQUEST_CHANGES"
      && input.message.recipients.some(
        (candidate) => candidate.recipientType === "agent" && candidate.role === "engineer",
      );
    const reviewerWatchActive =
      recipient.recipientType === "agent" &&
      recipient.role === "reviewer" &&
      (input.message.messageType === "ASSIGN_TASK" || input.message.messageType === "REASSIGN_TASK") &&
      internalWorkItemKind !== "implementation" &&
      isReviewerWatchEnabled(input.issueContext);
    const approvalCloseDirectRecipient =
      recipient.recipientType === "agent" &&
      recipient.role === "tech_lead" &&
      input.message.messageType === "APPROVE_IMPLEMENTATION" &&
      input.message.workflowStateAfter === "approved";
    const leadImplementationWatchOnly =
      recipient.recipientType === "agent" &&
      recipient.role === "tech_lead" &&
      (input.message.messageType === "ASSIGN_TASK" || input.message.messageType === "REASSIGN_TASK") &&
      internalWorkItemKind === "implementation" &&
      isLeadWatchEnabled(input.issueContext) &&
      typeof protocolPayload.assigneeAgentId === "string" &&
      protocolPayload.assigneeAgentId.trim().length > 0 &&
      protocolPayload.assigneeAgentId !== recipient.recipientId;
    const base = buildDispatchPlanBase({
      issueId: input.issueId,
      protocolMessageId: input.protocolMessageId,
      message: input.message,
      protocolPayload,
      wakeHints: {
        ...wakeHints,
        ...(engineerSelfStart || engineerChangeRequestRecovery ? { workspaceUsageOverride: "implementation" } : {}),
        ...(recipient.role === "qa" ? { readOnlyWorkspace: true } : {}),
      },
      source,
      reason:
        approvalCloseDirectRecipient
          ? "issue_ready_for_closure"
          : reviewerWatchActive
            ? reviewerWatchReason(input.message.messageType)
            : reason,
      recipient,
      recipientHint,
      issueContext: input.issueContext,
      dispatchMode:
        approvalCloseDirectRecipient
          ? "approval_close_followup"
          : reviewerWatchActive
            ? "reviewer_watch"
            : "default",
      forceFollowupRun:
        engineerSelfStart || engineerChangeRequestRecovery || approvalCloseDirectRecipient,
      forceFreshAdapterSession: approvalCloseDirectRecipient,
    });

    if (recipient.recipientType !== "agent") {
      return { kind: "notify_only", ...base };
    }

    if (leadImplementationWatchOnly) {
      return { kind: "notify_only", ...base };
    }

    if (leadChangeRequestWatchOnly) {
      return { kind: "notify_only", ...base };
    }

    if (!reviewerWatchActive && !shouldWakeRecipientForMessage(input.message.messageType, recipient.role)) {
      return { kind: "notify_only", ...base };
    }

    if (input.senderAgentId && recipient.recipientId === input.senderAgentId && !engineerSelfStart) {
      return { kind: "skip_sender", ...base };
    }

    return { kind: "wakeup", ...base };
  });

  const leadSupervisorReason = leadSupervisorProtocolReason(input.message.messageType);
  const leadSupervisorAgentId =
    leadSupervisorReason && isLeadWatchEnabled(input.issueContext)
      ? input.issueContext?.techLeadAgentId ?? null
      : null;

  const approvalCloseFollowupAgentId =
    input.message.messageType === "APPROVE_IMPLEMENTATION" && input.message.workflowStateAfter === "approved"
      ? input.issueContext?.techLeadAgentId ?? null
      : null;
  const qaGateFollowupAgentId =
    input.message.messageType === "APPROVE_IMPLEMENTATION" && input.message.workflowStateAfter === "qa_pending"
      ? input.issueContext?.qaAgentId ?? null
      : null;

  if (
    qaGateFollowupAgentId
    && !input.message.recipients.some(
      (recipient) =>
        recipient.recipientType === "agent"
        && recipient.recipientId === qaGateFollowupAgentId
        && recipient.role === "qa",
    )
  ) {
    plan.push({
      kind: "wakeup",
      ...buildDispatchPlanBase({
        issueId: input.issueId,
        protocolMessageId: input.protocolMessageId,
        message: input.message,
        protocolPayload,
        wakeHints: { ...wakeHints, readOnlyWorkspace: true },
        source,
        reason: "issue_ready_for_qa_gate",
        recipient: {
          recipientType: "agent",
          recipientId: qaGateFollowupAgentId,
          role: "qa",
        },
        issueContext: input.issueContext,
        dispatchMode: "qa_gate_followup",
        forceFollowupRun: true,
      }),
    });
  }

  if (
    approvalCloseFollowupAgentId
    && !input.message.recipients.some(
      (recipient) =>
        recipient.recipientType === "agent"
        && recipient.recipientId === approvalCloseFollowupAgentId
        && recipient.role === "tech_lead",
    )
  ) {
    plan.push({
      kind: "wakeup",
      ...buildDispatchPlanBase({
        issueId: input.issueId,
        protocolMessageId: input.protocolMessageId,
        message: input.message,
        protocolPayload,
        wakeHints,
        source,
        reason: "issue_ready_for_closure",
        recipient: {
          recipientType: "agent",
          recipientId: approvalCloseFollowupAgentId,
          role: "tech_lead",
        },
        issueContext: input.issueContext,
        dispatchMode: "approval_close_followup",
        forceFollowupRun: true,
        forceFreshAdapterSession: true,
      }),
    });
  }

  if (
    leadSupervisorAgentId &&
    !input.message.recipients.some(
      (recipient) => recipient.recipientType === "agent" && recipient.recipientId === leadSupervisorAgentId,
    )
  ) {
    const leadBase = buildDispatchPlanBase({
      issueId: input.issueId,
      protocolMessageId: input.protocolMessageId,
      message: input.message,
      protocolPayload,
      wakeHints,
      source,
      reason: leadSupervisorReason,
      recipient: {
        recipientType: "agent",
        recipientId: leadSupervisorAgentId,
        role: "tech_lead",
      },
      issueContext: input.issueContext,
      dispatchMode: "lead_supervisor",
    });

    if (input.senderAgentId && leadSupervisorAgentId === input.senderAgentId) {
      plan.push({ kind: "skip_sender", ...leadBase });
    } else {
      plan.push({ kind: "wakeup", ...leadBase });
    }
  }

  return plan;
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
      const issueContext = await loadInternalWorkItemSupervisorContext(db, input.companyId, input.issueId);
      const plan = buildProtocolExecutionDispatchPlan({
        issueId: input.issueId,
        protocolMessageId: input.protocolMessageId,
        message: input.message,
        senderAgentId: input.actor.agentId,
        recipientHints: input.recipientHints,
        issueContext,
      });
      const currentState = await db
        .select({
          workflowState: issueProtocolState.workflowState,
          metadata: issueProtocolState.metadata,
        })
        .from(issueProtocolState)
        .where(and(eq(issueProtocolState.issueId, input.issueId), eq(issueProtocolState.companyId, input.companyId)))
        .limit(1)
        .then((rows) => rows[0] ?? null);

      const storedDependencyGraph = readIssueDependencyGraphMetadata(currentState?.metadata ?? null);
      const dependencyGraph =
        await resolveIssueDependencyGraphMetadata(db, {
          companyId: input.companyId,
          issueId: input.issueId,
          payload: input.message.payload,
          existingMetadata: currentState?.metadata ?? {},
        })
        ?? storedDependencyGraph;
      const executionWakeups = plan.filter(
        (item) => item.kind === "wakeup" && item.recipientType === "agent",
      );

      if (executionWakeups.length > 0 && hasBlockingIssueDependencies(dependencyGraph)) {
        const now = new Date();
        const blockingSummary = buildIssueDependencyBlockingSummary(dependencyGraph);
        const nextMetadata = {
          ...(currentState?.metadata ?? {}),
          dependencyGraph,
          dependencyBlock: {
            blockedAt: now.toISOString(),
            blockedByMessageType: input.message.messageType,
            blockedByProtocolMessageId: input.protocolMessageId,
            pendingWorkflowState: currentState?.workflowState ?? input.message.workflowStateAfter,
            summary: blockingSummary,
          },
        };

        await db.transaction(async (tx) => {
          await tx
            .update(issueProtocolState)
            .set({
              workflowState: "blocked",
              coarseIssueStatus: "blocked",
              lastTransitionAt: now,
              blockedPhase: dependencyBlockedPhase(currentState?.workflowState ?? input.message.workflowStateAfter),
              blockedCode: "dependency_wait",
              blockedByMessageId: input.protocolMessageId,
              metadata: nextMetadata,
            })
            .where(eq(issueProtocolState.issueId, input.issueId));

          await tx
            .update(issues)
            .set({
              status: "blocked",
              updatedAt: now,
            })
            .where(and(eq(issues.id, input.issueId), eq(issues.companyId, input.companyId)));
        });

        await logActivity(db, {
          companyId: input.companyId,
          actorType: input.actor.actorType,
          actorId: input.actor.actorId,
          agentId: input.actor.agentId,
          runId: input.actor.runId,
          action: "issue.protocol_dispatch.blocked_by_dependency",
          entityType: "issue",
          entityId: input.issueId,
          details: {
            protocolMessageId: input.protocolMessageId,
            protocolMessageType: input.message.messageType,
            blockingIssueIds: dependencyGraph?.blockingIssueIds ?? [],
            blockingSummary,
          },
        });

        return {
          queued: 0,
          notifyOnly: plan.filter((item) => item.kind === "notify_only").length,
          skipped: plan.filter((item) => item.kind === "skip_sender").length + executionWakeups.length,
        };
      }

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

        if (!canDispatchProtocolToAdapter(recipientAgent.adapterType)) {
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
