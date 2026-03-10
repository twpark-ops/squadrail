# P1 RAG Feedback, Cache, and Multi-Hop Plan

작성일: 2026-03-11

## 목표

P0-B, P0-C로 조직 실행 커널은 닫혔다.

다음 배치의 목적은 세 가지다.

1. operator가 retrieval 결과를 제품 표면에서 직접 교정할 수 있게 만든다.
2. 반복 retrieval 비용을 candidate/final cache로 줄인다.
3. chunk-link graph를 한 단계 더 깊게 타서 "검색기"가 아니라 "연결된 지식"처럼 보이게 만든다.

## 이번 배치 우선순위

### 1. Operator Feedback Read Model

`IssueChangeSurface`에 아래를 추가한다.

- latest retrieval runs by brief scope
- retrieval feedback summary
- latest cache / graph quality hints

완료 기준:

- change view에서 어떤 retrieval run이 근거였는지 바로 알 수 있다.

### 2. Operator Pin / Hide UI

`Issue Detail > Change View`에서 operator가 retrieval hit에 직접 `pin` / `hide`를 줄 수 있게 한다.

완료 기준:

- 별도 스크립트 없이 UI에서 retrieval feedback을 기록할 수 있다.

### 3. Candidate Cache

query embedding 다음 단계로 fused candidate cache를 추가한다.

완료 기준:

- 같은 issue / role / policy / project-revision 문맥에서 후보 생성이 재실행되지 않는다.

### 4. Final-Hit Cache

graph, temporal, personalization, model rerank 결과까지 반영된 final hit cache를 추가한다.

완료 기준:

- 동일 문맥 재검색에서 expensive rerank / graph expansion을 건너뛸 수 있다.

### 5. Cache Invalidation Discipline

cache key에 아래를 넣는다.

- project knowledge revision signature
- temporal context fingerprint
- personalization profile fingerprint

완료 기준:

- stale hit 재사용 없이 deterministic invalidation이 된다.

### 6. Deeper Chunk-Link Multi-Hop

현재 chunk-link graph는 사실상 1-hop 중심이다.

이번에는:

- seed entity -> first-hop chunks
- first-hop chunk links -> second-hop entity seeds
- second-hop entities -> second-hop chunks

를 붙인다.

완료 기준:

- `multiHopGraphHitCount`가 실제로 증가하고, graph hop depth가 2 이상인 hit가 생긴다.

### 7. Knowledge Quality Trend Surface

`/api/knowledge/quality`에 아래를 추가한다.

- candidate cache hit rate
- final cache hit rate
- daily trend buckets
- feedback / graph / cache 조합 지표

완료 기준:

- "최근 14일 동안 retrieval이 좋아졌는가"를 수치로 설명할 수 있다.

### 8. Knowledge Explore Surface Refresh

Knowledge 화면에 retrieval quality snapshot을 올려서 cache, graph, feedback 신호를 한 번에 읽게 한다.

완료 기준:

- setup 화면이 아니라 explore 화면에서도 현재 retrieval posture를 이해할 수 있다.

### 9. Real-Agent RAG E2E

기존 real-org readiness E2E를 확장해서 아래를 검증한다.

- operator pin/hide feedback
- candidate/final cache hit
- multi-hop graph hit
- follow-up reviewer brief personalization

완료 기준:

- 실제 agent가 updated RAG를 사용한다는 것을 다시 증명한다.

## 비목표

- `issue-retrieval.ts` god file 분리는 이번 배치에서 직접 하지 않는다.
- rerank provider abstraction은 이번 배치 다음 우선순위로 둔다.

## 다음 우선순위

이번 배치가 끝나면 다음 순서는 이렇다.

1. retrieval god file 분리
2. rerank provider abstraction
3. cross-issue memory
4. PM intake UI
