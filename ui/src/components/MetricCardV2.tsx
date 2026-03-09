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
        "h-full px-6 py-5 rounded-xl border bg-card shadow-card transition-all",
        isClickable && "cursor-pointer card-hover hover:shadow-card-hover",
        className
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0 space-y-2">
          {/* Value - Large and prominent */}
          <div className="flex items-baseline gap-3">
            <p className="text-3xl sm:text-4xl font-bold tracking-tight">
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
          <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            {label}
          </p>

          {/* Description */}
          {description && (
            <div className="text-xs text-muted-foreground/80 leading-relaxed">
              {description}
            </div>
          )}
        </div>

        {/* Icon */}
        <Icon className="h-5 w-5 text-muted-foreground/40 shrink-0 mt-1" />
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
