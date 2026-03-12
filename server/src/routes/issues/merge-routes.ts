import { logger } from "../../middleware/logger.js";
import { assertCompanyAccess, getActorInfo } from "../authz.js";
import { logActivity } from "../../services/index.js";
import type { IssueRouteContext } from "./context.js";

export function registerIssueMergeRoutes(ctx: IssueRouteContext) {
  const { router, db } = ctx;
  const { svc, projectsSvc, retrievalPersonalization, mergeCandidatesSvc } = ctx.services;
  const {
    loadIssueChangeSurface,
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
