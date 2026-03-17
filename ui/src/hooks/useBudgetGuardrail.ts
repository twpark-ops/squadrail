import { useQuery } from "@tanstack/react-query";
import { deriveBudgetGuardrailStatus, type BudgetGuardrailStatus } from "@squadrail/shared";
import { dashboardApi } from "../api/dashboard";
import { useCompany } from "../context/CompanyContext";
import { queryKeys } from "../lib/queryKeys";

/**
 * Derives the budget guardrail status from the dashboard summary.
 *
 * Re-uses the existing dashboard summary query so no additional HTTP
 * request is needed when the dashboard has already been fetched.
 */
export function useBudgetGuardrail(): {
  status: BudgetGuardrailStatus | null;
  isLoading: boolean;
} {
  const { selectedCompanyId } = useCompany();

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.dashboard(selectedCompanyId!),
    queryFn: () => dashboardApi.summary(selectedCompanyId!),
    enabled: !!selectedCompanyId,
    // Let the dashboard polling keep this fresh — avoid extra refetches
    staleTime: 30_000,
  });

  if (!data) {
    return { status: null, isLoading };
  }

  const guardrail = deriveBudgetGuardrailStatus(
    data.costs.monthSpendCents,
    data.costs.monthBudgetCents,
  );

  return { status: guardrail, isLoading };
}
