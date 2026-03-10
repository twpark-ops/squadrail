# Autonomous Org Full-Loop Plan

작성일: 2026-03-11  
작성자: Taewoong Park <park.taewoong@airsmed.com>

## 1. 목표

`Squadrail`의 다음 목표는 단순한 `agent orchestration`이 아니다.

목표는 아래 풀 체인을 제품 수준으로 닫는 것이다.

1. Human request
2. PM intake and clarification
3. TL routing and decomposition
4. Engineer implementation
5. Reviewer and/or QA validation
6. TL / PM / CTO closure
7. Outcome -> organizational memory

즉 최종 상태는 `사람이 한 줄 요청을 주면 조직이 구조화하고, 실행하고, 검증하고, 학습하는 시스템`이다.

## 2. 현재 상태

### 2.1 이미 닫힌 구간

- `TL -> Engineer -> Review/QA -> Close`
- isolated workspace / diff / test / build artifact
- merge candidate / merge automation backend
- real-org E2E
- 18-agent canonical org sync
- graph / temporal / personalization 기반 RAG

### 2.2 아직 비어 있는 핵심 구간

#### A. Human -> PM intake

현재는 사람이 이미 어느 정도 구조화된 issue를 직접 작성해야 한다.

즉 아직 없다.

- 모호한 요청 intake
- PM이 PRD / acceptance criteria / execution-ready issue로 구조화
- PM이 TL lane으로 라우팅

#### B. Done -> Knowledge

현재는 schema와 retrieval source preference는 준비돼 있지만, 실제 ingestion path는 workspace/code 중심이다.

즉 아직 없다.

- issue artifact -> knowledge
- protocol / review artifact -> knowledge
- close outcome -> knowledge

#### C. QA gate semantics

현재 `qa`는 review lane에 참여할 수 있다.
하지만 `reviewer -> QA`를 별도 상태로 강제하는 2단계 게이트는 아직 아니다.

따라서 이건 제품 정책 결정을 먼저 해야 한다.

## 3. 설계 원칙

### 3.1 커널은 고정, 운영은 구성 가능

다음은 커널로 유지한다.

- protocol 상태머신
- delivery artifact contract
- isolated workspace / verification / merge provenance

다음은 제품 정책으로 열어둔다.

- PM intake 사용 여부
- QA를 reviewer와 분리할지 여부
- TL direct implementation 허용 여부
- human override 강도

즉 `완전 자유형 workflow builder`가 아니라 `강한 조직 실행 커널 + preset / policy`가 맞다.

### 3.2 우선순위 기준

우선순위는 아래 기준으로 정한다.

1. 조직이 실제로 기억할 수 있는가
2. 사람의 모호한 요청을 구조화할 수 있는가
3. 품질 게이트가 명확한가
4. retrieval 품질과 운영성이 따라오는가

## 4. 통합 우선순위

### P0-A. Organizational Memory Ingest

가장 높은 우선순위다.

목표:

- 조직의 판단과 실행 근거를 knowledge로 적재한다.

세부 작업:

1. `Issue Artifact Ingest`
   - sourceType `issue`
   - issue title / description / labels / acceptance context
   - close summary / verification summary / rollback plan 포함
2. `Protocol / Review Artifact Ingest`
   - sourceType `protocol_message`, `review`
   - 고신호 메시지 최소 집합:
     - `ASSIGN_TASK`
     - `REASSIGN_TASK`
     - `REQUEST_CHANGES`
     - `APPROVE_IMPLEMENTATION`
     - `REQUEST_HUMAN_DECISION`
     - `CLOSE_TASK`
3. `Source Linkage / Backfill`
   - `issueId`, `messageId`, `sourceType` 필수화
   - historical backfill
   - coverage metric 추가

완료 기준:

- retrieval이 코드뿐 아니라 과거 조직 판단 근거를 근거로 사용한다.

### P0-B. Human -> PM Intake Layer

두 번째 우선순위다.

목표:

- 사람이 모호한 요청만 줘도 PM lane이 이를 구조화한다.

세부 작업:

1. `Intake Entry`
   - freeform human request 입력 surface
   - company / project / target lane 선택
2. `PM Structuring Run`
   - PM brief 생성
   - 요구사항 clarification
   - acceptance criteria / definition of done / risks / docs debt 추출
3. `Execution Projection`
   - root issue 생성 또는 update
   - 필요 시 hidden child work items 생성
   - TL lane으로 `ASSIGN_TASK` 또는 `REASSIGN_TASK`

완료 기준:

- 사람이 “이거 만들어줘” 수준의 요청을 주면 PM이 execution-ready issue로 바꾼다.

현재 상태:

- `Slice 1` 완료
  - `POST /api/companies/:companyId/intake/issues`
  - active PM / reviewer-capable agent 자동 선택
  - root intake issue 생성
  - PM lane `ASSIGN_TASK` 자동 부착
- `Slice 2` 완료
  - `POST /api/issues/:id/intake/projection`
  - PM structuring 결과를 root issue enrichment와 hidden child work item으로 projection
  - TL / reviewer / optional QA owner assignment
- 남은 것
  - intake UI surface

세부 구현 기록은 [p0b-human-pm-intake-layer.md](/home/taewoong/company-project/squadall/docs/p0b-human-pm-intake-layer.md) 참조.

다음 구현 우선순위:

1. `P0-B Slice 2` PM projection
2. `P0-C` QA separate gate

### P0-C. QA Gate Policy and Automation

세 번째 우선순위다.

목표:

- QA를 reviewer와 같은 lane으로 둘지, 별도 단계로 승격할지 확정한다.

정책 대안:

1. `Shared Review Lane`
   - 현재 구조 유지
   - reviewer, TL, QA가 동일 review 상태를 공유
2. `Separate QA Gate`
   - reviewer 승인 후 `qa_pending` 또는 유사 상태로 승격
   - QA가 최종 품질 판정
   - 이후에만 close 가능

추천:

- product / release 중심 조직을 목표로 하면 `Separate QA Gate`가 더 맞다.

현재 상태:

- `qaAgentId`가 있는 경우 reviewer approval은 `qa_pending`으로 전이된다.
- QA는 assignment 시점에는 notify-only이고, reviewer approval 뒤에 `issue_ready_for_qa_gate` wake를 받는다.
- 최종 `approved` 뒤에만 TL close follow-up이 발생한다.

완료 기준:

- QA가 선택적 reviewer가 아니라 명시적 품질 게이트인지 아닌지가 제품에서 분명해진다.

## 5. 다음 단계

### P1-A. Operator Pin / Hide UI

- backend route는 이미 있다.
- 이를 `Knowledge / Work / Changes` 표면으로 올린다.

### P1-B. Candidate / Final-Hit Cache

- 현재 query embedding cache 다음 단계
- retrieval hot path 비용과 latency 안정화

### P1-C. Deeper Chunk-Link Multi-Hop

- symbol graph 외 chunk-link 2-hop 이상 확장
- `지식 그래프 느낌` 강화

## 6. 장기 단계

### P2-A. RAG Quality Trend Surface

- sourceType / role / project별 품질 추세
- organizational artifact coverage 가시화

### P2-B. Cross-Issue Memory

- 과거 issue / review / close artifact 재사용
- issue-to-issue reuse trace

### P2-C. External Agent Feedback Integration

- local agent 외 webhook / polling / external adapter 경로까지 기억 루프 확장

## 7. 권장 실행 순서

1. P0-A Organizational Memory Ingest
2. P0-B Human -> PM Intake Layer
3. P0-C QA Gate Policy and Automation
4. P1-A Operator Pin / Hide UI
5. P1-B Candidate / Final-Hit Cache
6. P1-C Deeper Chunk-Link Multi-Hop
7. P2-A RAG Quality Trend Surface
8. P2-B Cross-Issue Memory
9. P2-C External Agent Feedback Integration

## 7.1 현재 기준 후속 우선순위

상류 intake, QA 게이트, organizational memory backend 커널이 닫힌 뒤의 다음 우선순위는 아래 8개다.

1. Operator Feedback UI Surface Expansion
2. Candidate / Final-Hit Cache
3. Deeper Chunk-Link Multi-Hop
4. Retrieval Ranking Stabilization
5. Retrieval God-File Refactor
6. Rerank Provider Abstraction
7. RAG Quality Trend Surface
8. Cross-Issue Memory Reuse

이 순서는 다음 원칙을 따른다.

- 먼저 operator가 retrieval을 교정할 수 있어야 한다.
- 그 다음 latency와 graph 연결성을 보강한다.
- 이후 구조 부채와 provider lock-in을 줄인다.
- 마지막에 조직 기억 재사용을 본격화한다.

## 8. 결정 포인트

### 결정 1. QA를 별도 게이트로 올릴지

추천: 올린다.

이유:

- reviewer는 코드/변경 검토
- QA는 재현성, 회귀, 시스템 레벨 위험
- 두 역할이 조직적으로 다르다

### 결정 2. PM intake는 별도 root issue를 만들지, 기존 issue를 enrichment할지

추천: `intake issue -> execution issue` 2단계보다, `single root issue enrichment + hidden child work items`가 낫다.

이유:

- current protocol / internal work item 모델 재사용 가능
- 상태 추적과 UI surface가 단순해짐

## 9. 판정

현재 `Squadrail`은 이미 `강한 delivery engine`이다.

다음 단계는 이 엔진에

- 상류의 PM 구조화 능력
- 하류의 organizational memory
- 필요 시 별도 QA gate

를 붙여 `학습하는 AI software company`로 올리는 것이다.
