import { useMemo } from 'react';
import { AnimatedCard } from '@/components/AnimatedCard';
import { Button } from '@/components/ui/button';
import { timeAgo } from '@/lib/timeAgo';

interface ProjectDistributionProps {
  coverage: Array<{
    projectId: string;
    projectName: string;
    documentCount: number;
    chunkCount: number;
    linkCount: number;
    lastUpdatedAt: string | null;
  }>;
  selectedProjectId: string | null;
  onSelectProject: (projectId: string | null) => void;
}

export function ProjectDistribution({ coverage, selectedProjectId, onSelectProject }: ProjectDistributionProps) {
  const distribution = useMemo(() => {
    const totalDocuments = coverage.reduce((sum, item) => sum + item.documentCount, 0);
    return coverage.map((item) => ({
      ...item,
      percentage: totalDocuments > 0 ? (item.documentCount / totalDocuments) * 100 : 0,
    }));
  }, [coverage]);

  if (distribution.length === 0) {
    return null;
  }

  return (
    <AnimatedCard delay={0.2}>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">Project Coverage</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Exact document, chunk, and link coverage by project. Pick a project to inspect a scoped slice.
            </p>
          </div>
          <Button
            variant={selectedProjectId === null ? 'default' : 'outline'}
            size="sm"
            className="rounded-full"
            onClick={() => onSelectProject(null)}
          >
            All projects
          </Button>
        </div>
        <div className="space-y-3">
          {distribution.map((item, idx) => (
            <button
              key={item.projectId}
              type="button"
              onClick={() => onSelectProject(item.projectId)}
              className={`w-full rounded-[1.2rem] border p-4 text-left transition-[border-color,background-color,transform,box-shadow] ${
                selectedProjectId === item.projectId
                  ? 'border-primary/18 bg-primary/8 shadow-[0_16px_32px_rgba(65,98,191,0.08)]'
                  : 'border-border bg-background hover:-translate-y-0.5 hover:border-primary/14 hover:bg-accent/26 hover:shadow-card'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{item.projectName}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {item.documentCount.toLocaleString()} docs · {item.chunkCount.toLocaleString()} chunks · {item.linkCount.toLocaleString()} links
                  </div>
                  {item.lastUpdatedAt && (
                    <div className="mt-1 text-xs text-muted-foreground">
                      Updated {timeAgo(item.lastUpdatedAt)}
                    </div>
                  )}
                </div>
                <span className="shrink-0 rounded-full border border-border bg-card px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">
                  {item.percentage.toFixed(1)}%
                </span>
              </div>
              <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-500 ease-out"
                  style={{
                    width: `${item.percentage}%`,
                    animationDelay: `${idx * 50}ms`,
                  }}
                />
              </div>
            </button>
          ))}
        </div>
      </div>
    </AnimatedCard>
  );
}
