import { useEffect } from "react";
import { Link, useSearchParams } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Bot, Clock3, LifeBuoy, ShieldAlert } from "lucide-react";
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
import { PageTabBar } from "../components/PageTabBar";
import { Tabs, TabsContent } from "@/components/ui/tabs";

export function Runs() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [searchParams, setSearchParams] = useSearchParams();
  const runsView = (searchParams.get("view") as "live" | "recovery" | "history") ?? "live";
  const setRunsView = (v: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("view", v);
      return next;
    });
  };

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
    <Tabs value={runsView} onValueChange={setRunsView}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Runtime triage
            </div>
            <h1 className="mt-1 text-2xl font-semibold text-foreground">Runs</h1>
          </div>
          <PageTabBar
            items={[
              { value: "live", label: "Live" },
              { value: "recovery", label: "Recovery" },
              { value: "history", label: "History" },
            ]}
            value={runsView}
            onValueChange={setRunsView}
          />
        </div>

        {/* Compact summary bar */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 font-medium text-muted-foreground">
            <span className="tabular-nums text-foreground">{liveRuns.length}</span> live runs
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 font-medium text-muted-foreground">
            <span className="tabular-nums text-foreground">{recoverySummary?.totalCases ?? recoveryItems.length}</span> recovery
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 font-medium text-muted-foreground">
            <span className="tabular-nums text-foreground">{recoverySummary?.repeatedCases ?? 0}</span> repeated
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 font-medium text-muted-foreground">
            <span className="tabular-nums text-foreground">{recoverySummary?.operatorRequiredCases ?? 0}</span> operator required
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 font-medium text-muted-foreground">
            <span className="tabular-nums text-foreground">{failureCount}</span> recent failures
          </span>
        </div>

        {/* Live tab */}
        <TabsContent value="live" className="mt-0">
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
        </TabsContent>

        {/* Recovery tab */}
        <TabsContent value="recovery" className="mt-0">
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
        </TabsContent>

        {/* History tab */}
        <TabsContent value="history" className="mt-0">
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
        </TabsContent>
      </div>
    </Tabs>
  );
}
