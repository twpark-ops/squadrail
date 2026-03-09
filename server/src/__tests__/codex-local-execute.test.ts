import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execute } from "@squadrail/adapter-codex-local/server";

async function writeFakeCodexCommand(commandPath: string): Promise<void> {
  const script = `#!/usr/bin/env node
const fs = require("node:fs");

const capturePath = process.env.SQUADRAIL_TEST_CAPTURE_PATH;
const payload = {
  argv: process.argv.slice(2),
  cwd: process.cwd(),
  prompt: fs.readFileSync(0, "utf8"),
  squadrailEnvKeys: Object.keys(process.env)
    .filter((key) => key.startsWith("SQUADRAIL_"))
    .sort(),
  squadrailApiKey: process.env.SQUADRAIL_API_KEY ?? null,
};
if (capturePath) {
  fs.writeFileSync(capturePath, JSON.stringify(payload), "utf8");
}
console.log(JSON.stringify({ type: "thread.started", thread_id: "thread-1" }));
console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "hello" } }));
console.log(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 10, cached_input_tokens: 1, output_tokens: 3 } }));
`;
  await fs.writeFile(commandPath, script, "utf8");
  await fs.chmod(commandPath, 0o755);
}

type CapturePayload = {
  argv: string[];
  cwd: string;
  prompt: string;
  squadrailEnvKeys: string[];
  squadrailApiKey: string | null;
};

describe("codex execute", () => {
  it("injects runtime note with protocol wake context", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "squadrail-codex-execute-"));
    const workspace = path.join(root, "workspace");
    const commandPath = path.join(root, "codex");
    const capturePath = path.join(root, "capture.json");
    await fs.mkdir(workspace, { recursive: true });
    await writeFakeCodexCommand(commandPath);

    let invocationPrompt = "";
    try {
      const result = await execute({
        runId: "run-1",
        agent: {
          id: "agent-1",
          companyId: "company-1",
          name: "Codex Engineer",
          adapterType: "codex_local",
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
          promptTemplate: "Follow the Squadrail heartbeat.",
        },
        context: {
          squadrailWorkspace: {
            cwd: workspace,
            source: "project_shared",
            workspaceId: "workspace-1",
            repoUrl: "https://github.com/acme/swiftsight",
            repoRef: "main",
            workspaceUsage: "analysis",
          },
          issueId: "issue-1",
          wakeReason: "issue_assigned",
          protocolMessageType: "ASSIGN_TASK",
          protocolWorkflowStateBefore: "backlog",
          protocolWorkflowStateAfter: "assigned",
          protocolRecipientRole: "engineer",
          protocolSenderRole: "tech_lead",
          protocolSummary: "Assignment created",
          protocolPayload: {
            goal: "Implement retry policy",
            reviewerAgentId: "reviewer-1",
          },
          taskBrief: {
            id: "brief-1",
            scope: "engineer",
            retrievalRunId: "retrieval-1",
            contentMarkdown: "# engineer brief\n\n## Context\n- Reuse retry policy.\n",
            evidence: [
              {
                rank: 1,
                sourceType: "adr",
                path: "docs/adr/retry-policy.md",
                fusedScore: 0.91,
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
      expect(result.errorMessage).toBeNull();

      const capture = JSON.parse(await fs.readFile(capturePath, "utf8")) as CapturePayload;
      expect(capture.argv).toEqual(
        expect.arrayContaining(["--dangerously-bypass-approvals-and-sandbox"]),
      );
      expect(capture.squadrailEnvKeys).toEqual(
        expect.arrayContaining([
          "SQUADRAIL_AGENT_ID",
          "SQUADRAIL_API_KEY",
          "SQUADRAIL_API_URL",
          "SQUADRAIL_COMPANY_ID",
          "SQUADRAIL_RUN_ID",
          "SQUADRAIL_TASK_ID",
          "SQUADRAIL_WAKE_REASON",
          "SQUADRAIL_WORKSPACE_USAGE",
        ]),
      );
      expect(capture.squadrailApiKey).toBe("run-jwt-token");
      expect(capture.cwd).toBe(workspace);
      expect(capture.prompt).toContain("Squadrail runtime note:");
      expect(capture.prompt).toContain("protocolMessageType: ASSIGN_TASK");
      expect(capture.prompt).toContain("protocolWorkflow: backlog -> assigned");
      expect(capture.prompt).toContain("protocolSummary: Assignment created");
      expect(capture.prompt).toContain("workspaceSource: project_shared");
      expect(capture.prompt).toContain("workspaceUsage: analysis");
      expect(capture.prompt).toContain("Task brief (auto-generated from Squadrail knowledge):");
      expect(capture.prompt).toContain("# engineer brief");
      expect(capture.prompt).toContain("docs/adr/retry-policy.md");
      expect(invocationPrompt).toContain("protocolRecipientRole: engineer");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("adds --skip-git-repo-check for isolated project workspaces", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "squadrail-codex-isolated-"));
    const workspace = path.join(root, "workspace");
    const commandPath = path.join(root, "codex");
    const capturePath = path.join(root, "capture.json");
    await fs.mkdir(workspace, { recursive: true });
    await writeFakeCodexCommand(commandPath);

    try {
      const result = await execute({
        runId: "run-2",
        agent: {
          id: "agent-2",
          companyId: "company-1",
          name: "Codex Engineer",
          adapterType: "codex_local",
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
          promptTemplate: "Run inside isolated workspace.",
        },
        context: {
          squadrailWorkspace: {
            cwd: workspace,
            source: "project_isolated",
            workspaceId: "workspace-2",
            repoUrl: "https://github.com/acme/swiftsight",
            repoRef: "main",
            workspaceUsage: "implementation",
          },
        },
        authToken: "run-jwt-token",
        onLog: async () => {},
        onMeta: async () => {},
      });

      expect(result.exitCode).toBe(0);

      const capture = JSON.parse(await fs.readFile(capturePath, "utf8")) as CapturePayload;
      expect(capture.argv).toEqual(expect.arrayContaining(["--skip-git-repo-check"]));
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
