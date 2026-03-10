# Backend Post-Phase Plan

작성일: 2026-03-10

## 목표

Phase 0~4와 real-org E2E로 delivery runtime 자체는 닫혔다.

지금부터의 백엔드 작업 목표는 세 가지다.

1. real-org E2E와 운영 큐를 확실히 분리한다.
2. 실제 조직 루프를 nightly/metric으로 계속 검증한다.
3. RAG와 merge 흐름을 실측 기반으로 고도화한다.

## 참고 기준

- 현재 완료 상태: [phase-roadmap.md](/home/taewoong/company-project/squadall/docs/phase-roadmap.md)
- 후속 제품 backlog: [post-phase-backlog.md](/home/taewoong/company-project/squadall/docs/post-phase-backlog.md)

## `.paperclip`에서 채택한 백엔드 참고점

전체를 가져오지는 않는다. 아래 두 축만 흡수한다.

1. git visibility
   - issue / project / agent 단위로 branch, worktree, dirty state, diff, recent commits를 한곳에서 보여주는 read model
2. release worktree lifecycle
   - branch 재사용, clean worktree 요구, 경로 충돌 방지, operator가 provenance를 이해할 수 있게 하는 규칙

반대로 execution lock 계열은 이미 현재 runtime에 흡수돼 있다.

## 실행 순서

### B1. E2E Cleanup / Isolation Foundation

상태: 완료

목표:

- real-org E2E issue가 실제 운영 큐를 오염시키지 않게 만든다.

범위:

- E2E 전용 issue label 도입
- real-org E2E harness가 생성하는 issue에 label 부착
- 실행 전 lingering E2E issue 정리
- 실패 시 protocol cancellation
- 성공 시 운영 화면에서 숨길 수 있는 cleanup 경로 마련

완료 기준:

- QA / reviewer / lead가 예전 E2E 잔재 때문에 임의로 다시 깨어나지 않는다.
- nightly 실행 전후 큐 상태를 deterministic하게 정리할 수 있다.

### B2. Git Visibility Read Model

상태: 완료

목표:

- issue 기준으로 branch/worktree/diff/verification 정보를 안정적으로 읽을 수 있게 만든다.

범위:

- issue 단위 git execution read model
- branch name, workspace path, head sha, changed files, diff stat, verification summary 집계
- 최신 diff / test_run / build_run / approval artifact 정규화

완료 기준:

- UI와 operator tooling이 숨김 worktree 경로를 직접 스캔하지 않고도 변경 provenance를 읽을 수 있다.

### B3. Merge Candidate Backend Flow

상태: 완료

목표:

- `pending_external_merge` 이후의 반영 단계를 backend 계약으로 닫는다.

범위:

- merge candidate read model
- mark merged / mark rejected action
- copyable merge or cherry-pick instruction payload
- source branch / target repo / rollback note provenance 정리

완료 기준:

- operator가 close 이후 별도 수동 추적 없이 반영/폐기 결정을 기록할 수 있다.

### B4. Nightly Real-Org E2E

상태: 완료

목표:

- 실제 조직 루프가 계속 유지되는지 자동으로 감시한다.

범위:

- 대표 시나리오 nightly 실행
- 성공/실패 요약 저장
- 실패 시 recovery queue 또는 알림으로 연결

완료 기준:

- real-org 회귀를 하루 단위로 탐지한다.

### B5. RAG Quality Instrumentation

상태: 완료

목표:

- RAG를 감으로 바꾸지 않고 실측으로 다룬다.

수집 항목:

- brief confidence
- degraded reason 분포
- retrieval hit count
- source diversity
- wrong-project / wrong-file selection
- review 단계에서 근거 부족으로 되돌아간 비율

완료 기준:

- 역할별 / 프로젝트별 retrieval 품질을 숫자로 설명할 수 있다.

### B6. Cross-Project Retrieval Improvement

상태: 완료

목표:

- CTO / PM / TL이 cross-project 이슈를 던질 때 관련 프로젝트를 더 정확히 찾게 만든다.

범위:

- project affinity scoring
- cross-project path / symbol weighting
- multi-project brief shaping

완료 기준:

- cross-project 이슈에서 irrelevant selection 비율이 내려간다.

### B7. Merge Automation

상태: 완료

목표:

- merge candidate를 실제 반영 자동화까지 확장한다.

범위:

- branch push
- PR export
- merge helper
- cherry-pick helper
- pending candidate persistence
- merge automation preflight / plan

완료 기준:

- operator 개입을 최소화한 반영 경로가 생긴다.
- integration branch 기반 merge/cherry-pick 보조가 가능하다.
- merge candidate drift 없이 close evidence가 재사용된다.

### B8. Deep RAG Hardening

상태: 완료

목표:

- 대형 repo와 장기 운영에 맞는 retrieval 고도화를 붙인다.

범위:

- version-aware retrieval
- symbol / dependency graph traversal
- retrieval cache
- incremental reindex
- role-specific personalization

현재 완료 슬라이스:

- Slice 1. graph-assisted retrieval expansion
  - top hit의 `knowledge_chunk_links`를 seed로 사용
  - `symbol`, `path`, `project` link를 따라 linked chunk를 retrieval 후보로 확장
  - brief / retrieval debug에 `graphSeedCount`, `graphHitCount`, `graphEntityTypes` 기록
  - cross-project 이슈에서 graph expansion이 비어 있으면 `cross_project_graph_empty` degraded reason 부여
- Slice 2. symbol / dependency graph foundation
  - `code_symbols`, `code_symbol_edges` 추가
  - workspace import 시 symbol registry / edge 후보 생성
  - retrieval의 symbol 1-hop graph expansion 추가
  - company knowledge graph backfill 경로 추가
- Slice 3. version-aware retrieval
  - `knowledge_document_versions` 추가
  - workspace import / backfill 시 branch/head snapshot 영속화
  - retrieval의 temporal context / branch alignment scoring 추가
  - quality metric에 temporal hit 계열 추가
- Slice 4. retrieval cache + incremental reindex
  - `project_knowledge_revisions`, `retrieval_cache_entries` 추가
  - query embedding cache 추가
  - workspace import incremental / unchanged skip 추가
- Slice 5. role-specific personalization
  - `retrieval_feedback_events`, `retrieval_role_profiles` 추가
  - protocol outcome 기반 feedback recording 추가
  - role / project / eventType explainable boost 적용
  - quality summary personalization metric 추가

후속 설계 문서:

- [b8-deep-rag-hardening-plan.md](/home/taewoong/company-project/squadall/docs/b8-deep-rag-hardening-plan.md)
- [b8-symbol-dependency-graph-foundation.md](/home/taewoong/company-project/squadall/docs/b8-symbol-dependency-graph-foundation.md)
- [b8-version-aware-retrieval.md](/home/taewoong/company-project/squadall/docs/b8-version-aware-retrieval.md)
- [b8-retrieval-cache-incremental-reindex.md](/home/taewoong/company-project/squadall/docs/b8-retrieval-cache-incremental-reindex.md)
- [b8-role-specific-personalization.md](/home/taewoong/company-project/squadall/docs/b8-role-specific-personalization.md)

## Current Status Notes

- Organizational memory ingest: complete
- Human -> PM intake: complete for backend kernel
  - intake entrypoint exists
  - PM projection route exists
  - next work is UI intake surface
- QA policy / separate gate: complete for backend kernel
  - reviewer approval can escalate into `qa_pending`
  - QA follow-up wake and timeout handling are active
  - close follow-up only happens after final `approved`
- Retrieval god-file refactor debt is explicitly recorded in
  - [retrieval-god-file-refactor-debt.md](/home/taewoong/company-project/squadall/docs/retrieval-god-file-refactor-debt.md)

완료 기준:

- 대형 코드베이스에서 retrieval 품질과 비용이 안정화된다.

## 현재 상태 요약

완료:

1. B1. E2E Cleanup / Isolation Foundation
2. B2. Git Visibility Read Model
3. B3. Merge Candidate Backend Flow
4. B4. Nightly Real-Org E2E
5. B5. RAG Quality Instrumentation
6. B6. Cross-Project Retrieval Improvement
7. B7. Merge Automation
8. B8. Deep RAG Hardening

추가 완료:

9. Knowledge Setup UI-first foundation
   - company-level org sync / knowledge sync read model과 UI surface 추가
   - live `cloud-swiftsight`를 canonical 18-agent 조직으로 정렬
10. Real-org RAG readiness E2E
   - operator pin / merge outcome feedback을 실제 reviewer brief personalization까지 연결
   - follow-up issue에서 graph / personalization 신호가 실제 retrieval hit에 반영되는지 검증

## 다음 우선순위 큐

현재 backend 커널은 닫혔다. 다음 우선순위는 품질 안정화와 제품 표면 연결이다.

### 1. Operator Feedback UI Surface

- 현재 pin / hide는 `Change View`에는 부분적으로 올라와 있다.
- 다음 단계는 이를 `Knowledge Explore`와 retrieval quality 요약 표면까지 확장하는 것이다.
- 목표:
  - operator correction latency 축소
  - retrieval 교정 루프를 제품 기본 기능으로 승격
  - change-only surface를 knowledge-wide surface로 확장

### 2. Candidate / Final-Hit Cache

- 현재 실사용 캐시는 query embedding 중심이다.
- candidate merge cache와 final-hit cache를 추가해 동일 역할/유사 컨텍스트 반복 검색 비용을 줄인다.
- 목표:
  - retrieval hot path latency 안정화
  - personalization / graph 확장 비용 흡수

### 3. Deeper Chunk-Link Multi-Hop

- 현재 graph expansion은 의미가 생겼지만 chunk-link 중심 multi-hop은 아직 얕다.
- symbol edge와 chunk link를 2-hop 이상 결합해 `지식 그래프 느낌`을 강화한다.
- 목표:
  - cross-issue / cross-project 연결 근거 확장
  - graphHitCount의 실질적 상승

### 4. Retrieval Ranking Stabilization

- latest readiness 관찰 기준으로 engineer brief와 reviewer brief가 여전히 historical issue snapshot에 과하게 끌리는 경우가 있다.
- sourceType balancing, role-aware source ordering, code evidence promotion 규칙을 추가로 정교화한다.
- 목표:
  - `issue snapshot` 과잉 의존 감소
  - `code / test / review` evidence 우선순위 안정화

### 5. Retrieval God-File Refactor

- [retrieval-god-file-refactor-debt.md](/home/taewoong/company-project/squadall/docs/retrieval-god-file-refactor-debt.md) 기준으로 `issue-retrieval.ts`를 분리한다.
- 목표:
  - 유지보수성 회복
  - multi-hop / cache / ranking 개선을 독립적으로 실험 가능하게 만들기

### 6. Rerank Provider Abstraction

- 현재 model rerank는 OpenAI 단일 provider 중심이다.
- provider abstraction을 추가해 Jina / Cohere 등 대체 provider를 붙일 수 있게 한다.
- 목표:
  - rerank 품질/비용 선택권 확보
  - provider 장애 시 graceful fallback 강화

### 7. RAG Quality Trend Surface

- quality metric은 backend에 있지만, sourceType / role / project별 추세를 운영자가 읽기 쉽게 정리할 표면이 부족하다.
- 목표:
  - retrieval 품질의 장기 변화 감시
  - organizational memory coverage 가시화

### 8. Cross-Issue Memory Reuse

- 현재는 issue / protocol / review가 ingest되고 personalization에 쓰인다.
- 다음 단계는 새 issue가 과거 issue의 decision / fix / review 패턴을 직접 재사용하도록 만드는 것이다.
- 목표:
  - 비슷한 이슈의 해결 패턴 재사용
  - 조직 기억의 실질적 생산성 효과 확보

다음 우선순위:

1. operator feedback UI surface
2. candidate / final-hit cache
3. deeper chunk-link multi-hop
3. candidate / final-hit cache
4. deeper chunk-link multi-hop traversal
5. cross-issue memory / quality trend surface

상세 우선순위와 단계별 계획은 [organizational-memory-rag-plan.md](/home/taewoong/company-project/squadall/docs/organizational-memory-rag-plan.md), 전체 조직 풀루프 우선순위는 [autonomous-org-full-loop-plan.md](/home/taewoong/company-project/squadall/docs/autonomous-org-full-loop-plan.md) 참조.

## 완료 증거

- nightly real-org E2E 리포트
  - `~/.squadrail/reports/nightly/cloud-swiftsight-real-org/latest.json`
  - 최신 결과: `ok: true`
- 신규 backend surface
  - `GET /api/knowledge/quality`
  - `GET /api/issues/:id/change-surface`
  - `GET /api/issues/:id/merge-candidate`
  - `POST /api/issues/:id/merge-candidate/actions`
- cleanup tooling
  - `pnpm e2e:cloud-swiftsight-real-org`
  - `pnpm e2e:cloud-swiftsight-real-org:cleanup`

## 판정

지금 백엔드는 새 엔진을 만드는 단계가 아니다.

운영 자동화, retrieval 계측, merge 반영 흐름을 닫는 단계다.

## 다음 제품 단계

Knowledge follow-up은 CLI-first가 아니라 UI-first로 진행한다.

추천 순서:

1. `K1. Org drift read model`
   - live company와 canonical 18-agent bootstrap 차이 계산
2. `K2. Company knowledge setup read model`
   - project import state, graph/version/personalization state, quality 요약을 단일 응답으로 제공
3. `K3. Knowledge Setup UI`
   - 운영자의 주 경로
4. `K4. Company knowledge sync orchestration API`
   - selected/all sync, project-level step orchestration
5. `K5. Org repair action`
   - missing/misaligned agent repair
6. `K6. Real-agent RAG E2E revalidation`
   - follow-up issue brief에서 graph/personalization 사용 여부 확인

참고:

- [knowledge-setup-sync-ui-first-spec.md](/home/taewoong/company-project/squadall/docs/knowledge-setup-sync-ui-first-spec.md)
- [knowledge-setup-sync-ui-first-spec.puml](/home/taewoong/company-project/squadall/docs/knowledge-setup-sync-ui-first-spec.puml)
