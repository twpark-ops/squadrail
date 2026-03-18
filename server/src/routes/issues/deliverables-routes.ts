import type { IssueDeliverable } from "@squadrail/shared";
import type { Request, Response } from "express";
import { assertCompanyAccess } from "../authz.js";
import type { IssueRouteContext } from "./context.js";

/**
 * Federated read model: merge attachments + protocol artifacts into a
 * unified IssueDeliverable[] for the Deliverables panel.
 */
export function registerIssueDeliverablesRoutes(ctx: IssueRouteContext) {
  const { router } = ctx;
  const { svc } = ctx.services;
  const { withContentPath, loadIssueChangeSurface } = ctx.helpers;

  async function handleDeliverablesRead(input: {
    issueId: string;
    companyId?: string;
    req: Request;
    res: Response;
  }) {
    const { issueId, companyId, req, res } = input;
    const issue = await svc.getById(issueId);
    if (!issue) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }
    if (companyId) {
      assertCompanyAccess(req, companyId);
      if (issue.companyId !== companyId) {
        res.status(404).json({ error: "Issue not found" });
        return;
      }
    } else {
      assertCompanyAccess(req, issue.companyId);
    }

    // Fetch attachments and change surface in parallel
    const [attachments, changeSurface] = await Promise.all([
      svc.listAttachments(issueId),
      loadIssueChangeSurface(issue),
    ]);

    const deliverables: IssueDeliverable[] = [];

    // 1. Map attachments → IssueDeliverable
    for (const att of attachments) {
      const enriched = withContentPath(att);
      deliverables.push({
        id: att.id,
        source: "attachment",
        kind: "file",
        label: att.originalFilename ?? att.id,
        summary: null,
        href: enriched.contentPath ?? null,
        contentType: att.contentType ?? null,
        createdAt: (att as unknown as { createdAt?: Date }).createdAt ?? new Date(),
        createdByRole: null,
        metadata: {
          byteSize: att.byteSize,
          objectKey: att.objectKey,
        },
      });
    }

    // 2. Map change surface artifacts → IssueDeliverable
    const surfaceArtifacts = [
      changeSurface.diffArtifact,
      changeSurface.approvalArtifact,
      changeSurface.latestRunArtifact,
      changeSurface.workspaceBindingArtifact,
      ...changeSurface.verificationArtifacts,
    ];

    for (const artifact of surfaceArtifacts) {
      if (!artifact) continue;

      const kind = mapArtifactKind(artifact.kind);
      deliverables.push({
        id: `${artifact.messageId}:${artifact.kind}:${artifact.uri}`,
        source: "protocol_artifact",
        kind,
        label: artifact.label ?? `${artifact.kind} artifact`,
        summary: null,
        href: artifact.uri ?? null,
        contentType: null,
        createdAt: artifact.createdAt instanceof Date
          ? artifact.createdAt
          : new Date(artifact.createdAt),
        createdByRole: artifact.messageType ?? null,
        metadata: artifact.metadata ?? null,
      });
    }

    // Sort by createdAt descending
    deliverables.sort((a, b) => {
      const aTime = a.createdAt instanceof Date ? a.createdAt.getTime() : new Date(a.createdAt).getTime();
      const bTime = b.createdAt instanceof Date ? b.createdAt.getTime() : new Date(b.createdAt).getTime();
      return bTime - aTime;
    });

    res.json(deliverables);
  }

  router.get("/issues/:id/deliverables", async (req, res) => {
    await handleDeliverablesRead({
      issueId: req.params.id as string,
      req,
      res,
    });
  });

  router.get("/companies/:companyId/issues/:issueId/deliverables", async (req, res) => {
    await handleDeliverablesRead({
      issueId: req.params.issueId as string,
      companyId: req.params.companyId as string,
      req,
      res,
    });
  });
}

/** Map protocol artifact kind to IssueDeliverable kind */
function mapArtifactKind(
  protocolKind: string,
): IssueDeliverable["kind"] {
  switch (protocolKind) {
    case "diff":
      return "diff";
    case "approval":
      return "approval";
    case "test_run":
      return "test_run";
    case "build_run":
      return "build_run";
    case "run":
      return "run_log";
    case "doc":
      return "workspace_binding";
    default:
      return "file";
  }
}
