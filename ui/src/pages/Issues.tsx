import { useEffect, useMemo } from "react";
import { Link, useSearchParams } from "@/lib/router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { issuesApi } from "../api/issues";
import { agentsApi } from "../api/agents";
import { heartbeatsApi } from "../api/heartbeats";
import { dashboardApi } from "../api/dashboard";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { EmptyState } from "../components/EmptyState";
import { IssuesList } from "../components/IssuesList";
import {
  ArrowUpRight,
  CircleDot,
  Clock3,
  GitBranch,
  ShieldAlert,
  Users,
  Workflow,
} from "lucide-react";
import { PageTabBar } from "../components/PageTabBar";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { QueueCardV2 } from "../components/QueueCardV2";
import { PageSkeleton } from "../components/PageSkeleton";
import { appRoutes } from "../lib/appRoutes";

export function Issues() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();

  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: liveRuns } = useQuery({
    queryKey: queryKeys.liveRuns(selectedCompanyId!),
    queryFn: () => heartbeatsApi.liveRunsForCompany(selectedCompanyId!),
    enabled: !!selectedCompanyId,
    refetchInterval: 5000,
  });

  const liveIssueIds = useMemo(() => {
    const ids = new Set<string>();
    for (const run of liveRuns ?? []) {
      if (run.issueId) ids.add(run.issueId);
    }
    return ids;
  }, [liveRuns]);

  const protocolQueueQuery = useQuery({
    queryKey: queryKeys.dashboardProtocolQueue(selectedCompanyId!, 12),
    queryFn: () => dashboardApi.protocolQueue(selectedCompanyId!, 12),
    enabled: !!selectedCompanyId,
    refetchInterval: 15000,
  });

  useEffect(() => {
    setBreadcrumbs([{ label: "Work" }]);
  }, [setBreadcrumbs]);

  const {
    data: issues,
    isLoading,
    error,
  } = useQuery({
    queryKey: [...queryKeys.issues.list(selectedCompanyId!), "with-subtasks"],
    queryFn: () => issuesApi.list(selectedCompanyId!, { includeSubtasks: true }),
    enabled: !!selectedCompanyId,
  });

  const updateIssue = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      issuesApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.issues.list(selectedCompanyId!),
      });
    },
  });

  const issueSummary = useMemo(() => {
    const rows = issues ?? [];
    return {
      total: rows.length,
      active: rows.filter((issue) =>
        ["todo", "in_progress", "in_review", "blocked"].includes(issue.status)
      ).length,
      review: rows.filter((issue) => issue.status === "in_review").length,
      blocked: rows.filter((issue) => issue.status === "blocked").length,
      live: rows.filter((issue) => liveIssueIds.has(issue.id)).length,
    };
  }, [issues, liveIssueIds]);

  if (!selectedCompanyId) {
    return (
      <EmptyState icon={CircleDot} message="Select a company to view issues." />
    );
  }

  if (isLoading || protocolQueueQuery.isLoading) {
    return <PageSkeleton variant="list" />;
  }

  const executionQueue = protocolQueueQuery.data?.buckets.executionQueue ?? [];
  const reviewQueue = protocolQueueQuery.data?.buckets.reviewQueue ?? [];
  const blockedQueue = protocolQueueQuery.data?.buckets.blockedQueue ?? [];
  const handoffQueue =
    protocolQueueQuery.data?.buckets.handoffBlockerQueue ?? [];
  const readyToCloseQueue =
    protocolQueueQuery.data?.buckets.readyToCloseQueue ?? [];
  const humanDecisionQueue =
    protocolQueueQuery.data?.buckets.humanDecisionQueue ?? [];
  const staleQueue = protocolQueueQuery.data?.buckets.staleQueue ?? [];
  const focusCards = [
    {
      label: "Executing now",
      value: executionQueue.length,
      description: "Implementation work with active ownership.",
      to: appRoutes.changes,
      tone: "execution",
    },
    {
      label: "Needs review",
      value: reviewQueue.length,
      description: "Engineer handoff is done and a reviewer is next.",
      to: appRoutes.changes,
      tone: "review",
    },
    {
      label: "Blocked",
      value: blockedQueue.length,
      description:
        "Dependencies, runtime, or ownership issues are stopping flow.",
      to: appRoutes.runs,
      tone: "blocked",
    },
    {
      label: "Waiting on human",
      value: humanDecisionQueue.length,
      description: "Items that need explicit board or operator direction.",
      to: appRoutes.changes,
      tone: "human",
    },
    {
      label: "Ready to close",
      value: readyToCloseQueue.length,
      description: "Approved work approaching merge or close handoff.",
      to: appRoutes.changes,
      tone: "closure",
    },
    {
      label: "Stale or unassigned",
      value: staleQueue.length,
      description: "Work staying in flow too long without decisive movement.",
      to: appRoutes.runs,
      tone: "idle",
    },
  ] as const;

  const workView = (searchParams.get("view") as "board" | "list" | "queue") ?? "board";

  const setWorkView = (v: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("view", v);
      return next;
    });
  };

  return (
    <Tabs value={workView} onValueChange={setWorkView}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Delivery queue
            </div>
            <h1 className="mt-1 text-2xl font-semibold text-foreground">Work</h1>
          </div>
          <div className="flex items-center gap-3">
            <PageTabBar
              items={[
                { value: "board", label: "Board" },
                { value: "list", label: "List" },
                { value: "queue", label: "Queue" },
              ]}
              value={workView}
              onValueChange={setWorkView}
            />
            <div className="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground">
              {issueSummary.total} issues
            </div>
          </div>
        </div>

        {/* Compact summary bar — visible on Board & List tabs */}
        {workView !== "queue" && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {focusCards.map((card) => (
              <Link
                key={card.label}
                to={card.to}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 font-medium text-muted-foreground no-underline transition-colors hover:border-primary/18 hover:bg-accent/24"
              >
                <span className="tabular-nums text-foreground">{card.value}</span>
                <span>{card.label.toLowerCase()}</span>
              </Link>
            ))}
          </div>
        )}

        {/* Board tab (default) */}
        <TabsContent value="board" className="mt-0">
          <IssuesList
            issues={issues ?? []}
            isLoading={isLoading}
            error={error as Error | null}
            agents={agents}
            liveIssueIds={liveIssueIds}
            viewStateKey="squadrail:work-view"
            legacyViewStateKey="squadrail:issues-view"
            viewMode="board"
            initialAssignees={
              searchParams.get("assignee")
                ? [searchParams.get("assignee")!]
                : undefined
            }
            onUpdateIssue={(id, data) => updateIssue.mutate({ id, data })}
          />
        </TabsContent>

        {/* List tab */}
        <TabsContent value="list" className="mt-0">
          <section className="rounded-[1.55rem] border border-border bg-card px-5 py-4.5 shadow-card">
            <IssuesList
              issues={issues ?? []}
              isLoading={isLoading}
              error={error as Error | null}
              agents={agents}
              liveIssueIds={liveIssueIds}
              viewStateKey="squadrail:work-view"
              legacyViewStateKey="squadrail:issues-view"
              viewMode="list"
              initialAssignees={
                searchParams.get("assignee")
                  ? [searchParams.get("assignee")!]
                  : undefined
              }
              onUpdateIssue={(id, data) => updateIssue.mutate({ id, data })}
            />
          </section>
        </TabsContent>

        {/* Queue tab — operational dashboard */}
        <TabsContent value="queue" className="mt-0 space-y-6">
          <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {focusCards.map((card) => (
                <Link
                  key={card.label}
                  to={card.to}
                  className="rounded-[1.15rem] border border-border bg-card px-4 py-3.5 no-underline shadow-card transition-colors hover:border-primary/18 hover:bg-accent/24"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-[10px] font-semibold tracking-[0.1em] text-muted-foreground">
                        {card.label}
                      </div>
                      <div className="mt-1.5 text-[2rem] font-semibold text-foreground">
                        {card.value}
                      </div>
                    </div>
                    <span className="rounded-full border border-border bg-background px-2 py-1 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                      {card.tone}
                    </span>
                  </div>
                  <div className="mt-2 text-sm leading-6 text-muted-foreground">
                    {card.description}
                  </div>
                </Link>
              ))}
            </div>

            <section className="rounded-[1.45rem] border border-border bg-card px-5 py-4.5 shadow-card">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-foreground">
                    Work priorities
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Queue shape and pressure signals at a glance.
                  </p>
                </div>
                <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
              </div>

              <div className="mt-4 space-y-3">
                <div className="rounded-[1rem] border border-border bg-background/74 px-4 py-3.5">
                  <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <Workflow className="h-4 w-4 text-primary" />
                    Active flow
                  </div>
                  <div className="mt-2 text-sm text-muted-foreground">
                    {issueSummary.active} active issues, {issueSummary.live}{" "}
                    currently attached to running or queued heartbeat work.
                  </div>
                </div>
                <div className="rounded-[1rem] border border-border bg-background/74 px-4 py-3.5">
                  <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <Users className="h-4 w-4 text-primary" />
                    Human attention
                  </div>
                  <div className="mt-2 text-sm text-muted-foreground">
                    {humanDecisionQueue.length} human decisions and{" "}
                    {handoffQueue.length} close handoff blockers are visible.
                  </div>
                </div>
                <div className="rounded-[1rem] border border-border bg-background/74 px-4 py-3.5">
                  <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <Clock3 className="h-4 w-4 text-primary" />
                    Stale pressure
                  </div>
                  <div className="mt-2 text-sm text-muted-foreground">
                    {staleQueue.length} stale items and {issueSummary.blocked}{" "}
                    blocked issues need triage.
                  </div>
                </div>
              </div>
            </section>
          </section>

          <section className="space-y-4">
            <h2 className="text-lg font-semibold text-foreground">
              Operational lanes
            </h2>
            <div className="grid gap-4 xl:grid-cols-3">
              <QueueCardV2
                title="Execution now"
                subtitle="Issues with active implementation ownership."
                icon={Workflow}
                items={executionQueue}
                variant="execution"
                emptyMessage="No implementation work is moving right now."
                to="/changes"
              />
              <QueueCardV2
                title="Needs review"
                subtitle="Engineer handoff done, reviewer is next."
                icon={GitBranch}
                items={reviewQueue}
                variant="review"
                emptyMessage="Nothing is waiting on review right now."
                to="/changes"
              />
              <QueueCardV2
                title="Blocked"
                subtitle="Runtime, dependency, or ownership problems."
                icon={ShieldAlert}
                items={blockedQueue}
                variant="blocked"
                emptyMessage="No blocked work at the moment."
                to="/runs"
              />
              <QueueCardV2
                title="Handoff blockers"
                subtitle="Work needing explicit close or merge handoff."
                icon={CircleDot}
                items={handoffQueue}
                variant="closure"
                emptyMessage="No handoff blockers are waiting."
                to="/changes"
              />
              <QueueCardV2
                title="Waiting on human"
                subtitle="Board or operator decisions stalling flow."
                icon={Users}
                items={humanDecisionQueue}
                variant="approval"
                emptyMessage="No human decisions are waiting."
                to="/changes"
              />
              <QueueCardV2
                title="Ready to close"
                subtitle="Approved work approaching merge or close."
                icon={CircleDot}
                items={readyToCloseQueue}
                variant="closure"
                emptyMessage="Nothing is ready to close right now."
                to="/changes"
              />
            </div>
          </section>
        </TabsContent>
      </div>
    </Tabs>
  );
}
