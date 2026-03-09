import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw, Download } from 'lucide-react';
import { PageTransition } from '@/components/PageTransition';
import { useCompany } from '@/context/CompanyContext';
import { useBreadcrumbs } from '@/context/BreadcrumbContext';
import { Button } from '@/components/ui/button';
import { knowledgeApi, type KnowledgeDocument } from '@/api/knowledge';
import { projectsApi } from '@/api/projects';
import { KnowledgeStats } from '@/components/knowledge/KnowledgeStats';
import { ProjectDistribution } from '@/components/knowledge/ProjectDistribution';
import { DocumentList } from '@/components/knowledge/DocumentList';
import { DocumentDetailModal } from '@/components/knowledge/DocumentDetailModal';
import { timeAgo } from '@/lib/timeAgo';

/**
 * Knowledge Browser Page
 *
 * Browse and search RAG-indexed knowledge base.
 * View documents, evidence, and embeddings used by agents.
 */
export function Knowledge() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [selectedDocument, setSelectedDocument] = useState<KnowledgeDocument | null>(null);

  // Set breadcrumbs
  setBreadcrumbs([{ label: 'Knowledge' }]);

  // Fetch documents
  const documentsQuery = useQuery({
    queryKey: ['knowledge', 'documents', selectedCompanyId],
    queryFn: () =>
      knowledgeApi.listDocuments({
        companyId: selectedCompanyId!,
        limit: 500,
      }),
    enabled: Boolean(selectedCompanyId),
  });

  // Fetch projects for distribution view
  const projectsQuery = useQuery({
    queryKey: ['projects', selectedCompanyId],
    queryFn: () => projectsApi.list(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
  });

  // Calculate statistics
  const stats = useMemo(() => {
    const documents = documentsQuery.data || [];

    const totalChunks = documents.reduce((sum, doc) => {
      const chunkCount = doc.metadata?.embeddingChunkCount;
      return sum + (typeof chunkCount === 'number' ? chunkCount : 0);
    }, 0);

    const lastSync = documents.length > 0
      ? timeAgo(
          new Date(
            Math.max(...documents.map(d => new Date(d.updatedAt).getTime()))
          )
        )
      : null;

    const embeddedCount = documents.filter(
      d => d.metadata?.embeddingChunkCount && typeof d.metadata.embeddingChunkCount === 'number' && d.metadata.embeddingChunkCount > 0
    ).length;
    const embeddingStatus = documents.length > 0
      ? `${Math.round((embeddedCount / documents.length) * 100)}% embedded`
      : 'No data';

    return {
      totalDocuments: documents.length,
      totalChunks,
      lastSync,
      embeddingStatus,
    };
  }, [documentsQuery.data]);

  const handleRefresh = () => {
    documentsQuery.refetch();
  };

  const isLoading = documentsQuery.isLoading || projectsQuery.isLoading;
  const hasError = documentsQuery.error || projectsQuery.error;

  if (!selectedCompanyId) {
    return (
      <PageTransition>
        <div className="text-center py-12 text-muted-foreground">
          Please select a company to view knowledge base
        </div>
      </PageTransition>
    );
  }

  return (
    <PageTransition>
      <div className="space-y-8">
        {/* Hero */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-4xl font-bold tracking-tight">Knowledge Base</h1>
              <p className="text-lg text-muted-foreground mt-2">
                Browse and search indexed documents used by agents
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleRefresh}
                disabled={isLoading}
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
              <Button variant="outline" size="sm" disabled>
                <Download className="h-4 w-4 mr-2" />
                Export
              </Button>
            </div>
          </div>
        </section>

        {/* Error State */}
        {hasError && (
          <div className="rounded-xl border border-destructive/50 bg-destructive/10 p-6 text-center">
            <p className="text-destructive">
              Failed to load knowledge base:{' '}
              {documentsQuery.error?.message || projectsQuery.error?.message}
            </p>
          </div>
        )}

        {/* Loading State */}
        {isLoading && !documentsQuery.data && (
          <div className="text-center py-12 text-muted-foreground">
            Loading knowledge base...
          </div>
        )}

        {/* Stats */}
        {!isLoading && documentsQuery.data && (
          <section>
            <KnowledgeStats
              totalDocuments={stats.totalDocuments}
              totalChunks={stats.totalChunks}
              lastSync={stats.lastSync}
              embeddingStatus={stats.embeddingStatus}
            />
          </section>
        )}

        {/* Project Distribution */}
        {!isLoading && documentsQuery.data && projectsQuery.data && (
          <section>
            <ProjectDistribution
              documents={documentsQuery.data}
              projects={projectsQuery.data}
            />
          </section>
        )}

        {/* Documents List */}
        {!isLoading && documentsQuery.data && (
          <section className="space-y-4">
            <h2 className="text-2xl font-semibold">
              Documents ({documentsQuery.data.length})
            </h2>
            <DocumentList
              documents={documentsQuery.data}
              onDocumentClick={setSelectedDocument}
            />
          </section>
        )}

        {/* Empty State */}
        {!isLoading && documentsQuery.data && documentsQuery.data.length === 0 && (
          <div className="rounded-xl border border-dashed border-border bg-muted/20 p-12 text-center">
            <h3 className="text-lg font-semibold mb-2">No documents indexed yet</h3>
            <p className="text-muted-foreground max-w-md mx-auto">
              Import project workspaces to build your knowledge base. Documents will be
              automatically chunked and embedded for semantic search.
            </p>
          </div>
        )}

        {/* Document Detail Modal */}
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
