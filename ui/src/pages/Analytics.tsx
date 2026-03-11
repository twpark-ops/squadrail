import { useEffect, useMemo } from "react";

import { useQuery } from "@tanstack/react-query";
import { Activity, BarChart3, CheckCircle2, Clock3, XCircle } from "lucide-react";

import { approvalsApi } from "../api/approvals";
import { agentsApi } from "../api/agents";
import { heartbeatsApi } from "../api/heartbeats";
import { issuesApi } from "../api/issues";
import { EmptyState } from "../components/EmptyState";
import { HeroSection } from "../components/HeroSection";
import { PageSkeleton } from "../components/PageSkeleton";
import { SupportMetricCard } from "../components/SupportMetricCard";
import { SupportPanel } from "../components/SupportPanel";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useCompany } from "../context/CompanyContext";
import { queryKeys } from "../lib/queryKeys";

const FAILED_RUN_STATUSES = new Set(["failed", "timed_out"]);

export function Analytics() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();

  useEffect(() => {
    setBreadcrumbs([{ label: "Analytics" }]);
  }, [setBreadcrumbs]);

  const { data: issues, isLoading: issuesLoading } = useQuery({
    queryKey: queryKeys.issues.list(selectedCompanyId!),
    queryFn: () => issuesApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: approvals, isLoading: approvalsLoading } = useQuery({
    queryKey: queryKeys.approvals.list(selectedCompanyId!),
    queryFn: () => approvalsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: runs, isLoading: runsLoading } = useQuery({
    queryKey: queryKeys.heartbeats(selectedCompanyId!),
    queryFn: () => heartbeatsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: agents, isLoading: agentsLoading } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const isLoading = issuesLoading || approvalsLoading || runsLoading || agentsLoading;

  const inProgressIssues = useMemo(
    () => (issues ?? []).filter((issue) => issue.status === "in_progress").length,
    [issues],
  );
  const actionableApprovals = useMemo(
    () => (approvals ?? []).filter((approval) => approval.status === "pending" || approval.status === "revision_requested").length,
    [approvals],
  );
  const failedRuns = useMemo(
    () => (runs ?? []).filter((run) => FAILED_RUN_STATUSES.has(run.status)).length,
    [runs],
  );
  const activeAgents = useMemo(
    () => (agents ?? []).filter((agent) => agent.status === "active" || agent.status === "running" || agent.status === "idle").length,
    [agents],
  );

  const measurableSections = [
    "issue flow and active implementation volume",
    "approval queue pressure",
    "run failure and heartbeat health",
    "active lane coverage by agent status",
  ];
  const parkedSections = [
    "longitudinal review cycle timing",
    "historical message volume charts",
    "true productivity scoring",
    "company-level analytics that need new backend aggregates",
  ];

  if (!selectedCompanyId) {
    return <EmptyState icon={BarChart3} message="Select a company to view analytics." />;
  }

  if (isLoading) {
    return <PageSkeleton variant="list" />;
  }

  return (
    <div className="space-y-8">
      <HeroSection
        title="Analytics"
        subtitle="This page now focuses on what the current control plane can honestly measure today, without inventing charts that depend on missing backend aggregates."
        eyebrow="Measured Now"
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SupportMetricCard
          icon={Activity}
          label="In progress issues"
          value={inProgressIssues}
          detail="Active delivery work currently moving through implementation."
          tone="accent"
        />
        <SupportMetricCard
          icon={Clock3}
          label="Actionable approvals"
          value={actionableApprovals}
          detail="Pending or revision-requested decisions still waiting on the board."
          tone={actionableApprovals > 0 ? "warning" : "default"}
        />
        <SupportMetricCard
          icon={XCircle}
          label="Failed runs"
          value={failedRuns}
          detail="Heartbeat or execution runs that ended in failure or timeout."
          tone={failedRuns > 0 ? "warning" : "default"}
        />
        <SupportMetricCard
          icon={CheckCircle2}
          label="Active agents"
          value={activeAgents}
          detail="Agents currently able to carry ongoing delivery or review work."
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <SupportPanel
          title="Available now"
          description="These slices are already derivable from the current UI APIs, so this page can surface them without backend contract changes."
          contentClassName="space-y-3"
        >
          {measurableSections.map((item) => (
            <div
              key={item}
              className="rounded-[1.2rem] border border-border/80 bg-background/70 px-4 py-4 text-sm leading-6 text-foreground"
            >
              {item}
            </div>
          ))}
        </SupportPanel>

        <SupportPanel
          title="Still parked"
          description="These analytics remain intentionally out of scope for the UI-only pass because they need richer history or new aggregate endpoints."
          contentClassName="space-y-3"
        >
          {parkedSections.map((item) => (
            <div
              key={item}
              className="rounded-[1.2rem] border border-dashed border-border/80 bg-background/60 px-4 py-4 text-sm leading-6 text-muted-foreground"
            >
              {item}
            </div>
          ))}
        </SupportPanel>
      </div>
    </div>
  );
}
