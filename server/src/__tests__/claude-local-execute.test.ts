import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execute } from "@squadrail/adapter-claude-local/server";

async function writeFakeClaudeCommand(commandPath: string): Promise<void> {
const script = `#!/usr/bin/env node
const fs = require("node:fs");

const capturePath = process.env.SQUADRAIL_TEST_CAPTURE_PATH;
const argv = process.argv.slice(2);
const systemPromptFileIndex = argv.indexOf("--append-system-prompt-file");
const systemPromptFilePath =
  systemPromptFileIndex >= 0 && argv[systemPromptFileIndex + 1]
    ? argv[systemPromptFileIndex + 1]
    : null;
const payload = {
  argv,
  cwd: process.cwd(),
  prompt: fs.readFileSync(0, "utf8"),
  systemPromptFilePath,
  systemPromptFileContent:
    systemPromptFilePath && fs.existsSync(systemPromptFilePath)
      ? fs.readFileSync(systemPromptFilePath, "utf8")
      : null,
  squadrailEnvKeys: Object.keys(process.env)
    .filter((key) => key.startsWith("SQUADRAIL_"))
    .sort(),
  squadrailApiKey: process.env.SQUADRAIL_API_KEY ?? null,
};
if (capturePath) {
  fs.writeFileSync(capturePath, JSON.stringify(payload), "utf8");
}
console.log(JSON.stringify({ type: "system", subtype: "init", session_id: "claude-session-1", model: "claude-sonnet" }));
console.log(JSON.stringify({
  type: "assistant",
  session_id: "claude-session-1",
  message: { content: [{ type: "text", text: "hello" }] },
}));
console.log(JSON.stringify({
  type: "result",
  subtype: "success",
  session_id: "claude-session-1",
  result: "ok",
  usage: { input_tokens: 12, cache_read_input_tokens: 2, output_tokens: 4 },
}));
`;
  await fs.writeFile(commandPath, script, "utf8");
  await fs.chmod(commandPath, 0o755);
}

async function writeStreamIncompleteClaudeCommand(commandPath: string): Promise<void> {
  const script = `#!/usr/bin/env node
console.log(JSON.stringify({ type: "system", subtype: "init", session_id: "claude-session-incomplete", model: "claude-sonnet" }));
console.log(JSON.stringify({
  type: "assistant",
  session_id: "claude-session-incomplete",
  message: { content: [{ type: "text", text: "partial response" }] },
}));
process.exit(143);
`;
  await fs.writeFile(commandPath, script, "utf8");
  await fs.chmod(commandPath, 0o755);
}

type CapturePayload = {
  argv: string[];
  cwd: string;
  prompt: string;
  systemPromptFilePath: string | null;
  systemPromptFileContent: string | null;
  squadrailEnvKeys: string[];
  squadrailApiKey: string | null;
};

describe("claude execute", () => {
  it("injects runtime note with timeout protocol context", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "squadrail-claude-execute-"));
    const workspace = path.join(root, "workspace");
    const commandPath = path.join(root, "claude");
    const capturePath = path.join(root, "capture.json");
    await fs.mkdir(workspace, { recursive: true });
    await writeFakeClaudeCommand(commandPath);

    let invocationPrompt = "";
    try {
      const result = await execute({
        runId: "run-1",
        agent: {
          id: "agent-1",
          companyId: "company-1",
          name: "Claude Reviewer",
          adapterType: "claude_local",
          adapterConfig: {},
        },
        runtime: {
          sessionId: null,
          sessionParams: null,
          sessionDisplayId: null,
          taskKey: null,
        },
        config: {
          command: commandPath,
          cwd: root,
          env: {
            SQUADRAIL_TEST_CAPTURE_PATH: capturePath,
          },
          promptTemplate: "Review the current Squadrail task.",
        },
        context: {
          squadrailWorkspace: {
            cwd: workspace,
            source: "project_shared",
            workspaceId: "workspace-2",
            repoUrl: "https://github.com/acme/swiftsight",
            repoRef: "main",
            workspaceUsage: "review",
            branchName: "squadrail/project-1/reviewer-1/issue-2",
          },
          issueId: "issue-2",
          wakeReason: "protocol_timeout_escalation",
          protocolMessageType: "TIMEOUT_ESCALATION",
          protocolWorkflowStateBefore: "submitted_for_review",
          protocolWorkflowStateAfter: "submitted_for_review",
          protocolRecipientRole: "tech_lead",
          protocolSenderRole: "system",
          protocolSummary: "Timeout escalation: review_start_timeout",
          timeoutCode: "review_start_timeout",
          protocolPayload: {
            timeoutCode: "review_start_timeout",
            expiredActorRole: "reviewer",
          },
          taskBrief: {
            id: "brief-2",
            scope: "reviewer",
            retrievalRunId: "retrieval-2",
            contentMarkdown: "# reviewer brief\n\n## Checks\n- Validate retry edge cases.\n",
            evidence: [
              {
                rank: 1,
                sourceType: "code",
                path: "src/retry.ts",
                symbolName: "applyRetryPolicy",
                fusedScore: 0.88,
              },
            ],
          },
        },
        authToken: "run-jwt-token",
        onLog: async () => {},
        onMeta: async (meta) => {
          invocationPrompt = meta.prompt ?? "";
        },
      });

      expect(result.exitCode).toBe(0);

      const capture = JSON.parse(await fs.readFile(capturePath, "utf8")) as CapturePayload;
      expect(capture.squadrailEnvKeys).toEqual(
        expect.arrayContaining([
          "SQUADRAIL_AGENT_ID",
          "SQUADRAIL_API_KEY",
          "SQUADRAIL_API_URL",
          "SQUADRAIL_COMPANY_ID",
          "SQUADRAIL_PROTOCOL_HELPER_PATH",
          "SQUADRAIL_RUN_ID",
          "SQUADRAIL_TASK_ID",
          "SQUADRAIL_WAKE_REASON",
        ]),
      );
      expect(capture.squadrailApiKey).toBe("run-jwt-token");
      expect(capture.cwd).toBe(workspace);
      expect(capture.prompt).toContain("Squadrail runtime note:");
      expect(capture.prompt).toContain("protocolMessageType: TIMEOUT_ESCALATION");
      expect(capture.prompt).toContain("timeoutCode: review_start_timeout");
      expect(capture.prompt).toContain("protocolPayloadKeys: expiredActorRole, timeoutCode");
      expect(capture.prompt).toContain("workspaceSource: project_shared");
      expect(capture.prompt).toContain("workspaceUsage: review");
      expect(capture.prompt).toContain("workspaceBranchName: squadrail/project-1/reviewer-1/issue-2");
      expect(capture.prompt).toContain("Task brief (auto-generated from Squadrail knowledge):");
      expect(capture.prompt).toContain("# reviewer brief");
      expect(capture.prompt).toContain("symbol=applyRetryPolicy");
      expect(capture.systemPromptFileContent).toContain("Run-specific Squadrail workflow instructions:");
      expect(capture.systemPromptFileContent).toContain("protocolMessageType: TIMEOUT_ESCALATION");
      expect(invocationPrompt).toContain("protocolRecipientRole: tech_lead");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("injects supervisor routing guidance for pm assignment wakes", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "squadrail-claude-supervisor-"));
    const workspace = path.join(root, "workspace");
    const commandPath = path.join(root, "claude");
    const capturePath = path.join(root, "capture.json");
    await fs.mkdir(workspace, { recursive: true });
    await writeFakeClaudeCommand(commandPath);

    try {
      const result = await execute({
        runId: "run-supervisor",
        agent: {
          id: "agent-pm",
          companyId: "company-1",
          name: "Product Manager",
          adapterType: "claude_local",
          adapterConfig: {},
        },
        runtime: {
          sessionId: null,
          sessionParams: null,
          sessionDisplayId: null,
          taskKey: null,
        },
        config: {
          command: commandPath,
          cwd: root,
          env: {
            SQUADRAIL_TEST_CAPTURE_PATH: capturePath,
          },
          promptTemplate: "Clarify and route the task.",
        },
        context: {
          squadrailWorkspace: {
            cwd: workspace,
            source: "project_shared",
            workspaceId: "workspace-supervisor",
            repoUrl: "https://github.com/acme/swiftsight",
            repoRef: "main",
            workspaceUsage: "analysis",
          },
          issueId: "issue-supervisor",
          wakeReason: "issue_assigned",
          protocolMessageType: "ASSIGN_TASK",
          protocolWorkflowStateBefore: "backlog",
          protocolWorkflowStateAfter: "assigned",
          protocolRecipientRole: "pm",
          protocolSenderRole: "human_board",
          protocolSummary: "PM must clarify and route the delivery slice",
        },
        authToken: "run-jwt-token",
        onLog: async () => {},
        onMeta: async () => {},
      });

      expect(result.exitCode).toBe(0);

      const capture = JSON.parse(await fs.readFile(capturePath, "utf8")) as CapturePayload;
      expect(capture.prompt).toContain("Protocol-only wake.");
      expect(capture.prompt).not.toContain("Clarify and route the task.");
      expect(capture.prompt).toContain("IMMEDIATE PROTOCOL ACTION:");
      expect(capture.prompt).toContain("Run this first:");
      expect(capture.prompt).toContain("SHORT PROTOCOL LANE:");
      expect(capture.prompt).toContain("Route with `REASSIGN_TASK` when the execution owner is clear.");
      expect(capture.prompt).toContain("Structured wake context:");
      expect(capture.systemPromptFileContent).toContain("IMMEDIATE PROTOCOL ACTION:");
      expect(capture.systemPromptFileContent).toContain('reassign-task --issue "issue-supervisor" --payload');
      expect(capture.systemPromptFileContent).not.toContain("Clarify and route the task.");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("omits static instructions files for protocol-only wakes", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "squadrail-claude-protocol-only-"));
    const workspace = path.join(root, "workspace");
    const commandPath = path.join(root, "claude");
    const capturePath = path.join(root, "capture.json");
    const instructionsPath = path.join(root, "agent-instructions.md");
    await fs.mkdir(workspace, { recursive: true });
    await writeFakeClaudeCommand(commandPath);
    await fs.writeFile(instructionsPath, "STATIC SUPERVISOR INSTRUCTIONS SHOULD NOT BE INCLUDED", "utf8");

    try {
      const result = await execute({
        runId: "run-protocol-only",
        agent: {
          id: "agent-reviewer",
          companyId: "company-1",
          name: "Claude Reviewer",
          adapterType: "claude_local",
          adapterConfig: {},
        },
        runtime: {
          sessionId: null,
          sessionParams: null,
          sessionDisplayId: null,
          taskKey: null,
        },
        config: {
          command: commandPath,
          cwd: root,
          env: {
            SQUADRAIL_TEST_CAPTURE_PATH: capturePath,
          },
          instructionsFilePath: instructionsPath,
          promptTemplate: "Review the current Squadrail task.",
        },
        context: {
          squadrailWorkspace: {
            cwd: workspace,
            source: "project_shared",
            workspaceId: "workspace-reviewer",
            repoUrl: "https://github.com/acme/swiftsight",
            repoRef: "main",
            workspaceUsage: "review",
          },
          issueId: "issue-protocol-only",
          wakeReason: "protocol_review_requested",
          protocolMessageType: "SUBMIT_FOR_REVIEW",
          protocolWorkflowStateBefore: "submitted_for_review",
          protocolWorkflowStateAfter: "under_review",
          protocolRecipientRole: "reviewer",
        },
        onLog: async () => {},
        onMeta: async () => {},
      });

      expect(result.exitCode).toBe(0);

      const capture = JSON.parse(await fs.readFile(capturePath, "utf8")) as CapturePayload;
      expect(capture.prompt).toContain("Protocol-only wake.");
      expect(capture.systemPromptFileContent).toContain("Run-specific Squadrail workflow instructions:");
      expect(capture.systemPromptFileContent).not.toContain("STATIC SUPERVISOR INSTRUCTIONS SHOULD NOT BE INCLUDED");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("skips Claude session resume when the wake requests a fresh adapter session", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "squadrail-claude-fresh-session-"));
    const workspace = path.join(root, "workspace");
    const commandPath = path.join(root, "claude");
    const capturePath = path.join(root, "capture.json");
    await fs.mkdir(workspace, { recursive: true });
    await writeFakeClaudeCommand(commandPath);

    const stderrLogs: string[] = [];
    try {
      const result = await execute({
        runId: "run-fresh-session",
        agent: {
          id: "agent-reviewer",
          companyId: "company-1",
          name: "Claude Reviewer",
          adapterType: "claude_local",
          adapterConfig: {},
        },
        runtime: {
          sessionId: "claude-session-stale",
          sessionParams: {
            sessionId: "claude-session-stale",
            cwd: workspace,
          },
          sessionDisplayId: "claude-session-stale",
          taskKey: null,
        },
        config: {
          command: commandPath,
          cwd: root,
          env: {
            SQUADRAIL_TEST_CAPTURE_PATH: capturePath,
          },
          promptTemplate: "Review the current Squadrail task.",
        },
        context: {
          squadrailWorkspace: {
            cwd: workspace,
            source: "project_shared",
            workspaceId: "workspace-fresh",
            repoUrl: "https://github.com/acme/swiftsight",
            repoRef: "main",
            workspaceUsage: "review",
          },
          issueId: "issue-fresh",
          wakeReason: "protocol_review_requested",
          forceFreshAdapterSession: true,
        },
        onLog: async (stream, chunk) => {
          if (stream === "stderr") stderrLogs.push(chunk);
        },
        onMeta: async () => {},
      });

      expect(result.exitCode).toBe(0);

      const capture = JSON.parse(await fs.readFile(capturePath, "utf8")) as CapturePayload;
      expect(capture.argv).not.toContain("--resume");
      expect(capture.argv).not.toContain("claude-session-stale");
      expect(stderrLogs.join("")).toContain("Forcing a fresh Claude session for this wake.");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("marks incomplete Claude streams as retryable adapter failures", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "squadrail-claude-stream-incomplete-"));
    const commandPath = path.join(root, "claude");
    await writeStreamIncompleteClaudeCommand(commandPath);

    try {
      const result = await execute({
        runId: "run-stream-incomplete",
        agent: {
          id: "agent-1",
          companyId: "company-1",
          name: "Claude Reviewer",
          adapterType: "claude_local",
          adapterConfig: {},
        },
        runtime: {
          sessionId: null,
          sessionParams: null,
          sessionDisplayId: null,
          taskKey: null,
        },
        config: {
          command: commandPath,
          cwd: root,
          promptTemplate: "Continue the task.",
        },
        context: {},
        onLog: async () => {},
        onMeta: async () => {},
      });

      expect(result.exitCode).toBe(143);
      expect(result.errorCode).toBe("claude_stream_incomplete");
      expect(result.sessionId).toBe("claude-session-incomplete");
      expect(result.resultJson).toEqual(expect.objectContaining({
        subtype: "stream_incomplete",
        session_id: "claude-session-incomplete",
      }));
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
