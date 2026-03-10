import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  GitBranch,
  LoaderCircle,
  RefreshCw,
  Sparkles,
  Wrench,
} from "lucide-react";
import type { KnowledgeSetupView } from "@squadrail/shared";
import { companiesApi } from "@/api/companies";
import { useToast } from "@/context/ToastContext";
import { queryKeys } from "@/lib/queryKeys";
import { timeAgo } from "@/lib/timeAgo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

function compactNumber(value: number) {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function statusTone(status: string) {
  switch (status) {
    case "in_sync":
    case "ready":
    case "completed":
      return "success";
    case "repairable":
    case "stale":
    case "running":
      return "warn";
    case "missing_workspace":
    case "needs_import":
    case "failed":
    case "drifted":
      return "danger";
    default:
      return "neutral";
  }
}

function toneClasses(tone: ReturnType<typeof statusTone>) {
  switch (tone) {
    case "success":
      return "border-emerald-500/25 bg-emerald-500/10 text-emerald-200";
    case "warn":
      return "border-amber-500/25 bg-amber-500/10 text-amber-100";
    case "danger":
      return "border-rose-500/25 bg-rose-500/10 text-rose-100";
    default:
      return "border-border bg-background/70 text-muted-foreground";
  }
}

function titleCase(value: string) {
  return value.replaceAll("_", " ");
}

export function KnowledgeSetupPanel({
  companyId,
  view,
  onRefresh,
}: {
  companyId: string;
  view: KnowledgeSetupView;
  onRefresh: () => void;
}) {
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);

  useEffect(() => {
    setSelectedProjectIds((prev) => {
      if (prev.length > 0) {
        const allowed = new Set(view.projects.map((project) => project.projectId));
        const next = prev.filter((projectId) => allowed.has(projectId));
        if (next.length > 0) return next;
      }
      return view.projects.map((project) => project.projectId);
    });
  }, [view.projects]);

  const selectedProjects = useMemo(
    () => view.projects.filter((project) => selectedProjectIds.includes(project.projectId)),
    [selectedProjectIds, view.projects],
  );

  const syncMutation = useMutation({
    mutationFn: (projectIds: string[]) =>
      companiesApi.startKnowledgeSync(companyId, {
        projectIds,
        forceFull: false,
        rebuildGraph: true,
        rebuildVersions: true,
        backfillPersonalization: true,
      }),
    onSuccess: (job) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.companies.knowledgeSetup(companyId) });
      if (job.id) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.companies.knowledgeSyncJob(companyId, job.id) });
      }
      pushToast({
        tone: job.status === "failed" ? "warn" : "success",
        title: job.status === "failed" ? "Knowledge sync completed with failures" : "Knowledge sync completed",
        body:
          job.status === "failed"
            ? `${job.selectedProjectIds.length}개 프로젝트 중 일부가 실패했습니다. 최근 작업 로그를 확인하세요.`
            : `${job.selectedProjectIds.length}개 프로젝트가 최신 knowledge state로 정렬됐습니다.`,
      });
      onRefresh();
    },
    onError: (error) => {
      pushToast({
        tone: "error",
        title: "Knowledge sync failed",
        body: error instanceof Error ? error.message : String(error),
      });
    },
  });

  const repairMutation = useMutation({
    mutationFn: () => companiesApi.repairOrgSync(companyId, {
      createMissing: true,
      adoptLegacySingleEngineers: true,
      repairMismatches: true,
      pauseLegacyExtras: true,
    }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.companies.orgSync(companyId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.companies.knowledgeSetup(companyId) });
      pushToast({
        tone: result.statusAfter === "in_sync" ? "success" : "warn",
        title: result.statusAfter === "in_sync" ? "18-agent org synced" : "Org repair applied",
        body: `created ${result.createdAgentIds.length}, updated ${result.updatedAgentIds.length}, paused ${result.pausedAgentIds.length}`,
      });
      onRefresh();
    },
    onError: (error) => {
      pushToast({
        tone: "error",
        title: "Org repair failed",
        body: error instanceof Error ? error.message : String(error),
      });
    },
  });

  const readyProjects = view.projects.filter((project) => project.projectStatus === "ready").length;
  const projectsNeedingAttention = view.projects.filter((project) => project.projectStatus !== "ready").length;
  const totalDocuments = view.projects.reduce((sum, project) => sum + project.knowledge.documentCount, 0);
  const totalLinks = view.projects.reduce((sum, project) => sum + project.knowledge.linkCount, 0);
  const latestJob = view.latestJob;
  const latestJobLabel = latestJob?.completedAt
    ? timeAgo(new Date(latestJob.completedAt))
    : latestJob?.startedAt
      ? timeAgo(new Date(latestJob.startedAt))
      : null;

  const allSelected = selectedProjectIds.length > 0 && selectedProjectIds.length === view.projects.length;
  const someSelected = selectedProjectIds.length > 0 && !allSelected;

  const toggleAllProjects = (checked: boolean) => {
    setSelectedProjectIds(checked ? view.projects.map((project) => project.projectId) : []);
  };

  const toggleProject = (projectId: string, checked: boolean) => {
    setSelectedProjectIds((prev) =>
      checked ? Array.from(new Set([...prev, projectId])) : prev.filter((entry) => entry !== projectId),
    );
  };

  return (
    <div className="space-y-6">
      <section className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="rounded-[1.5rem] border border-border bg-card p-5 shadow-card">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/15 bg-primary/8 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-primary/90">
                <Sparkles className="h-3.5 w-3.5" />
                Setup control
              </div>
              <div>
                <h2 className="text-2xl font-semibold tracking-tight text-foreground">Knowledge Setup</h2>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
                  18-agent org drift, project workspace readiness, graph/version rebuild, personalization backfill까지 한 곳에서 정렬합니다.
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={onRefresh}
                disabled={syncMutation.isPending || repairMutation.isPending}
                className="rounded-full"
              >
                <RefreshCw className={`mr-2 h-4 w-4 ${syncMutation.isPending || repairMutation.isPending ? "animate-spin" : ""}`} />
                Refresh
              </Button>
              <Button
                size="sm"
                onClick={() => syncMutation.mutate(selectedProjectIds)}
                disabled={selectedProjectIds.length === 0 || syncMutation.isPending || repairMutation.isPending}
                className="rounded-full"
              >
                {syncMutation.isPending ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Database className="mr-2 h-4 w-4" />}
                Sync selected
              </Button>
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-[1.2rem] border border-border bg-background/70 px-4 py-4">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Projects ready</div>
              <div className="mt-2 text-3xl font-semibold text-foreground">{readyProjects}/{view.projects.length}</div>
              <div className="mt-1 text-sm text-muted-foreground">Knowledge sync가 현재 HEAD와 맞는 프로젝트</div>
            </div>
            <div className="rounded-[1.2rem] border border-border bg-background/70 px-4 py-4">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Drift status</div>
              <div className="mt-2 flex items-center gap-2">
                <Badge variant="outline" className={toneClasses(statusTone(view.orgSync.status))}>
                  {titleCase(view.orgSync.status)}
                </Badge>
                <span className="text-sm text-muted-foreground">
                  {view.orgSync.liveAgentCount}/{view.orgSync.canonicalAgentCount} live
                </span>
              </div>
              <div className="mt-1 text-sm text-muted-foreground">Canonical template: {view.orgSync.canonicalVersion}</div>
            </div>
            <div className="rounded-[1.2rem] border border-border bg-background/70 px-4 py-4">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Knowledge volume</div>
              <div className="mt-2 text-3xl font-semibold text-foreground">{compactNumber(totalDocuments)}</div>
              <div className="mt-1 text-sm text-muted-foreground">{compactNumber(totalLinks)} graph links across selected repos</div>
            </div>
            <div className="rounded-[1.2rem] border border-border bg-background/70 px-4 py-4">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Latest sync</div>
              <div className="mt-2 text-lg font-semibold text-foreground">
                {latestJobLabel ?? "No runs yet"}
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                {latestJob ? `${titleCase(latestJob.status)} · ${latestJob.selectedProjectIds.length} projects` : "Run setup sync after org repair."}
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-[1.5rem] border border-border bg-card p-5 shadow-card">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">18-agent org drift</div>
              <h3 className="mt-2 text-xl font-semibold text-foreground">Canonical org alignment</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                live `cloud-swiftsight`가 canonical 18-agent template와 얼마나 어긋나 있는지 확인하고 바로 repair할 수 있습니다.
              </p>
            </div>
            <Button
              size="sm"
              variant={view.orgSync.status === "in_sync" ? "outline" : "default"}
              disabled={repairMutation.isPending || view.orgSync.status === "in_sync"}
              onClick={() => repairMutation.mutate()}
              className="rounded-full"
            >
              {repairMutation.isPending ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Wrench className="mr-2 h-4 w-4" />}
              Repair org
            </Button>
          </div>

          <div className="mt-5 space-y-3">
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className={toneClasses(statusTone(view.orgSync.status))}>
                {titleCase(view.orgSync.status)}
              </Badge>
              <Badge variant="outline">{view.orgSync.matchedAgentCount} matched</Badge>
              <Badge variant="outline">{view.orgSync.missingAgents.length} missing</Badge>
              <Badge variant="outline">{view.orgSync.extraAgents.length} extra</Badge>
              <Badge variant="outline">{view.orgSync.mismatchedAgents.length} mismatch</Badge>
            </div>

            <div className="grid gap-2">
              {view.orgSync.missingAgents.slice(0, 3).map((agent) => (
                <div key={agent.canonicalSlug} className="rounded-[1rem] border border-amber-500/20 bg-amber-500/8 px-3 py-3 text-sm">
                  <div className="font-medium text-amber-50">{agent.canonicalSlug}</div>
                  <div className="mt-1 text-amber-100/75">{agent.projectSlug ?? "company"} · {agent.adapterType}</div>
                </div>
              ))}
              {view.orgSync.mismatchedAgents.slice(0, 2).map((agent) => (
                <div key={agent.agentId} className="rounded-[1rem] border border-rose-500/20 bg-rose-500/8 px-3 py-3 text-sm">
                  <div className="font-medium text-rose-50">{agent.liveUrlKey}</div>
                  <div className="mt-1 text-rose-100/75">Mismatch: {agent.mismatchKeys.join(", ")}</div>
                </div>
              ))}
              {view.orgSync.status === "in_sync" && (
                <div className="rounded-[1rem] border border-emerald-500/20 bg-emerald-500/8 px-3 py-3 text-sm text-emerald-100">
                  18-agent canonical org와 live runtime이 정렬돼 있습니다.
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-[1.5rem] border border-border bg-card p-5 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Project sync matrix</div>
            <h3 className="mt-2 text-xl font-semibold text-foreground">Workspace → Knowledge → Graph</h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              어떤 프로젝트를 knowledge에 넣을지 선택하고, workspace drift·graph/version·personalization 상태를 바로 확인합니다.
            </p>
          </div>
          <div className="flex items-center gap-3 rounded-full border border-border bg-background/70 px-3 py-2">
            <Checkbox
              checked={allSelected ? true : someSelected ? "indeterminate" : false}
              onCheckedChange={(value) => toggleAllProjects(Boolean(value))}
              aria-label="Select all projects"
            />
            <span className="text-sm text-foreground">Select all</span>
            <span className="text-sm text-muted-foreground">{selectedProjectIds.length} selected</span>
          </div>
        </div>

        <div className="mt-5 overflow-hidden rounded-[1.25rem] border border-border">
          <div className="grid grid-cols-[44px_minmax(0,1.5fr)_0.9fr_0.95fr_0.95fr] gap-3 border-b border-border bg-muted/25 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            <div />
            <div>Project</div>
            <div>Status</div>
            <div>Knowledge</div>
            <div>Workspace</div>
          </div>
          <div className="divide-y divide-border">
            {view.projects.map((project) => {
              const tone = statusTone(project.projectStatus);
              return (
                <div
                  key={project.projectId}
                  className="grid grid-cols-[44px_minmax(0,1.5fr)_0.9fr_0.95fr_0.95fr] gap-3 px-4 py-4"
                >
                  <div className="flex items-start justify-center pt-1">
                    <Checkbox
                      checked={selectedProjectIds.includes(project.projectId)}
                      onCheckedChange={(value) => toggleProject(project.projectId, Boolean(value))}
                      aria-label={`Select ${project.projectName}`}
                    />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="truncate text-sm font-semibold text-foreground">{project.projectName}</div>
                      {project.personalization.profileCount > 0 && (
                        <Badge variant="outline" className="gap-1">
                          <Sparkles className="h-3 w-3" />
                          {project.personalization.profileCount} profiles
                        </Badge>
                      )}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                      <span className="rounded-full border border-border bg-background px-2.5 py-1">
                        {project.knowledge.documentCount} docs
                      </span>
                      <span className="rounded-full border border-border bg-background px-2.5 py-1">
                        {project.knowledge.chunkCount} chunks
                      </span>
                      <span className="rounded-full border border-border bg-background px-2.5 py-1">
                        {project.knowledge.linkCount} links
                      </span>
                      <span className="rounded-full border border-border bg-background px-2.5 py-1">
                        rev {project.knowledge.revision}
                      </span>
                    </div>
                    {project.syncIssues.length > 0 && (
                      <div className="mt-3 space-y-1.5">
                        {project.syncIssues.map((issue) => (
                          <div key={issue} className="flex items-start gap-2 text-xs text-amber-100/85">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />
                            <span>{issue}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Badge variant="outline" className={toneClasses(tone)}>
                      {titleCase(project.projectStatus)}
                    </Badge>
                    <div className="text-xs text-muted-foreground">
                      {project.knowledge.lastImportedAt
                        ? `Imported ${timeAgo(new Date(project.knowledge.lastImportedAt))}`
                        : "Never imported"}
                    </div>
                  </div>
                  <div className="space-y-2 text-sm text-muted-foreground">
                    <div className="flex items-center gap-2 text-foreground">
                      <Database className="h-4 w-4 text-primary" />
                      <span>{compactNumber(project.knowledge.chunkCount)} chunks</span>
                    </div>
                    <div>{compactNumber(project.knowledge.symbolEdgeCount)} symbol edges</div>
                    <div>{compactNumber(project.personalization.feedbackCount)} feedback events</div>
                  </div>
                  <div className="space-y-2 text-sm text-muted-foreground">
                    <div className="flex items-center gap-2 text-foreground">
                      <GitBranch className="h-4 w-4 text-primary" />
                      <span className="truncate">{project.workspace.currentBranch ?? "No branch"}</span>
                    </div>
                    <div className="truncate">{project.workspace.cwd ?? "Workspace not configured"}</div>
                    <div className="text-xs">
                      {project.workspace.currentHeadSha
                        ? `HEAD ${project.workspace.currentHeadSha.slice(0, 10)}`
                        : "HEAD unavailable"}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-muted-foreground">
            {projectsNeedingAttention > 0
              ? `${projectsNeedingAttention}개 프로젝트가 workspace drift 또는 import 누락 상태입니다.`
              : "모든 프로젝트가 현재 knowledge 기준으로 ready 상태입니다."}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelectedProjectIds(view.projects.map((project) => project.projectId))}
              className="rounded-full"
            >
              Select all projects
            </Button>
            <Button
              size="sm"
              disabled={selectedProjects.length === 0 || syncMutation.isPending}
              onClick={() => syncMutation.mutate(selectedProjectIds)}
              className="rounded-full"
            >
              {syncMutation.isPending ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
              Run full sync
            </Button>
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="rounded-[1.5rem] border border-border bg-card p-5 shadow-card">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Recent jobs</div>
          <h3 className="mt-2 text-xl font-semibold text-foreground">Sync execution history</h3>
          <div className="mt-4 space-y-3">
            {view.recentJobs.length === 0 && (
              <div className="rounded-[1rem] border border-dashed border-border bg-background/70 px-4 py-6 text-sm text-muted-foreground">
                아직 knowledge sync 기록이 없습니다.
              </div>
            )}
            {view.recentJobs.map((job) => (
              <div key={job.id} className="rounded-[1rem] border border-border bg-background/70 px-4 py-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={toneClasses(statusTone(job.status))}>
                      {titleCase(job.status)}
                    </Badge>
                    <span className="text-sm font-medium text-foreground">{job.selectedProjectIds.length} projects</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {job.completedAt ? timeAgo(new Date(job.completedAt)) : job.startedAt ? timeAgo(new Date(job.startedAt)) : "pending"}
                  </div>
                </div>
                <div className="mt-3 grid gap-2 text-sm text-muted-foreground">
                  <div>
                    completed {String((job.summaryJson as { completedProjectCount?: number }).completedProjectCount ?? 0)} · failed {String((job.summaryJson as { failedProjectCount?: number }).failedProjectCount ?? 0)}
                  </div>
                  {job.error && <div className="text-rose-200">{job.error}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-[1.5rem] border border-border bg-card p-5 shadow-card">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Why this exists</div>
          <h3 className="mt-2 text-xl font-semibold text-foreground">Operator flow</h3>
          <div className="mt-4 space-y-3 text-sm leading-6 text-muted-foreground">
            <div className="rounded-[1rem] border border-border bg-background/70 px-4 py-4">
              1. 먼저 <span className="font-medium text-foreground">Repair org</span>로 live `cloud-swiftsight`를 canonical 18-agent 구조와 맞춥니다.
            </div>
            <div className="rounded-[1rem] border border-border bg-background/70 px-4 py-4">
              2. 그다음 knowledge에 넣을 프로젝트를 선택하고 <span className="font-medium text-foreground">Run full sync</span>를 실행합니다.
            </div>
            <div className="rounded-[1rem] border border-border bg-background/70 px-4 py-4">
              3. sync는 workspace import, graph rebuild, version rebuild, personalization backfill까지 한 번에 정렬합니다.
            </div>
            <div className="rounded-[1rem] border border-border bg-background/70 px-4 py-4">
              4. 이후 real-agent issue를 던지면 brief가 최신 graph/version context를 읽고 내려오게 됩니다.
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
