import { Router } from "express";
import { z } from "zod";
import type { Db } from "@squadrail/db";
import { dashboardRecoveryActionSchema } from "@squadrail/shared";
import { dashboardService } from "../services/dashboard.js";
import { assertCompanyAccess } from "./authz.js";

const protocolQueueQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export function dashboardRoutes(db: Db) {
  const router = Router();
  const svc = dashboardService(db);

  router.get("/companies/:companyId/dashboard", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const summary = await svc.summary(companyId);
    res.json(summary);
  });

  router.get("/companies/:companyId/dashboard/protocol-queue", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    const parsed = protocolQueueQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation error", details: parsed.error.issues });
      return;
    }

    const queue = await svc.protocolQueue({
      companyId,
      limit: parsed.data.limit,
    });
    res.json(queue);
  });

  router.get("/companies/:companyId/dashboard/agent-performance", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    const parsed = protocolQueueQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation error", details: parsed.error.issues });
      return;
    }

    const feed = await svc.agentPerformance({
      companyId,
      limit: parsed.data.limit,
    });
    res.json(feed);
  });

  router.get("/companies/:companyId/dashboard/recovery-queue", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    const parsed = protocolQueueQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation error", details: parsed.error.issues });
      return;
    }

    const recovery = await svc.recoveryQueue({
      companyId,
      limit: parsed.data.limit,
    });
    res.json(recovery);
  });

  router.get("/companies/:companyId/dashboard/team-supervision", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    const parsed = protocolQueueQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation error", details: parsed.error.issues });
      return;
    }

    const feed = await svc.teamSupervision({
      companyId,
      limit: parsed.data.limit,
    });
    res.json(feed);
  });

  router.post("/companies/:companyId/dashboard/recovery-queue/actions", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    const parsed = dashboardRecoveryActionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation error", details: parsed.error.issues });
      return;
    }

    if (req.actor.type !== "board") {
      res.status(403).json({ error: "Only board actors can apply recovery actions" });
      return;
    }

    const result = await svc.applyRecoveryAction({
      companyId,
      actionType: parsed.data.actionType,
      issueIds: parsed.data.issueIds,
      recoveryTypes: parsed.data.recoveryTypes,
      noteBody: parsed.data.noteBody ?? null,
      actor: {
        userId: req.actor.userId ?? null,
      },
    });
    res.json(result);
  });

  return router;
}
