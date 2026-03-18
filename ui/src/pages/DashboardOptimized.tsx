import { useEffect, useMemo } from "react";
import { Link } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { deriveBudgetGuardrailStatus } from "@squadrail/shared";
import { dashboardApi } from "../api/dashboard";
import { activityApi } from "../api/activity";
import { issuesApi } from "../api/issues";
import { agentsApi } from "../api/agents";
import { costsApi } from "../api/costs";
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
import { BudgetGuardrailStrip } from "../components/BudgetGuardrailStrip";
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
import type { Agent, Issue, IssueProgressPhase } from "@squadrail/shared";
import { appRoutes } from "../lib/appRoutes";
import { buildCurrentDeliveryIssues } from "../lib/current-delivery";

const DELIVERY_PHASE_LABELS: Record<IssueProgressPhase, string> = {
  intake: "Intake",
  clarification: "Clarification",
  planning: "Planning",
  implementing: "Implementing",
  review: "Review",
  qa: "QA",
  merge: "Merge",
  blocked: "Blocked",
  done: "Done",
  cancelled: "Cancelled",
};

const DELIVERY_PHASE_TONE: Record<IssueProgressPhase, string> = {
  intake: "border-border bg-background text-muted-foreground",
  clarification:
    "border-sky-300/70 bg-sky-500/10 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/15 dark:text-sky-200",
  planning: "border-border bg-background text-muted-foreground",
  implementing: "border-border bg-background text-foreground",
  review:
    "border-amber-300/70 bg-amber-500/10 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-200",
  qa: "border-cyan-300/70 bg-cyan-500/10 text-cyan-700 dark:border-cyan-500/30 dark:bg-cyan-500/15 dark:text-cyan-200",
  merge:
    "border-emerald-300/70 bg-emerald-500/10 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-200",
  blocked:
    "border-red-300/70 bg-red-500/10 text-red-700 dark:border-red-500/30 dark:bg-red-500/15 dark:text-red-200",
  done:
    "border-emerald-300/70 bg-emerald-500/10 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-200",
  cancelled: "border-border bg-background text-muted-foreground",
};

function ownerLabel(issue: Issue, agentMap: Map<string, Agent>) {
  const snapshot = issue.progressSnapshot;
  if (!snapshot) return "No owner";
  if (snapshot.activeOwnerAgentId) {
    return agentMap.get(snapshot.activeOwnerAgentId)?.name ?? "Assigned owner";
  }
  if (snapshot.phase === "clarification") return "Waiting on human reply";
  if (snapshot.phase === "blocked") return "Recovery required";
  return "No owner";
}

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

  const { data, isLoading, isError } = useQuery({
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

  const { data: issuesWithSubtasks } = useQuery({
    queryKey: queryKeys.issues.listWithSubtasks(selectedCompanyId!),
    queryFn: () => issuesApi.list(selectedCompanyId!, { includeSubtasks: true }),
    enabled: !!selectedCompanyId,
  });

  // MTD by-agent costs for the budget guardrail strip top-burn section
  const mtdFrom = useMemo(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  }, []);
  const { data: mtdByAgent } = useQuery({
    queryKey: ["costs-by-agent", selectedCompanyId, mtdFrom],
    queryFn: () => costsApi.byAgent(selectedCompanyId!, mtdFrom),
    enabled: !!selectedCompanyId,
    staleTime: 60_000,
    retry: false,
  });

  const recentActivity = useMemo(
    () => (activity ?? []).slice(0, 8),
    [activity]
  );

  const agentMap = useMemo(() => {
    const map = new Map<string, Agent>();
    for (const a of agents ?? []) map.set(a.id, a);
    return map;
  }, [agents]);

  const entityNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const i of issuesWithSubtasks ?? issues ?? [])
      map.set(`issue:${i.id}`, i.identifier ?? i.id.slice(0, 8));
    for (const a of agents ?? []) map.set(`agent:${a.id}`, a.name);
    return map;
  }, [issuesWithSubtasks, issues, agents]);

  const entityTitleMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const i of issuesWithSubtasks ?? issues ?? []) map.set(`issue:${i.id}`, i.title);
    return map;
  }, [issuesWithSubtasks, issues]);

  const currentDelivery = useMemo(
    () => buildCurrentDeliveryIssues(issuesWithSubtasks ?? []),
    [issuesWithSubtasks],
  );

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
      <EmptyState
        icon={LayoutDashboard}
        message="Create or select a company to view the operations console."
      />
    );
  }

  if (isLoading) {
    return <PageSkeleton variant="dashboard" />;
  }

  if (isError || (!isLoading && !data)) {
    return (
      <div className="space-y-6">
        <HeroSection
          eyebrow="Mission control"
          title="Overview"
          subtitle={<span>Unable to load dashboard data. The server may be starting up.</span>}
          actions={
            <button
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-primary/18 hover:bg-accent"
            >
              Retry
            </button>
          }
        />
      </div>
    );
  }

  const hasNoAgents = agents !== undefined && agents.length === 0;
  const company = companies.find((c) => c.id === selectedCompanyId);
  const activeIssues =
    issues?.filter((i) => i.status !== "done" && i.status !== "cancelled")
      .length ?? 0;
  const buckets = protocolQueue?.buckets;
  const recoveryItems = recoveryQueue?.items ?? [];
  const recoveryPreview = recoveryItems.slice(0, 3);
  const reviewReady = data?.protocol.reviewQueueCount ?? 0;
  const blockedCount = data?.protocol.blockedQueueCount ?? 0;
  const humanDecisionCount = data?.protocol.awaitingHumanDecisionCount ?? 0;
  const attention = data?.attention;
  const knowledge = data?.knowledge;
  const budgetGuardrail = data?.costs
    ? deriveBudgetGuardrailStatus(data.costs.monthSpendCents, data.costs.monthBudgetCents)
    : null;

  const prioritySignals = data
    ? [
        {
          label: "Attention now",
          value: attention?.urgentIssueCount ?? 0,
          detail: `${attention?.runtimeRiskCount ?? 0} runtime · ${attention?.reviewPressureCount ?? 0} review`,
          to: appRoutes.runs,
        },
        {
          label: "Execution queue",
          value: data.protocol.executionQueueCount,
          detail: `${data.tasks.inProgress} moving now`,
          to: appRoutes.work,
        },
        {
          label: "Review backlog",
          value: attention?.reviewPressureCount ?? reviewReady,
          detail: `${data.protocol.readyToCloseCount} near close`,
          to: appRoutes.changes,
        },
        {
          label: "Knowledge coverage",
          value: knowledge?.connectedDocuments ?? 0,
          detail: `${knowledge?.totalDocuments ?? 0} docs · ${knowledge?.lowConfidenceRuns7d ?? 0} low confidence`,
          to: appRoutes.knowledge,
        },
      ]
    : [];

  return (
    <div className="space-y-6">
      <HeroSection
        eyebrow="Mission control"
        title="Overview"
        subtitle={
          <span>
            {company?.name ?? "Operations"} is running {agents?.length ?? 0}{" "}
            agents across {activeIssues} active issues. Start with live
            execution and elevated blockers, then move into `Work`, `Changes`,
            or `Runs` for action.
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
              No agents are active yet. Seed the squad and assign an engine
              first.
            </p>
          </div>
          <button
            onClick={() =>
              openOnboarding({ initialStep: 2, companyId: selectedCompanyId! })
            }
            className="shrink-0 rounded-full border border-amber-300/28 bg-white/72 px-4 py-2 text-sm font-semibold text-amber-900 transition-colors hover:bg-white hover:text-amber-950 dark:border-amber-300/16 dark:bg-white/8 dark:text-amber-50 dark:hover:bg-white/12"
          >
            Open setup
          </button>
        </div>
      )}

      {data && (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {prioritySignals.map((signal) => (
              <Link
                key={signal.label}
                to={signal.to}
                className="rounded-[1.1rem] border border-border bg-card px-4 py-3 no-underline shadow-card transition-colors hover:border-primary/18 hover:bg-accent/24"
              >
                <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  {signal.label}
                </div>
                <div className="mt-1.5 flex items-end justify-between gap-3">
                  <div className="text-[2rem] font-semibold tracking-[-0.05em] text-foreground">
                    {signal.value}
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    {signal.detail}
                  </div>
                </div>
              </Link>
            ))}
          </section>

          {currentDelivery.length > 0 && (
            <section className="space-y-3">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold tracking-tight">
                    Current delivery
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Parent issues first. This is the fastest read on where each
                    request sits, who owns it, and which delivery flow needs
                    attention now.
                  </p>
                </div>
                <Link
                  to={appRoutes.work}
                  className="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground no-underline transition-colors hover:border-primary/18 hover:bg-accent"
                >
                  Open work board
                </Link>
              </div>
              <div className="grid gap-4 xl:grid-cols-3">
                {currentDelivery.map((issue) => {
                  const snapshot = issue.progressSnapshot;
                  if (!snapshot) return null;
                  const subtaskSummary = snapshot.subtaskSummary;
                  return (
                    <Link
                      key={issue.id}
                      to={`${appRoutes.work}/${issue.identifier ?? issue.id}`}
                      className="rounded-[1.25rem] border border-border bg-card px-4 py-4 no-underline shadow-card transition-colors hover:border-primary/18 hover:bg-accent/24"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${DELIVERY_PHASE_TONE[snapshot.phase]}`}
                        >
                          {DELIVERY_PHASE_LABELS[snapshot.phase]}
                        </span>
                        <span className="text-[11px] font-medium text-muted-foreground">
                          {issue.identifier ?? issue.id.slice(0, 8)}
                        </span>
                      </div>
                      <div className="mt-3">
                        <div className="line-clamp-1 text-sm font-semibold text-foreground">
                          {issue.title}
                        </div>
                        <div className="mt-1 line-clamp-2 text-sm leading-6 text-muted-foreground">
                          {snapshot.headline}
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span className="rounded-full border border-border bg-background px-2 py-1">
                          {ownerLabel(issue, agentMap)}
                        </span>
                        {subtaskSummary.total > 0 && (
                          <span className="rounded-full border border-border bg-background px-2 py-1">
                            {subtaskSummary.done}/{subtaskSummary.total} subtasks done
                          </span>
                        )}
                        {snapshot.pendingClarificationCount > 0 && (
                          <span className="rounded-full border border-sky-300/70 bg-sky-500/10 px-2 py-1 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/15 dark:text-sky-200">
                            {snapshot.pendingClarificationCount} clarification
                          </span>
                        )}
                        {subtaskSummary.blocked > 0 && (
                          <span className="rounded-full border border-red-300/70 bg-red-500/10 px-2 py-1 text-red-700 dark:border-red-500/30 dark:bg-red-500/15 dark:text-red-200">
                            {subtaskSummary.blocked} blocked
                          </span>
                        )}
                      </div>
                    </Link>
                  );
                })}
              </div>
            </section>
          )}

          {budgetGuardrail && (
            <BudgetGuardrailStrip status={budgetGuardrail} topAgents={mtdByAgent} />
          )}

          <section className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
            <div className="space-y-3">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold tracking-tight">
                    Live operations
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    See who is active now and what signal is worth escalating
                    before reading queue summaries.
                  </p>
                </div>
                <Link
                  to={appRoutes.runs}
                  className="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground no-underline transition-colors hover:border-primary/18 hover:bg-accent"
                >
                  Open Runs
                </Link>
              </div>
              <ActiveAgentsPanel companyId={selectedCompanyId!} />
            </div>

            <section className="rounded-[1.55rem] border border-border bg-card px-5 py-5 shadow-card">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-foreground">
                    Recovery Attention
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Keep recovery visible here, but do the actual operator
                    handling inside `Runs`.
                  </p>
                </div>
                <span className="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground">
                  Escalate fast
                </span>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
                <div className="rounded-[1.1rem] border border-border bg-background/74 px-4 py-3.5">
                  <div className="text-[10px] font-semibold tracking-[0.1em] text-muted-foreground">
                    Open recovery items
                  </div>
                  <div className="mt-1.5 text-[2rem] font-semibold text-foreground">
                    {recoveryItems.length}
                  </div>
                  <div className="mt-1.5 text-sm leading-6 text-muted-foreground">
                    Runtime, timeout, integrity, or violation work waiting for
                    operator attention.
                  </div>
                </div>
                <div className="rounded-[1.1rem] border border-border bg-background/74 px-4 py-3.5">
                  <div className="text-[10px] font-semibold tracking-[0.1em] text-muted-foreground">
                    Protocol risk
                  </div>
                  <div className="mt-1.5 text-[2rem] font-semibold text-foreground">
                    {data.protocol.openViolationCount}
                  </div>
                  <div className="mt-1.5 text-sm leading-6 text-muted-foreground">
                    {data.protocol.protocolMessagesLast24h} protocol messages
                    recorded in the last 24 hours.
                  </div>
                </div>
                <div className="rounded-[1.1rem] border border-border bg-background/74 px-4 py-3.5">
                  <div className="text-[10px] font-semibold tracking-[0.1em] text-muted-foreground">
                    Execution risk
                  </div>
                  <div className="mt-1.5 text-[2rem] font-semibold text-foreground">
                    {data.executionReliability.dispatchTimeoutsLast24h +
                      data.executionReliability.workspaceBlockedLast24h}
                  </div>
                  <div className="mt-1.5 text-sm leading-6 text-muted-foreground">
                    Timeout and workspace-block signals that should not stay
                    buried in a queue list.
                  </div>
                </div>
              </div>

              {recoveryPreview.length > 0 && (
                <div className="mt-4 space-y-2.5">
                  {recoveryPreview.map((item) => (
                    <Link
                      key={`${item.issueId}-${item.code ?? "runtime"}`}
                      to={appRoutes.runs}
                      className="block rounded-[1rem] border border-border bg-background/74 px-4 py-3.5 no-underline transition-colors hover:border-primary/18 hover:bg-accent/28"
                    >
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="rounded-full border border-border px-2 py-0.5">
                          {item.recoveryType}
                        </span>
                        <span>{item.severity}</span>
                      </div>
                      <div className="mt-2 text-sm font-semibold text-foreground">
                        {item.title}
                      </div>
                      <div className="mt-1 text-sm leading-6 text-muted-foreground">
                        {item.nextAction}
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </section>
          </section>

          <section className="space-y-4">
            <div className="space-y-1">
              <h2 className="text-xl font-semibold tracking-tight">
                Protocol queues
              </h2>
              <p className="text-sm text-muted-foreground">
                Four high-signal lanes for delivery flow. Deep recovery work
                stays in `Runs`.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
              <MetricCardV2
                icon={MessageSquareMore}
                value={data.protocol.handoffBlockerCount}
                label="Handoff Blockers"
                to={appRoutes.changes}
                description={
                  <span>
                    {humanDecisionCount} need explicit human judgment, close
                    handoff, or approval routing.
                  </span>
                }
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

          <section className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
            <div className="rounded-[1.55rem] border border-border bg-card shadow-card">
              <div className="flex items-center justify-between border-b border-border px-5 py-4">
                <div>
                  <h2 className="text-lg font-semibold">Operator notes</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Signals that explain why operators should move into `Work`,
                    `Changes`, or `Runs`.
                  </p>
                </div>
              </div>
              <div className="grid gap-3 p-5">
                <div className="rounded-[1.05rem] border border-border bg-background/74 px-4 py-3.5">
                  <div className="text-[10px] font-semibold tracking-[0.1em] text-muted-foreground">
                    Review pressure
                  </div>
                  <div className="mt-2 text-sm leading-6 text-foreground">
                    {(attention?.reviewPressureCount ?? reviewReady) > 0
                      ? `${attention?.reviewPressureCount ?? reviewReady} items are clustered around review, and ${data.protocol.readyToCloseCount} are close to merge or close handoff.`
                      : "No heavy review pressure right now."}
                  </div>
                </div>
                <div className="rounded-[1.05rem] border border-border bg-background/74 px-4 py-3.5">
                  <div className="text-[10px] font-semibold tracking-[0.1em] text-muted-foreground">
                    Human attention
                  </div>
                  <div className="mt-2 text-sm leading-6 text-foreground">
                    {humanDecisionCount > 0 || blockedCount > 0
                      ? `${humanDecisionCount} items are waiting on explicit board decisions and ${blockedCount} remain blocked in flow.`
                      : "No explicit board decisions are waiting right now."}
                  </div>
                </div>
                <div className="rounded-[1.05rem] border border-border bg-background/74 px-4 py-3.5">
                  <div className="text-[10px] font-semibold tracking-[0.1em] text-muted-foreground">
                    Stale work
                  </div>
                  <div className="mt-2 text-sm leading-6 text-foreground">
                    {(attention?.staleWorkCount ?? data.protocol.staleQueueCount) > 0
                      ? `${attention?.staleWorkCount ?? data.protocol.staleQueueCount} active items are drifting and need a fresh owner or recovery step.`
                      : "No stale flow signal is currently elevated."}
                  </div>
                </div>
                <div className="rounded-[1.05rem] border border-border bg-background/74 px-4 py-3.5">
                  <div className="text-[10px] font-semibold tracking-[0.1em] text-muted-foreground">
                    Knowledge coverage
                  </div>
                  <div className="mt-2 text-sm leading-6 text-foreground">
                    {knowledge && knowledge.totalDocuments > 0
                      ? `${knowledge.connectedDocuments} of ${knowledge.totalDocuments} documents are connected into the graph, with ${knowledge.lowConfidenceRuns7d} low-confidence retrieval runs over the last 7 days.`
                      : "Knowledge coverage is still shallow; sync documents and graph links before relying on retrieval for review flow."}
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold tracking-tight">
                  Recent activity
                </h2>
                <Link
                  to={appRoutes.runs}
                  className="text-sm font-medium text-primary hover:underline"
                >
                  View all
                </Link>
              </div>
              <div className="overflow-hidden divide-y divide-border rounded-[1.55rem] border border-border bg-card">
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
