#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { access, mkdir, mkdtemp, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertBypassOnlyOnLocalhost } from "./full-delivery-guards.mjs";
import { findCloseWakeEvidence } from "./close-wake-evidence.mjs";
import { assertCanonicalScenarioOne } from "./full-delivery-invariants.mjs";
import {
  assertMergeDeployFollowupScenario,
  findCloseFollowupRun,
} from "./merge-deploy-followup-invariants.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const HOST = process.env.HOST ?? "127.0.0.1";
const PREFERRED_PORT = Number(process.env.PORT ?? "3312");
let runtimePort = PREFERRED_PORT;
let runtimeBaseUrl = `http://${HOST}:${runtimePort}`;
const E2E_TIMEOUT_MS = Number(process.env.E2E_TIMEOUT_MS ?? 8 * 60 * 1000);
const POLL_INTERVAL_MS = Number(process.env.E2E_POLL_INTERVAL_MS ?? 4000);

function note(message) {
  process.stdout.write(`${message}\n`);
}

function section(title) {
  note("");
  note("=".repeat(88));
  note(title);
  note("=".repeat(88));
}

async function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? REPO_ROOT,
      env: { ...process.env, ...(options.env ?? {}) },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0 || options.allowFailure) {
        resolve({ code: code ?? 0, stdout, stderr });
        return;
      }
      reject(
        new Error(
          `${command} ${args.join(" ")} failed with exit code ${code}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
        ),
      );
    });
  });
}

async function api(pathname, options = {}) {
  const response = await fetch(`${runtimeBaseUrl}${pathname}`, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const contentType = response.headers.get("content-type") ?? "";
  const body =
    contentType.includes("application/json")
      ? await response.json()
      : await response.text();

  if (!response.ok) {
    throw new Error(
      `API ${options.method ?? "GET"} ${pathname} failed with ${response.status}: ${
        typeof body === "string" ? body : JSON.stringify(body)
      }`,
    );
  }
  return body;
}

async function waitForHealth() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 60_000) {
    try {
      await api("/health");
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw new Error(`Timed out waiting for ${runtimeBaseUrl}/health`);
}

async function resolveAvailablePort(host, preferredPort) {
  const attempt = (port) =>
    new Promise((resolve, reject) => {
      const server = createServer();
      server.once("error", reject);
      server.listen(port, host, () => {
        const address = server.address();
        if (!address || typeof address === "string") {
          server.close(() => reject(new Error("Could not resolve a listening port")));
          return;
        }
        server.close((closeError) => {
          if (closeError) {
            reject(closeError);
            return;
          }
          resolve(address.port);
        });
      });
    });

  try {
    return await attempt(preferredPort);
  } catch {
    return attempt(0);
  }
}

function fixturePackageJson() {
  return JSON.stringify(
    {
      name: "squadrail-delivery-e2e-fixture",
      private: true,
      type: "module",
      scripts: {
        test: "node --test",
        build: "node --input-type=module -e \"import('./src/release-label.js').then(m => console.log(m.normalizeReleaseLabel(' Build / Candidate ')))\"",
      },
    },
    null,
    2,
  );
}

function fixtureHelperScript() {
  return String.raw`#!/usr/bin/env node
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const issueId = process.env.SQUADRAIL_TASK_ID ?? process.env.SQUADRAIL_ISSUE_ID;
const runId = process.env.SQUADRAIL_RUN_ID ?? "";
const apiUrl = process.env.SQUADRAIL_API_URL;
const apiKey = process.env.SQUADRAIL_API_KEY;
const agentId = process.env.SQUADRAIL_AGENT_ID;

if (!issueId || !apiUrl || !apiKey || !agentId) {
  throw new Error("Missing required Squadrail runtime env: issueId/apiUrl/apiKey/agentId");
}

function assertState(state, allowed, action) {
  if (!allowed.includes(state.workflowState)) {
    throw new Error(action + " requires protocol state in " + allowed.join(", ") + ", got " + state.workflowState);
  }
}

async function request(pathname, options = {}) {
  const response = await fetch(apiUrl + pathname, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + apiKey,
      "X-Squadrail-Run-Id": runId,
      ...(options.headers ?? {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const contentType = response.headers.get("content-type") ?? "";
  const body =
    contentType.includes("application/json")
      ? await response.json()
      : await response.text();
  if (!response.ok) {
    throw new Error(
      (options.method ?? "GET") +
        " " +
        pathname +
        " failed with " +
        response.status +
        ": " +
        (typeof body === "string" ? body : JSON.stringify(body)),
    );
  }
  return body;
}

async function getState() {
  return request("/api/issues/" + issueId + "/protocol/state");
}

async function getMessages() {
  return request("/api/issues/" + issueId + "/protocol/messages");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForWorkflowState(allowedStates, timeoutMs = 15000) {
  const startedAt = Date.now();
  let latestState = null;
  while (Date.now() - startedAt < timeoutMs) {
    const state = await getState();
    latestState = state;
    if (allowedStates.includes(state.workflowState)) {
      return state;
    }
    await sleep(500);
  }
  throw new Error(
    "Timed out waiting for protocol state in " +
      allowedStates.join(", ") +
      ", got " +
      (latestState?.workflowState ?? "unknown"),
  );
}

async function changedFiles() {
  const { stdout } = await execFileAsync("git", ["diff", "--name-only", "HEAD"]);
  return stdout
    .split(/\r?\n/u)
    .map((value) => value.trim())
    .filter(Boolean);
}

async function sendMessage(message) {
  return request("/api/issues/" + issueId + "/protocol/messages", {
    method: "POST",
    body: message,
  });
}

async function engineerPrime() {
  const state = await getState();
  if (state.workflowState === "assigned") {
    await sendMessage({
      messageType: "ACK_ASSIGNMENT",
      sender: { actorType: "agent", actorId: agentId, role: "engineer" },
      recipients: [{ recipientType: "agent", recipientId: agentId, role: "engineer" }],
      workflowStateBefore: "assigned",
      workflowStateAfter: "accepted",
      summary: "Accepted the delivery fixture assignment.",
      payload: {
        accepted: true,
        understoodScope: "Fix normalizeReleaseLabel in the isolated implementation workspace.",
        initialRisks: ["Base workspace must remain unchanged while implementation happens in an isolated worktree."],
      },
      artifacts: [],
    });
  }

  const refreshed = await waitForWorkflowState(["accepted", "planning", "changes_requested"]);
  assertState(refreshed, ["accepted", "planning", "changes_requested"], "START_IMPLEMENTATION");
  await sendMessage({
    messageType: "START_IMPLEMENTATION",
    sender: { actorType: "agent", actorId: agentId, role: "engineer" },
    recipients: [{ recipientType: "agent", recipientId: agentId, role: "engineer" }],
    workflowStateBefore: refreshed.workflowState,
    workflowStateAfter: "implementing",
    summary: "Starting isolated implementation for the delivery fixture issue.",
    payload: {
      implementationMode: "direct",
      activeHypotheses: [
        "normalizeReleaseLabel should collapse separators into single hyphens",
        "only the isolated implementation worktree should change",
      ],
    },
    artifacts: [],
  });
}

async function engineerSubmitReview() {
  const state = await getState();
  assertState(state, ["implementing"], "SUBMIT_FOR_REVIEW");
  if (!state.reviewerAgentId) {
    throw new Error("Reviewer agent is missing from protocol state");
  }
  const files = await changedFiles();
  if (files.length === 0) {
    throw new Error("No changed files detected in the implementation workspace");
  }
  await sendMessage({
    messageType: "SUBMIT_FOR_REVIEW",
    sender: { actorType: "agent", actorId: agentId, role: "engineer" },
    recipients: [{ recipientType: "agent", recipientId: state.reviewerAgentId, role: "reviewer" }],
    workflowStateBefore: "implementing",
    workflowStateAfter: "submitted_for_review",
    summary: "Implementation is ready for review with green test and build output.",
    payload: {
      implementationSummary: "Updated normalizeReleaseLabel to normalize separators and collapse duplicates.",
      evidence: [
        "Inspected the failing node:test cases first",
        "Validated the fix with pnpm test",
        "Validated module import with pnpm build",
      ],
      reviewChecklist: [
        "Normalization logic only changed in src/release-label.js",
        "No test files or package metadata changed",
        "Fixture still relies on isolated implementation worktree",
      ],
      changedFiles: files,
      testResults: ["pnpm test", "pnpm build"],
      residualRisks: ["Base workspace has not been merged yet; change remains in the isolated implementation workspace."],
      diffSummary: "normalizeReleaseLabel now converts separators to single hyphens and trims duplicate punctuation.",
    },
    artifacts: [],
  });
}

function latestMessage(messages, messageType) {
  return [...messages].reverse().find((message) => message.messageType === messageType) ?? null;
}

async function reviewerApprove() {
  let state = await getState();
  if (state.workflowState === "submitted_for_review") {
    await sendMessage({
      messageType: "START_REVIEW",
      sender: { actorType: "agent", actorId: agentId, role: "reviewer" },
      recipients: [{ recipientType: "agent", recipientId: agentId, role: "reviewer" }],
      workflowStateBefore: "submitted_for_review",
      workflowStateAfter: "under_review",
      summary: "Review started for the delivery fixture implementation.",
      payload: {
        reviewCycle: Math.max(1, Number(state.currentReviewCycle ?? 0) + 1),
        reviewFocus: ["correctness", "evidence quality", "delivery contract completeness"],
        blockingReview: false,
      },
      artifacts: [],
    });
    state = await waitForWorkflowState(["under_review", "awaiting_human_decision"]);
  }

  assertState(state, ["under_review", "awaiting_human_decision"], "APPROVE_IMPLEMENTATION");
  const messages = await getMessages();
  const latestSubmit = latestMessage(messages, "SUBMIT_FOR_REVIEW");
  if (!latestSubmit) {
    throw new Error("Cannot approve without a SUBMIT_FOR_REVIEW message");
  }

  const changedFiles = Array.isArray(latestSubmit.payload?.changedFiles)
    ? latestSubmit.payload.changedFiles
    : [];
  const testResults = Array.isArray(latestSubmit.payload?.testResults)
    ? latestSubmit.payload.testResults
    : [];
  const recipients = state.techLeadAgentId
    ? [{ recipientType: "agent", recipientId: state.techLeadAgentId, role: "tech_lead" }]
    : [];

  await sendMessage({
    messageType: "APPROVE_IMPLEMENTATION",
    sender: { actorType: "agent", actorId: agentId, role: "reviewer" },
    recipients,
    workflowStateBefore: state.workflowState,
    workflowStateAfter: "approved",
    summary: "Review complete: the fixture change and evidence satisfy the delivery contract.",
    payload: {
      approvalSummary: "The implementation is scoped correctly and the provided evidence is complete for the fixture task.",
      approvalMode: "agent_review",
      approvalChecklist: [
        "Changed files stay within the expected implementation surface",
        "Test and build evidence were provided",
        "Residual risk is limited to external merge follow-up",
      ],
      verifiedEvidence: [
        ...testResults,
        ...(changedFiles.length > 0 ? ["Changed files: " + changedFiles.join(", ")] : []),
      ],
      residualRisks: ["The isolated implementation workspace still needs external merge handling after closure."],
      followUpActions: ["Record pending external merge in the close message."],
    },
    artifacts: [],
  });
}

async function techLeadClose() {
  const state = await getState();
  assertState(state, ["approved"], "CLOSE_TASK");
  const messages = await getMessages();
  const latestApproval = latestMessage(messages, "APPROVE_IMPLEMENTATION");
  const latestSubmit = latestMessage(messages, "SUBMIT_FOR_REVIEW");
  const changedFiles = Array.isArray(latestSubmit?.payload?.changedFiles)
    ? latestSubmit.payload.changedFiles
    : [];
  await sendMessage({
    messageType: "CLOSE_TASK",
    sender: { actorType: "agent", actorId: agentId, role: "tech_lead" },
    recipients: [{ recipientType: "agent", recipientId: agentId, role: "tech_lead" }],
    workflowStateBefore: "approved",
    workflowStateAfter: "done",
    summary: "Delivery fixture issue closed after review approval.",
    payload: {
      closeReason: "completed",
      closureSummary: "Engineer completed the isolated fix and reviewer approved the handoff.",
      verificationSummary: latestApproval?.payload?.approvalSummary ?? "Reviewer approval recorded with structured evidence.",
      rollbackPlan: "Drop the isolated implementation branch or worktree if a later external merge is rejected.",
      finalArtifacts: [
        "pending_external_merge",
        ...(changedFiles.length > 0 ? ["changed_files:" + changedFiles.join(",")] : []),
      ],
      finalTestStatus: "passed",
      mergeStatus: "pending_external_merge",
      remainingRisks: ["Base workspace remains unchanged until an external merge is performed."],
    },
    artifacts: [],
  });
}

const command = process.argv[2];
if (!command) {
  throw new Error("Usage: node tools/protocol-helper.mjs <engineer-prime|engineer-submit-review|reviewer-approve|techlead-close>");
}

switch (command) {
  case "engineer-prime":
    await engineerPrime();
    break;
  case "engineer-submit-review":
    await engineerSubmitReview();
    break;
  case "reviewer-approve":
    await reviewerApprove();
    break;
  case "techlead-close":
    await techLeadClose();
    break;
  default:
    throw new Error("Unknown command: " + command);
}
`;
}

function engineerInstructions() {
  return [
    "# Delivery Fixture Engineer",
    "",
    "- You are validating Squadrail full delivery automation on a tiny fixture repository.",
    "- Do not edit tests, package.json, or protocol helper scripts.",
    "- The only intended code change is in `src/release-label.js`.",
    "- If `SQUADRAIL_WORKSPACE_USAGE` is not `implementation`, do not change code. Run `node tools/protocol-helper.mjs engineer-prime` and stop.",
    "- In `implementation` workspace usage:",
    "  1. Run `pnpm test` to observe the current failure.",
    "  2. Fix `normalizeReleaseLabel` in `src/release-label.js`.",
    "  3. Run `pnpm test` until it passes.",
    "  4. Run `pnpm build` and keep it green.",
    "  5. Run `node tools/protocol-helper.mjs engineer-submit-review`.",
    "- Keep the change minimal and reversible.",
    "- Never move to review without green `pnpm test` and `pnpm build` output in the current run.",
  ].join("\n");
}

function reviewerInstructions() {
  return [
    "# Delivery Fixture Reviewer",
    "",
    "- You are validating the review handoff loop for Squadrail.",
    "- Do not edit code.",
    "- Ignore wakes unless the current workflow state is `submitted_for_review`, `under_review`, or `awaiting_human_decision`.",
    "- When the implementation is ready, review the latest `SUBMIT_FOR_REVIEW` message and confirm:",
    "  - changed files stay within the expected implementation surface",
    "  - test and build evidence are present",
    "  - residual risk is limited to pending external merge",
    "- Then run `node tools/protocol-helper.mjs reviewer-approve`.",
    "- Do not escalate to human decision for this fixture unless the protocol state is inconsistent.",
  ].join("\n");
}

function techLeadInstructions() {
  return [
    "# Delivery Fixture Tech Lead",
    "",
    "- You are closing the delivery loop after reviewer approval.",
    "- Do not edit code.",
    "- If `SQUADRAIL_WAKE_REASON` is not `issue_ready_for_closure`, do not inspect files or helper internals. Exit quietly.",
    "- Ignore wakes unless the current workflow state is `approved`.",
    "- Do not read `tools/protocol-helper.mjs`, do not inspect repository files, and do not improvise a different close payload in this wake.",
    "- When approved, run the exact command block below as your first and only protocol action, then stop.",
    "",
    "```bash",
    "node \"$SQUADRAIL_PROTOCOL_HELPER_PATH\" close-task --issue \"$SQUADRAIL_TASK_ID\" --close-reason completed --summary \"Reviewer approved implementation; recording closure with external merge still pending.\" --closure-summary \"Delivery fixture implementation and review handoff are complete in this isolated workspace; final merge remains pending in external repository workflow.\" --verification-summary \"Reviewer issued APPROVE_IMPLEMENTATION and confirmed contract evidence; no additional repository actions were required in this wake.\" --rollback-plan \"If post-merge issues surface, revert the merge commit in the target branch and reopen implementation follow-up from the approved patch baseline.\" --final-artifacts \"pending_external_merge||delivery-handoff:completed\" --final-test-status passed --merge-status pending_external_merge --remaining-risks \"External merge not executed yet; owner: repository maintainer/merge operator outside isolated worktree.\"",
    "```",
  ].join("\n");
}

function pmInstructions() {
  return [
    "# Delivery Fixture PM",
    "",
    "- You are present only to satisfy PM intake routing requirements for the canonical full-delivery harness.",
    "- Do not edit code.",
    "- Do not send protocol messages from autonomous wakes in this fixture.",
    "- The E2E harness will preview and apply PM intake projection explicitly as the board actor.",
  ].join("\n");
}

async function createFixtureRepo(rootDir) {
  await mkdir(path.join(rootDir, "src"), { recursive: true });
  await mkdir(path.join(rootDir, "test"), { recursive: true });
  await mkdir(path.join(rootDir, "tools"), { recursive: true });

  await writeFile(path.join(rootDir, "package.json"), fixturePackageJson());
  await writeFile(
    path.join(rootDir, "README.md"),
    [
      "# Squadrail Delivery Fixture",
      "",
      "This repository exists only for the full delivery E2E harness.",
      "The target bug lives in `src/release-label.js` and should be fixed in an isolated implementation workspace.",
    ].join("\n"),
  );
  await writeFile(
    path.join(rootDir, "src/release-label.js"),
    [
      "export function normalizeReleaseLabel(label) {",
      "  return String(label ?? \"\").trim().toLowerCase();",
      "}",
      "",
      "export function buildReleaseRecord(label) {",
      "  return {",
      "    label: normalizeReleaseLabel(label),",
      "    generatedAt: new Date(0).toISOString(),",
      "  };",
      "}",
    ].join("\n"),
  );
  await writeFile(
    path.join(rootDir, "test/release-label.test.js"),
    [
      "import test from \"node:test\";",
      "import assert from \"node:assert/strict\";",
      "import { buildReleaseRecord, normalizeReleaseLabel } from \"../src/release-label.js\";",
      "",
      "test(\"normalizes whitespace and separators into a single hyphen\", () => {",
      "  assert.equal(normalizeReleaseLabel(\"  Release / Candidate  \"), \"release-candidate\");",
      "});",
      "",
      "test(\"collapses repeated punctuation and preserves lowercase output\", () => {",
      "  assert.equal(normalizeReleaseLabel(\"hotfix___PATCH---1\"), \"hotfix-patch-1\");",
      "});",
      "",
      "test(\"buildReleaseRecord uses the normalized label\", () => {",
      "  assert.deepEqual(buildReleaseRecord(\" Beta / Build \"), {",
      "    label: \"beta-build\",",
      "    generatedAt: new Date(0).toISOString(),",
      "  });",
      "});",
    ].join("\n"),
  );
  await writeFile(path.join(rootDir, "tools/protocol-helper.mjs"), fixtureHelperScript(), { mode: 0o755 });

  await runCommand("git", ["init"], { cwd: rootDir });
  await runCommand("git", ["config", "user.name", "Squadrail E2E"], { cwd: rootDir });
  await runCommand("git", ["config", "user.email", "squadrail-e2e@example.com"], { cwd: rootDir });
  await runCommand("git", ["add", "."], { cwd: rootDir });
  await runCommand("git", ["commit", "-m", "chore(fixture): seed delivery e2e repo"], { cwd: rootDir });
}

function createServerProcess(logPath, env) {
  const logStream = createWriteStream(logPath, { flags: "a" });
  const child = spawn("pnpm", ["exec", "tsx", "src/index.ts"], {
    cwd: path.join(REPO_ROOT, "server"),
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.pipe(logStream);
  child.stderr.pipe(logStream);
  return { child, logStream };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureUiBuilt() {
  try {
    await access(path.join(REPO_ROOT, "ui/dist/index.html"));
  } catch {
    section("UI build missing; building once for embedded server");
    await runCommand("pnpm", ["--filter", "@squadrail/ui", "build"], { cwd: REPO_ROOT });
  }
}

async function probeCodexBinary() {
  const result = await runCommand("bash", ["-lc", "command -v codex"], {
    cwd: REPO_ROOT,
    allowFailure: true,
  });
  if (result.code !== 0 || result.stdout.trim().length === 0) {
    throw new Error("codex binary is not available on PATH");
  }
  return result.stdout.trim();
}

async function createAgentInstructions(rootDir) {
  await mkdir(rootDir, { recursive: true });
  const pmPath = path.join(rootDir, "pm.md");
  const engineerPath = path.join(rootDir, "engineer.md");
  const reviewerPath = path.join(rootDir, "reviewer.md");
  const techLeadPath = path.join(rootDir, "tech-lead.md");
  await writeFile(pmPath, pmInstructions());
  await writeFile(engineerPath, engineerInstructions());
  await writeFile(reviewerPath, reviewerInstructions());
  await writeFile(techLeadPath, techLeadInstructions());
  return { pmPath, engineerPath, reviewerPath, techLeadPath };
}

async function fetchIssueSnapshot(issueId) {
  let lastError = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const [issue, protocolState, protocolMessages, runs, briefs] = await Promise.all([
        api(`/api/issues/${issueId}`),
        api(`/api/issues/${issueId}/protocol/state`),
        api(`/api/issues/${issueId}/protocol/messages`),
        api(`/api/issues/${issueId}/runs`),
        api(`/api/issues/${issueId}/protocol/briefs`),
      ]);
      return { issue, protocolState, protocolMessages, runs, briefs };
    } catch (err) {
      lastError = err;
      const message = err instanceof Error ? err.message : String(err);
      const issueNotReady =
        message.includes(`/api/issues/${issueId} failed with 404`)
        || message.includes(`/api/issues/${issueId}/protocol/state failed with 404`);
      if (!issueNotReady) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw lastError ?? new Error(`Timed out waiting for issue snapshot: ${issueId}`);
}

async function fetchIssueChangeSurface(issueId) {
  return api(`/api/issues/${issueId}/change-surface`);
}

async function fetchTaskSessions(agentId) {
  return api(`/api/agents/${agentId}/task-sessions`);
}

async function fetchRunLog(runId) {
  return api(`/api/heartbeat-runs/${runId}/log?tailBytes=65536`);
}

async function waitForCloseRunSnapshot(issueId, initialSnapshot, timeoutMs = 30_000) {
  const existingCloseRun = findCloseFollowupRun(initialSnapshot);
  if (existingCloseRun?.runId) {
    return initialSnapshot;
  }

  const startedAt = Date.now();
  let latestSnapshot = initialSnapshot;
  while (Date.now() - startedAt < timeoutMs) {
    await sleep(1500);
    latestSnapshot = await fetchIssueSnapshot(issueId);
    const closeRun = findCloseFollowupRun(latestSnapshot);
    if (closeRun?.runId) {
      return latestSnapshot;
    }
  }

  throw new Error("Could not resolve the close follow-up run");
}

async function createPmIntakeIssue(companyId, request) {
  const created = await api(`/api/companies/${companyId}/intake/issues`, {
    method: "POST",
    body: {
      request,
      priority: "high",
    },
  });
  return created.issue ?? created;
}

async function previewProjection(issueId, body = { coordinationOnly: false }) {
  let lastError = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await api(`/api/issues/${issueId}/intake/projection-preview`, {
        method: "POST",
        body,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("Issue not found") || attempt === 4) {
        throw error;
      }
      lastError = error;
      await sleep(250 * (attempt + 1));
    }
  }
  throw lastError ?? new Error(`Projection preview did not become available for issue ${issueId}`);
}

async function applyProjection(issueId, draft) {
  return api(`/api/issues/${issueId}/intake/projection`, {
    method: "POST",
    body: draft,
  });
}

function summarizeMessage(message) {
  return `${message.seq}. ${message.messageType} (${message.workflowStateBefore} -> ${message.workflowStateAfter}) :: ${message.summary}`;
}

function summarizeRun(run) {
  const workspace = run?.resultJson?.workspaceGitSnapshot;
  const changedCount = Array.isArray(workspace?.changedFiles) ? workspace.changedFiles.length : 0;
  return `${run.runId} :: ${run.status} :: ${run.invocationSource ?? "unknown"} :: changedFiles=${changedCount}`;
}

function extractIsolatedWorkspacePath(latestReviewMessage) {
  if (!latestReviewMessage || !Array.isArray(latestReviewMessage.artifacts)) return null;
  for (const artifact of latestReviewMessage.artifacts) {
    const workspaceCwd = artifact?.metadata?.workspace?.cwd;
    if (typeof workspaceCwd === "string" && workspaceCwd.length > 0) {
      return workspaceCwd;
    }
    if (typeof artifact?.metadata?.cwd === "string" && artifact.metadata.cwd.length > 0) {
      return artifact.metadata.cwd;
    }
  }
  return null;
}

async function maybeImportKnowledge(projectId, workspaceId) {
  try {
    const result = await api(`/api/knowledge/projects/${projectId}/import-workspace`, {
      method: "POST",
      body: { workspaceId, maxFiles: 25 },
    });
    note(`Knowledge import completed: ${result.importedFiles} files, ${result.chunkCount} chunks`);
    return { imported: true, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Knowledge embedding provider is not configured")) {
      note(`Knowledge import skipped: ${message}`);
      return { imported: false, skipped: true };
    }
    throw error;
  }
}

async function main() {
  section("Full Delivery E2E");
  note(`Repo root: ${REPO_ROOT}`);
  runtimePort = await resolveAvailablePort(HOST, PREFERRED_PORT);
  runtimeBaseUrl = `http://${HOST}:${runtimePort}`;
  note(`Base URL: ${runtimeBaseUrl}`);
  assertBypassOnlyOnLocalhost(runtimeBaseUrl);

  const codexPath = await probeCodexBinary();
  note(`Codex binary: ${codexPath}`);
  await ensureUiBuilt();

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "squadrail-full-delivery-"));
  const squadrailHome = path.join(tempRoot, "home");
  const fixtureRepo = path.join(tempRoot, "delivery-fixture");
  const agentInstructions = path.join(tempRoot, "agent-instructions");
  const serverLog = path.join(tempRoot, "server.log");

  await createFixtureRepo(fixtureRepo);
  const instructionPaths = await createAgentInstructions(agentInstructions);

  section("Fixture Preflight");
  const fixtureBefore = await runCommand("pnpm", ["test"], {
    cwd: fixtureRepo,
    allowFailure: true,
  });
  if (fixtureBefore.code === 0) {
    throw new Error("Fixture repo unexpectedly passes before agent implementation");
  }
  note("Fixture repo starts in a failing state as expected.");

  section("Server Boot");
  const { child: serverProcess, logStream } = createServerProcess(serverLog, {
    HOST,
    PORT: String(runtimePort),
    SQUADRAIL_HOME: squadrailHome,
    SQUADRAIL_MIGRATION_AUTO_APPLY: "true",
    SQUADRAIL_KNOWLEDGE_BACKFILL_ENABLED: "false",
  });

  let serverExited = false;
  serverProcess.on("exit", () => {
    serverExited = true;
  });

  try {
    await waitForHealth();
    note("Server is healthy.");

    section("Company / Project / Agents");
    const company = await api("/api/companies", {
      method: "POST",
      body: {
        name: "Delivery E2E Co",
        description: "Temporary company for full delivery E2E",
        budgetMonthlyCents: 100000,
      },
    });

    const project = await api(`/api/companies/${company.id}/projects`, {
      method: "POST",
      body: {
        name: "Delivery Fixture",
        description: "Temporary git repo for golden full delivery verification",
        status: "in_progress",
        workspace: {
          name: "Delivery Fixture Workspace",
          cwd: fixtureRepo,
          isPrimary: true,
          executionPolicy: {
            mode: "isolated",
            applyFor: ["implementation"],
            isolationStrategy: "worktree",
            branchTemplate: "squadrail/e2e/{issueId}/{agentId}",
          },
        },
      },
    });

    const primaryWorkspace = Array.isArray(project.workspaces)
      ? project.workspaces.find((workspace) => workspace.isPrimary) ?? project.workspaces[0]
      : null;
    if (!primaryWorkspace?.id) {
      throw new Error("Primary project workspace was not created");
    }

    const adapterProbe = await api(`/api/companies/${company.id}/adapters/codex_local/test-environment`, {
      method: "POST",
      body: { adapterConfig: { cwd: fixtureRepo } },
    });
    note(`Adapter environment probe: ${JSON.stringify(adapterProbe)}`);

    const pm = await api(`/api/companies/${company.id}/agents`, {
      method: "POST",
      body: {
        name: "Delivery PM",
        role: "pm",
        title: "Product Manager",
        adapterType: "codex_local",
        adapterConfig: {
          cwd: fixtureRepo,
          instructionsFilePath: instructionPaths.pmPath,
          dangerouslyBypassApprovalsAndSandbox: true,
          search: false,
        },
        runtimeConfig: {},
        budgetMonthlyCents: 0,
      },
    });

    const techLead = await api(`/api/companies/${company.id}/agents`, {
      method: "POST",
      body: {
        name: "Delivery Lead",
        role: "general",
        title: "Tech Lead",
        adapterType: "codex_local",
        adapterConfig: {
          cwd: fixtureRepo,
          instructionsFilePath: instructionPaths.techLeadPath,
          dangerouslyBypassApprovalsAndSandbox: true,
          search: false,
        },
        runtimeConfig: {},
        budgetMonthlyCents: 0,
      },
    });

    const engineer = await api(`/api/companies/${company.id}/agents`, {
      method: "POST",
      body: {
        name: "Delivery Engineer",
        role: "engineer",
        title: "Implementation Engineer",
        adapterType: "codex_local",
        adapterConfig: {
          cwd: fixtureRepo,
          instructionsFilePath: instructionPaths.engineerPath,
          dangerouslyBypassApprovalsAndSandbox: true,
          search: false,
        },
        runtimeConfig: {},
        budgetMonthlyCents: 0,
      },
    });

    const reviewer = await api(`/api/companies/${company.id}/agents`, {
      method: "POST",
      body: {
        name: "Delivery Reviewer",
        role: "qa",
        title: "Reviewer",
        adapterType: "codex_local",
        adapterConfig: {
          cwd: fixtureRepo,
          instructionsFilePath: instructionPaths.reviewerPath,
          dangerouslyBypassApprovalsAndSandbox: true,
          search: false,
        },
        runtimeConfig: {},
        budgetMonthlyCents: 0,
      },
    });

    section("Optional Knowledge Import");
    await maybeImportKnowledge(project.id, primaryWorkspace.id);

    section("Quick Request / PM Projection");
    const intakeIssue = await createPmIntakeIssue(
      company.id,
      [
        "The Siemens-style release label normalization in the delivery fixture is wrong.",
        "",
        "Symptoms:",
        "- `normalizeReleaseLabel` stores labels with inconsistent separators instead of a single `-`",
        "- whitespace trimming and lowercase behavior should still hold",
        "- the fix must happen in an isolated implementation workspace without mutating the base checkout",
        "",
        "Expected behavior:",
        "- trim surrounding whitespace",
        "- lowercase the final label",
        "- convert spaces, `/`, `_`, and repeated punctuation into single `-` separators",
        "- keep the base workspace unchanged and do implementation work in an isolated workspace",
        "",
        "Success conditions:",
        "- `pnpm test` passes",
        "- `pnpm build` passes",
        "- submit structured review handoff and close the projected delivery issue",
      ].join("\n"),
    );
    note(`Quick request created: ${intakeIssue.identifier ?? intakeIssue.id}`);

    // The canonical full-delivery harness drives PM projection explicitly via preview/apply.
    // Pause the PM agent immediately after intake creation so the root issue does not race
    // the deterministic board-side projection flow.
    await api(`/api/agents/${pm.id}/pause`, {
      method: "POST",
    });

    const projectionPreview = await previewProjection(intakeIssue.id, {
      // Keep the intake root as a PM-owned coordination record and drive the
      // autonomous delivery loop through the projected child issue only.
      coordinationOnly: true,
    });
    if (projectionPreview.selectedProjectId !== project.id) {
      throw new Error(
        `Projection selected the wrong project: expected ${project.id}, got ${projectionPreview.selectedProjectId}`,
      );
    }
    if (projectionPreview.staffing.techLeadAgentId !== techLead.id) {
      throw new Error("Projection did not assign the expected tech lead");
    }
    if (projectionPreview.staffing.implementationAssigneeAgentId !== engineer.id) {
      throw new Error("Projection did not assign the expected engineer");
    }
    if (projectionPreview.staffing.reviewerAgentId !== reviewer.id) {
      throw new Error("Projection did not assign the expected reviewer");
    }
    note(`Projection selected ${projectionPreview.selectedProjectName ?? project.name}.`);

    const projection = await applyProjection(intakeIssue.id, projectionPreview.draft);
    const deliveryIssue = Array.isArray(projection.projectedWorkItems)
      ? projection.projectedWorkItems[0] ?? null
      : null;
    if (!deliveryIssue?.id) {
      throw new Error("PM intake projection did not create a projected delivery issue");
    }
    note(`Projected delivery issue: ${deliveryIssue.identifier ?? deliveryIssue.id}`);

    section("Polling Delivery Loop");
    const seenMessages = new Set();
    const seenRuns = new Set();
    const startedAt = Date.now();
    let lastState = null;

    while (Date.now() - startedAt < E2E_TIMEOUT_MS) {
      if (serverExited) {
        throw new Error(`Server exited early. Inspect log: ${serverLog}`);
      }

      const snapshot = await fetchIssueSnapshot(deliveryIssue.id);

      if (snapshot.protocolState?.workflowState !== lastState) {
        lastState = snapshot.protocolState?.workflowState ?? null;
        note(`State -> ${lastState ?? "unknown"}`);
      }

      for (const message of snapshot.protocolMessages) {
        if (seenMessages.has(message.id)) continue;
        seenMessages.add(message.id);
        note(`Message: ${summarizeMessage(message)}`);
      }

      for (const run of snapshot.runs) {
        if (seenRuns.has(run.runId)) continue;
        seenRuns.add(run.runId);
        note(`Run: ${summarizeRun(run)}`);
      }

      if (snapshot.protocolState?.workflowState === "done") {
        section("Post-Completion Verification");
        const completionSnapshot = await waitForCloseRunSnapshot(deliveryIssue.id, snapshot);
        const rootSnapshot = await fetchIssueSnapshot(intakeIssue.id);
        const scenarioOne = assertCanonicalScenarioOne({
          expectedProjectId: project.id,
          expectedStaffing: {
            techLeadAgentId: techLead.id,
            engineerAgentId: engineer.id,
            reviewerAgentId: reviewer.id,
          },
          projectionPreview,
          rootSnapshot,
          deliverySnapshot: completionSnapshot,
        });
        const latestReviewMessage = scenarioOne.latestSubmit;
        const implementationRun = scenarioOne.implementationRun;
        const changeSurface = await fetchIssueChangeSurface(deliveryIssue.id);
        const techLeadSessions = await fetchTaskSessions(techLead.id);
        const reviewerSessions = await fetchTaskSessions(reviewer.id);
        const closeRun = findCloseFollowupRun(completionSnapshot);
        if (!closeRun?.runId) {
          throw new Error("Could not resolve the close follow-up run from the completed snapshot");
        }
        const closeRunLog = await fetchRunLog(closeRun.runId);
        const closeWakeEvidence = await findCloseWakeEvidence(squadrailHome, deliveryIssue.id);
        const scenarioFive = assertMergeDeployFollowupScenario({
          issueId: deliveryIssue.id,
          deliverySnapshot: completionSnapshot,
          changeSurface,
          closeRun,
          closeRunLog,
          closeWakeEvidence,
          techLeadSessions,
          reviewerSessions,
        });

        const isolatedWorkspacePath = extractIsolatedWorkspacePath(latestReviewMessage);
        if (!isolatedWorkspacePath) {
          throw new Error("Could not resolve the isolated workspace path from review artifacts");
        }

        const workspaceStat = await stat(isolatedWorkspacePath).catch(() => null);
        if (!workspaceStat?.isDirectory()) {
          throw new Error(`Isolated workspace path does not exist: ${isolatedWorkspacePath}`);
        }

        const isolatedTest = await runCommand("pnpm", ["test"], {
          cwd: isolatedWorkspacePath,
          allowFailure: true,
        });
        if (isolatedTest.code !== 0) {
          throw new Error(`Isolated workspace tests failed:\n${isolatedTest.stdout}\n${isolatedTest.stderr}`);
        }

        const baseWorkspaceTest = await runCommand("pnpm", ["test"], {
          cwd: fixtureRepo,
          allowFailure: true,
        });
        if (baseWorkspaceTest.code === 0) {
          throw new Error("Base workspace unexpectedly passed after isolated implementation");
        }

        note(`Root issue identifier: ${rootSnapshot.issue.identifier}`);
        note(`Projected issue identifier: ${snapshot.issue.identifier}`);
        note(`Invariant summary: ${Object.entries(scenarioOne.checks).filter(([, passed]) => passed).length}/${Object.keys(scenarioOne.checks).length} checks`);
        note(`Merge/deploy invariant summary: ${Object.entries(scenarioFive.checks).filter(([, passed]) => passed).length}/${Object.keys(scenarioFive.checks).length} checks`);
        note(`Implementation run: ${implementationRun.runId}`);
        note(`Close run: ${closeRun.runId}`);
        note(`Isolated workspace: ${isolatedWorkspacePath}`);
        note(`Server log: ${serverLog}`);
        note(`Temp root: ${tempRoot}`);
        note("Full delivery E2E succeeded.");
        return;
      }

      if (snapshot.protocolState?.workflowState === "blocked" || snapshot.protocolState?.workflowState === "cancelled") {
        throw new Error(`Protocol state entered terminal failure state: ${snapshot.protocolState.workflowState}`);
      }

      await sleep(POLL_INTERVAL_MS);
    }

    const timedOutSnapshot = await fetchIssueSnapshot(deliveryIssue.id);
    throw new Error(
      [
        `Full delivery E2E timed out after ${E2E_TIMEOUT_MS}ms.`,
        `Latest state: ${timedOutSnapshot.protocolState?.workflowState ?? "unknown"}`,
        `Messages:`,
        ...timedOutSnapshot.protocolMessages.map((message) => `  - ${summarizeMessage(message)}`),
        `Runs:`,
        ...timedOutSnapshot.runs.map((run) => `  - ${summarizeRun(run)}`),
        `Server log: ${serverLog}`,
        `Temp root: ${tempRoot}`,
      ].join("\n"),
    );
  } finally {
    if (!serverExited) {
      serverProcess.kill("SIGTERM");
      await sleep(1500);
      if (!serverExited) {
        serverProcess.kill("SIGKILL");
      }
    }
    logStream.end();
  }
}

main().catch(async (error) => {
  const message = error instanceof Error ? error.message : String(error);
  section("E2E FAILED");
  note(message);
  process.exitCode = 1;
});
