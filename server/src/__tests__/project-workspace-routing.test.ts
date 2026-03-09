import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  deriveProjectWorkspaceUsageFromContext,
  resolveProjectWorkspaceByPolicy,
  setProjectWorkspaceGitExecutorForTests,
} from "../services/project-workspace-routing.js";

const tempRoots: string[] = [];

async function createTempWorkspace(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "squadrail-workspace-routing-"));
  tempRoots.push(root);
  await fs.writeFile(path.join(root, "README.md"), "# test\n", "utf8");
  return root;
}

afterEach(async () => {
  setProjectWorkspaceGitExecutorForTests(null);
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("deriveProjectWorkspaceUsageFromContext", () => {
  it("uses implementation mode for engineer implementation wakes", () => {
    expect(
      deriveProjectWorkspaceUsageFromContext({
        protocolRecipientRole: "engineer",
        protocolMessageType: "START_IMPLEMENTATION",
        protocolWorkflowStateAfter: "implementing",
      }),
    ).toBe("implementation");
  });

  it("uses review mode for reviewer workflows", () => {
    expect(
      deriveProjectWorkspaceUsageFromContext({
        protocolRecipientRole: "reviewer",
        protocolMessageType: "START_REVIEW",
        protocolWorkflowStateAfter: "under_review",
      }),
    ).toBe("review");
  });
});

describe("resolveProjectWorkspaceByPolicy", () => {
  it("selects shared workspace for review usage", async () => {
    const repo = await createTempWorkspace();
    const result = await resolveProjectWorkspaceByPolicy({
      agentId: "agent-review",
      issueId: "issue-1",
      projectId: "project-1",
      taskKey: "issue-1",
      context: {
        protocolRecipientRole: "reviewer",
        protocolMessageType: "START_REVIEW",
        protocolWorkflowStateAfter: "under_review",
      },
      workspaces: [
        {
          id: "workspace-shared",
          name: "shared",
          cwd: repo,
          repoUrl: null,
          repoRef: "HEAD",
          metadata: {
            executionPolicy: {
              mode: "shared",
              applyFor: ["analysis", "review"],
            },
          },
          isPrimary: true,
        },
      ],
    });

    expect(result?.source).toBe("project_shared");
    expect(result?.cwd).toBe(repo);
    expect(result?.workspaceUsage).toBe("review");
  });

  it("creates an isolated worktree for implementation usage", async () => {
    const repo = await createTempWorkspace();
    const isolatedRoot = path.join(repo, ".isolated");
    const gitWorktrees = new Set([repo]);
    setProjectWorkspaceGitExecutorForTests(async ({ cwd, args }) => {
      if (args[0] === "rev-parse" && args[1] === "--is-inside-work-tree") {
        if (cwd && gitWorktrees.has(cwd)) return { stdout: "true\n" };
        throw new Error("not a git worktree");
      }
      if (args[0] === "rev-parse" && args[1] === "--verify") {
        throw new Error("branch missing");
      }
      if (args[0] === "worktree" && args[1] === "add") {
        const targetDir = args.includes("-b")
          ? args[4]
          : args[3] === "--detach"
            ? args[4]
            : args[2];
        if (!targetDir) throw new Error("missing target dir");
        await fs.mkdir(targetDir, { recursive: true });
        gitWorktrees.add(targetDir);
        return { stdout: "" };
      }
      throw new Error(`unexpected git invocation: ${args.join(" ")}`);
    });
    const result = await resolveProjectWorkspaceByPolicy({
      agentId: "agent-implementer",
      issueId: "issue-42",
      projectId: "project-1",
      taskKey: "issue-42",
      context: {
        protocolRecipientRole: "engineer",
        protocolMessageType: "START_IMPLEMENTATION",
        protocolWorkflowStateAfter: "implementing",
      },
      workspaces: [
        {
          id: "workspace-shared",
          name: "shared",
          cwd: repo,
          repoUrl: null,
          repoRef: "HEAD",
          metadata: {
            executionPolicy: {
              mode: "shared",
              applyFor: ["analysis", "review"],
            },
          },
          isPrimary: true,
        },
        {
          id: "workspace-impl",
          name: "impl",
          cwd: repo,
          repoUrl: null,
          repoRef: "HEAD",
          metadata: {
            executionPolicy: {
              mode: "isolated",
              applyFor: ["implementation"],
              isolationStrategy: "worktree",
              isolatedRoot,
              branchTemplate: "squadrail/{projectId}/{agentId}/{issueId}",
            },
          },
          isPrimary: false,
        },
      ],
    });

    expect(result?.source).toBe("project_isolated");
    expect(result?.workspaceUsage).toBe("implementation");
    expect(result?.cwd.startsWith(isolatedRoot)).toBe(true);
    expect(gitWorktrees.has(result!.cwd)).toBe(true);
    expect(result?.branchName).toContain("squadrail/");
    expect(result?.workspaceState).toBe("fresh");
    expect(result?.hasLocalChanges).toBe(false);
  });

  it("reuses an existing worktree when the implementation branch is already attached elsewhere", async () => {
    const repo = await createTempWorkspace();
    const isolatedRoot = path.join(repo, ".isolated");
    const existingWorktree = path.join(repo, ".other-worktrees", "issue-42-agent-implementer-workspace-im");
    const expectedBranchName = "squadrail/project-1/agent-implemente/issue-42";
    await fs.mkdir(existingWorktree, { recursive: true });
    const gitWorktrees = new Set([repo, existingWorktree]);

    setProjectWorkspaceGitExecutorForTests(async ({ cwd, args }) => {
      if (args[0] === "rev-parse" && args[1] === "--is-inside-work-tree") {
        if (cwd && gitWorktrees.has(cwd)) return { stdout: "true\n" };
        throw new Error("not a git worktree");
      }
      if (args[0] === "worktree" && args[1] === "list") {
        return {
          stdout: [
            `worktree ${repo}`,
            "HEAD abc123",
            "branch refs/heads/main",
            "",
            `worktree ${existingWorktree}`,
            "HEAD def456",
            `branch refs/heads/${expectedBranchName}`,
            "",
          ].join("\n"),
        };
      }
      if (args[0] === "status" && args[1] === "--porcelain") {
        return { stdout: "" };
      }
      if (args[0] === "rev-parse" && args[1] === "--verify") {
        return { stdout: `refs/heads/${expectedBranchName}\n` };
      }
      throw new Error(`unexpected git invocation: ${args.join(" ")}`);
    });

    const result = await resolveProjectWorkspaceByPolicy({
      agentId: "agent-implementer",
      issueId: "issue-42",
      projectId: "project-1",
      taskKey: "issue-42",
      context: {
        protocolRecipientRole: "engineer",
        protocolMessageType: "START_IMPLEMENTATION",
        protocolWorkflowStateAfter: "implementing",
      },
      workspaces: [
        {
          id: "workspace-impl",
          name: "impl",
          cwd: repo,
          repoUrl: null,
          repoRef: "HEAD",
          metadata: {
            executionPolicy: {
              mode: "isolated",
              applyFor: ["implementation"],
              isolationStrategy: "worktree",
              isolatedRoot,
              branchTemplate: "squadrail/{projectId}/{agentId}/{issueId}",
            },
          },
          isPrimary: true,
        },
      ],
    });

    expect(result?.source).toBe("project_isolated");
    expect(result?.cwd).toBe(existingWorktree);
    expect(result?.workspaceState).toBe("recovered_existing");
    expect(result?.hasLocalChanges).toBe(false);
    expect(result?.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("already attached to existing worktree"),
      ]),
    );
  });

  it("removes a clean stale isolated worktree when the branch binding no longer matches", async () => {
    const repo = await createTempWorkspace();
    const isolatedRoot = path.join(repo, ".isolated");
    const staleTarget = path.join(isolatedRoot, "issue-42-agent-implementer-workspace-im");
    await fs.mkdir(staleTarget, { recursive: true });
    const gitWorktrees = new Set([repo, staleTarget]);

    setProjectWorkspaceGitExecutorForTests(async ({ cwd, args }) => {
      if (args[0] === "rev-parse" && args[1] === "--is-inside-work-tree") {
        if (cwd && gitWorktrees.has(cwd)) return { stdout: "true\n" };
        throw new Error("not a git worktree");
      }
      if (args[0] === "branch" && args[1] === "--show-current") {
        if (cwd === staleTarget) return { stdout: "old/stale-branch\n" };
        return { stdout: "main\n" };
      }
      if (args[0] === "status" && args[1] === "--porcelain") {
        return { stdout: "" };
      }
      if (args[0] === "worktree" && args[1] === "remove") {
        const targetDir = args[3];
        if (!targetDir) throw new Error("missing target dir");
        gitWorktrees.delete(targetDir);
        await fs.rm(targetDir, { recursive: true, force: true });
        return { stdout: "" };
      }
      if (args[0] === "worktree" && args[1] === "list") {
        return {
          stdout: [
            `worktree ${repo}`,
            "HEAD abc123",
            "branch refs/heads/main",
            "",
          ].join("\n"),
        };
      }
      if (args[0] === "rev-parse" && args[1] === "--verify") {
        throw new Error("branch missing");
      }
      if (args[0] === "worktree" && args[1] === "add") {
        const targetDir = args.includes("-b") ? args[4] : args[2];
        if (!targetDir) throw new Error("missing target dir");
        await fs.mkdir(targetDir, { recursive: true });
        gitWorktrees.add(targetDir);
        return { stdout: "" };
      }
      throw new Error(`unexpected git invocation: ${args.join(" ")}`);
    });

    const result = await resolveProjectWorkspaceByPolicy({
      agentId: "agent-implementer",
      issueId: "issue-42",
      projectId: "project-1",
      taskKey: "issue-42",
      context: {
        protocolRecipientRole: "engineer",
        protocolMessageType: "START_IMPLEMENTATION",
        protocolWorkflowStateAfter: "implementing",
      },
      workspaces: [
        {
          id: "workspace-impl",
          name: "impl",
          cwd: repo,
          repoUrl: null,
          repoRef: "HEAD",
          metadata: {
            executionPolicy: {
              mode: "isolated",
              applyFor: ["implementation"],
              isolationStrategy: "worktree",
              isolatedRoot,
              branchTemplate: "squadrail/{projectId}/{agentId}/{issueId}",
            },
          },
          isPrimary: true,
        },
      ],
    });

    expect(result?.source).toBe("project_isolated");
    expect(result?.cwd).toBe(staleTarget);
    expect(result?.branchName).toContain("squadrail/");
    expect(result?.workspaceState).toBe("recreated_clean");
    expect(result?.hasLocalChanges).toBe(false);
    expect(result?.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Removed stale isolated workspace"),
      ]),
    );
  });

  it("keeps a dirty stale isolated worktree blocked instead of reusing it", async () => {
    const repo = await createTempWorkspace();
    const isolatedRoot = path.join(repo, ".isolated");
    const staleTarget = path.join(isolatedRoot, "issue-42-agent-implementer-workspace-im");
    await fs.mkdir(staleTarget, { recursive: true });
    const gitWorktrees = new Set([repo, staleTarget]);

    setProjectWorkspaceGitExecutorForTests(async ({ cwd, args }) => {
      if (args[0] === "rev-parse" && args[1] === "--is-inside-work-tree") {
        if (cwd && gitWorktrees.has(cwd)) return { stdout: "true\n" };
        throw new Error("not a git worktree");
      }
      if (args[0] === "branch" && args[1] === "--show-current") {
        if (cwd === staleTarget) return { stdout: "old/stale-branch\n" };
        return { stdout: "main\n" };
      }
      if (args[0] === "status" && args[1] === "--porcelain") {
        if (cwd === staleTarget) return { stdout: " M src/app.ts\n" };
        return { stdout: "" };
      }
      throw new Error(`unexpected git invocation: ${args.join(" ")}`);
    });

    const result = await resolveProjectWorkspaceByPolicy({
      agentId: "agent-implementer",
      issueId: "issue-42",
      projectId: "project-1",
      taskKey: "issue-42",
      context: {
        protocolRecipientRole: "engineer",
        protocolMessageType: "START_IMPLEMENTATION",
        protocolWorkflowStateAfter: "implementing",
      },
      workspaces: [
        {
          id: "workspace-impl",
          name: "impl",
          cwd: repo,
          repoUrl: null,
          repoRef: "HEAD",
          metadata: {
            executionPolicy: {
              mode: "isolated",
              applyFor: ["implementation"],
              isolationStrategy: "worktree",
              isolatedRoot,
              branchTemplate: "squadrail/{projectId}/{agentId}/{issueId}",
            },
          },
          isPrimary: true,
        },
      ],
    });

    expect(result).toBeNull();
  });

  it("reuses a dirty same-branch isolated clone as an explicit resume", async () => {
    const repo = await createTempWorkspace();
    const isolatedRoot = path.join(repo, ".clones");
    const staleTarget = path.join(isolatedRoot, "issue-42-agent-implementer-workspace-im");
    await fs.mkdir(staleTarget, { recursive: true });
    const gitWorktrees = new Set([repo, staleTarget]);
    const expectedBranchName = "squadrail/project-1/agent-implemente/issue-42";

    setProjectWorkspaceGitExecutorForTests(async ({ cwd, args }) => {
      if (args[0] === "rev-parse" && args[1] === "--is-inside-work-tree") {
        if (cwd && gitWorktrees.has(cwd)) return { stdout: "true\n" };
        throw new Error("not a git worktree");
      }
      if (args[0] === "branch" && args[1] === "--show-current") {
        if (cwd === staleTarget) return { stdout: `${expectedBranchName}\n` };
        return { stdout: "main\n" };
      }
      if (args[0] === "status" && args[1] === "--porcelain") {
        if (cwd === staleTarget) return { stdout: " M src/app.ts\n" };
        return { stdout: "" };
      }
      throw new Error(`unexpected git invocation: ${args.join(" ")}`);
    });

    const result = await resolveProjectWorkspaceByPolicy({
      agentId: "agent-implementer",
      issueId: "issue-42",
      projectId: "project-1",
      taskKey: "issue-42",
      context: {
        protocolRecipientRole: "engineer",
        protocolMessageType: "START_IMPLEMENTATION",
        protocolWorkflowStateAfter: "implementing",
      },
      workspaces: [
        {
          id: "workspace-impl",
          name: "impl",
          cwd: repo,
          repoUrl: null,
          repoRef: "HEAD",
          metadata: {
            executionPolicy: {
              mode: "isolated",
              applyFor: ["implementation"],
              isolationStrategy: "clone",
              isolatedRoot,
              branchTemplate: "squadrail/{projectId}/{agentId}/{issueId}",
            },
          },
          isPrimary: true,
        },
      ],
    });

    expect(result?.source).toBe("project_isolated");
    expect(result?.cwd).toBe(staleTarget);
    expect(result?.workspaceState).toBe("resumed_dirty");
    expect(result?.hasLocalChanges).toBe(true);
    expect(result?.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("local changes from a prior implementation attempt"),
      ]),
    );
  });

  it("recreates a stale clone when the branch binding no longer matches", async () => {
    const repo = await createTempWorkspace();
    const isolatedRoot = path.join(repo, ".clones");
    const staleTarget = path.join(isolatedRoot, "issue-42-agent-implementer-workspace-im");
    await fs.mkdir(staleTarget, { recursive: true });
    const gitWorktrees = new Set([repo, staleTarget]);

    setProjectWorkspaceGitExecutorForTests(async ({ cwd, args }) => {
      if (args[0] === "rev-parse" && args[1] === "--is-inside-work-tree") {
        if (cwd && gitWorktrees.has(cwd)) return { stdout: "true\n" };
        throw new Error("not a git worktree");
      }
      if (args[0] === "branch" && args[1] === "--show-current") {
        if (cwd === staleTarget) return { stdout: "old/stale-branch\n" };
        return { stdout: "main\n" };
      }
      if (args[0] === "status" && args[1] === "--porcelain") {
        return { stdout: "" };
      }
      if (args[0] === "clone") {
        const targetDir = args[3];
        if (!targetDir) throw new Error("missing target dir");
        await fs.mkdir(targetDir, { recursive: true });
        gitWorktrees.add(targetDir);
        return { stdout: "" };
      }
      if (args[0] === "checkout" && args[1] === "-b") {
        return { stdout: "" };
      }
      throw new Error(`unexpected git invocation: ${args.join(" ")}`);
    });

    const result = await resolveProjectWorkspaceByPolicy({
      agentId: "agent-implementer",
      issueId: "issue-42",
      projectId: "project-1",
      taskKey: "issue-42",
      context: {
        protocolRecipientRole: "engineer",
        protocolMessageType: "START_IMPLEMENTATION",
        protocolWorkflowStateAfter: "implementing",
      },
      workspaces: [
        {
          id: "workspace-impl",
          name: "impl",
          cwd: repo,
          repoUrl: null,
          repoRef: "HEAD",
          metadata: {
            executionPolicy: {
              mode: "isolated",
              applyFor: ["implementation"],
              isolationStrategy: "clone",
              isolatedRoot,
              branchTemplate: "squadrail/{projectId}/{agentId}/{issueId}",
            },
          },
          isPrimary: true,
        },
      ],
    });

    expect(result?.source).toBe("project_isolated");
    expect(result?.cwd).toBe(staleTarget);
    expect(result?.workspaceState).toBe("recreated_clean");
    expect(result?.hasLocalChanges).toBe(false);
    expect(result?.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Removed stale isolated workspace"),
      ]),
    );
  });
});
