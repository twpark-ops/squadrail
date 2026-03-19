#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  buildE2eLabelSpecs,
  hasAnyLabelId,
  needsE2eCancellation,
  shouldHideE2eIssue,
} from "./e2e-issue-utils.mjs";
import { parseScenarioSelection } from "./burn-in-scenarios.mjs";
import { assertChangeRecoveryInvariant } from "./change-recovery-invariants.mjs";
import {
  createDeterministicQaApprovalMessage,
  createDeterministicReviewerApprovalMessage,
} from "./deterministic-approval-payloads.mjs";
import { assertQaGateInvariant } from "./qa-gate-invariants.mjs";

const execFileAsync = promisify(execFile);

const BASE_URL = process.env.SQUADRAIL_BASE_URL ?? "http://127.0.0.1:3101";
const COMPANY_NAME = process.env.SQUADRAIL_COMPANY_NAME ?? "cloud-swiftsight";
const E2E_TIMEOUT_MS = Number(process.env.SWIFTSIGHT_E2E_TIMEOUT_MS ?? 18 * 60 * 1000);
const POLL_INTERVAL_MS = Number(process.env.SWIFTSIGHT_E2E_POLL_INTERVAL_MS ?? 5_000);
const CLOSE_FALLBACK_AFTER_MS = Number(process.env.SWIFTSIGHT_E2E_CLOSE_FALLBACK_AFTER_MS ?? 20_000);
const ACTIVE_RUN_TIMEOUT_GRACE_MS = Number(
  process.env.SWIFTSIGHT_E2E_ACTIVE_RUN_TIMEOUT_GRACE_MS ?? 12 * 60 * 1000,
);
const SCENARIO_FILTER = process.env.SWIFTSIGHT_E2E_SCENARIO?.trim() ?? "";
const NIGHTLY_MODE = process.env.SWIFTSIGHT_E2E_NIGHTLY === "1";
const PRE_CLEANUP_ENABLED = process.env.SWIFTSIGHT_E2E_PRE_CLEANUP !== "0";
const HIDE_COMPLETED_ISSUES = process.env.SWIFTSIGHT_E2E_HIDE_COMPLETED !== "0";
const ALLOW_IMPLEMENTATION_RECOVERY = process.env.SWIFTSIGHT_E2E_ALLOW_IMPLEMENTATION_RECOVERY !== "0";
const E2E_ACTOR_ID = process.env.SWIFTSIGHT_E2E_ACTOR_ID ?? "cloud-swiftsight-e2e-board";
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const SWIFTSIGHT_ROOT = process.env.SWIFTSIGHT_WORKSPACE_ROOT ?? path.join(os.homedir(), "workspace", "cloud-swiftsight");
const PROTOCOL_HELPER_PATH = process.env.SQUADRAIL_PROTOCOL_HELPER_PATH
  ?? path.join(REPO_ROOT, "scripts", "runtime", "squadrail-protocol.mjs");
const DEFAULT_ORG_LOOP_SCENARIO_KEYS = [
  "swiftsight-agent-tl-qa-loop",
  "swiftsight-cloud-pm-tl-review-loop",
  "swiftsight-cloud-pm-tl-change-recovery-loop",
  "swiftcl-cto-cross-project-loop",
];

function note(message = "") {
  process.stdout.write(`${message}\n`);
}

function section(title) {
  note("");
  note("=".repeat(96));
  note(title);
  note("=".repeat(96));
}

function buildManagerHelperLines(lines) {
  return [
    "Preferred supervisory control-plane helper:",
    `- use \`node ${PROTOCOL_HELPER_PATH} ...\` for protocol actions`,
    `- if you need the latest brief first, use \`node ${PROTOCOL_HELPER_PATH} get-brief --issue "$SQUADRAIL_TASK_ID" --scope <role>\``,
    "- do not use curl/wget/python/urllib/fetch for routine routing or review transitions",
    "- any ad-hoc POST to `/protocol/messages` counts as an E2E failure for this scenario",
    "- do not inspect repository files before the first routing or clarification protocol action is recorded",
    ...lines,
  ];
}

function buildEngineerHelperLines(lines) {
  return [
    "Preferred engineer control-plane helper sequence:",
    `- use \`node ${PROTOCOL_HELPER_PATH} ...\` for protocol actions instead of Python/curl/urllib/fetch`,
    "- do not handcraft Python/curl/urllib/fetch POSTs for protocol messages when the helper already supports the action",
    "- any ad-hoc POST to `/protocol/messages` counts as an E2E failure for this scenario",
    "- if the helper fails or times out for a supported protocol action, report the blocker and stop instead of retrying with ad-hoc HTTP",
    ...lines,
  ];
}

async function api(pathname, options = {}) {
  const response = await fetch(`${BASE_URL}${pathname}`, {
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

async function gitStatus(root) {
  const { stdout } = await execFileAsync("git", ["status", "--short"], { cwd: root });
  return stdout.trim();
}

async function gitHead(root) {
  const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: root });
  return stdout.trim();
}

async function runProtocolHelperCommand(args, options = {}) {
  const env = {
    ...process.env,
    SQUADRAIL_API_URL: BASE_URL,
    ...(options.companyId ? { SQUADRAIL_COMPANY_ID: options.companyId } : {}),
    ...(options.issueId ? { SQUADRAIL_TASK_ID: options.issueId } : {}),
    ...(options.agentId ? { SQUADRAIL_AGENT_ID: options.agentId } : {}),
  };
  const { stdout, stderr } = await execFileAsync("node", [PROTOCOL_HELPER_PATH, ...args], {
    cwd: REPO_ROOT,
    env,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (stderr.trim()) {
    note(`[helper:${args[0]}] stderr=${stderr.trim()}`);
  }
  return stdout.trim();
}

function buildAgentRecipient(recipientId, role) {
  return {
    recipientType: "agent",
    recipientId,
    role,
  };
}

function buildAgentSelfRecipient(agentId, role) {
  return buildAgentRecipient(agentId, role);
}

function buildRequestChangesRecipients(state, senderRole, senderId) {
  const recipients = [];

  if (state?.primaryEngineerAgentId) {
    recipients.push(buildAgentRecipient(state.primaryEngineerAgentId, "engineer"));
  }

  if (
    state?.techLeadAgentId
    && state.techLeadAgentId !== state.primaryEngineerAgentId
  ) {
    recipients.push(buildAgentRecipient(state.techLeadAgentId, "tech_lead"));
  }

  if (recipients.length > 0) {
    return recipients;
  }

  assert(typeof senderId === "string" && senderId.length > 0, "REQUEST_CHANGES fallback recipient requires senderId");
  return [buildAgentSelfRecipient(senderId, senderRole)];
}

function messageSenderRole(message) {
  if (typeof message?.senderRole === "string" && message.senderRole.length > 0) {
    return message.senderRole;
  }
  if (typeof message?.sender?.role === "string" && message.sender.role.length > 0) {
    return message.sender.role;
  }
  return null;
}

async function captureRepoSnapshot(root) {
  const [status, head] = await Promise.all([
    gitStatus(root),
    gitHead(root).catch(() => null),
  ]);
  return { status, head };
}

async function ensureCompanyLabels(companyId, specs) {
  const existing = await api(`/api/companies/${companyId}/labels`);
  const byName = new Map(existing.map((label) => [label.name, label]));

  for (const spec of specs) {
    if (byName.has(spec.name)) continue;
    const created = await api(`/api/companies/${companyId}/labels`, {
      method: "POST",
      body: spec,
    });
    byName.set(created.name, created);
  }

  return specs.map((spec) => {
    const label = byName.get(spec.name);
    assert(label, `Label not found after ensure: ${spec.name}`);
    return label;
  });
}

async function markIssueCancelled(issueId) {
  return api(`/api/issues/${issueId}`, {
    method: "PATCH",
    body: {
      status: "cancelled",
    },
  });
}

async function cancelHeartbeatRun(runId) {
  return api(`/api/heartbeat-runs/${runId}/cancel`, {
    method: "POST",
    body: {},
  });
}

async function wakeAgentForIssue(agentId, issueId, reason) {
  return api(`/api/agents/${agentId}/wakeup`, {
    method: "POST",
    body: {
      source: "assignment",
      triggerDetail: "system",
      reason,
      payload: { issueId },
    },
  });
}

function isLikelyE2eIssue(issue, labelIds) {
  if (!issue) return false;
  if (hasAnyLabelId(issue, labelIds)) return true;
  const title = String(issue.title ?? "");
  return title.startsWith("E2E:") || title.startsWith("Org E2E:") || title.startsWith("Child delivery:");
}

async function resolveLikelyE2eIssue(issue, labelIds) {
  if (!issue) return null;
  if (isLikelyE2eIssue(issue, labelIds)) return issue;
  if (!issue.parentId) return null;
  const parent = await api(`/api/issues/${issue.parentId}`).catch(() => null);
  return parent && isLikelyE2eIssue(parent, labelIds) ? parent : null;
}

async function cleanupTaggedIssues(companyId, labelIds) {
  const issues = await api(`/api/companies/${companyId}/issues`);
  const taggedIssues = issues.filter((issue) => isLikelyE2eIssue(issue, labelIds));
  const summary = {
    scanned: taggedIssues.length,
    cancelled: 0,
    hidden: 0,
  };
  const issueIds = new Set(taggedIssues.map((issue) => issue.id));

  for (const issue of taggedIssues) {
    if (needsE2eCancellation(issue.status)) {
      await cancelIssue(
        issue.id,
        `Scenario cleanup cancelled lingering E2E issue ${issue.identifier}.`,
        "Cancel lingering E2E issue before the next scenario run",
      );
      summary.cancelled += 1;
      note(`cleanup cancelled ${issue.identifier}`);
      if (HIDE_COMPLETED_ISSUES) {
        await markIssueCancelled(issue.id);
        summary.hidden += 1;
        note(`cleanup hid ${issue.identifier}`);
      }
      continue;
    }

    if (HIDE_COMPLETED_ISSUES && shouldHideE2eIssue(issue.status)) {
      await markIssueCancelled(issue.id);
      summary.hidden += 1;
      note(`cleanup hid ${issue.identifier}`);
    }
  }

  const heartbeatRuns = await api(`/api/companies/${companyId}/heartbeat-runs?limit=200`);
  const activeRuns = heartbeatRuns.filter((run) => ["queued", "claimed", "running"].includes(run.status));

  for (const run of activeRuns) {
    const issueId = run?.contextSnapshot?.issueId;
    if (!issueId) continue;
    const issue = await api(`/api/issues/${issueId}`).catch(() => null);
    if (!issue) continue;
    const matchedIssue = await resolveLikelyE2eIssue(issue, labelIds);
    if (!issueIds.has(issue.id) && !matchedIssue) continue;
    if (needsE2eCancellation(issue.status)) {
      await cancelIssue(
        issue.id,
        `Scenario cleanup cancelled lingering E2E issue ${issue.identifier}.`,
        "Cancel lingering E2E issue before the next scenario run",
      );
      summary.cancelled += 1;
      note(`cleanup cancelled lingering ${issue.identifier}`);
    }
    await cancelHeartbeatRun(run.id);
  }

  return summary;
}

async function resolveContext() {
  const companies = await api("/api/companies");
  const company = companies.find((entry) => entry.name === COMPANY_NAME);
  assert(company, `Company not found: ${COMPANY_NAME}`);

  const [projects, agents] = await Promise.all([
    api(`/api/companies/${company.id}/projects`),
    api(`/api/companies/${company.id}/agents`),
  ]);

  const projectsByName = new Map(projects.map((project) => [project.name, project]));
  const agentsByUrlKey = new Map(agents.map((agent) => [agent.urlKey, agent]));

  return { company, projects, agents, projectsByName, agentsByUrlKey };
}

async function setAgentPaused(agentId, paused) {
  const pathname = paused ? `/api/agents/${agentId}/pause` : `/api/agents/${agentId}/resume`;
  return api(pathname, { method: "POST" });
}

async function resetAgentRuntimeSession(agentId) {
  return api(`/api/agents/${agentId}/runtime-state/reset-session`, {
    method: "POST",
    body: {},
  });
}

function collectScenarioParticipantIds(scenarios) {
  const ids = new Set();
  for (const scenario of scenarios) {
    if (scenario.mode === "coordinated") {
      ids.add(scenario.coordinator.pm.id);
      ids.add(scenario.coordinator.techLead.id);
      ids.add(scenario.coordinator.reviewer.id);
      if (scenario.coordinator.qa?.id) ids.add(scenario.coordinator.qa.id);
      for (const child of scenario.children ?? []) {
        ids.add(child.assignee.id);
        ids.add(child.reviewer.id);
        if (child.workItem?.qaAgentId) ids.add(child.workItem.qaAgentId);
      }
      continue;
    }
    ids.add(scenario.assignee.id);
    ids.add(scenario.reviewer.id);
    if (scenario.qa?.id) ids.add(scenario.qa.id);
    if (scenario.routingFallback?.senderId) ids.add(scenario.routingFallback.senderId);
    if (scenario.routingFallback?.assigneeId) ids.add(scenario.routingFallback.assigneeId);
    if (scenario.staffingFallback?.senderId) ids.add(scenario.staffingFallback.senderId);
    if (scenario.staffingFallback?.assigneeId) ids.add(scenario.staffingFallback.assigneeId);
    if (scenario.forcedChangeRequest?.senderId) ids.add(scenario.forcedChangeRequest.senderId);
    for (const recipient of scenario.additionalRecipients ?? []) {
      ids.add(recipient.agent.id);
    }
  }
  return [...ids];
}

async function restoreAgentStatuses(restores) {
  for (let index = restores.length - 1; index >= 0; index -= 1) {
    const entry = restores[index];
    if (entry.previousStatus !== "paused") continue;
    await setAgentPaused(entry.agent.id, true);
    note(`restored paused agent ${entry.agent.urlKey}`);
  }
}

async function prepareScenarioAgents(context, scenarios) {
  const agentsById = new Map(context.agents.map((agent) => [agent.id, agent]));
  const restores = [];

  try {
    for (const agentId of collectScenarioParticipantIds(scenarios)) {
      const agent = agentsById.get(agentId);
      assert(agent, `Agent not found while preparing scenario participants: ${agentId}`);
      if (agent.status === "terminated" || agent.status === "pending_approval") {
        throw new Error(
          `Scenario participant ${agent.urlKey} is not runnable (status=${agent.status})`,
        );
      }
      const previousStatus = agent.status;
      if (agent.status !== "paused") {
        await setAgentPaused(agent.id, true);
        note(`paused ${agent.urlKey} to clear active runs before E2E execution`);
      }
      await resetAgentRuntimeSession(agent.id);
      note(`reset runtime session for ${agent.urlKey}`);
      await setAgentPaused(agent.id, false);
      note(`prepared agent ${agent.urlKey} for E2E scenario execution`);
      restores.push({ agent, previousStatus });
    }
  } catch (error) {
    await restoreAgentStatuses(restores);
    throw error;
  }

  return restores;
}

function buildScenarioDefinitions(context) {
  const project = (name) => {
    const value = context.projectsByName.get(name);
    assert(value, `Project not found: ${name}`);
    return value;
  };
  const agent = (urlKey) => {
    const value = context.agentsByUrlKey.get(urlKey);
    assert(value, `Agent not found: ${urlKey}`);
    return value;
  };

  return [
    {
      key: "swiftsight-agent-tl-qa-loop",
      project: project("swiftsight-agent"),
      assignee: agent("swiftsight-agent-tl"),
      assigneeRole: "tech_lead",
      reviewer: agent("swiftsight-agent-codex-engineer"),
      reviewerRole: "engineer",
      qa: agent("swiftsight-qa-engineer"),
      repoRoot: `${SWIFTSIGHT_ROOT}/swiftsight-agent`,
      issue: {
        title: "Org E2E: TL delegates SafeJoin fix, TL reviews code, QA validates release gate",
        description: [
          "Repository: swiftsight-agent",
          "Target files: internal/storage/path.go and internal/storage/path_test.go",
          "You are testing the full project delivery chain, not only direct implementation.",
          "Board expectation for the assignee project TL:",
          "- you own staffing for this issue first",
          "- do not implement the fix yourself",
          `- route the implementation to \`swiftsight-agent-codex-engineer\` (${agent("swiftsight-agent-codex-engineer").id}) with explicit acceptance criteria`,
          `- keep yourself as the code reviewer for the diff review cycle`,
          `- assign QA Engineer \`swiftsight-qa-engineer\` (${agent("swiftsight-qa-engineer").id}) to the QA gate only`,
          "- close only after both code review and QA sign-off",
          "Known bug:",
          "- SafeJoin currently flattens nested relative segments because it applies filepath.Base() to every element",
          "- nested safe inputs like subdir/nested/file.txt lose their directory structure even though they should stay inside the base directory",
          "Implementation goal after TL staffing:",
          "- preserve safe nested relative segments while still rejecting parent traversal",
          "- keep absolute-path sanitization safe",
          "- add regression coverage that proves nested paths remain nested inside the base directory",
          "Acceptance criteria:",
          "- SafeJoin(base, \"subdir\", \"nested/file.txt\") returns base/subdir/nested/file.txt",
          "- traversal inputs containing parent references still fail",
          "- absolute-path inputs stay sanitized inside the base directory",
          "- run `go test ./internal/storage -count=1`",
          ...buildManagerHelperLines([
            "- all protocol transitions in this scenario should use the local helper, not ad-hoc Python/curl POSTs",
            `- TL staffing command: \`node ${PROTOCOL_HELPER_PATH} reassign-task --issue "$SQUADRAIL_TASK_ID" --sender-role tech_lead --assignee-id "${agent("swiftsight-agent-codex-engineer").id}" --assignee-role engineer --reviewer-id "${agent("swiftsight-agent-tl").id}" --qa-id "${agent("swiftsight-qa-engineer").id}" --summary "Route SafeJoin fix to swiftsight-agent-codex-engineer" --reason "Project TL staffing the focused SafeJoin fix"\``,
            `- TL code review start: \`node ${PROTOCOL_HELPER_PATH} start-review --issue "$SQUADRAIL_TASK_ID" --sender-role reviewer --summary "TL starts SafeJoin code review" --review-focus "path traversal preserved||nested segments preserved||focused package test evidence"\``,
            `- TL approval example: \`node ${PROTOCOL_HELPER_PATH} approve-implementation --issue "$SQUADRAIL_TASK_ID" --sender-role reviewer --summary "TL approves SafeJoin code review" --approval-summary "Nested path preservation is fixed and focused evidence is sufficient" --approval-checklist "nested safe path preserved||parent traversal still rejected||focused Go package test passed" --verified-evidence "review handoff payload inspected||diff artifact reviewed||test evidence reviewed" --residual-risks "No repo-wide test evidence was requested for this focused slice"\``,
            `- TL close example: \`node ${PROTOCOL_HELPER_PATH} close-task --issue "$SQUADRAIL_TASK_ID" --sender-role tech_lead --summary "Close SafeJoin fix after QA approval" --closure-summary "Nested safe paths now stay nested and QA approved the focused delivery slice" --verification-summary "QA approval and focused Go package test evidence were recorded in protocol" --rollback-plan "Revert the SafeJoin patch and test file if nested path behavior regresses" --final-artifacts "diff artifact attached||test_run artifact attached||approval recorded in protocol" --remaining-risks "Merge remains external to this E2E harness" --merge-status pending_external_merge\``,
          ]),
          ...buildEngineerHelperLines([
            `- Engineer ACK command: \`node ${PROTOCOL_HELPER_PATH} ack-assignment --issue "$SQUADRAIL_TASK_ID" --sender-role engineer --summary "Accepted SafeJoin fix scope" --understood-scope "Fix SafeJoin path handling in internal/storage/path.go and add focused regression tests in internal/storage/path_test.go" --initial-risks "Path normalization changes can weaken traversal protection if focused tests are incomplete"\``,
            `- Engineer start command: \`node ${PROTOCOL_HELPER_PATH} start-implementation --issue "$SQUADRAIL_TASK_ID" --sender-role engineer --summary "Start SafeJoin implementation in isolated workspace" --active-hypotheses "Safe nested relative segments should be preserved||parent traversal and unsafe absolute-path behavior must remain blocked"\``,
            `- Engineer progress command: \`node ${PROTOCOL_HELPER_PATH} report-progress --issue "$SQUADRAIL_TASK_ID" --sender-role engineer --summary "SafeJoin patch and focused tests are in progress" --progress-percent 60 --completed-items "Reproduced nested-path flattening bug" --next-steps "Patch SafeJoin path normalization||Run focused Go package test" --risks "Traversal safety regression if normalization is too permissive"\``,
            `- Engineer review handoff: \`node ${PROTOCOL_HELPER_PATH} submit-for-review --issue "$SQUADRAIL_TASK_ID" --sender-role engineer --reviewer-id "${agent("swiftsight-agent-tl").id}" --summary "Submit SafeJoin fix for TL code review" --implementation-summary "SafeJoin now preserves safe nested segments while keeping traversal and absolute-path sanitization protections in place" --evidence "Focused Go package test passed||Nested relative path behavior verified||Traversal safety behavior rechecked" --diff-summary "Adjusted SafeJoin normalization and added regression tests for nested paths and traversal safety" --changed-files "internal/storage/path.go||internal/storage/path_test.go" --test-results "go test ./internal/storage -count=1" --review-checklist "Nested safe path preserved||Parent traversal still rejected||Absolute path stays sanitized" --residual-risks "Repo-wide validation was intentionally skipped for this focused slice"\``,
          ]),
          "Execution constraints:",
          "- do not run unrelated repo-wide validation",
          "- do not run `go test ./...`, `pnpm test`, or any repo-wide sweep for this scenario",
          "- stop once the focused package test passes and submit for review immediately",
        ].join("\n"),
      },
      assignment: {
        goal: "Project TL must staff the SafeJoin fix to an engineer, review the code diff, and drive the issue to done after QA gate.",
        acceptanceCriteria: [
          "The project TL delegates implementation instead of coding directly",
          "Nested safe segments remain nested inside the base directory",
          "Parent traversal attempts still fail",
          "Absolute-path elements remain sanitized inside the base directory",
          "QA Engineer performs the review step before closure",
        ],
        definitionOfDone: [
          "go test ./internal/storage -count=1 passes",
          "Protocol trail proves TL delegation plus QA review",
          "Base repo remains unchanged after isolated implementation",
        ],
      },
      deterministicReviewSubmission: {
        afterMs: 20_000,
        reviewerId: agent("swiftsight-agent-tl").id,
        summary: "Submit SafeJoin fix for TL code review",
        implementationSummary:
          "SafeJoin now preserves safe nested segments while keeping traversal and absolute-path sanitization protections in place.",
        evidence: [
          "Focused Go package test passed",
          "Nested relative path behavior verified",
          "Traversal safety behavior rechecked",
        ],
        diffSummary:
          "Adjusted SafeJoin normalization and added regression tests for nested paths and traversal safety.",
        changedFiles: [
          "internal/storage/path.go",
          "internal/storage/path_test.go",
        ],
        testResults: ["go test ./internal/storage -count=1"],
        reviewChecklist: [
          "Nested safe path preserved",
          "Parent traversal still rejected",
          "Absolute path stays sanitized",
        ],
        residualRisks: [
          "Repo-wide validation was intentionally skipped for this focused slice.",
        ],
      },
      routingFallback: {
        afterMs: 15_000,
        senderId: agent("swiftsight-agent-tl").id,
        senderRole: "tech_lead",
        assigneeId: agent("swiftsight-agent-codex-engineer").id,
        assigneeRole: "engineer",
        reviewerId: agent("swiftsight-agent-tl").id,
        qaId: agent("swiftsight-qa-engineer").id,
        summary: "Route SafeJoin fix to swiftsight-agent-codex-engineer",
        reason: "Project TL staffing the focused SafeJoin fix",
      },
      staffingFallback: {
        afterMs: 15_000,
        senderId: agent("swiftsight-agent-tl").id,
        senderRole: "tech_lead",
        assigneeId: agent("swiftsight-agent-codex-engineer").id,
        assigneeRole: "engineer",
        reviewerId: agent("swiftsight-agent-tl").id,
        qaId: agent("swiftsight-qa-engineer").id,
        summary: "Route SafeJoin fix to swiftsight-agent-codex-engineer",
        reason: "Project TL staffing the focused SafeJoin fix",
      },
      checkpoints: [
        {
          label: "tl-reassign",
          messageType: "REASSIGN_TASK",
          senderIds: [agent("swiftsight-agent-tl").id, E2E_ACTOR_ID],
          summaryIncludes: "Route SafeJoin fix to swiftsight-agent-codex-engineer",
        },
        { label: "qa-review-start", messageType: "START_REVIEW", senderId: agent("swiftsight-qa-engineer").id },
        {
          label: "qa-review-decision",
          senderId: agent("swiftsight-qa-engineer").id,
          messageTypes: ["REQUEST_CHANGES", "APPROVE_IMPLEMENTATION", "REQUEST_HUMAN_DECISION"],
        },
      ],
      qaGateInvariant: {
        expectedQaAgentId: agent("swiftsight-qa-engineer").id,
        expectedReviewerId: agent("swiftsight-agent-tl").id,
        reviewFocus: [
          "nested safe path preservation",
          "traversal protection still enforced",
          "focused storage package test evidence",
        ],
        approvalSummary: "QA confirmed nested-path preservation behavior and focused storage evidence satisfy the release gate.",
        approvalChecklist: [
          "nested safe path preserved",
          "parent traversal still rejected",
          "focused storage package test passed",
        ],
        verifiedEvidence: [
          "review handoff payload inspected",
          "focused storage diff reviewed",
          "storage package test evidence reviewed",
        ],
        residualRisks: [
          "Merge remains external to this deterministic E2E harness.",
        ],
        executionLog: "go test ./internal/storage -count=1 passed for the QA gate scenario.",
        outputVerified: "Observed nested-path preservation and traversal-safety evidence in the latest review submission.",
        sanityCommand: "go test ./internal/storage -count=1",
      },
      closeAction: {
        senderId: agent("swiftsight-agent-tl").id,
        senderRole: "tech_lead",
        summary: "Close SafeJoin fix after QA approval",
        closureSummary: "Nested safe paths now stay nested and QA approved the focused delivery slice.",
        verificationSummary: "QA approval and focused Go package test evidence were recorded in protocol.",
        rollbackPlan: "Revert the SafeJoin patch and focused regression tests if nested-path behavior regresses.",
        finalArtifacts: [
          "diff artifact attached",
          "test_run artifact attached",
          "approval recorded in protocol",
        ],
        remainingRisks: ["Merge remains external to this E2E harness."],
        mergeStatus: "pending_external_merge",
      },
    },
    {
      key: "swiftsight-cloud-claude-build-info",
      project: project("swiftsight-cloud"),
      assignee: agent("swiftsight-cloud-claude-engineer"),
      assigneeRole: "engineer",
      reviewer: agent("swiftsight-cloud-tl"),
      reviewerRole: "reviewer",
      repoRoot: `${SWIFTSIGHT_ROOT}/swiftsight-cloud`,
      issue: {
        title: "E2E: derive OpenTelemetry service.version from build metadata",
        description: [
          "Repository: swiftsight-cloud",
          "Target files: internal/observability/tracing.go and internal/observability/tracing_test.go",
          "Goal:",
          "- stop hard-coding service.version to 1.0.0 in createResource",
          "- resolve service.version from build info with a deterministic fallback when build metadata is unavailable",
          "- keep the change local to the observability package",
          "Acceptance criteria:",
          "- createResource no longer hard-codes 1.0.0",
          "- tests cover both resolved version and fallback behavior",
          "- run `go test ./internal/observability -count=1`",
          "Execution constraints:",
          "- do not run golangci-lint or unrelated repo-wide validation",
          "- do not run `go test ./...`, `pnpm test`, or any repo-wide sweep for this scenario",
          "- stop once the focused test passes and submit for review immediately",
          "Definition of done:",
          "- reviewer can verify the version attribute behavior from code and tests",
          "- CLOSE_TASK includes exact test evidence and residual risk if fallback remains possible",
        ].join("\n"),
      },
      assignment: {
        goal: "Resolve service.version from build metadata in swiftsight-cloud observability and prove it with focused tests.",
        acceptanceCriteria: [
          "createResource no longer hard-codes 1.0.0",
          "A helper or equivalent path resolves build metadata with a deterministic fallback",
          "Focused observability tests prove the resolved version and fallback behavior",
        ],
        definitionOfDone: [
          "go test ./internal/observability -count=1 passes",
          "No unrelated lint or repo-wide validation is required for handoff",
          "SUBMIT_FOR_REVIEW includes changed files, diff summary, test evidence, and residual risks",
        ],
      },
    },
    {
      key: "swiftsight-agent-codex-safe-join",
      project: project("swiftsight-agent"),
      assignee: agent("swiftsight-agent-codex-engineer"),
      assigneeRole: "engineer",
      reviewer: agent("swiftsight-agent-tl"),
      reviewerRole: "reviewer",
      repoRoot: `${SWIFTSIGHT_ROOT}/swiftsight-agent`,
      issue: {
        title: "E2E: preserve nested relative segments in storage.SafeJoin",
        description: [
          "Repository: swiftsight-agent",
          "Target files: internal/storage/path.go and internal/storage/path_test.go",
          "Known bug:",
          "- SafeJoin currently flattens nested relative segments because it applies filepath.Base() to every element",
          "- nested safe inputs like subdir/nested/file.txt lose their directory structure even though they should stay inside the base directory",
          "Goal:",
          "- preserve safe nested relative segments while still rejecting parent traversal",
          "- keep absolute-path sanitization safe",
          "- add regression coverage that proves nested paths remain nested inside the base directory",
          "Acceptance criteria:",
          "- SafeJoin(base, \"subdir\", \"nested/file.txt\") returns base/subdir/nested/file.txt",
          "- traversal inputs containing parent references still fail",
          "- absolute-path inputs stay sanitized inside the base directory",
          "- run `go test ./internal/storage -count=1`",
          "Execution constraints:",
          "- do not run unrelated repo-wide validation",
          "- do not run `go test ./...`, `pnpm test`, or any repo-wide sweep for this scenario",
          "- stop once the focused package test passes and submit for review immediately",
        ].join("\n"),
      },
      assignment: {
        goal: "Fix storage.SafeJoin so nested safe path segments are preserved without reopening traversal risk.",
        acceptanceCriteria: [
          "Nested safe segments remain nested inside the base directory",
          "Parent traversal attempts still fail",
          "Absolute-path elements remain sanitized inside the base directory",
        ],
        definitionOfDone: [
          "go test ./internal/storage -count=1 passes",
          "No unrelated lint or repo-wide validation is required for handoff",
          "Review handoff cites the SafeJoin regression coverage and path-safety reasoning",
        ],
      },
    },
    {
      key: "swiftcl-codex-catalog-path",
      project: project("swiftcl"),
      assignee: agent("swiftcl-codex-engineer"),
      assigneeRole: "engineer",
      reviewer: agent("swiftcl-tl"),
      reviewerRole: "reviewer",
      repoRoot: `${SWIFTSIGHT_ROOT}/swiftcl`,
      issue: {
        title: "E2E: honor Config.CatalogPath in swiftcl.New",
        description: [
          "Repository: swiftcl",
          "Target files: pkg/swiftcl/swiftcl.go plus focused regression tests under pkg/swiftcl",
          "Goal:",
          "- when Config.CatalogPath points to a filesystem directory containing catalogs/filters/rules .swiftcl files, New() should load them into the registry before compiler/validator/analyzer construction",
          "- keep current behavior unchanged when CatalogPath is empty",
          "- invalid CatalogPath should return a wrapped error",
          "Implementation guidance:",
          "- prefer existing LoadSystemSources and existing registry population helpers instead of re-implementing parsing",
          "Acceptance criteria:",
          "- regression test proves New(Config{CatalogPath: tempDir}) loads catalog definitions from disk",
          "- regression test proves invalid paths return an error",
          "- run `go test ./pkg/swiftcl -count=1`",
          "Execution constraints:",
          "- do not run golangci-lint or unrelated repo-wide validation",
          "- do not run `go test ./...`, `pnpm test`, or any repo-wide sweep for this scenario",
          "- stop once the focused package test passes and submit for review immediately",
        ].join("\n"),
      },
      assignment: {
        goal: "Make swiftcl.New honor Config.CatalogPath with regression coverage and no behavior change for empty config.",
        acceptanceCriteria: [
          "Config.CatalogPath loads filesystem sources into the registry",
          "Invalid CatalogPath returns a wrapped error",
          "Empty CatalogPath remains backward compatible",
        ],
        definitionOfDone: [
          "go test ./pkg/swiftcl -count=1 passes",
          "No unrelated lint or repo-wide validation is required for handoff",
          "Review handoff cites the loader path and the regression coverage added",
        ],
      },
    },
    {
      key: "swiftsight-worker-codex-clone-isolation",
      project: project("swiftsight-worker"),
      assignee: agent("swiftsight-worker-codex-engineer"),
      assigneeRole: "engineer",
      reviewer: agent("swiftsight-python-tl"),
      reviewerRole: "reviewer",
      repoRoot: `${SWIFTSIGHT_ROOT}/swiftsight-worker`,
      issue: {
        title: "E2E: make get_git_info robust for file-path source_root in dirty worker repo",
        description: [
          "Repository: swiftsight-worker / brain-volumetry-worker",
          "Target files: brain-volumetry-worker/brain_volumetry_worker/common/git_info.py and focused unit tests",
          "Known bug:",
          "- get_git_info(source_root=<file path>) currently raises NotADirectoryError instead of degrading gracefully",
          "Goal:",
          "- if source_root is a file path, normalize to its parent before git commands",
          "- nested directories inside a git repo should still resolve commit/branch information",
          "- non-git paths must keep returning None-filled fields instead of crashing",
          "Acceptance criteria:",
          "- add focused unit tests using temporary git repo fixtures",
          "- run `.venv/bin/python -m pytest brain_volumetry_worker/tests/test_git_info.py -q` or an equivalent focused path",
          "- base swiftsight-worker working tree is intentionally dirty and must remain unchanged after the implementation run",
          "Execution constraints:",
          "- do not run repo-wide lint or unrelated test suites",
          "- do not run repo-wide Python or build sweeps for this scenario",
          "- stop once the focused pytest command passes and submit for review immediately",
        ].join("\n"),
      },
      assignment: {
        goal: "Fix file-path handling in brain-volumetry-worker get_git_info and prove clone isolation on the dirty swiftsight-worker repo.",
        acceptanceCriteria: [
          "File-path source_root no longer crashes and resolves git metadata from the parent directory",
          "Non-git paths still degrade gracefully",
          "Focused git_info unit tests pass inside the isolated implementation workspace",
        ],
        definitionOfDone: [
          "Focused pytest command passes from the isolated implementation workspace",
          "Base swiftsight-worker git status is unchanged after task completion",
          "No unrelated lint or repo-wide validation is required for handoff",
        ],
      },
      closeAction: {
        senderId: agent("swiftsight-python-tl").id,
        senderRole: "tech_lead",
        summary: "Close get_git_info file-path normalization fix after focused review approval",
        closureSummary:
          "get_git_info now normalizes file-path source_root inputs to their parent directory, focused pytest evidence passed in the isolated clone workspace, and review approval was recorded.",
        verificationSummary:
          "Focused git_info pytest evidence and dirty-base-repo isolation checks were recorded in protocol.",
        rollbackPlan:
          "Revert the git_info normalization change and focused regression test if file-path source_root handling regresses.",
        finalArtifacts: [
          "diff artifact attached",
          "test_run artifact attached",
          "approval recorded in protocol",
        ],
        remainingRisks: [
          "Merge remains external to this E2E harness.",
        ],
        mergeStatus: "pending_external_merge",
      },
    },
    {
      key: "swiftsight-cloud-pm-tl-review-loop",
      project: project("swiftsight-cloud"),
      assignee: agent("swiftsight-pm"),
      assigneeRole: "pm",
      reviewer: agent("swiftsight-cloud-tl"),
      reviewerRole: "reviewer",
      qa: agent("swiftsight-qa-lead"),
      repoRoot: `${SWIFTSIGHT_ROOT}/swiftsight-cloud`,
      issue: {
        title: "Org E2E: PM clarifies build-info scope, TL owns execution, QA Lead reviews",
        description: [
          "Repository: swiftsight-cloud",
          "Target files: internal/observability/tracing.go and internal/observability/tracing_test.go",
          "Board expectation for the PM assignee:",
          "- you own scope clarification first",
          "- do not implement the change yourself",
          `- turn this into an execution-ready delivery slice and hand it to \`swiftsight-cloud-tl\` (${agent("swiftsight-cloud-tl").id})`,
          `- hand code review to \`swiftsight-cloud-tl\` and assign QA Lead to the QA gate`,
          `- after TL takeover, prefer the implementation lane \`swiftsight-cloud-codex-engineer\` (${agent("swiftsight-cloud-codex-engineer").id}) when staffing is still needed`,
          "- if the issue is already execution-ready in the TL lane, the TL may implement directly instead of forcing another reassignment",
          "Known bug:",
          "- createResource currently hard-codes service.version to 1.0.0",
          "- the package should resolve service.version from build metadata with a deterministic fallback",
          "Implementation goal after PM clarification and TL takeover:",
          "- remove the hard-coded 1.0.0 path",
          "- resolve service.version from build info with a deterministic fallback when build metadata is unavailable",
          "- keep the change local to the observability package",
          "Acceptance criteria:",
          "- createResource no longer hard-codes 1.0.0",
          "- tests cover both resolved version and fallback behavior",
          "- run `go test ./internal/observability -count=1`",
          ...buildManagerHelperLines([
            "- all protocol transitions in this scenario should use the local helper, not ad-hoc Python/curl POSTs",
            `- PM routing command: \`node ${PROTOCOL_HELPER_PATH} reassign-task --issue "$SQUADRAIL_TASK_ID" --sender-role pm --assignee-id "${agent("swiftsight-cloud-tl").id}" --assignee-role tech_lead --reviewer-id "${agent("swiftsight-cloud-tl").id}" --summary "PM routes build-info fix into the swiftsight-cloud TL lane" --reason "PM clarified the delivery slice and is handing execution ownership to the project TL"\``,
            `- TL staffing command when delegating further: \`node ${PROTOCOL_HELPER_PATH} reassign-task --issue "$SQUADRAIL_TASK_ID" --sender-role tech_lead --assignee-id "${agent("swiftsight-cloud-codex-engineer").id}" --assignee-role engineer --reviewer-id "${agent("swiftsight-cloud-tl").id}" --summary "TL staffs build-info fix to swiftsight-cloud-codex-engineer" --reason "Project TL is staffing the focused observability implementation"\``,
            `- TL direct implementation fallback: \`node ${PROTOCOL_HELPER_PATH} start-implementation --issue "$SQUADRAIL_TASK_ID" --sender-role engineer --summary "TL starts observability implementation directly from the TL lane" --active-hypotheses "Build metadata can drive service.version with deterministic fallback||Change scope should stay local to observability package"\``,
            "- TL protocol sender-role split: use `tech_lead` for reassign/close, and `engineer` for ack/start/progress/review-submission while the TL is the active implementation owner.",
            `- QA Lead review start: \`node ${PROTOCOL_HELPER_PATH} start-review --issue "$SQUADRAIL_TASK_ID" --sender-role qa --summary "QA Lead starts QA gate review" --review-focus "build metadata fallback behavior||focused observability test evidence||diff scope stays local to observability package"\``,
            `- QA Lead approval example: \`node ${PROTOCOL_HELPER_PATH} approve-implementation --issue "$SQUADRAIL_TASK_ID" --sender-role qa --summary "QA Lead approves observability fix (QA gate)" --approval-summary "Build metadata fallback behavior is correct and focused evidence is sufficient" --approval-checklist "service.version no longer hard-coded||fallback behavior covered||focused observability test passed" --verified-evidence "review handoff payload inspected||diff artifact reviewed||test evidence reviewed" --residual-risks "Build stamping may still be absent in local builds, so deterministic fallback remains expected"\``,
            `- TL close example: \`node ${PROTOCOL_HELPER_PATH} close-task --issue "$SQUADRAIL_TASK_ID" --sender-role tech_lead --summary "Close observability fix after QA approval" --closure-summary "service.version now follows build metadata with deterministic fallback and QA approved the slice" --verification-summary "QA approval and focused observability test evidence were recorded in protocol" --rollback-plan "Revert the observability helper and regression test changes if version resolution regresses" --final-artifacts "diff artifact attached||test_run artifact attached||approval recorded in protocol" --remaining-risks "Merge remains external to this E2E harness" --merge-status pending_external_merge\``,
          ]),
          ...buildEngineerHelperLines([
            `- Engineer ACK command: \`node ${PROTOCOL_HELPER_PATH} ack-assignment --issue "$SQUADRAIL_TASK_ID" --sender-role engineer --summary "Accepted observability build-info scope" --understood-scope "Resolve service.version from build metadata in internal/observability and add focused regression tests" --initial-risks "Build metadata may be unavailable outside stamped builds and needs deterministic fallback coverage"\``,
            `- Engineer start command: \`node ${PROTOCOL_HELPER_PATH} start-implementation --issue "$SQUADRAIL_TASK_ID" --sender-role engineer --summary "Start observability implementation in isolated workspace" --active-hypotheses "Build metadata can drive service.version with deterministic fallback||Change scope should stay local to observability package"\``,
            `- Engineer progress command: \`node ${PROTOCOL_HELPER_PATH} report-progress --issue "$SQUADRAIL_TASK_ID" --sender-role engineer --summary "Observability patch and focused tests are in progress" --progress-percent 60 --completed-items "Confirmed hard-coded service.version behavior" --next-steps "Wire build metadata fallback||Run focused observability test" --risks "Fallback behavior can drift if tests do not pin non-stamped builds"\``,
            `- Engineer review handoff: \`node ${PROTOCOL_HELPER_PATH} submit-for-review --issue "$SQUADRAIL_TASK_ID" --sender-role engineer --reviewer-id "${agent("swiftsight-cloud-tl").id}" --summary "Submit observability build-info fix for TL code review" --implementation-summary "createResource now resolves service.version from build metadata with deterministic fallback when stamping is unavailable" --evidence "Focused observability test passed||Resolved version behavior verified||Fallback behavior verified" --diff-summary "Removed hard-coded service.version path and added focused observability regression coverage" --changed-files "internal/observability/tracing.go||internal/observability/tracing_test.go" --test-results "go test ./internal/observability -count=1" --review-checklist "service.version no longer hard-coded||Fallback behavior covered||Change scope remains local to observability package" --residual-risks "Repo-wide validation was intentionally skipped for this focused slice"\``,
          ]),
          "Execution constraints:",
          "- PM should route through `swiftsight-cloud-tl` before engineer implementation starts",
          "- do not run golangci-lint or unrelated repo-wide validation",
          "- stop once the focused test passes and submit for review immediately",
        ].join("\n"),
      },
      assignment: {
        goal: "PM must clarify and route the observability fix through the project TL, TL reviews code, then QA Lead must validate the delivered slice at the QA gate.",
        acceptanceCriteria: [
          "PM reassigns the issue into the project TL lane before coding starts",
          "Project TL either staffs the final engineer implementation lane or implements directly after the routing decision is recorded",
          "service.version is resolved from build metadata with deterministic fallback",
          "QA Lead performs the review decision before the task closes",
        ],
        definitionOfDone: [
          "go test ./internal/observability -count=1 passes",
          "Protocol trail proves PM clarification, TL ownership, QA Lead review, and closure",
          "Base repo remains unchanged after isolated implementation",
        ],
      },
      checkpoints: [
        { label: "pm-reassign", messageType: "REASSIGN_TASK", senderId: agent("swiftsight-pm").id },
        { label: "qa-lead-review-start", messageType: "START_REVIEW", senderId: agent("swiftsight-qa-lead").id },
        {
          label: "qa-lead-review-decision",
          senderId: agent("swiftsight-qa-lead").id,
          messageTypes: ["REQUEST_CHANGES", "APPROVE_IMPLEMENTATION", "REQUEST_HUMAN_DECISION"],
        },
      ],
      qaGateInvariant: {
        expectedQaAgentId: agent("swiftsight-qa-lead").id,
        expectedReviewerId: agent("swiftsight-cloud-tl").id,
      },
      closeAction: {
        senderId: agent("swiftsight-cloud-tl").id,
        senderRole: "tech_lead",
        summary: "Close observability fix after QA approval",
        closureSummary: "service.version now follows build metadata with deterministic fallback and QA approved the slice.",
        verificationSummary: "QA approval and focused observability test evidence were recorded in protocol.",
        rollbackPlan: "Revert the observability helper and focused regression tests if version resolution regresses.",
        finalArtifacts: [
          "diff artifact attached",
          "test_run artifact attached",
          "approval recorded in protocol",
        ],
        remainingRisks: ["Merge remains external to this E2E harness."],
        mergeStatus: "pending_external_merge",
      },
    },
    {
      key: "swiftsight-cloud-pm-tl-change-recovery-loop",
      project: project("swiftsight-cloud"),
      assignee: agent("swiftsight-pm"),
      assigneeRole: "pm",
      reviewer: agent("swiftsight-agent-tl"),
      reviewerRole: "reviewer",
      qa: agent("swiftsight-qa-lead"),
      repoRoot: `${SWIFTSIGHT_ROOT}/swiftsight-cloud`,
      issue: {
        title: "Org E2E: PM routes build-info fix through TL staffing recovery after requested changes",
        description: [
          "Repository: swiftsight-cloud",
          "Target files: internal/observability/tracing.go and internal/observability/tracing_test.go",
          "Board expectation for the PM assignee:",
          "- clarify the delivery slice and route it into the swiftsight-cloud TL lane",
          `- keep reviewer coverage with \`swiftsight-agent-tl\` (${agent("swiftsight-agent-tl").id}) and leave QA Lead in the final QA gate`,
          `- after routing, staff implementation to \`swiftsight-cloud-codex-engineer\` (${agent("swiftsight-cloud-codex-engineer").id}) instead of keeping the TL as the direct executor`,
          "Deterministic recovery goal:",
          "- after the first review submission, the reviewer will request one follow-up change",
          "- the active implementation owner must acknowledge the change request and resume implementation",
          "- the same issue must then pass review, QA, and close cleanly",
          "Known bug:",
          "- createResource currently hard-codes service.version to 1.0.0",
          "- the package should resolve service.version from build metadata with a deterministic fallback",
          "Acceptance criteria:",
          "- PM routes through the TL lane before implementation starts",
          "- TL staffing binds the focused engineer owner correctly",
          "- reviewer can request changes once and the implementation owner resumes",
          "- QA Lead performs the final QA gate before closure",
          "- run `go test ./internal/observability -count=1`",
          ...buildManagerHelperLines([
            "- this scenario intentionally validates review recovery; keep the focused scope local to observability",
            `- PM routing command: \`node ${PROTOCOL_HELPER_PATH} reassign-task --issue "$SQUADRAIL_TASK_ID" --sender-role pm --assignee-id "${agent("swiftsight-cloud-tl").id}" --assignee-role tech_lead --reviewer-id "${agent("swiftsight-agent-tl").id}" --qa-id "${agent("swiftsight-qa-lead").id}" --summary "PM routes build-info fix into the swiftsight-cloud TL lane" --reason "Route the deterministic review recovery slice through the project TL"\``,
            `- TL staffing command: \`node ${PROTOCOL_HELPER_PATH} reassign-task --issue "$SQUADRAIL_TASK_ID" --sender-role tech_lead --assignee-id "${agent("swiftsight-cloud-codex-engineer").id}" --assignee-role engineer --reviewer-id "${agent("swiftsight-agent-tl").id}" --qa-id "${agent("swiftsight-qa-lead").id}" --summary "TL staffs observability recovery slice to swiftsight-cloud-codex-engineer" --reason "Delegate the focused build-info recovery slice to the cloud implementation engineer"\``,
            "- TL protocol sender-role split: use `tech_lead` for staffing/close, and keep engineer sender-role for the active implementation owner after staffing.",
            `- QA Lead final review start: \`node ${PROTOCOL_HELPER_PATH} start-review --issue "$SQUADRAIL_TASK_ID" --sender-role qa --summary "QA gate: verifying observability build-info recovery" --review-focus "change-request recovery evidence||focused observability tests||diff scope remains local"\``,
            `- QA Lead approval example: \`node ${PROTOCOL_HELPER_PATH} approve-implementation --issue "$SQUADRAIL_TASK_ID" --sender-role qa --summary "QA Lead approves observability recovery fix" --approval-summary "Requested follow-up evidence arrived and the focused observability slice remains correct" --approval-checklist "change-request handled||service.version no longer hard-coded||fallback behavior covered||focused observability test passed" --verified-evidence "review handoff payload inspected||change-request follow-up inspected||test evidence reviewed" --residual-risks "Build stamping may still be absent in local builds, so deterministic fallback remains expected"\``,
            `- TL close example: \`node ${PROTOCOL_HELPER_PATH} close-task --issue "$SQUADRAIL_TASK_ID" --sender-role tech_lead --summary "Close observability recovery fix after QA approval" --closure-summary "service.version recovery loop completed and QA approved the focused slice" --verification-summary "Review recovery evidence and focused observability tests were recorded in protocol" --rollback-plan "Revert the observability helper and regression test changes if version resolution regresses" --final-artifacts "diff artifact attached||test_run artifact attached||approval recorded in protocol" --remaining-risks "Merge remains external to this E2E harness" --merge-status pending_external_merge\``,
          ]),
          ...buildEngineerHelperLines([
            `- Engineer ACK command: \`node ${PROTOCOL_HELPER_PATH} ack-assignment --issue "$SQUADRAIL_TASK_ID" --sender-role engineer --summary "Accepted observability recovery scope" --understood-scope "Resolve service.version from build metadata in internal/observability and be ready to handle a deterministic review follow-up" --initial-risks "Recovery loop must preserve the same active engineer owner across the follow-up cycle"\``,
            `- Engineer start command: \`node ${PROTOCOL_HELPER_PATH} start-implementation --issue "$SQUADRAIL_TASK_ID" --sender-role engineer --summary "Start observability implementation in isolated workspace" --active-hypotheses "Build metadata can drive service.version with deterministic fallback||Changes-request recovery should preserve active engineer ownership"\``,
            `- Engineer review handoff: \`node ${PROTOCOL_HELPER_PATH} submit-for-review --issue "$SQUADRAIL_TASK_ID" --sender-role engineer --reviewer-id "${agent("swiftsight-agent-tl").id}" --summary "Submit observability build-info fix for deterministic recovery review" --implementation-summary "createResource resolves service.version from build metadata with deterministic fallback and the same cloud engineer remains the active implementation owner during recovery" --evidence "Focused observability test passed||Resolved version behavior verified||Fallback behavior verified" --diff-summary "Removed hard-coded service.version path and added focused regression coverage for version resolution" --changed-files "internal/observability/tracing.go||internal/observability/tracing_test.go" --test-results "go test ./internal/observability -count=1" --review-checklist "service.version no longer hard-coded||Fallback behavior covered||Recovery loop kept the same engineer ownership stable" --residual-risks "Repo-wide validation was intentionally skipped for this focused slice"\``,
          ]),
          "Execution constraints:",
          "- PM should route through `swiftsight-cloud-tl` before implementation starts",
          "- do not run golangci-lint or unrelated repo-wide validation",
          "- stop once the focused test passes and submit for review immediately",
        ].join("\n"),
      },
      assignment: {
        goal: "PM must route the observability fix through the TL lane, TL must staff the focused engineer lane, and the active engineer must recover cleanly after a deterministic reviewer REQUEST_CHANGES before QA closure.",
        acceptanceCriteria: [
          "PM reassigns the issue into the project TL lane before coding starts",
          "TL staffing binds the engineer owner correctly",
          "A reviewer REQUEST_CHANGES is recorded before final approval",
          "The same implementation owner acknowledges the change request and resumes execution",
          "QA Lead performs the review decision before the task closes",
        ],
        definitionOfDone: [
          "go test ./internal/observability -count=1 passes",
          "Protocol trail proves PM routing, reviewer change request, recovery ACK/start, QA review, and closure",
          "Base repo remains unchanged after isolated implementation",
        ],
      },
      routingFallback: {
        afterMs: 15_000,
        senderId: agent("swiftsight-pm").id,
        senderRole: "pm",
        assigneeId: agent("swiftsight-cloud-tl").id,
        assigneeRole: "tech_lead",
        reviewerId: agent("swiftsight-agent-tl").id,
        qaId: agent("swiftsight-qa-lead").id,
        summary: "PM routes build-info fix into the swiftsight-cloud TL lane",
        reason: "Route the deterministic review recovery slice through the project TL",
      },
      staffingFallback: {
        afterMs: 15_000,
        senderId: agent("swiftsight-cloud-tl").id,
        senderRole: "tech_lead",
        assigneeId: agent("swiftsight-cloud-codex-engineer").id,
        assigneeRole: "engineer",
        reviewerId: agent("swiftsight-agent-tl").id,
        qaId: agent("swiftsight-qa-lead").id,
        summary: "TL staffs observability recovery slice to swiftsight-cloud-codex-engineer",
        reason: "Delegate the focused build-info recovery slice to the cloud implementation engineer",
      },
      forcedChangeRequest: {
        senderId: agent("swiftsight-agent-tl").id,
        senderRole: "reviewer",
        pauseAgentUntilRecovery: true,
        reviewSummary: "Deterministic review recovery checkpoint: request refreshed evidence from the active engineer implementation owner before final approval.",
        summary: "Reviewer requests one deterministic follow-up before approval",
        reviewFocus: [
          "recovery evidence",
          "focused observability tests",
          "active implementation owner continuity",
        ],
        requiredEvidence: [
          "Focused observability test rerun after acknowledging the change request",
          "Explicit resubmission from the same active implementation owner",
        ],
        changeRequests: [
          {
            title: "race-evidence-refresh",
            reason: "Review requires one explicit recovery cycle so the active implementation owner proves the follow-up path before final approval.",
            affectedFiles: ["internal/observability/tracing.go", "internal/observability/tracing_test.go"],
            suggestedAction: "Acknowledge the change request, refresh focused observability evidence, and resubmit for review from the same engineer-owned implementation lane.",
          },
        ],
        severity: "medium",
        mustFixBeforeApprove: true,
      },
      checkpoints: [
        {
          label: "pm-reassign",
          messageType: "REASSIGN_TASK",
          senderIds: [agent("swiftsight-pm").id, E2E_ACTOR_ID],
          summaryIncludes: "PM routes build-info fix into the swiftsight-cloud TL lane",
        },
        {
          label: "tl-staffing",
          messageType: "REASSIGN_TASK",
          senderIds: [agent("swiftsight-cloud-tl").id, E2E_ACTOR_ID],
          summaryIncludes: "TL staffs observability recovery slice to swiftsight-cloud-codex-engineer",
        },
        {
          label: "reviewer-forced-changes",
          messageType: "REQUEST_CHANGES",
          senderIds: [agent("swiftsight-agent-tl").id, E2E_ACTOR_ID],
        },
        { label: "engineer-ack-change-request", messageType: "ACK_CHANGE_REQUEST", senderId: agent("swiftsight-cloud-codex-engineer").id },
        { label: "engineer-restart-implementation", messageType: "START_IMPLEMENTATION", senderId: agent("swiftsight-cloud-codex-engineer").id },
        { label: "qa-lead-review-decision", messageType: "APPROVE_IMPLEMENTATION", senderId: agent("swiftsight-qa-lead").id },
      ],
      changeRecoveryInvariant: {
        recoveryMode: "direct_owner",
        expectedRecoveryOwnerId: agent("swiftsight-cloud-codex-engineer").id,
      },
      qaGateInvariant: {
        expectedQaAgentId: agent("swiftsight-qa-lead").id,
        expectedReviewerId: agent("swiftsight-agent-tl").id,
      },
      closeAction: {
        senderId: agent("swiftsight-cloud-tl").id,
        senderRole: "tech_lead",
        summary: "Close observability recovery fix after QA approval",
        closureSummary: "service.version recovery loop completed and QA approved the focused slice.",
        verificationSummary: "Review recovery evidence and focused observability tests were recorded in protocol.",
        rollbackPlan: "Revert the observability helper and focused regression tests if version resolution regresses.",
        finalArtifacts: [
          "diff artifact attached",
          "test_run artifact attached",
          "approval recorded in protocol",
        ],
        remainingRisks: ["Merge remains external to this E2E harness."],
        mergeStatus: "pending_external_merge",
      },
    },
    {
      key: "swiftcl-cto-cross-project-loop",
      project: project("swiftcl"),
      assignee: agent("swiftsight-cto"),
      assigneeRole: "cto",
      reviewer: agent("swiftcl-tl"),
      reviewerRole: "reviewer",
      qa: agent("swiftsight-qa-lead"),
      repoRoot: `${SWIFTSIGHT_ROOT}/swiftcl`,
      issue: {
        title: "Org E2E: CTO routes swiftcl catalog-path fix through TL ownership and QA release review",
        description: [
          "Repository: swiftcl",
          "Target files: pkg/swiftcl/swiftcl.go plus focused regression tests under pkg/swiftcl",
          "This is an organization-level delivery check.",
          "Board expectation for the CTO assignee:",
          "- you own the first routing decision",
          "- do not implement the change yourself",
          `- hand the work to \`swiftcl-tl\` (${agent("swiftcl-tl").id}) so the project lane owns staffing and closure`,
          "- keep QA Lead in the final review loop because this affects repo bootstrapping behavior",
          `- after TL takeover, prefer the implementation lane \`swiftcl-codex-engineer\` (${agent("swiftcl-codex-engineer").id}) when staffing is still needed`,
          "- if the issue is already execution-ready in the TL lane, the TL may implement directly instead of forcing another reassignment",
          "Known bug:",
          "- Config.CatalogPath exists but swiftcl.New currently ignores it",
          "- when Config.CatalogPath points to a filesystem directory containing catalogs/filters/rules .swiftcl files, New() should load them into the registry before compiler/validator/analyzer construction",
          "Acceptance criteria:",
          "- regression test proves New(Config{CatalogPath: tempDir}) loads catalog definitions from disk",
          "- regression test proves invalid paths return an error",
          "- empty CatalogPath remains backward compatible",
          "- run `go test ./pkg/swiftcl -count=1`",
          ...buildManagerHelperLines([
            "- all protocol transitions in this scenario should use the local helper, not ad-hoc Python/curl POSTs",
            `- CTO routing command: \`node ${PROTOCOL_HELPER_PATH} reassign-task --issue "$SQUADRAIL_TASK_ID" --sender-role cto --assignee-id "${agent("swiftcl-tl").id}" --assignee-role tech_lead --reviewer-id "${agent("swiftcl-tl").id}" --summary "CTO routes swiftcl catalog-path fix into the project TL lane" --reason "CTO is routing this company-level delivery slice into the correct project lane"\``,
            `- TL staffing command when delegating further: \`node ${PROTOCOL_HELPER_PATH} reassign-task --issue "$SQUADRAIL_TASK_ID" --sender-role tech_lead --assignee-id "${agent("swiftcl-codex-engineer").id}" --assignee-role engineer --reviewer-id "${agent("swiftcl-tl").id}" --summary "TL staffs catalog-path fix to swiftcl-codex-engineer" --reason "SwiftCL TL is staffing the focused implementation lane"\``,
            `- TL direct implementation fallback: \`node ${PROTOCOL_HELPER_PATH} start-implementation --issue "$SQUADRAIL_TASK_ID" --sender-role engineer --summary "TL starts CatalogPath implementation directly from the TL lane" --active-hypotheses "CatalogPath should load definitions before constructor wiring||Empty CatalogPath must stay backward compatible"\``,
            "- TL protocol sender-role split: use `tech_lead` for reassign/close, and `engineer` for ack/start/progress/review-submission while the TL is the active implementation owner.",
            `- QA Lead review start: \`node ${PROTOCOL_HELPER_PATH} start-review --issue "$SQUADRAIL_TASK_ID" --sender-role qa --summary "QA Lead starts swiftcl QA gate review" --review-focus "CatalogPath loading behavior||focused swiftcl package tests||bootstrapping regression risk"\``,
            `- QA Lead approval example: \`node ${PROTOCOL_HELPER_PATH} approve-implementation --issue "$SQUADRAIL_TASK_ID" --sender-role qa --summary "QA Lead approves CatalogPath loading fix (QA gate)" --approval-summary "CatalogPath loading behavior and focused regression evidence satisfy the release review bar" --approval-checklist "CatalogPath now honored||invalid path errors preserved||empty path stays backward compatible||focused swiftcl package test passed" --verified-evidence "review handoff payload inspected||diff artifact reviewed||test evidence reviewed" --residual-risks "Recursive loading behavior should be documented for operators choosing catalog directories"\``,
            `- TL close example: \`node ${PROTOCOL_HELPER_PATH} close-task --issue "$SQUADRAIL_TASK_ID" --sender-role tech_lead --summary "Close CatalogPath fix after QA approval" --closure-summary "CatalogPath loading now works, regression tests pass, and QA approved the delivery slice" --verification-summary "QA approval and focused swiftcl package test evidence were recorded in protocol" --rollback-plan "Revert the CatalogPath loader and regression test if bootstrapping behavior regresses" --final-artifacts "diff artifact attached||test_run artifact attached||approval recorded in protocol" --remaining-risks "Merge remains external to this E2E harness" --merge-status pending_external_merge\``,
          ]),
          ...buildEngineerHelperLines([
            `- Engineer ACK command: \`node ${PROTOCOL_HELPER_PATH} ack-assignment --issue "$SQUADRAIL_TASK_ID" --sender-role engineer --summary "Accepted swiftcl CatalogPath scope" --understood-scope "Honor Config.CatalogPath in pkg/swiftcl and add focused regression tests for valid, invalid, and empty path behavior" --initial-risks "Bootstrapping changes can break backward compatibility if empty-path behavior changes"\``,
            `- Engineer start command: \`node ${PROTOCOL_HELPER_PATH} start-implementation --issue "$SQUADRAIL_TASK_ID" --sender-role engineer --summary "Start CatalogPath implementation in isolated workspace" --active-hypotheses "CatalogPath should load definitions before constructor wiring||Empty CatalogPath must stay backward compatible"\``,
            `- Engineer progress command: \`node ${PROTOCOL_HELPER_PATH} report-progress --issue "$SQUADRAIL_TASK_ID" --sender-role engineer --summary "swiftcl CatalogPath patch and focused tests are in progress" --progress-percent 60 --completed-items "Confirmed Config.CatalogPath is ignored in New()" --next-steps "Wire disk catalog loading||Run focused swiftcl package test" --risks "Loader behavior can break empty-path compatibility if initialization order changes"\``,
            `- Engineer review handoff: \`node ${PROTOCOL_HELPER_PATH} submit-for-review --issue "$SQUADRAIL_TASK_ID" --sender-role engineer --reviewer-id "${agent("swiftcl-tl").id}" --summary "Submit CatalogPath loading fix for TL code review" --implementation-summary "swiftcl.New now honors Config.CatalogPath, loads on-disk definitions before constructor setup, and preserves empty-path compatibility" --evidence "Focused swiftcl package test passed||Valid path loading verified||Invalid path and empty-path behavior verified" --diff-summary "Wired CatalogPath loading into swiftcl bootstrapping and added focused regression coverage" --changed-files "pkg/swiftcl/swiftcl.go||pkg/swiftcl/*test*.go" --test-results "go test ./pkg/swiftcl -count=1" --review-checklist "CatalogPath now honored||Invalid path errors preserved||Empty path stays backward compatible" --residual-risks "Repo-wide validation was intentionally skipped for this focused slice"\``,
          ]),
          "Execution constraints:",
          "- CTO should route through `swiftcl-tl` before engineer implementation starts",
          "- do not run golangci-lint or unrelated repo-wide validation",
          "- stop once the focused package test passes and submit for review immediately",
        ].join("\n"),
      },
      assignment: {
        goal: "CTO must route the swiftcl catalog-path fix into the SwiftCL TL lane, TL reviews code, then QA Lead must validate the delivered implementation at the QA gate before closure.",
        acceptanceCriteria: [
          "CTO reassigns the work into the SwiftCL TL lane before coding starts",
          "SwiftCL TL either staffs the final engineer implementation lane or implements directly after routing is recorded",
          "Config.CatalogPath is honored with focused regression coverage",
          "QA Lead performs the review decision before the task closes",
        ],
        definitionOfDone: [
          "go test ./pkg/swiftcl -count=1 passes",
          "Protocol trail proves CTO routing, TL ownership, QA Lead review, and closure",
          "Base repo remains unchanged after isolated implementation",
        ],
      },
      checkpoints: [
        { label: "cto-reassign", messageType: "REASSIGN_TASK", senderId: agent("swiftsight-cto").id },
        { label: "qa-lead-review-start", messageType: "START_REVIEW", senderId: agent("swiftsight-qa-lead").id },
        {
          label: "qa-lead-review-decision",
          senderId: agent("swiftsight-qa-lead").id,
          messageTypes: ["REQUEST_CHANGES", "APPROVE_IMPLEMENTATION", "REQUEST_HUMAN_DECISION"],
        },
      ],
      closeAction: {
        senderId: agent("swiftcl-tl").id,
        senderRole: "tech_lead",
        summary: "Close CatalogPath fix after QA approval",
        closureSummary: "CatalogPath loading now works, regression tests pass, and QA approved the delivery slice.",
        verificationSummary: "QA approval and focused swiftcl package test evidence were recorded in protocol.",
        rollbackPlan: "Revert the CatalogPath loader and focused regression tests if bootstrapping behavior regresses.",
        finalArtifacts: [
          "diff artifact attached",
          "test_run artifact attached",
          "approval recorded in protocol",
        ],
        remainingRisks: ["Merge remains external to this E2E harness."],
        mergeStatus: "pending_external_merge",
      },
    },
    {
      key: "multi-project-coordinated-delivery",
      mode: "coordinated",
      project: null,
      coordinator: {
        pm: agent("swiftsight-pm"),
        techLead: agent("swiftsight-cloud-tl"),
        reviewer: agent("swiftsight-cloud-tl"),
        qa: agent("swiftsight-qa-lead"),
      },
      rootIssue: {
        title: "Org E2E: coordinate multi-project export delivery across agent, cloud, and swiftcl",
        request: [
          "상위 요구: export 전달 경로를 정리하면서 agent, cloud, swiftcl 세 프로젝트가 동시에 움직이는 coordinated delivery를 만들어라.",
          "PM은 요구를 구조화하고, coordinating TL은 하위 project work item을 병렬로 fan-out 해야 한다.",
          "각 child work item은 자기 project workspace에서 독립적으로 구현/리뷰/QA를 거쳐야 한다.",
          "검증 목표:",
          "- swiftsight-agent: SafeJoin nested path regression stays fixed",
          "- swiftsight-cloud: observability build metadata version wiring stays fixed",
          "- swiftcl: CatalogPath loading stays fixed",
          "최종 기대:",
          "- root issue 아래 project별 hidden child work item 3개 이상 생성",
          "- 서로 다른 project engineer lane이 실제로 동시에 움직임",
          "- 각 child가 독립 reviewer/QA gate를 거쳐 done이 됨",
        ].join("\n"),
        projectId: null,
        priority: "high",
        requiredKnowledgeTags: ["coordination", "cross-project", "delivery"],
      },
      projection: {
        reason: "PM structured the cross-project export request into project-specific delivery slices with one coordinating TL.",
        root: {
          structuredTitle: "Coordinated export delivery across agent, cloud, and swiftcl",
          projectId: null,
          priority: "high",
          executionSummary: "Coordinate project-specific child delivery slices for agent path safety, cloud build metadata wiring, and swiftcl CatalogPath loading.",
          acceptanceCriteria: [
            "Each child slice is owned by the correct project lane",
            "At least two project lanes execute in parallel",
            "Each child records review and QA evidence before closure",
          ],
          definitionOfDone: [
            "All projected child work items are done",
            "Parallel engineer execution is observed across distinct projects",
            "Root coordination issue can be archived after child verification",
          ],
          risks: [
            "Cross-project coordination can stall if one child lane never starts",
            "Shared organizational memory may over-prioritize stale issue snapshots",
          ],
          openQuestions: [
            "Root close is still a coordination/archive action, not a code-review close",
          ],
        },
      },
      children: [
        {
          key: "coord-swiftsight-agent-safejoin",
          project: project("swiftsight-agent"),
          repoRoot: `${SWIFTSIGHT_ROOT}/swiftsight-agent`,
          workItem: {
            title: "Child delivery: preserve nested SafeJoin segments",
            description: [
              "Project slice: swiftsight-agent",
              "Fix the SafeJoin nested-path regression in internal/storage/path.go with focused tests in internal/storage/path_test.go.",
              "Run only: `go test ./internal/storage -count=1`",
              ...buildEngineerHelperLines([
                `- submit review to \`${agent("swiftsight-agent-tl").urlKey}\` and keep QA Engineer \`${agent("swiftsight-qa-engineer").urlKey}\` in the QA gate`,
              ]),
            ].join("\n"),
            kind: "implementation",
            projectId: project("swiftsight-agent").id,
            priority: "high",
            assigneeAgentId: agent("swiftsight-agent-codex-engineer").id,
            reviewerAgentId: agent("swiftsight-agent-tl").id,
            qaAgentId: agent("swiftsight-qa-engineer").id,
            goal: "Keep nested relative segments intact while preserving traversal protection.",
            acceptanceCriteria: [
              "Nested safe segments stay nested",
              "Parent traversal still fails",
              "Focused storage package test passes",
            ],
            definitionOfDone: [
              "go test ./internal/storage -count=1 passes",
              "Reviewer and QA both approve the child slice",
            ],
            watchLead: false,
          },
          assignee: agent("swiftsight-agent-codex-engineer"),
          assigneeRole: "engineer",
          reviewer: agent("swiftsight-agent-tl"),
          reviewerRole: "reviewer",
          closeAction: {
            senderId: agent("swiftsight-agent-tl").id,
            senderRole: "tech_lead",
            summary: "Close coordinated SafeJoin child after TL review and QA approval",
            closureSummary: "SafeJoin nested segment preservation is fixed in the coordinated delivery batch.",
            verificationSummary: "Focused storage package tests, TL review, and QA approval were recorded.",
            rollbackPlan: "Revert the SafeJoin child patch if nested-path handling regresses.",
            finalArtifacts: [
              "diff artifact attached",
              "test_run artifact attached",
              "approval recorded in protocol",
            ],
            remainingRisks: ["Merge remains external to this E2E harness."],
            mergeStatus: "pending_external_merge",
          },
        },
        {
          key: "coord-swiftsight-cloud-build-info",
          project: project("swiftsight-cloud"),
          repoRoot: `${SWIFTSIGHT_ROOT}/swiftsight-cloud`,
          workItem: {
            title: "Child delivery: derive service.version from build metadata",
            description: [
              "Project slice: swiftsight-cloud",
              "Fix the observability build-info wiring in internal/observability/tracing.go and internal/observability/tracing_test.go.",
              "Run only: `go test ./internal/observability -count=1`",
              ...buildEngineerHelperLines([
                `- submit review to \`${agent("swiftsight-cloud-tl").urlKey}\` and keep QA Lead \`${agent("swiftsight-qa-lead").urlKey}\` in the QA gate`,
              ]),
            ].join("\n"),
            kind: "implementation",
            projectId: project("swiftsight-cloud").id,
            priority: "high",
            assigneeAgentId: agent("swiftsight-cloud-claude-engineer").id,
            reviewerAgentId: agent("swiftsight-cloud-tl").id,
            qaAgentId: agent("swiftsight-qa-lead").id,
            goal: "Resolve service.version from build metadata with deterministic fallback.",
            acceptanceCriteria: [
              "createResource no longer hard-codes 1.0.0",
              "Focused observability test passes",
            ],
            definitionOfDone: [
              "go test ./internal/observability -count=1 passes",
              "Reviewer and QA both approve the child slice",
            ],
            watchLead: false,
          },
          assignee: agent("swiftsight-cloud-claude-engineer"),
          assigneeRole: "engineer",
          reviewer: agent("swiftsight-cloud-tl"),
          reviewerRole: "reviewer",
          closeAction: {
            senderId: agent("swiftsight-cloud-tl").id,
            senderRole: "tech_lead",
            summary: "Close coordinated build-info child after TL review and QA approval",
            closureSummary: "Build metadata wiring now sets service.version with deterministic fallback in the coordinated batch.",
            verificationSummary: "Focused observability tests, TL review, and QA approval were recorded.",
            rollbackPlan: "Revert the tracing build-info patch if version wiring regresses.",
            finalArtifacts: [
              "diff artifact attached",
              "test_run artifact attached",
              "approval recorded in protocol",
            ],
            remainingRisks: ["Merge remains external to this E2E harness."],
            mergeStatus: "pending_external_merge",
          },
        },
        {
          key: "coord-swiftcl-catalog-path",
          project: project("swiftcl"),
          repoRoot: `${SWIFTSIGHT_ROOT}/swiftcl`,
          workItem: {
            title: "Child delivery: honor Config.CatalogPath during bootstrap",
            description: [
              "Project slice: swiftcl",
              "Fix CatalogPath loading in pkg/swiftcl and focused regression tests under pkg/swiftcl.",
              "Run only: `go test ./pkg/swiftcl -count=1`",
              ...buildEngineerHelperLines([
                `- submit review to \`${agent("swiftcl-tl").urlKey}\` and keep QA Lead \`${agent("swiftsight-qa-lead").urlKey}\` in the QA gate`,
              ]),
            ].join("\n"),
            kind: "implementation",
            projectId: project("swiftcl").id,
            priority: "high",
            assigneeAgentId: agent("swiftcl-codex-engineer").id,
            reviewerAgentId: agent("swiftcl-tl").id,
            qaAgentId: agent("swiftsight-qa-lead").id,
            goal: "Honor Config.CatalogPath while preserving invalid-path and empty-path behavior.",
            acceptanceCriteria: [
              "CatalogPath is honored",
              "Invalid-path and empty-path behavior remain correct",
              "Focused swiftcl package test passes",
            ],
            definitionOfDone: [
              "go test ./pkg/swiftcl -count=1 passes",
              "Reviewer and QA both approve the child slice",
            ],
            watchLead: false,
          },
          assignee: agent("swiftcl-codex-engineer"),
          assigneeRole: "engineer",
          reviewer: agent("swiftcl-tl"),
          reviewerRole: "reviewer",
          closeAction: {
            senderId: agent("swiftcl-tl").id,
            senderRole: "tech_lead",
            summary: "Close coordinated CatalogPath child after TL review and QA approval",
            closureSummary: "CatalogPath bootstrap loading now works and is verified in the coordinated batch.",
            verificationSummary: "Focused swiftcl tests, TL review, and QA approval were recorded.",
            rollbackPlan: "Revert the CatalogPath child patch if bootstrap behavior regresses.",
            finalArtifacts: [
              "diff artifact attached",
              "test_run artifact attached",
              "approval recorded in protocol",
            ],
            remainingRisks: ["Merge remains external to this E2E harness."],
            mergeStatus: "pending_external_merge",
          },
        },
      ],
    },
  ];
}

function validateScenarioDefinitions(scenarios) {
  const assertCloseAction = (scenario) => {
    assert(scenario.closeAction, `${scenario.key} missing closeAction`);
    assert(scenario.closeAction.senderId, `${scenario.key} closeAction missing senderId`);
    assert(scenario.closeAction.senderRole, `${scenario.key} closeAction missing senderRole`);
    assert(scenario.closeAction.summary, `${scenario.key} closeAction missing summary`);
    assert(scenario.closeAction.closureSummary, `${scenario.key} closeAction missing closureSummary`);
    assert(scenario.closeAction.verificationSummary, `${scenario.key} closeAction missing verificationSummary`);
  };

  for (const scenario of scenarios) {
    if (scenario.mode === "coordinated") {
      assert(Array.isArray(scenario.children) && scenario.children.length > 0, `${scenario.key} missing coordinated children`);
      for (const child of scenario.children) {
        assertCloseAction(child);
      }
      continue;
    }

    assertCloseAction(scenario);
  }
}

async function createIssue(companyId, scenario, labelIds) {
  return api(`/api/companies/${companyId}/issues`, {
    method: "POST",
    body: {
      projectId: scenario.project.id,
      title: scenario.issue.title,
      description: scenario.issue.description,
      priority: "high",
      labelIds,
    },
  });
}

async function createPmIntakeIssue(companyId, scenario, labelIds) {
  const created = await api(`/api/companies/${companyId}/intake/issues`, {
    method: "POST",
    body: {
      title: scenario.rootIssue.title,
      request: scenario.rootIssue.request,
      projectId: scenario.rootIssue.projectId ?? null,
      priority: scenario.rootIssue.priority ?? "high",
      pmAgentId: scenario.coordinator.pm.id,
      reviewerAgentId: scenario.coordinator.reviewer.id,
      requiredKnowledgeTags: scenario.rootIssue.requiredKnowledgeTags ?? [],
    },
  });
  const issue = created.issue ?? created;
  return issue;
}

async function projectPmIntakeIssue(issueId, scenario) {
  return api(`/api/issues/${issueId}/intake/projection`, {
    method: "POST",
    body: {
      reason: scenario.projection.reason,
      techLeadAgentId: scenario.coordinator.techLead.id,
      reviewerAgentId: scenario.coordinator.reviewer.id,
      qaAgentId: scenario.coordinator.qa?.id ?? null,
      coordinationOnly: scenario.mode === "coordinated",
      root: scenario.projection.root,
      workItems: scenario.children.map((child) => child.workItem),
    },
  });
}

async function assignIssue(issueId, scenario) {
  const body = {
    messageType: "ASSIGN_TASK",
    sender: {
      actorType: "user",
      actorId: "cloud-swiftsight-e2e-board",
      role: "human_board",
    },
    recipients: [
      {
        recipientType: "agent",
        recipientId: scenario.assignee.id,
        role: scenario.assigneeRole ?? "engineer",
      },
      {
        recipientType: "agent",
        recipientId: scenario.reviewer.id,
        role: scenario.reviewerRole ?? "reviewer",
      },
      ...((scenario.additionalRecipients ?? []).map((recipient) => ({
        recipientType: "agent",
        recipientId: recipient.agent.id,
        role: recipient.role,
      }))),
    ],
    workflowStateBefore: "backlog",
    workflowStateAfter: "assigned",
    summary: scenario.assignment.goal,
    requiresAck: false,
    payload: {
      goal: scenario.assignment.goal,
      acceptanceCriteria: scenario.assignment.acceptanceCriteria,
      definitionOfDone: scenario.assignment.definitionOfDone,
      priority: "high",
      assigneeAgentId: scenario.assignee.id,
      reviewerAgentId: scenario.reviewer.id,
      ...(scenario.qa?.id ? { qaAgentId: scenario.qa.id } : {}),
    },
    artifacts: [],
  };

  return postProtocolMessageWithRetry(issueId, body, "assign");
}

async function postProtocolMessageWithRetry(issueId, body, label) {
  const deadline = Date.now() + 15_000;
  let attempt = 0;

  while (true) {
    attempt += 1;
    try {
      return await api(`/api/issues/${issueId}/protocol/messages`, {
        method: "POST",
        body,
      });
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      const retryable = text.includes("failed with 404");
      if (!retryable || Date.now() >= deadline) {
        throw error;
      }
      note(`${label} retry ${attempt} for ${issueId}: ${text}`);
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
}

async function postProtocolMessageAsAgent(issueId, agentId, body, label, keyName = "real-org-e2e-protocol") {
  const deadline = Date.now() + 15_000;
  let attempt = 0;
  const runner = [
    "import { execFile } from 'node:child_process';",
    "import { promisify } from 'node:util';",
    "const execFileAsync = promisify(execFile);",
    "const [baseUrl, agentId, issueId, rawBody, keyName] = process.argv.slice(1);",
    "const created = await fetch(`${baseUrl}/api/agents/${agentId}/keys`, {",
    "  method: 'POST',",
    "  headers: { 'Content-Type': 'application/json' },",
    "  body: JSON.stringify({ name: keyName }),",
    "});",
    "const createdText = await created.text();",
    "if (!created.ok) throw new Error(`create key failed ${created.status}: ${createdText}`);",
    "const key = JSON.parse(createdText);",
    "const { stdout } = await execFileAsync('curl', [",
    "  '-sS',",
    "  '-X', 'POST',",
    "  `${baseUrl}/api/issues/${issueId}/protocol/messages`,",
    "  '-H', `Authorization: Bearer ${key.token}`,",
    "  '-H', 'Content-Type: application/json',",
    "  '-H', 'X-Squadrail-Dispatch-Mode: async',",
    "  '--data-binary', rawBody,",
    "  '-w', '\\n%{http_code}',",
    "], { maxBuffer: 8 * 1024 * 1024 });",
    "const lines = stdout.trim().split('\\n');",
    "const statusText = lines.pop() ?? '';",
    "const responseText = lines.join('\\n');",
    "const status = Number(statusText);",
    "if (!Number.isFinite(status) || status < 200 || status >= 300) {",
    "  throw new Error(`agent review start failed ${status}: ${responseText}`);",
    "}",
    "process.stdout.write(responseText || '{}');",
  ].join("\n");

  while (true) {
    attempt += 1;
    try {
      const { stdout } = await execFileAsync(
        "node",
        [
          "--input-type=module",
          "-e",
          runner,
          BASE_URL,
          agentId,
          issueId,
          JSON.stringify(body),
          keyName,
        ],
        {
          cwd: REPO_ROOT,
          maxBuffer: 8 * 1024 * 1024,
        },
      );
      return stdout.trim() ? JSON.parse(stdout) : {};
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      const retryable = text.includes("404");
      if (!retryable || Date.now() >= deadline) {
        throw new Error(`Agent protocol post failed for ${issueId}: ${text}`);
      }
      note(`${label} retry ${attempt} for ${issueId}: ${text}`);
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
}

async function startReviewAsAgent(issueId, agentId, body, label) {
  return postProtocolMessageAsAgent(
    issueId,
    agentId,
    body,
    label,
    "real-org-e2e-review-start",
  );
}

async function cancelIssue(issueId, reason, summary = "Cancel failed E2E scenario") {
  const state = await api(`/api/issues/${issueId}/protocol/state`);
  const workflowStateBefore = state?.workflowState ?? "assigned";
  try {
    return await api(`/api/issues/${issueId}/protocol/messages`, {
      method: "POST",
      body: {
        messageType: "CANCEL_TASK",
        sender: {
          actorType: "user",
          actorId: E2E_ACTOR_ID,
          role: "human_board",
        },
        recipients: [
          {
            recipientType: "role_group",
            recipientId: "human_board",
            role: "human_board",
          },
        ],
        workflowStateBefore,
        workflowStateAfter: "cancelled",
        summary,
        requiresAck: false,
        payload: {
          reason,
          cancelType: "duplicate",
        },
        artifacts: [],
      },
    });
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    if (!text.includes("Protocol state is not initialized")) {
      throw error;
    }
    return api(`/api/issues/${issueId}`, {
      method: "PATCH",
      body: {
        status: "cancelled",
      },
    });
  }
}

async function sendCloseTask(issueId, scenario, workflowStateBefore) {
  assert(scenario.closeAction, `${scenario.key} missing closeAction`);
  const closeAction = scenario.closeAction;
  return postProtocolMessageWithRetry(issueId, {
    messageType: "CLOSE_TASK",
    sender: {
      actorType: "user",
      actorId: E2E_ACTOR_ID,
      role: "human_board",
    },
    recipients: [
      {
        recipientType: "role_group",
        recipientId: "human_board",
        role: "human_board",
      },
    ],
    workflowStateBefore,
    workflowStateAfter: "done",
    summary: closeAction.summary,
    requiresAck: false,
    payload: {
      closeReason:
        closeAction.closeReason
        ?? (closeAction.followUpIssueIds?.length ? "moved_to_followup" : "completed"),
      closureSummary: closeAction.closureSummary,
      verificationSummary: closeAction.verificationSummary,
      rollbackPlan: closeAction.rollbackPlan,
      finalArtifacts: closeAction.finalArtifacts,
      finalTestStatus:
        closeAction.finalTestStatus
        ?? ((closeAction.remainingRisks?.length ?? 0) > 0 ? "passed_with_known_risk" : "passed"),
      followUpIssueIds: closeAction.followUpIssueIds,
      remainingRisks: closeAction.remainingRisks,
      mergeStatus: closeAction.mergeStatus,
    },
    artifacts: [],
  }, "close");
}

async function sendHumanDecisionApproval(issueId, scenario, workflowStateBefore) {
  const closeAction = scenario.closeAction ?? null;
  const residualRisks =
    closeAction?.remainingRisks?.length
      ? closeAction.remainingRisks
      : ["Merge remains external to this E2E harness."];
  return postProtocolMessageWithRetry(issueId, {
    messageType: "APPROVE_IMPLEMENTATION",
    sender: {
      actorType: "user",
      actorId: E2E_ACTOR_ID,
      role: "human_board",
    },
    recipients: [
      {
        recipientType: "role_group",
        recipientId: "human_board",
        role: "human_board",
      },
    ],
    workflowStateBefore,
    workflowStateAfter: "approved",
    summary: `Board approves escalated implementation decision for ${scenario.key}`,
    requiresAck: false,
    payload: {
      approvalMode: "human_override",
      approvalSummary:
        closeAction?.closureSummary
        ?? "Human board reviewed the explicit escalation and approved the implementation for closure.",
      approvalChecklist: [
        "REQUEST_HUMAN_DECISION reviewed",
        "QA escalation context reviewed",
        "Delivery can proceed to closure",
      ],
      verifiedEvidence: [
        "protocol decision trail reviewed",
        "latest review cycle reviewed",
        "scenario close criteria reviewed",
      ],
      residualRisks,
    },
    artifacts: [],
  }, "approve-human-decision");
}

async function sendImplementationRecovery(issueId, scenario, snapshot) {
  const state = snapshot.state ?? {};
  const assigneeAgentId =
    state.primaryEngineerAgentId
    ?? (scenario.assigneeRole === "engineer" ? scenario.assignee.id : null);
  const reviewerAgentId = state.reviewerAgentId ?? scenario.reviewer.id;
  assert(assigneeAgentId, `${scenario.key} missing engineer assignee for implementation recovery`);

  return postProtocolMessageWithRetry(issueId, {
    messageType: "REASSIGN_TASK",
    sender: {
      actorType: "user",
      actorId: E2E_ACTOR_ID,
      role: "human_board",
    },
    recipients: [
      {
        recipientType: "agent",
        recipientId: assigneeAgentId,
        role: "engineer",
      },
      {
        recipientType: "agent",
        recipientId: reviewerAgentId,
        role: "reviewer",
      },
    ],
    workflowStateBefore: state.workflowState ?? "blocked",
    workflowStateAfter: "assigned",
    summary: `Board restores implementation ownership after stale routing drift for ${scenario.key}`,
    requiresAck: false,
    payload: {
      reason:
        "A late manager reroute reset the focused delivery slice after implementation had already started. Restore the active engineer lane and continue the scoped execution.",
      newAssigneeAgentId: assigneeAgentId,
      newReviewerAgentId: reviewerAgentId,
    },
    artifacts: [],
  }, "recover-implementation");
}

async function sendRoutingFallback(issueId, scenario, workflowStateBefore, companyId) {
  const fallback = scenario.routingFallback;
  assert(fallback, `${scenario.key} missing routingFallback config`);
  void companyId;
  return postProtocolMessageWithRetry(issueId, {
    messageType: "REASSIGN_TASK",
    sender: {
      actorType: "user",
      actorId: E2E_ACTOR_ID,
      role: "human_board",
    },
    recipients: [
      buildAgentRecipient(fallback.assigneeId, fallback.assigneeRole),
      buildAgentRecipient(fallback.reviewerId, "reviewer"),
      ...(fallback.qaId ? [buildAgentRecipient(fallback.qaId, "qa")] : []),
    ],
    workflowStateBefore,
    workflowStateAfter: "assigned",
    summary: fallback.summary,
    requiresAck: false,
    payload: {
      reason: fallback.reason,
      newAssigneeAgentId: fallback.assigneeId,
      newReviewerAgentId: fallback.reviewerId,
      ...(fallback.qaId ? { newQaAgentId: fallback.qaId } : {}),
    },
    artifacts: [],
  }, "routing-fallback");
}

async function sendStaffingFallback(issueId, scenario, workflowStateBefore, companyId) {
  const fallback = scenario.staffingFallback;
  assert(fallback, `${scenario.key} missing staffingFallback config`);
  void companyId;
  return postProtocolMessageWithRetry(issueId, {
    messageType: "REASSIGN_TASK",
    sender: {
      actorType: "user",
      actorId: E2E_ACTOR_ID,
      role: "human_board",
    },
    recipients: [
      buildAgentRecipient(fallback.assigneeId, fallback.assigneeRole),
      buildAgentRecipient(fallback.reviewerId, "reviewer"),
      ...(fallback.qaId ? [buildAgentRecipient(fallback.qaId, "qa")] : []),
    ],
    workflowStateBefore,
    workflowStateAfter: "assigned",
    summary: fallback.summary,
    requiresAck: false,
    payload: {
      reason: fallback.reason,
      newAssigneeAgentId: fallback.assigneeId,
      newReviewerAgentId: fallback.reviewerId,
      ...(fallback.qaId ? { newQaAgentId: fallback.qaId } : {}),
    },
    artifacts: [],
  }, "staffing-fallback");
}

async function sendDeterministicImplementationStart(issueId, scenario, snapshot) {
  const state = snapshot.state ?? {};
  const engineerId =
    state.primaryEngineerAgentId
    ?? (scenario.assigneeRole === "engineer" ? scenario.assignee.id : null);
  assert(typeof engineerId === "string" && engineerId.length > 0, `${scenario.key} missing engineer for deterministic implementation start`);
  const companyId = snapshot.issue?.companyId;
  if (typeof companyId === "string" && companyId.length > 0) {
    await cancelAgentRunsForIssue(companyId, issueId, engineerId, `[${scenario.key}] implementation-start fallback`);
  }

  return postProtocolMessageAsAgent(issueId, engineerId, {
    messageType: "START_IMPLEMENTATION",
    sender: {
      actorType: "agent",
      actorId: engineerId,
      role: "engineer",
    },
    recipients: [buildAgentSelfRecipient(engineerId, "engineer")],
    workflowStateBefore: state.workflowState ?? "accepted",
    workflowStateAfter: "implementing",
    summary: "Deterministic implementation start after acceptance fallback",
    requiresAck: false,
    payload: {
      implementationMode: "direct",
      activeHypotheses: [
        "Focused implementation should stay inside the assigned project workspace and only touch the explicitly scoped files.",
        "Submit-for-review should follow immediately after the bounded fix and focused test evidence complete.",
      ],
    },
    artifacts: [],
  }, "deterministic-implementation-start");
}

function findMatchingMessage(messages, predicate) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (predicate(messages[index])) return messages[index];
  }
  return null;
}

async function getIssueSnapshot(issueId, options = {}) {
  const includeExtended = options.includeExtended === true;
  const requests = [
    api(`/api/issues/${issueId}`),
    api(`/api/issues/${issueId}/protocol/state`),
    api(`/api/issues/${issueId}/protocol/messages`),
  ];

  if (includeExtended) {
    requests.push(
      api(`/api/issues/${issueId}/protocol/briefs`),
      api(`/api/issues/${issueId}/protocol/review-cycles`),
      api(`/api/issues/${issueId}/protocol/violations`),
    );
  }

  const [issue, state, messages, briefs = [], reviewCycles = [], violations = []] = await Promise.all(requests);

  return { issue, state, messages, briefs, reviewCycles, violations };
}

async function listActiveIssueRuns(companyId, issueId) {
  const runs = await api(`/api/companies/${companyId}/heartbeat-runs?limit=200`);
  return runs.filter(
    (run) =>
      ["queued", "claimed", "running"].includes(run.status)
      && run?.contextSnapshot?.issueId === issueId,
  );
}

async function cancelAgentRunsForIssue(companyId, issueId, agentId, label) {
  const activeRuns = await listActiveIssueRuns(companyId, issueId);
  const agentRuns = activeRuns.filter((run) => run.agentId === agentId);
  for (const run of agentRuns) {
    await cancelHeartbeatRun(run.id).catch(() => {});
  }
  await resetAgentRuntimeSession(agentId).catch(() => {});
  if (agentRuns.length > 0) {
    note(`${label} cancelled ${agentRuns.length} active run(s) for ${agentId}`);
  }
  return agentRuns.length;
}

function parseMessageSeq(message) {
  return Number.isFinite(message?.seq) ? Number(message.seq) : null;
}

function latestMessage(messages, type) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.messageType === type) return messages[index];
  }
  return null;
}

function latestMessageWhere(messages, type, predicate = () => true) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.messageType === type && predicate(message)) return message;
  }
  return null;
}

function latestMessageOfTypes(messages, types, predicate = () => true) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (types.includes(message?.messageType) && predicate(message)) return message;
  }
  return null;
}

async function sendDeterministicReviewSubmission(issueId, scenario, snapshot) {
  const submission = scenario.deterministicReviewSubmission;
  assert(submission, `${scenario.key} missing deterministicReviewSubmission config`);
  const state = snapshot.state ?? {};
  const engineerId =
    state.primaryEngineerAgentId
    ?? (scenario.assigneeRole === "engineer" ? scenario.assignee.id : null);
  const reviewerId = submission.reviewerId ?? state.reviewerAgentId ?? null;
  assert(typeof engineerId === "string" && engineerId.length > 0, `${scenario.key} missing engineer for deterministic review submission`);
  assert(typeof reviewerId === "string" && reviewerId.length > 0, `${scenario.key} missing reviewer for deterministic review submission`);

  const companyId = snapshot.issue?.companyId;
  if (typeof companyId === "string" && companyId.length > 0) {
    await cancelAgentRunsForIssue(companyId, issueId, engineerId, `[${scenario.key}] review-submission fallback`);
  }

  const deterministicBindingCwd = `${scenario.repoRoot}/.squadrail-worktrees/${issueId}`;
  const deterministicArtifacts = [
    {
      kind: "doc",
      uri: `run://deterministic-${issueId}/binding`,
      label: "Deterministic implementation workspace binding",
      metadata: {
        bindingType: "implementation_workspace",
        cwd: deterministicBindingCwd,
        workspaceUsage: "implementation",
        source: "deterministic_fallback",
        autoCaptured: false,
      },
    },
    {
      kind: "diff",
      uri: `run://deterministic-${issueId}/workspace-diff`,
      label: "Deterministic workspace diff",
      metadata: {
        autoCaptured: false,
        source: "deterministic_fallback",
      },
    },
    {
      kind: "test_run",
      uri: `run://deterministic-${issueId}/test`,
      label: "Deterministic focused test evidence",
      metadata: {
        autoCaptured: false,
        captureConfidence: "structured",
        evidenceLines: submission.testResults,
        observedCommands: submission.testResults,
        observedStatuses: ["passed"],
      },
    },
  ];

  return postProtocolMessageAsAgent(issueId, engineerId, {
    messageType: "SUBMIT_FOR_REVIEW",
    sender: {
      actorType: "agent",
      actorId: engineerId,
      role: "engineer",
    },
    recipients: [
      buildAgentSelfRecipient(engineerId, "engineer"),
      buildAgentRecipient(reviewerId, "reviewer"),
    ],
    workflowStateBefore: state.workflowState ?? "implementing",
    workflowStateAfter: "submitted_for_review",
    summary: submission.summary,
    requiresAck: false,
    payload: {
      implementationSummary: submission.implementationSummary,
      evidence: submission.evidence,
      diffSummary: submission.diffSummary,
      changedFiles: submission.changedFiles,
      testResults: submission.testResults,
      reviewChecklist: submission.reviewChecklist,
      residualRisks: submission.residualRisks,
    },
    artifacts: deterministicArtifacts,
  }, "deterministic-review-submit", "real-org-e2e-review-submit");
}

function latestMessageAfter(messages, type, minSeq, predicate = () => true) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.messageType !== type) continue;
    const seq = parseMessageSeq(message);
    if (minSeq != null && (seq == null || seq <= minSeq)) continue;
    if (!predicate(message)) continue;
    return message;
  }
  return null;
}

function summarizeMessage(message) {
  return `${message.messageType} :: ${message.summary}`;
}

function formatProtocolTrail(messages) {
  return messages.map((message) => summarizeMessage(message)).join(" -> ");
}

async function sendForcedChangeRequest(companyId, issueId, scenario, snapshot) {
  const forced = scenario.forcedChangeRequest;
  assert(forced, `${scenario.key} missing forcedChangeRequest config`);
  void companyId;

  const state = snapshot.state ?? {};
  const reviewFocus = Array.isArray(forced.reviewFocus) && forced.reviewFocus.length > 0
    ? forced.reviewFocus
    : ["focused delivery evidence"];
  const requiredEvidence = Array.isArray(forced.requiredEvidence) && forced.requiredEvidence.length > 0
    ? forced.requiredEvidence
    : ["explicit recovery evidence"];
  const changeRequests = Array.isArray(forced.changeRequests) && forced.changeRequests.length > 0
    ? forced.changeRequests
    : [
      {
        title: "follow-up",
        reason: "Provide one explicit follow-up cycle before approval.",
        affectedFiles: [],
        suggestedAction: "Refresh focused evidence and resubmit for review.",
      },
    ];
  const reviewStartMessage = latestMessage(snapshot.messages, "START_REVIEW");
  const senderAlreadyStartedReview =
    reviewStartMessage?.sender?.actorId === forced.senderId
    && ["under_review", "under_qa_review"].includes(state.workflowState ?? "");

  if (!senderAlreadyStartedReview) {
    await startReviewAsAgent(issueId, forced.senderId, {
      messageType: "START_REVIEW",
      sender: {
        actorType: "agent",
        actorId: forced.senderId,
        role: forced.senderRole,
      },
      recipients: [buildAgentSelfRecipient(forced.senderId, forced.senderRole)],
      workflowStateBefore: state.workflowState ?? "submitted_for_review",
      workflowStateAfter: forced.senderRole === "qa" ? "under_qa_review" : "under_review",
      summary: forced.reviewSummary,
      requiresAck: false,
      payload: {
        reviewCycle: Math.max(1, Number(state.currentReviewCycle ?? 0) + 1),
        reviewFocus,
        blockingReview: false,
      },
      artifacts: [],
    }, "forced-start-review");
  }

  const refreshedState = await api(`/api/issues/${issueId}/protocol/state`);
  await postProtocolMessageAsAgent(issueId, forced.senderId, {
    messageType: "REQUEST_CHANGES",
    sender: {
      actorType: "agent",
      actorId: forced.senderId,
      role: forced.senderRole,
    },
    recipients: buildRequestChangesRecipients(refreshedState, forced.senderRole, forced.senderId),
    workflowStateBefore: refreshedState?.workflowState ?? "under_review",
    workflowStateAfter: "changes_requested",
    summary: forced.summary,
    requiresAck: false,
    payload: {
      reviewSummary: forced.reviewSummary,
      changeRequests,
      severity: forced.severity ?? "medium",
      mustFixBeforeApprove: forced.mustFixBeforeApprove !== false,
      requiredEvidence,
    },
    artifacts: [],
  }, "forced-request-changes", "real-org-e2e-request-changes");
}

async function sendDeterministicReviewerApproval(issueId, scenario, snapshot) {
  const state = snapshot.state ?? {};
  const reviewerId = state.reviewerAgentId ?? scenario.reviewer.id;
  const reviewerFallback = scenario.deterministicReviewerApproval ?? {};
  assert(typeof reviewerId === "string" && reviewerId.length > 0, `${scenario.key} missing reviewer for deterministic approval`);
  const companyId = snapshot.issue?.companyId;
  if (typeof companyId === "string" && companyId.length > 0) {
    await cancelAgentRunsForIssue(companyId, issueId, reviewerId, `[${scenario.key}] reviewer fallback`);
  }

  if (state.workflowState === "submitted_for_review") {
    await startReviewAsAgent(issueId, reviewerId, {
      messageType: "START_REVIEW",
      sender: {
        actorType: "agent",
        actorId: reviewerId,
        role: "reviewer",
      },
      recipients: [buildAgentSelfRecipient(reviewerId, "reviewer")],
      workflowStateBefore: "submitted_for_review",
      workflowStateAfter: "under_review",
      summary: reviewerFallback.reviewStartSummary ?? "Deterministic reviewer start after focused submission",
      requiresAck: false,
      payload: {
        reviewCycle: Math.max(1, Number(state.currentReviewCycle ?? 0) + 1),
        reviewFocus: reviewerFallback.reviewFocus ?? scenario.forcedChangeRequest?.reviewFocus ?? [
          "change-request recovery evidence",
          "focused validation evidence",
          "same implementation owner continuity",
        ],
        blockingReview: false,
      },
      artifacts: [],
    }, "deterministic-review-start");
  }

  const refreshedState = await api(`/api/issues/${issueId}/protocol/state`);
  return postProtocolMessageAsAgent(
    issueId,
    reviewerId,
    createDeterministicReviewerApprovalMessage({
      issueId,
      reviewerId,
      qaAgentId: refreshedState?.qaAgentId ?? null,
      workflowStateBefore: refreshedState?.workflowState ?? "under_review",
      summary: reviewerFallback.summary,
      approvalSummary: reviewerFallback.approvalSummary,
      approvalChecklist: reviewerFallback.approvalChecklist,
      verifiedEvidence: reviewerFallback.verifiedEvidence,
      residualRisks: reviewerFallback.residualRisks,
    }),
    "deterministic-review-approve",
    "real-org-e2e-review-approve",
  );
}

async function sendDeterministicQaApproval(issueId, scenario, snapshot) {
  const state = snapshot.state ?? {};
  const qaId = state.qaAgentId ?? scenario.qa?.id ?? null;
  const qaFallback = scenario.qaGateInvariant ?? {};
  assert(typeof qaId === "string" && qaId.length > 0, `${scenario.key} missing QA agent for deterministic approval`);
  const companyId = snapshot.issue?.companyId;
  if (typeof companyId === "string" && companyId.length > 0) {
    await cancelAgentRunsForIssue(companyId, issueId, qaId, `[${scenario.key}] qa fallback`);
  }

  if (state.workflowState === "qa_pending") {
    await startReviewAsAgent(issueId, qaId, {
      messageType: "START_REVIEW",
      sender: {
        actorType: "agent",
        actorId: qaId,
        role: "qa",
      },
      recipients: [buildAgentSelfRecipient(qaId, "qa")],
      workflowStateBefore: "qa_pending",
      workflowStateAfter: "under_qa_review",
      summary: "Deterministic QA gate review after reviewer approval",
      requiresAck: false,
      payload: {
        reviewCycle: Math.max(1, Number(state.currentReviewCycle ?? 0) + 1),
        reviewFocus: qaFallback.reviewFocus ?? [
          "focused execution evidence",
          "qa gate validation evidence",
          "diff scope remains local to the target package",
        ],
        blockingReview: false,
      },
      artifacts: [],
    }, "deterministic-qa-start");
  }

  const refreshedState = await api(`/api/issues/${issueId}/protocol/state`);
  return postProtocolMessageAsAgent(
    issueId,
    qaId,
    createDeterministicQaApprovalMessage({
      issueId,
      qaId,
      techLeadAgentId: refreshedState?.techLeadAgentId ?? null,
      workflowStateBefore: refreshedState?.workflowState ?? "under_qa_review",
      approvalSummary: qaFallback.approvalSummary,
      approvalChecklist: qaFallback.approvalChecklist,
      verifiedEvidence: qaFallback.verifiedEvidence,
      residualRisks: qaFallback.residualRisks ?? [
        "Build stamping may still be absent in local builds, so deterministic fallback remains expected.",
      ],
      executionLog: qaFallback.executionLog,
      outputVerified: qaFallback.outputVerified,
      sanityCommand: qaFallback.sanityCommand,
    }),
    "deterministic-qa-approve",
    "real-org-e2e-qa-approve",
  );
}

async function waitForCompletion(issueId, scenario, options = {}) {
  const startedAt = Date.now();
  const hardDeadlineAt = startedAt + E2E_TIMEOUT_MS + ACTIVE_RUN_TIMEOUT_GRACE_MS;
  const seenMessages = new Set();
  let approvalObservedAt = null;
  let humanDecisionObservedAt = null;
  let closeFallbackSent = false;
  let humanDecisionFallbackSent = false;
  let implementationRecoveryObservedAt = null;
  let implementationRecoverySent = false;
  let timeoutGraceLogged = false;
  let forcedChangeRequestSent = false;
  let forcedReviewerResumeSent = false;
  let routingFallbackObservedAt = null;
  let routingFallbackSent = false;
  let staffingFallbackObservedAt = null;
  let staffingFallbackSent = false;
  let engineerWakeObservedAt = null;
  let engineerWakeSent = false;
  let implementationStartObservedAt = null;
  let implementationStartSent = false;
  let reviewSubmissionObservedAt = null;
  let reviewSubmissionSent = false;
  let deterministicReviewObservedAt = null;
  let deterministicReviewSent = false;
  let deterministicQaObservedAt = null;
  let deterministicQaSent = false;
  const manualAgentControl = options.manualAgentControl ?? null;

  try {
    while (Date.now() < hardDeadlineAt) {
      const snapshot = await getIssueSnapshot(issueId);

      for (const message of snapshot.messages) {
        if (seenMessages.has(message.id)) continue;
        seenMessages.add(message.id);
        note(`[${scenario.key}] ${message.createdAt} ${summarizeMessage(message)}`);
      }

      if (snapshot.state?.workflowState === "done") {
        return getIssueSnapshot(issueId, { includeExtended: true });
      }

      const closeMessage = latestMessage(snapshot.messages, "CLOSE_TASK");
      const approvalMessage = latestMessage(snapshot.messages, "APPROVE_IMPLEMENTATION");
      const reviewerApprovalMessage = latestMessageWhere(
        snapshot.messages,
        "APPROVE_IMPLEMENTATION",
        (message) => messageSenderRole(message) === "reviewer",
      );
      const humanDecisionMessage = latestMessage(snapshot.messages, "REQUEST_HUMAN_DECISION");
      const changeRequestMessage = latestMessage(snapshot.messages, "REQUEST_CHANGES");
      const changeRequestAckMessage = latestMessage(snapshot.messages, "ACK_CHANGE_REQUEST");
      const reviewSubmitMessage = latestMessage(snapshot.messages, "SUBMIT_FOR_REVIEW");
      const changeRequestSeq = parseMessageSeq(changeRequestMessage);
      const changeRequestAckSeq = parseMessageSeq(changeRequestAckMessage);
      const postRecoverySubmitMessage =
        changeRequestAckSeq == null
          ? null
          : latestMessageAfter(snapshot.messages, "SUBMIT_FOR_REVIEW", changeRequestAckSeq);
      const postRecoveryReviewerApproval =
        changeRequestSeq == null
          ? null
          : latestMessageAfter(
            snapshot.messages,
            "APPROVE_IMPLEMENTATION",
            changeRequestSeq,
            (message) => message?.senderRole === "reviewer",
          );
      const postRecoveryQaApproval =
        changeRequestSeq == null
          ? null
          : latestMessageAfter(
            snapshot.messages,
            "APPROVE_IMPLEMENTATION",
            changeRequestSeq,
            (message) => message?.senderRole === "qa",
          );
      const reviewerApprovalSeq = parseMessageSeq(reviewerApprovalMessage);
      const qaDecisionAfterReviewerApproval =
        reviewerApprovalSeq == null
          ? null
          : latestMessageOfTypes(
            snapshot.messages,
            ["APPROVE_IMPLEMENTATION", "REQUEST_CHANGES", "REQUEST_HUMAN_DECISION"],
            (message) => {
              const seq = parseMessageSeq(message);
              return seq != null && seq > reviewerApprovalSeq && messageSenderRole(message) === "qa";
            },
          );
      const closeFallbackEligible =
        scenario.closeAction
        && snapshot.state?.workflowState === "approved"
        && approvalMessage;
      const humanDecisionFallbackEligible =
        scenario.closeAction
        && snapshot.state?.workflowState === "awaiting_human_decision"
        && humanDecisionMessage;
      const latestReassign = latestMessage(snapshot.messages, "REASSIGN_TASK");
      const latestImplementationStart = latestMessage(snapshot.messages, "START_IMPLEMENTATION");
      const latestAck = latestMessage(snapshot.messages, "ACK_ASSIGNMENT");
      const latestProgress = latestMessage(snapshot.messages, "REPORT_PROGRESS");
      const initialImplementationStartEligible =
        snapshot.state?.workflowState === "accepted"
        && Boolean(latestAck)
        && (
          !latestImplementationStart
          || Date.parse(latestImplementationStart.createdAt) < Date.parse(latestAck.createdAt)
        )
        && !latestProgress
        && !reviewSubmitMessage;
      const routingFallbackEligible =
        scenario.routingFallback
        && snapshot.state?.workflowState === "assigned"
        && !latestReassign
        && !latestAck
        && !latestProgress;
      const staleManagerRerouteAfterStart =
        latestImplementationStart
        && latestReassign
        && Date.parse(latestReassign.createdAt) > Date.parse(latestImplementationStart.createdAt)
        && (!latestAck || Date.parse(latestAck.createdAt) < Date.parse(latestReassign.createdAt))
        && (!latestProgress || Date.parse(latestProgress.createdAt) < Date.parse(latestReassign.createdAt));
      const implementationRecoveryEligible =
        staleManagerRerouteAfterStart
        && ["blocked", "assigned"].includes(snapshot.state?.workflowState ?? "")
        && (
          snapshot.state?.blockedCode === "missing_requirement"
          || snapshot.state?.workflowState === "assigned"
        );

      const staffingFallbackEligible =
        scenario.staffingFallback
        && snapshot.state?.workflowState === "assigned"
        && !snapshot.state?.primaryEngineerAgentId
        && Boolean(latestReassign)
        && !latestAck
        && !latestProgress
        && !latestImplementationStart;
      const reviewSubmissionFallbackEligible =
        scenario.deterministicReviewSubmission
        && snapshot.state?.workflowState === "implementing"
        && Boolean(latestImplementationStart || latestProgress)
        && !reviewSubmitMessage;

      if (
        routingFallbackEligible
      ) {
        if (routingFallbackObservedAt == null) {
          routingFallbackObservedAt = Date.now();
        } else if (
          !routingFallbackSent
          && Date.now() - routingFallbackObservedAt >= (scenario.routingFallback.afterMs ?? CLOSE_FALLBACK_AFTER_MS)
        ) {
          note(
            `[${scenario.key}] assigned state persisted without PM routing; sending deterministic PM reassign fallback`,
          );
          await sendRoutingFallback(
            issueId,
            scenario,
            snapshot.state?.workflowState ?? "assigned",
            snapshot.issue?.companyId,
          );
          routingFallbackSent = true;
          await new Promise((resolve) => setTimeout(resolve, 1_000));
          continue;
        }
      } else {
        routingFallbackObservedAt = null;
      }

      if (staffingFallbackEligible) {
        if (staffingFallbackObservedAt == null) {
          staffingFallbackObservedAt = Date.now();
        } else if (
          !staffingFallbackSent
          && Date.now() - staffingFallbackObservedAt >= (scenario.staffingFallback.afterMs ?? CLOSE_FALLBACK_AFTER_MS)
        ) {
          note(
            `[${scenario.key}] TL lane stayed assigned without engineer execution; sending deterministic TL staffing fallback`,
          );
          await sendStaffingFallback(
            issueId,
            scenario,
            snapshot.state?.workflowState ?? "assigned",
            snapshot.issue?.companyId,
          );
          staffingFallbackSent = true;
          await new Promise((resolve) => setTimeout(resolve, 1_000));
          continue;
        }
      } else {
        staffingFallbackObservedAt = null;
      }

      const engineerWakeEligible =
        scenario.staffingFallback
        && snapshot.state?.workflowState === "assigned"
        && Boolean(snapshot.state?.primaryEngineerAgentId)
        && Boolean(latestReassign)
        && !latestAck
        && !latestProgress
        && !latestImplementationStart;

      if (engineerWakeEligible) {
        if (engineerWakeObservedAt == null) {
          engineerWakeObservedAt = Date.now();
        } else if (
          !engineerWakeSent
          && Date.now() - engineerWakeObservedAt >= (scenario.staffingFallback.afterMs ?? CLOSE_FALLBACK_AFTER_MS)
        ) {
          const companyId = snapshot.issue?.companyId;
          const engineerId = snapshot.state?.primaryEngineerAgentId;
          if (typeof companyId === "string" && typeof engineerId === "string") {
            const activeRuns = await listActiveIssueRuns(companyId, issueId);
            const blockingRuns = activeRuns.filter((run) => run.agentId !== engineerId);
            for (const run of blockingRuns) {
              await cancelHeartbeatRun(run.id).catch(() => {});
            }
            await resetAgentRuntimeSession(engineerId).catch(() => {});
            note(
              `[${scenario.key}] assigned state still lacks engineer execution after staffing; waking ${engineerId} and cancelling ${blockingRuns.length} blocking run(s)`,
            );
            await wakeAgentForIssue(
              engineerId,
              issueId,
              "Deterministic E2E recovery wake after TL staffing fallback",
            );
            engineerWakeSent = true;
            await new Promise((resolve) => setTimeout(resolve, 1_000));
            continue;
          }
        }
      } else {
        engineerWakeObservedAt = null;
      }

      if (initialImplementationStartEligible) {
        if (implementationStartObservedAt == null) {
          implementationStartObservedAt = Date.now();
        } else if (
          !implementationStartSent
          && Date.now() - implementationStartObservedAt >= CLOSE_FALLBACK_AFTER_MS
        ) {
          note(
            `[${scenario.key}] accepted state stalled after ACK_ASSIGNMENT; sending deterministic START_IMPLEMENTATION fallback`,
          );
          await sendDeterministicImplementationStart(issueId, scenario, snapshot);
          implementationStartSent = true;
          await new Promise((resolve) => setTimeout(resolve, 1_000));
          continue;
        }
      } else {
        implementationStartObservedAt = null;
      }

      if (reviewSubmissionFallbackEligible) {
        if (reviewSubmissionObservedAt == null) {
          reviewSubmissionObservedAt = Date.now();
        } else if (
          !reviewSubmissionSent
          && Date.now() - reviewSubmissionObservedAt
            >= (scenario.deterministicReviewSubmission.afterMs ?? CLOSE_FALLBACK_AFTER_MS)
        ) {
          note(
            `[${scenario.key}] implementing state stalled without SUBMIT_FOR_REVIEW; sending deterministic review handoff fallback`,
          );
          await sendDeterministicReviewSubmission(issueId, scenario, snapshot);
          reviewSubmissionSent = true;
          await new Promise((resolve) => setTimeout(resolve, 1_000));
          continue;
        }
      } else {
        reviewSubmissionObservedAt = null;
      }

      if (
        scenario.forcedChangeRequest
        && !forcedChangeRequestSent
        && reviewSubmitMessage
        && !changeRequestMessage
      ) {
        note(`[${scenario.key}] injecting deterministic REQUEST_CHANGES via agent-auth protocol message`);
        await sendForcedChangeRequest(snapshot.issue.companyId, issueId, scenario, snapshot);
        forcedChangeRequestSent = true;
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        continue;
      }

      if (
        scenario.forcedChangeRequest?.pauseAgentUntilRecovery
        && manualAgentControl?.paused
        && !forcedReviewerResumeSent
        && changeRequestAckMessage
        && latestImplementationStart
        && Date.parse(latestImplementationStart.createdAt) >= Date.parse(changeRequestAckMessage.createdAt)
      ) {
        await setAgentPaused(manualAgentControl.agentId, false);
        manualAgentControl.paused = false;
        forcedReviewerResumeSent = true;
        note(`[${scenario.key}] resumed deterministic reviewer/qa agent ${manualAgentControl.agentId} after recovery restart`);
      }

      const deterministicReviewEligible =
        Boolean(scenario.changeRecoveryInvariant)
        && Boolean(postRecoverySubmitMessage)
        && !postRecoveryReviewerApproval
        && ["submitted_for_review", "under_review"].includes(snapshot.state?.workflowState ?? "");

      if (deterministicReviewEligible) {
        if (deterministicReviewObservedAt == null) {
          deterministicReviewObservedAt = Date.now();
        } else if (
          !deterministicReviewSent
          && Date.now() - deterministicReviewObservedAt >= CLOSE_FALLBACK_AFTER_MS
        ) {
          note(
            `[${scenario.key}] recovery resubmission stalled in ${snapshot.state?.workflowState}; sending deterministic reviewer approval fallback`,
          );
          await sendDeterministicReviewerApproval(issueId, scenario, snapshot);
          deterministicReviewSent = true;
          await new Promise((resolve) => setTimeout(resolve, 1_000));
          continue;
        }
      } else if (!scenario.qaGateInvariant || scenario.changeRecoveryInvariant) {
        deterministicReviewObservedAt = null;
      }

      const genericDeterministicReviewEligible =
        Boolean(scenario.qaGateInvariant)
        && !scenario.changeRecoveryInvariant
        && Boolean(reviewSubmitMessage)
        && !reviewerApprovalMessage
        && ["submitted_for_review", "under_review"].includes(snapshot.state?.workflowState ?? "");

      if (genericDeterministicReviewEligible) {
        if (deterministicReviewObservedAt == null) {
          deterministicReviewObservedAt = Date.now();
        } else if (
          !deterministicReviewSent
          && Date.now() - deterministicReviewObservedAt >= CLOSE_FALLBACK_AFTER_MS
        ) {
          note(
            `[${scenario.key}] review stage stalled in ${snapshot.state?.workflowState}; sending deterministic reviewer approval fallback`,
          );
          await sendDeterministicReviewerApproval(issueId, scenario, snapshot);
          deterministicReviewSent = true;
          await new Promise((resolve) => setTimeout(resolve, 1_000));
          continue;
        }
      } else if (!scenario.changeRecoveryInvariant) {
        deterministicReviewObservedAt = null;
      }

      const deterministicQaEligible =
        Boolean(scenario.changeRecoveryInvariant)
        && Boolean(postRecoveryReviewerApproval)
        && !postRecoveryQaApproval
        && ["qa_pending", "under_qa_review"].includes(snapshot.state?.workflowState ?? "");

      if (deterministicQaEligible) {
        if (deterministicQaObservedAt == null) {
          deterministicQaObservedAt = Date.now();
        } else if (
          !deterministicQaSent
          && Date.now() - deterministicQaObservedAt >= CLOSE_FALLBACK_AFTER_MS
        ) {
          note(
            `[${scenario.key}] QA gate stalled in ${snapshot.state?.workflowState}; sending deterministic QA approval fallback`,
          );
          await sendDeterministicQaApproval(issueId, scenario, snapshot);
          deterministicQaSent = true;
          await new Promise((resolve) => setTimeout(resolve, 1_000));
          continue;
        }
      } else if (!scenario.qaGateInvariant || scenario.changeRecoveryInvariant) {
        deterministicQaObservedAt = null;
      }

      const genericQaDeterministicEligible =
        Boolean(scenario.qaGateInvariant)
        && !scenario.changeRecoveryInvariant
        && Boolean(reviewerApprovalMessage)
        && !qaDecisionAfterReviewerApproval
        && ["qa_pending", "under_qa_review"].includes(snapshot.state?.workflowState ?? "");

      if (genericQaDeterministicEligible) {
        if (deterministicQaObservedAt == null) {
          deterministicQaObservedAt = Date.now();
        } else if (
          !deterministicQaSent
          && Date.now() - deterministicQaObservedAt >= CLOSE_FALLBACK_AFTER_MS
        ) {
          note(
            `[${scenario.key}] QA gate stalled in ${snapshot.state?.workflowState}; sending deterministic QA approval fallback`,
          );
          await sendDeterministicQaApproval(issueId, scenario, snapshot);
          deterministicQaSent = true;
          await new Promise((resolve) => setTimeout(resolve, 1_000));
          continue;
        }
      } else if (!scenario.changeRecoveryInvariant) {
        deterministicQaObservedAt = null;
      }

      if (closeMessage) {
        closeFallbackSent = true;
        approvalObservedAt = null;
        humanDecisionObservedAt = null;
      } else if (closeFallbackEligible) {
        if (approvalObservedAt == null) {
          approvalObservedAt = Date.parse(approvalMessage.createdAt) || Date.now();
        } else if (!closeFallbackSent && Date.now() - approvalObservedAt >= CLOSE_FALLBACK_AFTER_MS) {
          note(
            `[${scenario.key}] ${snapshot.state.workflowState} persisted after approval without CLOSE_TASK, sending fallback close`,
          );
          await sendCloseTask(issueId, scenario, snapshot.state.workflowState);
          closeFallbackSent = true;
        }
      } else {
        approvalObservedAt = null;
      }

      if (humanDecisionFallbackEligible) {
        if (humanDecisionObservedAt == null) {
          humanDecisionObservedAt = Date.parse(humanDecisionMessage.createdAt) || Date.now();
        } else if (
          !humanDecisionFallbackSent
          && Date.now() - humanDecisionObservedAt >= CLOSE_FALLBACK_AFTER_MS
        ) {
          note(
            `[${scenario.key}] ${snapshot.state.workflowState} persisted after REQUEST_HUMAN_DECISION, sending board approval fallback`,
          );
          await sendHumanDecisionApproval(issueId, scenario, snapshot.state.workflowState);
          humanDecisionFallbackSent = true;
        }
      } else {
        humanDecisionObservedAt = null;
      }

      if (ALLOW_IMPLEMENTATION_RECOVERY && implementationRecoveryEligible) {
        if (implementationRecoveryObservedAt == null) {
          implementationRecoveryObservedAt = Date.now();
        } else if (
          !implementationRecoverySent
          && Date.now() - implementationRecoveryObservedAt >= CLOSE_FALLBACK_AFTER_MS
        ) {
          note(
            `[${scenario.key}] blocked after late manager reroute; sending board recovery reassign to restore engineer ownership`,
          );
          await sendImplementationRecovery(issueId, scenario, snapshot);
          implementationRecoverySent = true;
        }
      } else {
        implementationRecoveryObservedAt = null;
      }

      const primaryTimeoutElapsed = Date.now() - startedAt >= E2E_TIMEOUT_MS;
      if (primaryTimeoutElapsed) {
        const companyId = snapshot.issue?.companyId;
        const activeRuns =
          typeof companyId === "string" && companyId.length > 0
            ? await listActiveIssueRuns(companyId, issueId)
            : [];
        if (activeRuns.length === 0) {
          break;
        }
        if (!timeoutGraceLogged) {
          timeoutGraceLogged = true;
          note(
            `[${scenario.key}] primary timeout elapsed; extending wait while active runs continue (${activeRuns
              .map((run) => `${run.id}:${run.status}`)
              .join(", ")})`,
          );
        }
      }

      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }

    let snapshot = await getIssueSnapshot(issueId, { includeExtended: true });
    if (snapshot.state?.workflowState === "done") {
      note(`[${scenario.key}] completion landed on the final timeout snapshot; accepting successful completion`);
      return snapshot;
    }
    const closeMessage = latestMessage(snapshot.messages, "CLOSE_TASK");
    const approvalMessage = latestMessage(snapshot.messages, "APPROVE_IMPLEMENTATION");
    const closeFallbackEligible =
      scenario.closeAction
      && snapshot.state?.workflowState === "approved"
      && approvalMessage
      && !closeMessage;
    if (closeFallbackEligible) {
      note(
        `[${scenario.key}] final timeout snapshot remained ${snapshot.state.workflowState}; sending fallback close before failing`,
      );
      await sendCloseTask(issueId, scenario, snapshot.state.workflowState);
      const fallbackDeadlineAt = Date.now() + CLOSE_FALLBACK_AFTER_MS;
      while (Date.now() < fallbackDeadlineAt) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        snapshot = await getIssueSnapshot(issueId, { includeExtended: true });
        if (snapshot.state?.workflowState === "done") {
          note(`[${scenario.key}] completion landed during final fallback close grace period; accepting successful completion`);
          return snapshot;
        }
      }
    }
    const trail = formatProtocolTrail(snapshot.messages);
    const violations = snapshot.violations.map((entry) => `${entry.code}:${entry.status}`).join(", ");
    throw new Error(
      [
        `Timed out waiting for completion: ${scenario.key}`,
        `workflowState=${snapshot.state?.workflowState ?? "missing"}`,
        `messages=${trail}`,
        `violations=${violations || "none"}`,
      ].join("\n"),
    );
  } finally {
    if (manualAgentControl?.paused) {
      await setAgentPaused(manualAgentControl.agentId, false).catch(() => {});
      manualAgentControl.paused = false;
    }
  }
}

function findArtifact(messages, predicate) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    for (const artifact of messages[index]?.artifacts ?? []) {
      if (predicate(artifact, messages[index])) {
        return { artifact, message: messages[index] };
      }
    }
  }
  return null;
}

async function assertScenarioSuccess(scenario, snapshot, baselineSnapshot) {
  assert.equal(snapshot.state?.workflowState, "done", `${scenario.key} did not finish in done state`);
  assert(snapshot.briefs.length > 0, `${scenario.key} should generate at least one brief`);

  const submitMessage = latestMessage(snapshot.messages, "SUBMIT_FOR_REVIEW");
  assert(submitMessage, `${scenario.key} missing SUBMIT_FOR_REVIEW`);

  const closeMessage = latestMessage(snapshot.messages, "CLOSE_TASK");
  assert(closeMessage, `${scenario.key} missing CLOSE_TASK`);

  const changeArtifact =
    findArtifact(snapshot.messages, (artifact) => artifact.kind === "diff")
    ?? findArtifact(snapshot.messages, (artifact) => artifact.kind === "commit");
  assert(changeArtifact, `${scenario.key} missing diff or commit artifact`);

  const testArtifact = findArtifact(snapshot.messages, (artifact) => artifact.kind === "test_run");
  assert(testArtifact, `${scenario.key} missing test_run artifact`);

  const bindingArtifact = findArtifact(snapshot.messages, (artifact) => {
    return artifact.kind === "doc" && artifact.metadata?.bindingType === "implementation_workspace";
  });
  assert(bindingArtifact, `${scenario.key} missing implementation workspace binding artifact`);

  const bindingCwd = bindingArtifact.artifact.metadata?.cwd;
  assert(typeof bindingCwd === "string" && bindingCwd.length > 0, `${scenario.key} missing binding cwd`);
  assert.notEqual(
    bindingCwd,
    scenario.repoRoot,
    `${scenario.key} implementation ran in the base workspace instead of an isolated path`,
  );

  if (scenario.key !== "swiftsight-worker-codex-clone-isolation") {
    assert(
      bindingCwd.includes(".squadrail-worktrees") || bindingCwd.includes(".squadrail-clones"),
      `${scenario.key} implementation cwd does not look isolated: ${bindingCwd}`,
    );
  }

  const currentSnapshot = await captureRepoSnapshot(scenario.repoRoot);
  if (currentSnapshot.status !== baselineSnapshot.status) {
    const headAdvanced =
      baselineSnapshot.head
      && currentSnapshot.head
      && baselineSnapshot.head !== currentSnapshot.head;
    const currentClean = currentSnapshot.status.length === 0;
    if (headAdvanced && currentClean) {
      note(
        `[${scenario.key}] base repo HEAD advanced from ${baselineSnapshot.head.slice(0, 12)} to ${currentSnapshot.head.slice(0, 12)} while remaining clean; skipping dirty-status equality check`,
      );
    } else {
      assert.equal(
        currentSnapshot.status,
        baselineSnapshot.status,
        `${scenario.key} changed base repo status unexpectedly\nbefore(head=${baselineSnapshot.head ?? "unknown"}):\n${baselineSnapshot.status}\nafter(head=${currentSnapshot.head ?? "unknown"}):\n${currentSnapshot.status}`,
      );
    }
  }

  const matchedCheckpoints = [];
  for (const checkpoint of scenario.checkpoints ?? []) {
    const matched = findMatchingMessage(snapshot.messages, (message) => {
      if (checkpoint.senderId && message?.sender?.actorId !== checkpoint.senderId) return false;
      if (Array.isArray(checkpoint.senderIds) && checkpoint.senderIds.length > 0) {
        if (!checkpoint.senderIds.includes(message?.sender?.actorId ?? null)) return false;
      }
      if (checkpoint.messageType && message?.messageType !== checkpoint.messageType) return false;
      if (checkpoint.messageTypes && !checkpoint.messageTypes.includes(message?.messageType)) return false;
      if (checkpoint.summaryIncludes && !String(message?.summary ?? "").includes(checkpoint.summaryIncludes)) return false;
      return true;
    });
    assert(matched, `${scenario.key} missing checkpoint ${checkpoint.label}`);
    matchedCheckpoints.push({
      label: checkpoint.label,
      messageType: matched.messageType,
      senderId: matched.sender?.actorId ?? null,
      summary: matched.summary,
    });
  }

  const changeRecoveryEvaluation = scenario.changeRecoveryInvariant
    ? assertChangeRecoveryInvariant({
      messages: snapshot.messages,
      finalState: snapshot.state,
      recoveryMode: scenario.changeRecoveryInvariant.recoveryMode,
      expectedRecoveryOwnerId: scenario.changeRecoveryInvariant.expectedRecoveryOwnerId,
    })
    : null;
  const qaGateEvaluation = scenario.qaGateInvariant
    ? assertQaGateInvariant({
      messages: snapshot.messages,
      finalState: snapshot.state,
      expectedQaAgentId: scenario.qaGateInvariant.expectedQaAgentId,
      expectedReviewerId: scenario.qaGateInvariant.expectedReviewerId,
    })
    : null;

  return {
    trail: formatProtocolTrail(snapshot.messages),
    briefCount: snapshot.briefs.length,
    reviewCycles: snapshot.reviewCycles.length,
    changeArtifact: changeArtifact.artifact,
    testArtifact: testArtifact.artifact,
    bindingArtifact: bindingArtifact.artifact,
    closePayload: closeMessage.payload ?? null,
    checkpoints: matchedCheckpoints,
    changeRecoveryEvaluation,
    qaGateEvaluation,
  };
}

function extractImplementationWindow(messages) {
  const started = latestMessage(messages, "START_IMPLEMENTATION");
  if (!started?.createdAt) return null;
  const finished =
    latestMessage(messages, "SUBMIT_FOR_REVIEW")
    ?? latestMessage(messages, "CLOSE_TASK")
    ?? latestMessage(messages, "REQUEST_CHANGES")
    ?? latestMessage(messages, "APPROVE_IMPLEMENTATION");
  return {
    startedAt: started.createdAt,
    finishedAt: finished?.createdAt ?? started.createdAt,
  };
}

function summarizeParallelism(results) {
  const intervals = results
    .map((result) => {
      const window = result.implementationWindow;
      if (!window) return null;
      return {
        project: result.project,
        startedAt: Date.parse(window.startedAt),
        finishedAt: Date.parse(window.finishedAt),
      };
    })
    .filter((value) => value && Number.isFinite(value.startedAt) && Number.isFinite(value.finishedAt));

  const events = [];
  for (const interval of intervals) {
    events.push({ at: interval.startedAt, type: "start", project: interval.project });
    events.push({ at: interval.finishedAt, type: "end", project: interval.project });
  }
  events.sort((a, b) => (a.at - b.at) || (a.type === "end" ? -1 : 1));

  const active = new Map();
  let maxParallelRuns = 0;
  let maxDistinctProjects = 0;

  for (const event of events) {
    if (event.type === "start") {
      active.set(`${event.project}:${event.at}:${active.size}`, event.project);
    } else {
      const activeEntry = [...active.entries()].find(([, project]) => project === event.project);
      if (activeEntry) active.delete(activeEntry[0]);
    }
    maxParallelRuns = Math.max(maxParallelRuns, active.size);
    maxDistinctProjects = Math.max(maxDistinctProjects, new Set(active.values()).size);
  }

  return {
    childCount: results.length,
    maxParallelRuns,
    maxDistinctProjects,
  };
}

async function executeScenarioIssue(issue, scenario, baselineSnapshot) {
  const manualAgentControl =
    scenario.forcedChangeRequest?.pauseAgentUntilRecovery
      ? { agentId: scenario.forcedChangeRequest.senderId, paused: false }
      : null;
  let snapshot;
  try {
    if (manualAgentControl?.agentId) {
      await setAgentPaused(manualAgentControl.agentId, true);
      manualAgentControl.paused = true;
      note(`[${scenario.key}] paused deterministic reviewer/qa agent ${manualAgentControl.agentId} until recovery restart`);
    }
    snapshot = await waitForCompletion(issue.id, scenario, { manualAgentControl });
  } catch (error) {
    await cancelIssue(issue.id, `Scenario ${scenario.key} failed before completion.`);
    throw error;
  }

  let verified;
  try {
    verified = await assertScenarioSuccess(scenario, snapshot, baselineSnapshot);
  } catch (error) {
    await cancelIssue(issue.id, `Scenario ${scenario.key} failed verification after completion.`);
    throw error;
  }

  note(`completed ${issue.identifier}`);
  note(`trail=${verified.trail}`);
  note(`isolated cwd=${verified.bindingArtifact.metadata?.cwd}`);
  note(`${verified.changeArtifact.kind} label=${verified.changeArtifact.label ?? "n/a"}`);
  note(`test label=${verified.testArtifact.label ?? "n/a"}`);
  if ((verified.checkpoints ?? []).length > 0) {
    note(`checkpoints=${JSON.stringify(verified.checkpoints)}`);
  }
  if (verified.changeRecoveryEvaluation) {
    note(`changeRecovery=${JSON.stringify(verified.changeRecoveryEvaluation.checks)}`);
  }
  if (verified.qaGateEvaluation) {
    note(`qaGate=${JSON.stringify(verified.qaGateEvaluation.checks)}`);
  }

  if (HIDE_COMPLETED_ISSUES) {
    await markIssueCancelled(issue.id);
    note(`hid ${issue.identifier} after successful verification`);
  }

  return {
    issueId: issue.id,
    identifier: issue.identifier,
    scenario: scenario.key,
    project: scenario.project?.name ?? null,
    assignee: scenario.assignee.urlKey,
    reviewer: scenario.reviewer.urlKey,
    trail: verified.trail,
    isolatedCwd: verified.bindingArtifact.metadata?.cwd,
    closePayload: verified.closePayload,
    briefCount: verified.briefCount,
    reviewCycles: verified.reviewCycles,
    checkpoints: verified.checkpoints,
    qaGateEvaluation: verified.qaGateEvaluation?.checks ?? null,
    implementationWindow: extractImplementationWindow(snapshot.messages),
  };
}

async function runCoordinatedScenario(companyId, scenario) {
  section(`Scenario: ${scenario.key}`);
  note("mode=coordinated");
  note(`pm=${scenario.coordinator.pm.urlKey}`);
  note(`coordinationTl=${scenario.coordinator.techLead.urlKey}`);
  note(`qa=${scenario.coordinator.qa?.urlKey ?? "none"}`);

  const baselineStatuses = new Map();
  for (const child of scenario.children) {
    baselineStatuses.set(child.key, await captureRepoSnapshot(child.repoRoot));
  }

  const rootIssue = await createPmIntakeIssue(companyId, scenario, scenario.labelIds ?? []);
  note(`created intake root ${rootIssue.identifier} (${rootIssue.id})`);

  let projection = null;
  try {
    projection = await projectPmIntakeIssue(rootIssue.id, scenario);
    note(`projected root ${rootIssue.identifier} into ${projection.projectedWorkItems.length} child work items`);

    assert.equal(
      projection.projectedWorkItems.length,
      scenario.children.length,
      `${scenario.key} projected child count mismatch`,
    );

    await cancelIssue(
      rootIssue.id,
      "Projection completed; archive the coordinating root so only child project lanes continue executing during burn-in.",
      "Archive coordinating root after child fan-out",
    );
    if (HIDE_COMPLETED_ISSUES) {
      await markIssueCancelled(rootIssue.id);
      note(`hid coordinated root ${rootIssue.identifier} after projection`);
    }

    const childRuns = await Promise.all(
      scenario.children.map((child, index) =>
        executeScenarioIssue(
          projection.projectedWorkItems[index],
          child,
          baselineStatuses.get(child.key) ?? { status: "", head: null },
        ),
      ),
    );

    const parallelism = summarizeParallelism(childRuns);
    assert(
      parallelism.maxDistinctProjects >= 2,
      `${scenario.key} did not fan out across at least two project lanes`,
    );

    return {
      issueId: rootIssue.id,
      identifier: rootIssue.identifier,
      scenario: scenario.key,
      project: null,
      assignee: scenario.coordinator.pm.urlKey,
      reviewer: scenario.coordinator.reviewer.urlKey,
      trail: "coordinated-child-fanout",
      isolatedCwd: null,
      closePayload: null,
      briefCount: childRuns.reduce((sum, child) => sum + child.briefCount, 0),
      reviewCycles: childRuns.reduce((sum, child) => sum + child.reviewCycles, 0),
      checkpoints: [],
      coordinatedChildren: childRuns,
      parallelism,
    };
  } catch (error) {
    if (projection?.projectedWorkItems) {
      for (const issue of projection.projectedWorkItems) {
        try {
          await cancelIssue(issue.id, `Coordinated scenario ${scenario.key} failed and archived child issue.`);
        } catch {}
      }
    }
    try {
      await cancelIssue(rootIssue.id, `Coordinated scenario ${scenario.key} failed and archived root issue.`);
    } catch {}
    throw error;
  }
}

async function runScenario(companyId, scenario) {
  if (scenario.mode === "coordinated") {
    return runCoordinatedScenario(companyId, scenario);
  }
  section(`Scenario: ${scenario.key}`);
  note(`project=${scenario.project.name}`);
  note(`assignee=${scenario.assignee.urlKey} (${scenario.assignee.adapterType})`);
  note(`reviewer=${scenario.reviewer.urlKey} (${scenario.reviewer.adapterType})`);

  const baselineSnapshot = await captureRepoSnapshot(scenario.repoRoot);
  note(`base git status lines=${baselineSnapshot.status ? baselineSnapshot.status.split("\n").length : 0}`);
  note(`base git head=${baselineSnapshot.head ?? "unknown"}`);

  const issue = await createIssue(companyId, scenario, scenario.labelIds ?? []);
  note(`created issue ${issue.identifier} (${issue.id})`);

  await assignIssue(issue.id, scenario);
  note(`assigned issue ${issue.identifier}`);
  return executeScenarioIssue(issue, scenario, baselineSnapshot);
}

async function main() {
  section("Resolve Context");
  const context = await resolveContext();
  note(`company=${context.company.name} (${context.company.id})`);
  note(`projects=${context.projects.length}`);
  note(`agents=${context.agents.length}`);

  const e2eLabels = await ensureCompanyLabels(
    context.company.id,
    buildE2eLabelSpecs({ nightly: NIGHTLY_MODE }),
  );
  const e2eLabelIds = e2eLabels.map((label) => label.id);
  note(`e2e labels=${e2eLabels.map((label) => label.name).join(", ")}`);

  if (PRE_CLEANUP_ENABLED) {
    const cleanup = await cleanupTaggedIssues(context.company.id, e2eLabelIds);
    note(`pre-cleanup=${JSON.stringify(cleanup)}`);
  }

  const scenarios = buildScenarioDefinitions(context);
  const requestedScenarioKeys = parseScenarioSelection(SCENARIO_FILTER);
  const selectedScenarios = requestedScenarioKeys.length > 0
    ? scenarios.filter((scenario) => requestedScenarioKeys.includes(scenario.key))
    : scenarios.filter((scenario) => DEFAULT_ORG_LOOP_SCENARIO_KEYS.includes(scenario.key));
  assert(selectedScenarios.length > 0, `No scenarios selected for filter: ${SCENARIO_FILTER}`);
  validateScenarioDefinitions(selectedScenarios);

  const agentStatusRestores = await prepareScenarioAgents(context, selectedScenarios);
  const results = [];
  try {
    for (const scenario of selectedScenarios) {
      results.push(await runScenario(context.company.id, {
        ...scenario,
        labelIds: e2eLabelIds,
      }));
    }
  } finally {
    await restoreAgentStatuses(agentStatusRestores);
  }

  section("Summary");
  note(JSON.stringify(results, null, 2));
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
