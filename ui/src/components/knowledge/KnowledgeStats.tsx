import { Database, FileText, Network, Boxes, Clock } from "lucide-react";
import { AnimatedCard } from "@/components/AnimatedCard";

interface KnowledgeStatsProps {
  totalDocuments: number;
  totalChunks: number;
  totalLinks: number;
  connectedDocuments: number;
  activeProjects: number;
  lastSync: string | null;
}

export function KnowledgeStats({
  totalDocuments,
  totalChunks,
  totalLinks,
  connectedDocuments,
  activeProjects,
  lastSync,
}: KnowledgeStatsProps) {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
      <AnimatedCard delay={0}>
        <div className="rounded-[1rem] border border-border bg-background/72 p-3.5 transition-shadow">
          <div className="mb-3 flex items-center gap-2.5">
            <div className="rounded-[0.8rem] border border-primary/10 bg-primary/8 p-2">
              <Database className="h-5 w-5 text-primary" />
            </div>
            <h3 className="min-w-0 text-sm font-medium leading-5 text-muted-foreground">
              Documents
            </h3>
          </div>
          <p className="text-[2rem] font-semibold">
            {totalDocuments.toLocaleString()}
          </p>
          <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
            Indexed files across the company
          </p>
        </div>
      </AnimatedCard>

      <AnimatedCard delay={0.1}>
        <div className="rounded-[1rem] border border-border bg-background/72 p-3.5 transition-shadow">
          <div className="mb-3 flex items-center gap-2.5">
            <div className="rounded-[0.8rem] border border-primary/10 bg-primary/8 p-2">
              <FileText className="h-5 w-5 text-primary" />
            </div>
            <h3 className="min-w-0 text-sm font-medium leading-5 text-muted-foreground">
              Chunks
            </h3>
          </div>
          <p className="text-[2rem] font-semibold">
            {totalChunks.toLocaleString()}
          </p>
          <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
            Semantic retrieval units
          </p>
        </div>
      </AnimatedCard>

      <AnimatedCard delay={0.2}>
        <div className="rounded-[1rem] border border-border bg-background/72 p-3.5 transition-shadow">
          <div className="mb-3 flex items-center gap-2.5">
            <div className="rounded-[0.8rem] border border-primary/10 bg-primary/8 p-2">
              <Network className="h-5 w-5 text-primary" />
            </div>
            <h3 className="min-w-0 text-sm font-medium leading-5 text-muted-foreground">
              Graph Links
            </h3>
          </div>
          <p className="text-[2rem] font-semibold">
            {totalLinks.toLocaleString()}
          </p>
          <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
            Chunk-to-entity connection edges
          </p>
        </div>
      </AnimatedCard>

      <AnimatedCard delay={0.3}>
        <div className="rounded-[1rem] border border-border bg-background/72 p-3.5 transition-shadow">
          <div className="mb-3 flex items-center gap-2.5">
            <div className="rounded-[0.8rem] border border-primary/10 bg-primary/8 p-2">
              <Boxes className="h-5 w-5 text-primary" />
            </div>
            <h3 className="min-w-0 text-sm font-medium leading-5 text-muted-foreground">
              Connected Docs
            </h3>
          </div>
          <p className="text-[2rem] font-semibold">
            {connectedDocuments.toLocaleString()}
          </p>
          <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
            {activeProjects} active projects contributing knowledge
          </p>
        </div>
      </AnimatedCard>

      <AnimatedCard delay={0.4}>
        <div className="rounded-[1rem] border border-border bg-background/72 p-3.5 transition-shadow">
          <div className="mb-3 flex items-center gap-2.5">
            <div className="rounded-[0.8rem] border border-primary/10 bg-primary/8 p-2">
              <Clock className="h-5 w-5 text-primary" />
            </div>
            <h3 className="min-w-0 text-sm font-medium leading-5 text-muted-foreground">
              Last Sync
            </h3>
          </div>
          <p className="text-2xl font-semibold">{lastSync || "Never"}</p>
          <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
            Most recent knowledge import activity
          </p>
        </div>
      </AnimatedCard>
    </div>
  );
}
