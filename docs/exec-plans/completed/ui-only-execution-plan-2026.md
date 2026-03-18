# UI-Only Execution Plan 2026

Date: 2026-03-10
Branch: `ui-rebuild-2026`
Worktree: `/home/taewoong/company-project/squadall-ui-rebuild-2026`
Status: UI-only implementation complete; later backend/read-model follow-up completed in `ui-review-desk-2026`

## Purpose

This document turns the UI rebuild backlog into an execution plan that can be implemented in the dedicated UI worktree without touching backend contracts unless explicitly approved later.

This plan is limited to `UI-only` work:

- no new backend routes
- no response-shape changes
- no `@squadrail/shared` type changes
- no `server/src/**` changes

Related inputs:

- `docs/ui-rebuild-backlog-2026.md`
- `docs/product-specs/ui-visual-rebuild-spec-v1.md`
- local Playwright and browser review captures generated during validation

## Current Baseline

Baseline checked in this worktree:

- `pnpm install`: complete
- `pnpm --filter @squadrail/ui build`: passes
- production build still emits a large main chunk around `2.58 MB`

Implications:

- the redesign can start immediately in this worktree
- route-level and feature-level code splitting should be part of the final phase

## Progress Log

- 2026-03-10: dedicated UI worktree created at `/home/taewoong/company-project/squadall-ui-rebuild-2026`
- 2026-03-10: backlog and screenshot inputs copied into this worktree
- 2026-03-10: `Phase 1` shell foundation implemented
- 2026-03-10: `pnpm --filter @squadrail/ui typecheck` passed
- 2026-03-10: `pnpm --filter @squadrail/ui build` passed
- 2026-03-10: `scripts/smoke/local-ui-flow.sh --port 3311` passed
- 2026-03-10: shell validation capture recorded locally for review
- 2026-03-10: `Phase 2` overview reset implemented
- 2026-03-10: `Phase 3` work queue redesign implemented
- 2026-03-10: `Phase 4` changes review workspace implemented
- 2026-03-10: `Phase 5` runs triage surface implemented
- 2026-03-10: `Phase 6` knowledge graph-read v1 implemented
- 2026-03-10: `Phase 7` team coverage polish implemented
- 2026-03-10: `Phase 8` route-level lazy loading and chunk strategy updated
- 2026-03-10: post-redesign `pnpm --filter @squadrail/ui typecheck` passed
- 2026-03-10: post-redesign `pnpm --filter @squadrail/ui build` passed
- 2026-03-10: refreshed desktop and mobile validation captures recorded locally
- 2026-03-10: remaining bundle risk isolated to a large async `mdx-editor` chunk, not the shell or top-level route pages

## Execution Rules

### Rule 1. Keep page meanings distinct

Each top-level route must answer one primary question:

- `Overview`: what needs attention now
- `Work`: what is moving and what is stuck
- `Changes`: what changed and can it be approved
- `Runs`: what is executing or failing right now
- `Knowledge`: what evidence exists and how it connects
- `Team`: who owns and covers the system

### Rule 2. Shell first

Do not redesign individual pages before the shell direction is stable.

### Rule 3. No silent backend creep

If a task needs:

- a new endpoint
- a new aggregate metric
- a new shared type
- a new server-side summary surface

then the task must be moved to the backend parking lot and removed from this execution plan.

### Rule 4. Verify every phase

Every implementation phase must end with:

- `pnpm --filter @squadrail/ui typecheck`
- `pnpm --filter @squadrail/ui build`
- desktop and mobile smoke review on the active UI worktree port

## Out Of Scope For This UI-Only Pass

These stay parked unless explicitly re-opened:

- shared contract redesign
- historical note:
  - company-scale knowledge graph endpoint and dashboard aggregate metrics were implemented later in `ui-review-desk-2026`

## Phase Overview

1. Phase 0: guardrails and baselines
2. Phase 1: shell foundation
3. Phase 2: overview reset
4. Phase 3: work redesign
5. Phase 4: changes redesign
6. Phase 5: runs redesign
7. Phase 6: knowledge v1 redesign
8. Phase 7: team polish
9. Phase 8: performance and rollout hardening

## Phase 0. Guardrails And Baselines

### Goal

Lock down the starting point so the redesign can move quickly without losing visual or technical orientation.

### Tasks

- keep the current backlog and local review inputs in this worktree
- preserve top-level before-state references during active review
- confirm the shell and all six top-level tabs render in the worktree environment
- keep a short running change log in this plan document or a sibling progress file

### Files

- `docs/ui-rebuild-backlog-2026.md`
- `docs/ui-only-execution-plan-2026.md`

### Exit Criteria

- worktree is ready
- baseline screenshots exist
- build passes

## Phase 1. Shell Foundation

Status: complete

### Goal

Make the product feel like one coherent light-first application before touching page internals.

### Primary Files

- `ui/src/index.css`
- `ui/src/components/Layout.tsx`
- `ui/src/components/CompanyRail.tsx`
- `ui/src/components/Sidebar.tsx`
- `ui/src/components/BreadcrumbBar.tsx`
- `ui/src/components/MobileBottomNav.tsx`
- `ui/src/components/ProductWordmark.tsx`

### Tasks

- unify rail, sidebar, top bar, and page shell into one visual system
- remove the dark-console feeling from `CompanyRail`
- reduce duplicated titling between top bar and page heroes
- simplify utility chrome in the sidebar
- make the six core routes the strongest navigation layer
- normalize spacing, borders, radii, and density at shell level
- ensure mobile navigation does not feel like a different product

### Design Output

- calmer company rail
- clearer sidebar hierarchy
- slim context bar instead of a second hero
- consistent page gutters and section spacing

### Verification

- open every top-level tab after shell changes
- confirm light mode feels coherent from rail to content
- check that page titles no longer repeat in the first screenful

### Exit Criteria

- shell is visually unified
- page chrome stops fighting page content
- the product no longer feels split between dark console and light cards

## Phase 2. Overview Reset

Status: complete

### Goal

Turn `Overview` into a mission-control page instead of a mixed telemetry board.

### Primary Files

- `ui/src/pages/DashboardOptimized.tsx`
- `ui/src/components/ActiveAgentsPanel.tsx`
- `ui/src/components/RecoveryDrilldownPanel.tsx`
- `ui/src/components/MetricCardV2.tsx`
- `ui/src/components/QueueCardV2.tsx`

### Tasks

- remove `Recovery Drill-down` from `Overview`
- keep only recovery signals and links into `Runs`
- replace the `Live Agents` card wall with a compact, scannable live activity strip or ranked list
- reduce metric-card redundancy
- prioritize urgency, flow state, and active movement
- make the page readable in the first three seconds

### Required Outcome

The user should immediately understand:

- what is urgent
- what is moving
- where to click next

### Verification

- confirm overview no longer contains recovery action controls
- confirm live activity is scannable without reading raw transcript fragments
- confirm the page answers mission-control questions before detailed exploration

### Exit Criteria

- `Overview` becomes a high-signal summary surface
- runtime actions are moved out

## Phase 3. Work Redesign

Status: complete

### Goal

Turn `Work` into the primary delivery queue surface.

### Primary Files

- `ui/src/pages/Issues.tsx`
- `ui/src/components/IssuesList.tsx`
- `ui/src/components/QueueCardV2.tsx`
- `ui/src/components/PageTabBar.tsx`
- optional new work-specific queue components

### Tasks

- make categories visible without opening filters
- keep the issue browser, but demote it below the queue framing
- promote opinionated categories:
  - executing now
  - needs review
  - blocked
  - waiting on human
  - ready to close
  - stale or unassigned
- simplify list toolbar chrome
- preserve search, grouping, sorting, and board mode
- improve selection rhythm and information density

### Required Outcome

The user should be able to answer:

- what is active
- what is blocked
- what is waiting for review

without exploring hidden controls.

### Verification

- validate the default screen without opening a popover
- confirm categories are visible on first load
- confirm advanced filters still work after the redesign

### Exit Criteria

- `Work` reads as an operating queue
- category discovery is immediate

## Phase 4. Changes Redesign

Status: complete

### Goal

Make `Changes` a real review and evidence workspace, not a second queue summary.

### Primary Files

- `ui/src/pages/Changes.tsx`
- `ui/src/pages/IssueDetail.tsx`
- `ui/src/components/MarkdownDiffView.tsx`
- `ui/src/api/issues.ts`
- optional new review-specific components

### Existing Data That Can Be Reused

Already available from current UI and backend surfaces:

- protocol state
- review cycle data
- protocol violations
- diff summary
- verification summary
- rollback plan
- merge status
- merge-candidate routes on the backend

### Tasks

- define a dedicated review layout
- separate queue entry from review evidence
- bring diff, verification, rollback, approval, and merge readiness into one view
- decide whether to build:
  - a dedicated `Changes` detail composition
  - or a specialized issue-detail review mode
- if needed, add new UI wrappers for existing merge-candidate endpoints without changing backend contracts

### Required Outcome

The user should understand why `Changes` exists separately from `Work`.

### Verification

- confirm the page centers on review evidence instead of queue duplication
- confirm a selected change can be evaluated without bouncing between tabs

### Exit Criteria

- `Changes` becomes the default review surface
- it no longer reads as a generic issue bucket page

## Phase 5. Runs Redesign

Status: complete

### Goal

Turn `Runs` into the runtime triage surface.

### Primary Files

- `ui/src/pages/Runs.tsx`
- `ui/src/components/LiveRunWidget.tsx`
- optional new runtime list, timeline, and recovery grouping components

### Existing Data That Can Be Reused

- live company runs
- recent runs
- run events
- run logs
- run cancel
- recovery queue
- recovery actions

### Tasks

- reduce wasted width
- create a clearer live runtime ribbon or active-run board
- group recovery items by severity or action family
- make next actions explicit
- make recent run history readable without long repetitive cards
- link cleanly into run detail and issue detail

### Required Outcome

The user should use `Runs` for runtime triage, not as a backup status page.

### Verification

- confirm recovery queue is scannable in batches
- confirm live and recent runtime states have different visual treatment
- confirm the page is useful even with low run counts

### Exit Criteria

- `Runs` becomes the operator surface for execution health

## Phase 6. Knowledge V1 Redesign

Status: complete

### Goal

Move `Knowledge` from document browser to exploration surface without requiring new backend contracts.

### Primary Files

- `ui/src/pages/Knowledge.tsx`
- `ui/src/components/knowledge/DocumentList.tsx`
- `ui/src/components/knowledge/DocumentDetailModal.tsx`
- `ui/src/components/knowledge/KnowledgeSignalPanel.tsx`
- optional new graph-read components

### Scope For This UI-Only Pass

Allowed:

- graph-like document and chunk exploration
- project-scoped relationship views
- evidence-oriented reading surfaces
- calmer stats and control hierarchy

Not allowed in this phase:

- any new conversational query workflow remains intentionally out of scope
- company-scale graph traversal endpoint work

### Tasks

- demote vanity stats
- make exploration the main interaction
- add graph-read panel or node-map using current chunk-link data
- keep document list as secondary navigation, not primary identity
- make evidence inspection feel intentional and visual

### Required Outcome

The user should feel that the app is helping explore knowledge structure, not just browse files.

### Verification

- confirm the page still works with current knowledge API only
- confirm the document list is no longer the dominant first impression

### Exit Criteria

- `Knowledge` gains a clear exploratory identity
- conversational ask mode remains intentionally excluded from this roadmap

## Phase 7. Team Polish

Status: complete

### Goal

Improve `Team` only after the workflow pages are stable.

### Primary Files

- `ui/src/pages/Team.tsx`
- optional new ownership and coverage components

### Tasks

- shift from generic metrics toward ownership and review coverage
- show missing role coverage or weak ownership zones
- preserve the page's current clarity while increasing usefulness

### Exit Criteria

- `Team` answers ownership questions better than today

## Phase 8. Performance And Rollout Hardening

Status: complete with follow-up bundle risk

### Goal

Finish the UI-only pass with acceptable build output and repeatable verification.

### Primary Files

- `ui/src/App.tsx`
- route-level page imports
- Vite config only if needed for chunk strategy
- optional lightweight screenshot or smoke tooling in UI scope

### Tasks

- introduce route-level lazy loading where appropriate
- reduce the large main chunk
- review heavy code paths and optional imports
- preserve build stability after all page redesign work
- refresh local before/after visual captures for all six tabs

### Verification

- `pnpm --filter @squadrail/ui typecheck`
- `pnpm --filter @squadrail/ui build`
- compare updated visual captures across top-level tabs

### Exit Criteria

- redesigned UI passes build and typecheck
- chunk size trend improves from the baseline
- visual review exists for desktop and mobile

### Result

- route-level lazy loading is in place across top-level pages
- the prior monolithic main page chunk has been split into route chunks
- current remaining warning is a large async `mdx-editor` bundle used by editor-heavy surfaces
- desktop and mobile visual captures were completed during review

## Suggested Commit Sequence

1. `docs(ui): add ui-only execution plan`
2. `feat(ui-shell): unify shell foundation`
3. `feat(ui-overview): reset overview as mission control`
4. `feat(ui-work): redesign delivery queue surface`
5. `feat(ui-changes): build review workspace`
6. `feat(ui-runs): build runtime triage surface`
7. `feat(ui-knowledge): add graph-read knowledge explorer`
8. `feat(ui-team): improve ownership and coverage surface`
9. `perf(ui): split routes and reduce main bundle`

## First Implementation Slice

Start with this exact order:

1. Phase 1 shell foundation
2. Phase 2 overview reset
3. Phase 3 work redesign

Do not start `Knowledge` before these three are stable.

## Parking Lot For Backend Coordination

Track these separately from this worktree:

- knowledge graph traversal endpoint
- new dashboard aggregate metrics not derivable client-side
- shared type changes for queue, runtime, or knowledge surfaces

## Definition Of Done For The UI-Only Pass

The UI-only pass is complete when all of the following are true:

- the shell feels like one product
- `Overview`, `Work`, `Changes`, `Runs`, `Knowledge`, and `Team` each have distinct meaning
- `Overview` no longer hosts recovery operations
- `Work` exposes categories by default
- `Changes` centers on evidence and approval
- `Runs` works as runtime triage
- `Knowledge` is more than a document list
- no backend contract changes were required
- build and typecheck pass
- updated screenshots exist for all top-level tabs
