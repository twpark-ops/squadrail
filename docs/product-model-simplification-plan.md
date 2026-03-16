# Product Model Simplification Plan

Status: design review (rev 2 — incorporating review feedback)
Author: Taewoong Park
Date: 2026-03-15
Branch: feat/product-model-simplify

## Problem Statement

The current product surface does not match the intended user experience.
Users should see one issue card with visible subtasks, but the system produces hidden children, cancelled coordination roots, and engineer double-runs that are invisible or confusing.

This document defines the changes needed to align the implementation with the product north star.

## Product North Star

> Users submit one issue card. The system decomposes it into visible subtasks when needed,
> asks only the missing questions, and routes work through a defined protocol.
> Small issues finish fast. Complex issues get the full workflow.

## Current vs Target Model

### 1. Issue Visibility

| Aspect | Current | Target |
|--------|---------|--------|
| Child issues | Hidden (`hiddenAt` timestamp) | **Visible subtasks** (done: parentId model) |
| Coordination root | Cancelled or stays assigned | **Parent stays open, shows progress** (done: parentId-based) |
| List views | Filter out `hiddenAt IS NOT NULL` | **Phase 1: root-only default** (done), `?parentId=` and `?includeSubtasks=true` supported. **Phase 2: indent subtasks in UI** (planned) |
| Progress | Not aggregated | **Parent shows subtask completion ratio** (planned) |

### 2. Execution Flow

| Aspect | Current | Target |
|--------|---------|--------|
| Engineer runs | 2 runs (protocol gate + implementation) | **1 run (ACK -> START -> implement)** |
| Run creation | `forceFollowupRun: true` defers second run | **Single continuous run** |
| Protocol messages | ACK_ASSIGNMENT and START_IMPLEMENTATION as separate dispatches | **ACK + START in one execution context** |

### 3. Issue Routing

| Aspect | Current | Target |
|--------|---------|--------|
| All issues | Full workflow (assign -> ack -> implement -> review -> qa -> close) | **Fast lane or full lane based on complexity** |
| Small bug fix | Same as complex feature | **Fast lane: implement -> lightweight review -> close** |
| Complex feature | Full workflow | **Full lane: clarification -> decompose -> implement -> review -> QA -> close** |

### 4. Role Separation

| Aspect | Current | Target |
|--------|---------|--------|
| Reviewer | Sometimes QA Lead in reviewer slot | **TL/Reviewer = code quality, design, diff** |
| QA | Sometimes does code review | **QA = release gate, acceptance criteria** |
| Assignment | E2E fixtures mix roles | **Blueprint defines role boundaries** |

---

## Change 1: Role Separation (Phase 1)

### Why first

Smallest scope, immediately reduces confusion in all subsequent work.
Fixture-only cleanup is insufficient — the staffing pipeline itself must enforce role boundaries.

### What changes

#### 1a. Fixtures and blueprints (surface)

- E2E fixtures: ensure QA never appears in reviewer slot
- Blueprint definitions: add explicit `slotConstraint` metadata

#### 1b. Staffing pipeline (root cause)

**`server/src/services/pm-intake.ts` — reviewer candidate policy**

Current reviewer selection is generic — any agent with reviewer-like title can land in the reviewer slot.
QA agents can be selected as reviewers because the candidate filter does not enforce slot exclusivity.

Fix:
- Add `slotConstraint: "reviewer_only" | "qa_only"` to agent role metadata in blueprints
- `pm-intake.ts` reviewer candidate filter must exclude agents whose blueprint role is `qa`
- `pm-intake.ts` QA candidate filter must exclude agents whose blueprint role is `reviewer`

#### 1c. Blueprint metadata

**`server/src/services/team-blueprints.ts`**

Add per-role constraints:
```typescript
{
  role: "reviewer",
  slotConstraint: "reviewer_only",
  responsibilities: ["code_quality", "design_review", "diff_review"],
}
{
  role: "qa",
  slotConstraint: "qa_only",
  responsibilities: ["acceptance_criteria", "release_gate", "regression_check"],
}
```

#### Files affected

| File | Change | Risk |
|------|--------|------|
| `server/src/services/team-blueprints.ts` | Add slotConstraint, responsibilities metadata | Low |
| `server/src/services/pm-intake.ts` | Enforce slot exclusivity in reviewer/QA candidate selection | Medium |
| `scripts/e2e/cloud-swiftsight-real-org.mjs` | Fix agent role assignments | Low |
| `scripts/e2e/cloud-swiftsight-autonomy-org.mjs` | Fix agent role assignments | Low |
| `bootstrap-bundles/cloud-swiftsight/*.json` | Add slotConstraint to role definitions | Low |

---

## Change 2: Visible Subtask Read Model (Phase 2)

### Why before creation semantics

The read model (how subtasks display) can be changed independently of write model (how subtasks are created).
This lets us validate the UI and query changes before touching creation logic.

### What changes

#### 2a. Parent/child display in list views

Current: `hiddenAt IS NOT NULL` children are filtered out everywhere.

Target: Show children as indented subtasks under their parent.

**Files using hiddenAt for filtering (full audit):**

| File | Current usage | Change |
|------|--------------|--------|
| `server/src/services/issues.ts` (line 491) | `isNull(issues.hiddenAt)` filter in list | Add `parentId` grouping, keep hiddenAt compat |
| `server/src/routes/sidebar-badges.ts` | Excludes hidden from badge counts | Exclude by `parentId IS NOT NULL` instead |
| `server/src/services/dashboard.ts` | Excludes hidden from dashboard metrics | Exclude by `parentId IS NOT NULL` instead |
| `server/src/services/activity.ts` | May include hidden in activity log | No change (activity should show all) |
| `server/src/services/organizational-memory-ingest.ts` | Excludes hidden from memory | Exclude by `parentId IS NOT NULL` instead |
| `server/src/services/internal-work-item-supervision.ts` | `isInternalWorkItemContext` checks hiddenAt | Add `isSubtask` check alongside hiddenAt |
| `ui/src/pages/IssueDetail.tsx` | Shows "internal work items" section for hidden | Convert to "Subtasks" section |
| `ui/src/pages/Team.tsx` | Filters hidden from board | Show subtasks indented under parent |

#### 2b. Progress aggregation

Add `subtaskProgressCache: jsonb` on parent issues.

```typescript
interface SubtaskProgressCache {
  total: number;
  done: number;
  inProgress: number;
  blocked: number;
  cancelled: number;
}
```

Computed from child issue statuses, updated on every child status change.

#### 2c. API changes

New query parameter: `GET /api/companies/:id/issues?parentId=<id>` to fetch subtasks of a parent.

Existing list endpoint: default to `parentId IS NULL` (root issues only) unless `parentId` or `includeSubtasks` is specified.

#### DB migration

```sql
ALTER TABLE issues ADD COLUMN subtask_order integer DEFAULT 0;
ALTER TABLE issues ADD COLUMN subtask_progress_cache jsonb;
```

No removal of hiddenAt. Both mechanisms coexist during transition.

#### Invariants

1. Subtasks only under root issues (max requestDepth = 1)
2. Label-based kind detection unchanged
3. Watch flags unchanged
4. Parent cannot close until all subtasks done/cancelled

---

## Change 3: Visible Subtask Creation Semantics (Phase 3)

### Why after read model

Read model (Phase 2) proves the display works. Now we change how subtasks are created.

### What changes

#### 3a. `createInternalWorkItem` → `createSubtask`

Current (issues.ts line 676-691):
```typescript
hiddenAt: new Date(),  // creates hidden child
```

Target:
```typescript
// No hiddenAt. Subtask is visible by default.
subtaskOrder: nextSubtaskOrder,
```

#### 3b. PM intake projection

**`server/src/routes/issues/intake-routes.ts`**

Projection apply loop creates subtasks without hiddenAt.
Coordination root stays as parent (no cancellation).

#### 3c. Supervision context update

**`server/src/services/internal-work-item-supervision.ts`**

`isInternalWorkItemContext` must work with both:
- Legacy hidden children (hiddenAt set)
- New visible subtasks (parentId set, hiddenAt null)

```typescript
export function isSubtaskOrInternalWorkItem(context) {
  return Boolean(context?.parentId);  // parentId alone is sufficient
}
```

#### 3d. Memory and activity update

**`server/src/services/organizational-memory-ingest.ts`**

Subtask-level memory should aggregate to parent.
Individual subtask memory is optional.

#### Files affected

| File | Change | Risk |
|------|--------|------|
| `server/src/services/issues.ts` | Remove hiddenAt on new subtask creation | Medium |
| `server/src/routes/issues/intake-routes.ts` | Subtask creation without hiddenAt | Medium |
| `server/src/services/pm-intake.ts` | Projection creates visible subtasks | Medium |
| `server/src/services/internal-work-item-supervision.ts` | Dual-path detection (legacy + new) | Medium |
| `server/src/services/organizational-memory-ingest.ts` | Subtask memory aggregation | Low |
| `scripts/e2e/*.mjs` | Update assertions for visible subtasks | Medium |

---

## Change 4: Engineer Single Flow (Phase 4)

### Why not first (rev 2 correction)

The original plan underestimated this change. The second engineer run is not mere duplication — it is the mechanism that transitions the engineer into an **isolated implementation workspace**.

Dependencies discovered in review:
- `issue-protocol-execution.ts` — dispatch mode
- `server-utils.ts` — workspace context construction
- `project-workspace-routing.ts` — workspace handoff strategy
- `heartbeat.ts` — run isolation and deferred run lifecycle

Removing `forceFollowupRun` without resolving workspace handoff will break the "shared/analysis workspace → implementation workspace" guard.

### Two-step approach

#### 4a. UI unification (low risk)

Before merging runs, unify how the two runs appear to users:
- Protocol gate run and implementation run display as **one logical execution** in IssueDetail
- Run list shows combined duration and transcript
- No server-side change — purely UI grouping

#### 4b. Actual single-run merge (medium-high risk)

After workspace handoff strategy is defined:

1. **Define workspace handoff within single run:**
   - Engineer ACKs in analysis context
   - Engineer STARTs and transitions to implementation workspace in same run
   - Workspace routing happens within the adapter, not between runs

2. **Remove forceFollowupRun for engineer self-START:**
   - `issue-protocol-execution.ts`: remove `implementationFollowupActive` block
   - Coalesce START_IMPLEMENTATION into active run

3. **Update workspace routing:**
   - `project-workspace-routing.ts`: workspace transition happens on START_IMPLEMENTATION message within active run, not on new run creation

#### Files affected

| File | Change | Risk |
|------|--------|------|
| `ui/src/pages/IssueDetail.tsx` | Group protocol gate + implementation runs visually (4a) | Low |
| `server/src/services/issue-protocol-execution.ts` | Remove implementationFollowupActive (4b) | Medium-High |
| `server/src/services/heartbeat.ts` | Adjust deferred run logic for engineer case (4b) | Medium-High |
| `server/src/services/project-workspace-routing.ts` | Workspace transition within single run (4b) | High |
| Adapter packages | Handle ACK → START → implement in single wake (4b) | Medium |

#### Prerequisite

Workspace handoff strategy document must be written before 4b implementation begins.

---

## Change 5: Fast Lane / Full Lane (Phase 5)

### Why last

Requires visible subtask model (Phase 3) for full lane decomposition.
Requires role separation (Phase 1) for correct QA gate behavior.

### Thin start approach (rev 2 correction)

Do NOT add a new `executionMode` column initially.
Instead, derive fast/full lane from **existing signals**:

```typescript
function deriveExecutionLane(issue, protocolState): "fast" | "full" {
  // Full lane if any of:
  if (protocolState.qaAgentId) return "full";           // QA assigned = full
  if (issue.parentId === null && hasSubtasks) return "full"; // Has decomposition = full
  if (needsClarification) return "full";                // Needs clarification = full

  // Otherwise fast lane
  return "fast";
}
```

**Fast lane behavior:**
- `qaAgentId` is null → no `qa_pending` state (already works in current protocol)
- No subtask decomposition
- Lighter review brief (existing execution-lanes.ts policy)
- Quick close after review approval

**Full lane behavior:**
- `qaAgentId` assigned → QA gate active
- Subtask decomposition possible
- Full clarification loop
- Full review evidence requirements

This means **zero schema changes** for the initial fast lane implementation.
The `executionMode` column can be added later if explicit lane tracking is needed.

#### Files affected

| File | Change | Risk |
|------|--------|------|
| `server/src/services/execution-lanes.ts` | Export `deriveExecutionLane()` | Low |
| `server/src/services/pm-intake.ts` | Use lane to decide QA assignment and decomposition | Medium |
| `server/src/services/issue-retrieval.ts` | Lighter brief for fast lane (already partially done) | Low |
| `ui/src/pages/IssueDetail.tsx` | Show lane indicator badge | Low |

## Implementation Order (rev 2)

```
Phase 1: Role separation (Change 1)
  - Smallest scope, immediately reduces confusion
  - Blueprint slotConstraint + pm-intake candidate filter
  - E2E fixture alignment
  - Risk: Low
  - Estimated scope: ~80 lines changed

Phase 2: Visible subtask read model (Change 2)
  - Display-only changes: queries, badges, dashboard, UI
  - DB migration: add subtaskOrder, subtaskProgressCache
  - No creation logic change yet
  - Risk: Medium (wide read surface, but no write-path risk)
  - Estimated scope: ~300 lines changed

Phase 3: Visible subtask creation semantics (Change 3)
  - New subtasks created without hiddenAt
  - Supervision context dual-path (legacy + new)
  - PM intake projection creates visible subtasks
  - Risk: Medium-High
  - Estimated scope: ~200 lines changed

Phase 4: Engineer single flow (Change 4)
  - 4a: UI grouping of protocol gate + implementation runs (low risk)
  - 4b: Actual single-run merge (requires workspace handoff strategy doc first)
  - Risk: 4a Low, 4b Medium-High
  - Estimated scope: 4a ~50 lines, 4b ~200 lines
  - PREREQUISITE: workspace handoff strategy document

Phase 5: Fast lane / full lane (Change 5)
  - Thin start: derive from existing signals (qaAgentId, subtask presence)
  - No new schema columns initially
  - Risk: Low (uses existing mechanisms)
  - Estimated scope: ~100 lines changed
```

## E2E Test Strategy After Changes

### Remove or archive

- Hidden child coordination E2E variants (internal mechanism proven, no longer primary surface)
- Cancelled coordination root assertions

### New E2E tests per phase

**Phase 1:**
- Verify reviewer and QA never appear in wrong slots after blueprint apply
- Verify pm-intake projection respects slotConstraint

**Phase 2:**
- Verify existing hidden children display as subtasks in list views
- Verify parent shows progress aggregation
- Verify sidebar badges exclude subtasks from top-level count
- Verify dashboard metrics exclude subtasks correctly

**Phase 3:**
- Create issue -> PM structures with subtasks -> verify subtasks visible (no hiddenAt)
- Verify subtask completion updates parent progress cache
- Verify supervision context works for both legacy hidden and new visible subtasks

**Phase 4a:**
- Verify IssueDetail groups protocol gate + implementation runs visually

**Phase 4b:**
- Assign issue -> verify single heartbeat run
- Verify ACK + START + implement in one run
- Verify workspace transition happens within single run

**Phase 5:**
- Create simple issue (no QA, no decomposition) -> verify fast lane behavior
- Verify no QA gate, lightweight review, quick close
- Create complex issue (QA assigned, decomposition) -> verify full lane
- Verify total fast lane cycle time < full lane

## Migration Strategy

### Backward compatibility

- `hiddenAt` column stays in schema (not dropped)
- Existing hidden children remain hidden until Phase 2 read model shows them
- New subtasks (Phase 3+) created without hiddenAt
- Old queries with hiddenAt filter continue to work during transition
- `isInternalWorkItemContext` supports both legacy and new path

### Data migration (optional, can be done after Phase 3)

```sql
-- Convert existing hidden children to visible subtasks
UPDATE issues
SET hidden_at = NULL,
    subtask_order = (
      SELECT COUNT(*) FROM issues AS sibling
      WHERE sibling.parent_id = issues.parent_id
      AND sibling.created_at < issues.created_at
    )
WHERE hidden_at IS NOT NULL
AND parent_id IS NOT NULL;
```

## Non-Goals

- Auto-merge / PR integration (not in scope)
- New UI components for subtask drag-and-drop (just indented list for now)
- Blueprint editor UI changes (blueprint format stays the same)
- Protocol message type additions (reuse existing types)
- Adapter changes for Phases 1-3 (adapters don't know about parent/child)
- New executionMode DB column in Phase 5 (derive from existing signals first)

## Risks (rev 2)

| Risk | Severity | Mitigation |
|------|----------|------------|
| hiddenAt read model spans 8+ files | High | Phase 2 is read-only, each file can be verified independently |
| pm-intake reviewer selection breaks after slot constraint | Medium | Add constraint gradually, keep fallback to current behavior |
| Engineer workspace handoff breaks on single-run merge | High | Phase 4a (UI only) first, 4b requires handoff strategy doc |
| Parent progress cache becomes stale | Medium | Update cache on every subtask status change event |
| Fast lane issues that should have been full lane | Low | Human board can upgrade lane at any time |
| Backward compat with existing hidden children | Medium | Both detection paths active until data migration |

## Success Criteria

1. Reviewer and QA never appear in wrong slots (Phase 1)
2. Existing subtasks are visible in all list views (Phase 2)
3. New subtasks created without hiddenAt (Phase 3)
4. Parent issue shows subtask completion progress (Phase 2-3)
5. Engineer runs display as single logical execution (Phase 4a)
6. Engineer completes assignment in 1 actual run (Phase 4b)
7. Simple issues close faster via fast lane (Phase 5)
8. All existing kernel E2E tests pass (adapted to new model)

## Review Feedback Log

### Rev 1 → Rev 2 (2026-03-15)

1. **Engineer single flow risk underestimated:**
   - Original: "~50 lines, low risk, heartbeat.ts no change"
   - Corrected: workspace handoff dependency discovered (project-workspace-routing.ts, server-utils.ts)
   - Resolution: split into 4a (UI grouping) and 4b (actual merge), moved to Phase 4

2. **Visible subtask scope underestimated:**
   - Original: listed 10 files affected
   - Corrected: hiddenAt is used in sidebar-badges, dashboard, activity, organizational-memory-ingest, internal-work-item-supervision, IssueDetail — full read model overhaul
   - Resolution: split into Phase 2 (read model) and Phase 3 (creation semantics)

3. **Role separation scope underestimated:**
   - Original: "fixture-only, no server logic changes"
   - Corrected: pm-intake.ts reviewer candidate policy must enforce slot exclusivity, not just fixtures
   - Resolution: added slotConstraint metadata and pm-intake filter changes

4. **Fast lane approach simplified:**
   - Original: new executionMode column
   - Corrected: derive from existing signals (qaAgentId, subtask presence, decomposition flag)
   - Resolution: zero schema changes for v1, executionMode column deferred
