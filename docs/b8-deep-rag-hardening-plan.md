# B8 Deep RAG Hardening Plan

작성일: 2026-03-10

## 목표

B8의 목적은 RAG를 `문서 검색기`에서 `코드베이스 reasoning engine`으로 끌어올리는 것이다.

이미 끝난 것:

- hybrid retrieval
- code-aware chunking
- brief quality instrumentation
- cross-project weighting
- graph-assisted linked chunk expansion

아직 부족한 것:

- 심볼 간 실제 관계 추적
- 시간축을 포함한 코드 버전 맥락
- 대형 repo에서의 비용/지연 안정화
- 역할별로 다른 retrieval bias

즉, 다음 단계의 핵심은 네 가지다.

1. semantic connectivity
2. temporal correctness
3. cost / latency stability
4. role-aware adaptation

## 진행 상태

- Slice 1: graph-assisted linked chunk expansion 완료
- Slice 2: symbol / dependency graph foundation 완료
- Slice 3: version-aware retrieval 완료

다음 우선순위:

1. Slice 4: retrieval cache + incremental reindex
2. Slice 5: role-specific personalization

## 현재 한계

### 1. 연결성은 얕다

지금은 `knowledge_chunk_links`를 따라 path/symbol/project linked evidence를 확장할 수 있지만,
이건 여전히 `flat link reuse`에 가깝다.

부족한 점:

- function call 관계 없음
- import / dependency 관계 없음
- test covers / implementation pair 관계 없음
- symbol rename / alias / receiver method 문맥 없음

### 2. 시간축이 없다

현재 retrieval은 "지금 import된 코드" 기준이다.

그래서 아래 질문이 약하다.

- 이 버그는 최근 변경 이후 생겼나
- 특정 commit 이전과 이후 중 무엇이 기준인가
- release branch 기준으로는 어떤 코드가 맞나

### 3. 운영성 최적화가 부족하다

현재 retrieval은 동작하지만, 대형 repo에서는 다음 문제가 커질 수 있다.

- embedding/query 비용
- repeated query latency
- reimport cost
- stale knowledge와 fresh knowledge의 혼재

### 4. 역할별 bias는 아직 정적이다

지금도 role별 source preference는 있지만 고정 룰에 가깝다.

부족한 점:

- reviewer가 실제로 자주 승인한 evidence 패턴
- tech lead가 자주 보는 ADR / runbook / cross-project 흔적
- qa가 자주 신뢰하는 test signal

이런 운영 피드백이 ranking에 반영되지 않는다.

## 설계 원칙

1. 기존 `knowledge_documents / knowledge_chunks / knowledge_chunk_links / retrieval_runs`를 최대한 재사용한다.
2. 새 기능은 retrieval continuity를 깨지 말고 additive하게 붙인다.
3. 각 슬라이스는 반드시 `metric + test + fallback`을 같이 가진다.
4. personalization은 black-box 학습보다 explainable boost를 우선한다.

## 권장 실행 순서

### Slice 2. Symbol / Dependency Graph Foundation

가장 먼저 해야 한다.

이유:

- retrieval quality를 직접 올린다.
- 현재 graph-assisted expansion을 진짜 semantic graph로 승격시킨다.
- 이후 version-aware retrieval도 symbol/path anchor가 있어야 품질이 난다.

#### 목표

- chunk metadata 수준을 넘어선 symbol registry를 만든다.
- symbol 간 관계를 graph로 저장하고 traversal 가능한 상태로 만든다.

#### 제안 스키마

##### `code_symbols`

- `id`
- `companyId`
- `projectId`
- `documentId`
- `chunkId`
- `path`
- `language`
- `symbolKey`
- `symbolName`
- `symbolKind`
- `receiverType`
- `startLine`
- `endLine`
- `metadata`
- unique key: `(companyId, projectId, path, symbolKey)`

##### `code_symbol_edges`

- `id`
- `companyId`
- `projectId`
- `fromSymbolId`
- `toSymbolId`
- `edgeType`
  - `imports`
  - `calls`
  - `implements`
  - `tests`
  - `configures`
  - `routes_to`
  - `references`
- `weight`
- `metadata`

#### importer 변경

우선 언어는 세 개만 먼저 강하게 잡는다.

- TypeScript / JavaScript
- Go
- Python

초기 수집 관계:

- import / from-import
- top-level call hint
- test file -> production symbol/file
- same-path symbol adjacency

#### retrieval 변경

1. top hit에서 symbol seed를 만든다.
2. `code_symbols`로 canonical symbol id를 찾는다.
3. `code_symbol_edges`를 1-hop 우선 traversal한다.
4. 연결된 symbol이 속한 chunk를 확장 candidate로 포함한다.
5. edgeType별 boost를 준다.

#### metric

- `symbolGraphSeedCount`
- `symbolGraphHitCount`
- `edgeTraversalCount`
- `edgeTypeCounts`
- `testCoverageExpansionCount`

#### 완료 기준

- path link가 아니라 semantic symbol relation으로 근거가 확장된다.
- reviewer/qa brief에서 test-linked evidence 비율이 올라간다.

### Slice 3. Version-Aware Retrieval

상태: 완료

두 번째로 해야 한다.

이유:

- 연결성만 좋아져도 과거/현재를 구분 못 하면 오답 근거를 계속 가져온다.
- real repo workflow와 merge candidate 흐름이 이미 있으므로 시간축을 붙일 가치가 높다.

#### 목표

- retrieval이 branch/commit/release context를 이해하게 만든다.

#### 제안 스키마

##### `knowledge_document_versions`

- `id`
- `companyId`
- `projectId`
- `path`
- `documentId`
- `commitSha`
- `parentCommitSha`
- `branchName`
- `authoredAt`
- `isHead`
- `metadata`

#### 인덱싱 전략

- workspace import 시 현재 branch HEAD 기준 버전 레코드 생성
- merge candidate / isolated worktree 실행 시 branch와 head sha 기록
- 이후 incremental import 시 같은 path의 최신 버전을 append

#### retrieval 변경

- issue / run / merge candidate의 branch/headSha를 temporal context로 전달
- temporal preference order:
  1. exact branch head
  2. same branch recent ancestor
  3. project default branch head
- stale/foreign branch penalty 추가

#### metric

- `temporalHitCount`
- `branchAlignedTopHitCount`
- `staleVersionPenaltyCount`
- `exactCommitMatchCount`

#### 완료 기준

- release/merge/rollback 관련 이슈에서 잘못된 시점의 코드를 덜 가져온다.

### Slice 4. Retrieval Cache + Incremental Reindex

상태: 진행 중

세 번째로 해야 한다.

이유:

- semantics와 temporal correctness가 먼저 있어야 cache key를 안전하게 설계할 수 있다.

#### 목표

- hot query latency와 reindex cost를 줄인다.

#### 제안 스키마

##### `retrieval_cache_entries`

- `id`
- `companyId`
- `cacheKey`
- `stage`
  - `query_embedding`
  - `candidate_merge`
  - `final_hits`
- `valueJson`
- `knowledgeRevision`
- `expiresAt`
- `createdAt`

##### `project_knowledge_revisions`

- `companyId`
- `projectId`
- `revision`
- `updatedAt`

#### 전략

- query embedding cache는 `queryHash + embeddingModel`
- candidate cache는 `company + projectAffinity + workflowState + role + branchContext + knowledgeRevision`
- import 완료 시 project revision 증가
- stale cache는 revision mismatch로 무효화

#### incremental reindex

- project workspace 마지막 import 시점의 git tree signature 저장
- changed paths만 재import
- deleted path는 document deprecate + version close

#### metric

- `cacheHitRate`
- `embeddingCacheHitRate`
- `candidateCacheHitRate`
- `incrementalImportChangedFileCount`
- `retrievalLatencyP50/P95`

#### 완료 기준

- retrieval 비용과 latency가 대형 repo에서도 예측 가능해진다.
- query embedding cache hit가 quality metric에 반영된다.
- workspace import가 unchanged tree에서 skip되고 changed path 중심으로 줄어든다.

### Slice 5. Role-Specific Personalization

마지막에 해야 한다.

이유:

- personalization은 객관적 semantic/temporal correctness 위에 얹어야 한다.
- 그 전에 넣으면 잘못된 편향을 강화할 수 있다.

#### 목표

- 역할/프로젝트/이벤트별로 실제 효과가 있던 evidence 패턴을 ranking에 반영한다.

#### 제안 스키마

##### `retrieval_feedback_events`

- `id`
- `companyId`
- `projectId`
- `issueId`
- `retrievalRunId`
- `actorRole`
- `feedbackType`
  - `approved`
  - `request_changes`
  - `merge_completed`
  - `manual_pin`
  - `manual_hide`
- `targetType`
  - `chunk`
  - `path`
  - `symbol`
  - `source_type`
- `targetId`
- `weight`
- `metadata`
- `createdAt`

##### `retrieval_role_profiles`

- `companyId`
- `projectId`
- `role`
- `eventType`
- `profileJson`
- `updatedAt`

#### 피드백 소스

- `APPROVE_IMPLEMENTATION`
- `REQUEST_CHANGES`
- `CLOSE_TASK`
- merge candidate final action
- operator manual pin/hide future UI action

#### ranking 적용

- sourceType / edgeType / path / symbol에 explainable additive boost
- role+project+eventType 단위로만 적용
- 단일 agent별 black-box memory는 나중으로 미룬다

#### metric

- `profileAppliedRunCount`
- `feedbackCoverageRate`
- `approvalAlignedTopHitRate`
- `requestChangesRepeatHitRate`

#### 완료 기준

- reviewer, qa, tech lead가 보는 evidence 패턴이 실제 승인/반려 결과와 더 잘 맞는다.

## 왜 이 순서인가

수학적으로 보면 retrieval 품질은 크게 세 가지 함수의 합이다.

`quality = relevance + temporal_validity + adaptation`

여기서:

- `relevance`는 graph/symbol connectivity가 만든다.
- `temporal_validity`는 version-aware retrieval이 만든다.
- `adaptation`은 personalization이 만든다.

cache는 품질 함수 자체보다 비용 함수 최적화다.

따라서 순서는 자연스럽다.

1. relevance
2. temporal validity
3. cost optimization
4. adaptation

## 권장 다음 작업

내 추천은 명확하다.

다음 구현은 `Slice 4. Retrieval Cache + Incremental Reindex`다.

이유:

- 지금 graph-assisted expansion을 진짜 semantic graph로 발전시킬 수 있다.
- 현재 사용자가 느끼는 `연결성 부족`을 가장 직접적으로 해결한다.
- 이후 retrieval cache와 personalization 설계의 anchor가 된다.

## Slice 2 구현 체크리스트

1. 스키마 추가
   - `code_symbols`
   - `code_symbol_edges`
2. importer 확장
   - TS/JS
   - Go
   - Python
3. retrieval service 확장
   - symbol id resolution
   - edge traversal
   - edge-aware rerank
4. metric 추가
5. tests
   - import
   - traversal
   - retrieval quality
6. real-org smoke

## 비권장 순서

지금 바로 cache부터 가는 것은 비권장이다.

이유:

- 지금 cache를 먼저 만들면 잘못된 retrieval 결과를 더 빠르게 재사용할 가능성이 크다.

지금 바로 personalization부터 가는 것도 비권장이다.

이유:

- 아직 semantic graph와 temporal context가 부족한 상태라 편향만 강화될 수 있다.
