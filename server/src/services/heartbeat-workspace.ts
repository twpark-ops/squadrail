import fs from "node:fs/promises";
import path from "node:path";
import { and, asc, eq } from "drizzle-orm";
import type { Db } from "@squadrail/db";
import {
  agents,
  issues,
  projectWorkspaces,
} from "@squadrail/db";
import {
  readProjectWorkspaceExecutionPolicyFromMetadata,
  type ProjectWorkspaceExecutionPolicy,
  type ProjectWorkspaceUsageProfile,
} from "@squadrail/shared";
import { resolveDefaultAgentWorkspaceDir } from "../home-paths.js";
import {
  resolveProjectWorkspaceByPolicy,
  type ProjectWorkspaceRoutingRow,
} from "./project-workspace-routing.js";

const REPO_ONLY_CWD_SENTINELS = new Set(["/__squadrail_repo_only__"]);

export type ResolvedWorkspaceForRun = {
  cwd: string;
  source: "project_shared" | "project_isolated" | "task_session" | "agent_home";
  projectId: string | null;
  workspaceId: string | null;
  repoUrl: string | null;
  repoRef: string | null;
  executionPolicy: ProjectWorkspaceExecutionPolicy | null;
  workspaceUsage: ProjectWorkspaceUsageProfile | null;
  branchName: string | null;
  workspaceHints: Array<{
    workspaceId: string;
    cwd: string | null;
    repoUrl: string | null;
    repoRef: string | null;
    executionPolicy: ProjectWorkspaceExecutionPolicy | null;
  }>;
  warnings: string[];
};

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function mapWorkspaceRowToRoutingRow(
  workspace: typeof projectWorkspaces.$inferSelect,
): ProjectWorkspaceRoutingRow {
  return {
    id: workspace.id,
    name: workspace.name,
    cwd: workspace.cwd,
    repoUrl: workspace.repoUrl ?? null,
    repoRef: workspace.repoRef ?? null,
    metadata: (workspace.metadata as Record<string, unknown> | null) ?? null,
    isPrimary: workspace.isPrimary,
  };
}

export async function resolveWorkspaceForRun(input: {
  db: Db;
  agent: typeof agents.$inferSelect;
  context: Record<string, unknown>;
  taskKey: string | null;
  previousSessionParams: Record<string, unknown> | null;
  useProjectWorkspace?: boolean | null;
}): Promise<ResolvedWorkspaceForRun> {
  const issueId = readNonEmptyString(input.context.issueId);
  const contextProjectId = readNonEmptyString(input.context.projectId);
  const issueProjectId = issueId
    ? await input.db
        .select({ projectId: issues.projectId })
        .from(issues)
        .where(and(eq(issues.id, issueId), eq(issues.companyId, input.agent.companyId)))
        .then((rows) => rows[0]?.projectId ?? null)
    : null;
  const resolvedProjectId = issueProjectId ?? contextProjectId;
  const useProjectWorkspace = input.useProjectWorkspace !== false;
  const workspaceProjectId = useProjectWorkspace ? resolvedProjectId : null;

  const projectWorkspaceRows = workspaceProjectId
    ? await input.db
        .select()
        .from(projectWorkspaces)
        .where(
          and(
            eq(projectWorkspaces.companyId, input.agent.companyId),
            eq(projectWorkspaces.projectId, workspaceProjectId),
          ),
        )
        .orderBy(asc(projectWorkspaces.createdAt), asc(projectWorkspaces.id))
    : [];

  const workspaceHints = projectWorkspaceRows.map((workspace) => ({
    workspaceId: workspace.id,
    cwd: readNonEmptyString(workspace.cwd),
    repoUrl: readNonEmptyString(workspace.repoUrl),
    repoRef: readNonEmptyString(workspace.repoRef),
    executionPolicy: readProjectWorkspaceExecutionPolicyFromMetadata(workspace.metadata),
  }));

  if (projectWorkspaceRows.length > 0) {
    const resolvedProjectWorkspace = await resolveProjectWorkspaceByPolicy({
      agentId: input.agent.id,
      issueId,
      projectId: resolvedProjectId,
      taskKey: input.taskKey,
      context: input.context,
      workspaces: projectWorkspaceRows.map(mapWorkspaceRowToRoutingRow),
    });
    if (resolvedProjectWorkspace) {
      return {
        cwd: resolvedProjectWorkspace.cwd,
        source: resolvedProjectWorkspace.source,
        projectId: resolvedProjectId,
        workspaceId: resolvedProjectWorkspace.workspaceId,
        repoUrl: resolvedProjectWorkspace.repoUrl,
        repoRef: resolvedProjectWorkspace.repoRef,
        executionPolicy: resolvedProjectWorkspace.executionPolicy,
        workspaceUsage: resolvedProjectWorkspace.workspaceUsage,
        branchName: resolvedProjectWorkspace.branchName,
        workspaceHints,
        warnings: resolvedProjectWorkspace.warnings,
      };
    }

    const missingProjectCwds: string[] = [];
    let hasConfiguredProjectCwd = false;
    for (const workspace of projectWorkspaceRows) {
      const projectCwd = readNonEmptyString(workspace.cwd);
      if (!projectCwd || REPO_ONLY_CWD_SENTINELS.has(projectCwd)) continue;
      hasConfiguredProjectCwd = true;
      const projectCwdExists = await fs
        .stat(projectCwd)
        .then((stats) => stats.isDirectory())
        .catch(() => false);
      if (projectCwdExists) {
        return {
          cwd: projectCwd,
          source: "project_shared",
          projectId: resolvedProjectId,
          workspaceId: workspace.id,
          repoUrl: workspace.repoUrl,
          repoRef: workspace.repoRef,
          executionPolicy: null,
          workspaceUsage: null,
          branchName: null,
          workspaceHints,
          warnings: [],
        };
      }
      missingProjectCwds.push(projectCwd);
    }

    const fallbackCwd = resolveDefaultAgentWorkspaceDir(input.agent.id);
    await fs.mkdir(fallbackCwd, { recursive: true });
    const warnings: string[] = [];
    if (missingProjectCwds.length > 0) {
      const firstMissing = missingProjectCwds[0];
      const extraMissingCount = Math.max(0, missingProjectCwds.length - 1);
      warnings.push(
        extraMissingCount > 0
          ? `Project workspace path "${firstMissing}" and ${extraMissingCount} other configured path(s) are not available yet. Using fallback workspace "${fallbackCwd}" for this run.`
          : `Project workspace path "${firstMissing}" is not available yet. Using fallback workspace "${fallbackCwd}" for this run.`,
      );
    } else if (!hasConfiguredProjectCwd) {
      warnings.push(
        `Project workspace has no local cwd configured. Using fallback workspace "${fallbackCwd}" for this run.`,
      );
    }
    return {
      cwd: fallbackCwd,
      source: "project_shared",
      projectId: resolvedProjectId,
      workspaceId: projectWorkspaceRows[0]?.id ?? null,
      repoUrl: projectWorkspaceRows[0]?.repoUrl ?? null,
      repoRef: projectWorkspaceRows[0]?.repoRef ?? null,
      executionPolicy: null,
      workspaceUsage: null,
      branchName: null,
      workspaceHints,
      warnings,
    };
  }

  const sessionCwd = readNonEmptyString(input.previousSessionParams?.cwd);
  if (sessionCwd) {
    const sessionCwdExists = await fs
      .stat(sessionCwd)
      .then((stats) => stats.isDirectory())
      .catch(() => false);
    if (sessionCwdExists) {
      return {
        cwd: sessionCwd,
        source: "task_session",
        projectId: resolvedProjectId,
        workspaceId: readNonEmptyString(input.previousSessionParams?.workspaceId),
        repoUrl: readNonEmptyString(input.previousSessionParams?.repoUrl),
        repoRef: readNonEmptyString(input.previousSessionParams?.repoRef),
        executionPolicy: null,
        workspaceUsage: null,
        branchName: readNonEmptyString(input.previousSessionParams?.branchName),
        workspaceHints,
        warnings: [],
      };
    }
  }

  const cwd = resolveDefaultAgentWorkspaceDir(input.agent.id);
  await fs.mkdir(cwd, { recursive: true });
  const warnings: string[] = [];
  if (sessionCwd) {
    warnings.push(
      `Saved session workspace "${sessionCwd}" is not available. Using fallback workspace "${cwd}" for this run.`,
    );
  } else if (resolvedProjectId) {
    warnings.push(
      `No project workspace directory is currently available for this issue. Using fallback workspace "${cwd}" for this run.`,
    );
  } else {
    warnings.push(
      `No project or prior session workspace was available. Using fallback workspace "${cwd}" for this run.`,
    );
  }
  return {
    cwd,
    source: "agent_home",
    projectId: resolvedProjectId,
    workspaceId: null,
    repoUrl: null,
    repoRef: null,
    executionPolicy: null,
    workspaceUsage: null,
    branchName: null,
    workspaceHints,
    warnings,
  };
}

export function resolveRuntimeSessionParamsForWorkspace(input: {
  agentId: string;
  previousSessionParams: Record<string, unknown> | null;
  resolvedWorkspace: ResolvedWorkspaceForRun;
}) {
  const { agentId, previousSessionParams, resolvedWorkspace } = input;
  const previousSessionId = readNonEmptyString(previousSessionParams?.sessionId);
  const previousCwd = readNonEmptyString(previousSessionParams?.cwd);
  if (!previousSessionId || !previousCwd) {
    return {
      sessionParams: previousSessionParams,
      warning: null as string | null,
    };
  }
  if (resolvedWorkspace.source !== "project_shared" && resolvedWorkspace.source !== "project_isolated") {
    return {
      sessionParams: previousSessionParams,
      warning: null as string | null,
    };
  }
  const projectCwd = readNonEmptyString(resolvedWorkspace.cwd);
  if (!projectCwd) {
    return {
      sessionParams: previousSessionParams,
      warning: null as string | null,
    };
  }
  const fallbackAgentHomeCwd = resolveDefaultAgentWorkspaceDir(agentId);
  if (path.resolve(previousCwd) !== path.resolve(fallbackAgentHomeCwd)) {
    return {
      sessionParams: previousSessionParams,
      warning: null as string | null,
    };
  }
  if (path.resolve(projectCwd) === path.resolve(previousCwd)) {
    return {
      sessionParams: previousSessionParams,
      warning: null as string | null,
    };
  }
  const previousWorkspaceId = readNonEmptyString(previousSessionParams?.workspaceId);
  if (previousWorkspaceId && resolvedWorkspace.workspaceId && previousWorkspaceId !== resolvedWorkspace.workspaceId) {
    return {
      sessionParams: previousSessionParams,
      warning: null as string | null,
    };
  }

  const migratedSessionParams: Record<string, unknown> = {
    ...(previousSessionParams ?? {}),
    cwd: projectCwd,
  };
  if (resolvedWorkspace.workspaceId) migratedSessionParams.workspaceId = resolvedWorkspace.workspaceId;
  if (resolvedWorkspace.repoUrl) migratedSessionParams.repoUrl = resolvedWorkspace.repoUrl;
  if (resolvedWorkspace.repoRef) migratedSessionParams.repoRef = resolvedWorkspace.repoRef;
  if (resolvedWorkspace.branchName) migratedSessionParams.branchName = resolvedWorkspace.branchName;

  return {
    sessionParams: migratedSessionParams,
    warning:
      `Project workspace "${projectCwd}" is now available. ` +
      `Attempting to resume session "${previousSessionId}" that was previously saved in fallback workspace "${previousCwd}".`,
  };
}
