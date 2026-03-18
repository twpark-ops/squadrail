# Retrieval God File Refactor Debt

## 대상

- [issue-retrieval.ts](/home/taewoong/company-project/squadall/server/src/services/issue-retrieval.ts)

## 현재 판정

이 파일은 retrieval scoring, query build, graph expansion, temporal context, cache hit accounting, quality summarization, personalization까지 한 파일에 몰려 있다.

현재 제품 우선순위상 `P0-B`, `P0-C`, organizational memory가 먼저였기 때문에 즉시 분리하지 않았다.  
하지만 유지보수성 기준으로는 **HIGH RISK** 부채다.

## 분리 목표

다음 4개 서비스로 나누는 것을 기준으로 잡는다.

1. `retrieval-query.ts`
   - candidate query build / execution
   - dense / sparse / path / symbol source fetch
2. `retrieval-graph.ts`
   - chunk-link / symbol-edge expansion
   - multi-hop traversal
3. `retrieval-scoring.ts`
   - fused score
   - authority / freshness / temporal / personalization boost
4. `retrieval-orchestrator.ts`
   - pipeline ordering
   - cache integration
   - quality summary / degraded reasons

## 순서

1. public helper extraction without behavior change
2. scoring function isolation
3. graph expansion isolation
4. orchestrator reduction
5. cache stage split

## 완료 기준

- `issue-retrieval.ts`가 orchestration shell 수준으로 축소된다
- pure scoring / graph helpers가 독립 unit test를 가진다
- candidate cache / final-hit cache를 끼우기 쉬운 구조가 된다
