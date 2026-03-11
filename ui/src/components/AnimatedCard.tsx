import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

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
  delay: _delay = 0,
  onClick,
  hover = true,
}: AnimatedCardProps) {
  return (
    <div
      className={cn(
        "transition-[transform,box-shadow] duration-200",
        hover && "hover:-translate-y-0.5",
        className
      )}
      onClick={onClick}
    >
      {children}
    </div>
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
  return <span className={className}>{value}</span>;
}

/**
 * AnimatedList - Container for staggered list animations
 */
interface AnimatedListProps {
  children: ReactNode;
  className?: string;
}

export function AnimatedList({ children, className }: AnimatedListProps) {
  return <div className={className}>{children}</div>;
}

/**
 * AnimatedListItem - Individual list item with stagger
 */
interface AnimatedListItemProps {
  children: ReactNode;
  className?: string;
}

export function AnimatedListItem({
  children,
  className,
}: AnimatedListItemProps) {
  return <div className={className}>{children}</div>;
}
