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
import { HeroSection } from "../components/HeroSection";
import { QueueCardV2 } from "../components/QueueCardV2";
import { PageSkeleton } from "../components/PageSkeleton";
import { appRoutes } from "../lib/appRoutes";

export function Issues() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [searchParams] = useSearchParams();
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
    queryKey: queryKeys.issues.list(selectedCompanyId!),
    queryFn: () => issuesApi.list(selectedCompanyId!),
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

  return (
    <div className="space-y-6">
      <HeroSection
        eyebrow="Delivery queue"
        title="Work"
        subtitle="Read execution flow, review pressure, and stalled ownership before dropping into the full issue browser."
      />

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
                This page should let operators read queue shape before they ever
                touch a filter.
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
                {handoffQueue.length} close handoff blockers are visible before
                the issue browser.
              </div>
            </div>
            <div className="rounded-[1rem] border border-border bg-background/74 px-4 py-3.5">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Clock3 className="h-4 w-4 text-primary" />
                Stale pressure
              </div>
              <div className="mt-2 text-sm text-muted-foreground">
                {staleQueue.length} stale items and {issueSummary.blocked}{" "}
                blocked issues should be triaged before queue churn gets worse.
              </div>
            </div>
          </div>
        </section>
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              Operational lanes
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Categories are exposed on the page itself, not buried behind a
              filter popover.
            </p>
          </div>
        </div>
        <div className="grid gap-4 xl:grid-cols-3">
          <QueueCardV2
            title="Execution now"
            subtitle="Issues with active implementation ownership or follow-up execution in progress."
            icon={Workflow}
            items={executionQueue}
            variant="execution"
            emptyMessage="No implementation work is moving right now."
            to="/changes"
          />
          <QueueCardV2
            title="Needs review"
            subtitle="Engineer handoff is done and a reviewer, QA, or lead decision is next."
            icon={GitBranch}
            items={reviewQueue}
            variant="review"
            emptyMessage="Nothing is waiting on review right now."
            to="/changes"
          />
          <QueueCardV2
            title="Blocked"
            subtitle="Runtime, dependency, or ownership problems that are actively stalling work."
            icon={ShieldAlert}
            items={blockedQueue}
            variant="blocked"
            emptyMessage="No blocked work at the moment."
            to="/runs"
          />
          <QueueCardV2
            title="Handoff blockers"
            subtitle="Approved or half-closed work that still needs an explicit close, merge handoff, or operator action."
            icon={CircleDot}
            items={handoffQueue}
            variant="closure"
            emptyMessage="No handoff blockers are waiting."
            to="/changes"
          />
          <QueueCardV2
            title="Waiting on human"
            subtitle="Board or operator decisions that stall movement even when engineering work is complete."
            icon={Users}
            items={humanDecisionQueue}
            variant="approval"
            emptyMessage="No human decisions are waiting."
            to="/changes"
          />
          <QueueCardV2
            title="Ready to close"
            subtitle="Approved work that only needs explicit close, merge, or export follow-through."
            icon={CircleDot}
            items={readyToCloseQueue}
            variant="closure"
            emptyMessage="Nothing is ready to close right now."
            to="/changes"
          />
        </div>
      </section>

      <section className="rounded-[1.55rem] border border-border bg-card px-5 py-4.5 shadow-card">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              Queue browser
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Search, sort, and bulk review still live here, but the queue
              framing now leads the page.
            </p>
          </div>
          <div className="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground">
            {issueSummary.total} issues
          </div>
        </div>
        <IssuesList
          issues={issues ?? []}
          isLoading={isLoading}
          error={error as Error | null}
          agents={agents}
          liveIssueIds={liveIssueIds}
          viewStateKey="squadrail:work-view"
          legacyViewStateKey="squadrail:issues-view"
          initialAssignees={
            searchParams.get("assignee")
              ? [searchParams.get("assignee")!]
              : undefined
          }
          onUpdateIssue={(id, data) => updateIssue.mutate({ id, data })}
        />
      </section>
    </div>
  );
}
