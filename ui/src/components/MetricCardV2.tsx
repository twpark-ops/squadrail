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
        "h-full rounded-[1.3rem] border border-border bg-card px-5 py-4 shadow-card transition-all",
        isClickable &&
          "cursor-pointer hover:-translate-y-0.5 hover:border-primary/18 hover:shadow-card-hover",
        className
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-2.5">
          <div className="flex items-baseline gap-3">
            <p className="text-[2rem] font-semibold tracking-[-0.05em] text-foreground sm:text-[2.35rem]">
              {value}
            </p>
            {trend && (
              <div
                className={cn(
                  "flex items-center gap-1 text-sm font-medium",
                  trend.direction === "up"
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-red-600 dark:text-red-400"
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

          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            {label}
          </p>

          {description && (
            <div className="text-sm leading-6 text-muted-foreground">
              {description}
            </div>
          )}
        </div>

        <div className="rounded-[0.9rem] border border-primary/10 bg-primary/8 p-2">
          <Icon className="mt-0.5 h-[18px] w-[18px] shrink-0 text-primary" />
        </div>
      </div>
    </div>
  );

  if (to) {
    return (
      <Link
        to={to}
        className="no-underline text-inherit block h-full"
        onClick={onClick}
      >
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
