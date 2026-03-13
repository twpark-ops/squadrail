import path from "node:path";
import type { CreateIssueProtocolMessage } from "@squadrail/shared";
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

function extractPayloadTerms(message: CreateIssueProtocolMessage) {
  const payload = message.payload as Record<string, unknown>;

  switch (message.messageType) {
    case "ASSIGN_TASK":
      return uniqueNonEmpty([
        String(payload.goal ?? ""),
        ...readStringArray(payload.relatedIssueIdentifiers),
        ...readStringArray(payload.acceptanceCriteria),
        ...readStringArray(payload.definitionOfDone),
        ...readStringArray(payload.requiredKnowledgeTags),
      ]);
    case "ACK_ASSIGNMENT":
      return uniqueNonEmpty([
        String(payload.understoodScope ?? ""),
        ...readStringArray(payload.initialRisks),
      ]);
    case "ASK_CLARIFICATION":
      return uniqueNonEmpty([
        String(payload.question ?? ""),
        ...readStringArray(payload.proposedAssumptions),
      ]);
    case "ANSWER_CLARIFICATION":
      return uniqueNonEmpty([
        String(payload.answer ?? ""),
        String(payload.nextStep ?? ""),
      ]);
    case "PROPOSE_PLAN":
      return uniqueNonEmpty([
        String(payload.planSummary ?? ""),
        ...readStringArray(payload.relatedIssueIdentifiers),
        ...(((payload.steps as Array<Record<string, unknown>> | undefined) ?? []).map((step) => String(step.title ?? ""))),
        ...readStringArray(payload.risks),
      ]);
    case "REPORT_PROGRESS":
      return uniqueNonEmpty([
        ...readStringArray(payload.completedItems),
        ...readStringArray(payload.nextSteps),
        ...readStringArray(payload.changedFiles),
        ...readStringArray(payload.relatedIssueIdentifiers),
        String(payload.testSummary ?? ""),
      ]);
    case "ESCALATE_BLOCKER":
      return uniqueNonEmpty([
        String(payload.blockerCode ?? ""),
        String(payload.blockingReason ?? ""),
        String(payload.requestedAction ?? ""),
        ...readStringArray(payload.relatedIssueIdentifiers),
      ]);
    case "SUBMIT_FOR_REVIEW":
      return uniqueNonEmpty([
        String(payload.implementationSummary ?? ""),
        ...readStringArray(payload.reviewChecklist),
        ...readStringArray(payload.changedFiles),
        ...readStringArray(payload.testResults),
        ...readStringArray(payload.residualRisks),
        ...readStringArray(payload.relatedIssueIdentifiers),
        String(payload.diffSummary ?? ""),
      ]);
    case "START_REVIEW":
      return uniqueNonEmpty(readStringArray(payload.reviewFocus));
    case "REQUEST_CHANGES":
      return uniqueNonEmpty([
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
      return uniqueNonEmpty([
        String(payload.approvalSummary ?? ""),
        ...readStringArray(payload.approvalChecklist),
        ...readStringArray(payload.verifiedEvidence),
        ...readStringArray(payload.residualRisks),
        ...readStringArray(payload.followUpActions),
        ...readStringArray(payload.relatedIssueIdentifiers),
      ]);
    case "CLOSE_TASK":
      return uniqueNonEmpty([
        String(payload.closeReason ?? ""),
        String(payload.closureSummary ?? ""),
        String(payload.verificationSummary ?? ""),
        String(payload.rollbackPlan ?? ""),
        ...readStringArray(payload.finalArtifacts),
        ...readStringArray(payload.remainingRisks),
        ...readStringArray(payload.relatedIssueIdentifiers),
      ]);
    default:
      return [];
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
  const relatedIssueRefs = readRelatedIssueRefs(payload);
  const preferredSourceTypesByRole: Record<string, string[]> = {
    engineer: ["code", "test_report", "review", "adr", "runbook", "issue"],
    reviewer: ["code", "test_report", "review", "adr", "runbook", "issue"],
    tech_lead: ["adr", "prd", "issue", "runbook", "review", "code"],
    human_board: ["prd", "adr", "issue", "review", "runbook", "protocol_message"],
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
    ...textDerivedPaths,
  ]).map(normalizeHintPath);
  const fileNames = uniqueNonEmpty(exactPaths.map((entry) => path.posix.basename(entry)));
  const knowledgeTags = uniqueNonEmpty([
    ...readStringArray(payload.requiredKnowledgeTags),
    ...readStringArray(payload.reviewChecklist),
    ...readStringArray(payload.reviewFocus),
    ...readStringArray(payload.requiredEvidence),
    ...readStringArray(payload.approvalChecklist),
    ...readStringArray(payload.verifiedEvidence),
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
    ...(exactPaths.length > 0 ? ["code"] : []),
    ...(relatedIssueSignalPresent ? ["review", "protocol_message", "issue"] : []),
    ...(input.eventType === "on_review_submit" || input.eventType === "on_review_start" || input.eventType === "on_change_request"
      ? ["code", "test_report", "review"]
      : []),
    ...((payload.questionType === "requirement" || payload.questionType === "scope") ? ["prd", "issue"] : []),
    ...(String(payload.blockerCode ?? "").includes("architecture") ? ["adr", "runbook"] : []),
    ...baselineSourceTypes,
  ]);

  const projectAffinityIds = uniqueNonEmpty([
    input.issue.projectId ?? "",
    ...((input.issue.mentionedProjects ?? []).map((project) => project.id)),
  ]);
  const projectAffinityNames = uniqueNonEmpty([
    ...((input.issue.mentionedProjects ?? []).map((project) => project.name)),
  ]);

  return {
    exactPaths,
    fileNames,
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
