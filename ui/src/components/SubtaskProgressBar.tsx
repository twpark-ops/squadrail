import { cn } from "../lib/utils";
import type { IssueInternalWorkItemSummary } from "@squadrail/shared";

interface SubtaskProgressBarProps {
  summary: IssueInternalWorkItemSummary;
  mode?: "compact" | "full";
  className?: string;
}

export function SubtaskProgressBar({
  summary,
  mode = "compact",
  className,
}: SubtaskProgressBarProps) {
  const { total, done, inProgress, inReview, blocked } = summary;
  if (total === 0) return null;

  const remaining = Math.max(0, total - done - inProgress - inReview - blocked);

  const segments = [
    { value: done, color: "bg-emerald-500", label: "Done" },
    { value: inProgress, color: "bg-blue-500", label: "In progress" },
    { value: inReview, color: "bg-amber-500", label: "In review" },
    { value: blocked, color: "bg-red-500", label: "Blocked" },
    { value: remaining, color: "bg-muted-foreground/25", label: "Remaining" },
  ];

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="flex h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        {segments.map(
          (seg) =>
            seg.value > 0 && (
              <div
                key={seg.label}
                className={cn(
                  "h-full transition-[width] duration-300",
                  seg.color,
                )}
                style={{ width: `${(seg.value / total) * 100}%` }}
                title={`${seg.label}: ${seg.value}`}
              />
            ),
        )}
      </div>
      {mode === "compact" ? (
        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
          {done}/{total}
        </span>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          {done > 0 && (
            <span className="rounded-full border border-emerald-300/60 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
              {done} done
            </span>
          )}
          {blocked > 0 && (
            <span className="rounded-full border border-red-300/60 bg-red-500/10 px-1.5 py-0.5 text-[10px] font-medium text-red-700 dark:text-red-300">
              {blocked} blocked
            </span>
          )}
          {inReview > 0 && (
            <span className="rounded-full border border-amber-300/60 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
              {inReview} review
            </span>
          )}
          {inProgress > 0 && (
            <span className="rounded-full border border-blue-300/60 bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:text-blue-300">
              {inProgress} active
            </span>
          )}
          <span className="text-[10px] tabular-nums text-muted-foreground">
            {done}/{total}
          </span>
        </div>
      )}
    </div>
  );
}
