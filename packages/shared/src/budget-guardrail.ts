/**
 * Budget Guardrail Surface — pure derivation logic.
 *
 * Thresholds:
 *   < 60 %  → healthy
 *   60–85 % → warning
 *   85–100% → critical
 *   > 100 % → exceeded
 */

export interface BudgetGuardrailStatus {
  monthSpendCents: number;
  monthBudgetCents: number;
  utilizationPercent: number;
  status: "healthy" | "warning" | "critical" | "exceeded";
  headline: string;
}

export type BudgetGuardrailLevel = BudgetGuardrailStatus["status"];

/**
 * Derive a budget guardrail status from raw spend / budget values.
 *
 * If `monthBudgetCents` is 0 or negative the budget is treated as
 * "unbounded" and always returns healthy with 0 % utilization.
 */
export function deriveBudgetGuardrailStatus(
  monthSpendCents: number,
  monthBudgetCents: number,
): BudgetGuardrailStatus {
  if (monthBudgetCents <= 0) {
    return {
      monthSpendCents,
      monthBudgetCents: 0,
      utilizationPercent: 0,
      status: "healthy",
      headline: "No budget cap",
    };
  }

  const utilizationPercent = Math.round(
    (monthSpendCents / monthBudgetCents) * 100,
  );

  if (utilizationPercent > 100) {
    return {
      monthSpendCents,
      monthBudgetCents,
      utilizationPercent,
      headline: "Over budget",
      status: "exceeded",
    };
  }

  if (utilizationPercent >= 85) {
    return {
      monthSpendCents,
      monthBudgetCents,
      utilizationPercent,
      headline: `Budget ${utilizationPercent}%`,
      status: "critical",
    };
  }

  if (utilizationPercent >= 60) {
    return {
      monthSpendCents,
      monthBudgetCents,
      utilizationPercent,
      headline: `Budget ${utilizationPercent}%`,
      status: "warning",
    };
  }

  return {
    monthSpendCents,
    monthBudgetCents,
    utilizationPercent,
    headline: `Budget ${utilizationPercent}%`,
    status: "healthy",
  };
}
