#!/usr/bin/env node

import { execFileSync } from "node:child_process";

const API_URL = process.env.SQUADRAIL_API_URL;
const API_KEY = process.env.SQUADRAIL_API_KEY;
const AGENT_ID = process.env.SQUADRAIL_AGENT_ID;
const RUN_ID = process.env.SQUADRAIL_RUN_ID;
const COMPANY_ID = process.env.SQUADRAIL_COMPANY_ID;
const DEFAULT_ISSUE_ID = process.env.SQUADRAIL_TASK_ID ?? null;
const REQUEST_TIMEOUT_MS = Number(process.env.SQUADRAIL_PROTOCOL_TIMEOUT_MS ?? 180_000);
const DEFAULT_DISPATCH_MODE = process.env.SQUADRAIL_PROTOCOL_DISPATCH_MODE ?? "async";
let cachedSelfAgent = null;

const ENGINEER_SENDER_COMMANDS = new Set([
  "ack-assignment",
  "start-implementation",
  "report-progress",
  "submit-for-review",
  "ack-change-request",
]);

const TECH_LEAD_SENDER_COMMANDS = new Set([
  "reassign-task",
  "close-task",
  "cancel-task",
]);

const REVIEW_SENDER_COMMANDS = new Set([
  "start-review",
  "request-changes",
  "request-human-decision",
  "approve-implementation",
]);

function runGit(args) {
  return execFileSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function tryInferSubmitForReviewArtifacts(changedFiles) {
  try {
    const insideWorkTree = runGit(["rev-parse", "--is-inside-work-tree"]);
    if (insideWorkTree !== "true") return [];

    const headSha = runGit(["rev-parse", "HEAD"]);
    const statusOutput = runGit(["status", "--porcelain"]);
    if (!statusOutput) {
      return [{
        kind: "commit",
        uri: `commit://${headSha}`,
        label: `Commit ${headSha.slice(0, 12)}`,
        metadata: {
          commitSha: headSha,
          changedFiles,
          captureConfidence: "local_git_helper",
        },
      }];
    }

    const statusEntries = statusOutput
      .split("\n")
      .map((line) => line.trimEnd())
      .filter(Boolean);
    const inferredChangedFiles = statusEntries
      .map((line) => line.slice(3).trim())
      .filter(Boolean);
    return [{
      kind: "diff",
      uri: `run://${RUN_ID ?? "manual"}/workspace-diff`,
      label: `Workspace diff (${inferredChangedFiles.length || changedFiles.length} file(s))`,
      metadata: {
        headSha,
        changedFiles: inferredChangedFiles.length > 0 ? inferredChangedFiles : changedFiles,
        statusEntries,
        captureConfidence: "local_git_helper",
      },
    }];
  } catch {
    return [];
  }
}

const COMMAND_HELP = {
  general:
    "Usage: squadrail-protocol.mjs <resolve-agent|get-brief|reassign-task|ack-assignment|start-implementation|report-progress|submit-for-review|ack-change-request|start-review|request-changes|request-human-decision|approve-implementation|close-task> [...]",
  "ack-assignment": [
    "Usage: squadrail-protocol.mjs ack-assignment --issue <issueId> [--sender-role <role>] --summary <text> --understood-scope <text> [options]",
    "",
    "Supported options:",
    "  --accepted <true|false>                           (default: true)",
    "  --initial-risks \"risk1||risk2\"",
    "  --workflow-before <state>",
    "  --payload <json>                                  understoodScope, initialRisks, accepted, summary",
  ].join("\n"),
  "start-implementation": [
    "Usage: squadrail-protocol.mjs start-implementation --issue <issueId> [--sender-role <role>] --summary <text> [options]",
    "",
    "Supported options:",
    "  --implementation-mode <direct|after_plan|after_change_request>",
    "                      legacy aliases `guided`, `code_change`, and `isolated_workspace` are normalized automatically",
    "  --active-hypotheses \"item1||item2\"",
    "  --workflow-before <state>",
    "  --payload <json>                                  implementationMode, activeHypotheses, summary",
  ].join("\n"),
  "report-progress": [
    "Usage: squadrail-protocol.mjs report-progress --issue <issueId> [--sender-role <role>] --summary <text> --progress-percent <0-100> [options]",
    "",
    "Supported options:",
    "  --completed-items \"item1||item2\"",
    "  --next-steps \"item1||item2\"",
    "  --risks \"item1||item2\"",
    "  --changed-files \"path1||path2\"",
    "  --test-summary <text>",
    "  --payload <json>                                  progressPercent, completedItems, nextSteps, risks, changedFiles, testSummary, summary",
  ].join("\n"),
  "submit-for-review": [
    "Usage: squadrail-protocol.mjs submit-for-review --issue <issueId> [--sender-role <role>] --reviewer-id <agentId> --summary <text> --implementation-summary <text> [options]",
    "",
    "Required evidence options:",
    "  --evidence \"item1||item2\"",
    "  --diff-summary <text>",
    "  --changed-files \"path1||path2\"",
    "  --test-results \"cmd1||cmd2\"",
    "  --review-checklist \"item1||item2\"",
    "  --residual-risks \"item1||item2\"",
    "  --payload <json>                                  reviewerId, implementationSummary, evidence, diffSummary, changedFiles, testResults, reviewChecklist, residualRisks, summary",
  ].join("\n"),
  "ack-change-request": [
    "Usage: squadrail-protocol.mjs ack-change-request --issue <issueId> [--sender-role <role>] --summary <text> --change-request-ids \"id1||id2\" --planned-fix-order \"step1||step2\" [--payload <json>]",
  ].join("\n"),
  "start-review": [
    "Usage: squadrail-protocol.mjs start-review --issue <issueId> [--sender-role <role>] --summary <text> --review-focus \"item1||item2\" [options]",
    "",
    "Supported options:",
    "  --review-cycle <number>",
    "  --blocking-review <true|false>",
    "  --payload <json>                                  reviewCycle, reviewFocus, blockingReview, summary",
  ].join("\n"),
  "request-changes": [
    "Usage: squadrail-protocol.mjs request-changes --issue <issueId> [--sender-role <role>] --summary <text> --review-summary <text> --required-evidence \"item1||item2\" --change-requests \"title::reason::file1|file2::suggested action\"",
    "",
    "Supported options:",
    "  --severity <high|medium|low>",
    "  --must-fix-before-approve <true|false>",
    "  --payload <json>                                  reviewSummary, requiredEvidence, changeRequests, severity",
  ].join("\n"),
  "request-human-decision": [
    "Usage: squadrail-protocol.mjs request-human-decision --issue <issueId> [--sender-role <role>] --summary <text> --decision-type <type> --decision-question <text> --options \"opt1||opt2\" [options]",
    "",
    "Supported options:",
    "  --recommended-option <text>",
    "  --payload <json>                                  decisionType, decisionQuestion, options, recommendedOption",
  ].join("\n"),
  "approve-implementation": [
    "Usage: squadrail-protocol.mjs approve-implementation --issue <issueId> [--sender-role <role>] --summary <text> --approval-summary <text> --approval-checklist \"item1||item2\" --verified-evidence \"item1||item2\" --residual-risks \"item1||item2\"",
    "",
    "Supported options:",
    "  --approval-mode <agent_review|tech_lead_review|human_override>",
    "                      legacy aliases `qa_review`, `full`, and `human_board` are normalized automatically",
    "  --payload <json>                                  approvalSummary, approvalChecklist, verifiedEvidence, residualRisks",
  ].join("\n"),
  "close-task": [
    "Usage: squadrail-protocol.mjs close-task --issue <issueId> [--sender-role <role>] --summary <text> --closure-summary <text> --verification-summary <text> --rollback-plan <text> --final-artifacts \"item1||item2\" [options]",
    "",
    "Supported options:",
    "  --close-reason <completed|superseded|cancelled_by_decision|moved_to_followup>",
    "  --final-test-status <passed|passed_with_known_risk|not_applicable>",
    "                      verbose legacy values are normalized automatically",
  ].join("\n"),
  "reassign-task": [
    "Usage: squadrail-protocol.mjs reassign-task --issue <issueId> --sender-role <role> --assignee-id <agentId> --reviewer-id <agentId> --reason <text> [options]",
    "",
    "Supported options:",
    "  --assignee-id / --new-assignee-agent-id / --new-assignee / --assignee",
    "  --assignee-role / --new-assignee-role             (default: engineer)",
    "  --reviewer-id / --new-reviewer-agent-id / --new-reviewer / --reviewer",
    "  --summary / --goal",
    "  --reason",
    "  --payload <json>                                  extra payload fields to merge",
    "  --carry-forward-brief-version <number>",
    "",
    "JSON payload may include: reason, newAssigneeAgentId, newReviewerAgentId, acceptanceCriteria, definitionOfDone, implementationGuidance, risks",
  ].join("\n"),
};

function normalizeImplementationMode(value) {
  if (value === "guided" || value === "code_change" || value === "isolated_workspace") {
    return "direct";
  }
  return value;
}

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
    if (next === undefined || next.startsWith("--")) {
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

function readAliasedOption(options, names, fallback = null) {
  for (const name of names) {
    const value = readOption(options, name);
    if (value) return value;
  }
  return fallback;
}

function requireAliasedOption(options, names) {
  const value = readAliasedOption(options, names);
  if (!value) {
    fail(`Missing required option: --${names[0]}`);
  }
  return value;
}

function isHelpRequested(options) {
  return parseBool(readOption(options, "help"), false) || parseBool(readOption(options, "h"), false);
}

function printHelp(command = "general") {
  const text = COMMAND_HELP[command] ?? COMMAND_HELP.general;
  process.stdout.write(`${text}\n`);
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

function parseListLike(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter(Boolean);
  }
  if (typeof value === "string") {
    return parseList(value);
  }
  return [];
}

function parseJsonOption(options, name) {
  const raw = readOption(options, name);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      fail(`--${name} must be a JSON object`);
    }
    return parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(`Invalid JSON for --${name}: ${message}`);
  }
}

function normalizeApprovalMode(value) {
  if (!value) return "agent_review";
  switch (value) {
    case "qa_review":
    case "reviewer_review":
    case "full":
      return "agent_review";
    case "tech_lead":
    case "lead_review":
      return "tech_lead_review";
    case "human_board":
    case "board_override":
      return "human_override";
    default:
      return value;
  }
}

function normalizeCloseReason(value) {
  if (!value) return "completed";
  const normalized = value.trim().toLowerCase();
  switch (normalized) {
    case "completed":
    case "superseded":
    case "cancelled_by_decision":
    case "moved_to_followup":
      return normalized;
    default:
      if (normalized.includes("follow") || normalized.includes("next issue")) {
        return "moved_to_followup";
      }
      if (normalized.includes("cancel") || normalized.includes("abort") || normalized.includes("reject")) {
        return "cancelled_by_decision";
      }
      if (normalized.includes("supersed")) {
        return "superseded";
      }
      return "completed";
  }
}

function normalizeFinalTestStatus(value) {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  switch (normalized) {
    case "passed":
    case "passed_with_known_risk":
    case "not_applicable":
      return normalized;
    default:
      if (normalized.startsWith("passed")) {
        return normalized.includes("risk") ? "passed_with_known_risk" : "passed";
      }
      if (
        normalized.includes("all green")
        || normalized.includes("green")
        || normalized.includes("all tests passed")
        || normalized.includes("tests passed")
      ) {
        return "passed";
      }
      if (normalized.includes("known_risk") || normalized.includes("known risk")) {
        return "passed_with_known_risk";
      }
      if (normalized.includes("n/a") || normalized.includes("not applicable")) {
        return "not_applicable";
      }
      return null;
  }
}

function parseListOptionOrPayload(options, names, payloadValue, { required = false, requiredLabel = names[0] } = {}) {
  const optionValue = readAliasedOption(options, names);
  const parsed = optionValue ? parseList(optionValue) : parseListLike(payloadValue);
  if (required && parsed.length === 0) {
    fail(`Missing required option: --${requiredLabel}`);
  }
  return parsed;
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
    headers: {
      "X-Squadrail-Dispatch-Mode": DEFAULT_DISPATCH_MODE,
    },
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

function inferSenderRoleFromAgent(agent, options = {}) {
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

  if (options.preferExplicitEngineer && explicitRole === "engineer") {
    return "engineer";
  }

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

async function resolveSenderRole(options, commandName = null) {
  const explicitRole = readOption(options, "sender-role");
  if (explicitRole) return explicitRole;
  const issueId = readOption(options, "issue", DEFAULT_ISSUE_ID);
  const selfAgent = await getSelfAgent();
  const preferExplicitEngineer = ENGINEER_SENDER_COMMANDS.has(commandName);
  if (issueId) {
    const issueState = await getIssueState(issueId);
    if (TECH_LEAD_SENDER_COMMANDS.has(commandName)) {
      if (issueState?.techLeadAgentId === AGENT_ID) {
        return "tech_lead";
      }
    } else if (REVIEW_SENDER_COMMANDS.has(commandName)) {
      if (issueState?.qaAgentId === AGENT_ID) {
        return "qa";
      }
      if (issueState?.reviewerAgentId === AGENT_ID) {
        return "reviewer";
      }
      if (issueState?.techLeadAgentId === AGENT_ID) {
        return "tech_lead";
      }
    } else if (!preferExplicitEngineer) {
      if (issueState?.qaAgentId === AGENT_ID) {
        return "qa";
      }
      if (issueState?.reviewerAgentId === AGENT_ID) {
        return "reviewer";
      }
      if (issueState?.techLeadAgentId === AGENT_ID) {
        return "tech_lead";
      }
    }
  }
  const inferredRole = inferSenderRoleFromAgent(selfAgent, { preferExplicitEngineer });
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
  if (isHelpRequested(options)) {
    printHelp("reassign-task");
    return;
  }
  const issueId = readOption(options, "issue", DEFAULT_ISSUE_ID);
  if (!issueId) fail("Missing issue id. Provide --issue or SQUADRAIL_TASK_ID.");
  const senderRole = await resolveSenderRole(options, "reassign-task");
  const payloadPatch = parseJsonOption(options, "payload") ?? {};
  const assigneeId = readAnyOption(options, [
    "new-assignee-agent-id",
    "new-assignee",
    "newAssigneeAgentId",
    "assignee-id",
    "assignee",
  ], payloadPatch.newAssigneeAgentId ?? payloadPatch.assigneeAgentId ?? null);
  if (!assigneeId) fail("Missing required option: --assignee-id");
  const assigneeRole = readAnyOption(options, [
    "new-assignee-role",
    "newAssigneeRole",
    "assignee-role",
  ], payloadPatch.newAssigneeRole ?? payloadPatch.assigneeRole ?? "engineer");
  const reviewerId = readAnyOption(options, [
    "new-reviewer-agent-id",
    "new-reviewer",
    "newReviewerAgentId",
    "reviewer-id",
    "reviewer",
  ], payloadPatch.newReviewerAgentId ?? payloadPatch.reviewerAgentId ?? null);
  if (!reviewerId) fail("Missing required option: --reviewer-id");
  const summary = readAnyOption(options, ["summary", "goal"], payloadPatch.goal ?? payloadPatch.summary ?? "Route implementation");
  const reason = readOption(options, "reason", payloadPatch.reason ?? null);
  if (!reason) fail("Missing required option: --reason");
  const carryForwardBriefVersion = readOption(
    options,
    "carry-forward-brief-version",
    payloadPatch.carryForwardBriefVersion == null ? null : String(payloadPatch.carryForwardBriefVersion),
  );
  const state = await getIssueState(issueId);

  const {
    reason: _ignoredReason,
    newAssigneeAgentId: _ignoredAssignee,
    assigneeAgentId: _ignoredLegacyAssignee,
    newAssigneeRole: _ignoredAssigneeRole,
    assigneeRole: _ignoredLegacyAssigneeRole,
    newReviewerAgentId: _ignoredReviewer,
    reviewerAgentId: _ignoredLegacyReviewer,
    carryForwardBriefVersion: _ignoredCarryForward,
    goal: _ignoredGoal,
    summary: _ignoredSummary,
    ...extraPayload
  } = payloadPatch;

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
      ...extraPayload,
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
  if (isHelpRequested(options)) {
    printHelp("ack-assignment");
    return;
  }
  const issueId = readOption(options, "issue", DEFAULT_ISSUE_ID);
  if (!issueId) fail("Missing issue id. Provide --issue or SQUADRAIL_TASK_ID.");
  const senderRole = await resolveSenderRole(options, "ack-assignment");
  const payloadPatch = parseJsonOption(options, "payload") ?? {};
  const understoodScope = readAliasedOption(
    options,
    ["understood-scope", "understoodScope"],
    payloadPatch.understoodScope ?? null,
  );
  if (!understoodScope) fail("Missing required option: --understood-scope");
  const summary = readAnyOption(options, ["summary"], payloadPatch.summary ?? understoodScope);
  if (!summary) fail("Missing required option: --summary");
  const initialRisks = parseListOptionOrPayload(
    options,
    ["initial-risks", "initialRisks"],
    payloadPatch.initialRisks,
  );
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
      accepted: parseBool(
        readAliasedOption(
          options,
          ["accepted"],
          payloadPatch.accepted == null ? "true" : String(payloadPatch.accepted),
        ),
        true,
      ),
      understoodScope,
      initialRisks,
    },
    artifacts: [],
  };

  await postProtocolMessage(issueId, body);
}

async function startImplementationCommand(options) {
  if (isHelpRequested(options)) {
    printHelp("start-implementation");
    return;
  }
  const issueId = readOption(options, "issue", DEFAULT_ISSUE_ID);
  if (!issueId) fail("Missing issue id. Provide --issue or SQUADRAIL_TASK_ID.");
  const senderRole = await resolveSenderRole(options, "start-implementation");
  const payloadPatch = parseJsonOption(options, "payload") ?? {};
  const summary = readAnyOption(options, ["summary"], payloadPatch.summary ?? "Start implementation");
  if (!summary) fail("Missing required option: --summary");
  const activeHypotheses = parseListOptionOrPayload(
    options,
    ["active-hypotheses", "activeHypotheses"],
    payloadPatch.activeHypotheses,
  );
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
      implementationMode: normalizeImplementationMode(
        readAliasedOption(
          options,
          ["implementation-mode", "implementationMode"],
          payloadPatch.implementationMode ?? "direct",
        ),
      ),
      activeHypotheses,
    },
    artifacts: [],
  };

  await postProtocolMessage(issueId, body);
}

async function reportProgressCommand(options) {
  if (isHelpRequested(options)) {
    printHelp("report-progress");
    return;
  }
  const issueId = readOption(options, "issue", DEFAULT_ISSUE_ID);
  if (!issueId) fail("Missing issue id. Provide --issue or SQUADRAIL_TASK_ID.");
  const senderRole = await resolveSenderRole(options, "report-progress");
  const payloadPatch = parseJsonOption(options, "payload") ?? {};
  const summary = readAnyOption(options, ["summary"], payloadPatch.summary ?? "Report implementation progress");
  if (!summary) fail("Missing required option: --summary");
  const progressPercentRaw = readAliasedOption(
    options,
    ["progress-percent", "progressPercent"],
    payloadPatch.progressPercent == null ? null : String(payloadPatch.progressPercent),
  );
  if (!progressPercentRaw) fail("Missing required option: --progress-percent");
  const progressPercent = Number(progressPercentRaw);
  const completedItems = parseListOptionOrPayload(
    options,
    ["completed-items", "completedItems"],
    payloadPatch.completedItems,
  );
  const nextSteps = parseListOptionOrPayload(
    options,
    ["next-steps", "nextSteps"],
    payloadPatch.nextSteps,
  );
  const risks = parseListOptionOrPayload(options, ["risks"], payloadPatch.risks);
  const changedFiles = parseListOptionOrPayload(
    options,
    ["changed-files", "changedFiles"],
    payloadPatch.changedFiles,
  );
  const testSummary = readAliasedOption(
    options,
    ["test-summary", "testSummary"],
    payloadPatch.testSummary ?? null,
  );
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
  if (isHelpRequested(options)) {
    printHelp("submit-for-review");
    return;
  }
  const issueId = readOption(options, "issue", DEFAULT_ISSUE_ID);
  if (!issueId) fail("Missing issue id. Provide --issue or SQUADRAIL_TASK_ID.");
  const senderRole = await resolveSenderRole(options, "submit-for-review");
  const payloadPatch = parseJsonOption(options, "payload") ?? {};
  const reviewerId = readAliasedOption(
    options,
    ["reviewer-id", "reviewerId"],
    payloadPatch.reviewerId ?? payloadPatch.newReviewerAgentId ?? null,
  );
  if (!reviewerId) fail("Missing required option: --reviewer-id");
  const implementationSummary = readAliasedOption(
    options,
    ["implementation-summary", "implementationSummary"],
    payloadPatch.implementationSummary ?? null,
  );
  if (!implementationSummary) fail("Missing required option: --implementation-summary");
  const summary = readAnyOption(options, ["summary"], payloadPatch.summary ?? implementationSummary);
  if (!summary) fail("Missing required option: --summary");
  const evidence = parseListOptionOrPayload(options, ["evidence"], payloadPatch.evidence, {
    required: true,
    requiredLabel: "evidence",
  });
  const diffSummary = readAliasedOption(
    options,
    ["diff-summary", "diffSummary"],
    payloadPatch.diffSummary ?? null,
  );
  if (!diffSummary) fail("Missing required option: --diff-summary");
  const changedFiles = parseListOptionOrPayload(
    options,
    ["changed-files", "changedFiles"],
    payloadPatch.changedFiles,
    { required: true, requiredLabel: "changed-files" },
  );
  const testResults = parseListOptionOrPayload(
    options,
    ["test-results", "testResults"],
    payloadPatch.testResults,
    { required: true, requiredLabel: "test-results" },
  );
  const reviewChecklist = parseListOptionOrPayload(
    options,
    ["review-checklist", "reviewChecklist"],
    payloadPatch.reviewChecklist,
    { required: true, requiredLabel: "review-checklist" },
  );
  const residualRisks = parseListOptionOrPayload(
    options,
    ["residual-risks", "residualRisks"],
    payloadPatch.residualRisks,
    { required: true, requiredLabel: "residual-risks" },
  );
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
    artifacts: tryInferSubmitForReviewArtifacts(changedFiles),
  };

  await postProtocolMessage(issueId, body);
}

async function ackChangeRequestCommand(options) {
  if (isHelpRequested(options)) {
    printHelp("ack-change-request");
    return;
  }
  const issueId = readOption(options, "issue", DEFAULT_ISSUE_ID);
  if (!issueId) fail("Missing issue id. Provide --issue or SQUADRAIL_TASK_ID.");
  const senderRole = await resolveSenderRole(options, "ack-change-request");
  const payloadPatch = parseJsonOption(options, "payload") ?? {};
  const summary = readAnyOption(
    options,
    ["summary"],
    payloadPatch.summary ?? payloadPatch.reviewSummary ?? "Acknowledge requested changes",
  );
  if (!summary) fail("Missing required option: --summary");
  const changeRequestIds = parseListOptionOrPayload(
    options,
    ["change-request-ids", "changeRequestIds"],
    payloadPatch.changeRequestIds,
    { required: true, requiredLabel: "change-request-ids" },
  );
  const plannedFixOrder = parseListOptionOrPayload(
    options,
    ["planned-fix-order", "plannedFixOrder"],
    payloadPatch.plannedFixOrder,
    { required: true, requiredLabel: "planned-fix-order" },
  );
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
      acknowledged: parseBool(
        readAliasedOption(options, ["acknowledged"], payloadPatch.acknowledged == null ? "true" : String(payloadPatch.acknowledged)),
        true,
      ),
      changeRequestIds,
      plannedFixOrder,
    },
    artifacts: [],
  };

  await postProtocolMessage(issueId, body);
}

async function startReviewCommand(options) {
  if (isHelpRequested(options)) {
    printHelp("start-review");
    return;
  }
  const issueId = readOption(options, "issue", DEFAULT_ISSUE_ID);
  if (!issueId) fail("Missing issue id. Provide --issue or SQUADRAIL_TASK_ID.");
  const senderRole = await resolveSenderRole(options, "start-review");
  const payloadPatch = parseJsonOption(options, "payload") ?? {};
  const reviewFocus = parseListOptionOrPayload(
    options,
    ["review-focus", "reviewFocus"],
    payloadPatch.reviewFocus,
    { required: true, requiredLabel: "review-focus" },
  );
  const summary = readAnyOption(
    options,
    ["summary"],
    payloadPatch.summary ?? `Start review for ${reviewFocus[0] ?? "submitted implementation"}`,
  );
  if (!summary) fail("Missing required option: --summary");
  const state = await getIssueState(issueId);
  const workflowStateAfter = readOption(
    options,
    "workflow-after",
    senderRole === "qa" ? "under_qa_review" : "under_review",
  );

  const body = {
    messageType: "START_REVIEW",
    sender: {
      actorType: "agent",
      actorId: AGENT_ID,
      role: senderRole,
    },
    recipients: [buildSelfRecipient(senderRole)],
    workflowStateBefore: readOption(options, "workflow-before", state.workflowState),
    workflowStateAfter,
    summary,
    requiresAck: false,
    payload: {
      reviewCycle: Number(
        readAliasedOption(
          options,
          ["review-cycle", "reviewCycle"],
          payloadPatch.reviewCycle == null ? String((state.currentReviewCycle ?? 0) + 1) : String(payloadPatch.reviewCycle),
        ),
      ),
      reviewFocus,
      blockingReview: parseBool(
        readAliasedOption(
          options,
          ["blocking-review", "blockingReview"],
          payloadPatch.blockingReview == null ? "false" : String(payloadPatch.blockingReview),
        ),
        false,
      ),
    },
    artifacts: [],
  };

  await postProtocolMessage(issueId, body);
}

async function approveImplementationCommand(options) {
  const commandName = "approve-implementation";
  if (isHelpRequested(options)) {
    printHelp(commandName);
    return;
  }
  const issueId = readOption(options, "issue", DEFAULT_ISSUE_ID);
  if (!issueId) fail("Missing issue id. Provide --issue or SQUADRAIL_TASK_ID.");
  const senderRole = await resolveSenderRole(options, commandName);
  const payloadPatch = parseJsonOption(options, "payload") ?? {};
  const approvalSummary = readAliasedOption(
    options,
    ["approval-summary", "approvalSummary"],
    payloadPatch.approvalSummary ?? null,
  );
  if (!approvalSummary) fail("Missing required option: --approval-summary");
  const summary = readAnyOption(options, ["summary"], payloadPatch.summary ?? approvalSummary);
  if (!summary) fail("Missing required option: --summary");
  const approvalChecklist = parseListOptionOrPayload(
    options,
    ["approval-checklist", "approvalChecklist"],
    payloadPatch.approvalChecklist,
    { required: true, requiredLabel: "approval-checklist" },
  );
  const verifiedEvidence = parseListOptionOrPayload(
    options,
    ["verified-evidence", "verifiedEvidence"],
    payloadPatch.verifiedEvidence,
    { required: true, requiredLabel: "verified-evidence" },
  );
  const residualRisks = parseListOptionOrPayload(
    options,
    ["residual-risks", "residualRisks"],
    payloadPatch.residualRisks,
    { required: true, requiredLabel: "residual-risks" },
  );
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
    workflowStateAfter: readOption(options, "workflow-after", "approved"),
    summary,
    requiresAck: false,
    payload: {
      approvalMode: normalizeApprovalMode(
        readAliasedOption(
          options,
          ["approval-mode", "approvalMode"],
          payloadPatch.approvalMode ?? "agent_review",
        ),
      ),
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
  const commandName = "request-changes";
  if (isHelpRequested(options)) {
    printHelp(commandName);
    return;
  }
  const issueId = readOption(options, "issue", DEFAULT_ISSUE_ID);
  if (!issueId) fail("Missing issue id. Provide --issue or SQUADRAIL_TASK_ID.");
  const senderRole = await resolveSenderRole(options, commandName);
  const payloadPatch = parseJsonOption(options, "payload") ?? {};
  const reviewSummary = readAliasedOption(
    options,
    ["review-summary", "reviewSummary"],
    payloadPatch.reviewSummary ?? null,
  );
  if (!reviewSummary) fail("Missing required option: --review-summary");
  const summary = readAnyOption(options, ["summary"], payloadPatch.summary ?? reviewSummary);
  if (!summary) fail("Missing required option: --summary");
  const requiredEvidence = parseListOptionOrPayload(
    options,
    ["required-evidence", "requiredEvidence"],
    payloadPatch.requiredEvidence,
    { required: true, requiredLabel: "required-evidence" },
  );
  const changeRequestOption = readAliasedOption(options, ["change-requests", "changeRequests"], null);
  const changeRequests = changeRequestOption
    ? parseStructuredChangeRequests(changeRequestOption)
    : Array.isArray(payloadPatch.changeRequests)
      ? payloadPatch.changeRequests
      : [];
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
      severity: readAliasedOption(options, ["severity"], payloadPatch.severity ?? "high"),
      mustFixBeforeApprove: parseBool(
        readAliasedOption(
          options,
          ["must-fix-before-approve", "mustFixBeforeApprove"],
          payloadPatch.mustFixBeforeApprove == null ? "true" : String(payloadPatch.mustFixBeforeApprove),
        ),
        true,
      ),
      requiredEvidence,
    },
    artifacts: [],
  };

  await postProtocolMessage(issueId, body);
}

async function requestHumanDecisionCommand(options) {
  const commandName = "request-human-decision";
  if (isHelpRequested(options)) {
    printHelp(commandName);
    return;
  }
  const issueId = readOption(options, "issue", DEFAULT_ISSUE_ID);
  if (!issueId) fail("Missing issue id. Provide --issue or SQUADRAIL_TASK_ID.");
  const senderRole = await resolveSenderRole(options, commandName);
  const payloadPatch = parseJsonOption(options, "payload") ?? {};
  const decisionQuestion = readAliasedOption(
    options,
    ["decision-question", "decisionQuestion"],
    payloadPatch.decisionQuestion ?? null,
  );
  if (!decisionQuestion) fail("Missing required option: --decision-question");
  const summary = readAnyOption(options, ["summary"], payloadPatch.summary ?? decisionQuestion);
  if (!summary) fail("Missing required option: --summary");
  const optionsList = parseListOptionOrPayload(options, ["options"], payloadPatch.options, {
    required: true,
    requiredLabel: "options",
  });
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
      decisionType: readAliasedOption(
        options,
        ["decision-type", "decisionType"],
        payloadPatch.decisionType ?? null,
      ) ?? fail("Missing required option: --decision-type"),
      decisionQuestion,
      options: optionsList,
      ...(readAliasedOption(
        options,
        ["recommended-option", "recommendedOption"],
        payloadPatch.recommendedOption ?? null,
      )
        ? {
            recommendedOption: readAliasedOption(
              options,
              ["recommended-option", "recommendedOption"],
              payloadPatch.recommendedOption ?? null,
            ),
          }
        : {}),
    },
    artifacts: [],
  };

  await postProtocolMessage(issueId, body);
}

async function closeTaskCommand(options) {
  if (isHelpRequested(options)) {
    printHelp("close-task");
    return;
  }
  const issueId = readOption(options, "issue", DEFAULT_ISSUE_ID);
  if (!issueId) fail("Missing issue id. Provide --issue or SQUADRAIL_TASK_ID.");
  const senderRole = await resolveSenderRole(options, "close-task");
  const closureSummary = requireAliasedOption(options, ["closure-summary", "closureSummary"]);
  const summary = readAliasedOption(options, ["summary"], closureSummary);
  const verificationSummary = requireAliasedOption(options, ["verification-summary", "verificationSummary"]);
  const rollbackPlan = requireAliasedOption(options, ["rollback-plan", "rollbackPlan"]);
  const finalArtifacts = parseList(requireAliasedOption(options, ["final-artifacts", "finalArtifacts"]));
  const remainingRisks = parseList(readAliasedOption(options, ["remaining-risks", "remainingRisks"], ""));
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
      closeReason: normalizeCloseReason(
        readAliasedOption(options, ["close-reason", "closeReason"], "completed"),
      ),
      mergeStatus: readAliasedOption(options, ["merge-status", "mergeStatus"], "pending_external_merge"),
      closureSummary,
      verificationSummary,
      rollbackPlan,
      finalArtifacts,
      remainingRisks,
      ...(normalizeFinalTestStatus(readAliasedOption(options, ["final-test-status", "finalTestStatus"]))
        ? { finalTestStatus: normalizeFinalTestStatus(readAliasedOption(options, ["final-test-status", "finalTestStatus"])) }
        : {}),
    },
    artifacts: [],
  };

  await postProtocolMessage(issueId, body);
}

async function main() {
  const { positionals, options } = readArgs(process.argv.slice(2));
  const command = positionals[0];
  if (!command) {
    printHelp("general");
    process.exit(1);
  }
  if ((command === "--help" || command === "help") && positionals[1]) {
    printHelp(positionals[1]);
    return;
  }
  if (command === "--help" || command === "help") {
    printHelp("general");
    return;
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

try {
  await main();
  process.exit(0);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  fail(message);
}
