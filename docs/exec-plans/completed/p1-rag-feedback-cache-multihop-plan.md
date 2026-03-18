# P1 RAG Feedback, Cache, and Multi-Hop Plan

작성일: 2026-03-11

## 목표

P0-B, P0-C로 조직 실행 커널은 닫혔다.

다음 배치의 목적은 세 가지다.

1. operator가 retrieval 결과를 제품 표면에서 직접 교정할 수 있게 만든다.
2. 반복 retrieval 비용을 candidate/final cache로 줄인다.
3. chunk-link graph를 한 단계 더 깊게 타서 "검색기"가 아니라 "연결된 지식"처럼 보이게 만든다.

## 상태

- `Issue Detail > Change View` pin / hide: 완료
- candidate cache / final-hit cache: 완료
- Knowledge quality trend API: 완료
- Knowledge Explore retrieval posture surface: 완료
- 이번 추가 배치:
  - `Knowledge Explore > Recent Retrieval Loops`
  - recent retrieval run read model
  - Knowledge 화면 pin / hide mutation 연결
  - direct `exactPaths` / `symbolHints` graph seed 주입
  - organizational memory metadata path boost 안정화
  - engineer / reviewer source preference 재정렬
  - brief quality에 organizational memory / code / review hit count 추가

## 최신 실측 결과

- `CLO-77` seed issue에서 TL / Engineer retrieval top hit source가 `issue`가 아니라 `review`로 이동했다.
- 같은 run에서 `graphHitCount=6`이 유지됐다.
- stale `issue_snapshot`는 metadata changedPaths만으로 direct code / review evidence를 이기지 못하도록 점수를 낮췄다.

## 남은 우선순위

### 1. Operator Feedback Read Model

`Knowledge Explore`까지 확장한 뒤의 다음 단계는 feedback provenance와 filter다.

- latest retrieval runs by brief scope
- retrieval feedback summary
- latest cache / graph quality hints

다음 완료 기준:

- knowledge 화면에서도 pinned / hidden evidence와 최근 retrieval run을 바로 읽을 수 있다.

### 2. Candidate / Final Cache Visibility

cache 자체는 들어갔으므로, 이제는 hit provenance와 invalidation 사유를 읽게 한다.

다음 완료 기준:

- 최근 retrieval run에서 candidate/final-hit cache 적중 이유를 설명할 수 있다.

### 3. Deeper Chunk-Link Multi-Hop

현재 chunk-link graph는 3-hop까지 열려 있지만, symbol graph보다 hit depth가 얕게 나타나는 경우가 있다.

이번에는:

- seed entity -> first-hop chunks
- first-hop chunk links -> second-hop entity seeds
- second-hop entities -> second-hop chunks

를 붙인다.

완료 기준:

- `multiHopGraphHitCount`가 실제로 증가하고, graph hop depth가 2 이상인 hit가 생긴다.

### 4. Retrieval Ranking Stabilization

실조직 retrieval에서 `issue_snapshot`이 changedPaths metadata만으로 상단을 점유하던 문제를 줄인다.

이번 배치에서 넣은 것:

- direct path match와 metadata path match 분리
- `issue_snapshot`, `protocol_event`, `review_event` metadata path multiplier 차등 적용
- implementation / review 맥락에서 organizational memory penalty 재적용
- engineer / reviewer source order를 `code -> test_report -> review -> ... -> issue`로 조정

완료 기준:

- engineer / reviewer recent retrieval run top hit가 모두 `issue`로만 채워지지 않는다.

### 5. Knowledge Quality Trend Surface

`/api/knowledge/quality`에 아래를 추가한다.

- candidate cache hit rate
- final cache hit rate
- daily trend buckets
- feedback / graph / cache 조합 지표

완료 기준:

- "최근 14일 동안 retrieval이 좋아졌는가"를 수치로 설명할 수 있다.

### 6. Knowledge Explore Surface Refresh

Knowledge 화면에 retrieval quality snapshot을 올려서 cache, graph, feedback 신호를 한 번에 읽게 한다.

완료 기준:

- setup 화면이 아니라 explore 화면에서도 현재 retrieval posture를 이해할 수 있다.

### 7. Real-Agent RAG E2E

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
