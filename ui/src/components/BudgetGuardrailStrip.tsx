import { Link } from "@/lib/router";
import type { BudgetGuardrailStatus, CostByAgent } from "@squadrail/shared";
import { cn, formatCents } from "../lib/utils";
import { appRoutes } from "../lib/appRoutes";
import { Identity } from "./Identity";

interface BudgetGuardrailStripProps {
  status: BudgetGuardrailStatus;
  /** Optional top-burning agents to show a burn ranking. */
  topAgents?: CostByAgent[];
}

const barColor: Record<BudgetGuardrailStatus["status"], string> = {
  healthy: "bg-emerald-500 dark:bg-emerald-400",
  warning: "bg-amber-500 dark:bg-amber-400",
  critical: "bg-red-500 dark:bg-red-400",
  exceeded: "bg-red-600 dark:bg-red-500",
};

const borderColor: Record<BudgetGuardrailStatus["status"], string> = {
  healthy: "border-emerald-300/30 dark:border-emerald-400/20",
  warning: "border-amber-300/30 dark:border-amber-400/20",
  critical: "border-red-300/30 dark:border-red-400/20",
  exceeded: "border-red-400/40 dark:border-red-500/30",
};

const bgColor: Record<BudgetGuardrailStatus["status"], string> = {
  healthy: "bg-card",
  warning: "bg-[color-mix(in_oklab,var(--card)_96%,#fef3c7)] dark:bg-[color-mix(in_oklab,var(--card)_96%,#451a03)]",
  critical: "bg-[color-mix(in_oklab,var(--card)_96%,#fee2e2)] dark:bg-[color-mix(in_oklab,var(--card)_96%,#450a0a)]",
  exceeded: "bg-[color-mix(in_oklab,var(--card)_94%,#fee2e2)] dark:bg-[color-mix(in_oklab,var(--card)_94%,#450a0a)]",
};

/**
 * Compact budget guardrail strip for the Overview dashboard.
 *
 * Shows monthly spend / budget, a utilization progress bar, and
 * an optional top-burning agents ranking.
 */
export function BudgetGuardrailStrip({ status, topAgents }: BudgetGuardrailStripProps) {
  // When no budget is set, show a minimal hint
  if (status.monthBudgetCents <= 0) {
    return (
      <Link
        to={appRoutes.costs}
        className={cn(
          "flex items-center justify-between rounded-[1.2rem] border border-border bg-card px-5 py-3.5 no-underline transition-colors hover:border-primary/18 hover:bg-accent/24",
        )}
      >
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Monthly budget
          </div>
          <div className="mt-1.5 text-lg font-semibold text-foreground">
            {formatCents(status.monthSpendCents)} spent
          </div>
        </div>
        <div className="text-xs text-muted-foreground">No budget cap set</div>
      </Link>
    );
  }

  const clampedPercent = Math.min(status.utilizationPercent, 100);
  const topBurners = (topAgents ?? [])
    .filter((a) => a.costCents > 0)
    .sort((a, b) => b.costCents - a.costCents)
    .slice(0, 3);

  return (
    <Link
      to={appRoutes.costs}
      className={cn(
        "block rounded-[1.2rem] border px-5 py-4 no-underline transition-colors hover:border-primary/18",
        borderColor[status.status],
        bgColor[status.status],
      )}
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Monthly budget guardrail
          </div>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className="text-xl font-semibold tracking-[-0.04em] text-foreground">
              {formatCents(status.monthSpendCents)}
            </span>
            <span className="text-sm text-muted-foreground">
              / {formatCents(status.monthBudgetCents)}
            </span>
          </div>
        </div>
        <div className="text-right">
          <div
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold",
              status.status === "healthy" && "border-emerald-300/40 text-emerald-700 dark:border-emerald-400/20 dark:text-emerald-300",
              status.status === "warning" && "border-amber-300/40 text-amber-700 dark:border-amber-400/20 dark:text-amber-300",
              status.status === "critical" && "border-red-300/40 text-red-700 dark:border-red-400/20 dark:text-red-300",
              status.status === "exceeded" && "animate-pulse border-red-400/50 text-red-800 dark:border-red-500/30 dark:text-red-200",
            )}
          >
            {status.headline}
          </div>
        </div>
      </div>

      {/* Utilization bar */}
      <div className="mt-3">
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted/50">
          <div
            className={cn("h-full rounded-full transition-all duration-500", barColor[status.status])}
            style={{ width: `${clampedPercent}%` }}
          />
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
          <span>{status.utilizationPercent}% used</span>
          <span>{formatCents(Math.max(0, status.monthBudgetCents - status.monthSpendCents))} remaining</span>
        </div>
      </div>

      {/* Top burning agents */}
      {topBurners.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-border/60 pt-3">
          <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            Top burn
          </span>
          {topBurners.map((agent) => (
            <div key={agent.agentId} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Identity name={agent.agentName ?? agent.agentId.slice(0, 8)} size="sm" />
              <span className="font-medium text-foreground">{formatCents(agent.costCents)}</span>
            </div>
          ))}
        </div>
      )}
    </Link>
  );
}
