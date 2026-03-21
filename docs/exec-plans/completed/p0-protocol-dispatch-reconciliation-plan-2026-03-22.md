# P0 Protocol Dispatch Reconciliation Plan

## Goal

`issue.protocol_message.created` 커밋 이후 `protocolExecution.dispatchMessage()` 전에 프로세스가 죽어도,
다음 scheduler sweep에서 pending protocol dispatch를 다시 깨워 dangling workflow state를 없앤다.

## Scope

- 마지막 protocol message 기준 pending dispatch candidate scan
- active wakeup/run evidence가 없는 message만 reconciliation dispatch
- local-trusted pre-retrieval reroute semantics 유지
- stored brief 재주입으로 wake context 품질 보존

## Non-Goals

- transactional outbox 도입
- protocol timeout worker 재설계
- heartbeat god-service 분해

## Implementation

1. Route에 묶여 있던 pre-retrieval reroute policy를 service helper로 분리한다.
2. `protocolDispatchReconciliationService`를 추가한다.
3. Scheduler tick에서 `reconcilePendingDispatches()`를 같이 호출한다.
4. 마지막 protocol message가 아래 조건을 만족하면 재디스패치한다.
   - issue not done/cancelled
   - blocked-by-current-message 아님
   - dispatch plan에 wakeup 대상이 있음
   - queued/claimed/deferred wakeup 또는 queued/claimed/running run evidence 없음
5. role별 latest task brief를 recipient hint로 재주입한다.

## Validation

- focused service tests
- route export regression (`issues-routes.test.ts` existing coverage 유지)
- `pnpm --filter @squadrail/server typecheck`
- `pnpm docs:check`

## Done When

- commit-after / dispatch-before crash gap를 scheduler sweep이 복구한다.
- reroute-required assignment에서도 reconciliation이 TL에 잘못 wake하지 않는다.
- no-op/blocked/already-dispatched message는 재디스패치하지 않는다.
