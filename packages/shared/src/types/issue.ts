import type {
  IssueDocumentKey,
  IssuePriority,
  IssueProtocolRole,
  IssueProtocolWorkflowState,
  IssueStatus,
} from "../constants.js";
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
  labelIds?: string[];
  labels?: IssueLabel[];
  internalWorkItems?: Issue[];
  internalWorkItemSummary?: IssueInternalWorkItemSummary;
  project?: Project | null;
  goal?: Goal | null;
  mentionedProjects?: Project[];
  progressSnapshot?: IssueProgressSnapshot;
  runtimeSummary?: IssueRuntimeSummary;
  createdAt: Date;
  updatedAt: Date;
}

export type IssueProgressPhase =
  | "intake"
  | "clarification"
  | "planning"
  | "implementing"
  | "review"
  | "qa"
  | "merge"
  | "blocked"
  | "done"
  | "cancelled";

export type IssueProgressOwnerRole = "pm" | "tech_lead" | "engineer" | "reviewer" | "qa" | null;

export type IssueProgressReviewState = "idle" | "waiting_review" | "in_review" | "changes_requested" | "approved";

export type IssueProgressQaState = "not_required" | "pending" | "running" | "passed" | "failed";

export interface IssueProgressSubtaskSummary {
  total: number;
  done: number;
  open: number;
  blocked: number;
  inReview: number;
}

export interface IssueProgressSnapshot {
  phase: IssueProgressPhase;
  headline: string;
  activeOwnerRole: IssueProgressOwnerRole;
  activeOwnerAgentId: string | null;
  blockedReason: string | null;
  pendingClarificationCount: number;
  subtaskSummary: IssueProgressSubtaskSummary;
  reviewState: IssueProgressReviewState;
  qaState: IssueProgressQaState;
  latestArtifactKinds: string[];
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

export interface IssueChangeSurfaceRetrievalRun {
  briefScope: string;
  briefId: string;
  retrievalRunId: string;
  createdAt: Date;
  confidenceLevel: "high" | "medium" | "low" | null;
  graphHitCount: number;
  multiHopGraphHitCount: number;
  personalized: boolean;
  candidateCacheHit: boolean;
  finalCacheHit: boolean;
}

export interface IssueChangeSurfaceFeedbackSummary {
  positiveCount: number;
  negativeCount: number;
  pinnedPathCount: number;
  hiddenPathCount: number;
  lastFeedbackAt: Date | null;
  feedbackTypeCounts: Record<string, number>;
}

export interface IssueChangeSurfaceCitationSummary {
  messageCount: number;
  citationCount: number;
  messageTypeCounts: Record<string, number>;
  retrievalRunIds: string[];
  briefIds: string[];
  citedPaths: string[];
  citedSourceTypes: string[];
  citedSummaryKinds: string[];
  latestMessageType: string | null;
  latestMessageAt: Date | null;
}

export interface IssueChangeSurfaceClarificationTrace {
  pendingCount: number;
  latestPendingQuestion: string | null;
  latestPendingAt: Date | null;
  latestPendingResumeWorkflowState: IssueProtocolWorkflowState | null;
  latestResolvedAt: Date | null;
  latestResolvedQuestion: string | null;
  latestResolvedAnswer: string | null;
  latestResolvedResumeWorkflowState: IssueProtocolWorkflowState | null;
  latestAskedByRole: IssueProtocolRole | null;
  latestAnsweredByRole: IssueProtocolRole | null;
}

export interface IssueMergeCandidateCheck {
  name: string;
  status: "queued" | "pending" | "running" | "success" | "failure" | "error" | "cancelled" | "skipped" | "neutral" | "unknown";
  conclusion: string | null;
  summary: string | null;
  detailsUrl: string | null;
  required: boolean;
}

export interface IssueMergeCandidateCheckSummary {
  total: number;
  passing: number;
  failing: number;
  pending: number;
  requiredTotal: number;
  requiredPassing: number;
  requiredFailing: number;
  requiredPending: number;
}

export interface IssueMergeCandidatePrBridge {
  provider: "github" | "gitlab";
  repoOwner: string;
  repoName: string;
  repoUrl: string | null;
  remoteUrl: string | null;
  number: number | null;
  externalId: string | null;
  url: string | null;
  title: string | null;
  state: "draft" | "open" | "merged" | "closed" | "unknown";
  mergeability: "mergeable" | "conflicting" | "blocked" | "unknown";
  headBranch: string | null;
  baseBranch: string | null;
  headSha: string | null;
  reviewDecision: string | null;
  commentCount: number;
  reviewCommentCount: number;
  lastSyncedAt: Date | null;
  checks: IssueMergeCandidateCheck[];
  checkSummary: IssueMergeCandidateCheckSummary;
}

export interface IssueMergeCandidateGateStatus {
  ciReady: boolean;
  mergeReady: boolean;
  closeReady: boolean;
  requiredChecksConfigured: boolean;
  blockingReasons: string[];
}

export interface IssueMergeCandidateConflictAssist {
  status: "clean" | "warning" | "conflicting";
  summary: string;
  blockers: string[];
  suggestedActions: string[];
}

export interface IssueMergeCandidateFailureAssist {
  status: "clean" | "watch" | "blocked";
  summary: string;
  retryability: "retryable" | "operator_required" | "blocked" | "clean";
  failureFamily:
    | "dispatch"
    | "runtime_process"
    | "workspace"
    | null;
  blockers: string[];
  suggestedActions: string[];
  repeatedFailureCount24h: number;
  lastSeenAt: Date | null;
}

export interface IssueMergeCandidateTemplateTrace {
  id: string;
  label: string;
  scope: "default" | "company";
}

export interface IssueMergeCandidateRevertAssist {
  status: "none" | "watch" | "ready";
  summary: string;
  rollbackPlan: string | null;
  mergeCommitSha: string | null;
  followUpIssueIds: string[];
  suggestedTitle: string | null;
  canCreateFollowUp: boolean;
  canReopen: boolean;
  lastActionSummary: string | null;
  lastActionAt: Date | null;
  lastCreatedIssueId: string | null;
  lastCreatedIssueIdentifier: string | null;
}

export interface IssueMergeCandidateRecoveryResult {
  actionType: "create_revert_followup" | "reopen_with_rollback_context";
  sourceIssueId: string;
  createdIssueId: string | null;
  createdIssueIdentifier: string | null;
  reopened: boolean;
  commentId: string | null;
  summary: string;
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
  automationMetadata: Record<string, unknown> | null;
  operatorNote: string | null;
  resolvedAt: Date | null;
  closeMessageId: string | null;
  prBridge: IssueMergeCandidatePrBridge | null;
  gateStatus: IssueMergeCandidateGateStatus | null;
  conflictAssist: IssueMergeCandidateConflictAssist | null;
  failureAssist: IssueMergeCandidateFailureAssist | null;
  templateTrace: IssueMergeCandidateTemplateTrace | null;
  revertAssist: IssueMergeCandidateRevertAssist | null;
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
  clarificationTrace: IssueChangeSurfaceClarificationTrace | null;
  latestRunArtifact: IssueChangeSurfaceArtifact | null;
  workspaceBindingArtifact: IssueChangeSurfaceArtifact | null;
  diffArtifact: IssueChangeSurfaceArtifact | null;
  approvalArtifact: IssueChangeSurfaceArtifact | null;
  verificationArtifacts: IssueChangeSurfaceArtifact[];
  retrievalContext: {
    latestRuns: IssueChangeSurfaceRetrievalRun[];
    feedbackSummary: IssueChangeSurfaceFeedbackSummary;
    citationSummary: IssueChangeSurfaceCitationSummary;
  };
  mergeCandidate: IssueMergeCandidate | null;
}

export interface IssueDeliverable {
  id: string;
  source: "attachment" | "protocol_artifact";
  kind:
    | "file"
    | "diff"
    | "approval"
    | "test_run"
    | "build_run"
    | "workspace_binding"
    | "run_log"
    | "report"
    | "preview";
  label: string;
  summary: string | null;
  href: string | null;
  contentType: string | null;
  createdAt: Date;
  createdByRole: string | null;
  metadata: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// Issue Documents
// ---------------------------------------------------------------------------

export type IssueDocumentFormat = "markdown";

export interface IssueDocumentSummary {
  id: string;
  issueId: string;
  key: IssueDocumentKey;
  title: string;
  format: IssueDocumentFormat;
  revisionNumber: number;
  createdByAgentId: string | null;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IssueDocument extends IssueDocumentSummary {
  body: string;
}

export interface IssueDocumentRevision {
  id: string;
  documentId: string;
  revisionNumber: number;
  title: string;
  body: string;
  createdByAgentId: string | null;
  createdByUserId: string | null;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// Issue Runtime Summary
// ---------------------------------------------------------------------------

export interface IssueRuntimeSummary {
  workspaceUsage: "analysis" | "implementation" | "review" | null;
  workspaceSource: "project_shared" | "project_isolated" | null;
  workspaceState:
    | "fresh"
    | "reused_clean"
    | "resumed_dirty"
    | "recreated_clean"
    | "recovered_existing"
    | null;
  workspacePath: string | null;
  branchName: string | null;
  headline: string;
  detail: string | null;
  severity: "info" | "warning" | "risk";
}

// ---------------------------------------------------------------------------

export interface PmIntakeProjectionPreviewRequest {
  projectId?: string | null;
  techLeadAgentId?: string | null;
  reviewerAgentId?: string | null;
  qaAgentId?: string | null;
  coordinationOnly?: boolean;
  requiredKnowledgeTags?: string[];
}

export interface PmIntakeProjectionPreviewProjectCandidate {
  projectId: string;
  projectName: string;
  score: number;
  selected: boolean;
  reasons: string[];
}

export interface PmIntakeProjectionPreviewRoot {
  structuredTitle?: string;
  projectId?: string | null;
  priority?: IssuePriority;
  executionSummary: string;
  acceptanceCriteria: string[];
  definitionOfDone: string[];
  risks?: string[];
  openQuestions?: string[];
  documentationDebt?: string[];
}

export interface PmIntakeProjectionPreviewWorkItem {
  title: string;
  description?: string | null;
  kind: "plan" | "implementation" | "review" | "qa";
  projectId?: string | null;
  priority?: IssuePriority;
  assigneeAgentId: string;
  reviewerAgentId: string;
  qaAgentId?: string | null;
  goal?: string;
  acceptanceCriteria: string[];
  definitionOfDone: string[];
  deadlineAt?: string | null;
  requiredKnowledgeTags?: string[];
  relatedIssueIds?: string[];
  watchReviewer?: boolean;
  watchLead?: boolean;
}

export interface PmIntakeProjectionPreviewResult {
  companyId: string;
  issueId: string;
  selectedProjectId: string | null;
  selectedProjectName: string | null;
  projectCandidates: PmIntakeProjectionPreviewProjectCandidate[];
  staffing: {
    techLeadAgentId: string;
    techLeadName: string;
    reviewerAgentId: string;
    reviewerName: string;
    qaAgentId: string | null;
    qaName: string | null;
    implementationAssigneeAgentId: string;
    implementationAssigneeName: string;
  };
  draft: {
    reason: string;
    techLeadAgentId: string;
    reviewerAgentId: string;
    qaAgentId: string | null;
    coordinationOnly: boolean;
    root: PmIntakeProjectionPreviewRoot;
    workItems: PmIntakeProjectionPreviewWorkItem[];
  };
  warnings: string[];
}
