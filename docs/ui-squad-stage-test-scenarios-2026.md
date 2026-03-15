---
title: "UI Squad Stage Test Scenarios 2026"
author: "Taewoong Park <park.taewoong@airsmed.com>"
date: "2026-03-15"
---

# UI Squad Stage Test Scenarios 2026

상태: planning  
브랜치: `feat/ui-agent-presence-2026`

## 1. 테스트 철학

`Stage`는 시각 효과만 보는 것이 아니라 **상태 기계가 제대로 읽히는지**를 검증해야 한다.

즉 테스트는 세 층으로 나눈다.

1. `Unit`
- state -> frame / lane / signal mapping
2. `Fixture smoke`
- deterministic design guide
3. `Integrated UI smoke`
- Team / Runs / IssueDetail surface parity

## 2. Unit 시나리오

### 2.1 actor state mapping

검증:

- `assigned` -> waiting/idle
- `implementing` -> working
- `submitted_for_review` -> reviewer lane active
- `qa_pending` -> qa lane active
- `blocked` -> blocked state

### 2.2 lane resolution

검증:

- PM -> PM lane
- TL -> TL lane
- Engineer -> Engineer lane
- Reviewer -> Reviewer lane
- QA -> QA lane

### 2.3 handoff resolution

검증:

- TL to Engineer
- Engineer to Reviewer
- Reviewer to QA
- failed lane beats queued follow-up

## 3. Design Guide deterministic fixture

### 3.1 stage idle roster

조건:

- 5 roles 모두 배치
- active issue 없음

기대:

- 각 lane station이 보임
- actor idle animation

### 3.2 engineer active

조건:

- engineer lane active
- TL finished handoff

기대:

- engineer working animation
- engineer station glow
- TL actor idle

### 3.3 blocked engineer

조건:

- engineer blocked

기대:

- blocked beacon
- blocked pose
- stage copy에 blocked reason

### 3.4 review waiting

조건:

- engineer done
- reviewer waiting

기대:

- reviewer lane highlight
- handoff marker visible

### 3.5 QA gate open

조건:

- reviewer done
- QA lane active

기대:

- QA gate glow
- QA verifying animation

### 3.6 failed lane over queued recovery

조건:

- same cluster에 failed run + queued follow-up 존재

기대:

- lane severity는 failed로 보인다

## 4. Integrated UI smoke

### 4.1 Team Stage default

흐름:

1. Team 진입
2. Stage가 기본 탭인지 확인
3. Roster / Coverage 탭 존재 확인

### 4.2 Stage actor motion

흐름:

1. deterministic fixture 로드
2. actor sprite 존재
3. walking 또는 working class/state 확인

### 4.3 Stage to Issue Detail parity

흐름:

1. Stage에서 active reviewer lane fixture 확인
2. 같은 fixture의 IssueDetail 진입
3. reviewer/qa wait reason copy 일치 확인

### 4.4 Stage to Runs parity

흐름:

1. Stage에서 phase 확인
2. Runs에서 동일 phase chip 확인
3. copy vocabulary 동일성 확인

## 5. 수동 리뷰 체크리스트

### motion

- 너무 산만하지 않은가
- reduced motion에서 멈추는가
- blocked와 active가 명확히 다른가

### readability

- 1초 안에 누가 일하는지 읽히는가
- handoff 방향이 읽히는가
- reviewer와 QA가 구분되는가

### product tone

- game UI처럼 과한가
- 운영 UI로서 너무 차갑지는 않은가

## 6. 캡처 기준

매 phase마다 최소 이 4장을 남긴다.

1. Stage idle
2. Stage handoff
3. Stage blocked
4. Stage QA gate

## 7. 게이트

phase 종료 기준:

1. unit green
2. deterministic smoke green
3. support-only integrated smoke green
4. 수동 캡처 4장 확인

한 줄 결론:

`Stage` 테스트는 애니메이션 존재 여부가 아니라, **상태가 정확히 읽히는지**를 검증해야 한다.
