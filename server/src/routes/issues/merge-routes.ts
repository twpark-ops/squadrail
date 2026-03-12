import { logger } from "../../middleware/logger.js";
import { assertCompanyAccess, getActorInfo } from "../authz.js";
import { logActivity } from "../../services/index.js";
import { buildRevertAssistContextBody } from "../../services/revert-assist.js";
import type { IssueRouteContext } from "./context.js";
import { runMergeCandidateRecoverySchema } from "@squadrail/shared";

export function registerIssueMergeRoutes(ctx: IssueRouteContext) {
  const { router, db } = ctx;
  const { svc, projectsSvc, protocolSvc, retrievalPersonalization, mergeCandidatesSvc } = ctx.services;
  const {
    loadIssueChangeSurface,
    queueIssueWakeup,
    buildMergeAutomationPlan,
    runMergeAutomationAction,
  } = ctx.helpers;
  const {
    mergeCandidateActionSchema,
    mergeCandidateAutomationSchema,
    retrievalFeedbackSchema,
  } = ctx.schemas;

  router.get("/issues/:id/change-surface", async (req, res) => {
    const id = req.params.id as string;
    const issue = await svc.getById(id);
    if (!issue) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }
    assertCompanyAccess(req, issue.companyId);
    const surface = await loadIssueChangeSurface(issue);
    res.json(surface);
  });

  router.post("/issues/:id/retrieval-feedback", async (req, res) => {
    const id = req.params.id as string;
    const issue = await svc.getById(id);
    if (!issue) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }
    assertCompanyAccess(req, issue.companyId);
    if (req.actor.type !== "board") {
      res.status(403).json({ error: "Only board users can record retrieval feedback" });
      return;
    }

    const parsed = retrievalFeedbackSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation error", details: parsed.error.issues });
      return;
    }

    const actor = getActorInfo(req);
    const result = await retrievalPersonalization.recordManualFeedback({
      companyId: issue.companyId,
      issueId: issue.id,
      issueProjectId: issue.projectId ?? null,
      retrievalRunId: parsed.data.retrievalRunId,
      feedbackType: parsed.data.feedbackType,
      targetType: parsed.data.targetType,
      targetIds: parsed.data.targetIds,
      actorRole: "human_board",
      noteBody: parsed.data.noteBody ?? null,
    });

    await logActivity(db, {
      companyId: issue.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "issue.retrieval_feedback.recorded",
      entityType: "issue",
      entityId: issue.id,
      details: {
        retrievalRunId: parsed.data.retrievalRunId,
        feedbackType: parsed.data.feedbackType,
        targetType: parsed.data.targetType,
        targetIds: parsed.data.targetIds,
        feedbackEventCount: result.feedbackEventCount,
      },
    });

    res.json(result);
  });

  router.get("/issues/:id/merge-candidate", async (req, res) => {
    const id = req.params.id as string;
    const issue = await svc.getById(id);
    if (!issue) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }
    assertCompanyAccess(req, issue.companyId);
    const surface = await loadIssueChangeSurface(issue);
    if (!surface.mergeCandidate) {
      res.status(404).json({ error: "Merge candidate not found" });
      return;
    }
    res.json(surface.mergeCandidate);
  });

  router.get("/issues/:id/merge-candidate/plan", async (req, res) => {
    const id = req.params.id as string;
    const issue = await svc.getById(id);
    if (!issue) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }
    assertCompanyAccess(req, issue.companyId);
    const surface = await loadIssueChangeSurface(issue);
    if (!surface.mergeCandidate) {
      res.status(404).json({ error: "Merge candidate not found" });
      return;
    }

    const project = issue.projectId ? await projectsSvc.getById(issue.projectId) : null;
    const targetBaseBranch =
      typeof req.query.targetBaseBranch === "string" && req.query.targetBaseBranch.trim().length > 0
        ? req.query.targetBaseBranch.trim()
        : null;
    const integrationBranchName =
      typeof req.query.integrationBranchName === "string" && req.query.integrationBranchName.trim().length > 0
        ? req.query.integrationBranchName.trim()
        : null;
    const remoteName =
      typeof req.query.remoteName === "string" && req.query.remoteName.trim().length > 0
        ? req.query.remoteName.trim()
        : null;

    const plan = await buildMergeAutomationPlan({
      issue: {
        id: issue.id,
        identifier: issue.identifier ?? null,
        title: issue.title,
        projectId: issue.projectId ?? null,
      },
      project: project
        ? {
            id: project.id,
            name: project.name,
            primaryWorkspace: project.primaryWorkspace
              ? {
                  id: project.primaryWorkspace.id,
                  name: project.primaryWorkspace.name,
                  cwd: project.primaryWorkspace.cwd,
                  repoRef: project.primaryWorkspace.repoRef,
                }
              : null,
          }
        : null,
      candidate: surface.mergeCandidate,
      targetBaseBranch,
      integrationBranchName,
      remoteName,
    });

    res.json(plan);
  });

  router.post("/issues/:id/merge-candidate/actions", async (req, res) => {
    const id = req.params.id as string;
    const issue = await svc.getById(id);
    if (!issue) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }
    assertCompanyAccess(req, issue.companyId);
    if (req.actor.type !== "board") {
      res.status(403).json({ error: "Only board users can resolve merge candidates" });
      return;
    }

    const parsed = mergeCandidateActionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation error", details: parsed.error.issues });
      return;
    }

    const surface = await loadIssueChangeSurface(issue);
    if (!surface.mergeCandidate) {
      res.status(409).json({ error: "Issue has no merge candidate" });
      return;
    }
    if (
      parsed.data.actionType === "mark_merged"
      && surface.mergeCandidate.prBridge
      && surface.mergeCandidate.gateStatus
      && surface.mergeCandidate.gateStatus.mergeReady === false
    ) {
      res.status(409).json({
        error: "Merge candidate is blocked by synced PR checks",
        blockingReasons: surface.mergeCandidate.gateStatus.blockingReasons,
      });
      return;
    }

    const actor = getActorInfo(req);
    const nextState = parsed.data.actionType === "mark_merged" ? "merged" : "rejected";
    await mergeCandidatesSvc.upsertDecision({
      companyId: issue.companyId,
      issueId: issue.id,
      closeMessageId: surface.mergeCandidate.closeMessageId,
      state: nextState,
      sourceBranch: surface.mergeCandidate.sourceBranch,
      workspacePath: surface.mergeCandidate.workspacePath,
      headSha: surface.mergeCandidate.headSha,
      diffStat: surface.mergeCandidate.diffStat,
      targetBaseBranch: parsed.data.targetBaseBranch ?? surface.mergeCandidate.targetBaseBranch,
      mergeCommitSha: parsed.data.mergeCommitSha ?? surface.mergeCandidate.mergeCommitSha,
      operatorActorType: actor.actorType,
      operatorActorId: actor.actorId,
      operatorNote: parsed.data.noteBody ?? null,
    });

    try {
      await retrievalPersonalization.recordMergeCandidateOutcomeFeedback({
        companyId: issue.companyId,
        issueId: issue.id,
        issueProjectId: issue.projectId ?? null,
        closeMessageId: surface.mergeCandidate.closeMessageId,
        outcome: nextState === "merged" ? "merge_completed" : "merge_rejected",
        changedFiles: surface.changedFiles,
        noteBody: parsed.data.noteBody ?? null,
        actorRole: "human_board",
        mergeCommitSha: parsed.data.mergeCommitSha ?? surface.mergeCandidate.mergeCommitSha ?? null,
        mergeStatus: nextState,
      });
    } catch (err) {
      logger.error(
        {
          err,
          issueId: issue.id,
          actionType: parsed.data.actionType,
        },
        "Merge candidate retrieval feedback recording failed",
      );
    }

    await logActivity(db, {
      companyId: issue.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "issue.merge_candidate.resolved",
      entityType: "issue",
      entityId: issue.id,
      details: {
        actionType: parsed.data.actionType,
        targetBaseBranch: parsed.data.targetBaseBranch ?? surface.mergeCandidate.targetBaseBranch,
        mergeCommitSha: parsed.data.mergeCommitSha ?? surface.mergeCandidate.mergeCommitSha,
      },
    });

    const refreshed = await loadIssueChangeSurface(issue);
    res.json(refreshed.mergeCandidate);
  });

  router.post("/issues/:id/merge-candidate/recovery", async (req, res) => {
    const id = req.params.id as string;
    const issue = await svc.getById(id);
    if (!issue) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }
    assertCompanyAccess(req, issue.companyId);
    if (req.actor.type !== "board") {
      res.status(403).json({ error: "Only board users can run merge recovery actions" });
      return;
    }

    const parsed = runMergeCandidateRecoverySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation error", details: parsed.error.issues });
      return;
    }

    const surface = await loadIssueChangeSurface(issue);
    const mergeCandidate = surface.mergeCandidate;
    const revertAssist = mergeCandidate?.revertAssist ?? null;
    if (!mergeCandidate || !revertAssist) {
      res.status(409).json({ error: "Issue has no recovery-ready merge candidate" });
      return;
    }

    const actor = getActorInfo(req);
    const recoveryBody = parsed.data.body?.trim() || buildRevertAssistContextBody({
      issueIdentifier: issue.identifier ?? null,
      issueTitle: issue.title,
      rollbackPlan: revertAssist.rollbackPlan,
      mergeCommitSha: revertAssist.mergeCommitSha,
      followUpIssueIds: revertAssist.followUpIssueIds,
      operatorNote: mergeCandidate.operatorNote ?? null,
    });

    if (parsed.data.actionType === "create_revert_followup") {
      if (!revertAssist.canCreateFollowUp) {
        res.status(409).json({ error: "Revert follow-up is not available for this candidate" });
        return;
      }

      const created = await svc.create(issue.companyId, {
        projectId: issue.projectId ?? null,
        parentId: null,
        title:
          parsed.data.title?.trim()
          || revertAssist.suggestedTitle
          || `Recovery follow-up for ${issue.identifier ?? issue.title}`,
        description: recoveryBody,
        status: "backlog",
        priority: issue.priority === "critical" ? "critical" : "high",
        assigneeAgentId: null,
        assigneeUserId: null,
        requestDepth: 0,
      });

      await mergeCandidatesSvc.patchAutomationMetadata(issue.id, {
        revertAssist: {
          lastActionType: "create_revert_followup",
          lastActionAt: new Date().toISOString(),
          lastActionSummary: `Created follow-up ${created.identifier ?? created.id}`,
          lastCreatedIssueId: created.id,
          lastCreatedIssueIdentifier: created.identifier ?? null,
        },
      });

      await logActivity(db, {
        companyId: created.companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "issue.created",
        entityType: "issue",
        entityId: created.id,
        details: {
          title: created.title,
          identifier: created.identifier,
          sourceIssueId: issue.id,
          sourceIssueIdentifier: issue.identifier,
          source: "revert_assist",
        },
      });

      await logActivity(db, {
        companyId: issue.companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "issue.revert_assist.followup_created",
        entityType: "issue",
        entityId: issue.id,
        details: {
          createdIssueId: created.id,
          createdIssueIdentifier: created.identifier,
        },
      });

      res.status(201).json({
        actionType: "create_revert_followup",
        sourceIssueId: issue.id,
        createdIssueId: created.id,
        createdIssueIdentifier: created.identifier ?? null,
        reopened: false,
        commentId: null,
        summary: `Created recovery follow-up ${created.identifier ?? created.id}`,
      });
      return;
    }

    if (!revertAssist.canReopen) {
      res.status(409).json({ error: "Issue cannot be reopened from the current state" });
      return;
    }

    const reopenResult = await protocolSvc.reopenForRecovery(issue.id);
    const reopenedIssue = reopenResult.issue;

    const comment = await svc.addComment(issue.id, recoveryBody, {
      agentId: actor.agentId ?? undefined,
      userId: actor.actorType === "user" ? actor.actorId : undefined,
    });

    await mergeCandidatesSvc.patchAutomationMetadata(issue.id, {
      revertAssist: {
        lastActionType: "reopen_with_rollback_context",
        lastActionAt: new Date().toISOString(),
        lastActionSummary: "Reopened issue with rollback context",
        lastCommentId: comment.id,
      },
    });

    await logActivity(db, {
      companyId: reopenedIssue.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "issue.updated",
      entityType: "issue",
      entityId: reopenedIssue.id,
      details: {
        status: "todo",
        reopened: true,
        reopenedFrom: issue.status,
        source: "revert_assist",
        identifier: reopenedIssue.identifier,
        reopenedFromWorkflowState: reopenResult.reopenedFromWorkflowState,
        nextWorkflowState: reopenResult.nextWorkflowState,
      },
    });

    await logActivity(db, {
      companyId: reopenedIssue.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "issue.comment_added",
      entityType: "issue",
      entityId: reopenedIssue.id,
      details: {
        commentId: comment.id,
        bodySnippet: comment.body.slice(0, 120),
        identifier: reopenedIssue.identifier,
        issueTitle: reopenedIssue.title,
        reopened: true,
        reopenedFrom: issue.status,
        source: "revert_assist",
        reopenedFromWorkflowState: reopenResult.reopenedFromWorkflowState,
        nextWorkflowState: reopenResult.nextWorkflowState,
      },
    });

    await logActivity(db, {
      companyId: reopenedIssue.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "issue.revert_assist.reopened",
      entityType: "issue",
      entityId: reopenedIssue.id,
      details: {
        commentId: comment.id,
        reopenedFromWorkflowState: reopenResult.reopenedFromWorkflowState,
        nextWorkflowState: reopenResult.nextWorkflowState,
      },
    });

    if (reopenResult.wakeAssigneeAgentId) {
      await queueIssueWakeup(
        reopenedIssue,
        reopenResult.wakeAssigneeAgentId,
        {
          source: "automation",
          triggerDetail: "system",
          reason: "issue_reopened_via_revert_assist",
          payload: {
            issueId: reopenedIssue.id,
            commentId: comment.id,
            reopenedFrom: issue.status,
            reopenedFromWorkflowState: reopenResult.reopenedFromWorkflowState,
            mutation: "merge_recovery",
          },
          requestedByActorType: actor.actorType,
          requestedByActorId: actor.actorId,
          contextSnapshot: {
            issueId: reopenedIssue.id,
            taskId: reopenedIssue.id,
            commentId: comment.id,
            source: "issue.revert_assist.reopen",
            wakeReason: "issue_reopened_via_revert_assist",
            reopenedFrom: issue.status,
            reopenedFromWorkflowState: reopenResult.reopenedFromWorkflowState,
          },
        },
        "failed to enqueue revert assist reopen wakeup",
      );
    }

    res.json({
      actionType: "reopen_with_rollback_context",
      sourceIssueId: issue.id,
      createdIssueId: null,
      createdIssueIdentifier: null,
      reopened: true,
      commentId: comment.id,
      summary: "Reopened issue with rollback context",
    });
  });

  router.post("/issues/:id/merge-candidate/automation", async (req, res) => {
    const id = req.params.id as string;
    const issue = await svc.getById(id);
    if (!issue) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }
    assertCompanyAccess(req, issue.companyId);
    if (req.actor.type !== "board") {
      res.status(403).json({ error: "Only board users can automate merge candidates" });
      return;
    }

    const parsed = mergeCandidateAutomationSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation error", details: parsed.error.issues });
      return;
    }

    const surface = await loadIssueChangeSurface(issue);
    if (!surface.mergeCandidate) {
      res.status(409).json({ error: "Issue has no merge candidate" });
      return;
    }

    const project = issue.projectId ? await projectsSvc.getById(issue.projectId) : null;
    const plan = await buildMergeAutomationPlan({
      issue: {
        id: issue.id,
        identifier: issue.identifier ?? null,
        title: issue.title,
        projectId: issue.projectId ?? null,
      },
      project: project
        ? {
            id: project.id,
            name: project.name,
            primaryWorkspace: project.primaryWorkspace
              ? {
                  id: project.primaryWorkspace.id,
                  name: project.primaryWorkspace.name,
                  cwd: project.primaryWorkspace.cwd,
                  repoRef: project.primaryWorkspace.repoRef,
                }
              : null,
          }
        : null,
      candidate: surface.mergeCandidate,
      targetBaseBranch: parsed.data.targetBaseBranch ?? null,
      integrationBranchName: parsed.data.integrationBranchName ?? null,
      remoteName: parsed.data.remoteName ?? null,
    });

    const actor = getActorInfo(req);
    const result = await runMergeAutomationAction({
      actionType: parsed.data.actionType,
      plan,
      candidate: surface.mergeCandidate,
      targetBaseBranch: parsed.data.targetBaseBranch ?? null,
      integrationBranchName: parsed.data.integrationBranchName ?? null,
      remoteName: parsed.data.remoteName ?? null,
      branchName: parsed.data.branchName ?? null,
      pushAfterAction: parsed.data.pushAfterAction === true,
    });

    if (result.automationMetadataPatch) {
      await mergeCandidatesSvc.patchAutomationMetadata(issue.id, result.automationMetadataPatch);
    }

    await logActivity(db, {
      companyId: issue.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "issue.merge_candidate.automation",
      entityType: "issue",
      entityId: issue.id,
      details: {
        actionType: parsed.data.actionType,
        targetBaseBranch: result.plan.targetBaseBranch,
        targetBranch: result.targetBranch ?? null,
        pushed: result.pushed ?? false,
        patchPath: result.patchPath ?? null,
        prBundlePath: result.prBundlePath ?? null,
        mergeCommitSha: result.mergeCommitSha ?? null,
        externalProvider: result.externalProvider ?? null,
        externalNumber: result.externalNumber ?? null,
        externalUrl: result.externalUrl ?? null,
      },
    });

    const refreshed = await loadIssueChangeSurface(issue);
    res.json({
      result,
      mergeCandidate: refreshed.mergeCandidate,
    });
  });
}
