import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execute } from "@squadrail/adapter-codex-local/server";

const SQUADRAIL_SKILL_PATH = fileURLToPath(new URL("../../../skills/squadrail", import.meta.url));

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
  it("repairs broken Codex Squadrail skill links before execution", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "squadrail-codex-skill-repair-"));
    const workspace = path.join(root, "workspace");
    const commandPath = path.join(root, "codex");
    const codexHome = path.join(root, "codex-home");
    const skillsHome = path.join(codexHome, "skills");
    const brokenSkillTarget = path.join(skillsHome, "squadrail");
    const previousCodexHome = process.env.CODEX_HOME;
    await fs.mkdir(workspace, { recursive: true });
    await fs.mkdir(skillsHome, { recursive: true });
    await writeFakeCodexCommand(commandPath);
    await fs.symlink(path.join(root, "missing-squadrail-skill"), brokenSkillTarget);

    try {
      process.env.CODEX_HOME = codexHome;
      const result = await execute({
        runId: "run-skill-repair",
        agent: {
          id: "agent-skill-repair",
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
          promptTemplate: "Repair Squadrail skills before execution.",
        },
        context: {
          squadrailWorkspace: {
            cwd: workspace,
            source: "project_shared",
            workspaceId: "workspace-skill-repair",
            repoUrl: "https://github.com/acme/swiftsight",
            repoRef: "main",
            workspaceUsage: "analysis",
          },
        },
        authToken: "run-jwt-token",
        onLog: async () => {},
        onMeta: async () => {},
      });

      expect(result.exitCode).toBe(0);
      expect((await fs.lstat(brokenSkillTarget)).isSymbolicLink()).toBe(true);
      expect(await fs.realpath(brokenSkillTarget)).toBe(
        await fs.realpath(SQUADRAIL_SKILL_PATH),
      );
    } finally {
      if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previousCodexHome;
      await fs.rm(root, { recursive: true, force: true });
    }
  });

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
      expect(capture.prompt).toContain("Mandatory protocol gate:");
      expect(capture.prompt).toContain("REQUIRED WORKFLOW GATE: this wake expects assignment acceptance or escalation.");
      expect(capture.prompt).toContain("The first protocol action before repository work must be one of: ACK_ASSIGNMENT, ASK_CLARIFICATION, ESCALATE_BLOCKER.");
      expect(capture.prompt).toContain("If this run ends without the required protocol message, Squadrail will mark the run failed.");
      expect(capture.prompt).toContain("scripts/runtime/squadrail-protocol.mjs");
      expect(capture.prompt).toContain("Do not handcraft Python/curl/urllib/fetch POSTs for protocol messages in this run.");
      expect(capture.prompt).toContain("Any ad-hoc POST to `/protocol/messages` counts as a workflow failure when the helper supports that transition.");
      expect(capture.prompt).toContain("Do not start file reads, design notes, or implementation planning before the first protocol action is sent.");
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

  it("injects artifact-first review guidance for reviewer wakes", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "squadrail-codex-review-"));
    const workspace = path.join(root, "workspace");
    const commandPath = path.join(root, "codex");
    const capturePath = path.join(root, "capture.json");
    await fs.mkdir(workspace, { recursive: true });
    await writeFakeCodexCommand(commandPath);

    try {
      const result = await execute({
        runId: "run-review",
        agent: {
          id: "agent-reviewer",
          companyId: "company-1",
          name: "Codex Reviewer",
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
          promptTemplate: "Review the submitted implementation.",
        },
        context: {
          squadrailWorkspace: {
            cwd: workspace,
            source: "project_shared",
            workspaceId: "workspace-review",
            repoUrl: "https://github.com/acme/swiftsight",
            repoRef: "main",
            workspaceUsage: "review",
          },
          issueId: "issue-review",
          wakeReason: "protocol_review_requested",
          protocolMessageType: "SUBMIT_FOR_REVIEW",
          protocolWorkflowStateBefore: "implementing",
          protocolWorkflowStateAfter: "submitted_for_review",
          protocolRecipientRole: "reviewer",
          protocolSenderRole: "engineer",
          protocolSummary: "Implementation ready for review",
          protocolPayload: {
            implementationSummary: "Removed the hard-coded version.",
            diffSummary: "2 files changed, 52 insertions(+), 5 deletions(-)",
            changedFiles: ["internal/observability/tracing.go", "internal/observability/tracing_test.go"],
            testResults: ["go test ./internal/observability -count=1: PASS"],
            evidence: ["createResource now calls resolveServiceVersion()."],
            reviewChecklist: ["Version is no longer hard-coded."],
            residualRisks: ["Fallback remains necessary without build stamping."],
          },
          reviewSubmission: {
            implementationSummary: "Removed the hard-coded version.",
            diffSummary: "2 files changed, 52 insertions(+), 5 deletions(-)",
            changedFiles: ["internal/observability/tracing.go", "internal/observability/tracing_test.go"],
            testResults: ["go test ./internal/observability -count=1: PASS"],
            evidence: ["createResource now calls resolveServiceVersion()."],
            reviewChecklist: ["Version is no longer hard-coded."],
            residualRisks: ["Fallback remains necessary without build stamping."],
            implementationWorkspace: {
              bindingType: "implementation_workspace",
              cwd: "/tmp/.squadrail-worktrees/swiftsight-cloud/review-run",
            },
            diffArtifact: {
              kind: "diff",
              label: "2 files changed, 52 insertions(+), 5 deletions(-)",
            },
            verificationArtifacts: [
              {
                kind: "test_run",
                label: "go test ./internal/observability -count=1",
                observedStatus: "passed",
              },
            ],
          },
        },
        authToken: "run-jwt-token",
        onLog: async () => {},
        onMeta: async () => {},
      });

      expect(result.exitCode).toBe(0);

      const capture = JSON.parse(await fs.readFile(capturePath, "utf8")) as CapturePayload;
      expect(capture.prompt).toContain("Review artifacts first.");
      expect(capture.prompt).toContain("shared review workspace may still reflect base HEAD");
      expect(capture.prompt).toContain("Review submission context:");
      expect(capture.prompt).toContain("implementationWorkspace: /tmp/.squadrail-worktrees/swiftsight-cloud/review-run");
      expect(capture.prompt).toContain("changedFiles: internal/observability/tracing.go, internal/observability/tracing_test.go");
      expect(capture.prompt).toContain("submittedTestResults:");
      expect(capture.prompt).toContain("go test ./internal/observability -count=1: PASS");
      expect(capture.prompt).toContain("verificationArtifacts:");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("injects explicit mergeStatus guidance for tech lead approval wakes", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "squadrail-codex-close-"));
    const workspace = path.join(root, "workspace");
    const commandPath = path.join(root, "codex");
    const capturePath = path.join(root, "capture.json");
    await fs.mkdir(workspace, { recursive: true });
    await writeFakeCodexCommand(commandPath);

    try {
      const result = await execute({
        runId: "run-close",
        agent: {
          id: "agent-tech-lead",
          companyId: "company-1",
          name: "Tech Lead",
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
          promptTemplate: "Close the approved task.",
        },
        context: {
          squadrailWorkspace: {
            cwd: workspace,
            source: "project_shared",
            workspaceId: "workspace-close",
            repoUrl: "https://github.com/acme/swiftsight",
            repoRef: "main",
            workspaceUsage: "review",
          },
          issueId: "issue-close",
          wakeReason: "issue_ready_for_closure",
          protocolMessageType: "APPROVE_IMPLEMENTATION",
          protocolWorkflowStateBefore: "under_review",
          protocolWorkflowStateAfter: "approved",
          protocolRecipientRole: "tech_lead",
          protocolSenderRole: "reviewer",
          protocolSummary: "Implementation approved and ready for closure",
        },
        authToken: "run-jwt-token",
        onLog: async () => {},
        onMeta: async () => {},
      });

      expect(result.exitCode).toBe(0);

      const capture = JSON.parse(await fs.readFile(capturePath, "utf8")) as CapturePayload;
      expect(capture.prompt).toContain("Minimal CLOSE_TASK example");
      expect(capture.prompt).toContain("Exact helper command form:");
      expect(capture.prompt).toContain("Required payload keys: closeReason, closureSummary, verificationSummary, rollbackPlan, finalArtifacts, finalTestStatus, mergeStatus, remainingRisks");
      expect(capture.prompt).toContain("For `CLOSE_TASK.payload.mergeStatus`, use exactly one of: `merged`, `merge_not_required`, `pending_external_merge`.");
      expect(capture.prompt).toContain("Never invent aliases such as `merge_pending`, `merge_required`, or free-form merge labels.");
      expect(capture.prompt).toContain("If code is approved but merge has not happened yet, use `pending_external_merge` and explain the external merge owner in `remainingRisks[]`.");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("injects supervisor routing guidance for pm assignment wakes", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "squadrail-codex-supervisor-"));
    const workspace = path.join(root, "workspace");
    const commandPath = path.join(root, "codex");
    const capturePath = path.join(root, "capture.json");
    await fs.mkdir(workspace, { recursive: true });
    await writeFakeCodexCommand(commandPath);

    try {
      const result = await execute({
        runId: "run-supervisor",
        agent: {
          id: "agent-pm",
          companyId: "company-1",
          name: "Product Manager",
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
      expect(capture.prompt).toContain("Do not inspect repository files, search the codebase, or draft implementation notes before the first routing action is recorded.");
      expect(capture.prompt).toContain("Do not handcraft Python/curl/urllib/fetch POSTs for protocol messages in this run.");
      expect(capture.prompt).toContain("Any ad-hoc POST to `/protocol/messages` counts as a workflow failure when the helper supports that transition.");
      expect(capture.prompt).toContain("Minimal REASSIGN_TASK example");
      expect(capture.prompt).toContain("Exact helper command form:");
      expect(capture.prompt).toContain("Required payload keys: reason, newAssigneeAgentId, newReviewerAgentId");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
