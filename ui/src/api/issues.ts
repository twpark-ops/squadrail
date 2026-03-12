import type {
  CreateInternalWorkItem,
  CreatePmIntakeIssue,
  CreatePmIntakeProjection,
  Approval,
  CreateIssueProtocolMessage,
  Issue,
  IssueAttachment,
  IssueChangeSurface,
  IssueComment,
  IssueLabel,
  IssueMergeCandidate,
  IssueProtocolMessage,
  IssueProtocolState,
  IssueProtocolViolation,
  IssueReviewCycle,
  IssueTaskBrief,
} from "@squadrail/shared";
import { api } from "./client";

export type MergeCandidateResolutionInput = {
  actionType: "mark_merged" | "mark_rejected";
  noteBody?: string | null;
  targetBaseBranch?: string | null;
  mergeCommitSha?: string | null;
};

export type MergeCandidateAutomationInput = {
  actionType:
    | "prepare_merge"
    | "export_patch"
    | "export_pr_bundle"
    | "merge_local"
    | "cherry_pick_local"
    | "push_branch"
    | "sync_pr_bridge";
  targetBaseBranch?: string | null;
  integrationBranchName?: string | null;
  remoteName?: string | null;
  branchName?: string | null;
  pushAfterAction?: boolean;
};

export type MergeAutomationPlan = {
  issueId: string;
  identifier: string | null;
  title: string;
  candidateState: "pending" | "merged" | "rejected";
  projectId: string | null;
  projectName: string | null;
  sourceBranch: string | null;
  sourceHeadSha: string | null;
  sourceWorkspacePath: string | null;
  sourceHeadCurrent: string | null;
  sourceHasLocalChanges: boolean;
  sourceComparisonRef: string | null;
  baseWorkspaceId: string | null;
  baseWorkspaceName: string | null;
  baseWorkspacePath: string | null;
  targetBaseBranch: string | null;
  targetStartRef: string | null;
  integrationBranchName: string | null;
  automationWorktreePath: string | null;
  remoteName: string | null;
  remoteUrl: string | null;
  checks: Record<string, boolean>;
  warnings: string[];
  canAutomate: boolean;
  automationMetadata: Record<string, unknown> | null;
};

export type MergeAutomationActionResult = {
  actionType: MergeCandidateAutomationInput["actionType"];
  ok: boolean;
  plan: MergeAutomationPlan;
  patchPath?: string | null;
  prBundlePath?: string | null;
  prPayloadPath?: string | null;
  targetBranch?: string | null;
  remoteName?: string | null;
  remoteUrl?: string | null;
  pushed?: boolean;
  pushedBranch?: string | null;
  automationWorktreePath?: string | null;
  mergeCommitSha?: string | null;
  cherryPickedCommitShas?: string[];
  externalProvider?: "github" | "gitlab" | null;
  externalNumber?: number | null;
  externalUrl?: string | null;
};

export type MergeCandidateAutomationResponse = {
  result: MergeAutomationActionResult;
  mergeCandidate: IssueMergeCandidate | null;
};

export type CreatePmIntakeIssueResponse = {
  issue: Issue;
  protocol: unknown;
  warnings: string[];
  intake: {
    pmAgentId: string;
    reviewerAgentId: string;
  };
};

export type CreatePmIntakeProjectionResponse = {
  issue: Issue;
  protocol: unknown;
  warnings: string[];
  projectedWorkItems: Issue[];
  intakeProjection: {
    techLeadAgentId: string;
    reviewerAgentId: string;
    qaAgentId: string | null;
  };
};

export type CreateInternalWorkItemResponse = {
  issue: Issue;
  protocol: unknown;
  warnings: string[];
};

export const issuesApi = {
  list: (
    companyId: string,
    filters?: {
      status?: string;
      projectId?: string;
      assigneeAgentId?: string;
      assigneeUserId?: string;
      labelId?: string;
      q?: string;
    },
  ) => {
    const params = new URLSearchParams();
    if (filters?.status) params.set("status", filters.status);
    if (filters?.projectId) params.set("projectId", filters.projectId);
    if (filters?.assigneeAgentId) params.set("assigneeAgentId", filters.assigneeAgentId);
    if (filters?.assigneeUserId) params.set("assigneeUserId", filters.assigneeUserId);
    if (filters?.labelId) params.set("labelId", filters.labelId);
    if (filters?.q) params.set("q", filters.q);
    const qs = params.toString();
    return api.get<Issue[]>(`/companies/${companyId}/issues${qs ? `?${qs}` : ""}`);
  },
  listLabels: (companyId: string) => api.get<IssueLabel[]>(`/companies/${companyId}/labels`),
  createLabel: (companyId: string, data: { name: string; color: string }) =>
    api.post<IssueLabel>(`/companies/${companyId}/labels`, data),
  deleteLabel: (id: string) => api.delete<IssueLabel>(`/labels/${id}`),
  get: (id: string) => api.get<Issue>(`/issues/${id}`),
  getProtocolState: (id: string) => api.get<IssueProtocolState | null>(`/issues/${id}/protocol/state`),
  listProtocolMessages: (id: string) => api.get<IssueProtocolMessage[]>(`/issues/${id}/protocol/messages`),
  createProtocolMessage: (id: string, data: CreateIssueProtocolMessage) =>
    api.post<{ message: IssueProtocolMessage; state: IssueProtocolState }>(`/issues/${id}/protocol/messages`, data),
  listProtocolBriefs: (id: string, opts: { scope?: string; latest?: boolean } = {}) => {
    const params = new URLSearchParams();
    if (opts.scope) params.set("scope", opts.scope);
    if (opts.latest) params.set("latest", "true");
    const qs = params.toString();
    return api.get<IssueTaskBrief | IssueTaskBrief[]>(`/issues/${id}/protocol/briefs${qs ? `?${qs}` : ""}`);
  },
  listProtocolReviewCycles: (id: string) => api.get<IssueReviewCycle[]>(`/issues/${id}/protocol/review-cycles`),
  listProtocolViolations: (id: string, status?: string) =>
    api.get<IssueProtocolViolation[]>(`/issues/${id}/protocol/violations${status ? `?status=${encodeURIComponent(status)}` : ""}`),
  getChangeSurface: (id: string) => api.get<IssueChangeSurface>(`/issues/${id}/change-surface`),
  recordRetrievalFeedback: (
    id: string,
    data: {
      retrievalRunId: string;
      feedbackType: "operator_pin" | "operator_hide";
      targetType: "chunk" | "path" | "symbol" | "source_type";
      targetIds: string[];
      noteBody?: string | null;
    },
  ) => api.post<{
    ok: boolean;
    feedbackEventCount: number;
    profiledRunCount: number;
    retrievalRunIds: string[];
  }>(`/issues/${id}/retrieval-feedback`, data),
  getMergeCandidate: (id: string) => api.get<IssueMergeCandidate>(`/issues/${id}/merge-candidate`),
  resolveMergeCandidate: (id: string, data: MergeCandidateResolutionInput) =>
    api.post<IssueMergeCandidate>(`/issues/${id}/merge-candidate/actions`, data),
  runMergeCandidateAutomation: (id: string, data: MergeCandidateAutomationInput) =>
    api.post<MergeCandidateAutomationResponse>(`/issues/${id}/merge-candidate/automation`, data),
  create: (companyId: string, data: Record<string, unknown>) =>
    api.post<Issue>(`/companies/${companyId}/issues`, data),
  createPmIntakeIssue: (companyId: string, data: CreatePmIntakeIssue) =>
    api.post<CreatePmIntakeIssueResponse>(`/companies/${companyId}/intake/issues`, data),
  createPmIntakeProjection: (issueId: string, data: CreatePmIntakeProjection) =>
    api.post<CreatePmIntakeProjectionResponse>(`/issues/${issueId}/intake/projection`, data),
  createInternalWorkItem: (issueId: string, data: CreateInternalWorkItem) =>
    api.post<CreateInternalWorkItemResponse>(`/issues/${issueId}/internal-work-items`, data),
  update: (id: string, data: Record<string, unknown>) => api.patch<Issue>(`/issues/${id}`, data),
  remove: (id: string) => api.delete<Issue>(`/issues/${id}`),
  checkout: (id: string, agentId: string) =>
    api.post<Issue>(`/issues/${id}/checkout`, {
      agentId,
      expectedStatuses: ["todo", "backlog", "blocked"],
    }),
  release: (id: string) => api.post<Issue>(`/issues/${id}/release`, {}),
  listComments: (id: string) => api.get<IssueComment[]>(`/issues/${id}/comments`),
  addComment: (id: string, body: string, reopen?: boolean, interrupt?: boolean) =>
    api.post<IssueComment>(
      `/issues/${id}/comments`,
      {
        body,
        ...(reopen === undefined ? {} : { reopen }),
        ...(interrupt === undefined ? {} : { interrupt }),
      },
    ),
  listAttachments: (id: string) => api.get<IssueAttachment[]>(`/issues/${id}/attachments`),
  uploadAttachment: (
    companyId: string,
    issueId: string,
    file: File,
    issueCommentId?: string | null,
  ) => {
    const form = new FormData();
    form.append("file", file);
    if (issueCommentId) {
      form.append("issueCommentId", issueCommentId);
    }
    return api.postForm<IssueAttachment>(`/companies/${companyId}/issues/${issueId}/attachments`, form);
  },
  deleteAttachment: (id: string) => api.delete<{ ok: true }>(`/attachments/${id}`),
  listApprovals: (id: string) => api.get<Approval[]>(`/issues/${id}/approvals`),
  linkApproval: (id: string, approvalId: string) =>
    api.post<Approval[]>(`/issues/${id}/approvals`, { approvalId }),
  unlinkApproval: (id: string, approvalId: string) =>
    api.delete<{ ok: true }>(`/issues/${id}/approvals/${approvalId}`),
};
