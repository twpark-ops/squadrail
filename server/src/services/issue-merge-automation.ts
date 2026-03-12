import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { syncMergePrBridge } from "./merge-pr-bridge.js";

const execFile = promisify(execFileCallback);

type GitExecutor = (input: {
  cwd?: string;
  args: string[];
}) => Promise<{ stdout: string; stderr?: string }>;

let gitExecutorOverride: GitExecutor | null = null;

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function slug(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized.length > 0 ? normalized : "merge";
}

function readFirstLine(value: string | null | undefined) {
  if (!value) return null;
  const first = value.split(/\r?\n/u)[0]?.trim();
  return first ? first : null;
}

async function runGit(args: string[], cwd?: string) {
  if (gitExecutorOverride) {
    return gitExecutorOverride({ cwd, args });
  }
  return execFile("git", cwd ? ["-C", cwd, ...args] : args, {
    timeout: 60_000,
    maxBuffer: 4 * 1024 * 1024,
  });
}

async function pathExists(targetPath: string | null | undefined) {
  if (!targetPath) return false;
  return fs.access(targetPath).then(() => true).catch(() => false);
}

async function isGitWorkTree(targetPath: string | null | undefined) {
  if (!targetPath) return false;
  try {
    const { stdout } = await runGit(["rev-parse", "--is-inside-work-tree"], targetPath);
    return stdout.trim() === "true";
  } catch {
    return false;
  }
}

async function readHeadSha(targetPath: string | null | undefined) {
  if (!targetPath) return null;
  try {
    const { stdout } = await runGit(["rev-parse", "HEAD"], targetPath);
    return readFirstLine(stdout);
  } catch {
    return null;
  }
}

async function readCurrentBranch(targetPath: string | null | undefined) {
  if (!targetPath) return null;
  try {
    const { stdout } = await runGit(["branch", "--show-current"], targetPath);
    return readFirstLine(stdout);
  } catch {
    return null;
  }
}

async function hasLocalChanges(targetPath: string | null | undefined) {
  if (!targetPath) return false;
  try {
    const { stdout } = await runGit(["status", "--porcelain"], targetPath);
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

async function refExists(targetPath: string | null | undefined, ref: string | null | undefined) {
  if (!targetPath || !ref) return false;
  try {
    await runGit(["rev-parse", "--verify", `${ref}^{commit}`], targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readRemoteUrl(targetPath: string | null | undefined, remoteName: string) {
  if (!targetPath) return null;
  try {
    const { stdout } = await runGit(["remote", "get-url", remoteName], targetPath);
    return readFirstLine(stdout);
  } catch {
    return null;
  }
}

async function ensureDir(targetPath: string) {
  await fs.mkdir(targetPath, { recursive: true });
}

async function removeAutomationWorktree(baseCwd: string, targetDir: string) {
  await runGit(["worktree", "remove", "--force", targetDir], baseCwd).catch(() => undefined);
  await fs.rm(targetDir, { recursive: true, force: true }).catch(() => undefined);
  await runGit(["worktree", "prune"], baseCwd).catch(() => undefined);
}

export function setIssueMergeAutomationGitExecutorForTests(executor: GitExecutor | null) {
  gitExecutorOverride = executor;
}

export type MergeAutomationIssueLike = {
  id: string;
  identifier: string | null;
  title: string;
  projectId: string | null;
};

export type MergeAutomationProjectLike = {
  id: string;
  name: string;
  primaryWorkspace: {
    id: string;
    name: string;
    cwd: string | null;
    repoRef: string | null;
  } | null;
} | null;

export type MergeAutomationCandidateLike = {
  issueId: string;
  identifier: string | null;
  state: "pending" | "merged" | "rejected";
  sourceBranch: string | null;
  headSha: string | null;
  workspacePath: string | null;
  targetBaseBranch: string | null;
  closeSummary: string | null;
  verificationSummary: string | null;
  approvalSummary: string | null;
  remainingRisks: string[];
  automationMetadata: Record<string, unknown> | null;
  closeMessageId: string | null;
};

export type MergeAutomationPlan = {
  issueId: string;
  identifier: string | null;
  title: string;
  candidateState: "pending" | "merged" | "rejected";
  projectId: string | null;
  projectName: string | null;
  sourceBranch: string | null;
  sourceHeadSha: string | null;
  sourceWorkspacePath: string | null;
  sourceHeadCurrent: string | null;
  sourceHasLocalChanges: boolean;
  sourceComparisonRef: string | null;
  baseWorkspaceId: string | null;
  baseWorkspaceName: string | null;
  baseWorkspacePath: string | null;
  targetBaseBranch: string | null;
  targetStartRef: string | null;
  integrationBranchName: string | null;
  automationWorktreePath: string | null;
  remoteName: string | null;
  remoteUrl: string | null;
  checks: {
    hasPendingCandidate: boolean;
    hasProject: boolean;
    hasBaseWorkspace: boolean;
    baseWorkspaceIsGit: boolean;
    hasSourceWorkspace: boolean;
    sourceWorkspaceIsGit: boolean;
    hasSourceBranch: boolean;
    sourceHeadMatches: boolean;
    hasSourceComparisonRef: boolean;
    hasTargetBaseBranch: boolean;
    hasRemote: boolean;
  };
  warnings: string[];
  canAutomate: boolean;
  automationMetadata: Record<string, unknown> | null;
};

export type MergeAutomationActionInput = {
  actionType:
    | "prepare_merge"
    | "export_patch"
    | "export_pr_bundle"
    | "merge_local"
    | "cherry_pick_local"
    | "push_branch"
    | "sync_pr_bridge";
  plan: MergeAutomationPlan;
  candidate: MergeAutomationCandidateLike;
  targetBaseBranch?: string | null;
  integrationBranchName?: string | null;
  remoteName?: string | null;
  branchName?: string | null;
  pushAfterAction?: boolean;
};

export type MergeAutomationActionResult = {
  actionType: MergeAutomationActionInput["actionType"];
  ok: boolean;
  plan: MergeAutomationPlan;
  patchPath?: string | null;
  prBundlePath?: string | null;
  prPayloadPath?: string | null;
  targetBranch?: string | null;
  remoteName?: string | null;
  remoteUrl?: string | null;
  pushed?: boolean;
  pushedBranch?: string | null;
  automationWorktreePath?: string | null;
  mergeCommitSha?: string | null;
  cherryPickedCommitShas?: string[];
  externalProvider?: "github" | "gitlab" | null;
  externalNumber?: number | null;
  externalUrl?: string | null;
  automationMetadataPatch?: Record<string, unknown>;
};

async function resolveTargetStartRef(baseWorkspacePath: string, targetBaseBranch: string, remoteName: string | null) {
  if (await refExists(baseWorkspacePath, `refs/heads/${targetBaseBranch}`)) {
    return targetBaseBranch;
  }
  if (remoteName && await refExists(baseWorkspacePath, `refs/remotes/${remoteName}/${targetBaseBranch}`)) {
    return `${remoteName}/${targetBaseBranch}`;
  }
  if (await refExists(baseWorkspacePath, targetBaseBranch)) {
    return targetBaseBranch;
  }
  return null;
}

async function resolveComparisonRef(targetPath: string, targetBaseBranch: string, remoteName: string | null) {
  if (await refExists(targetPath, `refs/heads/${targetBaseBranch}`)) {
    return targetBaseBranch;
  }
  if (remoteName && await refExists(targetPath, `refs/remotes/${remoteName}/${targetBaseBranch}`)) {
    return `${remoteName}/${targetBaseBranch}`;
  }
  if (await refExists(targetPath, targetBaseBranch)) {
    return targetBaseBranch;
  }
  return null;
}

function defaultIntegrationBranchName(input: {
  identifier: string | null;
  issueId: string;
  mode: "merge" | "cherry-pick";
}) {
  const key = slug(input.identifier ?? input.issueId).slice(0, 40);
  return `squadrail/${input.mode}/${key}`;
}

function defaultAutomationWorktreePath(baseWorkspacePath: string, integrationBranchName: string) {
  return path.join(
    path.dirname(baseWorkspacePath),
    ".squadrail-merge-worktrees",
    path.basename(baseWorkspacePath),
    slug(integrationBranchName).slice(0, 72),
  );
}

function buildExportRoot(issue: MergeAutomationIssueLike) {
  return path.join(
    os.homedir(),
    ".squadrail",
    "merge-candidates",
    slug(issue.identifier ?? issue.id).slice(0, 72),
  );
}

export async function buildMergeAutomationPlan(input: {
  issue: MergeAutomationIssueLike;
  project: MergeAutomationProjectLike;
  candidate: MergeAutomationCandidateLike;
  targetBaseBranch?: string | null;
  integrationBranchName?: string | null;
  remoteName?: string | null;
}) {
  const warnings: string[] = [];
  const remoteName = readString(input.remoteName) ?? "origin";
  const baseWorkspace = input.project?.primaryWorkspace ?? null;
  const baseWorkspacePath = readString(baseWorkspace?.cwd);
  const sourceWorkspacePath = readString(input.candidate.workspacePath);
  const sourceBranch = readString(input.candidate.sourceBranch);
  const sourceHeadSha = readString(input.candidate.headSha);
  const baseWorkspaceExists = await pathExists(baseWorkspacePath);
  const sourceWorkspaceExists = await pathExists(sourceWorkspacePath);
  const baseWorkspaceIsGit = await isGitWorkTree(baseWorkspacePath);
  const sourceWorkspaceIsGit = await isGitWorkTree(sourceWorkspacePath);
  const sourceHeadCurrent = await readHeadSha(sourceWorkspacePath);
  const sourceHasLocalChanges = await hasLocalChanges(sourceWorkspacePath);
  const sourceHeadMatches = sourceHeadSha ? sourceHeadCurrent === sourceHeadSha : sourceHeadCurrent != null;
  const hasSourceBranch = sourceWorkspaceIsGit && sourceBranch
    ? await refExists(sourceWorkspacePath, `refs/heads/${sourceBranch}`)
      || await refExists(sourceWorkspacePath, sourceBranch)
    : false;

  const inferredBaseBranch =
    readString(input.targetBaseBranch)
    ?? readString(input.candidate.targetBaseBranch)
    ?? readString(baseWorkspace?.repoRef)
    ?? await readCurrentBranch(baseWorkspacePath)
    ?? "main";

  const targetStartRef = baseWorkspaceIsGit
    ? await resolveTargetStartRef(baseWorkspacePath!, inferredBaseBranch, remoteName)
    : null;
  const sourceComparisonRef = sourceWorkspaceIsGit
    ? await resolveComparisonRef(sourceWorkspacePath!, inferredBaseBranch, remoteName)
    : null;
  const remoteUrl = baseWorkspaceIsGit ? await readRemoteUrl(baseWorkspacePath, remoteName) : null;
  const integrationBranchName = readString(input.integrationBranchName)
    ?? readString(asRecord(input.candidate.automationMetadata).lastPreparedBranch)
    ?? defaultIntegrationBranchName({
      identifier: input.issue.identifier,
      issueId: input.issue.id,
      mode: "merge",
    });
  const automationWorktreePath = baseWorkspacePath && integrationBranchName
    ? defaultAutomationWorktreePath(baseWorkspacePath, integrationBranchName)
    : null;

  if (input.candidate.state !== "pending") warnings.push("Merge candidate is not pending anymore.");
  if (!input.issue.projectId) warnings.push("Issue is not linked to a project.");
  if (!baseWorkspacePath) warnings.push("Project primary workspace has no cwd.");
  if (baseWorkspacePath && !baseWorkspaceExists) warnings.push(`Base workspace path is missing: ${baseWorkspacePath}`);
  if (baseWorkspaceExists && !baseWorkspaceIsGit) warnings.push(`Base workspace is not a git repository: ${baseWorkspacePath}`);
  if (!sourceWorkspacePath) warnings.push("Merge candidate has no source workspace path.");
  if (sourceWorkspacePath && !sourceWorkspaceExists) warnings.push(`Source workspace path is missing: ${sourceWorkspacePath}`);
  if (sourceWorkspaceExists && !sourceWorkspaceIsGit) warnings.push(`Source workspace is not a git repository: ${sourceWorkspacePath}`);
  if (!sourceBranch) warnings.push("Merge candidate has no source branch.");
  if (sourceBranch && !hasSourceBranch) warnings.push(`Source branch is missing in source workspace: ${sourceBranch}`);
  if (!sourceHeadMatches) warnings.push("Source workspace HEAD no longer matches the recorded merge candidate head.");
  if (!sourceComparisonRef) warnings.push(`Source workspace cannot resolve target comparison ref: ${inferredBaseBranch}`);
  if (!targetStartRef) warnings.push(`Target base branch could not be resolved: ${inferredBaseBranch}`);
  if (!remoteUrl) warnings.push(`Remote "${remoteName}" is not configured on the base workspace.`);

  const checks = {
    hasPendingCandidate: input.candidate.state === "pending",
    hasProject: Boolean(input.issue.projectId && input.project),
    hasBaseWorkspace: Boolean(baseWorkspacePath && baseWorkspaceExists),
    baseWorkspaceIsGit,
    hasSourceWorkspace: Boolean(sourceWorkspacePath && sourceWorkspaceExists),
    sourceWorkspaceIsGit,
    hasSourceBranch,
    sourceHeadMatches,
    hasSourceComparisonRef: Boolean(sourceComparisonRef),
    hasTargetBaseBranch: Boolean(targetStartRef),
    hasRemote: Boolean(remoteUrl),
  } as const;

  return {
    issueId: input.issue.id,
    identifier: input.issue.identifier,
    title: input.issue.title,
    candidateState: input.candidate.state,
    projectId: input.issue.projectId,
    projectName: input.project?.name ?? null,
    sourceBranch,
    sourceHeadSha,
    sourceWorkspacePath,
    sourceHeadCurrent,
    sourceHasLocalChanges,
    sourceComparisonRef,
    baseWorkspaceId: baseWorkspace?.id ?? null,
    baseWorkspaceName: baseWorkspace?.name ?? null,
    baseWorkspacePath,
    targetBaseBranch: inferredBaseBranch,
    targetStartRef,
    integrationBranchName,
    automationWorktreePath,
    remoteName,
    remoteUrl,
    checks,
    warnings,
    canAutomate:
      checks.hasPendingCandidate
      && checks.hasProject
      && checks.hasBaseWorkspace
      && checks.baseWorkspaceIsGit
      && checks.hasSourceWorkspace
      && checks.sourceWorkspaceIsGit
      && checks.hasSourceBranch
      && checks.sourceHeadMatches
      && checks.hasSourceComparisonRef
      && checks.hasTargetBaseBranch,
    automationMetadata: input.candidate.automationMetadata ?? null,
  } satisfies MergeAutomationPlan;
}

async function buildWorkspaceDiffPatch(input: {
  plan: MergeAutomationPlan;
}) {
  if (!input.plan.sourceWorkspacePath || !input.plan.sourceComparisonRef) {
    throw new Error("Merge automation plan is incomplete");
  }
  const { stdout } = await runGit(
    ["diff", "--binary", input.plan.sourceComparisonRef],
    input.plan.sourceWorkspacePath,
  );
  return stdout;
}

async function prepareAutomationWorktree(input: {
  plan: MergeAutomationPlan;
  branchName: string;
}) {
  if (!input.plan.baseWorkspacePath || !input.plan.automationWorktreePath || !input.plan.targetStartRef) {
    throw new Error("Merge automation plan is incomplete");
  }

  await ensureDir(path.dirname(input.plan.automationWorktreePath));
  await removeAutomationWorktree(input.plan.baseWorkspacePath, input.plan.automationWorktreePath);
  await runGit(
    [
      "worktree",
      "add",
      "-B",
      input.branchName,
      input.plan.automationWorktreePath,
      input.plan.targetStartRef,
    ],
    input.plan.baseWorkspacePath,
  );
  return input.plan.automationWorktreePath;
}

async function readRevList(targetPath: string, fromRef: string, toRef: string) {
  const { stdout } = await runGit(["rev-list", "--reverse", `${fromRef}..${toRef}`], targetPath);
  return stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
}

function buildPrBundleMarkdown(input: {
  issue: MergeAutomationIssueLike;
  candidate: MergeAutomationCandidateLike;
  plan: MergeAutomationPlan;
  branchName: string;
}) {
  const risks = input.candidate.remainingRisks.length > 0
    ? input.candidate.remainingRisks.map((risk) => `- ${risk}`).join("\n")
    : "- None recorded";
  return [
    `# ${input.issue.identifier ?? input.issue.id}: ${input.issue.title}`,
    "",
    `- Source branch: \`${input.plan.sourceBranch ?? "unknown"}\``,
    `- Target base branch: \`${input.plan.targetBaseBranch ?? "unknown"}\``,
    `- Prepared branch: \`${input.branchName}\``,
    `- Source head: \`${input.plan.sourceHeadSha ?? "unknown"}\``,
    `- Base workspace: \`${input.plan.baseWorkspacePath ?? "unknown"}\``,
    "",
    "## Approval Summary",
    "",
    input.candidate.approvalSummary ?? "No approval summary recorded.",
    "",
    "## Close Summary",
    "",
    input.candidate.closeSummary ?? "No close summary recorded.",
    "",
    "## Verification Summary",
    "",
    input.candidate.verificationSummary ?? "No verification summary recorded.",
    "",
    "## Remaining Risks",
    "",
    risks,
    "",
  ].join("\n");
}

function resolveBranchForAutomation(input: {
  plan: MergeAutomationPlan;
  branchName?: string | null;
  integrationBranchName?: string | null;
}) {
  return readString(input.integrationBranchName)
    ?? readString(input.branchName)
    ?? readString(asRecord(input.plan.automationMetadata).lastPushedBranch)
    ?? readString(asRecord(input.plan.automationMetadata).lastPreparedBranch)
    ?? input.plan.sourceBranch;
}

function resolveHeadShaForBranch(input: {
  plan: MergeAutomationPlan;
  branchName: string;
}) {
  const metadata = asRecord(input.plan.automationMetadata);
  const lastPreparedBranch = readString(metadata.lastPreparedBranch);
  const lastPreparedHeadSha = readString(metadata.lastPreparedHeadSha);
  if (lastPreparedBranch && input.branchName === lastPreparedBranch && lastPreparedHeadSha) {
    return lastPreparedHeadSha;
  }
  if (input.branchName === input.plan.sourceBranch) {
    return input.plan.sourceHeadSha;
  }
  return lastPreparedHeadSha ?? input.plan.sourceHeadSha;
}

async function pushRequestedBranch(input: {
  plan: MergeAutomationPlan;
  requestedBranch: string;
  remoteName?: string | null;
}) {
  if (input.requestedBranch === input.plan.sourceBranch && input.plan.sourceHasLocalChanges) {
    throw new Error("Cannot push the source branch while the source workspace still has local changes");
  }

  const pushCwd = input.requestedBranch === input.plan.sourceBranch
    ? input.plan.sourceWorkspacePath
    : input.plan.baseWorkspacePath;
  if (!pushCwd) {
    throw new Error("No workspace is available to push the requested branch");
  }

  const resolvedRemoteName = input.remoteName ?? input.plan.remoteName ?? "origin";
  await runGit(["push", resolvedRemoteName, input.requestedBranch], pushCwd);
  return {
    remoteName: resolvedRemoteName,
    pushCwd,
  };
}

export async function runMergeAutomationAction(input: MergeAutomationActionInput): Promise<MergeAutomationActionResult> {
  const plan = input.plan;
  if (input.actionType === "prepare_merge") {
    return {
      actionType: input.actionType,
      ok: plan.canAutomate,
      plan,
      automationMetadataPatch: {
        lastPlanGeneratedAt: new Date().toISOString(),
        lastPlanWarnings: plan.warnings,
        lastPlanChecks: plan.checks,
        lastPreparedBranch: plan.integrationBranchName,
        lastPreparedWorktreePath: plan.automationWorktreePath,
        lastPlanRemoteName: plan.remoteName,
        lastPlanRemoteUrl: plan.remoteUrl,
      },
    };
  }

  const issueKey = slug(plan.identifier ?? plan.issueId).slice(0, 72);
  const exportRoot = buildExportRoot({
    id: plan.issueId,
    identifier: plan.identifier,
    title: plan.title,
    projectId: plan.projectId,
  });
  await ensureDir(exportRoot);

  if (input.actionType === "sync_pr_bridge") {
    if (!plan.remoteUrl) {
      throw new Error("PR bridge requires a configured git remote on the base workspace");
    }
    const branchName = resolveBranchForAutomation({
      plan,
      branchName: input.branchName,
      integrationBranchName: input.integrationBranchName,
    });
    if (!branchName) {
      throw new Error("PR bridge requires a source or prepared branch");
    }

    let pushedBranch: string | null = null;
    let pushedRemoteName: string | null = null;
    if (input.pushAfterAction === true) {
      const pushResult = await pushRequestedBranch({
        plan,
        requestedBranch: branchName,
        remoteName: input.remoteName,
      });
      pushedBranch = branchName;
      pushedRemoteName = pushResult.remoteName;
    }

    const markdown = buildPrBundleMarkdown({
      issue: {
        id: plan.issueId,
        identifier: plan.identifier,
        title: plan.title,
        projectId: plan.projectId,
      },
      candidate: input.candidate,
      plan,
      branchName,
    });
    const existingBridge = asRecord(asRecord(plan.automationMetadata).prBridge);
    const prBridge = await syncMergePrBridge({
      remoteUrl: plan.remoteUrl,
      baseBranch: input.targetBaseBranch ?? plan.targetBaseBranch ?? "main",
      headBranch: branchName,
      headSha: resolveHeadShaForBranch({ plan, branchName }),
      title: `${plan.identifier ?? plan.issueId}: ${plan.title}`,
      body: markdown,
      existing: {
        number: readNumber(existingBridge.number),
        externalId: readString(existingBridge.externalId),
      },
    });

    return {
      actionType: input.actionType,
      ok: true,
      plan,
      targetBranch: branchName,
      remoteName: pushedRemoteName ?? input.remoteName ?? plan.remoteName,
      remoteUrl: plan.remoteUrl,
      pushed: input.pushAfterAction === true,
      pushedBranch,
      externalProvider: prBridge.provider,
      externalNumber: prBridge.number,
      externalUrl: prBridge.url,
      automationMetadataPatch: {
        lastAutomationAction: "sync_pr_bridge",
        lastAutomationAt: new Date().toISOString(),
        lastPushRemote: pushedRemoteName ?? undefined,
        lastPushedBranch: pushedBranch ?? undefined,
        prBridge: {
          ...prBridge,
          lastSyncedAt: prBridge.lastSyncedAt?.toISOString() ?? new Date().toISOString(),
        },
      },
    };
  }

  if (!plan.canAutomate || !plan.baseWorkspacePath || !plan.sourceWorkspacePath || !plan.sourceBranch || !plan.targetStartRef) {
    throw new Error(`Merge automation preflight failed: ${plan.warnings.join(" | ") || "unknown reason"}`);
  }

  if (input.actionType === "export_patch") {
    const patchPath = path.join(exportRoot, `${issueKey}.patch`);
    const stdout = await buildWorkspaceDiffPatch({ plan });
    await fs.writeFile(patchPath, stdout, "utf8");
    return {
      actionType: input.actionType,
      ok: true,
      plan,
      patchPath,
      automationMetadataPatch: {
        lastAutomationAction: "export_patch",
        lastPatchPath: patchPath,
        lastPreparedBranch: plan.integrationBranchName,
        lastPreparedWorktreePath: plan.automationWorktreePath,
        lastPlanRemoteUrl: plan.remoteUrl,
        lastAutomationAt: new Date().toISOString(),
      },
    };
  }

  if (input.actionType === "export_pr_bundle") {
    const branchName = readString(input.branchName)
      ?? readString(asRecord(plan.automationMetadata).lastPreparedBranch)
      ?? plan.integrationBranchName
      ?? defaultIntegrationBranchName({
        identifier: plan.identifier,
        issueId: plan.issueId,
        mode: "merge",
      });
    const bundlePath = path.join(exportRoot, `${issueKey}.pr.md`);
    const payloadPath = path.join(exportRoot, `${issueKey}.pr.json`);
    const markdown = buildPrBundleMarkdown({
      issue: {
        id: plan.issueId,
        identifier: plan.identifier,
        title: plan.title,
        projectId: plan.projectId,
      },
      candidate: input.candidate,
      plan,
      branchName,
    });
    const payload = {
      issueId: plan.issueId,
      identifier: plan.identifier,
      title: plan.title,
      sourceBranch: plan.sourceBranch,
      targetBaseBranch: plan.targetBaseBranch,
      preparedBranch: branchName,
      sourceHeadSha: plan.sourceHeadSha,
      approvalSummary: input.candidate.approvalSummary,
      closeSummary: input.candidate.closeSummary,
      verificationSummary: input.candidate.verificationSummary,
      remainingRisks: input.candidate.remainingRisks,
    };
    await fs.writeFile(bundlePath, `${markdown}\n`, "utf8");
    await fs.writeFile(payloadPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    return {
      actionType: input.actionType,
      ok: true,
      plan,
      prBundlePath: bundlePath,
      prPayloadPath: payloadPath,
      automationMetadataPatch: {
        lastAutomationAction: "export_pr_bundle",
        lastPrBundlePath: bundlePath,
        lastPrPayloadPath: payloadPath,
        lastPlanRemoteUrl: plan.remoteUrl,
        lastAutomationAt: new Date().toISOString(),
      },
    };
  }

  if (input.actionType === "merge_local" || input.actionType === "cherry_pick_local") {
    const branchName = readString(input.integrationBranchName)
      ?? readString(input.branchName)
      ?? plan.integrationBranchName
      ?? defaultIntegrationBranchName({
        identifier: plan.identifier,
        issueId: plan.issueId,
        mode: input.actionType === "merge_local" ? "merge" : "cherry-pick",
      });
    const worktreePath = await prepareAutomationWorktree({ plan, branchName });

    if (input.actionType === "merge_local") {
      const patchBody = await buildWorkspaceDiffPatch({ plan });
      if (patchBody.trim().length === 0) {
        throw new Error("Merge candidate patch is empty");
      }
      const patchPath = path.join(exportRoot, `${issueKey}.merge.patch`);
      await fs.writeFile(patchPath, patchBody, "utf8");
      await runGit(["apply", "--index", patchPath], worktreePath);
      await runGit(
        ["commit", "-m", `chore(merge): apply ${plan.identifier ?? plan.issueId} merge candidate`],
        worktreePath,
      );
    } else {
      if (plan.sourceHasLocalChanges) {
        throw new Error("Cherry-pick automation requires a clean source workspace without local changes");
      }
      const fetchedRef = `refs/squadrail/merge-candidates/${issueKey}/source`;
      await runGit(
        [
          "fetch",
          "--no-tags",
          "--force",
          plan.sourceWorkspacePath,
          `${plan.sourceBranch}:${fetchedRef}`,
        ],
        plan.baseWorkspacePath,
      );
      const commits = await readRevList(worktreePath, plan.targetStartRef, fetchedRef);
      if (commits.length === 0) {
        throw new Error("No commits are available to cherry-pick from the merge candidate");
      }
      await runGit(["cherry-pick", ...commits], worktreePath);
    }

    if (input.pushAfterAction) {
      await runGit(["push", plan.remoteName ?? "origin", branchName], worktreePath);
    }

    const mergeCommitSha = await readHeadSha(worktreePath);
    const cherryPickedCommitShas = input.actionType === "cherry_pick_local"
      ? await readRevList(worktreePath, plan.targetStartRef, "HEAD")
      : [];

    return {
      actionType: input.actionType,
      ok: true,
      plan,
      targetBranch: branchName,
      remoteName: plan.remoteName,
      remoteUrl: plan.remoteUrl,
      pushed: input.pushAfterAction === true,
      pushedBranch: input.pushAfterAction === true ? branchName : null,
      automationWorktreePath: worktreePath,
      mergeCommitSha,
      cherryPickedCommitShas,
      automationMetadataPatch: {
        lastAutomationAction: input.actionType,
        lastPreparedBranch: branchName,
        lastPreparedWorktreePath: worktreePath,
        lastPreparedHeadSha: mergeCommitSha,
        lastPreparedTargetBaseBranch: plan.targetBaseBranch,
        lastPreparedTargetStartRef: plan.targetStartRef,
        lastPreparedFromComparisonRef: plan.sourceComparisonRef,
        lastPreparedFromWorkingTree: plan.sourceHasLocalChanges,
        lastAutomationAt: new Date().toISOString(),
        lastPushRemote: input.pushAfterAction ? plan.remoteName : null,
        lastPushedBranch: input.pushAfterAction ? branchName : null,
        lastPlanRemoteUrl: plan.remoteUrl,
      },
    };
  }

  const requestedBranch = resolveBranchForAutomation({
    plan,
    branchName: input.branchName,
    integrationBranchName: input.integrationBranchName,
  });
  if (!requestedBranch) {
    throw new Error("No branch is available to push");
  }

  const pushResult = await pushRequestedBranch({
    plan,
    requestedBranch,
    remoteName: input.remoteName,
  });
  return {
    actionType: input.actionType,
    ok: true,
    plan,
    targetBranch: requestedBranch,
    remoteName: pushResult.remoteName,
    remoteUrl: plan.remoteUrl,
    pushed: true,
    pushedBranch: requestedBranch,
    automationMetadataPatch: {
      lastAutomationAction: "push_branch",
      lastPushRemote: pushResult.remoteName,
      lastPushedBranch: requestedBranch,
      lastPlanRemoteUrl: plan.remoteUrl,
      lastAutomationAt: new Date().toISOString(),
    },
  };
}
