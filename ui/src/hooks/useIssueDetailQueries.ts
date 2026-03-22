import { useQueries, useQuery } from "@tanstack/react-query";
import { activityApi } from "../api/activity";
import { agentsApi } from "../api/agents";
import { authApi } from "../api/auth";
import { companiesApi } from "../api/companies";
import { heartbeatsApi } from "../api/heartbeats";
import { issuesApi } from "../api/issues";
import { knowledgeApi } from "../api/knowledge";
import { projectsApi } from "../api/projects";
import {
  buildIssueDetailPollingState,
  resolveIssueDetailLiveRefetchInterval,
} from "../lib/issue-detail-polling";
import { queryKeys } from "../lib/queryKeys";

export type IssueDetailSection = "Work" | "Changes";
export type IssueDetailTab =
  | "brief"
  | "protocol"
  | "comments"
  | "subissues"
  | "documents"
  | "activity"
  | "delivery"
  | "deliverables";

export function useIssueDetailQueries(input: {
  issueId: string | null | undefined;
  selectedCompanyId: string | null | undefined;
  issueSection: IssueDetailSection;
  detailTab: IssueDetailTab;
}) {
  const commentsTabActive = input.detailTab === "comments";
  const subissuesTabActive = input.detailTab === "subissues";
  const documentsTabActive = input.detailTab === "documents";
  const activityTabActive = input.detailTab === "activity";
  const deliverablesTabActive = input.detailTab === "deliverables";
  const pollingState = buildIssueDetailPollingState({
    detailTab: input.detailTab,
    issueSection: input.issueSection,
  });

  const issueQuery = useQuery({
    queryKey: queryKeys.issues.detail(input.issueId!),
    queryFn: () => issuesApi.get(input.issueId!),
    enabled: !!input.issueId,
  });

  const commentsQuery = useQuery({
    queryKey: queryKeys.issues.comments(input.issueId!),
    queryFn: () => issuesApi.listComments(input.issueId!),
    enabled: !!input.issueId && commentsTabActive,
  });

  const protocolStateQuery = useQuery({
    queryKey: queryKeys.issues.protocolState(input.issueId!),
    queryFn: () => issuesApi.getProtocolState(input.issueId!),
    enabled: !!input.issueId,
    refetchInterval: pollingState.protocolState ? 5000 : false,
  });

  const protocolMessagesQuery = useQuery({
    queryKey: queryKeys.issues.protocolMessages(input.issueId!),
    queryFn: () => issuesApi.listProtocolMessages(input.issueId!),
    enabled: !!input.issueId,
    refetchInterval: pollingState.protocolMessages ? 5000 : false,
  });

  const protocolBriefsQuery = useQuery({
    queryKey: queryKeys.issues.protocolBriefs(input.issueId!),
    queryFn: async () => {
      const result = await issuesApi.listProtocolBriefs(input.issueId!);
      return Array.isArray(result) ? result : [result];
    },
    enabled: !!input.issueId,
    refetchInterval: pollingState.protocolBriefs ? 5000 : false,
  });

  const reviewCyclesQuery = useQuery({
    queryKey: queryKeys.issues.protocolReviewCycles(input.issueId!),
    queryFn: () => issuesApi.listProtocolReviewCycles(input.issueId!),
    enabled: !!input.issueId,
    refetchInterval: pollingState.reviewCycles ? 5000 : false,
  });

  const protocolViolationsQuery = useQuery({
    queryKey: queryKeys.issues.protocolViolations(input.issueId!),
    queryFn: () => issuesApi.listProtocolViolations(input.issueId!),
    enabled: !!input.issueId,
    refetchInterval: pollingState.protocolViolations ? 5000 : false,
  });

  const changeSurfaceQuery = useQuery({
    queryKey: queryKeys.issues.changeSurface(input.issueId!),
    queryFn: () => issuesApi.getChangeSurface(input.issueId!),
    enabled: !!input.issueId && input.issueSection === "Changes",
    refetchInterval: pollingState.changeSurface ? 5000 : false,
  });

  const activityQuery = useQuery({
    queryKey: queryKeys.issues.activity(input.issueId!),
    queryFn: () => activityApi.forIssue(input.issueId!),
    enabled: !!input.issueId && activityTabActive,
  });

  const linkedRunsQuery = useQuery({
    queryKey: queryKeys.issues.runs(input.issueId!),
    queryFn: () => activityApi.runsForIssue(input.issueId!),
    enabled: !!input.issueId,
    refetchInterval: pollingState.linkedRuns ? 5000 : false,
  });

  const linkedApprovalsQuery = useQuery({
    queryKey: queryKeys.issues.approvals(input.issueId!),
    queryFn: () => issuesApi.listApprovals(input.issueId!),
    enabled: !!input.issueId,
  });

  const attachmentsQuery = useQuery({
    queryKey: queryKeys.issues.attachments(input.issueId!),
    queryFn: () => issuesApi.listAttachments(input.issueId!),
    enabled: !!input.issueId,
  });

  const deliverablesQuery = useQuery({
    queryKey: queryKeys.issues.deliverables(input.issueId!),
    queryFn: () => issuesApi.deliverables(input.issueId!, issueQuery.data!.companyId),
    enabled: !!input.issueId && !!issueQuery.data && deliverablesTabActive,
  });

  const issueDocumentsQuery = useQuery({
    queryKey: queryKeys.issues.documents(input.issueId!),
    queryFn: () => issuesApi.documents.list(issueQuery.data!.companyId, input.issueId!),
    enabled: !!input.issueId && !!issueQuery.data && documentsTabActive,
  });

  const liveRunsQuery = useQuery({
    queryKey: queryKeys.issues.liveRuns(input.issueId!),
    queryFn: () => heartbeatsApi.liveRunsForIssue(input.issueId!),
    enabled: !!input.issueId,
    refetchInterval: (query) =>
      resolveIssueDetailLiveRefetchInterval({
        pollingActive: pollingState.linkedRuns,
        hasData: ((query.state.data as Array<unknown> | undefined)?.length ?? 0) > 0,
        intervalMs: 3000,
      }),
  });

  const activeRunQuery = useQuery({
    queryKey: queryKeys.issues.activeRun(input.issueId!),
    queryFn: () => heartbeatsApi.activeRunForIssue(input.issueId!),
    enabled: !!input.issueId,
    refetchInterval: (query) =>
      resolveIssueDetailLiveRefetchInterval({
        pollingActive: pollingState.linkedRuns,
        hasData: Boolean(query.state.data),
        intervalMs: 3000,
      }),
  });

  const allIssuesQuery = useQuery({
    queryKey: [...queryKeys.issues.list(input.selectedCompanyId!), "include-subtasks"],
    queryFn: () => issuesApi.list(input.selectedCompanyId!, { includeSubtasks: true }),
    enabled: !!input.selectedCompanyId && subissuesTabActive,
  });

  const agentsQuery = useQuery({
    queryKey: queryKeys.agents.list(input.selectedCompanyId!),
    queryFn: () => agentsApi.list(input.selectedCompanyId!),
    enabled: !!input.selectedCompanyId,
  });

  const sessionQuery = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
  });

  const projectsQuery = useQuery({
    queryKey: queryKeys.projects.list(input.selectedCompanyId!),
    queryFn: () => projectsApi.list(input.selectedCompanyId!),
    enabled: !!input.selectedCompanyId,
  });

  const setupProgressQuery = useQuery({
    queryKey: queryKeys.companies.setupProgress(input.selectedCompanyId!),
    queryFn: () => companiesApi.getSetupProgress(input.selectedCompanyId!),
    enabled: !!input.selectedCompanyId,
  });

  const retrievalRunHitsQueries = useQueries({
    queries: (changeSurfaceQuery.data?.retrievalContext.latestRuns ?? [])
      .slice(0, 3)
      .map((run) => ({
        queryKey: ["knowledge", "retrieval-run-hits", run.retrievalRunId],
        queryFn: () => knowledgeApi.getRetrievalRunHits(run.retrievalRunId),
        enabled: input.issueSection === "Changes",
        staleTime: 15_000,
      })),
  });

  return {
    pollingState,
    issue: issueQuery.data,
    issueLoading: issueQuery.isLoading,
    issueError: issueQuery.error,
    comments: commentsQuery.data,
    protocolState: protocolStateQuery.data,
    protocolMessages: protocolMessagesQuery.data ?? [],
    protocolBriefs: protocolBriefsQuery.data ?? [],
    reviewCycles: reviewCyclesQuery.data ?? [],
    protocolViolations: protocolViolationsQuery.data ?? [],
    changeSurface: changeSurfaceQuery.data,
    activity: activityQuery.data,
    linkedRuns: linkedRunsQuery.data,
    linkedApprovals: linkedApprovalsQuery.data,
    attachments: attachmentsQuery.data,
    deliverables: deliverablesQuery.data,
    issueDocuments: issueDocumentsQuery.data,
    refetchDocuments: issueDocumentsQuery.refetch,
    liveRuns: liveRunsQuery.data,
    activeRun: activeRunQuery.data,
    allIssues: allIssuesQuery.data,
    agents: agentsQuery.data,
    session: sessionQuery.data,
    projects: projectsQuery.data,
    setupProgress: setupProgressQuery.data,
    retrievalRunHitsQueries,
  };
}
