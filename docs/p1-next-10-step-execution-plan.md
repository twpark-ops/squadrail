# P1 Retrieval Next 10-Step Execution Plan

작성일: 2026-03-11  
작성자: Taewoong Park <park.taewoong@airsmed.com>

## 목적

이번 계획은 retrieval 안정화 이후 남은 후속 작업을 `운영 교정`, `성능 안정화`, `그래프 연결성`, `구조 부채`, `실조직 E2E`까지 한 번에 이어지는 실행 큐로 고정한다.

핵심 목표는 세 가지다.

1. operator가 retrieval 결과를 실제로 교정할 수 있게 만든다.
2. retrieval hot path 비용과 불안정을 줄인다.
3. `검색기` 느낌을 넘어 `연결된 조직 기억` 느낌이 나게 만든다.

## 10-Step 우선순위

### 1. Operator Feedback Surface Expansion

범위:

- `Knowledge Explore`
- `Change View`
- `Work Detail`

추가 항목:

- pin / hide action
- pinned / hidden provenance
- feedback actor / timestamp
- feedback summary chips

완료 기준:

- operator correction이 retrieval 운영 기본 동작이 된다.

### 2. Feedback Filters and Issue-less Run Handling

범위:

- issue 없는 ad-hoc retrieval run도 operator feedback을 받을 수 있게 한다.
- feedback list에 `issue-linked / ad-hoc / hidden / pinned` 필터를 추가한다.

완료 기준:

- issue context가 없는 knowledge 탐색도 feedback 루프에 들어온다.

### 3. Candidate Cache Provenance Surface

범위:

- `candidateCacheState`
- `candidateCacheMatchedRevision`
- `candidateCacheLatestKnownRevision`
- `candidateCacheLastEntryUpdatedAt`
- `candidateCacheKeyFingerprint`

완료 기준:

- candidate miss가 cold인지 revision drift인지 operator가 즉시 알 수 있다.

### 4. Final-Hit Cache Provenance Surface

범위:

- final-hit stage에도 동일 provenance를 노출한다.
- hit / miss / invalidation reason 분포를 trend sample에 포함한다.

완료 기준:

- final-hit cache가 실제로 유효한지와 invalidation 패턴을 운영자가 설명할 수 있다.

### 5. Cache Invalidation Reason Normalization

범위:

- `miss_cold`
- `miss_revision_changed`
- `miss_expired`
- `miss_policy_changed`
- `miss_feedback_changed`

완료 기준:

- cache miss reason taxonomy가 stage마다 일관된다.

### 6. Deeper Chunk-Link Multi-Hop

범위:

- chunk-link 2-hop / 3-hop traversal budget
- hop별 decay
- escalation path 제한
- visited frontier policy 재정의

완료 기준:

- recent live run 하나 이상에서 `multiHopGraphHitCount > 0`

### 7. Ranking Stabilization Phase 2

범위:

- issue / protocol / review saturation penalty 추가 조정
- code/test bridge boost 세분화
- role별 source ordering 재점검

완료 기준:

- review dominance가 줄고 code/test evidence 비중이 안정적으로 올라온다.

### 8. Retrieval God-File Refactor Slice 1

분리 목표:

- `retrieval-scoring.ts`
- `retrieval-query.ts`
- `retrieval-graph.ts`
- `retrieval-orchestrator.ts`

Slice 1 범위:

- pure scoring / ranking helper 분리
- graph helper 분리

완료 기준:

- `issue-retrieval.ts`가 orchestration 중심으로 축소된다.

### 9. Rerank Provider Abstraction

범위:

- OpenAI 외 provider interface 추가
- provider capability matrix
- graceful fallback reason 기록

완료 기준:

- rerank provider lock-in이 줄고 장애 대응이 쉬워진다.

### 10. Retrieval Trend + Real-Org E2E Gate

범위:

- role/project/sourceType trend sample
- readiness wrapper에서 retrieval quality threshold 검증
- reviewer / QA / close까지 닫히는 real-org RAG E2E

완료 기준:

- retrieval 품질과 조직 실행 루프를 한 번에 회귀 검증할 수 있다.

## 실행 순서

1. Operator feedback surface expansion
2. Feedback filters and issue-less handling
3. Candidate cache provenance
4. Final-hit cache provenance
5. Cache invalidation normalization
6. Deeper chunk-link multi-hop
7. Ranking stabilization phase 2
8. Retrieval god-file refactor slice 1
9. Rerank provider abstraction
10. Retrieval trend + real-org E2E gate

## 현재 상태

완료:

1. Operator feedback surface expansion
2. Feedback filters and issue-less handling
3. Candidate cache provenance
4. Final-hit cache provenance
5. Cache invalidation normalization
7. Ranking stabilization phase 2
8. Retrieval god-file refactor slice 1
9. Rerank provider abstraction

남은 다음 순서:

6. Deeper chunk-link multi-hop
10. Retrieval trend + real-org E2E gate

이번 배치 추가 반영:

- `linked_issue_context`, `top_hit_issue_context`, `top_hit_changed_path` seed를 도입해
  issue/protocol/review -> issue -> changed path -> code/test 경로의 multi-hop 가능성을 높였다.
- candidate/final cache miss reason taxonomy를 `miss_cold / miss_revision_changed / miss_expired / miss_policy_changed / miss_feedback_changed`로 정규화했다.
- pure helper를 `retrieval-cache.ts`, `retrieval-evidence-guards.ts`로 분리해
  `issue-retrieval.ts`의 pure logic 일부를 orchestration 밖으로 이동했다.
- rerank provider는 `openai | generic_http | null` capability로 정리했고,
  provider unavailable reason도 테스트로 고정했다.

## 검증 전략

각 단계마다 아래를 유지한다.

1. focused unit tests
2. typecheck
3. full test suite
4. build
5. live `cloud-swiftsight` retrieval smoke
6. periodic real-org readiness rerun

## 판정

지금 우선순위는 새 기능 폭 확장이 아니라 `operator correction -> cache explanation -> multi-hop evidence -> code structure debt` 순서로 retrieval 품질을 제품 수준으로 끌어올리는 것이다.
