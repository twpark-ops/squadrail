---
title: "Runtime Surface Maintenance Plan Phase 6"
owner: "taewoong"
status: "completed"
last-reviewed: "2026-03-22"
---

# Goal

`heartbeat`의 남은 execution/protocol recovery/wakeup enqueue cluster를 별도 factory로 분리해, service 본문을 composition layer로 축소한다.

# Scope

## In

- `heartbeat-run-execution.ts` 추가
- `heartbeat-protocol-recovery.ts` 추가
- `heartbeat-wakeup-control.ts`에 `enqueueWakeup` 이동
- `heartbeat.ts` local helper/class/function 제거 후 factory wiring만 유지
- 설계 문서와 maps 동기화

## Out

- `heartbeat` external API shape 변경
- protocol semantics 변경
- dashboard / UI surface 추가 변경

# Invariants

- wakeup enqueue/coalesce/deferred promotion semantics는 그대로 유지한다
- protocol idle/degraded recovery semantics는 그대로 유지한다
- run execution/result persistence semantics는 그대로 유지한다
- `heartbeat-dispatch-watchdog`, `heartbeat-service-flow` tests는 계속 green이다

# Implementation Plan

1. `wakeupControl`에 enqueue 경로를 합친다.
2. protocol recovery/watchdog cluster를 별도 factory로 옮긴다.
3. run execution/start cluster를 별도 factory로 옮긴다.
4. `heartbeat.ts`는 timer/store/service composition만 남긴다.
5. focused/heavy tests, typecheck, docs check를 다시 잠근다.

# Validation

- `pnpm --filter @squadrail/server typecheck`
- `pnpm --filter @squadrail/server exec vitest run src/__tests__/heartbeat-dispatch-watchdog.test.ts src/__tests__/heartbeat-internal-helpers.test.ts src/__tests__/heartbeat-workspace-session.test.ts`
- `pnpm --filter @squadrail/server exec vitest run -c vitest.heavy.config.ts src/__tests__/heartbeat-service-flow.test.ts`
- `pnpm docs:check`
- `git diff --check`

# Exit Criteria

- `heartbeat.ts`가 composition layer 수준으로 축소된다
- enqueue / protocol recovery / run execution이 각자 별도 module로 분리된다
- focused/heavy tests와 typecheck가 green이다
- 설계/plan 문서가 현재 구조를 반영한다

# Result

1. `heartbeat-run-execution.ts`, `heartbeat-protocol-recovery.ts`를 추가했고, `heartbeat-wakeup-control.ts`는 enqueue까지 포함하도록 확장했다.
2. `heartbeat.ts`는 store/timer/factory wiring/service API만 남는 구조로 줄었다.
3. focused tests, heavy service flow test, server typecheck가 모두 통과했다.
