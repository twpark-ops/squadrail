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

## Stabilization Review — 2026-03-20

38 commits (`8299c81..f077f6b8`), 292 files, +17,417 lines reviewed.

### Resolved

| # | Severity | Finding | Resolution |
|---|:--------:|---------|------------|
| S-1 | MEDIUM | `express.json()` had no `limit` — default 100KB silently blocked documents before Zod validation | `app.ts`: dynamic `jsonBodyLimitBytes` based on `maxDocumentBodyChars * 4`, floor 3MB / cap 16MB |
| S-2 | MEDIUM | `readEnvAlias()` called with duplicate identical keys (~20 sites) | `config.ts`: full audit — distinct aliases or single-arg calls |
| S-3 | MEDIUM | Reviewer cache drift had no revision upper bound — stale entry with `expiresAt=null` could be served | `knowledge.ts`: added `candidate.knowledgeRevision <= revision` guard |
| S-4 | MEDIUM | Sync job resume TOCTOU race — rapid polling could trigger duplicate executions | `knowledge-setup.ts`: job added to `activeKnowledgeSyncJobs` immediately in `scheduleKnowledgeSyncExecution` |
| S-5 | MEDIUM | `protocolIdleWatchdogTimers` map leaked entries on unexpected run exit | `heartbeat.ts`: `clearProtocolIdleWatchdog` now unconditionally deletes map entry even without active timer |
| S-6 | MEDIUM | Idle watchdog reschedules indefinitely with no backoff — O(runs × 2-3 queries) every 10s | `heartbeat.ts`: exponential backoff (10s→10s→20s→40s→60s cap) with `protocolIdleWatchdogAttempts`, reset on recovery |
| S-7 | MEDIUM | `projects.list` invalidated on every issue activity event — unnecessary refetches | `LiveUpdatesProvider.tsx`: guarded behind `projectIds.length > 0` |
| S-8 | CRITICAL | E2E temp directory `/tmp/squadrail-full-delivery-*` never cleaned up | `full-delivery.mjs`: `rm(tempRoot, {recursive:true})` in `finally`, gated by `E2E_KEEP_TEMP` flag |
| S-9 | HIGH | E2E hardcoded timeouts (8min global, 30s close, 60s health) not configurable | `full-delivery-runtime-policy.mjs`: centralized `RUNTIME_POLICY` with env var overrides |
| S-10 | HIGH | `briefs.length >= 2` undocumented invariant — breaks if brief consolidation changes | `full-delivery-invariants.mjs`: relaxed to `>= 1` |
| S-11 | LOW | `signalToneClass` recreated per render | Deferred — no functional impact |
| S-12 | LOW | `isActiveRootIssue` duplicated across files | Deferred — no functional impact |

### Open — Accepted Risks

| # | Severity | Finding | File | Position |
|---|:--------:|---------|------|----------|
| S-13 | CRITICAL | E2E scenarios 1-2, 5 call live OpenAI API via `codex` binary — no mock/stub, non-deterministic | `full-delivery.mjs`, `cloud-swiftsight-*.mjs` | Accepted risk. `RUNTIME_POLICY` externalizes timeouts. Mock adapter is a separate backlog item. |
| S-14 | HIGH | Scenarios 2-4 share a persistent server — state leakage possible despite label-based cleanup | `run-canonical-repeat-validation.sh` | Mitigated by `SWIFTSIGHT_PM_EVAL_CLEANUP=1`. Full isolation requires ephemeral server per scenario (backlog). |
| S-15 | MEDIUM | `handleProtocolIdleWatchdog` calls `recoverIdleProtocolRunIfNeeded` then `recoverDegradedProtocolRunIfNeeded` — if idle throws, degraded is skipped | `heartbeat.ts` | Backlog: wrap each in independent try/catch |
| S-16 | MEDIUM | `organizational-memory-ingest.ts` `innerJoin(issues, ...)` excludes deleted issues' protocol messages from backfill | `organizational-memory-ingest.ts:1114` | Backlog: evaluate if deleted issue messages should still be backfilled |
| S-17 | LOW | `api-rate-limit.ts:31` accesses `req.actor.type` without null check | `server/src/middleware/api-rate-limit.ts` | Backlog: add `if (!req.actor) return false` guard |
| S-18 | LOW | `close-wake-evidence.mjs` recursive file listing has no depth limit | `scripts/e2e/close-wake-evidence.mjs` | Backlog: add max depth or early exit |
| S-19 | LOW | QA `REQUEST_HUMAN_DECISION` path has no unit test | `scripts/e2e/__tests__/qa-gate-invariants.test.ts` | Backlog |
| S-20 | LOW | `readRecord`/`readString` duplicated across 3+ UI files | `LiveUpdatesProvider.tsx`, `live-update-issue-cache.ts`, `live-update-toast-builders.ts` | Backlog: extract to shared utility |

## P2 Follow-up Review — 2026-03-20

후속 reliability 패스(`f077f6b8`, `6d281a05`)까지 포함해 다시 점검했다.

### Resolved

| # | Severity | Finding | Resolution |
|---|:--------:|---------|------------|
| P2-1 | HIGH | short supervisory lanes (`reviewer/QA/close`) could stay in `adapter.invoke` without being surfaced as a distinct failure mode | `heartbeat.ts`: added `supervisory_invoke_stall` detection for `review_reviewer`, `qa_gate_reviewer`, and `approval_tech_lead` lanes, including `adapter.execute_start` / `adapter.invoke` checkpoints |
| P2-2 | MEDIUM | degraded classification and recovery threshold used different clocks, so watchdog recovery could trail deterministic fallback by a full cycle | `heartbeat.ts`: unified degraded recovery threshold resolution for supervisory stalls and kept the first two watchdog ticks at `10s` |
| P2-3 | HIGH | `human_board` close could still be blocked by failure-learning gate even though the policy text required operator review before close | `issue-protocol-policy.ts`: treat `human_board` close as satisfying the operator-review gate for unresolved repeated runtime failures |
| P2-4 | MEDIUM | idle recovery exception could skip degraded recovery because watchdog chained both branches in a single boolean expression | `heartbeat.ts`: split idle/degraded recovery into independently guarded execution via `runProtocolWatchdogRecoveries()` |
| P2-7 | MEDIUM | active-run diagnostics only proved helper contract injection, not whether shell-level helper POST actually reached the protocol route | `squadrail-protocol.mjs`, `issues.ts`, `agents.ts`, `active-run-protocol-progress.ts`: helper POSTs now send explicit transport headers, the issue route records `protocol.helper_invocation` run events, and `helperTrace` exposes observed helper transport alongside prompt/env contract injection |
| P2-8 | MEDIUM | reviewer / QA / close follow-up wakes could still inherit stale adapter sessions | `issue-protocol-execution.ts`, `claude-local execute.ts`, `heartbeat.ts`: short supervisory follow-ups now propagate `forceFreshAdapterSession` end-to-end, and `claude_local` explicitly skips `--resume` when the wake requests a fresh session |

### Open — Active Reliability Debt

| # | Severity | Finding | File | Position |
|---|:--------:|---------|------|----------|
| P2-5 | HIGH | `swiftsight-agent-tl-qa-loop` still needs deterministic fallback for `reviewer_approval`, `qa_approval`, and `close` even after supervisory stall detection | `cloud-swiftsight-real-org.mjs`, `heartbeat.ts` | Active P2 item. Now tracked as `supervisory_invoke_stall`, not as generic runtime ambiguity. |
| P2-6 | MEDIUM | fallback total for the QA loop remains `7` — canonical correctness is preserved, but autonomy is not yet steady-state | `cloud-swiftsight-real-org.mjs` | Active P2 item. The next slice should inspect actual shell-level helper execution traces and adapter/provider boundary signals before fallback. |

## Notes

- The toast-link issue was a client-side external navigation sink, not a server-side redirect endpoint.
- The heartbeat wakeup increase is a rollout concern, not a correctness bug by itself.
- The knowledge metric change should be reflected in any future dashboard or analytics copy that still assumes the old meaning.
- Retrieval-axis stabilization is not isolated from canonical stabilization. It must be executed together with `docs/exec-plans/completed/p1-retrieval-stabilization-plan.md`.
- S-13 (OpenAI mock adapter) is the single largest remaining E2E reliability gap. Until addressed, canonical repeat validation depends on external API availability.
- S-14 (shared persistent server) is mitigated but not eliminated. The repeat harness should eventually adopt ephemeral servers for all scenarios, matching the full-delivery pattern.
- P2 follow-up changed the diagnosis of the remaining QA/close debt. The latest real-org runs show `supervisory_invoke_stall` as the dominant signature, so the remaining work is now "why short supervisory lanes do not emit a decision message" rather than "whether runtime degradation exists at all."
- The latest helper-tracing slice narrows that further: the next question is whether stalled supervisory runs even reach shell-level helper execution (`helperTransportObserved`) before fallback.
- The latest real-org run (`CLO-187`) showed `helperTransportObserved = false` across the stalled fallback runs, so the remaining debt is now more clearly "why current-lane runs never reach shell-level helper execution" than "what happens after the helper POST succeeds."
- The latest real-org run (`CLO-191`) confirmed that reviewer / QA / close lanes now carry `forceFreshAdapterSession = true`, but they still stall with `helperTransportObserved = false`. That shifts the remaining P2 debt from "stale session reuse" to "fresh supervisory Claude runs never reaching shell-level helper execution."
