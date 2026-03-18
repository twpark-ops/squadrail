# Backend Post-Phase Plan

작성일: 2026-03-10

## 목표

Phase 0~4와 real-org E2E로 delivery runtime 자체는 닫혔다.

지금부터의 백엔드 작업 목표는 세 가지다.

1. real-org E2E와 운영 큐를 확실히 분리한다.
2. 실제 조직 루프를 nightly/metric으로 계속 검증한다.
3. RAG와 merge 흐름을 실측 기반으로 고도화한다.

## 참고 기준

- 현재 완료 상태: [phase-roadmap.md](/home/taewoong/company-project/squadall/docs/exec-plans/completed/phase-roadmap.md)
- 후속 제품 backlog: [post-phase-backlog.md](/home/taewoong/company-project/squadall/docs/post-phase-backlog.md)
- 실행 우선순위 재정렬: [run-first-burn-in-priority-plan.md](/home/taewoong/company-project/squadall/docs/run-first-burn-in-priority-plan.md)
- burn-in 실행계획: [18-agent-real-org-burn-in-plan.md](/home/taewoong/company-project/squadall/docs/18-agent-real-org-burn-in-plan.md)

## 2026-03-11 우선순위 재정렬

최근 replay cache / graph / feedback 고도화 이후, 다음 병목은 retrieval 미세튜닝이 아니라 `replay readiness gate`와 `18-agent burn-in`이라는 점이 확인됐다.

따라서 현재 기준 우선순위는 아래 순서로 재정렬한다.

1. replay E2E gate normalization
2. 18-agent real-org burn-in
3. blocked timeout + legacy semantics cleanup
4. retrieval god-file refactor
5. rerank provider abstraction
6. execution lane classifier
7. fast lane optimization
8. deeper multi-hop
9. ranking/cache/trend consolidation
10. cross-issue memory reuse

세부 이유와 실행 순서는 [run-first-burn-in-priority-plan.md](/home/taewoong/company-project/squadall/docs/run-first-burn-in-priority-plan.md)에서 관리한다.

최신 상태:

- coordinated burn-in은 `root CLO 1개 -> multi-project child fan-out -> reviewer -> QA -> done`까지 실데이터로 닫혔다.
- 따라서 즉시 다음 우선순위는 `blocked / legacy / protocol semantics cleanup`이다.

## upstream에서 채택한 백엔드 참고점

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
- Retrieval stabilization:
  - direct `exactPaths` / `symbolHints` are now graph seeds

## 2026-03-12 구조화 후속

최근 우선순위 배치에서 다음 세 항목을 함께 진행했다.

1. `issue-retrieval.ts` refactor slice 1
2. knowledge setup read-model cache / background refresh
3. PR verify / release workflow

현재 상태:

- `issue-retrieval.ts`는 graph helper와 model rerank helper를 `server/src/services/retrieval/` 하위 모듈로 1차 분리했다.
- 공통 문자열/path helper도 `server/src/services/retrieval/shared.ts`로 이동했다.
- knowledge setup read path는 in-process `stale-while-revalidate` 캐시를 사용한다.
  - fresh TTL: 15s
  - stale TTL: 2m
  - knowledge sync / org repair 후 cache invalidate
- repo 루트에 `.github/workflows/pr-verify.yml`, `.github/workflows/release.yml`를 추가해 기본 verify/release train을 열었다.

추가 진행:

- `issue-retrieval.ts` refactor slice 2 완료
  - scoring / rationale helper를 `server/src/services/retrieval/scoring.ts`로 분리
- `rerank provider abstraction` 1차 완료
  - provider config / transport를 `server/src/services/knowledge-rerank/` 하위 모듈로 분리
- `execution lane classifier + fast lane optimization + lane-aware multi-hop` 완료
  - `server/src/services/execution-lanes.ts` 추가
  - retrieval은 `fast / normal / deep` lane을 분류해 dense/sparse/rerank/finalK, model candidate count, graph hop depth, brief evidence 개수를 lane-aware하게 조정
  - protocol wake payload / contextSnapshot / taskBrief에도 `executionLane`을 포함
  - retrieval cache identity / stage key에도 lane을 포함해 fast/deep replay가 서로 오염되지 않게 함
  - organizational memory metadata path boost는 artifact kind 기준으로 안정화됨
  - engineer / reviewer source order는 `code -> test_report -> review -> ... -> issue`를 더 강하게 따름
  - latest live retrieval run 기준 `codeHitCount`와 `exactPathSatisfied`가 실제로 다시 올라왔고 `multiHopGraphHitCount=8`까지 확인됨

다음 순서:

1. ranking/cache/trend consolidation
2. cross-issue memory reuse
3. rerank provider abstraction 2차
4. execution lane / fast lane 실운영 계측 보강
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

현재 backend 커널은 닫혔다. 다음 우선순위는 retrieval/운영 품질의 안정화와 조직 기억 재사용 강화다.

### 1. Ranking / Cache / Trend Consolidation

- lane-aware retrieval, cache provenance, graph hit 지표는 이미 들어갔다.
- 다음 단계는 이 지표를 project / role / sourceType별 추세로 정리하고 cache invalidation reason과 final-hit provenance를 운영 기준으로 안정화하는 것이다.

### 2. Cross-Issue Memory Reuse

- 현재는 issue / protocol / review가 ingest되고 personalization에 쓰인다.
- 다음 단계는 새 issue가 과거 issue의 decision / fix / review 패턴을 직접 재사용하도록 만드는 것이다.

### 3. Rerank Provider Abstraction 2차

- provider abstraction 1차는 끝났고, 다음은 복수 provider 전략과 graceful fallback 정책을 실제 설정 단위로 여는 것이다.

### 4. Execution Lane / Fast Lane 실운영 계측

- fast / normal / deep 분류는 완료됐다.
- 다음 단계는 lane별 처리시간, cache hit, review reopen, QA bounce를 수집해 fast lane이 실제로 이득을 주는지 확인하는 것이다.

다음 실행 큐는 [p1-next-10-step-execution-plan.md](/home/taewoong/company-project/squadall/docs/p1-next-10-step-execution-plan.md)에 고정한다.

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

## Operator UX / Structural Debt Reprioritization

최신 검토 기준, backend capability를 이미 가진 영역에서 다음 제품 레벨업 포인트는 retrieval 미세조정보다 operator UX 연결과 구조 부채 정리다.

우선순위:

1. `issues.ts` route split slice 2
2. `issue-retrieval.ts` refactor
3. knowledge setup read-model cache/background refresh
4. PR verify / release workflow 추가

상태:
- `issues.ts` route split slice 1 완료
  - approvals
  - intake
  - protocol read routes
  - change/merge routes
  - attachment routes
- 메인 파일에는 create/update/delete/checkout/release, comments, protocol write 같은 고변동 흐름만 남긴 상태다.
- `knowledge-setup` read model cache 1차 완료
  - setup view는 15초 fresh / 2분 stale 캐시를 사용한다.
  - stale 구간에서는 cached view를 반환하고 background refresh를 비동기로 시작한다.
  - knowledge sync / org repair 시 cache invalidate를 수행한다.
  - `KnowledgeSetupView.cache`에 `state`, `refreshInFlight`, `freshUntil`, `staleUntil`, `lastRefresh*`를 노출한다.
- 루트 CI / release workflow 추가
  - `.github/workflows/pr-verify.yml`
  - `.github/workflows/release.yml`
- `issue-retrieval.ts` refactor slice 2 완료
  - scoring / rationale helper를 `server/src/services/retrieval/scoring.ts`로 이동
  - 메인 `issue-retrieval.ts`는 temporal context / orchestration / persistence 중심으로 축소
- `rerank provider abstraction` 1차 완료
  - provider config를 `server/src/services/knowledge-rerank/config.ts`로 분리
  - provider transport를 `server/src/services/knowledge-rerank/providers.ts`로 분리
  - `knowledge-reranking.ts`는 facade만 유지한다

이 순서는 coordinated burn-in 이후 `run first, optimize later` 원칙과 충돌하지 않는다.
의미는 UI-only 작업을 별도 worktree로 분리한 뒤, 백엔드 커널에서는 확장 전에 god-file과 release discipline을 정리하자는 것이다.
