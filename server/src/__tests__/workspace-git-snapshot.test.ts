import { afterEach, describe, expect, it } from "vitest";
import {
  inspectWorkspaceGitSnapshot,
  setWorkspaceGitExecutorForTests,
} from "../services/workspace-git-snapshot.js";

afterEach(() => {
  setWorkspaceGitExecutorForTests(null);
});

describe("inspectWorkspaceGitSnapshot", () => {
  it("captures branch, head, and changed files from git status", async () => {
    setWorkspaceGitExecutorForTests(async ({ args }) => {
      if (args[0] === "rev-parse" && args[1] === "--is-inside-work-tree") return { stdout: "true\n" };
      if (args[0] === "rev-parse" && args[1] === "HEAD") return { stdout: "abc123\n" };
      if (args[0] === "branch" && args[1] === "--show-current") return { stdout: "feature/test\n" };
      if (args[0] === "status") return { stdout: "## feature/test\n M src/app.ts\n?? docs/new.md\n" };
      if (args[0] === "diff" && args[1] === "--shortstat") return { stdout: " 2 files changed, 3 insertions(+)\n" };
      throw new Error(`unexpected git invocation: ${args.join(" ")}`);
    });

    const snapshot = await inspectWorkspaceGitSnapshot({
      cwd: "/workspace/repo",
      branchName: "expected/branch",
    });

    expect(snapshot).toMatchObject({
      branchName: "feature/test",
      expectedBranchName: "expected/branch",
      branchMismatch: true,
      headSha: "abc123",
      hasChanges: true,
      changedFiles: ["src/app.ts", "docs/new.md"],
      diffStat: "2 files changed, 3 insertions(+)",
    });
  });

  it("returns null when the cwd is not a git worktree", async () => {
    setWorkspaceGitExecutorForTests(async ({ args }) => {
      if (args[0] === "rev-parse" && args[1] === "--is-inside-work-tree") {
        throw new Error("not a git repo");
      }
      throw new Error(`unexpected git invocation: ${args.join(" ")}`);
    });

    await expect(inspectWorkspaceGitSnapshot({ cwd: "/workspace/plain" })).resolves.toBeNull();
  });
});
