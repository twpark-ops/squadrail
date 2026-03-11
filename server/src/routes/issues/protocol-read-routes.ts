import { assertCompanyAccess } from "../authz.js";
import type { IssueRouteContext } from "./context.js";

export function registerIssueProtocolReadRoutes(ctx: IssueRouteContext) {
  const { router } = ctx;
  const { svc, protocolSvc, knowledge } = ctx.services;

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
}
