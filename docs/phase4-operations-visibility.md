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

이번 턴에 시작한 범위:

- dashboard summary에 execution reliability 집계를 추가
- `running`, `queued`, `dispatch watchdog redispatch`, `dispatch_timeout`, `process_lost`, `workspace_required`를 24h 기준으로 노출
- Dashboard 상단 metric에서 execution risk를 바로 볼 수 있게 반영
- Phase 3에서 추가한 workspace lifecycle state를 이후 운영 표면에서 재사용할 수 있도록 context/artifact에 유지

완료 기준:

1. 운영자가 Dashboard 첫 화면에서 execution health를 3초 안에 파악한다.
2. dispatch stall / blocked implementation / process_lost 추세를 activity 없이도 요약 숫자로 볼 수 있다.

### Slice 2. Recovery Queue + Handoff Blockers

다음 작업 범위:

- recovery queue에 `workspace_required`, `dispatch_timeout`, `process_lost`를 우선순위 큐로 노출
- human decision / changes requested / approved but not closed 상태를 handoff blocker 뷰로 분리
- issue/work item 기준 owner, last transition age, next action을 하나의 테이블에서 보이게 정리

완료 기준:

1. 운영자는 recovery queue만 보고 다음 수동 개입 대상을 고를 수 있다.
2. handoff blocker가 protocol queue와 섞이지 않고 별도 시야로 보인다.

### Slice 3. SLA & Trend Metrics

다음 작업 범위:

- dispatch watchdog redispatch rate
- review turnaround 시간
- changes requested 재진입률
- blocked implementation age
- recovery case 처리 시간

완료 기준:

1. 운영자는 최근 24h/7d delivery health를 숫자로 비교할 수 있다.
2. 특정 adapter 또는 팀 구성에서 failure hot spot을 찾을 수 있다.

## 설계 원칙

1. 새 운영 테이블을 먼저 만들지 않는다.
2. `heartbeat_runs`, `heartbeat_run_events`, `issue_protocol_state`, `issue_protocol_violations`를 우선 재사용한다.
3. 실시간성보다 `판단 가능한 요약`을 먼저 제공한다.
4. recovery action은 기존 protocol/recovery queue 액션과 연결하고, 새로운 제어면을 급하게 늘리지 않는다.

## 현재 상태

- Phase 3 execution hardening 신호는 이제 summary/UI에서 소비할 준비가 됐다.
- Dashboard에는 execution reliability 요약이 올라가기 시작했다.
- 다음 구현 우선순위는 `Slice 2 recovery queue + handoff blockers`다.
