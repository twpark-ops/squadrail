import type { ProjectWorkspaceExecutionPolicy } from "./project.js";

export interface CompanyPortabilityInclude {
  company: boolean;
  projects: boolean;
  agents: boolean;
}

export interface CompanyPortabilitySecretRequirement {
  key: string;
  description: string | null;
  agentSlug: string | null;
  providerHint: string | null;
}

export interface CompanyPortabilityCompanyManifestEntry {
  path: string;
  name: string;
  description: string | null;
  brandColor: string | null;
  requireBoardApprovalForNewAgents: boolean;
}

export interface CompanyPortabilityAgentManifestEntry {
  slug: string;
  name: string;
  path: string;
  role: string;
  title: string | null;
  icon: string | null;
  capabilities: string | null;
  reportsToSlug: string | null;
  adapterType: string;
  adapterConfig: Record<string, unknown>;
  runtimeConfig: Record<string, unknown>;
  permissions: Record<string, unknown>;
  budgetMonthlyCents: number;
  metadata: Record<string, unknown> | null;
}

export interface CompanyPortabilityProjectWorkspaceManifestEntry {
  name: string;
  cwd: string | null;
  repoUrl: string | null;
  repoRef: string | null;
  metadata: Record<string, unknown> | null;
  executionPolicy: ProjectWorkspaceExecutionPolicy | null;
  isPrimary: boolean;
}

export interface CompanyPortabilityProjectManifestEntry {
  slug: string;
  name: string;
  description: string | null;
  status: string;
  leadAgentSlug: string | null;
  targetDate: string | null;
  color: string | null;
  archivedAt: string | null;
  workspaces: CompanyPortabilityProjectWorkspaceManifestEntry[];
}

export interface CompanyPortabilityManifest {
  schemaVersion: number;
  generatedAt: string;
  source: {
    companyId: string;
    companyName: string;
  } | null;
  includes: CompanyPortabilityInclude;
  company: CompanyPortabilityCompanyManifestEntry | null;
  projects: CompanyPortabilityProjectManifestEntry[];
  agents: CompanyPortabilityAgentManifestEntry[];
  requiredSecrets: CompanyPortabilitySecretRequirement[];
}

export interface CompanyPortabilityExportResult {
  manifest: CompanyPortabilityManifest;
  files: Record<string, string>;
  warnings: string[];
}

export type CompanyPortabilitySource =
  | {
      type: "inline";
      manifest: CompanyPortabilityManifest;
      files: Record<string, string>;
    }
  | {
      type: "url";
      url: string;
    }
  | {
      type: "github";
      url: string;
    };

export type CompanyPortabilityImportTarget =
  | {
      mode: "new_company";
      newCompanyName?: string | null;
    }
  | {
      mode: "existing_company";
      companyId: string;
    };

export type CompanyPortabilityAgentSelection = "all" | string[];

export type CompanyPortabilityCollisionStrategy = "rename" | "skip" | "replace";

export interface CompanyPortabilityPreviewRequest {
  source: CompanyPortabilitySource;
  include?: Partial<CompanyPortabilityInclude>;
  target: CompanyPortabilityImportTarget;
  agents?: CompanyPortabilityAgentSelection;
  collisionStrategy?: CompanyPortabilityCollisionStrategy;
}

export interface CompanyPortabilityPreviewAgentPlan {
  slug: string;
  action: "create" | "update" | "skip";
  plannedName: string;
  existingAgentId: string | null;
  reason: string | null;
}

export interface CompanyPortabilityPreviewProjectPlan {
  slug: string;
  action: "create" | "update" | "skip";
  plannedName: string;
  existingProjectId: string | null;
  reason: string | null;
}

export interface CompanyPortabilityPreviewResult {
  include: CompanyPortabilityInclude;
  targetCompanyId: string | null;
  targetCompanyName: string | null;
  collisionStrategy: CompanyPortabilityCollisionStrategy;
  selectedProjectSlugs: string[];
  selectedAgentSlugs: string[];
  plan: {
    companyAction: "none" | "create" | "update";
    projectPlans: CompanyPortabilityPreviewProjectPlan[];
    agentPlans: CompanyPortabilityPreviewAgentPlan[];
  };
  requiredSecrets: CompanyPortabilitySecretRequirement[];
  warnings: string[];
  errors: string[];
}

export interface CompanyPortabilityImportRequest extends CompanyPortabilityPreviewRequest {}

export interface CompanyPortabilityImportResult {
  company: {
    id: string;
    name: string;
    action: "created" | "updated" | "unchanged";
  };
  projects: {
    slug: string;
    id: string | null;
    action: "created" | "updated" | "skipped";
    name: string;
    reason: string | null;
  }[];
  agents: {
    slug: string;
    id: string | null;
    action: "created" | "updated" | "skipped";
    name: string;
    reason: string | null;
  }[];
  requiredSecrets: CompanyPortabilitySecretRequirement[];
  warnings: string[];
}

export interface CompanyPortabilityExportRequest {
  include?: Partial<CompanyPortabilityInclude>;
}
