import { useEffect, useMemo } from "react";
import { useSearchParams } from "@/lib/router";
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
import { CircleDot, GitBranch, ShieldAlert, Workflow } from "lucide-react";
import { HeroSection } from "../components/HeroSection";
import { MetricCardV2 } from "../components/MetricCardV2";
import { QueueCardV2 } from "../components/QueueCardV2";
import { PageSkeleton } from "../components/PageSkeleton";

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

  const { data: issues, isLoading, error } = useQuery({
    queryKey: queryKeys.issues.list(selectedCompanyId!),
    queryFn: () => issuesApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const updateIssue = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      issuesApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.list(selectedCompanyId!) });
    },
  });

  const issueSummary = useMemo(() => {
    const rows = issues ?? [];
    return {
      total: rows.length,
      active: rows.filter((issue) => ["todo", "in_progress", "in_review", "blocked"].includes(issue.status)).length,
      review: rows.filter((issue) => issue.status === "in_review").length,
      blocked: rows.filter((issue) => issue.status === "blocked").length,
      live: rows.filter((issue) => liveIssueIds.has(issue.id)).length,
    };
  }, [issues, liveIssueIds]);

  if (!selectedCompanyId) {
    return <EmptyState icon={CircleDot} message="Select a company to view issues." />;
  }

  if (isLoading || protocolQueueQuery.isLoading) {
    return <PageSkeleton variant="list" />;
  }

  const executionQueue = protocolQueueQuery.data?.buckets.executionQueue ?? [];
  const reviewQueue = protocolQueueQuery.data?.buckets.reviewQueue ?? [];
  const blockedQueue = protocolQueueQuery.data?.buckets.blockedQueue ?? [];
  const handoffQueue = protocolQueueQuery.data?.buckets.handoffBlockerQueue ?? [];

  return (
    <div className="space-y-8">
      <HeroSection
        title="Work"
        subtitle="See the flow of execution, review pressure, and stalled ownership before dropping into the full issue list."
      />

      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
        <MetricCardV2
          icon={Workflow}
          value={issueSummary.active}
          label="Active Work"
          description={<span>{issueSummary.total} total issues in this company.</span>}
        />
        <MetricCardV2
          icon={GitBranch}
          value={issueSummary.live}
          label="Live Execution"
          description={<span>Issues currently attached to running or queued heartbeat work.</span>}
        />
        <MetricCardV2
          icon={CircleDot}
          value={issueSummary.review}
          label="Review Queue"
          description={<span>Items already sitting in `in_review` and needing a decision.</span>}
        />
        <MetricCardV2
          icon={ShieldAlert}
          value={issueSummary.blocked}
          label="Blocked Work"
          description={<span>Issues stalled on dependencies, runtime failures, or manual action.</span>}
        />
      </div>

      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Operational lanes</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Structured by protocol queue, not just a flat list of issues.
            </p>
          </div>
        </div>
        <div className="grid gap-5 xl:grid-cols-2">
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
        </div>
      </section>

      <section className="rounded-[1.9rem] border border-border bg-card px-5 py-5 shadow-card">
        <IssuesList
          issues={issues ?? []}
          isLoading={isLoading}
          error={error as Error | null}
          agents={agents}
          liveIssueIds={liveIssueIds}
          viewStateKey="squadrail:work-view"
          legacyViewStateKey="squadrail:issues-view"
          initialAssignees={searchParams.get("assignee") ? [searchParams.get("assignee")!] : undefined}
          onUpdateIssue={(id, data) => updateIssue.mutate({ id, data })}
        />
      </section>
    </div>
  );
}
