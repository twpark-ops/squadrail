import { useEffect } from "react";
import { useParams } from "@/lib/router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { goalsApi } from "../api/goals";
import { projectsApi } from "../api/projects";
import { assetsApi } from "../api/assets";
import { usePanel } from "../context/PanelContext";
import { useCompany } from "../context/CompanyContext";
import { useDialog } from "../context/DialogContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { GoalProperties } from "../components/GoalProperties";
import { GoalTree } from "../components/GoalTree";
import { HeroSection } from "../components/HeroSection";
import { StatusBadge } from "../components/StatusBadge";
import { InlineEditor } from "../components/InlineEditor";
import { EntityRow } from "../components/EntityRow";
import { PageSkeleton } from "../components/PageSkeleton";
import { SupportMetricCard } from "../components/SupportMetricCard";
import { SupportPanel } from "../components/SupportPanel";
import { projectUrl } from "../lib/utils";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CalendarClock, Compass, Flag, Gauge, Network, Plus } from "lucide-react";
import type { Goal, Project } from "@squadrail/shared";

function formatTargetDate(value: Date | string | null | undefined) {
  if (!value) return "No target";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "No target";
  return date.toLocaleDateString();
}

export function GoalDetail() {
  const { goalId } = useParams<{ goalId: string }>();
  const { selectedCompanyId, setSelectedCompanyId } = useCompany();
  const { openNewGoal } = useDialog();
  const { openPanel, closePanel } = usePanel();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();

  const {
    data: goal,
    isLoading,
    error
  } = useQuery({
    queryKey: queryKeys.goals.detail(goalId!),
    queryFn: () => goalsApi.get(goalId!),
    enabled: !!goalId
  });
  const resolvedCompanyId = goal?.companyId ?? selectedCompanyId;

  const { data: allGoals } = useQuery({
    queryKey: queryKeys.goals.list(resolvedCompanyId!),
    queryFn: () => goalsApi.list(resolvedCompanyId!),
    enabled: !!resolvedCompanyId
  });

  const { data: allProjects } = useQuery({
    queryKey: queryKeys.projects.list(resolvedCompanyId!),
    queryFn: () => projectsApi.list(resolvedCompanyId!),
    enabled: !!resolvedCompanyId
  });

  useEffect(() => {
    if (!goal?.companyId || goal.companyId === selectedCompanyId) return;
    setSelectedCompanyId(goal.companyId, { source: "route_sync" });
  }, [goal?.companyId, selectedCompanyId, setSelectedCompanyId]);

  const updateGoal = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      goalsApi.update(goalId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.goals.detail(goalId!)
      });
      if (resolvedCompanyId) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.goals.list(resolvedCompanyId)
        });
      }
    }
  });

  const uploadImage = useMutation({
    mutationFn: async (file: File) => {
      if (!resolvedCompanyId) throw new Error("No company selected");
      return assetsApi.uploadImage(
        resolvedCompanyId,
        file,
        `goals/${goalId ?? "draft"}`
      );
    }
  });

  const childGoals = (allGoals ?? []).filter((g) => g.parentId === goalId);
  const linkedProjects = (allProjects ?? []).filter((p) => {
    if (!goalId) return false;
    if (p.goalIds.includes(goalId)) return true;
    if (p.goals.some((goalRef) => goalRef.id === goalId)) return true;
    return p.goalId === goalId;
  });

  useEffect(() => {
    setBreadcrumbs([
      { label: "Goals", href: "/goals" },
      { label: goal?.title ?? goalId ?? "Goal" }
    ]);
  }, [setBreadcrumbs, goal, goalId]);

  useEffect(() => {
    if (goal) {
      openPanel(
        <GoalProperties
          goal={goal}
          onUpdate={(data) => updateGoal.mutate(data)}
        />
      );
    }
    return () => closePanel();
  }, [goal]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading) return <PageSkeleton variant="detail" />;
  if (error) return <p className="text-sm text-destructive">{error.message}</p>;
  if (!goal) return null;

  return (
    <div className="space-y-8">
      <HeroSection
        title={goal.title}
        subtitle={goal.description ?? "Clarify the intent above the work queue and connect the right sub-goals and projects to it."}
        eyebrow="Goal Surface"
        actions={
          <div className="flex items-center gap-3">
            <span className="rounded-full border border-border/80 bg-background/80 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              {goal.level}
            </span>
            <StatusBadge status={goal.status} />
          </div>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        <SupportMetricCard
          icon={Flag}
          label="Status"
          value={goal.status.replace(/_/g, " ")}
          detail="Current state of this goal in the broader planning stack."
          tone="accent"
        />
        <SupportMetricCard
          icon={Gauge}
          label="Progress"
          value={`${goal.progressPercent}%`}
          detail="Manual progress signal used to reflect whether intent is actually landing."
        />
        <SupportMetricCard
          icon={CalendarClock}
          label="Target"
          value={formatTargetDate(goal.targetDate)}
          detail={goal.sprintName ? `Current sprint: ${goal.sprintName}` : "No sprint window is attached yet."}
        />
        <SupportMetricCard
          icon={Compass}
          label="Capacity"
          value={
            goal.capacityTargetPoints == null
              ? "Open"
              : `${goal.capacityCommittedPoints ?? 0}/${goal.capacityTargetPoints}`
          }
          detail="Committed vs planned capacity points for the active goal window."
        />
        <SupportMetricCard
          icon={Network}
          label="Sub-goals"
          value={childGoals.length}
          detail="Child goals currently nested under this parent objective."
        />
        <SupportMetricCard
          icon={Plus}
          label="Linked projects"
          value={linkedProjects.length}
          detail="Delivery scopes already tied directly to this goal."
        />
      </div>

      <SupportPanel
        title="Goal workspace"
        description="Use the child-goal tab to shape intent and the project tab to see which delivery scopes are already attached."
        contentClassName="space-y-4"
      >
        <div className="rounded-[1.25rem] border border-border/80 bg-background/70 px-4 py-4">
          <InlineEditor
            value={goal.title}
            onSave={(title) => updateGoal.mutate({ title })}
            as="h2"
            className="text-2xl font-semibold tracking-[-0.04em]"
          />

          <InlineEditor
            value={goal.description ?? ""}
            onSave={(description) => updateGoal.mutate({ description })}
            as="p"
            className="mt-3 text-sm text-muted-foreground"
            placeholder="Add a description..."
            multiline
            imageUploadHandler={async (file) => {
              const asset = await uploadImage.mutateAsync(file);
              return asset.contentPath;
            }}
          />
        </div>

        <Tabs defaultValue="children">
          <TabsList className="rounded-full border border-border/80 bg-background/80 p-1">
            <TabsTrigger value="children">
              Sub-Goals ({childGoals.length})
            </TabsTrigger>
            <TabsTrigger value="projects">
              Projects ({linkedProjects.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="children" className="mt-4 space-y-3">
            <div className="flex items-center justify-start">
              <Button
                size="sm"
                variant="outline"
                onClick={() => openNewGoal({ parentId: goalId })}
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Sub Goal
              </Button>
            </div>
            {childGoals.length === 0 ? (
              <p className="text-sm text-muted-foreground">No sub-goals.</p>
            ) : (
              <div className="rounded-[1.25rem] border border-border/80 bg-background/70 px-4 py-4">
                <GoalTree goals={childGoals} goalLink={(g) => `/goals/${g.id}`} />
              </div>
            )}
          </TabsContent>

          <TabsContent value="projects" className="mt-4">
            {linkedProjects.length === 0 ? (
              <p className="text-sm text-muted-foreground">No linked projects.</p>
            ) : (
              <div className="overflow-hidden rounded-[1.25rem] border border-border/80">
                {linkedProjects.map((project) => (
                  <EntityRow
                    key={project.id}
                    title={project.name}
                    subtitle={project.description ?? undefined}
                    to={projectUrl(project)}
                    trailing={<StatusBadge status={project.status} />}
                  />
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </SupportPanel>
    </div>
  );
}
