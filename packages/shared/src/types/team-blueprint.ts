import type {
  AgentAdapterType,
  AgentRole,
  RolePackPresetKey,
  TeamBlueprintKey,
  TeamBlueprintProjectBinding,
  TeamBlueprintProjectKind,
} from "../constants.js";
import type { SetupProgressView } from "./setup.js";

export interface TeamBlueprintProjectTemplate {
  key: string;
  label: string;
  description: string | null;
  kind: TeamBlueprintProjectKind;
  repositoryHint: string | null;
  defaultLeadRoleKey: string | null;
}

export interface TeamBlueprintRoleTemplate {
  key: string;
  label: string;
  role: AgentRole;
  title: string | null;
  reportsToKey: string | null;
  projectBinding: TeamBlueprintProjectBinding;
  preferredAdapterTypes: AgentAdapterType[];
  deliveryLane: string | null;
  capabilities: string[];
}

export interface TeamBlueprintParameterHints {
  supportsPm: boolean;
  supportsQa: boolean;
  supportsCto: boolean;
  defaultProjectCount: number;
  defaultEngineerPairsPerProject: number;
  editors?: TeamBlueprintParameterEditors;
}

export interface TeamBlueprintNumberParameterEditor {
  label: string;
  description: string;
  min: number;
  max: number;
  step: number;
}

export interface TeamBlueprintToggleParameterEditor {
  label: string;
  description: string;
  editable: boolean;
}

export interface TeamBlueprintParameterEditors {
  projectCount: TeamBlueprintNumberParameterEditor;
  engineerPairsPerProject: TeamBlueprintNumberParameterEditor;
  includePm: TeamBlueprintToggleParameterEditor;
  includeQa: TeamBlueprintToggleParameterEditor;
  includeCto: TeamBlueprintToggleParameterEditor;
}

export interface TeamBlueprintReadiness {
  requiredWorkspaceCount: number;
  knowledgeRequired: boolean;
  knowledgeSources: string[];
  approvalRequiredRoleKeys: string[];
  doctorSetupPrerequisites: string[];
  recommendedFirstQuickRequest: string;
}

export interface TeamBlueprintPortability {
  companyAgnostic: boolean;
  workspaceModel: "single_workspace" | "per_project";
  knowledgeModel: "optional" | "recommended" | "required";
  migrationHelperKeys: string[];
  notes: string[];
}

export interface TeamBlueprintCanonicalAbsorptionProjectMapping {
  canonicalProjectSlug: string;
  canonicalProjectName: string;
  blueprintSlotKey: string;
  blueprintTemplateKey: string;
  expectedLeadRoleKey: string | null;
}

export interface TeamBlueprintCanonicalAbsorptionPrep {
  canonicalTemplateKey: string;
  canonicalVersion: string;
  blueprintKey: TeamBlueprintKey;
  previewRequest: TeamBlueprintPreviewRequest;
  projectMappings: TeamBlueprintCanonicalAbsorptionProjectMapping[];
  warnings: string[];
}

export interface TeamBlueprintMigrationHelper extends TeamBlueprintCanonicalAbsorptionPrep {
  key: string;
  kind: "canonical_absorption";
  label: string;
  description: string;
}

export interface TeamBlueprint {
  key: TeamBlueprintKey;
  label: string;
  description: string;
  presetKey: RolePackPresetKey;
  projects: TeamBlueprintProjectTemplate[];
  roles: TeamBlueprintRoleTemplate[];
  parameterHints: TeamBlueprintParameterHints;
  readiness: TeamBlueprintReadiness;
  portability: TeamBlueprintPortability;
}

export interface PortableTeamBlueprintDefinition {
  slug: string;
  label: string;
  description: string;
  sourceBlueprintKey: TeamBlueprintKey | null;
  presetKey: RolePackPresetKey;
  projects: TeamBlueprintProjectTemplate[];
  roles: TeamBlueprintRoleTemplate[];
  parameterHints: TeamBlueprintParameterHints;
  readiness: TeamBlueprintReadiness;
  portability: TeamBlueprintPortability;
}

export interface SavedTeamBlueprintSourceMetadata {
  type: "builtin_export" | "import_bundle";
  companyId: string | null;
  companyName: string | null;
  blueprintKey: TeamBlueprintKey | null;
  generatedAt: string;
}

export interface CompanySavedTeamBlueprint {
  id: string;
  companyId: string;
  definition: PortableTeamBlueprintDefinition;
  defaultPreviewRequest: TeamBlueprintPreviewRequest;
  sourceMetadata: SavedTeamBlueprintSourceMetadata;
  createdAt: string;
  updatedAt: string;
}

export interface TeamBlueprintCatalogView {
  companyId: string;
  blueprints: TeamBlueprint[];
  savedBlueprints: CompanySavedTeamBlueprint[];
  migrationHelpers: TeamBlueprintMigrationHelper[];
}

export interface TeamBlueprintPreviewRequest {
  projectCount?: number | null;
  engineerPairsPerProject?: number | null;
  includePm?: boolean | null;
  includeQa?: boolean | null;
  includeCto?: boolean | null;
}

export interface TeamBlueprintPreviewParameters {
  projectCount: number;
  engineerPairsPerProject: number;
  includePm: boolean;
  includeQa: boolean;
  includeCto: boolean;
}

export interface TeamBlueprintPreviewProjectDiff {
  slotKey: string;
  templateKey: string;
  label: string;
  kind: TeamBlueprintProjectKind;
  status: "adopt_existing" | "create_new";
  existingProjectId: string | null;
  existingProjectName: string | null;
  workspaceCount: number;
  repositoryHint: string | null;
}

export interface TeamBlueprintPreviewRoleDiff {
  templateKey: string;
  label: string;
  role: AgentRole;
  status: "ready" | "partial" | "missing";
  requiredCount: number;
  existingCount: number;
  missingCount: number;
  matchingAgentNames: string[];
  notes: string[];
}

export interface TeamBlueprintPreviewReadinessCheck {
  key: string;
  label: string;
  status: "ready" | "warning" | "missing";
  detail: string;
}

export interface TeamBlueprintPreviewResult {
  companyId: string;
  previewHash: string;
  blueprint: TeamBlueprint;
  parameters: TeamBlueprintPreviewParameters;
  summary: {
    currentProjectCount: number;
    currentWorkspaceCount: number;
    currentAgentCount: number;
    adoptedProjectCount: number;
    createProjectCount: number;
    matchedRoleCount: number;
    missingRoleCount: number;
  };
  projectDiff: TeamBlueprintPreviewProjectDiff[];
  roleDiff: TeamBlueprintPreviewRoleDiff[];
  readinessChecks: TeamBlueprintPreviewReadinessCheck[];
  warnings: string[];
}

export interface TeamBlueprintApplyRequest extends TeamBlueprintPreviewRequest {
  previewHash: string;
}

export interface TeamBlueprintApplyProjectResult {
  slotKey: string;
  templateKey: string;
  label: string;
  action: "adopt_existing" | "create_new";
  projectId: string;
  projectName: string;
}

export interface TeamBlueprintApplyRoleResult {
  slotKey: string;
  templateKey: string;
  label: string;
  action: "adopt_existing" | "create_new" | "update_existing";
  agentId: string;
  agentName: string;
  reportsToAgentId: string | null;
  updated: boolean;
}

export interface TeamBlueprintApplyResult {
  companyId: string;
  blueprintKey: TeamBlueprintKey;
  previewHash: string;
  parameters: TeamBlueprintPreviewParameters;
  summary: {
    adoptedProjectCount: number;
    createdProjectCount: number;
    adoptedAgentCount: number;
    createdAgentCount: number;
    updatedAgentCount: number;
    seededRolePackCount: number;
    existingRolePackCount: number;
  };
  projectResults: TeamBlueprintApplyProjectResult[];
  roleResults: TeamBlueprintApplyRoleResult[];
  setupProgress: SetupProgressView;
  warnings: string[];
}

export interface TeamBlueprintExportBundle {
  schemaVersion: number;
  generatedAt: string;
  source: {
    companyId: string;
    companyName: string | null;
    blueprintKey: TeamBlueprintKey | null;
    blueprintLabel: string;
  };
  definition: PortableTeamBlueprintDefinition;
  defaultPreviewRequest: TeamBlueprintPreviewRequest;
}

export interface TeamBlueprintExportResult {
  bundle: TeamBlueprintExportBundle;
  warnings: string[];
}

export type TeamBlueprintImportSource =
  | {
      type: "inline";
      bundle: TeamBlueprintExportBundle;
    };

export type TeamBlueprintImportCollisionStrategy = "rename" | "replace";

export interface TeamBlueprintImportPreviewRequest {
  source: TeamBlueprintImportSource;
  slug?: string | null;
  label?: string | null;
  collisionStrategy?: TeamBlueprintImportCollisionStrategy | null;
}

export interface TeamBlueprintImportPreviewResult {
  previewHash: string;
  targetCompanyId: string;
  definition: PortableTeamBlueprintDefinition;
  saveAction: "create" | "replace";
  existingSavedBlueprintId: string | null;
  collisionStrategy: TeamBlueprintImportCollisionStrategy;
  preview: TeamBlueprintPreviewResult;
  warnings: string[];
  errors: string[];
}

export interface TeamBlueprintImportRequest extends TeamBlueprintImportPreviewRequest {
  previewHash: string;
}

export interface TeamBlueprintImportResult {
  savedBlueprint: CompanySavedTeamBlueprint;
  action: "created" | "updated";
  previewHash: string;
  warnings: string[];
}
