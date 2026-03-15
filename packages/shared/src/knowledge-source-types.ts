import { z } from "zod";

export const KNOWLEDGE_SOURCE_TYPES = [
  "adr",
  "code",
  "code_summary",
  "issue",
  "issue_snapshot",
  "note",
  "prd",
  "protocol_message",
  "review",
  "runbook",
  "symbol_summary",
  "test_report",
] as const;

export type KnowledgeSourceType = (typeof KNOWLEDGE_SOURCE_TYPES)[number];

export const knowledgeSourceTypeSchema = z.enum(KNOWLEDGE_SOURCE_TYPES);

export const KNOWLEDGE_SUMMARY_SOURCE_TYPES = ["code_summary", "symbol_summary"] as const;

export type KnowledgeSummarySourceType = (typeof KNOWLEDGE_SUMMARY_SOURCE_TYPES)[number];

export const knowledgeSummarySourceTypeSchema = z.enum(KNOWLEDGE_SUMMARY_SOURCE_TYPES);

export const KNOWLEDGE_CODE_PATH_SOURCE_TYPES = ["code", ...KNOWLEDGE_SUMMARY_SOURCE_TYPES] as const;

export const KNOWLEDGE_CODE_REUSE_SOURCE_TYPES = [...KNOWLEDGE_CODE_PATH_SOURCE_TYPES, "test_report"] as const;

export const KNOWLEDGE_PM_CANONICAL_SOURCE_TYPES = [
  "adr",
  "prd",
  "runbook",
  ...KNOWLEDGE_SUMMARY_SOURCE_TYPES,
] as const;

const knowledgeSummarySourceTypeSet = new Set<string>(KNOWLEDGE_SUMMARY_SOURCE_TYPES);

export function isKnowledgeSummarySourceType(value: string | null | undefined): value is KnowledgeSummarySourceType {
  return typeof value === "string" && knowledgeSummarySourceTypeSet.has(value);
}

export const KNOWLEDGE_SUMMARY_KINDS = ["file", "module", "symbol"] as const;

export type KnowledgeSummaryKind = (typeof KNOWLEDGE_SUMMARY_KINDS)[number];

export const knowledgeSummaryKindSchema = z.enum(KNOWLEDGE_SUMMARY_KINDS);

const knowledgeTagSchema = z.string().trim().min(1).max(120);

export const knowledgeSummaryProjectSelectionSchema = z.object({
  ownerTags: z.array(knowledgeTagSchema).max(24).optional(),
  supportTags: z.array(knowledgeTagSchema).max(24).optional(),
  avoidTags: z.array(knowledgeTagSchema).max(24).optional(),
}).strict();

export type KnowledgeSummaryProjectSelection = z.infer<typeof knowledgeSummaryProjectSelectionSchema>;

export const knowledgeSummaryMetadataSchema = z.object({
  summaryVersion: z.literal(1),
  summaryKind: knowledgeSummaryKindSchema,
  sourceDocumentId: z.string().uuid().nullable().optional(),
  sourcePath: z.string().trim().min(1).max(1_000).nullable().optional(),
  sourceLanguage: z.string().trim().min(1).max(80).nullable().optional(),
  sourceSymbolName: z.string().trim().min(1).max(320).nullable().optional(),
  sourceSymbolKind: z.string().trim().min(1).max(160).nullable().optional(),
  tags: z.array(knowledgeTagSchema).max(24).optional(),
  requiredKnowledgeTags: z.array(knowledgeTagSchema).max(24).optional(),
  pmProjectSelection: knowledgeSummaryProjectSelectionSchema.optional(),
}).strict();

export type KnowledgeSummaryMetadata = z.infer<typeof knowledgeSummaryMetadataSchema>;

export const KNOWLEDGE_SUMMARY_LINK_REASONS = [
  "summary_source_document",
  "summary_source_symbol",
  "summary_source_path",
] as const;

export type KnowledgeSummaryLinkReason = (typeof KNOWLEDGE_SUMMARY_LINK_REASONS)[number];

const knowledgeSummaryLinkReasonSet = new Set<string>(KNOWLEDGE_SUMMARY_LINK_REASONS);

export function isKnowledgeSummaryLinkReason(value: string | null | undefined): value is KnowledgeSummaryLinkReason {
  return typeof value === "string" && knowledgeSummaryLinkReasonSet.has(value);
}
