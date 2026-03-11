#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  buildE2eLabelSpecs,
  collectTaggedIssues,
  needsE2eCancellation,
  shouldHideE2eIssue,
} from "./e2e-issue-utils.mjs";

const execFileAsync = promisify(execFile);

const BASE_URL = process.env.SQUADRAIL_BASE_URL ?? "http://127.0.0.1:3101";
const COMPANY_NAME = process.env.SQUADRAIL_COMPANY_NAME ?? "cloud-swiftsight";
const E2E_TIMEOUT_MS = Number(process.env.SWIFTSIGHT_E2E_TIMEOUT_MS ?? 18 * 60 * 1000);
const POLL_INTERVAL_MS = Number(process.env.SWIFTSIGHT_E2E_POLL_INTERVAL_MS ?? 5_000);
const CLOSE_FALLBACK_AFTER_MS = Number(process.env.SWIFTSIGHT_E2E_CLOSE_FALLBACK_AFTER_MS ?? 20_000);
const SCENARIO_FILTER = process.env.SWIFTSIGHT_E2E_SCENARIO?.trim() ?? "";
const NIGHTLY_MODE = process.env.SWIFTSIGHT_E2E_NIGHTLY === "1";
const PRE_CLEANUP_ENABLED = process.env.SWIFTSIGHT_E2E_PRE_CLEANUP !== "0";
const HIDE_COMPLETED_ISSUES = process.env.SWIFTSIGHT_E2E_HIDE_COMPLETED !== "0";
const E2E_ACTOR_ID = process.env.SWIFTSIGHT_E2E_ACTOR_ID ?? "cloud-swiftsight-e2e-board";

const SWIFTSIGHT_ROOT = "/home/taewoong/workspace/cloud-swiftsight";
const PROTOCOL_HELPER_PATH = "/home/taewoong/company-project/squadall/scripts/runtime/squadrail-protocol.mjs";
const DEFAULT_ORG_LOOP_SCENARIO_KEYS = [
  "swiftsight-agent-tl-qa-loop",
  "swiftsight-cloud-pm-qa-lead-loop",
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

async function hideIssue(issueId) {
  return api(`/api/issues/${issueId}`, {
    method: "PATCH",
    body: {
      hiddenAt: new Date().toISOString(),
    },
  });
}

async function cleanupTaggedIssues(companyId, labelIds) {
  const issues = await api(`/api/companies/${companyId}/issues`);
  const taggedIssues = collectTaggedIssues(issues, labelIds);
  const summary = {
    scanned: taggedIssues.length,
    cancelled: 0,
    hidden: 0,
  };

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
        await hideIssue(issue.id);
        summary.hidden += 1;
        note(`cleanup hid ${issue.identifier}`);
      }
      continue;
    }

    if (HIDE_COMPLETED_ISSUES && shouldHideE2eIssue(issue.status)) {
      await hideIssue(issue.id);
      summary.hidden += 1;
      note(`cleanup hid ${issue.identifier}`);
    }
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

function collectScenarioParticipantIds(scenarios) {
  const ids = new Set();
  for (const scenario of scenarios) {
    ids.add(scenario.assignee.id);
    ids.add(scenario.reviewer.id);
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
      if (agent.status !== "paused") continue;
      await setAgentPaused(agent.id, false);
      restores.push({ agent, previousStatus: "paused" });
      note(`resumed paused agent ${agent.urlKey} for E2E scenario execution`);
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
      reviewer: agent("swiftsight-qa-engineer"),
      reviewerRole: "reviewer",
      repoRoot: `${SWIFTSIGHT_ROOT}/swiftsight-agent`,
      issue: {
        title: "Org E2E: TL delegates SafeJoin fix and QA validates the review loop",
        description: [
          "Repository: swiftsight-agent",
          "Target files: internal/storage/path.go and internal/storage/path_test.go",
          "You are testing the full project delivery chain, not only direct implementation.",
          "Board expectation for the assignee project TL:",
          "- you own staffing for this issue first",
          "- do not implement the fix yourself",
          `- route the implementation to \`swiftsight-agent-codex-engineer\` (${agent("swiftsight-agent-codex-engineer").id}) with explicit acceptance criteria`,
          `- keep QA Engineer \`swiftsight-qa-engineer\` (${agent("swiftsight-qa-engineer").id}) as the active reviewer and reuse that exact reviewer id in REASSIGN_TASK`,
          "- close only after QA sign-off",
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
            `- TL staffing command: \`node ${PROTOCOL_HELPER_PATH} reassign-task --issue "$SQUADRAIL_TASK_ID" --sender-role tech_lead --assignee-id "${agent("swiftsight-agent-codex-engineer").id}" --assignee-role engineer --reviewer-id "${agent("swiftsight-qa-engineer").id}" --summary "Route SafeJoin fix to swiftsight-agent-codex-engineer" --reason "Project TL staffing the focused SafeJoin fix"\``,
            `- QA review start: \`node ${PROTOCOL_HELPER_PATH} start-review --issue "$SQUADRAIL_TASK_ID" --sender-role reviewer --summary "QA starts SafeJoin review" --review-focus "path traversal preserved||nested segments preserved||focused package test evidence"\``,
            `- QA approval example: \`node ${PROTOCOL_HELPER_PATH} approve-implementation --issue "$SQUADRAIL_TASK_ID" --sender-role reviewer --summary "QA approves SafeJoin fix" --approval-summary "Nested path preservation is fixed and focused evidence is sufficient" --approval-checklist "nested safe path preserved||parent traversal still rejected||focused Go package test passed" --verified-evidence "review handoff payload inspected||diff artifact reviewed||test evidence reviewed" --residual-risks "No repo-wide test evidence was requested for this focused slice"\``,
            `- TL close example: \`node ${PROTOCOL_HELPER_PATH} close-task --issue "$SQUADRAIL_TASK_ID" --sender-role tech_lead --summary "Close SafeJoin fix after QA approval" --closure-summary "Nested safe paths now stay nested and QA approved the focused delivery slice" --verification-summary "QA approval and focused Go package test evidence were recorded in protocol" --rollback-plan "Revert the SafeJoin patch and test file if nested path behavior regresses" --final-artifacts "diff artifact attached||test_run artifact attached||approval recorded in protocol" --remaining-risks "Merge remains external to this E2E harness" --merge-status pending_external_merge\``,
          ]),
          ...buildEngineerHelperLines([
            `- Engineer ACK command: \`node ${PROTOCOL_HELPER_PATH} ack-assignment --issue "$SQUADRAIL_TASK_ID" --sender-role engineer --summary "Accepted SafeJoin fix scope" --understood-scope "Fix SafeJoin path handling in internal/storage/path.go and add focused regression tests in internal/storage/path_test.go" --initial-risks "Path normalization changes can weaken traversal protection if focused tests are incomplete"\``,
            `- Engineer start command: \`node ${PROTOCOL_HELPER_PATH} start-implementation --issue "$SQUADRAIL_TASK_ID" --sender-role engineer --summary "Start SafeJoin implementation in isolated workspace" --active-hypotheses "Safe nested relative segments should be preserved||parent traversal and unsafe absolute-path behavior must remain blocked"\``,
            `- Engineer progress command: \`node ${PROTOCOL_HELPER_PATH} report-progress --issue "$SQUADRAIL_TASK_ID" --sender-role engineer --summary "SafeJoin patch and focused tests are in progress" --progress-percent 60 --completed-items "Reproduced nested-path flattening bug" --next-steps "Patch SafeJoin path normalization||Run focused Go package test" --risks "Traversal safety regression if normalization is too permissive"\``,
            `- Engineer review handoff: \`node ${PROTOCOL_HELPER_PATH} submit-for-review --issue "$SQUADRAIL_TASK_ID" --sender-role engineer --reviewer-id "${agent("swiftsight-qa-engineer").id}" --summary "Submit SafeJoin fix for QA review" --implementation-summary "SafeJoin now preserves safe nested segments while keeping traversal and absolute-path sanitization protections in place" --evidence "Focused Go package test passed||Nested relative path behavior verified||Traversal safety behavior rechecked" --diff-summary "Adjusted SafeJoin normalization and added regression tests for nested paths and traversal safety" --changed-files "internal/storage/path.go||internal/storage/path_test.go" --test-results "go test ./internal/storage -count=1" --review-checklist "Nested safe path preserved||Parent traversal still rejected||Absolute path stays sanitized" --residual-risks "Repo-wide validation was intentionally skipped for this focused slice"\``,
          ]),
          "Execution constraints:",
          "- do not run unrelated repo-wide validation",
          "- do not run `go test ./...`, `pnpm test`, or any repo-wide sweep for this scenario",
          "- stop once the focused package test passes and submit for review immediately",
        ].join("\n"),
      },
      assignment: {
        goal: "Project TL must staff the SafeJoin fix to an engineer, keep QA as reviewer, and drive the issue to done.",
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
      checkpoints: [
        { label: "tl-reassign", messageType: "REASSIGN_TASK", senderId: agent("swiftsight-agent-tl").id },
        { label: "qa-review-start", messageType: "START_REVIEW", senderId: agent("swiftsight-qa-engineer").id },
        {
          label: "qa-review-decision",
          senderId: agent("swiftsight-qa-engineer").id,
          messageTypes: ["REQUEST_CHANGES", "APPROVE_IMPLEMENTATION", "REQUEST_HUMAN_DECISION"],
        },
      ],
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
    },
    {
      key: "swiftsight-cloud-pm-qa-lead-loop",
      project: project("swiftsight-cloud"),
      assignee: agent("swiftsight-pm"),
      assigneeRole: "pm",
      reviewer: agent("swiftsight-qa-lead"),
      reviewerRole: "reviewer",
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
          "- keep QA Lead as the active reviewer for the final review cycle",
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
            `- PM routing command: \`node ${PROTOCOL_HELPER_PATH} reassign-task --issue "$SQUADRAIL_TASK_ID" --sender-role pm --assignee-id "${agent("swiftsight-cloud-tl").id}" --assignee-role tech_lead --reviewer-id "${agent("swiftsight-qa-lead").id}" --summary "PM routes build-info fix into the swiftsight-cloud TL lane" --reason "PM clarified the delivery slice and is handing execution ownership to the project TL"\``,
            `- TL staffing command when delegating further: \`node ${PROTOCOL_HELPER_PATH} reassign-task --issue "$SQUADRAIL_TASK_ID" --sender-role tech_lead --assignee-id "${agent("swiftsight-cloud-codex-engineer").id}" --assignee-role engineer --reviewer-id "${agent("swiftsight-qa-lead").id}" --summary "TL staffs build-info fix to swiftsight-cloud-codex-engineer" --reason "Project TL is staffing the focused observability implementation"\``,
            `- TL direct implementation fallback: \`node ${PROTOCOL_HELPER_PATH} start-implementation --issue "$SQUADRAIL_TASK_ID" --sender-role engineer --summary "TL starts observability implementation directly from the TL lane" --active-hypotheses "Build metadata can drive service.version with deterministic fallback||Change scope should stay local to observability package"\``,
            "- TL protocol sender-role split: use `tech_lead` for reassign/close, and `engineer` for ack/start/progress/review-submission while the TL is the active implementation owner.",
            `- QA Lead review start: \`node ${PROTOCOL_HELPER_PATH} start-review --issue "$SQUADRAIL_TASK_ID" --sender-role reviewer --summary "QA Lead starts observability review" --review-focus "build metadata fallback behavior||focused observability test evidence||diff scope stays local to observability package"\``,
            `- QA Lead approval example: \`node ${PROTOCOL_HELPER_PATH} approve-implementation --issue "$SQUADRAIL_TASK_ID" --sender-role reviewer --summary "QA Lead approves observability fix" --approval-summary "Build metadata fallback behavior is correct and focused evidence is sufficient" --approval-checklist "service.version no longer hard-coded||fallback behavior covered||focused observability test passed" --verified-evidence "review handoff payload inspected||diff artifact reviewed||test evidence reviewed" --residual-risks "Build stamping may still be absent in local builds, so deterministic fallback remains expected"\``,
            `- TL close example: \`node ${PROTOCOL_HELPER_PATH} close-task --issue "$SQUADRAIL_TASK_ID" --sender-role tech_lead --summary "Close observability fix after QA approval" --closure-summary "service.version now follows build metadata with deterministic fallback and QA approved the slice" --verification-summary "QA approval and focused observability test evidence were recorded in protocol" --rollback-plan "Revert the observability helper and regression test changes if version resolution regresses" --final-artifacts "diff artifact attached||test_run artifact attached||approval recorded in protocol" --remaining-risks "Merge remains external to this E2E harness" --merge-status pending_external_merge\``,
          ]),
          ...buildEngineerHelperLines([
            `- Engineer ACK command: \`node ${PROTOCOL_HELPER_PATH} ack-assignment --issue "$SQUADRAIL_TASK_ID" --sender-role engineer --summary "Accepted observability build-info scope" --understood-scope "Resolve service.version from build metadata in internal/observability and add focused regression tests" --initial-risks "Build metadata may be unavailable outside stamped builds and needs deterministic fallback coverage"\``,
            `- Engineer start command: \`node ${PROTOCOL_HELPER_PATH} start-implementation --issue "$SQUADRAIL_TASK_ID" --sender-role engineer --summary "Start observability implementation in isolated workspace" --active-hypotheses "Build metadata can drive service.version with deterministic fallback||Change scope should stay local to observability package"\``,
            `- Engineer progress command: \`node ${PROTOCOL_HELPER_PATH} report-progress --issue "$SQUADRAIL_TASK_ID" --sender-role engineer --summary "Observability patch and focused tests are in progress" --progress-percent 60 --completed-items "Confirmed hard-coded service.version behavior" --next-steps "Wire build metadata fallback||Run focused observability test" --risks "Fallback behavior can drift if tests do not pin non-stamped builds"\``,
            `- Engineer review handoff: \`node ${PROTOCOL_HELPER_PATH} submit-for-review --issue "$SQUADRAIL_TASK_ID" --sender-role engineer --reviewer-id "${agent("swiftsight-qa-lead").id}" --summary "Submit observability build-info fix for QA Lead review" --implementation-summary "createResource now resolves service.version from build metadata with deterministic fallback when stamping is unavailable" --evidence "Focused observability test passed||Resolved version behavior verified||Fallback behavior verified" --diff-summary "Removed hard-coded service.version path and added focused observability regression coverage" --changed-files "internal/observability/tracing.go||internal/observability/tracing_test.go" --test-results "go test ./internal/observability -count=1" --review-checklist "service.version no longer hard-coded||Fallback behavior covered||Change scope remains local to observability package" --residual-risks "Repo-wide validation was intentionally skipped for this focused slice"\``,
          ]),
          "Execution constraints:",
          "- PM should route through `swiftsight-cloud-tl` before engineer implementation starts",
          "- do not run golangci-lint or unrelated repo-wide validation",
          "- stop once the focused test passes and submit for review immediately",
        ].join("\n"),
      },
      assignment: {
        goal: "PM must clarify and route the observability fix through the project TL, then QA Lead must review the delivered slice.",
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
      key: "swiftcl-cto-cross-project-loop",
      project: project("swiftcl"),
      assignee: agent("swiftsight-cto"),
      assigneeRole: "cto",
      reviewer: agent("swiftsight-qa-lead"),
      reviewerRole: "reviewer",
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
            `- CTO routing command: \`node ${PROTOCOL_HELPER_PATH} reassign-task --issue "$SQUADRAIL_TASK_ID" --sender-role cto --assignee-id "${agent("swiftcl-tl").id}" --assignee-role tech_lead --reviewer-id "${agent("swiftsight-qa-lead").id}" --summary "CTO routes swiftcl catalog-path fix into the project TL lane" --reason "CTO is routing this company-level delivery slice into the correct project lane"\``,
            `- TL staffing command when delegating further: \`node ${PROTOCOL_HELPER_PATH} reassign-task --issue "$SQUADRAIL_TASK_ID" --sender-role tech_lead --assignee-id "${agent("swiftcl-codex-engineer").id}" --assignee-role engineer --reviewer-id "${agent("swiftsight-qa-lead").id}" --summary "TL staffs catalog-path fix to swiftcl-codex-engineer" --reason "SwiftCL TL is staffing the focused implementation lane"\``,
            `- TL direct implementation fallback: \`node ${PROTOCOL_HELPER_PATH} start-implementation --issue "$SQUADRAIL_TASK_ID" --sender-role engineer --summary "TL starts CatalogPath implementation directly from the TL lane" --active-hypotheses "CatalogPath should load definitions before constructor wiring||Empty CatalogPath must stay backward compatible"\``,
            "- TL protocol sender-role split: use `tech_lead` for reassign/close, and `engineer` for ack/start/progress/review-submission while the TL is the active implementation owner.",
            `- QA Lead review start: \`node ${PROTOCOL_HELPER_PATH} start-review --issue "$SQUADRAIL_TASK_ID" --sender-role reviewer --summary "QA Lead starts swiftcl release review" --review-focus "CatalogPath loading behavior||focused swiftcl package tests||bootstrapping regression risk"\``,
            `- QA Lead approval example: \`node ${PROTOCOL_HELPER_PATH} approve-implementation --issue "$SQUADRAIL_TASK_ID" --sender-role reviewer --summary "QA Lead approves CatalogPath loading fix" --approval-summary "CatalogPath loading behavior and focused regression evidence satisfy the release review bar" --approval-checklist "CatalogPath now honored||invalid path errors preserved||empty path stays backward compatible||focused swiftcl package test passed" --verified-evidence "review handoff payload inspected||diff artifact reviewed||test evidence reviewed" --residual-risks "Recursive loading behavior should be documented for operators choosing catalog directories"\``,
            `- TL close example: \`node ${PROTOCOL_HELPER_PATH} close-task --issue "$SQUADRAIL_TASK_ID" --sender-role tech_lead --summary "Close CatalogPath fix after QA approval" --closure-summary "CatalogPath loading now works, regression tests pass, and QA approved the delivery slice" --verification-summary "QA approval and focused swiftcl package test evidence were recorded in protocol" --rollback-plan "Revert the CatalogPath loader and regression test if bootstrapping behavior regresses" --final-artifacts "diff artifact attached||test_run artifact attached||approval recorded in protocol" --remaining-risks "Merge remains external to this E2E harness" --merge-status pending_external_merge\``,
          ]),
          ...buildEngineerHelperLines([
            `- Engineer ACK command: \`node ${PROTOCOL_HELPER_PATH} ack-assignment --issue "$SQUADRAIL_TASK_ID" --sender-role engineer --summary "Accepted swiftcl CatalogPath scope" --understood-scope "Honor Config.CatalogPath in pkg/swiftcl and add focused regression tests for valid, invalid, and empty path behavior" --initial-risks "Bootstrapping changes can break backward compatibility if empty-path behavior changes"\``,
            `- Engineer start command: \`node ${PROTOCOL_HELPER_PATH} start-implementation --issue "$SQUADRAIL_TASK_ID" --sender-role engineer --summary "Start CatalogPath implementation in isolated workspace" --active-hypotheses "CatalogPath should load definitions before constructor wiring||Empty CatalogPath must stay backward compatible"\``,
            `- Engineer progress command: \`node ${PROTOCOL_HELPER_PATH} report-progress --issue "$SQUADRAIL_TASK_ID" --sender-role engineer --summary "swiftcl CatalogPath patch and focused tests are in progress" --progress-percent 60 --completed-items "Confirmed Config.CatalogPath is ignored in New()" --next-steps "Wire disk catalog loading||Run focused swiftcl package test" --risks "Loader behavior can break empty-path compatibility if initialization order changes"\``,
            `- Engineer review handoff: \`node ${PROTOCOL_HELPER_PATH} submit-for-review --issue "$SQUADRAIL_TASK_ID" --sender-role engineer --reviewer-id "${agent("swiftsight-qa-lead").id}" --summary "Submit CatalogPath loading fix for QA Lead review" --implementation-summary "swiftcl.New now honors Config.CatalogPath, loads on-disk definitions before constructor setup, and preserves empty-path compatibility" --evidence "Focused swiftcl package test passed||Valid path loading verified||Invalid path and empty-path behavior verified" --diff-summary "Wired CatalogPath loading into swiftcl bootstrapping and added focused regression coverage" --changed-files "pkg/swiftcl/swiftcl.go||pkg/swiftcl/*test*.go" --test-results "go test ./pkg/swiftcl -count=1" --review-checklist "CatalogPath now honored||Invalid path errors preserved||Empty path stays backward compatible" --residual-risks "Repo-wide validation was intentionally skipped for this focused slice"\``,
          ]),
          "Execution constraints:",
          "- CTO should route through `swiftcl-tl` before engineer implementation starts",
          "- do not run golangci-lint or unrelated repo-wide validation",
          "- stop once the focused package test passes and submit for review immediately",
        ].join("\n"),
      },
      assignment: {
        goal: "CTO must route the swiftcl catalog-path fix into the SwiftCL TL lane, then QA Lead must validate the delivered implementation before closure.",
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
  ];
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
    },
    artifacts: [],
  };

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
      note(`assign retry ${attempt} for ${issueId}: ${text}`);
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
}

async function cancelIssue(issueId, reason, summary = "Cancel failed E2E scenario") {
  const state = await api(`/api/issues/${issueId}/protocol/state`);
  const workflowStateBefore = state?.workflowState ?? "assigned";
  return api(`/api/issues/${issueId}/protocol/messages`, {
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
}

async function sendCloseTask(issueId, scenario, workflowStateBefore) {
  assert(scenario.closeAction, `${scenario.key} missing closeAction`);
  const closeAction = scenario.closeAction;
  return api(`/api/issues/${issueId}/protocol/messages`, {
    method: "POST",
    body: {
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
    },
  });
}

function findMatchingMessage(messages, predicate) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (predicate(messages[index])) return messages[index];
  }
  return null;
}

async function getIssueSnapshot(issueId) {
  const [issue, state, messages, briefs, reviewCycles, violations] = await Promise.all([
    api(`/api/issues/${issueId}`),
    api(`/api/issues/${issueId}/protocol/state`),
    api(`/api/issues/${issueId}/protocol/messages`),
    api(`/api/issues/${issueId}/protocol/briefs`),
    api(`/api/issues/${issueId}/protocol/review-cycles`),
    api(`/api/issues/${issueId}/protocol/violations`),
  ]);

  return { issue, state, messages, briefs, reviewCycles, violations };
}

function latestMessage(messages, type) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.messageType === type) return messages[index];
  }
  return null;
}

function summarizeMessage(message) {
  return `${message.messageType} :: ${message.summary}`;
}

function formatProtocolTrail(messages) {
  return messages.map((message) => summarizeMessage(message)).join(" -> ");
}

async function waitForCompletion(issueId, scenario) {
  const startedAt = Date.now();
  const seenMessages = new Set();
  let approvalObservedAt = null;
  let closeFallbackSent = false;

  while (Date.now() - startedAt < E2E_TIMEOUT_MS) {
    const snapshot = await getIssueSnapshot(issueId);

    for (const message of snapshot.messages) {
      if (seenMessages.has(message.id)) continue;
      seenMessages.add(message.id);
      note(`[${scenario.key}] ${message.createdAt} ${summarizeMessage(message)}`);
    }

    if (snapshot.state?.workflowState === "done") {
      return snapshot;
    }

    const closeMessage = latestMessage(snapshot.messages, "CLOSE_TASK");
    if (closeMessage) {
      closeFallbackSent = true;
      approvalObservedAt = null;
    } else if (
      scenario.closeAction &&
      snapshot.state?.workflowState === "approved"
    ) {
      if (approvalObservedAt == null) {
        approvalObservedAt = Date.now();
      } else if (!closeFallbackSent && Date.now() - approvalObservedAt >= CLOSE_FALLBACK_AFTER_MS) {
        note(`[${scenario.key}] approved state persisted without CLOSE_TASK, sending fallback close`);
        await sendCloseTask(issueId, scenario, snapshot.state.workflowState);
        closeFallbackSent = true;
      }
    } else {
      approvalObservedAt = null;
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  const snapshot = await getIssueSnapshot(issueId);
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

async function assertScenarioSuccess(scenario, snapshot, baselineStatus) {
  assert.equal(snapshot.state?.workflowState, "done", `${scenario.key} did not finish in done state`);
  assert(snapshot.briefs.length > 0, `${scenario.key} should generate at least one brief`);

  const submitMessage = latestMessage(snapshot.messages, "SUBMIT_FOR_REVIEW");
  assert(submitMessage, `${scenario.key} missing SUBMIT_FOR_REVIEW`);

  const closeMessage = latestMessage(snapshot.messages, "CLOSE_TASK");
  assert(closeMessage, `${scenario.key} missing CLOSE_TASK`);

  const diffArtifact = findArtifact(snapshot.messages, (artifact) => artifact.kind === "diff");
  assert(diffArtifact, `${scenario.key} missing diff artifact`);

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

  const currentStatus = await gitStatus(scenario.repoRoot);
  assert.equal(
    currentStatus,
    baselineStatus,
    `${scenario.key} changed base repo status unexpectedly\nbefore:\n${baselineStatus}\nafter:\n${currentStatus}`,
  );

  const matchedCheckpoints = [];
  for (const checkpoint of scenario.checkpoints ?? []) {
    const matched = findMatchingMessage(snapshot.messages, (message) => {
      if (checkpoint.senderId && message?.sender?.actorId !== checkpoint.senderId) return false;
      if (checkpoint.messageType && message?.messageType !== checkpoint.messageType) return false;
      if (checkpoint.messageTypes && !checkpoint.messageTypes.includes(message?.messageType)) return false;
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

  return {
    trail: formatProtocolTrail(snapshot.messages),
    briefCount: snapshot.briefs.length,
    reviewCycles: snapshot.reviewCycles.length,
    diffArtifact: diffArtifact.artifact,
    testArtifact: testArtifact.artifact,
    bindingArtifact: bindingArtifact.artifact,
    closePayload: closeMessage.payload ?? null,
    checkpoints: matchedCheckpoints,
  };
}

async function runScenario(companyId, scenario) {
  section(`Scenario: ${scenario.key}`);
  note(`project=${scenario.project.name}`);
  note(`assignee=${scenario.assignee.urlKey} (${scenario.assignee.adapterType})`);
  note(`reviewer=${scenario.reviewer.urlKey} (${scenario.reviewer.adapterType})`);

  const baselineStatus = await gitStatus(scenario.repoRoot);
  note(`base git status lines=${baselineStatus ? baselineStatus.split("\n").length : 0}`);

  const issue = await createIssue(companyId, scenario, scenario.labelIds ?? []);
  note(`created issue ${issue.identifier} (${issue.id})`);

  await assignIssue(issue.id, scenario);
  note(`assigned issue ${issue.identifier}`);

  let snapshot;
  try {
    snapshot = await waitForCompletion(issue.id, scenario);
  } catch (error) {
    await cancelIssue(issue.id, `Scenario ${scenario.key} failed before completion.`);
    throw error;
  }

  let verified;
  try {
    verified = await assertScenarioSuccess(scenario, snapshot, baselineStatus);
  } catch (error) {
    await cancelIssue(issue.id, `Scenario ${scenario.key} failed verification after completion.`);
    throw error;
  }

  note(`completed ${issue.identifier}`);
  note(`trail=${verified.trail}`);
  note(`isolated cwd=${verified.bindingArtifact.metadata?.cwd}`);
  note(`diff label=${verified.diffArtifact.label ?? "n/a"}`);
  note(`test label=${verified.testArtifact.label ?? "n/a"}`);
  if ((verified.checkpoints ?? []).length > 0) {
    note(`checkpoints=${JSON.stringify(verified.checkpoints)}`);
  }

  if (HIDE_COMPLETED_ISSUES) {
    await hideIssue(issue.id);
    note(`hid ${issue.identifier} after successful verification`);
  }

  return {
    issueId: issue.id,
    identifier: issue.identifier,
    scenario: scenario.key,
    project: scenario.project.name,
    assignee: scenario.assignee.urlKey,
    reviewer: scenario.reviewer.urlKey,
    trail: verified.trail,
    isolatedCwd: verified.bindingArtifact.metadata?.cwd,
    closePayload: verified.closePayload,
    briefCount: verified.briefCount,
    reviewCycles: verified.reviewCycles,
    checkpoints: verified.checkpoints,
  };
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
  const selectedScenarios = SCENARIO_FILTER
    ? scenarios.filter((scenario) => scenario.key === SCENARIO_FILTER)
    : scenarios.filter((scenario) => DEFAULT_ORG_LOOP_SCENARIO_KEYS.includes(scenario.key));
  assert(selectedScenarios.length > 0, `No scenarios selected for filter: ${SCENARIO_FILTER}`);

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
