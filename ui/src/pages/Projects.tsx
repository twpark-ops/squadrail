import { useEffect, useMemo } from "react";

import { useQuery } from "@tanstack/react-query";
import { Hexagon } from "lucide-react";

import { Button } from "@/components/ui/button";

import { projectsApi } from "../api/projects";
import { EmptyState } from "../components/EmptyState";
import { EntityRow } from "../components/EntityRow";
import { PageSkeleton } from "../components/PageSkeleton";
import { StatusBadge } from "../components/StatusBadge";
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
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Scope map
          </div>
          <h1 className="mt-1 text-2xl font-semibold text-foreground">Projects</h1>
        </div>
        <Button size="sm" onClick={openNewProject}>
          Add Project
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 font-medium text-muted-foreground">
          <span className="tabular-nums text-foreground">{projects?.length ?? 0}</span> projects
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 font-medium text-muted-foreground">
          <span className="tabular-nums text-foreground">{workspaceCount}</span> workspaces
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 font-medium text-muted-foreground">
          <span className="tabular-nums text-foreground">{activeCount}</span> in progress
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 font-medium text-muted-foreground">
          <span className="tabular-nums text-foreground">{withTargets}</span> with target date
        </span>
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
