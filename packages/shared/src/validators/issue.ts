import { z } from "zod";
import { ISSUE_PRIORITIES, ISSUE_STATUSES } from "../constants.js";

const internalWorkItemKinds = ["plan", "implementation", "review", "qa"] as const;
const stringListSchema = z.array(z.string().trim().min(1).max(500)).max(20);

export const issueAssigneeAdapterOverridesSchema = z
  .object({
    adapterConfig: z.record(z.unknown()).optional(),
    useProjectWorkspace: z.boolean().optional(),
  })
  .strict();

export const createIssueSchema = z.object({
  projectId: z.string().uuid().optional().nullable(),
  goalId: z.string().uuid().optional().nullable(),
  parentId: z.string().uuid().optional().nullable(),
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  status: z.enum(ISSUE_STATUSES).optional().default("backlog"),
  priority: z.enum(ISSUE_PRIORITIES).optional().default("medium"),
  assigneeAgentId: z.string().uuid().optional().nullable(),
  assigneeUserId: z.string().optional().nullable(),
  requestDepth: z.number().int().nonnegative().optional().default(0),
  billingCode: z.string().optional().nullable(),
  assigneeAdapterOverrides: issueAssigneeAdapterOverridesSchema.optional().nullable(),
  labelIds: z.array(z.string().uuid()).optional(),
});

export type CreateIssue = z.infer<typeof createIssueSchema>;

export const createPmIntakeIssueSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  request: z.string().trim().min(1).max(10_000),
  projectId: z.string().uuid().optional().nullable(),
  goalId: z.string().uuid().optional().nullable(),
  priority: z.enum(ISSUE_PRIORITIES).optional().default("medium"),
  relatedIssueIds: z.array(z.string().uuid()).max(20).optional(),
  requiredKnowledgeTags: stringListSchema.optional(),
  pmAgentId: z.string().uuid().optional().nullable(),
  reviewerAgentId: z.string().uuid().optional().nullable(),
  requestedDueAt: z.string().datetime().nullable().optional(),
}).strict();

export type CreatePmIntakeIssue = z.infer<typeof createPmIntakeIssueSchema>;

export const previewPmIntakeProjectionSchema = z.object({
  projectId: z.string().uuid().nullable().optional(),
  techLeadAgentId: z.string().uuid().nullable().optional(),
  reviewerAgentId: z.string().uuid().nullable().optional(),
  qaAgentId: z.string().uuid().nullable().optional(),
  coordinationOnly: z.boolean().optional().default(false),
  requiredKnowledgeTags: stringListSchema.optional(),
}).strict();

export type PreviewPmIntakeProjection = z.infer<typeof previewPmIntakeProjectionSchema>;

const createInternalWorkItemBaseSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(10_000).optional().nullable(),
  kind: z.enum(internalWorkItemKinds),
  projectId: z.string().uuid().nullable().optional(),
  priority: z.enum(ISSUE_PRIORITIES).optional().default("medium"),
  assigneeAgentId: z.string().uuid(),
  reviewerAgentId: z.string().uuid(),
  qaAgentId: z.string().uuid().nullable().optional(),
  goal: z.string().trim().min(1).max(500).optional(),
  acceptanceCriteria: stringListSchema.min(1),
  definitionOfDone: stringListSchema.min(1),
  deadlineAt: z.string().datetime().nullable().optional(),
  requiredKnowledgeTags: stringListSchema.optional(),
  relatedIssueIds: z.array(z.string().uuid()).max(20).optional(),
  watchReviewer: z.boolean().optional().default(true),
  watchLead: z.boolean().optional().default(true),
});

export const createInternalWorkItemSchema = createInternalWorkItemBaseSchema.superRefine((input, ctx) => {
  if (input.assigneeAgentId === input.reviewerAgentId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Reviewer must be different from assignee",
      path: ["reviewerAgentId"],
    });
  }
  if (input.qaAgentId && input.qaAgentId === input.assigneeAgentId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "QA must be different from assignee",
      path: ["qaAgentId"],
    });
  }
});

export type CreateInternalWorkItem = z.infer<typeof createInternalWorkItemSchema>;

const intakeProjectionRootSchema = z.object({
  structuredTitle: z.string().trim().min(1).max(200).optional(),
  projectId: z.string().uuid().nullable().optional(),
  priority: z.enum(ISSUE_PRIORITIES).optional(),
  executionSummary: z.string().trim().min(1),
  acceptanceCriteria: stringListSchema.min(1),
  definitionOfDone: stringListSchema.min(1),
  risks: stringListSchema.optional(),
  openQuestions: stringListSchema.optional(),
  documentationDebt: stringListSchema.optional(),
}).strict();

const intakeProjectionWorkItemSchema = createInternalWorkItemBaseSchema.extend({
  watchLead: z.boolean().optional().default(true),
  watchReviewer: z.boolean().optional().default(true),
}).strict().superRefine((input, ctx) => {
  if (input.assigneeAgentId === input.reviewerAgentId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Reviewer must be different from assignee",
      path: ["reviewerAgentId"],
    });
  }
  if (input.qaAgentId && input.qaAgentId === input.assigneeAgentId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "QA must be different from assignee",
      path: ["qaAgentId"],
    });
  }
});

const createPmIntakeProjectionBaseSchema = z.object({
  reason: z.string().trim().min(1).max(2_000),
  techLeadAgentId: z.string().uuid(),
  reviewerAgentId: z.string().uuid(),
  qaAgentId: z.string().uuid().nullable().optional(),
  coordinationOnly: z.boolean().optional().default(false),
  carryForwardBriefVersion: z.number().int().nonnegative().nullable().optional(),
  root: intakeProjectionRootSchema,
  workItems: z.array(intakeProjectionWorkItemSchema).max(8).optional().default([]),
}).strict();

export const createPmIntakeProjectionSchema = createPmIntakeProjectionBaseSchema.superRefine((input, ctx) => {
  if (input.techLeadAgentId === input.reviewerAgentId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Reviewer must be different from tech lead assignee",
      path: ["reviewerAgentId"],
    });
  }
  if (input.qaAgentId && (input.qaAgentId === input.techLeadAgentId || input.qaAgentId === input.reviewerAgentId)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "QA must be different from tech lead and reviewer",
      path: ["qaAgentId"],
    });
  }
});

export type CreatePmIntakeProjection = z.infer<typeof createPmIntakeProjectionSchema>;

export const createIssueLabelSchema = z.object({
  name: z.string().trim().min(1).max(48),
  color: z.string().regex(/^#(?:[0-9a-fA-F]{6})$/, "Color must be a 6-digit hex value"),
});

export type CreateIssueLabel = z.infer<typeof createIssueLabelSchema>;

export const updateIssueSchema = createIssueSchema.partial().extend({
  comment: z.string().min(1).optional(),
});

export type UpdateIssue = z.infer<typeof updateIssueSchema>;

export const checkoutIssueSchema = z.object({
  agentId: z.string().uuid(),
  expectedStatuses: z.array(z.enum(ISSUE_STATUSES)).nonempty(),
});

export type CheckoutIssue = z.infer<typeof checkoutIssueSchema>;

export const addIssueCommentSchema = z.object({
  body: z.string().min(1),
  reopen: z.boolean().optional(),
  interrupt: z.boolean().optional(),
});

export type AddIssueComment = z.infer<typeof addIssueCommentSchema>;

export const runMergeCandidateRecoverySchema = z.object({
  actionType: z.enum(["create_revert_followup", "reopen_with_rollback_context"]),
  title: z.string().trim().max(200).nullable().optional(),
  body: z.string().trim().max(8_000).nullable().optional(),
}).strict();

export type RunMergeCandidateRecovery = z.infer<typeof runMergeCandidateRecoverySchema>;

export const linkIssueApprovalSchema = z.object({
  approvalId: z.string().uuid(),
});

export type LinkIssueApproval = z.infer<typeof linkIssueApprovalSchema>;

export const createIssueAttachmentMetadataSchema = z.object({
  issueCommentId: z.string().uuid().optional().nullable(),
});

export type CreateIssueAttachmentMetadata = z.infer<typeof createIssueAttachmentMetadataSchema>;
