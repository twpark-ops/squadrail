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
            workspaceState: "resumed_dirty",
            hasLocalChanges: true,
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
            workspaceState: "resumed_dirty",
            hasLocalChanges: true,
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
        resultJson: {
          commandExecutions: [
            { command: "pnpm test:run", status: "completed", exitCode: 0 },
            { command: "pnpm build", status: "completed", exitCode: 0 },
          ],
          verificationSignals: [
            {
              kind: "test",
              command: "pnpm test:run",
              source: "command_execution",
              confidence: "structured",
              status: "passed",
              exitCode: 0,
            },
            {
              kind: "build",
              command: "pnpm build",
              source: "command_execution",
              confidence: "structured",
              status: "passed",
              exitCode: 0,
            },
          ],
        },
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
            captureConfidence: "structured",
            evidenceLines: ["pnpm test:run"],
            observedCommands: ["pnpm test:run"],
            observedStatuses: ["passed"],
          }),
        }),
        expect.objectContaining({
          kind: "build_run",
          uri: "run://run-2/build",
          metadata: expect.objectContaining({
            captureConfidence: "structured",
            evidenceLines: ["pnpm build"],
            observedCommands: ["pnpm build"],
            observedStatuses: ["passed"],
          }),
        }),
      ]),
    );
  });

  it("captures test and build artifacts from active run live logs before resultJson is finalized", async () => {
    setWorkspaceGitExecutorForTests(async ({ args }) => {
      if (args[0] === "rev-parse" && args[1] === "--is-inside-work-tree") return { stdout: "true\n" };
      if (args[0] === "rev-parse" && args[1] === "HEAD") return { stdout: "abc123\n" };
      if (args[0] === "branch" && args[1] === "--show-current") return { stdout: "squadrail/issue-3-eng-1\n" };
      if (args[0] === "status") return { stdout: "## squadrail/issue-3-eng-1\n M src/release-label.js\n" };
      if (args[0] === "diff" && args[1] === "--shortstat") return { stdout: " 1 file changed, 6 insertions(+), 2 deletions(-)\n" };
      throw new Error(`unexpected git invocation: ${args.join(" ")}`);
    });

    const liveLogContent = [
      JSON.stringify({
        ts: "2026-03-10T00:00:00.000Z",
        stream: "stdout",
        chunk: `${JSON.stringify({
          type: "item.completed",
          item: {
            type: "command_execution",
            command: "/usr/bin/zsh -lc 'pnpm test'",
            exit_code: 0,
            status: "completed",
          },
        })}\n${JSON.stringify({
          type: "item.completed",
          item: {
            type: "command_execution",
            command: "/usr/bin/zsh -lc 'pnpm build'",
            exit_code: 0,
            status: "completed",
          },
        })}`,
      }),
    ].join("\n");

    const message = await enrichProtocolMessageArtifactsFromRun({
      issueId: "issue-3",
      liveLogContent,
      run: {
        id: "run-3",
        companyId: "company-1",
        agentId: "eng-1",
        invocationSource: "automation",
        status: "running",
        startedAt: new Date("2026-03-10T00:02:00.000Z"),
        finishedAt: null,
        stdoutExcerpt: null,
        stderrExcerpt: null,
        contextSnapshot: {
          issueId: "issue-3",
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
          evidence: ["Validated with pnpm build"],
          diffSummary: "updated release label normalization",
          changedFiles: ["src/release-label.js"],
          testResults: ["pnpm test"],
          reviewChecklist: ["changed one file"],
          residualRisks: ["pending external merge"],
        },
        artifacts: [],
      },
    });

    expect(message.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "test_run",
          metadata: expect.objectContaining({
            captureConfidence: "structured",
            observedCommands: ["/usr/bin/zsh -lc 'pnpm test'"],
          }),
        }),
        expect.objectContaining({
          kind: "build_run",
          metadata: expect.objectContaining({
            captureConfidence: "structured",
            observedCommands: ["/usr/bin/zsh -lc 'pnpm build'"],
          }),
        }),
      ]),
    );
  });

  it("captures Claude bash tool executions from active live logs before resultJson is finalized", async () => {
    setWorkspaceGitExecutorForTests(async ({ args }) => {
      if (args[0] === "rev-parse" && args[1] === "--is-inside-work-tree") return { stdout: "true\n" };
      if (args[0] === "rev-parse" && args[1] === "HEAD") return { stdout: "abc123\n" };
      if (args[0] === "branch" && args[1] === "--show-current") return { stdout: "squadrail/issue-4-eng-1\n" };
      if (args[0] === "status") return { stdout: "## squadrail/issue-4-eng-1\n M internal/observability/tracing.go\n" };
      if (args[0] === "diff" && args[1] === "--shortstat") return { stdout: " 1 file changed, 8 insertions(+), 1 deletion(-)\n" };
      throw new Error(`unexpected git invocation: ${args.join(" ")}`);
    });

    const liveLogContent = [
      JSON.stringify({
        ts: "2026-03-10T00:00:00.000Z",
        stream: "stdout",
        chunk: [
          JSON.stringify({
            type: "assistant",
            message: {
              content: [
                {
                  type: "tool_use",
                  id: "toolu_test",
                  name: "Bash",
                  input: {
                    command: "go test ./internal/observability -count=1 -v",
                  },
                },
              ],
            },
          }),
          JSON.stringify({
            type: "user",
            message: {
              content: [
                {
                  type: "tool_result",
                  tool_use_id: "toolu_test",
                  is_error: false,
                  content: "PASS\nok\tinternal/observability\t5.501s",
                },
              ],
            },
          }),
        ].join("\n"),
      }),
    ].join("\n");

    const message = await enrichProtocolMessageArtifactsFromRun({
      issueId: "issue-4",
      liveLogContent,
      run: {
        id: "run-4",
        companyId: "company-1",
        agentId: "eng-1",
        invocationSource: "automation",
        status: "running",
        startedAt: new Date("2026-03-10T00:03:00.000Z"),
        finishedAt: null,
        stdoutExcerpt: null,
        stderrExcerpt: null,
        contextSnapshot: {
          issueId: "issue-4",
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
          evidence: ["Focused observability patch complete"],
          diffSummary: "updated tracing version resolution",
          changedFiles: ["internal/observability/tracing.go"],
          testResults: ["go test ./internal/observability -count=1 -v"],
          reviewChecklist: ["focused tests passed"],
          residualRisks: ["fallback remains active in non-stamped builds"],
        },
        artifacts: [],
      },
    });

    expect(message.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "test_run",
          metadata: expect.objectContaining({
            captureConfidence: "structured",
            observedCommands: ["go test ./internal/observability -count=1 -v"],
          }),
        }),
      ]),
    );
  });

  it("does not auto-capture failed structured verification as passing evidence", async () => {
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
        stdoutExcerpt: "pnpm test:run",
        stderrExcerpt: null,
        resultJson: {
          commandExecutions: [
            { command: "pnpm test:run", status: "failed", exitCode: 1 },
          ],
          verificationSignals: [
            {
              kind: "test",
              command: "pnpm test:run",
              source: "command_execution",
              confidence: "structured",
              status: "failed",
              exitCode: 1,
            },
          ],
        },
        contextSnapshot: {
          issueId: "issue-2",
          squadrailWorkspace: {
            cwd: "/workspace/repo",
            source: "project_shared",
            projectId: "project-1",
            workspaceId: "workspace-1",
            workspaceUsage: "review",
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
          evidence: ["pnpm test:run"],
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
      expect.not.arrayContaining([
        expect.objectContaining({ kind: "test_run" }),
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

  it("adds approval artifacts for approval messages", async () => {
    const message = await enrichProtocolMessageArtifactsFromRun({
      issueId: "issue-3",
      run: {
        id: "run-3",
        companyId: "company-1",
        agentId: "rev-1",
        invocationSource: "automation",
        status: "running",
        startedAt: new Date("2026-03-10T00:01:00.000Z"),
        finishedAt: null,
        stdoutExcerpt: null,
        stderrExcerpt: null,
        resultJson: null,
        contextSnapshot: {
          issueId: "issue-3",
          squadrailWorkspace: {
            cwd: "/workspace/repo",
            source: "project_shared",
            projectId: "project-1",
            workspaceId: "workspace-1",
            workspaceUsage: "review",
          },
        },
      },
      message: {
        messageType: "APPROVE_IMPLEMENTATION",
        sender: {
          actorType: "agent",
          actorId: "rev-1",
          role: "reviewer",
        },
        recipients: [
          {
            recipientType: "agent",
            recipientId: "lead-1",
            role: "tech_lead",
          },
        ],
        workflowStateBefore: "under_review",
        workflowStateAfter: "approved",
        summary: "approve",
        payload: {
          approvalSummary: "looks good",
          approvalMode: "agent_review",
          approvalChecklist: ["checked diff"],
          verifiedEvidence: ["reviewed implementation evidence"],
          residualRisks: ["monitor rollout"],
        },
        artifacts: [],
      },
    });

    expect(message.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "approval",
          uri: "approval://issue-3/run-3",
        }),
      ]),
    );
  });
});
