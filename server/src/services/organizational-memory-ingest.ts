import { createHash } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@squadrail/db";
import {
  agents,
  goals,
  issueLabels,
  issueProtocolArtifacts,
  issueProtocolMessages,
  issueProtocolRecipients,
  issueProtocolState,
  issues,
  knowledgeDocuments,
  labels,
  projects,
} from "@squadrail/db";
import type { IssueProtocolMessageType } from "@squadrail/shared";
import { logger } from "../middleware/logger.js";
import { knowledgeEmbeddingService } from "./knowledge-embeddings.js";
import { knowledgeService } from "./knowledge.js";
import {
  deriveOrganizationalMemorySourceType,
  ORGANIZATIONAL_MEMORY_PROTOCOL_MESSAGE_TYPES,
  ORGANIZATIONAL_MEMORY_REVIEW_MESSAGE_TYPES,
} from "./organizational-memory-shared.js";

const MAX_ORG_MEMORY_SECTION_TOKENS = 480;
const MAX_ORG_MEMORY_CONTENT_CHARS = 48_000;

type OrganizationalIssueMutation =
  | "create"
  | "update"
  | "internal_work_item"
  | "backfill";

type OrganizationalMemoryChunk = {
  headingPath: string | null;
  textContent: string;
  tokenCount: number;
  searchText: string;
  links: Array<{
    entityType: string;
    entityId: string;
    linkReason: string;
    weight?: number;
  }>;
  metadata: Record<string, unknown>;
};

function readString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" && entry.trim().length > 0 ? entry.trim() : null))
    .filter((entry): entry is string => Boolean(entry));
}

function readBoolean(value: unknown) {
  return value === true;
}

function asRecord(value: unknown) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function estimateTokenCount(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length === 0) return 1;
  return Math.max(normalized.split(" ").filter(Boolean).length, Math.ceil(normalized.length / 4));
}

function compactWhitespace(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function slugifyMessageType(messageType: string) {
  return messageType.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

export function truncateText(text: string) {
  if (text.length <= MAX_ORG_MEMORY_CONTENT_CHARS) return text;
  return `${text.slice(0, MAX_ORG_MEMORY_CONTENT_CHARS).trimEnd()}\n\n[truncated]`;
}

function pushList(lines: string[], title: string, values: string[]) {
  lines.push("", `## ${title}`);
  if (values.length === 0) {
    lines.push("", "_None._");
    return;
  }
  lines.push("");
  for (const value of values) {
    lines.push(`- ${value}`);
  }
}

export function splitMarkdownSections(markdown: string) {
  const sections: Array<{ headingPath: string | null; textContent: string }> = [];
  const lines = markdown.split(/\r?\n/);
  let currentHeadingPath: string | null = null;
  let currentLines: string[] = [];

  const flush = () => {
    const textContent = currentLines.join("\n").trim();
    if (!textContent) return;
    sections.push({
      headingPath: currentHeadingPath,
      textContent,
    });
  };

  for (const line of lines) {
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flush();
      const title = heading[2]?.trim() ?? "";
      currentHeadingPath = title || null;
      currentLines = [line];
      continue;
    }
    currentLines.push(line);
  }

  flush();

  if (sections.length === 0) {
    return [{
      headingPath: null,
      textContent: markdown.trim(),
    }];
  }

  return sections;
}

export function splitOversizedSection(input: {
  headingPath: string | null;
  textContent: string;
  baseLinks: OrganizationalMemoryChunk["links"];
  metadata: Record<string, unknown>;
}) {
  const paragraphs = input.textContent
    .split(/\n{2,}/)
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (paragraphs.length <= 1) {
    return [{
      headingPath: input.headingPath,
      textContent: input.textContent,
      tokenCount: estimateTokenCount(input.textContent),
      searchText: [input.headingPath, input.textContent].filter(Boolean).join("\n"),
      links: input.baseLinks,
      metadata: input.metadata,
    }] satisfies OrganizationalMemoryChunk[];
  }

  const chunks: OrganizationalMemoryChunk[] = [];
  let current: string[] = [];
  let chunkIndex = 0;

  const flush = () => {
    const textContent = current.join("\n\n").trim();
    if (!textContent) return;
    chunks.push({
      headingPath: input.headingPath,
      textContent,
      tokenCount: estimateTokenCount(textContent),
      searchText: [input.headingPath, textContent].filter(Boolean).join("\n"),
      links: input.baseLinks.filter((link) => (
        link.entityType === "issue"
        || link.entityType === "project"
        || textContent.includes(link.entityId)
      )),
      metadata: {
        ...input.metadata,
        chunkKind: "paragraph_window",
        chunkWindowIndex: chunkIndex,
      },
    });
    chunkIndex += 1;
  };

  for (const paragraph of paragraphs) {
    const candidate = [...current, paragraph].join("\n\n");
    if (current.length > 0 && estimateTokenCount(candidate) > MAX_ORG_MEMORY_SECTION_TOKENS) {
      flush();
      current = [paragraph];
      continue;
    }
    current.push(paragraph);
  }

  flush();
  return chunks;
}

export function normalizePathLink(pathValue: string) {
  return pathValue.replace(/\\/g, "/").replace(/^\.\/+/, "").trim();
}

export function extractRelatedIssueIds(payload: Record<string, unknown>) {
  const related = new Set<string>();
  for (const value of readStringArray(payload.relatedIssueIds)) related.add(value);
  for (const value of readStringArray(payload.followUpIssueIds)) related.add(value);
  const replacementIssueId = readString(payload.replacementIssueId);
  if (replacementIssueId) related.add(replacementIssueId);
  return [...related];
}

export function extractChangedPaths(payload: Record<string, unknown>) {
  const result = new Set<string>();

  for (const entry of readStringArray(payload.changedFiles)) {
    result.add(normalizePathLink(entry));
  }

  for (const entry of readStringArray(payload.finalArtifacts)) {
    if (entry.includes("/") || entry.includes("\\")) {
      result.add(normalizePathLink(entry));
    }
  }

  const changeRequests = Array.isArray(payload.changeRequests) ? payload.changeRequests : [];
  for (const item of changeRequests) {
    const record = asRecord(item);
    if (!record) continue;
    for (const entry of readStringArray(record.affectedFiles)) {
      result.add(normalizePathLink(entry));
    }
  }

  return [...result];
}

export function buildIssueSnapshotMarkdown(input: {
  issue: {
    id: string;
    identifier: string | null;
    title: string;
    description: string | null;
    status: string;
    priority: string;
    requestDepth: number;
    parentId: string | null;
    hiddenAt?: Date | string | null;
    createdAt: Date | string;
    updatedAt: Date | string;
    completedAt: Date | string | null;
    cancelledAt: Date | string | null;
  };
  projectName: string | null;
  goalTitle: string | null;
  parentLabel: string | null;
  assigneeLabel: string | null;
  workflowState: string | null;
  labels: string[];
  internalSummary: {
    total: number;
    backlog: number;
    todo: number;
    inProgress: number;
    inReview: number;
    blocked: number;
    done: number;
    cancelled: number;
  };
  mutation: OrganizationalIssueMutation;
}) {
  const issueLabel = input.issue.identifier ? `${input.issue.identifier} ${input.issue.title}` : input.issue.title;
  const lines = [
    `# Issue Snapshot: ${issueLabel}`,
    "",
    `- issueId: ${input.issue.id}`,
    `- mutation: ${input.mutation}`,
    `- status: ${input.issue.status}`,
    `- priority: ${input.issue.priority}`,
    `- workflowState: ${input.workflowState ?? "-"}`,
    `- project: ${input.projectName ?? "-"}`,
    `- goal: ${input.goalTitle ?? "-"}`,
    `- parent: ${input.parentLabel ?? "-"}`,
    `- assignee: ${input.assigneeLabel ?? "-"}`,
    `- requestDepth: ${input.issue.requestDepth}`,
    `- visibility: ${input.issue.parentId ? "subtask" : "root_issue"}`,
    `- labels: ${input.labels.length > 0 ? input.labels.join(", ") : "-"}`,
    `- createdAt: ${new Date(input.issue.createdAt).toISOString()}`,
    `- updatedAt: ${new Date(input.issue.updatedAt).toISOString()}`,
  ];

  if (input.issue.completedAt) {
    lines.push(`- completedAt: ${new Date(input.issue.completedAt).toISOString()}`);
  }
  if (input.issue.cancelledAt) {
    lines.push(`- cancelledAt: ${new Date(input.issue.cancelledAt).toISOString()}`);
  }

  lines.push("", "## Description", "", input.issue.description?.trim() || "_No description provided._");

  lines.push(
    "",
    "## Internal Work Summary",
    "",
    `- total: ${input.internalSummary.total}`,
    `- backlog: ${input.internalSummary.backlog}`,
    `- todo: ${input.internalSummary.todo}`,
    `- inProgress: ${input.internalSummary.inProgress}`,
    `- inReview: ${input.internalSummary.inReview}`,
    `- blocked: ${input.internalSummary.blocked}`,
    `- done: ${input.internalSummary.done}`,
    `- cancelled: ${input.internalSummary.cancelled}`,
  );

  return truncateText(lines.join("\n"));
}

function renderProtocolPayloadMarkdown(input: {
  messageType: IssueProtocolMessageType;
  payload: Record<string, unknown>;
}) {
  const lines: string[] = [];

  switch (input.messageType) {
    case "ASSIGN_TASK":
      lines.push(`- goal: ${readString(input.payload.goal) ?? "-"}`);
      pushList(lines, "Acceptance Criteria", readStringArray(input.payload.acceptanceCriteria));
      pushList(lines, "Definition of Done", readStringArray(input.payload.definitionOfDone));
      lines.push("", "## Assignment", "");
      lines.push(`- assigneeAgentId: ${readString(input.payload.assigneeAgentId) ?? "-"}`);
      lines.push(`- reviewerAgentId: ${readString(input.payload.reviewerAgentId) ?? "-"}`);
      break;
    case "REASSIGN_TASK":
      lines.push(`- reason: ${readString(input.payload.reason) ?? "-"}`);
      lines.push(`- newAssigneeAgentId: ${readString(input.payload.newAssigneeAgentId) ?? "-"}`);
      lines.push(`- newReviewerAgentId: ${readString(input.payload.newReviewerAgentId) ?? "-"}`);
      break;
    case "ASK_CLARIFICATION":
      lines.push(`- questionType: ${readString(input.payload.questionType) ?? "-"}`);
      lines.push(`- blocking: ${readBoolean(input.payload.blocking) ? "true" : "false"}`);
      lines.push("", "## Question", "", readString(input.payload.question) ?? "_No question body._");
      pushList(lines, "Proposed Assumptions", readStringArray(input.payload.proposedAssumptions));
      break;
    case "ANSWER_CLARIFICATION":
      lines.push(`- nextStep: ${readString(input.payload.nextStep) ?? "-"}`);
      lines.push("", "## Clarification Answer", "", readString(input.payload.answer) ?? "_No answer body provided._");
      break;
    case "PROPOSE_PLAN":
      lines.push(`- planSummary: ${readString(input.payload.planSummary) ?? "-"}`);
      pushList(lines, "Risks", readStringArray(input.payload.risks));
      {
        const steps = Array.isArray(input.payload.steps) ? input.payload.steps : [];
        lines.push("", "## Plan Steps", "");
        if (steps.length === 0) lines.push("_No structured steps provided._");
        for (const [index, step] of steps.entries()) {
          const record = asRecord(step);
          if (!record) continue;
          lines.push(`${index + 1}. ${readString(record.title) ?? "Untitled step"}`);
          lines.push(`   - expectedOutcome: ${readString(record.expectedOutcome) ?? "-"}`);
          const dependsOn = readStringArray(record.dependsOn);
          if (dependsOn.length > 0) {
            lines.push(`   - dependsOn: ${dependsOn.join(", ")}`);
          }
        }
      }
      break;
    case "ESCALATE_BLOCKER":
      lines.push(`- blockerCode: ${readString(input.payload.blockerCode) ?? "-"}`);
      lines.push(`- requestedAction: ${readString(input.payload.requestedAction) ?? "-"}`);
      lines.push("", "## Blocking Reason", "", readString(input.payload.blockingReason) ?? "_No blocker detail provided._");
      break;
    case "REQUEST_HUMAN_DECISION":
      lines.push(`- decisionType: ${readString(input.payload.decisionType) ?? "-"}`);
      lines.push(`- recommendedOption: ${readString(input.payload.recommendedOption) ?? "-"}`);
      pushList(lines, "Options", readStringArray(input.payload.options));
      lines.push("", "## Decision Question", "", readString(input.payload.decisionQuestion) ?? "_No decision question provided._");
      break;
    case "SUBMIT_FOR_REVIEW":
      lines.push(`- diffSummary: ${readString(input.payload.diffSummary) ?? "-"}`);
      pushList(lines, "Changed Files", readStringArray(input.payload.changedFiles));
      pushList(lines, "Evidence", readStringArray(input.payload.evidence));
      pushList(lines, "Test Results", readStringArray(input.payload.testResults));
      pushList(lines, "Review Checklist", readStringArray(input.payload.reviewChecklist));
      pushList(lines, "Residual Risks", readStringArray(input.payload.residualRisks));
      lines.push("", "## Implementation Summary", "", readString(input.payload.implementationSummary) ?? "_No implementation summary provided._");
      break;
    case "REQUEST_CHANGES":
      lines.push(`- severity: ${readString(input.payload.severity) ?? "-"}`);
      lines.push(`- mustFixBeforeApprove: ${readBoolean(input.payload.mustFixBeforeApprove) ? "true" : "false"}`);
      pushList(lines, "Required Evidence", readStringArray(input.payload.requiredEvidence));
      lines.push("", "## Review Summary", "", readString(input.payload.reviewSummary) ?? "_No review summary provided._");
      {
        const changeRequests = Array.isArray(input.payload.changeRequests) ? input.payload.changeRequests : [];
        lines.push("", "## Change Requests", "");
        if (changeRequests.length === 0) lines.push("_No structured change requests provided._");
        for (const [index, request] of changeRequests.entries()) {
          const record = asRecord(request);
          if (!record) continue;
          lines.push(`${index + 1}. ${readString(record.title) ?? "Untitled request"}`);
          lines.push(`   - reason: ${readString(record.reason) ?? "-"}`);
          const affectedFiles = readStringArray(record.affectedFiles);
          if (affectedFiles.length > 0) {
            lines.push(`   - affectedFiles: ${affectedFiles.join(", ")}`);
          }
          const suggestedAction = readString(record.suggestedAction);
          if (suggestedAction) {
            lines.push(`   - suggestedAction: ${suggestedAction}`);
          }
        }
      }
      break;
    case "APPROVE_IMPLEMENTATION":
      lines.push(`- approvalMode: ${readString(input.payload.approvalMode) ?? "-"}`);
      pushList(lines, "Approval Checklist", readStringArray(input.payload.approvalChecklist));
      pushList(lines, "Verified Evidence", readStringArray(input.payload.verifiedEvidence));
      pushList(lines, "Residual Risks", readStringArray(input.payload.residualRisks));
      pushList(lines, "Follow-up Actions", readStringArray(input.payload.followUpActions));
      lines.push("", "## Approval Summary", "", readString(input.payload.approvalSummary) ?? "_No approval summary provided._");
      break;
    case "CLOSE_TASK":
      lines.push(`- closeReason: ${readString(input.payload.closeReason) ?? "-"}`);
      lines.push(`- finalTestStatus: ${readString(input.payload.finalTestStatus) ?? "-"}`);
      lines.push(`- mergeStatus: ${readString(input.payload.mergeStatus) ?? "-"}`);
      pushList(lines, "Final Artifacts", readStringArray(input.payload.finalArtifacts));
      pushList(lines, "Remaining Risks", readStringArray(input.payload.remainingRisks));
      pushList(lines, "Follow-up Issue IDs", readStringArray(input.payload.followUpIssueIds));
      lines.push("", "## Closure Summary", "", readString(input.payload.closureSummary) ?? "_No closure summary provided._");
      lines.push("", "## Verification Summary", "", readString(input.payload.verificationSummary) ?? "_No verification summary provided._");
      lines.push("", "## Rollback Plan", "", readString(input.payload.rollbackPlan) ?? "_No rollback plan provided._");
      break;
    case "CANCEL_TASK":
      lines.push(`- cancelType: ${readString(input.payload.cancelType) ?? "-"}`);
      lines.push(`- replacementIssueId: ${readString(input.payload.replacementIssueId) ?? "-"}`);
      lines.push("", "## Reason", "", readString(input.payload.reason) ?? "_No cancel reason provided._");
      break;
    case "TIMEOUT_ESCALATION":
      lines.push(`- timeoutCode: ${readString(input.payload.timeoutCode) ?? "-"}`);
      lines.push(`- expiredActorRole: ${readString(input.payload.expiredActorRole) ?? "-"}`);
      lines.push(`- nextEscalationTarget: ${readString(input.payload.nextEscalationTarget) ?? "-"}`);
      break;
    default:
      lines.push("", "## Payload", "", "```json", JSON.stringify(input.payload, null, 2), "```");
      break;
  }

  lines.push("", "## Raw Payload", "", "```json", JSON.stringify(input.payload, null, 2), "```");
  return lines;
}

export function buildProtocolArtifactMarkdown(input: {
  issue: {
    id: string;
    identifier: string | null;
    title: string;
  };
  projectName: string | null;
  message: {
    id: string;
    seq: number;
    messageType: IssueProtocolMessageType;
    senderActorType: string;
    senderActorId: string;
    senderRole: string;
    workflowStateBefore: string;
    workflowStateAfter: string;
    summary: string;
    payload: Record<string, unknown>;
    createdAt: Date | string;
  };
  sourceType: "protocol_message" | "review";
  recipients: Array<{
    recipientType: string;
    recipientId: string;
    recipientRole: string;
  }>;
  artifacts: Array<{
    artifactKind: string;
    artifactUri: string;
    label: string | null;
    metadata: Record<string, unknown>;
  }>;
}) {
  const issueLabel = input.issue.identifier ? `${input.issue.identifier} ${input.issue.title}` : input.issue.title;
  const lines = [
    `# ${input.sourceType === "review" ? "Review Artifact" : "Protocol Artifact"}: ${issueLabel}`,
    "",
    `- messageId: ${input.message.id}`,
    `- seq: ${input.message.seq}`,
    `- sourceType: ${input.sourceType}`,
    `- messageType: ${input.message.messageType}`,
    `- senderRole: ${input.message.senderRole}`,
    `- senderActorType: ${input.message.senderActorType}`,
    `- senderActorId: ${input.message.senderActorId}`,
    `- workflow: ${input.message.workflowStateBefore} -> ${input.message.workflowStateAfter}`,
    `- project: ${input.projectName ?? "-"}`,
    `- createdAt: ${new Date(input.message.createdAt).toISOString()}`,
    "",
    "## Summary",
    "",
    input.message.summary.trim() || "_No summary provided._",
  ];

  if (input.recipients.length > 0) {
    lines.push("", "## Recipients", "");
    for (const recipient of input.recipients) {
      lines.push(`- ${recipient.recipientRole}: ${recipient.recipientType}:${recipient.recipientId}`);
    }
  }

  if (input.artifacts.length > 0) {
    lines.push("", "## Attached Artifacts", "");
    for (const artifact of input.artifacts) {
      lines.push(`- ${artifact.artifactKind}: ${artifact.label ?? artifact.artifactUri}`);
      lines.push(`  - uri: ${artifact.artifactUri}`);
    }
  }

  lines.push(...renderProtocolPayloadMarkdown({
    messageType: input.message.messageType,
    payload: input.message.payload,
  }));

  return truncateText(lines.join("\n"));
}

export function organizationalMemoryService(db: Db) {
  const knowledge = knowledgeService(db);
  const embeddings = knowledgeEmbeddingService();

  async function buildKnowledgeChunks(input: {
    rawContent: string;
    sourceType: "issue" | "protocol_message" | "review";
    baseLinks: OrganizationalMemoryChunk["links"];
  }) {
    const sectionDefinitions = splitMarkdownSections(input.rawContent);
    const chunks: OrganizationalMemoryChunk[] = [];

    for (const [sectionIndex, section] of sectionDefinitions.entries()) {
      const baseMetadata = {
        organizationalMemory: true,
        sourceType: input.sourceType,
        sectionIndex,
        chunkKind: "markdown_section",
      } satisfies Record<string, unknown>;
      const tokenCount = estimateTokenCount(section.textContent);
      if (tokenCount <= MAX_ORG_MEMORY_SECTION_TOKENS) {
        chunks.push({
          headingPath: section.headingPath,
          textContent: section.textContent,
          tokenCount,
          searchText: [section.headingPath, section.textContent].filter(Boolean).join("\n"),
          links: input.baseLinks.filter((link) => (
            link.entityType === "issue"
            || link.entityType === "project"
            || section.textContent.includes(link.entityId)
          )),
          metadata: baseMetadata,
        });
        continue;
      }

      chunks.push(...splitOversizedSection({
        headingPath: section.headingPath,
        textContent: section.textContent,
        baseLinks: input.baseLinks,
        metadata: baseMetadata,
      }));
    }

    if (!embeddings.isConfigured()) {
      return {
        chunks: chunks.map((chunk, index) => ({
          chunkIndex: index,
          headingPath: chunk.headingPath,
          tokenCount: chunk.tokenCount,
          textContent: chunk.textContent,
          searchText: chunk.searchText,
          embedding: [] as number[],
          metadata: {
            ...chunk.metadata,
            embeddingOrigin: "not_configured",
          },
          links: chunk.links,
        })),
        documentEmbeddingMetadata: {
          embeddingConfigured: false,
          embeddingChunkCount: chunks.length,
        },
      };
    }

    const generatedAt = new Date().toISOString();
    const result = await embeddings.generateEmbeddings(chunks.map((chunk) => chunk.textContent));
    return {
      chunks: chunks.map((chunk, index) => ({
        chunkIndex: index,
        headingPath: chunk.headingPath,
        tokenCount: chunk.tokenCount,
        textContent: chunk.textContent,
        searchText: chunk.searchText,
        embedding: result.embeddings[index] ?? [],
        metadata: {
          ...chunk.metadata,
          embeddingProvider: result.provider,
          embeddingModel: result.model,
          embeddingDimensions: result.dimensions,
          embeddingOrigin: "organizational_memory_ingest",
          embeddingGeneratedAt: generatedAt,
        },
        links: chunk.links,
      })),
      documentEmbeddingMetadata: {
        embeddingConfigured: true,
        embeddingProvider: result.provider,
        embeddingModel: result.model,
        embeddingDimensions: result.dimensions,
        embeddingOrigin: "organizational_memory_ingest",
        embeddingGeneratedAt: generatedAt,
        embeddingChunkCount: chunks.length,
        embeddingTotalTokens: result.usage.totalTokens,
      },
    };
  }

  async function ensureDocumentCurrent(input: {
    documentId: string;
    authorityLevel: string;
    issueId?: string | null;
    messageId?: string | null;
    metadata: Record<string, unknown>;
  }) {
    const current = await knowledge.getDocumentById(input.documentId);
    if (!current) return null;

    await db
      .update(knowledgeDocuments)
      .set({
        authorityLevel: input.authorityLevel,
        issueId: input.issueId ?? null,
        messageId: input.messageId ?? null,
        metadata: {
          ...(current.metadata ?? {}),
          ...input.metadata,
          isLatestForScope: input.metadata.isLatestForScope ?? current.metadata?.isLatestForScope ?? true,
        },
        updatedAt: new Date(),
      })
      .where(eq(knowledgeDocuments.id, input.documentId));

    return knowledge.getDocumentById(input.documentId);
  }

  async function finalizeDocument(input: {
    companyId: string;
    projectId?: string | null;
    documentId: string;
    sourceType: "issue" | "protocol_message" | "review";
    path: string;
    authorityLevel: string;
    issueId?: string | null;
    messageId?: string | null;
    rawContent: string;
    title: string;
    metadata: Record<string, unknown>;
    baseLinks: OrganizationalMemoryChunk["links"];
    allowSupersede: boolean;
  }) {
    const currentDocument = await ensureDocumentCurrent({
      documentId: input.documentId,
      authorityLevel: input.authorityLevel,
      issueId: input.issueId ?? null,
      messageId: input.messageId ?? null,
      metadata: input.metadata,
    });

    const { chunks, documentEmbeddingMetadata } = await buildKnowledgeChunks({
      rawContent: input.rawContent,
      sourceType: input.sourceType,
      baseLinks: input.baseLinks,
    });

    await knowledge.replaceDocumentChunks({
      companyId: input.companyId,
      documentId: input.documentId,
      chunks,
    });

    await knowledge.updateDocumentMetadata(input.documentId, {
      ...input.metadata,
      ...documentEmbeddingMetadata,
      organizationalMemory: true,
      isLatestForScope: true,
    });

    if (input.allowSupersede) {
      await knowledge.deprecateSupersededDocuments({
        companyId: input.companyId,
        sourceType: input.sourceType,
        path: input.path,
        projectId: input.projectId ?? null,
        repoRef: null,
        keepDocumentId: input.documentId,
        supersededByDocumentId: input.documentId,
      });
    }

    if (input.projectId) {
      await knowledge.touchProjectKnowledgeRevision({
        companyId: input.companyId,
        projectId: input.projectId,
        bump: true,
        headSha: null,
        treeSignature: null,
        importMode: "organizational_memory_ingest",
        importedAt: new Date().toISOString(),
        metadata: {
          sourceType: input.sourceType,
          issueId: input.issueId ?? null,
          messageId: input.messageId ?? null,
          path: input.path,
          title: input.title,
        },
      });
    }

    return currentDocument;
  }

  async function loadIssueContext(issueId: string) {
    const issue = await db
      .select()
      .from(issues)
      .where(eq(issues.id, issueId))
      .then((rows) => rows[0] ?? null);
    if (!issue) return null;

    const [project, goal, parent, assignee, state, issueLabelRows, childStatusRows] = await Promise.all([
      issue.projectId
        ? db.select({ name: projects.name }).from(projects).where(eq(projects.id, issue.projectId)).then((rows) => rows[0] ?? null)
        : Promise.resolve(null),
      issue.goalId
        ? db.select({ title: goals.title }).from(goals).where(eq(goals.id, issue.goalId)).then((rows) => rows[0] ?? null)
        : Promise.resolve(null),
      issue.parentId
        ? db.select({ identifier: issues.identifier, title: issues.title }).from(issues).where(eq(issues.id, issue.parentId)).then((rows) => rows[0] ?? null)
        : Promise.resolve(null),
      issue.assigneeAgentId
        ? db.select({ name: agents.name }).from(agents).where(eq(agents.id, issue.assigneeAgentId)).then((rows) => rows[0] ?? null)
        : Promise.resolve(null),
      db.select({ workflowState: issueProtocolState.workflowState }).from(issueProtocolState).where(eq(issueProtocolState.issueId, issue.id)).then((rows) => rows[0] ?? null),
      db
        .select({ name: labels.name, color: labels.color })
        .from(issueLabels)
        .innerJoin(labels, eq(labels.id, issueLabels.labelId))
        .where(eq(issueLabels.issueId, issue.id))
        .orderBy(asc(labels.name)),
      db.execute<{ status: string; count: number }>(sql`
        select status, count(*)::int as count
        from issues
        where parent_id = ${issue.id}
        group by status
      `),
    ]);

    const internalSummary = {
      total: childStatusRows.reduce((total, row) => total + Number(row.count ?? 0), 0),
      backlog: 0,
      todo: 0,
      inProgress: 0,
      inReview: 0,
      blocked: 0,
      done: 0,
      cancelled: 0,
    };
    for (const row of childStatusRows) {
      const count = Number(row.count ?? 0);
      if (row.status === "backlog") internalSummary.backlog += count;
      else if (row.status === "todo") internalSummary.todo += count;
      else if (row.status === "in_progress") internalSummary.inProgress += count;
      else if (row.status === "in_review") internalSummary.inReview += count;
      else if (row.status === "blocked") internalSummary.blocked += count;
      else if (row.status === "done") internalSummary.done += count;
      else if (row.status === "cancelled") internalSummary.cancelled += count;
    }

    return {
      issue,
      projectName: project?.name ?? null,
      goalTitle: goal?.title ?? null,
      parentLabel: parent ? [parent.identifier, parent.title].filter(Boolean).join(" ") : null,
      assigneeLabel: assignee?.name ?? issue.assigneeUserId ?? null,
      workflowState: state?.workflowState ?? null,
      labels: issueLabelRows.map((label) => label.name),
      internalSummary,
    };
  }

  async function loadProtocolContext(messageId: string) {
    const message = await db
      .select()
      .from(issueProtocolMessages)
      .where(eq(issueProtocolMessages.id, messageId))
      .then((rows) => rows[0] ?? null);
    if (!message) return null;

    const sourceType = deriveOrganizationalMemorySourceType(message.messageType as IssueProtocolMessageType);
    if (!sourceType) return null;

    const issue = await db
      .select()
      .from(issues)
      .where(eq(issues.id, message.issueId))
      .then((rows) => rows[0] ?? null);
    if (!issue) return null;

    const [project, recipients, artifacts] = await Promise.all([
      issue.projectId
        ? db.select({ name: projects.name }).from(projects).where(eq(projects.id, issue.projectId)).then((rows) => rows[0] ?? null)
        : Promise.resolve(null),
      db
        .select({
          recipientType: issueProtocolRecipients.recipientType,
          recipientId: issueProtocolRecipients.recipientId,
          recipientRole: issueProtocolRecipients.recipientRole,
        })
        .from(issueProtocolRecipients)
        .where(eq(issueProtocolRecipients.messageId, message.id))
        .orderBy(asc(issueProtocolRecipients.recipientRole), asc(issueProtocolRecipients.recipientId)),
      db
        .select({
          artifactKind: issueProtocolArtifacts.artifactKind,
          artifactUri: issueProtocolArtifacts.artifactUri,
          label: issueProtocolArtifacts.label,
          metadata: issueProtocolArtifacts.metadata,
        })
        .from(issueProtocolArtifacts)
        .where(eq(issueProtocolArtifacts.messageId, message.id))
        .orderBy(asc(issueProtocolArtifacts.artifactKind), asc(issueProtocolArtifacts.artifactUri)),
    ]);

    return {
      issue,
      message,
      sourceType,
      projectName: project?.name ?? null,
      recipients,
      artifacts,
    };
  }

  async function ingestIssueSnapshot(input: {
    issueId: string;
    mutation: OrganizationalIssueMutation;
  }) {
    const context = await loadIssueContext(input.issueId);
    if (!context) return null;

    const path = `issues/${context.issue.identifier ?? context.issue.id}/issue.md`;
    const title = context.issue.identifier
      ? `${context.issue.identifier} issue snapshot`
      : `${context.issue.id} issue snapshot`;
    const rawContent = buildIssueSnapshotMarkdown({
      issue: context.issue,
      projectName: context.projectName,
      goalTitle: context.goalTitle,
      parentLabel: context.parentLabel,
      assigneeLabel: context.assigneeLabel,
      workflowState: context.workflowState,
      labels: context.labels,
      internalSummary: context.internalSummary,
      mutation: input.mutation,
    });
    const created = await knowledge.createDocument({
      companyId: context.issue.companyId,
      sourceType: "issue",
      authorityLevel: "canonical",
      contentSha256: sha256(rawContent),
      rawContent,
      projectId: context.issue.projectId,
      issueId: context.issue.id,
      messageId: null,
      path,
      title,
      language: "markdown",
      metadata: {
        organizationalMemory: true,
        artifactKind: "issue_snapshot",
        mutation: input.mutation,
        workflowState: context.workflowState,
        labels: context.labels,
        issueStatus: context.issue.status,
        issuePriority: context.issue.priority,
        isLatestForScope: true,
      },
    });
    if (!created) return null;

    const baseLinks = [
      {
        entityType: "issue",
        entityId: context.issue.id,
        linkReason: "issue_snapshot",
        weight: 1.2,
      },
      ...(context.issue.projectId
        ? [{
          entityType: "project",
          entityId: context.issue.projectId,
          linkReason: "issue_project_scope",
          weight: 0.85,
        }]
        : []),
    ];

    await finalizeDocument({
      companyId: context.issue.companyId,
      projectId: context.issue.projectId,
      documentId: created.id,
      sourceType: "issue",
      path,
      authorityLevel: "canonical",
      issueId: context.issue.id,
      messageId: null,
      rawContent,
      title,
      metadata: {
        organizationalMemory: true,
        artifactKind: "issue_snapshot",
        mutation: input.mutation,
        workflowState: context.workflowState,
        issueStatus: context.issue.status,
        issuePriority: context.issue.priority,
        labels: context.labels,
      },
      baseLinks,
      allowSupersede: true,
    });

    return {
      issueId: context.issue.id,
      documentId: created.id,
      sourceType: "issue" as const,
      path,
    };
  }

  async function ingestProtocolMessage(input: {
    messageId: string;
  }) {
    const context = await loadProtocolContext(input.messageId);
    if (!context) return null;

    const pathBucket = context.sourceType === "review" ? "review" : "protocol";
    const path = `issues/${context.issue.identifier ?? context.issue.id}/${pathBucket}/${String(context.message.seq).padStart(4, "0")}-${slugifyMessageType(context.message.messageType)}.md`;
    const titlePrefix = context.sourceType === "review" ? "review" : "protocol";
    const title = context.issue.identifier
      ? `${context.issue.identifier} ${titlePrefix} ${context.message.seq}`
      : `${context.issue.id} ${titlePrefix} ${context.message.seq}`;
    const rawContent = buildProtocolArtifactMarkdown({
      issue: {
        id: context.issue.id,
        identifier: context.issue.identifier,
        title: context.issue.title,
      },
      projectName: context.projectName,
      message: {
        id: context.message.id,
        seq: context.message.seq,
        messageType: context.message.messageType as IssueProtocolMessageType,
        senderActorType: context.message.senderActorType,
        senderActorId: context.message.senderActorId,
        senderRole: context.message.senderRole,
        workflowStateBefore: context.message.workflowStateBefore,
        workflowStateAfter: context.message.workflowStateAfter,
        summary: context.message.summary,
        payload: (context.message.payload ?? {}) as Record<string, unknown>,
        createdAt: context.message.createdAt,
      },
      sourceType: context.sourceType,
      recipients: context.recipients,
      artifacts: context.artifacts.map((artifact) => ({
        artifactKind: artifact.artifactKind,
        artifactUri: artifact.artifactUri,
        label: artifact.label,
        metadata: (artifact.metadata ?? {}) as Record<string, unknown>,
      })),
    });

    const payload = asRecord(context.message.payload) ?? {};
    const linkedIssueIds = extractRelatedIssueIds(payload);
    const changedPaths = extractChangedPaths(payload);
    const created = await knowledge.createDocument({
      companyId: context.issue.companyId,
      sourceType: context.sourceType,
      authorityLevel: context.sourceType === "review" ? "canonical" : "working",
      contentSha256: sha256(rawContent),
      rawContent,
      projectId: context.issue.projectId,
      issueId: context.issue.id,
      messageId: context.message.id,
      path,
      title,
      language: "markdown",
      metadata: {
        organizationalMemory: true,
        artifactKind: context.sourceType === "review" ? "review_event" : "protocol_event",
        messageType: context.message.messageType,
        senderRole: context.message.senderRole,
        workflowStateBefore: context.message.workflowStateBefore,
        workflowStateAfter: context.message.workflowStateAfter,
        linkedIssueIds,
        changedPaths,
        isLatestForScope: true,
      },
    });
    if (!created) return null;

    const baseLinks = [
      {
        entityType: "issue",
        entityId: context.issue.id,
        linkReason: "protocol_issue_context",
        weight: 1.1,
      },
      ...(context.issue.projectId
        ? [{
          entityType: "project",
          entityId: context.issue.projectId,
          linkReason: "protocol_project_scope",
          weight: 0.8,
        }]
        : []),
      ...changedPaths.map((pathValue) => ({
        entityType: "path",
        entityId: pathValue,
        linkReason: "protocol_changed_path",
        weight: context.sourceType === "review" ? 1 : 0.85,
      })),
      ...linkedIssueIds.map((issueId) => ({
        entityType: "issue",
        entityId: issueId,
        linkReason: "protocol_related_issue",
        weight: 0.7,
      })),
    ];

    await finalizeDocument({
      companyId: context.issue.companyId,
      projectId: context.issue.projectId,
      documentId: created.id,
      sourceType: context.sourceType,
      path,
      authorityLevel: context.sourceType === "review" ? "canonical" : "working",
      issueId: context.issue.id,
      messageId: context.message.id,
      rawContent,
      title,
      metadata: {
        organizationalMemory: true,
        artifactKind: context.sourceType === "review" ? "review_event" : "protocol_event",
        messageType: context.message.messageType,
        senderRole: context.message.senderRole,
        workflowStateBefore: context.message.workflowStateBefore,
        workflowStateAfter: context.message.workflowStateAfter,
        linkedIssueIds,
        changedPaths,
      },
      baseLinks,
      allowSupersede: true,
    });

    return {
      issueId: context.issue.id,
      messageId: context.message.id,
      documentId: created.id,
      sourceType: context.sourceType,
      path,
    };
  }

  async function backfillCompany(input: {
    companyId: string;
    issueLimit?: number;
    messageLimit?: number;
    issueIds?: string[];
    messageIds?: string[];
  }) {
    const issueIds = input.issueIds && input.issueIds.length > 0
      ? input.issueIds
      : await db
        .select({ id: issues.id })
        .from(issues)
        .where(eq(issues.companyId, input.companyId))
        .orderBy(asc(issues.createdAt))
        .limit(input.issueLimit ?? 5_000)
        .then((rows) => rows.map((row) => row.id));

    const messageIds = input.messageIds && input.messageIds.length > 0
      ? input.messageIds
      : await db
        .select({ id: issueProtocolMessages.id })
        .from(issueProtocolMessages)
        .where(
          and(
            eq(issueProtocolMessages.companyId, input.companyId),
            inArray(
              issueProtocolMessages.messageType,
              [
                ...ORGANIZATIONAL_MEMORY_PROTOCOL_MESSAGE_TYPES,
                ...ORGANIZATIONAL_MEMORY_REVIEW_MESSAGE_TYPES,
              ] as string[],
            ),
          ),
        )
        .orderBy(asc(issueProtocolMessages.createdAt))
        .limit(input.messageLimit ?? 10_000)
        .then((rows) => rows.map((row) => row.id));

    let issueDocumentCount = 0;
    let protocolDocumentCount = 0;
    let reviewDocumentCount = 0;

    for (const issueId of issueIds) {
      try {
        const result = await ingestIssueSnapshot({
          issueId,
          mutation: "backfill",
        });
        if (result) issueDocumentCount += 1;
      } catch (err) {
        logger.error({ err, companyId: input.companyId, issueId }, "organizational memory issue backfill failed");
      }
    }

    for (const messageId of messageIds) {
      try {
        const result = await ingestProtocolMessage({ messageId });
        if (!result) continue;
        if (result.sourceType === "review") reviewDocumentCount += 1;
        else protocolDocumentCount += 1;
      } catch (err) {
        logger.error({ err, companyId: input.companyId, messageId }, "organizational memory protocol backfill failed");
      }
    }

    return {
      companyId: input.companyId,
      issueScanned: issueIds.length,
      issueDocumentCount,
      messageScanned: messageIds.length,
      protocolDocumentCount,
      reviewDocumentCount,
      completedAt: new Date().toISOString(),
    };
  }

  return {
    ingestIssueSnapshot,
    ingestProtocolMessage,
    backfillCompany,
  };
}
