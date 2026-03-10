# Organizational Memory RAG Plan

작성일: 2026-03-11  
작성자: Taewoong Park <park.taewoong@airsmed.com>

## 목표

현재 `Squadrail`의 RAG는 이미 강한 코드 중심 retrieval runtime이다.

- workspace import
- graph-assisted retrieval
- version-aware retrieval
- query embedding cache
- incremental reindex
- role-aware personalization
- real-org follow-up E2E

하지만 아직 중심 기억은 `코드/워크스페이스`에 치우쳐 있다.

다음 목표는 `코드를 잘 찾는 시스템`에서 `조직의 판단과 실행 근거를 기억하는 회사`로 올리는 것이다.

## 현재까지 완료된 기반

### 1. 지식 운영 표면

- `Knowledge / Setup` UI 추가
- company-level org sync / knowledge sync read model 추가
- live `cloud-swiftsight`를 canonical 18-agent 조직으로 정렬

### 2. retrieval runtime

- graph-assisted retrieval expansion
- symbol / dependency graph foundation
- version-aware retrieval
- query embedding cache
- incremental reindex
- role-specific personalization

### 3. 실제 조직 E2E

- real-org delivery E2E 완료
- operator pin / merge outcome feedback이 follow-up reviewer brief에 실제 반영되는지 검증 완료

즉 현재는 `조직 기억을 담을 runtime 그릇`은 만들어져 있다.

## 아직 남은 본질 갭

### P0. 조직 기억 인입

이 단계가 가장 중요하다.

현재는 schema에 `issueId`, `messageId`, `sourceType`가 있어도 실제 ingestion pipeline은 workspace/code import 중심이다.

즉 아래가 아직 부족하다.

1. 이슈 데이터 -> knowledge 문서화
2. 프로토콜 메시지 / 리뷰 / 종료 근거 -> knowledge 문서화
3. sourceType / issueId / messageId linkage의 지속적 보장

이게 없으면 시스템은 계속 `코드 검색을 잘하는 팀`으로 남고, 조직 기억은 약하다.

### P1. retrieval UX / 성능 / 연결성

조직 기억이 들어오기 시작하면 다음 병목은 retrieval 품질과 operator control이다.

1. candidate / final-hit cache
2. operator pin / hide UI
3. chunk-link 중심 multi-hop traversal

### P2. 시각화와 학습 루프

조직 기억이 실제로 쌓이고 있는지 설명 가능해야 한다.

1. RAG quality trend surface
2. cross-issue memory / reuse metric
3. issue/protocol/review artifact 활용률 측정

## 최종 우선순위

### P0-1. Issue Artifact Ingest

목표:

- issue 생성/수정/종료 시 조직 판단 근거를 knowledge로 적재한다.

범위:

- sourceType `issue`
- issue title / summary / description / labels / project / owner
- close 시 `closureSummary`, `verificationSummary`, `rollbackPlan` 요약 반영
- issue 단위 knowledge document / chunk 생성

완료 기준:

- retrieval에서 과거 issue의 문제정의와 종료근거를 근거로 사용할 수 있다.

### P0-2. Protocol / Review Artifact Ingest

목표:

- TL / PM / QA / reviewer의 실제 판단을 knowledge로 적재한다.

범위:

- sourceType `protocol_message`, `review_feedback`
- 포함 메시지 유형 최소 집합:
  - `ASSIGN_TASK`
  - `REASSIGN_TASK`
  - `REQUEST_CHANGES`
  - `APPROVE_IMPLEMENTATION`
  - `CLOSE_TASK`
  - `REQUEST_HUMAN_DECISION`
- low-signal chatter는 제외하고 high-signal payload만 적재
- messageId / issueId / projectId linkage 보장

완료 기준:

- retrieval이 코드뿐 아니라 과거 조직 판단 근거를 같이 사용할 수 있다.

### P0-3. Source Linkage / Backfill

목표:

- sourceType / issueId / messageId가 실제 데이터에서 비지 않게 만든다.

범위:

- 신규 ingest path는 linkage 필수화
- 기존 issue/protocol data에 대한 backfill 스크립트
- quality metric에 artifact-source coverage 추가

완료 기준:

- `issue`, `protocol_message`, `review_feedback` sourceType 문서가 실제로 쌓이고 coverage를 측정할 수 있다.

### P1-1. Candidate / Final-Hit Cache

목표:

- 현재 query embedding cache를 넘어 hot retrieval stage를 줄인다.

범위:

- candidate stage cache
- final-hit cache
- invalidation은 project knowledge revision과 query fingerprint 기준

완료 기준:

- 반복 retrieval의 latency와 비용이 안정적으로 내려간다.

### P1-2. Operator Pin / Hide UI

목표:

- backend route에 있는 operator feedback을 실제 제품 표면으로 올린다.

범위:

- Change / Knowledge / Issue detail에서 pin / hide 액션
- explanation copy
- pinned evidence trace

완료 기준:

- 운영자가 retrieval 결과를 UI에서 교정하고, 그 결과가 다음 brief에 반영된다.

### P1-3. Deeper Chunk-Link Multi-Hop

목표:

- 현재 symbol graph 중심 shallow expansion을 넘어 chunk-link 기반 연결감도 높인다.

범위:

- chunk-link 2-hop budget
- edge type decay
- graph density / hop depth quality metric

완료 기준:

- cross-project / cross-file issue에서 `검색기`보다 `연결된 근거망`에 가까운 retrieval이 된다.

### P1-4. External Agent Feedback Integration

목표:

- local agent 외 adapter에서도 retrieval feedback loop를 끊기지 않게 만든다.

범위:

- webhook / polling / async result ingest 전략
- external adapter protocolDispatch capability 확장

완료 기준:

- 외부 agent도 organization memory 루프에 참여할 수 있다.

## P2 장기 심화

### P2-1. RAG Quality Trend Surface

- retrieval_runs 기반 trend / regression surface
- role / project / sourceType별 quality 변화

### P2-2. Cross-Issue Memory

- 과거 issue / review / close artifact를 follow-up issue에서 재사용
- issue-to-issue reuse trace

## 권장 실행 순서

1. P0-1 Issue Artifact Ingest
2. P0-2 Protocol / Review Artifact Ingest
3. P0-3 Source Linkage / Backfill
4. P1-2 Operator Pin / Hide UI
5. P1-1 Candidate / Final-Hit Cache
6. P1-3 Deeper Chunk-Link Multi-Hop
7. P2-1 RAG Quality Trend Surface
8. P2-2 Cross-Issue Memory
9. P1-4 External Agent Feedback Integration

## 왜 이 순서인가

순서는 `기억의 양 -> 기억의 연결성 -> 기억의 설명 가능성 -> 외부 확장` 기준이다.

- 먼저 기억할 데이터가 들어와야 한다.
- 그 다음 retrieval이 그 기억을 잘 꺼내야 한다.
- 그 다음 운영자가 품질을 교정할 수 있어야 한다.
- 마지막으로 외부 agent까지 루프를 넓힌다.

즉 지금의 진짜 P0는 cache나 UI polish가 아니라 `조직 산출물을 knowledge에 넣는 것`이다.

## 판정

현재 `Squadrail`은 이미 강한 자율 개발 엔진이다.

다음 단계는 엔진을 더 만드는 것이 아니라, 이슈/프로토콜/리뷰를 조직 기억으로 흡수해 `회사 자체가 학습하는 시스템`으로 올리는 것이다.
