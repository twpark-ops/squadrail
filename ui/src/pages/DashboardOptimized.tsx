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
import { RecoveryDrilldownPanel } from "../components/RecoveryDrilldownPanel";
import {
  AlertTriangle,
  Bot,
  CircleDot,
  Clock3,
  GitPullRequestArrow,
  LayoutDashboard,
  MessageSquareMore,
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

  return (
    <div className="space-y-10">
      {/* Hero - Larger, bolder */}
      <HeroSection
        title={company?.name ?? "Operations"}
        subtitle={
          <span className="text-muted-foreground">
            {agents?.length ?? 0} agents operating delivery loops · {activeIssues} active issues
          </span>
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
          {/* Key Metrics - 4 cards, generous spacing */}
          <section className="space-y-4">
            <div className="space-y-1">
              <h2 className="text-2xl font-bold tracking-tight">System Status</h2>
              <p className="text-sm text-muted-foreground">
                Queue pressure, human blockers, and execution health in one glance.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6">
              <MetricCardV2
                icon={CircleDot}
                value={data.protocol.executionQueueCount}
                label="Execution Queue"
                to={appRoutes.work}
                description={<span>{data.tasks.inProgress} in progress</span>}
              />
              <MetricCardV2
                icon={GitPullRequestArrow}
                value={data.protocol.reviewQueueCount}
                label="Review Backlog"
                to={appRoutes.work}
                description={<span>{data.protocol.readyToCloseCount} ready to close</span>}
              />
              <MetricCardV2
                icon={MessageSquareMore}
                value={data.protocol.handoffBlockerCount}
                label="Handoff Blockers"
                to={appRoutes.work}
                description={
                  <span>
                    {data.protocol.awaitingHumanDecisionCount} human, {data.protocol.readyToCloseCount} ready to close
                  </span>
                }
              />
              <MetricCardV2
                icon={AlertTriangle}
                value={data.protocol.blockedQueueCount + data.protocol.awaitingHumanDecisionCount}
                label="Blocked / Human"
                to={appRoutes.work}
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
                to={appRoutes.runs}
                description={<span>{data.protocol.protocolMessagesLast24h} messages in 24h</span>}
              />
              <MetricCardV2
                icon={Clock3}
                value={data.executionReliability.runningRuns + data.executionReliability.queuedRuns}
                label="Heartbeat Runs"
                to={appRoutes.runs}
                description={
                  <span>
                    {data.executionReliability.runningRuns} running, {data.executionReliability.queuedRuns} queued
                  </span>
                }
              />
              <MetricCardV2
                icon={MessageSquareMore}
                value={
                  data.executionReliability.dispatchTimeoutsLast24h
                  + data.executionReliability.processLostLast24h
                  + data.executionReliability.workspaceBlockedLast24h
                }
                label="Execution Risks (24h)"
                to={appRoutes.runs}
                description={
                  <span>
                    watchdog {data.executionReliability.dispatchRedispatchesLast24h}, blocked {data.executionReliability.workspaceBlockedLast24h}
                  </span>
                }
              />
            </div>
          </section>

          {/* Live Agent Activity - Promoted to top */}
          <section className="space-y-4">
            <div className="space-y-1">
              <h2 className="text-2xl font-bold tracking-tight">Live Agents</h2>
              <p className="text-sm text-muted-foreground">
                Agents currently executing work, streaming events, or waiting on the next protocol step.
              </p>
            </div>
            <ActiveAgentsPanel companyId={selectedCompanyId!} />
          </section>

          {/* Protocol Queues - 2 columns for better readability */}
          <section className="space-y-4">
            <div className="space-y-1">
              <h2 className="text-2xl font-bold tracking-tight">Protocol Queues</h2>
              <p className="text-sm text-muted-foreground">
                Delivery queues grouped by execution phase so blocked work and human decisions surface early.
              </p>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
                title="Handoff Blockers"
                subtitle="Review, board, and close handoffs"
                items={buckets?.handoffBlockerQueue ?? []}
                emptyMessage="No handoff blockers"
                icon={MessageSquareMore}
                variant="approval"
                to={appRoutes.work}
              />
              <QueueCardV2
                title="Violation Queue"
                subtitle="Protocol breakdowns"
                items={buckets?.violationQueue ?? []}
                emptyMessage="No violations"
                icon={ShieldAlert}
                variant="blocked"
                to={appRoutes.work}
              />
              <QueueCardV2
                title="Human Decisions"
                subtitle="Awaiting board direction"
                items={buckets?.humanDecisionQueue ?? []}
                emptyMessage="No decisions pending"
                icon={MessageSquareMore}
                variant="approval"
                to={appRoutes.work}
              />
              <QueueCardV2
                title="Stale Queue"
                subtitle="Long-running work"
                items={buckets?.staleQueue ?? []}
                emptyMessage="No stale work"
                icon={Clock3}
                variant="idle"
                to={appRoutes.work}
              />
            </div>
          </section>

          {/* Recovery Section */}
          {recoveryQueue && (
            <RecoveryDrilldownPanel
              companyId={selectedCompanyId!}
              items={recoveryQueue.items}
            />
          )}

          {/* Recent Activity - Compact */}
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold tracking-tight">Recent Activity</h2>
              <Link to={appRoutes.runs} className="text-sm font-medium text-primary hover:underline">
                View all
              </Link>
            </div>
            <div className="overflow-hidden rounded-xl border border-border divide-y divide-border bg-card">
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
          </section>
        </>
      )}
    </div>
  );
}
