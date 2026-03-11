import type { ReactNode } from "react";

interface HeroSectionProps {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
}

export function HeroSection({
  title,
  subtitle,
  actions,
  eyebrow,
}: HeroSectionProps) {
  return (
    <section className="rounded-[1.55rem] border border-border/85 bg-[linear-gradient(180deg,color-mix(in_oklab,var(--card)_90%,var(--background)),color-mix(in_oklab,var(--accent)_10%,var(--card)))] px-5 py-5 shadow-card dark:bg-[linear-gradient(180deg,color-mix(in_oklab,var(--card)_95%,var(--background)),color-mix(in_oklab,var(--card)_90%,var(--accent)))] md:px-6 md:py-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0 space-y-2.5">
          {eyebrow && (
            <div className="text-[10px] font-semibold tracking-[0.12em] text-muted-foreground">
              {eyebrow}
            </div>
          )}
          <h1 className="text-[2.25rem] font-semibold tracking-[-0.055em] text-foreground md:text-[2.7rem]">
            {title}
          </h1>
          {subtitle && (
            <div className="max-w-3xl text-sm leading-6 text-muted-foreground md:text-[0.98rem]">
              {subtitle}
            </div>
          )}
        </div>
        {actions && (
          <div className="flex flex-wrap items-center gap-2.5 lg:justify-end">
            {actions}
          </div>
        )}
      </div>
    </section>
  );
}
