import { z } from "zod";
import { assertCompanyAccess, getActorInfo } from "../authz.js";
import { createIssueDocumentService } from "../../services/issue-documents.js";
import type { IssueRouteContext } from "./context.js";

function buildUpsertDocumentBodySchema(maxBodyChars: number) {
  return z.object({
    title: z.string().min(1).max(500).optional(),
    body: z.string().max(maxBodyChars),
    baseRevisionNumber: z.number().int().min(1).optional(),
  });
}

/**
 * Register issue document CRUD routes.
 *
 * Routes:
 *   GET    /companies/:companyId/issues/:issueId/documents
 *   GET    /companies/:companyId/issues/:issueId/documents/:key
 *   PUT    /companies/:companyId/issues/:issueId/documents/:key
 *   DELETE /companies/:companyId/issues/:issueId/documents/:key
 *   GET    /companies/:companyId/issues/:issueId/documents/:key/revisions
 */
export function registerIssueDocumentRoutes(ctx: IssueRouteContext) {
  const { router, db } = ctx;
  const { svc } = ctx.services;
  const { maxDocumentBodyChars } = ctx.constants;
  const docService = createIssueDocumentService(db);
  const upsertDocumentBodySchema = buildUpsertDocumentBodySchema(maxDocumentBodyChars);

  // -----------------------------------------------------------------------
  // LIST documents for an issue
  // -----------------------------------------------------------------------
  router.get(
    "/companies/:companyId/issues/:issueId/documents",
    async (req, res) => {
      const { companyId, issueId } = req.params;
      assertCompanyAccess(req, companyId as string);

      const issue = await svc.getById(issueId as string);
      if (!issue) {
        res.status(404).json({ error: "Issue not found" });
        return;
      }
      if (issue.companyId !== companyId) {
        res.status(404).json({ error: "Issue not found" });
        return;
      }

      const documents = await docService.listDocuments(issueId as string);
      res.json(documents);
    },
  );

  // -----------------------------------------------------------------------
  // GET a single document by key
  // -----------------------------------------------------------------------
  router.get(
    "/companies/:companyId/issues/:issueId/documents/:key",
    async (req, res) => {
      const { companyId, issueId, key } = req.params;
      assertCompanyAccess(req, companyId as string);

      const issue = await svc.getById(issueId as string);
      if (!issue) {
        res.status(404).json({ error: "Issue not found" });
        return;
      }
      if (issue.companyId !== companyId) {
        res.status(404).json({ error: "Issue not found" });
        return;
      }

      const document = await docService.getDocument(
        issueId as string,
        key as string,
      );
      if (!document) {
        res.status(404).json({ error: "Document not found" });
        return;
      }

      res.json(document);
    },
  );

  // -----------------------------------------------------------------------
  // UPSERT (create or update) a document
  // -----------------------------------------------------------------------
  router.put(
    "/companies/:companyId/issues/:issueId/documents/:key",
    async (req, res) => {
      const { companyId, issueId, key } = req.params;
      assertCompanyAccess(req, companyId as string);

      const issue = await svc.getById(issueId as string);
      if (!issue) {
        res.status(404).json({ error: "Issue not found" });
        return;
      }
      if (issue.companyId !== companyId) {
        res.status(404).json({ error: "Issue not found" });
        return;
      }

      const parsed = upsertDocumentBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(422).json({
          error: "Invalid request body",
          details: parsed.error.issues,
        });
        return;
      }

      const actor = getActorInfo(req);

      const document = await docService.upsertDocument({
        issueId: issueId as string,
        companyId: issue.companyId,
        key: key as string,
        title: parsed.data.title,
        body: parsed.data.body,
        baseRevisionNumber: parsed.data.baseRevisionNumber,
        authorAgentId: actor.agentId,
        authorUserId: actor.actorType === "user" ? actor.actorId : null,
      });

      res.json(document);
    },
  );

  // -----------------------------------------------------------------------
  // DELETE a document
  // -----------------------------------------------------------------------
  router.delete(
    "/companies/:companyId/issues/:issueId/documents/:key",
    async (req, res) => {
      const { companyId, issueId, key } = req.params;
      assertCompanyAccess(req, companyId as string);

      const issue = await svc.getById(issueId as string);
      if (!issue) {
        res.status(404).json({ error: "Issue not found" });
        return;
      }
      if (issue.companyId !== companyId) {
        res.status(404).json({ error: "Issue not found" });
        return;
      }

      await docService.deleteDocument(issueId as string, key as string);
      res.json({ ok: true });
    },
  );

  // -----------------------------------------------------------------------
  // LIST revisions for a document
  // -----------------------------------------------------------------------
  router.get(
    "/companies/:companyId/issues/:issueId/documents/:key/revisions",
    async (req, res) => {
      const { companyId, issueId, key } = req.params;
      assertCompanyAccess(req, companyId as string);

      const issue = await svc.getById(issueId as string);
      if (!issue) {
        res.status(404).json({ error: "Issue not found" });
        return;
      }
      if (issue.companyId !== companyId) {
        res.status(404).json({ error: "Issue not found" });
        return;
      }

      const revisions = await docService.listRevisions(
        issueId as string,
        key as string,
      );
      res.json(revisions);
    },
  );
}
