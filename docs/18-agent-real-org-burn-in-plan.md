# 18-Agent Real-Org Burn-In Plan

작성일: 2026-03-11  
작성자: Taewoong Park <park.taewoong@airsmed.com>

## 목적

대표 시나리오 한두 개 성공으로는 충분하지 않다.

이 계획의 목적은 canonical 18-agent 조직이 실제로 여러 이슈를 동시에 받아서 아래를 반복적으로 감당할 수 있는지 확인하는 것이다.

- PM / TL routing
- engineer execution
- reviewer / QA gate
- blocked / timeout / escalation
- close / knowledge ingest
- merge candidate handoff

## 진입 조건

burn-in 시작 전에 아래가 만족돼야 한다.

1. replay readiness gate가 기능 성공과 historical hygiene를 구분해 보고한다.
2. organizational memory ingest가 create / protocol commit 이후 안정적으로 실행된다.
3. canonical 18-agent live org drift가 없다.

## 시나리오 구성

총 5개 이슈를 동시에 운용한다.

### Scenario 1. Fast-Lane Candidate

- 프로젝트: `swiftsight-agent`
- 유형: 단일 파일 + 단일 테스트 범위
- 기대:
  - TL reassignment
  - fast-lane candidate 분류 가능성
  - 짧은 implementation loop

### Scenario 2. Normal Engineering Loop

- 프로젝트: `swiftsight-cloud`
- 유형: 일반 구현 + review + QA
- 기대:
  - standard PM -> TL -> Engineer -> Reviewer -> QA -> Close
  - worktree evidence / verification artifacts / merge candidate 생성

### Scenario 3. QA-Heavy Loop

- 프로젝트: `swiftcl`
- 유형: reviewer 승인 뒤 QA에서 실제로 차단 또는 통과
- 기대:
  - `qa_pending`, `under_qa_review`
  - reviewer와 QA gate 분리 검증

### Scenario 4. Cross-Project Coordination

- 프로젝트: `swiftsight-worker` + `swiftsight-report-server`
- 유형: cross-project context required
- 기대:
  - PM 또는 CTO routing
  - cross-project retrieval
  - related project evidence 사용

### Scenario 5. Failure / Recovery Drill

- 프로젝트: 위 시나리오 중 하나 재사용
- 유형: blocked 또는 timeout을 의도적으로 유발할 수 있는 constrained issue
- 기대:
  - timeout reminder
  - escalation
  - blocked queue / recovery visibility

## 관찰 지표

각 이슈마다 아래를 기록한다.

1. total wall-clock duration
2. first assignment latency
3. implementation run count
4. review loop count
5. QA loop count
6. blocked / timeout / escalation count
7. retrieval quality
   - candidateCacheHit
   - finalCacheHit
   - exactPathSatisfied
   - graphHitCount
   - multiHopGraphHitCount
8. organizational memory ingest status
9. merge candidate readiness

## 실패 조건

아래 중 하나라도 발생하면 burn-in은 실패로 간주한다.

1. root issue가 stuck state로 15분 이상 머문다.
2. reviewer 또는 QA gate가 follow-up 없이 정지한다.
3. organizational memory ingest가 신규 issue / protocol에 빠진다.
4. merge candidate가 close evidence와 불일치한다.
5. recovery queue에 남은 이슈를 operator가 설명할 수 없다.

## 종료 기준

다음이 만족되면 burn-in 성공이다.

1. 5개 시나리오 중 4개 이상이 `done`
2. blocked / timeout 시나리오도 escalation 경로가 설명 가능
3. 모든 done issue가 organizational memory coverage에 반영
4. replay / cross-project retrieval 품질 지표가 하락하지 않음

## 실행 순서

### Burn-In Batch 1

1. replay gate normalization 완료 여부 확인
2. company readiness snapshot 저장
3. 5개 시나리오 issue 생성
4. 30분 관찰
5. 종료 / cleanup
6. metric snapshot 저장

### Burn-In Batch 2

Batch 1에서 나온 blocked / timeout / retrieval issue를 반영한 뒤 같은 5개를 다시 실행한다.

목표는 최적화가 아니라 `회귀 없는 반복 성공`이다.

## 후속 연결

burn-in 결과에 따라 우선순위를 다시 나눈다.

- blocked / timeout이 문제면:
  - blocked timeout + legacy cleanup 우선
- simple issue가 과하게 느리면:
  - execution lane classifier + fast lane optimization 우선
- cross-project evidence가 약하면:
  - deeper multi-hop / ranking stabilization 우선
- replay cache가 흔들리면:
  - cache provenance / invalidation normalization 우선
