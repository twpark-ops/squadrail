import { useEffect, useMemo } from "react";

import { useQuery } from "@tanstack/react-query";
import { GitBranch, Plus, Target, Telescope } from "lucide-react";

import { Button } from "@/components/ui/button";

import { goalsApi } from "../api/goals";
import { EmptyState } from "../components/EmptyState";
import { GoalTree } from "../components/GoalTree";
import { HeroSection } from "../components/HeroSection";
import { PageSkeleton } from "../components/PageSkeleton";
import { SupportMetricCard } from "../components/SupportMetricCard";
import { SupportPanel } from "../components/SupportPanel";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useCompany } from "../context/CompanyContext";
import { useDialog } from "../context/DialogContext";
import { queryKeys } from "../lib/queryKeys";

export function Goals() {
  const { selectedCompanyId } = useCompany();
  const { openNewGoal } = useDialog();
  const { setBreadcrumbs } = useBreadcrumbs();

  useEffect(() => {
    setBreadcrumbs([{ label: "Goals" }]);
  }, [setBreadcrumbs]);

  const { data: goals, isLoading, error } = useQuery({
    queryKey: queryKeys.goals.list(selectedCompanyId!),
    queryFn: () => goalsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const rootCount = useMemo(
    () => (goals ?? []).filter((goal) => goal.parentId === null).length,
    [goals],
  );
  const nestedCount = useMemo(
    () => (goals ?? []).filter((goal) => goal.parentId !== null).length,
    [goals],
  );
  const activeCount = useMemo(
    () => (goals ?? []).filter((goal) => goal.status === "active").length,
    [goals],
  );

  if (!selectedCompanyId) {
    return <EmptyState icon={Target} message="Select a company to view goals." />;
  }

  if (isLoading) {
    return <PageSkeleton variant="list" />;
  }

  return (
    <div className="space-y-8">
      <HeroSection
        title="Goals"
        subtitle="Keep longer-range delivery intent visible above the queue so squads can see why work exists, not just what is next."
        eyebrow="Intent Layer"
        actions={
          <Button
            size="sm"
            onClick={() => {
              openNewGoal();
            }}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            New Goal
          </Button>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SupportMetricCard
          icon={Target}
          label="Goals"
          value={goals?.length ?? 0}
          detail="Delivery goals currently visible for this company."
          tone="accent"
        />
        <SupportMetricCard
          icon={Telescope}
          label="Top-level"
          value={rootCount}
          detail="Root goals that define the visible intent structure."
        />
        <SupportMetricCard
          icon={GitBranch}
          label="Nested"
          value={nestedCount}
          detail="Child goals that break larger intent into concrete delivery tracks."
        />
        <SupportMetricCard
          icon={Target}
          label="Active"
          value={activeCount}
          detail="Goals marked active and still coordinating real delivery movement."
        />
      </div>

      <SupportPanel
        title="Goal tree"
        description="This surface should read as delivery intent, not as another task list. Keep the hierarchy visible and the chrome quiet."
        contentClassName="space-y-4"
      >
        {error ? <p className="text-sm text-destructive">{error.message}</p> : null}

        {goals && goals.length === 0 ? (
          <EmptyState
            icon={Target}
            message="No goals have been defined yet."
            action="Add Goal"
            onAction={() => {
              openNewGoal();
            }}
          />
        ) : (
          <div className="rounded-[1.45rem] border border-border/80 bg-background/70 px-4 py-4">
            <GoalTree goals={goals ?? []} goalLink={(goal) => `/goals/${goal.id}`} />
          </div>
        )}
      </SupportPanel>
    </div>
  );
}
