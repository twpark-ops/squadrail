import path from "node:path";
import {
  KNOWLEDGE_CODE_PATH_SOURCE_TYPES,
  KNOWLEDGE_CODE_REUSE_SOURCE_TYPES,
  KNOWLEDGE_PM_CANONICAL_SOURCE_TYPES,
  KNOWLEDGE_SUMMARY_SOURCE_TYPES,
  type CreateIssueProtocolMessage,
} from "@squadrail/shared";
import type { RetrievalSignals } from "../issue-retrieval.js";
import {
  basenameWithoutExtension,
  extractIssueIdentifiers,
  isIssueIdentifier,
  normalizeIssueIdentifier,
  normalizeHintPath,
  truncateRetrievalSegment,
  uniqueNonEmpty,
} from "./shared.js";

export const RETRIEVAL_EVENT_BY_MESSAGE_TYPE = {
  ASSIGN_TASK: "on_assignment",
  REASSIGN_TASK: "on_assignment",
  ACK_ASSIGNMENT: "on_acceptance",
  START_IMPLEMENTATION: "on_progress_report",
  ASK_CLARIFICATION: "on_progress_report",
  ANSWER_CLARIFICATION: "on_progress_report",
  PROPOSE_PLAN: "on_plan_requested",
  REPORT_PROGRESS: "on_progress_report",
  ESCALATE_BLOCKER: "on_blocker",
  SUBMIT_FOR_REVIEW: "on_review_submit",
  START_REVIEW: "on_review_start",
  REQUEST_CHANGES: "on_change_request",
  APPROVE_IMPLEMENTATION: "on_approval",
  CLOSE_TASK: "on_close",
} as const satisfies Partial<Record<CreateIssueProtocolMessage["messageType"], string>>;

export type RetrievalEventType =
  (typeof RETRIEVAL_EVENT_BY_MESSAGE_TYPE)[keyof typeof RETRIEVAL_EVENT_BY_MESSAGE_TYPE];

export type RetrievalTargetRole =
  | "engineer"
  | "reviewer"
  | "tech_lead"
  | "cto"
  | "pm"
  | "qa"
  | "human_board";

export type RetrievalBriefScope =
  | "global"
  | "engineer"
  | "reviewer"
  | "tech_lead"
  | "cto"
  | "pm"
  | "qa"
  | "closure";

function readStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return uniqueNonEmpty(
    value.filter((entry): entry is string => typeof entry === "string"),
  );
}

function readPositiveIntArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(
    value.filter((entry): entry is number => Number.isInteger(entry) && entry > 0),
  ));
}

const RETRIEVAL_LEXICAL_STOPWORDS = new Set([
  "agent",
  "agents",
  "assign",
  "assigned",
  "assignment",
  "change",
  "changes",
  "changed",
  "check",
  "checks",
  "cloud",
  "company",
  "completed",
  "current",
  "data",
  "description",
  "details",
  "engineer",
  "expected",
  "field",
  "fields",
  "find",
  "fix",
  "fixed",
  "instead",
  "issue",
  "issues",
  "message",
  "metadata",
  "pipeline",
  "problem",
  "protocol",
  "request",
  "requested",
  "requests",
  "review",
  "reviewer",
  "route",
  "routing",
  "save",
  "saved",
  "saving",
  "should",
  "state",
  "status",
  "persists",
  "stores",
  "stored",
  "summary",
  "support",
  "swiftsight",
  "task",
  "tasks",
  "team",
  "update",
  "using",
  "value",
  "values",
  "why",
  "workflow",
]);

function splitKnowledgeTagTokens(values: string[]) {
  return uniqueNonEmpty(values.flatMap((value) =>
    value
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/[_./:-]+/g, " ")
      .split(/[^a-zA-Z0-9]+/)
      .map((token) => token.trim().toLowerCase())
      .filter((token) => token.length >= 3 && token.length <= 32),
  ));
}

function buildLexicalTermVariants(value: string) {
  const candidates = value.match(/\b[A-Za-z][A-Za-z0-9_./:-]{2,63}\b/g) ?? [];
  const variants: string[] = [];
  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    if (trimmed.length < 3) continue;
    const hadCompoundSyntax = /[A-Z]|[_./:-]/.test(trimmed);
    const spaced = trimmed
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/[_./:-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    const collapsed = trimmed.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
    if (spaced.length >= 3) variants.push(spaced);
    if (
      hadCompoundSyntax
      && collapsed.length >= 3
      && collapsed.length <= 48
    ) {
      variants.push(collapsed);
    } else if (
      collapsed.length >= 3
      && collapsed.length <= 48
      && collapsed !== spaced.replace(/\s+/g, "")
    ) {
      variants.push(collapsed);
    }
    variants.push(
      ...spaced
        .split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 3 && token.length <= 32),
    );
  }
  return uniqueNonEmpty(variants);
}

function buildLexicalRetrievalTerms(values: string[]) {
  return uniqueNonEmpty(values.flatMap((value) => buildLexicalTermVariants(value)))
    .filter((term) => {
      const tokens = term.split(/\s+/).filter((token) => token.length > 0);
      if (tokens.length === 0) return false;
      if (tokens.every((token) => RETRIEVAL_LEXICAL_STOPWORDS.has(token))) return false;
      if (tokens.length === 1 && RETRIEVAL_LEXICAL_STOPWORDS.has(tokens[0] ?? "")) return false;
      return true;
    })
    .slice(0, 24);
}

function splitRelatedIssueRefs(values: string[]) {
  const issueIds: string[] = [];
  const issueIdentifiers: string[] = [];
  for (const value of values) {
    if (isIssueIdentifier(value)) {
      issueIdentifiers.push(normalizeIssueIdentifier(value));
      continue;
    }
    issueIds.push(value);
  }
  return {
    issueIds: uniqueNonEmpty(issueIds),
    issueIdentifiers: uniqueNonEmpty(issueIdentifiers),
  };
}

function extractPathHintsFromTextValues(values: Array<string | null | undefined>) {
  const pathPattern = /\b(?:[A-Za-z0-9_.-]+\/)+(?:[A-Za-z0-9_.-]+\.[A-Za-z0-9]+)\b/g;
  const results: string[] = [];
  for (const value of values) {
    if (typeof value !== "string" || value.trim().length === 0) continue;
    const matches = value.match(pathPattern) ?? [];
    for (const match of matches) {
      results.push(normalizeHintPath(match));
    }
  }
  return uniqueNonEmpty(results);
}

function extractIdentifierHints(values: string[]) {
  const identifiers: string[] = [];
  for (const value of values) {
    const matches = value.match(/\b[A-Za-z_][A-Za-z0-9_]{2,}\b/g) ?? [];
    for (const match of matches) {
      if (!/[A-Z_]/.test(match) && match === match.toLowerCase()) continue;
      identifiers.push(match);
    }
  }
  return uniqueNonEmpty(identifiers);
}

type EvidenceCitationSignals = {
  retrievalRunId: string;
  briefId: string | null;
  citedHitRanks: number[];
  citedPaths: string[];
  citedSourceTypes: string[];
  citedSummaryKinds: string[];
  citationReason: string | null;
};

function readEvidenceCitations(payload: Record<string, unknown>): EvidenceCitationSignals[] {
  const raw = payload.evidenceCitations;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const candidate = entry as Record<string, unknown>;
    const retrievalRunId = typeof candidate.retrievalRunId === "string"
      ? candidate.retrievalRunId.trim()
      : "";
    if (retrievalRunId.length === 0) return [];
    const briefId = typeof candidate.briefId === "string" && candidate.briefId.trim().length > 0
      ? candidate.briefId.trim()
      : null;
    const citationReason = typeof candidate.citationReason === "string" && candidate.citationReason.trim().length > 0
      ? candidate.citationReason.trim()
      : null;
    return [{
      retrievalRunId,
      briefId,
      citedHitRanks: readPositiveIntArray(candidate.citedHitRanks),
      citedPaths: readStringArray(candidate.citedPaths).map(normalizeHintPath),
      citedSourceTypes: readStringArray(candidate.citedSourceTypes),
      citedSummaryKinds: readStringArray(candidate.citedSummaryKinds),
      citationReason,
    }];
  });
}

function buildEvidenceCitationTerms(citations: EvidenceCitationSignals[]) {
  return uniqueNonEmpty(citations.flatMap((citation) => [
    ...citation.citedPaths,
    ...citation.citedSourceTypes,
    ...citation.citedSummaryKinds.map((kind) => `${kind} summary`),
    ...(citation.citationReason ? [citation.citationReason] : []),
  ]));
}

function extractPayloadTerms(message: CreateIssueProtocolMessage) {
  const payload = message.payload as Record<string, unknown>;
  const citationTerms = buildEvidenceCitationTerms(readEvidenceCitations(payload));
  const withCitationTerms = (terms: string[]) => uniqueNonEmpty([...terms, ...citationTerms]);

  switch (message.messageType) {
    case "ASSIGN_TASK":
      return withCitationTerms([
        String(payload.goal ?? ""),
        ...readStringArray(payload.relatedIssueIdentifiers),
        ...readStringArray(payload.acceptanceCriteria),
        ...readStringArray(payload.definitionOfDone),
        ...readStringArray(payload.requiredKnowledgeTags),
      ]);
    case "ACK_ASSIGNMENT":
      return withCitationTerms([
        String(payload.understoodScope ?? ""),
        ...readStringArray(payload.initialRisks),
      ]);
    case "ASK_CLARIFICATION":
      return withCitationTerms([
        String(payload.question ?? ""),
        ...readStringArray(payload.proposedAssumptions),
      ]);
    case "ANSWER_CLARIFICATION":
      return withCitationTerms([
        String(payload.answer ?? ""),
        String(payload.nextStep ?? ""),
      ]);
    case "PROPOSE_PLAN":
      return withCitationTerms([
        String(payload.planSummary ?? ""),
        ...readStringArray(payload.relatedIssueIdentifiers),
        ...(((payload.steps as Array<Record<string, unknown>> | undefined) ?? []).map((step) => String(step.title ?? ""))),
        ...readStringArray(payload.risks),
      ]);
    case "REPORT_PROGRESS":
      return withCitationTerms([
        ...readStringArray(payload.completedItems),
        ...readStringArray(payload.nextSteps),
        ...readStringArray(payload.changedFiles),
        ...readStringArray(payload.relatedIssueIdentifiers),
        String(payload.testSummary ?? ""),
      ]);
    case "ESCALATE_BLOCKER":
      return withCitationTerms([
        String(payload.blockerCode ?? ""),
        String(payload.blockingReason ?? ""),
        String(payload.requestedAction ?? ""),
        ...readStringArray(payload.relatedIssueIdentifiers),
      ]);
    case "SUBMIT_FOR_REVIEW":
      return withCitationTerms([
        String(payload.implementationSummary ?? ""),
        ...readStringArray(payload.reviewChecklist),
        ...readStringArray(payload.changedFiles),
        ...readStringArray(payload.testResults),
        ...readStringArray(payload.residualRisks),
        ...readStringArray(payload.relatedIssueIdentifiers),
        String(payload.diffSummary ?? ""),
      ]);
    case "START_REVIEW":
      return withCitationTerms(readStringArray(payload.reviewFocus));
    case "REQUEST_CHANGES":
      return withCitationTerms([
        String(payload.reviewSummary ?? ""),
        ...readStringArray(payload.relatedIssueIdentifiers),
        ...readStringArray(payload.requiredEvidence),
        ...(((payload.changeRequests as Array<Record<string, unknown>> | undefined) ?? []).flatMap((request) => [
          String(request.title ?? ""),
          String(request.reason ?? ""),
          ...readStringArray(request.affectedFiles),
          String(request.suggestedAction ?? ""),
        ])),
      ]);
    case "APPROVE_IMPLEMENTATION":
      return withCitationTerms([
        String(payload.approvalSummary ?? ""),
        ...readStringArray(payload.approvalChecklist),
        ...readStringArray(payload.verifiedEvidence),
        ...readStringArray(payload.residualRisks),
        ...readStringArray(payload.followUpActions),
        ...readStringArray(payload.relatedIssueIdentifiers),
      ]);
    case "CLOSE_TASK":
      return withCitationTerms([
        String(payload.closeReason ?? ""),
        String(payload.closureSummary ?? ""),
        String(payload.verificationSummary ?? ""),
        String(payload.rollbackPlan ?? ""),
        ...readStringArray(payload.finalArtifacts),
        ...readStringArray(payload.remainingRisks),
        ...readStringArray(payload.relatedIssueIdentifiers),
      ]);
    default:
      return citationTerms;
  }
}

function readRelatedIssueRefs(payload: Record<string, unknown>) {
  return splitRelatedIssueRefs(uniqueNonEmpty([
    ...readStringArray(payload.relatedIssueIds),
    ...readStringArray(payload.linkedIssueIds),
    ...readStringArray(payload.followUpIssueIds),
    ...readStringArray(payload.relatedIssueIdentifiers),
  ]));
}

export function deriveRetrievalEventType(messageType: CreateIssueProtocolMessage["messageType"]) {
  if (!(messageType in RETRIEVAL_EVENT_BY_MESSAGE_TYPE)) return null;
  return RETRIEVAL_EVENT_BY_MESSAGE_TYPE[messageType as keyof typeof RETRIEVAL_EVENT_BY_MESSAGE_TYPE];
}

export function deriveBriefScope(input: {
  eventType: RetrievalEventType;
  recipientRole: string;
}): RetrievalBriefScope {
  if (input.eventType === "on_close") return "closure";
  if (input.recipientRole === "reviewer") return "reviewer";
  if (input.recipientRole === "tech_lead") return "tech_lead";
  if (input.recipientRole === "cto") return "cto";
  if (input.recipientRole === "pm") return "pm";
  if (input.recipientRole === "qa") return "qa";
  if (input.recipientRole === "human_board") return "global";
  return "engineer";
}

export function selectProtocolRetrievalRecipients(input: {
  messageType: string;
  recipients: Array<{
    recipientType: string;
    recipientId: string;
    role: string;
  }>;
}) {
  const shouldInclude = (recipientRole: string) => {
    if (input.messageType === "ASSIGN_TASK" || input.messageType === "REASSIGN_TASK") {
      return (
        recipientRole === "engineer"
        || recipientRole === "tech_lead"
        || recipientRole === "pm"
        || recipientRole === "cto"
        || recipientRole === "qa"
      );
    }

    return (
      recipientRole === "engineer"
      || recipientRole === "reviewer"
      || recipientRole === "tech_lead"
      || recipientRole === "pm"
      || recipientRole === "cto"
      || recipientRole === "qa"
      || recipientRole === "human_board"
    );
  };

  return input.recipients.filter(
    (recipient, index, all) =>
      shouldInclude(recipient.role)
      && all.findIndex(
        (candidate) =>
          candidate.recipientId === recipient.recipientId
          && candidate.role === recipient.role
          && candidate.recipientType === recipient.recipientType,
      ) === index,
  );
}

export function buildRetrievalQueryText(input: {
  issue: {
    title: string;
    description: string | null;
    identifier: string | null;
    labels?: Array<{ name: string }>;
    mentionedProjects?: Array<{ id: string; name: string }>;
  };
  message: CreateIssueProtocolMessage;
  recipientRole: string;
}) {
  const payloadTerms = extractPayloadTerms(input.message);
  const currentIssueIdentifier = input.issue.identifier ? normalizeIssueIdentifier(input.issue.identifier) : null;
  const relatedIssueIdentifiers = extractIssueIdentifiers([
    input.issue.title,
    input.issue.description,
    input.message.summary,
    ...((input.issue.labels ?? []).map((label) => label.name)),
    ...payloadTerms,
  ]).filter((identifier) => identifier !== currentIssueIdentifier);
  const querySegments = uniqueNonEmpty([
    truncateRetrievalSegment(input.issue.identifier ?? "", 64),
    truncateRetrievalSegment(input.issue.title, 180),
    truncateRetrievalSegment(input.issue.description ?? "", 1200),
    truncateRetrievalSegment(input.message.summary, 320),
    input.message.messageType,
    input.message.workflowStateAfter,
    input.recipientRole,
    ...((input.issue.labels ?? []).map((label) => truncateRetrievalSegment(label.name, 64))),
    ...((input.issue.mentionedProjects ?? []).map((project) => truncateRetrievalSegment(project.name, 96))),
    ...relatedIssueIdentifiers.map((identifier) => truncateRetrievalSegment(identifier, 64)),
    ...payloadTerms.slice(0, 16).map((term) => truncateRetrievalSegment(term, 180)),
  ]);

  const budgetedSegments: string[] = [];
  let consumed = 0;
  const maxQueryLength = 2400;
  for (const segment of querySegments) {
    const projected = consumed + segment.length + (budgetedSegments.length > 0 ? 1 : 0);
    if (projected > maxQueryLength) break;
    budgetedSegments.push(segment);
    consumed = projected;
  }

  return budgetedSegments.join("\n");
}

export function deriveDynamicRetrievalSignals(input: {
  message: CreateIssueProtocolMessage;
  issue: {
    projectId: string | null;
    identifier?: string | null;
    title?: string | null;
    description?: string | null;
    labels?: Array<{ name: string }>;
    mentionedProjects?: Array<{ id: string; name: string }>;
  };
  recipientRole: string;
  eventType: RetrievalEventType;
  baselineSourceTypes?: string[];
}) {
  const payload = input.message.payload as Record<string, unknown>;
  const evidenceCitations = readEvidenceCitations(payload);
  const citedPaths = uniqueNonEmpty(
    evidenceCitations.flatMap((citation) => citation.citedPaths),
  ).map(normalizeHintPath);
  const citedSourceTypes = uniqueNonEmpty(
    evidenceCitations.flatMap((citation) => citation.citedSourceTypes),
  );
  const citedSummaryKinds = uniqueNonEmpty(
    evidenceCitations.flatMap((citation) => citation.citedSummaryKinds),
  );
  const citationReasons = uniqueNonEmpty(
    evidenceCitations.flatMap((citation) => citation.citationReason ? [citation.citationReason] : []),
  );
  const citationSemanticTerms = uniqueNonEmpty([
    ...citedSourceTypes,
    ...citedSummaryKinds.map((kind) => `${kind} summary`),
    ...citationReasons,
  ]);
  const relatedIssueRefs = readRelatedIssueRefs(payload);
  const preferredSourceTypesByRole: Record<string, string[]> = {
    engineer: [...KNOWLEDGE_CODE_REUSE_SOURCE_TYPES, "review", "adr", "runbook", "issue"],
    reviewer: [...KNOWLEDGE_CODE_REUSE_SOURCE_TYPES, "review", "adr", "runbook", "issue"],
    tech_lead: ["adr", "prd", "issue", "runbook", "review", "code", ...KNOWLEDGE_SUMMARY_SOURCE_TYPES],
    human_board: ["prd", "adr", "issue", "review", "runbook", "protocol_message", ...KNOWLEDGE_SUMMARY_SOURCE_TYPES],
  };
  const baselineSourceTypes = uniqueNonEmpty([
    ...(preferredSourceTypesByRole[input.recipientRole] ?? preferredSourceTypesByRole.engineer),
    ...(input.baselineSourceTypes ?? []),
  ]);

  const textDerivedPaths = extractPathHintsFromTextValues([
    input.issue.title,
    input.issue.description,
    input.message.summary,
    typeof payload.goal === "string" ? payload.goal : null,
    typeof payload.reason === "string" ? payload.reason : null,
    typeof payload.implementationSummary === "string" ? payload.implementationSummary : null,
    typeof payload.diffSummary === "string" ? payload.diffSummary : null,
    typeof payload.reviewSummary === "string" ? payload.reviewSummary : null,
    typeof payload.approvalSummary === "string" ? payload.approvalSummary : null,
    typeof payload.closureSummary === "string" ? payload.closureSummary : null,
    typeof payload.verificationSummary === "string" ? payload.verificationSummary : null,
    typeof payload.rollbackPlan === "string" ? payload.rollbackPlan : null,
    ...readStringArray(payload.requiredEvidence),
    ...readStringArray(payload.reviewChecklist),
    ...readStringArray(payload.testResults),
    ...readStringArray(payload.residualRisks),
    ...readStringArray(payload.remainingRisks),
    ...readStringArray(payload.followUpActions),
    ...readStringArray(payload.changedFiles),
    ...citedPaths,
    ...citationReasons,
    ...(((payload.changeRequests as Array<Record<string, unknown>> | undefined) ?? []).flatMap((request) => [
      typeof request.title === "string" ? request.title : null,
      typeof request.reason === "string" ? request.reason : null,
      typeof request.suggestedAction === "string" ? request.suggestedAction : null,
      ...readStringArray(request.affectedFiles),
    ])),
  ]);

  const exactPaths = uniqueNonEmpty([
    ...readStringArray(payload.changedFiles),
    ...(((payload.changeRequests as Array<Record<string, unknown>> | undefined) ?? []).flatMap((request) => (
      readStringArray(request.affectedFiles)
    ))),
    ...readStringArray(payload.relatedArtifacts),
    ...citedPaths,
    ...textDerivedPaths,
  ]).map(normalizeHintPath);
  const fileNames = uniqueNonEmpty(exactPaths.map((entry) => path.posix.basename(entry)));
  const rawKnowledgeTags = uniqueNonEmpty([
    ...readStringArray(payload.requiredKnowledgeTags),
    ...readStringArray(payload.reviewChecklist),
    ...readStringArray(payload.reviewFocus),
    ...readStringArray(payload.requiredEvidence),
    ...readStringArray(payload.approvalChecklist),
    ...readStringArray(payload.verifiedEvidence),
    ...citationSemanticTerms,
  ]);
  const knowledgeTags = uniqueNonEmpty([
    ...rawKnowledgeTags,
    ...splitKnowledgeTagTokens(rawKnowledgeTags),
  ]);
  const identifierHints = extractIdentifierHints([
    ...knowledgeTags,
    ...exactPaths.map(basenameWithoutExtension),
    String(payload.question ?? ""),
    String(payload.blockerCode ?? ""),
    String(payload.implementationSummary ?? ""),
    String(payload.diffSummary ?? ""),
    String(payload.reviewSummary ?? ""),
    String(payload.approvalSummary ?? ""),
    String(payload.closureSummary ?? ""),
    String(payload.verificationSummary ?? ""),
    ...citationSemanticTerms,
  ]);
  const currentIssueIdentifier = input.issue.identifier ? normalizeIssueIdentifier(input.issue.identifier) : null;
  const relatedIssueIdentifiers = uniqueNonEmpty([
    ...relatedIssueRefs.issueIdentifiers,
    ...extractIssueIdentifiers([
      input.issue.title,
      input.issue.description,
      input.message.summary,
      ...((input.issue.labels ?? []).map((label) => label.name)),
      String(payload.goal ?? ""),
      String(payload.reason ?? ""),
      String(payload.question ?? ""),
      String(payload.implementationSummary ?? ""),
      String(payload.diffSummary ?? ""),
      String(payload.reviewSummary ?? ""),
      String(payload.approvalSummary ?? ""),
      String(payload.closureSummary ?? ""),
      String(payload.verificationSummary ?? ""),
      String(payload.rollbackPlan ?? ""),
      ...readStringArray(payload.requiredEvidence),
      ...readStringArray(payload.reviewChecklist),
      ...readStringArray(payload.verifiedEvidence),
      ...readStringArray(payload.followUpActions),
      ...readStringArray(payload.remainingRisks),
    ]),
  ]).filter((identifier) => identifier !== currentIssueIdentifier);
  const relatedIssueSignalPresent = relatedIssueRefs.issueIds.length > 0 || relatedIssueIdentifiers.length > 0;

  const preferredSourceTypes = uniqueNonEmpty([
    ...(exactPaths.length > 0 ? KNOWLEDGE_CODE_PATH_SOURCE_TYPES : []),
    ...(relatedIssueSignalPresent ? ["review", "protocol_message", "issue"] : []),
    ...(input.eventType === "on_review_submit" || input.eventType === "on_review_start" || input.eventType === "on_change_request"
      ? [...KNOWLEDGE_CODE_REUSE_SOURCE_TYPES, "review"]
      : []),
    ...((payload.questionType === "requirement" || payload.questionType === "scope")
      ? ["prd", "issue", ...KNOWLEDGE_PM_CANONICAL_SOURCE_TYPES]
      : []),
    ...(String(payload.blockerCode ?? "").includes("architecture") ? ["adr", "runbook"] : []),
    ...citedSourceTypes,
    ...baselineSourceTypes,
  ]);

  const projectAffinityIds = uniqueNonEmpty([
    input.issue.projectId ?? "",
    ...((input.issue.mentionedProjects ?? []).map((project) => project.id)),
  ]);
  const projectAffinityNames = uniqueNonEmpty([
    ...((input.issue.mentionedProjects ?? []).map((project) => project.name)),
  ]);
  const lexicalTerms = uniqueNonEmpty([
    ...buildLexicalRetrievalTerms([
      ...rawKnowledgeTags,
      ...knowledgeTags,
      ...identifierHints,
      ...exactPaths,
      ...fileNames,
      ...citationSemanticTerms,
    ]),
    ...buildLexicalRetrievalTerms([
      input.issue.title ?? "",
      input.issue.description ?? "",
      input.message.summary,
      String(payload.goal ?? ""),
      String(payload.reason ?? ""),
      String(payload.question ?? ""),
      String(payload.implementationSummary ?? ""),
      String(payload.diffSummary ?? ""),
      String(payload.reviewSummary ?? ""),
      String(payload.approvalSummary ?? ""),
      String(payload.closureSummary ?? ""),
      String(payload.verificationSummary ?? ""),
      String(payload.rollbackPlan ?? ""),
      ...projectAffinityNames,
    ]),
  ]).slice(0, 24);

  return {
    exactPaths,
    fileNames,
    lexicalTerms,
    symbolHints: uniqueNonEmpty([...identifierHints, ...exactPaths.map(basenameWithoutExtension)]),
    knowledgeTags,
    preferredSourceTypes,
    projectAffinityIds,
    projectAffinityNames,
    relatedIssueIds: relatedIssueRefs.issueIds,
    relatedIssueIdentifiers,
    blockerCode: typeof payload.blockerCode === "string" ? payload.blockerCode : null,
    questionType: typeof payload.questionType === "string" ? payload.questionType : null,
  } satisfies RetrievalSignals;
}
