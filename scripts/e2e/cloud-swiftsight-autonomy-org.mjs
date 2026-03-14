#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const BASE_URL = process.env.SQUADRAIL_BASE_URL ?? "http://127.0.0.1:3101";
const COMPANY_NAME = process.env.SQUADRAIL_COMPANY_NAME ?? "cloud-swiftsight";
const PROJECT_HINT = process.env.SWIFTSIGHT_AUTONOMY_PROJECT ?? "swiftsight-cloud";
const AUTONOMY_BOARD_ID = process.env.SWIFTSIGHT_AUTONOMY_BOARD_ID ?? "autonomy-board";
const AUTONOMY_BOOTSTRAP_BLUEPRINT = process.env.SWIFTSIGHT_AUTONOMY_BLUEPRINT ?? "delivery_plus_qa";
const REQUEST = process.env.SWIFTSIGHT_AUTONOMY_REQUEST ?? [
  "Tighten the swiftsight-cloud export handoff before release.",
  "",
  "- keep audit evidence explicit",
  "- keep the change scoped to the cloud export path",
  "- focused verification is enough",
].join("\n");
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PROTOCOL_HELPER_PATH = process.env.SQUADRAIL_PROTOCOL_HELPER_PATH
  ?? path.join(REPO_ROOT, "scripts", "runtime", "squadrail-protocol.mjs");
const execFileAsync = promisify(execFile);
const agentApiKeyCache = new Map();

function note(message = "") {
  process.stdout.write(`${message}\n`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  const body = contentType.includes("application/json")
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

async function resolveCompanyByName(name) {
  const companies = await api("/api/companies");
  const normalized = name.trim().toLowerCase();
  const match = companies.find((company) => {
    const companyName = typeof company.name === "string" ? company.name.toLowerCase() : "";
    const slug = typeof company.slug === "string" ? company.slug.toLowerCase() : "";
    return companyName === normalized || slug === normalized;
  });
  assert(match, `Company not found for ${name}`);
  return match;
}

async function createCompany(name) {
  return api("/api/companies", {
    method: "POST",
    body: {
      name,
      description: "Autonomy burn-in bootstrap company",
    },
  });
}

async function listProjects(companyId) {
  return api(`/api/companies/${companyId}/projects`);
}

async function previewTeamBlueprint(companyId, blueprintKey, body) {
  return api(`/api/companies/${companyId}/team-blueprints/${blueprintKey}/preview`, {
    method: "POST",
    body,
  });
}

async function applyTeamBlueprint(companyId, blueprintKey, preview) {
  return api(`/api/companies/${companyId}/team-blueprints/${blueprintKey}/apply`, {
    method: "POST",
    body: {
      previewHash: preview.previewHash,
      ...preview.parameters,
    },
  });
}

async function ensureCompanyContext(name) {
  const companies = await api("/api/companies");
  const normalized = name.trim().toLowerCase();
  const existing = companies.find((company) => {
    const companyName = typeof company.name === "string" ? company.name.toLowerCase() : "";
    const slug = typeof company.slug === "string" ? company.slug.toLowerCase() : "";
    return companyName === normalized || slug === normalized;
  });
  if (existing) {
    return {
      company: existing,
      bootstrapped: false,
      bootstrapProjectId: null,
      bootstrapProjectName: null,
    };
  }

  note(`company ${name} not found; bootstrapping ${AUTONOMY_BOOTSTRAP_BLUEPRINT}`);
  const company = await createCompany(name);
  const preview = await previewTeamBlueprint(company.id, AUTONOMY_BOOTSTRAP_BLUEPRINT, {
    projectCount: 1,
  });
  const applied = await applyTeamBlueprint(company.id, AUTONOMY_BOOTSTRAP_BLUEPRINT, preview);
  const bootstrapProject = applied.projectResults[0] ?? null;
  return {
    company,
    bootstrapped: true,
    bootstrapProjectId: bootstrapProject?.projectId ?? null,
    bootstrapProjectName: bootstrapProject?.projectName ?? null,
  };
}

async function resolveProject(companyId, hint, fallbackProjectId = null) {
  const projects = await listProjects(companyId);
  if (fallbackProjectId) {
    const explicit = projects.find((project) => project.id === fallbackProjectId);
    if (explicit) return explicit;
  }
  const normalized = hint.trim().toLowerCase();
  const match = projects.find((project) => {
    const name = typeof project.name === "string" ? project.name.toLowerCase() : "";
    const urlKey = typeof project.urlKey === "string" ? project.urlKey.toLowerCase() : "";
    return name === normalized || urlKey === normalized || project.id === hint;
  });
  if (!match && projects.length === 1) {
    note(`project hint ${hint} not found; falling back to the only available project ${projects[0].name}`);
    return projects[0];
  }
  assert(match, `Project not found for ${hint}`);
  return match;
}

async function createPmIntakeIssue(companyId, projectId) {
  const created = await api(`/api/companies/${companyId}/intake/issues`, {
    method: "POST",
    body: {
      request: REQUEST,
      projectId,
      priority: "high",
    },
  });
  return created.issue ?? created;
}

async function previewProjection(issueId) {
  let lastError = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await api(`/api/issues/${issueId}/intake/projection-preview`, {
        method: "POST",
        body: {
          coordinationOnly: false,
        },
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

async function getProtocolState(issueId) {
  return api(`/api/issues/${issueId}/protocol/state`);
}

async function listProtocolMessages(issueId) {
  return api(`/api/issues/${issueId}/protocol/messages`);
}

async function postProtocolMessage(issueId, body) {
  return api(`/api/issues/${issueId}/protocol/messages`, {
    method: "POST",
    body,
  });
}

async function ensureAgentApiKey(agentId) {
  const cached = agentApiKeyCache.get(agentId);
  if (cached) return cached;

  const created = await api(`/api/agents/${agentId}/keys`, {
    method: "POST",
    body: {
      name: "autonomy-burn-in",
    },
  });
  assert(typeof created?.token === "string" && created.token.length > 0, `Failed to create API key for agent ${agentId}`);
  agentApiKeyCache.set(agentId, created.token);
  return created.token;
}

function formatList(values) {
  return values.join("||");
}

async function runProtocolHelper({ companyId, agentId, issueId, args }) {
  const apiKey = await ensureAgentApiKey(agentId);
  const { stdout } = await execFileAsync("node", [PROTOCOL_HELPER_PATH, ...args], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      SQUADRAIL_API_URL: BASE_URL,
      SQUADRAIL_API_KEY: apiKey,
      SQUADRAIL_AGENT_ID: agentId,
      SQUADRAIL_COMPANY_ID: companyId,
      SQUADRAIL_TASK_ID: issueId,
    },
    encoding: "utf8",
    timeout: 180_000,
    maxBuffer: 1024 * 1024 * 8,
  });
  return stdout.trim();
}

async function ackAssignment(issueId, companyId, preview) {
  await runProtocolHelper({
    companyId,
    agentId: preview.staffing.implementationAssigneeAgentId,
    issueId,
    args: [
      "ack-assignment",
      "--issue",
      issueId,
      "--summary",
      "Accepted bounded autonomy delivery scope.",
      "--understood-scope",
      "Implement the projected child within the selected lane, preserve explicit audit evidence, and keep verification focused.",
      "--initial-risks",
      formatList([
        "Scope drift could widen the change beyond the projected delivery lane.",
        "Audit evidence could become implicit unless it stays explicit in review and close artifacts.",
      ]),
    ],
  });
}

async function startImplementation(issueId, companyId, preview) {
  await runProtocolHelper({
    companyId,
    agentId: preview.staffing.implementationAssigneeAgentId,
    issueId,
    args: [
      "start-implementation",
      "--issue",
      issueId,
      "--summary",
      "Start bounded autonomy implementation after PM projection.",
      "--implementation-mode",
      "direct",
      "--active-hypotheses",
      formatList([
        "Keep the change scoped to the selected delivery lane.",
        "Focused verification remains sufficient for this delivery slice.",
      ]),
    ],
  });
}

async function askClarification(issueId, companyId, preview, workflowStateBefore) {
  await runProtocolHelper({
    companyId,
    agentId: preview.staffing.implementationAssigneeAgentId,
    issueId,
    args: [
      "ask-clarification",
      "--issue",
      issueId,
      "--workflow-before",
      workflowStateBefore,
      "--summary",
      "Need board confirmation before implementation proceeds.",
      "--question-type",
      "requirement",
      "--question",
      "Should this stay scoped to the cloud export handoff and explicit audit evidence only?",
      "--requested-from",
      "human_board",
      "--blocking",
      "true",
      "--resume-workflow-state",
      "implementing",
      "--proposed-assumptions",
      formatList([
        "Keep the change inside the selected project lane.",
        "Focused verification remains sufficient unless the board expands scope.",
      ]),
    ],
  });

  const messages = await listProtocolMessages(issueId);
  const askMessage = [...messages]
    .reverse()
    .find((message) => message.messageType === "ASK_CLARIFICATION");
  assert(askMessage, "Clarification question was not recorded on the projected child");
  return askMessage;
}

async function escalateBlocker(issueId, companyId, preview, workflowStateBefore) {
  await runProtocolHelper({
    companyId,
    agentId: preview.staffing.implementationAssigneeAgentId,
    issueId,
    args: [
      "escalate-blocker",
      "--issue",
      issueId,
      "--workflow-before",
      workflowStateBefore,
      "--summary",
      "Blocking on board clarification before implementation continues.",
      "--blocker-code",
      "needs_human_decision",
      "--blocking-reason",
      "The projected delivery needs explicit board confirmation that scope stays limited to the cloud export handoff and audit evidence.",
      "--requested-action",
      "Confirm the scope boundary so implementation can resume without widening the change.",
      "--requested-from",
      "human_board",
    ],
  });
}

async function answerClarification(issueId, askMessage) {
  await postProtocolMessage(issueId, {
    messageType: "ANSWER_CLARIFICATION",
    sender: {
      actorType: "user",
      actorId: AUTONOMY_BOARD_ID,
      role: "human_board",
    },
    recipients: [
      {
        recipientType: "agent",
        recipientId: askMessage.sender.actorId,
        role: askMessage.sender.role,
      },
    ],
    workflowStateBefore: "blocked",
    workflowStateAfter: "implementing",
    summary: "Board confirmed the clarification and resumed execution.",
    causalMessageId: askMessage.id,
    requiresAck: false,
    payload: {
      answer: "Yes. Keep the delivery scoped to the cloud export handoff and explicit audit evidence only.",
      nextStep: "Resume implementation in the selected lane without widening scope.",
    },
    artifacts: [],
  });
}

async function submitForReview(issueId, companyId, preview, project) {
  await runProtocolHelper({
    companyId,
    agentId: preview.staffing.implementationAssigneeAgentId,
    issueId,
    args: [
      "submit-for-review",
      "--issue",
      issueId,
      "--reviewer-id",
      preview.staffing.reviewerAgentId,
      "--summary",
      `Submit ${project.name} delivery slice for reviewer verification.`,
      "--implementation-summary",
      `Scoped the ${project.name} export handoff change and preserved explicit audit evidence in the delivery slice.`,
      "--evidence",
      formatList([
        "implementation summary recorded in protocol",
        "focused verification stayed inside the selected project lane",
        "clarification trail recorded before resuming execution",
      ]),
      "--diff-summary",
      "Refined the export handoff path without widening the delivery scope.",
      "--changed-files",
      formatList([
        "src/export-handoff.ts",
        "src/export-handoff.test.ts",
      ]),
      "--test-results",
      formatList([
        "focused export handoff verification recorded",
        "protocol clarification resume invariant recorded",
      ]),
      "--review-checklist",
      formatList([
        "Scope stayed inside the selected delivery lane",
        "Audit evidence remained explicit",
        "Focused verification evidence is attached",
      ]),
      "--residual-risks",
      formatList([
        "Merge remains external to this bounded autonomy harness.",
      ]),
    ],
  });
}

async function startReview(issueId, companyId, agentId, senderRole, focus, workflowBefore = null) {
  const args = [
    "start-review",
    "--issue",
    issueId,
    "--sender-role",
    senderRole,
    "--summary",
    `${senderRole === "qa" ? "QA" : "Reviewer"} is starting verification for the autonomy slice.`,
    "--review-focus",
    formatList(focus),
  ];
  if (workflowBefore) {
    args.push("--workflow-before", workflowBefore);
  }
  await runProtocolHelper({
    companyId,
    agentId,
    issueId,
    args,
  });
}

async function approveImplementation(issueId, companyId, agentId, senderRole, workflowAfter) {
  const args = [
    "approve-implementation",
    "--issue",
    issueId,
    "--sender-role",
    senderRole,
    "--summary",
    `${senderRole === "qa" ? "QA" : "Reviewer"} approves the bounded autonomy delivery slice.`,
    "--approval-summary",
    senderRole === "qa"
      ? "QA confirmed the delivery slice is ready for closure."
      : "Reviewer confirmed the implementation is ready for QA handoff.",
    "--approval-checklist",
    formatList([
      "Delivery scope reviewed",
      "Clarification trail reviewed",
      "Evidence package reviewed",
    ]),
    "--verified-evidence",
    formatList([
      "protocol review trail recorded",
      "focused verification results recorded",
      "delivery scope remained bounded",
    ]),
    "--residual-risks",
    formatList([
      "Merge remains external to this bounded autonomy harness.",
    ]),
  ];
  if (workflowAfter) {
    args.push("--workflow-after", workflowAfter);
  }
  await runProtocolHelper({
    companyId,
    agentId,
    issueId,
    args,
  });
}

async function closeTask(issueId, companyId, techLeadAgentId, project) {
  await runProtocolHelper({
    companyId,
    agentId: techLeadAgentId,
    issueId,
    args: [
      "close-task",
      "--issue",
      issueId,
      "--sender-role",
      "tech_lead",
      "--summary",
      `Close ${project.name} autonomy delivery after reviewer and QA approval.`,
      "--closure-summary",
      `${project.name} export handoff stayed scoped, carried explicit audit evidence, and passed the bounded autonomy loop.`,
      "--verification-summary",
      "Clarification, review, QA, and focused verification evidence were all recorded in the protocol thread.",
      "--rollback-plan",
      "Revert the scoped export handoff change and reopen the delivery slice if downstream verification regresses.",
      "--final-artifacts",
      formatList([
        "protocol clarification trail recorded",
        "review approval recorded in protocol",
        "qa approval recorded in protocol",
      ]),
      "--final-test-status",
      "passed_with_known_risk",
      "--remaining-risks",
      formatList([
        "Merge remains external to this bounded autonomy harness.",
      ]),
      "--merge-status",
      "pending_external_merge",
    ],
  });
}

function assertMessageSequence(messages, requiredTypes) {
  let lastIndex = -1;
  for (const type of requiredTypes) {
    const nextIndex = messages.findIndex(
      (message, index) => index > lastIndex && message.messageType === type,
    );
    assert(nextIndex > lastIndex, `Expected protocol message sequence to include ${type} after index ${lastIndex}`);
    lastIndex = nextIndex;
  }
}

async function main() {
  note("Phase 7 bounded autonomy burn-in");
  note(`baseUrl=${BASE_URL}`);
  note(`company=${COMPANY_NAME}`);
  note(`projectHint=${PROJECT_HINT}`);

  const context = await ensureCompanyContext(COMPANY_NAME);
  const company = context.company;
  const project = await resolveProject(company.id, PROJECT_HINT, context.bootstrapProjectId);
  if (context.bootstrapped) {
    note(`bootstrapped company ${company.name}`);
    note(`bootstrap project=${context.bootstrapProjectName ?? project.name}`);
  }

  const intakeIssue = await createPmIntakeIssue(company.id, project.id);
  note(`created intake root ${intakeIssue.identifier ?? intakeIssue.id}`);

  const preview = await previewProjection(intakeIssue.id);
  assert.equal(preview.issueId, intakeIssue.id);
  assert.equal(preview.selectedProjectId, project.id);
  assert(preview.projectCandidates.some((candidate) => candidate.selected), "Preview did not select a project");
  assert(preview.draft.workItems.length >= 1, "Preview did not produce any work items");
  note(`preview selected project ${preview.selectedProjectName ?? project.name}`);
  note(`preview work items=${preview.draft.workItems.length}`);

  const projection = await applyProjection(intakeIssue.id, preview.draft);
  assert(Array.isArray(projection.projectedWorkItems), "Projection response missing projectedWorkItems");
  assert(projection.projectedWorkItems.length >= 1, "Projection did not create any child work items");

  const rootState = await getProtocolState(intakeIssue.id);
  const childIssue = projection.projectedWorkItems[0];
  const childState = await getProtocolState(childIssue.id);
  assert.equal(rootState.workflowState, "assigned");
  assert.equal(childState.workflowState, "assigned");

  await ackAssignment(childIssue.id, company.id, preview);
  const acceptedState = await getProtocolState(childIssue.id);
  assert.equal(acceptedState.workflowState, "accepted");

  await startImplementation(childIssue.id, company.id, preview);
  const implementingState = await getProtocolState(childIssue.id);
  assert.equal(implementingState.workflowState, "implementing");

  await escalateBlocker(childIssue.id, company.id, preview, implementingState.workflowState);
  const blockedState = await getProtocolState(childIssue.id);
  assert.equal(blockedState.workflowState, "blocked");

  const askMessage = await askClarification(childIssue.id, company.id, preview, blockedState.workflowState);
  note(`clarification asked ${askMessage.id}`);

  await answerClarification(childIssue.id, askMessage);
  const resumedState = await getProtocolState(childIssue.id);
  assert.equal(resumedState.workflowState, "implementing");

  await submitForReview(childIssue.id, company.id, preview, project);
  const submittedState = await getProtocolState(childIssue.id);
  assert.equal(submittedState.workflowState, "submitted_for_review");

  await startReview(
    childIssue.id,
    company.id,
    preview.staffing.reviewerAgentId,
    "reviewer",
    [
      "Scope remained bounded to the selected project lane",
      "Audit evidence stayed explicit",
      "Focused verification is sufficient for QA handoff",
    ],
  );
  const underReviewState = await getProtocolState(childIssue.id);
  assert.equal(underReviewState.workflowState, "under_review");

  if (preview.staffing.qaAgentId) {
    await approveImplementation(
      childIssue.id,
      company.id,
      preview.staffing.reviewerAgentId,
      "reviewer",
      "qa_pending",
    );
    const qaPendingState = await getProtocolState(childIssue.id);
    assert.equal(qaPendingState.workflowState, "qa_pending");

    await startReview(
      childIssue.id,
      company.id,
      preview.staffing.qaAgentId,
      "qa",
      [
        "Focused verification evidence is sufficient",
        "Clarification answer is reflected in the delivery scope",
        "Close evidence is ready for the tech lead",
      ],
      qaPendingState.workflowState,
    );
    const underQaState = await getProtocolState(childIssue.id);
    assert.equal(underQaState.workflowState, "under_qa_review");

    await approveImplementation(
      childIssue.id,
      company.id,
      preview.staffing.qaAgentId,
      "qa",
      "approved",
    );
  } else {
    await approveImplementation(
      childIssue.id,
      company.id,
      preview.staffing.reviewerAgentId,
      "reviewer",
      "approved",
    );
  }

  const approvedState = await getProtocolState(childIssue.id);
  assert.equal(approvedState.workflowState, "approved");

  await closeTask(childIssue.id, company.id, preview.staffing.techLeadAgentId, project);
  const doneState = await getProtocolState(childIssue.id);
  assert.equal(doneState.workflowState, "done");

  const messages = await listProtocolMessages(childIssue.id);
  const latestAnswer = [...messages]
    .reverse()
    .find((message) => message.messageType === "ANSWER_CLARIFICATION");
  assert(latestAnswer, "Clarification answer was not recorded on the projected child");
  assert.equal(latestAnswer.causalMessageId, askMessage.id);
  assertMessageSequence(
    messages,
    preview.staffing.qaAgentId
      ? [
          "ACK_ASSIGNMENT",
          "START_IMPLEMENTATION",
          "ESCALATE_BLOCKER",
          "ASK_CLARIFICATION",
          "ANSWER_CLARIFICATION",
          "SUBMIT_FOR_REVIEW",
          "START_REVIEW",
          "APPROVE_IMPLEMENTATION",
          "START_REVIEW",
          "APPROVE_IMPLEMENTATION",
          "CLOSE_TASK",
        ]
      : [
          "ACK_ASSIGNMENT",
          "START_IMPLEMENTATION",
          "ESCALATE_BLOCKER",
          "ASK_CLARIFICATION",
          "ANSWER_CLARIFICATION",
          "SUBMIT_FOR_REVIEW",
          "START_REVIEW",
          "APPROVE_IMPLEMENTATION",
          "CLOSE_TASK",
        ],
  );

  note(`projected child ${childIssue.identifier ?? childIssue.id}`);
  note(`clarification resumed ${resumedState.workflowState}`);
  note(`delivery loop closed ${doneState.workflowState}`);
  note("bounded autonomy burn-in invariants passed");
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
