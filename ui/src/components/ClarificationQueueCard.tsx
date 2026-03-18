import { ArrowUpRight } from "lucide-react";
import type { DashboardProtocolQueueItem } from "@squadrail/shared";
import { Link } from "@/lib/router";
import { timeAgo } from "@/lib/timeAgo";
import { workIssuePath } from "@/lib/appRoutes";
import { Identity } from "@/components/Identity";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

function formatProtocolValue(value: string | null | undefined) {
  if (!value) return "Unknown";
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatProtocolQueueOwner(item: DashboardProtocolQueueItem) {
  const pendingClarification = item.pendingHumanClarifications[0] ?? null;
  if (pendingClarification) {
    return `Asked by ${pendingClarification.askedByLabel}`;
  }
  if (item.nextOwnerRole) {
    return `Next owner ${item.nextOwnerRole.replace(/_/g, " ")}`;
  }
  return "Pending operator clarification";
}

function clarificationDomainLabel(value: string | null | undefined) {
  switch (value) {
    case "scope":
      return "Scope";
    case "requirement":
      return "Requirements";
    case "implementation":
      return "Implementation";
    case "environment":
      return "Environment";
    case "review_feedback":
      return "Review";
    default:
      return "Clarification";
  }
}

export function ClarificationQueueCard({
  item,
  testId,
}: {
  item: DashboardProtocolQueueItem;
  testId?: string;
}) {
  const pendingClarification = item.pendingHumanClarifications[0] ?? null;
  const issueHref = workIssuePath(item.identifier ?? item.issueId);
  const answerHref = pendingClarification
    ? `${issueHref}?tab=protocol&action=ANSWER_CLARIFICATION&clarification=${encodeURIComponent(pendingClarification.questionMessageId)}&source=inbox`
    : issueHref;
  const pendingCount = item.pendingHumanClarifications.length;
  const domainLabel = clarificationDomainLabel(pendingClarification?.questionType ?? null);

  return (
    <div
      data-testid={testId}
      className="rounded-xl border border-border bg-card p-4 transition-colors hover:bg-accent/20"
    >
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="font-mono">{item.identifier ?? item.issueId.slice(0, 8)}</span>
        <span>•</span>
        <span>{item.projectName ?? "No project"}</span>
        <span>•</span>
        <span>{timeAgo(item.lastTransitionAt)}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <StatusBadge status={item.coarseIssueStatus} />
        <Badge variant="outline" className="rounded-full">
          {domainLabel}
        </Badge>
        <Badge variant="secondary" className="rounded-full">
          {pendingCount} pending item{pendingCount === 1 ? "" : "s"}
        </Badge>
        <span className="text-xs text-muted-foreground">
          {formatProtocolQueueOwner(item)}
        </span>
      </div>
      <div className="mt-3 text-sm font-medium text-foreground">{item.title}</div>
      <p className="mt-2 text-sm text-muted-foreground">
        {pendingClarification?.question ?? "Pending clarification requires a human answer."}
      </p>
      {pendingClarification?.resumeWorkflowState ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Answering this resumes {formatProtocolValue(pendingClarification.resumeWorkflowState)}.
        </p>
      ) : null}
      {pendingClarification?.askedByLabel ? (
        <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <Identity name={pendingClarification.askedByLabel} size="sm" />
          <span>{pendingClarification.blocking ? "Blocking clarification" : "Advisory clarification"}</span>
        </div>
      ) : null}
      {pendingCount > 1 && (
        <p className="mt-2 text-xs text-muted-foreground">
          {pendingCount} clarification requests are waiting on the board.
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button asChild size="sm">
          <Link to={answerHref}>
            Answer now
            <ArrowUpRight className="ml-1.5 h-3.5 w-3.5" />
          </Link>
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link to={issueHref}>Open issue</Link>
        </Button>
      </div>
    </div>
  );
}
