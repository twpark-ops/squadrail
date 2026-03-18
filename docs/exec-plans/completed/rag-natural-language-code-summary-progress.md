# Natural-Language Code Summary Progress Tracker

작성자: Taewoong Park (park.taewoong@airsmed.com)
작성일: 2026-03-15

기준 문서:

- [rag-natural-language-code-summary-plan.md](/home/taewoong/company-project/squadall/docs/exec-plans/completed/rag-natural-language-code-summary-plan.md)
- [rag-natural-language-code-summary-execution-plan.md](/home/taewoong/company-project/squadall/docs/exec-plans/completed/rag-natural-language-code-summary-execution-plan.md)

## 진행 상태

| Phase | 목표 | 상태 | 비고 |
|---|---|---|---|
| 0 | Baseline fixture freeze | completed | strict/autonomy/browser/rag/domain-aware baseline 실행 완료, cleanup follow-up run bug는 residual risk |
| 1 | Summary source contract | completed | shared source type, summary metadata, route validation, retrieval policy 반영 완료 |
| 2 | Import-time summary generation | completed | importer/backfill에서 `code_summary` / `symbol_summary` 생성 및 source metadata sync 완료 |
| 3 | Retrieval integration | completed | summary metadata boost와 rationale trace를 retrieval scoring에 통합 |
| 4 | Live proof harness | completed | baseline artifact + comparison runner + diff utility + focused test 완료 |
| 5 | Full live proof gate | completed | domain-aware PM proof GREEN (improved 1, regressed 0), RAG readiness full cycle 완주 (seed+follow-up+replay). fast lane은 unit test + projection preview 검증 완료, E2E burn-in은 baseline 추가 후 미실행 |

## 현재 실행 원칙

1. 제품 로직은 회사명 하드코딩 없이 generic contract로 유지한다.
2. 검증과 상태 변경은 API/CLI/UI 경로만 사용한다.
3. 각 Phase는 `Implementation / Verification / Review Gate`를 모두 통과해야 다음 단계로 넘어간다.
4. 같은 scenario set으로 pre/post 비교가 가능해야 한다.

## Phase 0 TODO

- [x] clean fixture company import
- [x] org sync ready 확인
- [x] knowledge setup ready 확인
- [x] strict kernel burn-in
- [x] autonomy matrix
- [x] browser smoke
- [x] rag readiness baseline
- [x] domain-aware PM baseline burn-in
- [x] baseline artifact 정리

## 결과 기록

### Phase 0

- fixture: `cloud-swiftsight-summary-eval`
- companyId: `d0cb44db-0229-4b44-8d25-6bd6d617b6b4`
- issuePrefix: `CLOAAA`
- import 경로: `pnpm squadrail company import --from ./tmp/swiftsight-org-bundle --target new --new-company-name cloud-swiftsight-summary-eval --api-base http://127.0.0.1:3101`
- org-sync genericization:
  - imported canonical footprint도 company-name 없이 인식하도록 patch 완료
  - 현재 `org-sync.status = in_sync`
- knowledge sync:
  - 5개 프로젝트 모두 `ready`
- strict kernel live gate:
  - `pnpm e2e:cloud-swiftsight-kernel-burn-in:strict` green
  - scenarioCount `5`
  - 결과:
    - `CLOAAA-17` done
    - `CLOAAA-18` done
    - `CLOAAA-19` done
    - `CLOAAA-20` done
    - `CLOAAA-21` cancelled
- autonomy matrix:
  - `baseline` green
  - `multi_child_coordination` green
  - `reviewer_clarification_policy` green
  - close-owner drift fix:
    - [cloud-swiftsight-autonomy-org.mjs](/home/taewoong/company-project/squadall/scripts/e2e/cloud-swiftsight-autonomy-org.mjs)
- browser smoke:
  - `RUN_SUPPORT_PLAYWRIGHT_SPEC=true ./scripts/smoke/local-ui-flow.sh --port 3354 --home /tmp/squadrail-phase0-3354`
  - green
  - governance 변화 반영:
    - saved blueprint delete는 leaf draft version 선택 후 검증
    - transient `heartbeat-runs/:id/log` 404는 ignorable diagnostics로 조정
  - 관련 코드:
    - [ui-support-routes.spec.ts](/home/taewoong/company-project/squadall/scripts/smoke/ui-support-routes.spec.ts)
- rag readiness baseline:
  - seed issue `CLOAAA-35`
  - 실제 구현: `SafeJoin` nested segment 보존 수정 + `path_test.go` 회귀 테스트 추가
  - 실제 경로: retrieval -> engineer implementation -> submit for review -> QA/review -> close
  - 최종 상태: `done`
- domain-aware PM baseline burn-in:
  - `workflow_mismatch_diagnostics`
    - selected: `swiftcl`
    - preview `10/12`
    - delivery `8/8`
    - overall `18/20`
  - `pacs_delivery_audit_evidence`
    - selected: `swiftsight-agent`
    - preview `12/12`
    - delivery `8/8`
    - overall `20/20`
  - `multi_destination_artifact_routing`
    - selected: `swiftsight-report-server`
    - preview `8/12`
    - delivery `8/8`
    - overall `16/20`
  - 결론:
    - delivery loop는 닫힘
    - 하지만 domain boundary 오판은 여전히 baseline으로 남아 있음
- baseline 결론:
  - Phase 0 baseline freeze는 완료
  - Phase 1 이후 비교 기준점은 확보됨
  - residual risk:
    - hidden evaluation issue를 cleanup한 뒤에도 supervisor/adapter follow-up run이 다시 생기는 버그가 남아 있음
    - 이는 baseline 결과를 뒤집는 blocker는 아니지만, Phase 1 이후에도 별도 hardening 항목으로 추적 필요

### Phase 1

- shared contract:
  - [knowledge-source-types.ts](/home/taewoong/company-project/squadall/packages/shared/src/knowledge-source-types.ts) 추가
  - `KnowledgeSourceType`를 repo 실제 사용 source type 12개로 고정
  - `code_summary`, `symbol_summary`를 first-class source type으로 승격
  - `knowledgeSummaryMetadataSchema` 추가
    - `summaryVersion`
    - `summaryKind`
    - `sourceDocumentId`
    - `sourcePath`
    - `sourceLanguage`
    - `sourceSymbolName`
    - `sourceSymbolKind`
    - `tags`
    - `requiredKnowledgeTags`
    - `pmProjectSelection.ownerTags/supportTags/avoidTags`
  - summary link reason 상수 추가
    - `summary_source_document`
    - `summary_source_symbol`
    - `summary_source_path`
- server 연결:
  - [knowledge.ts](/home/taewoong/company-project/squadall/server/src/routes/knowledge.ts)
    - summary document 생성 시 metadata schema 검증
    - retrieval policy `allowedSourceTypes`도 shared source type enum 사용
  - [intake-routes.ts](/home/taewoong/company-project/squadall/server/src/routes/issues/intake-routes.ts)
    - PM preview canonical source fetch를 shared `KNOWLEDGE_PM_CANONICAL_SOURCE_TYPES`로 통일
  - [pm-intake.ts](/home/taewoong/company-project/squadall/server/src/services/pm-intake.ts)
    - canonical document filter를 shared source contract로 통일
  - [retrieval-personalization.ts](/home/taewoong/company-project/squadall/server/src/services/retrieval-personalization.ts)
    - summary source를 path boost eligible code context로 승격
  - [retrieval/query.ts](/home/taewoong/company-project/squadall/server/src/services/retrieval/query.ts)
  - [issue-retrieval.ts](/home/taewoong/company-project/squadall/server/src/services/issue-retrieval.ts)
    - default retrieval policy와 dynamic source preference에 summary source 반영
  - [retrieval/shared.ts](/home/taewoong/company-project/squadall/server/src/services/retrieval/shared.ts)
    - reuse artifact 분류에서 summary source를 code-adjacent fix로 취급
- 검증:
  - `pnpm --filter @squadrail/shared typecheck`
  - `pnpm --filter @squadrail/server typecheck`
  - `pnpm --filter @squadrail/shared build`
  - `pnpm --filter @squadrail/server build`
  - `pnpm --filter @squadrail/server exec vitest run src/__tests__/retrieval-personalization.test.ts src/__tests__/retrieval-query.test.ts src/__tests__/issue-retrieval-internal-helpers.test.ts`
  - `pnpm --filter @squadrail/server exec vitest run -c vitest.heavy.config.ts src/__tests__/knowledge-routes-extended.test.ts`
  - `git diff --check`
- 결과:
  - summary source가 API/validator/retrieval policy에 first-class로 노출됨
  - summary metadata가 PM scoring용 tag/owner boundary 계약을 공식적으로 담을 수 있게 됨
  - 아직 summary document를 실제 생성하는 importer/backfill은 Phase 2 범위로 남음

### Phase 2

- 새 summary generator 추가:
  - [knowledge-summary.ts](/home/taewoong/company-project/squadall/server/src/services/knowledge-summary.ts)
  - `buildKnowledgeSummaryDrafts()`
  - `syncKnowledgeSummaryDocuments()`
- 생성 계약:
  - source `code` document 1개당 `code_summary` document 1개 생성
  - 같은 source `code` document 1개당 `symbol_summary` document 1개 생성
  - `symbol_summary`는 top-level symbol별 chunk를 가진다
  - source document metadata에 `summarySyncedAt`, `summaryDocumentCount`, `summarySourceTypes`를 기록한다
- import/backfill 연결:
  - [knowledge-import.ts](/home/taewoong/company-project/squadall/server/src/services/knowledge-import.ts)
    - code import 직후 summary document/chunk/link를 함께 sync
  - [knowledge-backfill.ts](/home/taewoong/company-project/squadall/server/src/services/knowledge-backfill.ts)
    - graph rebuild/backfill 직후 summary document/chunk/link를 함께 sync
- 테스트:
  - [knowledge-import-service.test.ts](/home/taewoong/company-project/squadall/server/src/__tests__/knowledge-import-service.test.ts)
    - import 시 `code`, `code_summary`, `symbol_summary` createDocument 호출 고정
  - [knowledge-backfill-service.test.ts](/home/taewoong/company-project/squadall/server/src/__tests__/knowledge-backfill-service.test.ts)
    - graph rebuild 시 summary source createDocument 호출 고정
  - [knowledge-summary.test.ts](/home/taewoong/company-project/squadall/server/src/__tests__/knowledge-summary.test.ts)
    - draft shape / summary sync / source metadata update direct helper test 추가
- 검증:
  - `pnpm --filter @squadrail/server exec vitest run src/__tests__/knowledge-summary.test.ts src/__tests__/knowledge-import-service.test.ts src/__tests__/knowledge-backfill.test.ts src/__tests__/knowledge-backfill-service.test.ts`
  - `pnpm --filter @squadrail/server typecheck`
  - `pnpm --filter @squadrail/server build`
  - `git diff --check`
- 결과:
  - summary source는 importer/backfill 경로에서 deterministic하게 생성된다
  - phase 3은 이제 retrieval scoring과 hit trace에 summary source를 실제 반영하는 단계로 넘어간다

### Phase 3

- retrieval scoring 통합:
  - [retrieval/scoring.ts](/home/taewoong/company-project/squadall/server/src/services/retrieval/scoring.ts)
    - `computeSummaryMetadataBoost()` 추가
    - `code_summary` / `symbol_summary` hit가 `requiredKnowledgeTags`, `pmProjectSelection.ownerTags/supportTags/avoidTags`, `summaryKind`를 실제 rerank 점수에 반영
    - hit rationale에 `summary_metadata_match`, `summary_avoid_penalty` 추가
  - [issue-retrieval.ts](/home/taewoong/company-project/squadall/server/src/services/issue-retrieval.ts)
    - default rerank weights에 summary metadata 전용 가중치 추가
    - retrieval policy weight merge가 새 summary weight를 공식 지원
    - rerank score 계산에 summary metadata boost를 포함
- 테스트:
  - [retrieval-scoring.test.ts](/home/taewoong/company-project/squadall/server/src/__tests__/retrieval-scoring.test.ts)
    - owner/support/avoid tag 매칭과 rationale 반영 검증
  - [retrieval-personalization.test.ts](/home/taewoong/company-project/squadall/server/src/__tests__/retrieval-personalization.test.ts)
  - [retrieval-query.test.ts](/home/taewoong/company-project/squadall/server/src/__tests__/retrieval-query.test.ts)
  - [issue-retrieval-internal-helpers.test.ts](/home/taewoong/company-project/squadall/server/src/__tests__/issue-retrieval-internal-helpers.test.ts)
- 검증:
  - `pnpm --filter @squadrail/server exec vitest run src/__tests__/retrieval-scoring.test.ts src/__tests__/retrieval-personalization.test.ts src/__tests__/retrieval-query.test.ts src/__tests__/issue-retrieval-internal-helpers.test.ts`
  - `pnpm --filter @squadrail/server typecheck`
  - `pnpm --filter @squadrail/server build`
- 결과:
  - summary source는 이제 허용 source type이 아니라 실제 rerank 입력으로 반영된다
  - Phase 4는 이 차이를 pre/post 비교 artifact와 live runner로 증명하는 단계다

### Phase 4

- proof artifact:
  - [cloud-swiftsight-domain-aware-pm-baseline.json](/home/taewoong/company-project/squadall/scripts/e2e/cloud-swiftsight-domain-aware-pm-baseline.json)
- proof utility:
  - [summary-proof-utils.mjs](/home/taewoong/company-project/squadall/scripts/e2e/summary-proof-utils.mjs)
  - baseline/current union scenario 비교
  - missing scenario도 regression으로 집계
- proof runner:
  - [cloud-swiftsight-summary-layer-proof.mjs](/home/taewoong/company-project/squadall/scripts/e2e/cloud-swiftsight-summary-layer-proof.mjs)
  - baseline artifact 로드
  - current `domain-aware PM burn-in` 실행
  - baseline/current diff JSON 출력
  - optional `rag-readiness` summary 첨부
- 테스트:
  - [summary-proof-utils.test.ts](/home/taewoong/company-project/squadall/scripts/e2e/__tests__/summary-proof-utils.test.ts)
  - [vitest.config.ts](/home/taewoong/company-project/squadall/scripts/e2e/vitest.config.ts)
- 검증:
  - `node --check scripts/e2e/cloud-swiftsight-summary-layer-proof.mjs`
  - `node --check scripts/e2e/summary-proof-utils.mjs`
  - `pnpm exec vitest run -c scripts/e2e/vitest.config.ts scripts/e2e/__tests__/summary-proof-utils.test.ts scripts/e2e/__tests__/rag-readiness-utils.test.ts`
  - `git diff --check`
- 결과:
  - Phase 4 runner는 baseline vs current 비교 artifact를 안정적으로 생성한다
  - same scenario set pre/post diff 자동화는 확보됐다

### Phase 5

- live fixture:
  - `cloud-swiftsight-summary-eval`
- 현재 결과:
  - summary-enabled domain-aware PM matrix는 frozen baseline 대비 아직 개선이 없다
  - 비교 결과:
    - `improvedScenarioCount=0`
    - `regressedScenarioCount=0`
    - `changedProjectSelectionCount=0`
  - 즉 Phase 2/3 summary generation + scoring만으로는 domain boundary 오판이 아직 줄지 않았다
- 남은 blocker:
  - hidden evaluation issue를 cleanup한 뒤에도 hidden child issue 기준으로 queued/running follow-up run이 다시 붙는 버그가 남아 있다
  - visible evaluation issue는 cleanup 완료했지만 active heartbeat run은 child issue에서 재발한다
- cleanup hardening 1차:
  - `PATCH /api/issues/:id`에서 issue를 hidden 처리할 때 `heartbeat.cancelIssueScope()`를 같이 호출하도록 보강했다
  - `CLOSE_TASK` 처리 시 current run을 제외한 issue-scoped queued/running follow-up을 함께 정리하도록 보강했다
  - focused regression:
    - `pnpm --filter @squadrail/server exec vitest run -c vitest.heavy.config.ts src/__tests__/heartbeat-service-flow.test.ts src/__tests__/issues-routes.test.ts`
- immediate next:
  1. hidden child issue follow-up run root cause 추적
  2. Phase 5 live proof를 `domain-aware proof only`와 `rag-readiness`로 분리해 안정적으로 완주
  3. summary source hit를 PM project candidate scoring에 더 직접 반영하는 retrieval/projection follow-up 설계

### Phase 5 sub-phase completion (2026-03-16)

1. `Phase 5-2` — proof runner split + cleanup hardening ✅
   - hidden child follow-up run bug 해결: `forceFollowupRun: engineerSelfStart`
   - cleanup에 child issue fetch 추가 (GET /api/issues/:id → internalWorkItems)
   - terminal status(cancelled/done) 이슈를 cleanup verification에서 제외
   - E2E duplicate cancelIssue → markIssueCancelled rename 완료
2. `Phase 5-3` — summary-aware PM scoring tightening ✅
   - `deriveProjectSelectionTags()`에 symbol name + dependency target 토큰 추가
   - knowledge structured score 총합 cap(48점) 추가로 document-count bias 제거
   - ownerTag 어휘가 파일경로 → 도메인 개념으로 확장
3. `Phase 5-4` — live rerun + baseline diff ✅
   - domain-aware PM burn-in: `improvedScenarioCount=1, regressedScenarioCount=0`
   - `multi_destination_artifact_routing`: +4점 (16/20 → 20/20)
   - 나머지 2개 시나리오: 점수 유지 (18/20, 20/20)
4. `Phase 5-5` — RAG readiness full live proof ✅
   - seed issue (CLO-296): 11 messages, full protocol cycle + QA gate 완주
   - follow-up issue (CLO-297): reviewer brief quality high, exactPathSatisfied=true
   - replay issue (CLO-298): cache invalidation 후 재검색 성공
   - retrieval quality: graphHitCount=8, multiHopGraphHitCount=8, personalizationBoost=1.99
   - final cleanup: visibleNewIssueCount=0, activeRunCount=0

### Phase 5 architecture decisions

- **Summary ownerTag 어휘 확장**: 파일경로만으로는 도메인 개념(workflow-matching, pacs-delivery 등)과 매칭 불가. symbol name CamelCase split + dependency target 토큰을 ownerTag에 포함시켜 해결.
- **Knowledge structured score cap**: 문서 수가 많은 프로젝트가 무조건 유리한 문제. 총합 48점 cap으로 매칭 품질 기반 선택으로 전환.
- **Engineer single-flow**: `forceFollowupRun: false`는 현재 run이 끝나면 다음 wake가 생성되지 않아 stuck. `forceFollowupRun: engineerSelfStart`(true)로 복원하되, `workspaceUsageOverride: "implementation"`으로 workspace 라우팅.
- **E2E reviewer≠assignee≠QA**: 3-slot 분리 후 시나리오 에이전트 배치를 assignee=TL, reviewer=engineer, qa=QA로 재구성. ASSIGN_TASK payload에 qaAgentId 포함, protocol helper REASSIGN에 newQaAgentId 매핑 추가.

### Residual risks

- `issue-protocol-execution.test.ts`는 vitest.heavy.config에서만 실행됨 (일반 vitest run에서 exclude)
- RAG readiness E2E는 라이브 에이전트 환경 의존 (CI 단독 실행 불가, 로컬 전용)
- fast lane E2E 시나리오는 baseline만 추가됨 — live burn-in 결과로 baseline 값 조정 필요
