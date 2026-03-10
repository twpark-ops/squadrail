import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, FolderTree, Network, RefreshCw } from "lucide-react";
import { PageTransition } from "@/components/PageTransition";
import { useCompany } from "@/context/CompanyContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { Button } from "@/components/ui/button";
import { knowledgeApi, type KnowledgeDocument } from "@/api/knowledge";
import { projectsApi } from "@/api/projects";
import { KnowledgeStats } from "@/components/knowledge/KnowledgeStats";
import { ProjectDistribution } from "@/components/knowledge/ProjectDistribution";
import { DocumentList } from "@/components/knowledge/DocumentList";
import { DocumentDetailModal } from "@/components/knowledge/DocumentDetailModal";
import { KnowledgeSignalPanel } from "@/components/knowledge/KnowledgeSignalPanel";
import { KnowledgeMapPanel } from "@/components/knowledge/KnowledgeMapPanel";
import { timeAgo } from "@/lib/timeAgo";

export function Knowledge() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [selectedDocument, setSelectedDocument] = useState<KnowledgeDocument | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

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

  const handleRefresh = () => {
    overviewQuery.refetch();
    documentsQuery.refetch();
    projectsQuery.refetch();
  };

  const isLoading = overviewQuery.isLoading || documentsQuery.isLoading || projectsQuery.isLoading;
  const hasError = overviewQuery.error || documentsQuery.error || projectsQuery.error;

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
        <section className="rounded-[2rem] border border-border bg-[linear-gradient(145deg,color-mix(in_oklab,var(--card)_88%,var(--background)),color-mix(in_oklab,var(--primary)_8%,var(--card)))] p-6 shadow-card dark:bg-[linear-gradient(145deg,color-mix(in_oklab,var(--card)_94%,var(--background)),color-mix(in_oklab,var(--card)_88%,var(--primary)))] md:p-7">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-3">
              <div className="inline-flex rounded-full border border-primary/10 bg-primary/8 px-3 py-1 text-[11px] font-medium tracking-[0.1em] text-primary/84">
                Evidence explorer
              </div>
              <div>
                <h1 className="text-4xl font-semibold tracking-tight text-foreground">Knowledge Base</h1>
                <p className="mt-2 max-w-3xl text-base text-muted-foreground md:text-lg">
                  Explore company-wide retrieval coverage, graph connectivity, and project-scoped evidence slices. This pass prioritizes graph-read exploration without new backend contracts.
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
                || "unknown error"}
            </p>
          </div>
        )}

        {isLoading && !overviewQuery.data && (
          <div className="rounded-[1.5rem] border border-border/70 bg-card/60 py-12 text-center text-muted-foreground">
            Loading knowledge base...
          </div>
        )}

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
                    Current retrieval scale and import freshness. These stats support the explorer instead of dominating it.
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
              </div>
            </div>
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
                    This UI-only pass gives knowledge a graph-read identity. Ask mode stays parked until the retrieval query API is exposed.
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
                  <div className="text-sm font-semibold text-foreground">What is intentionally parked</div>
                  <div className="mt-2 text-sm leading-6 text-muted-foreground">
                    Natural-language ask mode and true company-scale graph traversal are backend-dependent and remain out of scope for this worktree.
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
