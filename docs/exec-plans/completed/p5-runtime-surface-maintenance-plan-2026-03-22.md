---
title: "Runtime Surface Maintenance Plan Phase 5"
owner: "taewoong"
status: "completed"
last-reviewed: "2026-03-22"
---

# Goal

`heartbeat` 본체에서 wakeup control과 cancellation cluster를 추가로 분리해 service를 execution/polling 중심으로 더 좁힌다.

# Scope

## In

- `heartbeat-wakeup-control.ts` 추가
- `releaseIssueExecutionAndPromote`, `wakeLeadSupervisorForRunFailure`, `cancelRunInternal` 분리
- `cancelIssueScope`, `cancelSupersededIssueFollowups`, `cancelActiveForAgent`를 같은 factory로 이동
- 기존 `heartbeat` service API와 helper export surface 유지
- 설계 문서와 maps 동기화

## Out

- `enqueueWakeup` full split
- protocol retry / execution cluster full decomposition
- additional QA contract tooling

# Invariants

- issue execution release/promote semantics는 그대로 유지한다
- issue-scoped cancel semantics는 그대로 유지한다
- agent pause 시 active run cancel semantics는 그대로 유지한다
- `heartbeat-service-flow`와 `heartbeat-dispatch-watchdog` tests는 계속 green이다

# Implementation Plan

1. wakeup/cancel cluster의 공통 의존성을 정리한다.
2. 별도 factory module에 wake/release/cancel 경로를 옮긴다.
3. `heartbeat.ts`는 injected helper만 사용하도록 정리한다.
4. focused tests, heavy flow test, typecheck를 다시 잠근다.
5. 설계 문서와 completed maps를 동기화한다.

# Validation

- `pnpm --filter @squadrail/server exec vitest run src/__tests__/heartbeat-dispatch-watchdog.test.ts src/__tests__/heartbeat-internal-helpers.test.ts src/__tests__/heartbeat-workspace-session.test.ts`
- `pnpm --filter @squadrail/server exec vitest run -c vitest.heavy.config.ts src/__tests__/heartbeat-service-flow.test.ts`
- `pnpm --filter @squadrail/server typecheck`
- `pnpm docs:check`
- `git diff --check`

# Exit Criteria

- `heartbeat.ts`에서 wakeup control / cancellation cluster가 별도 module로 이동한다
- heavy flow test와 watchdog tests가 green이다
- server typecheck가 green이다
- 설계/plan 문서가 현재 상태로 맞춰진다

# Result

1. `heartbeat-wakeup-control.ts`를 추가해 issue execution release/promote, lead-supervisor wake, run cancellation, issue-scope cancellation cluster를 별도 factory module로 이동했다.
2. `heartbeat.ts`는 해당 경로를 직접 구현하지 않고 injected helper를 사용하도록 정리됐다.
3. focused tests, heavy flow test, server typecheck가 모두 통과했고, helper export surface도 유지됐다.
