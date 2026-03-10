# B8 RAG Graph Expansion

작성일: 2026-03-10

## 문제

현재 retrieval은 hybrid search 자체는 동작하지만, 체감상 `코드 검색`에 가깝다.

실제 운영에서 보인 한계는 다음과 같았다.

- top hit만 보고 끝나서 연결된 근거망이 약하다.
- cross-project 이슈에서도 linked evidence가 거의 드러나지 않는다.
- brief에 `왜 이 문서가 함께 올라왔는가`가 드러나지 않는다.

## 목표

첫 번째 B8 슬라이스의 목표는 `그래프형 근거 확장`이다.

즉, top hit를 찾은 다음 끝내지 않고 이미 저장돼 있는 `knowledge_chunk_links`를 따라
관련 chunk를 retrieval 후보에 다시 포함시킨다.

## 설계

### Seed 단계

초기 rerank 결과의 상위 hit에서 graph seed를 만든다.

- `symbol`
- `path`
- `project` (cross-project affinity가 있을 때만)

seed는 `knowledge_chunk_links`와 hit 자체 metadata를 함께 본다.

### Expansion 단계

seed와 같은 entity를 공유하는 다른 chunk를 linked candidate로 조회한다.

- 기존 hit는 제외한다.
- authority/sourceType filter는 기존 retrieval policy를 그대로 따른다.
- graph score는 `seedBoost + linkWeight` 계열로 계산한다.

### Final rerank 단계

expanded candidate를 base candidate와 다시 합친 뒤 최종 rerank를 한 번 더 태운다.

이렇게 하면:

- 기존 dense/sparse/path/symbol signal
- 기존 heuristic rerank
- 새 graph linkage signal

이 같이 반영된다.

## 기록되는 메타데이터

brief / retrieval debug에 아래를 남긴다.

- `graphSeedCount`
- `graphHitCount`
- `graphEntityTypes`

또한 cross-project 요청인데 graph hit가 비면:

- `cross_project_graph_empty`

를 degraded reason으로 남긴다.

## 현재 범위

이번 슬라이스는 기존 `knowledge_chunk_links`만 사용한다.

아직 하지 않은 것:

- symbol dependency graph
- call graph / import graph
- temporal version graph
- cache layer
- personalization memory

## 검증 기준

1. pure helper test
   - seed 생성
   - graph hit merge
   - brief markdown graph 정보
2. server typecheck
3. retrieval smoke
   - 실제 DB에서 retrieval run debug에 graph 메타데이터 기록 확인

## 다음 슬라이스

1. symbol/dependency graph import
2. version-aware retrieval
3. retrieval cache / incremental reindex
4. role-specific personalization
