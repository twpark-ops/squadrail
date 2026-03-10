import { AnimatedCard } from "@/components/AnimatedCard";

interface KnowledgeSignalPanelProps {
  sourceTypeDistribution: Array<{ key: string; count: number }>;
  authorityDistribution: Array<{ key: string; count: number }>;
  linkEntityDistribution: Array<{ key: string; count: number }>;
}

function PillRow({
  title,
  items,
}: {
  title: string;
  items: Array<{ key: string; count: number }>;
}) {
  return (
    <div className="space-y-2">
      <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
        {title}
      </div>
      <div className="flex flex-wrap gap-2">
        {items.length === 0 ? (
          <span className="rounded-full border border-dashed border-border px-3 py-1.5 text-xs text-muted-foreground">
            No data
          </span>
        ) : (
          items.slice(0, 8).map((item) => (
            <span
              key={`${title}-${item.key}`}
              className="rounded-full border border-border bg-background/75 px-3 py-1.5 text-xs text-foreground"
            >
              <span className="font-medium">{item.key}</span>
              <span className="ml-2 text-muted-foreground">{item.count.toLocaleString()}</span>
            </span>
          ))
        )}
      </div>
    </div>
  );
}

export function KnowledgeSignalPanel({
  sourceTypeDistribution,
  authorityDistribution,
  linkEntityDistribution,
}: KnowledgeSignalPanelProps) {
  return (
    <AnimatedCard delay={0.15}>
      <div className="space-y-5">
        <div>
          <h3 className="text-lg font-semibold">Graph Signals</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            What kind of knowledge is indexed, how authoritative it is, and what the chunk graph is linked to.
          </p>
        </div>
        <PillRow title="Source Types" items={sourceTypeDistribution} />
        <PillRow title="Authority" items={authorityDistribution} />
        <PillRow title="Linked Entities" items={linkEntityDistribution} />
      </div>
    </AnimatedCard>
  );
}
