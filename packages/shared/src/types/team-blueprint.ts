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
