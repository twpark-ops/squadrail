import { useEffect, useMemo, useState } from "react";

import { useQuery } from "@tanstack/react-query";
import { CircleDollarSign, FolderKanban, Wallet, Workflow } from "lucide-react";

import { Button } from "@/components/ui/button";

import { costsApi } from "../api/costs";
import { EmptyState } from "../components/EmptyState";
import { HeroSection } from "../components/HeroSection";
import { Identity } from "../components/Identity";
import { PageSkeleton } from "../components/PageSkeleton";
import { StatusBadge } from "../components/StatusBadge";
import { SupportMetricCard } from "../components/SupportMetricCard";
import { SupportPanel } from "../components/SupportPanel";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useCompany } from "../context/CompanyContext";
import { queryKeys } from "../lib/queryKeys";
import { formatCents, formatTokens } from "../lib/utils";

type DatePreset = "mtd" | "7d" | "30d" | "ytd" | "all" | "custom";

const PRESET_LABELS: Record<DatePreset, string> = {
  mtd: "Month to Date",
  "7d": "Last 7 Days",
  "30d": "Last 30 Days",
  ytd: "Year to Date",
  all: "All Time",
  custom: "Custom",
};

function computeRange(preset: DatePreset): { from: string; to: string } {
  const now = new Date();
  const to = now.toISOString();
  switch (preset) {
    case "mtd":
      return { from: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(), to };
    case "7d":
      return { from: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(), to };
    case "30d":
      return { from: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(), to };
    case "ytd":
      return { from: new Date(now.getFullYear(), 0, 1).toISOString(), to };
    case "all":
      return { from: "", to: "" };
    case "custom":
      return { from: "", to: "" };
  }
}

export function Costs() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();

  const [preset, setPreset] = useState<DatePreset>("mtd");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  useEffect(() => {
    setBreadcrumbs([{ label: "Costs" }]);
  }, [setBreadcrumbs]);

  const { from, to } = useMemo(() => {
    if (preset === "custom") {
      return {
        from: customFrom ? new Date(customFrom).toISOString() : "",
        to: customTo ? new Date(`${customTo}T23:59:59.999Z`).toISOString() : "",
      };
    }
    return computeRange(preset);
  }, [preset, customFrom, customTo]);

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.costs(selectedCompanyId!, from || undefined, to || undefined),
    queryFn: async () => {
      const [summary, byAgent, byProject] = await Promise.all([
        costsApi.summary(selectedCompanyId!, from || undefined, to || undefined),
        costsApi.byAgent(selectedCompanyId!, from || undefined, to || undefined),
        costsApi.byProject(selectedCompanyId!, from || undefined, to || undefined),
      ]);
      return { summary, byAgent, byProject };
    },
    enabled: !!selectedCompanyId,
  });

  const apiRunCount = useMemo(
    () => (data?.byAgent ?? []).reduce((sum, row) => sum + row.apiRunCount, 0),
    [data],
  );
  const subscriptionRunCount = useMemo(
    () => (data?.byAgent ?? []).reduce((sum, row) => sum + row.subscriptionRunCount, 0),
    [data],
  );

  if (!selectedCompanyId) {
    return <EmptyState icon={CircleDollarSign} message="Select a company to view operating costs." />;
  }

  if (isLoading) {
    return <PageSkeleton variant="costs" />;
  }

  const presetKeys: DatePreset[] = ["mtd", "7d", "30d", "ytd", "all", "custom"];

  return (
    <div className="space-y-8">
      <HeroSection
        title="Costs"
        subtitle="Track spend, utilization, and where model usage is accumulating across agents and projects."
        eyebrow="Operating Spend"
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SupportMetricCard
          icon={CircleDollarSign}
          label="Spend"
          value={formatCents(data?.summary.spendCents ?? 0)}
          detail={PRESET_LABELS[preset]}
          tone="accent"
        />
        <SupportMetricCard
          icon={Wallet}
          label="Budget usage"
          value={
            data?.summary.budgetCents && data.summary.budgetCents > 0
              ? `${data.summary.utilizationPercent}%`
              : "Open"
          }
          detail={
            data?.summary.budgetCents && data.summary.budgetCents > 0
              ? `${formatCents(data.summary.budgetCents)} budget tracked for this range.`
              : "No explicit budget cap is set for the selected range."
          }
          tone={data?.summary.utilizationPercent && data.summary.utilizationPercent > 85 ? "warning" : "default"}
        />
        <SupportMetricCard
          icon={Wallet}
          label="Month-end forecast"
          value={
            data?.summary.monthlyForecast
              ? formatCents(data.summary.monthlyForecast.projectedSpendCents)
              : "N/A"
          }
          detail={
            data?.summary.monthlyForecast
              ? `${data.summary.monthlyForecast.projectedUtilizationPercent}% of monthly budget · ${data.summary.monthlyForecast.status.replace(/_/g, " ")}`
              : "Forecast not available"
          }
          tone={
            data?.summary.monthlyForecast?.status === "over_budget"
              ? "warning"
              : data?.summary.monthlyForecast?.status === "watch"
                ? "warning"
                : "default"
          }
        />
        <SupportMetricCard
          icon={Workflow}
          label="API runs"
          value={apiRunCount}
          detail="Runs billed directly through metered API usage."
        />
        <SupportMetricCard
          icon={FolderKanban}
          label="Project attribution"
          value={data?.byProject.length ?? 0}
          detail="Projects with visible cost attribution in the selected time window."
        />
      </div>

      <SupportPanel
        title="Cost range"
        description="Use the preset ranges to keep the board comparable. Switch to custom only when you need to inspect a specific incident window."
        contentClassName="space-y-4"
      >
        <div className="flex flex-wrap items-center gap-2">
          {presetKeys.map((value) => (
            <Button
              key={value}
              variant={preset === value ? "secondary" : "ghost"}
              size="sm"
              className="rounded-full"
              onClick={() => setPreset(value)}
            >
              {PRESET_LABELS[value]}
            </Button>
          ))}
          {preset === "custom" ? (
            <div className="flex flex-wrap items-center gap-2 md:ml-3">
              <input
                type="date"
                value={customFrom}
                onChange={(event) => setCustomFrom(event.target.value)}
                className="h-9 rounded-full border border-input bg-background px-3 text-sm text-foreground"
              />
              <span className="text-sm text-muted-foreground">to</span>
              <input
                type="date"
                value={customTo}
                onChange={(event) => setCustomTo(event.target.value)}
                className="h-9 rounded-full border border-input bg-background px-3 text-sm text-foreground"
              />
            </div>
          ) : null}
        </div>
        {error ? <p className="text-sm text-destructive">{error.message}</p> : null}
      </SupportPanel>

      <div className="grid gap-4 xl:grid-cols-2">
        <SupportPanel
          title="By agent"
          description="See which lanes are consuming budget and whether that usage comes from metered API runs or subscription-backed execution."
          contentClassName="space-y-3"
        >
          {data?.byAgent.length === 0 ? (
            <EmptyState icon={CircleDollarSign} message="No agent cost events are visible for this range." />
          ) : (
            <div className="space-y-3">
              {data?.byAgent.map((row) => (
                <div
                  key={row.agentId}
                  className="flex flex-col gap-3 rounded-[1.2rem] border border-border/80 bg-background/70 px-4 py-4 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Identity name={row.agentName ?? row.agentId} size="sm" />
                      {row.agentStatus === "terminated" ? <StatusBadge status="terminated" /> : null}
                    </div>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      {row.apiRunCount > 0 ? `API runs ${row.apiRunCount}` : "No API runs"}
                      {row.subscriptionRunCount > 0
                        ? ` • subscription runs ${row.subscriptionRunCount}`
                        : " • no subscription runs"}
                    </p>
                  </div>
                  <div className="text-left sm:text-right">
                    <div className="text-lg font-semibold text-foreground">{formatCents(row.costCents)}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      in {formatTokens(row.inputTokens)} / out {formatTokens(row.outputTokens)}
                    </div>
                    {row.subscriptionRunCount > 0 ? (
                      <div className="mt-1 text-xs text-muted-foreground">
                        subscription tokens {formatTokens(row.subscriptionInputTokens)} in / {formatTokens(row.subscriptionOutputTokens)} out
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </SupportPanel>

        <SupportPanel
          title="By project"
          description="Use this view to spot which scopes are absorbing most of the active model spend."
          contentClassName="space-y-3"
        >
          {data?.byProject.length === 0 ? (
            <EmptyState icon={FolderKanban} message="No project-attributed cost has been recorded yet." />
          ) : (
            <div className="space-y-3">
              {data?.byProject.map((row) => (
                <div
                  key={row.projectId ?? "na"}
                  className="flex items-center justify-between rounded-[1.2rem] border border-border/80 bg-background/70 px-4 py-4"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium text-foreground">
                      {row.projectName ?? row.projectId ?? "Unattributed"}
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      {row.projectId ? "Tracked project spend" : "Spend not yet attributed to a project"}
                    </div>
                  </div>
                  <div className="ml-4 text-right text-lg font-semibold text-foreground">
                    {formatCents(row.costCents)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </SupportPanel>
      </div>

      {subscriptionRunCount > 0 ? (
        <p className="text-sm text-muted-foreground">
          Subscription-backed usage is visible in the per-agent breakdown even when direct spend remains low in the selected range.
        </p>
      ) : null}
    </div>
  );
}
