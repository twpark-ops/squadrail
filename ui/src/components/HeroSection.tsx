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
      className="space-y-6"
    >
      <div className="space-y-3">
        <h1 className="text-5xl md:text-6xl font-bold tracking-tight">
          {title}
        </h1>
        {subtitle && (
          <div className="text-lg md:text-xl text-muted-foreground">
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
