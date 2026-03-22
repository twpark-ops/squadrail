import { Router, type Request, type Response } from "express";
import multer from "multer";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { enqueueAfterDbCommit, runWithoutDbContext, type Db } from "@squadrail/db";
import {
  addIssueCommentSchema,
  createInternalWorkItemSchema,
  createIssueLabelSchema,
  checkoutIssueSchema,
  createIssueSchema,
  createIssueProtocolMessageSchema,
  type CreateIssueProtocolMessage,
  updateIssueSchema,
  isUuidLike,
} from "@squadrail/shared";
import type { StorageService } from "../storage/types.js";
import { validate } from "../middleware/validate.js";
import {
  accessService,
  agentService,
  buildMergeAutomationPlan,
  goalService,
  heartbeatService,
  issueApprovalService,
  issueProtocolExecutionService,
  protocolDispatchOutboxService,
  issueRetrievalService,
  issueProtocolService,
  organizationalMemoryService,
  resolvePmIntakeAgents,
  derivePmIntakeIssueTitle,
  buildPmIntakeIssueDescription,
  buildPmIntakeAssignment,
  buildPmIntakeProjectionPreview,
  retrievalPersonalizationService,
  issueService,
  knowledgeService,
  logActivity,
  projectService,
  runMergeAutomationAction,
} from "../services/index.js";
import { buildIssueChangeSurface } from "../services/issue-change-surface.js";
import { computeIssueRuntimeSummary } from "../services/issue-runtime-summary.js";
import { computeIssueProgressSnapshot, computeSimplifiedIssueProgressSnapshot } from "../services/issue-progress-snapshot.js";
import { issueMergeCandidateService } from "../services/issue-merge-candidates.js";
import { summarizeIssueFailureLearning } from "../services/failure-learning.js";
import { logger } from "../middleware/logger.js";
import { conflict, forbidden, HttpError, notFound, unauthorized, unprocessable } from "../errors.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import {
  enrichProtocolMessageArtifactsFromRun,
  runMatchesIssueScope,
} from "../services/protocol-run-artifacts.js";
import { shouldSkipSupersededProtocolFollowup } from "../services/heartbeat.js";
import {
  maybeApplyPreRetrievalSupervisorReroute,
  resolvePreRetrievalAutoAssistRecipient,
  shouldDispatchBeforeProtocolRetrieval,
} from "../services/protocol-dispatch-routing.js";
import { registerIssueApprovalRoutes } from "./issues/approvals-routes.js";
import { registerIssueAttachmentRoutes } from "./issues/attachments-routes.js";
import { registerIssueIntakeRoutes } from "./issues/intake-routes.js";
import { registerIssueMergeRoutes } from "./issues/merge-routes.js";
import { registerIssueProtocolReadRoutes } from "./issues/protocol-read-routes.js";
import { registerIssueDeliverablesRoutes } from "./issues/deliverables-routes.js";
import { registerIssueDocumentRoutes } from "./issues/documents-routes.js";
import type { IssueRouteContext } from "./issues/context.js";

const MAX_ATTACHMENT_BYTES = Number(process.env.SQUADRAIL_ATTACHMENT_MAX_BYTES) || 10 * 1024 * 1024;
const ALLOWED_ATTACHMENT_CONTENT_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
]);

/**
 * Map agent role to protocol role for validation
 */
export function getProtocolRole(agentRole: string): string {
  if (agentRole === "cto") return "cto";
  if (agentRole === "pm") return "pm";
  if (agentRole === "qa") return "qa";
  if (agentRole === "engineer") return "engineer";
  if (agentRole === "manager" || agentRole === "tech_lead") return "tech_lead";
  return "reviewer";
}

export function getAllowedProtocolRoles(agent: {
  role: string;
  title?: string | null;
  urlKey?: string | null;
}) {
  const allowed = new Set<string>([agent.role, getProtocolRole(agent.role)]);
  if (agent.role === "qa") {
    allowed.add("reviewer");
  }
  if (typeof agent.title === "string" && /reviewer/i.test(agent.title)) {
    allowed.add("reviewer");
  }
  if (typeof agent.urlKey === "string" && /(?:^|-)(reviewer)(?:-|$)/i.test(agent.urlKey)) {
    allowed.add("reviewer");
  }
  if (typeof agent.title === "string" && /tech lead/i.test(agent.title)) {
    allowed.add("tech_lead");
    allowed.add("reviewer");
  }
  return allowed;
}

export function canBypassAssignPermissionForProtocolMessage(message: {
  messageType: string;
  sender: { actorType: string; role: string };
}) {
  if (message.sender.actorType !== "agent") return false;
  if (
    message.sender.role !== "tech_lead"
    && message.sender.role !== "cto"
    && message.sender.role !== "pm"
  ) {
    return false;
  }

  return (
    message.messageType === "REASSIGN_TASK"
    || message.messageType === "CLOSE_TASK"
    || message.messageType === "CANCEL_TASK"
  );
}

function readProtocolHelperTransportHeader(req: Request) {
  const transport = req.header("x-squadrail-protocol-helper")?.trim();
  if (!transport) return null;
  const command = req.header("x-squadrail-protocol-helper-command")?.trim() ?? null;
  return {
    transport,
    command,
  };
}

function readRunContextProtocolField(
  contextSnapshot: unknown,
  key: "protocolMessageType" | "protocolRecipientRole",
) {
  if (!contextSnapshot || typeof contextSnapshot !== "object" || Array.isArray(contextSnapshot)) {
    return null;
  }
  const value = (contextSnapshot as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

const PROTOCOL_RETRIEVAL_MESSAGE_TYPES = new Set<CreateIssueProtocolMessage["messageType"]>([
  "ASSIGN_TASK",
  "REASSIGN_TASK",
  "ASK_CLARIFICATION",
  "ANSWER_CLARIFICATION",
  "PROPOSE_PLAN",
  "ESCALATE_BLOCKER",
  "SUBMIT_FOR_REVIEW",
  "REQUEST_CHANGES",
  "TIMEOUT_ESCALATION",
]);

const mergeCandidateActionSchema = z.object({
  actionType: z.enum(["mark_merged", "mark_rejected"]),
  noteBody: z.string().trim().max(4_000).nullable().optional(),
  targetBaseBranch: z.string().trim().max(255).nullable().optional(),
  mergeCommitSha: z.string().trim().max(255).nullable().optional(),
}).strict();

const mergeCandidateAutomationSchema = z.object({
  actionType: z.enum([
    "prepare_merge",
    "export_patch",
    "export_pr_bundle",
    "merge_local",
    "cherry_pick_local",
    "push_branch",
    "sync_pr_bridge",
  ]),
  targetBaseBranch: z.string().trim().max(255).nullable().optional(),
  integrationBranchName: z.string().trim().max(255).nullable().optional(),
  remoteName: z.string().trim().max(255).nullable().optional(),
  branchName: z.string().trim().max(255).nullable().optional(),
  pushAfterAction: z.boolean().optional(),
}).strict();

const retrievalFeedbackSchema = z.object({
  retrievalRunId: z.string().uuid(),
  feedbackType: z.enum(["operator_pin", "operator_hide"]),
  targetType: z.enum(["chunk", "path", "symbol", "source_type"]),
  targetIds: z.array(z.string().trim().min(1)).min(1).max(32),
  noteBody: z.string().trim().max(4_000).nullable().optional(),
}).strict();

export function shouldGenerateProtocolRetrievalContext(
  messageType: CreateIssueProtocolMessage["messageType"],
) {
  return PROTOCOL_RETRIEVAL_MESSAGE_TYPES.has(messageType);
}

export { shouldDispatchBeforeProtocolRetrieval, resolvePreRetrievalAutoAssistRecipient };

const PM_INTAKE_LABEL_SPECS = [
  { name: "workflow:intake", color: "#2563EB" },
  { name: "lane:pm", color: "#0F766E" },
  { name: "source:human_request", color: "#7C3AED" },
] as const;

export function readString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function buildMentionProtocolContext(input: {
  issue: { assigneeAgentId?: string | null };
  mentionedAgentId: string;
  protocolState: Record<string, unknown> | null;
}) {
  const workflowState = readString(input.protocolState?.workflowState);
  if (!workflowState) return {};

  if (
    input.issue.assigneeAgentId === input.mentionedAgentId
    && (workflowState === "implementing" || workflowState === "changes_requested")
  ) {
    return {
      protocolRecipientRole: "engineer",
      protocolWorkflowStateAfter: workflowState,
    };
  }

  if (
    readString(input.protocolState?.reviewerAgentId) === input.mentionedAgentId
    && (workflowState === "submitted_for_review" || workflowState === "under_review")
  ) {
    return {
      protocolRecipientRole: "reviewer",
      protocolWorkflowStateAfter: workflowState,
    };
  }

  if (
    readString(input.protocolState?.qaAgentId) === input.mentionedAgentId
    && (workflowState === "qa_pending" || workflowState === "under_qa_review")
  ) {
    return {
      protocolRecipientRole: "qa",
      protocolWorkflowStateAfter: workflowState,
    };
  }

  return {};
}

export function withIssueAttachmentContentPath<T extends { id: string }>(attachment: T) {
  return {
    ...attachment,
    contentPath: `/api/attachments/${attachment.id}/content`,
  };
}

export function scheduleIssueMemoryIngestHelper(input: {
  organizationalMemory: {
    ingestIssueSnapshot(args: { issueId: string; mutation: "create" | "update" | "internal_work_item" }): Promise<unknown>;
  };
  issueId: string;
  mutation: "create" | "update" | "internal_work_item";
}) {
  const schedule = () => {
    runWithoutDbContext(() => {
      void input.organizationalMemory
        .ingestIssueSnapshot({ issueId: input.issueId, mutation: input.mutation })
        .catch((err) => logger.error(
          { err, issueId: input.issueId, mutation: input.mutation },
          "issue organizational memory ingest failed",
        ));
    });
  };
  if (!enqueueAfterDbCommit(schedule)) {
    schedule();
  }
}

export function scheduleProtocolMemoryIngestHelper(input: {
  organizationalMemory: {
    ingestProtocolMessage(args: { messageId: string }): Promise<unknown>;
  };
  messageId: string;
  issueId: string;
  messageType: string;
}) {
  const schedule = () => {
    runWithoutDbContext(() => {
      void input.organizationalMemory
        .ingestProtocolMessage({ messageId: input.messageId })
        .catch((err) => logger.error(
          { err, issueId: input.issueId, messageId: input.messageId, messageType: input.messageType },
          "protocol organizational memory ingest failed",
        ));
    });
  };
  if (!enqueueAfterDbCommit(schedule)) {
    schedule();
  }
}

export async function ensureIssueLabelsByNameHelper<TLabel extends { id: string; name: string; color: string }>(input: {
  svc: {
    listLabels(companyId: string): Promise<TLabel[]>;
    createLabel(companyId: string, spec: { name: string; color: string }): Promise<TLabel>;
  };
  companyId: string;
  specs: ReadonlyArray<{ name: string; color: string }>;
}) {
  const existing = await input.svc.listLabels(input.companyId);
  const labelByName = new Map(existing.map((label) => [label.name, label] as const));
  const resolved = [];
  for (const spec of input.specs) {
    let label = labelByName.get(spec.name);
    if (!label) {
      try {
        label = await input.svc.createLabel(input.companyId, spec);
      } catch {
        label = (await input.svc.listLabels(input.companyId)).find((entry) => entry.name === spec.name);
      }
      if (!label) {
        throw conflict(`Failed to create reserved label ${spec.name}`);
      }
      labelByName.set(spec.name, label);
    }
    resolved.push(label);
  }
  return resolved;
}

export function canManageTaskAssignmentsLegacy(agent: {
  permissions: Record<string, unknown> | null | undefined;
  role: string;
  title?: string | null;
}) {
  if (agent.role === "ceo" || agent.role === "cto") return true;
  if (typeof agent.title === "string" && /tech lead/i.test(agent.title)) return true;
  if (!agent.permissions || typeof agent.permissions !== "object") return false;
  const permissions = agent.permissions as Record<string, unknown>;
  return Boolean(permissions.canCreateAgents || permissions.canAssignTasks);
}

const PM_PROJECTION_SECTION_START = "<!-- squadrail:intake-projection:start -->";
const PM_PROJECTION_SECTION_END = "<!-- squadrail:intake-projection:end -->";

type IssueRouteAgentLookup = {
  getById(agentId: string): Promise<{
    id: string;
    companyId: string;
    name: string;
    role: string;
    status: string;
    reportsTo: string | null;
    title?: string | null;
    permissions?: Record<string, unknown> | null | undefined;
  } | null>;
};

export async function assertActiveCompanyAgentHelper(input: {
  agentsSvc: IssueRouteAgentLookup;
  companyId: string;
  agentId: string;
  label: "Assignee" | "Reviewer" | "Tech Lead" | "QA";
}) {
  const agent = await input.agentsSvc.getById(input.agentId);
  if (!agent || agent.companyId !== input.companyId) {
    throw notFound(`${input.label} agent not found`);
  }
  if (agent.status === "pending_approval") {
    throw conflict(`Cannot assign ${input.label.toLowerCase()} to pending approval agents`);
  }
  if (agent.status === "terminated") {
    throw conflict(`Cannot assign ${input.label.toLowerCase()} to terminated agents`);
  }
  return agent;
}

export async function assertInternalWorkItemAssigneeHelper(input: {
  agentsSvc: IssueRouteAgentLookup;
  companyId: string;
  assigneeAgentId: string;
}) {
  const assignee = await assertActiveCompanyAgentHelper({
    agentsSvc: input.agentsSvc,
    companyId: input.companyId,
    agentId: input.assigneeAgentId,
    label: "Assignee",
  });
  const allowedRoles = getAllowedProtocolRoles(assignee);
  if (allowedRoles.has("engineer")) {
    return { agent: assignee, protocolRole: "engineer" as const };
  }
  throw unprocessable("Assignee agent must support engineer protocol role");
}

export async function assertInternalWorkItemReviewerHelper(input: {
  agentsSvc: IssueRouteAgentLookup;
  companyId: string;
  reviewerAgentId: string;
}) {
  const reviewer = await assertActiveCompanyAgentHelper({
    agentsSvc: input.agentsSvc,
    companyId: input.companyId,
    agentId: input.reviewerAgentId,
    label: "Reviewer",
  });
  const allowedRoles = getAllowedProtocolRoles(reviewer);
  if (!allowedRoles.has("reviewer")) {
    throw unprocessable("Reviewer agent must support reviewer protocol role");
  }
  return reviewer;
}

export async function assertInternalWorkItemQaHelper(input: {
  agentsSvc: IssueRouteAgentLookup;
  companyId: string;
  qaAgentId: string;
}) {
  const qaAgent = await assertActiveCompanyAgentHelper({
    agentsSvc: input.agentsSvc,
    companyId: input.companyId,
    agentId: input.qaAgentId,
    label: "QA",
  });
  const allowedRoles = getAllowedProtocolRoles(qaAgent);
  if (!allowedRoles.has("qa")) {
    throw unprocessable("QA agent must support qa protocol role");
  }
  return qaAgent;
}

export async function assertInternalWorkItemLeadSupervisorHelper(input: {
  agentsSvc: IssueRouteAgentLookup;
  companyId: string;
  techLeadAgentId: string;
}) {
  const techLead = await assertActiveCompanyAgentHelper({
    agentsSvc: input.agentsSvc,
    companyId: input.companyId,
    agentId: input.techLeadAgentId,
    label: "Tech Lead",
  });
  const allowedRoles = getAllowedProtocolRoles(techLead);
  if (!allowedRoles.has("tech_lead")) {
    throw unprocessable("Lead supervisor agent must support tech_lead protocol role");
  }
  return techLead;
}

export async function buildTaskAssignmentSenderHelper(input: {
  actor: Request["actor"];
  actorInfo: ReturnType<typeof getActorInfo>;
  companyId: string;
  agentsSvc: IssueRouteAgentLookup;
}) {
  if (input.actor.type === "board") {
    return {
      actorType: "user" as const,
      actorId: input.actorInfo.actorId,
      role: "human_board" as const,
    };
  }

  if (!input.actor.agentId) {
    throw forbidden("Agent authentication required");
  }

  const agent = await input.agentsSvc.getById(input.actor.agentId);
  if (!agent || agent.companyId !== input.companyId) {
    throw forbidden("Agent not found");
  }

  if (agent.role === "cto") {
    return { actorType: "agent" as const, actorId: agent.id, role: "cto" as const };
  }
  if (agent.role === "pm") {
    return { actorType: "agent" as const, actorId: agent.id, role: "pm" as const };
  }
  if (agent.role === "tech_lead" || agent.role === "manager" || /tech lead/i.test(agent.title ?? "")) {
    return { actorType: "agent" as const, actorId: agent.id, role: "tech_lead" as const };
  }

  throw forbidden("Agent cannot create internal work items through protocol assignment");
}

export function buildInternalWorkItemLabelNames(input: {
  kind: "plan" | "implementation" | "review" | "qa";
  watchReviewer?: boolean;
  watchLead?: boolean;
}) {
  return [
    "team:internal",
    input.kind === "plan"
      ? "work:plan"
      : input.kind === "implementation"
        ? "work:implementation"
        : input.kind === "review"
          ? "work:review"
          : "work:qa",
    ...(input.watchReviewer === false ? [] : ["watch:reviewer"]),
    ...(input.watchLead === false ? [] : ["watch:lead"]),
  ];
}

export function replaceMarkedSection(input: {
  description: string | null | undefined;
  content: string;
}) {
  const existing = (input.description ?? "").trim();
  const nextSection = [
    PM_PROJECTION_SECTION_START,
    input.content.trim(),
    PM_PROJECTION_SECTION_END,
  ].join("\n");

  if (!existing) return nextSection;

  const pattern = new RegExp(
    `${PM_PROJECTION_SECTION_START}[\\s\\S]*?${PM_PROJECTION_SECTION_END}\\n*`,
    "g",
  );
  const withoutOld = existing.replace(pattern, "").trim();
  return [withoutOld, nextSection].filter(Boolean).join("\n\n");
}

export function buildPmProjectionRootDescription(input: {
  requestDescription: string | null | undefined;
  projectName: string | null;
  techLeadName: string;
  reviewerName: string;
  qaName: string | null;
  root: {
    executionSummary: string;
    acceptanceCriteria: string[];
    definitionOfDone: string[];
    risks?: string[];
    openQuestions?: string[];
    documentationDebt?: string[];
  };
}) {
  const lines = [
    "## Intake Structuring Snapshot",
    "",
    `- Routed to TL: ${input.techLeadName}`,
    `- Reviewer: ${input.reviewerName}`,
    `- QA gate: ${input.qaName ?? "not required"}`,
    input.projectName ? `- Project: ${input.projectName}` : null,
    "",
    "### Execution Summary",
    "",
    input.root.executionSummary,
    "",
    "### Acceptance Criteria",
    "",
    ...input.root.acceptanceCriteria.map((item) => `- ${item}`),
    "",
    "### Definition of Done",
    "",
    ...input.root.definitionOfDone.map((item) => `- ${item}`),
  ].filter((line): line is string => line !== null);

  if (input.root.risks && input.root.risks.length > 0) {
    lines.push("", "### Risks", "", ...input.root.risks.map((item) => `- ${item}`));
  }
  if (input.root.openQuestions && input.root.openQuestions.length > 0) {
    lines.push("", "### Open Questions", "", ...input.root.openQuestions.map((item) => `- ${item}`));
  }
  if (input.root.documentationDebt && input.root.documentationDebt.length > 0) {
    lines.push("", "### Documentation Debt", "", ...input.root.documentationDebt.map((item) => `- ${item}`));
  }

  return replaceMarkedSection({
    description: input.requestDescription,
    content: lines.join("\n"),
  });
}

export function issueRoutes(
  db: Db,
  storage: StorageService,
  opts?: { maxDocumentBodyChars?: number },
) {
  const router = Router();
  const svc = issueService(db);
  const access = accessService(db);
  const heartbeat = heartbeatService(db);
  const agentsSvc = agentService(db);
  const knowledge = knowledgeService(db);
  const projectsSvc = projectService(db);
  const goalsSvc = goalService(db);
  const issueApprovalsSvc = issueApprovalService(db);
  const protocolExecution = issueProtocolExecutionService(db);
  const protocolDispatchOutbox = protocolDispatchOutboxService(db);
  const issueRetrieval = issueRetrievalService(db);
  const protocolSvc = issueProtocolService(db);
  const organizationalMemory = organizationalMemoryService(db);
  const retrievalPersonalization = retrievalPersonalizationService(db);
  const mergeCandidatesSvc = issueMergeCandidateService(db);
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 1 },
  });

  function scheduleIssueMemoryIngest(issueId: string, mutation: "create" | "update" | "internal_work_item") {
    scheduleIssueMemoryIngestHelper({ organizationalMemory, issueId, mutation });
  }

  function scheduleProtocolMemoryIngest(messageId: string, issueId: string, messageType: string) {
    scheduleProtocolMemoryIngestHelper({ organizationalMemory, messageId, issueId, messageType });
  }

  async function ensureIssueLabelsByName(companyId: string, specs: ReadonlyArray<{ name: string; color: string }>) {
    return ensureIssueLabelsByNameHelper({ svc, companyId, specs });
  }

  async function loadIssueChangeSurface(issue: {
    id: string;
    identifier: string | null;
    title: string;
    status?: string | null;
    companyId?: string | null;
    projectId?: string | null;
  }) {
    const [messages, mergeCandidateRecord, briefs, retrievalFeedbackSummary, failureLearningGate] = await Promise.all([
      protocolSvc.listMessages(issue.id),
      mergeCandidatesSvc.getByIssueId(issue.id),
      knowledge.listTaskBriefs({ issueId: issue.id, limit: 20 }),
      issue.companyId
        ? retrievalPersonalization.summarizeIssueFeedback({
          companyId: issue.companyId,
          issueId: issue.id,
        })
        : Promise.resolve(null),
      issue.companyId
        ? summarizeIssueFailureLearning(db, {
          companyId: issue.companyId,
          issueId: issue.id,
        })
        : Promise.resolve(null),
    ]);
    return buildIssueChangeSurface({
      issue: {
        ...issue,
        status: issue.status ?? "done",
      },
      messages,
      mergeCandidateRecord,
      briefs,
      retrievalFeedbackSummary,
      failureLearningGate,
    });
  }

  async function syncMergeCandidateFromProtocolMessage(input: {
    issue: {
      id: string;
      companyId: string;
      identifier: string | null;
      title: string;
      status?: string | null;
      projectId: string | null;
    };
    actor: ReturnType<typeof getActorInfo>;
    message: CreateIssueProtocolMessage;
    persistedMessageId: string;
  }) {
    if (input.message.messageType === "CANCEL_TASK") {
      await mergeCandidatesSvc.deleteByIssueId(input.issue.id);
      return;
    }
    if (input.message.messageType !== "CLOSE_TASK") return;

    const payload = (input.message.payload ?? {}) as Record<string, unknown>;
    const mergeStatus = readString(payload.mergeStatus);
    if (mergeStatus === "pending_external_merge") {
      const surface = await loadIssueChangeSurface(input.issue);
      if (!surface.mergeCandidate) return;
      await mergeCandidatesSvc.upsertDecision({
        companyId: input.issue.companyId,
        issueId: input.issue.id,
        closeMessageId: input.persistedMessageId,
        state: "pending",
        sourceBranch: surface.mergeCandidate.sourceBranch,
        workspacePath: surface.mergeCandidate.workspacePath,
        headSha: surface.mergeCandidate.headSha,
        diffStat: surface.mergeCandidate.diffStat,
        targetBaseBranch:
          readString(payload.targetBaseBranch)
          ?? surface.mergeCandidate.targetBaseBranch
          ?? null,
        automationMetadata: {
          ...(surface.mergeCandidate.automationMetadata ?? {}),
          pendingCreatedAt: new Date().toISOString(),
          lastCloseMessageId: input.persistedMessageId,
        },
        operatorActorType: input.actor.actorType,
        operatorActorId: input.actor.actorId,
        operatorNote: null,
      });
      return;
    }

    if (mergeStatus === "merged" || mergeStatus === "merge_not_required") {
      await mergeCandidatesSvc.deleteByIssueId(input.issue.id);
    }
  }

  async function runSingleFileUpload(req: Request, res: Response) {
    await new Promise<void>((resolve, reject) => {
      upload.single("file")(req, res, (err: unknown) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async function assertCanManageIssueApprovalLinks(req: Request, res: Response, companyId: string) {
    assertCompanyAccess(req, companyId);
    if (req.actor.type === "board") return true;
    if (!req.actor.agentId) {
      res.status(403).json({ error: "Agent authentication required" });
      return false;
    }
    const actorAgent = await agentsSvc.getById(req.actor.agentId);
    if (!actorAgent || actorAgent.companyId !== companyId) {
      res.status(403).json({ error: "Forbidden" });
      return false;
    }
    if (actorAgent.role === "ceo" || Boolean(actorAgent.permissions?.canCreateAgents)) return true;
    res.status(403).json({ error: "Missing permission to link approvals" });
    return false;
  }

  async function assertCanAssignTasks(req: Request, companyId: string) {
    assertCompanyAccess(req, companyId);
    if (req.actor.type === "board") {
      if (req.actor.source === "local_implicit" || req.actor.isInstanceAdmin) return;
      const allowed = await access.canUser(companyId, req.actor.userId, "tasks:assign");
      if (!allowed) throw forbidden("Missing permission: tasks:assign");
      return;
    }
    if (req.actor.type === "agent") {
      if (!req.actor.agentId) throw forbidden("Agent authentication required");
      const allowedByGrant = await access.hasPermission(companyId, "agent", req.actor.agentId, "tasks:assign");
      if (allowedByGrant) return;
      const actorAgent = await agentsSvc.getById(req.actor.agentId);
      if (actorAgent && actorAgent.companyId === companyId && canManageTaskAssignmentsLegacy(actorAgent)) return;
      throw forbidden("Missing permission: tasks:assign");
    }
    throw unauthorized();
  }

  async function queueIssueWakeup(
    issue: { id: string; companyId: string },
    agentId: string,
    wakeup: Parameters<typeof heartbeat.wakeup>[1],
    failureMessage: string,
  ) {
    try {
      return await heartbeat.wakeup(agentId, wakeup);
    } catch (err) {
      logger.warn({ err, issueId: issue.id, agentId }, failureMessage);
      return null;
    }
  }

  async function assertActiveCompanyAgent(
    companyId: string,
    agentId: string,
    label: "Assignee" | "Reviewer" | "Tech Lead" | "QA",
  ) {
    return assertActiveCompanyAgentHelper({
      agentsSvc,
      companyId,
      agentId,
      label,
    });
  }

  async function assertInternalWorkItemAssignee(companyId: string, assigneeAgentId: string) {
    return assertInternalWorkItemAssigneeHelper({
      agentsSvc,
      companyId,
      assigneeAgentId,
    });
  }

  async function assertInternalWorkItemReviewer(companyId: string, reviewerAgentId: string) {
    return assertInternalWorkItemReviewerHelper({
      agentsSvc,
      companyId,
      reviewerAgentId,
    });
  }

  async function assertInternalWorkItemQa(companyId: string, qaAgentId: string) {
    return assertInternalWorkItemQaHelper({
      agentsSvc,
      companyId,
      qaAgentId,
    });
  }

  async function assertInternalWorkItemLeadSupervisor(companyId: string, techLeadAgentId: string) {
    return assertInternalWorkItemLeadSupervisorHelper({
      agentsSvc,
      companyId,
      techLeadAgentId,
    });
  }

  async function buildTaskAssignmentSender(req: Request, companyId: string): Promise<CreateIssueProtocolMessage["sender"]> {
    return buildTaskAssignmentSenderHelper({
      actor: req.actor,
      actorInfo: getActorInfo(req),
      companyId,
      agentsSvc,
    });
  }

  async function createAndAssignInternalWorkItem(input: {
    rootIssue: NonNullable<Awaited<ReturnType<typeof svc.getById>>>;
    actor: ReturnType<typeof getActorInfo>;
    sender: CreateIssueProtocolMessage["sender"];
    rootProtocolState: Awaited<ReturnType<typeof protocolSvc.getState>>;
    body: z.infer<typeof createInternalWorkItemSchema>;
    leadAgentIdOverride?: string | null;
  }) {
    if (input.body.assigneeAgentId === input.body.reviewerAgentId) {
      throw unprocessable("Reviewer must be different from assignee");
    }

    const assignee = await assertInternalWorkItemAssignee(input.rootIssue.companyId, input.body.assigneeAgentId);
    await assertInternalWorkItemReviewer(input.rootIssue.companyId, input.body.reviewerAgentId);
    const qaAgent = input.body.qaAgentId
      ? await assertInternalWorkItemQa(input.rootIssue.companyId, input.body.qaAgentId)
      : null;
    const scopedProject =
      input.body.projectId
        ? await projectsSvc.getById(input.body.projectId)
        : input.rootIssue.projectId
          ? await projectsSvc.getById(input.rootIssue.projectId)
          : null;
    if (scopedProject && scopedProject.companyId !== input.rootIssue.companyId) {
      throw unprocessable("Selected project must belong to the same company");
    }

    const watchLeadRequested = input.body.watchLead !== false;
    const resolvedLeadAgentId =
      input.leadAgentIdOverride
      ?? (input.sender.actorType === "agent" && input.sender.role === "tech_lead"
        ? input.sender.actorId
        : input.rootProtocolState?.techLeadAgentId ?? null);
    if (watchLeadRequested && !resolvedLeadAgentId) {
      throw unprocessable("Lead watch requires a root tech lead or tech lead creator");
    }
    if (resolvedLeadAgentId) {
      await assertInternalWorkItemLeadSupervisor(input.rootIssue.companyId, resolvedLeadAgentId);
    }

    const workItem = await svc.createInternalWorkItem({
      parentIssueId: input.rootIssue.id,
      companyId: input.rootIssue.companyId,
      projectId: input.body.projectId ?? null,
      title: input.body.title,
      description: input.body.description ?? null,
      kind: input.body.kind,
      priority: input.body.priority,
      assigneeAgentId: input.body.assigneeAgentId,
      createdByAgentId: input.actor.agentId,
      createdByUserId: input.actor.actorType === "user" ? input.actor.actorId : null,
      labelNames: buildInternalWorkItemLabelNames({
        kind: input.body.kind,
        watchReviewer: input.body.watchReviewer,
        watchLead: input.body.watchLead,
      }),
    });

    await logActivity(db, {
      companyId: workItem.companyId,
      actorType: input.actor.actorType,
      actorId: input.actor.actorId,
      agentId: input.actor.agentId,
      runId: input.actor.runId,
      action: "issue.created",
      entityType: "issue",
      entityId: workItem.id,
      details: {
        title: workItem.title,
        identifier: workItem.identifier,
        parentIssueId: input.rootIssue.id,
        internalWorkItem: true,
        kind: input.body.kind,
        projectId: workItem.projectId ?? input.body.projectId ?? input.rootIssue.projectId ?? null,
      },
    });

    scheduleIssueMemoryIngest(workItem.id, "internal_work_item");

    const assignmentRecipients: CreateIssueProtocolMessage["recipients"] = [
      {
        recipientType: "agent",
        recipientId: input.body.assigneeAgentId,
        role: assignee.protocolRole,
      },
      {
        recipientType: "agent",
        recipientId: input.body.reviewerAgentId,
        role: "reviewer",
      },
    ];

    if (qaAgent) {
      assignmentRecipients.push({
        recipientType: "agent",
        recipientId: qaAgent.id,
        role: "qa",
      });
    }

    const senderIsInheritedLead =
      input.sender.actorType === "agent" && input.sender.role === "tech_lead" && input.sender.actorId === resolvedLeadAgentId;
    if (
      watchLeadRequested &&
      resolvedLeadAgentId &&
      !senderIsInheritedLead &&
      !assignmentRecipients.some(
        (recipient) => recipient.recipientType === "agent" && recipient.recipientId === resolvedLeadAgentId,
      )
    ) {
      assignmentRecipients.push({
        recipientType: "agent",
        recipientId: resolvedLeadAgentId,
        role: "tech_lead",
      });
    }

    const assignmentMessage: CreateIssueProtocolMessage = {
      messageType: "ASSIGN_TASK",
      sender: input.sender,
      recipients: assignmentRecipients,
      workflowStateBefore: "backlog",
      workflowStateAfter: "assigned",
      summary: `Assign internal ${input.body.kind} work item`,
      requiresAck: false,
      payload: {
        goal: input.body.goal?.trim() || input.body.title,
        acceptanceCriteria: input.body.acceptanceCriteria,
        definitionOfDone: input.body.definitionOfDone,
        priority: input.body.priority,
        assigneeAgentId: input.body.assigneeAgentId,
        reviewerAgentId: input.body.reviewerAgentId,
        qaAgentId: input.body.qaAgentId ?? null,
        deadlineAt: input.body.deadlineAt ?? null,
        relatedIssueIds: input.body.relatedIssueIds,
        requiredKnowledgeTags: input.body.requiredKnowledgeTags,
      },
      artifacts: [],
    };

    let dispatch;
    try {
      dispatch = await appendProtocolMessageAndDispatch({
        issue: workItem,
        message: assignmentMessage,
        actor: input.actor,
      });
    } catch (err) {
      try {
        await svc.remove(workItem.id);
      } catch (cleanupErr) {
        logger.error(
          { err: cleanupErr, issueId: workItem.id, parentIssueId: input.rootIssue.id },
          "failed to clean up internal work item after initial protocol assignment failed",
        );
      }
      throw err;
    }

    return {
      issue: await svc.getById(workItem.id) ?? workItem,
      protocol: dispatch.result,
      warnings: dispatch.warnings,
    };
  }

  function normalizeProtocolApprovalModeAlias(value: unknown) {
    if (typeof value !== "string" || value.trim().length === 0) {
      return value;
    }
    switch (value.trim()) {
      case "qa_review":
      case "reviewer_review":
      case "full":
        return "agent_review";
      case "tech_lead":
      case "lead_review":
        return "tech_lead_review";
      case "human_board":
      case "board_override":
        return "human_override";
      default:
        return value;
    }
  }

  function normalizeProtocolStringArrayAlias(value: unknown) {
    if (!Array.isArray(value)) return [];
    const results = value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    return Array.from(new Set(results));
  }

  function normalizeProtocolRequestBodyAliases(body: unknown) {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return body;
    }

    const message = body as Record<string, unknown>;
    const payload = message.payload;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return body;
    }

    const payloadRecord = payload as Record<string, unknown>;
    const linkedIssueIds = normalizeProtocolStringArrayAlias(payloadRecord.linkedIssueIds);
    const relatedIssueIds = normalizeProtocolStringArrayAlias(payloadRecord.relatedIssueIds);
    const normalizedPayload: Record<string, unknown> = {
      ...payloadRecord,
    };

    if (linkedIssueIds.length > 0 || Array.isArray(payloadRecord.linkedIssueIds)) {
      normalizedPayload.relatedIssueIds = Array.from(new Set([...relatedIssueIds, ...linkedIssueIds]));
      delete normalizedPayload.linkedIssueIds;
    }

    if (message.messageType === "APPROVE_IMPLEMENTATION") {
      normalizedPayload.approvalMode = normalizeProtocolApprovalModeAlias(payloadRecord.approvalMode);
    }

    return {
      ...message,
      payload: normalizedPayload,
    };
  }

  async function appendProtocolMessageAndDispatch(input: {
    issue: {
      id: string;
      companyId: string;
      projectId: string | null;
      identifier: string | null;
      title: string;
      description: string | null;
      labels?: Array<{ id: string; name: string; color: string }>;
      mentionedProjects?: Array<{ id: string; name: string }>;
    };
    message: CreateIssueProtocolMessage;
    actor: ReturnType<typeof getActorInfo>;
    asyncDispatch?: boolean;
  }) {
    let effectiveMessage = input.message;
    if (effectiveMessage.messageType === "SUBMIT_FOR_REVIEW") {
      const currentState = await protocolSvc.getState(input.issue.id);
      const reviewerAgentId = currentState?.reviewerAgentId ?? null;
      const hasCorrectReviewerRecipient = effectiveMessage.recipients.some(
        (recipient) =>
          recipient.recipientType === "agent"
          && recipient.role === "reviewer"
          && typeof reviewerAgentId === "string"
          && recipient.recipientId === reviewerAgentId,
      );

      if (reviewerAgentId && !hasCorrectReviewerRecipient) {
        const normalizedRecipients = effectiveMessage.recipients.filter(
          (recipient) => !(recipient.recipientType === "agent" && recipient.role === "reviewer"),
        );
        effectiveMessage = {
          ...effectiveMessage,
          recipients: [
            ...normalizedRecipients,
            {
              recipientType: "agent",
              recipientId: reviewerAgentId,
              role: "reviewer",
            },
          ],
        };
      }
    }

    if (input.actor.actorType === "agent" && input.actor.agentId && input.actor.runId) {
      const activeRun = await heartbeat.getRun(input.actor.runId);
      if (
        activeRun
        && activeRun.companyId === input.issue.companyId
        && activeRun.agentId === input.actor.agentId
        && runMatchesIssueScope(activeRun, input.issue.id)
      ) {
        let liveLogContent: string | null = null;
        if (activeRun.status === "running" && activeRun.logStore && activeRun.logRef) {
          try {
            const liveLog = await heartbeat.readLog(activeRun.id, {
              limitBytes: 256 * 1024,
              tailBytes: 256 * 1024,
            });
            liveLogContent = liveLog.content;
          } catch (err) {
            logger.warn(
              {
                err,
                runId: activeRun.id,
                issueId: input.issue.id,
                agentId: input.actor.agentId,
              },
              "failed to load active run log for protocol artifact enrichment",
            );
          }
        }

        effectiveMessage = await enrichProtocolMessageArtifactsFromRun({
          message: effectiveMessage,
          run: activeRun,
          issueId: input.issue.id,
          liveLogContent,
        });
      } else {
        logger.warn(
          {
            runId: input.actor.runId,
            issueId: input.issue.id,
            agentId: input.actor.agentId,
          },
          "skipping protocol run artifact enrichment because the active run could not be verified",
        );
      }
    }

    const result = await protocolSvc.appendMessage({
      issueId: input.issue.id,
      message: effectiveMessage,
      mirrorToComments: true,
      authorAgentId: input.actor.agentId,
      authorUserId: input.actor.actorType === "user" ? input.actor.actorId : null,
    });

    await logActivity(db, {
      companyId: input.issue.companyId,
      actorType: input.actor.actorType,
      actorId: input.actor.actorId,
      agentId: input.actor.agentId,
      runId: input.actor.runId,
      action: "issue.protocol_message.created",
      entityType: "issue",
      entityId: input.issue.id,
      details: {
        messageType: effectiveMessage.messageType,
        workflowStateBefore: effectiveMessage.workflowStateBefore,
        workflowStateAfter: effectiveMessage.workflowStateAfter,
        summary: effectiveMessage.summary,
        ...(typeof effectiveMessage.payload === "object" && effectiveMessage.payload
          ? {
              boardTemplateId: readString((effectiveMessage.payload as Record<string, unknown>).boardTemplateId),
              boardTemplateLabel: readString((effectiveMessage.payload as Record<string, unknown>).boardTemplateLabel),
              boardTemplateScope: readString((effectiveMessage.payload as Record<string, unknown>).boardTemplateScope),
            }
          : {}),
      },
    });

    await syncMergeCandidateFromProtocolMessage({
      issue: input.issue,
      actor: input.actor,
      message: effectiveMessage,
      persistedMessageId: result.message.id,
    });

    scheduleProtocolMemoryIngest(result.message.id, input.issue.id, effectiveMessage.messageType);

    if (
      effectiveMessage.messageType === "REQUEST_CHANGES"
      || effectiveMessage.messageType === "APPROVE_IMPLEMENTATION"
      || effectiveMessage.messageType === "CLOSE_TASK"
    ) {
      try {
        await retrievalPersonalization.recordProtocolFeedback({
          companyId: input.issue.companyId,
          issueId: input.issue.id,
          issueProjectId: input.issue.projectId ?? null,
          feedbackMessageId: result.message.id,
          currentMessageSeq: result.message.seq,
          message: effectiveMessage,
        });
      } catch (err) {
        logger.error(
          {
            err,
            issueId: input.issue.id,
            protocolMessageId: result.message.id,
            messageType: effectiveMessage.messageType,
          },
          "Retrieval personalization feedback recording failed",
        );
      }
    }

    if (effectiveMessage.messageType === "CANCEL_TASK") {
      try {
        await heartbeat.cancelIssueScope({
          companyId: input.issue.companyId,
          issueId: input.issue.id,
          reason: "Issue cancelled via protocol",
        });
      } catch (err) {
        logger.error({ err, issueId: input.issue.id }, "Issue cancellation cleanup failed");
        return {
          result,
          warnings: ["Issue execution cleanup failed - existing runs may continue"],
        };
      }

      return { result, warnings: [] as string[] };
    }

    if (effectiveMessage.messageType === "CLOSE_TASK") {
      try {
        await heartbeat.cancelIssueScope({
          companyId: input.issue.companyId,
          issueId: input.issue.id,
          excludeRunId: input.actor.runId ?? null,
          reason: "Issue closed via protocol",
        });
      } catch (err) {
        logger.error({ err, issueId: input.issue.id }, "Issue close cleanup failed");
      }
    }

    const runDispatch = async () => {
      const buildRecipientHints = async (
        dispatchMessage: CreateIssueProtocolMessage = effectiveMessage,
        persistedMessage: { id: string; seq: number } = result.message,
      ): Promise<Array<{
        recipientId: string;
        recipientRole: string;
        retrievalRunId: string;
        briefId: string;
        briefScope: string;
      }>> => {
        let recipientHints: Array<{
          recipientId: string;
          recipientRole: string;
          retrievalRunId: string;
          briefId: string;
          briefScope: string;
        }> = [];
        if (!shouldGenerateProtocolRetrievalContext(dispatchMessage.messageType)) {
          logger.debug(
            {
              issueId: input.issue.id,
              messageType: dispatchMessage.messageType,
            },
            "Skipping protocol retrieval context for non-handoff message",
          );
          return recipientHints;
        }
        try {
          const mentionedProjects = input.issue.mentionedProjects ?? await (async () => {
            const mentionedProjectIds = await svc.findMentionedProjectIds(input.issue.id);
            if (mentionedProjectIds.length === 0) return [];
            const projects = await projectsSvc.listByIds(input.issue.companyId, mentionedProjectIds);
            return projects.map((project) => ({ id: project.id, name: project.name }));
          })();
          const retrieval = await issueRetrieval.handleProtocolMessage({
            companyId: input.issue.companyId,
            issueId: input.issue.id,
            issue: {
              id: input.issue.id,
              projectId: input.issue.projectId ?? null,
              identifier: input.issue.identifier ?? null,
              title: input.issue.title,
              description: input.issue.description ?? null,
              labels: input.issue.labels ?? [],
              mentionedProjects: mentionedProjects.map((project) => ({
                id: project.id,
                name: project.name,
              })),
            },
            triggeringMessageId: persistedMessage.id,
            triggeringMessageSeq: persistedMessage.seq,
            message: dispatchMessage,
            actor: {
              actorType: input.actor.actorType,
              actorId: input.actor.actorId,
            },
          });
          recipientHints = retrieval.recipientHints;

          if (retrieval.retrievalRuns && retrieval.retrievalRuns.length > 0) {
            logger.info(
              {
                issueId: input.issue.id,
                messageType: dispatchMessage.messageType,
                retrievalRunCount: retrieval.retrievalRuns.length,
                retrievalRunIds: retrieval.retrievalRuns.map((run) => run.retrievalRunId),
              },
              "Brief(s) generated successfully",
            );
          }
        } catch (err) {
          logger.error(
              {
                err,
                issueId: input.issue.id,
                messageType: dispatchMessage.messageType,
                errorMessage: err instanceof Error ? err.message : String(err),
              },
              "CRITICAL: Failed to build protocol retrieval context - brief generation failed",
          );
        }
        return recipientHints;
      };

      const dispatchBeforeRetrieval = shouldDispatchBeforeProtocolRetrieval(effectiveMessage);
      let activeProtocolMessageId = result.message.id;

      try {
        if (dispatchBeforeRetrieval) {
          await logActivity(db, {
            companyId: input.issue.companyId,
            actorType: input.actor.actorType,
            actorId: input.actor.actorId,
            agentId: input.actor.agentId,
            runId: input.actor.runId,
            action: "issue.protocol_dispatch.dispatched_before_retrieval",
            entityType: "issue",
            entityId: input.issue.id,
            details: {
              protocolMessageId: result.message.id,
              messageType: effectiveMessage.messageType,
            },
          });
          const rerouted = await maybeApplyPreRetrievalSupervisorReroute({
            db,
            protocolSvc,
            issue: input.issue,
            protocolMessageId: result.message.id,
            message: effectiveMessage,
          });
          if (rerouted) {
            await protocolDispatchOutbox.markNoAction({
              protocolMessageId: result.message.id,
              dispatchResult: {
                reason: "rerouted_before_retrieval",
                rerouteProtocolMessageId: rerouted.rerouteProtocolMessageId,
              },
            });
            activeProtocolMessageId = rerouted.rerouteProtocolMessageId;
            const rerouteRecipientHints = await buildRecipientHints(
              rerouted.rerouteMessage,
              {
                id: rerouted.rerouteProtocolMessageId,
                seq: rerouted.rerouteProtocolMessageSeq,
              },
            );
            await protocolExecution.dispatchMessage({
              issueId: input.issue.id,
              companyId: input.issue.companyId,
              protocolMessageId: rerouted.rerouteProtocolMessageId,
              message: rerouted.rerouteMessage,
              recipientHints: rerouteRecipientHints,
              actor: rerouted.actor,
            });
            void buildRecipientHints().catch((err) => {
              logger.error(
                {
                  err,
                  issueId: input.issue.id,
                  messageType: effectiveMessage.messageType,
                },
                "Deferred protocol retrieval context generation failed after pre-retrieval supervisor reroute",
              );
            });
            await protocolDispatchOutbox.markDispatched({
              protocolMessageId: rerouted.rerouteProtocolMessageId,
              dispatchResult: {
                path: "pre_retrieval_reroute",
                queuedBy: "route_dispatch",
              },
            });
            return [] as string[];
          }
          await protocolExecution.dispatchMessage({
            issueId: input.issue.id,
            companyId: input.issue.companyId,
            protocolMessageId: result.message.id,
            message: effectiveMessage,
            recipientHints: [],
            actor: input.actor,
          });
          void buildRecipientHints().catch((err) => {
            logger.error(
              {
                err,
                issueId: input.issue.id,
                messageType: effectiveMessage.messageType,
              },
              "Deferred protocol retrieval context generation failed after dispatch",
            );
          });
          await protocolDispatchOutbox.markDispatched({
            protocolMessageId: result.message.id,
            dispatchResult: {
              path: "dispatch_before_retrieval",
              queuedBy: "route_dispatch",
            },
          });
          return [] as string[];
        }

        const recipientHints = await buildRecipientHints();
        await protocolExecution.dispatchMessage({
          issueId: input.issue.id,
          companyId: input.issue.companyId,
          protocolMessageId: result.message.id,
          message: effectiveMessage,
          recipientHints,
          actor: input.actor,
        });
        await protocolDispatchOutbox.markDispatched({
          protocolMessageId: result.message.id,
          dispatchResult: {
            path: "dispatch_after_retrieval",
            queuedBy: "route_dispatch",
            recipientHintCount: recipientHints.length,
          },
        });
        return [] as string[];
      } catch (err) {
        logger.error({ err, issueId: input.issue.id }, "Protocol dispatch failed - agents may not be notified");
        await protocolDispatchOutbox.markPendingRetryNow({
          protocolMessageId: activeProtocolMessageId,
          error: err instanceof Error ? err.message : String(err),
          dispatchResult: {
            path: dispatchBeforeRetrieval ? "dispatch_before_retrieval" : "dispatch_after_retrieval",
            failedAtRoute: true,
          },
        });
        return ["Wakeup dispatch failed - agents may not be notified"];
      }
    };

    if (input.asyncDispatch) {
      const scheduleAsyncDispatch = () => {
        runWithoutDbContext(() => {
          void runDispatch().catch((err) => {
            logger.error(
              {
                err,
                issueId: input.issue.id,
                protocolMessageId: result.message.id,
                messageType: effectiveMessage.messageType,
              },
              "Async protocol dispatch failed after response was returned",
            );
          });
        });
      };

      if (!enqueueAfterDbCommit(scheduleAsyncDispatch)) {
        scheduleAsyncDispatch();
      }
      return { result, warnings: [] as string[] };
    }

    const warnings = await runDispatch();
    return { result, warnings };
  }

  async function assertCanPostProtocolMessage(
    req: Request,
    res: Response,
    issue: { companyId: string; id: string },
    message: {
      messageType: string;
      sender: { actorType: string; actorId: string; role: string };
    },
  ) {
    assertCompanyAccess(req, issue.companyId);
    const actor = getActorInfo(req);

    async function denyWithProtocolViolation(
      status: number,
      error: string,
      details: Record<string, unknown>,
    ) {
      await recordProtocolViolation({
        issueId: issue.id,
        companyId: issue.companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        violationCode: "unauthorized_sender",
        severity: "high",
        details: {
          messageType: message.messageType,
          senderActorType: message.sender.actorType,
          senderActorId: message.sender.actorId,
          senderRole: message.sender.role,
          ...details,
        },
      });
      res.status(status).json({ error });
      return false;
    }

    if (
      message.messageType === "SYSTEM_REMINDER"
      || message.messageType === "TIMEOUT_ESCALATION"
      || message.messageType === "RECORD_PROTOCOL_VIOLATION"
      || message.sender.role === "system"
    ) {
      return denyWithProtocolViolation(403, "System protocol messages cannot be posted through the public API", {
        reason: "system_message_not_allowed",
      });
    }

    if (
      (message.messageType === "ASSIGN_TASK"
        || message.messageType === "REASSIGN_TASK"
        || message.messageType === "CANCEL_TASK"
        || message.messageType === "CLOSE_TASK")
      && !canBypassAssignPermissionForProtocolMessage(message)
    ) {
      try {
        await assertCanAssignTasks(req, issue.companyId);
      } catch (err) {
        return denyWithProtocolViolation(
          err instanceof HttpError ? err.status : 403,
          err instanceof Error ? err.message : "Missing permission to manage protocol task transitions",
          { reason: "missing_tasks_assign_permission" },
        );
      }
    }

    if (req.actor.type === "agent") {
      if (!req.actor.agentId) {
        return denyWithProtocolViolation(403, "Agent authentication required", {
          reason: "missing_agent_identity",
        });
      }
      if (message.sender.actorType !== "agent" || message.sender.actorId !== req.actor.agentId) {
        return denyWithProtocolViolation(403, "Protocol sender must match the authenticated agent", {
          reason: "agent_sender_mismatch",
        });
      }

      // HIGH-1: Verify claimed role matches actual agent role
      const agent = await agentsSvc.getById(req.actor.agentId);
      if (!agent) {
        return denyWithProtocolViolation(403, "Agent not found", {
          reason: "agent_not_found",
        });
      }
      if (agent.companyId !== req.actor.companyId) {
        return denyWithProtocolViolation(403, "Agent company mismatch", {
          reason: "agent_company_mismatch",
        });
      }

      const allowedProtocolRoles = getAllowedProtocolRoles(agent);
      if (!allowedProtocolRoles.has(message.sender.role)) {
        return denyWithProtocolViolation(403, `Role mismatch: claimed ${message.sender.role}, actual ${agent.role}`, {
          reason: "role_escalation_attempt",
          claimedRole: message.sender.role,
          actualRole: agent.role,
          allowedRoles: Array.from(allowedProtocolRoles),
        });
      }

      return true;
    }

    if (req.actor.type === "board") {
      if (message.sender.actorType !== "user") {
        return denyWithProtocolViolation(403, "Board users must post protocol messages as user senders", {
          reason: "board_sender_type_mismatch",
        });
      }
      if (req.actor.source !== "local_implicit" && message.sender.actorId !== req.actor.userId) {
        return denyWithProtocolViolation(403, "Protocol sender must match the authenticated user", {
          reason: "board_sender_id_mismatch",
        });
      }
      if (message.sender.role !== "human_board") {
        return denyWithProtocolViolation(403, "Board users may only send protocol messages as human_board", {
          reason: "board_sender_role_mismatch",
        });
      }
      return true;
    }

    res.status(401).json({ error: "Unauthorized" });
    return false;
  }

  function inferProtocolViolationFromError(err: unknown) {
    if (!(err instanceof HttpError)) return null;
    const messageText = err.message.toLowerCase();

    if (err.status === 409) {
      if (messageText.includes("active review cycle already exists")) {
        return { violationCode: "duplicate_active_review", severity: "high" } as const;
      }
      if (messageText.includes("no active review cycle found")) {
        return { violationCode: "stale_review_cycle_action", severity: "medium" } as const;
      }
      if (messageText.includes("without submit_for_review")) {
        return { violationCode: "invalid_predecessor_message", severity: "high" } as const;
      }
      if (messageText.includes("cannot close task before approval")) {
        return { violationCode: "close_without_approval", severity: "high" } as const;
      }
      if (messageText.includes("close task requires") || messageText.includes("close_task requires")) {
        return { violationCode: "close_without_verification", severity: "high" } as const;
      }
      return { violationCode: "invalid_state_transition", severity: "high" } as const;
    }

    if (err.status === 403) {
      return { violationCode: "unauthorized_sender", severity: "high" } as const;
    }

    if (err.status === 422) {
      if (messageText.includes("missing required artifact")) {
        return { violationCode: "missing_required_artifact", severity: "medium" } as const;
      }
      if (messageText.includes("only the assigned") || messageText.includes("sender role")) {
        return { violationCode: "unauthorized_sender", severity: "high" } as const;
      }
      if (messageText.includes("close task requires") || messageText.includes("close_task requires")) {
        return { violationCode: "close_without_verification", severity: "high" } as const;
      }
      return { violationCode: "recipient_role_mismatch", severity: "medium" } as const;
    }

    return null;
  }

  async function recordProtocolViolation(input: {
    issueId: string;
    companyId: string;
    actorType: "agent" | "user";
    actorId: string;
    agentId: string | null;
    runId: string | null;
    violationCode:
      | "payload_schema_mismatch"
      | "invalid_state_transition"
      | "invalid_predecessor_message"
      | "duplicate_active_review"
      | "stale_review_cycle_action"
      | "unauthorized_sender"
      | "recipient_role_mismatch"
      | "missing_required_artifact"
      | "close_without_approval"
      | "close_without_verification";
    severity: "medium" | "high";
    details: Record<string, unknown>;
  }) {
    const violation = await protocolSvc.createViolation({
      issueId: input.issueId,
      violation: {
        violationCode: input.violationCode,
        severity: input.severity,
        detectedByActorType: input.actorType,
        detectedByActorId: input.actorId,
        status: "open",
        details: input.details,
      },
    });

    await logActivity(db, {
      companyId: input.companyId,
      actorType: input.actorType,
      actorId: input.actorId,
      agentId: input.agentId,
      runId: input.runId,
      action: "issue.protocol_violation.recorded",
      entityType: "issue",
      entityId: input.issueId,
      details: {
        violationId: violation.id,
        violationCode: violation.violationCode,
        severity: violation.severity,
      },
    });

    return violation;
  }

  function requireAgentRunId(req: Request, res: Response) {
    if (req.actor.type !== "agent") return null;
    const runId = req.actor.runId?.trim();
    if (runId) return runId;
    res.status(401).json({ error: "Agent run id required" });
    return null;
  }

  async function assertAgentRunCheckoutOwnership(
    req: Request,
    res: Response,
    issue: { id: string; companyId: string; status: string; assigneeAgentId: string | null },
  ) {
    if (req.actor.type !== "agent") return true;
    const actorAgentId = req.actor.agentId;
    if (!actorAgentId) {
      res.status(403).json({ error: "Agent authentication required" });
      return false;
    }
    if (issue.status !== "in_progress" || issue.assigneeAgentId !== actorAgentId) {
      return true;
    }
    const runId = requireAgentRunId(req, res);
    if (!runId) return false;
    const ownership = await svc.assertCheckoutOwner(issue.id, actorAgentId, runId);
    if (ownership.adoptedFromRunId) {
      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId: issue.companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "issue.checkout_lock_adopted",
        entityType: "issue",
        entityId: issue.id,
        details: {
          previousCheckoutRunId: ownership.adoptedFromRunId,
          checkoutRunId: runId,
          reason: "stale_checkout_run",
        },
      });
    }
    return true;
  }

  async function normalizeIssueIdentifier(rawId: string): Promise<string> {
    if (/^[A-Z]+-\d+$/i.test(rawId)) {
      const issue = await svc.getByIdentifier(rawId);
      if (issue) {
        return issue.id;
      }
    }
    return rawId;
  }

  // Resolve issue identifiers (e.g. "PAP-39") to UUIDs for all /issues/:id routes
  router.param("id", async (req, res, next, rawId) => {
    try {
      req.params.id = await normalizeIssueIdentifier(rawId);
      next();
    } catch (err) {
      next(err);
    }
  });

  // Resolve issue identifiers (e.g. "PAP-39") to UUIDs for company-scoped attachment routes.
  router.param("issueId", async (req, res, next, rawId) => {
    try {
      req.params.issueId = await normalizeIssueIdentifier(rawId);
      next();
    } catch (err) {
      next(err);
    }
  });

  const routeContext = {
    router,
    db,
    storage,
    services: {
      svc,
      access,
      heartbeat,
      agentsSvc,
      knowledge,
      projectsSvc,
      goalsSvc,
      issueApprovalsSvc,
      protocolExecution,
      issueRetrieval,
      protocolSvc,
      organizationalMemory,
      retrievalPersonalization,
      mergeCandidatesSvc,
    },
    helpers: {
      withContentPath: withIssueAttachmentContentPath,
      scheduleIssueMemoryIngest,
      scheduleProtocolMemoryIngest,
      ensureIssueLabelsByName,
      loadIssueChangeSurface,
      syncMergeCandidateFromProtocolMessage,
      runSingleFileUpload,
      assertCanManageIssueApprovalLinks,
      assertCanAssignTasks,
      queueIssueWakeup,
      assertInternalWorkItemAssignee,
      assertInternalWorkItemReviewer,
      assertInternalWorkItemQa,
      assertInternalWorkItemLeadSupervisor,
      buildTaskAssignmentSender,
      createAndAssignInternalWorkItem,
      appendProtocolMessageAndDispatch,
      assertCanPostProtocolMessage,
      recordProtocolViolation,
      requireAgentRunId,
      assertAgentRunCheckoutOwnership,
      buildPmProjectionRootDescription,
      resolvePmIntakeAgents,
      derivePmIntakeIssueTitle,
      buildPmIntakeIssueDescription,
      buildPmIntakeAssignment,
      buildPmIntakeProjectionPreview,
      normalizeProtocolRequestBodyAliases,
      buildMergeAutomationPlan,
      runMergeAutomationAction,
    },
    schemas: {
      mergeCandidateActionSchema,
      mergeCandidateAutomationSchema,
      retrievalFeedbackSchema,
    },
    constants: {
      maxAttachmentBytes: MAX_ATTACHMENT_BYTES,
      maxDocumentBodyChars: opts?.maxDocumentBodyChars ?? 200_000,
      allowedAttachmentContentTypes: ALLOWED_ATTACHMENT_CONTENT_TYPES,
      pmIntakeLabelSpecs: PM_INTAKE_LABEL_SPECS,
    },
  };
  const typedRouteContext: IssueRouteContext = routeContext;

  registerIssueApprovalRoutes(typedRouteContext);
  registerIssueIntakeRoutes(typedRouteContext);
  registerIssueProtocolReadRoutes(typedRouteContext);
  registerIssueMergeRoutes(typedRouteContext);
  registerIssueAttachmentRoutes(typedRouteContext);
  registerIssueDeliverablesRoutes(typedRouteContext);
  registerIssueDocumentRoutes(typedRouteContext);

  router.get("/companies/:companyId/issues", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const assigneeUserFilterRaw = req.query.assigneeUserId as string | undefined;
    const assigneeUserId =
      assigneeUserFilterRaw === "me" && req.actor.type === "board"
        ? req.actor.userId
        : assigneeUserFilterRaw;

    if (assigneeUserFilterRaw === "me" && (!assigneeUserId || req.actor.type !== "board")) {
      res.status(403).json({ error: "assigneeUserId=me requires board authentication" });
      return;
    }

    const parentIdRaw = req.query.parentId as string | undefined;
    if (parentIdRaw && !isUuidLike(parentIdRaw)) {
      res.status(400).json({ error: "parentId must be a valid UUID" });
      return;
    }

    const includeSubtasks = req.query.includeSubtasks === "true";
    const result = await svc.list(companyId, {
      status: req.query.status as string | undefined,
      assigneeAgentId: req.query.assigneeAgentId as string | undefined,
      assigneeUserId,
      projectId: req.query.projectId as string | undefined,
      labelId: req.query.labelId as string | undefined,
      q: req.query.q as string | undefined,
      parentId: parentIdRaw,
      includeSubtasks,
    });

    // Attach simplified progress snapshot for root issues
    if (includeSubtasks) {
      const rootIds = result.filter((i: Record<string, unknown>) => !i.parentId).map((i: Record<string, unknown>) => i.id as string);
      const summaryMap = await svc.listInternalWorkItemSummaries(rootIds);
      const enriched = result.map((issue: Record<string, unknown>) => {
        if (issue.parentId) return issue;
        const summary = summaryMap.get(issue.id as string) ?? null;
        return {
          ...issue,
          internalWorkItemSummary: summary,
          progressSnapshot: computeSimplifiedIssueProgressSnapshot({
            issue: issue as { status: import("@squadrail/shared").IssueStatus },
            internalWorkItemSummary: summary,
          }),
        };
      });
      res.json(enriched);
    } else {
      res.json(result);
    }
  });

  router.get("/companies/:companyId/labels", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const result = await svc.listLabels(companyId);
    res.json(result);
  });

  router.post("/companies/:companyId/labels", validate(createIssueLabelSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const label = await svc.createLabel(companyId, req.body);
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "label.created",
      entityType: "label",
      entityId: label.id,
      details: { name: label.name, color: label.color },
    });
    res.status(201).json(label);
  });

  router.delete("/labels/:labelId", async (req, res) => {
    const labelId = req.params.labelId as string;
    const existing = await svc.getLabelById(labelId);
    if (!existing) {
      res.status(404).json({ error: "Label not found" });
      return;
    }
    assertCompanyAccess(req, existing.companyId);
    const removed = await svc.deleteLabel(labelId);
    if (!removed) {
      res.status(404).json({ error: "Label not found" });
      return;
    }
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId: removed.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "label.deleted",
      entityType: "label",
      entityId: removed.id,
      details: { name: removed.name, color: removed.color },
    });
    res.json(removed);
  });

  router.get("/issues/:id", async (req, res) => {
    const id = req.params.id as string;
    const issue = await svc.getById(id);
    if (!issue) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }
    assertCompanyAccess(req, issue.companyId);
    const [ancestors, project, goal, mentionedProjectIds] = await Promise.all([
      svc.getAncestors(issue.id),
      issue.projectId ? projectsSvc.getById(issue.projectId) : null,
      issue.goalId ? goalsSvc.getById(issue.goalId) : null,
      svc.findMentionedProjectIds(issue.id),
    ]);
    const mentionedProjects = mentionedProjectIds.length > 0
      ? await projectsSvc.listByIds(issue.companyId, mentionedProjectIds)
      : [];
    const [internalWorkItems, internalWorkItemSummary, protocolStateRow, protocolMessages] = await Promise.all([
      svc.listInternalWorkItems(issue.id),
      svc.getInternalWorkItemSummary(issue.id),
      protocolSvc.getState(issue.id).catch(() => null),
      protocolSvc.listMessages(issue.id).catch(() => [] as Array<import("@squadrail/shared").IssueProtocolMessage>),
    ]);
    const progressSnapshot = computeIssueProgressSnapshot({
      issue: issue as { status: import("@squadrail/shared").IssueStatus },
      protocolState: protocolStateRow as import("@squadrail/shared").IssueProtocolState | null,
      internalWorkItemSummary,
      protocolMessages: protocolMessages as import("@squadrail/shared").IssueProtocolMessage[],
    });
    // Compute runtime summary from the change surface (best-effort, non-blocking).
    let runtimeSummary: import("@squadrail/shared").IssueRuntimeSummary | null = null;
    try {
      const changeSurface = await loadIssueChangeSurface(issue);
      runtimeSummary = computeIssueRuntimeSummary(changeSurface);
    } catch {
      // Non-critical — runtime banner is purely informational.
    }
    res.json({
      ...issue,
      ancestors,
      internalWorkItems,
      internalWorkItemSummary,
      progressSnapshot,
      ...(runtimeSummary ? { runtimeSummary } : {}),
      project: project ?? null,
      goal: goal ?? null,
      mentionedProjects,
    });
  });

  router.post("/issues/:id/internal-work-items", validate(createInternalWorkItemSchema), async (req, res) => {
    const rootIssueId = req.params.id as string;
    const rootIssue = await svc.getById(rootIssueId);
    if (!rootIssue) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }

    assertCompanyAccess(req, rootIssue.companyId);
    await assertCanAssignTasks(req, rootIssue.companyId);

    const actor = getActorInfo(req);
    const sender = await buildTaskAssignmentSender(req, rootIssue.companyId);
    const rootProtocolState = await protocolSvc.getState(rootIssue.id);
    const projected = await createAndAssignInternalWorkItem({
      rootIssue,
      actor,
      sender,
      rootProtocolState,
      body: req.body,
    });

    res.status(201).json({
      issue: projected.issue,
      protocol: projected.protocol,
      warnings: projected.warnings,
    });
  });

  router.post("/companies/:companyId/issues", validate(createIssueSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    if (req.body.assigneeAgentId || req.body.assigneeUserId) {
      await assertCanAssignTasks(req, companyId);
    }

    const actor = getActorInfo(req);
    const issue = await svc.create(companyId, {
      ...req.body,
      createdByAgentId: actor.agentId,
      createdByUserId: actor.actorType === "user" ? actor.actorId : null,
    });

    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "issue.created",
      entityType: "issue",
      entityId: issue.id,
      details: { title: issue.title, identifier: issue.identifier },
    });

    if (issue.assigneeAgentId) {
      await queueIssueWakeup(
        issue,
        issue.assigneeAgentId,
        {
          source: "assignment",
          triggerDetail: "system",
          reason: "issue_assigned",
          payload: { issueId: issue.id, mutation: "create" },
          requestedByActorType: actor.actorType,
          requestedByActorId: actor.actorId,
          contextSnapshot: { issueId: issue.id, source: "issue.create" },
        },
        "failed to wake assignee on issue create",
      );
    }

    scheduleIssueMemoryIngest(issue.id, "create");

    res.status(201).json(issue);
  });

  router.patch("/issues/:id", validate(updateIssueSchema), async (req, res) => {
    const id = req.params.id as string;
    const existing = await svc.getById(id);
    if (!existing) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }
    assertCompanyAccess(req, existing.companyId);
    const assigneeWillChange =
      (req.body.assigneeAgentId !== undefined && req.body.assigneeAgentId !== existing.assigneeAgentId) ||
      (req.body.assigneeUserId !== undefined && req.body.assigneeUserId !== existing.assigneeUserId);

    const isAgentReturningIssueToCreator =
      req.actor.type === "agent" &&
      !!req.actor.agentId &&
      existing.assigneeAgentId === req.actor.agentId &&
      req.body.assigneeAgentId === null &&
      typeof req.body.assigneeUserId === "string" &&
      !!existing.createdByUserId &&
      req.body.assigneeUserId === existing.createdByUserId;

    if (assigneeWillChange) {
      if (!isAgentReturningIssueToCreator) {
        await assertCanAssignTasks(req, existing.companyId);
      }
    }
    if (!(await assertAgentRunCheckoutOwnership(req, res, existing))) return;

    const { comment: commentBody, ...updateFields } = req.body;
    let issue;
    try {
      issue = await svc.update(id, updateFields);
    } catch (err) {
      if (err instanceof HttpError && err.status === 422) {
        logger.warn(
          {
            issueId: id,
            companyId: existing.companyId,
            assigneePatch: {
              assigneeAgentId:
                req.body.assigneeAgentId === undefined ? "__omitted__" : req.body.assigneeAgentId,
              assigneeUserId:
                req.body.assigneeUserId === undefined ? "__omitted__" : req.body.assigneeUserId,
            },
            currentAssignee: {
              assigneeAgentId: existing.assigneeAgentId,
              assigneeUserId: existing.assigneeUserId,
            },
            error: err.message,
            details: err.details,
          },
          "issue update rejected with 422",
        );
      }
      throw err;
    }
    if (!issue) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }

    // Build activity details with previous values for changed fields
    const previous: Record<string, unknown> = {};
    for (const key of Object.keys(updateFields)) {
      if (key in existing && (existing as Record<string, unknown>)[key] !== (updateFields as Record<string, unknown>)[key]) {
        previous[key] = (existing as Record<string, unknown>)[key];
      }
    }

    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId: issue.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "issue.updated",
      entityType: "issue",
      entityId: issue.id,
      details: { ...updateFields, identifier: issue.identifier, _previous: Object.keys(previous).length > 0 ? previous : undefined },
    });

    let comment = null;
    if (commentBody) {
      comment = await svc.addComment(id, commentBody, {
        agentId: actor.agentId ?? undefined,
        userId: actor.actorType === "user" ? actor.actorId : undefined,
      });

      await logActivity(db, {
        companyId: issue.companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "issue.comment_added",
        entityType: "issue",
        entityId: issue.id,
        details: {
          commentId: comment.id,
          bodySnippet: comment.body.slice(0, 120),
          identifier: issue.identifier,
          issueTitle: issue.title,
        },
      });

    }

    const assigneeChanged = assigneeWillChange;

    // Merge all wakeups from this update into one enqueue per agent to avoid duplicate runs.
    const wakeups = new Map<string, Parameters<typeof heartbeat.wakeup>[1]>();

    if (assigneeChanged && issue.assigneeAgentId) {
      wakeups.set(issue.assigneeAgentId, {
        source: "assignment",
        triggerDetail: "system",
        reason: "issue_assigned",
        payload: { issueId: issue.id, mutation: "update" },
        requestedByActorType: actor.actorType,
        requestedByActorId: actor.actorId,
        contextSnapshot: { issueId: issue.id, source: "issue.update" },
      });
    }

    if (commentBody && comment) {
      const protocolState = await protocolSvc.getState(id).catch((err) => {
        logger.warn({ err, issueId: id }, "failed to resolve protocol state for issue update wakeups");
        return null;
      });

      let mentionedIds: string[] = [];
      try {
        mentionedIds = await svc.findMentionedAgents(issue.companyId, commentBody);
      } catch (err) {
        logger.warn({ err, issueId: id }, "failed to resolve @-mentions");
      }

      for (const mentionedId of mentionedIds) {
        if (wakeups.has(mentionedId)) {
          const existing = wakeups.get(mentionedId);
          if (existing) {
            wakeups.set(mentionedId, {
              ...existing,
              reason: "issue_comment_mentioned",
              payload: {
                ...(existing.payload ?? {}),
                issueId: id,
                commentId: comment.id,
              },
              contextSnapshot: {
                ...(existing.contextSnapshot ?? {}),
                issueId: id,
                taskId: id,
                commentId: comment.id,
                wakeCommentId: comment.id,
                wakeReason: "issue_comment_mentioned",
                source: "comment.mention",
                ...buildMentionProtocolContext({
                  issue,
                  mentionedAgentId: mentionedId,
                  protocolState,
                }),
              },
            });
          }
          continue;
        }
        wakeups.set(mentionedId, {
          source: "automation",
          triggerDetail: "system",
          reason: "issue_comment_mentioned",
          payload: { issueId: id, commentId: comment.id },
          requestedByActorType: actor.actorType,
          requestedByActorId: actor.actorId,
          contextSnapshot: {
            issueId: id,
            taskId: id,
            commentId: comment.id,
            wakeCommentId: comment.id,
            wakeReason: "issue_comment_mentioned",
            source: "comment.mention",
            ...buildMentionProtocolContext({
              issue,
              mentionedAgentId: mentionedId,
              protocolState,
            }),
          },
        });
      }
    }

    for (const [agentId, wakeup] of wakeups.entries()) {
      await queueIssueWakeup(
        issue,
        agentId,
        wakeup,
        "failed to wake agent on issue update",
      );
    }

    scheduleIssueMemoryIngest(issue.id, "update");

    res.json({ ...issue, comment });
  });

  router.delete("/issues/:id", async (req, res) => {
    const id = req.params.id as string;
    const existing = await svc.getById(id);
    if (!existing) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }
    assertCompanyAccess(req, existing.companyId);
    const attachments = await svc.listAttachments(id);

    const issue = await svc.remove(id);
    if (!issue) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }

    for (const attachment of attachments) {
      try {
        await storage.deleteObject(attachment.companyId, attachment.objectKey);
      } catch (err) {
        logger.warn({ err, issueId: id, attachmentId: attachment.id }, "failed to delete attachment object during issue delete");
      }
    }

    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId: issue.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "issue.deleted",
      entityType: "issue",
      entityId: issue.id,
    });

    res.json(issue);
  });

  router.post("/issues/:id/checkout", validate(checkoutIssueSchema), async (req, res) => {
    const id = req.params.id as string;
    const issue = await svc.getById(id);
    if (!issue) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }
    assertCompanyAccess(req, issue.companyId);

    if (req.actor.type === "agent" && req.actor.agentId !== req.body.agentId) {
      res.status(403).json({ error: "Agent can only checkout as itself" });
      return;
    }

    const checkoutRunId = requireAgentRunId(req, res);
    if (req.actor.type === "agent" && !checkoutRunId) return;
    const updated = await svc.checkout(id, req.body.agentId, req.body.expectedStatuses, checkoutRunId);
    const actor = getActorInfo(req);

    await logActivity(db, {
      companyId: issue.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "issue.checked_out",
      entityType: "issue",
      entityId: issue.id,
      details: { agentId: req.body.agentId },
    });

    await queueIssueWakeup(
      issue,
      req.body.agentId,
      {
        source: "assignment",
        triggerDetail: "system",
        reason: "issue_checked_out",
        payload: { issueId: issue.id, mutation: "checkout" },
        requestedByActorType: actor.actorType,
        requestedByActorId: actor.actorId,
        contextSnapshot: { issueId: issue.id, source: "issue.checkout" },
      },
      "failed to wake assignee on issue checkout",
    );

    res.json(updated);
  });

  router.post("/issues/:id/release", async (req, res) => {
    const id = req.params.id as string;
    const existing = await svc.getById(id);
    if (!existing) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }
    assertCompanyAccess(req, existing.companyId);
    if (!(await assertAgentRunCheckoutOwnership(req, res, existing))) return;
    const actorRunId = requireAgentRunId(req, res);
    if (req.actor.type === "agent" && !actorRunId) return;

    const released = await svc.release(
      id,
      req.actor.type === "agent" ? req.actor.agentId : undefined,
      actorRunId,
    );
    if (!released) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }

    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId: released.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "issue.released",
      entityType: "issue",
      entityId: released.id,
    });

    res.json(released);
  });

  router.get("/issues/:id/comments", async (req, res) => {
    const id = req.params.id as string;
    const issue = await svc.getById(id);
    if (!issue) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }
    assertCompanyAccess(req, issue.companyId);
    const comments = await svc.listComments(id);
    res.json(comments);
  });

  router.post("/issues/:id/protocol/messages", async (req, res, next) => {
    const id = req.params.id as string;
    const issue = await svc.getById(id);
    if (!issue) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }

    assertCompanyAccess(req, issue.companyId);

    const normalizedBody = normalizeProtocolRequestBodyAliases(req.body);
    const parsedMessage = createIssueProtocolMessageSchema.safeParse(normalizedBody);
    const actor = getActorInfo(req);
    if (!parsedMessage.success) {
      await recordProtocolViolation({
        issueId: id,
        companyId: issue.companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        violationCode: "payload_schema_mismatch",
        severity: "medium",
        details: {
          issues: parsedMessage.error.issues,
          rawMessageType: typeof req.body?.messageType === "string" ? req.body.messageType : null,
        },
      });
      res.status(400).json({ error: "Validation error", details: parsedMessage.error.issues });
      return;
    }

    const message = parsedMessage.data;

    if (!(await assertCanPostProtocolMessage(req, res, issue, message))) return;

    const requestedDispatchMode = req.header("x-squadrail-dispatch-mode")?.toLowerCase();
    const asyncDispatch = actor.actorType === "agent" && requestedDispatchMode === "async";
    const helperTransport = readProtocolHelperTransportHeader(req);

    if (helperTransport && actor.actorType === "agent" && actor.runId) {
      void heartbeat.recordExternalRunEvent({
        runId: actor.runId,
        eventType: "protocol.helper_invocation",
        message: `${message.messageType} via protocol helper`,
        payload: {
          transport: helperTransport.transport,
          command: helperTransport.command,
          issueId: issue.id,
          messageType: message.messageType,
          senderRole: message.sender.role,
          dispatchMode: requestedDispatchMode ?? null,
        },
      }).catch((err) => {
        logger.warn(
          { err, runId: actor.runId, issueId: issue.id, messageType: message.messageType },
          "Failed to record protocol helper invocation event",
        );
      });
    }

    let dispatch;
    try {
      dispatch = await appendProtocolMessageAndDispatch({
        issue: {
          id: issue.id,
          companyId: issue.companyId,
          projectId: issue.projectId ?? null,
          identifier: issue.identifier ?? null,
          title: issue.title,
          description: issue.description ?? null,
          labels: issue.labels ?? [],
        },
        message,
        actor,
        asyncDispatch,
      });
    } catch (err) {
      const inferredViolation = inferProtocolViolationFromError(err);
      if (inferredViolation) {
        await recordProtocolViolation({
          issueId: id,
          companyId: issue.companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          runId: actor.runId,
          violationCode: inferredViolation.violationCode,
          severity: inferredViolation.severity,
          details: {
            messageType: message.messageType,
            workflowStateBefore: message.workflowStateBefore,
            workflowStateAfter: message.workflowStateAfter,
            error: err instanceof Error ? err.message : String(err),
          },
        });
      }
      next(err);
      return;
    }

    if (actor.actorType === "agent" && actor.runId) {
      const actorRunId = actor.runId;
      void (async () => {
        const actorRun = await heartbeat.getRun(actorRunId);
        if (!actorRun || actorRun.status !== "running" || !runMatchesIssueScope(actorRun, issue.id)) {
          return;
        }

        const currentProtocolMessageType = readRunContextProtocolField(actorRun.contextSnapshot, "protocolMessageType");
        const currentProtocolRecipientRole = readRunContextProtocolField(actorRun.contextSnapshot, "protocolRecipientRole");
        if (!currentProtocolMessageType || !currentProtocolRecipientRole) {
          return;
        }

        if (!shouldSkipSupersededProtocolFollowup({
          issueStatus: issue.status,
          workflowState: message.workflowStateAfter,
          protocolMessageType: currentProtocolMessageType,
          protocolRecipientRole: currentProtocolRecipientRole,
        })) {
          return;
        }

        await heartbeat.cancelRun(actorRunId, {
          message: `Cancelled actor run after ${message.messageType} advanced the protocol lane`,
          checkpointMessage: "run cancelled after protocol lane advanced",
        });
      })().catch((err) => {
        logger.warn(
          { err, runId: actorRunId, issueId: issue.id, messageType: message.messageType },
          "Failed to cancel superseded actor protocol run",
        );
      });
    }

    res.status(201).json(
      dispatch.warnings.length > 0
        ? { ...dispatch.result, warnings: dispatch.warnings }
        : dispatch.result,
    );
  });

  router.get("/issues/:id/comments/:commentId", async (req, res) => {
    const id = req.params.id as string;
    const commentId = req.params.commentId as string;
    const issue = await svc.getById(id);
    if (!issue) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }
    assertCompanyAccess(req, issue.companyId);
    const comment = await svc.getComment(commentId);
    if (!comment || comment.issueId !== id) {
      res.status(404).json({ error: "Comment not found" });
      return;
    }
    res.json(comment);
  });

  router.post("/issues/:id/comments", validate(addIssueCommentSchema), async (req, res) => {
    const id = req.params.id as string;
    const issue = await svc.getById(id);
    if (!issue) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }
    assertCompanyAccess(req, issue.companyId);
    if (!(await assertAgentRunCheckoutOwnership(req, res, issue))) return;

    const actor = getActorInfo(req);
    const reopenRequested = req.body.reopen === true;
    const interruptRequested = req.body.interrupt === true;
    const isClosed = issue.status === "done" || issue.status === "cancelled";
    let reopened = false;
    let reopenFromStatus: string | null = null;
    let interruptedRunId: string | null = null;
    let currentIssue = issue;

    if (reopenRequested && isClosed) {
      const reopenedIssue = await svc.update(id, { status: "todo" });
      if (!reopenedIssue) {
        res.status(404).json({ error: "Issue not found" });
        return;
      }
      reopened = true;
      reopenFromStatus = issue.status;
      currentIssue = reopenedIssue;

      await logActivity(db, {
        companyId: currentIssue.companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "issue.updated",
        entityType: "issue",
        entityId: currentIssue.id,
        details: {
          status: "todo",
          reopened: true,
          reopenedFrom: reopenFromStatus,
          source: "comment",
          identifier: currentIssue.identifier,
        },
      });
    }

    if (interruptRequested) {
      if (req.actor.type !== "board") {
        res.status(403).json({ error: "Only board users can interrupt active runs from issue comments" });
        return;
      }

      let runToInterrupt = currentIssue.executionRunId
        ? await heartbeat.getRun(currentIssue.executionRunId)
        : null;

      if (
        (!runToInterrupt || runToInterrupt.status !== "running") &&
        currentIssue.assigneeAgentId
      ) {
        const activeRun = await heartbeat.getActiveRunForAgent(currentIssue.assigneeAgentId);
        const activeIssueId =
          activeRun &&
            activeRun.contextSnapshot &&
            typeof activeRun.contextSnapshot === "object" &&
            typeof (activeRun.contextSnapshot as Record<string, unknown>).issueId === "string"
            ? ((activeRun.contextSnapshot as Record<string, unknown>).issueId as string)
            : null;
        if (activeRun && activeRun.status === "running" && activeIssueId === currentIssue.id) {
          runToInterrupt = activeRun;
        }
      }

      if (runToInterrupt && runToInterrupt.status === "running") {
        const cancelled = await heartbeat.cancelRun(runToInterrupt.id);
        if (cancelled) {
          interruptedRunId = cancelled.id;
          await logActivity(db, {
            companyId: cancelled.companyId,
            actorType: actor.actorType,
            actorId: actor.actorId,
            agentId: actor.agentId,
            runId: actor.runId,
            action: "heartbeat.cancelled",
            entityType: "heartbeat_run",
            entityId: cancelled.id,
            details: { agentId: cancelled.agentId, source: "issue_comment_interrupt", issueId: currentIssue.id },
          });
        }
      }
    }

    const comment = await svc.addComment(id, req.body.body, {
      agentId: actor.agentId ?? undefined,
      userId: actor.actorType === "user" ? actor.actorId : undefined,
    });

    await logActivity(db, {
      companyId: currentIssue.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "issue.comment_added",
      entityType: "issue",
      entityId: currentIssue.id,
      details: {
        commentId: comment.id,
        bodySnippet: comment.body.slice(0, 120),
        identifier: currentIssue.identifier,
        issueTitle: currentIssue.title,
        ...(reopened ? { reopened: true, reopenedFrom: reopenFromStatus, source: "comment" } : {}),
        ...(interruptedRunId ? { interruptedRunId } : {}),
      },
    });

    // Merge all wakeups from this comment into one enqueue per agent to avoid duplicate runs.
    void (async () => {
      const wakeups = new Map<string, Parameters<typeof heartbeat.wakeup>[1]>();
      const assigneeId = currentIssue.assigneeAgentId;
      if (assigneeId) {
        if (reopened) {
          wakeups.set(assigneeId, {
            source: "automation",
            triggerDetail: "system",
            reason: "issue_reopened_via_comment",
            payload: {
              issueId: currentIssue.id,
              commentId: comment.id,
              reopenedFrom: reopenFromStatus,
              mutation: "comment",
              ...(interruptedRunId ? { interruptedRunId } : {}),
            },
            requestedByActorType: actor.actorType,
            requestedByActorId: actor.actorId,
            contextSnapshot: {
              issueId: currentIssue.id,
              taskId: currentIssue.id,
              commentId: comment.id,
              source: "issue.comment.reopen",
              wakeReason: "issue_reopened_via_comment",
              reopenedFrom: reopenFromStatus,
              ...(interruptedRunId ? { interruptedRunId } : {}),
            },
          });
        } else {
          wakeups.set(assigneeId, {
            source: "automation",
            triggerDetail: "system",
            reason: "issue_commented",
            payload: {
              issueId: currentIssue.id,
              commentId: comment.id,
              mutation: "comment",
              ...(interruptedRunId ? { interruptedRunId } : {}),
            },
            requestedByActorType: actor.actorType,
            requestedByActorId: actor.actorId,
            contextSnapshot: {
              issueId: currentIssue.id,
              taskId: currentIssue.id,
              commentId: comment.id,
              source: "issue.comment",
              wakeReason: "issue_commented",
              ...(interruptedRunId ? { interruptedRunId } : {}),
            },
          });
        }
      }

      let mentionedIds: string[] = [];
      const protocolState = await protocolSvc.getState(id).catch((err) => {
        logger.warn({ err, issueId: id }, "failed to resolve protocol state for issue comment wakeups");
        return null;
      });
      try {
        mentionedIds = await svc.findMentionedAgents(issue.companyId, req.body.body);
      } catch (err) {
        logger.warn({ err, issueId: id }, "failed to resolve @-mentions");
      }

      for (const mentionedId of mentionedIds) {
        if (wakeups.has(mentionedId)) {
          const existing = wakeups.get(mentionedId);
          if (existing) {
            wakeups.set(mentionedId, {
              ...existing,
              reason: "issue_comment_mentioned",
              payload: {
                ...(existing.payload ?? {}),
                issueId: id,
                commentId: comment.id,
              },
              contextSnapshot: {
                ...(existing.contextSnapshot ?? {}),
                issueId: id,
                taskId: id,
                commentId: comment.id,
                wakeCommentId: comment.id,
                wakeReason: "issue_comment_mentioned",
                source: "comment.mention",
                ...buildMentionProtocolContext({
                  issue: currentIssue,
                  mentionedAgentId: mentionedId,
                  protocolState,
                }),
              },
            });
          }
          continue;
        }
        wakeups.set(mentionedId, {
          source: "automation",
          triggerDetail: "system",
          reason: "issue_comment_mentioned",
          payload: { issueId: id, commentId: comment.id },
          requestedByActorType: actor.actorType,
          requestedByActorId: actor.actorId,
          contextSnapshot: {
            issueId: id,
            taskId: id,
            commentId: comment.id,
            wakeCommentId: comment.id,
            wakeReason: "issue_comment_mentioned",
            source: "comment.mention",
            ...buildMentionProtocolContext({
              issue: currentIssue,
              mentionedAgentId: mentionedId,
              protocolState,
            }),
          },
        });
      }

      for (const [agentId, wakeup] of wakeups.entries()) {
        heartbeat
          .wakeup(agentId, wakeup)
          .catch((err) => logger.warn({ err, issueId: currentIssue.id, agentId }, "failed to wake agent on issue comment"));
      }
    })();

    res.status(201).json(comment);
  });

  return router;
}
