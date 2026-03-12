export interface CostEvent {
  id: string;
  companyId: string;
  agentId: string;
  issueId: string | null;
  projectId: string | null;
  goalId: string | null;
  billingCode: string | null;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costCents: number;
  occurredAt: Date;
  createdAt: Date;
}

export interface CostSummary {
  companyId: string;
  spendCents: number;
  budgetCents: number;
  utilizationPercent: number;
  monthlyForecast: CostMonthlyForecast | null;
}

export interface CostMonthlyForecast {
  monthStart: Date;
  monthEnd: Date;
  elapsedDays: number;
  totalDays: number;
  projectedSpendCents: number;
  projectedUtilizationPercent: number;
  status: "on_track" | "watch" | "over_budget" | "unbounded";
}

export interface CostByAgent {
  agentId: string;
  agentName: string | null;
  agentStatus: string | null;
  costCents: number;
  inputTokens: number;
  outputTokens: number;
  apiRunCount: number;
  subscriptionRunCount: number;
  subscriptionInputTokens: number;
  subscriptionOutputTokens: number;
}
