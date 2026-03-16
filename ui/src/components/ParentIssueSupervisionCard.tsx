import { Link } from "@/lib/router";
import type { DashboardTeamSupervisionItem } from "@squadrail/shared";
import { Identity } from "./Identity";
import { StatusBadge } from "./StatusBadge";
import { cn, relativeTime } from "../lib/utils";
import { workIssuePath } from "../lib/appRoutes";

interface ParentIssueSupervisionCardProps {
  rootIssueId: string;
  rootIdentifier: string | null;
  rootTitle: string;
  rootProjectName: string | null;
  items: DashboardTeamSupervisionItem[];
}

function kindBadgeClass(kind: string | null) {
  switch (kind) {
    case "implementation":
      return "border-blue-300/60 bg-blue-500/10 text-blue-700 dark:border-blue-500/30 dark:text-blue-300";
    case "review":
      return "border-amber-300/60 bg-amber-500/10 text-amber-700 dark:border-amber-500/30 dark:text-amber-300";
    case "qa":
      return "border-purple-300/60 bg-purple-500/10 text-purple-700 dark:border-purple-500/30 dark:text-purple-300";
    case "plan":
      return "border-sky-300/60 bg-sky-500/10 text-sky-700 dark:border-sky-500/30 dark:text-sky-300";
    default:
      return "border-border bg-muted/50 text-muted-foreground";
  }
}

function summaryKindTone(kind: string) {
  switch (kind) {
    case "blocked":
      return "text-red-600 dark:text-red-400";
    case "review":
      return "text-amber-600 dark:text-amber-400";
    case "active":
      return "text-blue-600 dark:text-blue-400";
    default:
      return "text-muted-foreground";
  }
}

function summaryKindLabel(kind: string) {
  switch (kind) {
    case "blocked":
      return "Blocked";
    case "review":
      return "Review";
    case "active":
      return "Active";
    default:
      return "Queued";
  }
}

export function ParentIssueSupervisionCard({
  rootIssueId,
  rootIdentifier,
  rootTitle,
  rootProjectName,
  items,
}: ParentIssueSupervisionCardProps) {
  const counts = {
    active: items.filter((i) => i.summaryKind === "active").length,
    blocked: items.filter((i) => i.summaryKind === "blocked").length,
    review: items.filter((i) => i.summaryKind === "review").length,
    queued: items.filter((i) => i.summaryKind === "queued").length,
  };

  return (
    <div className="rounded-[1.35rem] border border-border bg-background">
      <div className="border-b border-border px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <Link
              to={workIssuePath(rootIdentifier ?? rootIssueId)}
              className="text-sm font-semibold text-foreground no-underline hover:underline"
            >
              <span className="mr-1.5 font-mono text-muted-foreground">
                {rootIdentifier ?? rootIssueId.slice(0, 8)}
              </span>
              {rootTitle}
            </Link>
            {rootProjectName && (
              <div className="mt-0.5 text-xs text-muted-foreground">
                {rootProjectName}
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5 text-[10px] font-medium">
            {counts.active > 0 && (
              <span className="rounded-full border border-blue-300/60 bg-blue-500/10 px-2 py-0.5 text-blue-700 dark:text-blue-300">
                {counts.active} active
              </span>
            )}
            {counts.blocked > 0 && (
              <span className="rounded-full border border-red-300/60 bg-red-500/10 px-2 py-0.5 text-red-700 dark:text-red-300">
                {counts.blocked} blocked
              </span>
            )}
            {counts.review > 0 && (
              <span className="rounded-full border border-amber-300/60 bg-amber-500/10 px-2 py-0.5 text-amber-700 dark:text-amber-300">
                {counts.review} review
              </span>
            )}
            {counts.queued > 0 && (
              <span className="rounded-full border border-border bg-muted/50 px-2 py-0.5 text-muted-foreground">
                {counts.queued} queued
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="divide-y divide-border">
        {items.map((item) => (
          <div
            key={item.workItemIssueId}
            className="flex items-start gap-3 px-4 py-2.5"
          >
            <div className="min-w-0 flex-1">
              <Link
                to={workIssuePath(
                  item.workItemIdentifier ?? item.workItemIssueId,
                )}
                className="text-sm text-foreground no-underline hover:underline"
              >
                {item.workItemTitle}
              </Link>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <StatusBadge status={item.issueStatus} />
                {item.kind && (
                  <span
                    className={cn(
                      "rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                      kindBadgeClass(item.kind),
                    )}
                  >
                    {item.kind}
                  </span>
                )}
                <span
                  className={cn(
                    "text-[10px] font-medium",
                    summaryKindTone(item.summaryKind),
                  )}
                >
                  {summaryKindLabel(item.summaryKind)}
                </span>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {item.assignee && (
                <Identity name={item.assignee.name} size="sm" />
              )}
              <span className="text-[10px] tabular-nums text-muted-foreground">
                {relativeTime(item.updatedAt)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
