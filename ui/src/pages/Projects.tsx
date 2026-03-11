import { useEffect, useMemo } from "react";

import { useQuery } from "@tanstack/react-query";
import { FolderKanban, Hexagon, Link2, TimerReset } from "lucide-react";

import { Button } from "@/components/ui/button";

import { projectsApi } from "../api/projects";
import { EmptyState } from "../components/EmptyState";
import { EntityRow } from "../components/EntityRow";
import { HeroSection } from "../components/HeroSection";
import { PageSkeleton } from "../components/PageSkeleton";
import { StatusBadge } from "../components/StatusBadge";
import { SupportMetricCard } from "../components/SupportMetricCard";
import { SupportPanel } from "../components/SupportPanel";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useCompany } from "../context/CompanyContext";
import { useDialog } from "../context/DialogContext";
import { queryKeys } from "../lib/queryKeys";
import { formatDate, projectUrl } from "../lib/utils";

export function Projects() {
  const { selectedCompanyId } = useCompany();
  const { openNewProject } = useDialog();
  const { setBreadcrumbs } = useBreadcrumbs();

  useEffect(() => {
    setBreadcrumbs([{ label: "Projects" }]);
  }, [setBreadcrumbs]);

  const { data: projects, isLoading, error } = useQuery({
    queryKey: queryKeys.projects.list(selectedCompanyId!),
    queryFn: () => projectsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const workspaceCount = useMemo(
    () => (projects ?? []).reduce((sum, project) => sum + project.workspaces.length, 0),
    [projects],
  );
  const activeCount = useMemo(
    () => (projects ?? []).filter((project) => project.status === "in_progress").length,
    [projects],
  );
  const withTargets = useMemo(
    () => (projects ?? []).filter((project) => Boolean(project.targetDate)).length,
    [projects],
  );

  if (!selectedCompanyId) {
    return <EmptyState icon={Hexagon} message="Select a company to view projects." />;
  }

  if (isLoading) {
    return <PageSkeleton variant="list" />;
  }

  return (
    <div className="space-y-8">
      <HeroSection
        title="Projects"
        subtitle="Track the scopes this company is actively operating, the workspaces bound to them, and the delivery surfaces they anchor."
        eyebrow="Scope Map"
        actions={
          <Button size="sm" onClick={openNewProject}>
            Add Project
          </Button>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SupportMetricCard
          icon={FolderKanban}
          label="Projects"
          value={projects?.length ?? 0}
          detail="Visible project scopes currently configured for this company."
          tone="accent"
        />
        <SupportMetricCard
          icon={Link2}
          label="Workspaces"
          value={workspaceCount}
          detail="Bound repositories or execution roots attached to the project directory."
        />
        <SupportMetricCard
          icon={Hexagon}
          label="In progress"
          value={activeCount}
          detail="Projects actively moving through delivery rather than planning or archive states."
        />
        <SupportMetricCard
          icon={TimerReset}
          label="With target date"
          value={withTargets}
          detail="Projects that already expose a visible delivery target or checkpoint."
        />
      </div>

      <SupportPanel
        title="Project directory"
        description="Use this page as the operating map of active scopes. The primary signal is workspace ownership, not decorative metadata."
        contentClassName="space-y-4"
      >
        {error ? <p className="text-sm text-destructive">{error.message}</p> : null}

        {projects && projects.length === 0 ? (
          <EmptyState
            icon={Hexagon}
            message="No projects exist yet."
            action="Add Project"
            onAction={openNewProject}
          />
        ) : (
          <div className="overflow-hidden rounded-[1.35rem] border border-border/80">
            {projects?.map((project) => (
              <EntityRow
                key={project.id}
                title={project.name}
                subtitle={
                  project.description
                    ?? `${project.workspaces.length} workspace${project.workspaces.length === 1 ? "" : "s"} connected`
                }
                to={projectUrl(project)}
                trailing={
                  <div className="flex items-center gap-3">
                    {project.targetDate ? (
                      <span className="text-xs text-muted-foreground">{formatDate(project.targetDate)}</span>
                    ) : null}
                    <StatusBadge status={project.status} />
                  </div>
                }
              />
            ))}
          </div>
        )}
      </SupportPanel>
    </div>
  );
}
