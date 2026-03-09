import { useMemo } from 'react';
import { AnimatedCard } from '@/components/AnimatedCard';
import type { KnowledgeDocument } from '@/api/knowledge';

interface ProjectDistributionProps {
  documents: KnowledgeDocument[];
  projects: Array<{ id: string; name: string; urlKey?: string }>;
}

export function ProjectDistribution({ documents, projects }: ProjectDistributionProps) {
  const distribution = useMemo(() => {
    const counts = new Map<string, number>();

    for (const doc of documents) {
      const projectId = doc.projectId || 'unassigned';
      counts.set(projectId, (counts.get(projectId) || 0) + 1);
    }

    const total = documents.length;
    const projectMap = new Map(projects.map(p => [p.id, p]));

    return Array.from(counts.entries())
      .map(([projectId, count]) => ({
        projectId,
        projectName: projectId === 'unassigned'
          ? 'Unassigned'
          : projectMap.get(projectId)?.name || projectId.substring(0, 8),
        count,
        percentage: total > 0 ? (count / total) * 100 : 0,
      }))
      .sort((a, b) => b.count - a.count);
  }, [documents, projects]);

  if (distribution.length === 0) {
    return null;
  }

  return (
    <AnimatedCard delay={0.2}>
      <div className="p-6 border rounded-xl shadow-card">
        <h3 className="text-lg font-semibold mb-4">Distribution by Project</h3>
        <div className="space-y-3">
          {distribution.slice(0, 10).map((item, idx) => (
            <div key={item.projectId} className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium truncate">{item.projectName}</span>
                <span className="text-muted-foreground ml-2">
                  {item.count.toLocaleString()} ({item.percentage.toFixed(1)}%)
                </span>
              </div>
              <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                <div
                  className="bg-primary h-full transition-all duration-500 ease-out rounded-full"
                  style={{
                    width: `${item.percentage}%`,
                    animationDelay: `${idx * 50}ms`,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </AnimatedCard>
  );
}
