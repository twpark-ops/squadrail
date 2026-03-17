import {
  KNOWLEDGE_PM_CANONICAL_SOURCE_TYPES,
  isKnowledgeSummarySourceType,
  type KnowledgeSourceType,
  type PmIntakeProjectionPreviewRequest,
  type PmIntakeProjectionPreviewResult,
} from "@squadrail/shared";
import { conflict, unprocessable } from "../errors.js";
import { isComplexIntake } from "./execution-lanes.js";

// Caps prevent document-count bias: ~3 strong matches at ~16 pts each = 48.
const KNOWLEDGE_STRUCTURED_CAP_WITH_INTENT = 48;
const KNOWLEDGE_STRUCTURED_CAP_DEFAULT = 36;
const KNOWLEDGE_AMBIENT_CAP_WITH_INTENT = 8;
const KNOWLEDGE_AMBIENT_CAP_DEFAULT = 12;

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
  description?: string | null;
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
  sourceType: KnowledgeSourceType;
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
const PM_CANONICAL_SOURCE_TYPE_SET = new Set<string>(KNOWLEDGE_PM_CANONICAL_SOURCE_TYPES);

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
  // QA agents must not fill the reviewer slot — role exclusivity enforcement.
  // QA agents belong in the qaAgentId slot only.
  if (agent.role === "qa") return false;
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

const PM_GENERIC_TOKEN_STOPWORDS = new Set([
  "change",
  "changes",
  "field",
  "fields",
  "fix",
  "issue",
  "issues",
  "metadata",
  "problem",
  "project",
  "projects",
  "request",
  "requests",
  "should",
  "user",
  "users",
  "value",
  "values",
  "verification",
  "workflow",
  "name",
]);

const PM_LEXICAL_SIGNAL_ALLOWLIST = new Set([
  "db",
  "database",
  "dicom",
  "diagnostics",
  "operator",
  "persistence",
  "persist",
  "protocol",
  "protocolname",
  "registry",
  "series",
  "seriesdescription",
  "seriesname",
  "series_name",
  "siemens",
  "storage",
  "vendor",
  "workflow",
]);

const PM_OPERATOR_FACING_PHRASES = [
  "운영자",
  "설명 가능",
  "설명할 수",
  "설명 가능하게",
  "보여줘",
  "보여 주",
  "빠르게 판단",
  "operator",
  "visibility",
  "diagnostic",
  "diagnostics",
  "explain",
  "explanation",
];

const PM_WORKFLOW_INVESTIGATION_PHRASES = [
  "workflow mismatch",
  "workflow matching",
  "match trace",
  "매칭되지",
  "매칭되지 않았",
  "조건이 안 맞",
  "study 단위",
];

const PM_COMPILER_AUTHORING_PHRASES = [
  "compiler",
  "compile",
  "compile-time",
  "validation",
  "validator",
  "dsl",
  "hcl",
  "cli",
  "lsp",
  "정책",
  "컴파일",
  "미리 막",
];

const PM_OPERATOR_SURFACE_PROJECT_TERMS = [
  "cloud",
  "operator",
  "control plane",
  "settings",
  "backend",
  "registry",
  "visibility",
  "service api",
  "temporal",
  "orchestration",
  "delivery",
];

const PM_COMPILER_PROJECT_TERMS = [
  "compiler",
  "compile time",
  "validation",
  "cli",
  "tree sitter",
  "lsp",
  "hcl",
  "dsl",
];

const PM_WORKFLOW_BOUNDARY_SUPPORT_TERMS = [
  "workflow matching",
  "match trace",
  "compiler",
];

interface PmRequestRoutingSignals {
  operatorFacingExplainability: boolean;
  workflowInvestigation: boolean;
  compilerAuthoring: boolean;
}

function normalizePmSearchText(value: string | null | undefined) {
  if (!value) return "";
  return compactLine(value)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_./:-]+/g, " ")
    .toLowerCase();
}

function collapsePmSearchText(value: string | null | undefined) {
  if (!value) return "";
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function lowerCaseText(value: string | null | undefined) {
  return typeof value === "string" ? value.toLowerCase() : "";
}

function textIncludesAny(value: string | null | undefined, phrases: string[]) {
  const source = lowerCaseText(value);
  return phrases.some((phrase) => source.includes(phrase));
}

function tokenize(value: string | null | undefined) {
  return normalizePmSearchText(value)
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function tokenizeKnowledgeTags(values: string[]) {
  return uniqueStrings(
    values.flatMap((value) =>
      tokenize(value).filter((token) => token.length >= 3 && !PM_GENERIC_TOKEN_STOPWORDS.has(token)),
    ),
  );
}

function buildPmLexicalVariants(
  value: string | null | undefined,
  options?: { allowBroadTokens?: boolean },
) {
  const source = typeof value === "string" ? value : "";
  const candidates = source.match(/\b[A-Za-z][A-Za-z0-9_./:-]{1,63}\b/g) ?? [];
  const variants: string[] = [];
  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    if (trimmed.length < 2) continue;
    const normalized = normalizePmSearchText(trimmed);
    const collapsed = collapsePmSearchText(trimmed);
    const hasCompoundSyntax = /[A-Z]|[_./:-]/.test(trimmed);
    if (
      normalized.length >= 3
      && (
        hasCompoundSyntax
        || normalized.includes(" ")
        || PM_LEXICAL_SIGNAL_ALLOWLIST.has(normalized)
      )
    ) {
      variants.push(normalized);
    }
    if (
      collapsed.length >= 3
      && collapsed.length <= 48
      && (
        hasCompoundSyntax
        || PM_LEXICAL_SIGNAL_ALLOWLIST.has(collapsed)
      )
    ) {
      variants.push(collapsed);
    }
  }

  const signalTokens = (options?.allowBroadTokens ? tokenize(source) : []).filter((token) =>
    token === "db"
    || PM_LEXICAL_SIGNAL_ALLOWLIST.has(token)
  );

  return uniqueStrings([...variants, ...signalTokens]);
}

function buildRequestLexicalTerms(requestText: string, requestKnowledgeTags: string[]) {
  return uniqueStrings([
    ...requestKnowledgeTags.flatMap((value) => buildPmLexicalVariants(value)),
    ...buildPmLexicalVariants(requestText, { allowBroadTokens: true }),
  ]).slice(0, 20);
}

function derivePmRequestRoutingSignals(requestText: string, requestKnowledgeTags: string[]): PmRequestRoutingSignals {
  const requestSource = [requestText, ...requestKnowledgeTags].join("\n");
  return {
    operatorFacingExplainability: textIncludesAny(requestSource, PM_OPERATOR_FACING_PHRASES),
    workflowInvestigation: textIncludesAny(requestSource, PM_WORKFLOW_INVESTIGATION_PHRASES),
    compilerAuthoring: textIncludesAny(requestSource, PM_COMPILER_AUTHORING_PHRASES),
  };
}

function buildRoutingLexicalTerms(signals: PmRequestRoutingSignals) {
  const terms: string[] = [];
  if (signals.operatorFacingExplainability) {
    terms.push("operator diagnostics", "settings visibility", "control plane");
  }
  if (signals.workflowInvestigation) {
    terms.push("workflow mismatch", "workflow matching", "match trace");
  }
  if (signals.compilerAuthoring) {
    terms.push("workflow compiler", "compile time", "validation");
  }
  return uniqueStrings(terms);
}

function scoreLexicalSignalsAgainstTexts(input: {
  texts: Array<string | null | undefined>;
  requestLexicalTerms: string[];
  matchCap: number;
}) {
  if (input.requestLexicalTerms.length === 0) {
    return {
      score: 0,
      matches: [] as string[],
    };
  }

  const targets = input.texts
    .map((text) => ({
      normalized: normalizePmSearchText(text),
      collapsed: collapsePmSearchText(text),
    }))
    .filter((target) => target.normalized.length > 0 || target.collapsed.length > 0);
  const matchedTerms = uniqueStrings(
    input.requestLexicalTerms.filter((term) => {
      const normalizedTerm = normalizePmSearchText(term);
      const collapsedTerm = collapsePmSearchText(term);
      if (!normalizedTerm && !collapsedTerm) return false;
      return targets.some((target) => (
        (normalizedTerm.length > 0 && target.normalized.includes(normalizedTerm))
        || (collapsedTerm.length > 0 && target.collapsed.includes(collapsedTerm))
      ));
    }),
  );
  const score = matchedTerms.reduce((sum, term) => {
    if (term === "db") return sum + 3;
    if (term === "workflow") return sum + 1;
    if (term.includes(" ")) return sum + 7;
    if (term.length >= 12) return sum + 6;
    if (term.length >= 8) return sum + 5;
    if (term.length >= 6) return sum + 4;
    return sum + 2;
  }, 0);

  return {
    score: Math.min(input.matchCap, score),
    matches: matchedTerms,
  };
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

function isAmbientWorkflowContextTag(value: string) {
  return value === "dicom" || value === "dicom-metadata";
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

function buildProjectContextTexts(project: PmIntakeProjectCandidate) {
  return uniqueStrings([
    project.description ?? null,
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
  requestLexicalTerms: string[];
  requestRoutingSignals: PmRequestRoutingSignals;
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
  const knowledgeTagTokens = tokenizeKnowledgeTags(normalizedKnowledgeTags);
  const ownerTagSet = new Set(uniqueStrings([
    ...ownerTags.map((value) => value.toLowerCase()),
    ...tokenizeKnowledgeTags(ownerTags),
  ]));
  const supportTagSet = new Set(uniqueStrings([
    ...supportTags.map((value) => value.toLowerCase()),
    ...tokenizeKnowledgeTags(supportTags),
  ]));
  const avoidTagSet = new Set(uniqueStrings([
    ...avoidTags.map((value) => value.toLowerCase()),
    ...tokenizeKnowledgeTags(avoidTags),
  ]));
  const documentTagSet = new Set(uniqueStrings([
    ...documentTags,
    ...tokenizeKnowledgeTags(documentTags),
  ]));
  const ownerTagMatches = uniqueStrings([
    ...normalizedKnowledgeTags.filter((tag) => ownerTagSet.has(tag)),
    ...knowledgeTagTokens.filter((tag) => ownerTagSet.has(tag)),
  ]);
  const supportTagMatches = uniqueStrings([
    ...normalizedKnowledgeTags.filter((tag) => supportTagSet.has(tag)),
    ...knowledgeTagTokens.filter((tag) => supportTagSet.has(tag)),
  ]);
  const avoidTagMatches = uniqueStrings([
    ...normalizedKnowledgeTags.filter((tag) => avoidTagSet.has(tag)),
    ...knowledgeTagTokens.filter((tag) => avoidTagSet.has(tag)),
  ]);
  const genericTagMatches = uniqueStrings([
    ...normalizedKnowledgeTags.filter((tag) => documentTagSet.has(tag)),
    ...knowledgeTagTokens.filter((tag) => documentTagSet.has(tag)),
  ]);
  const summarySource = isKnowledgeSummarySourceType(input.document.sourceType);
  const workflowMismatchOperatorSurface =
    input.requestRoutingSignals.operatorFacingExplainability
    && input.requestRoutingSignals.workflowInvestigation
    && !input.requestRoutingSignals.compilerAuthoring;

  const focusedOwnerTagMatches = workflowMismatchOperatorSurface
    ? ownerTagMatches.filter((tag) => !isAmbientWorkflowContextTag(tag))
    : ownerTagMatches;
  const ambientOwnerTagMatches = workflowMismatchOperatorSurface
    ? ownerTagMatches.filter(isAmbientWorkflowContextTag)
    : [];
  const focusedSupportTagMatches = workflowMismatchOperatorSurface
    ? supportTagMatches.filter((tag) => !isAmbientWorkflowContextTag(tag))
    : supportTagMatches;
  const ambientSupportTagMatches = workflowMismatchOperatorSurface
    ? supportTagMatches.filter(isAmbientWorkflowContextTag)
    : [];
  const focusedGenericTagMatches = workflowMismatchOperatorSurface
    ? genericTagMatches.filter((tag) => !isAmbientWorkflowContextTag(tag))
    : genericTagMatches;
  const ambientGenericTagMatches = workflowMismatchOperatorSurface
    ? genericTagMatches.filter(isAmbientWorkflowContextTag)
    : [];

  const ownerTagWeight = summarySource ? 14 : 12;
  const supportTagWeight = summarySource ? 7 : 6;
  const avoidTagWeight = summarySource ? 14 : 12;
  const genericTagWeight = summarySource ? 5 : input.document.sourceType === "runbook" ? 2 : 3;
  const ownerTokenWeight = summarySource ? 5 : 4;
  const supportTokenWeight = summarySource ? 3 : 2;
  const avoidTokenWeight = summarySource ? 5 : 4;
  const genericTokenWeight = summarySource ? 2 : input.document.sourceType === "runbook" ? 1 : 1;
  const ambientTextCap = summarySource ? 8 : input.document.sourceType === "runbook" ? 3 : 6;
  const ambientMultiplier = summarySource ? 1.35 : input.document.sourceType === "runbook" ? 0.55 : 1;
  const structuredScoreCap = summarySource ? 28 : 22;

  const reasons: string[] = [];
  let structuredScore = 0;
  let ambientScore = 0;

  const ownerTagMatchSet = new Set(ownerTagMatches);
  const supportTagMatchSet = new Set(supportTagMatches);
  const avoidTagMatchSet = new Set(avoidTagMatches);
  const genericTagMatchSet = new Set(genericTagMatches);
  const ownerTokenMatches = knowledgeTagTokens.filter((tag) => ownerTagSet.has(tag) && !ownerTagMatchSet.has(tag));
  const supportTokenMatches = knowledgeTagTokens.filter((tag) => supportTagSet.has(tag) && !supportTagMatchSet.has(tag));
  const avoidTokenMatches = knowledgeTagTokens.filter((tag) => avoidTagSet.has(tag) && !avoidTagMatchSet.has(tag));
  const genericTokenMatches = knowledgeTagTokens.filter((tag) => documentTagSet.has(tag) && !genericTagMatchSet.has(tag));
  const focusedOwnerTokenMatches = workflowMismatchOperatorSurface
    ? ownerTokenMatches.filter((tag) => !isAmbientWorkflowContextTag(tag))
    : ownerTokenMatches;
  const ambientOwnerTokenMatches = workflowMismatchOperatorSurface
    ? ownerTokenMatches.filter(isAmbientWorkflowContextTag)
    : [];
  const focusedSupportTokenMatches = workflowMismatchOperatorSurface
    ? supportTokenMatches.filter((tag) => !isAmbientWorkflowContextTag(tag))
    : supportTokenMatches;
  const ambientSupportTokenMatches = workflowMismatchOperatorSurface
    ? supportTokenMatches.filter(isAmbientWorkflowContextTag)
    : [];
  const focusedGenericTokenMatches = workflowMismatchOperatorSurface
    ? genericTokenMatches.filter((tag) => !isAmbientWorkflowContextTag(tag))
    : genericTokenMatches;
  const ambientGenericTokenMatches = workflowMismatchOperatorSurface
    ? genericTokenMatches.filter(isAmbientWorkflowContextTag)
    : [];

  if (focusedOwnerTagMatches.length > 0) {
    structuredScore += focusedOwnerTagMatches.length * ownerTagWeight;
    reasons.push(`knowledge_owner_tags:${focusedOwnerTagMatches.join(",")}`);
  }
  if (ambientOwnerTagMatches.length > 0) {
    structuredScore += ambientOwnerTagMatches.length;
    reasons.push(`knowledge_context_tags:${ambientOwnerTagMatches.join(",")}`);
  }
  if (focusedOwnerTokenMatches.length > 0) {
    structuredScore += focusedOwnerTokenMatches.length * ownerTokenWeight;
    reasons.push(`knowledge_owner_tag_tokens:${uniqueStrings(focusedOwnerTokenMatches).join(",")}`);
  }
  if (ambientOwnerTokenMatches.length > 0) {
    structuredScore += ambientOwnerTokenMatches.length;
    reasons.push(`knowledge_context_tag_tokens:${uniqueStrings(ambientOwnerTokenMatches).join(",")}`);
  }
  if (focusedSupportTagMatches.length > 0) {
    structuredScore += focusedSupportTagMatches.length * supportTagWeight;
    reasons.push(`knowledge_support_tags:${focusedSupportTagMatches.join(",")}`);
  }
  if (ambientSupportTagMatches.length > 0) {
    structuredScore += ambientSupportTagMatches.length;
    reasons.push(`knowledge_context_support_tags:${ambientSupportTagMatches.join(",")}`);
  }
  if (focusedSupportTokenMatches.length > 0) {
    structuredScore += focusedSupportTokenMatches.length * supportTokenWeight;
    reasons.push(`knowledge_support_tag_tokens:${uniqueStrings(focusedSupportTokenMatches).join(",")}`);
  }
  if (ambientSupportTokenMatches.length > 0) {
    structuredScore += ambientSupportTokenMatches.length;
    reasons.push(`knowledge_context_support_tag_tokens:${uniqueStrings(ambientSupportTokenMatches).join(",")}`);
  }
  if (avoidTagMatches.length > 0) {
    structuredScore -= avoidTagMatches.length * avoidTagWeight;
    reasons.push(`knowledge_avoid_tags:${avoidTagMatches.join(",")}`);
  }
  if (avoidTokenMatches.length > 0) {
    structuredScore -= avoidTokenMatches.length * avoidTokenWeight;
    reasons.push(`knowledge_avoid_tag_tokens:${uniqueStrings(avoidTokenMatches).join(",")}`);
  }
  if (focusedGenericTagMatches.length > 0) {
    structuredScore += focusedGenericTagMatches.length * genericTagWeight;
    reasons.push(`knowledge_tags:${focusedGenericTagMatches.join(",")}`);
  }
  if (ambientGenericTagMatches.length > 0) {
    structuredScore += ambientGenericTagMatches.length;
    reasons.push(`knowledge_context_generic_tags:${ambientGenericTagMatches.join(",")}`);
  }
  if (focusedGenericTokenMatches.length > 0) {
    structuredScore += focusedGenericTokenMatches.length * genericTokenWeight;
    reasons.push(`knowledge_tag_tokens:${uniqueStrings(focusedGenericTokenMatches).join(",")}`);
  }
  if (ambientGenericTokenMatches.length > 0) {
    structuredScore += ambientGenericTokenMatches.length;
    reasons.push(`knowledge_context_generic_tag_tokens:${uniqueStrings(ambientGenericTokenMatches).join(",")}`);
  }

  const lexicalMatch = scoreLexicalSignalsAgainstTexts({
    texts: [
      input.document.path ?? null,
      input.document.title ?? null,
      input.document.rawContent.slice(0, 1_800),
    ],
    requestLexicalTerms: input.requestLexicalTerms,
    matchCap: summarySource ? 20 : 14,
  });
  if (lexicalMatch.matches.length > 0) {
    structuredScore += lexicalMatch.score;
    reasons.push(`knowledge_lexical_terms:${lexicalMatch.matches.join(",")}`);
  }
  structuredScore = Math.min(structuredScoreCap, structuredScore);

  for (const text of uniqueStrings([
    input.document.title ?? null,
    input.document.path ?? null,
    input.document.rawContent.slice(0, 1_200),
  ])) {
    const textScore = scoreTextAgainstRequest(text, input.requestLower, input.requestTokens);
    if (textScore.overlapCount > 0 && textScore.score > 0) {
      ambientScore += Math.min(ambientTextCap, textScore.score * ambientMultiplier);
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
  requestRoutingSignals: PmRequestRoutingSignals,
) {
  if (issueProjectId && issueProjectId === project.id) {
    return {
      score: 100,
      reasons: ["matches_issue_project"],
    };
  }

  const requestLower = requestText.toLowerCase();
  const requestTokens = new Set(tokenize(requestText));
  const knowledgeTagTokens = tokenizeKnowledgeTags(requestKnowledgeTags);
  const requestLexicalTerms = uniqueStrings([
    ...buildRequestLexicalTerms(requestText, requestKnowledgeTags),
    ...buildRoutingLexicalTerms(requestRoutingSignals),
  ]);
  const reasons: string[] = [];
  const hasKnowledgeIntent = requestKnowledgeTags.length > 0;
  let score = 0;
  let knowledgeStructuredScore = 0;
  const structuredReasonPool: string[] = [];
  const knowledgeAmbientSignals: Array<{ score: number; reasons: string[] }> = [];

  for (const term of buildProjectSearchTerms(project)) {
    const normalized = compactLine(term).toLowerCase();
    if (!normalized) continue;
    const termScore = scoreTextAgainstRequest(normalized, requestLower, requestTokens);
    if (requestLower.includes(normalized)) {
      score += hasKnowledgeIntent ? 6 : 8;
      reasons.push(`mentions:${normalized}`);
    }
    if (termScore.overlapCount > 0) {
      score += termScore.overlapCount * (hasKnowledgeIntent ? 1 : 2);
      reasons.push(`token_overlap:${normalized}`);
    }
  }

  for (const contextText of buildProjectContextTexts(project)) {
    const contextScore = scoreTextAgainstRequest(contextText, requestLower, requestTokens);
    if (contextScore.overlapCount > 0 && contextScore.score > 0) {
      score += Math.min(hasKnowledgeIntent ? 3 : 5, contextScore.score);
      reasons.push(`project_context:${compactLine(contextText).slice(0, 80).toLowerCase()}`);
    }
  }

  const projectLexicalScore = scoreLexicalSignalsAgainstTexts({
    texts: [
      project.name,
      project.urlKey ?? null,
      ...buildProjectContextTexts(project),
    ],
    requestLexicalTerms,
    matchCap: hasKnowledgeIntent ? 8 : 10,
  });
  if (projectLexicalScore.matches.length > 0) {
    score += projectLexicalScore.score;
    reasons.push(`project_lexical_terms:${projectLexicalScore.matches.join(",")}`);
  }

  if (requestRoutingSignals.operatorFacingExplainability) {
    const operatorSurfaceScore = scoreLexicalSignalsAgainstTexts({
      texts: [
        project.name,
        project.urlKey ?? null,
        ...buildProjectContextTexts(project),
      ],
      requestLexicalTerms: PM_OPERATOR_SURFACE_PROJECT_TERMS,
      matchCap: requestRoutingSignals.workflowInvestigation ? 28 : 20,
    });
    if (operatorSurfaceScore.matches.length > 0) {
      score += operatorSurfaceScore.score;
      reasons.push(`operator_surface_terms:${operatorSurfaceScore.matches.join(",")}`);
    }

    if (!requestRoutingSignals.compilerAuthoring) {
      const compilerSurfaceScore = scoreLexicalSignalsAgainstTexts({
        texts: [
          project.name,
          project.urlKey ?? null,
          ...buildProjectContextTexts(project),
        ],
        requestLexicalTerms: PM_COMPILER_PROJECT_TERMS,
        matchCap: requestRoutingSignals.workflowInvestigation ? 18 : 12,
      });
      if (compilerSurfaceScore.matches.length > 0) {
        score -= compilerSurfaceScore.score;
        reasons.push(`operator_surface_avoids_compiler:${compilerSurfaceScore.matches.join(",")}`);
      }
    }
  }

  if (requestRoutingSignals.compilerAuthoring) {
    const compilerSurfaceScore = scoreLexicalSignalsAgainstTexts({
      texts: [
        project.name,
        project.urlKey ?? null,
        ...buildProjectContextTexts(project),
      ],
      requestLexicalTerms: PM_COMPILER_PROJECT_TERMS,
      matchCap: 16,
    });
    if (compilerSurfaceScore.matches.length > 0) {
      score += compilerSurfaceScore.score;
      reasons.push(`compiler_surface_terms:${compilerSurfaceScore.matches.join(",")}`);
    }
  }

  if (requestRoutingSignals.workflowInvestigation) {
    const workflowBoundaryScore = scoreLexicalSignalsAgainstTexts({
      texts: [
        project.name,
        project.urlKey ?? null,
        ...buildProjectContextTexts(project),
      ],
      requestLexicalTerms: PM_WORKFLOW_BOUNDARY_SUPPORT_TERMS,
      matchCap: requestRoutingSignals.operatorFacingExplainability ? 12 : 16,
    });
    if (workflowBoundaryScore.matches.length > 0) {
      score += workflowBoundaryScore.score;
      reasons.push(`workflow_boundary_terms:${workflowBoundaryScore.matches.join(",")}`);
    }
  }

  if (hasKnowledgeIntent && knowledgeTagTokens.length > 0) {
    const projectKnowledgeContext = uniqueStrings([
      project.name,
      project.urlKey ?? null,
      ...buildProjectContextTexts(project),
    ]).join(" ");
    const projectKnowledgeTokens = new Set(tokenize(projectKnowledgeContext));
    const projectKnowledgeMatches = knowledgeTagTokens.filter((token) => projectKnowledgeTokens.has(token));
    if (projectKnowledgeMatches.length > 0) {
      score += Math.min(8, projectKnowledgeMatches.length * 2);
      reasons.push(`project_knowledge_tags:${projectKnowledgeMatches.join(",")}`);
    }
  }

  const projectKnowledgeDocuments = knowledgeDocuments.filter((document) => document.projectId === project.id);
  for (const document of projectKnowledgeDocuments) {
    const knowledgeScore = scoreKnowledgeDocumentForProject({
      document,
      requestLower,
      requestTokens,
      requestKnowledgeTags,
      requestLexicalTerms,
      requestRoutingSignals,
    });
    knowledgeStructuredScore += knowledgeScore.structuredScore;
    if (knowledgeScore.structuredScore !== 0) {
      structuredReasonPool.push(...knowledgeScore.reasons.filter((reason) => !reason.startsWith("knowledge_match:")));
    }
    if (knowledgeScore.ambientScore > 0) {
      knowledgeAmbientSignals.push({
        score: knowledgeScore.ambientScore,
        reasons: knowledgeScore.reasons.filter((reason) => reason.startsWith("knowledge_match:")),
      });
    }
  }

  const knowledgeStructuredCap = hasKnowledgeIntent ? KNOWLEDGE_STRUCTURED_CAP_WITH_INTENT : KNOWLEDGE_STRUCTURED_CAP_DEFAULT;
  score += Math.min(knowledgeStructuredCap, knowledgeStructuredScore);
  const ambientKnowledgeCap = hasKnowledgeIntent ? KNOWLEDGE_AMBIENT_CAP_WITH_INTENT : KNOWLEDGE_AMBIENT_CAP_DEFAULT;
  const ambientKnowledgeScore = knowledgeAmbientSignals
    .sort((left, right) => right.score - left.score)
    .slice(0, 3)
    .reduce((sum, signal) => sum + signal.score, 0);
  score += Math.min(ambientKnowledgeCap, ambientKnowledgeScore);
  reasons.push(...uniqueStrings(structuredReasonPool).slice(0, 12));
  reasons.push(
    ...uniqueStrings(
      knowledgeAmbientSignals
        .sort((left, right) => right.score - left.score)
        .slice(0, 3)
        .flatMap((signal) => signal.reasons.slice(0, 2)),
    ).slice(0, 6),
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
    .filter((document) => PM_CANONICAL_SOURCE_TYPE_SET.has(document.sourceType));
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
  const requestRoutingSignals = derivePmRequestRoutingSignals(requestText, requestKnowledgeTags);
  const projectCandidates = companyProjects
    .map((project) => {
      const scored = scoreProjectCandidate(
        project,
        requestText,
        input.issue.projectId,
        requestKnowledgeTags,
        companyKnowledgeDocuments,
        requestRoutingSignals,
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
    roleBonus: (agent) => (hasReviewerIdentity(agent) ? 100 : 0),
    notFoundMessage: "No active reviewer-capable agent is available for PM intake projection",
    invalidPreferredMessage: "Selected reviewer agent must support reviewer protocol role",
  });

  // Complexity scoring: only assign QA for complex issues (full lane).
  // Simple issues skip the QA gate entirely (fast lane).
  const complexIssue = isComplexIntake({
    explicitQaRequested: Boolean(input.request.qaAgentId),
    coordinationOnly: Boolean(input.request.coordinationOnly),
    crossProjectCount: projectCandidates.filter((c) => c.score > 0).length,
    priority: input.issue.priority,
    requiredKnowledgeTagCount: (input.request.requiredKnowledgeTags ?? []).length,
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
  } else if (complexIssue) {
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
  // When !complexIssue and no explicit qaAgentId: qaAgent stays null -> fast lane (no QA gate).

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
