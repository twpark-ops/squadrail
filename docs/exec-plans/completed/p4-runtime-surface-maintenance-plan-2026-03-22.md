---
title: "Runtime Surface Maintenance Plan Phase 4"
owner: "taewoong"
status: "completed"
last-reviewed: "2026-03-22"
---

# Goal

`heartbeat` 본체에서 dispatch/lifecycle orchestration을 더 분리해 service를 run execution 중심으로 좁힌다.

# Scope

## In

- `heartbeat-dispatch-lifecycle.ts` 추가
- `claimQueuedRun`, `applyDispatchPrioritySelection`, `handleDispatchWatchdog`, `finalizeAgentStatus`, `reapOrphanedRuns` 분리
- 기존 `heartbeat` export surface 유지
- 설계 문서와 maps 동기화

## Out

- `heartbeat.ts` full decomposition
- protocol retry / wake routing 전체 module split
- additional dashboard summary surface pagination
- QA contract execution tooling

# Invariants

- dispatch watchdog semantics는 그대로 유지한다
- orphaned run reap semantics는 그대로 유지한다
- agent status publish contract는 그대로 유지한다
- `heartbeat-dispatch-watchdog` focused tests는 계속 green이다

# Implementation Plan

1. dispatch/lifecycle cluster의 의존성을 정리한다.
2. factory module에 dispatch/orphan-reap/agent-status finalize를 옮긴다.
3. `heartbeat.ts`는 injected helper를 사용하도록 교체한다.
4. focused tests와 server typecheck를 다시 잠근다.
5. 설계 문서와 completed maps를 동기화한다.

# Validation

- `pnpm --filter @squadrail/server exec vitest run src/__tests__/heartbeat-dispatch-watchdog.test.ts src/__tests__/heartbeat-internal-helpers.test.ts src/__tests__/heartbeat-workspace-session.test.ts`
- `pnpm --filter @squadrail/server typecheck`
- `pnpm docs:check`
- `git diff --check`

# Exit Criteria

- `heartbeat.ts`에서 dispatch/lifecycle cluster가 별도 module로 이동한다
- dispatch watchdog focused tests가 green이다
- server typecheck가 green이다
- 설계/plan 문서가 현재 상태로 맞춰진다

# Result

1. `heartbeat-dispatch-lifecycle.ts`를 추가해 dispatch claim, priority selection, dispatch watchdog, orphan reap, agent status finalize를 factory module로 이동했다.
2. `heartbeat.ts`는 해당 기능을 직접 구현하지 않고 injected helper를 사용하도록 정리됐다.
3. 기존 focused tests와 typecheck는 모두 통과했고, summary surface pagination은 `Team` / `Runs`까지만 확대하고 `Inbox` / `Overview`는 snapshot surface로 유지했다.
