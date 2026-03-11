import { useEffect, useMemo, useState, useRef } from "react";
import { useParams, useNavigate, useLocation, Navigate } from "@/lib/router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PROJECT_COLORS, isUuidLike } from "@squadrail/shared";
import { FolderKanban, Link2, Shapes, TimerReset } from "lucide-react";
import { projectsApi } from "../api/projects";
import { issuesApi } from "../api/issues";
import { agentsApi } from "../api/agents";
import { heartbeatsApi } from "../api/heartbeats";
import { assetsApi } from "../api/assets";
import { usePanel } from "../context/PanelContext";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { ProjectProperties } from "../components/ProjectProperties";
import { HeroSection } from "../components/HeroSection";
import { InlineEditor } from "../components/InlineEditor";
import { PageTabBar } from "../components/PageTabBar";
import { StatusBadge } from "../components/StatusBadge";
import { SupportMetricCard } from "../components/SupportMetricCard";
import { SupportPanel } from "../components/SupportPanel";
import { IssuesList } from "../components/IssuesList";
import { PageSkeleton } from "../components/PageSkeleton";
import { projectRouteRef } from "../lib/utils";
import { Tabs } from "@/components/ui/tabs";

/* ── Top-level tab types ── */

type ProjectTab = "overview" | "list";

function resolveProjectTab(pathname: string, projectId: string): ProjectTab | null {
  const segments = pathname.split("/").filter(Boolean);
  const projectsIdx = segments.indexOf("projects");
  if (projectsIdx === -1 || segments[projectsIdx + 1] !== projectId) return null;
  const tab = segments[projectsIdx + 2];
  if (tab === "overview") return "overview";
  if (tab === "issues") return "list";
  return null;
}

/* ── Overview tab content ── */

function OverviewContent({
  project,
  onUpdate,
  imageUploadHandler,
}: {
  project: { description: string | null; status: string; targetDate: string | null };
  onUpdate: (data: Record<string, unknown>) => void;
  imageUploadHandler?: (file: File) => Promise<string>;
}) {
  return (
    <div className="space-y-6">
      <InlineEditor
        value={project.description ?? ""}
        onSave={(description) => onUpdate({ description })}
        as="p"
        className="text-sm text-muted-foreground"
        placeholder="Add a description..."
        multiline
        imageUploadHandler={imageUploadHandler}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
        <div>
          <span className="text-muted-foreground">Status</span>
          <div className="mt-1">
            <StatusBadge status={project.status} />
          </div>
        </div>
        {project.targetDate && (
          <div>
            <span className="text-muted-foreground">Target Date</span>
            <p>{project.targetDate}</p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Color picker popover ── */

function ColorPicker({
  currentColor,
  onSelect,
}: {
  currentColor: string;
  onSelect: (color: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="shrink-0 h-5 w-5 rounded-md cursor-pointer hover:ring-2 hover:ring-foreground/20 transition-[box-shadow]"
        style={{ backgroundColor: currentColor }}
        aria-label="Change project color"
      />
      {open && (
        <div className="absolute top-full left-0 mt-2 p-2 bg-popover border border-border rounded-lg shadow-lg z-50 w-max">
          <div className="grid grid-cols-5 gap-1.5">
            {PROJECT_COLORS.map((color) => (
              <button
                key={color}
                onClick={() => {
                  onSelect(color);
                  setOpen(false);
                }}
                className={`h-6 w-6 rounded-md cursor-pointer transition-[transform,box-shadow] duration-150 hover:scale-110 ${
                  color === currentColor
                    ? "ring-2 ring-foreground ring-offset-1 ring-offset-background"
                    : "hover:ring-2 hover:ring-foreground/30"
                }`}
                style={{ backgroundColor: color }}
                aria-label={`Select color ${color}`}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── List (issues) tab content ── */

function ProjectIssuesList({ projectId, companyId }: { projectId: string; companyId: string }) {
  const queryClient = useQueryClient();

  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(companyId),
    queryFn: () => agentsApi.list(companyId),
    enabled: !!companyId,
  });

  const { data: liveRuns } = useQuery({
    queryKey: queryKeys.liveRuns(companyId),
    queryFn: () => heartbeatsApi.liveRunsForCompany(companyId),
    enabled: !!companyId,
    refetchInterval: 5000,
  });

  const liveIssueIds = useMemo(() => {
    const ids = new Set<string>();
    for (const run of liveRuns ?? []) {
      if (run.issueId) ids.add(run.issueId);
    }
    return ids;
  }, [liveRuns]);

  const { data: issues, isLoading, error } = useQuery({
    queryKey: queryKeys.issues.listByProject(companyId, projectId),
    queryFn: () => issuesApi.list(companyId, { projectId }),
    enabled: !!companyId,
  });

  const updateIssue = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      issuesApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.listByProject(companyId, projectId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.list(companyId) });
    },
  });

  return (
    <IssuesList
      issues={issues ?? []}
      isLoading={isLoading}
      error={error as Error | null}
      agents={agents}
      liveIssueIds={liveIssueIds}
      projectId={projectId}
      viewStateKey={`squadrail:project-view:${projectId}`}
      legacyViewStateKey={`squadrail:project-view:${projectId}`}
      onUpdateIssue={(id, data) => updateIssue.mutate({ id, data })}
    />
  );
}

/* ── Main project page ── */

export function ProjectDetail() {
  const { companyPrefix, projectId, filter } = useParams<{
    companyPrefix?: string;
    projectId: string;
    filter?: string;
  }>();
  const { companies, selectedCompanyId, setSelectedCompanyId } = useCompany();
  const { openPanel, closePanel } = usePanel();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const routeProjectRef = projectId ?? "";
  const routeCompanyId = useMemo(() => {
    if (!companyPrefix) return null;
    const requestedPrefix = companyPrefix.toUpperCase();
    return companies.find((company) => company.issuePrefix.toUpperCase() === requestedPrefix)?.id ?? null;
  }, [companies, companyPrefix]);
  const lookupCompanyId = routeCompanyId ?? selectedCompanyId ?? undefined;
  const canFetchProject = routeProjectRef.length > 0 && (isUuidLike(routeProjectRef) || Boolean(lookupCompanyId));

  const activeTab = routeProjectRef ? resolveProjectTab(location.pathname, routeProjectRef) : null;

  const { data: project, isLoading, error } = useQuery({
    queryKey: [...queryKeys.projects.detail(routeProjectRef), lookupCompanyId ?? null],
    queryFn: () => projectsApi.get(routeProjectRef, lookupCompanyId),
    enabled: canFetchProject,
  });
  const canonicalProjectRef = project ? projectRouteRef(project) : routeProjectRef;
  const projectLookupRef = project?.id ?? routeProjectRef;
  const resolvedCompanyId = project?.companyId ?? selectedCompanyId;

  useEffect(() => {
    if (!project?.companyId || project.companyId === selectedCompanyId) return;
    setSelectedCompanyId(project.companyId, { source: "route_sync" });
  }, [project?.companyId, selectedCompanyId, setSelectedCompanyId]);

  const invalidateProject = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.projects.detail(routeProjectRef) });
    queryClient.invalidateQueries({ queryKey: queryKeys.projects.detail(projectLookupRef) });
    if (resolvedCompanyId) {
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.list(resolvedCompanyId) });
    }
  };

  const updateProject = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      projectsApi.update(projectLookupRef, data, resolvedCompanyId ?? lookupCompanyId),
    onSuccess: invalidateProject,
  });

  const uploadImage = useMutation({
    mutationFn: async (file: File) => {
      if (!resolvedCompanyId) throw new Error("No company selected");
      return assetsApi.uploadImage(resolvedCompanyId, file, `projects/${projectLookupRef || "draft"}`);
    },
  });

  useEffect(() => {
    setBreadcrumbs([
      { label: "Projects", href: "/projects" },
      { label: project?.name ?? routeProjectRef ?? "Project" },
    ]);
  }, [setBreadcrumbs, project, routeProjectRef]);

  useEffect(() => {
    if (!project) return;
    if (routeProjectRef === canonicalProjectRef) return;
    if (activeTab === "overview") {
      navigate(`/projects/${canonicalProjectRef}/overview`, { replace: true });
      return;
    }
    if (activeTab === "list") {
      if (filter) {
        navigate(`/projects/${canonicalProjectRef}/issues/${filter}`, { replace: true });
        return;
      }
      navigate(`/projects/${canonicalProjectRef}/issues`, { replace: true });
      return;
    }
    navigate(`/projects/${canonicalProjectRef}`, { replace: true });
  }, [project, routeProjectRef, canonicalProjectRef, activeTab, filter, navigate]);

  useEffect(() => {
    if (project) {
      openPanel(<ProjectProperties project={project} onUpdate={(data) => updateProject.mutate(data)} />);
    }
    return () => closePanel();
  }, [project]); // eslint-disable-line react-hooks/exhaustive-deps

  // Redirect bare /projects/:id to /projects/:id/issues
  if (routeProjectRef && activeTab === null) {
    return <Navigate to={`/projects/${canonicalProjectRef}/issues`} replace />;
  }

  if (isLoading) return <PageSkeleton variant="detail" />;
  if (error) return <p className="text-sm text-destructive">{error.message}</p>;
  if (!project) return null;

  const handleTabChange = (tab: ProjectTab) => {
    if (tab === "overview") {
      navigate(`/projects/${canonicalProjectRef}/overview`);
    } else {
      navigate(`/projects/${canonicalProjectRef}/issues`);
    }
  };

  const linkedGoalCount = new Set([
    ...(project.goalIds ?? []),
    ...project.goals.map((goal) => goal.id),
    ...(project.goalId ? [project.goalId] : []),
  ]).size;
  const workspaceCount = project.workspaces.length;

  return (
    <div className="space-y-8">
      <HeroSection
        title={project.name}
        subtitle={project.description ?? "Define the project surface, keep its linked workspaces clear, and route delivery work through the correct scope."}
        eyebrow="Project Surface"
        actions={
          <div className="flex items-center gap-3">
            <div className="rounded-full border border-border/80 bg-background/80 p-1.5">
              <ColorPicker
                currentColor={project.color ?? "#6366f1"}
                onSelect={(color) => updateProject.mutate({ color })}
              />
            </div>
            <StatusBadge status={project.status} />
          </div>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SupportMetricCard
          icon={FolderKanban}
          label="Status"
          value={project.status.replace(/_/g, " ")}
          detail="Current project state exposed to the rest of the delivery workspace."
          tone="accent"
        />
        <SupportMetricCard
          icon={Link2}
          label="Workspaces"
          value={workspaceCount}
          detail="Execution roots and repositories currently bound to this project."
        />
        <SupportMetricCard
          icon={Shapes}
          label="Linked goals"
          value={linkedGoalCount}
          detail="Goal-level intent currently connected to this delivery scope."
        />
        <SupportMetricCard
          icon={TimerReset}
          label="Target date"
          value={project.targetDate ?? "Unset"}
          detail="Visible delivery target for the project, if one has already been defined."
        />
      </div>

      <SupportPanel
        title="Project workspace"
        description="Keep the overview focused on scope definition and use the work tab when you need the underlying issue queue."
        action={
          <Tabs value={activeTab ?? "list"} onValueChange={(value) => handleTabChange(value as ProjectTab)}>
            <PageTabBar
              items={[
                { value: "overview", label: "Overview" },
                { value: "list", label: "Work" },
              ]}
              value={activeTab ?? "list"}
              onValueChange={(value) => handleTabChange(value as ProjectTab)}
            />
          </Tabs>
        }
        contentClassName="space-y-4"
      >
        {activeTab === "overview" && (
          <div className="space-y-4">
            <div className="rounded-[1.25rem] border border-border/80 bg-background/70 px-4 py-4">
              <div className="text-[11px] font-medium tracking-[0.14em] text-muted-foreground">
                Project name
              </div>
              <InlineEditor
                value={project.name}
                onSave={(name) => updateProject.mutate({ name })}
                as="h2"
                className="mt-2 text-2xl font-semibold tracking-[-0.04em]"
              />
            </div>
            <div className="rounded-[1.25rem] border border-border/80 bg-background/70 px-4 py-4">
              <OverviewContent
                project={project}
                onUpdate={(data) => updateProject.mutate(data)}
                imageUploadHandler={async (file) => {
                  const asset = await uploadImage.mutateAsync(file);
                  return asset.contentPath;
                }}
              />
            </div>
          </div>
        )}

        {activeTab === "list" && project?.id && resolvedCompanyId && (
          <ProjectIssuesList projectId={project.id} companyId={resolvedCompanyId} />
        )}
      </SupportPanel>
    </div>
  );
}
