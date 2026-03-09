import type {
  ProjectStatus,
  ProjectWorkspaceExecutionMode,
  ProjectWorkspaceIsolationStrategy,
  ProjectWorkspaceUsageProfile,
} from "../constants.js";

export interface ProjectGoalRef {
  id: string;
  title: string;
}

export interface ProjectWorkspaceExecutionPolicy {
  mode: ProjectWorkspaceExecutionMode;
  applyFor: ProjectWorkspaceUsageProfile[];
  isolationStrategy: ProjectWorkspaceIsolationStrategy | null;
  isolatedRoot: string | null;
  branchTemplate: string | null;
  writable: boolean;
}

export interface ProjectWorkspace {
  id: string;
  companyId: string;
  projectId: string;
  name: string;
  cwd: string | null;
  repoUrl: string | null;
  repoRef: string | null;
  metadata: Record<string, unknown> | null;
  executionPolicy: ProjectWorkspaceExecutionPolicy | null;
  isPrimary: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Project {
  id: string;
  companyId: string;
  urlKey: string;
  /** @deprecated Use goalIds / goals instead */
  goalId: string | null;
  goalIds: string[];
  goals: ProjectGoalRef[];
  name: string;
  description: string | null;
  status: ProjectStatus;
  leadAgentId: string | null;
  targetDate: string | null;
  color: string | null;
  workspaces: ProjectWorkspace[];
  primaryWorkspace: ProjectWorkspace | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
