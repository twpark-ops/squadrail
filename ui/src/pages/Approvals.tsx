import { useEffect, useMemo, useState } from "react";

import { useNavigate, useLocation } from "@/lib/router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, Sparkles, Clock3, AlertTriangle } from "lucide-react";

import { Tabs } from "@/components/ui/tabs";

import { approvalsApi } from "../api/approvals";
import { agentsApi } from "../api/agents";
import { ApprovalCard } from "../components/ApprovalCard";
import { EmptyState } from "../components/EmptyState";
import { HeroSection } from "../components/HeroSection";
import { PageSkeleton } from "../components/PageSkeleton";
import { PageTabBar } from "../components/PageTabBar";
import { SupportMetricCard } from "../components/SupportMetricCard";
import { SupportPanel } from "../components/SupportPanel";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useCompany } from "../context/CompanyContext";
import { queryKeys } from "../lib/queryKeys";

type StatusFilter = "pending" | "all";

export function Approvals() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const pathSegment = location.pathname.split("/").pop() ?? "pending";
  const statusFilter: StatusFilter = pathSegment === "all" ? "all" : "pending";
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    setBreadcrumbs([{ label: "Approvals" }]);
  }, [setBreadcrumbs]);

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.approvals.list(selectedCompanyId!),
    queryFn: () => approvalsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => approvalsApi.approve(id),
    onSuccess: (_approval, id) => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.approvals.list(selectedCompanyId!) });
      navigate(`/approvals/${id}?resolved=approved`);
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : "Failed to approve");
    },
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) => approvalsApi.reject(id),
    onSuccess: () => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.approvals.list(selectedCompanyId!) });
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : "Failed to reject");
    },
  });

  const actionableCount = useMemo(
    () => (data ?? []).filter((approval) => approval.status === "pending" || approval.status === "revision_requested").length,
    [data],
  );
  const resolvedCount = useMemo(
    () => (data ?? []).filter((approval) => approval.status === "approved" || approval.status === "rejected").length,
    [data],
  );
  const revisionCount = useMemo(
    () => (data ?? []).filter((approval) => approval.status === "revision_requested").length,
    [data],
  );
  const activeRequesters = useMemo(
    () =>
      new Set(
        (data ?? [])
          .filter((approval) => approval.status === "pending" || approval.status === "revision_requested")
          .map((approval) => approval.requestedByAgentId)
          .filter((value): value is string => Boolean(value)),
      ).size,
    [data],
  );

  const filtered = useMemo(
    () =>
      (data ?? [])
        .filter((approval) => statusFilter === "all" || approval.status === "pending" || approval.status === "revision_requested")
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [data, statusFilter],
  );

  if (!selectedCompanyId) {
    return <EmptyState icon={ShieldCheck} message="Select a company to review approvals." />;
  }

  if (isLoading) {
    return <PageSkeleton variant="approvals" />;
  }

  return (
    <div className="space-y-8">
      <HeroSection
        title="Approvals"
        subtitle="Review the decisions waiting on human confirmation, revision loops, and recently resolved requests."
        eyebrow="Decision Surface"
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SupportMetricCard
          icon={Clock3}
          label="Actionable"
          value={actionableCount}
          detail="Pending approvals and revision requests that still need a board decision."
          tone={actionableCount > 0 ? "accent" : "default"}
        />
        <SupportMetricCard
          icon={AlertTriangle}
          label="Needs revision"
          value={revisionCount}
          detail="Requests that already bounced back and require a sharper decision path."
          tone={revisionCount > 0 ? "warning" : "default"}
        />
        <SupportMetricCard
          icon={Sparkles}
          label="Resolved"
          value={resolvedCount}
          detail="Approved or rejected requests already cleared from the active decision queue."
        />
        <SupportMetricCard
          icon={ShieldCheck}
          label="Active requesters"
          value={activeRequesters}
          detail="Distinct agents currently waiting on a decision from the board surface."
        />
      </div>

      <SupportPanel
        title="Approval queue"
        description="Keep the default view focused on action. Use the archive tab only when you need broader approval history."
        action={
          <Tabs value={statusFilter} onValueChange={(value) => navigate(`/approvals/${value}`)}>
            <PageTabBar
              items={[
                { value: "pending", label: `Actionable${actionableCount > 0 ? ` (${actionableCount})` : ""}` },
                { value: "all", label: "All" },
              ]}
              value={statusFilter}
              onValueChange={(value) => navigate(`/approvals/${value}`)}
            />
          </Tabs>
        }
        contentClassName="space-y-4"
      >
        {error ? <p className="text-sm text-destructive">{error.message}</p> : null}
        {actionError ? <p className="text-sm text-destructive">{actionError}</p> : null}

        {filtered.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            message={statusFilter === "pending" ? "No active approvals are waiting right now." : "No approvals have been created yet."}
          />
        ) : (
          <div className="grid gap-3">
            {filtered.map((approval) => (
              <ApprovalCard
                key={approval.id}
                approval={approval}
                requesterAgent={
                  approval.requestedByAgentId
                    ? (agents ?? []).find((agent) => agent.id === approval.requestedByAgentId) ?? null
                    : null
                }
                onApprove={() => approveMutation.mutate(approval.id)}
                onReject={() => rejectMutation.mutate(approval.id)}
                detailLink={`/approvals/${approval.id}`}
                isPending={approveMutation.isPending || rejectMutation.isPending}
              />
            ))}
          </div>
        )}
      </SupportPanel>
    </div>
  );
}
