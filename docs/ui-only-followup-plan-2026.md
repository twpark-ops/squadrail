# UI-Only Follow-up Plan 2026

Date: 2026-03-11
Branch: `ui-only-followup-2026`
Worktree: `/home/taewoong/company-project/squadall-ui-only-followup-2026`
Status: UI-only structural and performance follow-up complete, optional polish largely closed

## Current Sprint

This pass is shipping in one UI-only stream:

- slim the left rail, workspace sidebar, and wordmark
- align priority support pages with the new support-panel system
- lift remaining detail and admin surfaces with clearer headers, metrics, and panel rhythm
- leave backend-dependent knowledge and aggregate work parked

## Current State

This worktree has already moved the product further from a generic dashboard and closer to a usable operator tool.

Implemented in this branch:

- denser left rail, workspace sidebar, and product mark
- rebuilt support-route language for `Approvals`, `Activity`, `Costs`, `Analytics`, `Org Chart`, `Agents`, `Projects`, and `Goals`
- upgraded detail/admin surfaces including `Inbox`, `AgentDetail`, `ProjectDetail`, `GoalDetail`, `ApprovalDetail`, `Companies`, and `CompanySettings`
- follow-up density pass on `Overview`, `Changes`, and `Knowledge`
- browser smoke and Playwright coverage for the updated support routes

Validated in this worktree:

- `pnpm --filter @squadrail/ui typecheck`
- `pnpm --filter @squadrail/ui build`
- `scripts/smoke/local-ui-flow.sh`
- Playwright review specs for interaction, support routes, and dark-mode readability

## Remaining UI-Only Risk

The remaining UI-only gap is no longer page structure. The remaining items are optional runtime polish:

- pointer-drag reorder automation is still a headless `dnd-kit` gap, even though stored-order persistence is now covered
- bundle size can still be shaved further, but the major eager-load regressions are already removed
- Playwright coverage exists locally and is sufficient for repeated manual verification

This means broad UI-only redesign work is effectively closed.

## Purpose

This plan covers the remaining UI-only work after the first major shell and core-route rebuild landed.

This worktree stays inside UI-only scope:

- no new backend routes
- no response-shape changes
- no `@squadrail/shared` contract changes
- no `server/src/**` implementation changes

## Current Focus

The first rebuild stabilized:

- shell
- `Overview`
- `Work`
- `Changes`
- `Runs`
- `Knowledge` graph-read v1
- `Team`

The remaining UI-only work is concentrated in:

- shell density follow-up for the left rail and workspace sidebar
- secondary routes that still look like foundation/admin pages
- dark-mode and responsive consistency outside the main six surfaces
- empty/loading/error state consistency
- follow-up bundle optimization and repeatable browser verification

## Route Buckets

### Bucket A. Priority support surfaces

These are the first pages to modernize because they are operationally relevant and visibly behind the new shell:

- `Agents`
- `Projects`
- `Goals`
- `Approvals`
- `Org Chart`
- `Activity`
- `Costs`
- `Analytics`

### Bucket B. Workflow support and detail surfaces

These remain UI-only, but they are larger and should follow after Bucket A patterns are stable:

- `Inbox`
- `AgentDetail`
- `ProjectDetail`
- `GoalDetail`
- `ApprovalDetail`

### Bucket C. Admin and setup surfaces

These should be modernized after the support routes are aligned:

- `CompanySettings`
- `Companies`
- `DesignGuide`

## Follow-up Rules

### Rule 1. Keep the new shell language

Secondary routes must inherit the light-first editorial operations style already established in the main six routes.

### Rule 2. Prefer shared patterns over one-off page inventions

When several support routes need the same visual rhythm, extract or reuse common UI patterns instead of adding custom chrome per page.

### Rule 3. Keep meaning explicit

Each support route should answer one operational question clearly:

- `Agents`: who is active, overloaded, paused, or unhealthy
- `Projects`: what scope is connected, active, drifting, or blocked
- `Goals`: what delivery intent exists above the queue
- `Approvals`: what decisions are waiting and why
- `Org Chart`: who owns which lane and who reports where
- `Activity`: what changed recently and who triggered it
- `Costs`: where spend is happening and whether utilization is safe
- `Analytics`: what is currently measurable vs still placeholder

### Rule 4. No placeholder theater

If a page is still mostly fake or static, either:

- clearly frame it as a limited current surface
- or reduce decorative chrome and make the available information more honest

## Execution Phases

### Phase 0. Baseline and plan lock

- create clean worktree from current `master`
- lock this plan document
- verify the existing UI rebuild baseline still builds

### Phase 1. Shared support-route patterns

- define common support-page rhythm for hero, metrics, filters, and primary panels
- normalize empty/error/loading treatment where still inconsistent
- make dark-mode-safe surface styling the default for support routes
- slim down the left rail, sidebar, and wordmark so the shell feels closer to a dense operating tool than a dashboard

### Phase 2. Priority support surfaces

- redesign `Approvals`, `Activity`, `Costs`, `Analytics`, and `Org Chart`
- bring `Agents`, `Projects`, and `Goals` up to the newer visual/system level

Status:

- `Approvals`, `Activity`, `Costs`, `Analytics`, and `Org Chart` implemented
- `Agents`, `Projects`, and `Goals` upgraded with the shared support-route language

### Phase 3. Support detail surfaces

- modernize `Inbox`
- modernize `AgentDetail`, `ProjectDetail`, `GoalDetail`, and `ApprovalDetail`
- reduce duplicated chrome and improve layout rhythm

Status:

- `Inbox`, `AgentDetail`, `ProjectDetail`, `GoalDetail`, and `ApprovalDetail` in active implementation in this worktree

### Phase 4. Admin and rollout hardening

- modernize `CompanySettings` and remaining admin surfaces that still feel legacy
- re-run dark-mode and responsive QA on support routes
- improve bundle behavior where support pages still pull too much code
- expand browser verification coverage

Status:

- `Companies` and `CompanySettings` moved into this pass
- verification expansion is part of the closeout for this branch

### Phase 5. Performance hardening and shell extraction

Status: complete

#### Goal

Reduce initial route cost without regressing the denser operator-tool shell.

#### Priority 1. Remove shell-level eager dependencies

- extract company reordering so `CompanyRail` does not pull `@dnd-kit/*` into the root shell by default
- keep the visual rail intact, but only load drag-and-drop when reordering is actually invoked
- verify that `Overview` first load no longer fetches `dnd-kit` unless reorder mode is active

#### Priority 2. Isolate editor runtime from first load

- keep `MarkdownEditor` fully behind lazy boundaries
- investigate Vite helper placement so the root entry stops importing the `mdx-editor` runtime on `Overview`
- if needed, split editor entry concerns more aggressively rather than allowing the root shell to own editor preload helpers

#### Priority 3. Reduce motion cost on primary routes

- audit `HeroSection` and shell-level animation usage
- replace non-essential `framer-motion` usage with static or CSS-driven transitions where it does not add operational value
- keep motion only where it improves hierarchy, not where it simply decorates

#### Priority 4. Lock QA into repeatable rollout checks

- keep the current local smoke and Playwright specs green
- prepare the specs to become CI gates in the next merge wave

#### Exit Criteria

- first-load shell no longer pulls drag-and-drop dependencies by default
- editor runtime is either removed from `Overview` first load or clearly isolated as remaining bundler debt
- the product still preserves the denser operator-tool reading pattern
- verification remains repeatable after the perf changes

Delivered in this worktree:

- `CompanyRail` reorder extracted behind a lazy mode toggle
- root entry no longer statically imports `mdx-editor` or `dnd-kit`
- `HeroSection` no longer pulls shell-level `framer-motion`
- reorder mode added to Playwright interaction coverage
- two-company smoke seeding added for stored-order persistence validation
- root bundle now builds without static `framer-motion` references or a separate motion chunk

## Out Of Scope

These remain parked for backend or shared-contract coordination:

- `Knowledge` ask/chat
- company-scale graph traversal endpoint
- new overview/work/runs aggregate metrics not derivable client-side
- shared type changes for runtime, queue, or knowledge surfaces

## Verification

Every implementation slice should finish with:

- `pnpm --filter @squadrail/ui typecheck`
- `pnpm --filter @squadrail/ui build`
- browser review of affected support routes

## Target Outcome

This follow-up pass is complete when:

- secondary routes no longer feel visually older than the main six routes
- support pages have clear operational meaning
- dark mode and mobile behavior are consistent outside the main routes
- support-route QA is repeatable
- remaining UI-only risk is mostly limited to optional polish, not structural gaps

Optional next pass:

- deeper drag persistence verification
- additional bundle shaving if product load budget becomes a priority
