import { Router } from "express";
import type { Db } from "@squadrail/db";
import {
  companyPortabilityExportSchema,
  companyPortabilityImportSchema,
  companyPortabilityPreviewSchema,
  createRolePackDraftSchema,
  createKnowledgeSyncJobSchema,
  createCompanySchema,
  rolePackSimulationRequestSchema,
  repairOrgSyncSchema,
  listRolePacksQuerySchema,
  restoreRolePackRevisionSchema,
  seedDefaultRolePacksSchema,
  updateSetupProgressSchema,
  updateCompanySchema,
} from "@squadrail/shared";
import { z } from "zod";
import { forbidden } from "../errors.js";
import { validate } from "../middleware/validate.js";
import {
  accessService,
  companyPortabilityService,
  companyService,
  doctorService,
  logActivity,
  knowledgeSetupService,
  rolePackService,
  setupProgressService,
} from "../services/index.js";
import { assertBoard, assertCompanyAccess, getActorInfo } from "./authz.js";

const doctorQuerySchema = z.object({
  deep: z.coerce.boolean().optional(),
  workspaceId: z.string().uuid().optional(),
});

export function companyRoutes(
  db: Db,
  opts: {
    deploymentMode: "local_trusted" | "authenticated";
    deploymentExposure: "private" | "public";
    authReady: boolean;
    protocolTimeoutsEnabled: boolean;
    knowledgeBackfillEnabled: boolean;
  },
) {
  const router = Router();
  const svc = companyService(db);
  const portability = companyPortabilityService(db);
  const access = accessService(db);
  const setup = setupProgressService(db);
  const rolePacks = rolePackService(db);
  const knowledgeSetup = knowledgeSetupService(db);
  const doctor = doctorService(db, opts);

  router.get("/role-pack-presets", (req, res) => {
    assertBoard(req);
    res.json(rolePacks.listPresets());
  });

  router.get("/", async (req, res) => {
    assertBoard(req);
    const result = await svc.list();
    if (req.actor.source === "local_implicit" || req.actor.isInstanceAdmin) {
      res.json(result);
      return;
    }
    const allowed = new Set(req.actor.companyIds ?? []);
    res.json(result.filter((company) => allowed.has(company.id)));
  });

  router.get("/stats", async (req, res) => {
    assertBoard(req);
    const allowed = req.actor.source === "local_implicit" || req.actor.isInstanceAdmin
      ? null
      : new Set(req.actor.companyIds ?? []);
    const stats = await svc.stats();
    if (!allowed) {
      res.json(stats);
      return;
    }
    const filtered = Object.fromEntries(Object.entries(stats).filter(([companyId]) => allowed.has(companyId)));
    res.json(filtered);
  });

  router.get("/:companyId", async (req, res) => {
    assertBoard(req);
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const company = await svc.getById(companyId);
    if (!company) {
      res.status(404).json({ error: "Company not found" });
      return;
    }
    res.json(company);
  });

  router.get("/:companyId/setup-progress", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const progress = await setup.getView(companyId);
    res.json(progress);
  });

  router.get("/:companyId/org-sync", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const view = await knowledgeSetup.getOrgSync(companyId);
    res.json(view);
  });

  router.post("/:companyId/org-sync/repair", validate(repairOrgSyncSchema), async (req, res) => {
    assertBoard(req);
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const actor = getActorInfo(req);
    const result = await knowledgeSetup.repairOrgSync(companyId, req.body, {
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
    });
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "company.org_sync_repaired",
      entityType: "company",
      entityId: companyId,
      details: {
        createdAgentIds: result.createdAgentIds,
        updatedAgentIds: result.updatedAgentIds,
        pausedAgentIds: result.pausedAgentIds,
        adoptedAgentIds: result.adoptedAgentIds,
        statusBefore: result.statusBefore,
        statusAfter: result.statusAfter,
      },
    });
    res.json(result);
  });

  router.get("/:companyId/knowledge-setup", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const view = await knowledgeSetup.getKnowledgeSetup(companyId);
    res.json(view);
  });

  router.post("/:companyId/knowledge-sync", validate(createKnowledgeSyncJobSchema), async (req, res) => {
    assertBoard(req);
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const actor = getActorInfo(req);
    const job = await knowledgeSetup.runKnowledgeSync(companyId, req.body, {
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
    });
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "knowledge.sync_requested",
      entityType: "company",
      entityId: companyId,
      details: {
        jobId: job.id,
        selectedProjectIds: job.selectedProjectIds,
        status: job.status,
      },
    });
    res.status(201).json(job);
  });

  router.get("/:companyId/knowledge-sync/:jobId", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const jobId = req.params.jobId as string;
    const job = await knowledgeSetup.getKnowledgeSyncJob(companyId, jobId);
    if (!job) {
      res.status(404).json({ error: "Knowledge sync job not found" });
      return;
    }
    res.json(job);
  });

  router.patch("/:companyId/setup-progress", validate(updateSetupProgressSchema), async (req, res) => {
    assertBoard(req);
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const actor = getActorInfo(req);
    const progress = await setup.update(companyId, req.body);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "setup.progress.updated",
      entityType: "company",
      entityId: companyId,
      details: req.body,
    });
    res.json(progress);
  });

  router.get("/:companyId/doctor", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const parsed = doctorQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation error", details: parsed.error.issues });
      return;
    }
    const report = await doctor.run({
      companyId,
      workspaceId: parsed.data.workspaceId,
      deep: parsed.data.deep,
    });
    res.json(report);
  });

  router.get("/:companyId/role-packs", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const parsed = listRolePacksQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation error", details: parsed.error.issues });
      return;
    }
    const packs = await rolePacks.listRolePacks({
      companyId,
      scopeType: parsed.data.scopeType,
      scopeId: parsed.data.scopeId ?? undefined,
      roleKey: parsed.data.roleKey,
    });
    res.json(packs);
  });

  router.get("/:companyId/role-packs/:rolePackSetId", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const rolePack = await rolePacks.getRolePack({
      companyId,
      rolePackSetId: req.params.rolePackSetId as string,
    });
    if (!rolePack) {
      res.status(404).json({ error: "Role pack not found" });
      return;
    }
    res.json(rolePack);
  });

  router.get("/:companyId/role-packs/:rolePackSetId/revisions", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const revisions = await rolePacks.listRevisions({
      companyId,
      rolePackSetId: req.params.rolePackSetId as string,
    });
    if (!revisions) {
      res.status(404).json({ error: "Role pack not found" });
      return;
    }
    res.json(revisions);
  });

  router.post("/:companyId/role-packs/:rolePackSetId/simulate", validate(rolePackSimulationRequestSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const result = await rolePacks.simulateRolePack({
      companyId,
      rolePackSetId: req.params.rolePackSetId as string,
      simulation: req.body,
    });
    if (!result) {
      res.status(404).json({ error: "Role pack not found" });
      return;
    }
    res.json(result);
  });

  router.post("/:companyId/role-packs/seed-defaults", validate(seedDefaultRolePacksSchema), async (req, res) => {
    assertBoard(req);
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const actor = getActorInfo(req);
    const result = await rolePacks.seedDefaults({
      companyId,
      force: req.body.force,
      presetKey: req.body.presetKey,
      actor: {
        userId: req.actor.type === "board" ? req.actor.userId : null,
        agentId: req.actor.type === "agent" ? req.actor.agentId : null,
      },
    });
    await setup.update(companyId, {
      status: "squad_ready",
      metadata: {
        rolePacksSeeded: true,
        rolePackPresetKey: req.body.presetKey ?? "squadrail_default_v1",
      },
    });
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "role_pack.seeded",
      entityType: "company",
      entityId: companyId,
      details: {
        createdCount: result.created.length,
        existingCount: result.existing.length,
        force: req.body.force === true,
      },
    });
    res.status(201).json(result);
  });

  router.post("/:companyId/role-packs/:rolePackSetId/revisions", validate(createRolePackDraftSchema), async (req, res) => {
    assertBoard(req);
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const actor = getActorInfo(req);
    const result = await rolePacks.createDraftRevision({
      companyId,
      rolePackSetId: req.params.rolePackSetId as string,
      actor: {
        userId: req.actor.type === "board" ? req.actor.userId : null,
        agentId: req.actor.type === "agent" ? req.actor.agentId : null,
      },
      draft: req.body,
    });
    if (!result) {
      res.status(404).json({ error: "Role pack not found" });
      return;
    }
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "role_pack.revision.created",
      entityType: "company",
      entityId: companyId,
      details: {
        rolePackSetId: req.params.rolePackSetId,
        status: req.body.status ?? "draft",
      },
    });
    res.status(201).json(result);
  });

  router.post(
    "/:companyId/role-packs/:rolePackSetId/revisions/:revisionId/restore",
    validate(restoreRolePackRevisionSchema),
    async (req, res) => {
      assertBoard(req);
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const actor = getActorInfo(req);
      const result = await rolePacks.restoreRevision({
        companyId,
        rolePackSetId: req.params.rolePackSetId as string,
        revisionId: req.params.revisionId as string,
        actor: {
          userId: req.actor.type === "board" ? req.actor.userId : null,
          agentId: req.actor.type === "agent" ? req.actor.agentId : null,
        },
        restore: req.body,
      });
      if (!result) {
        res.status(404).json({ error: "Role pack or revision not found" });
        return;
      }
      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "role_pack.revision.restored",
        entityType: "company",
        entityId: companyId,
        details: {
          rolePackSetId: req.params.rolePackSetId,
          revisionId: req.params.revisionId,
          status: req.body.status ?? "draft",
        },
      });
      res.status(201).json(result);
    },
  );

  router.post("/:companyId/export", validate(companyPortabilityExportSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const result = await portability.exportBundle(companyId, req.body);
    res.json(result);
  });

  router.post("/import/preview", validate(companyPortabilityPreviewSchema), async (req, res) => {
    if (req.body.target.mode === "existing_company") {
      assertCompanyAccess(req, req.body.target.companyId);
    } else {
      assertBoard(req);
    }
    const preview = await portability.previewImport(req.body);
    res.json(preview);
  });

  router.post("/import", validate(companyPortabilityImportSchema), async (req, res) => {
    if (req.body.target.mode === "existing_company") {
      assertCompanyAccess(req, req.body.target.companyId);
    } else {
      assertBoard(req);
    }
    const actor = getActorInfo(req);
    const result = await portability.importBundle(req.body, req.actor.type === "board" ? req.actor.userId : null);
    await logActivity(db, {
      companyId: result.company.id,
      actorType: actor.actorType,
      actorId: actor.actorId,
      action: "company.imported",
      entityType: "company",
      entityId: result.company.id,
      agentId: actor.agentId,
      runId: actor.runId,
      details: {
        include: req.body.include ?? null,
        agentCount: result.agents.length,
        warningCount: result.warnings.length,
        companyAction: result.company.action,
      },
    });
    res.json(result);
  });

  router.post("/", validate(createCompanySchema), async (req, res) => {
    assertBoard(req);
    if (!(req.actor.source === "local_implicit" || req.actor.isInstanceAdmin)) {
      throw forbidden("Instance admin required");
    }
    const company = await svc.create(req.body);
    await access.ensureMembership(company.id, "user", req.actor.userId ?? "local-board", "owner", "active");
    await setup.update(company.id, {
      status: "company_ready",
    });
    await logActivity(db, {
      companyId: company.id,
      actorType: "user",
      actorId: req.actor.userId ?? "board",
      action: "company.created",
      entityType: "company",
      entityId: company.id,
      details: { name: company.name },
    });
    res.status(201).json(company);
  });

  router.patch("/:companyId", validate(updateCompanySchema), async (req, res) => {
    assertBoard(req);
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const company = await svc.update(companyId, req.body);
    if (!company) {
      res.status(404).json({ error: "Company not found" });
      return;
    }
    await logActivity(db, {
      companyId,
      actorType: "user",
      actorId: req.actor.userId ?? "board",
      action: "company.updated",
      entityType: "company",
      entityId: companyId,
      details: req.body,
    });
    res.json(company);
  });

  router.post("/:companyId/archive", async (req, res) => {
    assertBoard(req);
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const company = await svc.archive(companyId);
    if (!company) {
      res.status(404).json({ error: "Company not found" });
      return;
    }
    await logActivity(db, {
      companyId,
      actorType: "user",
      actorId: req.actor.userId ?? "board",
      action: "company.archived",
      entityType: "company",
      entityId: companyId,
    });
    res.json(company);
  });

  router.delete("/:companyId", async (req, res) => {
    assertBoard(req);
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const company = await svc.remove(companyId);
    if (!company) {
      res.status(404).json({ error: "Company not found" });
      return;
    }
    res.json({ ok: true });
  });

  return router;
}
