import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildMergeAutomationPlan,
  runMergeAutomationAction,
} from "../services/issue-merge-automation.js";

const execFile = promisify(execFileCallback);

async function run(cmd: string, args: string[], cwd?: string) {
  return execFile(cmd, args, { cwd, timeout: 60_000 });
}

async function configureGitRepo(cwd: string) {
  await run("git", ["config", "user.email", "test@example.com"], cwd);
  await run("git", ["config", "user.name", "Test User"], cwd);
}

async function createRepoFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "squadrail-merge-automation-"));
  const remoteDir = path.join(root, "remote.git");
  const baseDir = path.join(root, "base");
  const sourceDir = path.join(root, "source");

  await run("git", ["init", "--bare", remoteDir]);
  await run("git", ["clone", remoteDir, baseDir]);
  await configureGitRepo(baseDir);
  await run("git", ["checkout", "-b", "main"], baseDir);
  await fs.writeFile(path.join(baseDir, "app.txt"), "base\n", "utf8");
  await run("git", ["add", "app.txt"], baseDir);
  await run("git", ["commit", "-m", "initial"], baseDir);
  await run("git", ["push", "-u", "origin", "main"], baseDir);

  await run("git", ["clone", remoteDir, sourceDir]);
  await configureGitRepo(sourceDir);
  await run("git", ["checkout", "-b", "squadrail/clo-merge", "origin/main"], sourceDir);
  await fs.writeFile(path.join(sourceDir, "app.txt"), "base\nchange\n", "utf8");
  await run("git", ["add", "app.txt"], sourceDir);
  await run("git", ["commit", "-m", "candidate change"], sourceDir);
  const { stdout } = await run("git", ["rev-parse", "HEAD"], sourceDir);

  return {
    root,
    baseDir,
    sourceDir,
    headSha: stdout.trim(),
  };
}

async function branchExists(cwd: string, ref: string) {
  try {
    await run("git", ["rev-parse", "--verify", `${ref}^{commit}`], cwd);
    return true;
  } catch {
    return false;
  }
}

const cleanupPaths: string[] = [];

afterEach(async () => {
  while (cleanupPaths.length > 0) {
    const target = cleanupPaths.pop();
    if (!target) continue;
    await fs.rm(target, { recursive: true, force: true }).catch(() => undefined);
  }
});

describe("issue merge automation", () => {
  it("builds a valid merge automation plan for a pending candidate", async () => {
    const fixture = await createRepoFixture();
    cleanupPaths.push(fixture.root);

    const plan = await buildMergeAutomationPlan({
      issue: {
        id: "issue-1",
        identifier: "CLO-1",
        title: "Merge candidate",
        projectId: "project-1",
      },
      project: {
        id: "project-1",
        name: "Example",
        primaryWorkspace: {
          id: "workspace-1",
          name: "Base",
          cwd: fixture.baseDir,
          repoRef: "main",
        },
      },
      candidate: {
        issueId: "issue-1",
        identifier: "CLO-1",
        state: "pending",
        sourceBranch: "squadrail/clo-merge",
        headSha: fixture.headSha,
        workspacePath: fixture.sourceDir,
        targetBaseBranch: null,
        closeSummary: "Ready for merge",
        verificationSummary: "Tests passed",
        approvalSummary: "Approved",
        remainingRisks: [],
        automationMetadata: {},
        closeMessageId: "close-1",
      },
    });

    expect(plan.canAutomate).toBe(true);
    expect(plan.targetBaseBranch).toBe("main");
    expect(plan.targetStartRef).toBe("main");
    expect(plan.remoteName).toBe("origin");
    expect(plan.remoteUrl).toContain("remote.git");
  });

  it("exports patch and PR bundle artifacts", async () => {
    const fixture = await createRepoFixture();
    cleanupPaths.push(fixture.root);

    const plan = await buildMergeAutomationPlan({
      issue: {
        id: "issue-2",
        identifier: "CLO-2",
        title: "Export artifacts",
        projectId: "project-1",
      },
      project: {
        id: "project-1",
        name: "Example",
        primaryWorkspace: {
          id: "workspace-1",
          name: "Base",
          cwd: fixture.baseDir,
          repoRef: "main",
        },
      },
      candidate: {
        issueId: "issue-2",
        identifier: "CLO-2",
        state: "pending",
        sourceBranch: "squadrail/clo-merge",
        headSha: fixture.headSha,
        workspacePath: fixture.sourceDir,
        targetBaseBranch: null,
        closeSummary: "Ready for merge",
        verificationSummary: "Tests passed",
        approvalSummary: "Approved",
        remainingRisks: ["External push pending"],
        automationMetadata: {},
        closeMessageId: "close-1",
      },
    });

    const patchResult = await runMergeAutomationAction({
      actionType: "export_patch",
      plan,
      candidate: {
        issueId: "issue-2",
        identifier: "CLO-2",
        state: "pending",
        sourceBranch: "squadrail/clo-merge",
        headSha: fixture.headSha,
        workspacePath: fixture.sourceDir,
        targetBaseBranch: null,
        closeSummary: "Ready for merge",
        verificationSummary: "Tests passed",
        approvalSummary: "Approved",
        remainingRisks: ["External push pending"],
        automationMetadata: {},
        closeMessageId: "close-1",
      },
    });

    expect(patchResult.patchPath).toBeTruthy();
    const patchBody = await fs.readFile(patchResult.patchPath!, "utf8");
    expect(patchBody).toContain("change");

    const prResult = await runMergeAutomationAction({
      actionType: "export_pr_bundle",
      plan,
      candidate: {
        issueId: "issue-2",
        identifier: "CLO-2",
        state: "pending",
        sourceBranch: "squadrail/clo-merge",
        headSha: fixture.headSha,
        workspacePath: fixture.sourceDir,
        targetBaseBranch: null,
        closeSummary: "Ready for merge",
        verificationSummary: "Tests passed",
        approvalSummary: "Approved",
        remainingRisks: ["External push pending"],
        automationMetadata: {},
        closeMessageId: "close-1",
      },
    });

    expect(prResult.prBundlePath).toBeTruthy();
    expect(prResult.prPayloadPath).toBeTruthy();
    const prBody = await fs.readFile(prResult.prBundlePath!, "utf8");
    expect(prBody).toContain("Ready for merge");
    expect(prBody).toContain("Tests passed");
  });

  it("creates and pushes an integration branch for merge automation", async () => {
    const fixture = await createRepoFixture();
    cleanupPaths.push(fixture.root);

    const candidate = {
      issueId: "issue-3",
      identifier: "CLO-3",
      state: "pending" as const,
      sourceBranch: "squadrail/clo-merge",
      headSha: fixture.headSha,
      workspacePath: fixture.sourceDir,
      targetBaseBranch: null,
      closeSummary: "Ready for merge",
      verificationSummary: "Tests passed",
      approvalSummary: "Approved",
      remainingRisks: [],
      automationMetadata: {},
      closeMessageId: "close-1",
    };

    const plan = await buildMergeAutomationPlan({
      issue: {
        id: "issue-3",
        identifier: "CLO-3",
        title: "Merge automation",
        projectId: "project-1",
      },
      project: {
        id: "project-1",
        name: "Example",
        primaryWorkspace: {
          id: "workspace-1",
          name: "Base",
          cwd: fixture.baseDir,
          repoRef: "main",
        },
      },
      candidate,
    });

    const mergeResult = await runMergeAutomationAction({
      actionType: "merge_local",
      plan,
      candidate,
    });

    expect(mergeResult.targetBranch).toBeTruthy();
    expect(mergeResult.automationWorktreePath).toBeTruthy();
    expect(mergeResult.mergeCommitSha).toBeTruthy();
    expect(await branchExists(fixture.baseDir, mergeResult.targetBranch!)).toBe(true);

    const pushResult = await runMergeAutomationAction({
      actionType: "push_branch",
      plan,
      candidate: {
        ...candidate,
        automationMetadata: {
          lastPreparedBranch: mergeResult.targetBranch,
        },
      },
      branchName: mergeResult.targetBranch,
    });

    expect(pushResult.pushed).toBe(true);
    expect(await branchExists(fixture.baseDir, `refs/remotes/origin/${mergeResult.targetBranch}`)).toBe(true);
  });
});
