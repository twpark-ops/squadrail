import type {
  PmIntakeProjectionPreviewRequest,
  PmIntakeProjectionPreviewResult,
} from "@squadrail/shared";
import { conflict, unprocessable } from "../errors.js";

export interface PmIntakeAgent {
  id: string;
  companyId: string;
  name: string;
  urlKey?: string | null;
  role: string;
  status: string;
  reportsTo: string | null;
  title?: string | null;
}

export interface PmIntakeProjectCandidate {
  id: string;
  companyId: string;
  name: string;
  urlKey?: string | null;
  primaryWorkspace?: {
    cwd?: string | null;
    repoUrl?: string | null;
    repoRef?: string | null;
  } | null;
}

export interface PmIntakeKnowledgeDocument {
  id: string;
  companyId: string;
  projectId: string | null;
  sourceType: string;
  authorityLevel: string;
  path?: string | null;
  title?: string | null;
  rawContent: string;
  metadata?: Record<string, unknown> | null;
}

interface BuildPmIntakeProjectionPreviewInput {
  issue: {
    id: string;
    companyId: string;
    title: string;
    description: string | null;
    priority: "critical" | "high" | "medium" | "low";
    projectId: string | null;
  };
  projects: PmIntakeProjectCandidate[];
  agents: PmIntakeAgent[];
  knowledgeDocuments?: PmIntakeKnowledgeDocument[];
  request: PmIntakeProjectionPreviewRequest;
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

function hasReviewerIdentity(agent: PmIntakeAgent) {
  if (agent.role === "reviewer") return true;
  if (typeof agent.title === "string" && /reviewer/i.test(agent.title)) return true;
  return /(?:^|-)(reviewer)(?:-|$)/i.test(agent.urlKey ?? "");
}

function hasDedicatedEngineerIdentity(agent: PmIntakeAgent) {
  if (typeof agent.title === "string" && /\bengineer\b/i.test(agent.title)) return true;
  return /(?:^|-)(engineer)(?:-|$)/i.test(agent.urlKey ?? "");
}

function canActAsReviewer(agent: PmIntakeAgent) {
  if (hasReviewerIdentity(agent)) return true;
  if (agent.role === "qa") return true;
  if (typeof agent.title === "string" && /tech lead/i.test(agent.title)) return true;
  return false;
}

function canActAsTechLead(agent: PmIntakeAgent) {
  if (agent.role === "manager" || agent.role === "tech_lead") return true;
  if (typeof agent.title === "string" && /tech lead/i.test(agent.title)) return true;
  return /(?:^|-)(tl|tech-lead)(?:-|$)/i.test(agent.urlKey ?? "");
}

function canActAsEngineer(agent: PmIntakeAgent) {
  return agent.role === "engineer";
}

function canActAsQa(agent: PmIntakeAgent) {
  return agent.role === "qa";
}

function intakeAgentSortWeight(agent: PmIntakeAgent) {
  if (agent.role === "pm" && !agent.reportsTo) return 0;
  if (agent.role === "pm") return 10;
  if (hasReviewerIdentity(agent)) return 0;
  if (agent.role === "qa" && /lead/i.test(agent.title ?? "")) return 10;
  if (agent.role === "qa") return 20;
  if (typeof agent.title === "string" && /tech lead/i.test(agent.title)) return 20;
  return 100;
}

function sortAgents(left: PmIntakeAgent, right: PmIntakeAgent) {
  const leftWeight = intakeAgentSortWeight(left);
  const rightWeight = intakeAgentSortWeight(right);
  if (leftWeight !== rightWeight) return leftWeight - rightWeight;
  return left.name.localeCompare(right.name);
}

function compactLine(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function tokenize(value: string | null | undefined) {
  if (!value) return [];
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function readStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
}

function readRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => (typeof value === "string" ? value.trim() : "")).filter(Boolean))];
}

function extractHumanRequest(description: string | null | undefined) {
  const source = typeof description === "string" ? description : "";
  if (!source.trim()) return "";
  const match = source.match(/## Human Intake Request\s+([\s\S]*?)\n## /i);
  if (match?.[1]) return match[1].trim();
  return source.trim();
}

function extractBulletItems(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line))
    .map((line) => line.replace(/^[-*]\s+/, "").replace(/^\d+\.\s+/, "").trim())
    .filter(Boolean);
}

function buildProjectSearchTerms(project: PmIntakeProjectCandidate) {
  const cwd = project.primaryWorkspace?.cwd ?? null;
  return uniqueStrings([
    project.name,
    project.urlKey ?? null,
    project.primaryWorkspace?.repoRef ?? null,
    cwd ? cwd.split(/[\\/]/).filter(Boolean).pop() ?? null : null,
  ]);
}

function scoreTextAgainstRequest(text: string, requestLower: string, requestTokens: Set<string>) {
  const normalized = compactLine(text).toLowerCase();
  if (!normalized) return { score: 0, overlapCount: 0 };
  let score = 0;
  if (requestLower.includes(normalized)) {
    score += 4;
  }
  const overlapCount = tokenize(normalized).filter((token) => requestTokens.has(token)).length;
  score += overlapCount;
  return { score, overlapCount };
}

function scoreKnowledgeDocumentForProject(input: {
  document: PmIntakeKnowledgeDocument;
  requestLower: string;
  requestTokens: Set<string>;
  requestKnowledgeTags: string[];
}) {
  const metadata = readRecord(input.document.metadata);
  const projectSelection = readRecord(metadata.pmProjectSelection);
  const ownerTags = readStringArray(projectSelection.ownerTags);
  const supportTags = readStringArray(projectSelection.supportTags);
  const avoidTags = readStringArray(projectSelection.avoidTags);
  const documentTags = uniqueStrings([
    ...readStringArray(metadata.tags),
    ...readStringArray(metadata.requiredKnowledgeTags),
  ]).map((tag) => tag.toLowerCase());

  const normalizedKnowledgeTags = input.requestKnowledgeTags.map((tag) => tag.toLowerCase());
  const ownerTagMatches = normalizedKnowledgeTags.filter((tag) => ownerTags.map((value) => value.toLowerCase()).includes(tag));
  const supportTagMatches = normalizedKnowledgeTags.filter((tag) => supportTags.map((value) => value.toLowerCase()).includes(tag));
  const avoidTagMatches = normalizedKnowledgeTags.filter((tag) => avoidTags.map((value) => value.toLowerCase()).includes(tag));
  const genericTagMatches = normalizedKnowledgeTags.filter((tag) => documentTags.includes(tag));

  const reasons: string[] = [];
  let structuredScore = 0;
  let ambientScore = 0;

  if (ownerTagMatches.length > 0) {
    structuredScore += ownerTagMatches.length * 12;
    reasons.push(`knowledge_owner_tags:${ownerTagMatches.join(",")}`);
  }
  if (supportTagMatches.length > 0) {
    structuredScore += supportTagMatches.length * 6;
    reasons.push(`knowledge_support_tags:${supportTagMatches.join(",")}`);
  }
  if (avoidTagMatches.length > 0) {
    structuredScore -= avoidTagMatches.length * 12;
    reasons.push(`knowledge_avoid_tags:${avoidTagMatches.join(",")}`);
  }
  if (genericTagMatches.length > 0) {
    structuredScore += genericTagMatches.length * 3;
    reasons.push(`knowledge_tags:${genericTagMatches.join(",")}`);
  }

  for (const text of uniqueStrings([
    input.document.title ?? null,
    input.document.path ?? null,
    input.document.rawContent.slice(0, 1_200),
  ])) {
    const textScore = scoreTextAgainstRequest(text, input.requestLower, input.requestTokens);
    if (textScore.overlapCount > 0 && textScore.score > 0) {
      ambientScore += Math.min(6, textScore.score);
      reasons.push(`knowledge_match:${compactLine(text).slice(0, 80).toLowerCase()}`);
    }
  }

  return {
    structuredScore,
    ambientScore,
    score: structuredScore + ambientScore,
    reasons,
  };
}

function scoreProjectCandidate(
  project: PmIntakeProjectCandidate,
  requestText: string,
  issueProjectId: string | null,
  requestKnowledgeTags: string[],
  knowledgeDocuments: PmIntakeKnowledgeDocument[],
) {
  if (issueProjectId && issueProjectId === project.id) {
    return {
      score: 100,
      reasons: ["matches_issue_project"],
    };
  }

  const requestLower = requestText.toLowerCase();
  const requestTokens = new Set(tokenize(requestText));
  const reasons: string[] = [];
  let score = 0;
  let knowledgeStructuredScore = 0;
  const knowledgeAmbientSignals: Array<{ score: number; reasons: string[] }> = [];

  for (const term of buildProjectSearchTerms(project)) {
    const normalized = compactLine(term).toLowerCase();
    if (!normalized) continue;
    const termScore = scoreTextAgainstRequest(normalized, requestLower, requestTokens);
    if (requestLower.includes(normalized)) {
      score += 8;
      reasons.push(`mentions:${normalized}`);
    }
    if (termScore.overlapCount > 0) {
      score += termScore.overlapCount * 2;
      reasons.push(`token_overlap:${normalized}`);
    }
  }

  const projectKnowledgeDocuments = knowledgeDocuments.filter((document) => document.projectId === project.id);
  for (const document of projectKnowledgeDocuments) {
    const knowledgeScore = scoreKnowledgeDocumentForProject({
      document,
      requestLower,
      requestTokens,
      requestKnowledgeTags,
    });
    knowledgeStructuredScore += knowledgeScore.structuredScore;
    if (knowledgeScore.structuredScore !== 0) {
      reasons.push(...knowledgeScore.reasons.filter((reason) => !reason.startsWith("knowledge_match:")));
    }
    if (knowledgeScore.ambientScore > 0) {
      knowledgeAmbientSignals.push({
        score: knowledgeScore.ambientScore,
        reasons: knowledgeScore.reasons.filter((reason) => reason.startsWith("knowledge_match:")),
      });
    }
  }

  score += knowledgeStructuredScore;
  const ambientKnowledgeScore = knowledgeAmbientSignals
    .sort((left, right) => right.score - left.score)
    .slice(0, 3)
    .reduce((sum, signal) => sum + signal.score, 0);
  score += Math.min(12, ambientKnowledgeScore);
  reasons.push(
    ...knowledgeAmbientSignals
      .sort((left, right) => right.score - left.score)
      .slice(0, 3)
      .flatMap((signal) => signal.reasons.slice(0, 2)),
  );

  return { score, reasons };
}

function buildAgentMatchTerms(agent: PmIntakeAgent) {
  return uniqueStrings([agent.name, agent.title ?? null, agent.urlKey ?? null]);
}

function scoreAgentCandidate(agent: PmIntakeAgent, selectedProject: PmIntakeProjectCandidate | null) {
  if (!selectedProject) return 0;
  const projectTokens = new Set(tokenize(buildProjectSearchTerms(selectedProject).join(" ")));
  return buildAgentMatchTerms(agent)
    .flatMap((value) => tokenize(value))
    .filter((token) => projectTokens.has(token))
    .length;
}

function pickBestAgent(input: {
  agents: PmIntakeAgent[];
  selectedProject: PmIntakeProjectCandidate | null;
  predicate: (agent: PmIntakeAgent) => boolean;
  preferredId?: string | null;
  excludedIds?: string[];
  roleBonus?: (agent: PmIntakeAgent) => number;
  notFoundMessage: string;
  invalidPreferredMessage: string;
}) {
  const excludedIds = new Set(input.excludedIds ?? []);
  const activeAgents = input.agents
    .filter(isActiveForIntake)
    .filter((agent) => !excludedIds.has(agent.id))
    .filter(input.predicate);

  if (input.preferredId) {
    const preferred = activeAgents.find((agent) => agent.id === input.preferredId) ?? null;
    if (!preferred) {
      throw unprocessable(input.invalidPreferredMessage);
    }
    return preferred;
  }

  const ranked = [...activeAgents].sort((left, right) => {
    const leftScore = scoreAgentCandidate(left, input.selectedProject) + (input.roleBonus?.(left) ?? 0);
    const rightScore = scoreAgentCandidate(right, input.selectedProject) + (input.roleBonus?.(right) ?? 0);
    if (leftScore !== rightScore) return rightScore - leftScore;
    return sortAgents(left, right);
  });

  const selected = ranked[0] ?? null;
  if (!selected) {
    throw conflict(input.notFoundMessage);
  }
  return selected;
}

export function resolvePmIntakeAgents(input: ResolvePmIntakeAgentsInput): ResolvePmIntakeAgentsResult {
  const activeAgents = input.agents.filter(isActiveForIntake);

  const pmCandidates = activeAgents
    .filter((agent) => agent.role === "pm")
    .sort(sortAgents);

  const pmAgent = input.pmAgentId
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

  const reviewerAgent = input.reviewerAgentId
    ? activeAgents.find((agent) => agent.id === input.reviewerAgentId) ?? null
    : reviewerCandidates[0] ?? null;

  if (input.reviewerAgentId && (!reviewerAgent || !canActAsReviewer(reviewerAgent) || reviewerAgent.id === pmAgent.id)) {
    throw unprocessable("Selected reviewer agent must be an active reviewer-capable agent and different from the PM");
  }

  if (!reviewerAgent) {
    throw conflict("No active reviewer-capable agent is available for PM intake");
  }

  return { pmAgent, reviewerAgent };
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

export function buildPmIntakeProjectionPreview(
  input: BuildPmIntakeProjectionPreviewInput,
): PmIntakeProjectionPreviewResult {
  const companyProjects = input.projects.filter((project) => project.companyId === input.issue.companyId);
  const companyKnowledgeDocuments = (input.knowledgeDocuments ?? [])
    .filter((document) => document.companyId === input.issue.companyId)
    .filter((document) => document.authorityLevel === "canonical")
    .filter((document) => ["adr", "prd", "runbook", "code_summary", "symbol_summary"].includes(document.sourceType));
  if (companyProjects.length === 0) {
    throw conflict("PM intake projection preview requires at least one company project");
  }

  const selectedProjectOverride = input.request.projectId
    ? companyProjects.find((project) => project.id === input.request.projectId) ?? null
    : null;

  if (input.request.projectId && !selectedProjectOverride) {
    throw unprocessable("Selected project must belong to the same company");
  }

  const requestText = extractHumanRequest(input.issue.description) || input.issue.title;
  const requestKnowledgeTags = uniqueStrings(input.request.requiredKnowledgeTags ?? []);
  const projectCandidates = companyProjects
    .map((project) => {
      const scored = scoreProjectCandidate(
        project,
        requestText,
        input.issue.projectId,
        requestKnowledgeTags,
        companyKnowledgeDocuments,
      );
      return {
        project,
        ...scored,
      };
    })
    .sort((left, right) => {
      if (left.score !== right.score) return right.score - left.score;
      return left.project.name.localeCompare(right.project.name);
    });

  const warnings: string[] = [];
  const selectedProject =
    selectedProjectOverride
    ?? projectCandidates.find((candidate) => candidate.score > 0)?.project
    ?? companyProjects[0]
    ?? null;

  if (!selectedProjectOverride && projectCandidates[0] && projectCandidates[0].score <= 0) {
    warnings.push("project_match_low_confidence");
  }

  const techLead = pickBestAgent({
    agents: input.agents,
    selectedProject,
    predicate: canActAsTechLead,
    preferredId: input.request.techLeadAgentId ?? null,
    notFoundMessage: "No active tech lead-capable agent is available for PM intake projection",
    invalidPreferredMessage: "Selected tech lead agent must support tech_lead protocol role",
  });

  const reviewer = pickBestAgent({
    agents: input.agents,
    selectedProject,
    predicate: canActAsReviewer,
    preferredId: input.request.reviewerAgentId ?? null,
    excludedIds: [techLead.id],
    roleBonus: (agent) => (hasReviewerIdentity(agent) ? 100 : agent.role === "qa" ? 50 : 0),
    notFoundMessage: "No active reviewer-capable agent is available for PM intake projection",
    invalidPreferredMessage: "Selected reviewer agent must support reviewer protocol role",
  });

  let qaAgent: PmIntakeAgent | null = null;
  if (input.request.qaAgentId) {
    qaAgent = pickBestAgent({
      agents: input.agents,
      selectedProject,
      predicate: canActAsQa,
      preferredId: input.request.qaAgentId,
      excludedIds: [techLead.id, reviewer.id],
      notFoundMessage: "No active QA agent is available for PM intake projection",
      invalidPreferredMessage: "Selected QA agent must support qa protocol role",
    });
  } else {
    const qaCandidates = input.agents
      .filter(isActiveForIntake)
      .filter((agent) => agent.id !== techLead.id && agent.id !== reviewer.id)
      .filter(canActAsQa);
    if (qaCandidates.length > 0) {
      qaAgent = pickBestAgent({
        agents: input.agents,
        selectedProject,
        predicate: canActAsQa,
        excludedIds: [techLead.id, reviewer.id],
        notFoundMessage: "No active QA agent is available for PM intake projection",
        invalidPreferredMessage: "Selected QA agent must support qa protocol role",
      });
    }
  }

  const implementationAssignee = pickBestAgent({
    agents: input.agents,
    selectedProject,
    predicate: canActAsEngineer,
    excludedIds: [reviewer.id, ...(qaAgent ? [qaAgent.id] : [])],
    roleBonus: (agent) => (hasDedicatedEngineerIdentity(agent) ? 100 : agent.role === "engineer" ? 20 : 0),
    notFoundMessage: "No active engineer agent is available for PM intake projection",
    invalidPreferredMessage: "Selected implementation assignee must support engineer protocol role",
  });

  const structuredTitle = compactLine(input.issue.title).slice(0, 200) || "Structured intake request";
  const bulletItems = extractBulletItems(requestText);
  const executionSummary = compactLine(requestText.split(/\r?\n/)[0] ?? requestText).slice(0, 500) || structuredTitle;
  const acceptanceCriteria = (
    bulletItems.length > 0
      ? bulletItems
      : [
          `Implement the requested change inside ${selectedProject?.name ?? "the selected project"} without widening scope.`,
          "Capture focused validation evidence in protocol messages before review.",
          "Keep reviewer and QA ownership explicit through close.",
        ]
  ).slice(0, 6);
  const definitionOfDone = [
    `The ${selectedProject?.name ?? "selected"} TL lane owns the execution path.`,
    "At least one execution work item is ready for implementation with explicit reviewer and QA owners.",
    "Open risks or clarification debt stay visible in protocol history.",
  ];
  const openQuestions = warnings.includes("project_match_low_confidence")
    ? ["Confirm the intended project if the selected preview does not match the request."]
    : [];
  const documentationDebt = requestText.toLowerCase().includes("docs")
    ? ["Confirm whether documentation updates belong in the same delivery slice."]
    : [];
  const coordinationOnly = input.request.coordinationOnly ?? false;
  const workItemKind: "plan" | "implementation" =
    /\b(plan|design|scope|triage|investigate)\b/i.test(requestText)
      ? "plan"
      : "implementation";
  const workItems = [
    {
      title: structuredTitle,
      description: requestText.slice(0, 10_000),
      kind: workItemKind,
      projectId: selectedProject?.id ?? null,
      priority: input.issue.priority,
      assigneeAgentId: implementationAssignee.id,
      reviewerAgentId: reviewer.id,
      qaAgentId: qaAgent?.id ?? null,
      goal: executionSummary,
      acceptanceCriteria,
      definitionOfDone,
      watchLead: true,
      watchReviewer: true,
    },
  ];

  return {
    companyId: input.issue.companyId,
    issueId: input.issue.id,
    selectedProjectId: selectedProject?.id ?? null,
    selectedProjectName: selectedProject?.name ?? null,
    projectCandidates: projectCandidates.map((candidate) => ({
      projectId: candidate.project.id,
      projectName: candidate.project.name,
      score: candidate.score,
      selected: candidate.project.id === selectedProject?.id,
      reasons: candidate.reasons,
    })),
    staffing: {
      techLeadAgentId: techLead.id,
      techLeadName: techLead.name,
      reviewerAgentId: reviewer.id,
      reviewerName: reviewer.name,
      qaAgentId: qaAgent?.id ?? null,
      qaName: qaAgent?.name ?? null,
      implementationAssigneeAgentId: implementationAssignee.id,
      implementationAssigneeName: implementationAssignee.name,
    },
    draft: {
      reason: coordinationOnly
        ? `Structure ${structuredTitle} into coordinated child delivery for ${selectedProject?.name ?? "the selected delivery lane"} without reassigning the root lane.`
        : `Structure ${structuredTitle} into ${selectedProject?.name ?? "the selected delivery lane"} and route execution through ${techLead.name}.`,
      techLeadAgentId: techLead.id,
      reviewerAgentId: reviewer.id,
      qaAgentId: qaAgent?.id ?? null,
      coordinationOnly,
      root: {
        structuredTitle,
        projectId: selectedProject?.id ?? null,
        priority: input.issue.priority,
        executionSummary,
        acceptanceCriteria,
        definitionOfDone,
        risks: warnings.length > 0 ? ["Project match confidence is low and should be confirmed during PM review."] : [],
        openQuestions,
        documentationDebt,
      },
      workItems,
    },
    warnings,
  };
}
