import { FileCode2, FileText, FolderTree, Network } from "lucide-react";
import type { KnowledgeDocument, KnowledgeGraphView } from "@/api/knowledge";
import { cn } from "@/lib/utils";

type KnowledgeGraphNode = KnowledgeGraphView["nodes"][number];

interface ProjectCoverageItem {
  projectId: string;
  projectName: string;
  documentCount: number;
  chunkCount: number;
  linkCount: number;
  lastUpdatedAt: string | null;
}

interface KnowledgeMapPanelProps {
  graph?: KnowledgeGraphView;
  coverage: ProjectCoverageItem[];
  documents: KnowledgeDocument[];
  selectedProjectId: string | null;
  onSelectProject: (projectId: string | null) => void;
  onSelectDocument: (document: KnowledgeDocument) => void;
}

export function KnowledgeMapPanel({
  graph,
  coverage,
  documents,
  selectedProjectId,
  onSelectProject,
  onSelectDocument,
}: KnowledgeMapPanelProps) {
  const projectNodes = (graph?.nodes.filter(
    (node) =>
      node.kind === "project" &&
      (selectedProjectId ? node.projectId === selectedProjectId : true)
  ) ?? []) as KnowledgeGraphNode[];
  const entityNodes = (graph?.nodes.filter(
    (node) => node.kind === "entity"
  ) ?? []) as KnowledgeGraphNode[];
  const documentNodes = (graph?.nodes.filter(
    (node) =>
      node.kind === "document" &&
      (selectedProjectId ? node.projectId === selectedProjectId : true)
  ) ?? []) as KnowledgeGraphNode[];

  const visibleProjects =
    projectNodes.length > 0
      ? projectNodes.slice(0, 4).map((node) => ({
          projectId: node.projectId ?? node.id,
          projectName: node.label,
          documentCount: node.metric,
          chunkCount: 0,
          linkCount: 0,
          lastUpdatedAt: null,
        }))
      : (
          selectedProjectId
            ? coverage.filter((item) => item.projectId === selectedProjectId)
            : coverage.slice(0, 4)
        ).slice(0, 4);

  const visibleDocuments =
    documentNodes.length > 0
      ? documentNodes.slice(0, 6)
      : documents.slice(0, 6).map((doc) => ({
          id: `document:${doc.id}`,
          kind: "document" as const,
          label: doc.title || doc.path || "Untitled document",
          secondaryLabel: [doc.sourceType, doc.language, doc.authorityLevel]
            .filter(Boolean)
            .join(" · "),
          projectId: doc.projectId,
          metric: 0,
          path: doc.path,
          documentId: doc.id,
        }));
  const visibleDocumentCards = visibleDocuments.map((doc) => ({
    id: doc.id,
    documentId: doc.documentId ?? doc.id.replace(/^document:/, ""),
    label: doc.label,
    secondaryLabel: doc.secondaryLabel || "Knowledge document",
    isCode:
      doc.secondaryLabel?.toLowerCase().includes("code") ||
      doc.path?.endsWith(".ts") ||
      doc.path?.endsWith(".tsx") ||
      doc.path?.endsWith(".js") ||
      doc.path?.endsWith(".go") ||
      false,
  }));

  const entityHubs = entityNodes.slice(0, 5).map((node) => ({
    id: node.id,
    label: node.label,
    entityType: node.secondaryLabel ?? "entity",
    weight: node.metric,
  }));

  return (
    <section className="self-start rounded-[1.35rem] border border-border bg-card px-4 py-4 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[10px] font-semibold tracking-[0.1em] text-muted-foreground">
            Graph read surface
          </div>
          <h2 className="mt-2 text-xl font-semibold text-foreground">
            Knowledge Map
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Company-scale graph slices for projects, documents, and linked
            entities. Use this to spot which evidence surfaces are connected
            before drilling into chunk detail.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onSelectProject(null)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
              selectedProjectId === null
                ? "border-primary/16 bg-primary/8 text-primary"
                : "border-border bg-background text-muted-foreground hover:border-primary/18 hover:bg-accent hover:text-foreground"
            )}
          >
            All projects
          </button>
        </div>
      </div>

      {graph && (
        <div className="mt-4 flex flex-wrap gap-2 text-xs text-muted-foreground">
          <span className="rounded-full border border-border bg-background px-3 py-1.5">
            {graph.summary.projectNodeCount} project nodes
          </span>
          <span className="rounded-full border border-border bg-background px-3 py-1.5">
            {graph.summary.documentNodeCount} document nodes
          </span>
          <span className="rounded-full border border-border bg-background px-3 py-1.5">
            {graph.summary.entityNodeCount} entity hubs
          </span>
          <span className="rounded-full border border-border bg-background px-3 py-1.5">
            {graph.summary.edgeCount} visible edges
          </span>
        </div>
      )}

      <div className="relative mt-5 overflow-hidden rounded-[1.15rem] border border-border bg-[radial-gradient(circle_at_top_left,color-mix(in_oklab,var(--primary)_8%,var(--card)),transparent_36%),linear-gradient(180deg,color-mix(in_oklab,var(--background)_92%,var(--card)),color-mix(in_oklab,var(--accent)_18%,var(--card)))] p-4 dark:bg-[radial-gradient(circle_at_top_left,color-mix(in_oklab,var(--primary)_12%,transparent),transparent_36%),linear-gradient(180deg,color-mix(in_oklab,var(--background)_94%,var(--card)),color-mix(in_oklab,var(--card)_88%,var(--accent)))]">
        <div className="grid gap-5 lg:grid-cols-[0.9fr_0.7fr_1.1fr]">
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <FolderTree className="h-4 w-4 text-primary" />
              Projects
            </div>
            {visibleProjects.length === 0 ? (
              <div className="rounded-[0.95rem] border border-dashed border-border px-4 py-5 text-sm text-muted-foreground">
                No project coverage yet.
              </div>
            ) : (
              visibleProjects.map((project) => (
                <button
                  key={project.projectId}
                  type="button"
                  onClick={() => onSelectProject(project.projectId)}
                  className={cn(
                    "relative w-full rounded-[0.95rem] border px-4 py-3.5 text-left transition-colors after:absolute after:right-[-18px] after:top-1/2 after:h-px after:w-4 after:-translate-y-1/2 after:bg-border",
                    selectedProjectId === project.projectId
                      ? "border-primary/16 bg-primary/8"
                      : "border-border bg-card hover:border-primary/18 hover:bg-accent/24"
                  )}
                >
                  <div className="text-sm font-semibold text-foreground">
                    {project.projectName}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {project.documentCount} docs
                    {project.linkCount > 0 ? ` · ${project.linkCount} links` : ""}
                  </div>
                </button>
              ))
            )}
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Network className="h-4 w-4 text-primary" />
              Entity hubs
            </div>
            {entityHubs.length === 0 ? (
              <div className="rounded-[0.95rem] border border-dashed border-border px-4 py-5 text-sm text-muted-foreground">
                No entity hubs yet.
              </div>
            ) : (
              entityHubs.map((entity) => (
                <div
                  key={entity.id}
                  className="relative rounded-[0.95rem] border border-border bg-card px-4 py-3.5 after:absolute after:left-[-18px] after:top-1/2 after:h-px after:w-4 after:-translate-y-1/2 after:bg-border before:absolute before:right-[-18px] before:top-1/2 before:h-px before:w-4 before:-translate-y-1/2 before:bg-border"
                >
                  <div className="text-sm font-semibold text-foreground">
                    {entity.label}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {entity.entityType} · {entity.weight} visible links
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
              <div className="rounded-[0.95rem] border border-dashed border-border px-4 py-5 text-sm text-muted-foreground">
                No visible documents in this slice yet.
              </div>
            ) : (
              visibleDocumentCards.map((doc) => (
                <button
                  key={doc.id}
                  type="button"
                  onClick={() => {
                    const matched = documents.find(
                      (document) => document.id === doc.documentId
                    );
                    if (matched) onSelectDocument(matched);
                  }}
                  className="relative w-full rounded-[0.95rem] border border-border bg-card px-4 py-3.5 text-left transition-colors before:absolute before:left-[-18px] before:top-1/2 before:h-px before:w-4 before:-translate-y-1/2 before:bg-border hover:border-primary/18 hover:bg-accent/24"
                >
                  <div className="flex items-start gap-3">
                    <div className="rounded-[0.8rem] border border-border bg-background p-2">
                      {doc.isCode ? (
                        <FileCode2 className="h-4 w-4 text-primary" />
                      ) : (
                        <FileText className="h-4 w-4 text-primary" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-foreground">
                        {doc.label}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {doc.secondaryLabel || "Knowledge document"}
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
