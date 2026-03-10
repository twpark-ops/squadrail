import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

type GitExecutor = (input: {
  cwd: string;
  args: string[];
}) => Promise<{ stdout: string; stderr?: string }>;

export type WorkspaceGitSnapshot = {
  branchName: string | null;
  expectedBranchName: string | null;
  branchMismatch: boolean;
  headSha: string | null;
  hasChanges: boolean;
  changedFiles: string[];
  statusEntries: string[];
  diffStat: string | null;
  capturedAt: string;
};

export type WorkspaceVersionContext = {
  branchName: string | null;
  defaultBranchName: string | null;
  headSha: string | null;
  parentCommitSha: string | null;
  isDefaultBranch: boolean;
  capturedAt: string;
};

let gitExecutorOverride: GitExecutor | null = null;

async function runGit(args: string[], cwd: string) {
  if (gitExecutorOverride) {
    return gitExecutorOverride({ cwd, args });
  }
  return execFile("git", ["-C", cwd, ...args], {
    timeout: 15_000,
    maxBuffer: 1_024 * 1_024,
  });
}

function readFirstLine(value: string | null | undefined) {
  if (!value) return null;
  const first = value.split(/\r?\n/u)[0]?.trim();
  return first ? first : null;
}

function readLines(value: string | null | undefined, limit = 64) {
  if (!value) return [];
  return value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, limit);
}

function parseChangedPathFromStatusLine(line: string) {
  const match = line.match(/^(?:[A-Z?]{1,2})\s+(.*)$/u);
  const rawPath = match?.[1]?.trim();
  if (!rawPath) return null;
  const renamed = rawPath.split(" -> ");
  return renamed[renamed.length - 1]?.trim() || null;
}

function parseDefaultBranchFromRemoteHead(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/refs\/remotes\/[^/]+\/(.+)$/u);
  return match?.[1]?.trim() || null;
}

async function isGitWorkTree(cwd: string) {
  try {
    const { stdout } = await runGit(["rev-parse", "--is-inside-work-tree"], cwd);
    return stdout.trim() === "true";
  } catch {
    return false;
  }
}

export function setWorkspaceGitExecutorForTests(executor: GitExecutor | null) {
  gitExecutorOverride = executor;
}

export async function inspectWorkspaceGitSnapshot(input: {
  cwd: string | null;
  branchName?: string | null;
}): Promise<WorkspaceGitSnapshot | null> {
  if (!input.cwd) return null;
  if (!(await isGitWorkTree(input.cwd))) return null;

  const [headResult, branchResult, statusResult, diffStatResult] = await Promise.all([
    runGit(["rev-parse", "HEAD"], input.cwd).catch(() => ({ stdout: "" })),
    runGit(["branch", "--show-current"], input.cwd).catch(() => ({ stdout: "" })),
    runGit(["status", "--short", "--branch"], input.cwd).catch(() => ({ stdout: "" })),
    runGit(["diff", "--shortstat", "--no-ext-diff", "HEAD"], input.cwd).catch(() => ({ stdout: "" })),
  ]);

  const statusLines = readLines(statusResult.stdout);
  const statusEntries = statusLines.filter((line) => !line.startsWith("## "));
  const changedFiles = Array.from(new Set(
    statusEntries
      .map((line) => parseChangedPathFromStatusLine(line))
      .filter((value): value is string => Boolean(value)),
  ));
  const actualBranchName = readFirstLine(branchResult.stdout);
  const expectedBranchName = input.branchName ?? null;

  return {
    branchName: actualBranchName ?? expectedBranchName,
    expectedBranchName,
    branchMismatch: Boolean(actualBranchName && expectedBranchName && actualBranchName !== expectedBranchName),
    headSha: readFirstLine(headResult.stdout),
    hasChanges: statusEntries.length > 0,
    changedFiles,
    statusEntries,
    diffStat: readFirstLine(diffStatResult.stdout),
    capturedAt: new Date().toISOString(),
  };
}

export async function inspectWorkspaceVersionContext(input: {
  cwd: string | null;
}): Promise<WorkspaceVersionContext | null> {
  if (!input.cwd) return null;
  if (!(await isGitWorkTree(input.cwd))) return null;

  const [branchResult, headResult, parentResult, remoteHeadResult] = await Promise.all([
    runGit(["branch", "--show-current"], input.cwd).catch(() => ({ stdout: "" })),
    runGit(["rev-parse", "HEAD"], input.cwd).catch(() => ({ stdout: "" })),
    runGit(["rev-parse", "HEAD^"], input.cwd).catch(() => ({ stdout: "" })),
    runGit(["symbolic-ref", "refs/remotes/origin/HEAD"], input.cwd).catch(() => ({ stdout: "" })),
  ]);

  const branchName = readFirstLine(branchResult.stdout);
  const defaultBranchName = parseDefaultBranchFromRemoteHead(remoteHeadResult.stdout) ?? branchName;

  return {
    branchName,
    defaultBranchName,
    headSha: readFirstLine(headResult.stdout),
    parentCommitSha: readFirstLine(parentResult.stdout),
    isDefaultBranch: Boolean(branchName && defaultBranchName && branchName === defaultBranchName),
    capturedAt: new Date().toISOString(),
  };
}
