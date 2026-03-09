import { afterEach, describe, expect, it } from "vitest";
import { enrichProtocolMessageArtifactsFromRun } from "../services/protocol-run-artifacts.js";
import { setWorkspaceGitExecutorForTests } from "../services/workspace-git-snapshot.js";

afterEach(() => {
  setWorkspaceGitExecutorForTests(null);
});

describe("enrichProtocolMessageArtifactsFromRun", () => {
  it("adds resolved workspace binding metadata when the active run is already in implementation mode", async () => {
    setWorkspaceGitExecutorForTests(async ({ args }) => {
      if (args[0] === "rev-parse" && args[1] === "--is-inside-work-tree") return { stdout: "true\n" };
      if (args[0] === "rev-parse" && args[1] === "HEAD") return { stdout: "abc123\n" };
      if (args[0] === "branch" && args[1] === "--show-current") return { stdout: "squadrail/issue-1-eng-1\n" };
      if (args[0] === "status") return { stdout: "## squadrail/issue-1-eng-1\n M src/app.ts\n" };
      if (args[0] === "diff" && args[1] === "--shortstat") return { stdout: " 1 file changed, 2 insertions(+)\n" };
      throw new Error(`unexpected git invocation: ${args.join(" ")}`);
    });

    const message = await enrichProtocolMessageArtifactsFromRun({
      issueId: "issue-1",
      run: {
        id: "run-1",
        companyId: "company-1",
        agentId: "eng-1",
        invocationSource: "automation",
        status: "running",
        startedAt: new Date("2026-03-10T00:00:00.000Z"),
        finishedAt: null,
        stdoutExcerpt: null,
        stderrExcerpt: null,
        contextSnapshot: {
          issueId: "issue-1",
          squadrailWorkspace: {
            cwd: "/workspace/repo",
            source: "project_isolated",
            projectId: "project-1",
            workspaceId: "workspace-1",
            repoUrl: "git@github.com:org/repo.git",
            repoRef: "main",
            workspaceUsage: "implementation",
            branchName: "squadrail/issue-1-eng-1",
          },
        },
      },
      message: {
        messageType: "START_IMPLEMENTATION",
        sender: {
          actorType: "agent",
          actorId: "eng-1",
          role: "engineer",
        },
        recipients: [
          {
            recipientType: "agent",
            recipientId: "eng-1",
            role: "engineer",
          },
        ],
        workflowStateBefore: "planning",
        workflowStateAfter: "implementing",
        summary: "start implementation",
        payload: {
          implementationMode: "code_change",
          activeHypotheses: ["isolate the worktree"],
        },
        artifacts: [],
      },
    });

    expect(message.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "run",
          uri: "run://run-1",
        }),
        expect.objectContaining({
          kind: "doc",
          uri: "workspace://workspace-1/binding",
          metadata: expect.objectContaining({
            bindingType: "implementation_workspace",
            branchName: "squadrail/issue-1-eng-1",
            headSha: "abc123",
          }),
        }),
        expect.objectContaining({
          kind: "diff",
          uri: "run://run-1/workspace-diff",
          metadata: expect.objectContaining({
            captureConfidence: "workspace_snapshot",
            changedFiles: ["src/app.ts"],
          }),
        }),
      ]),
    );
  });

  it("does not mark START_IMPLEMENTATION from a non-implementation run as already bound", async () => {
    const message = await enrichProtocolMessageArtifactsFromRun({
      issueId: "issue-1",
      run: {
        id: "run-1",
        companyId: "company-1",
        agentId: "eng-1",
        invocationSource: "automation",
        status: "running",
        startedAt: new Date("2026-03-10T00:00:00.000Z"),
        finishedAt: null,
        stdoutExcerpt: null,
        stderrExcerpt: null,
        contextSnapshot: {
          issueId: "issue-1",
          squadrailWorkspace: {
            cwd: "/workspace/repo",
            source: "project_shared",
            projectId: "project-1",
            workspaceId: "workspace-1",
            repoUrl: "git@github.com:org/repo.git",
            repoRef: "main",
            workspaceUsage: "analysis",
          },
        },
      },
      message: {
        messageType: "START_IMPLEMENTATION",
        sender: {
          actorType: "agent",
          actorId: "eng-1",
          role: "engineer",
        },
        recipients: [
          {
            recipientType: "agent",
            recipientId: "eng-1",
            role: "engineer",
          },
        ],
        workflowStateBefore: "planning",
        workflowStateAfter: "implementing",
        summary: "start implementation",
        payload: {
          implementationMode: "code_change",
        },
        artifacts: [],
      },
    });

    expect(message.artifacts).toEqual(
      expect.not.arrayContaining([
        expect.objectContaining({
          kind: "doc",
          uri: expect.stringContaining("/binding"),
        }),
      ]),
    );
  });

  it("captures reported test and build evidence only when corroborated by run output", async () => {
    setWorkspaceGitExecutorForTests(async ({ args }) => {
      if (args[0] === "rev-parse" && args[1] === "--is-inside-work-tree") return { stdout: "true\n" };
      if (args[0] === "rev-parse" && args[1] === "HEAD") return { stdout: "abc123\n" };
      if (args[0] === "branch" && args[1] === "--show-current") return { stdout: "squadrail/issue-2-eng-1\n" };
      if (args[0] === "status") return { stdout: "## squadrail/issue-2-eng-1\n M server/src/retry.ts\n" };
      if (args[0] === "diff" && args[1] === "--shortstat") return { stdout: " 1 file changed, 10 insertions(+)\n" };
      throw new Error(`unexpected git invocation: ${args.join(" ")}`);
    });

    const message = await enrichProtocolMessageArtifactsFromRun({
      issueId: "issue-2",
      run: {
        id: "run-2",
        companyId: "company-1",
        agentId: "eng-1",
        invocationSource: "automation",
        status: "running",
        startedAt: new Date("2026-03-10T00:01:00.000Z"),
        finishedAt: null,
        stdoutExcerpt: "pnpm test:run\npnpm build",
        stderrExcerpt: null,
        contextSnapshot: {
          issueId: "issue-2",
          squadrailWorkspace: {
            cwd: "/workspace/repo",
            source: "project_isolated",
            projectId: "project-1",
            workspaceId: "workspace-1",
            workspaceUsage: "implementation",
          },
        },
      },
      message: {
        messageType: "SUBMIT_FOR_REVIEW",
        sender: {
          actorType: "agent",
          actorId: "eng-1",
          role: "engineer",
        },
        recipients: [
          {
            recipientType: "agent",
            recipientId: "rev-1",
            role: "reviewer",
          },
        ],
        workflowStateBefore: "implementing",
        workflowStateAfter: "submitted_for_review",
        summary: "submit for review",
        payload: {
          implementationSummary: "done",
          evidence: ["pnpm build"],
          diffSummary: "updated retry handling",
          changedFiles: ["server/src/retry.ts"],
          testResults: ["pnpm test:run"],
          reviewChecklist: ["reviewed retry flow"],
          residualRisks: ["monitor production queue depth"],
        },
        artifacts: [],
      },
    });

    expect(message.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "run",
          uri: "run://run-2",
        }),
        expect.objectContaining({
          kind: "diff",
          uri: "run://run-2/workspace-diff",
        }),
        expect.objectContaining({
          kind: "test_run",
          uri: "run://run-2/test",
          metadata: expect.objectContaining({
            evidenceLines: ["pnpm test:run"],
          }),
        }),
        expect.objectContaining({
          kind: "build_run",
          uri: "run://run-2/build",
          metadata: expect.objectContaining({
            evidenceLines: ["pnpm build"],
          }),
        }),
      ]),
    );
  });

  it("does not auto-capture test or build artifacts from payload text alone", async () => {
    setWorkspaceGitExecutorForTests(async ({ args }) => {
      if (args[0] === "rev-parse" && args[1] === "--is-inside-work-tree") return { stdout: "true\n" };
      if (args[0] === "rev-parse" && args[1] === "HEAD") return { stdout: "abc123\n" };
      if (args[0] === "branch" && args[1] === "--show-current") return { stdout: "squadrail/issue-2-eng-1\n" };
      if (args[0] === "status") return { stdout: "## squadrail/issue-2-eng-1\n M server/src/retry.ts\n" };
      if (args[0] === "diff" && args[1] === "--shortstat") return { stdout: " 1 file changed, 10 insertions(+)\n" };
      throw new Error(`unexpected git invocation: ${args.join(" ")}`);
    });

    const message = await enrichProtocolMessageArtifactsFromRun({
      issueId: "issue-2",
      run: {
        id: "run-2",
        companyId: "company-1",
        agentId: "eng-1",
        invocationSource: "automation",
        status: "running",
        startedAt: new Date("2026-03-10T00:01:00.000Z"),
        finishedAt: null,
        stdoutExcerpt: "analysis only",
        stderrExcerpt: null,
        contextSnapshot: {
          issueId: "issue-2",
          squadrailWorkspace: {
            cwd: "/workspace/repo",
            source: "project_isolated",
            projectId: "project-1",
            workspaceId: "workspace-1",
            workspaceUsage: "implementation",
          },
        },
      },
      message: {
        messageType: "SUBMIT_FOR_REVIEW",
        sender: {
          actorType: "agent",
          actorId: "eng-1",
          role: "engineer",
        },
        recipients: [
          {
            recipientType: "agent",
            recipientId: "rev-1",
            role: "reviewer",
          },
        ],
        workflowStateBefore: "implementing",
        workflowStateAfter: "submitted_for_review",
        summary: "submit for review",
        payload: {
          implementationSummary: "done",
          evidence: ["pnpm build"],
          diffSummary: "updated retry handling",
          changedFiles: ["server/src/retry.ts"],
          testResults: ["pnpm test:run"],
          reviewChecklist: ["reviewed retry flow"],
          residualRisks: ["monitor production queue depth"],
        },
        artifacts: [],
      },
    });

    expect(message.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "diff" }),
      ]),
    );
    expect(message.artifacts).toEqual(
      expect.not.arrayContaining([
        expect.objectContaining({ kind: "test_run" }),
        expect.objectContaining({ kind: "build_run" }),
      ]),
    );
  });
});
