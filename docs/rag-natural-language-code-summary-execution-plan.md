# Natural-Language Code Summary Execution Plan

작성자: Taewoong Park <park.taewoong@airsmed.com>  
작성일: 2026-03-15

## 목적

이번 트랙의 목표는 `Squadrail`의 기존 RAG 커널 위에 **자연어 기반 코드 의미층**을 추가하고, 그 결과가 실제 PM 판단과 bounded delivery 품질을 개선한다는 점을 **live E2E로 증명**하는 것이다.

핵심은 아래 두 가지다.

1. 제품 로직은 `cloud-swiftsight` 전용이 아니어야 한다
2. 증명은 preview 점수만이 아니라 실제 `apply -> delivery -> review/QA -> close`까지 포함해야 한다

즉 이번 계획은 단순 importer 개선이 아니라, **generic RAG meaning layer + live proof harness**를 같이 닫는 계획이다.

## 비목표

이번 트랙에서 하지 않는 일:

- 외부 semantic code search 제품을 retrieval kernel로 대체
- generic code chat UI 추가
- raw code / symbol graph 제거
- multi-agent repository chat workflow
- 회사명 기반 scoring shortcut

## 현재 상태

이미 되어 있는 것:

- code chunk / symbol graph / issue-history retrieval kernel
- role-aware / lane-aware retrieval personalization
- generic `requiredKnowledgeTags` 기반 PM project selection
- bounded autonomy domain-aware PM burn-in
- live fixture에서 `preview -> apply -> delivery close`까지 실행 가능한 harness

현재 부족한 것:

- `이 파일/심볼이 시스템에서 무슨 역할을 하는지`를 담은 first-class knowledge source
- importer/backfill 단계에서 summary를 생성하고 유지하는 경로
- retrieval hit에서 summary source를 별도로 반영하는 scoring
- summary layer가 실제 PM 판단을 개선했다는 pre/post 증명

## 증명 원칙

이번 트랙은 아래 원칙으로 증명한다.

### 1. Generic first

제품 코드는 아래 generic contract만 사용한다.

- `code_summary`
- `symbol_summary`
- summary metadata
- `requiredKnowledgeTags`
- knowledge metadata의 `pmProjectSelection.ownerTags / supportTags / avoidTags`
- retrieval weighting / personalization

`cloud-swiftsight`는 검증 fixture일 뿐이고, 제품 로직에 회사명/slug shortcut을 넣지 않는다.

### 2. API / CLI / UI only

성공 검증과 상태 변경은 반드시 아래 경로로만 수행한다.

1. UI
2. CLI
3. HTTP API

DB 직접 조작이나 service direct call은 금지한다.

### 3. Pre/Post proof

자연어 의미층의 가치는 아래 비교로 증명한다.

1. **baseline fixture**
   - manual boundary hint 없이 knowledge sync
   - domain-aware PM matrix 실행
2. **summary-enabled fixture**
   - importer/backfill이 `code_summary / symbol_summary` 생성
   - 같은 matrix 재실행
3. 같은 시나리오에서 project selection / summary hit / delivery close를 비교

## 실행 단계

## 연속 실행 원칙

이번 트랙은 `Phase 0 -> Phase 5`를 끊긴 아이디어 나열이 아니라, **각 단계가 다음 단계의 입력이 되는 연속 실행 트랙**으로 진행한다.

운영 방식은 아래로 고정한다.

1. 각 Phase 시작 전에 `구현 대상 / 성공 기준 / 리뷰 포인트`를 먼저 고정한다
2. 각 Phase 종료 전에 `구현 + 테스트 + live gate + 코드리뷰 관점 위험 점검`을 한 번에 묶어 확인한다
3. 이전 Phase의 산출물이 다음 Phase의 입력이 된다
4. live fixture 검증은 항상 같은 scenario set을 재사용해 pre/post 비교가 가능해야 한다

따라서 이번 트랙은 아래 순서로 **안 끊기게** 진행한다.

1. `Phase 0` baseline fixture freeze
2. `Phase 1` summary contract
3. `Phase 2` importer/backfill generation
4. `Phase 3` retrieval integration
5. `Phase 4` pre/post proof harness
6. `Phase 5` full live proof gate

각 단계는 반드시 아래 3개를 모두 통과해야 다음 단계로 넘어간다.

- `Implementation`
- `Verification`
- `Review Gate`

## Phase 0. Baseline Freeze

목표:

- 현재 kernel/autonomy 기준점을 먼저 잠근다
- RAG 의미층 효과를 비교할 clean fixture를 만든다

구현 대상:

- 기존 live fixture를 오염시키지 않기 위한 새 회사 생성 경로
- baseline domain-aware PM 결과 snapshot

실행:

1. 실제 bundle import로 clean fixture 회사 생성
   - 예: `cloud-swiftsight-summary-eval`
   - 경로: `pnpm squadrail company import ...` 또는 `POST /api/companies/import`
2. org sync / knowledge setup를 API 기준으로 완료
3. **manual boundary docs를 넣지 않은 상태**에서 아래 baseline 실행
   - `pnpm e2e:cloud-swiftsight-kernel-burn-in:strict`
   - `pnpm e2e:cloud-swiftsight-autonomy-burn-in`
   - `RUN_SUPPORT_PLAYWRIGHT_SPEC=true ./scripts/smoke/local-ui-flow.sh ...`
   - `SQUADRAIL_COMPANY_NAME=<fixture> pnpm e2e:cloud-swiftsight-rag-readiness`
   - `SQUADRAIL_COMPANY_NAME=<fixture> pnpm e2e:cloud-swiftsight-domain-aware-pm-burn-in`
4. baseline 결과 JSON 저장

완료 기준:

- clean fixture가 API로 생성됨
- active run / visible evaluation issue cleanup 경로까지 확인됨
- baseline 점수가 저장됨

### Verification

- `POST /api/companies/import` 또는 `pnpm squadrail company import` 실제 경로로 fixture 생성
- `GET /api/companies/:id/org-sync` = `in_sync`
- `GET /api/companies/:id/knowledge-setup` = ready 또는 sync job 완료
- baseline gate 실행:
  - `pnpm e2e:cloud-swiftsight-kernel-burn-in:strict`
  - `pnpm e2e:cloud-swiftsight-autonomy-burn-in`
  - `RUN_SUPPORT_PLAYWRIGHT_SPEC=true ./scripts/smoke/local-ui-flow.sh ...`
  - `pnpm e2e:cloud-swiftsight-rag-readiness`
  - `pnpm e2e:cloud-swiftsight-domain-aware-pm-burn-in`

### Review Gate

- **BLOCKING**: fixture 생성이 DB/service direct call에 기대면 실패
- **BLOCKING**: baseline 결과가 JSON artifact로 남지 않으면 다음 Phase 금지
- **HIGH**: cleanup 후 visible evaluation issue 또는 active run이 남으면 다음 Phase 금지

## Phase 1. Summary Source Contract

목표:

- `code_summary / symbol_summary`를 first-class source type으로 올린다

구현 대상:

- [packages/shared/src/types](/home/taewoong/company-project/squadall/packages/shared/src/types)
- [packages/shared/src/validators](/home/taewoong/company-project/squadall/packages/shared/src/validators)
- [server/src/routes/knowledge.ts](/home/taewoong/company-project/squadall/server/src/routes/knowledge.ts)
- [server/src/services/issue-retrieval.ts](/home/taewoong/company-project/squadall/server/src/services/issue-retrieval.ts)

구체 작업:

1. source type contract 정리
   - `code_summary`
   - `symbol_summary`
2. summary metadata contract 추가
   - `summaryKind`
    - `sourceDocumentId`
   - `sourcePath`
   - `sourceLanguage`
   - `sourceSymbolName`
   - `sourceSymbolKind`
   - `summaryVersion`
   - `tags`
   - `requiredKnowledgeTags`
   - `pmProjectSelection.ownerTags / supportTags / avoidTags`
3. chunk link reason contract 추가
   - raw code <-> summary 연결
4. retrieval allowed source type / policy 메타에 summary source 반영

테스트:

- shared typecheck
- knowledge route validation test
- retrieval source type regression test

완료 기준:

- summary source가 API/DB contract 상에서 first-class로 인식됨

### Verification

- `pnpm --filter @squadrail/shared typecheck`
- `pnpm --filter @squadrail/server typecheck`
- `pnpm --filter @squadrail/shared build`
- `pnpm --filter @squadrail/server build`
- `pnpm --filter @squadrail/server exec vitest run src/__tests__/retrieval-personalization.test.ts src/__tests__/retrieval-query.test.ts src/__tests__/issue-retrieval-internal-helpers.test.ts`
- `pnpm --filter @squadrail/server exec vitest run -c vitest.heavy.config.ts src/__tests__/knowledge-routes-extended.test.ts`
- `git diff --check`

### Review Gate

- **BLOCKING**: `code_summary / symbol_summary`가 built-in source type으로 안 보이면 실패
- **HIGH**: summary metadata가 raw code row와 섞여 source ownership이 모호하면 재설계
- **HIGH**: generic contract가 아니라 회사명/fixture명을 참조하면 실패

## Phase 2. Import-Time Summary Generation

목표:

- workspace import/backfill 단계에서 summary를 자동 생성한다

구현 대상:

- [server/src/services/knowledge-import.ts](/home/taewoong/company-project/squadall/server/src/services/knowledge-import.ts)
- [server/src/services/knowledge-backfill.ts](/home/taewoong/company-project/squadall/server/src/services/knowledge-backfill.ts)
- 새 summary generator service

구체 작업:

1. top-level file/module summary 생성
2. extracted top-level symbol summary 생성
3. summary를 별도 `knowledge_documents / knowledge_chunks`로 저장
4. source code chunk / symbol graph와 `knowledge_chunk_links`로 연결
5. regenerate/backfill 시 idempotent replace 보장

v1 summary shape:

- `what_it_does`
- `why_it_exists`
- `entrypoints`
- `depends_on`
- `used_by`
- `side_effects`
- `test_surface`

테스트:

- knowledge import service test
- knowledge backfill service test
- summary generation helper test
- code graph link integrity test

완료 기준:

- fresh knowledge sync 후 `code_summary / symbol_summary` document/chunk가 실제로 생성됨

현재 상태:

- 2026-03-15 기준 구현/검증 완료
- 다음 단계는 `Phase 3 retrieval integration`

### Verification

- knowledge import service test
- knowledge backfill service test
- summary generation helper test
- code graph link integrity test
- 실제 fixture project 1개에 대해 knowledge sync 실행 후:
  - `GET /api/knowledge/documents`
  - `GET /api/knowledge/documents/:id/chunks`
  에서 summary source 확인

### Review Gate

- **BLOCKING**: importer/backfill이 idempotent하지 않으면 실패
- **HIGH**: summary가 raw code / symbol을 link 없이 orphan으로 저장하면 실패
- **HIGH**: summary 생성이 code import를 막거나 sync 시간을 과도하게 늘리면 generation strategy 재검토

## Phase 3. Retrieval Integration

목표:

- summary source를 current retrieval kernel에 붙인다

구현 대상:

- [server/src/services/issue-retrieval.ts](/home/taewoong/company-project/squadall/server/src/services/issue-retrieval.ts)
- [server/src/services/retrieval-personalization.ts](/home/taewoong/company-project/squadall/server/src/services/retrieval-personalization.ts)
- [server/src/services/retrieval/scoring.ts](/home/taewoong/company-project/squadall/server/src/services/retrieval/scoring.ts)
- [server/src/services/retrieval/quality.ts](/home/taewoong/company-project/squadall/server/src/services/retrieval/quality.ts)

구체 작업:

1. summary source를 dense/sparse retrieval 대상에 포함
2. role-aware weight 추가
   - engineer: raw code 우선, summary는 orientation 용도
   - reviewer: summary 가중치 중간 이상
   - pm / human_board: summary 가중치 높음
3. retrieval trace에 summary hit를 별도 표기
4. PM preview knowledge fetch에 summary source 반영
5. `rag-readiness` 평가 로직에 summary coverage 항목 추가

테스트:

- issue retrieval rerank test
- retrieval personalization test
- PM intake preview test
- rag quality summary test

완료 기준:

- retrieval top hit / brief trace에 summary source가 실제로 나타남
- summary source가 raw code를 대체하지 않고 hybrid로 동작함

### Verification

- issue retrieval rerank test
- retrieval personalization test
- PM intake preview test
- rag quality summary test
- 실제 fixture에서 `rag-readiness` 실행 후:
  - retrieval run top hit source type
  - brief trace summary inclusion
  - role별 source type 분포
  확인

### Review Gate

- **BLOCKING**: summary가 raw code를 밀어내서 engineer retrieval 품질이 떨어지면 실패
- **HIGH**: PM/human_board에서 summary hit가 전혀 안 보이면 weighting 부족
- **HIGH**: summary source가 personalization profile에 반영되지 않으면 다음 Phase 금지

## Phase 4. Live Fixture Proof Harness

목표:

- summary layer의 실제 효과를 pre/post로 비교한다

구현 대상:

- 새 proof runner
  - 예: `scripts/e2e/cloud-swiftsight-summary-layer-proof.mjs`
- 기존 `rag-readiness` / `domain-aware-pm-burn-in` 활용

구체 작업:

1. clean fixture 생성
2. baseline run
   - no manual boundary docs
   - no summary docs
3. summary-enabled knowledge sync
4. post run
5. diff report 생성

측정 항목:

- selected project
- top project coverage
- warning 감소 여부
- retrieval top hit sourceType
- summary hit count
- bounded delivery close 여부

테스트:

- proof runner unit shell test
- CLI/API failure cleanup test
- evaluation cleanup regression

완료 기준:

- 같은 fixture에서 baseline 대비 summary-enabled 결과 차이를 JSON으로 비교 가능

### Verification

- proof runner shell/regression test
- baseline fixture와 summary-enabled fixture 모두 자동 생성/정리
- pre/post diff JSON artifact 생성

### Review Gate

- **BLOCKING**: baseline과 post가 같은 fixture/같은 scenario set을 쓰지 않으면 실패
- **HIGH**: 결과 비교가 preview-only면 실패, apply+delivery 결과까지 포함해야 함
- **HIGH**: cleanup 실패로 fixture 오염이 남으면 다음 Phase 금지

## Phase 5. E2E Proof Gate

이번 트랙의 완료 조건은 아래 5개가 모두 녹색인 것이다.

### Gate 1. Strict kernel burn-in

```bash
SQUADRAIL_COMPANY_NAME=<fixture> pnpm e2e:cloud-swiftsight-kernel-burn-in:strict
```

의미:

- lower delivery kernel regression 없음

### Gate 2. Autonomy matrix

```bash
SQUADRAIL_COMPANY_NAME=<fixture> pnpm e2e:cloud-swiftsight-autonomy-burn-in
```

의미:

- quick request -> projection -> clarification -> close loop 유지

### Gate 3. Browser smoke

```bash
RUN_SUPPORT_PLAYWRIGHT_SPEC=true ./scripts/smoke/local-ui-flow.sh --port <port> --home /tmp/<fixture>
```

의미:

- onboarding / settings / library / preview/apply surface 회귀 없음

### Gate 4. RAG readiness with summary hits

```bash
SQUADRAIL_COMPANY_NAME=<fixture> pnpm e2e:cloud-swiftsight-rag-readiness
```

추가 판정:

- retrieval top hits 또는 review brief에 `code_summary` 또는 `symbol_summary`가 포함돼야 한다

### Gate 5. Domain-aware PM matrix pre/post proof

```bash
SQUADRAIL_COMPANY_NAME=<fixture> pnpm e2e:cloud-swiftsight-domain-aware-pm-burn-in
```

성공 기준:

1. baseline 대비 post-summary 결과가 개선 또는 유지
2. `workflow_mismatch_diagnostics` -> `swiftsight-cloud`
3. `pacs_delivery_audit_evidence` -> `swiftsight-agent` 또는 valid cloud/agent coordination
4. `multi_destination_artifact_routing` -> `swiftcl` 중심 선택
5. 각 child issue가 `done`
6. review/QA/close까지 완료
7. 적어도 한 개 이상 summary source hit가 evidence trace에 남음

### Review Gate

- **BLOCKING**: summary hit는 늘었지만 project selection/delivery가 개선되지 않으면 실패
- **BLOCKING**: review/QA/close까지 안 닫히면 실패
- **HIGH**: 특정 fixture 전용 manual boundary doc 없이는 못 맞추는 구조면 generic 목표 실패

## 권장 구현 순서

1. Phase 0 baseline freeze
2. Phase 1 contract
3. Phase 2 importer/backfill generation
4. Phase 3 retrieval integration
5. Phase 4 proof runner
6. Phase 5 live proof gates

## 단계별 산출물

각 Phase가 끝날 때 남겨야 하는 산출물은 아래와 같다.

| Phase | 코드 산출물 | 검증 산출물 | 리뷰 산출물 |
|---|---|---|---|
| 0 | fixture import/cleanup path | baseline JSON | baseline risk note |
| 1 | shared/server contract | typecheck + focused test | contract review note |
| 2 | importer/backfill summary generation | sync result + summary docs/chunks 확인 | generation risk note |
| 3 | retrieval/personalization integration | rag-readiness result | scoring review note |
| 4 | pre/post proof runner | diff JSON | proof interpretation |
| 5 | live full gate green | kernel/autonomy/browser/rag/domain-aware PM result | 최종 판정 |

## 위험 요소

### 위험 1. Summary hallucination

대응:

- summary는 짧고 구조화된 contract만 허용
- raw code link와 source chunk link를 항상 남긴다

### 위험 2. Summary overweight

대응:

- engineer role에서는 raw code 우선
- sourceType boost 상한 적용

### 위험 3. Fixture contamination

대응:

- clean fixture를 API import로 매번 새로 만든다
- manual boundary docs가 없는 baseline을 기준으로 삼는다

### 위험 4. Proof가 SwiftSight 전용으로 보이는 문제

대응:

- 문서와 코드에 fixture-only 원칙 명시
- summary contract / tag contract / scoring policy는 회사명에 의존하지 않게 유지

## 최종 완료 정의

이번 트랙은 아래 상태가 되면 완료로 본다.

1. `code_summary / symbol_summary`가 importer/backfill에서 자동 생성된다
2. retrieval과 PM preview가 summary source를 실제로 읽는다
3. clean fixture baseline 대비 post-summary domain-aware PM 결과가 좋아진다
4. bounded delivery까지 실제로 닫힌다
5. 구현 전체가 특정 회사명 하드코딩 없이 generic contract로 유지된다
