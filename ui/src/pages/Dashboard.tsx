import { useEffect, useMemo, useState } from "react";
import { Link } from "@/lib/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { dashboardApi } from "../api/dashboard";
import { activityApi } from "../api/activity";
import { issuesApi } from "../api/issues";
import { agentsApi } from "../api/agents";
import { projectsApi } from "../api/projects";
import { heartbeatsApi } from "../api/heartbeats";
import { useCompany } from "../context/CompanyContext";
import { useDialog } from "../context/DialogContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { MetricCard } from "../components/MetricCard";
import { MetricCardV2 } from "../components/MetricCardV2";
import { QueueCardV2 } from "../components/QueueCardV2";
import { ActivityTimelineV2 } from "../components/ActivityTimelineV2";
import { MetricCardSkeleton } from "../components/LoadingSkeleton";
import { EmptyState } from "../components/EmptyState";
import { StatusIcon } from "../components/StatusIcon";
import { PriorityIcon } from "../components/PriorityIcon";
import { ActivityRow } from "../components/ActivityRow";
import { Identity } from "../components/Identity";
import { timeAgo } from "../lib/timeAgo";
import { cn, formatCents } from "../lib/utils";
import {
  AlertTriangle,
  Bot,
  CircleDot,
  Clock3,
  FileWarning,
  GitPullRequestArrow,
  LayoutDashboard,
  MessageSquareMore,
  ShieldAlert,
} from "lucide-react";
import { ActiveAgentsPanel } from "../components/ActiveAgentsPanel";
import {
  ChartCard,
  RunActivityChart,
  PriorityChart,
  IssueStatusChart,
  SuccessRateChart,
} from "../components/ActivityCharts";
import { PageSkeleton } from "../components/PageSkeleton";
import type { Agent, DashboardProtocolQueueItem, DashboardRecoveryCase, Issue } from "@squadrail/shared";

function getRecentIssues(issues: Issue[]): Issue[] {
  return [...issues]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

function formatProtocolLabel(value: string | null | undefined) {
  if (!value) return "Unknown";
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function recoveryCaseKey(item: DashboardRecoveryCase) {
  return `${item.recoveryType}:${item.issueId}:${item.code ?? "none"}:${item.createdAt.toString()}`;
}

function protocolTone(item: DashboardProtocolQueueItem) {
  if (item.openViolationCount > 0) return "border-red-300/70 bg-red-50/70";
  if (item.workflowState === "blocked" || item.workflowState === "awaiting_human_decision") {
    return "border-amber-300/70 bg-amber-50/70";
  }
  if (item.workflowState === "approved") return "border-emerald-300/70 bg-emerald-50/70";
  return "border-border bg-card";
}

function firstBriefPreview(item: DashboardProtocolQueueItem) {
  const orderedScopes = ["engineer", "reviewer", "tech_lead", "closure"];
  for (const scope of orderedScopes) {
    const brief = item.latestBriefs[scope];
    if (brief) return brief;
  }
  return null;
}

function QueueSection({
  title,
  subtitle,
  items,
  emptyMessage,
  icon: Icon,
}: {
  title: string;
  subtitle: string;
  items: DashboardProtocolQueueItem[];
  emptyMessage: string;
  icon: typeof Clock3;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
        <div className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card">
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
      </div>

      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-5 text-sm text-muted-foreground">
          {emptyMessage}
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const preview = firstBriefPreview(item);
            return (
              <Link
                key={item.issueId}
                to={`/issues/${item.identifier ?? item.issueId}`}
                className={cn(
                  "block rounded-lg border p-4 transition-colors hover:border-foreground/20 hover:bg-accent/20",
                  protocolTone(item),
                )}
              >
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex items-center gap-2">
                    <PriorityIcon priority={item.priority} />
                    <StatusIcon status={item.coarseIssueStatus} />
                  </div>
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {item.identifier ?? item.issueId.slice(0, 8)}
                      </span>
                      <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                        {formatProtocolLabel(item.workflowState)}
                      </span>
                      {item.stale && (
                        <span className="rounded-full border border-amber-400 px-2 py-0.5 text-[11px] text-amber-700">
                          Stale
                        </span>
                      )}
                      {item.openViolationCount > 0 && (
                        <span className="rounded-full border border-red-400 px-2 py-0.5 text-[11px] text-red-700">
                          {item.openViolationCount} violations
                        </span>
                      )}
                      {item.projectName && (
                        <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                          {item.projectName}
                        </span>
                      )}
                    </div>

                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-foreground">{item.title}</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          Next owner: {formatProtocolLabel(item.nextOwnerRole)}
                          {item.blockedCode ? ` · Blocked by ${formatProtocolLabel(item.blockedCode)}` : ""}
                        </div>
                      </div>
                      <div className="shrink-0 text-[11px] text-muted-foreground">
                        {timeAgo(item.lastTransitionAt)}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                      {item.techLead && <Identity name={item.techLead.name} size="sm" className="text-[11px]" />}
                      {item.engineer && <Identity name={item.engineer.name} size="sm" className="text-[11px]" />}
                      {item.reviewer && <Identity name={item.reviewer.name} size="sm" className="text-[11px]" />}
                    </div>

                    {item.latestMessage && (
                      <div className="rounded-md border border-border/70 bg-background/80 px-3 py-2">
                        <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                          Latest message · {formatProtocolLabel(item.latestMessage.messageType)}
                        </div>
                        <p className="mt-1 text-sm text-foreground">{item.latestMessage.summary}</p>
                      </div>
                    )}

                    {preview && (
                      <div className="rounded-md border border-border/70 bg-background/80 px-3 py-2">
                        <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                          {formatProtocolLabel(preview.briefScope)} brief
                        </div>
                        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{preview.preview}</p>
                      </div>
                    )}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}

function RecoverySection({ companyId, items }: { companyId: string; items: DashboardRecoveryCase[] }) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<"all" | DashboardRecoveryCase["recoveryType"]>("all");
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [noteBody, setNoteBody] = useState("Board recovery note: inspect the current blocker, preserve evidence, and post the next deterministic handoff.");

  const filteredItems = useMemo(
    () => (filter === "all" ? items : items.filter((item) => item.recoveryType === filter)),
    [filter, items],
  );
  const selectedItems = useMemo(
    () => filteredItems.filter((item) => selectedKeys.includes(recoveryCaseKey(item))),
    [filteredItems, selectedKeys],
  );
  const selectedIssueIds = useMemo(
    () => Array.from(new Set(selectedItems.map((item) => item.issueId))),
    [selectedItems],
  );
  const hasSelectedViolation = selectedItems.some((item) => item.recoveryType === "violation");

  useEffect(() => {
    const validKeys = new Set(items.map(recoveryCaseKey));
    setSelectedKeys((current) => current.filter((key) => validKeys.has(key)));
  }, [items]);

  const recoveryActionMutation = useMutation({
    mutationFn: (input: { actionType: "resolve_violations" | "post_recovery_note"; noteBody?: string }) =>
      dashboardApi.applyRecoveryAction(companyId, {
        actionType: input.actionType,
        issueIds: selectedIssueIds,
        recoveryTypes: Array.from(new Set(selectedItems.map((item) => item.recoveryType))),
        noteBody: input.noteBody,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboardRecoveryQueue(companyId, 12) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboardProtocolQueue(companyId, 20) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(companyId) });
      setSelectedKeys([]);
    },
  });

  function toggleSelection(key: string) {
    setSelectedKeys((current) =>
      current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key],
    );
  }

  function toggleSelectAllVisible() {
    const visibleKeys = filteredItems.map(recoveryCaseKey);
    const allVisibleSelected = visibleKeys.length > 0 && visibleKeys.every((key) => selectedKeys.includes(key));
    setSelectedKeys((current) =>
      allVisibleSelected
        ? current.filter((key) => !visibleKeys.includes(key))
        : Array.from(new Set([...current, ...visibleKeys])),
    );
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Recovery Drill-down</h3>
          <p className="text-xs text-muted-foreground">
            Runtime failures, cross-issue violations, timeout escalations, and integrity backlog that need operator action.
          </p>
        </div>
        <div className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card">
          <ShieldAlert className="h-4 w-4 text-muted-foreground" />
        </div>
      </div>

      <div className="rounded-lg border border-border bg-muted/20 px-4 py-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {(["all", "runtime", "violation", "timeout", "integrity"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs transition-colors",
                filter === value
                  ? "border-foreground bg-foreground text-background"
                  : "border-border text-muted-foreground hover:bg-accent/50",
              )}
            >
              {value === "all" ? "All" : formatProtocolLabel(value)}
            </button>
          ))}
          <button
            type="button"
            onClick={toggleSelectAllVisible}
            className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent/50"
            disabled={filteredItems.length === 0}
          >
            {filteredItems.length > 0 && filteredItems.every((item) => selectedKeys.includes(recoveryCaseKey(item)))
              ? "Clear visible"
              : "Select visible"}
          </button>
        </div>

        <textarea
          className="min-h-[88px] w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none"
          value={noteBody}
          onChange={(event) => setNoteBody(event.target.value)}
          placeholder="Shared board recovery note for selected issues"
        />

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => recoveryActionMutation.mutate({ actionType: "resolve_violations" })}
            disabled={recoveryActionMutation.isPending || selectedIssueIds.length === 0 || !hasSelectedViolation}
            className="rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent/50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Resolve violations
          </button>
          <button
            type="button"
            onClick={() => recoveryActionMutation.mutate({ actionType: "post_recovery_note", noteBody })}
            disabled={recoveryActionMutation.isPending || selectedIssueIds.length === 0 || noteBody.trim().length === 0}
            className="rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent/50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Post board note
          </button>
          <div className="text-xs text-muted-foreground">
            {selectedIssueIds.length} issue(s) selected
          </div>
          {recoveryActionMutation.data && (
            <div className="text-xs text-muted-foreground">
              Updated violations {recoveryActionMutation.data.affectedViolationCount} · created notes {recoveryActionMutation.data.createdMessageCount}
            </div>
          )}
          {recoveryActionMutation.isError && (
            <div className="text-xs text-destructive">
              {recoveryActionMutation.error instanceof Error ? recoveryActionMutation.error.message : "Recovery action failed"}
            </div>
          )}
        </div>
      </div>

      {filteredItems.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-5 text-sm text-muted-foreground">
          No recovery cases are open.
        </div>
      ) : (
        <div className="space-y-3">
          {filteredItems.map((item) => (
            <Link
              key={recoveryCaseKey(item)}
              to={`/issues/${item.identifier ?? item.issueId}`}
              className={cn(
                "block rounded-lg border p-4 transition-colors hover:border-foreground/20 hover:bg-accent/20",
                item.recoveryType === "violation"
                  ? "border-red-300/70 bg-red-50/70"
                  : item.recoveryType === "runtime"
                    ? "border-orange-300/70 bg-orange-50/70"
                    : "border-amber-300/70 bg-amber-50/70",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-2">
                  <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={selectedKeys.includes(recoveryCaseKey(item))}
                      onChange={(event) => {
                        event.stopPropagation();
                        toggleSelection(recoveryCaseKey(item));
                      }}
                      onClick={(event) => event.stopPropagation()}
                    />
                    Select
                  </label>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {item.identifier ?? item.issueId.slice(0, 8)}
                    </span>
                    <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                      {formatProtocolLabel(item.recoveryType)}
                    </span>
                    <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                      {formatProtocolLabel(item.workflowState)}
                    </span>
                    {item.code && (
                      <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                        {item.code}
                      </span>
                    )}
                  </div>
                  <div className="text-sm font-semibold text-foreground">{item.title}</div>
                  <p className="text-sm text-muted-foreground">{item.summary}</p>
                  <div className="rounded-md border border-border/70 bg-background/80 px-3 py-2 text-xs text-muted-foreground">
                    Next action: {item.nextAction}
                  </div>
                </div>
                <div className="shrink-0 text-[11px] text-muted-foreground">{timeAgo(item.createdAt)}</div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

export function Dashboard() {
  const { selectedCompanyId, companies } = useCompany();
  const { openOnboarding } = useDialog();
  const { setBreadcrumbs } = useBreadcrumbs();

  useEffect(() => {
    setBreadcrumbs([{ label: "Operations" }]);
  }, [setBreadcrumbs]);

  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.dashboard(selectedCompanyId!),
    queryFn: () => dashboardApi.summary(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: protocolQueue } = useQuery({
    queryKey: queryKeys.dashboardProtocolQueue(selectedCompanyId!, 20),
    queryFn: () => dashboardApi.protocolQueue(selectedCompanyId!, 20),
    enabled: !!selectedCompanyId,
    refetchInterval: 15000,
  });

  const { data: recoveryQueue } = useQuery({
    queryKey: queryKeys.dashboardRecoveryQueue(selectedCompanyId!, 12),
    queryFn: () => dashboardApi.recoveryQueue(selectedCompanyId!, 12),
    enabled: !!selectedCompanyId,
    refetchInterval: 15000,
  });

  const { data: activity } = useQuery({
    queryKey: queryKeys.activity(selectedCompanyId!),
    queryFn: () => activityApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: issues } = useQuery({
    queryKey: queryKeys.issues.list(selectedCompanyId!),
    queryFn: () => issuesApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: projects } = useQuery({
    queryKey: queryKeys.projects.list(selectedCompanyId!),
    queryFn: () => projectsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: runs } = useQuery({
    queryKey: queryKeys.heartbeats(selectedCompanyId!),
    queryFn: () => heartbeatsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const recentIssues = issues ? getRecentIssues(issues) : [];
  const recentActivity = useMemo(() => (activity ?? []).slice(0, 8), [activity]);

  const agentMap = useMemo(() => {
    const map = new Map<string, Agent>();
    for (const a of agents ?? []) map.set(a.id, a);
    return map;
  }, [agents]);

  const entityNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const i of issues ?? []) map.set(`issue:${i.id}`, i.identifier ?? i.id.slice(0, 8));
    for (const a of agents ?? []) map.set(`agent:${a.id}`, a.name);
    for (const p of projects ?? []) map.set(`project:${p.id}`, p.name);
    return map;
  }, [issues, agents, projects]);

  const entityTitleMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const i of issues ?? []) map.set(`issue:${i.id}`, i.title);
    return map;
  }, [issues]);

  const agentName = (id: string | null) => {
    if (!id || !agents) return null;
    return agents.find((a) => a.id === id)?.name ?? null;
  };

  if (!selectedCompanyId) {
    if (companies.length === 0) {
      return (
        <EmptyState
          icon={LayoutDashboard}
          message="Welcome to Squadrail. Set up your first company and squad to start operating."
          action="Get Started"
          onAction={openOnboarding}
        />
      );
    }
    return (
      <EmptyState icon={LayoutDashboard} message="Create or select a company to view the operations console." />
    );
  }

  if (isLoading) {
    return <PageSkeleton variant="dashboard" />;
  }

  const hasNoAgents = agents !== undefined && agents.length === 0;
  const buckets = protocolQueue?.buckets;

  const company = companies.find(c => c.id === selectedCompanyId);

  return (
    <div className="space-y-8">
      {/* Hero Section */}
      <section className="space-y-4">
        <div>
          <h1 className="text-4xl font-bold tracking-tight">
            {company?.name ?? "Operations"}
          </h1>
          <p className="text-lg text-muted-foreground mt-2">
            {projects?.length ?? 0} projects · {agents?.length ?? 0} agents · {issues?.filter(i => i.status !== 'done' && i.status !== 'cancelled').length ?? 0} active issues
          </p>
        </div>
      </section>

      {error && <p className="text-sm text-destructive">{error.message}</p>}

      {hasNoAgents && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <Bot className="h-4 w-4 shrink-0 text-amber-600" />
            <p className="text-sm text-amber-900">No agents are active yet. Seed the squad and assign an engine first.</p>
          </div>
          <button
            onClick={() => openOnboarding({ initialStep: 2, companyId: selectedCompanyId! })}
            className="shrink-0 text-sm font-medium text-amber-700 underline underline-offset-2 hover:text-amber-900"
          >
            Open setup
          </button>
        </div>
      )}

      {data && (
        <>
          {/* Metrics Grid - Enhanced */}
          <section>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              <MetricCardV2
                icon={CircleDot}
                value={data.protocol.executionQueueCount}
                label="Execution Queue"
                to="/issues"
                description={<span>{data.tasks.inProgress} in progress</span>}
              />
              <MetricCardV2
                icon={GitPullRequestArrow}
                value={data.protocol.reviewQueueCount}
                label="Review Backlog"
                to="/issues"
                description={<span>{data.protocol.readyToCloseCount} ready to close</span>}
              />
              <MetricCardV2
                icon={AlertTriangle}
                value={data.protocol.blockedQueueCount + data.protocol.awaitingHumanDecisionCount}
                label="Blocked / Human"
                to="/issues"
                description={
                  <span>
                    {data.protocol.blockedQueueCount} blocked, {data.protocol.awaitingHumanDecisionCount} waiting
                  </span>
                }
              />
              <MetricCardV2
                icon={ShieldAlert}
                value={data.protocol.openViolationCount}
                label="Protocol Violations"
                to="/activity"
                description={<span>{data.protocol.protocolMessagesLast24h} messages in 24h</span>}
              />
            </div>
          </section>

          {/* Protocol Queues - Redesigned */}
          <section className="space-y-6">
            <h2 className="text-2xl font-semibold">Protocol Queues</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              <QueueCardV2
                title="Execution Queue"
                subtitle="Active engineering work"
                items={buckets?.executionQueue ?? []}
                emptyMessage="No execution work waiting"
                icon={CircleDot}
                variant="execution"
                to="/issues"
              />
              <QueueCardV2
                title="Review Backlog"
                subtitle="Under review"
                items={buckets?.reviewQueue ?? []}
                emptyMessage="No reviews waiting"
                icon={GitPullRequestArrow}
                variant="review"
                to="/issues"
              />
              <QueueCardV2
                title="Blocked Queue"
                subtitle="Environment or dependency issues"
                items={buckets?.blockedQueue ?? []}
                emptyMessage="No blocked issues"
                icon={AlertTriangle}
                variant="blocked"
                to="/issues"
              />
              <QueueCardV2
                title="Violation Queue"
                subtitle="Protocol breakdowns"
                items={buckets?.violationQueue ?? []}
                emptyMessage="No violations"
                icon={ShieldAlert}
                variant="blocked"
                to="/issues"
              />
              <QueueCardV2
                title="Human Decisions"
                subtitle="Awaiting board direction"
                items={buckets?.humanDecisionQueue ?? []}
                emptyMessage="No decisions pending"
                icon={MessageSquareMore}
                variant="approval"
                to="/issues"
              />
              <QueueCardV2
                title="Stale Queue"
                subtitle="Long-running work"
                items={buckets?.staleQueue ?? []}
                emptyMessage="No stale work"
                icon={Clock3}
                variant="idle"
                to="/issues"
              />
            </div>
          </section>

          <RecoverySection companyId={selectedCompanyId!} items={recoveryQueue?.items ?? []} />

          <ActiveAgentsPanel companyId={selectedCompanyId!} />

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <ChartCard title="Run Activity" subtitle="Last 14 days">
              <RunActivityChart runs={runs ?? []} />
            </ChartCard>
            <ChartCard title="Issues by Priority" subtitle="Last 14 days">
              <PriorityChart issues={issues ?? []} />
            </ChartCard>
            <ChartCard title="Issues by Status" subtitle="Last 14 days">
              <IssueStatusChart issues={issues ?? []} />
            </ChartCard>
            <ChartCard title="Success Rate" subtitle="Last 14 days">
              <SuccessRateChart runs={runs ?? []} />
            </ChartCard>
          </div>

          {/* Activity Timeline - Enhanced */}
          <section className="space-y-4">
            <h2 className="text-2xl font-semibold">Recent Activity</h2>
            <div className="overflow-hidden rounded-xl border border-border divide-y divide-border bg-card">
              {recentActivity.length === 0 ? (
                <div className="p-12 text-center text-sm text-muted-foreground">
                  No activity yet
                </div>
              ) : (
                recentActivity.map((event) => (
                  <ActivityRow
                    key={event.id}
                    event={event}
                    agentMap={agentMap}
                    entityNameMap={entityNameMap}
                    entityTitleMap={entityTitleMap}
                  />
                ))
              )}
            </div>
          </section>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="min-w-0 hidden">
              {/* Keeping original activity section hidden for now */}
            </div>

            <div className="min-w-0">
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Recently Updated Issues
              </h3>
              {recentIssues.length === 0 ? (
                <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
                  No issues yet.
                </div>
              ) : (
                <div className="overflow-hidden rounded-lg border border-border divide-y divide-border">
                  {recentIssues.slice(0, 10).map((issue) => (
                    <Link
                      key={issue.id}
                      to={`/issues/${issue.identifier ?? issue.id}`}
                      className="block px-4 py-3 text-sm transition-colors hover:bg-accent/30"
                    >
                      <div className="flex gap-3">
                        <div className="mt-0.5 flex items-center gap-2">
                          <PriorityIcon priority={issue.priority} />
                          <StatusIcon status={issue.status} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-foreground">{issue.title}</p>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                            <span className="font-mono">{issue.identifier ?? issue.id.slice(0, 8)}</span>
                            {issue.assigneeAgentId && agentName(issue.assigneeAgentId) && (
                              <Identity name={agentName(issue.assigneeAgentId)!} size="sm" className="text-[11px]" />
                            )}
                          </div>
                        </div>
                        <div className="shrink-0 text-[11px] text-muted-foreground">{timeAgo(issue.updatedAt)}</div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
            <MetricCard
              icon={Bot}
              value={data.agents.active + data.agents.running + data.agents.paused + data.agents.error}
              label="Agents Enabled"
              to="/agents"
              description={
                <span>
                  {data.agents.running} running, {data.agents.paused} paused, {data.agents.error} errors
                </span>
              }
            />
            <MetricCard
              icon={FileWarning}
              value={data.pendingApprovals}
              label="Pending Approvals"
              to="/approvals"
              description={<span>{data.staleTasks} stale coarse tasks</span>}
            />
            <MetricCard
              icon={Clock3}
              value={data.protocol.staleQueueCount}
              label="Stale Protocol Work"
              to="/activity"
              description={<span>{data.tasks.open} open issues in total</span>}
            />
            <MetricCard
              icon={ShieldAlert}
              value={formatCents(data.costs.monthSpendCents)}
              label="Month Spend"
              to="/costs"
              description={
                <span>
                  {data.costs.monthBudgetCents > 0
                    ? `${data.costs.monthUtilizationPercent}% of ${formatCents(data.costs.monthBudgetCents)} budget`
                    : "Unlimited budget"}
                </span>
              }
            />
          </div>
        </>
      )}
    </div>
  );
}
