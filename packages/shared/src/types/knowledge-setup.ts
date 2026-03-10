export type OrgSyncStatus = "in_sync" | "repairable" | "drifted";

export interface OrgSyncExpectedAgent {
  canonicalSlug: string;
  name: string;
  role: string;
  title: string | null;
  adapterType: string;
  reportsToSlug: string | null;
  projectSlug: string | null;
  deliveryLane: string | null;
}

export interface OrgSyncMissingAgent extends OrgSyncExpectedAgent {}

export interface OrgSyncExtraAgent {
  agentId: string;
  urlKey: string;
  name: string;
  role: string;
  title: string | null;
  status: string;
  projectSlug: string | null;
  reason: string;
}

export interface OrgSyncMismatch {
  agentId: string;
  canonicalSlug: string;
  liveUrlKey: string;
  mismatchKeys: string[];
  expected: Record<string, unknown>;
  actual: Record<string, unknown>;
}

export interface OrgSyncView {
  companyId: string;
  templateKey: string | null;
  templateConfigured: boolean;
  canonicalVersion: string;
  canonicalAgentCount: number;
  liveAgentCount: number;
  matchedAgentCount: number;
  status: OrgSyncStatus;
  missingAgents: OrgSyncMissingAgent[];
  extraAgents: OrgSyncExtraAgent[];
  mismatchedAgents: OrgSyncMismatch[];
  generatedAt: string;
}

export interface OrgSyncRepairResult {
  companyId: string;
  createdAgentIds: string[];
  updatedAgentIds: string[];
  pausedAgentIds: string[];
  adoptedAgentIds: string[];
  statusBefore: OrgSyncStatus;
  statusAfter: OrgSyncStatus;
  orgSync: OrgSyncView;
}

export type KnowledgeSyncJobStatus = "queued" | "running" | "completed" | "failed";
export type KnowledgeSetupProjectStatus = "ready" | "missing_workspace" | "needs_import" | "stale";

export interface KnowledgeSetupWorkspaceState {
  workspaceId: string | null;
  workspaceName: string | null;
  cwd: string | null;
  repoUrl: string | null;
  repoRef: string | null;
  exists: boolean;
  currentBranch: string | null;
  currentHeadSha: string | null;
}

export interface KnowledgeSetupProjectMetrics {
  documentCount: number;
  chunkCount: number;
  linkCount: number;
  symbolEdgeCount: number;
  versionCount: number;
  revision: number;
  lastHeadSha: string | null;
  lastImportMode: string | null;
  lastImportedAt: string | null;
}

export interface KnowledgeSetupPersonalizationMetrics {
  feedbackCount: number;
  profileCount: number;
  lastFeedbackAt: string | null;
}

export interface KnowledgeSetupProjectView {
  projectId: string;
  projectName: string;
  projectStatus: KnowledgeSetupProjectStatus;
  syncIssues: string[];
  workspace: KnowledgeSetupWorkspaceState;
  knowledge: KnowledgeSetupProjectMetrics;
  personalization: KnowledgeSetupPersonalizationMetrics;
}

export interface KnowledgeSyncJobProjectRun {
  id: string;
  jobId: string;
  projectId: string;
  workspaceId: string | null;
  status: KnowledgeSyncJobStatus;
  stepJson: Record<string, unknown>;
  resultJson: Record<string, unknown>;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeSyncJobView {
  id: string;
  companyId: string;
  status: KnowledgeSyncJobStatus;
  selectedProjectIds: string[];
  optionsJson: Record<string, unknown>;
  summaryJson: Record<string, unknown>;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  projectRuns: KnowledgeSyncJobProjectRun[];
}

export interface KnowledgeSetupView {
  companyId: string;
  generatedAt: string;
  setupProgressStatus: string;
  orgSync: OrgSyncView;
  projects: KnowledgeSetupProjectView[];
  activeJobCount: number;
  latestJob: KnowledgeSyncJobView | null;
  recentJobs: KnowledgeSyncJobView[];
}
