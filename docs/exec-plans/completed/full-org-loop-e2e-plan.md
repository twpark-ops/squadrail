# Full Org Loop E2E Plan

## Goal

Validate the live `cloud-swiftsight` organization as a real delivery org, not only an engineer-only implementation loop.

The expanded E2E must prove:

- project TL delegation works
- QA agents can act as real reviewers
- PM can clarify and route delivery work
- CTO can route company-level work into the correct project lane
- implementation still stays inside isolated worktrees or clones

## Scenario Set

### 1. TL + QA Engineer loop

- Project: `swiftsight-agent`
- Root assignee: `swiftsight-agent-tl` (`tech_lead`)
- Reviewer: `swiftsight-qa-engineer`
- Expected role checkpoints:
  - TL sends `REASSIGN_TASK`
  - QA Engineer sends `START_REVIEW`
  - QA Engineer sends a review decision (`REQUEST_CHANGES` or `APPROVE_IMPLEMENTATION` or `REQUEST_HUMAN_DECISION`)

### 2. PM + TL + QA Lead loop

- Project: `swiftsight-cloud`
- Root assignee: `swiftsight-pm` (`pm`)
- Reviewer: `swiftsight-qa-lead`
- Expected role checkpoints:
  - PM sends `REASSIGN_TASK`
  - `swiftsight-cloud-tl` sends `REASSIGN_TASK`
  - QA Lead sends `START_REVIEW`
  - QA Lead sends a review decision

### 3. CTO + TL + QA Lead loop

- Project: `swiftcl`
- Root assignee: `swiftsight-cto` (`cto`)
- Reviewer: `swiftsight-qa-lead`
- Expected role checkpoints:
  - CTO sends `REASSIGN_TASK`
  - `swiftcl-tl` sends `REASSIGN_TASK`
  - QA Lead sends `START_REVIEW`
  - QA Lead sends a review decision

## Common Success Criteria

- Final workflow state is `done`
- `SUBMIT_FOR_REVIEW`, `APPROVE_IMPLEMENTATION`, and `CLOSE_TASK` exist
- `diff`, `test_run`, and implementation workspace binding artifacts exist
- implementation workspace is isolated and differs from the base repo root
- base repo git status is unchanged before vs after

## Execution Order

1. TL + QA Engineer
2. PM + TL + QA Lead
3. CTO + TL + QA Lead

## Supervisor Control-Plane Rule

- Supervisory roles must prefer `node /home/taewoong/company-project/squadall/scripts/runtime/squadrail-protocol.mjs`
- Do not rely on ad-hoc `curl`, `wget`, or tool-search for routine protocol transitions in `claude_local`
- Route ownership with explicit `REASSIGN_TASK`; start review with `START_REVIEW`; use structured review decisions (`REQUEST_CHANGES`, `REQUEST_HUMAN_DECISION`, `APPROVE_IMPLEMENTATION`) through the helper
- When a supervisor needs context, prefer `get-brief --scope <role>` instead of repository inspection before the first routing action
- Treat repo inspection before the first routing action as an E2E failure for PM, CTO, and TL assignment loops

## Risks

- PM or CTO may respond with notes instead of `REASSIGN_TASK`
- QA may request changes, causing additional review cycles
- Claude-based supervisory roles may be slower than engineer runs

## Recommendation

Treat this harness as a live-org governance test, not only a repo-fix test. Fail the run if the named role checkpoints are missing even when the code fix eventually lands.
