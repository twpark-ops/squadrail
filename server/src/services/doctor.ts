import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { and, asc, desc, eq, isNull, or, sql } from "drizzle-orm";
import type { Db } from "@squadrail/db";
import { companies, issueProtocolMessages, projectWorkspaces, projects } from "@squadrail/db";
import type {
  AdapterEnvironmentCheck,
  AdapterEnvironmentTestResult,
  AgentAdapterType,
  DoctorCheck,
  DoctorReport,
  DoctorWorkspaceTarget,
} from "@squadrail/shared";
import { findServerAdapter, isPrimaryServerAdapter } from "../adapters/registry.js";
import { knowledgeEmbeddingService } from "./knowledge-embeddings.js";
import { knowledgeRerankingService } from "./knowledge-reranking.js";
import { protocolIntegrityReady } from "../protocol-integrity.js";
import { setupProgressService } from "./setup-progress.js";

type DoctorServiceOptions = {
  deploymentMode: "local_trusted" | "authenticated";
  deploymentExposure: "private" | "public";
  authReady: boolean;
  protocolTimeoutsEnabled: boolean;
  knowledgeBackfillEnabled: boolean;
};

type WorkspaceCandidate = DoctorWorkspaceTarget & {
  repoUrl: string | null;
};

function summarizeDoctorStatus(checks: DoctorCheck[]): DoctorReport["status"] {
  if (checks.some((check) => check.status === "fail")) return "fail";
  if (checks.some((check) => check.status === "warn")) return "warn";
  return "pass";
}

function mapAdapterCheckToDoctorCheck(input: {
  adapterType: AgentAdapterType;
  check: AdapterEnvironmentCheck;
}): DoctorCheck {
  return {
    code: `${input.adapterType}_${input.check.code}`,
    category: "engine",
    status: input.check.level === "error" ? "fail" : input.check.level === "warn" ? "warn" : "pass",
    label: `Engine probe: ${input.adapterType}`,
    message: input.check.message,
    detail: input.check.detail ?? null,
    hint: input.check.hint ?? null,
  };
}

async function ensureWorkspaceAccess(candidate: WorkspaceCandidate | null) {
  if (!candidate?.cwd) {
    return {
      status: candidate?.repoUrl ? "warn" : "fail",
      message: candidate?.repoUrl
        ? "Workspace has repository metadata but no local cwd; import can only use remote metadata until a local path is configured."
        : "Workspace is not connected to a local directory yet.",
      detail: candidate?.repoUrl ?? null,
      hint: candidate?.repoUrl
        ? "Set a local workspace cwd to enable import, retrieval indexing, and agent execution."
        : "Connect a project workspace with a valid local cwd.",
    } as const;
  }

  try {
    await access(candidate.cwd, fsConstants.R_OK);
    return {
      status: "pass",
      message: `Workspace path is readable: ${candidate.cwd}`,
      detail: candidate.cwd,
      hint: null,
    } as const;
  } catch (error) {
    return {
      status: "fail",
      message: error instanceof Error ? error.message : "Workspace path is not readable",
      detail: candidate.cwd,
      hint: "Update the selected workspace cwd to a readable local path.",
    } as const;
  }
}

async function resolveWorkspaceCandidate(
  db: Db,
  companyId: string,
  preferredWorkspaceId?: string | null,
): Promise<WorkspaceCandidate | null> {
  const rows = await db
    .select({
      workspaceId: projectWorkspaces.id,
      projectId: projectWorkspaces.projectId,
      projectName: projects.name,
      workspaceName: projectWorkspaces.name,
      cwd: projectWorkspaces.cwd,
      repoUrl: projectWorkspaces.repoUrl,
      isPrimary: projectWorkspaces.isPrimary,
    })
    .from(projectWorkspaces)
    .leftJoin(projects, eq(projectWorkspaces.projectId, projects.id))
    .where(eq(projectWorkspaces.companyId, companyId))
    .orderBy(desc(projectWorkspaces.isPrimary), asc(projectWorkspaces.createdAt));
  if (rows.length === 0) return null;

  const selected = preferredWorkspaceId
    ? rows.find((row) => row.workspaceId === preferredWorkspaceId) ?? rows[0]!
    : rows[0]!;

  return {
    workspaceId: selected.workspaceId,
    projectId: selected.projectId,
    projectName: selected.projectName,
    workspaceName: selected.workspaceName,
    cwd: selected.cwd,
    repoUrl: selected.repoUrl,
  };
}

async function runDeepEngineProbe(input: {
  companyId: string;
  adapterType: AgentAdapterType;
  cwd: string | null;
}): Promise<AdapterEnvironmentTestResult | null> {
  const adapter = findServerAdapter(input.adapterType);
  if (!adapter?.testEnvironment) return null;
  return adapter.testEnvironment({
    companyId: input.companyId,
    adapterType: input.adapterType,
    config: {
      cwd: input.cwd ?? process.cwd(),
    },
  });
}

export function doctorService(db: Db, opts: DoctorServiceOptions) {
  const setup = setupProgressService(db);
  const embeddings = knowledgeEmbeddingService();
  const reranker = knowledgeRerankingService();

  return {
    async run(input: {
      companyId: string;
      workspaceId?: string | null;
      deep?: boolean;
    }): Promise<DoctorReport> {
      const setupView = await setup.getView(input.companyId);
      const workspace = await resolveWorkspaceCandidate(
        db,
        input.companyId,
        input.workspaceId ?? setupView.selectedWorkspaceId,
      );
      const checks: DoctorCheck[] = [];

      const companyExists = await db
        .select({ id: companies.id })
        .from(companies)
        .where(eq(companies.id, input.companyId))
        .then((rows) => rows[0] ?? null);
      checks.push({
        code: "company_exists",
        category: "auth",
        status: companyExists ? "pass" : "fail",
        label: "Company scope",
        message: companyExists ? "Company scope is valid." : "Company does not exist.",
      });

      checks.push({
        code: "auth_ready",
        category: "auth",
        status: opts.authReady ? "pass" : opts.deploymentMode === "authenticated" ? "fail" : "warn",
        label: "Auth readiness",
        message: opts.authReady
          ? `Authentication is ready for ${opts.deploymentMode} mode.`
          : `Authentication is not ready for ${opts.deploymentMode} mode.`,
        detail: `exposure=${opts.deploymentExposure}`,
      });

      try {
        await db.execute(sql`select 1`);
        checks.push({
          code: "database_connection",
          category: "database",
          status: "pass",
          label: "Database connection",
          message: "PostgreSQL connection is healthy.",
        });
      } catch (error) {
        checks.push({
          code: "database_connection",
          category: "database",
          status: "fail",
          label: "Database connection",
          message: error instanceof Error ? error.message : "Database query failed.",
        });
      }

      const vectorExtension = await db.execute<{ installed: boolean }>(
        sql`select exists (select 1 from pg_extension where extname = 'vector') as installed`,
      );
      const vectorInstalled = Boolean(vectorExtension[0]?.installed ?? false);
      const vectorIndexRows = vectorInstalled
        ? await db.execute<{ installed: boolean }>(
          sql`select exists (
            select 1
            from pg_indexes
            where schemaname = 'public'
              and tablename = 'knowledge_chunks'
              and indexname = 'knowledge_chunks_embedding_vector_hnsw_idx'
          ) as installed`,
        )
        : [];
      const vectorIndexInstalled = Boolean(vectorIndexRows[0]?.installed ?? false);
      checks.push({
        code: "vector_extension",
        category: "database",
        status: vectorInstalled ? "pass" : "warn",
        label: "Vector extension",
        message: vectorInstalled
          ? "pgvector extension is available."
          : "pgvector extension is not installed; Squadrail will use application-side cosine reranking.",
        hint: vectorInstalled ? null : "Install pgvector later if you want database-side vector indexing and faster dense retrieval.",
      });
      checks.push({
        code: "vector_index",
        category: "database",
        status: !vectorInstalled ? "warn" : vectorIndexInstalled ? "pass" : "warn",
        label: "Dense vector index",
        message: !vectorInstalled
          ? "Vector index is unavailable because pgvector is not installed."
          : vectorIndexInstalled
            ? "HNSW vector index is installed for knowledge chunks."
            : "pgvector is installed but the HNSW index is missing.",
        hint: !vectorInstalled || vectorIndexInstalled ? null : "Run the latest migrations to create knowledge_chunks_embedding_vector_hnsw_idx.",
      });

      const rlsRows = await db.execute<{ enabled: boolean; forced: boolean; roleReady: boolean }>(
        sql`select
            coalesce((select relrowsecurity from pg_class where relname = 'issues'), false) as enabled,
            coalesce((select relforcerowsecurity from pg_class where relname = 'issues'), false) as forced,
            exists(select 1 from pg_roles where rolname = 'squadrail_app_rls') as roleReady`,
      );
      const rlsEnabled = Boolean(rlsRows[0]?.enabled ?? false);
      const rlsRoleReady = Boolean(rlsRows[0]?.roleReady ?? false);
      checks.push({
        code: "tenant_rls",
        category: "auth",
        status: rlsEnabled && rlsRoleReady ? "pass" : "warn",
        label: "Tenant RLS",
        message: rlsEnabled && rlsRoleReady
          ? "Row-level security policies and the Squadrail request role are installed."
          : "Tenant RLS is not fully installed yet.",
        hint: rlsEnabled && rlsRoleReady
          ? null
          : "Apply the latest database migrations to install RLS policies and the squadrail_app_rls role.",
      });

      checks.push({
        code: "protocol_timeout_scheduler",
        category: "scheduler",
        status: opts.protocolTimeoutsEnabled ? "pass" : "warn",
        label: "Protocol timeout worker",
        message: opts.protocolTimeoutsEnabled ? "Protocol timeout worker is enabled." : "Protocol timeout worker is disabled.",
      });

      checks.push({
        code: "knowledge_backfill_scheduler",
        category: "scheduler",
        status: opts.knowledgeBackfillEnabled ? "pass" : "warn",
        label: "Knowledge backfill worker",
        message: opts.knowledgeBackfillEnabled ? "Knowledge backfill worker is enabled." : "Knowledge backfill worker is disabled.",
      });

      checks.push({
        code: "protocol_integrity_secret",
        category: "auth",
        status: protocolIntegrityReady() ? "pass" : "warn",
        label: "Protocol integrity secret",
        message: protocolIntegrityReady()
          ? "Tamper-evident protocol message sealing is ready."
          : "Protocol integrity secret is not available; new protocol messages cannot be sealed.",
        hint: protocolIntegrityReady()
          ? null
          : "Provide SQUADRAIL_PROTOCOL_INTEGRITY_SECRET or allow Squadrail to write its default protocol-integrity.secret file.",
      });

      const unsignedProtocolMessages = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(issueProtocolMessages)
        .where(
          and(
            eq(issueProtocolMessages.companyId, input.companyId),
            or(isNull(issueProtocolMessages.integritySignature), isNull(issueProtocolMessages.integrityAlgorithm)),
          ),
        )
        .then((rows) => Number(rows[0]?.count ?? 0));
      checks.push({
        code: "protocol_integrity_backlog",
        category: "database",
        status: unsignedProtocolMessages === 0 ? "pass" : "warn",
        label: "Protocol integrity backlog",
        message: unsignedProtocolMessages === 0
          ? "All protocol messages are sealed with an integrity signature."
          : `${unsignedProtocolMessages} protocol message(s) predate sealing or still need resealing.`,
        hint: unsignedProtocolMessages === 0
          ? null
          : "Legacy unsealed messages remain readable, but new audit guarantees only apply to sealed protocol traffic.",
      });

      checks.push({
        code: "engine_selected",
        category: "engine",
        status: setupView.selectedEngine ? "pass" : "warn",
        label: "Execution engine",
        message: setupView.selectedEngine
          ? `Selected engine: ${setupView.selectedEngine}`
          : "No execution engine selected yet.",
        hint: setupView.selectedEngine ? null : "Choose Claude Code or Codex as the squad execution engine.",
      });

      if (setupView.selectedEngine) {
        const supported = isPrimaryServerAdapter(setupView.selectedEngine);
        checks.push({
          code: "engine_supported",
          category: "engine",
          status: supported ? "pass" : "warn",
          label: "Supported engine",
          message: supported
            ? `${setupView.selectedEngine} matches the Squadrail execution target.`
            : `${setupView.selectedEngine} is still available, but Squadrail is being narrowed to Claude Code and Codex.`,
        });
      }

      checks.push({
        code: "workspace_selected",
        category: "workspace",
        status: workspace ? "pass" : "warn",
        label: "Workspace selection",
        message: workspace
          ? `Workspace selected: ${workspace.workspaceName ?? workspace.workspaceId}`
          : "No workspace is connected yet.",
        detail: workspace?.cwd ?? null,
        hint: workspace ? null : "Connect a project workspace before running import and execution flows.",
      });

      const workspaceAccess = await ensureWorkspaceAccess(workspace);
      checks.push({
        code: "workspace_access",
        category: "workspace",
        status: workspaceAccess.status,
        label: "Workspace access",
        message: workspaceAccess.message,
        detail: workspaceAccess.detail,
        hint: workspaceAccess.hint,
      });

      const embeddingInfo = embeddings.getProviderInfo();
      checks.push({
        code: "embedding_provider",
        category: "retrieval",
        status: embeddingInfo.available ? "pass" : "warn",
        label: "Embedding provider",
        message: embeddingInfo.available
          ? `Embeddings ready via ${embeddingInfo.provider}:${embeddingInfo.model}.`
          : "Embedding provider is not configured.",
        hint: embeddingInfo.available
          ? null
          : "Set OPENAI_API_KEY or SQUADRAIL_KNOWLEDGE_OPENAI_API_KEY to enable embedding generation.",
      });

      const rerankInfo = reranker.getProviderInfo();
      checks.push({
        code: "rerank_provider",
        category: "retrieval",
        status: rerankInfo.available ? "pass" : "warn",
        label: "Rerank provider",
        message: rerankInfo.available
          ? `Optional rerank ready via ${rerankInfo.provider}:${rerankInfo.model}.`
          : "Model rerank is not configured; heuristic reranking will be used.",
      });

      if (input.deep && setupView.selectedEngine) {
        const deepResult = await runDeepEngineProbe({
          companyId: input.companyId,
          adapterType: setupView.selectedEngine,
          cwd: workspace?.cwd ?? null,
        });
        if (deepResult) {
          checks.push(...deepResult.checks.map((check) => mapAdapterCheckToDoctorCheck({
            adapterType: setupView.selectedEngine!,
            check,
          })));
        }
      }

      const summary = {
        pass: checks.filter((check) => check.status === "pass").length,
        warn: checks.filter((check) => check.status === "warn").length,
        fail: checks.filter((check) => check.status === "fail").length,
      };

      return {
        status: summarizeDoctorStatus(checks),
        companyId: input.companyId,
        selectedEngine: setupView.selectedEngine,
        workspace,
        checkedAt: new Date().toISOString(),
        checks,
        summary,
      };
    },
  };
}
