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
  });
});
