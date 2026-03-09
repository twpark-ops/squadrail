import { Database, FileText, Clock, Zap } from 'lucide-react';
import { AnimatedCard } from '@/components/AnimatedCard';

interface KnowledgeStatsProps {
  totalDocuments: number;
  totalChunks: number;
  lastSync: string | null;
  embeddingStatus: string;
}

export function KnowledgeStats({
  totalDocuments,
  totalChunks,
  lastSync,
  embeddingStatus,
}: KnowledgeStatsProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <AnimatedCard delay={0}>
        <div className="p-6 border rounded-xl shadow-card hover:shadow-card-hover transition-shadow">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-primary/10 rounded-lg">
              <Database className="h-5 w-5 text-primary" />
            </div>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Documents
            </h3>
          </div>
          <p className="text-4xl font-bold">{totalDocuments.toLocaleString()}</p>
          <p className="text-sm text-muted-foreground mt-2">Indexed files</p>
        </div>
      </AnimatedCard>

      <AnimatedCard delay={0.1}>
        <div className="p-6 border rounded-xl shadow-card hover:shadow-card-hover transition-shadow">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-primary/10 rounded-lg">
              <FileText className="h-5 w-5 text-primary" />
            </div>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Chunks
            </h3>
          </div>
          <p className="text-4xl font-bold">{totalChunks.toLocaleString()}</p>
          <p className="text-sm text-muted-foreground mt-2">Vector embeddings</p>
        </div>
      </AnimatedCard>

      <AnimatedCard delay={0.2}>
        <div className="p-6 border rounded-xl shadow-card hover:shadow-card-hover transition-shadow">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-primary/10 rounded-lg">
              <Clock className="h-5 w-5 text-primary" />
            </div>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Last Sync
            </h3>
          </div>
          <p className="text-4xl font-bold">{lastSync || 'Never'}</p>
          <p className="text-sm text-muted-foreground mt-2">Most recent update</p>
        </div>
      </AnimatedCard>

      <AnimatedCard delay={0.3}>
        <div className="p-6 border rounded-xl shadow-card hover:shadow-card-hover transition-shadow">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-primary/10 rounded-lg">
              <Zap className="h-5 w-5 text-primary" />
            </div>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Status
            </h3>
          </div>
          <p className="text-2xl font-bold">{embeddingStatus}</p>
          <p className="text-sm text-muted-foreground mt-2">Embedding health</p>
        </div>
      </AnimatedCard>
    </div>
  );
}
