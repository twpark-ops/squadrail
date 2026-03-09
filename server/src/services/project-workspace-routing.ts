import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { ProjectWorkspaceExecutionPolicy, ProjectWorkspaceUsageProfile } from "@squadrail/shared";
import { readProjectWorkspaceExecutionPolicyFromMetadata } from "@squadrail/shared";

const execFile = promisify(execFileCallback);
const REPO_ONLY_CWD_SENTINELS = new Set(["/__squadrail_repo_only__"]);

type GitExecutor = (input: {
  cwd?: string;
  args: string[];
}) => Promise<{ stdout: string; stderr?: string }>;

type GitWorktreeEntry = {
  path: string;
  branchName: string | null;
};

let gitExecutorOverride: GitExecutor | null = null;

export type ProjectWorkspaceRoutingRow = {
  id: string;
  name: string;
  cwd: string | null;
  repoUrl: string | null;
  repoRef: string | null;
  metadata: Record<string, unknown> | null;
  isPrimary: boolean;
};

export type ResolvedProjectWorkspace = {
  cwd: string;
  source: "project_shared" | "project_isolated";
  workspaceId: string;
  repoUrl: string | null;
  repoRef: string | null;
  executionPolicy: ProjectWorkspaceExecutionPolicy | null;
  workspaceUsage: ProjectWorkspaceUsageProfile;
  warnings: string[];
  branchName: string | null;
};

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function slugSegment(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "workspace";
}

async function pathIsDirectory(targetPath: string) {
  return fs
    .stat(targetPath)
    .then((stats) => stats.isDirectory())
    .catch(() => false);
}

async function isGitWorkTree(targetPath: string) {
  try {
    const { stdout } = await runGit(["rev-parse", "--is-inside-work-tree"], targetPath);
    return stdout.trim() === "true";
  } catch {
    return false;
  }
}

async function readGitBranchName(targetPath: string) {
  try {
    const { stdout } = await runGit(["branch", "--show-current"], targetPath);
    const branchName = stdout.trim();
    return branchName.length > 0 ? branchName : null;
  } catch {
    return null;
  }
}

async function isGitWorkTreeClean(targetPath: string) {
  try {
    const { stdout } = await runGit(["status", "--porcelain"], targetPath);
    return stdout.trim().length === 0;
  } catch {
    return false;
  }
}

async function isDirectoryEmpty(targetPath: string) {
  try {
    const entries = await fs.readdir(targetPath);
    return entries.length === 0;
  } catch {
    return false;
  }
}

function parseWorktreeList(stdout: string): GitWorktreeEntry[] {
  const entries: GitWorktreeEntry[] = [];
  let currentPath: string | null = null;
  let currentBranch: string | null = null;

  const flush = () => {
    if (!currentPath) return;
    entries.push({
      path: currentPath,
      branchName: currentBranch,
    });
    currentPath = null;
    currentBranch = null;
  };

  for (const rawLine of stdout.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line) {
      flush();
      continue;
    }
    if (line.startsWith("worktree ")) {
      flush();
      currentPath = line.slice("worktree ".length).trim();
      continue;
    }
    if (line.startsWith("branch ")) {
      const ref = line.slice("branch ".length).trim();
      currentBranch = ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref;
    }
  }
  flush();
  return entries;
}

async function listGitWorktrees(baseCwd: string) {
  try {
    const { stdout } = await runGit(["worktree", "list", "--porcelain"], baseCwd);
    return parseWorktreeList(stdout);
  } catch {
    return [];
  }
}

async function removeIsolatedWorkspace(input: {
  baseCwd: string;
  targetDir: string;
  strategy: NonNullable<ProjectWorkspaceExecutionPolicy["isolationStrategy"]>;
}) {
  if (input.strategy === "worktree") {
    await runGit(["worktree", "remove", "--force", input.targetDir], input.baseCwd).catch(() => undefined);
  }
  await fs.rm(input.targetDir, { recursive: true, force: true }).catch(() => undefined);
}

async function runGit(args: string[], cwd?: string) {
  if (gitExecutorOverride) {
    return gitExecutorOverride({ cwd, args });
  }
  return execFile("git", cwd ? ["-C", cwd, ...args] : args, {
    timeout: 30_000,
  });
}

export function setProjectWorkspaceGitExecutorForTests(executor: GitExecutor | null) {
  gitExecutorOverride = executor;
}

function renderBranchName(template: string | null, input: {
  agentId: string;
  issueId: string | null;
  projectId: string | null;
  workspaceId: string;
}) {
  if (!template) return null;
  const issueKey = input.issueId ? slugSegment(input.issueId).slice(0, 16) : "adhoc";
  const agentKey = slugSegment(input.agentId).slice(0, 16);
  const projectKey = input.projectId ? slugSegment(input.projectId).slice(0, 24) : "project";
  const workspaceKey = slugSegment(input.workspaceId).slice(0, 16);
  return template
    .replaceAll("{issueId}", issueKey)
    .replaceAll("{agentId}", agentKey)
    .replaceAll("{projectId}", projectKey)
    .replaceAll("{workspaceId}", workspaceKey);
}

function defaultIsolatedRoot(baseCwd: string, strategy: NonNullable<ProjectWorkspaceExecutionPolicy["isolationStrategy"]>) {
  return path.join(
    path.dirname(baseCwd),
    strategy === "clone" ? ".squadrail-clones" : ".squadrail-worktrees",
    path.basename(baseCwd),
  );
}

function deriveIsolatedWorkspaceDir(input: {
  baseCwd: string;
  strategy: NonNullable<ProjectWorkspaceExecutionPolicy["isolationStrategy"]>;
  isolatedRoot: string | null;
  issueId: string | null;
  taskKey: string | null;
  agentId: string;
  workspaceId: string;
}) {
  const root = input.isolatedRoot ?? defaultIsolatedRoot(input.baseCwd, input.strategy);
  const taskKey = input.issueId ?? input.taskKey ?? "adhoc";
  const dirName = `${slugSegment(taskKey).slice(0, 32)}-${slugSegment(input.agentId).slice(0, 24)}-${slugSegment(input.workspaceId).slice(0, 12)}`;
  return path.join(root, dirName);
}

function classifyUsageScore(input: {
  usage: ProjectWorkspaceUsageProfile;
  policy: ProjectWorkspaceExecutionPolicy | null;
  isPrimary: boolean;
  hasCwd: boolean;
}) {
  if (!input.hasCwd) return Number.NEGATIVE_INFINITY;
  const policy = input.policy;
  if (policy && !policy.applyFor.includes(input.usage)) {
    return Number.NEGATIVE_INFINITY;
  }
  let score = input.isPrimary ? 20 : 0;
  if (!policy) {
    score += input.usage === "implementation" ? 20 : 40;
    return score;
  }
  if (policy.mode === "isolated") {
    score += input.usage === "implementation" ? 100 : -50;
  } else {
    score += input.usage === "implementation" ? 15 : 80;
  }
  if (policy.writable) score += input.usage === "implementation" ? 10 : -5;
  return score;
}

export function deriveProjectWorkspaceUsageFromContext(
  context: Record<string, unknown>,
): ProjectWorkspaceUsageProfile {
  const recipientRole = readNonEmptyString(context.protocolRecipientRole);
  const messageType = readNonEmptyString(context.protocolMessageType);
  const workflowStateAfter = readNonEmptyString(context.protocolWorkflowStateAfter);

  if (
    recipientRole === "reviewer"
    || recipientRole === "qa"
    || messageType === "START_REVIEW"
    || messageType === "REQUEST_CHANGES"
    || messageType === "APPROVE_IMPLEMENTATION"
    || workflowStateAfter === "submitted_for_review"
    || workflowStateAfter === "under_review"
    || workflowStateAfter === "approved"
  ) {
    return "review";
  }

  if (
    recipientRole === "engineer"
    && (
      messageType === "START_IMPLEMENTATION"
      || messageType === "REPORT_PROGRESS"
      || messageType === "SUBMIT_FOR_REVIEW"
      || messageType === "ACK_CHANGE_REQUEST"
      || workflowStateAfter === "implementing"
      || workflowStateAfter === "changes_requested"
    )
  ) {
    return "implementation";
  }

  return "analysis";
}

async function ensureIsolatedWorkspace(input: {
  baseCwd: string;
  workspace: ProjectWorkspaceRoutingRow;
  policy: ProjectWorkspaceExecutionPolicy;
  agentId: string;
  issueId: string | null;
  projectId: string | null;
  taskKey: string | null;
  repoRef: string | null;
}): Promise<{ cwd: string; warnings: string[]; branchName: string | null } | null> {
  const strategy = input.policy.isolationStrategy ?? "worktree";
  const targetDir = deriveIsolatedWorkspaceDir({
    baseCwd: input.baseCwd,
    strategy,
    isolatedRoot: input.policy.isolatedRoot,
    issueId: input.issueId,
    taskKey: input.taskKey,
    agentId: input.agentId,
    workspaceId: input.workspace.id,
  });
  const branchName = renderBranchName(input.policy.branchTemplate, {
    agentId: input.agentId,
    issueId: input.issueId,
    projectId: input.projectId,
    workspaceId: input.workspace.id,
  });
  const warnings: string[] = [];

  await fs.mkdir(path.dirname(targetDir), { recursive: true });

  if (await pathIsDirectory(targetDir)) {
    if (await isGitWorkTree(targetDir)) {
      const existingBranchName = await readGitBranchName(targetDir);
      if (branchName && existingBranchName && existingBranchName !== branchName) {
        const clean = await isGitWorkTreeClean(targetDir);
        if (!clean) {
          warnings.push(
            `Isolated workspace "${targetDir}" is bound to branch "${existingBranchName}" instead of "${branchName}" and contains local changes. Falling back to the shared project workspace rather than reusing a stale branch.`,
          );
          return null;
        }
        await removeIsolatedWorkspace({
          baseCwd: input.baseCwd,
          targetDir,
          strategy,
        });
        warnings.push(
          `Removed stale isolated workspace "${targetDir}" because it was bound to branch "${existingBranchName}" instead of "${branchName}".`,
        );
      } else {
        return { cwd: targetDir, warnings, branchName: existingBranchName ?? branchName };
      }
    } else if (await isDirectoryEmpty(targetDir)) {
      await fs.rm(targetDir, { recursive: true, force: true });
      warnings.push(
        `Removed empty stale isolated workspace directory "${targetDir}" before recreating it.`,
      );
    } else {
      warnings.push(
        `Isolated workspace path "${targetDir}" already exists but is not a git worktree/clone. Falling back to the shared project workspace.`,
      );
      return null;
    }
  }

  if (!(await isGitWorkTree(input.baseCwd))) {
    warnings.push(
      `Workspace "${input.baseCwd}" is not a git repository, so isolated ${strategy} execution could not be prepared.`,
    );
    return null;
  }

  const targetRef = input.repoRef ?? "HEAD";
  if (strategy === "clone") {
    await runGit(["clone", "--quiet", input.baseCwd, targetDir]);
    if (branchName) {
      await runGit(["checkout", "-b", branchName], targetDir);
    } else if (targetRef !== "HEAD") {
      await runGit(["checkout", "--detach", targetRef], targetDir);
    }
    return { cwd: targetDir, warnings, branchName };
  }

  if (branchName) {
    const existingWorktree = (await listGitWorktrees(input.baseCwd))
      .find((entry) => entry.branchName === branchName);
    if (existingWorktree && existingWorktree.path !== targetDir) {
      const existingWorktreeAvailable = await pathIsDirectory(existingWorktree.path);
      const existingWorktreeValid = existingWorktreeAvailable && await isGitWorkTree(existingWorktree.path);
      if (existingWorktreeValid) {
        warnings.push(
          `Branch "${branchName}" is already attached to existing worktree "${existingWorktree.path}". Reusing that isolated workspace.`,
        );
        return { cwd: existingWorktree.path, warnings, branchName };
      }
      await runGit(["worktree", "prune"], input.baseCwd).catch(() => undefined);
      warnings.push(
        `Pruned stale git worktree metadata for branch "${branchName}" before recreating the isolated workspace.`,
      );
    }

    const branchExists = await runGit(["rev-parse", "--verify", `refs/heads/${branchName}`], input.baseCwd)
      .then(() => true)
      .catch(() => false);
    try {
      if (branchExists) {
        await runGit(["worktree", "add", targetDir, branchName], input.baseCwd);
      } else {
        await runGit(["worktree", "add", "-b", branchName, targetDir, targetRef], input.baseCwd);
      }
    } catch (err) {
      await runGit(["worktree", "prune"], input.baseCwd).catch(() => undefined);
      const recoveredWorktree = (await listGitWorktrees(input.baseCwd))
        .find((entry) => entry.branchName === branchName);
      if (recoveredWorktree && await pathIsDirectory(recoveredWorktree.path) && await isGitWorkTree(recoveredWorktree.path)) {
        warnings.push(
          `Recovered existing worktree "${recoveredWorktree.path}" for branch "${branchName}" after retrying stale worktree metadata cleanup.`,
        );
        return { cwd: recoveredWorktree.path, warnings, branchName };
      }
      throw err;
    }
  } else {
    await runGit(["worktree", "add", "--detach", targetDir, targetRef], input.baseCwd);
  }

  return { cwd: targetDir, warnings, branchName };
}

export async function resolveProjectWorkspaceByPolicy(input: {
  agentId: string;
  issueId: string | null;
  projectId: string | null;
  taskKey: string | null;
  context: Record<string, unknown>;
  workspaces: ProjectWorkspaceRoutingRow[];
}): Promise<ResolvedProjectWorkspace | null> {
  const workspaceUsage = deriveProjectWorkspaceUsageFromContext(input.context);
  const candidates = input.workspaces
    .map((workspace) => {
      const cwd = readNonEmptyString(workspace.cwd);
      const validCwd = cwd && !REPO_ONLY_CWD_SENTINELS.has(cwd) ? cwd : null;
      const executionPolicy = readProjectWorkspaceExecutionPolicyFromMetadata(workspace.metadata);
      return {
        workspace,
        cwd: validCwd,
        executionPolicy,
        score: classifyUsageScore({
          usage: workspaceUsage,
          policy: executionPolicy,
          isPrimary: workspace.isPrimary,
          hasCwd: Boolean(validCwd),
        }),
      };
    })
    .filter((candidate) => Number.isFinite(candidate.score))
    .sort((left, right) => right.score - left.score);

  const warnings: string[] = [];
  for (const candidate of candidates) {
    if (!candidate.cwd) continue;
    const cwdExists = await pathIsDirectory(candidate.cwd);
    if (!cwdExists) {
      warnings.push(`Configured workspace path "${candidate.cwd}" is not available.`);
      continue;
    }

    if (candidate.executionPolicy?.mode === "isolated" && workspaceUsage === "implementation") {
      const isolated = await ensureIsolatedWorkspace({
        baseCwd: candidate.cwd,
        workspace: candidate.workspace,
        policy: candidate.executionPolicy,
        agentId: input.agentId,
        issueId: input.issueId,
        projectId: input.projectId,
        taskKey: input.taskKey,
        repoRef: readNonEmptyString(candidate.workspace.repoRef),
      });
      if (isolated) {
        return {
          cwd: isolated.cwd,
          source: "project_isolated",
          workspaceId: candidate.workspace.id,
          repoUrl: candidate.workspace.repoUrl,
          repoRef: candidate.workspace.repoRef,
          executionPolicy: candidate.executionPolicy,
          workspaceUsage,
          warnings: [...warnings, ...isolated.warnings],
          branchName: isolated.branchName,
        };
      }
      continue;
    }

    return {
      cwd: candidate.cwd,
      source: "project_shared",
      workspaceId: candidate.workspace.id,
      repoUrl: candidate.workspace.repoUrl,
      repoRef: candidate.workspace.repoRef,
      executionPolicy: candidate.executionPolicy,
      workspaceUsage,
      warnings,
      branchName: null,
    };
  }

  return null;
}
