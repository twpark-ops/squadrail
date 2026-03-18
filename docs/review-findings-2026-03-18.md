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
