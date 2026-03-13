import type {
  AgentAdapterType,
  AgentRole,
  RolePackPresetKey,
  TeamBlueprintKey,
  TeamBlueprintProjectBinding,
  TeamBlueprintProjectKind,
} from "../constants.js";

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
}

export interface TeamBlueprintReadiness {
  requiredWorkspaceCount: number;
  knowledgeRequired: boolean;
  knowledgeSources: string[];
  approvalRequiredRoleKeys: string[];
  doctorSetupPrerequisites: string[];
  recommendedFirstQuickRequest: string;
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
}

export interface TeamBlueprintCatalogView {
  companyId: string;
  blueprints: TeamBlueprint[];
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
