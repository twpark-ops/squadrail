import { useEffect, useMemo, useState, useRef } from "react";
import { useParams, useNavigate, useLocation, Navigate, Link } from "@/lib/router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PROJECT_COLORS, isUuidLike, type Agent, type IssueProgressPhase } from "@squadrail/shared";
import { AlertTriangle, FolderKanban, GitPullRequestArrow, Link2, MessageSquareMore, Shapes, TimerReset } from "lucide-react";
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
import { buildProjectDeliverySummary } from "../lib/project-delivery-summary";
import { workIssuePath } from "../lib/appRoutes";
import { Tabs } from "@/components/ui/tabs";

/* ── Top-level tab types ── */

type ProjectTab = "overview" | "list";

const PROJECT_DELIVERY_PHASE_LABELS: Record<IssueProgressPhase, string> = {
  intake: "Intake",
  clarification: "Clarification",
  planning: "Planning",
  implementing: "Implementing",
  review: "Review",
  qa: "QA",
  merge: "Merge",
  blocked: "Blocked",
  done: "Done",
  cancelled: "Cancelled",
};

const PROJECT_DELIVERY_PHASE_TONE: Record<IssueProgressPhase, string> = {
  intake: "border-border bg-background text-muted-foreground",
  clarification:
    "border-sky-300/70 bg-sky-500/10 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/15 dark:text-sky-200",
  planning: "border-border bg-background text-muted-foreground",
  implementing: "border-border bg-background text-foreground",
  review:
    "border-amber-300/70 bg-amber-500/10 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-200",
  qa: "border-cyan-300/70 bg-cyan-500/10 text-cyan-700 dark:border-cyan-500/30 dark:bg-cyan-500/15 dark:text-cyan-200",
  merge:
    "border-emerald-300/70 bg-emerald-500/10 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-200",
  blocked:
    "border-red-300/70 bg-red-500/10 text-red-700 dark:border-red-500/30 dark:bg-red-500/15 dark:text-red-200",
  done:
    "border-emerald-300/70 bg-emerald-500/10 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-200",
  cancelled: "border-border bg-background text-muted-foreground",
};

function projectOwnerLabel(issue: {
  progressSnapshot?: { activeOwnerAgentId?: string | null; phase?: IssueProgressPhase | null } | null;
}, agentMap: Map<string, Agent>) {
  const snapshot = issue.progressSnapshot;
  if (!snapshot) return "No owner";
  if (snapshot.activeOwnerAgentId) {
    return agentMap.get(snapshot.activeOwnerAgentId)?.name ?? "Assigned owner";
  }
  if (snapshot.phase === "clarification") return "Waiting on human reply";
  if (snapshot.phase === "blocked") return "Recovery required";
  return "No owner";
}

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
    queryFn: () => issuesApi.list(companyId, { projectId, includeSubtasks: true }),
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

  const { data: overviewIssues = [] } = useQuery({
    queryKey: project?.id && resolvedCompanyId
      ? queryKeys.issues.listByProject(resolvedCompanyId, project.id)
      : ["project-overview-issues", routeProjectRef],
    queryFn: () => issuesApi.list(resolvedCompanyId!, { projectId: project!.id, includeSubtasks: true }),
    enabled: activeTab === "overview" && !!project?.id && !!resolvedCompanyId,
  });

  const { data: overviewAgents } = useQuery({
    queryKey: queryKeys.agents.list(resolvedCompanyId!),
    queryFn: () => agentsApi.list(resolvedCompanyId!),
    enabled: activeTab === "overview" && !!resolvedCompanyId,
  });

  const overviewAgentMap = useMemo(() => {
    const map = new Map<string, Agent>();
    for (const agent of overviewAgents ?? []) map.set(agent.id, agent);
    return map;
  }, [overviewAgents]);

  const projectDelivery = useMemo(
    () => buildProjectDeliverySummary(overviewIssues),
    [overviewIssues],
  );

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
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <SupportMetricCard
                icon={FolderKanban}
                label="Active roots"
                value={projectDelivery.activeRootCount}
                detail="Parent issues still moving inside this project."
              />
              <SupportMetricCard
                icon={AlertTriangle}
                label="Blocked"
                value={projectDelivery.blockedRootCount}
                detail="Requests needing recovery or unblock attention."
              />
              <SupportMetricCard
                icon={MessageSquareMore}
                label="Clarifications"
                value={projectDelivery.clarificationRootCount}
                detail="Project requests currently waiting on an answer."
              />
              <SupportMetricCard
                icon={GitPullRequestArrow}
                label="Review / gate"
                value={projectDelivery.reviewOrGateCount}
                detail="Requests sitting in review, QA, or merge follow-up."
                tone="accent"
              />
            </div>
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
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <div className="text-[11px] font-medium tracking-[0.14em] text-muted-foreground">
                    Current project delivery
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Keep the project overview anchored on parent issues, not just project metadata.
                  </p>
                </div>
                <Link
                  to={`/projects/${canonicalProjectRef}/issues`}
                  className="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground no-underline transition-colors hover:border-primary/18 hover:bg-accent"
                >
                  Open project work
                </Link>
              </div>

              {projectDelivery.currentDelivery.length === 0 ? (
                <p className="mt-4 text-sm text-muted-foreground">
                  No active parent issues yet. Create or route work into this project to expose delivery flow here.
                </p>
              ) : (
                <div className="mt-4 grid gap-3 xl:grid-cols-3">
                  {projectDelivery.currentDelivery.map((issue) => {
                    const snapshot = issue.progressSnapshot;
                    if (!snapshot) return null;
                    const subtaskSummary = snapshot.subtaskSummary;
                    return (
                      <Link
                        key={issue.id}
                        to={workIssuePath(issue.identifier ?? issue.id)}
                        className="rounded-[1.1rem] border border-border bg-card px-4 py-4 no-underline shadow-card transition-colors hover:border-primary/18 hover:bg-accent/24"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span
                            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${PROJECT_DELIVERY_PHASE_TONE[snapshot.phase]}`}
                          >
                            {PROJECT_DELIVERY_PHASE_LABELS[snapshot.phase]}
                          </span>
                          <span className="text-[11px] font-medium text-muted-foreground">
                            {issue.identifier ?? issue.id.slice(0, 8)}
                          </span>
                        </div>
                        <div className="mt-3">
                          <div className="line-clamp-1 text-sm font-semibold text-foreground">
                            {issue.title}
                          </div>
                          <div className="mt-1 line-clamp-2 text-sm leading-6 text-muted-foreground">
                            {snapshot.headline}
                          </div>
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span className="rounded-full border border-border bg-background px-2 py-1">
                            {projectOwnerLabel(issue, overviewAgentMap)}
                          </span>
                          {subtaskSummary.total > 0 && (
                            <span className="rounded-full border border-border bg-background px-2 py-1">
                              {subtaskSummary.done}/{subtaskSummary.total} subtasks done
                            </span>
                          )}
                          {snapshot.pendingClarificationCount > 0 && (
                            <span className="rounded-full border border-sky-300/70 bg-sky-500/10 px-2 py-1 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/15 dark:text-sky-200">
                              {snapshot.pendingClarificationCount} clarification
                            </span>
                          )}
                          {subtaskSummary.blocked > 0 && (
                            <span className="rounded-full border border-red-300/70 bg-red-500/10 px-2 py-1 text-red-700 dark:border-red-500/30 dark:bg-red-500/15 dark:text-red-200">
                              {subtaskSummary.blocked} blocked
                            </span>
                          )}
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}
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
