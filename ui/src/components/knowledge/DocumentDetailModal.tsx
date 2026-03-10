import { useQuery } from '@tanstack/react-query';
import { X, Code, FileText, Hash, Calendar, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { knowledgeApi, type KnowledgeDocument } from '@/api/knowledge';
import { timeAgo } from '@/lib/timeAgo';
import { cn } from '@/lib/utils';

interface DocumentDetailModalProps {
  document: KnowledgeDocument;
  onClose: () => void;
}

export function DocumentDetailModal({ document, onClose }: DocumentDetailModalProps) {
  const metadata = document.metadata ?? {};

  const chunksQuery = useQuery({
    queryKey: ['knowledge', 'documents', document.id, 'chunks'],
    queryFn: () => knowledgeApi.getDocumentChunks(document.id, { includeLinks: true }),
  });

  const totalLinks = chunksQuery.data?.reduce((sum, chunk) => sum + (chunk.links?.length ?? 0), 0) ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
      <div className="bg-card border rounded-[1.6rem] shadow-2xl max-w-5xl w-full max-h-[90vh] flex flex-col">
        <div className="flex items-start justify-between gap-4 border-b p-6">
          <div className="flex-1 min-w-0">
            <h2 className="text-2xl font-semibold truncate">
              {document.title || document.path || 'Untitled Document'}
            </h2>
            {document.path && document.path !== document.title && (
              <p className="text-sm text-muted-foreground mt-1 truncate">{document.path}</p>
            )}
            <div className="flex items-center gap-4 mt-3 text-sm text-muted-foreground flex-wrap">
              <span className="flex items-center gap-1">
                <Code className="h-4 w-4" />
                {document.sourceType}
              </span>
              {document.language && (
                <span className="flex items-center gap-1">
                  <FileText className="h-4 w-4" />
                  {document.language}
                </span>
              )}
              <span className="flex items-center gap-1">
                <Hash className="h-4 w-4" />
                {document.authorityLevel}
              </span>
              <span className="flex items-center gap-1">
                <Calendar className="h-4 w-4" />
                {timeAgo(document.updatedAt)}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <span className="rounded-full border border-border bg-background/75 px-3 py-1.5 text-muted-foreground">
                {chunksQuery.data?.length ?? 0} chunks
              </span>
              <span className="rounded-full border border-border bg-background/75 px-3 py-1.5 text-muted-foreground">
                {totalLinks} graph links
              </span>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {chunksQuery.isLoading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          )}

          {chunksQuery.error && (
            <div className="text-center py-12 text-destructive">
              Failed to load chunks: {chunksQuery.error.message}
            </div>
          )}

          {chunksQuery.data && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold mb-2">
                  Chunks ({chunksQuery.data.length})
                </h3>
                <p className="text-sm text-muted-foreground">
                  This document has been split into {chunksQuery.data.length} semantic chunks for retrieval, with chunk-level links surfaced below.
                </p>
              </div>

              <div className="space-y-4">
                {chunksQuery.data.map((chunk, idx) => (
                  <div
                    key={chunk.id}
                    className={cn(
                      "p-4 rounded-[1.15rem] border bg-muted/30",
                      idx % 2 === 0 ? "bg-muted/20" : "bg-muted/40"
                    )}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-3 text-sm">
                        <span className="font-mono font-semibold">
                          #{chunk.chunkIndex}
                        </span>
                        {chunk.symbolName && (
                          <span className="text-muted-foreground">
                            {chunk.symbolName}
                          </span>
                        )}
                        {chunk.headingPath && (
                          <span className="text-muted-foreground truncate max-w-md">
                            {chunk.headingPath}
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {chunk.tokenCount} tokens
                      </span>
                    </div>
                    <pre className="text-sm whitespace-pre-wrap font-mono bg-background/50 p-3 rounded border overflow-x-auto">
                      {chunk.textContent}
                    </pre>
                    {chunk.links && chunk.links.length > 0 && (
                      <div className="mt-3 space-y-2">
                        <div className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                          Graph Links
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {chunk.links.slice(0, 8).map((link) => (
                            <span
                              key={`${chunk.id}-${link.entityType}-${link.entityId}`}
                              className="rounded-full border border-border bg-background/70 px-2.5 py-1.5 text-xs text-foreground"
                            >
                              <span className="font-medium">{link.entityType}</span>
                              <span className="mx-1 text-muted-foreground">·</span>
                              <span>{link.linkReason}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {chunk.metadata?.embeddingModel ? (
                      <div className="mt-2 text-xs text-muted-foreground">
                        Embedding: {String(chunk.metadata.embeddingModel)}
                        {chunk.metadata.embeddingDimensions ? ` (${String(chunk.metadata.embeddingDimensions)}d)` : ''}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>

              {Object.keys(metadata).length > 0 && (
                <div className="mt-6">
                  <h3 className="text-lg font-semibold mb-2">Metadata</h3>
                  <pre className="text-xs bg-muted/50 p-4 rounded border overflow-x-auto">
                    {JSON.stringify(metadata, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-6 border-t">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
