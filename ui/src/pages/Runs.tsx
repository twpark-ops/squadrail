import { useEffect } from "react";
import { Link } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Bot, Clock3, LifeBuoy, ShieldAlert, TimerReset } from "lucide-react";
import { dashboardApi } from "../api/dashboard";
import { heartbeatsApi } from "../api/heartbeats";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { cn, relativeTime } from "../lib/utils";
import { workIssuePath } from "../lib/appRoutes";
import { getRunPhaseMeta } from "../lib/run-presence";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";

export function Runs() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();

  useEffect(() => {
    setBreadcrumbs([{ label: "Runs" }]);
  }, [setBreadcrumbs]);

  const liveRunsQuery = useQuery({
    queryKey: queryKeys.liveRuns(selectedCompanyId!),
    queryFn: () => heartbeatsApi.liveRunsForCompany(selectedCompanyId!),
    enabled: !!selectedCompanyId,
    refetchInterval: 5000,
  });

  const recentRunsQuery = useQuery({
    queryKey: ["heartbeat-runs", selectedCompanyId, "recent-foundation"],
    queryFn: () => heartbeatsApi.list(selectedCompanyId!, undefined, 20),
    enabled: !!selectedCompanyId,
  });

  const recoveryQuery = useQuery({
    queryKey: queryKeys.dashboardRecoveryQueue(selectedCompanyId!, 12),
    queryFn: () => dashboardApi.recoveryQueue(selectedCompanyId!, 12),
    enabled: !!selectedCompanyId,
    refetchInterval: 15000,
  });

  if (!selectedCompanyId) {
    return <EmptyState icon={Bot} message="Select a company to inspect agent runs." />;
  }

  if (liveRunsQuery.isLoading || recentRunsQuery.isLoading || recoveryQuery.isLoading) {
    return <PageSkeleton variant="list" />;
  }

  const liveRuns = liveRunsQuery.data ?? [];
  const recentRuns = recentRunsQuery.data ?? [];
  const recoveryItems = recoveryQuery.data?.items ?? [];
  const recoverySummary = recoveryQuery.data?.summary;
  const failureCount = recentRuns.filter((run) => ["failed", "timed_out"].includes(run.status)).length;
  const groupedRecovery = Object.entries(
    recoveryItems.reduce<Record<string, typeof recoveryItems>>((acc, item) => {
      acc[item.failureFamily] = [...(acc[item.failureFamily] ?? []), item];
      return acc;
    }, {}),
  );

  return (
    <div className="space-y-8">
      <section className="rounded-3xl border border-border bg-card px-6 py-6 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-muted-foreground">
              <TimerReset className="h-3.5 w-3.5" />
              Runtime triage
            </div>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight">Runs</h1>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
              Live execution, recovery backlog, and recent heartbeat runs. This surface should answer what is running, what failed, and what needs an operator next.
            </p>
          </div>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-[1.4rem] border border-border bg-card px-5 py-4 shadow-card">
          <div className="text-[11px] font-medium tracking-[0.08em] text-muted-foreground">Live runs</div>
          <div className="mt-2 text-3xl font-semibold text-foreground">{liveRuns.length}</div>
          <div className="mt-2 text-sm text-muted-foreground">Active or queued runtime sessions visible right now.</div>
        </div>
        <div className="rounded-[1.4rem] border border-border bg-card px-5 py-4 shadow-card">
          <div className="text-[11px] font-medium tracking-[0.08em] text-muted-foreground">Recovery Queue</div>
          <div className="mt-2 text-3xl font-semibold text-foreground">{recoverySummary?.totalCases ?? recoveryItems.length}</div>
          <div className="mt-2 text-sm text-muted-foreground">Failure learning feed grouped by recovery family and retryability.</div>
        </div>
        <div className="rounded-[1.4rem] border border-border bg-card px-5 py-4 shadow-card">
          <div className="text-[11px] font-medium tracking-[0.08em] text-muted-foreground">Repeated cases</div>
          <div className="mt-2 text-3xl font-semibold text-foreground">{recoverySummary?.repeatedCases ?? 0}</div>
          <div className="mt-2 text-sm text-muted-foreground">Recovery cases seen at least twice in the last 24 hours.</div>
        </div>
        <div className="rounded-[1.4rem] border border-border bg-card px-5 py-4 shadow-card">
          <div className="text-[11px] font-medium tracking-[0.08em] text-muted-foreground">Operator required</div>
          <div className="mt-2 text-3xl font-semibold text-foreground">{recoverySummary?.operatorRequiredCases ?? 0}</div>
          <div className="mt-2 text-sm text-muted-foreground">Cases that should not be blindly retried before operator review.</div>
        </div>
        <div className="rounded-[1.4rem] border border-border bg-card px-5 py-4 shadow-card">
          <div className="text-[11px] font-medium tracking-[0.08em] text-muted-foreground">Recent failures</div>
          <div className="mt-2 text-3xl font-semibold text-foreground">{failureCount}</div>
          <div className="mt-2 text-sm text-muted-foreground">Recent failed or timed out runs that still deserve operator context.</div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <section className="rounded-2xl border border-border bg-card shadow-card">
          <div className="border-b border-border px-6 py-4">
            <h2 className="text-lg font-semibold">Live Runs</h2>
            <p className="mt-1 text-sm text-muted-foreground">The current runtime ribbon. These cards should make execution state readable at a glance.</p>
          </div>
          <div className="grid gap-4 p-5 lg:grid-cols-2">
            {liveRuns.length === 0 ? (
              <div className="rounded-[1.2rem] border border-dashed border-border px-6 py-10 text-sm text-muted-foreground">
                No live runs right now.
              </div>
            ) : (
              liveRuns.map((run) => (
                <div key={run.id} className="rounded-[1.3rem] border border-border bg-background/72 p-4">
                  {(() => {
                    const phase = getRunPhaseMeta(run);
                    return (
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-[11px] font-medium text-blue-600 dark:text-blue-400">
                          {run.status}
                        </span>
                        <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em]", phase.className)}>
                          {phase.label}
                        </span>
                        <span className="text-xs text-muted-foreground">{run.agentName}</span>
                      </div>
                      <div className="mt-2 text-sm font-semibold text-foreground">
                        {run.issueId ? `Issue-linked run ${run.id.slice(0, 8)}` : `Run ${run.id.slice(0, 8)}`}
                      </div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        {run.triggerDetail ?? phase.summary}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                        <span className="rounded-full border border-border bg-card px-2.5 py-1">
                          started {relativeTime(run.startedAt ?? run.createdAt)}
                        </span>
                        <span className="rounded-full border border-border bg-card px-2.5 py-1">
                          {phase.threadLabel}
                        </span>
                        {run.issueId && (
                          <span className="rounded-full border border-border bg-card px-2.5 py-1">
                            issue linked
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col gap-2">
                      {run.issueId && (
                        <Link
                          to={workIssuePath(run.issueId)}
                          className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground no-underline hover:bg-accent"
                        >
                          Open work
                        </Link>
                      )}
                      <Link
                        to={`/agents/${run.agentId}/runs/${run.id}`}
                        className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground no-underline hover:bg-accent"
                      >
                        Run detail
                      </Link>
                    </div>
                  </div>
                    );
                  })()}
                </div>
              ))
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-card shadow-card">
          <div className="border-b border-border px-6 py-4">
            <h2 className="text-lg font-semibold">Recovery Queue</h2>
            <p className="mt-1 text-sm text-muted-foreground">Grouped by failure family so repeated issues are visible before the operator drills in.</p>
          </div>
          <div className="grid gap-4 p-5">
            {groupedRecovery.length === 0 ? (
              <div className="rounded-[1.2rem] border border-dashed border-border px-6 py-10 text-sm text-muted-foreground">
                No recovery items waiting.
              </div>
            ) : (
              groupedRecovery.map(([group, items]) => (
                <div key={group} className="rounded-[1.25rem] border border-border bg-background/72 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      <ShieldAlert className="h-4 w-4 text-primary" />
                      {group}
                    </div>
                    <span className="rounded-full border border-border bg-card px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                      {items.length}
                    </span>
                  </div>
                  <div className="mt-4 space-y-3">
                    {items.slice(0, 3).map((item) => (
                    <div key={`${item.issueId}-${item.code ?? "runtime"}`} className="rounded-[1rem] border border-border bg-card px-4 py-4">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        {item.severity} · {item.workflowState}
                        <span className="rounded-full border border-border px-2 py-0.5">
                          {item.retryability.replace(/_/g, " ")}
                        </span>
                        {item.repeated ? (
                          <span className="rounded-full border border-red-300 px-2 py-0.5 text-red-600">
                            repeated
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-2 text-sm font-semibold text-foreground">{item.title}</div>
                      <div className="mt-1 text-sm text-muted-foreground">{item.summary}</div>
                      <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                        <span className="rounded-full border border-border bg-background px-2.5 py-1">
                          {item.occurrenceCount24h} hits / 24h
                        </span>
                        <span className="rounded-full border border-border bg-background px-2.5 py-1">
                          {item.operatorActionLabel}
                        </span>
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-3">
                        <span className="text-xs text-muted-foreground">{item.nextAction}</span>
                        <Link
                            to={workIssuePath(item.identifier ?? item.issueId)}
                            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground no-underline hover:bg-accent"
                          >
                            Open issue
                          </Link>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.08fr_0.92fr]">
        <section className="rounded-2xl border border-border bg-card shadow-card">
          <div className="border-b border-border px-6 py-4">
            <h2 className="text-lg font-semibold">Recent Heartbeats</h2>
            <p className="mt-1 text-sm text-muted-foreground">Most recent runs across the selected company, with failures kept visually obvious.</p>
          </div>
          <div className="divide-y divide-border">
            {recentRuns.slice(0, 10).map((run) => (
              <div key={run.id} className="flex items-start justify-between gap-4 px-6 py-4">
                {(() => {
                  const phase = getRunPhaseMeta(run);
                  return (
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                        {run.status}
                      </span>
                    <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em]", phase.className)}>
                      {phase.label}
                    </span>
                  </div>
                  <div className="mt-1 text-sm font-medium text-foreground">Run {run.id.slice(0, 8)}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    created {relativeTime(run.createdAt)} · {run.error ?? run.errorCode ?? phase.summary}
                  </div>
                </div>
                  );
                })()}
                <div className="flex shrink-0 items-center gap-2">
                  {["failed", "timed_out"].includes(run.status) ? (
                    <AlertTriangle className="h-4 w-4 text-red-500" />
                  ) : (
                    <LifeBuoy className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-card shadow-card">
          <div className="border-b border-border px-6 py-4">
            <h2 className="text-lg font-semibold">Runtime Patterns</h2>
            <p className="mt-1 text-sm text-muted-foreground">A compact read on what is causing noise in the runtime surface.</p>
          </div>
          <div className="grid gap-4 p-5">
            <div className="rounded-[1.2rem] border border-border bg-background/72 px-4 py-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Clock3 className="h-4 w-4 text-primary" />
                Queue pressure
              </div>
              <div className="mt-2 text-sm text-muted-foreground">
                {liveRuns.filter((run) => run.status === "queued").length} queued runs are waiting for capacity right now.
              </div>
            </div>
            <div className="rounded-[1.2rem] border border-border bg-background/72 px-4 py-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <AlertTriangle className="h-4 w-4 text-primary" />
                Failure surface
              </div>
              <div className="mt-2 text-sm text-muted-foreground">
                {failureCount} recent failures or timeouts are visible in the last run slice.
              </div>
            </div>
            <div className="rounded-[1.2rem] border border-border bg-background/72 px-4 py-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Bot className="h-4 w-4 text-primary" />
                Recovery mix
              </div>
              <div className="mt-2 text-sm text-muted-foreground">
                {groupedRecovery.length === 0
                  ? "No recovery families are active."
                  : groupedRecovery.map(([group, items]) => `${group} ${items.length}`).join(" · ")}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
