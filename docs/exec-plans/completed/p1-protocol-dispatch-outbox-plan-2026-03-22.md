---
title: "Protocol Dispatch Outbox Execution Plan"
owner: "taewoong"
status: "completed"
last-reviewed: "2026-03-22"
---

# Goal

`appendMessage()` 커밋과 follow-up dispatch 사이의 유실 구간을 줄이기 위해, protocol message 저장과 같은 트랜잭션 안에서 dispatch intention을 durable하게 적재하고 worker가 이를 소비하도록 만든다.

# Scope

## In

- `issue_protocol_dispatch_outbox` 테이블과 migration
- `appendMessage()` 트랜잭션 안 outbox enqueue
- route-level sync dispatch settle contract
- reconciliation worker의 outbox 우선 소비
- focused tests, typecheck, fresh DB verification

## Out

- full dead-letter operator UI
- transactional claim/lease 기반 고급 outbox worker
- QA contract 실행 제품화

# Invariants

- protocol message commit과 dispatch intention insert는 같은 트랜잭션에 있어야 한다
- sync dispatch 성공/실패와 worker reconciliation은 같은 status vocabulary를 써야 한다
- legacy message는 outbox row가 없더라도 fallback reconciliation로 복구 가능해야 한다
- terminal issue, no wake target, existing evidence는 idempotent `no_action` 또는 `dispatched`로 settle되어야 한다

# Implementation Plan

1. outbox schema/migration과 service helper 추가
2. `appendMessage()`에 outbox enqueue 연결
3. route sync dispatch와 reconciliation이 shared settle contract를 쓰도록 정리
4. focused tests와 docs를 current state 기준으로 잠근다

# Validation

- `pnpm --filter @squadrail/server exec vitest run src/__tests__/issue-protocol-service.test.ts src/__tests__/protocol-dispatch-reconciliation.test.ts`
- `pnpm --filter @squadrail/server exec vitest run -c vitest.heavy.config.ts src/__tests__/issues-routes.test.ts -t "marks the protocol dispatch outbox|shouldDispatchBeforeProtocolRetrieval|resolvePreRetrievalAutoAssistRecipient"`
- `pnpm --filter @squadrail/db typecheck`
- `pnpm --filter @squadrail/server typecheck`
- `pnpm docs:check`
- `pnpm db:verify-fresh`

# Exit Criteria

- new protocol messages always create a durable outbox record inside `appendMessage()`
- sync route dispatch settles outbox rows on success and retry on failure
- reconciliation consumes pending outbox rows before legacy fallback scan
- focused tests, typecheck, docs check, fresh DB verify are all green

# Result

- `issue_protocol_dispatch_outbox` migration과 schema가 추가되었다.
- `appendMessage()`가 같은 트랜잭션 안에서 outbox row를 적재한다.
- sync route dispatch는 success / no_action / retry settle contract를 outbox 상태와 공유한다.
- reconciliation worker는 pending outbox를 우선 소비하고, legacy state는 fallback scan으로만 복구한다.
- focused tests, server/db typecheck, docs check, targeted heavy routes tests는 green이다.
- `pnpm db:verify-fresh`도 `0045_protocol_dispatch_outbox.sql`까지 포함한 fresh migration path에서 green이다.
