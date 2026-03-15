# Natural-Language Code Summary Progress Tracker

작성자: Taewoong Park <park.taewoong@airsmed.com>  
작성일: 2026-03-15

기준 문서:

- [rag-natural-language-code-summary-plan.md](/home/taewoong/company-project/squadall/docs/rag-natural-language-code-summary-plan.md)
- [rag-natural-language-code-summary-execution-plan.md](/home/taewoong/company-project/squadall/docs/rag-natural-language-code-summary-execution-plan.md)

## 진행 상태

| Phase | 목표 | 상태 | 비고 |
|---|---|---|---|
| 0 | Baseline fixture freeze | completed | strict/autonomy/browser/rag/domain-aware baseline 실행 완료, cleanup follow-up run bug는 residual risk |
| 1 | Summary source contract | pending | source type / metadata / link contract |
| 2 | Import-time summary generation | pending | importer/backfill summary 생성 |
| 3 | Retrieval integration | pending | summary source weighting / trace |
| 4 | Live proof harness | pending | baseline vs summary-enabled diff |
| 5 | Full live proof gate | pending | kernel/autonomy/browser/rag/domain-aware PM green |

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

- pending

### Phase 2

- pending

### Phase 3

- pending

### Phase 4

- pending

### Phase 5

- pending
