import { z } from "zod";
import {
  ISSUE_PROTOCOL_MESSAGE_TYPES,
  ISSUE_PROTOCOL_WORKFLOW_STATES,
  ROLE_PACK_CUSTOM_BASE_ROLE_KEYS,
  ROLE_PACK_FILE_NAMES,
  ROLE_PACK_PRESET_KEYS,
  ROLE_PACK_REVISION_STATUSES,
  ROLE_PACK_ROLE_KEYS,
  ROLE_PACK_SCOPE_TYPES,
} from "../constants.js";

export const seedDefaultRolePacksSchema = z.object({
  force: z.boolean().optional(),
  presetKey: z.enum(ROLE_PACK_PRESET_KEYS).optional(),
}).strict();

export type SeedDefaultRolePacks = z.infer<typeof seedDefaultRolePacksSchema>;

export const createRolePackDraftSchema = z.object({
  status: z.enum(ROLE_PACK_REVISION_STATUSES).optional(),
  message: z.string().trim().min(1).max(500).nullable().optional(),
  files: z.array(z.object({
    filename: z.enum(ROLE_PACK_FILE_NAMES),
    content: z.string(),
  }).strict()).min(1),
}).strict();

export type CreateRolePackDraft = z.infer<typeof createRolePackDraftSchema>;

export const createCustomRolePackSchema = z.object({
  roleName: z.string().trim().min(1).max(80),
  roleSlug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80).nullable().optional(),
  baseRoleKey: z.enum(ROLE_PACK_CUSTOM_BASE_ROLE_KEYS),
  description: z.string().trim().max(1_000).nullable().optional(),
  publish: z.boolean().optional().default(true),
}).strict();

export type CreateCustomRolePack = z.infer<typeof createCustomRolePackSchema>;

export const restoreRolePackRevisionSchema = z.object({
  message: z.string().trim().min(1).max(500),
  status: z.enum(ROLE_PACK_REVISION_STATUSES).optional(),
}).strict();

export type RestoreRolePackRevision = z.infer<typeof restoreRolePackRevisionSchema>;

export const listRolePacksQuerySchema = z.object({
  scopeType: z.enum(ROLE_PACK_SCOPE_TYPES).optional(),
  scopeId: z.string().uuid().optional(),
  roleKey: z.enum(ROLE_PACK_ROLE_KEYS).optional(),
});

export type ListRolePacksQuery = z.infer<typeof listRolePacksQuerySchema>;

export const rolePackSimulationInputSchema = z.object({
  workflowState: z.enum(ISSUE_PROTOCOL_WORKFLOW_STATES),
  messageType: z.enum(ISSUE_PROTOCOL_MESSAGE_TYPES),
  issueTitle: z.string().trim().min(1).max(300),
  issueSummary: z.string().trim().min(1).max(4000),
  taskBrief: z.string().trim().max(8000).nullable().optional(),
  retrievalSummary: z.string().trim().max(8000).nullable().optional(),
  acceptanceCriteria: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
  changedFiles: z.array(z.string().trim().min(1).max(500)).max(50).default([]),
  reviewFindings: z.array(z.string().trim().min(1).max(1000)).max(20).default([]),
  blockerCode: z.string().trim().min(1).max(120).nullable().optional(),
}).strict();

export type RolePackSimulationInput = z.infer<typeof rolePackSimulationInputSchema>;

export const rolePackSimulationRequestSchema = z.object({
  scenario: rolePackSimulationInputSchema,
  draftFiles: z.array(z.object({
    filename: z.enum(ROLE_PACK_FILE_NAMES),
    content: z.string(),
  }).strict()).max(16).optional(),
}).strict();

export type RolePackSimulationRequest = z.infer<typeof rolePackSimulationRequestSchema>;
