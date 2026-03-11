# UI Rebuild Backlog 2026

Date: 2026-03-10
Author: Codex
Status: Draft backlog for the next dedicated UI worktree

## Goal

Rebuild the Squadrail UI into a clearer light-first operations workspace that feels contemporary in 2026, while fixing the deeper issue behind the current discomfort:

- the product shell is visually split
- page responsibilities are blurred
- the most important actions are not surfaced in the first screenful
- runtime and knowledge views do not match user intent

This backlog is based on:

- live inspection of `http://127.0.0.1:3103`
- local Playwright review captures generated during validation
- current UI routes and components in `ui/src`
- the intended direction in `docs/ui-visual-rebuild-spec-v1.md`

## Product Direction

The UI should behave like an editorial operations studio, not like a generic admin dashboard and not like a legacy dark console.

Working rules:

- light-first by default
- strong information hierarchy in the first 3 seconds
- each top-level tab must answer a different question
- runtime detail belongs in runtime surfaces, not overview surfaces
- knowledge must become an exploration surface, not a document dump
- "less raw telemetry, more actionable state"

## User Feedback Integrated Into The Backlog

The following feedback is treated as product requirements, not optional polish:

- `Live Agents` is too hard to read.
- `Recovery Drill-down` does not belong in `Overview`.
- `Work` is hard to parse and has no obvious categories at first glance.
- `Changes` is not self-explanatory as a tab.
- `Runs` is too wide and low-signal.
- `Recovery Queue` is too dense to be operational.
- `Knowledge` should not be a raw codebase browser; it needs graph-style exploration and stronger retrieval evidence surfaces.
- `Team` is comparatively acceptable and can be addressed later.

## Current State Summary

### 1. Shell mismatch

The shell still looks like two products:

- `CompanyRail` is hardcoded dark and visually detached from the rest of the app.
- `Sidebar` and page bodies are mostly light and card-based.
- `BreadcrumbBar` duplicates page identity that pages already repeat in the hero.

Impact:

- the product feels unstable before any content is read
- light mode does not feel intentional
- page hierarchy is harder to parse because shell noise competes with page content

### 2. Weak page semantics

Top-level tabs are not distinct enough:

- `Overview` mixes mission control, telemetry, and recovery action tools
- `Work` mixes dashboard summary, lanes, and a heavy issue browser
- `Changes` is a queue summary, not a review workspace
- `Runs` is a placeholder runtime page
- `Knowledge` is a searchable document list with stats

Impact:

- users do not know where to go for a specific decision
- information is repeated across tabs
- the product looks broader than it is, but actually feels less useful

### 3. Overuse of micro labels and pills

The UI relies too much on:

- uppercase micro labels
- mono pills
- thin outlines
- low-contrast surface differences

Impact:

- visual fatigue
- weak scan paths
- a "console" feel instead of a high-signal modern workspace

## Constraints And Data Readiness

### What can be improved immediately in the UI

- shell unification
- information hierarchy and copy
- `Overview`, `Work`, `Changes`, `Runs`, `Team` restructuring
- `Knowledge` graph-style read surface for document and chunk links
- runtime cards, timeline views, and condensed agent state presentation

### What likely needs backend support or API expansion

#### Knowledge conversational ask/chat

This is intentionally removed from the near-term roadmap.

Current exposed UI API supports:

- overview
- document list
- document chunks with links
- retrieval run hits by run id
- retrieval policy CRUD

That is sufficient for graph-read and evidence-oriented exploration. A user-driven conversational ask/chat surface would require a new backend query flow, but it is not required for the current product direction.

#### Knowledge graph at company scale

Current UI can render graph-like detail from document chunk links. A real cross-project graph explorer would be easier with a dedicated graph endpoint instead of building everything from per-document chunk fetches.

## Worktree Readiness

### Recommended branching rule

Preferred path after backend work finishes:

1. merge or stabilize the active backend branch first
2. update the primary branch used for integration
3. create the UI worktree from that updated integration branch

Recommended command flow:

```bash
git fetch origin
git switch master
git pull --ff-only
git worktree add -b ui-rebuild-2026 ../squadall-ui-rebuild-2026 master
cd ../squadall-ui-rebuild-2026
pnpm install
pnpm --filter @squadrail/ui dev -- --host 127.0.0.1 --port 3103
```

Use a backend branch as the UI worktree base only if the UI must consume backend changes that are not merged yet.

### Safe file scope for the UI worktree

These paths are safe to treat as UI-owned by default:

- `ui/src/**`
- `ui/package.json`
- `ui/index.html`
- `ui/public/**`
- `docs/ui-rebuild-backlog-2026.md`
- other UI-only docs under `docs/`

These paths are contract-sensitive and should stay untouched unless intentionally coordinated:

- `server/src/**`
- `packages/shared/**`
- `packages/db/**`
- root `package.json`

This path is shared-repo sensitive and should change only when necessary:

- `pnpm-lock.yaml`

### Commit hygiene for the future UI worktree

Rules:

- keep shell and page redesign commits separate from contract changes
- if a new UI library is needed, isolate the dependency change in its own commit
- if `packages/shared` or `server/src` must change, split that into a dedicated coordination commit or sibling branch
- if `pnpm-lock.yaml` changes because of a UI-only dependency, keep that change isolated and avoid mixing it with page redesign edits
- do not mix backend route changes into the shell/visual redesign commits

### When to stop calling the worktree "UI-only"

The UI worktree stops being UI-only when any of the following happens:

- a new API route is added
- an existing response shape changes
- a `@squadrail/shared` type changes
- the root lockfile changes because of a shared or server dependency change rather than a UI-only dependency

## UI / Backend Split

### A. UI-only backlog items

These can be completed in the UI worktree without requiring backend changes.

- shell foundation:
  - `CompanyRail`
  - `Sidebar`
  - `BreadcrumbBar`
  - layout spacing and density
- overview reset:
  - remove `Recovery Drill-down` from overview
  - replace `Live Agents` wall with a compact live summary
  - restructure hero, urgency, and flow sections
- work redesign:
  - lane-first information architecture
  - category framing on first load
  - issue list simplification
- runs redesign, first pass:
  - runtime board layout
  - grouped recovery presentation using existing recovery queue data
  - live run density and scannability improvements
- team polish:
  - role/ownership presentation
  - coverage layout and visual refinement
- knowledge redesign, first pass:
  - quieter stats
  - document-to-chunk relationship exploration
  - graph-like document detail using existing chunk links

### B. UI worktree can use existing backend endpoints, but needs new UI wiring only

These do not require backend implementation if the UI only needs to surface what already exists.

- `Changes` review workspace:
  - the backend already exposes issue protocol state and review-related data
  - diff, verification, rollback, merge-related information already exists in issue detail payloads and protocol messages
  - merge candidate endpoints already exist in `server/src/routes/issues.ts`
  - likely work needed is:
    - better UI composition
    - dedicated change review route mode
    - optional new `ui/src/api/issues.ts` wrappers for merge-candidate actions
- `Runs` operator detail view:
  - live runs
  - recent runs
  - run log polling
  - run event polling
  - run cancel
  - recovery queue actions
  are already exposed

This category should remain inside the UI worktree unless response shapes need to change.

### C. Backend or shared-contract changes required

These items should be tracked separately and should not silently slip into the UI worktree.

#### Knowledge graph at company scale

A real graph explorer across projects and entities is possible in a limited UI-first version, but a scalable company-wide graph explorer likely needs:

- graph traversal endpoint
- or aggregated node/edge endpoint

#### New summary metrics for overview/work/runs

If the redesigned pages need metrics that are not already derivable from:

- `/companies/:id/dashboard`
- `/companies/:id/dashboard/protocol-queue`
- `/companies/:id/dashboard/recovery-queue`
- `/companies/:id/live-runs`

then backend additions should be handled in a separate contract task.

#### Shared type changes

Any change to:

- queue bucket shape
- recovery item shape
- heartbeat run shape
- knowledge overview shape
- issue protocol surface shape

must be treated as shared-contract work and kept separate from purely visual redesign tasks.

## Suggested Ticket Split For The Future UI Worktree

### Track 1. Pure UI worktree tickets

Start with these tickets inside the dedicated UI worktree:

1. shell foundation
2. overview reset
3. work redesign
4. changes redesign using existing issue/protocol data
5. runs redesign using existing runtime endpoints
6. knowledge graph-read v1 using existing document and chunk-link data
7. team polish

### Track 2. Backend coordination tickets

Keep these outside the UI worktree until explicitly scheduled:

1. any response-shape or shared-type change required by the redesigned surfaces

Completed later in `ui-review-desk-2026`:

- company-wide graph endpoint for knowledge exploration
- dashboard attention / knowledge aggregate metrics
- runtime-state concurrency hardening for agent detail

### Track 3. Shared integration checklist before UI work starts

Before opening the UI worktree for implementation:

1. confirm the backend branch is merged or frozen
2. confirm whether the UI worktree should base on `master` or on a backend feature branch tip
3. confirm whether company-scale knowledge graph work is in scope for the next pass
4. freeze any planned shared type changes so the shell and page redesign can proceed without churn

## Priority Model

- `P0`: mandatory foundation work before the rest of the redesign
- `P1`: highest user-facing value, fixes the current navigation and comprehension failures
- `P2`: major surface redesigns that depend on P0 and P1
- `P3`: refinement, scale, and rollout safety

## Execution Order

1. Shell foundation
2. Overview reset
3. Work redesign
4. Changes redesign
5. Runs redesign
6. Knowledge redesign
7. Team polish
8. Performance, regression checks, and rollout hardening

This order is intentional:

- shell must land first so the rest of the product stops drifting
- `Overview`, `Work`, and `Changes` are the most confusing surfaces today
- `Knowledge` needs stronger concept work and partial API discussion
- `Team` already works better than the others

## Detailed Backlog

### P0. Shell Foundation And Design Authority

#### P0-1. Define one visual authority

Problem:

- `docs/ui-visual-rebuild-spec-v1.md` and `ui/DESIGN_SYSTEM.md` are still conceptually split
- current tokens moved toward light mode, but shell components still carry older console DNA

Tasks:

- declare `docs/ui-visual-rebuild-spec-v1.md` as the active visual authority
- mark `ui/DESIGN_SYSTEM.md` as deprecated or revise it to match the active direction
- normalize color, spacing, border, radius, and typography tokens in `ui/src/index.css`
- reduce reliance on uppercase micro-label styling as a primary hierarchy tool

Deliverables:

- token cleanup pass
- one short "active visual rules" section in docs
- no remaining dark-first shell assumptions

Acceptance criteria:

- shell components no longer use a separate dark visual language
- typography hierarchy is readable without relying on mono pills
- a new page can be built without choosing between conflicting systems

#### P0-2. Rebuild the company rail

Problem:

- `CompanyRail` currently feels like a separate dark app

Tasks:

- redesign the rail for light mode
- preserve company switching, drag reorder, live indicators, and unread indicators
- reduce heavy neon/console contrast
- make selection state clearer and calmer
- keep the rail visually premium, but not louder than the main page

Acceptance criteria:

- rail visually belongs to the same product as the rest of the layout
- company selection is obvious in 1 second
- live state can be understood without reading a tooltip

#### P0-3. Rebuild the sidebar

Problem:

- sidebar has too many decorative cards and not enough information hierarchy
- current company block, search, new issue, nav, docs, theme, settings all compete at the same level

Tasks:

- simplify the upper utility zone
- separate primary navigation from secondary operations more clearly
- make `Overview / Work / Changes / Runs / Knowledge / Team` the dominant mental model
- demote secondary areas like docs and settings
- keep command palette entry, but stop repeating it visually with the top bar

Acceptance criteria:

- first read of the sidebar clearly answers "where am I" and "what are the six core surfaces"
- utility actions no longer overpower navigation

#### P0-4. Rebuild the top context bar

Problem:

- `BreadcrumbBar` duplicates page identity
- the hero section then repeats it again

Tasks:

- turn the top bar into a slim context and actions strip
- remove redundant page titling
- keep company context, route ancestry when useful, and lightweight global actions
- mobile behavior should remain stable

Acceptance criteria:

- page title appears only once in the first screenful
- top bar acts as context, not a second hero

#### P0-5. Layout rhythm and responsive pass

Tasks:

- standardize hero spacing, card gutters, section spacing, and panel density
- reduce over-wide empty areas in large desktop layouts
- make mobile and tablet layout decisions explicit instead of letting cards wrap arbitrarily

Acceptance criteria:

- desktop pages do not feel sparse
- mobile pages preserve a clear top-to-bottom decision flow

### P1. Overview Reset

#### P1-1. Redefine Overview as mission control

Overview should answer:

- What needs attention now?
- What is moving?
- Where is the risk?

It should not be a place for deep recovery operations.

#### P1-2. Replace `Live Agents` card wall

Problem:

- current card-per-run layout is noisy and hard to scan
- raw transcript fragments are too prominent

Tasks:

- replace with a compact live activity strip or ranked activity list
- show only the most useful summaries:
  - agent
  - linked issue
  - current phase
  - latest meaningful event
  - runtime health state
- allow expansion into detail only on demand

Acceptance criteria:

- a user can tell "who is doing what" in under 3 seconds
- raw logs are not the default view

#### P1-3. Remove `Recovery Drill-down` from Overview

Tasks:

- remove the recovery action panel from `Overview`
- move operational recovery actions into `Runs`
- keep only a compact recovery signal summary on `Overview`

Acceptance criteria:

- `Overview` no longer includes note posting, item selection, or batch recovery actions
- recovery attention is visible, but recovery execution happens elsewhere

#### P1-4. Recompose overview sections

Recommended layout:

- top: mission header with company health summary
- row 1: urgent signals
- row 2: flow summary across work, review, and runtime
- row 3: live activity summary
- optional lower section: recent important changes or notable blockers

Remove or demote:

- repeated metric cards that do not drive an action
- redundant hero copy

### P1. Work Redesign

#### P1-5. Redefine `Work` as the delivery queue surface

Work should answer:

- What is active?
- What is blocked?
- What is waiting for review?
- What needs assignment or ownership correction?

Problem:

- current screen is part dashboard and part browser
- categories exist in filters, not in the default structure

Tasks:

- promote explicit categories to the default page structure
- keep the issue list, but make it downstream of the queue framing
- ensure first screen is lane-first, not filter-first

Recommended structure:

- top row: queue summary by delivery state
- main body: prioritized lanes or grouped queues
- right rail or lower panel: selected issue quick context
- deep search and advanced filters remain available, but not as the main story

Acceptance criteria:

- users can answer "where is work stuck" without opening filter popovers
- the page reads as an operational queue, not as a generic issue table

#### P1-6. Introduce opinionated default categories

Suggested default categories:

- executing now
- needs review
- blocked
- waiting on human
- ready to close
- unassigned or stale

Tasks:

- map these categories to existing issue and protocol state
- expose category switching or lane grouping directly in the page

Acceptance criteria:

- category framing is visible with no interaction
- users do not need to infer categories from status codes

#### P1-7. Simplify the issue browser

Tasks:

- keep list and board views, but give them a cleaner top bar
- make search, sort, and filters denser and calmer
- reduce control chrome
- improve selected row emphasis and list rhythm

### P1. Changes Redesign

#### P1-8. Redefine `Changes` as the review and evidence workspace

Changes should answer:

- What changed?
- Is it verified?
- Is it safe to merge or close?
- What evidence supports the decision?

Problem:

- the current tab is a queue summary, not a change-review experience
- the meaning overlaps with `Work`

Tasks:

- stop presenting `Changes` as another set of issue buckets
- make diff/evidence the center of gravity
- keep lanes only as entry points into review work

Recommended structure:

- top: review summary and risk counts
- main center: selected change review panel
- left: review queue
- right: evidence, verification, and close readiness

Core modules:

- diff summary
- file change grouping
- verification status
- approval state
- rollback or release note
- recent reviewer activity

Acceptance criteria:

- a first-time user understands why `Changes` exists separately from `Work`
- the tab is clearly about review decisions, not task progression

#### P1-9. Fix route semantics

Problem:

- `/changes/:issueId` currently resolves into the generic issue detail path model

Tasks:

- decide whether `Changes` gets a dedicated detail composition or a specialized issue-detail mode
- ensure the route itself communicates review mode clearly

Acceptance criteria:

- opening a change from `Changes` feels like entering a review workspace, not a detour back into `Work`

### P2. Runs Redesign

#### P2-1. Redefine `Runs` as runtime operations

Runs should answer:

- What is executing right now?
- What failed or stalled?
- What needs operator intervention?
- What happened recently in runtime terms?

Problem:

- the page is wide, sparse, and not yet operationally opinionated

Tasks:

- promote runtime status strips, timeline views, and grouped recovery queues
- move recovery actions here from `Overview`
- make run severity and operator next steps much more explicit

Recommended structure:

- top: live runtime ribbon
- left: active runs and queued runs
- center: selected run timeline or event feed
- right: grouped recovery actions
- lower section: recent incidents and recurring failure patterns

Acceptance criteria:

- `Runs` becomes the one place for runtime triage
- recovery queue items are grouped, not just stacked
- operator next action is visible on each item

#### P2-2. Rebuild recovery UI

Tasks:

- convert `Recovery Queue` from a plain stack into grouped incident buckets
- group by severity, failure family, or required action
- support quick action flows without overwhelming the user

Acceptance criteria:

- queue items are scannable in batches
- repeated failures collapse into a recognizable pattern

### P2. Knowledge Redesign

#### P2-3. Redefine `Knowledge` as an exploration surface

Knowledge should answer:

- What does the system know?
- How are documents and chunks connected?
- Which project area has relevant evidence?
- Can I ask a question and inspect the retrieval basis?

Problem:

- current surface is mostly stats plus a document list
- it feels like a file browser rather than a reasoning tool

#### P2-4. Add graph-first exploration

Tasks:

- add a graph or node-map surface for document/chunk/entity relationships
- allow project-scoped and company-scoped exploration
- let users pivot by project, source type, authority, and entity link

Immediate UI version that is possible now:

- document-centric graph preview using chunk links from `getDocumentChunks(..., { includeLinks: true })`
- relationship panel that shows why chunks are connected

Better version after backend support:

- dedicated graph endpoint for cross-document exploration

Acceptance criteria:

- the user can visually explore knowledge relationships without opening raw documents one by one

#### P2-5. Demote vanity stats

Tasks:

- move top stats into a quieter summary strip
- make exploration the dominant interaction
- reduce decorative badges and distribution pills

### P3. Team Polish

#### P3-1. Keep the current direction, but deepen operational meaning

Team is currently the least broken surface. It should be improved after the core workflow pages.

Tasks:

- shift from generic counts to ownership and coverage maps
- show role coverage against delivery stages
- show escalation paths and review capacity
- show which projects lack clear ownership

Acceptance criteria:

- `Team` helps answer staffing and ownership questions, not just org visibility

### P3. Cross-Cutting Improvements

#### P3-2. Copy system cleanup

Tasks:

- stop naming foundation or placeholder states directly in the UI
- reduce "console" phrasing
- use clearer verbs and shorter action-oriented labels

#### P3-3. Motion and interaction quality

Tasks:

- add a few intentional transitions for panel reveal and context shifts
- remove decorative motion that does not improve orientation

#### P3-4. Density tuning

Tasks:

- fewer large empty cards
- fewer stacked bordered boxes
- more intentional contrast between primary, secondary, and tertiary information

## Engineering Backlog For The UI Worktree

### Workstream A. Foundations

- align tokens and active design docs
- rebuild `CompanyRail`
- rebuild `Sidebar`
- rebuild `BreadcrumbBar`
- normalize page spacing primitives

### Workstream B. Core operations surfaces

- rebuild `Overview`
- rebuild `Work`
- rebuild `Changes`

### Workstream C. Runtime and knowledge

- rebuild `Runs`
- introduce `Knowledge` graph read surface

### Workstream D. Finishing pass

- polish `Team`
- bundle splitting and route-based lazy loading
- visual regression screenshots
- typecheck and build hardening

## Suggested Milestones

### Milestone 1. Shell and overview

Scope:

- P0 fully complete
- Overview reset complete

Expected result:

- the app immediately feels like one coherent product
- the first screen becomes easier to trust

### Milestone 2. Core workflow clarity

Scope:

- Work redesign
- Changes redesign

Expected result:

- users understand where to manage flow vs where to review changes

### Milestone 3. Runtime and knowledge identity

Scope:

- Runs redesign
- Knowledge graph read surface

Expected result:

- runtime and knowledge finally become differentiated product strengths

### Milestone 4. Polish and rollout safety

Scope:

- Team improvements
- performance work
- screenshot baselines
- regression checks

## Verification Checklist

Use this before merging the UI worktree:

- `Overview / Work / Changes / Runs / Knowledge / Team` each answer a distinct user question
- no duplicated page titling between top bar and hero
- no hardcoded dark shell leftovers in light mode
- `Live Agents` is scannable without reading raw logs
- `Recovery Drill-down` is no longer on `Overview`
- `Work` default layout exposes categories without opening filters
- `Changes` clearly presents review evidence
- `Runs` clearly presents runtime triage
- `Knowledge` is no longer only a document list
- desktop and mobile screenshots look intentional at every top-level tab

## Immediate Recommendation For The Next UI Worktree

Start with these tickets in order:

1. `P0-1` through `P0-5`
2. `P1-1` through `P1-4`
3. `P1-5` through `P1-9`
4. `P2-1` and `P2-2`
5. `P2-3` through `P2-6`
6. `P3-1` through `P3-4`

If time is limited, do not start with `Knowledge` first. The correct first win is shell plus `Overview / Work / Changes`.
