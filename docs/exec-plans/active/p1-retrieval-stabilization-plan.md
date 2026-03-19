# P1 Retrieval Stabilization and Multi-Hop Plan

작성일: 2026-03-11

## 목표

실조직 RAG readiness에서 engineer/reviewer brief의 top hit가 `issue_snapshot`에 과도하게 끌리는 문제를 줄이고, direct code/test/review evidence가 먼저 보이도록 retrieval을 안정화한다.

## 실행 계획

1. 현재 retrieval run 데이터에서 top hit sourceType 분포를 재확인한다.
2. stale `issue_snapshot` 우세 원인을 `query_debug`, `changedPaths`, personalization profile 기준으로 분해한다.
3. direct path match와 metadata path match를 구분하는 scoring 모델을 정의한다.
4. `issue_snapshot`, `protocol_event`, `review_event`의 metadata path multiplier 차등 규칙을 정의한다.
5. implementation/review 맥락에서 organizational memory hit penalty 적용 조건을 다시 정의한다.
6. engineer/reviewer source preference를 code/test/review 우선으로 재정렬한다.
7. graph seed 생성 시 top hit 의존을 줄이고 direct `exactPaths`, `symbolHints`, `projectAffinityIds`를 seed로 주입한다.
8. brief quality에 organizational memory / code / review hit count를 추가한다.
9. unit test로 `signal seed`, `issue snapshot demotion` 회귀를 고정한다.
10. live `cloud-swiftsight` server에서 retrieval run의 top hits를 다시 검증한다.
11. real-org RAG readiness E2E를 재실행해 follow-up brief 품질을 확인한다.
12. 전체 typecheck/test/build/smoke를 다시 돌리고 문서를 갱신한다.

## 완료 기준

- engineer/reviewer retrieval run의 top hits에 code/review/test evidence가 실제로 올라온다.
- `multiHopGraphHitCount` 또는 `graphSeedCount`가 direct signal seed를 반영한다.
- stale `issue_snapshot`은 metadata path만으로 direct code hit를 이기지 못한다.

## 진행 상태

- 2026-03-19 Batch 1:
  - `issue_snapshot`가 top hit를 먹는 마지막 케이스를 selected-window guard로 보정
  - RAG readiness가 `topHitSourceType/topHitArtifactKind`를 직접 검증하도록 강화
  - direct evidence 우선 규칙을 focused test와 readiness E2E 기준에 반영
