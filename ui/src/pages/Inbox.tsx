import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "@/lib/router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { approvalsApi } from "../api/approvals";
import { accessApi } from "../api/access";
import { ApiError } from "../api/client";
import { companiesApi } from "../api/companies";
import { dashboardApi } from "../api/dashboard";
import { issuesApi } from "../api/issues";
import { agentsApi } from "../api/agents";
import { heartbeatsApi } from "../api/heartbeats";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { StatusIcon } from "../components/StatusIcon";
import { PriorityIcon } from "../components/PriorityIcon";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { ApprovalCard } from "../components/ApprovalCard";
import { StatusBadge } from "../components/StatusBadge";
import { SupportPanel } from "../components/SupportPanel";
import { timeAgo } from "../lib/timeAgo";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tabs } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Inbox as InboxIcon,
  AlertTriangle,
  Clock,
  ArrowUpRight,
  XCircle,
  UserCheck,
  RotateCcw,
} from "lucide-react";
import { Identity } from "../components/Identity";
import { PageTabBar } from "../components/PageTabBar";
import { ClarificationQueueCard } from "@/components/ClarificationQueueCard";
import type {
  CompanyRoleTemplate,
  DashboardTeamSupervisionItem,
  HeartbeatRun,
  Issue,
  JoinRequest,
  PermissionKey,
} from "@squadrail/shared";
import {
  COMPANY_ROLE_TEMPLATES,
  ROLE_TEMPLATE_DEFINITIONS,
  permissionsForRoleTemplate,
  resolveRoleTemplate,
} from "@squadrail/shared";

const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours
const FAILED_RUN_STATUSES = new Set(["failed", "timed_out"]);
const ACTIONABLE_APPROVAL_STATUSES = new Set(["pending", "revision_requested"]);

type InboxTab = "new" | "all";
type InboxCategoryFilter =
  | "everything"
  | "assigned_to_me"
  | "clarifications"
  | "team_supervision"
  | "join_requests"
  | "approvals"
  | "failed_runs"
  | "alerts"
  | "stale_work";
type InboxApprovalFilter = "all" | "actionable" | "resolved";
type SectionKey =
  | "assigned_to_me"
  | "clarifications"
  | "team_supervision"
  | "join_requests"
  | "approvals"
  | "failed_runs"
  | "alerts"
  | "stale_work";

const RUN_SOURCE_LABELS: Record<string, string> = {
  timer: "Scheduled",
  assignment: "Assignment",
  on_demand: "Manual",
  automation: "Automation",
};

function getStaleIssues(issues: Issue[]): Issue[] {
  const now = Date.now();
  return issues
    .filter(
      (i) =>
        ["in_progress", "todo"].includes(i.status) &&
        now - new Date(i.updatedAt).getTime() > STALE_THRESHOLD_MS,
    )
    .sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime());
}

function getLatestFailedRunsByAgent(runs: HeartbeatRun[]): HeartbeatRun[] {
  const sorted = [...runs].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  const latestByAgent = new Map<string, HeartbeatRun>();

  for (const run of sorted) {
    if (!latestByAgent.has(run.agentId)) {
      latestByAgent.set(run.agentId, run);
    }
  }

  return Array.from(latestByAgent.values()).filter((run) => FAILED_RUN_STATUSES.has(run.status));
}

function firstNonEmptyLine(value: string | null | undefined): string | null {
  if (!value) return null;
  const line = value.split("\n").map((chunk) => chunk.trim()).find(Boolean);
  return line ?? null;
}

function runFailureMessage(run: HeartbeatRun): string {
  return firstNonEmptyLine(run.error) ?? firstNonEmptyLine(run.stderrExcerpt) ?? "Run exited with an error.";
}

function readIssueIdFromRun(run: HeartbeatRun): string | null {
  const context = run.contextSnapshot;
  if (!context) return null;

  const issueId = context["issueId"];
  if (typeof issueId === "string" && issueId.length > 0) return issueId;

  const taskId = context["taskId"];
  if (typeof taskId === "string" && taskId.length > 0) return taskId;

  return null;
}

function FailedRunCard({
  run,
  issueById,
  agentName: linkedAgentName,
}: {
  run: HeartbeatRun;
  issueById: Map<string, Issue>;
  agentName: string | null;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const issueId = readIssueIdFromRun(run);
  const issue = issueId ? issueById.get(issueId) ?? null : null;
  const sourceLabel = RUN_SOURCE_LABELS[run.invocationSource] ?? "Manual";
  const displayError = runFailureMessage(run);

  const retryRun = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {};
      const context = run.contextSnapshot as Record<string, unknown> | null;
      if (context) {
        if (typeof context.issueId === "string" && context.issueId) payload.issueId = context.issueId;
        if (typeof context.taskId === "string" && context.taskId) payload.taskId = context.taskId;
        if (typeof context.taskKey === "string" && context.taskKey) payload.taskKey = context.taskKey;
      }
      const result = await agentsApi.wakeup(run.agentId, {
        source: "on_demand",
        triggerDetail: "manual",
        reason: "retry_failed_run",
        payload,
      });
      if (!("id" in result)) {
        throw new Error("Retry was skipped because the agent is not currently invokable.");
      }
      return result;
    },
    onSuccess: (newRun) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.heartbeats(run.companyId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.heartbeats(run.companyId, run.agentId) });
      navigate(`/agents/${run.agentId}/runs/${newRun.id}`);
    },
  });

  return (
    <div className="group relative overflow-hidden rounded-xl border border-red-500/30 bg-gradient-to-br from-red-500/10 via-card to-card p-4">
      <div className="absolute right-0 top-0 h-24 w-24 rounded-full bg-red-500/10 blur-2xl" />
      <div className="relative space-y-3">
        {issue ? (
          <Link
            to={`/issues/${issue.identifier ?? issue.id}`}
            className="block truncate text-sm font-medium transition-colors hover:text-foreground no-underline text-inherit"
          >
            <span className="font-mono text-muted-foreground mr-1.5">
              {issue.identifier ?? issue.id.slice(0, 8)}
            </span>
            {issue.title}
          </Link>
        ) : (
          <span className="block text-sm text-muted-foreground">
            {run.errorCode ? `Error code: ${run.errorCode}` : "No linked issue"}
          </span>
        )}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-md bg-red-500/20 p-1.5">
                <XCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
              </span>
              {linkedAgentName ? (
                <Identity name={linkedAgentName} size="sm" />
              ) : (
                <span className="text-sm font-medium">Agent {run.agentId.slice(0, 8)}</span>
              )}
              <StatusBadge status={run.status} />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {sourceLabel} run failed {timeAgo(run.createdAt)}
            </p>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 shrink-0 px-2.5"
              onClick={() => retryRun.mutate()}
              disabled={retryRun.isPending}
            >
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
              {retryRun.isPending ? "Retrying…" : "Retry"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 shrink-0 px-2.5"
              asChild
            >
              <Link to={`/agents/${run.agentId}/runs/${run.id}`}>
                Open run
                <ArrowUpRight className="ml-1.5 h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
        </div>

        <div className="rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm">
          {displayError}
        </div>

        <div className="text-xs">
          <span className="font-mono text-muted-foreground">run {run.id.slice(0, 8)}</span>
        </div>

        {retryRun.isError && (
          <div className="text-xs text-destructive">
            {retryRun.error instanceof Error ? retryRun.error.message : "Failed to retry run"}
          </div>
        )}
      </div>
    </div>
  );
}

function TeamSupervisionCard({
  item,
}: {
  item: DashboardTeamSupervisionItem;
}) {
  const badgeTone =
    item.summaryKind === "blocked"
      ? "text-red-600 dark:text-red-400"
      : item.summaryKind === "review"
      ? "text-amber-600 dark:text-amber-400"
      : "text-blue-600 dark:text-blue-400";

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Link
              to={`/issues/${item.rootIdentifier ?? item.rootIssueId}`}
              className="font-mono no-underline text-inherit hover:text-foreground"
            >
              {item.rootIdentifier ?? item.rootIssueId.slice(0, 8)}
            </Link>
            <span>•</span>
            <span>{item.rootTitle}</span>
            {item.rootProjectName && (
              <>
                <span>•</span>
                <span>{item.rootProjectName}</span>
              </>
            )}
          </div>
          <Link
            to={`/issues/${item.workItemIdentifier ?? item.workItemIssueId}`}
            className="block text-sm font-medium no-underline text-inherit hover:text-foreground"
          >
            <span className="font-mono text-muted-foreground mr-1.5">
              {item.workItemIdentifier ?? item.workItemIssueId.slice(0, 8)}
            </span>
            {item.workItemTitle}
          </Link>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <StatusBadge status={item.issueStatus} />
            {item.kind && (
              <span className="rounded-full border border-border px-1.5 py-0.5 uppercase tracking-wide">
                {item.kind}
              </span>
            )}
            {item.watchReviewer && (
              <span className="rounded-full border border-border px-1.5 py-0.5 uppercase tracking-wide">
                reviewer watch
              </span>
            )}
            {item.watchLead && (
              <span className="rounded-full border border-border px-1.5 py-0.5 uppercase tracking-wide">
                lead watch
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground">{item.summaryText}</p>
        </div>

        <div className="space-y-2 text-xs text-muted-foreground">
          <div className={badgeTone}>
            {item.summaryKind === "blocked"
              ? "Blocked"
              : item.summaryKind === "review"
              ? "Needs review"
              : item.summaryKind === "active"
              ? "Active"
              : "Queued"}
          </div>
          {item.assignee && <Identity name={item.assignee.name} size="sm" />}
          {item.reviewer && (
            <div>Reviewer: {item.reviewer.name}</div>
          )}
          {item.techLead && <div>Lead: {item.techLead.name}</div>}
          <div>Updated {timeAgo(item.updatedAt)}</div>
        </div>
      </div>
    </div>
  );
}

export function Inbox() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);
  const [allCategoryFilter, setAllCategoryFilter] = useState<InboxCategoryFilter>("everything");
  const [allApprovalFilter, setAllApprovalFilter] = useState<InboxApprovalFilter>("all");
  const [joinRequestRoles, setJoinRequestRoles] = useState<Record<string, CompanyRoleTemplate>>({});

  const pathSegment = location.pathname.split("/").pop() ?? "new";
  const tab: InboxTab = pathSegment === "all" ? "all" : "new";

  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: setupProgress } = useQuery({
    queryKey: queryKeys.companies.setupProgress(selectedCompanyId!),
    queryFn: () => companiesApi.getSetupProgress(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const firstIssueCreated = setupProgress?.steps?.firstIssueReady ?? false;

  useEffect(() => {
    setBreadcrumbs([{ label: "Inbox" }]);
  }, [setBreadcrumbs]);

  const {
    data: approvals,
    isLoading: isApprovalsLoading,
    error: approvalsError,
  } = useQuery({
    queryKey: queryKeys.approvals.list(selectedCompanyId!),
    queryFn: () => approvalsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const {
    data: joinRequests = [],
    isLoading: isJoinRequestsLoading,
  } = useQuery({
    queryKey: queryKeys.access.joinRequests(selectedCompanyId!),
    queryFn: async () => {
      try {
        return await accessApi.listJoinRequests(selectedCompanyId!, "pending_approval");
      } catch (err) {
        if (err instanceof ApiError && (err.status === 403 || err.status === 401)) {
          return [];
        }
        throw err;
      }
    },
    enabled: !!selectedCompanyId,
    retry: false,
  });

  const { data: dashboard, isLoading: isDashboardLoading } = useQuery({
    queryKey: queryKeys.dashboard(selectedCompanyId!),
    queryFn: () => dashboardApi.summary(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const { data: protocolQueue, isLoading: isProtocolQueueLoading } = useQuery({
    queryKey: queryKeys.dashboardProtocolQueue(selectedCompanyId!, 12),
    queryFn: () => dashboardApi.protocolQueue(selectedCompanyId!, 12),
    enabled: !!selectedCompanyId,
  });
  const { data: teamSupervision, isLoading: isTeamSupervisionLoading } =
    useQuery({
      queryKey: queryKeys.dashboardTeamSupervision(selectedCompanyId!, 12),
      queryFn: () => dashboardApi.teamSupervision(selectedCompanyId!, 12),
      enabled: !!selectedCompanyId,
    });

  const { data: issues, isLoading: isIssuesLoading } = useQuery({
    queryKey: queryKeys.issues.list(selectedCompanyId!),
    queryFn: () => issuesApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const {
    data: assignedToMeIssuesRaw = [],
    isLoading: isAssignedToMeLoading,
  } = useQuery({
    queryKey: queryKeys.issues.listAssignedToMe(selectedCompanyId!),
    queryFn: () =>
      issuesApi.list(selectedCompanyId!, {
        assigneeUserId: "me",
        status: "backlog,todo,in_progress,in_review,blocked",
      }),
    enabled: !!selectedCompanyId,
  });

  const { data: heartbeatRuns, isLoading: isRunsLoading } = useQuery({
    queryKey: queryKeys.heartbeats(selectedCompanyId!),
    queryFn: () => heartbeatsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const staleIssues = issues ? getStaleIssues(issues) : [];
  const clarificationItems = protocolQueue?.buckets.clarificationQueue ?? [];
  const teamSupervisionItems = teamSupervision?.items ?? [];
  const assignedToMeIssues = useMemo(
    () =>
      [...assignedToMeIssuesRaw].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      ),
    [assignedToMeIssuesRaw],
  );

  const agentById = useMemo(() => {
    const map = new Map<string, string>();
    for (const agent of agents ?? []) map.set(agent.id, agent.name);
    return map;
  }, [agents]);

  const issueById = useMemo(() => {
    const map = new Map<string, Issue>();
    for (const issue of issues ?? []) map.set(issue.id, issue);
    return map;
  }, [issues]);

  const failedRuns = useMemo(
    () => getLatestFailedRunsByAgent(heartbeatRuns ?? []),
    [heartbeatRuns],
  );

  const allApprovals = useMemo(
    () =>
      [...(approvals ?? [])].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [approvals],
  );

  const actionableApprovals = useMemo(
    () => allApprovals.filter((approval) => ACTIONABLE_APPROVAL_STATUSES.has(approval.status)),
    [allApprovals],
  );

  const filteredAllApprovals = useMemo(() => {
    if (allApprovalFilter === "all") return allApprovals;

    return allApprovals.filter((approval) => {
      const isActionable = ACTIONABLE_APPROVAL_STATUSES.has(approval.status);
      return allApprovalFilter === "actionable" ? isActionable : !isActionable;
    });
  }, [allApprovals, allApprovalFilter]);

  const agentName = (id: string | null) => {
    if (!id) return null;
    return agentById.get(id) ?? null;
  };

  const approveMutation = useMutation({
    mutationFn: (id: string) => approvalsApi.approve(id),
    onSuccess: (_approval, id) => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.approvals.list(selectedCompanyId!) });
      navigate(`/approvals/${id}?resolved=approved`);
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : "Failed to approve");
    },
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) => approvalsApi.reject(id),
    onSuccess: () => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.approvals.list(selectedCompanyId!) });
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : "Failed to reject");
    },
  });

  const approveJoinMutation = useMutation({
    mutationFn: async (joinRequest: JoinRequest) => {
      const approved = await accessApi.approveJoinRequest(selectedCompanyId!, joinRequest.id);
      // After approval, apply the selected role template permissions
      const selectedRole = joinRequestRoles[joinRequest.id] ?? "operator";
      if (selectedRole !== "viewer") {
        // Fetch members to find the newly created membership
        try {
          const members = await accessApi.listMembers(selectedCompanyId!);
          const principalId = joinRequest.requestType === "human"
            ? joinRequest.requestingUserId
            : (approved as JoinRequest).createdAgentId;
          if (principalId) {
            const member = members.find(
              (m) => m.principalId === principalId && m.principalType === (joinRequest.requestType === "human" ? "user" : "agent"),
            );
            if (member) {
              const grants = permissionsForRoleTemplate(selectedRole).map((g) => ({
                permissionKey: g.permissionKey as PermissionKey,
                scope: g.scope,
              }));
              await accessApi.updateMemberPermissions(selectedCompanyId!, member.id, grants);
            }
          }
        } catch {
          // Non-critical: permissions can be set later from CompanySettings > Members
        }
      }
      return approved;
    },
    onSuccess: () => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.access.joinRequests(selectedCompanyId!) });
      queryClient.invalidateQueries({ queryKey: queryKeys.sidebarBadges(selectedCompanyId!) });
      queryClient.invalidateQueries({ queryKey: queryKeys.agents.list(selectedCompanyId!) });
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.access.members(selectedCompanyId!) });
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : "Failed to approve join request");
    },
  });

  const rejectJoinMutation = useMutation({
    mutationFn: (joinRequest: JoinRequest) =>
      accessApi.rejectJoinRequest(selectedCompanyId!, joinRequest.id),
    onSuccess: () => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.access.joinRequests(selectedCompanyId!) });
      queryClient.invalidateQueries({ queryKey: queryKeys.sidebarBadges(selectedCompanyId!) });
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : "Failed to reject join request");
    },
  });

  if (!selectedCompanyId) {
    return <EmptyState icon={InboxIcon} message="Select a company to view inbox." />;
  }

  const hasRunFailures = failedRuns.length > 0;
  const showAggregateAgentError = !!dashboard && dashboard.agents.error > 0 && !hasRunFailures;
  const showBudgetAlert =
    !!dashboard &&
    dashboard.costs.monthBudgetCents > 0 &&
    dashboard.costs.monthUtilizationPercent >= 80;
  const hasAlerts = showAggregateAgentError || showBudgetAlert;
  const hasStale = staleIssues.length > 0;
  const hasJoinRequests = joinRequests.length > 0;
  const hasAssignedToMe = assignedToMeIssues.length > 0;
  const hasTeamSupervision = teamSupervisionItems.length > 0;

  const newItemCount =
    assignedToMeIssues.length +
    clarificationItems.length +
    teamSupervisionItems.length +
    joinRequests.length +
    actionableApprovals.length +
    failedRuns.length +
    staleIssues.length +
    (showAggregateAgentError ? 1 : 0) +
    (showBudgetAlert ? 1 : 0);

  const showJoinRequestsCategory =
    allCategoryFilter === "everything" || allCategoryFilter === "join_requests";
  const showAssignedCategory =
    allCategoryFilter === "everything" || allCategoryFilter === "assigned_to_me";
  const showClarificationsCategory =
    allCategoryFilter === "everything" || allCategoryFilter === "clarifications";
  const showTeamSupervisionCategory =
    allCategoryFilter === "everything" || allCategoryFilter === "team_supervision";
  const showApprovalsCategory = allCategoryFilter === "everything" || allCategoryFilter === "approvals";
  const showFailedRunsCategory =
    allCategoryFilter === "everything" || allCategoryFilter === "failed_runs";
  const showAlertsCategory = allCategoryFilter === "everything" || allCategoryFilter === "alerts";
  const showStaleCategory = allCategoryFilter === "everything" || allCategoryFilter === "stale_work";

  const approvalsToRender = tab === "new" ? actionableApprovals : filteredAllApprovals;
  const showAssignedSection = tab === "new" ? hasAssignedToMe : showAssignedCategory && hasAssignedToMe;
  const showClarificationsSection =
    tab === "new"
      ? clarificationItems.length > 0
      : showClarificationsCategory && clarificationItems.length > 0;
  const showJoinRequestsSection =
    tab === "new" ? hasJoinRequests : showJoinRequestsCategory && hasJoinRequests;
  const showTeamSupervisionSection =
    tab === "new"
      ? hasTeamSupervision
      : showTeamSupervisionCategory && hasTeamSupervision;
  const showApprovalsSection =
    tab === "new"
      ? actionableApprovals.length > 0
      : showApprovalsCategory && filteredAllApprovals.length > 0;
  const showFailedRunsSection =
    tab === "new" ? hasRunFailures : showFailedRunsCategory && hasRunFailures;
  const showAlertsSection = tab === "new" ? hasAlerts : showAlertsCategory && hasAlerts;
  const showStaleSection = tab === "new" ? hasStale : showStaleCategory && hasStale;

  const visibleSections = [
    showAssignedSection ? "assigned_to_me" : null,
    showClarificationsSection ? "clarifications" : null,
    showTeamSupervisionSection ? "team_supervision" : null,
    showApprovalsSection ? "approvals" : null,
    showJoinRequestsSection ? "join_requests" : null,
    showFailedRunsSection ? "failed_runs" : null,
    showAlertsSection ? "alerts" : null,
    showStaleSection ? "stale_work" : null,
  ].filter((key): key is SectionKey => key !== null);

  const allLoaded =
    !isJoinRequestsLoading &&
    !isApprovalsLoading &&
    !isDashboardLoading &&
    !isProtocolQueueLoading &&
    !isTeamSupervisionLoading &&
    !isIssuesLoading &&
    !isAssignedToMeLoading &&
    !isRunsLoading;

  const showSeparatorBefore = (key: SectionKey) => visibleSections.indexOf(key) > 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Triage surface
          </div>
          <h1 className="mt-1 text-2xl font-semibold text-foreground">Inbox</h1>
        </div>
      </div>

      {/* Compact summary bar */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {newItemCount > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300/60 bg-amber-500/10 px-2.5 py-1 font-medium text-amber-700 dark:text-amber-300">
            <span className="tabular-nums">{newItemCount}</span> new items
          </span>
        )}
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 font-medium text-muted-foreground">
          <span className="tabular-nums text-foreground">{assignedToMeIssues.length}</span> assigned
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 font-medium text-muted-foreground">
          <span className="tabular-nums text-foreground">{clarificationItems.length}</span> clarifications
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 font-medium text-muted-foreground">
          <span className="tabular-nums text-foreground">{teamSupervisionItems.length}</span> supervision
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 font-medium text-muted-foreground">
          <span className="tabular-nums text-foreground">{actionableApprovals.length}</span> approvals
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 font-medium text-muted-foreground">
          <span className="tabular-nums text-foreground">{failedRuns.length}</span> failed runs
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 font-medium text-muted-foreground">
          <span className="tabular-nums text-foreground">{staleIssues.length}</span> stale
        </span>
      </div>

      <SupportPanel
        title="Inbox queue"
        description="Use the new view as the action-first triage strip. Switch to all only when you need broader inbox history and category filters."
        action={
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <Tabs value={tab} onValueChange={(value) => navigate(`/inbox/${value === "all" ? "all" : "new"}`)}>
              <PageTabBar
                items={[
                  {
                    value: "new",
                    label: (
                      <>
                        New
                        {newItemCount > 0 && (
                          <span className="ml-1.5 rounded-full bg-blue-500/20 px-1.5 py-0.5 text-[10px] font-medium text-blue-500">
                            {newItemCount}
                          </span>
                        )}
                      </>
                    ),
                  },
                  { value: "all", label: "All" },
                ]}
              />
            </Tabs>

            {tab === "all" && (
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  value={allCategoryFilter}
                  onValueChange={(value) => setAllCategoryFilter(value as InboxCategoryFilter)}
                >
                  <SelectTrigger className="h-9 w-[170px] rounded-full text-xs">
                    <SelectValue placeholder="Category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="everything">All categories</SelectItem>
                    <SelectItem value="assigned_to_me">Assigned to me</SelectItem>
                    <SelectItem value="clarifications">Clarifications</SelectItem>
                    <SelectItem value="team_supervision">Team supervision</SelectItem>
                    <SelectItem value="join_requests">Join requests</SelectItem>
                    <SelectItem value="approvals">Approvals</SelectItem>
                    <SelectItem value="failed_runs">Failed runs</SelectItem>
                    <SelectItem value="alerts">Alerts</SelectItem>
                    <SelectItem value="stale_work">Stale work</SelectItem>
                  </SelectContent>
                </Select>

                {showApprovalsCategory && (
                  <Select
                    value={allApprovalFilter}
                    onValueChange={(value) => setAllApprovalFilter(value as InboxApprovalFilter)}
                  >
                    <SelectTrigger className="h-9 w-[170px] rounded-full text-xs">
                      <SelectValue placeholder="Approval status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All approval statuses</SelectItem>
                      <SelectItem value="actionable">Needs action</SelectItem>
                      <SelectItem value="resolved">Resolved</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}
          </div>
        }
        contentClassName="space-y-5"
      >
        {approvalsError && <p className="text-sm text-destructive">{approvalsError.message}</p>}
        {actionError && <p className="text-sm text-destructive">{actionError}</p>}

        {!allLoaded && visibleSections.length === 0 && (
          <PageSkeleton variant="inbox" />
        )}

        {allLoaded && visibleSections.length === 0 && (
          <EmptyState
            icon={InboxIcon}
            message={
              tab === "new"
                ? !firstIssueCreated
                  ? "Submit a quick request to get started. Clarifications from the PM will appear here."
                  : "You're all caught up!"
                : "No inbox items match these filters."
            }
          />
        )}

        {showAssignedSection && (
        <>
          {showSeparatorBefore("assigned_to_me") && <Separator />}
          <div>
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Assigned To Me
            </h3>
            <div className="divide-y divide-border border border-border">
              {assignedToMeIssues.map((issue) => (
                <Link
                  key={issue.id}
                  to={`/issues/${issue.identifier ?? issue.id}`}
                  className="flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/50 no-underline text-inherit"
                >
                  <UserCheck className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
                  <PriorityIcon priority={issue.priority} />
                  <StatusIcon status={issue.status} />
                  <span className="text-xs font-mono text-muted-foreground">
                    {issue.identifier ?? issue.id.slice(0, 8)}
                  </span>
                  <span className="flex-1 truncate text-sm">{issue.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    updated {timeAgo(issue.updatedAt)}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </>
        )}

        {showClarificationsSection && (
        <>
          {showSeparatorBefore("clarifications") && <Separator />}
          <div>
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Clarifications
            </h3>
            <div className="grid gap-3">
              {clarificationItems.map((item) => (
                <ClarificationQueueCard key={item.issueId} item={item} />
              ))}
            </div>
          </div>
        </>
        )}

        {showTeamSupervisionSection && (
        <>
          {showSeparatorBefore("team_supervision") && <Separator />}
          <div>
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Team Supervision
            </h3>
            <div className="grid gap-3">
              {teamSupervisionItems.map((item) => (
                <TeamSupervisionCard key={item.workItemIssueId} item={item} />
              ))}
            </div>
          </div>
        </>
        )}

        {showApprovalsSection && (
        <>
          {showSeparatorBefore("approvals") && <Separator />}
          <div>
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {tab === "new" ? "Approvals Needing Action" : "Approvals"}
            </h3>
            <div className="grid gap-3">
              {approvalsToRender.map((approval) => (
                <ApprovalCard
                  key={approval.id}
                  approval={approval}
                  requesterAgent={
                    approval.requestedByAgentId
                      ? (agents ?? []).find((a) => a.id === approval.requestedByAgentId) ?? null
                      : null
                  }
                  onApprove={() => approveMutation.mutate(approval.id)}
                  onReject={() => rejectMutation.mutate(approval.id)}
                  detailLink={`/approvals/${approval.id}`}
                  isPending={approveMutation.isPending || rejectMutation.isPending}
                />
              ))}
            </div>
          </div>
        </>
        )}

        {showJoinRequestsSection && (
        <>
          {showSeparatorBefore("join_requests") && <Separator />}
          <div>
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Join Requests
            </h3>
            <div className="grid gap-3">
              {joinRequests.map((joinRequest) => {
                const selectedRole = joinRequestRoles[joinRequest.id] ?? "operator";
                return (
                <div key={joinRequest.id} className="rounded-xl border border-border bg-card p-4">
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div className="space-y-1">
                        <p className="text-sm font-medium">
                          {joinRequest.requestType === "human"
                            ? "Human join request"
                            : `Agent join request${joinRequest.agentName ? `: ${joinRequest.agentName}` : ""}`}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          requested {timeAgo(joinRequest.createdAt)} from IP {joinRequest.requestIp}
                        </p>
                        {joinRequest.requestEmailSnapshot && (
                          <p className="text-xs text-muted-foreground">
                            email: {joinRequest.requestEmailSnapshot}
                          </p>
                        )}
                        {joinRequest.adapterType && (
                          <p className="text-xs text-muted-foreground">adapter: {joinRequest.adapterType}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={approveJoinMutation.isPending || rejectJoinMutation.isPending}
                          onClick={() => rejectJoinMutation.mutate(joinRequest)}
                        >
                          Reject
                        </Button>
                        <Button
                          size="sm"
                          disabled={approveJoinMutation.isPending || rejectJoinMutation.isPending}
                          onClick={() => approveJoinMutation.mutate(joinRequest)}
                        >
                          Approve as {ROLE_TEMPLATE_DEFINITIONS.find((d) => d.key === selectedRole)?.label ?? selectedRole}
                        </Button>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] text-muted-foreground mr-1">Role:</span>
                      {COMPANY_ROLE_TEMPLATES.map((rt) => {
                        const def = ROLE_TEMPLATE_DEFINITIONS.find((d) => d.key === rt);
                        const isSelected = selectedRole === rt;
                        const toneMap: Record<string, string> = {
                          owner: "border-purple-300 bg-purple-50 text-purple-700",
                          admin: "border-blue-300 bg-blue-50 text-blue-700",
                          operator: "border-emerald-300 bg-emerald-50 text-emerald-700",
                          viewer: "border-slate-300 bg-slate-100 text-slate-700",
                        };
                        return (
                          <button
                            key={rt}
                            type="button"
                            className={`rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors ${
                              isSelected
                                ? toneMap[rt] ?? "border-border"
                                : "border-border bg-background text-muted-foreground hover:bg-muted/50"
                            }`}
                            title={def?.description ?? ""}
                            onClick={() =>
                              setJoinRequestRoles((prev) => ({ ...prev, [joinRequest.id]: rt }))
                            }
                          >
                            {def?.label ?? rt}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
                );
              })}
            </div>
          </div>
        </>
        )}

        {showFailedRunsSection && (
        <>
          {showSeparatorBefore("failed_runs") && <Separator />}
          <div>
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Failed Runs
            </h3>
            <div className="grid gap-3">
              {failedRuns.map((run) => (
                <FailedRunCard
                  key={run.id}
                  run={run}
                  issueById={issueById}
                  agentName={agentName(run.agentId)}
                />
              ))}
            </div>
          </div>
        </>
        )}

        {showAlertsSection && (
        <>
          {showSeparatorBefore("alerts") && <Separator />}
          <div>
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Alerts
            </h3>
            <div className="divide-y divide-border border border-border">
              {showAggregateAgentError && (
                <Link
                  to="/agents"
                  className="flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/50 no-underline text-inherit"
                >
                  <AlertTriangle className="h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
                  <span className="text-sm">
                    <span className="font-medium">{dashboard!.agents.error}</span>{" "}
                    {dashboard!.agents.error === 1 ? "agent has" : "agents have"} errors
                  </span>
                </Link>
              )}
              {showBudgetAlert && (
                <Link
                  to="/costs"
                  className="flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/50 no-underline text-inherit"
                >
                  <AlertTriangle className="h-4 w-4 shrink-0 text-yellow-400" />
                  <span className="text-sm">
                    Budget at{" "}
                    <span className="font-medium">{dashboard!.costs.monthUtilizationPercent}%</span>{" "}
                    utilization this month
                  </span>
                </Link>
              )}
            </div>
          </div>
        </>
        )}

        {showStaleSection && (
        <>
          {showSeparatorBefore("stale_work") && <Separator />}
          <div>
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Stale Work
            </h3>
            <div className="divide-y divide-border border border-border">
              {staleIssues.map((issue) => (
                <Link
                  key={issue.id}
                  to={`/issues/${issue.identifier ?? issue.id}`}
                  className="flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/50 no-underline text-inherit"
                >
                  <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <PriorityIcon priority={issue.priority} />
                  <StatusIcon status={issue.status} />
                  <span className="text-xs font-mono text-muted-foreground">
                    {issue.identifier ?? issue.id.slice(0, 8)}
                  </span>
                  <span className="flex-1 truncate text-sm">{issue.title}</span>
                  {issue.assigneeAgentId &&
                    (() => {
                      const name = agentName(issue.assigneeAgentId);
                      return name ? (
                        <Identity name={name} size="sm" />
                      ) : (
                        <span className="font-mono text-xs text-muted-foreground">
                          {issue.assigneeAgentId.slice(0, 8)}
                        </span>
                      );
                    })()}
                  <span className="shrink-0 text-xs text-muted-foreground">
                    updated {timeAgo(issue.updatedAt)}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </>
        )}
      </SupportPanel>
    </div>
  );
}
