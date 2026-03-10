import { useState } from 'react';
import { FileText, Code, FileCode, Calendar, Hash } from 'lucide-react';
import { AnimatedCard } from '@/components/AnimatedCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { KnowledgeDocument } from '@/api/knowledge';
import { timeAgo } from '@/lib/timeAgo';

interface DocumentListProps {
  documents: KnowledgeDocument[];
  projectNames?: Record<string, string>;
  selectedProjectId?: string | null;
  recentMode?: boolean;
  onDocumentClick: (document: KnowledgeDocument) => void;
}

export function DocumentList({
  documents,
  projectNames = {},
  selectedProjectId = null,
  recentMode = false,
  onDocumentClick,
}: DocumentListProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterSourceType, setFilterSourceType] = useState<string | null>(null);

  const sourceTypes = Array.from(new Set(documents.map(d => d.sourceType)));

  const filteredDocuments = documents.filter(doc => {
    const matchesSearch = !searchQuery ||
      doc.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      doc.path?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      doc.language?.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesFilter = !filterSourceType || doc.sourceType === filterSourceType;

    return matchesSearch && matchesFilter;
  });

  const getIcon = (doc: KnowledgeDocument) => {
    if (doc.language === 'typescript' || doc.language === 'javascript') {
      return <FileCode className="h-5 w-5 text-yellow-600" />;
    }
    if (doc.language === 'python') {
      return <FileCode className="h-5 w-5 text-blue-600" />;
    }
    if (doc.language === 'go') {
      return <FileCode className="h-5 w-5 text-cyan-600" />;
    }
    if (doc.sourceType === 'code') {
      return <Code className="h-5 w-5 text-muted-foreground" />;
    }
    return <FileText className="h-5 w-5 text-muted-foreground" />;
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-3 flex-wrap">
        <Input
          type="text"
          placeholder={recentMode ? "Search recent documents..." : "Search project documents..."}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="max-w-md rounded-full"
        />
        <div className="flex gap-2 flex-wrap">
          <Button
            variant={filterSourceType === null ? 'default' : 'outline'}
            size="sm"
            className="rounded-full"
            onClick={() => setFilterSourceType(null)}
          >
            All ({documents.length})
          </Button>
          {sourceTypes.map(type => {
            const count = documents.filter(d => d.sourceType === type).length;
            return (
              <Button
                key={type}
                variant={filterSourceType === type ? 'default' : 'outline'}
                size="sm"
                className="rounded-full"
                onClick={() => setFilterSourceType(type)}
              >
                {type} ({count})
              </Button>
            );
          })}
        </div>
      </div>

      <div className="rounded-[1.15rem] border border-border/80 bg-background/60 px-4 py-3 text-sm text-muted-foreground">
        {selectedProjectId
          ? "Project-scoped view. You are browsing the selected project's knowledge slice."
          : recentMode
            ? "Company-wide recent view. This list is intentionally capped, so use project coverage above for full distribution."
            : "Company-wide knowledge view."}
      </div>

      <div className="space-y-3">
        {filteredDocuments.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            No documents found matching your criteria
          </div>
        )}

        {filteredDocuments.map((doc, idx) => (
          <AnimatedCard key={doc.id} delay={Math.min(idx * 0.03, 0.5)}>
            <div
              className="cursor-pointer rounded-[1.2rem] border border-border/80 bg-background/70 p-4 transition-colors hover:border-foreground/20 hover:bg-accent/20"
              onClick={() => onDocumentClick(doc)}
            >
              <div className="flex items-start gap-4">
                <div className="shrink-0 rounded-[0.95rem] bg-muted p-2">
                  {getIcon(doc)}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold truncate">
                    {doc.title || doc.path || 'Untitled Document'}
                  </h3>
                  {doc.path && doc.path !== doc.title && (
                    <p className="text-sm text-muted-foreground truncate mt-1">
                      {doc.path}
                    </p>
                  )}
                  <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground flex-wrap">
                    {doc.projectId && projectNames[doc.projectId] && (
                      <span className="flex items-center gap-1 rounded-full border border-border bg-card px-2 py-1">
                        {projectNames[doc.projectId]}
                      </span>
                    )}
                    <span className="flex items-center gap-1">
                      <Code className="h-3 w-3" />
                      {doc.sourceType}
                    </span>
                    {doc.language && (
                      <span className="flex items-center gap-1">
                        <FileCode className="h-3 w-3" />
                        {doc.language}
                      </span>
                    )}
                    <span className="flex items-center gap-1">
                      <Hash className="h-3 w-3" />
                      {doc.authorityLevel}
                    </span>
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {timeAgo(doc.updatedAt)}
                    </span>
                    {doc.metadata?.embeddingChunkCount ? (
                      <span className="flex items-center gap-1">
                        <FileText className="h-3 w-3" />
                        {String(doc.metadata.embeddingChunkCount)} chunks
                      </span>
                    ) : null}
                  </div>
                </div>
                <Button variant="ghost" size="sm">
                  View
                </Button>
              </div>
            </div>
          </AnimatedCard>
        ))}
      </div>

      {filteredDocuments.length > 0 && filteredDocuments.length < documents.length && (
        <p className="text-sm text-muted-foreground text-center">
          Showing {filteredDocuments.length} of {documents.length} documents
        </p>
      )}
    </div>
  );
}
