import { validate } from "../../middleware/validate.js";
import {
  createPmIntakeIssueSchema,
  createPmIntakeProjectionSchema,
  KNOWLEDGE_PM_CANONICAL_SOURCE_TYPES,
  previewPmIntakeProjectionSchema,
  type CreateIssueProtocolMessage,
} from "@squadrail/shared";
import { assertCompanyAccess, getActorInfo } from "../authz.js";
import { logActivity } from "../../services/index.js";
import { conflict, forbidden, unprocessable } from "../../errors.js";
import type { IssueRouteContext } from "./context.js";

function isPmIntakeRootIssue(issue: {
  description?: string | null;
  labels?: Array<{ name?: string | null }> | null;
}) {
  const description = typeof issue.description === "string" ? issue.description : "";
  if (/## Human Intake Request\b/i.test(description)) return true;
  return (issue.labels ?? []).some((label) => label?.name === "workflow:intake");
}

export function registerIssueIntakeRoutes(ctx: IssueRouteContext) {
  const { router, db } = ctx;
  const { svc, agentsSvc, knowledge, projectsSvc, protocolSvc } = ctx.services;
  const {
    assertCanAssignTasks,
    ensureIssueLabelsByName,
    scheduleIssueMemoryIngest,
    buildTaskAssignmentSender,
    appendProtocolMessageAndDispatch,
    assertInternalWorkItemReviewer,
    assertInternalWorkItemQa,
    assertInternalWorkItemLeadSupervisor,
    createAndAssignInternalWorkItem,
    buildPmProjectionRootDescription,
    resolvePmIntakeAgents,
    derivePmIntakeIssueTitle,
    buildPmIntakeIssueDescription,
    buildPmIntakeAssignment,
    buildPmIntakeProjectionPreview,
  } = ctx.helpers;
  const { pmIntakeLabelSpecs } = ctx.constants;

  router.post("/companies/:companyId/intake/issues", validate(createPmIntakeIssueSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    await assertCanAssignTasks(req, companyId);

    const actor = getActorInfo(req);
    const companyAgents = await agentsSvc.list(companyId);
    const { pmAgent, reviewerAgent } = resolvePmIntakeAgents({
      agents: companyAgents,
      pmAgentId: req.body.pmAgentId ?? null,
      reviewerAgentId: req.body.reviewerAgentId ?? null,
    });

    const relatedIssueIdentifiers = req.body.relatedIssueIds?.length
      ? (await Promise.all(req.body.relatedIssueIds.map(async (issueId: string) => {
          const issue = await svc.getById(issueId);
          return issue?.companyId === companyId ? (issue.identifier ?? issue.id) : null;
        }))).filter((value): value is string => typeof value === "string")
      : [];

    const scopedProject =
      req.body.projectId
        ? await projectsSvc.getById(req.body.projectId)
        : null;

    if (scopedProject && scopedProject.companyId !== companyId) {
      throw unprocessable("Selected project must belong to this company");
    }

    const title = derivePmIntakeIssueTitle({
      title: req.body.title ?? null,
      request: req.body.request,
    });
    const description = buildPmIntakeIssueDescription({
      request: req.body.request,
      projectName: scopedProject?.name ?? null,
      relatedIssueIdentifiers,
    });
    const labels: Array<{ id: string }> = await ensureIssueLabelsByName(companyId, pmIntakeLabelSpecs);

    const issue = await svc.create(companyId, {
      projectId: req.body.projectId ?? null,
      goalId: req.body.goalId ?? null,
      parentId: null,
      title,
      description,
      status: "backlog",
      priority: req.body.priority,
      assigneeAgentId: pmAgent.id,
      assigneeUserId: null,
      requestDepth: 0,
      billingCode: null,
      assigneeAdapterOverrides: null,
      createdByAgentId: actor.agentId,
      createdByUserId: actor.actorType === "user" ? actor.actorId : null,
      labelIds: labels.map((label) => label.id),
    });

    scheduleIssueMemoryIngest(issue.id, "create");

    const sender = await buildTaskAssignmentSender(req, companyId);
    const assignment = buildPmIntakeAssignment({
      title,
      priority: req.body.priority,
      pmAgentId: pmAgent.id,
      reviewerAgentId: reviewerAgent.id,
      requestedDueAt: req.body.requestedDueAt ?? null,
      relatedIssueIds: req.body.relatedIssueIds,
      requiredKnowledgeTags: req.body.requiredKnowledgeTags,
    });

    const assignmentMessage: CreateIssueProtocolMessage = {
      messageType: "ASSIGN_TASK",
      sender,
      recipients: [
        {
          recipientType: "agent",
          recipientId: pmAgent.id,
          role: "pm",
        },
        {
          recipientType: "agent",
          recipientId: reviewerAgent.id,
          role: "reviewer",
        },
      ],
      workflowStateBefore: "backlog",
      workflowStateAfter: "assigned",
      summary: assignment.summary,
      requiresAck: false,
      payload: assignment.payload,
      artifacts: [],
    };

    let dispatch;
    try {
      dispatch = await appendProtocolMessageAndDispatch({
        issue,
        message: assignmentMessage,
        actor,
        asyncDispatch: true,
      });
    } catch (err) {
      try {
        await svc.remove(issue.id);
      } catch (cleanupErr) {
        void logActivity(db, {
          companyId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          agentId: actor.agentId,
          runId: actor.runId,
          action: "issue.intake.cleanup_failed",
          entityType: "issue",
          entityId: issue.id,
          details: {
            stage: "initial_assignment",
            error: cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr),
          },
        }).catch(() => {});
      }
      throw err;
    }

    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "issue.intake.created",
      entityType: "issue",
      entityId: issue.id,
      details: {
        identifier: issue.identifier,
        pmAgentId: pmAgent.id,
        reviewerAgentId: reviewerAgent.id,
        projectId: issue.projectId,
      },
    });

    const refreshedIssue = await svc.getById(issue.id) ?? issue;

    res.status(201).json({
      issue: refreshedIssue,
      protocol: dispatch.result,
      warnings: dispatch.warnings,
      intake: {
        pmAgentId: pmAgent.id,
        reviewerAgentId: reviewerAgent.id,
      },
    });
  });

  router.post("/issues/:id/intake/projection", validate(createPmIntakeProjectionSchema), async (req, res) => {
    const issueId = req.params.id as string;
    const rootIssue = await svc.getById(issueId);
    if (!rootIssue) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }

    assertCompanyAccess(req, rootIssue.companyId);
    await assertCanAssignTasks(req, rootIssue.companyId);
    if (rootIssue.parentId) {
      throw unprocessable("PM intake projection can only run on root issues");
    }
    if (!isPmIntakeRootIssue(rootIssue)) {
      throw unprocessable("PM intake projection can only run on root intake issues");
    }

    const actor = getActorInfo(req);
    const sender = await buildTaskAssignmentSender(req, rootIssue.companyId);
    if (sender.role !== "pm" && sender.role !== "cto" && sender.role !== "human_board") {
      throw forbidden("Only PM, CTO, or board actors can project intake issues");
    }

    const rootProtocolState = await protocolSvc.getState(rootIssue.id);
    if (!rootProtocolState) {
      throw conflict("PM intake projection requires initialized protocol state");
    }

    const techLead = await assertInternalWorkItemLeadSupervisor(rootIssue.companyId, req.body.techLeadAgentId);
    const reviewer = await assertInternalWorkItemReviewer(rootIssue.companyId, req.body.reviewerAgentId);
    const qaAgent = req.body.qaAgentId
      ? await assertInternalWorkItemQa(rootIssue.companyId, req.body.qaAgentId)
      : null;
    const scopedProject =
      req.body.root.projectId
        ? await projectsSvc.getById(req.body.root.projectId)
        : rootIssue.projectId
          ? await projectsSvc.getById(rootIssue.projectId)
          : null;
    if (scopedProject && scopedProject.companyId !== rootIssue.companyId) {
      throw unprocessable("Selected project must belong to the same company");
    }

    const nextDescription = buildPmProjectionRootDescription({
      requestDescription: rootIssue.description,
      projectName: scopedProject?.name ?? null,
      techLeadName: techLead.name,
      reviewerName: reviewer.name,
      qaName: qaAgent?.name ?? null,
      root: req.body.root,
    });

    const updatedRoot = await svc.update(rootIssue.id, {
      title: req.body.root.structuredTitle ?? rootIssue.title,
      description: nextDescription,
      projectId: req.body.root.projectId === undefined ? rootIssue.projectId : req.body.root.projectId,
      priority: req.body.root.priority ?? rootIssue.priority,
    }) ?? rootIssue;
    scheduleIssueMemoryIngest(rootIssue.id, "update");

    let reassignDispatch: Awaited<ReturnType<typeof appendProtocolMessageAndDispatch>> | null = null;
    if (!req.body.coordinationOnly) {
      const reassignMessage: CreateIssueProtocolMessage = {
        messageType: "REASSIGN_TASK",
        sender,
        recipients: [
          {
            recipientType: "agent",
            recipientId: techLead.id,
            role: "tech_lead",
          },
          {
            recipientType: "agent",
            recipientId: reviewer.id,
            role: "reviewer",
          },
          ...(qaAgent
            ? [{
                recipientType: "agent" as const,
                recipientId: qaAgent.id,
                role: "qa" as const,
              }]
            : []),
        ],
        workflowStateBefore: rootProtocolState.workflowState as CreateIssueProtocolMessage["workflowStateBefore"],
        workflowStateAfter: "assigned",
        summary: `Route ${updatedRoot.identifier ?? updatedRoot.title} into ${techLead.name}'s TL lane`,
        requiresAck: false,
        payload: {
          reason: req.body.reason,
          newAssigneeAgentId: techLead.id,
          newReviewerAgentId: reviewer.id,
          newQaAgentId: qaAgent?.id ?? null,
          carryForwardBriefVersion: req.body.carryForwardBriefVersion ?? null,
        },
        artifacts: [],
      };

      reassignDispatch = await appendProtocolMessageAndDispatch({
        issue: updatedRoot,
        message: reassignMessage,
        actor,
        asyncDispatch: true,
      });
    }

    const projectedWorkItems = [];
    for (const workItem of req.body.workItems) {
      const projected = await createAndAssignInternalWorkItem({
        rootIssue: updatedRoot,
        actor,
        sender,
        rootProtocolState,
        leadAgentIdOverride: techLead.id,
        body: {
          ...workItem,
          qaAgentId: workItem.qaAgentId ?? qaAgent?.id ?? null,
        },
      });
      projectedWorkItems.push(projected.issue);
    }

    await logActivity(db, {
      companyId: rootIssue.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "issue.intake.projected",
      entityType: "issue",
      entityId: rootIssue.id,
      details: {
        identifier: updatedRoot.identifier,
        techLeadAgentId: techLead.id,
        reviewerAgentId: reviewer.id,
        qaAgentId: qaAgent?.id ?? null,
        coordinationOnly: req.body.coordinationOnly ?? false,
        projectedWorkItemCount: projectedWorkItems.length,
      },
    });

    res.status(201).json({
      issue: updatedRoot,
      protocol: reassignDispatch?.result ?? null,
      warnings: reassignDispatch?.warnings ?? [],
      projectedWorkItems,
      intakeProjection: {
        techLeadAgentId: techLead.id,
        reviewerAgentId: reviewer.id,
        qaAgentId: qaAgent?.id ?? null,
        coordinationOnly: req.body.coordinationOnly ?? false,
      },
    });
  });

  router.post("/issues/:id/intake/projection-preview", validate(previewPmIntakeProjectionSchema), async (req, res) => {
    const issueId = req.params.id as string;
    const rootIssue = await svc.getById(issueId);
    if (!rootIssue) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }

    assertCompanyAccess(req, rootIssue.companyId);
    await assertCanAssignTasks(req, rootIssue.companyId);
    if (rootIssue.parentId) {
      throw unprocessable("PM intake projection preview can only run on root issues");
    }
    if (!isPmIntakeRootIssue(rootIssue)) {
      throw unprocessable("PM intake projection preview can only run on root intake issues");
    }

    const sender = await buildTaskAssignmentSender(req, rootIssue.companyId);
    if (sender.role !== "pm" && sender.role !== "cto" && sender.role !== "human_board") {
      throw forbidden("Only PM, CTO, or board actors can preview intake projection");
    }

    const [companyAgents, companyProjects, knowledgeDocsByType] = await Promise.all([
      agentsSvc.list(rootIssue.companyId),
      projectsSvc.list(rootIssue.companyId),
      Promise.all(KNOWLEDGE_PM_CANONICAL_SOURCE_TYPES.map((sourceType) => (
        knowledge.listDocuments({
          companyId: rootIssue.companyId,
          sourceType,
          limit: 500,
        })
      ))),
    ]);
    const companyKnowledgeDocuments = knowledgeDocsByType.flat();

    const preview = buildPmIntakeProjectionPreview({
      issue: {
        id: rootIssue.id,
        companyId: rootIssue.companyId,
        title: rootIssue.title,
        description: rootIssue.description,
        priority: rootIssue.priority as "low" | "medium" | "high" | "critical",
        projectId: rootIssue.projectId ?? null,
      },
      projects: companyProjects.map((project: Awaited<ReturnType<typeof projectsSvc.list>>[number]) => ({
        id: project.id,
        companyId: project.companyId,
        name: project.name,
        description: (project as { description?: string | null }).description ?? null,
        urlKey: project.urlKey ?? null,
        primaryWorkspace: project.primaryWorkspace
          ? {
              cwd: project.primaryWorkspace.cwd,
              repoUrl: project.primaryWorkspace.repoUrl ?? null,
              repoRef: project.primaryWorkspace.repoRef,
            }
          : null,
      })),
      knowledgeDocuments: companyKnowledgeDocuments.map((document) => ({
        id: document.id,
        companyId: document.companyId,
        projectId: document.projectId ?? null,
        sourceType: document.sourceType,
        authorityLevel: document.authorityLevel,
        path: document.path ?? null,
        title: document.title ?? null,
        rawContent: document.rawContent,
        metadata: document.metadata ?? {},
      })),
      agents: companyAgents.map((agent: Awaited<ReturnType<typeof agentsSvc.list>>[number]) => ({
        id: agent.id,
        companyId: agent.companyId,
        name: agent.name,
        urlKey: agent.urlKey ?? null,
        role: agent.role,
        status: agent.status,
        reportsTo: agent.reportsTo,
        title: agent.title ?? null,
      })),
      request: req.body,
    });

    res.json(preview);
  });
}
