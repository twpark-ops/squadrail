import { useEffect, useMemo } from "react";
import { Link } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { dashboardApi } from "../api/dashboard";
import { activityApi } from "../api/activity";
import { issuesApi } from "../api/issues";
import { agentsApi } from "../api/agents";
import { heartbeatsApi } from "../api/heartbeats";
import { useCompany } from "../context/CompanyContext";
import { useDialog } from "../context/DialogContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { MetricCardV2 } from "../components/MetricCardV2";
import { QueueCardV2 } from "../components/QueueCardV2";
import { ActivityRow } from "../components/ActivityRow";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { ActiveAgentsPanel } from "../components/ActiveAgentsPanel";
import { HeroSection } from "../components/HeroSection";
import {
  AlertTriangle,
  Bot,
  CircleDot,
  Clock3,
  GitPullRequestArrow,
  LayoutDashboard,
  MessageSquareMore,
  MoveRight,
  ShieldAlert,
} from "lucide-react";
import type { Agent } from "@squadrail/shared";
import { appRoutes } from "../lib/appRoutes";

/**
 * Optimized Dashboard for Squadrail
 *
 * Design Goals:
 * - "Who's doing what" visible in 3 seconds
 * - Real-time agent activity at the top
 * - Clear visual hierarchy with generous spacing
 * - Reduced information overload
 */
export function DashboardOptimized() {
  const { selectedCompanyId, companies } = useCompany();
  const { openOnboarding } = useDialog();
  const { setBreadcrumbs } = useBreadcrumbs();

  useEffect(() => {
    setBreadcrumbs([{ label: "Overview" }]);
  }, [setBreadcrumbs]);

  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data, isLoading } = useQuery({
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
    return map;
  }, [issues, agents]);

  const entityTitleMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const i of issues ?? []) map.set(`issue:${i.id}`, i.title);
    return map;
  }, [issues]);

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
    return <EmptyState icon={LayoutDashboard} message="Create or select a company to view the operations console." />;
  }

  if (isLoading) {
    return <PageSkeleton variant="dashboard" />;
  }

  const hasNoAgents = agents !== undefined && agents.length === 0;
  const company = companies.find((c) => c.id === selectedCompanyId);
  const activeIssues = issues?.filter((i) => i.status !== "done" && i.status !== "cancelled").length ?? 0;
  const buckets = protocolQueue?.buckets;
  const recoveryItems = recoveryQueue?.items ?? [];
  const recoveryPreview = recoveryItems.slice(0, 3);
  const runningRuns = data?.executionReliability.runningRuns ?? 0;
  const queuedRuns = data?.executionReliability.queuedRuns ?? 0;
  const reviewReady = data?.protocol.reviewQueueCount ?? 0;
  const blockedCount = data?.protocol.blockedQueueCount ?? 0;
  const humanDecisionCount = data?.protocol.awaitingHumanDecisionCount ?? 0;

  return (
    <div className="space-y-8">
      <HeroSection
        eyebrow="Mission control"
        title="Overview"
        subtitle={
          <span>
            {company?.name ?? "Operations"} is running {agents?.length ?? 0} agents across {activeIssues} active issues.
            Use this surface for attention routing, not deep execution or recovery work.
          </span>
        }
        actions={
          <>
            <Link
              to={appRoutes.work}
              className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-4 py-2 text-sm font-medium text-foreground no-underline transition-colors hover:border-primary/18 hover:bg-accent"
            >
              Open work queue
              <MoveRight className="h-4 w-4" />
            </Link>
            <Link
              to={appRoutes.runs}
              className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium text-muted-foreground no-underline transition-colors hover:border-primary/18 hover:bg-accent hover:text-foreground"
            >
              Open runtime board
              <MoveRight className="h-4 w-4" />
            </Link>
          </>
        }
      />

      {hasNoAgents && (
        <div className="flex items-center justify-between gap-4 rounded-[1.6rem] border border-amber-300/24 bg-[color-mix(in_oklab,var(--card)_95%,#f7e6bd)] px-6 py-5 dark:border-amber-300/14 dark:bg-[linear-gradient(180deg,rgba(54,44,24,0.7),rgba(40,32,18,0.7))]">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-amber-300/22 bg-white/55 text-amber-700 dark:border-amber-300/18 dark:bg-white/6 dark:text-amber-200">
              <Bot className="h-5 w-5" />
            </div>
            <p className="text-sm font-medium text-amber-950 dark:text-amber-50">
              No agents are active yet. Seed the squad and assign an engine first.
            </p>
          </div>
          <button
            onClick={() => openOnboarding({ initialStep: 2, companyId: selectedCompanyId! })}
            className="shrink-0 rounded-full border border-amber-300/28 bg-white/72 px-4 py-2 text-sm font-semibold text-amber-900 transition-colors hover:bg-white hover:text-amber-950 dark:border-amber-300/16 dark:bg-white/8 dark:text-amber-50 dark:hover:bg-white/12"
          >
            Open setup
          </button>
        </div>
      )}

      {data && (
        <>
          <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
            <div className="space-y-4">
              <div className="space-y-1">
                <h2 className="text-2xl font-bold tracking-tight">System Status</h2>
                <p className="text-sm text-muted-foreground">
                  Queue pressure, review readiness, and execution risks in one pass.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <MetricCardV2
                  icon={CircleDot}
                  value={data.protocol.executionQueueCount}
                  label="Execution Queue"
                  to={appRoutes.work}
                  description={<span>{data.tasks.inProgress} issues actively moving through implementation.</span>}
                />
                <MetricCardV2
                  icon={GitPullRequestArrow}
                  value={reviewReady}
                  label="Review Backlog"
                  to={appRoutes.changes}
                  description={<span>{data.protocol.readyToCloseCount} are already near close readiness.</span>}
                />
                <MetricCardV2
                  icon={AlertTriangle}
                  value={blockedCount + humanDecisionCount}
                  label="Blocked / Human"
                  to={appRoutes.work}
                  description={<span>{blockedCount} blocked, {humanDecisionCount} waiting on a board or operator decision.</span>}
                />
                <MetricCardV2
                  icon={Clock3}
                  value={runningRuns + queuedRuns}
                  label="Heartbeat Runs"
                  to={appRoutes.runs}
                  description={<span>{runningRuns} running, {queuedRuns} queued across the selected company.</span>}
                />
              </div>
            </div>

            <section className="rounded-[1.75rem] border border-border bg-card px-5 py-5 shadow-card">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-foreground">Recovery Attention</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Keep recovery visible here, but move actual operator handling into `Runs`.
                  </p>
                </div>
                <Link
                  to={appRoutes.runs}
                  className="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground no-underline transition-colors hover:border-primary/18 hover:bg-accent"
                >
                  Open Runs
                </Link>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
                <div className="rounded-[1.2rem] border border-border bg-background/74 px-4 py-4">
                  <div className="text-[11px] font-medium tracking-[0.08em] text-muted-foreground">Open recovery items</div>
                  <div className="mt-2 text-3xl font-semibold text-foreground">{recoveryItems.length}</div>
                  <div className="mt-2 text-sm text-muted-foreground">Runtime, timeout, integrity, or violation work waiting for operator attention.</div>
                </div>
                <div className="rounded-[1.2rem] border border-border bg-background/74 px-4 py-4">
                  <div className="text-[11px] font-medium tracking-[0.08em] text-muted-foreground">Protocol risk</div>
                  <div className="mt-2 text-3xl font-semibold text-foreground">{data.protocol.openViolationCount}</div>
                  <div className="mt-2 text-sm text-muted-foreground">{data.protocol.protocolMessagesLast24h} protocol messages recorded in the last 24 hours.</div>
                </div>
                <div className="rounded-[1.2rem] border border-border bg-background/74 px-4 py-4">
                  <div className="text-[11px] font-medium tracking-[0.08em] text-muted-foreground">Execution risk</div>
                  <div className="mt-2 text-3xl font-semibold text-foreground">
                    {data.executionReliability.dispatchTimeoutsLast24h + data.executionReliability.workspaceBlockedLast24h}
                  </div>
                  <div className="mt-2 text-sm text-muted-foreground">
                    Timeout and workspace-block signals that should not stay buried in a queue list.
                  </div>
                </div>
              </div>

              {recoveryPreview.length > 0 && (
                <div className="mt-5 space-y-3">
                  {recoveryPreview.map((item) => (
                    <Link
                      key={`${item.issueId}-${item.code ?? "runtime"}`}
                      to={appRoutes.runs}
                      className="block rounded-[1.2rem] border border-border bg-background/74 px-4 py-4 no-underline transition-colors hover:border-primary/18 hover:bg-accent/28"
                    >
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="rounded-full border border-border px-2 py-0.5">
                          {item.recoveryType}
                        </span>
                        <span>{item.severity}</span>
                      </div>
                      <div className="mt-2 text-sm font-semibold text-foreground">{item.title}</div>
                      <div className="mt-1 text-sm text-muted-foreground">{item.nextAction}</div>
                    </Link>
                  ))}
                </div>
              )}
            </section>
          </section>

          <section className="space-y-4">
            <div className="space-y-1">
              <h2 className="text-2xl font-bold tracking-tight">Live Agents</h2>
              <p className="text-sm text-muted-foreground">
                See who is active now, what issue they are touching, and the latest meaningful signal.
              </p>
            </div>
            <ActiveAgentsPanel companyId={selectedCompanyId!} />
          </section>

          <section className="space-y-4">
            <div className="space-y-1">
              <h2 className="text-2xl font-bold tracking-tight">Protocol Queues</h2>
              <p className="text-sm text-muted-foreground">
                Four high-signal lanes for delivery flow. Deep recovery work stays in `Runs`.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
              <MetricCardV2
                icon={MessageSquareMore}
                value={data.protocol.handoffBlockerCount}
                label="Handoff Blockers"
                to={appRoutes.changes}
                description={<span>{humanDecisionCount} need explicit human judgment, close handoff, or approval routing.</span>}
              />
              <QueueCardV2
                title="Execution Queue"
                subtitle="Active engineering work"
                items={buckets?.executionQueue ?? []}
                emptyMessage="No execution work waiting"
                icon={CircleDot}
                variant="execution"
                to={appRoutes.work}
              />
              <QueueCardV2
                title="Review Backlog"
                subtitle="Under review"
                items={buckets?.reviewQueue ?? []}
                emptyMessage="No reviews waiting"
                icon={GitPullRequestArrow}
                variant="review"
                to={appRoutes.work}
              />
              <QueueCardV2
                title="Blocked Queue"
                subtitle="Environment or dependency issues"
                items={buckets?.blockedQueue ?? []}
                emptyMessage="No blocked issues"
                icon={AlertTriangle}
                variant="blocked"
                to={appRoutes.work}
              />
              <QueueCardV2
                title="Ready To Close"
                subtitle="Approved work near the finish line"
                items={buckets?.readyToCloseQueue ?? []}
                emptyMessage="Nothing is waiting for close or merge handoff."
                icon={ShieldAlert}
                variant="closure"
                to={appRoutes.changes}
              />
            </div>
          </section>

          <section className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
            <div className="rounded-[1.75rem] border border-border bg-card shadow-card">
              <div className="flex items-center justify-between border-b border-border px-5 py-4">
                <div>
                  <h2 className="text-lg font-semibold">Attention Notes</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Signals that explain why operators should move into `Work`, `Changes`, or `Runs`.
                  </p>
                </div>
              </div>
              <div className="grid gap-3 p-5">
                <div className="rounded-[1.2rem] border border-border bg-background/74 px-4 py-4">
                  <div className="text-[11px] font-medium tracking-[0.08em] text-muted-foreground">Review pressure</div>
                  <div className="mt-2 text-sm text-foreground">
                    {reviewReady > 0
                      ? `${reviewReady} items are already in review and ${data.protocol.readyToCloseCount} are close to merge or close handoff.`
                      : "No heavy review pressure right now."}
                  </div>
                </div>
                <div className="rounded-[1.2rem] border border-border bg-background/74 px-4 py-4">
                  <div className="text-[11px] font-medium tracking-[0.08em] text-muted-foreground">Human attention</div>
                  <div className="mt-2 text-sm text-foreground">
                    {humanDecisionCount > 0
                      ? `${humanDecisionCount} items are waiting on explicit board or operator decisions.`
                      : "No explicit board decisions are waiting right now."}
                  </div>
                </div>
                <div className="rounded-[1.2rem] border border-border bg-background/74 px-4 py-4">
                  <div className="text-[11px] font-medium tracking-[0.08em] text-muted-foreground">Stale work</div>
                  <div className="mt-2 text-sm text-foreground">
                    {data.protocol.staleQueueCount > 0
                      ? `${data.protocol.staleQueueCount} issues are staying in flow too long and need a fresh owner or recovery step.`
                      : "No stale flow signal is currently elevated."}
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold tracking-tight">Recent Activity</h2>
                <Link to={appRoutes.runs} className="text-sm font-medium text-primary hover:underline">
                  View all
                </Link>
              </div>
              <div className="overflow-hidden rounded-[1.75rem] border border-border divide-y divide-border bg-card">
                {recentActivity.length === 0 ? (
                  <EmptyState
                    icon={MessageSquareMore}
                    message="Activity will appear here once the squad starts moving through assignments, reviews, and recoveries."
                  />
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
            </div>
          </section>
        </>
      )}
    </div>
  );
}
