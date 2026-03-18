# Run-First Burn-In Priority Plan

작성일: 2026-03-11  
작성자: Taewoong Park (park.taewoong@airsmed.com)

## 목적

최근 RAG와 retrieval 최적화 작업은 방향 자체는 맞았지만, 실제 제품 임팩트 기준으로는 `실조직 burn-in`보다 앞서기 시작했다.

이 문서는 우선순위를 다시 `run first, optimize later`로 고정한다.

핵심 질문은 하나다.

`18-agent 조직이 실제 이슈를 반복적으로 완주할 수 있는가?`

이 질문이 닫히기 전에는 retrieval 미세튜닝을 계속 늘리는 것이 아니라, replay gate와 burn-in을 우선 검증해야 한다.

## 현재 판단

이미 검증된 것:

- PM / TL / Engineer / Reviewer / QA / Close를 포함한 real-org 대표 시나리오
- replay retrieval에서 `candidateCacheHit`, `finalCacheHit`, `exactPathSatisfied`, `multiHopGraphHitCount` 확인
- organizational memory ingest, PM projection, QA separate gate backend kernel

아직 닫히지 않은 것:

- replay readiness gate와 historical coverage hygiene의 분리
- 18-agent 조직을 여러 실제 이슈로 반복 가동하는 burn-in
- blocked / timeout / legacy protocol semantics 정리

즉 현재 병목은 `retrieval 기능 부족`보다 `실행 검증과 운영 게이트 정리`다.

최신 burn-in 기준으로는 `root coordinating issue -> child fan-out -> parallel execution -> reviewer -> QA -> done`이 실제로 닫혔다.
따라서 현재 활성 최우선은 이제 `blocked / legacy / protocol semantics cleanup`이다.

추가 제품 판단:

- 기본 실행 모델은 `single engineer per child + reviewer + QA`로 유지한다.
- 병렬화는 subtask 분해 + TL staffing으로 달성한다 (같은 이슈에 2명이 아닌, 이슈를 나눠서 각각 실행).
- 프로토콜/heartbeat/workspace 모두 단일 엔지니어 기준이며, 이 구조가 현재 제품 north star에 맞다.

## 재정렬된 우선순위

### 1. Replay E2E Gate Normalization

목표:

- replay 기능 성공과 historical quality hygiene를 분리한다.
- 기능이 이미 성공했는데 readiness gate 때문에 전체가 실패로 보이는 문제를 정리한다.

세부 단계:

1. `1-A commit-after ingest rollout`
   - issue / protocol organizational memory ingest를 commit 이후에만 실행
2. `1-B historical backfill reliability`
   - backfill 중 embedding / chunking 실패 원인 제거
3. `1-C readiness gate threshold split`
   - functional replay readiness와 historical memory hygiene를 분리

완료 기준:

- replay wrapper가 실제 기능 실패와 historical data hygiene를 구분해 보고한다.

### 2. 18-Agent Real-Org Burn-In

목표:

- canonical 18-agent 조직을 실제로 3~5개 혼합 이슈로 굴려서 운영 병목을 드러낸다.

시나리오:

- 간단한 fast-lane candidate 1~2개
- 일반 구현 이슈 1~2개
- cross-project / QA-heavy 이슈 1개

선행 구현:

- root coordinating issue 아래 child work item이 각기 다른 `projectId`를 가질 수 있어야 한다.
- 현재 커널은 hidden child work item을 만들 수 있지만, project별 fan-out override가 없으면 진짜 멀티프로젝트 burn-in이 아니다.
- 따라서 burn-in 2단계의 첫 슬라이스는 `cross-project child work item support`다.

관찰 항목:

- reassignment
- blocked / timeout
- QA gate
- close / merge candidate
- knowledge ingest
- retrieval brief 품질

완료 기준:

- 여러 이슈가 동시에 돌아도 stuck run과 queue pollution 없이 완주 가능하다.
- 멀티프로젝트 coordinating scenario에서 최소 2개 이상의 distinct project lane이 실제 child work item으로 병렬 fan-out된다.
- 상세 실행계획은 [18-agent-real-org-burn-in-plan.md](/home/taewoong/company-project/squadall/docs/18-agent-real-org-burn-in-plan.md) 기준으로 관리한다.

### 3. Blocked Timeout + Legacy Semantics Cleanup

상태: 진행 중

목표:

- burn-in에서 노이즈를 만드는 blocked / timeout / legacy protocol 경로를 줄인다.

범위:

- blocked escalation semantics 정리
- legacy alias / legacy review mode 정리
- timeout reminder와 escalation 의미 정리
- protocol-required retry가 stale workflow state를 따라 재기동하지 않게 축소

현재 반영:

- `blocked_resolution_timeout` 추가
- `protocol_required_retry`를 workflow-state-aware로 제한

### 4. Retrieval God-File Refactor

목표:

- `issue-retrieval.ts`를 유지보수 가능한 단위로 분해한다.

분리 목표:

- `retrieval-query`
- `retrieval-scoring`
- `retrieval-graph`
- `retrieval-orchestrator`

### 5. Rerank Provider Abstraction

목표:

- OpenAI 단일 rerank 의존을 완화한다.

### 6. Execution Lane Classifier

목표:

- `fast / normal / deep` 3단 분류를 도입한다.

원칙:

- 시스템 1차 판정
- TL 최종 override
- 실행 중 escalation 허용

### 7. Fast Lane Optimization

목표:

- 가벼운 이슈는 더 짧은 brief, 더 좁은 test scope, 더 빠른 scheduler/poll로 처리한다.

### 8. Deeper Multi-Hop

목표:

- chunk-link 기반 연결성을 더 깊게 만들어 `지식 그래프` 체감을 높인다.

### 9. Ranking / Cache / Trend Consolidation

목표:

- ranking stabilization 2
- candidate / final-hit cache 고도화
- trend surface

이 세 가지는 burn-in 이후 병목 데이터를 기준으로 다시 순서를 미세조정한다.

### 10. Cross-Issue Memory Reuse

목표:

- 과거 issue / review / close artifact가 다음 issue planning과 retrieval에 직접 재사용되게 만든다.

## 즉시 실행 순서

이번 배치에서 바로 할 일:

1. replay gate normalization 완료
2. cross-project child work item support 구현
3. 18-agent burn-in 계획 고정 및 multi-project coordinated scenario 실구현
4. blocked / legacy cleanup 설계 시작

이번 배치에서 아직 하지 않을 일:

- multi-hop 추가 튜닝
- ranking stabilization 2
- cache 추가 고도화
- trend surface
- cross-issue memory

이들은 burn-in 이후 실제 병목 데이터로 다시 우선순위를 재정렬한다.

## 판단 기준

다음 질문에 `예`가 나오면 우선순위가 맞다.

1. 실제 조직이 반복적으로 일을 끝내는가?
2. stuck / blocked / timeout이 먼저 보이는가?
3. retrieval 최적화보다 운영 병목이 더 크다는 증거가 있는가?

현재 답은 모두 `예`다.

따라서 지금은 retrieval 미세조정보다 `실행 검증과 운영 안정화`가 앞선다.
