import { useEffect, useMemo } from "react";
import { Link } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import {
  ExternalLink,
  GitBranch,
  GitCommitHorizontal,
  MoveRight,
  Workflow,
  Inbox,
} from "lucide-react";
import { dashboardApi } from "../api/dashboard";
import { issuesApi } from "../api/issues";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { relativeTime } from "../lib/utils";
import { changeIssuePath, workIssuePath } from "../lib/appRoutes";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { ChangeReviewDesk } from "../components/ChangeReviewDesk";
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

function ChangeLane({
  title,
  subtitle,
  icon,
  items,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  items: ChangeLaneItem[];
}) {
  if (items.length === 0) return null;

  return (
    <section className="overflow-hidden rounded-[1.45rem] border border-border bg-card shadow-card">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        {icon}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-foreground">{title}</h2>
            <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
              {items.length}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
        </div>
      </div>
      <div className="divide-y divide-border/85">
        {items.map((item) => (
          <div
            key={item.issueId}
            className="flex items-start justify-between gap-4 px-4 py-3"
          >
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-border bg-background px-2 py-0.5 font-['IBM_Plex_Mono'] text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  {item.identifier ?? item.issueId.slice(0, 8)}
                </span>
                {item.workflowState && (
                  <StatusBadgeV2
                    state={item.workflowState}
                    showIcon={false}
                    className="px-2 py-0.5 text-[10px]"
                  />
                )}
                {item.projectName && (
                  <span className="text-[10px] text-muted-foreground">
                    {item.projectName}
                  </span>
                )}
              </div>
              <div className="text-sm font-medium text-foreground">
                {item.title}
              </div>
              {item.summary && (
                <div className="text-xs leading-5 text-muted-foreground line-clamp-1">
                  {item.summary}
                </div>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Button asChild size="sm" variant="outline" className="h-7 rounded-full px-2.5 text-xs">
                <Link to={changeIssuePath(item.identifier ?? item.issueId)}>
                  <GitBranch className="h-3 w-3" />
                  Review
                </Link>
              </Button>
              <Button asChild size="sm" variant="ghost" className="h-7 rounded-full px-2.5 text-xs">
                <Link to={workIssuePath(item.identifier ?? item.issueId)}>
                  <ExternalLink className="h-3 w-3" />
                </Link>
              </Button>
            </div>
          </div>
        ))}
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
        summary: item.latestMessage?.summary ?? "Implementation running or queued.",
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
        summary: item.latestMessage?.summary ?? "Approved — waiting for close or merge.",
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
        summary: `Closed ${issue.updatedAt ? relativeTime(issue.updatedAt) : "recently"}`,
      }));
  }, [issuesQuery.data]);

  const primaryReviewItem =
    reviewReady[0] ?? mergeCandidates[0] ?? changesInMotion[0] ?? null;

  const primaryReviewSurfaceQuery = useQuery({
    queryKey: primaryReviewItem
      ? queryKeys.issues.changeSurface(primaryReviewItem.issueId)
      : ["issues", "change-surface", "__none__"],
    queryFn: () => issuesApi.getChangeSurface(primaryReviewItem!.issueId),
    enabled: Boolean(primaryReviewItem),
    staleTime: 15_000,
  });

  if (!selectedCompanyId) {
    return (
      <EmptyState
        icon={GitBranch}
        message="Select a company to inspect delivery changes."
      />
    );
  }

  if (issuesQuery.isLoading || queueQuery.isLoading) {
    return <PageSkeleton variant="list" />;
  }

  const totalActionable = reviewReady.length + mergeCandidates.length;
  const totalAll = changesInMotion.length + reviewReady.length + mergeCandidates.length + recentlyClosed.length;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Review queue
          </div>
          <h1 className="mt-1 text-2xl font-semibold text-foreground">Changes</h1>
        </div>
        {primaryReviewItem && (
          <Link
            to={changeIssuePath(primaryReviewItem.identifier ?? primaryReviewItem.issueId)}
            className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-4 py-2 text-sm font-medium text-foreground no-underline transition-colors hover:border-primary/18 hover:bg-accent"
          >
            Open next review
            <MoveRight className="h-4 w-4" />
          </Link>
        )}
      </div>

      {/* Summary bar */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {reviewReady.length > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300/60 bg-amber-500/10 px-2.5 py-1 font-medium text-amber-700 dark:text-amber-300">
            <span className="tabular-nums">{reviewReady.length}</span> needs review
          </span>
        )}
        {mergeCandidates.length > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300/60 bg-emerald-500/10 px-2.5 py-1 font-medium text-emerald-700 dark:text-emerald-300">
            <span className="tabular-nums">{mergeCandidates.length}</span> ready to merge
          </span>
        )}
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 font-medium text-muted-foreground">
          <span className="tabular-nums text-foreground">{changesInMotion.length}</span> in motion
        </span>
        {recentlyClosed.length > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 font-medium text-muted-foreground">
            <span className="tabular-nums text-foreground">{recentlyClosed.length}</span> closed
          </span>
        )}
      </div>

      {/* All clear state */}
      {totalAll === 0 && (
        <div className="rounded-[1.45rem] border border-dashed border-border bg-card px-6 py-10 text-center">
          <Inbox className="mx-auto h-8 w-8 text-muted-foreground/40" />
          <div className="mt-3 text-sm font-medium text-foreground">Review queue is clear</div>
          <div className="mt-1 text-xs text-muted-foreground">
            No changes need attention right now. Active work will appear here when it reaches review or merge.
          </div>
        </div>
      )}

      {/* Primary Review Desk — only when there's something to review */}
      {primaryReviewItem && (reviewReady.length > 0 || mergeCandidates.length > 0) && (
        <ChangeReviewDesk
          companyId={selectedCompanyId}
          issueId={primaryReviewItem.issueId}
          issueRef={primaryReviewItem.identifier ?? primaryReviewItem.issueId.slice(0, 8)}
          issueTitle={primaryReviewItem.title}
          reviewHref={changeIssuePath(primaryReviewItem.identifier ?? primaryReviewItem.issueId)}
          workHref={workIssuePath(primaryReviewItem.identifier ?? primaryReviewItem.issueId)}
          surface={primaryReviewSurfaceQuery.data}
          compact
        />
      )}

      {/* Lanes — ordered by urgency, empty sections hidden */}
      <ChangeLane
        title="Needs review"
        subtitle="Handoff complete — reviewer or QA decision is next."
        icon={<GitBranch className="h-4 w-4 text-amber-600 dark:text-amber-400" />}
        items={reviewReady}
      />

      <ChangeLane
        title="Ready to merge"
        subtitle="Approved and waiting for close, merge, or deploy."
        icon={<GitCommitHorizontal className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />}
        items={mergeCandidates}
      />

      <ChangeLane
        title="Implementation in motion"
        subtitle="Engineering work that will become the next review handoff."
        icon={<Workflow className="h-4 w-4 text-blue-600 dark:text-blue-400" />}
        items={changesInMotion}
      />

      <ChangeLane
        title="Recently closed"
        subtitle="May need downstream merge, audit, or rollout follow-through."
        icon={<GitCommitHorizontal className="h-4 w-4 text-muted-foreground" />}
        items={recentlyClosed}
      />
    </div>
  );
}
