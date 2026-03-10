import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { projectsApi } from "../api/projects";
import { useCompany } from "../context/CompanyContext";
import { useDialog } from "../context/DialogContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { EntityRow } from "../components/EntityRow";
import { StatusBadge } from "../components/StatusBadge";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { formatDate, projectUrl } from "../lib/utils";
import { Button } from "@/components/ui/button";
import { Hexagon, Plus } from "lucide-react";
import { HeroSection } from "../components/HeroSection";

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
        subtitle="Workspace binding, delivery scope, and the product surfaces currently operated by this company."
        actions={
          <Button size="sm" onClick={openNewProject}>
            <Plus className="mr-1.5 h-4 w-4" />
            Add Project
          </Button>
        }
      />

      {error && <p className="text-sm text-destructive">{error.message}</p>}

      {projects && projects.length === 0 && (
        <EmptyState
          icon={Hexagon}
          message="No projects yet."
          action="Add Project"
          onAction={openNewProject}
        />
      )}

      {projects && projects.length > 0 && (
        <section className="overflow-hidden rounded-[1.8rem] border border-border bg-card shadow-card">
          <div className="border-b border-border px-5 py-4">
            <h2 className="text-lg font-semibold">Project Directory</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Follow workspace ownership, schedule targets, and project delivery status.
            </p>
          </div>
          <div>
            {projects.map((project) => (
              <EntityRow
                key={project.id}
                title={project.name}
                subtitle={project.description ?? `${project.workspaces.length} workspace${project.workspaces.length === 1 ? "" : "s"} connected`}
                to={projectUrl(project)}
                trailing={
                  <div className="flex items-center gap-3">
                    {project.targetDate && (
                      <span className="text-xs text-muted-foreground">
                        {formatDate(project.targetDate)}
                      </span>
                    )}
                    <StatusBadge status={project.status} />
                  </div>
                }
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
