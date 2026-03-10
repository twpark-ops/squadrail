import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execute } from "@squadrail/adapter-claude-local/server";

async function writeFakeClaudeCommand(commandPath: string): Promise<void> {
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

type CapturePayload = {
  argv: string[];
  cwd: string;
  prompt: string;
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
      expect(capture.prompt).toContain("Mandatory protocol gate:");
      expect(capture.prompt).toContain("REQUIRED WORKFLOW GATE: this wake expects routing, clarification, or escalation.");
      expect(capture.prompt).toContain("You are explicitly allowed to route this issue with `REASSIGN_TASK`.");
      expect(capture.prompt).toContain("Do not handcraft Python/curl/urllib/fetch POSTs for protocol messages in this run.");
      expect(capture.prompt).toContain("Minimal REASSIGN_TASK example");
      expect(capture.prompt).toContain("Exact helper command form:");
      expect(capture.prompt).toContain("Required payload keys: reason, newAssigneeAgentId, newReviewerAgentId");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
