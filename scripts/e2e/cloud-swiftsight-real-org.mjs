#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const BASE_URL = process.env.SQUADRAIL_BASE_URL ?? "http://127.0.0.1:3101";
const COMPANY_NAME = process.env.SQUADRAIL_COMPANY_NAME ?? "cloud-swiftsight";
const E2E_TIMEOUT_MS = Number(process.env.SWIFTSIGHT_E2E_TIMEOUT_MS ?? 18 * 60 * 1000);
const POLL_INTERVAL_MS = Number(process.env.SWIFTSIGHT_E2E_POLL_INTERVAL_MS ?? 5_000);
const SCENARIO_FILTER = process.env.SWIFTSIGHT_E2E_SCENARIO?.trim() ?? "";

const SWIFTSIGHT_ROOT = "/home/taewoong/workspace/cloud-swiftsight";

function note(message = "") {
  process.stdout.write(`${message}\n`);
}

function section(title) {
  note("");
  note("=".repeat(96));
  note(title);
  note("=".repeat(96));
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
      key: "swiftsight-cloud-claude-build-info",
      project: project("swiftsight-cloud"),
      assignee: agent("swiftsight-cloud-claude-engineer"),
      reviewer: agent("swiftsight-cloud-tl"),
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
      key: "swiftcl-codex-catalog-path",
      project: project("swiftcl"),
      assignee: agent("swiftcl-codex-engineer"),
      reviewer: agent("swiftcl-tl"),
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
      reviewer: agent("swiftsight-python-tl"),
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
  ];
}

async function createIssue(companyId, scenario) {
  return api(`/api/companies/${companyId}/issues`, {
    method: "POST",
    body: {
      projectId: scenario.project.id,
      title: scenario.issue.title,
      description: scenario.issue.description,
      priority: "high",
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
        role: "engineer",
      },
      {
        recipientType: "agent",
        recipientId: scenario.reviewer.id,
        role: "reviewer",
      },
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

  while (Date.now() - startedAt < E2E_TIMEOUT_MS) {
    const snapshot = await getIssueSnapshot(issueId);

    for (const message of snapshot.messages) {
      if (seenMessages.has(message.id)) continue;
      seenMessages.add(message.id);
      note(`[${scenario.key}] ${message.createdAt} ${summarizeMessage(message)}`);
    }

    if (snapshot.state.workflowState === "done") {
      return snapshot;
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  const snapshot = await getIssueSnapshot(issueId);
  const trail = formatProtocolTrail(snapshot.messages);
  const violations = snapshot.violations.map((entry) => `${entry.code}:${entry.status}`).join(", ");
  throw new Error(
    [
      `Timed out waiting for completion: ${scenario.key}`,
      `workflowState=${snapshot.state.workflowState}`,
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
  assert.equal(snapshot.state.workflowState, "done", `${scenario.key} did not finish in done state`);
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

  return {
    trail: formatProtocolTrail(snapshot.messages),
    briefCount: snapshot.briefs.length,
    reviewCycles: snapshot.reviewCycles.length,
    diffArtifact: diffArtifact.artifact,
    testArtifact: testArtifact.artifact,
    bindingArtifact: bindingArtifact.artifact,
    closePayload: closeMessage.payload ?? null,
  };
}

async function runScenario(companyId, scenario) {
  section(`Scenario: ${scenario.key}`);
  note(`project=${scenario.project.name}`);
  note(`assignee=${scenario.assignee.urlKey} (${scenario.assignee.adapterType})`);
  note(`reviewer=${scenario.reviewer.urlKey} (${scenario.reviewer.adapterType})`);

  const baselineStatus = await gitStatus(scenario.repoRoot);
  note(`base git status lines=${baselineStatus ? baselineStatus.split("\n").length : 0}`);

  const issue = await createIssue(companyId, scenario);
  note(`created issue ${issue.identifier} (${issue.id})`);

  await assignIssue(issue.id, scenario);
  note(`assigned issue ${issue.identifier}`);

  const snapshot = await waitForCompletion(issue.id, scenario);
  const verified = await assertScenarioSuccess(scenario, snapshot, baselineStatus);

  note(`completed ${issue.identifier}`);
  note(`trail=${verified.trail}`);
  note(`isolated cwd=${verified.bindingArtifact.metadata?.cwd}`);
  note(`diff label=${verified.diffArtifact.label ?? "n/a"}`);
  note(`test label=${verified.testArtifact.label ?? "n/a"}`);

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
  };
}

async function main() {
  section("Resolve Context");
  const context = await resolveContext();
  note(`company=${context.company.name} (${context.company.id})`);
  note(`projects=${context.projects.length}`);
  note(`agents=${context.agents.length}`);

  const scenarios = buildScenarioDefinitions(context);
  const selectedScenarios = SCENARIO_FILTER
    ? scenarios.filter((scenario) => scenario.key === SCENARIO_FILTER)
    : scenarios;
  assert(selectedScenarios.length > 0, `No scenarios selected for filter: ${SCENARIO_FILTER}`);
  const results = [];
  for (const scenario of selectedScenarios) {
    results.push(await runScenario(context.company.id, scenario));
  }

  section("Summary");
  note(JSON.stringify(results, null, 2));
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
