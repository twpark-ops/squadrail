import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

interface SupportMetricCardProps {
  icon: LucideIcon;
  label: string;
  value: string | number;
  detail?: string;
  tone?: "default" | "accent" | "warning";
  className?: string;
}

const toneClasses: Record<NonNullable<SupportMetricCardProps["tone"]>, string> = {
  default:
    "border-border bg-[linear-gradient(180deg,color-mix(in_oklab,var(--card)_92%,var(--background)),color-mix(in_oklab,var(--card)_88%,var(--accent)))]",
  accent:
    "border-primary/18 bg-[linear-gradient(180deg,color-mix(in_oklab,var(--card)_82%,var(--background)),color-mix(in_oklab,var(--primary)_14%,var(--card)))]",
  warning: "border-amber-400/30 bg-amber-50/70 dark:bg-amber-950/20",
};

export function SupportMetricCard({
  icon: Icon,
  label,
  value,
  detail,
  tone = "default",
  className,
}: SupportMetricCardProps) {
  return (
    <article
      className={cn(
        "rounded-[1.45rem] border px-5 py-5 shadow-card",
        toneClasses[tone],
        className,
      )}
    >
      <div className="flex items-center gap-2 text-[11px] font-medium tracking-[0.14em] text-muted-foreground">
        <span className="flex h-7 w-7 items-center justify-center rounded-full border border-border/70 bg-background/70">
          <Icon className="h-3.5 w-3.5" />
        </span>
        <span>{label}</span>
      </div>
      <div className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-foreground">{value}</div>
      {detail ? <p className="mt-2 text-sm leading-6 text-muted-foreground">{detail}</p> : null}
    </article>
  );
}
