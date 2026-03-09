/**
 * Animation Constants and Variants
 *
 * Centralized animation definitions for consistent motion design.
 * All animations respect prefers-reduced-motion.
 */

// Easing curves
export const easing = {
  smooth: [0.16, 1, 0.3, 1] as [number, number, number, number],
  spring: { type: 'spring' as const, stiffness: 300, damping: 30 },
  linear: { ease: 'linear' as const },
};

// Fade in from below
export const fadeInUp = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -20 },
};

// Fade in from right
export const fadeInRight = {
  initial: { opacity: 0, x: 20 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -20 },
};

// Scale in
export const scaleIn = {
  initial: { opacity: 0, scale: 0.95 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.95 },
};

// Stagger container
export const staggerContainer = {
  animate: {
    transition: {
      staggerChildren: 0.05,
    },
  },
};

// Stagger item
export const staggerItem = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
};

// Card hover
export const cardHover = {
  hover: {
    y: -4,
    transition: { duration: 0.2, ease: easing.smooth },
  },
};

// Duration presets
export const duration = {
  fast: 0.15,
  normal: 0.2,
  slow: 0.3,
  slower: 0.4,
};
