# B8 Retrieval Cache + Incremental Reindex

작성일: 2026-03-10

## 목표

Slice 4의 목적은 두 가지다.

1. 반복 retrieval에서 query embedding 비용과 latency를 줄인다.
2. workspace knowledge import를 full rescan이 아니라 changed path 중심으로 줄인다.

## 이번 구현 범위

이번 패스는 안전한 foundation만 먼저 넣는다.

- `project_knowledge_revisions`
  - 프로젝트별 knowledge revision, last head sha, last tree signature 저장
- `retrieval_cache_entries`
  - `query_embedding` stage 캐시 저장
- incremental workspace import
  - tree signature 동일 시 import skip
  - 이전 head와 현재 head가 다르면 changed path만 재가공
  - 삭제된 path는 deprecated 처리

## 설계 요점

### 1. Revision anchor

cache invalidation의 기준은 시간 대신 revision이다.

- import / backfill / manual knowledge update가 project revision을 올린다
- revision이 오르지 않으면 retrieval result cache는 안전하지 않다
- 이번 패스에서는 query embedding cache만 넣기 때문에 revision은 주로 incremental import anchor 역할을 한다

### 2. Safe cache

먼저 넣는 캐시는 `query_embedding`뿐이다.

이유:

- query embedding은 knowledge revision과 독립적이다
- 잘못 적중해도 retrieval relevance를 직접 오염시키지 않는다
- dense retrieval 비용을 가장 간단하게 줄일 수 있다

cache key:

- `sha256(embeddingFingerprint + queryText)`

cache payload:

- embedding vector
- provider/model/dimensions
- total tokens

### 3. Incremental reindex

workspace import는 이제 세 모드로 동작한다.

- `full`
- `incremental`
- `skipped_unchanged`

선택 규칙:

1. 이전 tree signature와 같으면 `skipped_unchanged`
2. 이전 head와 현재 head가 다르면 `git diff --name-only`로 changed path 집합 계산
3. changed path가 전체보다 좁으면 `incremental`
4. 그렇지 않으면 `full`

삭제된 changed path는 기존 workspace 문서를 `deprecated`로 전환한다.

## 새 스키마

### `project_knowledge_revisions`

- `companyId`
- `projectId`
- `revision`
- `lastHeadSha`
- `lastTreeSignature`
- `lastImportMode`
- `lastImportedAt`
- `metadata`

### `retrieval_cache_entries`

- `companyId`
- `projectId`
- `stage`
- `cacheKey`
- `knowledgeRevision`
- `valueJson`
- `expiresAt`
- `hitCount`
- `lastAccessedAt`

## 관측 지표

quality summary에 추가:

- `cacheHitRate`
- `embeddingCacheHitRate`
- `candidateCacheHitRate`

import 결과에 추가:

- `importMode`
- `changedPathCount`
- `deprecatedFiles`
- `knowledgeRevision`

## 남은 후속

이번 패스에서 아직 안 한 것:

- final hit cache
- candidate merge cache
- company-wide knowledge revision
- path-level hash 기반 dirty workspace incremental import

이건 다음 패스에서 붙인다.
