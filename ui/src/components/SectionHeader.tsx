import { motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  className?: string;
}

/**
 * SectionHeader - Section title with optional subtitle and action
 *
 * Consistent section headers with:
 * - Large text-2xl/3xl titles
 * - Optional subtitle in muted color
 * - Optional action button on the right
 */
export function SectionHeader({ title, subtitle, action, className }: SectionHeaderProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      className={cn('flex items-start justify-between gap-4', className)}
    >
      <div className="space-y-1">
        <h2 className="text-2xl md:text-3xl font-semibold tracking-tight">
          {title}
        </h2>
        {subtitle && (
          <p className="text-base text-muted-foreground">
            {subtitle}
          </p>
        )}
      </div>
      {action && (
        <div className="shrink-0">
          {action}
        </div>
      )}
    </motion.div>
  );
}
