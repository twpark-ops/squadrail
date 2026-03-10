import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "@/lib/router";
import { ArrowUp, ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface TrendData {
  value: number;
  direction: "up" | "down";
}

interface MetricCardV2Props {
  icon: LucideIcon;
  value: string | number;
  label: string;
  description?: ReactNode;
  trend?: TrendData;
  to?: string;
  onClick?: () => void;
  className?: string;
}

/**
 * Enhanced metric card with larger typography, trend indicators, and hover elevation
 * Follows Linear's design with generous spacing and clear hierarchy
 */
export function MetricCardV2({
  icon: Icon,
  value,
  label,
  description,
  trend,
  to,
  onClick,
  className,
}: MetricCardV2Props) {
  const isClickable = !!(to || onClick);

  const inner = (
    <div
      className={cn(
        "h-full rounded-[1.55rem] border border-border bg-card px-6 py-5 shadow-card transition-all",
        isClickable && "cursor-pointer hover:-translate-y-0.5 hover:border-primary/18 hover:shadow-card-hover",
        className
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-3">
          {/* Value - Large and prominent */}
          <div className="flex items-baseline gap-3">
              <p className="text-[2.3rem] font-semibold tracking-[-0.05em] text-foreground sm:text-[2.8rem]">
                {value}
              </p>
            {trend && (
              <div
                className={cn(
                  "flex items-center gap-1 text-sm font-medium",
                  trend.direction === "up" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
                )}
              >
                {trend.direction === "up" ? (
                  <ArrowUp className="h-4 w-4" />
                ) : (
                  <ArrowDown className="h-4 w-4" />
                )}
                <span>{Math.abs(trend.value)}%</span>
              </div>
            )}
          </div>

          {/* Label */}
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            {label}
          </p>

          {/* Description */}
          {description && (
            <div className="text-sm leading-relaxed text-muted-foreground">
              {description}
            </div>
          )}
        </div>

        <div className="rounded-[1rem] border border-primary/10 bg-primary/8 p-2.5">
          <Icon className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        </div>
      </div>
    </div>
  );

  if (to) {
    return (
      <Link to={to} className="no-underline text-inherit block h-full" onClick={onClick}>
        {inner}
      </Link>
    );
  }

  if (onClick) {
    return (
      <button
        type="button"
        className="no-underline text-inherit block h-full w-full text-left"
        onClick={onClick}
      >
        {inner}
      </button>
    );
  }

  return inner;
}
