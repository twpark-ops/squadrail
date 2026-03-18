# B8 Slice 3: Version-Aware Retrieval

작성일: 2026-03-10

## 목표

Slice 3의 목적은 retrieval이 현재 branch / commit 문맥을 이해하게 만드는 것이다.

이번 슬라이스에서 닫은 범위:

- `knowledge_document_versions` 도입
- workspace import / backfill 시 branch, head sha, parent sha 영속화
- issue artifact / merge candidate 기반 temporal context 유도
- rerank 단계의 branch / commit alignment scoring
- retrieval quality의 temporal metric 노출

## 설계 포인트

### 1. document와 version의 역할 분리

- `knowledge_documents`
  - content snapshot
- `knowledge_document_versions`
  - 그 snapshot이 어떤 branch / head / default branch에서 수집됐는지 설명

즉 document는 본문이고, version row는 시간축 메타데이터다.

### 2. temporal context 해석 순서

retrieval은 아래 우선순위로 현재 문맥을 정한다.

1. protocol artifact의 `diff` / `implementation_workspace`
2. `issue_merge_candidates`
3. project default branch head

실제 delivery loop에서 가장 믿을 수 있는 시간축 정보가 protocol artifact이기 때문에 이 순서를 택한다.

### 3. temporal scoring

rerank에 아래 규칙을 추가했다.

- `exact_commit`
- `same_branch_head`
- `default_branch_head`
- `same_branch_stale`
- `foreign_branch`

이 점수는 hybrid retrieval 위에 additive하게 붙는다.

## 추가된 지표

brief quality / `/api/knowledge/quality`:

- `temporalContextAvailable`
- `temporalHitCount`
- `branchAlignedTopHitCount`
- `staleVersionPenaltyCount`
- `exactCommitMatchCount`
- `averageTemporalHitCount`
- `averageBranchAlignedTopHitCount`

## 실데이터 결과

`cloud-swiftsight`에 대해 version backfill을 수행했고:

- `knowledge_document_versions`: 577 rows
- real retrieval smoke:
  - `temporalContextAvailable: true`
  - `temporalHitCount: 6`
  - `exactCommitMatchCount: 6`
  - `branchAlignedTopHitCount: 3`

즉 temporal context가 실제 rerank 결과에 반영된다.

## 다음 단계

다음 우선순위는 비용/지연 안정화다.

1. retrieval cache
2. incremental reindex
3. role-specific personalization
