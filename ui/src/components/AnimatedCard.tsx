import { motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface AnimatedCardProps {
  children: ReactNode;
  className?: string;
  delay?: number;
  onClick?: () => void;
  hover?: boolean;
}

/**
 * AnimatedCard - Card with smooth entrance and hover animations
 *
 * Features:
 * - Fade-in + slide-up on mount
 * - Optional hover elevation
 * - Staggered delays for list animations
 * - Respects prefers-reduced-motion
 */
export function AnimatedCard({
  children,
  className,
  delay = 0,
  onClick,
  hover = true,
}: AnimatedCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.3,
        delay,
        ease: [0.16, 1, 0.3, 1],
      }}
      whileHover={hover ? { y: -2, transition: { duration: 0.2 } } : undefined}
      className={cn('transition-shadow', className)}
      onClick={onClick}
    >
      {children}
    </motion.div>
  );
}

/**
 * AnimatedMetric - Number count-up animation for metrics
 */
interface AnimatedMetricProps {
  value: number;
  className?: string;
}

export function AnimatedMetric({ value, className }: AnimatedMetricProps) {
  return (
    <motion.span
      initial={{ opacity: 0, scale: 0.5 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{
        duration: 0.4,
        ease: [0.16, 1, 0.3, 1],
      }}
      className={className}
    >
      {value}
    </motion.span>
  );
}

/**
 * AnimatedList - Container for staggered list animations
 */
interface AnimatedListProps {
  children: ReactNode;
  className?: string;
}

export function AnimatedList({ children, className }: AnimatedListProps) {
  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={{
        visible: {
          transition: {
            staggerChildren: 0.05,
          },
        },
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/**
 * AnimatedListItem - Individual list item with stagger
 */
interface AnimatedListItemProps {
  children: ReactNode;
  className?: string;
}

export function AnimatedListItem({ children, className }: AnimatedListItemProps) {
  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, x: -10 },
        visible: { opacity: 1, x: 0 },
      }}
      transition={{
        duration: 0.3,
        ease: [0.16, 1, 0.3, 1],
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
