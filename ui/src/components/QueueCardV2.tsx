import { Link } from "@/lib/router";
import type { LucideIcon } from "lucide-react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Identity } from "./Identity";
import { StatusBadgeV2 } from "./StatusBadgeV2";
import type { DashboardProtocolQueueItem } from "@squadrail/shared";
import { timeAgo } from "@/lib/timeAgo";
import { workIssuePath } from "@/lib/appRoutes";

interface QueueCardV2Props {
  title: string;
  subtitle: string;
  icon: LucideIcon;
  items: DashboardProtocolQueueItem[];
  variant: "execution" | "review" | "approval" | "blocked" | "idle" | "closure";
  emptyMessage: string;
  to?: string;
  className?: string;
}

const variantStyles = {
  execution: "border-t-[3px] border-t-blue-500",
  review: "border-t-[3px] border-t-yellow-500",
  approval: "border-t-[3px] border-t-purple-500",
  blocked: "border-t-[3px] border-t-red-500",
  idle: "border-t-[3px] border-t-gray-400",
  closure: "border-t-[3px] border-t-emerald-500",
} as const;

/**
 * Card-based protocol queue display with visual hierarchy
 * Shows 3-5 preview items with progress indicator
 */
export function QueueCardV2({
  title,
  subtitle,
  icon: Icon,
  items,
  variant,
  emptyMessage,
  to,
  className,
}: QueueCardV2Props) {
  const previewItems = items.slice(0, 5);
  const hasMore = items.length > 5;

  return (
    <div
      className={cn(
        "overflow-hidden rounded-[1.5rem] border border-border/85 bg-card/90 shadow-[0_16px_40px_color-mix(in_oklab,var(--foreground)_4%,transparent)] transition-all hover:border-primary/20 hover:shadow-[0_20px_48px_color-mix(in_oklab,var(--primary)_8%,transparent)]",
        variantStyles[variant],
        className
      )}
    >
      {/* Header */}
      <div className="border-b border-border/75 bg-muted/22 px-6 py-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="inline-flex h-11 w-11 items-center justify-center rounded-[1rem] border border-border/75 bg-background/85">
              <Icon className="h-5 w-5 text-foreground/72" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-foreground">{title}</h3>
              <p className="text-sm text-muted-foreground">{subtitle}</p>
            </div>
          </div>
          <div className="inline-flex h-9 min-w-9 items-center justify-center rounded-full bg-primary px-3 text-sm font-bold text-primary-foreground">
            {items.length}
          </div>
        </div>
      </div>

      {/* Body - Issue Previews */}
      <div className="px-6 py-5">
        {items.length === 0 ? (
          <div className="rounded-[1.2rem] border border-dashed border-border/80 bg-background/60 px-5 py-10 text-center text-sm text-muted-foreground">
            {emptyMessage}
          </div>
        ) : (
          <div className="space-y-4">
            {previewItems.map((item) => (
              <Link
                key={item.issueId}
                to={workIssuePath(item.identifier ?? item.issueId)}
                className="block group"
              >
                <div className="rounded-[1.15rem] border border-border/80 bg-background/65 p-4 transition-colors hover:bg-accent/48">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      {/* Issue Title */}
                      <p className="line-clamp-1 text-[15px] font-semibold text-foreground transition-colors group-hover:text-primary">
                        {item.title}
                      </p>

                      {/* Meta */}
                      <div className="mt-2 flex items-center gap-2">
                        <StatusBadgeV2
                          state={item.workflowState}
                          showIcon={false}
                          className="text-xs px-2 py-0.5"
                        />
                        <span className="text-xs text-muted-foreground">
                          {timeAgo(item.lastTransitionAt)}
                        </span>
                      </div>

                      {/* Violations or Brief Preview */}
                      {item.openViolationCount > 0 && (
                        <div className="mt-2 flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
                          <span className="font-medium">{item.openViolationCount} violation{item.openViolationCount > 1 ? "s" : ""}</span>
                        </div>
                      )}
                    </div>

                    <ChevronRight className="h-4 w-4 text-muted-foreground/40 shrink-0 mt-1 group-hover:text-muted-foreground transition-colors" />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      {items.length > 0 && to && (
        <div className="border-t border-border/75 bg-muted/18 px-6 py-4">
          <Link
            to={to}
            className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
          >
            View all {items.length} issue{items.length !== 1 ? "s" : ""}
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
      )}
    </div>
  );
}
