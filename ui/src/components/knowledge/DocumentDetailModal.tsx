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
  const chunksQuery = useQuery({
    queryKey: ['knowledge', 'documents', document.id, 'chunks'],
    queryFn: () => knowledgeApi.getDocumentChunks(document.id),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
      <div className="bg-card border rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between p-6 border-b">
          <div className="flex-1 min-w-0">
            <h2 className="text-2xl font-bold truncate">
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
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* Content */}
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
                  This document has been split into {chunksQuery.data.length} semantic chunks for retrieval.
                </p>
              </div>

              <div className="space-y-4">
                {chunksQuery.data.map((chunk, idx) => (
                  <div
                    key={chunk.id}
                    className={cn(
                      "p-4 rounded-lg border bg-muted/30",
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
                    {chunk.metadata?.embeddingModel ? (
                      <div className="mt-2 text-xs text-muted-foreground">
                        Embedding: {String(chunk.metadata.embeddingModel)}
                        {chunk.metadata.embeddingDimensions ? ` (${String(chunk.metadata.embeddingDimensions)}d)` : ''}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>

              {/* Metadata */}
              {Object.keys(document.metadata).length > 0 && (
                <div className="mt-6">
                  <h3 className="text-lg font-semibold mb-2">Metadata</h3>
                  <pre className="text-xs bg-muted/50 p-4 rounded border overflow-x-auto">
                    {JSON.stringify(document.metadata, null, 2)}
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
