import { useQuery } from '@tanstack/react-query';
import { BarChart3, TrendingUp, Clock, CheckCircle2, XCircle } from 'lucide-react';
import { PageTransition } from '@/components/PageTransition';
import { AnimatedCard } from '@/components/AnimatedCard';
import { useCompany } from '@/context/CompanyContext';
import { useBreadcrumbs } from '@/context/BreadcrumbContext';
import { cn } from '@/lib/utils';

/**
 * Protocol Analytics Page
 *
 * Visualize protocol performance:
 * - Message volume over time
 * - Review cycle times
 * - Agent productivity metrics
 * - Success/failure rates
 */
export function Analytics() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();

  setBreadcrumbs([
    { label: 'Analytics' },
  ]);

  const metrics = [
    {
      icon: BarChart3,
      label: 'Messages Last 7 Days',
      value: '1,247',
      trend: '+12%',
      trendUp: true,
    },
    {
      icon: Clock,
      label: 'Avg Review Cycle Time',
      value: '2.4h',
      trend: '-8%',
      trendUp: true,
    },
    {
      icon: CheckCircle2,
      label: 'Success Rate',
      value: '94.2%',
      trend: '+2.1%',
      trendUp: true,
    },
    {
      icon: XCircle,
      label: 'Violations This Week',
      value: '23',
      trend: '+5',
      trendUp: false,
    },
  ];

  return (
    <PageTransition>
      <div className="space-y-8">
        {/* Hero */}
        <section className="space-y-4">
          <div>
            <h1 className="text-4xl font-bold tracking-tight">Protocol Analytics</h1>
            <p className="text-lg text-muted-foreground mt-2">
              Performance metrics and insights
            </p>
          </div>
        </section>

        {/* Metrics Grid */}
        <section>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            {metrics.map((metric, i) => (
              <AnimatedCard key={metric.label} delay={0.1 * i}>
                <div className="p-6 border rounded-xl shadow-card hover:shadow-card-hover">
                  <div className="flex items-center justify-between mb-4">
                    <div className="p-2 bg-primary/10 rounded-lg">
                      <metric.icon className="h-5 w-5 text-primary" />
                    </div>
                    <span
                      className={cn(
                        'text-sm font-medium',
                        metric.trendUp ? 'text-green-600' : 'text-red-600'
                      )}
                    >
                      {metric.trend}
                    </span>
                  </div>
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                    {metric.label}
                  </h3>
                  <p className="text-4xl font-bold">{metric.value}</p>
                </div>
              </AnimatedCard>
            ))}
          </div>
        </section>

        {/* Charts Placeholder */}
        <section className="space-y-4">
          <h2 className="text-2xl font-semibold">Message Volume</h2>
          <AnimatedCard delay={0.2}>
            <div className="p-12 border rounded-xl bg-muted/20 text-center">
              <BarChart3 className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">Charts Coming Soon</h3>
              <p className="text-muted-foreground max-w-md mx-auto">
                Interactive charts showing message volume, cycle times, and agent productivity will be available soon.
              </p>
            </div>
          </AnimatedCard>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold">Agent Productivity</h2>
          <AnimatedCard delay={0.3}>
            <div className="p-12 border rounded-xl bg-muted/20 text-center">
              <TrendingUp className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">Agent Insights Coming Soon</h3>
              <p className="text-muted-foreground max-w-md mx-auto">
                Per-agent metrics, task completion rates, and efficiency scores will be added in the next release.
              </p>
            </div>
          </AnimatedCard>
        </section>
      </div>
    </PageTransition>
  );
}
