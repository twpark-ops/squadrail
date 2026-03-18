# Review Findings — 2026-03-18

## Scope

- Reviewed commits:
  - `6f1e9c9` — UI clarification and deploy surfaces
  - `6128b8c` — core hardening and canonical delivery flow
- Follow-up patch:
  - external toast link validation
  - null-safe merge gate summary access
  - localhost guard for `dangerouslyBypassApprovalsAndSandbox`
  - toast builder unit tests

## Pre-Stabilization Blockers

아래 항목은 canonical stabilization sprint의 선행 조건으로 취급한다.

| # | Severity | Finding | File | Position |
|---|:--------:|---------|------|----------|
| 0-1 | HIGH | hardcoded auth secret fallback remains | `server/src/auth/better-auth.ts` | Phase 0에서 제거 |
| 0-2 | HIGH | email verification is disabled by default | `server/src/auth/better-auth.ts` | Phase 0에서 기본 활성화 |
| 0-3 | MEDIUM | issue document body has no size cap | `server/src/routes/issues/documents-routes.ts` | Phase 0에서 route-level limit 추가 |
| 0-4 | MEDIUM | deliverables route needs stronger authorization / route-shape consistency | `server/src/routes/issues/deliverables-routes.ts` | Phase 0에서 hardening |
| 0-5 | MEDIUM | retrieval stabilization tests and known drifts must be aligned before invariant lock | `server/src/__tests__/retrieval-cache.test.ts`, `server/src/__tests__/dashboard-service.test.ts` | Phase 1에서 복구 |

## Resolved In This Pass

| # | Severity | Finding | File | Resolution |
|---|:--------:|---------|------|------------|
| 1 | MEDIUM | Toast action accepted unvalidated `externalUrl` values | `ui/src/context/LiveUpdatesProvider.tsx` | Moved toast builders into a dedicated module and added `http/https`-only URL validation with fallback to the internal changes route |
| 2 | LOW | `gateStatus?.blockingReasons[0]` could throw when `blockingReasons` is absent | `ui/src/components/ChangeReviewDesk.tsx` | Replaced with `gateStatus?.blockingReasons?.[0]` |
| 3 | LOW | `full-delivery.mjs` used `dangerouslyBypassApprovalsAndSandbox` without an explicit localhost assertion | `scripts/e2e/full-delivery.mjs` | Added `assertBypassOnlyOnLocalhost(runtimeBaseUrl)` and covered it with Vitest |
| 4 | LOW | Toast builder regressions were not directly tested | `ui/src/context/live-update-toast-builders.ts` | Added unit tests for protocol, merge candidate, merge automation, timeout, and run-status toast builders |

## Monitored / Intentional Tradeoffs

| # | Severity | Finding | File | Current Position |
|---|:--------:|---------|------|------------------|
| 5 | MEDIUM | Visible-subtask wakeups increase heartbeat run volume | `server/src/services/heartbeat.ts` | Kept as-is. This is the intended behavior needed for visible subtasks and internal work items. Track run volume and queue pressure instead of reverting the change. |
| 6 | MEDIUM | `feedbackCoverageRate` semantics changed | `server/src/services/knowledge.ts` | Kept as-is. The metric now reflects actual feedback-event coverage. UI consumers should treat `profileAppliedRunRate` as a separate signal. |

## Validation

```bash
pnpm exec vitest run --project ui ui/src/context/live-update-toast-builders.test.ts
pnpm exec vitest run --config scripts/e2e/vitest.config.ts scripts/e2e/__tests__/full-delivery-guards.test.ts
pnpm --filter @squadrail/ui typecheck
git diff --check
```

## Notes

- The toast-link issue was a client-side external navigation sink, not a server-side redirect endpoint.
- The heartbeat wakeup increase is a rollout concern, not a correctness bug by itself.
- The knowledge metric change should be reflected in any future dashboard or analytics copy that still assumes the old meaning.
- Retrieval-axis stabilization is not isolated from canonical stabilization. It must be executed together with `docs/p1-retrieval-stabilization-plan.md`.
