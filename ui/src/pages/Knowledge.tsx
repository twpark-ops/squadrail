import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, FileText, Folder, Clock, Database } from 'lucide-react';
import { PageTransition } from '@/components/PageTransition';
import { AnimatedCard } from '@/components/AnimatedCard';
import { useCompany } from '@/context/CompanyContext';
import { useBreadcrumbs } from '@/context/BreadcrumbContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * Knowledge Browser Page
 *
 * Browse and search RAG-indexed knowledge base.
 * View documents, evidence, and embeddings used by agents.
 */
export function Knowledge() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [searchQuery, setSearchQuery] = useState('');

  // Set breadcrumbs
  setBreadcrumbs([
    { label: 'Knowledge' },
  ]);

  // Placeholder data - replace with actual API
  const documents = [
    { id: '1', title: 'README.md', type: 'markdown', size: '2.4 KB', updated: '2 hours ago' },
    { id: '2', title: 'Architecture.md', type: 'markdown', size: '15.8 KB', updated: '1 day ago' },
    { id: '3', title: 'API Documentation', type: 'markdown', size: '8.2 KB', updated: '3 days ago' },
  ];

  return (
    <PageTransition>
      <div className="space-y-8">
        {/* Hero */}
        <section className="space-y-4">
          <div>
            <h1 className="text-4xl font-bold tracking-tight">Knowledge Base</h1>
            <p className="text-lg text-muted-foreground mt-2">
              Browse and search indexed documents used by agents
            </p>
          </div>

          {/* Search Bar */}
          <div className="flex gap-3 max-w-2xl">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search knowledge base..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 h-12 text-base"
              />
            </div>
            <Button size="lg">Search</Button>
          </div>
        </section>

        {/* Stats */}
        <section>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <AnimatedCard delay={0}>
              <div className="p-6 border rounded-xl shadow-card hover:shadow-card-hover">
                <div className="flex items-center gap-3 mb-3">
                  <div className="p-2 bg-primary/10 rounded-lg">
                    <Database className="h-5 w-5 text-primary" />
                  </div>
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    Total Documents
                  </h3>
                </div>
                <p className="text-4xl font-bold">127</p>
                <p className="text-sm text-muted-foreground mt-2">Across all projects</p>
              </div>
            </AnimatedCard>

            <AnimatedCard delay={0.1}>
              <div className="p-6 border rounded-xl shadow-card hover:shadow-card-hover">
                <div className="flex items-center gap-3 mb-3">
                  <div className="p-2 bg-primary/10 rounded-lg">
                    <FileText className="h-5 w-5 text-primary" />
                  </div>
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    Embeddings
                  </h3>
                </div>
                <p className="text-4xl font-bold">3,542</p>
                <p className="text-sm text-muted-foreground mt-2">Vector chunks indexed</p>
              </div>
            </AnimatedCard>

            <AnimatedCard delay={0.2}>
              <div className="p-6 border rounded-xl shadow-card hover:shadow-card-hover">
                <div className="flex items-center gap-3 mb-3">
                  <div className="p-2 bg-primary/10 rounded-lg">
                    <Clock className="h-5 w-5 text-primary" />
                  </div>
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    Last Updated
                  </h3>
                </div>
                <p className="text-4xl font-bold">2h</p>
                <p className="text-sm text-muted-foreground mt-2">Ago</p>
              </div>
            </AnimatedCard>
          </div>
        </section>

        {/* Documents List */}
        <section className="space-y-4">
          <h2 className="text-2xl font-semibold">Recent Documents</h2>
          <div className="space-y-3">
            {documents.map((doc, i) => (
              <AnimatedCard key={doc.id} delay={0.1 * i}>
                <div className="p-4 border rounded-xl hover:border-foreground/20 hover:bg-accent/20 transition-colors cursor-pointer">
                  <div className="flex items-center gap-4">
                    <div className="p-2 bg-muted rounded-lg">
                      <FileText className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold">{doc.title}</h3>
                      <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                        <span>{doc.type}</span>
                        <span>·</span>
                        <span>{doc.size}</span>
                        <span>·</span>
                        <span>Updated {doc.updated}</span>
                      </div>
                    </div>
                    <Button variant="ghost" size="sm">View</Button>
                  </div>
                </div>
              </AnimatedCard>
            ))}
          </div>
        </section>

        {/* Coming Soon */}
        <div className="rounded-xl border border-dashed border-border bg-muted/20 p-12 text-center">
          <Database className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-semibold mb-2">Knowledge Integration Coming Soon</h3>
          <p className="text-muted-foreground max-w-md mx-auto">
            Full RAG browser, semantic search, and evidence viewer will be available in the next release.
          </p>
        </div>
      </div>
    </PageTransition>
  );
}
