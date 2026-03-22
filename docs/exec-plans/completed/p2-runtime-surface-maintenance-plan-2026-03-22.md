---
title: "Runtime Surface Maintenance Plan Phase 2"
owner: "taewoong"
status: "completed"
last-reviewed: "2026-03-22"
---

# Goal

`heartbeat` helper split 2차와 dashboard feed pagination 계약을 추가해, 유지보수성과 후속 UI 확장 기반을 더 단단하게 만든다.

# Scope

## In

- `heartbeat-wake-utils.ts` / `heartbeat-protocol-watchdog.ts` 분리
- dashboard `teamSupervision` / `recoveryQueue` `offset/hasMore` 계약 추가
- route/UI API backward-compatible 기본값 정렬
- focused tests 및 typecheck 갱신

## Out

- `heartbeat.ts` full service decomposition
- dashboard UI의 실제 infinite scroll / pager 도입
- `agentPerformance` / `protocolQueue` pagination
- QA contract execution tooling

# Invariants

- 기존 route shape는 `offset=0` 기본 호출에서 계속 동작한다
- dashboard sort semantics와 summary semantics는 유지한다
- `heartbeat.ts` runtime behavior는 helper split 전과 동일하다
- 기존 UI callers는 추가 인자 없이 계속 동작한다

# Implementation Plan

1. `heartbeat`에 남아 있던 wake/watchdog helper를 별도 module로 옮기고 re-export surface를 유지한다.
2. shared dashboard feed type에 pagination metadata를 추가한다.
3. dashboard service/route/UI API에 `offset` 기본값과 `hasMore/nextOffset`를 연결한다.
4. service/route focused tests와 server/ui typecheck를 다시 잠근다.
5. 설계 문서와 maps를 현재 상태 기준으로 동기화한다.

# Validation

- `pnpm --filter @squadrail/server exec vitest run src/__tests__/dashboard-service.test.ts src/__tests__/dashboard-routes.test.ts src/__tests__/heartbeat-internal-helpers.test.ts src/__tests__/heartbeat-workspace-session.test.ts`
- `pnpm --filter @squadrail/server typecheck`
- `pnpm --filter @squadrail/ui typecheck`
- `pnpm docs:check`
- `git diff --check`

# Exit Criteria

- `heartbeat.ts`가 wake/watchdog helper를 직접 소유하지 않고 별도 module을 사용한다
- `teamSupervision` / `recoveryQueue` feed가 `limit/offset/hasMore/nextOffset`를 반환한다
- route와 UI API가 `offset=0` 기본 경로에서 backward compatible 하게 유지된다
- focused tests와 typecheck가 green이다

# Result

1. `heartbeat.ts`는 `heartbeat-wake-utils.ts`, `heartbeat-protocol-watchdog.ts`를 import/re-export 하도록 정리됐다.
2. dashboard `teamSupervision` / `recoveryQueue`는 pagination metadata를 반환하고, service는 `offset + limit` 기준 overscan sourceLimit을 사용한다.
3. route와 UI API는 `offset`을 optional query param으로 열었고, 기존 호출은 `offset=0`으로 유지된다.
4. dashboard service/route tests와 heartbeat helper tests, server/ui typecheck가 모두 통과했다.
