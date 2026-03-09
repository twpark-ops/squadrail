# Squadrail Design System

AI Squads on Rails - 독자적인 브랜드 정체성을 가진 디자인 시스템입니다.

## Brand Identity

### Vision
"AI Squads on Rails" - AI 에이전트들이 레일 위를 달리듯 효율적으로 협업하는 플랫폼.

### Color Philosophy
**Tech Startup Modern** aesthetic with high-energy, future-focused palette.

**Primary: Lime (#84CC16)**
- Energy, growth, forward motion
- "Go" signal for execution
- Differentiates from typical blue/purple SaaS

**Secondary: Cyan (#06B6D4)**
- Technology, clarity, precision
- AI/ML platform aesthetic
- Clean, modern contrast

**Supporting Colors:**
- Orange (#F97316): Attention, review needed
- Green (#22C55E): Success, completion
- Red (#EF4444): Critical, blocked
- Pink (#EC4899): Highlights, special states

### Dark Mode First
Squadrail is optimized for dark mode (true black `#000000` background), reflecting modern developer tools and AI platforms.

## Design Principles

### 1. "Who's doing what" in 3 seconds
- Agent 상태는 최상단에 배치
- 실시간 활동은 pulse animation으로 표시
- 중요 정보만 큼, 상세는 클릭 시 표시

### 2. Visual Hierarchy
```
Hero: 60px (text-5xl/6xl)
Section Title: 24px (text-2xl)
Card Title: 18px (text-base)
Body: 14px (text-sm)
Meta: 12px (text-xs)
```

### 3. Generous Spacing
```
Section gap: 40px (space-y-10)
Card gap: 24px (gap-6)
Content padding: 24px (p-6)
Compact padding: 16px (p-4)
```

## Color Strategy

### Brand Colors
```typescript
const brandColors = {
  // Primary palette
  primary: {
    light: "#84CC16",  // Lime-500
    dark: "#A3E635",   // Lime-400 (brighter for dark mode)
  },
  secondary: {
    light: "#06B6D4",  // Cyan-500
    dark: "#22D3EE",   // Cyan-400
  },

  // Background
  background: {
    light: "#FCFCFC",  // Near-white
    dark: "#1A1A1A",   // Near-black (not pure black for better UX)
  },
};
```

### Status Colors (Workflow States)
```typescript
const statusColors = {
  backlog: "slate-400",     // #94A3B8 - Neutral, waiting
  implementing: "cyan-500", // #06B6D4 - Active work
  reviewing: "orange-500",  // #F97316 - Attention needed
  approved: "lime-500",     // #84CC16 - Success (brand color!)
  blocked: "red-500",       // #EF4444 - Critical issue
  idle: "gray-400",         // #9CA3AF - Inactive
};
```

### Priority Colors
```typescript
const priorityColors = {
  critical: "red-500",    // #EF4444
  high: "orange-500",     // #F97316
  medium: "cyan-500",     // #06B6D4
  low: "slate-500",       // #64748B
};
```

### Semantic Usage
- **Lime**: Success, approved, primary actions (BRAND)
- **Cyan**: Active work, technology, information (BRAND)
- **Orange**: Review needed, warnings, high priority
- **Red**: Errors, critical, blocked
- **Green**: Completed tasks, success states
- **Pink**: Special highlights, featured items
- **Gray/Slate**: Idle, inactive, low priority

## Component Patterns

### MetricCardV2
```tsx
<MetricCardV2
  icon={CircleDot}
  value={42}
  label="Execution Queue"
  description="12 in progress"
  to="/issues"
/>
```

**Design:**
- 48px value (text-3xl/4xl)
- 14px label, uppercase
- Icon top-right, 20px
- Hover: elevation + shadow

### QueueCardV2
```tsx
<QueueCardV2
  title="Execution Queue"
  subtitle="Active engineering work"
  items={items}
  variant="execution"
  icon={CircleDot}
/>
```

**Design:**
- Left border: 4px colored bar
- Header: icon + title + count badge
- Preview: 5 items max
- Footer: "View all X issues" link

### ActiveAgentsPanel
```tsx
<ActiveAgentsPanel companyId={companyId} />
```

**Design:**
- 4-column grid on desktop
- Real-time WebSocket streaming
- Pulse animation for active agents
- Scrollable feed (max 200px height)

### AgentCardEnhanced
```tsx
<AgentCardEnhanced
  agent={agent}
  currentTask={task}
  isActive={true}
  position={{ x: 0, y: 0 }}
/>
```

**Design:**
- 48px avatar
- Current task display when active
- Gradient header for active state
- Subtle shadow + border glow

## Layout Patterns

### Dashboard Structure
```
1. Hero (60px title)
2. Key Metrics (4 cards, generous spacing)
3. Live Agents (promoted position)
4. Protocol Queues (2-column grid)
5. Recovery (collapsible)
6. Recent Activity (compact)
```

### Issue Detail Structure
```
Left (25%):
  - Brief
  - Evidence
  - Related Issues

Center (50%):
  - Description
  - Protocol Timeline
  - Comments

Right (25%):
  - Properties
  - Quick Actions
```

### OrgChart Structure
```
- Pan & Zoom canvas
- Enhanced agent cards (240x140px)
- Hierarchical tree layout
- Real-time status overlay
```

## Responsive Breakpoints

```css
sm: 640px   /* 2-column metrics */
md: 768px   /* 2-column queues */
lg: 1024px  /* 3-column issue detail */
xl: 1280px  /* 4-column metrics */
```

## Animation Guidelines

### Use sparingly
- Pulse: Only for active/live status
- Fade in: Page transitions (400ms)
- Slide in: New feed items (300ms)
- Hover: Elevation (200ms)

### DO NOT use
- Excessive spinning
- Bouncing
- Auto-playing videos
- Confetti (unless explicitly requested)

## Accessibility

### WCAG 2.1 AA Compliance
- Color contrast ratio: 4.5:1 minimum
- Keyboard navigation: full support
- Screen reader: semantic HTML + ARIA labels
- Focus indicators: visible outline

### Focus Management
```tsx
// Good
<button className="focus:ring-2 focus:ring-primary">
  Action
</button>

// Bad
<div onClick={handler}>Action</div>
```

## Performance

### Core Web Vitals Targets
- LCP: < 2.5s
- FID: < 100ms
- CLS: < 0.1

### Optimization Strategies
- Lazy load charts and heavy components
- Virtualize long lists (100+ items)
- Debounce real-time updates (15s interval)
- Memoize expensive computations

## File Organization

```
ui/src/
├── components/
│   ├── MetricCardV2.tsx       # Metric display
│   ├── QueueCardV2.tsx        # Queue preview
│   ├── ActiveAgentsPanel.tsx  # Live agent feed
│   ├── AgentCardEnhanced.tsx  # Org chart card
│   ├── IssueDetailLayout.tsx  # 3-column layout
│   └── ui/                    # shadcn/ui primitives
├── pages/
│   ├── DashboardOptimized.tsx # Main dashboard
│   ├── OrgChart.tsx           # Agent hierarchy
│   └── IssueDetail.tsx        # Issue view
└── lib/
    └── utils.ts               # cn(), timeAgo(), etc.
```

## Best Practices

### DO
- Use design tokens (border-border, bg-card)
- Compose with existing components
- Test on mobile first
- Provide loading states
- Handle empty states gracefully

### DON'T
- Create one-off components
- Hard-code colors or spacing
- Nest grids more than 2 levels
- Use `any` type in TypeScript
- Skip error boundaries

## Implementation Checklist

When adding a new feature:

- [ ] Mobile responsive (test on 375px viewport)
- [ ] Dark mode support (test both themes)
- [ ] Loading skeleton (PageSkeleton or custom)
- [ ] Empty state (EmptyState component)
- [ ] Error boundary (try/catch + fallback UI)
- [ ] Keyboard navigation (tab order, shortcuts)
- [ ] ARIA labels (screen reader friendly)
- [ ] Performance tested (React DevTools Profiler)

## Resources

- **Figma**: [Design File Link]
- **Storybook**: `pnpm storybook` (if available)
- **Design Guide**: `/design-guide` route in app
- **shadcn/ui docs**: https://ui.shadcn.com

## Changelog

### 2026-03-09
- Created design system documentation
- Added DashboardOptimized component
- Added AgentCardEnhanced for OrgChart
- Added IssueDetailLayout pattern
- Defined color strategy and spacing scale
