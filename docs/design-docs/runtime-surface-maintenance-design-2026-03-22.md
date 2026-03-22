# Runtime Surface Maintenance Design

상태: implemented
날짜: 2026-03-22  
작성자: Taewoong Park

## 문제

현재 런타임 표면에는 네 가지 운영성 debt가 남아 있다.

1. [heartbeat.ts](/home/taewoong/company-project/squadall/server/src/services/heartbeat.ts)가 지나치게 커서 session/watchdog/dispatch 변경이 서로 얽힌다.
2. [IssueDetail.tsx](/home/taewoong/company-project/squadall/ui/src/pages/IssueDetail.tsx)가 query orchestration까지 한 파일에 몰려 있어 탭 분리가 어렵다.
3. [issues.ts](/home/taewoong/company-project/squadall/server/src/routes/issues.ts) 의 `includeSubtasks` 경로가 root issue마다 별도 summary query를 날려 N+1이 생긴다.
4. [dashboard.ts](/home/taewoong/company-project/squadall/server/src/services/dashboard.ts)는 일부 feed를 넓게 읽고 뒤에서 slice해, limit가 있어도 broad-load가 남는다.

이번 배치는 correctness를 바꾸지 않고, 유지보수성과 요청량을 동시에 낮추는 first slice다.

## 목표

1. `IssueDetail` query orchestration을 page 본문에서 분리해 탭/기능 단위 분할의 기반을 만든다.
2. issue list의 internal work summary를 batched query로 바꿔 root issue 수에 선형으로 늘던 query 수를 줄인다.
3. dashboard feed가 `limit`보다 과도하게 많은 row를 읽지 않도록 overscan-based 제한을 둔다.
4. `heartbeat.ts`에서 pure helper와 priority/session 유틸을 분리해 god-service 분해의 첫 단계를 만든다.

## 비목표

1. `heartbeat.ts` 전체 구조를 이번 배치에서 완전히 쪼개지는 않는다.
2. `IssueDetail`를 탭별 page component로 완전 분리하지 않는다.
3. dashboard 전체 pagination을 한 번에 도입하지 않는다.
4. issue list summary를 materialized table로 승격하지 않는다.

## 설계 결정

### 1. IssueDetail은 query hook로 먼저 분리한다

`IssueDetail`은 surface별 component split 전에 query orchestration을 hook로 빼는 편이 안전하다.

- 장점:
  - page JSX와 data wiring을 분리할 수 있다
  - 기존 polling gate helper를 재사용할 수 있다
  - 이후 `protocol`, `delivery`, `changes` panel을 하위 component로 옮기기 쉽다
- 단점:
  - hook 반환 값이 많아질 수 있다
  - 첫 배치에서는 파일 수가 늘어난다

### 2. issue list summary는 route loop가 아니라 service batch를 만든다

현재 route가 root issue id마다 `getInternalWorkItemSummary()`를 호출한다. 이것은 routing layer가 batching 책임을 지는 구조라 좋지 않다.

이번 배치에서는 [issues.ts service](/home/taewoong/company-project/squadall/server/src/services/issues.ts)에 `listInternalWorkItemSummaries(parentIssueIds)`를 추가해, route는 batched 결과를 merge만 하도록 만든다.

### 3. dashboard는 overscan limit를 먼저 둔다

완전한 cursor pagination보다 먼저, `limit * overscan`만 읽고 enrich/sort/slice 하도록 바꾸는 것이 변경 폭 대비 이득이 크다.

추천 overscan:

- `teamSupervision`: `limit * 5`
- `recoveryQueue`: source별 `limit * 5`

이 값은 correctness를 바꾸지 않으면서 broad-load를 줄이는 pragmatic cap이다.

### 4. heartbeat는 pure helper re-export 전략으로 분리한다

테스트와 다른 모듈이 [heartbeat.ts](/home/taewoong/company-project/squadall/server/src/services/heartbeat.ts) 에서 직접 helper를 import하고 있다. 그래서 이번 배치에서는:

1. 새 helper module로 구현을 옮기고
2. `heartbeat.ts`는 import 후 re-export

하는 방식을 쓴다. 이렇게 하면 runtime behavior와 test surface를 거의 바꾸지 않고 line count를 줄일 수 있다.

## 세부 변경

### heartbeat

새 module 후보:

- `heartbeat-runtime-utils.ts`
- `heartbeat-dispatch-priority.ts`

분리 대상:

- session / runtime context merge helpers
- adapter session codec helpers
- dispatch priority 계산 helpers

### issues list

- `listInternalWorkItemSummaries(parentIssueIds: string[])`
- label enrichment 1회
- `parentId` 기준 group 후 summary map 반환

### dashboard

- `teamSupervision` source query에 overscan limit 적용
- `recoveryQueue` source query에 overscan limit 적용

### frontend

- `useIssueDetailQueries()` hook 추가
- `IssueDetail.tsx`는 hook 반환값으로 렌더링만 담당

## 리스크

1. dashboard source limit가 너무 낮으면 post-sort 후 필요한 row가 일부 잘릴 수 있다.
2. `IssueDetail` hook 반환값이 지나치게 크면 다른 형태의 복잡성이 생길 수 있다.
3. `heartbeat` helper split 시 import cycle을 조심해야 한다.

## 검증

1. `dashboard-service` focused tests
2. `heartbeat` internal/session helper tests
3. `IssueDetail` UI typecheck/build
4. `docs:check`
5. `git diff --check`
