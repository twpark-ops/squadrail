import { useEffect, useMemo } from "react";
import { Link } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import {
  ExternalLink,
  GitBranch,
  GitCommitHorizontal,
  MoveRight,
  ShieldCheck,
  TestTube2,
  Workflow,
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
import { HeroSection } from "../components/HeroSection";
import { ChangeReviewDesk } from "../components/ChangeReviewDesk";
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
  return state
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
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
    <section className="overflow-hidden rounded-[1.45rem] border border-border bg-card shadow-card">
      <div className="border-b border-border px-4 py-3.5">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
      </div>
      <div className="divide-y divide-border/85">
        {items.length === 0 ? (
          <div className="px-4 py-5">
            <div className="rounded-[1rem] border border-dashed border-border bg-background/55 px-4 py-5 text-sm text-muted-foreground">
              No changes in this lane yet.
            </div>
          </div>
        ) : (
          items.map((item) => (
            <div
              key={item.issueId}
              className="flex items-start justify-between gap-4 px-4 py-3.5"
            >
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-border bg-background px-2.5 py-1 font-['IBM_Plex_Mono'] text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    {item.identifier ?? item.issueId.slice(0, 8)}
                  </span>
                  {item.workflowState && (
                    <StatusBadgeV2
                      state={item.workflowState}
                      showIcon={false}
                      className="px-2.5 py-1 text-xs"
                    />
                  )}
                  {item.projectName && (
                    <span className="rounded-full border border-border bg-background px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                      {item.projectName}
                    </span>
                  )}
                </div>
                <div className="text-sm font-semibold text-foreground md:text-[15px]">
                  {item.title}
                </div>
                <div className="text-sm leading-6 text-muted-foreground">
                  {item.summary ??
                    `Updated ${
                      item.updatedAt ? relativeTime(item.updatedAt) : "recently"
                    } in ${formatWorkflowState(item.workflowState)}`}
                </div>
              </div>
              <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
                <Button
                  asChild
                  size="sm"
                  variant="outline"
                  className="rounded-full"
                >
                  <Link to={changeIssuePath(item.identifier ?? item.issueId)}>
                    <GitBranch className="h-3.5 w-3.5" />
                    Open review
                  </Link>
                </Button>
                <Button
                  asChild
                  size="sm"
                  variant="ghost"
                  className="rounded-full"
                >
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
      (queueQuery.data?.buckets.executionQueue ?? [])
        .slice(0, 6)
        .map((item) => ({
          issueId: item.issueId,
          identifier: item.identifier,
          title: item.title,
          workflowState: item.workflowState,
          updatedAt: item.lastTransitionAt,
          projectName: item.projectName,
          summary:
            item.latestMessage?.summary ??
            "Implementation is currently running or queued.",
        })),
    [queueQuery.data]
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
        summary:
          item.latestMessage?.summary ?? "Ready for reviewer or QA decision.",
      })),
    [queueQuery.data]
  );

  const mergeCandidates = useMemo(
    () =>
      (queueQuery.data?.buckets.readyToCloseQueue ?? [])
        .slice(0, 6)
        .map((item) => ({
          issueId: item.issueId,
          identifier: item.identifier,
          title: item.title,
          workflowState: item.workflowState,
          updatedAt: item.lastTransitionAt,
          projectName: item.projectName,
          summary:
            item.latestMessage?.summary ??
            "Approved and waiting for explicit closure or merge handoff.",
        })),
    [queueQuery.data]
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
        summary:
          "Closed changes that may still need merge, audit, or rollout follow-through.",
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

  const reviewDesk = [
    {
      title: "Diff signal",
      description:
        "Open review should immediately surface changed files, diff summary, and implementation context.",
    },
    {
      title: "Verification evidence",
      description:
        "Show tests, checks, and verification summary before asking for a close decision.",
    },
    {
      title: "Rollback readiness",
      description:
        "Every near-close change needs a rollback path and merge status that can be inspected quickly.",
    },
  ];

  const primaryReviewRef =
    changesInMotion[0]?.identifier ??
    changesInMotion[0]?.issueId ??
    reviewReady[0]?.identifier ??
    reviewReady[0]?.issueId ??
    mergeCandidates[0]?.identifier ??
    mergeCandidates[0]?.issueId ??
    null;

  const reviewStack = [
    {
      title: "Ready for review",
      count: reviewReady.length,
      detail: reviewReady[0]
        ? `${reviewReady[0].identifier ?? reviewReady[0].issueId} · ${
            reviewReady[0].title
          }`
        : "No reviewer or QA handoff is waiting right now.",
      to: reviewReady[0]
        ? changeIssuePath(reviewReady[0].identifier ?? reviewReady[0].issueId)
        : null,
      cta: "Open next review",
    },
    {
      title: "Merge candidates",
      count: mergeCandidates.length,
      detail: mergeCandidates[0]
        ? `${mergeCandidates[0].identifier ?? mergeCandidates[0].issueId} · ${
            mergeCandidates[0].title
          }`
        : "No approval-complete changes are waiting for merge handoff.",
      to: mergeCandidates[0]
        ? changeIssuePath(
            mergeCandidates[0].identifier ?? mergeCandidates[0].issueId
          )
        : null,
      cta: "Inspect merge path",
    },
    {
      title: "Closed follow-through",
      count: recentlyClosed.length,
      detail: recentlyClosed[0]
        ? `${recentlyClosed[0].identifier ?? recentlyClosed[0].issueId} · ${
            recentlyClosed[0].title
          }`
        : "No closed changes need audit or rollout follow-through.",
      to: recentlyClosed[0]
        ? changeIssuePath(
            recentlyClosed[0].identifier ?? recentlyClosed[0].issueId
          )
        : null,
      cta: "Review closeout",
    },
  ] as const;
  const sparseReviewMode =
    reviewReady.length === 0 && mergeCandidates.length === 0;

  return (
    <div className="space-y-6">
      <HeroSection
        eyebrow="Review workspace"
        title="Changes"
        subtitle="Review handoff, evidence, and merge readiness without bouncing back into the generic work queue."
        actions={
          primaryReviewRef ? (
            <Link
              to={workIssuePath(primaryReviewRef)}
              className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-4 py-2 text-sm font-medium text-foreground no-underline transition-colors hover:border-primary/18 hover:bg-accent"
            >
              Inspect linked work
              <MoveRight className="h-4 w-4" />
            </Link>
          ) : undefined
        }
      />

      {primaryReviewItem && (
        <ChangeReviewDesk
          companyId={selectedCompanyId}
          issueId={primaryReviewItem.issueId}
          issueRef={
            primaryReviewItem.identifier ?? primaryReviewItem.issueId.slice(0, 8)
          }
          issueTitle={primaryReviewItem.title}
          reviewHref={changeIssuePath(
            primaryReviewItem.identifier ?? primaryReviewItem.issueId
          )}
          workHref={workIssuePath(
            primaryReviewItem.identifier ?? primaryReviewItem.issueId
          )}
          surface={primaryReviewSurfaceQuery.data}
          compact
        />
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCardV2
          icon={Workflow}
          value={changesInMotion.length}
          label="Implementation In Motion"
          description={
            <span>Changes currently moving through execution lanes.</span>
          }
        />
        <MetricCardV2
          icon={TestTube2}
          value={reviewReady.length}
          label="Review Ready"
          description={
            <span>
              Engineer handoff is done and a reviewer or QA decision is next.
            </span>
          }
        />
        <MetricCardV2
          icon={ShieldCheck}
          value={mergeCandidates.length}
          label="Merge Candidates"
          description={
            <span>Approved work that is ready to close, merge, or export.</span>
          }
        />
        <MetricCardV2
          icon={GitCommitHorizontal}
          value={recentlyClosed.length}
          label="Recently Closed"
          description={
            <span>
              Recently completed issues that may still need downstream release
              follow-through.
            </span>
          }
        />
      </div>

      <section
        className={`grid gap-5 ${
          sparseReviewMode
            ? "xl:grid-cols-[0.88fr_1.12fr]"
            : "xl:grid-cols-[0.92fr_1.08fr]"
        }`}
      >
        <div className="space-y-6">
          {sparseReviewMode ? (
            <>
              <section className="rounded-[1.45rem] border border-border bg-card px-4 py-4 shadow-card">
                <div className="space-y-1">
                  <h2 className="text-base font-semibold text-foreground">
                    Review lanes are clear
                  </h2>
                  <p className="text-sm leading-6 text-muted-foreground">
                    Nothing is waiting on reviewer or merge handoff right now.
                    Keep the desk compact and watch the next inflow instead of
                    staring at empty review lanes.
                  </p>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
                  {reviewStack.map((item) => (
                    <div
                      key={item.title}
                      className="rounded-[1rem] border border-border bg-background/70 px-4 py-3.5"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-foreground">
                            {item.title}
                          </div>
                          <div className="mt-1 text-sm leading-6 text-muted-foreground">
                            {item.detail}
                          </div>
                        </div>
                        <div className="text-xl font-semibold text-foreground">
                          {item.count}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
              <ChangeLane
                title="Implementation In Motion"
                subtitle="Execution work that is most likely to become the next review handoff."
                items={changesInMotion}
              />
            </>
          ) : (
            <>
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
            </>
          )}
        </div>

        <section className="rounded-[1.55rem] border border-border bg-card px-5 py-4.5 shadow-card">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold text-foreground">
                Review desk
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                This tab exists to answer one question: can this change be
                approved or closed with confidence?
              </p>
            </div>
            <span className="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground">
              Evidence first
            </span>
          </div>

          <div className="mt-4 grid gap-3">
            {reviewStack.map((item) => (
              <div
                key={item.title}
                className="rounded-[1rem] border border-border bg-background/72 px-4 py-3.5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-foreground">
                      {item.title}
                    </div>
                    <div className="mt-1 text-sm leading-6 text-muted-foreground">
                      {item.detail}
                    </div>
                  </div>
                  <div className="text-2xl font-semibold text-foreground">
                    {item.count}
                  </div>
                </div>
                {item.to && (
                  <Link
                    to={item.to}
                    className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-primary no-underline hover:underline"
                  >
                    {item.cta}
                    <MoveRight className="h-3.5 w-3.5" />
                  </Link>
                )}
              </div>
            ))}
          </div>

          <div className="mt-4 grid gap-3">
            {reviewDesk.map((item) => (
              <div
                key={item.title}
                className="rounded-[1rem] border border-border bg-background/72 px-4 py-3.5"
              >
                <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  {item.title}
                </div>
                <div className="mt-2 text-sm leading-6 text-foreground">
                  {item.description}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <div className="rounded-[1rem] border border-border bg-background/72 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-foreground">
                    Implementation trail
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    Active engineering work that will soon become a review item.
                  </div>
                </div>
                <Workflow className="h-4 w-4 text-primary" />
              </div>
              <div className="mt-4 space-y-3">
                {changesInMotion.length === 0 ? (
                  <div className="rounded-[1rem] border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
                    No implementation changes are currently moving.
                  </div>
                ) : (
                  changesInMotion.slice(0, 4).map((item) => (
                    <Link
                      key={item.issueId}
                      to={changeIssuePath(item.identifier ?? item.issueId)}
                      className="block rounded-[1rem] border border-border bg-card px-3 py-3 no-underline transition-colors hover:border-primary/18 hover:bg-accent/24"
                    >
                      <div className="text-sm font-semibold text-foreground">
                        {item.title}
                      </div>
                      <div className="mt-1 text-sm leading-6 text-muted-foreground">
                        {item.summary}
                      </div>
                    </Link>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-[1rem] border border-border bg-background/72 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-foreground">
                    Close follow-through
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    Completed work that may still need audit, release, or merge
                    verification.
                  </div>
                </div>
                <GitCommitHorizontal className="h-4 w-4 text-primary" />
              </div>
              <div className="mt-4 space-y-3">
                {recentlyClosed.length === 0 ? (
                  <div className="rounded-[1rem] border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
                    No recently closed changes yet.
                  </div>
                ) : (
                  recentlyClosed.slice(0, 4).map((item) => (
                    <Link
                      key={item.issueId}
                      to={changeIssuePath(item.identifier ?? item.issueId)}
                      className="block rounded-[1rem] border border-border bg-card px-3 py-3 no-underline transition-colors hover:border-primary/18 hover:bg-accent/24"
                    >
                      <div className="text-sm font-semibold text-foreground">
                        {item.title}
                      </div>
                      <div className="mt-1 text-sm leading-6 text-muted-foreground">
                        {item.summary}
                      </div>
                    </Link>
                  ))
                )}
              </div>
            </div>
          </div>
        </section>
      </section>

      {sparseReviewMode ? (
        recentlyClosed.length > 0 ? (
          <section className="rounded-[1.55rem] border border-border bg-card px-5 py-4.5 shadow-card">
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-foreground">
                Recent change trail
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Closed work that still deserves merge, audit, or rollout
                follow-through.
              </p>
            </div>
            <ChangeLane
              title="Recently Closed"
              subtitle="Recently closed work that should still be easy to audit, export, or compare with landed code."
              items={recentlyClosed}
            />
          </section>
        ) : null
      ) : (
        <section className="rounded-[1.55rem] border border-border bg-card px-5 py-4.5 shadow-card">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-foreground">
              Change lanes
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Secondary lanes that help operators compare active implementation
              with already-closed work.
            </p>
          </div>
          <div className="grid gap-5 xl:grid-cols-2">
            <ChangeLane
              title="Implementation In Motion"
              subtitle="Changes currently backed by execution work, queued implementation, or follow-up engineering activity."
              items={changesInMotion}
            />
            <ChangeLane
              title="Recently Closed"
              subtitle="Recently closed work that should still be easy to audit, export, or compare with landed code."
              items={recentlyClosed}
            />
          </div>
        </section>
      )}
    </div>
  );
}
