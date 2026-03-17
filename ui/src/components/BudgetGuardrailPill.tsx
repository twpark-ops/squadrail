import { Link } from "@/lib/router";
import type { BudgetGuardrailStatus } from "@squadrail/shared";
import { cn } from "../lib/utils";
import { appRoutes } from "../lib/appRoutes";

interface BudgetGuardrailPillProps {
  status: BudgetGuardrailStatus;
  /** When true, show as a compact inline pill (sidebar). Default: false. */
  compact?: boolean;
}

const levelClasses: Record<BudgetGuardrailStatus["status"], string> = {
  healthy: "hidden",
  warning:
    "border-amber-400/40 bg-amber-50/80 text-amber-800 dark:border-amber-400/24 dark:bg-amber-950/40 dark:text-amber-200",
  critical:
    "border-red-400/40 bg-red-50/80 text-red-700 dark:border-red-400/24 dark:bg-red-950/40 dark:text-red-200",
  exceeded:
    "border-red-500/50 bg-red-100/90 text-red-800 animate-pulse dark:border-red-500/30 dark:bg-red-950/50 dark:text-red-100",
};

/**
 * A small pill that surfaces budget guardrail status.
 *
 * Hidden when healthy. Shown as amber/red pill for warning/critical/exceeded.
 * Links to the costs page on click.
 */
export function BudgetGuardrailPill({ status, compact }: BudgetGuardrailPillProps) {
  if (status.status === "healthy") {
    return null;
  }

  return (
    <Link
      to={appRoutes.costs}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border no-underline transition-colors hover:brightness-95",
        compact ? "px-2 py-0.5 text-[10px] font-semibold" : "px-2.5 py-1 text-xs font-medium",
        levelClasses[status.status],
      )}
      title={`Monthly spend: ${status.utilizationPercent}% of budget`}
    >
      {status.headline}
    </Link>
  );
}
