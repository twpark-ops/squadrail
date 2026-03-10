import type { IssuePriority, IssueStatus } from "../constants.js";
import type { Goal } from "./goal.js";
import type { Project, ProjectWorkspace } from "./project.js";

export interface IssueAncestorProject {
  id: string;
  name: string;
  description: string | null;
  status: string;
  goalId: string | null;
  workspaces: ProjectWorkspace[];
  primaryWorkspace: ProjectWorkspace | null;
}

export interface IssueAncestorGoal {
  id: string;
  title: string;
  description: string | null;
  level: string;
  status: string;
}

export interface IssueAncestor {
  id: string;
  identifier: string | null;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  assigneeAgentId: string | null;
  assigneeUserId: string | null;
  projectId: string | null;
  goalId: string | null;
  project: IssueAncestorProject | null;
  goal: IssueAncestorGoal | null;
}

export interface IssueLabel {
  id: string;
  companyId: string;
  name: string;
  color: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface IssueAssigneeAdapterOverrides {
  adapterConfig?: Record<string, unknown>;
  useProjectWorkspace?: boolean;
}

export interface IssueInternalWorkItemSummary {
  total: number;
  backlog: number;
  todo: number;
  inProgress: number;
  inReview: number;
  blocked: number;
  done: number;
  cancelled: number;
  activeAssigneeAgentIds: string[];
  blockerIssueId: string | null;
  reviewRequestedIssueId: string | null;
}

export interface Issue {
  id: string;
  companyId: string;
  projectId: string | null;
  goalId: string | null;
  parentId: string | null;
  ancestors?: IssueAncestor[];
  title: string;
  description: string | null;
  status: IssueStatus;
  priority: IssuePriority;
  assigneeAgentId: string | null;
  assigneeUserId: string | null;
  checkoutRunId: string | null;
  executionRunId: string | null;
  executionAgentNameKey: string | null;
  executionLockedAt: Date | null;
  createdByAgentId: string | null;
  createdByUserId: string | null;
  issueNumber: number | null;
  identifier: string | null;
  requestDepth: number;
  billingCode: string | null;
  assigneeAdapterOverrides: IssueAssigneeAdapterOverrides | null;
  startedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  hiddenAt: Date | null;
  labelIds?: string[];
  labels?: IssueLabel[];
  internalWorkItems?: Issue[];
  internalWorkItemSummary?: IssueInternalWorkItemSummary;
  project?: Project | null;
  goal?: Goal | null;
  mentionedProjects?: Project[];
  createdAt: Date;
  updatedAt: Date;
}

export interface IssueComment {
  id: string;
  companyId: string;
  issueId: string;
  authorAgentId: string | null;
  authorUserId: string | null;
  body: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface IssueAttachment {
  id: string;
  companyId: string;
  issueId: string;
  issueCommentId: string | null;
  assetId: string;
  provider: string;
  objectKey: string;
  contentType: string;
  byteSize: number;
  sha256: string;
  originalFilename: string | null;
  createdByAgentId: string | null;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
  contentPath: string;
}

export interface IssueChangeSurfaceArtifact {
  messageId: string;
  messageType: string;
  createdAt: Date;
  kind: string;
  uri: string;
  label: string | null;
  metadata: Record<string, unknown> | null;
}

export interface IssueMergeCandidate {
  issueId: string;
  identifier: string | null;
  state: "pending" | "merged" | "rejected";
  sourceBranch: string | null;
  headSha: string | null;
  workspacePath: string | null;
  diffStat: string | null;
  changedFiles: string[];
  targetBaseBranch: string | null;
  mergeCommitSha: string | null;
  closeSummary: string | null;
  verificationSummary: string | null;
  rollbackPlan: string | null;
  approvalSummary: string | null;
  remainingRisks: string[];
  operatorNote: string | null;
  resolvedAt: Date | null;
  closeMessageId: string | null;
}

export interface IssueChangeSurface {
  issueId: string;
  identifier: string | null;
  title: string;
  issueStatus: IssueStatus;
  branchName: string | null;
  headSha: string | null;
  workspacePath: string | null;
  workspaceSource: string | null;
  workspaceState: string | null;
  changedFiles: string[];
  statusEntries: string[];
  diffStat: string | null;
  verificationSummary: string | null;
  closureSummary: string | null;
  latestRunArtifact: IssueChangeSurfaceArtifact | null;
  workspaceBindingArtifact: IssueChangeSurfaceArtifact | null;
  diffArtifact: IssueChangeSurfaceArtifact | null;
  approvalArtifact: IssueChangeSurfaceArtifact | null;
  verificationArtifacts: IssueChangeSurfaceArtifact[];
  mergeCandidate: IssueMergeCandidate | null;
}
