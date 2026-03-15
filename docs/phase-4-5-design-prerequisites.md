# Phase 4-5 Design Prerequisites

Status: design review
Author: Taewoong Park
Date: 2026-03-15
Branch: feat/product-model-simplify

## Phase 4: Engineer Single Flow

### Problem Recap

Engineer gets 2 heartbeat runs per assignment:

| Run | Protocol Message | Workspace Usage | Workspace Type |
|-----|-----------------|-----------------|----------------|
| Run 1 | ACK_ASSIGNMENT | **analysis** | shared |
| Run 2 | START_IMPLEMENTATION | **implementation** | isolated (if policy) |

The second run exists because `forceFollowupRun: true` forces a new run,
and the new run's context has `protocolMessageType: "START_IMPLEMENTATION"`,
which triggers `workspaceUsage = "implementation"` in `deriveProjectWorkspaceUsageFromContext()`.

### Root Cause

The workspace routing decision is derived from the protocol message type:

```
deriveProjectWorkspaceUsageFromContext():
  ACK_ASSIGNMENT → "analysis"
  START_IMPLEMENTATION → "implementation"
```

This means:
- Merging runs without fixing workspace routing → engineer works in analysis workspace
- Analysis workspace may be shared → implementation in wrong workspace
- Isolated workspace never created → isolation guarantee broken

### Why Phase 4a (UI Grouping) Is Safe

Phase 4a only groups the two runs visually in IssueDetail.tsx.
No server-side change. No workspace change. No risk.

### Phase 4b: Three Options Evaluated

#### Option A: Override workspace usage in context (Recommended)

When building the dispatch plan for ACK_ASSIGNMENT to an engineer,
add `workspaceUsageOverride: "implementation"` to the context snapshot.

In `deriveProjectWorkspaceUsageFromContext()`:
```typescript
// Check for override first
if (context.workspaceUsageOverride) {
  return context.workspaceUsageOverride;
}
// Then existing logic...
```

In `issue-protocol-execution.ts`, for engineer ACK_ASSIGNMENT recipients:
```typescript
// Instead of setting forceFollowupRun: true,
// set workspace override so single run gets implementation workspace
contextSnapshot: {
  ...baseContext,
  workspaceUsageOverride: "implementation",
}
```

**Pros:**
- Minimal code change (2 files)
- No protocol state machine change
- No adapter change needed
- Workspace isolation preserved
- Engineer still sends ACK + START as separate protocol messages within one run

**Cons:**
- Context snapshot has a "magic" override field
- Need to verify all workspace routing paths respect the override

**Files to change:**
- `server/src/services/project-workspace-routing.ts`: Add override check (~5 lines)
- `server/src/services/issue-protocol-execution.ts`: Set override instead of forceFollowupRun (~10 lines)
- `server/src/services/heartbeat.ts`: No change (coalescing already works)

**Risk: Low-Medium**

#### Option B: Change ACK_ASSIGNMENT to resolve as "implementation"

Modify `deriveProjectWorkspaceUsageFromContext()` to treat engineer ACK_ASSIGNMENT
as implementation usage.

```typescript
if (recipientRole === "engineer" && messageType === "ACK_ASSIGNMENT") {
  return "implementation";  // Preemptively use implementation workspace
}
```

**Pros:**
- Single line change in workspace routing
- Clean, no override mechanism

**Cons:**
- Changes the semantic meaning of ACK_ASSIGNMENT for ALL engineers
- Any non-implementation ACK (e.g., plan work items) would get wrong workspace
- Harder to revert

**Risk: Medium** — Semantic coupling between protocol messages and workspace.

#### Option C: Combine ACK + START into single protocol message

Create a new protocol message type `ACK_AND_START_IMPLEMENTATION` that does both.

**Pros:**
- Clean protocol semantics

**Cons:**
- Protocol state machine change (new message type)
- All adapters need to support new message
- Most invasive change
- Breaks protocol linearity (ACK and START are logically distinct)

**Risk: High** — Too invasive for the benefit.

### Recommendation: Option A

Workspace override in context snapshot. Minimal change, preserves isolation, no protocol change.

### Phase 4b Implementation Plan

```
Step 1: Add workspaceUsageOverride check to deriveProjectWorkspaceUsageFromContext()
Step 2: In issue-protocol-execution.ts, for engineer ACK_ASSIGNMENT:
        - Remove implementationFollowupActive block
        - Remove forceFollowupRun: true
        - Add workspaceUsageOverride: "implementation" to context
Step 3: Verify coalescing works (START_IMPLEMENTATION merges into active run)
Step 4: Test: engineer gets 1 run with implementation workspace
Step 5: E2E: full delivery loop still works with single run
```

### Files Affected (Phase 4b)

| File | Change | Risk |
|------|--------|------|
| `server/src/services/project-workspace-routing.ts` | Override check | Low |
| `server/src/services/issue-protocol-execution.ts` | Replace forceFollowupRun with override | Medium |
| `server/src/__tests__/` | Update run count expectations | Low |
| `scripts/e2e/*.mjs` | Verify single run behavior | Low |

### Prerequisite Checklist

- [x] Understand workspace routing decision tree
- [x] Understand forceFollowupRun lifecycle
- [x] Understand isolated workspace creation trigger
- [x] Evaluate 3 options
- [x] Choose Option A (workspace override)
- [ ] Implement Phase 4a (UI grouping)
- [ ] Implement Phase 4b (actual merge)

---

## Phase 5: Fast Lane / Full Lane

### Current State

The execution lane system already exists and works:

| Lane | Trigger | Effect |
|------|---------|--------|
| fast | Few files, few criteria, implementing state | Retrieval: topK=8, finalK=4, maxEvidence=4 |
| normal | Default | Retrieval: unchanged |
| deep | Cross-project, coordination, architecture | Retrieval: topK=24, finalK=10, maxEvidence=8 |

**Key finding:** Lanes currently only affect **retrieval policy**.
They do NOT affect protocol workflow (QA gate, review depth, etc.).

### QA Gate Is Already Conditional

The QA gate mechanism is already designed to be optional:

```typescript
// issue-protocol.ts: APPROVE_IMPLEMENTATION handler
if (before === "under_review" && qaRequired && !humanOverride && sender.role !== "qa") {
  return "qa_pending";   // QA assigned → go through QA gate
}
return "approved";        // No QA → skip directly to approved
```

`qaRequired = Boolean(currentState.qaAgentId)` — if no QA agent assigned, gate is skipped.

### Thin Start Approach (No Schema Change)

Fast lane = **no QA assigned + lighter retrieval**

The derivation is simple:

```typescript
function deriveProductLane(issue, protocolState): "fast" | "full" {
  if (protocolState.qaAgentId) return "full";
  if (hasSubtasks(issue)) return "full";
  return "fast";
}
```

This means:
- PM intake decides QA assignment → indirectly decides lane
- If PM sees simple issue → no QA → fast lane
- If PM sees complex issue → QA assigned → full lane

### What Changes for Fast Lane

| Aspect | Fast Lane | Full Lane |
|--------|-----------|-----------|
| QA gate | Skipped (qaAgentId = null) | Active |
| Subtask decomposition | None | Possible |
| Review brief | Lighter (topK=8, maxEvidence=4) | Full |
| Clarification | Optional (usually skipped) | Expected |
| Protocol flow | assign → ack → implement → review → approve → close | assign → ack → [clarify] → [decompose] → implement → review → [qa] → approve → close |

### What Does NOT Change

- Protocol state machine stays the same
- No new states, no new message types
- No executionMode DB column
- Adapters don't need changes

### Implementation Plan

```
Step 1: In pm-intake.ts, add complexity scoring for QA assignment decision:
        - Simple request (few files, clear scope) → qaAgent = null
        - Complex request (cross-project, unclear scope) → qaAgent = picked

Step 2: Export deriveProductLane() from execution-lanes.ts:
        - Uses qaAgentId and subtask presence
        - Used in brief construction and UI display

Step 3: In issue-retrieval.ts, use product lane for brief template:
        - Fast lane → shorter acceptance criteria section
        - Fast lane → fewer review evidence requirements

Step 4: In IssueDetail.tsx, show lane indicator badge:
        - "Fast" or "Full" next to issue status

Step 5: E2E test:
        - Simple issue → no QA assigned → fast lane → quick close
        - Complex issue → QA assigned → full lane → full workflow
```

### PM Intake Complexity Scoring

The key decision point is in pm-intake.ts where QA gets assigned.
Currently, QA is assigned whenever a `role === "qa"` agent exists.

For fast lane, we add a complexity check:

```typescript
// In buildPmIntakeProjectionPreview():

const complexitySignals = {
  crossProject: mentionedProjectCount > 1,
  needsClarification: Boolean(input.request.requiredKnowledgeTags?.length > 2),
  coordinationOnly: Boolean(input.request.coordinationOnly),
  highPriority: input.issue.priority === "critical",
};

const isComplex = Object.values(complexitySignals).some(Boolean);

// Only assign QA for complex issues
if (isComplex) {
  qaAgent = pickBestAgent({ predicate: canActAsQa, ... });
} else {
  qaAgent = null;  // Fast lane — no QA gate
}
```

### Files Affected (Phase 5)

| File | Change | Risk |
|------|--------|------|
| `server/src/services/execution-lanes.ts` | Add `deriveProductLane()` | Low |
| `server/src/services/pm-intake.ts` | Complexity scoring for QA assignment | Medium |
| `server/src/services/issue-retrieval.ts` | Lane-aware brief template | Low |
| `ui/src/pages/IssueDetail.tsx` | Lane indicator badge | Low |
| `scripts/e2e/*.mjs` | Fast vs full lane test | Low |

### Prerequisite Checklist

- [x] Understand execution lane system
- [x] Understand QA gate conditional logic
- [x] Understand PM intake QA assignment flow
- [x] Design thin start (no schema change)
- [x] Define complexity scoring signals
- [ ] Implement deriveProductLane()
- [ ] Add complexity scoring to PM intake
- [ ] Add UI lane indicator
- [ ] Add E2E tests

---

## Implementation Order (Phase 4-5)

```
Phase 4a: UI grouping of engineer runs
  - IssueDetail.tsx: group protocol gate + implementation runs
  - Risk: Low
  - Scope: ~50 lines

Phase 4b: Workspace override single-run merge
  - project-workspace-routing.ts: add override check
  - issue-protocol-execution.ts: replace forceFollowupRun
  - Risk: Low-Medium
  - Scope: ~30 lines + test updates

Phase 5: Fast lane via QA assignment control
  - execution-lanes.ts: add deriveProductLane()
  - pm-intake.ts: complexity scoring
  - issue-retrieval.ts: lane-aware brief
  - IssueDetail.tsx: lane badge
  - Risk: Low
  - Scope: ~100 lines
```

## Risk Summary

| Phase | Risk | Mitigation |
|-------|------|------------|
| 4a | Very Low | UI only, no server change |
| 4b | Low-Medium | Override is additive, existing workspace routing untouched |
| 5 | Low | Uses existing QA gate mechanism, no protocol change |
