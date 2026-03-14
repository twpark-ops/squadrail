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
const AUTONOMY_VARIANT = process.env.SWIFTSIGHT_AUTONOMY_VARIANT ?? "baseline";
const AUTONOMY_MULTI_CHILD_COUNT = Math.max(2, Number(process.env.SWIFTSIGHT_AUTONOMY_MULTI_CHILD_COUNT ?? 2));
const AUTONOMY_EXISTING_ROOT_ISSUE_ID = process.env.SWIFTSIGHT_AUTONOMY_EXISTING_ROOT_ISSUE_ID ?? null;
const AUTONOMY_PREVIEW_JSON = process.env.SWIFTSIGHT_AUTONOMY_PREVIEW_JSON ?? null;
const DEFAULT_REQUEST = process.env.SWIFTSIGHT_AUTONOMY_REQUEST ?? [
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

const VARIANT_DESCRIPTIONS = {
  baseline: "single project bounded autonomy with board clarification",
  multi_child_coordination: "coordination-only root with multiple projected child slices",
  reviewer_clarification_policy: "single project autonomy with reviewer-targeted clarification policy",
};

function note(message = "") {
  process.stdout.write(`${message}\n`);
}

function parseJsonEnv(name, value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON in ${name}: ${message}`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retryWithBackoff(action, options = {}) {
  const attempts = options.attempts ?? 20;
  const baseDelayMs = options.baseDelayMs ?? 200;
  const shouldRetry = options.shouldRetry ?? (() => true);
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
      if (!shouldRetry(error, attempt)) {
        throw error;
      }
      await sleep(baseDelayMs * (attempt + 1));
    }
  }
  throw lastError ?? new Error("retryWithBackoff exhausted without an error payload");
}

function resolveVariantRequest(variant) {
  if (variant === "multi_child_coordination") {
    return [
      "Coordinate the cloud-swiftsight export handoff across multiple delivery lanes before release.",
      "",
      "- keep audit evidence explicit in every child slice",
      "- preserve bounded change scope per project lane",
      "- focused verification is enough per child slice",
    ].join("\n");
  }
  if (variant === "reviewer_clarification_policy") {
    return [
      "Tighten the swiftsight-cloud export handoff before release.",
      "",
      "- reviewer must confirm the scope boundary before implementation resumes",
      "- keep audit evidence explicit",
      "- focused verification is enough",
    ].join("\n");
  }
  return DEFAULT_REQUEST;
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

async function ensureCompanyContext(name, options = {}) {
  const requiredProjectCount = options.requiredProjectCount ?? 1;
  const companies = await api("/api/companies");
  const normalized = name.trim().toLowerCase();
  const existing = companies.find((company) => {
    const companyName = typeof company.name === "string" ? company.name.toLowerCase() : "";
    const slug = typeof company.slug === "string" ? company.slug.toLowerCase() : "";
    return companyName === normalized || slug === normalized;
  });
  if (existing) {
    const existingProjects = await listProjects(existing.id);
    if (existingProjects.length < requiredProjectCount) {
      note(`company ${name} has ${existingProjects.length} project(s); expanding to ${requiredProjectCount}`);
      const preview = await previewTeamBlueprint(existing.id, AUTONOMY_BOOTSTRAP_BLUEPRINT, {
        projectCount: requiredProjectCount,
      });
      await applyTeamBlueprint(existing.id, AUTONOMY_BOOTSTRAP_BLUEPRINT, preview);
      const expandedProjects = await listProjects(existing.id);
      const primaryProject = expandedProjects[0] ?? null;
      return {
        company: existing,
        bootstrapped: false,
        expanded: true,
        bootstrapProjectId: primaryProject?.id ?? null,
        bootstrapProjectName: primaryProject?.name ?? null,
      };
    }
    return {
      company: existing,
      bootstrapped: false,
      expanded: false,
      bootstrapProjectId: null,
      bootstrapProjectName: null,
    };
  }

  note(`company ${name} not found; bootstrapping ${AUTONOMY_BOOTSTRAP_BLUEPRINT}`);
  const company = await createCompany(name);
  const preview = await previewTeamBlueprint(company.id, AUTONOMY_BOOTSTRAP_BLUEPRINT, {
    projectCount: requiredProjectCount,
  });
  const applied = await applyTeamBlueprint(company.id, AUTONOMY_BOOTSTRAP_BLUEPRINT, preview);
  const bootstrapProject = applied.projectResults[0] ?? null;
  return {
    company,
    bootstrapped: true,
    expanded: false,
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
    const [fallback] = projects;
    note(`project hint ${hint} not found; falling back to only project ${fallback.name}`);
    return fallback;
  }
  assert(match, `Project not found for ${hint}`);
  return match;
}

async function resolveVariantFallbackProjectId(companyId, variant) {
  const preferredProjectKeysByVariant = {
    baseline: ["app-surface"],
    multi_child_coordination: ["app-surface"],
    reviewer_clarification_policy: ["platform-services"],
  };
  const preferredKeys = preferredProjectKeysByVariant[variant] ?? [];
  if (preferredKeys.length === 0) return null;
  const projects = await listProjects(companyId);
  const preferred = projects.find((project) => {
    const name = typeof project.name === "string" ? project.name.toLowerCase().replace(/\s+/g, "-") : "";
    const urlKey = typeof project.urlKey === "string" ? project.urlKey.toLowerCase() : "";
    return preferredKeys.includes(name) || preferredKeys.includes(urlKey);
  });
  if (!preferred) return null;
  note(`variant ${variant} using explicit fallback project ${preferred.name}`);
  return preferred.id;
}

async function resolveProjects(companyId, hint, fallbackProjectId = null, requiredCount = 1) {
  const projects = await listProjects(companyId);
  const selected = [];
  if (requiredCount <= 1) {
    return [await resolveProject(companyId, hint, fallbackProjectId)];
  }

  const primary = await resolveProject(companyId, hint, fallbackProjectId);
  selected.push(primary);

  const remaining = projects
    .filter((project) => project.id !== primary.id)
    .sort((left, right) => left.name.localeCompare(right.name));

  for (const project of remaining) {
    if (selected.length >= requiredCount) break;
    selected.push(project);
  }

  assert(
    selected.length >= requiredCount,
    `Expected at least ${requiredCount} projects for autonomy variant ${AUTONOMY_VARIANT}; found ${selected.length}.`,
  );
  return selected.slice(0, requiredCount);
}

async function createPmIntakeIssue(companyId, projectId = null, request = DEFAULT_REQUEST) {
  const created = await api(`/api/companies/${companyId}/intake/issues`, {
    method: "POST",
    body: {
      request,
      ...(projectId ? { projectId } : {}),
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

async function getProtocolState(issueId) {
  return api(`/api/issues/${issueId}/protocol/state`);
}

async function listProtocolMessages(issueId) {
  return api(`/api/issues/${issueId}/protocol/messages`);
}

async function waitForProtocolState(issueId, expectedWorkflowState = null) {
  return retryWithBackoff(
    async () => {
      const state = await getProtocolState(issueId);
      if (expectedWorkflowState && state.workflowState !== expectedWorkflowState) {
        throw new Error(
          `Expected protocol state ${expectedWorkflowState} for ${issueId}, received ${state.workflowState}`,
        );
      }
      return state;
    },
    {
      shouldRetry(error) {
        const message = error instanceof Error ? error.message : String(error);
        return message.includes("Issue not found")
          || message.includes("Expected protocol state");
      },
    },
  );
}

async function waitForProtocolMessages(issueId, expectedMessageType = null) {
  return retryWithBackoff(
    async () => {
      const messages = await listProtocolMessages(issueId);
      if (expectedMessageType && !messages.some((message) => message.messageType === expectedMessageType)) {
        throw new Error(`Expected protocol message ${expectedMessageType} for ${issueId}`);
      }
      return messages;
    },
    {
      shouldRetry(error) {
        const message = error instanceof Error ? error.message : String(error);
        return message.includes("Issue not found")
          || message.includes("Expected protocol message");
      },
    },
  );
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

async function runBoardProtocolHelper({ companyId, issueId, args }) {
  const {
    SQUADRAIL_API_KEY: _agentApiKey,
    SQUADRAIL_AGENT_ID: _agentId,
    ...inheritedEnv
  } = process.env;
  const { stdout } = await execFileAsync("node", [PROTOCOL_HELPER_PATH, ...args], {
    cwd: REPO_ROOT,
    env: {
      ...inheritedEnv,
      SQUADRAIL_API_URL: BASE_URL,
      SQUADRAIL_COMPANY_ID: companyId,
      SQUADRAIL_TASK_ID: issueId,
      SQUADRAIL_USER_ID: AUTONOMY_BOARD_ID,
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

function resolveClarificationTarget(preview, mode) {
  if (mode === "reviewer") {
    return {
      requestedFrom: "reviewer",
      recipientId: preview.staffing.reviewerAgentId,
      responderAgentId: preview.staffing.reviewerAgentId,
      responderRole: "reviewer",
      question:
        "Please confirm whether the scoped export handoff change and explicit audit evidence are sufficient for this delivery slice.",
      answer:
        "Confirmed. Keep the delivery scoped to the export handoff and preserve explicit audit evidence only.",
      nextStep:
        "Resume implementation in the selected lane and prepare the focused evidence package for review.",
      summaryPrefix: "reviewer clarification",
    };
  }

  return {
    requestedFrom: "human_board",
    recipientId: null,
    responderAgentId: null,
    responderRole: "human_board",
    question:
      "Should this stay scoped to the cloud export handoff and explicit audit evidence only?",
    answer:
      "Yes. Keep the delivery scoped to the cloud export handoff and explicit audit evidence only.",
    nextStep:
      "Resume implementation in the selected lane without widening scope.",
    summaryPrefix: "board clarification",
  };
}

async function askClarification(issueId, companyId, preview, workflowStateBefore, clarificationTarget) {
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
      `Need ${clarificationTarget.summaryPrefix} before implementation proceeds.`,
      "--question-type",
      "requirement",
      "--question",
      clarificationTarget.question,
      "--requested-from",
      clarificationTarget.requestedFrom,
      "--blocking",
      "true",
      "--resume-workflow-state",
      "implementing",
      "--proposed-assumptions",
      formatList([
        "Keep the change inside the selected project lane.",
        "Focused verification remains sufficient unless the board expands scope.",
      ]),
      ...(clarificationTarget.recipientId
        ? ["--recipient-id", clarificationTarget.recipientId]
        : []),
    ],
  });

  const messages = await waitForProtocolMessages(issueId, "ASK_CLARIFICATION");
  const askMessage = [...messages]
    .reverse()
    .find((message) => message.messageType === "ASK_CLARIFICATION");
  assert(askMessage, "Clarification question was not recorded on the projected child");
  return askMessage;
}

async function escalateBlocker(issueId, companyId, preview, workflowStateBefore, clarificationTarget) {
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
      `Blocking on ${clarificationTarget.summaryPrefix} before implementation continues.`,
      "--blocker-code",
      "needs_human_decision",
      "--blocking-reason",
      clarificationTarget.requestedFrom === "human_board"
        ? "The projected delivery needs explicit board confirmation that scope stays limited to the cloud export handoff and audit evidence."
        : "The projected delivery needs explicit reviewer confirmation that scope stays limited to the export handoff and audit evidence.",
      "--requested-action",
      "Confirm the scope boundary so implementation can resume without widening the change.",
      "--requested-from",
      clarificationTarget.requestedFrom,
      ...(clarificationTarget.recipientId
        ? ["--recipient-id", clarificationTarget.recipientId]
        : []),
    ],
  });
}

async function answerClarification(issueId, companyId, askMessage, clarificationTarget) {
  const args = [
    "answer-clarification",
    "--issue",
    issueId,
    "--sender-role",
    clarificationTarget.responderRole,
    "--causal-message-id",
    askMessage.id,
    "--workflow-before",
    "blocked",
    "--answer",
    clarificationTarget.answer,
    "--next-step",
    clarificationTarget.nextStep,
    "--summary",
    `Resolved ${clarificationTarget.summaryPrefix} and resumed execution.`,
  ];

  if (clarificationTarget.responderRole === "human_board") {
    await runBoardProtocolHelper({
      companyId,
      issueId,
      args,
    });
    return;
  }

  await runProtocolHelper({
    companyId,
    agentId: clarificationTarget.responderAgentId,
    issueId,
    args,
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

function expectedMessageSequence(hasQa, includesClarification) {
  if (!includesClarification) {
    return hasQa
      ? [
          "ACK_ASSIGNMENT",
          "START_IMPLEMENTATION",
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
          "SUBMIT_FOR_REVIEW",
          "START_REVIEW",
          "APPROVE_IMPLEMENTATION",
          "CLOSE_TASK",
        ];
  }

  return hasQa
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
      ];
}

async function executeChildDeliveryLoop(input) {
  const {
    childIssue,
    companyId,
    preview,
    project,
    clarificationMode = "human_board",
  } = input;

  await ackAssignment(childIssue.id, companyId, preview);
  const acceptedState = await waitForProtocolState(childIssue.id, "accepted");
  assert.equal(acceptedState.workflowState, "accepted");

  await startImplementation(childIssue.id, companyId, preview);
  const implementingState = await waitForProtocolState(childIssue.id, "implementing");
  assert.equal(implementingState.workflowState, "implementing");

  let finalPreReviewState = implementingState;
  let askMessage = null;
  if (clarificationMode !== "none") {
    const clarificationTarget = resolveClarificationTarget(preview, clarificationMode);
    await escalateBlocker(
      childIssue.id,
      companyId,
      preview,
      implementingState.workflowState,
      clarificationTarget,
    );
    const blockedState = await waitForProtocolState(childIssue.id, "blocked");
    assert.equal(blockedState.workflowState, "blocked");

    askMessage = await askClarification(
      childIssue.id,
      companyId,
      preview,
      blockedState.workflowState,
      clarificationTarget,
    );
    await answerClarification(childIssue.id, companyId, askMessage, clarificationTarget);
    finalPreReviewState = await waitForProtocolState(childIssue.id, "implementing");
    assert.equal(finalPreReviewState.workflowState, "implementing");
  }

  await submitForReview(childIssue.id, companyId, preview, project);
  const submittedState = await waitForProtocolState(childIssue.id, "submitted_for_review");
  assert.equal(submittedState.workflowState, "submitted_for_review");

  await startReview(
    childIssue.id,
    companyId,
    preview.staffing.reviewerAgentId,
    "reviewer",
    [
      "Scope remained bounded to the selected project lane",
      "Audit evidence stayed explicit",
      "Focused verification is sufficient for QA handoff",
    ],
  );
  const underReviewState = await waitForProtocolState(childIssue.id, "under_review");
  assert.equal(underReviewState.workflowState, "under_review");

  if (preview.staffing.qaAgentId) {
    await approveImplementation(
      childIssue.id,
      companyId,
      preview.staffing.reviewerAgentId,
      "reviewer",
      "qa_pending",
    );
    const qaPendingState = await waitForProtocolState(childIssue.id, "qa_pending");
    assert.equal(qaPendingState.workflowState, "qa_pending");

    await startReview(
      childIssue.id,
      companyId,
      preview.staffing.qaAgentId,
      "qa",
      [
        "Focused verification evidence is sufficient",
        "Clarification answer is reflected in the delivery scope",
        "Close evidence is ready for the tech lead",
      ],
      qaPendingState.workflowState,
    );
    const underQaState = await waitForProtocolState(childIssue.id, "under_qa_review");
    assert.equal(underQaState.workflowState, "under_qa_review");

    await approveImplementation(
      childIssue.id,
      companyId,
      preview.staffing.qaAgentId,
      "qa",
      "approved",
    );
  } else {
    await approveImplementation(
      childIssue.id,
      companyId,
      preview.staffing.reviewerAgentId,
      "reviewer",
      "approved",
    );
  }

  const approvedState = await waitForProtocolState(childIssue.id, "approved");
  assert.equal(approvedState.workflowState, "approved");

  await closeTask(childIssue.id, companyId, preview.staffing.techLeadAgentId, project);
  const doneState = await waitForProtocolState(childIssue.id, "done");
  assert.equal(doneState.workflowState, "done");

  const messages = await waitForProtocolMessages(childIssue.id, "CLOSE_TASK");
  if (askMessage) {
    const latestAnswer = [...messages]
      .reverse()
      .find((message) => message.messageType === "ANSWER_CLARIFICATION");
    assert(latestAnswer, "Clarification answer was not recorded on the projected child");
    assert.equal(latestAnswer.causalMessageId, askMessage.id);
  }

  assertMessageSequence(
    messages,
    expectedMessageSequence(Boolean(preview.staffing.qaAgentId), Boolean(askMessage)),
  );

  return {
    childIssue,
    acceptedState,
    finalPreReviewState,
    doneState,
    askMessageId: askMessage?.id ?? null,
    messageCount: messages.length,
    clarificationMode,
  };
}

function buildCoordinationDraft(previews) {
  const coordinator = previews[0];
  const projectNames = previews.map(({ project }) => project.name);
  return {
    reason: `Coordinate ${projectNames.length} bounded autonomy delivery slices across ${projectNames.join(", ")}.`,
    techLeadAgentId: coordinator.preview.staffing.techLeadAgentId,
    reviewerAgentId: coordinator.preview.staffing.reviewerAgentId,
    qaAgentId: coordinator.preview.staffing.qaAgentId,
    coordinationOnly: true,
    root: {
      structuredTitle: `Coordinated autonomy delivery across ${projectNames.join(", ")}`,
      projectId: null,
      priority: "high",
      executionSummary: `Coordinate bounded delivery slices across ${projectNames.join(", ")} while keeping audit evidence explicit.`,
      acceptanceCriteria: [
        "Each child slice stays inside its selected project lane",
        "Each child records explicit review and QA evidence before close",
        "The coordination root remains a non-execution planning surface",
      ],
      definitionOfDone: [
        "All projected child slices are done",
        "Clarification and review trails are recorded per child as needed",
        "The coordination root remains available for operator follow-through",
      ],
      risks: [
        "Cross-project coordination can stall if one child lane never starts",
      ],
      openQuestions: [],
      documentationDebt: [],
    },
    workItems: previews.map(({ project, preview }, index) => ({
      ...preview.draft.workItems[0],
      title: `Autonomy child: ${project.name} bounded delivery slice`,
      description: [
        preview.draft.workItems[0].description,
        "",
        "## Autonomy Variant",
        "",
        "- multi-child coordination",
        `- child index: ${index + 1}`,
        `- project: ${project.name}`,
      ].join("\n"),
      projectId: project.id,
    })),
  };
}

async function main() {
  note("Phase 7 bounded autonomy burn-in");
  note(`baseUrl=${BASE_URL}`);
  note(`company=${COMPANY_NAME}`);
  note(`projectHint=${PROJECT_HINT}`);
  note(`variant=${AUTONOMY_VARIANT}`);
  note(`variantDescription=${VARIANT_DESCRIPTIONS[AUTONOMY_VARIANT] ?? "custom"}`);

  const externalPreview = parseJsonEnv("SWIFTSIGHT_AUTONOMY_PREVIEW_JSON", AUTONOMY_PREVIEW_JSON);
  if (AUTONOMY_EXISTING_ROOT_ISSUE_ID) {
    assert(externalPreview, "SWIFTSIGHT_AUTONOMY_PREVIEW_JSON is required when using an existing autonomy root issue");
    assert(AUTONOMY_VARIANT !== "multi_child_coordination", "Existing-root autonomy execution does not support multi_child_coordination variant");
  }

  const requiredProjectCount = AUTONOMY_VARIANT === "multi_child_coordination"
    ? AUTONOMY_MULTI_CHILD_COUNT
    : 1;
  const context = AUTONOMY_EXISTING_ROOT_ISSUE_ID
    ? {
        company: await resolveCompanyByName(COMPANY_NAME),
        bootstrapped: false,
        expanded: false,
        bootstrapProjectId: null,
        bootstrapProjectName: null,
      }
    : await ensureCompanyContext(COMPANY_NAME, {
        requiredProjectCount,
      });
  const company = context.company;
  const variantFallbackProjectId = context.bootstrapProjectId
    ?? await resolveVariantFallbackProjectId(company.id, AUTONOMY_VARIANT);
  const projects = AUTONOMY_EXISTING_ROOT_ISSUE_ID
    ? await resolveProjects(
        company.id,
        externalPreview?.selectedProjectId ?? externalPreview?.draft?.root?.projectId ?? PROJECT_HINT,
        variantFallbackProjectId,
        1,
      )
    : await resolveProjects(
        company.id,
        PROJECT_HINT,
        variantFallbackProjectId,
        requiredProjectCount,
      );
  const project = projects[0];
  if (!AUTONOMY_EXISTING_ROOT_ISSUE_ID) {
    if (context.bootstrapped) {
      note(`bootstrapped company ${company.name}`);
      note(`bootstrap project=${context.bootstrapProjectName ?? project.name}`);
    } else if (context.expanded) {
      note(`expanded company ${company.name} to ${requiredProjectCount} projects`);
    }
  }

  const intakeIssue = AUTONOMY_EXISTING_ROOT_ISSUE_ID
    ? {
        id: AUTONOMY_EXISTING_ROOT_ISSUE_ID,
        identifier: null,
      }
    : await createPmIntakeIssue(
        company.id,
        AUTONOMY_VARIANT === "multi_child_coordination" ? null : project.id,
        resolveVariantRequest(AUTONOMY_VARIANT),
      );
  note(
    AUTONOMY_EXISTING_ROOT_ISSUE_ID
      ? `using existing intake root ${intakeIssue.id}`
      : `created intake root ${intakeIssue.identifier ?? intakeIssue.id}`,
  );
  const childResults = [];
  let projection;
  let rootState;
  let selectedPreviews = [];

  if (AUTONOMY_VARIANT === "multi_child_coordination") {
    const perProjectPreviews = [];
    for (const selectedProject of projects) {
      const preview = await previewProjection(intakeIssue.id, {
        projectId: selectedProject.id,
        coordinationOnly: true,
      });
      assert.equal(preview.issueId, intakeIssue.id);
      assert.equal(preview.selectedProjectId, selectedProject.id);
      assert(preview.draft.workItems.length >= 1, `Preview did not produce a work item for ${selectedProject.name}`);
      perProjectPreviews.push({ project: selectedProject, preview });
    }
    selectedPreviews = perProjectPreviews;
    note(`coordination previews=${perProjectPreviews.length}`);
    projection = await applyProjection(intakeIssue.id, buildCoordinationDraft(perProjectPreviews));
    assert(Array.isArray(projection.projectedWorkItems), "Projection response missing projectedWorkItems");
    assert.equal(projection.projectedWorkItems.length, perProjectPreviews.length);
    rootState = await waitForProtocolState(intakeIssue.id, "assigned");
    assert.equal(rootState.workflowState, "assigned");

    for (const [index, childIssue] of projection.projectedWorkItems.entries()) {
      const childPreview = perProjectPreviews[index];
      assert(childPreview, `Missing child preview for projected work item ${index + 1}`);
      const childState = await waitForProtocolState(childIssue.id, "assigned");
      assert.equal(childState.workflowState, "assigned");
      const childResult = await executeChildDeliveryLoop({
        childIssue,
        companyId: company.id,
        preview: childPreview.preview,
        project: childPreview.project,
        clarificationMode: index === 0 ? "human_board" : "none",
      });
      childResults.push({
        issueId: childIssue.id,
        identifier: childIssue.identifier ?? null,
        projectId: childPreview.project.id,
        projectName: childPreview.project.name,
        clarificationMode: childResult.clarificationMode,
        finalWorkflowState: childResult.doneState.workflowState,
        askMessageId: childResult.askMessageId,
      });
      note(`child ${childIssue.identifier ?? childIssue.id} closed ${childResult.doneState.workflowState}`);
    }
  } else {
    const preview = externalPreview ?? await previewProjection(intakeIssue.id, {
      projectId: project.id,
      coordinationOnly: false,
    });
    selectedPreviews = [{ project, preview }];
    assert.equal(preview.issueId, intakeIssue.id);
    assert.equal(preview.selectedProjectId, project.id);
    assert(preview.projectCandidates.some((candidate) => candidate.selected), "Preview did not select a project");
    assert(preview.draft.workItems.length >= 1, "Preview did not produce any work items");
    note(`preview selected project ${preview.selectedProjectName ?? project.name}`);
    note(`preview work items=${preview.draft.workItems.length}`);

    projection = await applyProjection(intakeIssue.id, preview.draft);
    assert(Array.isArray(projection.projectedWorkItems), "Projection response missing projectedWorkItems");
    assert(projection.projectedWorkItems.length >= 1, "Projection did not create any child work items");

    rootState = await waitForProtocolState(intakeIssue.id, "assigned");
    const childIssue = projection.projectedWorkItems[0];
    const childState = await waitForProtocolState(childIssue.id, "assigned");
    assert.equal(rootState.workflowState, "assigned");
    assert.equal(childState.workflowState, "assigned");

    const childResult = await executeChildDeliveryLoop({
      childIssue,
      companyId: company.id,
      preview,
      project,
      clarificationMode: AUTONOMY_VARIANT === "reviewer_clarification_policy" ? "reviewer" : "human_board",
    });
    childResults.push({
      issueId: childIssue.id,
      identifier: childIssue.identifier ?? null,
      projectId: project.id,
      projectName: project.name,
      clarificationMode: childResult.clarificationMode,
      finalWorkflowState: childResult.doneState.workflowState,
      askMessageId: childResult.askMessageId,
    });
    note(`projected child ${childIssue.identifier ?? childIssue.id}`);
    note(`delivery loop closed ${childResult.doneState.workflowState}`);
  }

  note("bounded autonomy burn-in invariants passed");
  note(JSON.stringify({
    ok: true,
    variant: AUTONOMY_VARIANT,
    companyId: company.id,
    companyName: company.name,
    rootIssueId: intakeIssue.id,
    rootIssueIdentifier: intakeIssue.identifier ?? null,
    rootWorkflowState: rootState?.workflowState ?? null,
    projectedChildCount: projection.projectedWorkItems.length,
    selectedProjects: selectedPreviews.map(({ project }) => ({
      projectId: project.id,
      projectName: project.name,
    })),
    childResults,
  }, null, 2));
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
