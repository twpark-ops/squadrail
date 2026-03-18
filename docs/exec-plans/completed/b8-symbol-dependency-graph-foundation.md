# B8 Slice 2: Symbol / Dependency Graph Foundation

작성일: 2026-03-10

## 상태

- 완료

## 목표

RAG를 `linked chunk search`에서 `semantic code graph retrieval`로 한 단계 올린다.

이번 슬라이스에서 닫은 범위:

- `code_symbols`, `code_symbol_edges` 스키마 추가
- workspace import 시 symbol registry / edge candidate 생성
- retrieval 1-hop symbol graph expansion
- 기존 knowledge graph backfill 경로 추가

## 왜 필요했는가

기존 graph-assisted retrieval은 `knowledge_chunk_links`를 따라 path/symbol/project linked chunk를 확장하는 수준이었다.

문제:

- symbol 간 call/reference/import 관계가 없음
- test -> implementation 연결성이 약함
- cross-project issue에서도 graph의 의미가 얕음
- graph가 실제로 작동했는지 운영 지표가 부족함

## 구현 요약

### 1. Symbol Registry

새 테이블:

- `code_symbols`
  - document/chunk 기준 symbol registry
  - `path`, `language`, `symbolKey`, `symbolName`, `symbolKind`, `receiverType`, line range 저장

- `code_symbol_edges`
  - symbol 간 edge
  - 현재 edge type:
    - `imports`
    - `calls`
    - `references`
    - `tests`

### 2. Importer

기존 `chunkWorkspaceFile()` 결과를 그대로 사용해서 graph를 만든다.

edge 후보 생성 규칙:

1. local symbol reference
2. import reference
3. test -> production reference

초기 언어 지원:

- TypeScript / JavaScript
- Python
- Go

### 3. Retrieval

retrieval graph 확장은 이제 2단계다.

1. `knowledge_chunk_links` 기반 expansion
2. `code_symbol_edges` 기반 expansion

흐름:

1. sparse/path/symbol/dense 후보 수집
2. legacy graph expansion
3. rerank
4. top hit의 chunk -> symbol seed 추출
5. symbol 1-hop traversal
6. target symbol chunk를 retrieval 후보로 추가
7. rerank 재실행

## 메트릭

추가된 quality/debug:

- `symbolGraphSeedCount`
- `symbolGraphHitCount`
- `edgeTraversalCount`
- `edgeTypeCounts`

기존 metric은 유지:

- `graphSeedCount`
- `graphHitCount`
- `graphEntityTypes`

## Backfill

새 문서만 graph를 가지게 두면 현재 `cloud-swiftsight`에는 변화가 없으므로 graph backfill을 같이 넣었다.

추가 경로:

- `knowledgeBackfillService.rebuildDocumentGraph(...)`
- `knowledgeBackfillService.rebuildCompanyCodeGraph(...)`
- `pnpm knowledge:rebuild-graph -- --company-name cloud-swiftsight --limit 3000`

실행 결과:

- `companyId`: `04b799b3-d846-42d6-835d-d0142b0d3c7f`
- `scanned`: `525`
- `processed`: `522`
- `skipped`: `3`

## 실데이터 확인

backfill 이후:

- `code_symbols`: `3886`
- `code_symbol_edges`: `8076`

retrieval smoke:

- `retrievalRunId`: `a6e9dfc7-8258-42ae-b478-d68b3a43310f`
- `symbolGraphSeedCount`: `4`
- `symbolGraphHitCount`: `1`
- `edgeTraversalCount`: `9`
- `edgeTypeCounts`: `{ "calls": 1 }`

즉 symbol graph expansion이 실제 retrieval quality payload에 반영됐다.

## 검증

- `pnpm --filter @squadrail/server typecheck`
- `pnpm -r typecheck`
- `pnpm test:run`
- `pnpm build`
- `DATABASE_URL=... pnpm db:migrate`
- `DATABASE_URL=... pnpm knowledge:rebuild-graph -- --company-name cloud-swiftsight --limit 3000`

## 다음 단계

우선순위는 그대로 간다.

1. `Slice 3: Version-Aware Retrieval`
2. `Slice 4: Retrieval Cache + Incremental Reindex`
3. `Slice 5: Role-Specific Personalization`
