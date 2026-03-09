import { Link } from "@/lib/router";
import type { LucideIcon } from "lucide-react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Identity } from "./Identity";
import { StatusBadgeV2 } from "./StatusBadgeV2";
import type { DashboardProtocolQueueItem } from "@squadrail/shared";
import { timeAgo } from "@/lib/timeAgo";

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
  execution: "border-l-4 border-l-blue-500",
  review: "border-l-4 border-l-yellow-500",
  approval: "border-l-4 border-l-purple-500",
  blocked: "border-l-4 border-l-red-500",
  idle: "border-l-4 border-l-gray-400",
  closure: "border-l-4 border-l-emerald-500",
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
        "bg-card border rounded-xl shadow-card overflow-hidden transition-all card-hover hover:shadow-card-hover",
        variantStyles[variant],
        className
      )}
    >
      {/* Header */}
      <div className="px-6 py-4 border-b bg-muted/30">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-background border">
              <Icon className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <h3 className="text-base font-semibold">{title}</h3>
              <p className="text-xs text-muted-foreground">{subtitle}</p>
            </div>
          </div>
          <div className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-bold">
            {items.length}
          </div>
        </div>
      </div>

      {/* Body - Issue Previews */}
      <div className="px-6 py-4">
        {items.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            {emptyMessage}
          </div>
        ) : (
          <div className="space-y-3">
            {previewItems.map((item) => (
              <Link
                key={item.issueId}
                to={`/issues/${item.issueId}`}
                className="block group"
              >
                <div className="p-3 rounded-lg border bg-background/50 hover:bg-accent/50 transition-colors">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      {/* Issue Title */}
                      <p className="text-sm font-medium line-clamp-1 group-hover:text-primary transition-colors">
                        {item.title}
                      </p>

                      {/* Meta */}
                      <div className="flex items-center gap-2 mt-1">
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
        <div className="px-6 py-3 border-t bg-muted/20">
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
