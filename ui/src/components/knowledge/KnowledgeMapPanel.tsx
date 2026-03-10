import { FileCode2, FileText, FolderTree, Network } from "lucide-react";
import type { KnowledgeDocument } from "@/api/knowledge";
import { cn } from "@/lib/utils";

interface ProjectCoverageItem {
  projectId: string;
  projectName: string;
  documentCount: number;
  chunkCount: number;
  linkCount: number;
  lastUpdatedAt: string | null;
}

interface KnowledgeMapPanelProps {
  coverage: ProjectCoverageItem[];
  documents: KnowledgeDocument[];
  selectedProjectId: string | null;
  onSelectProject: (projectId: string | null) => void;
  onSelectDocument: (document: KnowledgeDocument) => void;
}

export function KnowledgeMapPanel({
  coverage,
  documents,
  selectedProjectId,
  onSelectProject,
  onSelectDocument,
}: KnowledgeMapPanelProps) {
  const visibleProjects = (selectedProjectId
    ? coverage.filter((item) => item.projectId === selectedProjectId)
    : coverage.slice(0, 4)
  ).slice(0, 4);
  const visibleDocuments = documents.slice(0, 6);
  const sourceTypes = Array.from(new Set(visibleDocuments.map((doc) => doc.sourceType))).slice(0, 4);

  return (
    <section className="rounded-[1.7rem] border border-border bg-card px-5 py-5 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[11px] font-medium tracking-[0.08em] text-muted-foreground">Graph-read v1</div>
          <h2 className="mt-2 text-2xl font-semibold text-foreground">Knowledge Map</h2>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            A lightweight map of projects, source clusters, and the most visible documents. This is the exploration surface available without a new graph endpoint.
          </p>
        </div>
        <button
          type="button"
          onClick={() => onSelectProject(null)}
          className={cn(
            "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
            selectedProjectId === null
              ? "border-primary/16 bg-primary/8 text-primary"
              : "border-border bg-background text-muted-foreground hover:border-primary/18 hover:bg-accent hover:text-foreground",
          )}
        >
          All projects
        </button>
      </div>

      <div className="relative mt-6 overflow-hidden rounded-[1.45rem] border border-border bg-[radial-gradient(circle_at_top_left,color-mix(in_oklab,var(--primary)_8%,var(--card)),transparent_36%),linear-gradient(180deg,color-mix(in_oklab,var(--background)_92%,var(--card)),color-mix(in_oklab,var(--accent)_18%,var(--card)))] p-5 dark:bg-[radial-gradient(circle_at_top_left,color-mix(in_oklab,var(--primary)_12%,transparent),transparent_36%),linear-gradient(180deg,color-mix(in_oklab,var(--background)_94%,var(--card)),color-mix(in_oklab,var(--card)_88%,var(--accent)))]">
        <div className="grid gap-6 lg:grid-cols-[0.9fr_0.7fr_1.1fr]">
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <FolderTree className="h-4 w-4 text-primary" />
              Projects
            </div>
            {visibleProjects.length === 0 ? (
              <div className="rounded-[1rem] border border-dashed border-border px-4 py-5 text-sm text-muted-foreground">
                No project coverage yet.
              </div>
            ) : (
              visibleProjects.map((project) => (
                <button
                  key={project.projectId}
                  type="button"
                  onClick={() => onSelectProject(project.projectId)}
                  className={cn(
                    "relative w-full rounded-[1rem] border px-4 py-4 text-left transition-colors after:absolute after:right-[-18px] after:top-1/2 after:h-px after:w-4 after:-translate-y-1/2 after:bg-border",
                    selectedProjectId === project.projectId
                      ? "border-primary/16 bg-primary/8"
                      : "border-border bg-card hover:border-primary/18 hover:bg-accent/24",
                  )}
                >
                  <div className="text-sm font-semibold text-foreground">{project.projectName}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {project.documentCount} docs · {project.chunkCount} chunks
                  </div>
                </button>
              ))
            )}
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Network className="h-4 w-4 text-primary" />
              Source clusters
            </div>
            {sourceTypes.length === 0 ? (
              <div className="rounded-[1rem] border border-dashed border-border px-4 py-5 text-sm text-muted-foreground">
                No source clusters yet.
              </div>
            ) : (
              sourceTypes.map((type) => (
                <div
                  key={type}
                  className="relative rounded-[1rem] border border-border bg-card px-4 py-4 after:absolute after:left-[-18px] after:top-1/2 after:h-px after:w-4 after:-translate-y-1/2 after:bg-border before:absolute before:right-[-18px] before:top-1/2 before:h-px before:w-4 before:-translate-y-1/2 before:bg-border"
                >
                  <div className="text-sm font-semibold text-foreground">{type}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {visibleDocuments.filter((doc) => doc.sourceType === type).length} visible documents
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <FileCode2 className="h-4 w-4 text-primary" />
              Visible documents
            </div>
            {visibleDocuments.length === 0 ? (
              <div className="rounded-[1rem] border border-dashed border-border px-4 py-5 text-sm text-muted-foreground">
                No visible documents in this slice yet.
              </div>
            ) : (
              visibleDocuments.map((doc) => (
                <button
                  key={doc.id}
                  type="button"
                  onClick={() => onSelectDocument(doc)}
                  className="relative w-full rounded-[1rem] border border-border bg-card px-4 py-4 text-left transition-colors before:absolute before:left-[-18px] before:top-1/2 before:h-px before:w-4 before:-translate-y-1/2 before:bg-border hover:border-primary/18 hover:bg-accent/24"
                >
                  <div className="flex items-start gap-3">
                    <div className="rounded-[0.9rem] border border-border bg-background p-2">
                      {doc.sourceType === "code" ? (
                        <FileCode2 className="h-4 w-4 text-primary" />
                      ) : (
                        <FileText className="h-4 w-4 text-primary" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-foreground">
                        {doc.title || doc.path || "Untitled document"}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {doc.sourceType}
                        {doc.language ? ` · ${doc.language}` : ""}
                        {doc.authorityLevel ? ` · ${doc.authorityLevel}` : ""}
                      </div>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
