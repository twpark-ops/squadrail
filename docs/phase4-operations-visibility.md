# Phase 4 Operations & Visibility

작성일: 2026-03-10

## 목표

Phase 4의 목표는 운영자가 DB를 직접 뒤지지 않고도 `어디가 막혔는지`, `무엇을 먼저 개입해야 하는지`, `실행이 실제로 건강한지`를 UI와 요약 API만으로 파악하게 만드는 것이다.

핵심 질문은 세 가지다.

1. stuck run, blocked implementation, recovery candidate가 요약 숫자와 큐로 보이는가
2. lead / reviewer / human board handoff가 어디에서 멈췄는지 바로 보이는가
3. 최근 24시간 실행 품질을 장기 추세 없이도 즉시 판단할 수 있는가

## Slice 구성

### Slice 1. Execution Reliability Surface

이번 턴에 완료한 범위:

- dashboard summary에 execution reliability 집계를 추가
- `running`, `queued`, `dispatch watchdog redispatch`, `dispatch_timeout`, `process_lost`, `workspace_required`를 24h 기준으로 노출
- Dashboard 상단 metric에서 execution risk를 바로 볼 수 있게 반영
- Phase 3에서 추가한 workspace lifecycle state를 이후 운영 표면에서 재사용할 수 있도록 context/artifact에 유지

완료 기준:

1. 운영자가 Dashboard 첫 화면에서 execution health를 3초 안에 파악한다.
2. dispatch stall / blocked implementation / process_lost 추세를 activity 없이도 요약 숫자로 볼 수 있다.

### Slice 2. Recovery Queue + Handoff Blockers

이번 턴에 완료한 범위:

- recovery queue에 `workspace_required`, `dispatch_timeout`, `process_lost` runtime case를 추가
- `changes_requested`, `awaiting_human_decision`, `approved`를 handoff blocker bucket으로 분리
- optimized dashboard에서 recovery drill-down UI와 board note / resolve violation 액션을 바로 수행 가능하게 연결

완료 기준:

1. 운영자는 recovery queue만 보고 다음 수동 개입 대상을 고를 수 있다.
2. handoff blocker가 protocol queue와 섞이지 않고 별도 시야로 보인다.

### Slice 3. SLA & Trend Metrics

이번 턴에 완료한 범위:

- 최근 24h execution reliability count를 dashboard summary와 metric card에 반영
- `handoffBlockerCount`, `staleQueue`, `review backlog`, `execution risks`를 같은 화면에서 함께 보이도록 정리
- 운영자가 recovery drill-down, protocol queue, execution reliability를 한 화면에서 교차 판단 가능하게 구성

완료 기준:

1. 운영자는 최근 delivery health를 숫자로 빠르게 비교할 수 있다.
2. 특정 adapter 또는 팀 구성에서 failure hot spot을 찾을 수 있다.

## 설계 원칙

1. 새 운영 테이블을 먼저 만들지 않는다.
2. `heartbeat_runs`, `heartbeat_run_events`, `issue_protocol_state`, `issue_protocol_violations`를 우선 재사용한다.
3. 실시간성보다 `판단 가능한 요약`을 먼저 제공한다.
4. recovery action은 기존 protocol/recovery queue 액션과 연결하고, 새로운 제어면을 급하게 늘리지 않는다.

## 현재 상태

- Phase 4는 V1 범위 기준으로 완료됐다.
- Dashboard는 이제 execution reliability, protocol queues, handoff blockers, recovery drill-down을 함께 노출한다.
- 다음 우선순위는 새 phase가 아니라 운영 고도화다. 예를 들면 chunk 최적화, 세부 SLA 차트, adapter별 deep analytics 같은 후속 개선이 남아 있다.
