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

추가로, 실제 제품이 의미 있으려면 단일 프로젝트 이슈만 도는 것이 아니라
하나의 상위 요구가 여러 저장소와 역할로 분해되어 병렬로 진행될 수 있어야 한다.

이 계획에서 말하는 "18-agent 조직 burn-in"은 다음을 검증하는 것을 뜻한다.

- root coordinating issue가 상위 목표와 acceptance criteria를 유지한다.
- project별 hidden child work item이 서로 다른 project / engineer lane으로 병렬 분배된다.
- TL / PM / CTO는 root issue를 통해 하위 병렬 작업을 조율한다.
- 각 child work item은 독립 worktree / reviewer / QA gate를 가진다.
- root issue는 child work item 완료를 수집해 최종 close / knowledge ingest로 수렴한다.

## 진입 조건

burn-in 시작 전에 아래가 만족돼야 한다.

1. replay readiness gate가 기능 성공과 historical hygiene를 구분해 보고한다.
2. organizational memory ingest가 create / protocol commit 이후 안정적으로 실행된다.
3. canonical 18-agent live org drift가 없다.
4. 멀티프로젝트 coordinating scenario를 위해 child work item의 `projectId` override가 가능하다.

## 시나리오 구성

총 5개 이슈를 동시에 운용한다.

이 중 최소 1개는 "멀티프로젝트 coordinating issue"여야 한다.

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

### Scenario 4. Multi-Project Coordinated Delivery

- root issue:
  - 프로젝트 비지정 또는 상위 coordination project
- child work items:
  - `swiftsight-agent`
  - `swiftsight-cloud`
  - `swiftcl`
  - 필요 시 `swiftsight-report-server`
- 유형:
  - 하나의 상위 요구가 여러 코드베이스 수정으로 분해되는 coordinated delivery
- 기대:
  - PM 또는 CTO routing
  - root issue 아래 project별 hidden child work item 생성
  - 서로 다른 engineer lane이 병렬로 실행
  - reviewer / QA가 child work item별로 독립 검토
  - 현재 burn-in harness에서는 root issue를 projection 직후 archive
    - 구현: PM intake projection에 `coordinationOnly=true`를 사용
    - 이유: product kernel에 아직 dedicated `coordination-only root` workflow state가 없어, projectless root가 unintended engineer lane으로 drift할 수 있음
  - 장기적으로는 root issue가 child 상태를 수집한 뒤 close
  - cross-project retrieval과 organizational memory가 하위 작업에 재사용

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
6.5. concurrent child work item fan-out
  - number of active child work items
  - number of distinct project lanes active at once
  - number of parallel engineer runs
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
6. 멀티프로젝트 coordinating issue가 실제 child work item 병렬 실행으로 fan-out되지 못한다.

## 종료 기준

다음이 만족되면 burn-in 성공이다.

1. 5개 시나리오 중 4개 이상이 `done`
2. blocked / timeout 시나리오도 escalation 경로가 설명 가능
3. 모든 done issue가 organizational memory coverage에 반영
4. replay / cross-project retrieval 품질 지표가 하락하지 않음
5. 멀티프로젝트 coordinating issue에서 최소 2개 이상의 project lane이 실제로 병렬 실행됨

## 실행 순서

### Burn-In Batch 1

1. replay gate normalization 완료 여부 확인
2. company readiness snapshot 저장
3. 5개 시나리오 issue 생성
4. 30분 관찰
5. 종료 / cleanup
6. metric snapshot 저장

실행 명령:

```bash
SQUADRAIL_BASE_URL=http://127.0.0.1:3144 pnpm e2e:cloud-swiftsight-burn-in
```

### Burn-In Batch 2

Batch 1에서 나온 blocked / timeout / retrieval issue를 반영한 뒤 같은 5개를 다시 실행한다.

목표는 최적화가 아니라 `회귀 없는 반복 성공`이다.

## 후속 연결

burn-in 결과에 따라 우선순위를 다시 나눈다.

- blocked / timeout이 문제면:
  - blocked timeout + legacy cleanup 우선
- simple issue가 과하게 느리면:
  - execution lane classifier + fast lane optimization 우선
- cross-project evidence나 child fan-out이 약하면:
  - deeper multi-hop / ranking stabilization 우선
- replay cache가 흔들리면:
  - cache provenance / invalidation normalization 우선

## 현재 구조 한계

현재 커널은 root issue 하나에 "한 명의 primary engineer / reviewer"를 직접 병렬로 여러 명 붙이는 방식이 아니다.

따라서 멀티프로젝트 동시 작업은 다음 방식으로 수행해야 한다.

1. root coordinating issue 생성
2. project별 hidden child work item 생성
3. child work item마다 assignee / reviewer / workspace를 독립 배정
4. root issue는 coordination / aggregation만 담당

즉, 병렬성의 단위는 "한 issue에 여러 engineer"가 아니라 "한 root issue 아래 여러 child work item"이다.

추가로 현재 burn-in 기준에서 중요한 구현 체크는 다음이다.

1. child work item이 parent project를 무조건 상속하면 멀티프로젝트 coordinating scenario는 성립하지 않는다.
2. 따라서 burn-in 전에 child work item `projectId` override가 실제 DB / workspace / assignment / retrieval까지 전달되는지 확인해야 한다.
