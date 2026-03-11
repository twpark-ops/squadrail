# P1 Multi-Hop Graph + Cache Provenance Plan

작성일: 2026-03-11

## 목표

이번 배치는 retrieval 후속 우선순위 3가지를 한 번에 닫는다.

1. `multiHopGraphHitCount`가 실제 run에서 의미 있게 증가하도록 chunk-link graph traversal을 강화한다.
2. candidate/final-hit cache가 왜 hit/miss/invalidate 되었는지 recent runs와 quality summary에서 설명 가능하게 만든다.
3. organizational memory 문서가 path metadata와 personalization만으로 상위 evidence를 독점하는 현상을 줄인다.

## 실측 배경

최근 real-org run에서 다음 패턴이 반복됐다.

- `graphSeedTypes=["path","symbol"]`
- `graphHopDepthCounts={"1": N}`
- `multiHopGraphHitCount=0`
- top hit source가 `review`
- `review submit-for-review` 문서가 `metadata_path_match + personalized_path`로 상위 6~8개를 독점

즉 현재 문제는 단순히 그래프가 없어서가 아니라:

- 1-hop graph는 동작하지만 2-hop이 final evidence에 살아남지 못하고,
- cache는 hit 여부만 보일 뿐 왜 invalidated/missed 됐는지 설명이 부족하고,
- organizational memory 문서 포화 때문에 code/test evidence 다양성이 줄어든다.

## 실행 계획

1. 최근 real-org run에서 multi-hop 부재와 cache miss 패턴을 데이터로 다시 확인한다.
2. `queryGraphExpansionKnowledge()`의 second-hop seed propagation 규칙을 명시한다.
3. path/symbol/project 외에 `issue` seed를 2-hop 연결용으로 제한적으로 허용할지 결정한다.
4. review/protocol 문서가 이미 direct path seed로 들어온 경우, 동일 path 재발견을 2-hop escalation seed로 허용한다.
5. graph-expanded hit가 동일 source/path에 과도하게 몰리면 saturation penalty를 적용한다.
6. candidate/final cache state를 `hit | miss_cold | miss_revision_changed`로 구분하는 inspection helper를 추가한다.
7. retrieval run debug/cache payload에 provenance와 invalidation reason을 기록한다.
8. recent retrieval runs read model과 quality summary에 cache provenance 필드를 노출한다.
9. focused unit/integration 테스트를 추가한다.
10. real-org readiness E2E를 재실행해 multi-hop 증가와 cache provenance 노출을 검증한다.
11. typecheck/test/build/smoke를 전부 다시 돌린다.
12. 문서 업데이트 후 커밋/푸시한다.

## 설계 결정

### 1. Multi-hop propagation

기존 규칙:
- hop 1에서 path/symbol/project seed로 chunk를 찾고,
- 거기서 다시 발견된 link를 다음 frontier seed로 삼는다.

문제:
- direct path seed가 review/protocol 문서를 먼저 가져오면,
- 그 문서에서 다시 발견되는 path link는 `visitedSeedKeys` 때문에 무시된다.
- 결국 2-hop이 `issue/project`로만 퍼지거나 아예 사라지고, 최종 evidence는 여전히 review 문서에 몰린다.

개선:
- `path`와 `symbol` seed는 동일 key라도 1회에 한해 `escalation hop`을 허용한다.
- escalation은 다음 조건을 만족할 때만 허용한다.
  - 기존 seed reason이 `signal_exact_path` 또는 `signal_symbol_hint`
  - 새로 발견한 link reason이 `protocol_changed_path`, `issue_snapshot`, `protocol_issue_context`, `protocol_related_issue`
  - 새 seed boost가 기존 boost보다 충분히 높다.
- escalation seed는 `graph_escalated_path`, `graph_escalated_symbol` reason을 갖고 hopDepth 2 이상 후보를 만들 수 있다.

### 2. Saturation control

문제:
- 동일 sourceType/source path의 organizational memory 문서가 final evidence를 거의 독점한다.

개선:
- final rerank 직전에 path/source saturation penalty를 적용한다.
- 대상:
  - `issue`, `protocol_message`, `review`
- 규칙:
  - 동일 normalized path가 final 상위에 2개 이상 등장하면 세 번째부터 소폭 penalty
  - 동일 sourceType이 final 상위 4개 이상이면 소폭 penalty
- 목적은 제거가 아니라 code/test/review 조합의 diversity 회복이다.

### 3. Cache provenance

문제:
- 현재는 `candidateHit`, `finalHit` boolean만 보여서 왜 miss인지 모른다.

개선:
- stage별 cache state를 기록한다.
- 상태:
  - `hit`
  - `miss_cold`
  - `miss_revision_changed`
- 추가 메타데이터:
  - `matchedRevision`
  - `latestKnownRevision`
  - `lastEntryUpdatedAt`
  - `cacheKeyFingerprint`

### 4. Read model exposure

`GET /api/knowledge/retrieval-runs`
- `candidateCacheState`
- `candidateCacheReason`
- `finalCacheState`
- `finalCacheReason`
- `graphMaxDepth`
- `graphHopDepthCounts`
- `organizationalMemoryHitCount`
- `codeHitCount`
- `reviewHitCount`

`GET /api/knowledge/quality`
- `candidateCacheMissReasons`
- `finalCacheMissReasons`
- `averageOrganizationalMemoryHitCount`
- `averageCodeHitCount`
- `averageReviewHitCount`

## 종료 기준

- recent real-org retrieval run 하나 이상에서 `multiHopGraphHitCount > 0`
- recent runs API에 candidate/final cache provenance가 보인다.
- quality summary에 cache miss reason 분포가 보인다.
- review 문서가 상위 evidence를 독점하던 run에서 `codeHitCount` 또는 `sourceDiversity`가 개선된다.

## 현재 결과

이번 배치에서 실제로 닫힌 항목은 아래다.

- personalization path hygiene 적용
  - `issues/...`, `docs/...`, `.md` artifact 경로가 더 이상 path boost를 오염시키지 않는다.
- global / project profile rebuild 경로 추가
  - stale global profile까지 함께 재계산된다.
- exact-path code/test evidence promotion 강화
  - final top-k 바깥 깊은 순위의 code hit도 diversity guard로 승격 가능해졌다.
- cache provenance read model 추가
  - recent runs / quality summary에서 candidate/final miss reason을 설명할 수 있다.

실측 기준:

- recent live run `CLO-85`
  - `codeHitCount: 0 -> 1`
  - `exactPathSatisfied: true`
  - `graphHitCount: 5`
  - `multiHopGraphHitCount: 0`
  - top hit source는 여전히 `review`

즉 이번 배치는 `multi-hop 달성`이 아니라:

1. polluted personalization 제거
2. exact path code evidence 복구
3. cache provenance 가시화

까지 닫은 상태다.

## 남은 후속

다음 단계는 아래 순서가 맞다.

1. chunk-link 기반 multi-hop을 실제 final evidence에 살아남게 하기
2. candidate/final cache invalidation reason을 operator surface까지 올리기
3. review dominance를 더 줄이는 ranking stabilization
4. `issue-retrieval.ts` 분리 리팩터링
