import { useEffect } from "react";
import { Link } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Bot, LifeBuoy, TimerReset } from "lucide-react";
import { dashboardApi } from "../api/dashboard";
import { heartbeatsApi } from "../api/heartbeats";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { relativeTime } from "../lib/utils";
import { workIssuePath } from "../lib/appRoutes";
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

  return (
    <div className="space-y-8">
      <section className="rounded-3xl border border-border bg-card px-6 py-6 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-muted-foreground">
              <TimerReset className="h-3.5 w-3.5" />
              Runtime visibility foundation
            </div>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight">Runs</h1>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
              Live execution, recovery backlog, and recent heartbeat runs. This is the operator view of
              runtime health before the deeper recovery UI lands.
            </p>
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <section className="rounded-2xl border border-border bg-card shadow-card">
          <div className="border-b border-border px-6 py-4">
            <h2 className="text-lg font-semibold">Live Runs</h2>
            <p className="mt-1 text-sm text-muted-foreground">Agent executions currently moving work forward.</p>
          </div>
          <div className="divide-y divide-border">
            {(liveRunsQuery.data ?? []).length === 0 ? (
              <div className="px-6 py-8 text-sm text-muted-foreground">No live runs right now.</div>
            ) : (
              (liveRunsQuery.data ?? []).map((run) => (
                <div key={run.id} className="flex items-start justify-between gap-4 px-6 py-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-[11px] font-medium text-blue-600 dark:text-blue-400">
                        {run.status}
                      </span>
                      <span className="text-xs text-muted-foreground">{run.agentName}</span>
                    </div>
                    <div className="mt-1 text-sm font-medium text-foreground">
                      {run.issueId ? `Issue-linked run ${run.id.slice(0, 8)}` : `Run ${run.id.slice(0, 8)}`}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {run.triggerDetail ?? run.invocationSource} · started {relativeTime(run.startedAt ?? run.createdAt)}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
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
              ))
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-card shadow-card">
          <div className="border-b border-border px-6 py-4">
            <h2 className="text-lg font-semibold">Recovery Queue</h2>
            <p className="mt-1 text-sm text-muted-foreground">Runs and protocol cases that need operator attention.</p>
          </div>
          <div className="divide-y divide-border">
            {(recoveryQuery.data?.items ?? []).length === 0 ? (
              <div className="px-6 py-8 text-sm text-muted-foreground">No recovery items waiting.</div>
            ) : (
              recoveryQuery.data!.items.map((item) => (
                <div key={`${item.issueId}-${item.code ?? "runtime"}`} className="px-6 py-4">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {item.recoveryType} · {item.severity}
                  </div>
                  <div className="mt-1 text-sm font-medium text-foreground">{item.title}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{item.summary}</div>
                  <div className="mt-3 flex items-center gap-2">
                    <Link
                      to={workIssuePath(item.identifier ?? item.issueId)}
                      className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground no-underline hover:bg-accent"
                    >
                      Open issue
                    </Link>
                    <span className="text-xs text-muted-foreground">{item.nextAction}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      <section className="rounded-2xl border border-border bg-card shadow-card">
        <div className="border-b border-border px-6 py-4">
          <h2 className="text-lg font-semibold">Recent Heartbeats</h2>
          <p className="mt-1 text-sm text-muted-foreground">Most recent runs across the selected company.</p>
        </div>
        <div className="divide-y divide-border">
          {(recentRunsQuery.data ?? []).slice(0, 10).map((run) => (
            <div key={run.id} className="flex items-start justify-between gap-4 px-6 py-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                    {run.status}
                  </span>
                  <span className="text-xs text-muted-foreground">{run.invocationSource}</span>
                </div>
                <div className="mt-1 text-sm font-medium text-foreground">Run {run.id.slice(0, 8)}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  created {relativeTime(run.createdAt)} · {run.error ?? run.errorCode ?? "no summary"}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <LifeBuoy className="h-4 w-4 text-muted-foreground" />
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
