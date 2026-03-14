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
  editors: z.object({
    projectCount: z.object({
      label: z.string().trim().min(1).max(160),
      description: z.string().trim().min(1).max(500),
      min: z.number().int().min(1).max(20),
      max: z.number().int().min(1).max(20),
      step: z.number().int().min(1).max(5),
    }).strict(),
    engineerPairsPerProject: z.object({
      label: z.string().trim().min(1).max(160),
      description: z.string().trim().min(1).max(500),
      min: z.number().int().min(1).max(10),
      max: z.number().int().min(1).max(10),
      step: z.number().int().min(1).max(5),
    }).strict(),
    includePm: z.object({
      label: z.string().trim().min(1).max(160),
      description: z.string().trim().min(1).max(500),
      editable: z.boolean(),
    }).strict(),
    includeQa: z.object({
      label: z.string().trim().min(1).max(160),
      description: z.string().trim().min(1).max(500),
      editable: z.boolean(),
    }).strict(),
    includeCto: z.object({
      label: z.string().trim().min(1).max(160),
      description: z.string().trim().min(1).max(500),
      editable: z.boolean(),
    }).strict(),
  }).strict().optional(),
}).strict();

export const teamBlueprintReadinessSchema = z.object({
  requiredWorkspaceCount: z.number().int().min(0).max(20),
  knowledgeRequired: z.boolean(),
  knowledgeSources: z.array(z.string().trim().min(1).max(160)).max(20),
  approvalRequiredRoleKeys: z.array(blueprintKeySchema).max(20),
  doctorSetupPrerequisites: z.array(z.string().trim().min(1).max(200)).max(20),
  recommendedFirstQuickRequest: z.string().trim().min(1).max(2_000),
}).strict();

export const teamBlueprintPortabilitySchema = z.object({
  companyAgnostic: z.boolean(),
  workspaceModel: z.enum(["single_workspace", "per_project"]),
  knowledgeModel: z.enum(["optional", "recommended", "required"]),
  migrationHelperKeys: z.array(blueprintKeySchema).max(20),
  notes: z.array(z.string().trim().min(1).max(500)).max(20),
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
  portability: teamBlueprintPortabilitySchema,
}).strict();

export const portableTeamBlueprintDefinitionSchema = z.object({
  slug: blueprintKeySchema,
  label: z.string().trim().min(1).max(160),
  description: z.string().trim().min(1).max(2_000),
  sourceBlueprintKey: z.enum(TEAM_BLUEPRINT_KEYS).nullable(),
  presetKey: z.enum(ROLE_PACK_PRESET_KEYS),
  projects: z.array(teamBlueprintProjectTemplateSchema).min(1).max(20),
  roles: z.array(teamBlueprintRoleTemplateSchema).min(1).max(40),
  parameterHints: teamBlueprintParameterHintsSchema,
  readiness: teamBlueprintReadinessSchema,
  portability: teamBlueprintPortabilitySchema,
}).strict();

export const teamBlueprintCanonicalAbsorptionProjectMappingSchema = z.object({
  canonicalProjectSlug: blueprintKeySchema,
  canonicalProjectName: z.string().trim().min(1).max(200),
  blueprintSlotKey: blueprintKeySchema,
  blueprintTemplateKey: blueprintKeySchema,
  expectedLeadRoleKey: blueprintKeySchema.nullable(),
}).strict();

export const teamBlueprintCanonicalAbsorptionPrepSchema = z.object({
  canonicalTemplateKey: blueprintKeySchema,
  canonicalVersion: z.string().trim().min(1).max(160),
  blueprintKey: z.enum(TEAM_BLUEPRINT_KEYS),
  previewRequest: z.object({
    projectCount: z.number().int().min(1).max(20).nullable().optional(),
    engineerPairsPerProject: z.number().int().min(1).max(10).nullable().optional(),
    includePm: z.boolean().nullable().optional(),
    includeQa: z.boolean().nullable().optional(),
    includeCto: z.boolean().nullable().optional(),
  }).strict(),
  projectMappings: z.array(teamBlueprintCanonicalAbsorptionProjectMappingSchema).min(1).max(20),
  warnings: z.array(z.string().trim().min(1).max(500)).max(20),
}).strict();

export const teamBlueprintMigrationHelperSchema = teamBlueprintCanonicalAbsorptionPrepSchema.extend({
  key: blueprintKeySchema,
  kind: z.literal("canonical_absorption"),
  label: z.string().trim().min(1).max(160),
  description: z.string().trim().min(1).max(2_000),
}).strict();

export const savedTeamBlueprintSourceMetadataSchema = z.object({
  type: z.enum(["builtin_export", "import_bundle", "company_local_authoring", "saved_blueprint_version"]),
  companyId: z.string().uuid().nullable(),
  companyName: z.string().trim().min(1).max(160).nullable(),
  blueprintKey: z.enum(TEAM_BLUEPRINT_KEYS).nullable(),
  generatedAt: z.string().datetime(),
  lineageKey: blueprintKeySchema.nullable().optional(),
  version: z.number().int().min(1).max(1_000).nullable().optional(),
  parentSavedBlueprintId: z.string().uuid().nullable().optional(),
  versionNote: z.string().trim().max(500).nullable().optional(),
}).strict();

export const companySavedTeamBlueprintSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  definition: portableTeamBlueprintDefinitionSchema,
  defaultPreviewRequest: z.object({
    projectCount: z.number().int().min(1).max(20).nullable().optional(),
    engineerPairsPerProject: z.number().int().min(1).max(10).nullable().optional(),
    includePm: z.boolean().nullable().optional(),
    includeQa: z.boolean().nullable().optional(),
    includeCto: z.boolean().nullable().optional(),
  }).strict(),
  sourceMetadata: savedTeamBlueprintSourceMetadataSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();

export const teamBlueprintCatalogViewSchema = z.object({
  companyId: z.string().uuid(),
  blueprints: z.array(teamBlueprintSchema).min(1).max(20),
  savedBlueprints: z.array(companySavedTeamBlueprintSchema).max(50),
  migrationHelpers: z.array(teamBlueprintMigrationHelperSchema).max(20),
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

export const teamBlueprintExportBundleSchema = z.object({
  schemaVersion: z.number().int().positive(),
  generatedAt: z.string().datetime(),
  source: z.object({
    companyId: z.string().uuid(),
    companyName: z.string().trim().min(1).max(160).nullable(),
    blueprintKey: z.enum(TEAM_BLUEPRINT_KEYS).nullable(),
    blueprintLabel: z.string().trim().min(1).max(160),
  }).strict(),
  definition: portableTeamBlueprintDefinitionSchema,
  defaultPreviewRequest: teamBlueprintPreviewRequestSchema,
}).strict();

export const teamBlueprintExportResultSchema = z.object({
  bundle: teamBlueprintExportBundleSchema,
  warnings: z.array(z.string().trim().min(1).max(500)).max(50),
}).strict();

export const teamBlueprintImportSourceSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("inline"),
    bundle: teamBlueprintExportBundleSchema,
  }).strict(),
]);

export const teamBlueprintImportCollisionStrategySchema = z.enum(["rename", "replace"]);

export const teamBlueprintImportPreviewRequestSchema = z.object({
  source: teamBlueprintImportSourceSchema,
  slug: blueprintKeySchema.nullable().optional(),
  label: z.string().trim().min(1).max(160).nullable().optional(),
  collisionStrategy: teamBlueprintImportCollisionStrategySchema.nullable().optional(),
}).strict();

export const teamBlueprintPreviewResultSchema = z.object({
  companyId: z.string().uuid(),
  previewHash: z.string().trim().min(16).max(256),
  blueprint: teamBlueprintSchema,
  parameters: z.object({
    projectCount: z.number().int().min(1).max(20),
    engineerPairsPerProject: z.number().int().min(1).max(10),
    includePm: z.boolean(),
    includeQa: z.boolean(),
    includeCto: z.boolean(),
  }).strict(),
  summary: z.object({
    currentProjectCount: z.number().int().min(0),
    currentWorkspaceCount: z.number().int().min(0),
    currentAgentCount: z.number().int().min(0),
    adoptedProjectCount: z.number().int().min(0),
    createProjectCount: z.number().int().min(0),
    matchedRoleCount: z.number().int().min(0),
    missingRoleCount: z.number().int().min(0),
  }).strict(),
  projectDiff: z.array(z.object({
    slotKey: blueprintKeySchema,
    templateKey: blueprintKeySchema,
    label: z.string().trim().min(1).max(160),
    kind: z.enum(TEAM_BLUEPRINT_PROJECT_KINDS),
    status: z.enum(["adopt_existing", "create_new"]),
    existingProjectId: z.string().uuid().nullable(),
    existingProjectName: z.string().trim().min(1).max(160).nullable(),
    workspaceCount: z.number().int().min(0),
    repositoryHint: z.string().trim().max(500).nullable(),
  }).strict()).max(100),
  roleDiff: z.array(z.object({
    templateKey: blueprintKeySchema,
    label: z.string().trim().min(1).max(160),
    role: z.enum(AGENT_ROLES),
    status: z.enum(["ready", "partial", "missing"]),
    requiredCount: z.number().int().min(0),
    existingCount: z.number().int().min(0),
    missingCount: z.number().int().min(0),
    matchingAgentNames: z.array(z.string().trim().min(1).max(160)).max(100),
    notes: z.array(z.string().trim().min(1).max(500)).max(100),
  }).strict()).max(100),
  readinessChecks: z.array(z.object({
    key: blueprintKeySchema,
    label: z.string().trim().min(1).max(160),
    status: z.enum(["ready", "warning", "missing"]),
    detail: z.string().trim().min(1).max(2_000),
  }).strict()).max(50),
  warnings: z.array(z.string().trim().min(1).max(2_000)).max(100),
}).strict();

export const teamBlueprintImportPreviewResultSchema = z.object({
  previewHash: z.string().trim().min(16).max(256),
  targetCompanyId: z.string().uuid(),
  definition: portableTeamBlueprintDefinitionSchema,
  saveAction: z.enum(["create", "replace"]),
  existingSavedBlueprintId: z.string().uuid().nullable(),
  collisionStrategy: teamBlueprintImportCollisionStrategySchema,
  preview: teamBlueprintPreviewResultSchema,
  warnings: z.array(z.string().trim().min(1).max(500)).max(50),
  errors: z.array(z.string().trim().min(1).max(500)).max(50),
}).strict();

export const teamBlueprintImportRequestSchema = teamBlueprintImportPreviewRequestSchema.extend({
  previewHash: z.string().trim().min(16).max(256),
}).strict();

export const teamBlueprintImportResultSchema = z.object({
  savedBlueprint: companySavedTeamBlueprintSchema,
  action: z.enum(["created", "updated"]),
  previewHash: z.string().trim().min(16).max(256),
  warnings: z.array(z.string().trim().min(1).max(500)).max(50),
}).strict();

export const teamBlueprintSavedUpdateRequestSchema = z.object({
  slug: blueprintKeySchema,
  label: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2_000).nullable(),
}).strict();

export const teamBlueprintSavedUpdateResultSchema = z.object({
  savedBlueprint: companySavedTeamBlueprintSchema,
}).strict();

export const teamBlueprintSavedDeleteResultSchema = z.object({
  ok: z.literal(true),
  deletedSavedBlueprintId: z.string().uuid(),
}).strict();

export const teamBlueprintSaveRequestSchema = teamBlueprintApplyRequestSchema.extend({
  slug: blueprintKeySchema,
  label: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2_000).nullable(),
  versionNote: z.string().trim().max(500).nullable().optional(),
}).strict();

export const teamBlueprintSaveResultSchema = z.object({
  savedBlueprint: companySavedTeamBlueprintSchema,
}).strict();

export const teamBlueprintSavedVersionCreateRequestSchema = teamBlueprintApplyRequestSchema.extend({
  slug: blueprintKeySchema.nullable().optional(),
  label: z.string().trim().min(1).max(160).nullable().optional(),
  description: z.string().trim().max(2_000).nullable().optional(),
  versionNote: z.string().trim().max(500).nullable().optional(),
}).strict();

export const teamBlueprintSavedVersionCreateResultSchema = z.object({
  savedBlueprint: companySavedTeamBlueprintSchema,
}).strict();
