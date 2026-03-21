# Tech Debt Tracker

## Current Debt Buckets

### Reliability

- `completed/canonical-stabilization-sprint-plan-2026-03-18.md`
- `completed/five-axis-hardening-plan-2026-03-18.md`
- `completed/p2-autonomy-fallback-hardening-plan-2026-03-19.md`
- `completed/p0-protocol-dispatch-reconciliation-plan-2026-03-22.md`
- `completed/p1-protocol-dispatch-outbox-plan-2026-03-22.md`
- `active/p3-project-qa-contract-execution-plan-2026-03-21.md`
- `../design-docs/supervisory-lane-autonomy-gap-design-2026-03-20.md`
- E2E infrastructure debt
  - Live-model nondeterminism remains outside the completed P2 scope.
  - Shared persistent-server repeat validation remains a harness concern until ephemeral-per-scenario mode is added.
  - Protocol dispatch durability gap is closed with reconciliation sweep + transactional outbox.
  - Follow-up debt is now limited to outbox worker claim/metrics/operator visibility polish.

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
