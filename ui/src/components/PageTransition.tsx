import type { ReactNode } from "react";

interface PageTransitionProps {
  children: ReactNode;
  className?: string;
}

/**
 * PageTransition - Lightweight route wrapper.
 */
export function PageTransition({ children, className }: PageTransitionProps) {
  return <div className={className}>{children}</div>;
}

/**
 * Stagger animation for list items
 */
export const staggerContainer = {
  animate: {},
};

export const staggerItem = {
  initial: {},
  animate: {},
};
