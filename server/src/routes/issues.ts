import { Router, type Request, type Response } from "express";
import multer from "multer";
import { runWithoutDbContext, type Db } from "@squadrail/db";
import {
  addIssueCommentSchema,
  createIssueAttachmentMetadataSchema,
  createInternalWorkItemSchema,
  createIssueLabelSchema,
  checkoutIssueSchema,
  createIssueSchema,
  createIssueProtocolMessageSchema,
  type CreateIssueProtocolMessage,
  linkIssueApprovalSchema,
  updateIssueSchema,
} from "@squadrail/shared";
import type { StorageService } from "../storage/types.js";
import { validate } from "../middleware/validate.js";
import {
  accessService,
  agentService,
  goalService,
  heartbeatService,
  issueApprovalService,
  issueProtocolExecutionService,
  issueRetrievalService,
  issueProtocolService,
  issueService,
  knowledgeService,
  logActivity,
  projectService,
} from "../services/index.js";
import { logger } from "../middleware/logger.js";
import { conflict, forbidden, HttpError, notFound, unauthorized, unprocessable } from "../errors.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";

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
function getProtocolRole(agentRole: string): string {
  if (agentRole === "cto") return "cto";
  if (agentRole === "pm") return "pm";
  if (agentRole === "qa") return "qa";
  if (agentRole === "engineer") return "engineer";
  if (agentRole === "manager" || agentRole === "tech_lead") return "tech_lead";
  return "reviewer";
}

function getAllowedProtocolRoles(agent: {
  role: string;
  title?: string | null;
}) {
  const allowed = new Set<string>([agent.role, getProtocolRole(agent.role)]);
  if (agent.role === "qa") {
    allowed.add("reviewer");
  }
  if (typeof agent.title === "string" && /tech lead/i.test(agent.title)) {
    allowed.add("tech_lead");
    allowed.add("reviewer");
  }
  return allowed;
}

export function issueRoutes(db: Db, storage: StorageService) {
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
  const issueRetrieval = issueRetrievalService(db);
  const protocolSvc = issueProtocolService(db);
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 1 },
  });

  function withContentPath<T extends { id: string }>(attachment: T) {
    return {
      ...attachment,
      contentPath: `/api/attachments/${attachment.id}/content`,
    };
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

  function canManageTaskAssignmentsLegacy(agent: {
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
    label: "Assignee" | "Reviewer",
  ) {
    const agent = await agentsSvc.getById(agentId);
    if (!agent || agent.companyId !== companyId) {
      throw notFound(`${label} agent not found`);
    }
    if (agent.status === "pending_approval") {
      throw conflict(`Cannot assign ${label.toLowerCase()} to pending approval agents`);
    }
    if (agent.status === "terminated") {
      throw conflict(`Cannot assign ${label.toLowerCase()} to terminated agents`);
    }
    return agent;
  }

  async function assertInternalWorkItemAssignee(companyId: string, assigneeAgentId: string) {
    const assignee = await assertActiveCompanyAgent(companyId, assigneeAgentId, "Assignee");
    const allowedRoles = getAllowedProtocolRoles(assignee);
    if (allowedRoles.has("tech_lead")) {
      return { agent: assignee, protocolRole: "tech_lead" as const };
    }
    if (allowedRoles.has("engineer")) {
      return { agent: assignee, protocolRole: "engineer" as const };
    }
    throw unprocessable("Assignee agent must support engineer or tech_lead protocol role");
  }

  async function assertInternalWorkItemReviewer(companyId: string, reviewerAgentId: string) {
    const reviewer = await assertActiveCompanyAgent(companyId, reviewerAgentId, "Reviewer");
    const allowedRoles = getAllowedProtocolRoles(reviewer);
    if (!allowedRoles.has("reviewer")) {
      throw unprocessable("Reviewer agent must support reviewer protocol role");
    }
    return reviewer;
  }

  async function buildTaskAssignmentSender(req: Request, companyId: string): Promise<CreateIssueProtocolMessage["sender"]> {
    const actor = getActorInfo(req);
    if (req.actor.type === "board") {
      return {
        actorType: "user",
        actorId: actor.actorId,
        role: "human_board",
      };
    }

    if (!req.actor.agentId) {
      throw forbidden("Agent authentication required");
    }

    const agent = await agentsSvc.getById(req.actor.agentId);
    if (!agent || agent.companyId !== companyId) {
      throw forbidden("Agent not found");
    }

    if (agent.role === "cto") {
      return { actorType: "agent", actorId: agent.id, role: "cto" };
    }
    if (agent.role === "pm") {
      return { actorType: "agent", actorId: agent.id, role: "pm" };
    }
    if (agent.role === "tech_lead" || agent.role === "manager" || /tech lead/i.test(agent.title ?? "")) {
      return { actorType: "agent", actorId: agent.id, role: "tech_lead" };
    }

    throw forbidden("Agent cannot create internal work items through protocol assignment");
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
    };
    message: CreateIssueProtocolMessage;
    actor: ReturnType<typeof getActorInfo>;
  }) {
    const result = await protocolSvc.appendMessage({
      issueId: input.issue.id,
      message: input.message,
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
        messageType: input.message.messageType,
        workflowStateBefore: input.message.workflowStateBefore,
        workflowStateAfter: input.message.workflowStateAfter,
        summary: input.message.summary,
      },
    });

    let recipientHints: Array<{
      recipientId: string;
      recipientRole: string;
      retrievalRunId: string;
      briefId: string;
      briefScope: string;
    }> = [];
    try {
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
        },
        triggeringMessageId: result.message.id,
        triggeringMessageSeq: result.message.seq,
        message: input.message,
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
            messageType: input.message.messageType,
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
          messageType: input.message.messageType,
          errorMessage: err instanceof Error ? err.message : String(err),
        },
        "CRITICAL: Failed to build protocol retrieval context - brief generation failed",
      );
    }

    try {
      await protocolExecution.dispatchMessage({
        issueId: input.issue.id,
        companyId: input.issue.companyId,
        protocolMessageId: result.message.id,
        message: input.message,
        recipientHints,
        actor: input.actor,
      });
      return { result, warnings: [] as string[] };
    } catch (err) {
      logger.error({ err, issueId: input.issue.id }, "Protocol dispatch failed - agents may not be notified");
      return { result, warnings: ["Wakeup dispatch failed - agents may not be notified"] };
    }
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
      message.messageType === "ASSIGN_TASK"
      || message.messageType === "REASSIGN_TASK"
      || message.messageType === "CANCEL_TASK"
      || message.messageType === "CLOSE_TASK"
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

    if (err.status === 409) {
      if (err.message.includes("active review cycle already exists")) {
        return { violationCode: "duplicate_active_review", severity: "high" } as const;
      }
      if (err.message.includes("No active review cycle found")) {
        return { violationCode: "stale_review_cycle_action", severity: "medium" } as const;
      }
       if (
        err.message.includes("without SUBMIT_FOR_REVIEW")
        || err.message.includes("without SUBMIT_FOR_REVIEW")
      ) {
        return { violationCode: "invalid_predecessor_message", severity: "high" } as const;
      }
      if (err.message.includes("Cannot close task before approval")) {
        return { violationCode: "close_without_approval", severity: "high" } as const;
      }
      if (err.message.includes("Close task requires")) {
        return { violationCode: "close_without_verification", severity: "high" } as const;
      }
      return { violationCode: "invalid_state_transition", severity: "high" } as const;
    }

    if (err.status === 403) {
      return { violationCode: "unauthorized_sender", severity: "high" } as const;
    }

    if (err.status === 422) {
      if (err.message.includes("Missing required artifact")) {
        return { violationCode: "missing_required_artifact", severity: "medium" } as const;
      }
      if (err.message.includes("Only the assigned") || err.message.includes("Sender role")) {
        return { violationCode: "unauthorized_sender", severity: "high" } as const;
      }
      if (err.message.includes("Close task requires")) {
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

    const result = await svc.list(companyId, {
      status: req.query.status as string | undefined,
      assigneeAgentId: req.query.assigneeAgentId as string | undefined,
      assigneeUserId,
      projectId: req.query.projectId as string | undefined,
      labelId: req.query.labelId as string | undefined,
      q: req.query.q as string | undefined,
    });
    res.json(result);
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
    const [internalWorkItems, internalWorkItemSummary] = await Promise.all([
      svc.listInternalWorkItems(issue.id),
      svc.getInternalWorkItemSummary(issue.id),
    ]);
    res.json({
      ...issue,
      ancestors,
      internalWorkItems,
      internalWorkItemSummary,
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
    if (req.body.assigneeAgentId === req.body.reviewerAgentId) {
      throw unprocessable("Reviewer must be different from assignee");
    }
    const assignee = await assertInternalWorkItemAssignee(rootIssue.companyId, req.body.assigneeAgentId);
    await assertInternalWorkItemReviewer(rootIssue.companyId, req.body.reviewerAgentId);

    const labelNames = [
      "team:internal",
      req.body.kind === "plan"
        ? "work:plan"
        : req.body.kind === "implementation"
          ? "work:implementation"
          : req.body.kind === "review"
            ? "work:review"
            : "work:qa",
      ...(req.body.watchReviewer === false ? [] : ["watch:reviewer"]),
      ...(req.body.watchLead === false ? [] : ["watch:lead"]),
    ];

    const workItem = await svc.createInternalWorkItem({
      parentIssueId: rootIssue.id,
      companyId: rootIssue.companyId,
      title: req.body.title,
      description: req.body.description ?? null,
      kind: req.body.kind,
      priority: req.body.priority,
      assigneeAgentId: req.body.assigneeAgentId,
      createdByAgentId: actor.agentId,
      createdByUserId: actor.actorType === "user" ? actor.actorId : null,
      labelNames,
    });

    await logActivity(db, {
      companyId: workItem.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "issue.created",
      entityType: "issue",
      entityId: workItem.id,
      details: {
        title: workItem.title,
        identifier: workItem.identifier,
        parentIssueId: rootIssue.id,
        internalWorkItem: true,
        kind: req.body.kind,
      },
    });

    const assignmentMessage: CreateIssueProtocolMessage = {
      messageType: "ASSIGN_TASK",
      sender,
      recipients: [
        {
          recipientType: "agent",
          recipientId: req.body.assigneeAgentId,
          role: assignee.protocolRole,
        },
        {
          recipientType: "agent",
          recipientId: req.body.reviewerAgentId,
          role: "reviewer",
        },
      ],
      workflowStateBefore: "backlog",
      workflowStateAfter: "assigned",
      summary: `Assign internal ${req.body.kind} work item`,
      requiresAck: false,
      payload: {
        goal: req.body.goal?.trim() || req.body.title,
        acceptanceCriteria: req.body.acceptanceCriteria,
        definitionOfDone: req.body.definitionOfDone,
        priority: req.body.priority,
        assigneeAgentId: req.body.assigneeAgentId,
        reviewerAgentId: req.body.reviewerAgentId,
        deadlineAt: req.body.deadlineAt ?? null,
        relatedIssueIds: req.body.relatedIssueIds,
        requiredKnowledgeTags: req.body.requiredKnowledgeTags,
      },
      artifacts: [],
    };

    let dispatch;
    try {
      dispatch = await appendProtocolMessageAndDispatch({
        issue: workItem,
        message: assignmentMessage,
        actor,
      });
    } catch (err) {
      try {
        await svc.remove(workItem.id);
      } catch (cleanupErr) {
        logger.error(
          { err: cleanupErr, issueId: workItem.id, parentIssueId: rootIssue.id },
          "failed to clean up internal work item after initial protocol assignment failed",
        );
      }
      throw err;
    }

    const refreshedWorkItem = await svc.getById(workItem.id) ?? workItem;

    res.status(201).json({
      issue: refreshedWorkItem,
      protocol: dispatch.result,
      warnings: dispatch.warnings,
    });
  });

  router.get("/issues/:id/approvals", async (req, res) => {
    const id = req.params.id as string;
    const issue = await svc.getById(id);
    if (!issue) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }
    assertCompanyAccess(req, issue.companyId);
    const approvals = await issueApprovalsSvc.listApprovalsForIssue(id);
    res.json(approvals);
  });

  router.post("/issues/:id/approvals", validate(linkIssueApprovalSchema), async (req, res) => {
    const id = req.params.id as string;
    const issue = await svc.getById(id);
    if (!issue) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }
    if (!(await assertCanManageIssueApprovalLinks(req, res, issue.companyId))) return;

    const actor = getActorInfo(req);
    await issueApprovalsSvc.link(id, req.body.approvalId, {
      agentId: actor.agentId,
      userId: actor.actorType === "user" ? actor.actorId : null,
    });

    await logActivity(db, {
      companyId: issue.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "issue.approval_linked",
      entityType: "issue",
      entityId: issue.id,
      details: { approvalId: req.body.approvalId },
    });

    const approvals = await issueApprovalsSvc.listApprovalsForIssue(id);
    res.status(201).json(approvals);
  });

  router.delete("/issues/:id/approvals/:approvalId", async (req, res) => {
    const id = req.params.id as string;
    const approvalId = req.params.approvalId as string;
    const issue = await svc.getById(id);
    if (!issue) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }
    if (!(await assertCanManageIssueApprovalLinks(req, res, issue.companyId))) return;

    await issueApprovalsSvc.unlink(id, approvalId);

    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId: issue.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "issue.approval_unlinked",
      entityType: "issue",
      entityId: issue.id,
      details: { approvalId },
    });

    res.json({ ok: true });
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

    const { comment: commentBody, hiddenAt: hiddenAtRaw, ...updateFields } = req.body;
    if (hiddenAtRaw !== undefined) {
      updateFields.hiddenAt = hiddenAtRaw ? new Date(hiddenAtRaw) : null;
    }
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
      let mentionedIds: string[] = [];
      try {
        mentionedIds = await svc.findMentionedAgents(issue.companyId, commentBody);
      } catch (err) {
        logger.warn({ err, issueId: id }, "failed to resolve @-mentions");
      }

      for (const mentionedId of mentionedIds) {
        if (wakeups.has(mentionedId)) continue;
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

  router.get("/issues/:id/protocol/state", async (req, res) => {
    const id = req.params.id as string;
    const issue = await svc.getById(id);
    if (!issue) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }
    assertCompanyAccess(req, issue.companyId);
    const state = await protocolSvc.getState(id);
    res.json(state);
  });

  router.get("/issues/:id/protocol/messages", async (req, res) => {
    const id = req.params.id as string;
    const issue = await svc.getById(id);
    if (!issue) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }
    assertCompanyAccess(req, issue.companyId);
    const messages = await protocolSvc.listMessages(id);
    res.json(messages);
  });

  router.get("/issues/:id/protocol/briefs", async (req, res) => {
    const id = req.params.id as string;
    const issue = await svc.getById(id);
    if (!issue) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }
    assertCompanyAccess(req, issue.companyId);

    const scope =
      typeof req.query.scope === "string" && req.query.scope.trim().length > 0
        ? req.query.scope.trim()
        : null;
    const latest = req.query.latest === "true";

    if (latest && scope) {
      const brief = await knowledge.getLatestTaskBrief(id, scope);
      if (!brief) {
        res.status(404).json({ error: "Brief not found" });
        return;
      }
      res.json(brief);
      return;
    }

    const briefs = await knowledge.listTaskBriefs({
      issueId: id,
      briefScope: scope,
      limit: 20,
    });
    res.json(briefs);
  });

  router.get("/issues/:id/protocol/review-cycles", async (req, res) => {
    const id = req.params.id as string;
    const issue = await svc.getById(id);
    if (!issue) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }
    assertCompanyAccess(req, issue.companyId);
    const reviewCycles = await protocolSvc.listReviewCycles(id);
    res.json(reviewCycles);
  });

  router.get("/issues/:id/protocol/violations", async (req, res) => {
    const id = req.params.id as string;
    const issue = await svc.getById(id);
    if (!issue) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }
    assertCompanyAccess(req, issue.companyId);

    const status =
      typeof req.query.status === "string" && req.query.status.trim().length > 0
        ? req.query.status.trim()
        : null;

    const violations = await protocolSvc.listViolations({
      issueId: id,
      status,
    });
    res.json(violations);
  });

  router.post("/issues/:id/protocol/messages", async (req, res, next) => {
    const id = req.params.id as string;
    const issue = await svc.getById(id);
    if (!issue) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }

    assertCompanyAccess(req, issue.companyId);

    const parsedMessage = createIssueProtocolMessageSchema.safeParse(req.body);
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
      try {
        mentionedIds = await svc.findMentionedAgents(issue.companyId, req.body.body);
      } catch (err) {
        logger.warn({ err, issueId: id }, "failed to resolve @-mentions");
      }

      for (const mentionedId of mentionedIds) {
        if (wakeups.has(mentionedId)) continue;
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

  router.get("/issues/:id/attachments", async (req, res) => {
    const issueId = req.params.id as string;
    const issue = await svc.getById(issueId);
    if (!issue) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }
    assertCompanyAccess(req, issue.companyId);
    const attachments = await svc.listAttachments(issueId);
    res.json(attachments.map(withContentPath));
  });

  router.post("/companies/:companyId/issues/:issueId/attachments", async (req, res) => {
    const companyId = req.params.companyId as string;
    const issueId = req.params.issueId as string;
    assertCompanyAccess(req, companyId);
    const issue = await svc.getById(issueId);
    if (!issue) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }
    if (issue.companyId !== companyId) {
      res.status(422).json({ error: "Issue does not belong to company" });
      return;
    }

    try {
      await runSingleFileUpload(req, res);
    } catch (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          res.status(422).json({ error: `Attachment exceeds ${MAX_ATTACHMENT_BYTES} bytes` });
          return;
        }
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }

    const file = (req as Request & { file?: { mimetype: string; buffer: Buffer; originalname: string } }).file;
    if (!file) {
      res.status(400).json({ error: "Missing file field 'file'" });
      return;
    }
    const contentType = (file.mimetype || "").toLowerCase();
    if (!ALLOWED_ATTACHMENT_CONTENT_TYPES.has(contentType)) {
      res.status(422).json({ error: `Unsupported attachment type: ${contentType || "unknown"}` });
      return;
    }
    if (file.buffer.length <= 0) {
      res.status(422).json({ error: "Attachment is empty" });
      return;
    }

    const parsedMeta = createIssueAttachmentMetadataSchema.safeParse(req.body ?? {});
    if (!parsedMeta.success) {
      res.status(400).json({ error: "Invalid attachment metadata", details: parsedMeta.error.issues });
      return;
    }

    const actor = getActorInfo(req);
    const stored = await storage.putFile({
      companyId,
      namespace: `issues/${issueId}`,
      originalFilename: file.originalname || null,
      contentType,
      body: file.buffer,
    });

    const attachment = await svc.createAttachment({
      issueId,
      issueCommentId: parsedMeta.data.issueCommentId ?? null,
      provider: stored.provider,
      objectKey: stored.objectKey,
      contentType: stored.contentType,
      byteSize: stored.byteSize,
      sha256: stored.sha256,
      originalFilename: stored.originalFilename,
      createdByAgentId: actor.agentId,
      createdByUserId: actor.actorType === "user" ? actor.actorId : null,
    });

    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "issue.attachment_added",
      entityType: "issue",
      entityId: issueId,
      details: {
        attachmentId: attachment.id,
        originalFilename: attachment.originalFilename,
        contentType: attachment.contentType,
        byteSize: attachment.byteSize,
      },
    });

    res.status(201).json(withContentPath(attachment));
  });

  router.get("/attachments/:attachmentId/content", async (req, res, next) => {
    const attachmentId = req.params.attachmentId as string;
    const attachment = await svc.getAttachmentById(attachmentId);
    if (!attachment) {
      res.status(404).json({ error: "Attachment not found" });
      return;
    }
    assertCompanyAccess(req, attachment.companyId);

    const object = await storage.getObject(attachment.companyId, attachment.objectKey);
    res.setHeader("Content-Type", attachment.contentType || object.contentType || "application/octet-stream");
    res.setHeader("Content-Length", String(attachment.byteSize || object.contentLength || 0));
    res.setHeader("Cache-Control", "private, max-age=60");
    const filename = attachment.originalFilename ?? "attachment";
    res.setHeader("Content-Disposition", `inline; filename=\"${filename.replaceAll("\"", "")}\"`);

    object.stream.on("error", (err) => {
      next(err);
    });
    object.stream.pipe(res);
  });

  router.delete("/attachments/:attachmentId", async (req, res) => {
    const attachmentId = req.params.attachmentId as string;
    const attachment = await svc.getAttachmentById(attachmentId);
    if (!attachment) {
      res.status(404).json({ error: "Attachment not found" });
      return;
    }
    assertCompanyAccess(req, attachment.companyId);

    try {
      await storage.deleteObject(attachment.companyId, attachment.objectKey);
    } catch (err) {
      logger.warn({ err, attachmentId }, "storage delete failed while removing attachment");
    }

    const removed = await svc.removeAttachment(attachmentId);
    if (!removed) {
      res.status(404).json({ error: "Attachment not found" });
      return;
    }

    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId: removed.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "issue.attachment_removed",
      entityType: "issue",
      entityId: removed.issueId,
      details: {
        attachmentId: removed.id,
      },
    });

    res.json({ ok: true });
  });

  return router;
}
