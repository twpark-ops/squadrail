# Tech Debt Tracker

## Current Debt Buckets

### Reliability

- `completed/canonical-stabilization-sprint-plan-2026-03-18.md`
- `completed/five-axis-hardening-plan-2026-03-18.md`
- `active/p2-autonomy-fallback-hardening-plan-2026-03-19.md`
- `../design-docs/supervisory-lane-autonomy-gap-design-2026-03-20.md`
- Provider/runtime degraded debt
  - Track scenarios that appear in `providerRuntimeDebtScenarios` from real-org fallback summaries.
  - Track both `supervisory_invoke_stall` and `recovered_supervisory_invoke_stall`.
  - Current canonical example: `swiftsight-agent-tl-qa-loop`
    - `CLO-183`: `supervisory_invoke_stall`
    - earlier runs: `recovered_supervisory_invoke_stall`
 - Follow-up autonomy debt
  - Remaining deterministic fallback reasons:
    - `reviewer_approval`
    - `qa_approval`
    - `close`
  - Current question: why short supervisory lanes fail to emit a decision message before fallback.

### Retrieval / Knowledge

- `completed/p1-retrieval-stabilization-plan.md`
- `../design-docs/retrieval-god-file-refactor-debt.md`

### Product / UX

- `../product-specs/batch-b-onboarding-first-success-runtime-plan-2026-03-17.md`
- `../product-specs/batch-c-budget-quota-composer-collaboration-plan-2026-03-17.md`
- `../product-specs/ui-rebuild-backlog-2026.md`

### Security

- `completed/phase-0-security-baseline-design-2026-03-18.md`
- `../review-findings-2026-03-18.md`
