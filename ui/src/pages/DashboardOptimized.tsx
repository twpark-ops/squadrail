import { useEffect, useMemo, useState } from "react";
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  AlertTriangle,
  Bot,
  ChevronDown,
  CircleDot,
  Clock3,
  GitPullRequestArrow,
  LayoutDashboard,
  MessageSquareMore,
  ShieldAlert,
} from "lucide-react";
import { cn } from "../lib/utils";
import type { Agent } from "@squadrail/shared";

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
  const [recoveryOpen, setRecoveryOpen] = useState(true);

  useEffect(() => {
    setBreadcrumbs([{ label: "Operations" }]);
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
            {agents?.length ?? 0} agents · {activeIssues} active issues
          </span>
        }
      />

      {hasNoAgents && (
        <div className="flex items-center justify-between gap-3 rounded-lg border-2 border-amber-300 bg-amber-50 dark:bg-amber-950/30 px-6 py-4">
          <div className="flex items-center gap-3">
            <Bot className="h-5 w-5 shrink-0 text-amber-600" />
            <p className="text-sm font-medium text-amber-900 dark:text-amber-100">
              No agents are active yet. Seed the squad and assign an engine first.
            </p>
          </div>
          <button
            onClick={() => openOnboarding({ initialStep: 2, companyId: selectedCompanyId! })}
            className="shrink-0 text-sm font-semibold text-amber-700 underline underline-offset-2 hover:text-amber-900"
          >
            Open setup
          </button>
        </div>
      )}

      {data && (
        <>
          {/* Key Metrics - 4 cards, generous spacing */}
          <section className="space-y-4">
            <h2 className="text-2xl font-bold tracking-tight">System Status</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6">
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
              <MetricCardV2
                icon={Clock3}
                value={data.executionReliability.runningRuns + data.executionReliability.queuedRuns}
                label="Heartbeat Runs"
                to="/agents"
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
                to="/activity"
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
            <h2 className="text-2xl font-bold tracking-tight">Live Agents</h2>
            <ActiveAgentsPanel companyId={selectedCompanyId!} />
          </section>

          {/* Protocol Queues - 2 columns for better readability */}
          <section className="space-y-4">
            <h2 className="text-2xl font-bold tracking-tight">Protocol Queues</h2>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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

          {/* Recovery Section - Collapsible */}
          {recoveryQueue && recoveryQueue.items.length > 0 && (
            <Collapsible open={recoveryOpen} onOpenChange={setRecoveryOpen}>
              <section className="space-y-4">
                <CollapsibleTrigger className="flex w-full items-center justify-between group">
                  <h2 className="text-2xl font-bold tracking-tight">Recovery Drill-down</h2>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">{recoveryQueue.items.length} cases</span>
                    <ChevronDown
                      className={cn(
                        "h-5 w-5 text-muted-foreground transition-transform",
                        recoveryOpen && "rotate-180"
                      )}
                    />
                  </div>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="rounded-xl border bg-card p-6">
                    <p className="text-sm text-muted-foreground mb-4">
                      Cross-issue violations, timeout escalations, and integrity backlog that need operator action.
                    </p>
                    {/* Recovery section content would go here */}
                  </div>
                </CollapsibleContent>
              </section>
            </Collapsible>
          )}

          {/* Recent Activity - Compact */}
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold tracking-tight">Recent Activity</h2>
              <Link to="/activity" className="text-sm font-medium text-primary hover:underline">
                View all
              </Link>
            </div>
            <div className="overflow-hidden rounded-xl border border-border divide-y divide-border bg-card">
              {recentActivity.length === 0 ? (
                <div className="p-12 text-center text-sm text-muted-foreground">No activity yet</div>
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
