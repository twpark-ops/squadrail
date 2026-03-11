import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FolderTree, Network, Pin, PinOff, RefreshCw, Settings2 } from "lucide-react";
import { Link } from "react-router-dom";
import { PageTransition } from "@/components/PageTransition";
import { useCompany } from "@/context/CompanyContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { useToast } from "@/context/ToastContext";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { companiesApi } from "@/api/companies";
import { knowledgeApi, type KnowledgeDocument } from "@/api/knowledge";
import { projectsApi } from "@/api/projects";
import { KnowledgeStats } from "@/components/knowledge/KnowledgeStats";
import { ProjectDistribution } from "@/components/knowledge/ProjectDistribution";
import { DocumentList } from "@/components/knowledge/DocumentList";
import { DocumentDetailModal } from "@/components/knowledge/DocumentDetailModal";
import { KnowledgeSignalPanel } from "@/components/knowledge/KnowledgeSignalPanel";
import { KnowledgeMapPanel } from "@/components/knowledge/KnowledgeMapPanel";
import { KnowledgeSetupPanel } from "@/components/knowledge/KnowledgeSetupPanel";
import { changeIssuePath } from "@/lib/appRoutes";
import { queryKeys } from "@/lib/queryKeys";
import { timeAgo } from "@/lib/timeAgo";

type IssueLinkFilter = "all" | "issue_linked" | "ad_hoc";
type FeedbackFilter = "all" | "with_feedback" | "pinned" | "hidden" | "no_feedback";

function deriveFeedbackTarget(hit: {
  documentPath: string | null;
  symbolName: string | null;
  sourceType: string;
}) {
  if (hit.documentPath) {
    return {
      targetType: "path" as const,
      targetIds: [hit.documentPath],
      label: hit.documentPath,
    };
  }
  if (hit.symbolName) {
    return {
      targetType: "symbol" as const,
      targetIds: [hit.symbolName],
      label: hit.symbolName,
    };
  }
  return {
    targetType: "source_type" as const,
    targetIds: [hit.sourceType],
    label: hit.sourceType,
  };
}

function formatCacheStateLabel(value: string | null | undefined) {
  if (!value) return "unknown";
  return value.replaceAll("_", " ");
}

function formatRunLinkLabel(run: {
  issueId: string | null;
  issueIdentifier: string | null;
  issueTitle: string | null;
  retrievalRunId: string;
}) {
  if (run.issueId) return run.issueTitle ?? run.issueIdentifier ?? run.issueId;
  return `Ad-hoc run · ${run.retrievalRunId.slice(0, 8)}`;
}

export function Knowledge() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const [selectedDocument, setSelectedDocument] = useState<KnowledgeDocument | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"explore" | "setup">("explore");
  const [issueLinkFilter, setIssueLinkFilter] = useState<IssueLinkFilter>("all");
  const [feedbackFilter, setFeedbackFilter] = useState<FeedbackFilter>("all");

  useEffect(() => {
    setBreadcrumbs([{ label: "Knowledge" }]);
  }, [setBreadcrumbs]);

  const overviewQuery = useQuery({
    queryKey: ["knowledge", "overview", selectedCompanyId],
    queryFn: () => knowledgeApi.getOverview(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
  });

  const documentsQuery = useQuery({
    queryKey: ["knowledge", "documents", selectedCompanyId, selectedProjectId],
    queryFn: () =>
      knowledgeApi.listDocuments({
        companyId: selectedCompanyId!,
        projectId: selectedProjectId ?? undefined,
        limit: selectedProjectId ? 500 : 250,
      }),
    enabled: Boolean(selectedCompanyId),
  });

  const projectsQuery = useQuery({
    queryKey: ["projects", selectedCompanyId],
    queryFn: () => projectsApi.list(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
  });

  const setupQuery = useQuery({
    queryKey: selectedCompanyId ? queryKeys.companies.knowledgeSetup(selectedCompanyId) : ["companies", "__none__", "knowledge-setup"],
    queryFn: () => companiesApi.getKnowledgeSetup(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data || typeof data !== "object" || !("activeJobCount" in data)) return false;
      return Number((data as { activeJobCount?: number }).activeJobCount ?? 0) > 0 ? 5000 : false;
    },
  });

  const qualityQuery = useQuery({
    queryKey: ["knowledge", "quality", selectedCompanyId],
    queryFn: () => knowledgeApi.getQuality(selectedCompanyId!, { days: 14, limit: 2000 }),
    enabled: Boolean(selectedCompanyId),
  });

  const recentRunsQuery = useQuery({
    queryKey: ["knowledge", "recent-retrieval-runs", selectedCompanyId, selectedProjectId],
    queryFn: () => knowledgeApi.listRecentRetrievalRuns({
      companyId: selectedCompanyId!,
      projectId: selectedProjectId ?? undefined,
      limit: 8,
    }),
    enabled: Boolean(selectedCompanyId),
  });

  const retrievalFeedbackMutation = useMutation({
    mutationFn: (input: {
      issueId?: string | null;
      retrievalRunId: string;
      feedbackType: "operator_pin" | "operator_hide";
      targetType: "chunk" | "path" | "symbol" | "source_type";
      targetIds: string[];
      noteBody?: string | null;
    }) => knowledgeApi.recordRetrievalFeedback(input.retrievalRunId, {
      feedbackType: input.feedbackType,
      targetType: input.targetType,
      targetIds: input.targetIds,
      noteBody: input.noteBody ?? null,
    }),
    onSuccess: (_, variables) => {
      void recentRunsQuery.refetch();
      void qualityQuery.refetch();
      if (variables.issueId) {
        void queryClient.invalidateQueries({ queryKey: ["issue", variables.issueId] });
      }
      pushToast({
        title: variables.feedbackType === "operator_pin" ? "Retrieval hit pinned" : "Retrieval hit hidden",
        body: variables.targetIds[0] ?? variables.retrievalRunId,
        tone: "success",
      });
    },
    onError: (error) => {
      pushToast({
        title: "Retrieval feedback failed",
        body: error instanceof Error ? error.message : "Failed to record retrieval feedback",
        tone: "error",
      });
    },
  });

  const stats = useMemo(() => {
    const overview = overviewQuery.data;
    const timestamps = (overview?.projectCoverage ?? [])
      .map((project) => (project.lastUpdatedAt ? new Date(project.lastUpdatedAt).getTime() : 0))
      .filter((value) => value > 0);

    return {
      totalDocuments: overview?.totalDocuments ?? 0,
      totalChunks: overview?.totalChunks ?? 0,
      totalLinks: overview?.totalLinks ?? 0,
      connectedDocuments: overview?.connectedDocuments ?? 0,
      activeProjects: overview?.activeProjects ?? 0,
      linkedChunks: overview?.linkedChunks ?? 0,
      lastSync: timestamps.length > 0 ? timeAgo(new Date(Math.max(...timestamps))) : null,
    };
  }, [overviewQuery.data]);

  const projectNameMap = useMemo(
    () => Object.fromEntries((projectsQuery.data ?? []).map((project) => [project.id, project.name])),
    [projectsQuery.data],
  );

  const dailyTrend = useMemo(
    () => qualityQuery.data?.dailyTrend?.slice(-7) ?? [],
    [qualityQuery.data?.dailyTrend],
  );
  const filteredRecentRuns = useMemo(() => {
    const runs = recentRunsQuery.data ?? [];
    return runs.filter((run) => {
      const issueLinkMatched =
        issueLinkFilter === "all"
          ? true
          : issueLinkFilter === "issue_linked"
            ? Boolean(run.issueId)
            : !run.issueId;
      if (!issueLinkMatched) return false;

      const feedback = run.feedbackSummary;
      if (feedbackFilter === "all") return true;
      if (feedbackFilter === "with_feedback") return feedback.totalCount > 0;
      if (feedbackFilter === "pinned") return feedback.pinnedPathCount > 0;
      if (feedbackFilter === "hidden") return feedback.hiddenPathCount > 0;
      if (feedbackFilter === "no_feedback") return feedback.totalCount === 0;
      return true;
    });
  }, [feedbackFilter, issueLinkFilter, recentRunsQuery.data]);
  const feedbackRichRunCount = useMemo(
    () => (recentRunsQuery.data ?? []).filter((run) => run.feedbackSummary.totalCount > 0).length,
    [recentRunsQuery.data],
  );
  const topCandidateMissReasons = useMemo(
    () =>
      Object.entries(qualityQuery.data?.candidateCacheMissReasonCounts ?? {})
        .sort((left, right) => right[1] - left[1])
        .slice(0, 3),
    [qualityQuery.data?.candidateCacheMissReasonCounts],
  );
  const maxDailyRuns = useMemo(
    () => dailyTrend.reduce((max, day) => Math.max(max, day.totalRuns), 0),
    [dailyTrend],
  );

  const handleRefresh = () => {
    void overviewQuery.refetch();
    void documentsQuery.refetch();
    void projectsQuery.refetch();
    void setupQuery.refetch();
    void qualityQuery.refetch();
    void recentRunsQuery.refetch();
  };

  const isLoading =
    overviewQuery.isLoading
    || documentsQuery.isLoading
    || projectsQuery.isLoading
    || setupQuery.isLoading
    || qualityQuery.isLoading
    || recentRunsQuery.isLoading;
  const hasError =
    overviewQuery.error
    || documentsQuery.error
    || projectsQuery.error
    || setupQuery.error
    || qualityQuery.error
    || recentRunsQuery.error;

  if (!selectedCompanyId) {
    return (
      <PageTransition>
        <div className="py-12 text-center text-muted-foreground">
          Please select a company to view knowledge base
        </div>
      </PageTransition>
    );
  }

  return (
    <PageTransition>
      <div className="space-y-8">
        <section className="rounded-[2rem] border border-border bg-[linear-gradient(145deg,color-mix(in_oklab,var(--card)_92%,var(--background)),color-mix(in_oklab,var(--primary)_7%,var(--card)))] p-6 shadow-card md:p-7">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-3">
              <div className="inline-flex rounded-full border border-primary/10 bg-primary/8 px-3 py-1 text-[11px] font-medium tracking-[0.1em] text-primary/84">
                Evidence explorer
              </div>
              <div>
                <h1 className="text-4xl font-semibold tracking-tight text-foreground">Knowledge Base</h1>
                <p className="mt-2 max-w-3xl text-base text-muted-foreground md:text-lg">
                  Explore company-wide retrieval coverage and keep the org, workspace, graph, version, and personalization layers in sync from one place.
                </p>
              </div>
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                <span className="rounded-full border border-border bg-background px-3 py-1.5">
                  {stats.totalDocuments.toLocaleString()} documents
                </span>
                <span className="rounded-full border border-border bg-background px-3 py-1.5">
                  {stats.totalChunks.toLocaleString()} chunks
                </span>
                <span className="rounded-full border border-border bg-background px-3 py-1.5">
                  {stats.totalLinks.toLocaleString()} graph links
                </span>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleRefresh}
                disabled={isLoading}
                className="rounded-full border-border bg-background dark:bg-background/92"
              >
                <RefreshCw className={`mr-2 h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
                Refresh
              </Button>
              <Button variant="outline" size="sm" disabled className="rounded-full border-border bg-background dark:bg-background/92">
                <Download className="mr-2 h-4 w-4" />
                Export
              </Button>
            </div>
          </div>
        </section>

        {hasError && (
          <div className="rounded-[1.5rem] border border-destructive/50 bg-destructive/10 p-6 text-center">
            <p className="text-destructive">
              Failed to load knowledge base:{" "}
              {(overviewQuery.error instanceof Error ? overviewQuery.error.message : null)
                || (documentsQuery.error instanceof Error ? documentsQuery.error.message : null)
                || (projectsQuery.error instanceof Error ? projectsQuery.error.message : null)
                || (setupQuery.error instanceof Error ? setupQuery.error.message : null)
                || (qualityQuery.error instanceof Error ? qualityQuery.error.message : null)
                || (recentRunsQuery.error instanceof Error ? recentRunsQuery.error.message : null)
                || "unknown error"}
            </p>
          </div>
        )}

        {isLoading && !overviewQuery.data && !setupQuery.data && (
          <div className="rounded-[1.5rem] border border-border/70 bg-card/60 py-12 text-center text-muted-foreground">
            Loading knowledge base...
          </div>
        )}

        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as "explore" | "setup")} className="space-y-5">
          <TabsList variant="line" className="w-full justify-start gap-2 rounded-[1rem] border border-border bg-card px-2 py-2">
            <TabsTrigger value="explore" className="gap-2 rounded-full px-4 py-2">
              <Network className="h-4 w-4" />
              Explore
            </TabsTrigger>
            <TabsTrigger value="setup" className="gap-2 rounded-full px-4 py-2">
              <Settings2 className="h-4 w-4" />
              Setup
            </TabsTrigger>
          </TabsList>

          <TabsContent value="explore" className="space-y-6">
            {!isLoading && overviewQuery.data && (
              <section className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
                <KnowledgeMapPanel
                  coverage={overviewQuery.data.projectCoverage}
                  documents={documentsQuery.data ?? []}
                  selectedProjectId={selectedProjectId}
                  onSelectProject={setSelectedProjectId}
                  onSelectDocument={setSelectedDocument}
                />
                <div className="space-y-6">
                  <div className="rounded-[1.6rem] border border-border bg-card p-5 shadow-card">
                    <KnowledgeSignalPanel
                      sourceTypeDistribution={overviewQuery.data.sourceTypeDistribution}
                      authorityDistribution={overviewQuery.data.authorityDistribution}
                      linkEntityDistribution={overviewQuery.data.linkEntityDistribution}
                    />
                  </div>
                  <div className="rounded-[1.6rem] border border-border bg-card p-5 shadow-card">
                    <div className="mb-4">
                      <h2 className="text-lg font-semibold text-foreground">Retrieval posture</h2>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Current retrieval scale, cache posture, and operator feedback. This is the quickest view into whether the org memory loop is actually steering retrieval.
                      </p>
                    </div>
                    <KnowledgeStats
                      totalDocuments={stats.totalDocuments}
                      totalChunks={stats.totalChunks}
                      totalLinks={stats.totalLinks}
                      connectedDocuments={stats.connectedDocuments}
                      activeProjects={stats.activeProjects}
                      lastSync={stats.lastSync}
                    />
                    {qualityQuery.data && (
                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        <div className="rounded-[1rem] border border-border bg-background/72 px-3 py-3">
                          <div className="text-xs text-muted-foreground">Candidate cache</div>
                          <div className="mt-1 text-xl font-semibold text-foreground">
                            {(qualityQuery.data.candidateCacheHitRate * 100).toFixed(0)}%
                          </div>
                        </div>
                        <div className="rounded-[1rem] border border-border bg-background/72 px-3 py-3">
                          <div className="text-xs text-muted-foreground">Final cache</div>
                          <div className="mt-1 text-xl font-semibold text-foreground">
                            {(qualityQuery.data.finalCacheHitRate * 100).toFixed(0)}%
                          </div>
                        </div>
                        <div className="rounded-[1rem] border border-border bg-background/72 px-3 py-3">
                          <div className="text-xs text-muted-foreground">Graph-expanded runs</div>
                          <div className="mt-1 text-xl font-semibold text-foreground">
                            {qualityQuery.data.graphExpandedRuns}
                          </div>
                        </div>
                        <div className="rounded-[1rem] border border-border bg-background/72 px-3 py-3">
                          <div className="text-xs text-muted-foreground">Multi-hop runs</div>
                          <div className="mt-1 text-xl font-semibold text-foreground">
                            {qualityQuery.data.multiHopGraphExpandedRuns}
                          </div>
                        </div>
                      </div>
                    )}
                    {qualityQuery.data && (
                      <div className="mt-4 grid gap-3 xl:grid-cols-[0.85fr_1.15fr]">
                        <div className="rounded-[1rem] border border-border bg-background/72 px-4 py-4">
                          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                            Feedback posture
                          </div>
                          <div className="mt-3 grid gap-3 sm:grid-cols-3">
                            <div>
                              <div className="text-[11px] text-muted-foreground">Events</div>
                              <div className="mt-1 text-xl font-semibold text-foreground">
                                {qualityQuery.data.feedbackEventCount.toLocaleString()}
                              </div>
                            </div>
                            <div>
                              <div className="text-[11px] text-muted-foreground">Coverage</div>
                              <div className="mt-1 text-xl font-semibold text-foreground">
                                {(qualityQuery.data.feedbackCoverageRate * 100).toFixed(0)}%
                              </div>
                            </div>
                            <div>
                              <div className="text-[11px] text-muted-foreground">Profiles</div>
                              <div className="mt-1 text-xl font-semibold text-foreground">
                                {qualityQuery.data.profileCount.toLocaleString()}
                              </div>
                            </div>
                          </div>
                          <div className="mt-4 flex flex-wrap gap-2">
                            {Object.entries(qualityQuery.data.feedbackTypeCounts).length > 0 ? (
                              Object.entries(qualityQuery.data.feedbackTypeCounts)
                                .sort((left, right) => right[1] - left[1])
                                .slice(0, 4)
                                .map(([type, count]) => (
                                  <span
                                    key={type}
                                    className="rounded-full border border-border bg-card px-3 py-1.5 text-xs text-foreground/80"
                                  >
                                    {type.replaceAll("_", " ")} · {count}
                                  </span>
                                ))
                            ) : (
                              <span className="rounded-full border border-dashed border-border px-3 py-1.5 text-xs text-muted-foreground">
                                No operator feedback yet
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="rounded-[1rem] border border-border bg-background/72 px-4 py-4">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                                7-day trend
                              </div>
                              <div className="mt-1 text-sm text-muted-foreground">
                                Runs, cache reuse, and graph expansion over the last week.
                              </div>
                            </div>
                            <span className="rounded-full border border-border bg-card px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                              live quality
                            </span>
                          </div>
                          <div className="mt-4 space-y-2">
                            {dailyTrend.length > 0 ? (
                              dailyTrend.map((day) => {
                                const width = maxDailyRuns > 0 ? `${Math.max(10, Math.round((day.totalRuns / maxDailyRuns) * 100))}%` : "10%";
                                return (
                                  <div key={day.date} className="grid grid-cols-[84px_minmax(0,1fr)_120px] items-center gap-3">
                                    <div className="text-xs text-muted-foreground">{day.date.slice(5)}</div>
                                    <div className="rounded-full bg-border/60">
                                      <div
                                        className="h-2 rounded-full bg-primary/80"
                                        style={{ width }}
                                      />
                                    </div>
                                    <div className="text-right text-[11px] text-muted-foreground">
                                      {day.totalRuns} runs · {day.graphExpandedRuns} graph · {day.finalCacheHits} final cache
                                    </div>
                                  </div>
                                );
                              })
                            ) : (
                              <div className="rounded-[0.85rem] border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
                                Recent trend data will appear as retrieval runs accumulate.
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </section>
            )}

            {!isLoading && (
              <section className="rounded-[1.6rem] border border-border bg-card p-5 shadow-card">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <h2 className="text-2xl font-semibold">Recent Retrieval Loops</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Inspect the latest retrieval-backed briefs, confirm cache reuse, and steer follow-up runs with pin or hide feedback.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span className="rounded-full border border-border bg-background px-3 py-1.5">
                      {filteredRecentRuns.length}/{recentRunsQuery.data?.length ?? 0} visible
                    </span>
                    <span className="rounded-full border border-border bg-background px-3 py-1.5">
                      {(((qualityQuery.data?.candidateCacheHitRate ?? 0)) * 100).toFixed(0)}% candidate cache
                    </span>
                    <span className="rounded-full border border-border bg-background px-3 py-1.5">
                      {(((qualityQuery.data?.finalCacheHitRate ?? 0)) * 100).toFixed(0)}% final cache
                    </span>
                    <span className="rounded-full border border-border bg-background px-3 py-1.5">
                      {feedbackRichRunCount} feedback-tuned
                    </span>
                  </div>
                </div>

                <div className="mt-4 flex flex-col gap-3 rounded-[1.15rem] border border-border bg-background/65 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex flex-wrap gap-2">
                    {([
                      { value: "all", label: "All runs" },
                      { value: "issue_linked", label: "Issue-linked" },
                      { value: "ad_hoc", label: "Ad-hoc" },
                    ] as const).map((option) => (
                      <Button
                        key={option.value}
                        type="button"
                        size="sm"
                        variant={issueLinkFilter === option.value ? "default" : "outline"}
                        className="rounded-full"
                        onClick={() => setIssueLinkFilter(option.value)}
                      >
                        {option.label}
                      </Button>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {([
                      { value: "all", label: "All feedback" },
                      { value: "with_feedback", label: "Touched" },
                      { value: "pinned", label: "Pinned" },
                      { value: "hidden", label: "Hidden" },
                      { value: "no_feedback", label: "Untouched" },
                    ] as const).map((option) => (
                      <Button
                        key={option.value}
                        type="button"
                        size="sm"
                        variant={feedbackFilter === option.value ? "default" : "outline"}
                        className="rounded-full"
                        onClick={() => setFeedbackFilter(option.value)}
                      >
                        {option.label}
                      </Button>
                    ))}
                  </div>
                </div>

                {topCandidateMissReasons.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    {topCandidateMissReasons.map(([reason, count]) => (
                      <span key={reason} className="rounded-full border border-border bg-background px-3 py-1.5">
                        candidate miss · {formatCacheStateLabel(reason)} · {count}
                      </span>
                    ))}
                  </div>
                )}

                {filteredRecentRuns.length > 0 ? (
                  <div className="mt-5 grid gap-4 xl:grid-cols-2">
                    {filteredRecentRuns.map((run) => (
                      <div key={run.retrievalRunId} className="rounded-[1.25rem] border border-border bg-background/80 p-4">
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                          <div className="space-y-2">
                            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                              <span className="rounded-full border border-border bg-card px-2.5 py-1 font-medium text-foreground">
                                {run.actorRole}
                              </span>
                              <span className="rounded-full border border-border bg-card px-2.5 py-1">
                                {run.eventType}
                              </span>
                              <span className="rounded-full border border-border bg-card px-2.5 py-1">
                                {run.issueId ? "issue-linked" : "ad-hoc"}
                              </span>
                              {run.candidateCacheHit && (
                                <span className="rounded-full border border-emerald-300/70 bg-emerald-50 px-2.5 py-1 text-emerald-700">
                                  candidate cache
                                </span>
                              )}
                              {run.finalCacheHit && (
                                <span className="rounded-full border border-blue-300/70 bg-blue-50 px-2.5 py-1 text-blue-700">
                                  final cache
                                </span>
                              )}
                              {run.multiHopGraphHitCount > 0 && (
                                <span className="rounded-full border border-violet-300/70 bg-violet-50 px-2.5 py-1 text-violet-700">
                                  {run.multiHopGraphHitCount} multi-hop
                                </span>
                              )}
                            </div>
                            <div>
                              <div className="text-sm font-semibold text-foreground">
                                {run.issueIdentifier ?? run.issueTitle ?? `Run ${run.retrievalRunId.slice(0, 8)}`}
                              </div>
                              <div className="mt-1 text-sm text-muted-foreground">
                                {run.issueId && (run.issueIdentifier ?? run.issueId) ? (
                                  <Link to={changeIssuePath(run.issueIdentifier ?? run.issueId)} className="font-medium text-primary hover:underline">
                                    {formatRunLinkLabel(run)}
                                  </Link>
                                ) : (
                                  run.queryText
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="text-right text-xs text-muted-foreground">
                            <div>{new Date(run.createdAt).toLocaleString()}</div>
                            <div className="mt-1">
                              quality {run.confidenceLevel ?? "unknown"} · {run.graphHitCount} graph
                              {run.personalizationApplied ? ` · boost ${run.averagePersonalizationBoost.toFixed(2)}` : ""}
                            </div>
                          </div>
                        </div>

                        <div className="mt-4 grid gap-3 lg:grid-cols-3">
                          <div className="rounded-[1rem] border border-border bg-card px-3 py-3">
                            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                              Candidate cache
                            </div>
                            <div className="mt-2 text-sm font-semibold text-foreground">
                              {formatCacheStateLabel(run.candidateCacheState ?? (run.candidateCacheHit ? "hit" : "miss"))}
                            </div>
                            <div className="mt-1 text-xs leading-5 text-muted-foreground">
                              {run.candidateCacheReason ? `${formatCacheStateLabel(run.candidateCacheReason)} · ` : ""}
                              revision {run.candidateCacheMatchedRevision ?? "?"}
                              {run.candidateCacheLatestKnownRevision != null
                                ? ` / latest ${run.candidateCacheLatestKnownRevision}`
                                : ""}
                            </div>
                          </div>
                          <div className="rounded-[1rem] border border-border bg-card px-3 py-3">
                            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                              Evidence mix
                            </div>
                            <div className="mt-2 text-sm font-semibold text-foreground">
                              code {run.codeHitCount} · review {run.reviewHitCount}
                            </div>
                            <div className="mt-1 text-xs leading-5 text-muted-foreground">
                              org-memory {run.organizationalMemoryHitCount} · graph depth {run.graphMaxDepth}
                            </div>
                          </div>
                          <div className="rounded-[1rem] border border-border bg-card px-3 py-3">
                            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                              Feedback provenance
                            </div>
                            <div className="mt-2 text-sm font-semibold text-foreground">
                              {run.feedbackSummary.totalCount} events
                            </div>
                            <div className="mt-1 text-xs leading-5 text-muted-foreground">
                              +{run.feedbackSummary.pinnedPathCount} pinned · -{run.feedbackSummary.hiddenPathCount} hidden
                              {run.feedbackSummary.lastFeedbackAt
                                ? ` · ${timeAgo(new Date(run.feedbackSummary.lastFeedbackAt))}`
                                : ""}
                            </div>
                          </div>
                        </div>

                        <div className="mt-4 space-y-2">
                          {run.topHits.map((hit) => {
                            const target = deriveFeedbackTarget(hit);
                            return (
                              <div key={`${run.retrievalRunId}:${hit.chunkId}`} className="rounded-[1rem] border border-border bg-card px-3 py-3">
                                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                  <div className="space-y-1">
                                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                      <span className="rounded-full border border-border bg-background px-2 py-0.5 font-medium text-foreground">
                                        {hit.sourceType}
                                      </span>
                                      {hit.documentPath && (
                                        <span className="font-mono text-[11px] text-foreground/80">{hit.documentPath}</span>
                                      )}
                                      {typeof hit.finalRank === "number" && (
                                        <span className="rounded-full border border-border bg-background px-2 py-0.5">
                                          #{hit.finalRank}
                                        </span>
                                      )}
                                    </div>
                                    <div className="text-sm font-medium text-foreground">
                                      {hit.documentTitle ?? hit.symbolName ?? hit.chunkId.slice(0, 8)}
                                    </div>
                                    <div className="line-clamp-2 text-sm text-muted-foreground">
                                      {hit.rationale ?? hit.textContent}
                                    </div>
                                  </div>
                                  <div className="flex shrink-0 gap-2">
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      disabled={retrievalFeedbackMutation.isPending}
                                      onClick={() => retrievalFeedbackMutation.mutate({
                                        issueId: run.issueId,
                                        retrievalRunId: run.retrievalRunId,
                                        feedbackType: "operator_pin",
                                        targetType: target.targetType,
                                        targetIds: target.targetIds,
                                        noteBody: `Pinned from knowledge surface: ${target.label}`,
                                      })}
                                    >
                                      <Pin className="mr-2 h-3.5 w-3.5" />
                                      Pin
                                    </Button>
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="ghost"
                                      disabled={retrievalFeedbackMutation.isPending}
                                      onClick={() => retrievalFeedbackMutation.mutate({
                                        issueId: run.issueId,
                                        retrievalRunId: run.retrievalRunId,
                                        feedbackType: "operator_hide",
                                        targetType: target.targetType,
                                        targetIds: target.targetIds,
                                        noteBody: `Hidden from knowledge surface: ${target.label}`,
                                      })}
                                    >
                                      <PinOff className="mr-2 h-3.5 w-3.5" />
                                      Hide
                                    </Button>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-5 rounded-[1rem] border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
                    No retrieval runs match the current issue-link and feedback filters.
                  </div>
                )}
              </section>
            )}

            {!isLoading && overviewQuery.data && (
              <section className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
                <div className="rounded-[1.6rem] border border-border bg-card p-5 shadow-card">
                  <div className="mb-4 flex items-start gap-3">
                    <div className="rounded-[0.95rem] border border-primary/10 bg-primary/8 p-2 text-primary">
                      <FolderTree className="h-5 w-5" />
                    </div>
                    <div>
                      <h2 className="text-2xl font-semibold">Coverage by Project</h2>
                      <p className="text-sm text-muted-foreground">
                        Use project coverage to pivot the map and document browser into a more focused slice.
                      </p>
                    </div>
                  </div>
                  <ProjectDistribution
                    coverage={overviewQuery.data.projectCoverage}
                    selectedProjectId={selectedProjectId}
                    onSelectProject={setSelectedProjectId}
                  />
                </div>
                <div className="rounded-[1.6rem] border border-border bg-card p-5 shadow-card">
                  <div className="mb-4 flex items-start gap-3">
                    <div className="rounded-[0.95rem] border border-primary/10 bg-primary/8 p-2 text-primary">
                      <Network className="h-5 w-5" />
                    </div>
                    <div>
                      <h2 className="text-2xl font-semibold">Explorer Notes</h2>
                      <p className="text-sm text-muted-foreground">
                        This pass makes graph reach, project coverage, and source slices visible before ask-mode orchestration enters the UI.
                      </p>
                    </div>
                  </div>
                  <div className="grid gap-3">
                    <div className="rounded-[1.2rem] border border-border bg-background/72 px-4 py-4">
                      <div className="text-sm font-semibold text-foreground">What you can do now</div>
                      <div className="mt-2 text-sm leading-6 text-muted-foreground">
                        Pivot by project, inspect source clusters, browse visible documents, and drill into chunk-level graph links from the detail modal.
                      </div>
                    </div>
                    <div className="rounded-[1.2rem] border border-border bg-background/72 px-4 py-4">
                      <div className="text-sm font-semibold text-foreground">Current selected slice</div>
                      <div className="mt-2 text-sm leading-6 text-muted-foreground">
                        {selectedProjectId
                          ? `${projectNameMap[selectedProjectId] ?? "Selected project"} is active in the explorer.`
                          : "The explorer is showing a company-wide slice of the latest indexed material."}
                      </div>
                    </div>
                    {setupQuery.data && (
                      <div className="rounded-[1.2rem] border border-border bg-background/72 px-4 py-4">
                        <div className="text-sm font-semibold text-foreground">Setup health</div>
                        <div className="mt-2 text-sm leading-6 text-muted-foreground">
                          Org sync is <span className="font-medium text-foreground">{setupQuery.data.orgSync.status.replaceAll("_", " ")}</span> and{" "}
                          <span className="font-medium text-foreground">{setupQuery.data.projects.filter((project) => project.projectStatus === "ready").length}</span> of{" "}
                          <span className="font-medium text-foreground">{setupQuery.data.projects.length}</span> projects are ready.
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </section>
            )}

            {!isLoading && documentsQuery.data && (
              <section className="space-y-4 rounded-[1.6rem] border border-border bg-card p-5 shadow-card">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-2xl font-semibold">
                      {selectedProjectId ? "Project Slice" : "Recent Company Slice"} ({documentsQuery.data.length})
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {selectedProjectId
                        ? `${projectNameMap[selectedProjectId] ?? "Selected project"} scoped documents.`
                        : "Recent documents across all projects. Use the project coverage panel above to inspect full project slices."}
                    </p>
                  </div>
                  <div className="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                    <Network className="mr-2 inline h-3.5 w-3.5" />
                    {stats.linkedChunks.toLocaleString()} linked chunks
                  </div>
                </div>
                <DocumentList
                  documents={documentsQuery.data}
                  projectNames={projectNameMap}
                  selectedProjectId={selectedProjectId}
                  recentMode={!selectedProjectId}
                  onDocumentClick={setSelectedDocument}
                />
              </section>
            )}

            {!isLoading && overviewQuery.data && overviewQuery.data.totalDocuments === 0 && (
              <div className="rounded-[1.5rem] border border-dashed border-border bg-muted/20 p-12 text-center">
                <h3 className="mb-2 text-lg font-semibold">No documents indexed yet</h3>
                <p className="mx-auto max-w-md text-muted-foreground">
                  Import project workspaces to build your knowledge base. Documents will be chunked, embedded, and linked into the retrieval graph.
                </p>
              </div>
            )}
          </TabsContent>

          <TabsContent value="setup">
            {setupQuery.data && (
              <KnowledgeSetupPanel
                companyId={selectedCompanyId}
                view={setupQuery.data}
                onRefresh={handleRefresh}
              />
            )}
          </TabsContent>
        </Tabs>

        {selectedDocument && (
          <DocumentDetailModal
            document={selectedDocument}
            onClose={() => setSelectedDocument(null)}
          />
        )}
      </div>
    </PageTransition>
  );
}
