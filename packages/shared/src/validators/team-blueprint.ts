import { z } from "zod";
import {
  AGENT_ADAPTER_TYPES,
  AGENT_ROLES,
  ROLE_PACK_PRESET_KEYS,
  TEAM_BLUEPRINT_KEYS,
  TEAM_BLUEPRINT_PROJECT_BINDINGS,
  TEAM_BLUEPRINT_PROJECT_KINDS,
} from "../constants.js";

const blueprintKeySchema = z.string().trim().min(1).max(120).regex(/^[a-z0-9_:-]+$/);

export const teamBlueprintProjectTemplateSchema = z.object({
  key: blueprintKeySchema,
  label: z.string().trim().min(1).max(160),
  description: z.string().trim().max(1_000).nullable(),
  kind: z.enum(TEAM_BLUEPRINT_PROJECT_KINDS),
  repositoryHint: z.string().trim().max(500).nullable(),
  defaultLeadRoleKey: blueprintKeySchema.nullable(),
}).strict();

export const teamBlueprintRoleTemplateSchema = z.object({
  key: blueprintKeySchema,
  label: z.string().trim().min(1).max(160),
  role: z.enum(AGENT_ROLES),
  title: z.string().trim().max(160).nullable(),
  reportsToKey: blueprintKeySchema.nullable(),
  projectBinding: z.enum(TEAM_BLUEPRINT_PROJECT_BINDINGS),
  preferredAdapterTypes: z.array(z.enum(AGENT_ADAPTER_TYPES)).min(1).max(6),
  deliveryLane: z.string().trim().max(120).nullable(),
  capabilities: z.array(z.string().trim().min(1).max(200)).max(20),
}).strict();

export const teamBlueprintParameterHintsSchema = z.object({
  supportsPm: z.boolean(),
  supportsQa: z.boolean(),
  supportsCto: z.boolean(),
  defaultProjectCount: z.number().int().min(1).max(20),
  defaultEngineerPairsPerProject: z.number().int().min(1).max(10),
}).strict();

export const teamBlueprintReadinessSchema = z.object({
  requiredWorkspaceCount: z.number().int().min(0).max(20),
  knowledgeRequired: z.boolean(),
  knowledgeSources: z.array(z.string().trim().min(1).max(160)).max(20),
  approvalRequiredRoleKeys: z.array(blueprintKeySchema).max(20),
  doctorSetupPrerequisites: z.array(z.string().trim().min(1).max(200)).max(20),
  recommendedFirstQuickRequest: z.string().trim().min(1).max(2_000),
}).strict();

export const teamBlueprintSchema = z.object({
  key: z.enum(TEAM_BLUEPRINT_KEYS),
  label: z.string().trim().min(1).max(160),
  description: z.string().trim().min(1).max(2_000),
  presetKey: z.enum(ROLE_PACK_PRESET_KEYS),
  projects: z.array(teamBlueprintProjectTemplateSchema).min(1).max(20),
  roles: z.array(teamBlueprintRoleTemplateSchema).min(1).max(40),
  parameterHints: teamBlueprintParameterHintsSchema,
  readiness: teamBlueprintReadinessSchema,
}).strict();

export const teamBlueprintCatalogViewSchema = z.object({
  companyId: z.string().uuid(),
  blueprints: z.array(teamBlueprintSchema).min(1).max(20),
}).strict();

export const teamBlueprintPreviewRequestSchema = z.object({
  projectCount: z.number().int().min(1).max(20).nullable().optional(),
  engineerPairsPerProject: z.number().int().min(1).max(10).nullable().optional(),
  includePm: z.boolean().nullable().optional(),
  includeQa: z.boolean().nullable().optional(),
  includeCto: z.boolean().nullable().optional(),
}).strict();

export const teamBlueprintApplyRequestSchema = teamBlueprintPreviewRequestSchema.extend({
  previewHash: z.string().trim().min(16).max(256),
}).strict();
