#!/usr/bin/env node

const API_URL = process.env.SQUADRAIL_API_URL;
const API_KEY = process.env.SQUADRAIL_API_KEY;
const AGENT_ID = process.env.SQUADRAIL_AGENT_ID;
const RUN_ID = process.env.SQUADRAIL_RUN_ID;
const COMPANY_ID = process.env.SQUADRAIL_COMPANY_ID;
const DEFAULT_ISSUE_ID = process.env.SQUADRAIL_TASK_ID ?? null;
const REQUEST_TIMEOUT_MS = Number(process.env.SQUADRAIL_PROTOCOL_TIMEOUT_MS ?? 180_000);
let cachedSelfAgent = null;

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function requireEnv(name, value) {
  if (!value) fail(`Missing required environment variable: ${name}`);
  return value;
}

requireEnv("SQUADRAIL_API_URL", API_URL);
requireEnv("SQUADRAIL_API_KEY", API_KEY);
requireEnv("SQUADRAIL_AGENT_ID", AGENT_ID);
requireEnv("SQUADRAIL_COMPANY_ID", COMPANY_ID);

function readArgs(argv) {
  const positionals = [];
  const options = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      options.set(key, "true");
      continue;
    }
    options.set(key, next);
    index += 1;
  }
  return { positionals, options };
}

function readOption(options, name, fallback = null) {
  const value = options.get(name);
  return value === undefined ? fallback : value;
}

function requireOption(options, name) {
  const value = readOption(options, name);
  if (!value) fail(`Missing required option: --${name}`);
  return value;
}

function readAnyOption(options, names, fallback = null) {
  for (const name of names) {
    const value = readOption(options, name);
    if (value) return value;
  }
  return fallback;
}

function parseList(value) {
  if (!value) return [];
  return value
    .split("||")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

async function api(pathname, input = {}) {
  let response;
  try {
    response = await fetch(`${API_URL}${pathname}`, {
      method: input.method ?? "GET",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
        ...(RUN_ID ? { "X-Squadrail-Run-Id": RUN_ID } : {}),
        ...(input.headers ?? {}),
      },
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(`API ${input.method ?? "GET"} ${pathname} failed: ${message}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    fail(`API ${input.method ?? "GET"} ${pathname} failed with ${response.status}: ${
      typeof body === "string" ? body : JSON.stringify(body)
    }`);
  }

  return body;
}

async function postProtocolMessage(issueId, body) {
  const result = await api(`/api/issues/${issueId}/protocol/messages`, {
    method: "POST",
    body,
  });
  printJson(result);
}

async function getIssueState(issueId) {
  return api(`/api/issues/${issueId}/protocol/state`);
}

async function listAgents() {
  return api(`/api/companies/${COMPANY_ID}/agents`);
}

async function getSelfAgent() {
  if (cachedSelfAgent) return cachedSelfAgent;
  const agents = await listAgents();
  const selfAgent = agents.find((agent) => agent.id === AGENT_ID);
  if (!selfAgent) fail(`Unable to resolve self agent for ${AGENT_ID}`);
  cachedSelfAgent = selfAgent;
  return cachedSelfAgent;
}

function inferSenderRoleFromAgent(agent) {
  if (!agent || typeof agent !== "object") return null;
  const explicitRole =
    typeof agent.role === "string" && agent.role.trim().length > 0
      ? agent.role.trim()
      : null;
  const title =
    typeof agent.title === "string" && agent.title.trim().length > 0
      ? agent.title.trim()
      : "";
  const urlKey =
    typeof agent.urlKey === "string" && agent.urlKey.trim().length > 0
      ? agent.urlKey.trim()
      : "";

  if (explicitRole === "manager" || explicitRole === "tech_lead") {
    return "tech_lead";
  }

  if (
    explicitRole === "engineer"
    && (/tech lead/i.test(title) || /(?:^|-)tl(?:-|$)/i.test(urlKey))
  ) {
    return "tech_lead";
  }

  return explicitRole;
}

async function resolveSenderRole(options) {
  const explicitRole = readOption(options, "sender-role");
  if (explicitRole) return explicitRole;
  const selfAgent = await getSelfAgent();
  const inferredRole = inferSenderRoleFromAgent(selfAgent);
  if (inferredRole) return inferredRole;
  fail("Missing required option: --sender-role");
}

async function getBriefCommand(options) {
  const issueId = readOption(options, "issue", DEFAULT_ISSUE_ID);
  if (!issueId) fail("Missing issue id. Provide --issue or SQUADRAIL_TASK_ID.");
  const scope = readOption(options, "scope");
  const latest = parseBool(readOption(options, "latest", "true"), true);

  if (latest && !scope) {
    fail("get-brief with --latest requires --scope.");
  }

  const query = new URLSearchParams();
  if (scope) query.set("scope", scope);
  if (latest) query.set("latest", "true");
  const brief = await api(`/api/issues/${issueId}/protocol/briefs${query.size > 0 ? `?${query.toString()}` : ""}`);
  printJson(brief);
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function buildSelfRecipient(senderRole) {
  return {
    recipientType: "agent",
    recipientId: AGENT_ID,
    role: senderRole,
  };
}

function buildHumanBoardRecipient() {
  return {
    recipientType: "role_group",
    recipientId: "human_board",
    role: "human_board",
  };
}

function buildAgentRecipient(recipientId, role) {
  return {
    recipientType: "agent",
    recipientId,
    role,
  };
}

function buildRequestChangesRecipients(state, senderRole) {
  const recipients = [];

  if (state.primaryEngineerAgentId) {
    recipients.push(buildAgentRecipient(state.primaryEngineerAgentId, "engineer"));
  }

  if (
    state.techLeadAgentId
    && state.techLeadAgentId !== state.primaryEngineerAgentId
  ) {
    recipients.push(buildAgentRecipient(state.techLeadAgentId, "tech_lead"));
  }

  if (recipients.length === 0) {
    return [buildSelfRecipient(senderRole)];
  }

  return recipients;
}

function parseBool(value, fallback = false) {
  if (value === null || value === undefined) return fallback;
  const normalized = String(value).trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

function parseStructuredChangeRequests(value) {
  return parseList(value).map((entry) => {
    const [title = "", reason = "", affectedFiles = "", suggestedAction = ""] = entry
      .split("::")
      .map((segment) => segment.trim());
    return {
      title,
      reason,
      ...(affectedFiles
        ? {
            affectedFiles: affectedFiles
              .split("|")
              .map((segment) => segment.trim())
              .filter(Boolean),
          }
        : {}),
      ...(suggestedAction ? { suggestedAction } : {}),
    };
  });
}

async function resolveAgentCommand(slug) {
  const agents = await listAgents();
  const match = agents.find((agent) => agent.urlKey === slug);
  if (!match) fail(`Agent not found for urlKey=${slug}`);
  printJson(match);
}

async function reassignTaskCommand(options) {
  const issueId = readOption(options, "issue", DEFAULT_ISSUE_ID);
  if (!issueId) fail("Missing issue id. Provide --issue or SQUADRAIL_TASK_ID.");
  const senderRole = await resolveSenderRole(options);
  const assigneeId = readAnyOption(options, [
    "new-assignee-agent-id",
    "new-assignee",
    "newAssigneeAgentId",
    "assignee-id",
    "assignee",
  ]);
  if (!assigneeId) fail("Missing required option: --assignee-id");
  const assigneeRole = readAnyOption(options, [
    "new-assignee-role",
    "newAssigneeRole",
    "assignee-role",
  ], "engineer");
  const reviewerId = readAnyOption(options, [
    "new-reviewer-agent-id",
    "new-reviewer",
    "newReviewerAgentId",
    "reviewer-id",
    "reviewer",
  ]);
  if (!reviewerId) fail("Missing required option: --reviewer-id");
  const summary = readAnyOption(options, ["summary", "goal"], "Route implementation");
  const reason = requireOption(options, "reason");
  const carryForwardBriefVersion = readOption(options, "carry-forward-brief-version");
  const state = await getIssueState(issueId);

  const body = {
    messageType: "REASSIGN_TASK",
    sender: {
      actorType: "agent",
      actorId: AGENT_ID,
      role: senderRole,
    },
    recipients: [
      {
        recipientType: "agent",
        recipientId: assigneeId,
        role: assigneeRole,
      },
      {
        recipientType: "agent",
        recipientId: reviewerId,
        role: "reviewer",
      },
    ],
    workflowStateBefore: readOption(options, "workflow-before", state.workflowState),
    workflowStateAfter: "assigned",
    summary,
    requiresAck: false,
    payload: {
      reason,
      newAssigneeAgentId: assigneeId,
      newReviewerAgentId: reviewerId,
      ...(carryForwardBriefVersion ? { carryForwardBriefVersion: Number(carryForwardBriefVersion) } : {}),
    },
    artifacts: [],
  };

  await postProtocolMessage(issueId, body);
}

async function ackAssignmentCommand(options) {
  const issueId = readOption(options, "issue", DEFAULT_ISSUE_ID);
  if (!issueId) fail("Missing issue id. Provide --issue or SQUADRAIL_TASK_ID.");
  const senderRole = requireOption(options, "sender-role");
  const summary = requireOption(options, "summary");
  const understoodScope = requireOption(options, "understood-scope");
  const initialRisks = parseList(readOption(options, "initial-risks", ""));
  const state = await getIssueState(issueId);

  const body = {
    messageType: "ACK_ASSIGNMENT",
    sender: {
      actorType: "agent",
      actorId: AGENT_ID,
      role: senderRole,
    },
    recipients: [buildSelfRecipient(senderRole)],
    workflowStateBefore: readOption(options, "workflow-before", state.workflowState),
    workflowStateAfter: "accepted",
    summary,
    requiresAck: false,
    payload: {
      accepted: parseBool(readOption(options, "accepted", "true"), true),
      understoodScope,
      initialRisks,
    },
    artifacts: [],
  };

  await postProtocolMessage(issueId, body);
}

async function startImplementationCommand(options) {
  const issueId = readOption(options, "issue", DEFAULT_ISSUE_ID);
  if (!issueId) fail("Missing issue id. Provide --issue or SQUADRAIL_TASK_ID.");
  const senderRole = requireOption(options, "sender-role");
  const summary = requireOption(options, "summary");
  const activeHypotheses = parseList(readOption(options, "active-hypotheses", ""));
  const state = await getIssueState(issueId);

  const body = {
    messageType: "START_IMPLEMENTATION",
    sender: {
      actorType: "agent",
      actorId: AGENT_ID,
      role: senderRole,
    },
    recipients: [buildSelfRecipient(senderRole)],
    workflowStateBefore: readOption(options, "workflow-before", state.workflowState),
    workflowStateAfter: "implementing",
    summary,
    requiresAck: false,
    payload: {
      implementationMode: readOption(options, "implementation-mode", "direct"),
      activeHypotheses,
    },
    artifacts: [],
  };

  await postProtocolMessage(issueId, body);
}

async function reportProgressCommand(options) {
  const issueId = readOption(options, "issue", DEFAULT_ISSUE_ID);
  if (!issueId) fail("Missing issue id. Provide --issue or SQUADRAIL_TASK_ID.");
  const senderRole = requireOption(options, "sender-role");
  const summary = requireOption(options, "summary");
  const progressPercent = Number(requireOption(options, "progress-percent"));
  const completedItems = parseList(readOption(options, "completed-items", ""));
  const nextSteps = parseList(readOption(options, "next-steps", ""));
  const risks = parseList(readOption(options, "risks", ""));
  const changedFiles = parseList(readOption(options, "changed-files", ""));
  const testSummary = readOption(options, "test-summary");
  const state = await getIssueState(issueId);

  if (!Number.isFinite(progressPercent) || progressPercent < 0 || progressPercent > 100) {
    fail("--progress-percent must be a number between 0 and 100.");
  }

  const body = {
    messageType: "REPORT_PROGRESS",
    sender: {
      actorType: "agent",
      actorId: AGENT_ID,
      role: senderRole,
    },
    recipients: [buildSelfRecipient(senderRole)],
    workflowStateBefore: readOption(options, "workflow-before", state.workflowState),
    workflowStateAfter: "implementing",
    summary,
    requiresAck: false,
    payload: {
      progressPercent,
      completedItems,
      nextSteps,
      risks,
      changedFiles,
      testSummary: testSummary ?? null,
    },
    artifacts: [],
  };

  await postProtocolMessage(issueId, body);
}

async function submitForReviewCommand(options) {
  const issueId = readOption(options, "issue", DEFAULT_ISSUE_ID);
  if (!issueId) fail("Missing issue id. Provide --issue or SQUADRAIL_TASK_ID.");
  const senderRole = requireOption(options, "sender-role");
  const reviewerId = requireOption(options, "reviewer-id");
  const summary = requireOption(options, "summary");
  const implementationSummary = requireOption(options, "implementation-summary");
  const evidence = parseList(requireOption(options, "evidence"));
  const diffSummary = requireOption(options, "diff-summary");
  const changedFiles = parseList(requireOption(options, "changed-files"));
  const testResults = parseList(requireOption(options, "test-results"));
  const reviewChecklist = parseList(requireOption(options, "review-checklist"));
  const residualRisks = parseList(requireOption(options, "residual-risks"));
  const state = await getIssueState(issueId);

  const body = {
    messageType: "SUBMIT_FOR_REVIEW",
    sender: {
      actorType: "agent",
      actorId: AGENT_ID,
      role: senderRole,
    },
    recipients: [
      {
        recipientType: "agent",
        recipientId: reviewerId,
        role: "reviewer",
      },
    ],
    workflowStateBefore: readOption(options, "workflow-before", state.workflowState),
    workflowStateAfter: "submitted_for_review",
    summary,
    requiresAck: false,
    payload: {
      implementationSummary,
      evidence,
      diffSummary,
      changedFiles,
      testResults,
      reviewChecklist,
      residualRisks,
    },
    artifacts: [],
  };

  await postProtocolMessage(issueId, body);
}

async function ackChangeRequestCommand(options) {
  const issueId = readOption(options, "issue", DEFAULT_ISSUE_ID);
  if (!issueId) fail("Missing issue id. Provide --issue or SQUADRAIL_TASK_ID.");
  const senderRole = requireOption(options, "sender-role");
  const summary = requireOption(options, "summary");
  const changeRequestIds = parseList(requireOption(options, "change-request-ids"));
  const plannedFixOrder = parseList(requireOption(options, "planned-fix-order"));
  const state = await getIssueState(issueId);

  const body = {
    messageType: "ACK_CHANGE_REQUEST",
    sender: {
      actorType: "agent",
      actorId: AGENT_ID,
      role: senderRole,
    },
    recipients: [buildSelfRecipient(senderRole)],
    workflowStateBefore: readOption(options, "workflow-before", state.workflowState),
    workflowStateAfter: "implementing",
    summary,
    requiresAck: false,
    payload: {
      acknowledged: parseBool(readOption(options, "acknowledged", "true"), true),
      changeRequestIds,
      plannedFixOrder,
    },
    artifacts: [],
  };

  await postProtocolMessage(issueId, body);
}

async function startReviewCommand(options) {
  const issueId = readOption(options, "issue", DEFAULT_ISSUE_ID);
  if (!issueId) fail("Missing issue id. Provide --issue or SQUADRAIL_TASK_ID.");
  const senderRole = requireOption(options, "sender-role");
  const summary = requireOption(options, "summary");
  const reviewFocus = parseList(requireOption(options, "review-focus"));
  const state = await getIssueState(issueId);

  const body = {
    messageType: "START_REVIEW",
    sender: {
      actorType: "agent",
      actorId: AGENT_ID,
      role: senderRole,
    },
    recipients: [buildSelfRecipient(senderRole)],
    workflowStateBefore: readOption(options, "workflow-before", state.workflowState),
    workflowStateAfter: "under_review",
    summary,
    requiresAck: false,
    payload: {
      reviewCycle: Number(readOption(options, "review-cycle", String((state.currentReviewCycle ?? 0) + 1))),
      reviewFocus,
      blockingReview: readOption(options, "blocking-review", "false") === "true",
    },
    artifacts: [],
  };

  await postProtocolMessage(issueId, body);
}

async function approveImplementationCommand(options) {
  const issueId = readOption(options, "issue", DEFAULT_ISSUE_ID);
  if (!issueId) fail("Missing issue id. Provide --issue or SQUADRAIL_TASK_ID.");
  const senderRole = requireOption(options, "sender-role");
  const summary = requireOption(options, "summary");
  const approvalSummary = requireOption(options, "approval-summary");
  const approvalChecklist = parseList(requireOption(options, "approval-checklist"));
  const verifiedEvidence = parseList(requireOption(options, "verified-evidence"));
  const residualRisks = parseList(requireOption(options, "residual-risks"));
  const state = await getIssueState(issueId);

  const body = {
    messageType: "APPROVE_IMPLEMENTATION",
    sender: {
      actorType: "agent",
      actorId: AGENT_ID,
      role: senderRole,
    },
    recipients: [buildSelfRecipient(senderRole)],
    workflowStateBefore: readOption(options, "workflow-before", state.workflowState),
    workflowStateAfter: "approved",
    summary,
    requiresAck: false,
    payload: {
      approvalMode: readOption(options, "approval-mode", "agent_review"),
      approvalSummary,
      approvalChecklist,
      verifiedEvidence,
      residualRisks,
    },
    artifacts: [],
  };

  await postProtocolMessage(issueId, body);
}

async function requestChangesCommand(options) {
  const issueId = readOption(options, "issue", DEFAULT_ISSUE_ID);
  if (!issueId) fail("Missing issue id. Provide --issue or SQUADRAIL_TASK_ID.");
  const senderRole = requireOption(options, "sender-role");
  const summary = requireOption(options, "summary");
  const reviewSummary = requireOption(options, "review-summary");
  const requiredEvidence = parseList(requireOption(options, "required-evidence"));
  const changeRequests = parseStructuredChangeRequests(requireOption(options, "change-requests"));
  const state = await getIssueState(issueId);

  if (requiredEvidence.length === 0) {
    fail("REQUEST_CHANGES requires at least one required-evidence item.");
  }
  if (
    changeRequests.length === 0
    || changeRequests.some((entry) => !entry.title || !entry.reason || (!entry.affectedFiles && !entry.suggestedAction))
  ) {
    fail(
      "REQUEST_CHANGES requires --change-requests entries in title::reason::affected1|affected2::suggestedAction format.",
    );
  }

  const body = {
    messageType: "REQUEST_CHANGES",
    sender: {
      actorType: "agent",
      actorId: AGENT_ID,
      role: senderRole,
    },
    recipients: buildRequestChangesRecipients(state, senderRole),
    workflowStateBefore: readOption(options, "workflow-before", state.workflowState),
    workflowStateAfter: "changes_requested",
    summary,
    requiresAck: false,
    payload: {
      reviewSummary,
      changeRequests,
      severity: readOption(options, "severity", "high"),
      mustFixBeforeApprove: parseBool(readOption(options, "must-fix-before-approve", "true"), true),
      requiredEvidence,
    },
    artifacts: [],
  };

  await postProtocolMessage(issueId, body);
}

async function requestHumanDecisionCommand(options) {
  const issueId = readOption(options, "issue", DEFAULT_ISSUE_ID);
  if (!issueId) fail("Missing issue id. Provide --issue or SQUADRAIL_TASK_ID.");
  const senderRole = requireOption(options, "sender-role");
  const summary = requireOption(options, "summary");
  const decisionQuestion = requireOption(options, "decision-question");
  const optionsList = parseList(requireOption(options, "options"));
  const state = await getIssueState(issueId);

  if (optionsList.length < 2) {
    fail("REQUEST_HUMAN_DECISION requires at least two decision options.");
  }

  const body = {
    messageType: "REQUEST_HUMAN_DECISION",
    sender: {
      actorType: "agent",
      actorId: AGENT_ID,
      role: senderRole,
    },
    recipients: [buildHumanBoardRecipient()],
    workflowStateBefore: readOption(options, "workflow-before", state.workflowState),
    workflowStateAfter: "awaiting_human_decision",
    summary,
    requiresAck: false,
    payload: {
      decisionType: requireOption(options, "decision-type"),
      decisionQuestion,
      options: optionsList,
      ...(readOption(options, "recommended-option")
        ? { recommendedOption: readOption(options, "recommended-option") }
        : {}),
    },
    artifacts: [],
  };

  await postProtocolMessage(issueId, body);
}

async function closeTaskCommand(options) {
  const issueId = readOption(options, "issue", DEFAULT_ISSUE_ID);
  if (!issueId) fail("Missing issue id. Provide --issue or SQUADRAIL_TASK_ID.");
  const senderRole = requireOption(options, "sender-role");
  const summary = requireOption(options, "summary");
  const closureSummary = requireOption(options, "closure-summary");
  const verificationSummary = requireOption(options, "verification-summary");
  const rollbackPlan = requireOption(options, "rollback-plan");
  const finalArtifacts = parseList(requireOption(options, "final-artifacts"));
  const remainingRisks = parseList(readOption(options, "remaining-risks", ""));
  const state = await getIssueState(issueId);

  const body = {
    messageType: "CLOSE_TASK",
    sender: {
      actorType: "agent",
      actorId: AGENT_ID,
      role: senderRole,
    },
    recipients: [buildSelfRecipient(senderRole)],
    workflowStateBefore: readOption(options, "workflow-before", state.workflowState),
    workflowStateAfter: "done",
    summary,
    requiresAck: false,
    payload: {
      closeReason: readOption(options, "close-reason", "completed"),
      mergeStatus: readOption(options, "merge-status", "pending_external_merge"),
      closureSummary,
      verificationSummary,
      rollbackPlan,
      finalArtifacts,
      remainingRisks,
      ...(readOption(options, "final-test-status") ? { finalTestStatus: readOption(options, "final-test-status") } : {}),
    },
    artifacts: [],
  };

  await postProtocolMessage(issueId, body);
}

async function main() {
  const { positionals, options } = readArgs(process.argv.slice(2));
  const command = positionals[0];
  if (!command) {
    fail(
      "Usage: squadrail-protocol.mjs <resolve-agent|get-brief|reassign-task|ack-assignment|start-implementation|report-progress|submit-for-review|ack-change-request|start-review|request-changes|request-human-decision|approve-implementation|close-task> [...]",
    );
  }

  switch (command) {
    case "resolve-agent":
      await resolveAgentCommand(positionals[1] ?? fail("Usage: resolve-agent <urlKey>"));
      return;
    case "get-brief":
      await getBriefCommand(options);
      return;
    case "reassign-task":
      await reassignTaskCommand(options);
      return;
    case "ack-assignment":
      await ackAssignmentCommand(options);
      return;
    case "start-implementation":
      await startImplementationCommand(options);
      return;
    case "report-progress":
      await reportProgressCommand(options);
      return;
    case "submit-for-review":
      await submitForReviewCommand(options);
      return;
    case "ack-change-request":
      await ackChangeRequestCommand(options);
      return;
    case "start-review":
      await startReviewCommand(options);
      return;
    case "request-changes":
      await requestChangesCommand(options);
      return;
    case "request-human-decision":
      await requestHumanDecisionCommand(options);
      return;
    case "approve-implementation":
      await approveImplementationCommand(options);
      return;
    case "close-task":
      await closeTaskCommand(options);
      return;
    default:
      fail(`Unknown command: ${command}`);
  }
}

await main();
