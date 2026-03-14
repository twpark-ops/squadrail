#!/usr/bin/env node

import assert from "node:assert/strict";

const BASE_URL = process.env.SQUADRAIL_BASE_URL ?? "http://127.0.0.1:3101";
const COMPANY_NAME = process.env.SQUADRAIL_COMPANY_NAME ?? "cloud-swiftsight";
const PROJECT_HINT = process.env.SWIFTSIGHT_AUTONOMY_PROJECT ?? "swiftsight-cloud";
const REQUEST = process.env.SWIFTSIGHT_AUTONOMY_REQUEST ?? [
  "Tighten the swiftsight-cloud export handoff before release.",
  "",
  "- keep audit evidence explicit",
  "- keep the change scoped to the cloud export path",
  "- focused verification is enough",
].join("\n");

function note(message = "") {
  process.stdout.write(`${message}\n`);
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

async function resolveProject(companyId, hint) {
  const projects = await api(`/api/companies/${companyId}/projects`);
  const normalized = hint.trim().toLowerCase();
  const match = projects.find((project) => {
    const name = typeof project.name === "string" ? project.name.toLowerCase() : "";
    const urlKey = typeof project.urlKey === "string" ? project.urlKey.toLowerCase() : "";
    return name === normalized || urlKey === normalized || project.id === hint;
  });
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
  return api(`/api/issues/${issueId}/intake/projection-preview`, {
    method: "POST",
    body: {
      coordinationOnly: false,
    },
  });
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

function deriveImplementationSenderRole(preview) {
  return preview.staffing.implementationAssigneeAgentId === preview.staffing.techLeadAgentId
    ? "tech_lead"
    : "engineer";
}

async function askClarification(issueId, preview, workflowStateBefore) {
  const senderRole = deriveImplementationSenderRole(preview);
  await postProtocolMessage(issueId, {
    messageType: "ASK_CLARIFICATION",
    sender: {
      actorType: "agent",
      actorId: preview.staffing.implementationAssigneeAgentId,
      role: senderRole,
    },
    recipients: [
      {
        recipientType: "role_group",
        recipientId: "human_board",
        role: "human_board",
      },
    ],
    workflowStateBefore,
    workflowStateAfter: "blocked",
    summary: "Need board confirmation before implementation proceeds.",
    requiresAck: false,
    payload: {
      questionType: "requirement",
      question: "Should this stay scoped to the cloud export handoff and explicit audit evidence only?",
      blocking: true,
      requestedFrom: "human_board",
      resumeWorkflowState: "implementing",
      proposedAssumptions: [
        "Keep the change inside the selected project lane.",
        "Focused verification remains sufficient unless the board expands scope.",
      ],
    },
    artifacts: [],
  });

  const messages = await listProtocolMessages(issueId);
  const askMessage = [...messages]
    .reverse()
    .find((message) => message.messageType === "ASK_CLARIFICATION");
  assert(askMessage, "Clarification question was not recorded on the projected child");
  return askMessage;
}

async function answerClarification(issueId, askMessage) {
  await postProtocolMessage(issueId, {
    messageType: "ANSWER_CLARIFICATION",
    sender: {
      actorType: "user",
      actorId: "autonomy-board",
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
    workflowStateAfter: "blocked",
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

async function main() {
  note("Phase 7 autonomy kickoff");
  note(`baseUrl=${BASE_URL}`);
  note(`company=${COMPANY_NAME}`);
  note(`projectHint=${PROJECT_HINT}`);

  const company = await resolveCompanyByName(COMPANY_NAME);
  const project = await resolveProject(company.id, PROJECT_HINT);

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

  const askMessage = await askClarification(childIssue.id, preview, childState.workflowState);
  const blockedState = await getProtocolState(childIssue.id);
  assert.equal(blockedState.workflowState, "blocked");
  note(`clarification asked ${askMessage.id}`);

  await answerClarification(childIssue.id, askMessage);
  const resumedState = await getProtocolState(childIssue.id);
  assert.equal(resumedState.workflowState, "implementing");

  const messages = await listProtocolMessages(childIssue.id);
  const latestAnswer = [...messages]
    .reverse()
    .find((message) => message.messageType === "ANSWER_CLARIFICATION");
  assert(latestAnswer, "Clarification answer was not recorded on the projected child");
  assert.equal(latestAnswer.causalMessageId, askMessage.id);

  note(`projected child ${childIssue.identifier ?? childIssue.id}`);
  note(`clarification resumed ${resumedState.workflowState}`);
  note("autonomy kickoff invariants passed");
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
