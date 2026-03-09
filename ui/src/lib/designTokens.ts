/**
 * Design System Tokens
 *
 * Central source of truth for typography, spacing, colors, and other design constants.
 * Following Linear/Notion design principles with enhanced readability and hierarchy.
 */

// Typography Scale
export const typography = {
  // Display - Page titles
  display: {
    fontSize: '2rem', // 32px
    lineHeight: '2.5rem', // 40px
    fontWeight: '700',
    letterSpacing: '-0.02em',
  },

  // Heading 1 - Section titles
  h1: {
    fontSize: '1.5rem', // 24px
    lineHeight: '2rem', // 32px
    fontWeight: '600',
    letterSpacing: '-0.01em',
  },

  // Heading 2 - Card titles, subsections
  h2: {
    fontSize: '1.25rem', // 20px
    lineHeight: '1.75rem', // 28px
    fontWeight: '600',
  },

  // Heading 3 - Labels, small headers
  h3: {
    fontSize: '0.875rem', // 14px
    lineHeight: '1.25rem', // 20px
    fontWeight: '600',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
  },

  // Body - Default text
  body: {
    fontSize: '0.875rem', // 14px
    lineHeight: '1.5rem', // 24px (improved from 1.5)
    fontWeight: '400',
  },

  // Small - Captions, timestamps
  small: {
    fontSize: '0.75rem', // 12px
    lineHeight: '1rem', // 16px
    fontWeight: '400',
  },
} as const;

// Spacing Scale
export const spacing = {
  xs: '0.5rem', // 8px
  sm: '0.75rem', // 12px
  md: '1rem', // 16px
  lg: '1.5rem', // 24px
  xl: '2rem', // 32px
  '2xl': '3rem', // 48px
  '3xl': '4rem', // 64px
} as const;

// Card Padding Variants
export const cardPadding = {
  compact: spacing.md, // 16px
  default: spacing.lg, // 24px
  spacious: spacing.xl, // 32px
} as const;

// Status Colors (extends Tailwind color system)
export const statusColors = {
  // Workflow states
  backlog: {
    light: 'oklch(0.75 0.05 240)',
    dark: 'oklch(0.45 0.08 240)',
    border: 'oklch(0.65 0.10 240)',
  },
  implementing: {
    light: 'oklch(0.7 0.15 250)',
    dark: 'oklch(0.55 0.18 250)',
    border: 'oklch(0.60 0.16 250)',
  },
  reviewing: {
    light: 'oklch(0.75 0.12 60)',
    dark: 'oklch(0.65 0.14 60)',
    border: 'oklch(0.70 0.13 60)',
  },
  approved: {
    light: 'oklch(0.7 0.15 145)',
    dark: 'oklch(0.6 0.18 145)',
    border: 'oklch(0.65 0.16 145)',
  },
  blocked: {
    light: 'oklch(0.65 0.18 25)',
    dark: 'oklch(0.55 0.20 25)',
    border: 'oklch(0.60 0.19 25)',
  },
  awaiting_human_decision: {
    light: 'oklch(0.75 0.12 60)',
    dark: 'oklch(0.65 0.14 60)',
    border: 'oklch(0.70 0.13 60)',
  },
  idle: {
    light: 'oklch(0.80 0.02 240)',
    dark: 'oklch(0.50 0.04 240)',
    border: 'oklch(0.65 0.03 240)',
  },
} as const;

// Priority Colors
export const priorityColors = {
  critical: {
    color: 'oklch(0.55 0.22 25)', // red
    bg: 'oklch(0.97 0.05 25)',
    bgDark: 'oklch(0.25 0.10 25)',
  },
  high: {
    color: 'oklch(0.65 0.18 40)', // orange
    bg: 'oklch(0.97 0.04 40)',
    bgDark: 'oklch(0.25 0.09 40)',
  },
  medium: {
    color: 'oklch(0.70 0.12 60)', // yellow
    bg: 'oklch(0.97 0.03 60)',
    bgDark: 'oklch(0.25 0.06 60)',
  },
  low: {
    color: 'oklch(0.70 0.08 200)', // blue-gray
    bg: 'oklch(0.97 0.02 200)',
    bgDark: 'oklch(0.25 0.04 200)',
  },
} as const;

// Elevation (Shadow) Tokens
export const elevation = {
  none: '0 0 0 0 transparent',
  sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
  md: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
  lg: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
  xl: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
} as const;

// Dark mode elevation adjustments
export const elevationDark = {
  none: '0 0 0 0 transparent',
  sm: '0 1px 3px 0 rgb(0 0 0 / 0.3)',
  md: '0 4px 6px -1px rgb(0 0 0 / 0.4), 0 2px 4px -2px rgb(0 0 0 / 0.3)',
  lg: '0 10px 15px -3px rgb(0 0 0 / 0.4), 0 4px 6px -4px rgb(0 0 0 / 0.3)',
  xl: '0 20px 25px -5px rgb(0 0 0 / 0.4), 0 8px 10px -6px rgb(0 0 0 / 0.3)',
} as const;

// Border Radius
export const radius = {
  sm: '0.375rem', // 6px
  md: '0.5rem', // 8px
  lg: '0.75rem', // 12px
  xl: '1rem', // 16px
  full: '9999px',
} as const;

// Breakpoints (matching Tailwind defaults)
export const breakpoints = {
  sm: '640px',
  md: '768px',
  lg: '1024px',
  xl: '1280px',
  '2xl': '1536px',
} as const;

// Animation Durations
export const duration = {
  fast: '150ms',
  normal: '200ms',
  slow: '300ms',
} as const;

// Animation Easings
export const easing = {
  default: 'cubic-bezier(0.16, 1, 0.3, 1)',
  linear: 'linear',
  in: 'cubic-bezier(0.4, 0, 1, 1)',
  out: 'cubic-bezier(0, 0, 0.2, 1)',
  inOut: 'cubic-bezier(0.4, 0, 0.2, 1)',
} as const;

// Component-specific tokens
export const components = {
  card: {
    padding: cardPadding.default,
    borderRadius: radius.xl,
    shadow: elevation.sm,
    shadowHover: elevation.md,
  },
  button: {
    paddingX: spacing.lg,
    paddingY: spacing.sm,
    borderRadius: radius.md,
  },
  input: {
    paddingX: spacing.md,
    paddingY: spacing.sm,
    borderRadius: radius.md,
    minHeight: '2.5rem', // 40px
  },
  avatar: {
    sm: '2rem', // 32px
    md: '2.5rem', // 40px
    lg: '3rem', // 48px
    xl: '4rem', // 64px
  },
} as const;

// Helper function to get workflow state color
export function getWorkflowStateColor(
  state: string,
  variant: 'light' | 'dark' | 'border' = 'light'
): string {
  const normalizedState = state as keyof typeof statusColors;
  return statusColors[normalizedState]?.[variant] ?? statusColors.idle[variant];
}

// Helper function to get priority color
export function getPriorityColor(
  priority: string,
  variant: 'color' | 'bg' | 'bgDark' = 'color'
): string {
  const normalizedPriority = priority.toLowerCase() as keyof typeof priorityColors;
  return priorityColors[normalizedPriority]?.[variant] ?? priorityColors.low[variant];
}
