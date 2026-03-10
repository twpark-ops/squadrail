import { motion } from 'framer-motion';
import type { ReactNode } from 'react';

interface HeroSectionProps {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
}

/**
 * HeroSection - Large, bold page header with smooth animation
 *
 * Linear-inspired hero section for page titles.
 * Features large typography (text-5xl/6xl) and generous spacing.
 */
export function HeroSection({ title, subtitle, actions, eyebrow }: HeroSectionProps) {
  return (
    <motion.section
      initial={false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="rounded-[1.8rem] border border-border/85 bg-[linear-gradient(180deg,color-mix(in_oklab,var(--card)_86%,var(--background)),color-mix(in_oklab,var(--accent)_14%,var(--card)))] px-6 py-6 shadow-card dark:bg-[linear-gradient(180deg,color-mix(in_oklab,var(--card)_94%,var(--background)),color-mix(in_oklab,var(--card)_88%,var(--accent)))] md:px-7"
    >
      <div className="space-y-3">
        {eyebrow && (
          <div className="text-[11px] font-medium tracking-[0.1em] text-muted-foreground">
            {eyebrow}
          </div>
        )}
        <h1 className="text-3xl font-semibold tracking-[-0.055em] text-foreground md:text-[3rem]">
          {title}
        </h1>
        {subtitle && (
          <div className="max-w-4xl text-[0.98rem] leading-7 text-muted-foreground md:text-[1.05rem]">
            {subtitle}
          </div>
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-3">
          {actions}
        </div>
      )}
    </motion.section>
  );
}
