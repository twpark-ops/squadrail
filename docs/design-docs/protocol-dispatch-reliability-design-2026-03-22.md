# Protocol Dispatch Reliability Design

상태: implemented
날짜: 2026-03-22  
작성자: Taewoong Park

## 문제

현재 protocol message 저장은 [issues.ts](/home/taewoong/company-project/squadall/server/src/routes/issues.ts) 에서 `appendMessage()` 트랜잭션으로 커밋되고, 후속 dispatch는 그 뒤에 별도 호출된다.

이 구조는 아래 위험을 만든다.

1. protocol state는 이미 전이됐는데 recipient wakeup은 안 간다
2. 커밋 직후 프로세스 크래시 시 dangling state가 남는다
3. 실패 시 `"agents may not be notified"` 로그만 남고 복구 계약이 약하다

즉, 현재 문제는 **message durability**와 **dispatch durability**가 분리돼 있다는 점이다.

## 현재 흐름

1. API route가 protocol message를 검증한다
2. `appendMessage()`가 message/state/comment를 커밋한다
3. route가 retrieval hint를 계산한다
4. route가 `protocolExecution.dispatchMessage()`를 호출한다
5. dispatch 실패 시 경고만 남기고 요청은 성공할 수 있다

## 요구사항

1. protocol state commit과 dispatch intention 사이에 유실 구간이 없어야 한다
2. dispatch 실패는 재시도 가능해야 한다
3. recovery는 idempotent해야 한다
4. operator가 현재 pending dispatch를 볼 수 있어야 한다

## 대안

### A. Transactional outbox

message append 트랜잭션 안에서 `protocol_dispatch_outbox` row를 같이 적재하고, 별도 worker가 outbox를 소비한다.

장점:

- durability가 가장 강하다
- retry / dead-letter / metrics 설계가 명확하다
- dispatch를 route lifecycle과 분리할 수 있다

단점:

- 테이블, consumer, 상태모델이 추가된다
- 현재 route-level retrieval hint 계산과 결합점이 많아 초기 변경폭이 크다

### B. Reconciliation sweep

현재 구조를 유지하되, `appendMessage` 이후 일정 조건을 만족하는 message/state를 주기적으로 찾아 dispatch 누락을 복구한다.

장점:

- 구현이 작다
- 현재 코드에 자연스럽게 붙일 수 있다

단점:

- strict outbox보다 약하다
- commit 직후 짧은 유실 윈도우는 그대로 남는다

## 추천

이번 축은 **2단계 전략**이 맞다.

1. 단기:
   reconciliation sweep 추가
2. 중기:
   transactional outbox로 승격

이유:

- 지금 당장 막아야 할 건 dangling state의 운영 리스크다
- 현재 route/brief/dispatch 결합이 커서 outbox를 한 번에 넣으면 회귀 범위가 넓다
- sweep으로 즉시 리스크를 낮춘 뒤 outbox로 승격하는 편이 안전하다

## 단기 설계: reconciliation sweep

### 대상

- state가 handoff/workflow transition을 끝냈다
- 마지막 protocol message가 dispatch-required message다
- 최근 dispatch activity / wakeup evidence가 없다
- issue가 terminal/cancelled가 아니다

### 구현 위치

- heartbeat watchdog 계열 또는 별도 reliability worker
- 후보:
  - `server/src/services/heartbeat.ts`
  - 새 helper: `server/src/services/protocol-dispatch-reconciliation.ts`

### 동작

1. recent protocol message를 읽는다
2. dispatch-required message인지 판단한다
3. 이미 wakeup/dispatch log가 있으면 skip
4. 없으면 recipient hint를 재계산한다
5. `protocolExecution.dispatchMessage()`를 idempotent하게 재시도한다
6. activity에 reconciliation reason을 남긴다

### idempotency

- message id 기준으로 한 번 이상 dispatch되어도 안전해야 한다
- 기존 wake dedupe / superseded run cancel 규칙을 그대로 사용한다
- recovery reason을 `protocol_dispatch_reconciliation`으로 명시한다

## 중기 설계: transactional outbox

### 새 테이블

- `protocol_dispatch_outbox`
  - `id`
  - `company_id`
  - `issue_id`
  - `protocol_message_id`
  - `dispatch_state` (`pending`, `processing`, `sent`, `failed`, `dead_letter`)
  - `attempt_count`
  - `next_attempt_at`
  - `last_error`
  - `created_at`
  - `updated_at`

### 쓰기 경로

`appendMessage()` 트랜잭션 안에서:

1. message/state 저장
2. outbox row insert

### 소비 경로

1. worker가 `pending/failed` row를 claim
2. recipient hint 계산
3. dispatch 실행
4. 성공 시 `sent`
5. 실패 시 backoff 후 `failed`

## 검증 시나리오

1. message append 후 dispatch 직전 예외를 강제로 던져도 sweep이 복구한다
2. 같은 message를 여러 번 reconciliation해도 중복 실행이 생기지 않는다
3. terminal issue는 reconciliation 대상에서 빠진다
4. superseded lane은 stale wake가 아니라 현재 lane만 복구한다

## 범위 밖

- full queue observability UI
- dead-letter operator action panel
- protocol message 자체의 durable event sourcing 전환

## 다음 작업

1. reconciliation helper와 focused tests 추가
2. activity/log schema에 reconciliation reason 표준화
3. outbox row를 `appendMessage()` 트랜잭션 안에서 적재
4. reconciliation worker를 outbox 우선 소비 구조로 승격
5. route-level sync dispatch와 worker recovery가 같은 settle contract를 공유
