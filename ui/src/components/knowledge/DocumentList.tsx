import { useState } from 'react';
import { FileText, Code, FileCode, Calendar, Hash } from 'lucide-react';
import { AnimatedCard } from '@/components/AnimatedCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { KnowledgeDocument } from '@/api/knowledge';
import { timeAgo } from '@/lib/timeAgo';

interface DocumentListProps {
  documents: KnowledgeDocument[];
  onDocumentClick: (document: KnowledgeDocument) => void;
}

export function DocumentList({ documents, onDocumentClick }: DocumentListProps) {
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
          placeholder="Search documents..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="max-w-md"
        />
        <div className="flex gap-2 flex-wrap">
          <Button
            variant={filterSourceType === null ? 'default' : 'outline'}
            size="sm"
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
                onClick={() => setFilterSourceType(type)}
              >
                {type} ({count})
              </Button>
            );
          })}
        </div>
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
              className="p-4 border rounded-xl hover:border-foreground/20 hover:bg-accent/20 transition-colors cursor-pointer"
              onClick={() => onDocumentClick(doc)}
            >
              <div className="flex items-start gap-4">
                <div className="p-2 bg-muted rounded-lg shrink-0">
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
