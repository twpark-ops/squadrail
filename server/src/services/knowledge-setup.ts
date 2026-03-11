import { existsSync } from "node:fs";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { enqueueAfterDbCommit, type Db } from "@squadrail/db";
import {
  agents,
  codeSymbolEdges,
  companies,
  knowledgeChunkLinks,
  knowledgeChunks,
  knowledgeDocumentVersions,
  knowledgeDocuments,
  knowledgeSyncJobs,
  knowledgeSyncProjectRuns,
  projectKnowledgeRevisions,
  retrievalFeedbackEvents,
  retrievalRoleProfiles,
} from "@squadrail/db";
import type {
  CreateKnowledgeSyncJob,
  KnowledgeSetupProjectStatus,
  KnowledgeSetupProjectView,
  KnowledgeSetupView,
  KnowledgeSyncJobView,
  OrgSyncMismatch,
  OrgSyncView,
  RepairOrgSync,
} from "@squadrail/shared";
import { normalizeAgentUrlKey } from "@squadrail/shared";
import { agentService } from "./agents.js";
import { knowledgeBackfillService } from "./knowledge-backfill.js";
import { knowledgeImportService } from "./knowledge-import.js";
import { projectService } from "./projects.js";
import { retrievalPersonalizationService } from "./retrieval-personalization.js";
import { setupProgressService } from "./setup-progress.js";
import {
  SWIFTSIGHT_CANONICAL_TEMPLATE_KEY,
  SWIFTSIGHT_CANONICAL_VERSION,
  canonicalTemplateForCompanyName,
  buildCanonicalLookupMaps,
  type CanonicalAgentDefinition,
} from "./swiftsight-org-canonical.js";
import { inspectWorkspaceVersionContext } from "./workspace-git-snapshot.js";

const activeKnowledgeSyncJobs = new Set<string>();
const KNOWLEDGE_SETUP_CACHE_FRESH_MS = 15_000;
const KNOWLEDGE_SETUP_CACHE_STALE_MS = 2 * 60_000;

type KnowledgeSetupCacheEntry = {
  value: KnowledgeSetupView;
  expiresAt: number;
  staleUntil: number;
};

const knowledgeSetupReadModelCache = new Map<string, KnowledgeSetupCacheEntry>();
const knowledgeSetupRefreshPromises = new Map<string, Promise<KnowledgeSetupView>>();

type ActorInfo = {
  actorType: "agent" | "user" | "system";
  actorId: string;
  agentId?: string | null;
};

type OrgSyncCandidate = {
  canonical: CanonicalAgentDefinition;
  live: Awaited<ReturnType<ReturnType<typeof agentService>["list"]>>[number] | null;
  matchedBy: "bootstrap_slug" | "url_key" | "legacy_slug" | null;
};

function invalidateKnowledgeSetupCache(companyId: string) {
  knowledgeSetupReadModelCache.delete(companyId);
}

function toIso(value: Date | string | null | undefined) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asRecord(value: unknown) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function canonicalShape(definition: CanonicalAgentDefinition) {
  return {
    role: definition.role,
    title: definition.title,
    adapterType: definition.adapterType,
    reportsToSlug: definition.reportsToSlug,
    projectSlug: definition.projectSlug,
    deliveryLane: definition.deliveryLane,
  };
}

function liveShape(agent: Awaited<ReturnType<ReturnType<typeof agentService>["list"]>>[number], reportsToSlug: string | null) {
  const metadata = asRecord(agent.metadata);
  return {
    role: agent.role,
    title: agent.title ?? null,
    adapterType: agent.adapterType,
    reportsToSlug,
    projectSlug: readString(metadata?.projectSlug),
    deliveryLane: readString(metadata?.deliveryLane),
  };
}

function diffAgentShape(
  expected: ReturnType<typeof canonicalShape>,
  actual: ReturnType<typeof liveShape>,
) {
  return Object.keys(expected).filter((key) => {
    const typedKey = key as keyof typeof expected;
    return expected[typedKey] !== actual[typedKey];
  });
}

function deriveExtraAgentReason(agent: Awaited<ReturnType<ReturnType<typeof agentService>["list"]>>[number]) {
  const metadata = asRecord(agent.metadata);
  const bootstrapSlug = readString(metadata?.bootstrapSlug);
  if (bootstrapSlug?.endsWith("-engineer")) return "legacy_single_engineer";
  if (agent.urlKey === "python-tl") return "legacy_python_tl_alias";
  if (readString(metadata?.canonicalTemplateKey) === SWIFTSIGHT_CANONICAL_TEMPLATE_KEY) {
    return "stale_canonical_agent";
  }
  return "not_in_canonical_template";
}

function deriveProjectSyncStatus(input: {
  workspaceExists: boolean;
  workspaceCwd: string | null;
  currentHeadSha: string | null;
  documentCount: number;
  revision: number;
  lastHeadSha: string | null;
}): KnowledgeSetupProjectStatus {
  if (!input.workspaceCwd || !input.workspaceExists) return "missing_workspace";
  if (input.documentCount === 0 || input.revision === 0) return "needs_import";
  if (input.currentHeadSha && input.lastHeadSha && input.currentHeadSha !== input.lastHeadSha) return "stale";
  return "ready";
}

export function buildProjectSyncIssues(input: {
  workspaceExists: boolean;
  workspaceCwd: string | null;
  documentCount: number;
  revision: number;
  currentHeadSha: string | null;
  lastHeadSha: string | null;
}) {
  const issues: string[] = [];
  if (!input.workspaceCwd) issues.push("Primary workspace is not configured.");
  else if (!input.workspaceExists) issues.push("Primary workspace path is missing on disk.");
  if (input.documentCount === 0) issues.push("Knowledge documents have not been imported yet.");
  if (input.revision === 0) issues.push("Project knowledge revision has not been initialized.");
  if (input.currentHeadSha && input.lastHeadSha && input.currentHeadSha !== input.lastHeadSha) {
    issues.push("Workspace HEAD has moved since the last knowledge sync.");
  }
  return issues;
}

export function buildOrgSyncView(input: {
  companyId: string;
  templateKey: string | null;
  canonicalVersion: string | null;
  canonicalAgents: CanonicalAgentDefinition[];
  liveAgents: Awaited<ReturnType<ReturnType<typeof agentService>["list"]>>;
}) {
  const liveById = new Map(input.liveAgents.map((agent) => [agent.id, agent]));
  const liveByUrlKey = new Map(input.liveAgents.map((agent) => [agent.urlKey, agent]));
  const liveByBootstrapSlug = new Map(
    input.liveAgents
      .map((agent) => [readString(asRecord(agent.metadata)?.bootstrapSlug), agent] as const)
      .filter((entry): entry is [string, (typeof input.liveAgents)[number]] => Boolean(entry[0])),
  );
  const liveByLegacySlug = new Map(input.liveAgents.map((agent) => [agent.urlKey, agent]));
  const usedLiveIds = new Set<string>();
  const candidates: OrgSyncCandidate[] = [];
  const mismatches: OrgSyncMismatch[] = [];

  for (const canonical of input.canonicalAgents) {
    const direct = liveByBootstrapSlug.get(canonical.canonicalSlug)
      ?? liveByUrlKey.get(canonical.canonicalSlug)
      ?? canonical.legacySlugs.map((slug) => liveByLegacySlug.get(slug)).find(Boolean)
      ?? null;
    let matchedBy: OrgSyncCandidate["matchedBy"] = null;
    if (direct) {
      if (readString(asRecord(direct.metadata)?.bootstrapSlug) === canonical.canonicalSlug) matchedBy = "bootstrap_slug";
      else if (direct.urlKey === canonical.canonicalSlug) matchedBy = "url_key";
      else matchedBy = "legacy_slug";
      usedLiveIds.add(direct.id);
      const manager = canonical.reportsToSlug
        ? input.liveAgents.find((agent) => agent.id === direct.reportsTo)?.urlKey ?? null
        : null;
      const mismatchKeys = diffAgentShape(canonicalShape(canonical), liveShape(direct, manager));
      if (mismatchKeys.length > 0) {
        mismatches.push({
          agentId: direct.id,
          canonicalSlug: canonical.canonicalSlug,
          liveUrlKey: direct.urlKey,
          mismatchKeys,
          expected: canonicalShape(canonical),
          actual: liveShape(direct, manager),
        });
      }
    }
    candidates.push({ canonical, live: direct, matchedBy });
  }

  const missingAgents = candidates
    .filter((candidate) => candidate.live == null)
    .map((candidate) => ({
      canonicalSlug: candidate.canonical.canonicalSlug,
      name: candidate.canonical.name,
      role: candidate.canonical.role,
      title: candidate.canonical.title,
      adapterType: candidate.canonical.adapterType,
      reportsToSlug: candidate.canonical.reportsToSlug,
      projectSlug: candidate.canonical.projectSlug,
      deliveryLane: candidate.canonical.deliveryLane,
    }));

  const extraAgents = input.liveAgents
    .filter((agent) => !usedLiveIds.has(agent.id))
    .map((agent) => ({
      agentId: agent.id,
      urlKey: agent.urlKey,
      name: agent.name,
      role: agent.role,
      title: agent.title ?? null,
      status: agent.status,
      projectSlug: readString(asRecord(agent.metadata)?.projectSlug),
      reason: deriveExtraAgentReason(agent),
    }));

  const templateConfigured = Boolean(input.templateKey);
  let status: OrgSyncView["status"];
  if (!templateConfigured) status = "drifted";
  else if (missingAgents.length === 0 && extraAgents.length === 0 && mismatches.length === 0) status = "in_sync";
  else status = "repairable";

  return {
    companyId: input.companyId,
    templateKey: input.templateKey,
    templateConfigured,
    canonicalVersion: input.canonicalVersion ?? "unconfigured",
    canonicalAgentCount: input.canonicalAgents.length,
    liveAgentCount: input.liveAgents.length,
    matchedAgentCount: input.canonicalAgents.length - missingAgents.length,
    status,
    missingAgents,
    extraAgents,
    mismatchedAgents: mismatches,
    generatedAt: new Date().toISOString(),
  } satisfies OrgSyncView;
}

function normalizeAgentPatch(input: {
  canonical: CanonicalAgentDefinition;
  managerId: string | null;
}) {
  return {
    name: input.canonical.name,
    role: input.canonical.role,
    title: input.canonical.title,
    reportsTo: input.managerId,
    capabilities: input.canonical.capabilities,
    adapterType: input.canonical.adapterType,
    adapterConfig: input.canonical.adapterConfig,
    runtimeConfig: input.canonical.runtimeConfig,
    metadata: input.canonical.metadata,
  };
}

export function knowledgeSetupService(db: Db) {
  const projectsSvc = projectService(db);
  const agentsSvc = agentService(db);
  const setupSvc = setupProgressService(db);
  const imports = knowledgeImportService(db);
  const backfill = knowledgeBackfillService(db);
  const personalization = retrievalPersonalizationService(db);

  async function requireCompany(companyId: string) {
    const company = await db
      .select({ id: companies.id, name: companies.name })
      .from(companies)
      .where(eq(companies.id, companyId))
      .then((rows) => rows[0] ?? null);
    if (!company) {
      throw new Error("Company not found");
    }
    return company;
  }

  async function loadJobViews(companyId: string, limit = 6) {
    const jobs = await db
      .select()
      .from(knowledgeSyncJobs)
      .where(eq(knowledgeSyncJobs.companyId, companyId))
      .orderBy(desc(knowledgeSyncJobs.createdAt))
      .limit(limit);
    const jobIds = jobs.map((job) => job.id);
    const projectRuns = jobIds.length === 0
      ? []
      : await db
        .select()
        .from(knowledgeSyncProjectRuns)
        .where(inArray(knowledgeSyncProjectRuns.jobId, jobIds))
        .orderBy(desc(knowledgeSyncProjectRuns.updatedAt));
    const runsByJobId = new Map<string, typeof projectRuns>();
    for (const projectRun of projectRuns) {
      const entries = runsByJobId.get(projectRun.jobId) ?? [];
      entries.push(projectRun);
      runsByJobId.set(projectRun.jobId, entries);
    }
    return jobs.map((job) => ({
      id: job.id,
      companyId: job.companyId,
      status: job.status as KnowledgeSyncJobView["status"],
      selectedProjectIds: (job.selectedProjectIds as string[] | null) ?? [],
      optionsJson: (job.optionsJson as Record<string, unknown> | null) ?? {},
      summaryJson: (job.summaryJson as Record<string, unknown> | null) ?? {},
      error: job.error ?? null,
      startedAt: toIso(job.startedAt),
      completedAt: toIso(job.completedAt),
      createdAt: toIso(job.createdAt) ?? new Date(0).toISOString(),
      updatedAt: toIso(job.updatedAt) ?? new Date(0).toISOString(),
      projectRuns: (runsByJobId.get(job.id) ?? []).map((projectRun) => ({
        id: projectRun.id,
        jobId: projectRun.jobId,
        projectId: projectRun.projectId,
        workspaceId: projectRun.workspaceId ?? null,
        status: projectRun.status as KnowledgeSyncJobView["status"],
        stepJson: (projectRun.stepJson as Record<string, unknown> | null) ?? {},
        resultJson: (projectRun.resultJson as Record<string, unknown> | null) ?? {},
        error: projectRun.error ?? null,
        createdAt: toIso(projectRun.createdAt) ?? new Date(0).toISOString(),
        updatedAt: toIso(projectRun.updatedAt) ?? new Date(0).toISOString(),
      })),
    }));
  }

  async function getOrgSync(companyId: string) {
    const company = await requireCompany(companyId);
    const template = canonicalTemplateForCompanyName(company.name);
    const liveAgents = await agentsSvc.list(companyId);
    return buildOrgSyncView({
      companyId,
      templateKey: template?.templateKey ?? null,
      canonicalVersion: template?.canonicalVersion ?? null,
      canonicalAgents: template?.agents ?? [],
      liveAgents,
    });
  }

  async function buildKnowledgeSetupView(companyId: string): Promise<KnowledgeSetupView> {
    const [setupProgress, orgSync, projectRows, recentJobs] = await Promise.all([
      setupSvc.getView(companyId),
      getOrgSync(companyId),
      projectsSvc.list(companyId),
      loadJobViews(companyId),
    ]);
    const projectIds = projectRows.map((project) => project.id);

    const [
      revisions,
      documentCounts,
      chunkCounts,
      linkCounts,
      symbolEdgeCounts,
      versionCounts,
      profileCounts,
      feedbackCounts,
    ] = await Promise.all([
      projectIds.length > 0 ? db
        .select()
        .from(projectKnowledgeRevisions)
        .where(and(
          eq(projectKnowledgeRevisions.companyId, companyId),
          inArray(projectKnowledgeRevisions.projectId, projectIds),
        )) : Promise.resolve([]),
      db.execute<{ projectId: string | null; count: number }>(sql`
        select project_id as "projectId", count(*)::int as "count"
        from knowledge_documents
        where company_id = ${companyId} and authority_level <> 'deprecated'
        group by project_id
      `),
      db.execute<{ projectId: string | null; count: number }>(sql`
        select kd.project_id as "projectId", count(kc.id)::int as "count"
        from knowledge_chunks kc
        inner join knowledge_documents kd on kd.id = kc.document_id
        where kd.company_id = ${companyId} and kd.authority_level <> 'deprecated'
        group by kd.project_id
      `),
      db.execute<{ projectId: string | null; count: number }>(sql`
        select kd.project_id as "projectId", count(kcl.id)::int as "count"
        from knowledge_chunk_links kcl
        inner join knowledge_chunks kc on kc.id = kcl.chunk_id
        inner join knowledge_documents kd on kd.id = kc.document_id
        where kd.company_id = ${companyId} and kd.authority_level <> 'deprecated'
        group by kd.project_id
      `),
      db.execute<{ projectId: string | null; count: number }>(sql`
        select project_id as "projectId", count(*)::int as "count"
        from code_symbol_edges
        where company_id = ${companyId}
        group by project_id
      `),
      db.execute<{ projectId: string | null; count: number }>(sql`
        select project_id as "projectId", count(*)::int as "count"
        from knowledge_document_versions
        where company_id = ${companyId}
        group by project_id
      `),
      db.execute<{ projectId: string | null; count: number; lastFeedbackAt: string | null }>(sql`
        select project_id as "projectId", count(*)::int as "count", max(last_feedback_at)::text as "lastFeedbackAt"
        from retrieval_role_profiles
        where company_id = ${companyId}
        group by project_id
      `),
      db.execute<{ projectId: string | null; count: number; lastFeedbackAt: string | null }>(sql`
        select project_id as "projectId", count(*)::int as "count", max(created_at)::text as "lastFeedbackAt"
        from retrieval_feedback_events
        where company_id = ${companyId}
        group by project_id
      `),
    ]);

    const revisionByProjectId = new Map(revisions.map((revision) => [revision.projectId, revision]));
    const documentCountByProjectId = new Map(documentCounts.map((row) => [row.projectId ?? "__null__", Number(row.count ?? 0)]));
    const chunkCountByProjectId = new Map(chunkCounts.map((row) => [row.projectId ?? "__null__", Number(row.count ?? 0)]));
    const linkCountByProjectId = new Map(linkCounts.map((row) => [row.projectId ?? "__null__", Number(row.count ?? 0)]));
    const symbolCountByProjectId = new Map(symbolEdgeCounts.map((row) => [row.projectId ?? "__null__", Number(row.count ?? 0)]));
    const versionCountByProjectId = new Map(versionCounts.map((row) => [row.projectId ?? "__null__", Number(row.count ?? 0)]));
    const profileCountByProjectId = new Map(profileCounts.map((row) => [row.projectId ?? "__null__", {
      count: Number(row.count ?? 0),
      lastFeedbackAt: row.lastFeedbackAt,
    }]));
    const feedbackCountByProjectId = new Map(feedbackCounts.map((row) => [row.projectId ?? "__null__", {
      count: Number(row.count ?? 0),
      lastFeedbackAt: row.lastFeedbackAt,
    }]));

    const projectViews: KnowledgeSetupProjectView[] = [];
    for (const project of projectRows) {
      const primaryWorkspace = project.primaryWorkspace ?? project.workspaces.find((entry) => Boolean(entry.cwd)) ?? null;
      const workspaceCwd = primaryWorkspace?.cwd ?? null;
      const workspaceExists = workspaceCwd ? existsSync(workspaceCwd) : false;
      const workspaceVersion = workspaceExists
        ? await inspectWorkspaceVersionContext({ cwd: workspaceCwd })
        : null;
      const revision = revisionByProjectId.get(project.id) ?? null;
      const key = project.id;
      const documentCount = documentCountByProjectId.get(key) ?? 0;
      const syncIssues = buildProjectSyncIssues({
        workspaceExists,
        workspaceCwd,
        documentCount,
        revision: revision?.revision ?? 0,
        currentHeadSha: workspaceVersion?.headSha ?? null,
        lastHeadSha: revision?.lastHeadSha ?? null,
      });
      projectViews.push({
        projectId: project.id,
        projectName: project.name,
        projectStatus: deriveProjectSyncStatus({
          workspaceExists,
          workspaceCwd,
          currentHeadSha: workspaceVersion?.headSha ?? null,
          documentCount,
          revision: revision?.revision ?? 0,
          lastHeadSha: revision?.lastHeadSha ?? null,
        }),
        syncIssues,
        workspace: {
          workspaceId: primaryWorkspace?.id ?? null,
          workspaceName: primaryWorkspace?.name ?? null,
          cwd: workspaceCwd,
          repoUrl: primaryWorkspace?.repoUrl ?? null,
          repoRef: primaryWorkspace?.repoRef ?? null,
          exists: workspaceExists,
          currentBranch: workspaceVersion?.branchName ?? null,
          currentHeadSha: workspaceVersion?.headSha ?? null,
        },
        knowledge: {
          documentCount,
          chunkCount: chunkCountByProjectId.get(key) ?? 0,
          linkCount: linkCountByProjectId.get(key) ?? 0,
          symbolEdgeCount: symbolCountByProjectId.get(key) ?? 0,
          versionCount: versionCountByProjectId.get(key) ?? 0,
          revision: revision?.revision ?? 0,
          lastHeadSha: revision?.lastHeadSha ?? null,
          lastImportMode: revision?.lastImportMode ?? null,
          lastImportedAt: toIso(revision?.lastImportedAt) ?? null,
        },
        personalization: {
          feedbackCount: feedbackCountByProjectId.get(key)?.count ?? 0,
          profileCount: profileCountByProjectId.get(key)?.count ?? 0,
          lastFeedbackAt:
            feedbackCountByProjectId.get(key)?.lastFeedbackAt
            ?? profileCountByProjectId.get(key)?.lastFeedbackAt
            ?? null,
        },
      });
    }

    const activeJobCount = recentJobs.filter((job) => job.status === "queued" || job.status === "running").length;

    return {
      companyId,
      generatedAt: new Date().toISOString(),
      setupProgressStatus: setupProgress.status,
      orgSync,
      projects: projectViews.sort((left, right) => left.projectName.localeCompare(right.projectName, "en")),
      activeJobCount,
      latestJob: recentJobs[0] ?? null,
      recentJobs,
    };
  }

  async function refreshKnowledgeSetupCache(companyId: string, force = false) {
    if (!force) {
      const inFlight = knowledgeSetupRefreshPromises.get(companyId);
      if (inFlight) return inFlight;
    }

    const refreshPromise = buildKnowledgeSetupView(companyId)
      .then((view) => {
        const now = Date.now();
        knowledgeSetupReadModelCache.set(companyId, {
          value: view,
          expiresAt: now + KNOWLEDGE_SETUP_CACHE_FRESH_MS,
          staleUntil: now + KNOWLEDGE_SETUP_CACHE_STALE_MS,
        });
        return view;
      })
      .finally(() => {
        knowledgeSetupRefreshPromises.delete(companyId);
      });

    knowledgeSetupRefreshPromises.set(companyId, refreshPromise);
    return refreshPromise;
  }

  async function getKnowledgeSetup(companyId: string): Promise<KnowledgeSetupView> {
    const cached = knowledgeSetupReadModelCache.get(companyId);
    const now = Date.now();
    if (cached && now < cached.expiresAt) {
      return cached.value;
    }

    if (cached && now < cached.staleUntil) {
      void refreshKnowledgeSetupCache(companyId).catch(() => {});
      return cached.value;
    }

    return refreshKnowledgeSetupCache(companyId, true);
  }

  async function getKnowledgeSyncJob(companyId: string, jobId: string) {
    const jobs = await loadJobViews(companyId, 50);
    return jobs.find((job) => job.id === jobId) ?? null;
  }

  async function updateJobSummary(jobId: string, summaryJson: Record<string, unknown>, status?: string, error?: string | null) {
    const now = new Date();
    await db
      .update(knowledgeSyncJobs)
      .set({
        summaryJson,
        status: status ?? undefined,
        error: error ?? undefined,
        completedAt: status === "completed" || status === "failed" ? now : undefined,
        updatedAt: now,
      })
      .where(eq(knowledgeSyncJobs.id, jobId));
  }

  async function executeKnowledgeSyncJob(companyId: string, jobId: string) {
    if (activeKnowledgeSyncJobs.has(jobId)) {
      return;
    }
    activeKnowledgeSyncJobs.add(jobId);
    try {
      const jobRow = await db
        .select()
        .from(knowledgeSyncJobs)
        .where(and(
          eq(knowledgeSyncJobs.id, jobId),
          eq(knowledgeSyncJobs.companyId, companyId),
        ))
        .then((rows) => rows[0] ?? null);
      if (!jobRow) {
        throw new Error("Knowledge sync job not found");
      }

      const projectRows = await projectsSvc.list(companyId);
      const selectedProjectIds = (jobRow.selectedProjectIds as string[] | null) ?? [];
      const selectedProjects = selectedProjectIds.length > 0
        ? projectRows.filter((project) => selectedProjectIds.includes(project.id))
        : projectRows;
      if (selectedProjects.length === 0) {
        await updateJobSummary(jobId, {
          selectedProjectCount: 0,
          completedProjectCount: 0,
          failedProjectCount: 0,
          globalSteps: {},
        }, "failed", "No projects selected for knowledge sync");
        return;
      }

      const optionsJson = (jobRow.optionsJson as Record<string, unknown> | null) ?? {};
      const now = new Date();
      await db
        .update(knowledgeSyncJobs)
        .set({
          status: "running",
          startedAt: jobRow.startedAt ?? now,
          updatedAt: now,
        })
        .where(eq(knowledgeSyncJobs.id, jobId));

      let completedProjectCount = 0;
      let failedProjectCount = 0;

      for (const project of selectedProjects) {
        const projectRun = await db
          .select()
          .from(knowledgeSyncProjectRuns)
          .where(and(
            eq(knowledgeSyncProjectRuns.jobId, jobId),
            eq(knowledgeSyncProjectRuns.projectId, project.id),
          ))
          .then((rows) => rows[0] ?? null);
        if (!projectRun) continue;
        const startedProjectAt = new Date();

        await db
          .update(knowledgeSyncProjectRuns)
          .set({
            status: "running",
            stepJson: {
              importWorkspace: {
                status: "running",
                startedAt: startedProjectAt.toISOString(),
              },
            },
            updatedAt: startedProjectAt,
          })
          .where(eq(knowledgeSyncProjectRuns.id, projectRun.id));

        try {
          const result = await imports.importProjectWorkspace({
            projectId: project.id,
            workspaceId: project.primaryWorkspace?.id ?? undefined,
            maxFiles: typeof optionsJson.maxFiles === "number" ? optionsJson.maxFiles : undefined,
            forceFull: optionsJson.forceFull === true,
          });
          if (!result) {
            throw new Error("Project workspace import returned no result");
          }
          completedProjectCount += 1;
          await db
            .update(knowledgeSyncProjectRuns)
            .set({
              status: "completed",
              stepJson: {
                importWorkspace: {
                  status: "completed",
                  finishedAt: new Date().toISOString(),
                  importMode: result.importMode,
                },
              },
              resultJson: result as unknown as Record<string, unknown>,
              error: null,
              updatedAt: new Date(),
            })
            .where(eq(knowledgeSyncProjectRuns.id, projectRun.id));
        } catch (error) {
          failedProjectCount += 1;
          await db
            .update(knowledgeSyncProjectRuns)
            .set({
              status: "failed",
              stepJson: {
                importWorkspace: {
                  status: "failed",
                  finishedAt: new Date().toISOString(),
                },
              },
              error: error instanceof Error ? error.message : String(error),
              updatedAt: new Date(),
            })
            .where(eq(knowledgeSyncProjectRuns.id, projectRun.id));
        }
      }

      const globalSteps: Record<string, unknown> = {};
      try {
        if (optionsJson.rebuildGraph !== false) {
          globalSteps.rebuildGraph = await backfill.rebuildCompanyCodeGraph({
            companyId,
            projectIds: selectedProjects.map((project) => project.id),
          });
        }
        if (optionsJson.rebuildVersions !== false) {
          globalSteps.rebuildVersions = await backfill.rebuildCompanyDocumentVersions({
            companyId,
            projectIds: selectedProjects.map((project) => project.id),
          });
        }
        if (optionsJson.backfillPersonalization !== false) {
          globalSteps.backfillPersonalization = await personalization.backfillProtocolFeedback({
            companyId,
            projectIds: selectedProjects.map((project) => project.id),
          });
        }
      } catch (error) {
        await updateJobSummary(jobId, {
          selectedProjectCount: selectedProjects.length,
          completedProjectCount,
          failedProjectCount: failedProjectCount + 1,
          globalSteps,
        }, "failed", error instanceof Error ? error.message : String(error));
        return;
      }

      const finalStatus = failedProjectCount > 0 ? "failed" : "completed";
      await updateJobSummary(jobId, {
        selectedProjectCount: selectedProjects.length,
        completedProjectCount,
        failedProjectCount,
        globalSteps,
      }, finalStatus);
    } finally {
      invalidateKnowledgeSetupCache(companyId);
      activeKnowledgeSyncJobs.delete(jobId);
    }
  }

  async function runKnowledgeSync(companyId: string, input: CreateKnowledgeSyncJob, actor: ActorInfo) {
    const activeJob = await db
      .select({ id: knowledgeSyncJobs.id })
      .from(knowledgeSyncJobs)
      .where(and(
        eq(knowledgeSyncJobs.companyId, companyId),
        inArray(knowledgeSyncJobs.status, ["queued", "running"]),
      ))
      .orderBy(desc(knowledgeSyncJobs.createdAt))
      .limit(1)
      .then((rows) => rows[0] ?? null);
    if (activeJob) {
      const existingJob = await getKnowledgeSyncJob(companyId, activeJob.id);
      if (existingJob) {
        return existingJob;
      }
    }

    const projectRows = await projectsSvc.list(companyId);
    const selectedProjects = input.projectIds?.length
      ? projectRows.filter((project) => input.projectIds?.includes(project.id))
      : projectRows;
    if (selectedProjects.length === 0) {
      throw new Error("No projects selected for knowledge sync");
    }

    const now = new Date();
    const [job] = await db
      .insert(knowledgeSyncJobs)
      .values({
        companyId,
        status: "queued",
        requestedByActorType: actor.actorType,
        requestedByActorId: actor.actorId,
        requestedByAgentId: actor.agentId ?? null,
        selectedProjectIds: selectedProjects.map((project) => project.id),
        optionsJson: {
          forceFull: input.forceFull ?? false,
          maxFiles: input.maxFiles ?? null,
          rebuildGraph: input.rebuildGraph !== false,
          rebuildVersions: input.rebuildVersions !== false,
          backfillPersonalization: input.backfillPersonalization !== false,
        },
        summaryJson: {
          selectedProjectCount: selectedProjects.length,
          completedProjectCount: 0,
          failedProjectCount: 0,
          globalSteps: {},
        },
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    await db.insert(knowledgeSyncProjectRuns).values(
      selectedProjects.map((project) => ({
        jobId: job.id,
        companyId,
        projectId: project.id,
        workspaceId: project.primaryWorkspace?.id ?? null,
        status: "queued",
        stepJson: {},
        resultJson: {},
      })),
    );
    invalidateKnowledgeSetupCache(companyId);

    const scheduleExecution = () => {
      void executeKnowledgeSyncJob(companyId, job.id).catch(async (error) => {
        await updateJobSummary(job.id, {
          selectedProjectCount: selectedProjects.length,
          completedProjectCount: 0,
          failedProjectCount: selectedProjects.length,
          globalSteps: {},
        }, "failed", error instanceof Error ? error.message : String(error));
      });
    };
    if (!enqueueAfterDbCommit(scheduleExecution)) {
      scheduleExecution();
    }

    const createdJob = await getKnowledgeSyncJob(companyId, job.id);
    if (!createdJob) {
      throw new Error("Knowledge sync job was not found after creation");
    }
    return createdJob;
  }

  async function repairOrgSync(companyId: string, input: RepairOrgSync, actor: ActorInfo) {
    const company = await requireCompany(companyId);
    const template = canonicalTemplateForCompanyName(company.name);
    if (!template) {
      throw new Error("This company does not have a canonical org template");
    }

    const liveAgents = await agentsSvc.list(companyId);
    const byId = new Map(liveAgents.map((agent) => [agent.id, agent]));
    const byUrlKey = new Map(liveAgents.map((agent) => [agent.urlKey, agent]));
    const byBootstrapSlug = new Map(
      liveAgents
        .map((agent) => [readString(asRecord(agent.metadata)?.bootstrapSlug), agent] as const)
        .filter((entry): entry is [string, (typeof liveAgents)[number]] => Boolean(entry[0])),
    );
    const usedIds = new Set<string>();
    const createdAgentIds: string[] = [];
    const updatedAgentIds: string[] = [];
    const pausedAgentIds: string[] = [];
    const adoptedAgentIds: string[] = [];

    const statusBefore = buildOrgSyncView({
      companyId,
      templateKey: template.templateKey,
      canonicalVersion: template.canonicalVersion,
      canonicalAgents: template.agents,
      liveAgents,
    }).status;

    const managerIdBySlug = new Map<string, string | null>();
    for (const canonical of template.agents.filter((agent) => agent.reportsToSlug == null)) {
      const existing = byBootstrapSlug.get(canonical.canonicalSlug)
        ?? byUrlKey.get(canonical.canonicalSlug)
        ?? null;
      if (existing) {
        managerIdBySlug.set(canonical.canonicalSlug, existing.id);
      }
    }

    for (const canonical of template.agents) {
      const direct = byBootstrapSlug.get(canonical.canonicalSlug)
        ?? byUrlKey.get(canonical.canonicalSlug)
        ?? null;
      const legacyCandidate = input.adoptLegacySingleEngineers
        ? canonical.legacySlugs.map((slug) => byUrlKey.get(slug)).find((agent) => agent && !usedIds.has(agent.id)) ?? null
        : null;
      const target = direct ?? legacyCandidate;
      const managerId = canonical.reportsToSlug
        ? managerIdBySlug.get(canonical.reportsToSlug) ?? null
        : null;
      const patch = normalizeAgentPatch({ canonical, managerId });

      if (target) {
        usedIds.add(target.id);
        managerIdBySlug.set(canonical.canonicalSlug, target.id);
        const managerSlug = target.reportsTo
          ? liveAgents.find((agent) => agent.id === target.reportsTo)?.urlKey ?? null
          : null;
        const mismatchKeys = diffAgentShape(canonicalShape(canonical), liveShape(target, managerSlug));
        const metadata = {
          ...(asRecord(target.metadata) ?? {}),
          ...patch.metadata,
        };

        if ((legacyCandidate && legacyCandidate.id === target.id) || (input.repairMismatches && mismatchKeys.length > 0)) {
          const updated = await agentsSvc.update(target.id, {
            ...patch,
            metadata,
          });
          if (updated) {
            updatedAgentIds.push(updated.id);
            if (legacyCandidate && legacyCandidate.id === target.id) {
              adoptedAgentIds.push(updated.id);
            }
            managerIdBySlug.set(canonical.canonicalSlug, updated.id);
            byUrlKey.set(updated.urlKey, updated);
            byBootstrapSlug.set(canonical.canonicalSlug, updated);
            byId.set(updated.id, updated);
          }
        }
        continue;
      }

      if (!input.createMissing) continue;
      const created = await agentsSvc.create(companyId, {
        name: patch.name,
        role: patch.role,
        title: patch.title,
        reportsTo: managerId,
        capabilities: patch.capabilities,
        adapterType: patch.adapterType,
        adapterConfig: patch.adapterConfig,
        runtimeConfig: patch.runtimeConfig,
        budgetMonthlyCents: 0,
        metadata: patch.metadata,
        status: "idle",
        spentMonthlyCents: 0,
        lastHeartbeatAt: null,
      });
      createdAgentIds.push(created.id);
      managerIdBySlug.set(canonical.canonicalSlug, created.id);
      byId.set(created.id, created);
      byUrlKey.set(created.urlKey, created);
      byBootstrapSlug.set(canonical.canonicalSlug, created);
    }

    const finalLiveAgents = await agentsSvc.list(companyId);
    const orgSyncAfterCreate = buildOrgSyncView({
      companyId,
      templateKey: template.templateKey,
      canonicalVersion: template.canonicalVersion,
      canonicalAgents: template.agents,
      liveAgents: finalLiveAgents,
    });

    if (input.pauseLegacyExtras) {
      for (const extra of orgSyncAfterCreate.extraAgents) {
        if (!["legacy_single_engineer", "legacy_python_tl_alias", "stale_canonical_agent"].includes(extra.reason)) {
          continue;
        }
        const paused = await agentsSvc.pause(extra.agentId);
        if (paused) {
          pausedAgentIds.push(paused.id);
        }
      }
    }

    const orgSync = await getOrgSync(companyId);
    invalidateKnowledgeSetupCache(companyId);
    return {
      companyId,
      createdAgentIds,
      updatedAgentIds,
      pausedAgentIds,
      adoptedAgentIds,
      statusBefore,
      statusAfter: orgSync.status,
      orgSync,
    };
  }

  return {
    getOrgSync,
    getKnowledgeSetup,
    getKnowledgeSyncJob,
    runKnowledgeSync,
    repairOrgSync,
  };
}
