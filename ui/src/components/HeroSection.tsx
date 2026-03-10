import { motion } from 'framer-motion';
import type { ReactNode } from 'react';

interface HeroSectionProps {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}

/**
 * HeroSection - Large, bold page header with smooth animation
 *
 * Linear-inspired hero section for page titles.
 * Features large typography (text-5xl/6xl) and generous spacing.
 */
export function HeroSection({ title, subtitle, actions }: HeroSectionProps) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="space-y-5"
    >
      <div className="space-y-2.5">
        <div className="text-[11px] font-semibold uppercase tracking-[0.34em] text-primary/84">
          Autonomous Delivery Workspace
        </div>
        <h1 className="text-4xl font-semibold tracking-[-0.06em] text-foreground md:text-[3.45rem]">
          {title}
        </h1>
        {subtitle && (
          <div className="max-w-4xl text-base leading-7 text-muted-foreground md:text-lg">
            {subtitle}
          </div>
        )}
      </div>
      {actions && (
        <div className="flex items-center gap-3">
          {actions}
        </div>
      )}
    </motion.section>
  );
}
