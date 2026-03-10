import { conflict, unprocessable } from "../errors.js";

export interface PmIntakeAgent {
  id: string;
  companyId: string;
  name: string;
  role: string;
  status: string;
  reportsTo: string | null;
  title?: string | null;
}

const ACTIVE_INTAKE_AGENT_STATUSES = new Set(["active", "idle", "running"]);

export interface ResolvePmIntakeAgentsInput {
  agents: PmIntakeAgent[];
  pmAgentId?: string | null;
  reviewerAgentId?: string | null;
}

export interface ResolvePmIntakeAgentsResult {
  pmAgent: PmIntakeAgent;
  reviewerAgent: PmIntakeAgent;
}

function isActiveForIntake(agent: PmIntakeAgent) {
  return ACTIVE_INTAKE_AGENT_STATUSES.has(agent.status);
}

function canActAsReviewer(agent: PmIntakeAgent) {
  if (agent.role === "qa") return true;
  if (typeof agent.title === "string" && /tech lead/i.test(agent.title)) return true;
  return false;
}

function intakeAgentSortWeight(agent: PmIntakeAgent) {
  if (agent.role === "pm" && !agent.reportsTo) return 0;
  if (agent.role === "pm") return 10;
  if (agent.role === "qa" && /lead/i.test(agent.title ?? "")) return 0;
  if (agent.role === "qa") return 10;
  if (typeof agent.title === "string" && /tech lead/i.test(agent.title)) return 20;
  return 100;
}

function sortAgents(left: PmIntakeAgent, right: PmIntakeAgent) {
  const leftWeight = intakeAgentSortWeight(left);
  const rightWeight = intakeAgentSortWeight(right);
  if (leftWeight !== rightWeight) return leftWeight - rightWeight;
  return left.name.localeCompare(right.name);
}

export function resolvePmIntakeAgents(input: ResolvePmIntakeAgentsInput): ResolvePmIntakeAgentsResult {
  const activeAgents = input.agents.filter(isActiveForIntake);

  const pmCandidates = activeAgents
    .filter((agent) => agent.role === "pm")
    .sort(sortAgents);

  let pmAgent = input.pmAgentId
    ? activeAgents.find((agent) => agent.id === input.pmAgentId) ?? null
    : pmCandidates[0] ?? null;

  if (input.pmAgentId && (!pmAgent || pmAgent.role !== "pm")) {
    throw unprocessable("Selected PM agent must be an active PM in this company");
  }

  if (!pmAgent) {
    throw conflict("No active PM agent is available for intake routing");
  }

  const reviewerCandidates = activeAgents
    .filter((agent) => agent.id !== pmAgent.id && canActAsReviewer(agent))
    .sort(sortAgents);

  let reviewerAgent = input.reviewerAgentId
    ? activeAgents.find((agent) => agent.id === input.reviewerAgentId) ?? null
    : reviewerCandidates[0] ?? null;

  if (input.reviewerAgentId && (!reviewerAgent || !canActAsReviewer(reviewerAgent) || reviewerAgent.id === pmAgent.id)) {
    throw unprocessable("Selected reviewer agent must be an active QA or Tech Lead and different from the PM");
  }

  if (!reviewerAgent) {
    throw conflict("No active reviewer-capable QA or Tech Lead agent is available for PM intake");
  }

  return { pmAgent, reviewerAgent };
}

function compactLine(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function derivePmIntakeIssueTitle(input: {
  title?: string | null;
  request: string;
}) {
  const explicit = typeof input.title === "string" ? compactLine(input.title) : "";
  if (explicit.length > 0) return explicit.slice(0, 200);

  const firstLine = input.request
    .split(/\r?\n/)
    .map((line) => compactLine(line))
    .find((line) => line.length > 0);

  const fallback = firstLine ?? compactLine(input.request);
  return fallback.slice(0, 200) || "Human intake request";
}

export function buildPmIntakeIssueDescription(input: {
  request: string;
  projectName?: string | null;
  relatedIssueIdentifiers?: string[];
}) {
  const sections = [
    "## Human Intake Request",
    "",
    input.request.trim(),
    "",
    "## Structuring Expectations",
    "",
    "- Clarify the requested outcome, scope, and affected surfaces.",
    "- Produce execution-ready acceptance criteria and definition of done.",
    "- Route the work into the correct project TL lane or ask clarification if the request is still ambiguous.",
  ];

  if (input.projectName) {
    sections.push("", "## Requested Project Scope", "", `- ${input.projectName}`);
  }

  if (input.relatedIssueIdentifiers && input.relatedIssueIdentifiers.length > 0) {
    sections.push("", "## Related Issues", "", ...input.relatedIssueIdentifiers.map((identifier) => `- ${identifier}`));
  }

  return sections.join("\n");
}

export function buildPmIntakeAssignment(input: {
  title: string;
  priority: "critical" | "high" | "medium" | "low";
  pmAgentId: string;
  reviewerAgentId: string;
  requestedDueAt?: string | null;
  relatedIssueIds?: string[];
  requiredKnowledgeTags?: string[];
}) {
  return {
    summary: `PM intake: structure and route "${input.title}"`,
    payload: {
      goal: input.title,
      acceptanceCriteria: [
        "Clarify the requested outcome, scope, constraints, and impacted surfaces.",
        "Produce execution-ready acceptance criteria and definition of done for delivery.",
        "Route the issue into the correct project TL lane or explicitly request clarification.",
      ],
      definitionOfDone: [
        "The human request is summarized into an execution-ready issue.",
        "A project TL owner and reviewer are assigned, or the issue is escalated for clarification.",
        "Open questions, risks, and documentation debt are captured in protocol messages.",
      ],
      priority: input.priority,
      assigneeAgentId: input.pmAgentId,
      reviewerAgentId: input.reviewerAgentId,
      deadlineAt: input.requestedDueAt ?? null,
      relatedIssueIds: input.relatedIssueIds,
      requiredKnowledgeTags: input.requiredKnowledgeTags,
    },
  };
}
