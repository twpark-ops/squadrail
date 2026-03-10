import { useEffect, useMemo } from "react";
import { Link } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import {
  ExternalLink,
  GitBranch,
  GitCommitHorizontal,
  ShieldCheck,
  TestTube2,
  Workflow,
} from "lucide-react";
import { dashboardApi } from "../api/dashboard";
import { issuesApi } from "../api/issues";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { relativeTime, issueUrl } from "../lib/utils";
import { changeIssuePath, workIssuePath } from "../lib/appRoutes";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { HeroSection } from "../components/HeroSection";
import { MetricCardV2 } from "../components/MetricCardV2";
import { StatusBadgeV2 } from "../components/StatusBadgeV2";
import { Button } from "@/components/ui/button";

type ChangeLaneItem = {
  issueId: string;
  identifier: string | null;
  title: string;
  workflowState?: string | null;
  updatedAt?: Date | string | null;
  projectName?: string | null;
  summary?: string | null;
};

function formatWorkflowState(state: string | null | undefined) {
  if (!state) return "Idle";
  return state.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function ChangeLane({
  title,
  subtitle,
  items,
}: {
  title: string;
  subtitle: string;
  items: ChangeLaneItem[];
}) {
  return (
    <section className="overflow-hidden rounded-[1.8rem] border border-border bg-card shadow-card">
      <div className="border-b border-border px-5 py-4">
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
      </div>
      <div className="divide-y divide-border/85">
        {items.length === 0 ? (
          <div className="px-5 py-10">
            <EmptyState icon={GitCommitHorizontal} message="No changes in this lane yet." />
          </div>
        ) : (
          items.map((item) => (
            <div key={item.issueId} className="flex items-start justify-between gap-4 px-5 py-4">
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-border bg-background px-2.5 py-1 font-['IBM_Plex_Mono'] text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    {item.identifier ?? item.issueId.slice(0, 8)}
                  </span>
                  {item.workflowState && <StatusBadgeV2 state={item.workflowState} showIcon={false} className="px-2.5 py-1 text-xs" />}
                  {item.projectName && (
                    <span className="rounded-full border border-border bg-background px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                      {item.projectName}
                    </span>
                  )}
                </div>
                <div className="text-base font-semibold text-foreground">{item.title}</div>
                <div className="text-sm text-muted-foreground">
                  {item.summary ?? `Updated ${item.updatedAt ? relativeTime(item.updatedAt) : "recently"} in ${formatWorkflowState(item.workflowState)}`}
                </div>
              </div>
              <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
                <Button asChild size="sm" variant="outline" className="rounded-full">
                  <Link to={changeIssuePath(item.identifier ?? item.issueId)}>
                    <GitBranch className="h-3.5 w-3.5" />
                    Change View
                  </Link>
                </Button>
                <Button asChild size="sm" variant="ghost" className="rounded-full">
                  <Link to={workIssuePath(item.identifier ?? item.issueId)}>
                    <ExternalLink className="h-3.5 w-3.5" />
                    Work View
                  </Link>
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

export function Changes() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();

  useEffect(() => {
    setBreadcrumbs([{ label: "Changes" }]);
  }, [setBreadcrumbs]);

  const issuesQuery = useQuery({
    queryKey: queryKeys.issues.list(selectedCompanyId!),
    queryFn: () => issuesApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const queueQuery = useQuery({
    queryKey: queryKeys.dashboardProtocolQueue(selectedCompanyId!, 20),
    queryFn: () => dashboardApi.protocolQueue(selectedCompanyId!, 20),
    enabled: !!selectedCompanyId,
    refetchInterval: 15000,
  });

  const changesInMotion = useMemo(
    () =>
      (queueQuery.data?.buckets.executionQueue ?? []).slice(0, 6).map((item) => ({
        issueId: item.issueId,
        identifier: item.identifier,
        title: item.title,
        workflowState: item.workflowState,
        updatedAt: item.lastTransitionAt,
        projectName: item.projectName,
        summary: item.latestMessage?.summary ?? "Implementation is currently running or queued.",
      })),
    [queueQuery.data],
  );

  const reviewReady = useMemo(
    () =>
      (queueQuery.data?.buckets.reviewQueue ?? []).slice(0, 6).map((item) => ({
        issueId: item.issueId,
        identifier: item.identifier,
        title: item.title,
        workflowState: item.workflowState,
        updatedAt: item.lastTransitionAt,
        projectName: item.projectName,
        summary: item.latestMessage?.summary ?? "Ready for reviewer or QA decision.",
      })),
    [queueQuery.data],
  );

  const mergeCandidates = useMemo(
    () =>
      (queueQuery.data?.buckets.readyToCloseQueue ?? []).slice(0, 6).map((item) => ({
        issueId: item.issueId,
        identifier: item.identifier,
        title: item.title,
        workflowState: item.workflowState,
        updatedAt: item.lastTransitionAt,
        projectName: item.projectName,
        summary: item.latestMessage?.summary ?? "Approved and waiting for explicit closure or merge handoff.",
      })),
    [queueQuery.data],
  );

  const recentlyClosed = useMemo(() => {
    return [...(issuesQuery.data ?? [])]
      .filter((issue) => issue.status === "done")
      .sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt))
      .slice(0, 6)
      .map((issue) => ({
        issueId: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        workflowState: issue.status,
        updatedAt: issue.updatedAt,
        projectName: issue.project?.name ?? null,
        summary: "Closed changes that may still need merge, audit, or rollout follow-through.",
      }));
  }, [issuesQuery.data]);

  if (!selectedCompanyId) {
    return <EmptyState icon={GitBranch} message="Select a company to inspect delivery changes." />;
  }

  if (issuesQuery.isLoading || queueQuery.isLoading) {
    return <PageSkeleton variant="list" />;
  }

  return (
    <div className="space-y-8">
      <HeroSection
        title="Changes"
        subtitle="Review implementation flow, approval readiness, and merge handoff without digging through hidden worktrees."
      />

      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
        <MetricCardV2
          icon={Workflow}
          value={changesInMotion.length}
          label="Implementation In Motion"
          description={<span>Changes currently moving through execution lanes.</span>}
        />
        <MetricCardV2
          icon={TestTube2}
          value={reviewReady.length}
          label="Review Ready"
          description={<span>Engineer handoff is done and a reviewer or QA decision is next.</span>}
        />
        <MetricCardV2
          icon={ShieldCheck}
          value={mergeCandidates.length}
          label="Merge Candidates"
          description={<span>Approved work that is ready to close, merge, or export.</span>}
        />
        <MetricCardV2
          icon={GitCommitHorizontal}
          value={recentlyClosed.length}
          label="Recently Closed"
          description={<span>Recently completed issues that may still need downstream release follow-through.</span>}
        />
      </div>

      <section className="rounded-[1.9rem] border border-border bg-card px-5 py-5 shadow-card">
        <div className="grid gap-6 xl:grid-cols-2">
          <ChangeLane
            title="Implementation In Motion"
            subtitle="Changes currently backed by execution work, queued implementation, or follow-up engineering activity."
            items={changesInMotion}
          />
          <ChangeLane
            title="Review Ready"
            subtitle="Changes that already crossed the handoff boundary and need reviewer or QA attention."
            items={reviewReady}
          />
          <ChangeLane
            title="Merge Candidates"
            subtitle="Approved work waiting for explicit close, merge export, or merge-candidate follow-through."
            items={mergeCandidates}
          />
          <ChangeLane
            title="Recently Closed"
            subtitle="Recently closed work that should still be easy to audit, export, or compare with landed code."
            items={recentlyClosed}
          />
        </div>
      </section>
    </div>
  );
}
