---
title: "Canonical Stabilization Sprint Plan"
author: "Taewoong Park (park.taewoong@airsmed.com)"
date: "2026-03-18"
lang: "ko"
CJKmainfont: "Noto Sans CJK KR"
mainfont: "Noto Sans"
---

# 개요

현재 Squadrail은 제품 방향과 핵심 제어 평면은 강하지만, 실제 사용자 루프를 끝까지 통과시키는
운영 안정성은 아직 베타 수준이다.

이번 스프린트의 목표는 새 기능 추가가 아니라 다음 조건을 **제품 계약**으로 고정하는 것이다.

- fresh DB 기준으로 canonical E2E 5개가 모두 통과한다.
- flaky rerun 없이 동일 시나리오를 3회 연속 green으로 만든다.
- 실패 원인을 `state transition`, `ownership/session`, `retrieval/routing` 세 축 중 하나로 반드시 분류한다.

이 문서는 현재 구현 상태를 전제로, 다음 1~2주 동안 수행할 안정화 스프린트의 설계, 범위,
시나리오, invariant, 보안 선행 조건, 검증 계획을 정리한다.

# 관련 문서

- [review-findings-2026-03-18.md](/home/taewoong/company-project/squadall/docs/review-findings-2026-03-18.md)
- [phase-0-security-baseline-design-2026-03-18.md](/home/taewoong/company-project/squadall/docs/exec-plans/active/phase-0-security-baseline-design-2026-03-18.md)
- [p1-retrieval-stabilization-plan.md](/home/taewoong/company-project/squadall/docs/exec-plans/active/p1-retrieval-stabilization-plan.md)
- [five-axis-hardening-plan-2026-03-18.md](/home/taewoong/company-project/squadall/docs/exec-plans/active/five-axis-hardening-plan-2026-03-18.md)

# 배경

최근 수정과 검증을 통해 다음 사실이 분명해졌다.

1. 핵심 프로토콜 모델과 역할 기반 실행 제어는 유효하다.
2. 실제 불안정성은 주로 후속 wake, task session reset, close follow-up 같은 운영 glue에서 발생한다.
3. symptom-first intake, retrieval evidence, engineer assignment, review/close를 한 줄로 묶는
   canonical E2E가 제품 의도를 가장 잘 드러낸다.
4. 같은 종류의 버그가 반복되는 이유는, 시나리오별 invariant가 충분히 테스트로 잠기지 않았기 때문이다.
5. 안정화 스프린트는 보안 baseline 없이 진행할 수 없다. E2E가 green이어도 인증/권한 baseline이
   무너지면 배포 가능 상태로 볼 수 없다.

# 목표

## 1. 시스템 목표

- 제품의 golden path를 명시적으로 5개로 고정한다.
- 각 경로에 대해 반드시 지켜야 하는 상태 전이와 ownership/session invariant를 정의한다.
- UI smoke, focused server tests, canonical E2E가 같은 제품 계약을 바라보게 만든다.

## 2. 품질 목표

- **MUST**: canonical E2E 5개 3회 연속 green
- **MUST**: Phase 0 security baseline이 먼저 닫혀야 한다.
- **MUST**: `approved -> close`, `changes_requested -> recovery`, `qa_pending -> close` 경로에서
  stale session 재사용이 없어야 한다.
- **MUST**: symptom-first 시나리오에서 입력에 프로젝트 힌트를 넣지 않는다.
- **MUST**: retrieval-required 시나리오에서 실제 evidence가 기록된다.
- **SHOULD**: UI가 해당 상태를 숨기지 않고 직접 노출한다.

# 현재 진행 상태

기준일: 2026-03-19

- Phase 0 baseline은 구현과 focused tests 기준으로 닫혔다.
- Batch A v1은 `IssueDetail + IssuesList + Overview current delivery`까지 shipped 상태다.
- Phase 1은 아래 항목까지 완료됐다.
  - `retrieval-cache.test.ts` drift 복구
  - `dashboard-service.test.ts` health 규칙 정렬
  - fresh DB bootstrap verifier 추가 및 실제 migration head 검증
  - canonical company bootstrap helper를 `scripts/e2e/company-bootstrap.mjs`로 통일
- Phase 2는 canonical 5개 시나리오가 모두 invariant + 실제 E2E로 잠겼다.
  - 시나리오 1: canonical full delivery (`full-delivery.mjs`, `full-delivery-invariants.mjs`)
  - 시나리오 2: clarification loop (`cloud-swiftsight-domain-aware-pm-eval.mjs`,
    `clarification-loop-invariants.mjs`, `cloud-swiftsight-autonomy-org.mjs`)
  - 시나리오 3: changes requested recovery (`cloud-swiftsight-real-org.mjs`,
    `change-recovery-invariants.mjs`)
  - 시나리오 4: QA gate (`cloud-swiftsight-real-org.mjs`,
    `qa-gate-invariants.mjs`)
  - 시나리오 5: merge/deploy follow-up (`full-delivery.mjs`,
    `merge-deploy-followup-invariants.mjs`)
- 현재 다음 타깃은 `Phase 3 UI surface alignment`다.

# 선행 조건: Security Baseline

안정화 스프린트는 다음 보안/하드닝 항목을 Phase 0으로 선행 처리해야 한다.

## 검증된 선행 항목

1. auth secret fallback에 하드코딩 값이 남아 있다.
   - 현재 코드: `server/src/auth/better-auth.ts`
2. email verification이 비활성화돼 있다.
   - 현재 코드: `server/src/auth/better-auth.ts`
3. issue document body에 상한이 없다.
   - 현재 코드: `server/src/routes/issues/documents-routes.ts`
4. deliverables route는 company-scoped route shape와 authorization 일관성을 더 강하게 맞출 필요가 있다.
   - 현재 코드: `server/src/routes/issues/deliverables-routes.ts`

## Phase 0 목표

- auth secret externalization
- email verification 기본 활성화
- issue document body size limit
- deliverables route authorization / route-pattern hardening
- upstream security patch intake 준비

## Phase 0 완료 기준

- 하드코딩 secret 제거
- email verification bypass 기본값 제거
- oversized document payload가 route level에서 거부
- deliverables route가 company boundary와 route shape 기준으로 일관되게 검증
- upstream remote / 보안 패치 모니터링 경로가 문서화

# 범위

## 포함 범위

- onboarding / first-success
- PM intake / project routing / retrieval evidence
- protocol execution / wake follow-up / task session reset
- reviewer recovery / QA gate / merge-deploy follow-up
- IssueDetail / Inbox / ChangeReviewDesk / Overview의 상태 노출
- canonical E2E scripts
- focused server tests / browser smoke

## 제외 범위

- 신규 plugin 시스템
- stage/animation 확장
- 대규모 UI 리디자인
- 새로운 artifact schema 추가
- broad architecture rewrite

# Canonical 시나리오 5개

## 1. Onboarding -> Quick Request -> PM routing -> engineer -> review -> close

### 목적

제품의 기본 북극성 경로를 검증한다.

### 입력 조건

- 프로젝트 힌트 없는 quick request
- fresh DB에서 회사, workspace, blueprint를 기본 루프로 세팅

### 기대 결과

1. onboarding 완료
2. first quick request 생성
3. PM projection preview/apply
4. 적절한 project 선택
5. retrieval 사용
6. engineer assignment
7. review approval
8. close 완료

### invariant

- intake issue와 projected delivery issue가 모두 존재한다.
- `ASSIGN_TASK -> ACK_ASSIGNMENT -> START_IMPLEMENTATION -> SUBMIT_FOR_REVIEW -> START_REVIEW -> APPROVE_IMPLEMENTATION -> CLOSE_TASK`
  순서가 성립한다.
- `approved` 이전에는 close 불가다.
- close follow-up은 stale task session을 재사용하지 않는다.
- implementation run에는 실제 수정 파일이 존재한다.
- base workspace는 오염되지 않는다.

## 2. Clarification loop

### 목적

모호한 요청에만 clarification이 걸리고, 답변 후 delivery가 재개되는지 검증한다.

### 기대 결과

1. PM이 clarification 필요 여부를 판단
2. clarification 필요 시 Inbox / IssueDetail에 pending 노출
3. 답변 후 workflow 재개
4. 재개 후 delivery 정상 진행

### invariant

- clarification 불필요 시나리오에서는 `ASK_CLARIFICATION`이 없어야 한다.
- clarification 필요 시나리오에서는 반드시 `ASK_CLARIFICATION`이 있어야 한다.
- answer는 같은 issue/question contract에 연결되어야 한다.
- unresolved clarification이 있으면 close 불가다.
- clarification 재개 이후 retrieval-required 요청이면 실제 evidence가 다시 기록되어야 한다.

## 3. Changes requested recovery

### 목적

reviewer가 변경 요청을 돌려보낸 뒤 engineer 또는 TL-direct owner가 정상 복구하는지 검증한다.

### 기대 결과

1. reviewer `REQUEST_CHANGES`
2. state `changes_requested`
3. reassign 또는 direct owner recovery
4. engineer/TL이 다시 구현
5. review 승인으로 복귀

### invariant

- `changes_requested` 이후 recover owner가 비면 안 된다.
- `changes_requested` 상태에서 `REASSIGN_TASK`가 허용되어야 한다.
- TL-direct implementation이면 `primaryEngineerAgentId`가 비어 있지 않아야 한다.
- recovery follow-up도 stale session을 재사용하지 않아야 한다.
- recovery 후 `ACK_CHANGE_REQUEST` 또는 `START_IMPLEMENTATION`이 가능해야 한다.

## 4. QA gate

### 목적

review 승인 후 QA가 실제 execution gate로 동작하는지 검증한다.

### 기대 결과

1. reviewer approval
2. `qa_pending` 또는 `under_qa_review`
3. QA evidence 제출
4. approve 또는 request changes

### invariant

- QA agent가 있으면 reviewer approval 직후 바로 close 되면 안 된다.
- QA approval에는 execution evidence가 필요하다.
- QA request changes에는 failure evidence가 필요하다.
- QA 완료 전 close 불가다.
- QA return path는 recovery path와 같은 수준으로 복구 가능해야 한다.
- QA evidence surface는 retrieval / execution provenance를 잃지 않아야 한다.

## 5. Merge / deploy follow-up

### 목적

approved 이후 merge/deploy 후속이 올바르게 표시되고, close 또는 pending external merge 처리로 이어지는지 검증한다.

### 기대 결과

1. merge candidate surface 노출
2. deploy tracking surface 갱신
3. 필요한 경우 pending external merge
4. close follow-up 완료

### invariant

- merge/deploy 링크는 안전한 URL만 사용한다.
- `approved -> close` follow-up은 새 task session으로 시작한다.
- deploy blocked / recovery required는 UI에서 직접 노출되어야 한다.
- reviewer session이 close follow-up에 재사용되면 안 된다.
- merge candidate / deploy surface가 retrieval-backed summary를 쓰는 경우, provenance가 누락되면 안 된다.

# 공통 Invariant

## 상태 전이

- 모든 protocol message는 `workflowStateBefore`와 실제 현재 state가 일치해야 한다.
- state machine에 허용되지 않은 message는 명시적으로 실패해야 한다.

## ownership / session

- sender role과 assigned ownership이 일치해야 한다.
- stage 전환 follow-up은 필요한 경우 task session을 reset해야 한다.
- role 전환이 있으면 stale context resume이 일어나면 안 된다.

## retrieval / routing

- retrieval-required scenario는 `retrievalUsed=true`를 만족해야 한다.
- symptom-first scenario 입력에는 프로젝트 힌트가 없어야 한다.
- 기대 project 선택은 평가 기준으로만 존재해야 한다.

## UI / observability

- 중요한 상태는 UI에서 숨겨지면 안 된다.
- 실패 시 원인과 단계가 로그 또는 테스트 출력에 남아야 한다.

# 실행 계획

## 기간 추정

| Phase | 예상 기간 | 근거 |
|---|---:|---|
| Phase 0. Security Baseline | 1-2일 | 수정 범위는 작지만 인증/권한/route 회귀 테스트 필요 |
| Phase 1. Fresh DB Bootstrap | 1-2일 | fixture 통일, migration fresh run, legacy 간섭 제거 |
| Phase 2. Scenario Invariant Lock | 3-5일 | 5개 시나리오 × focused test + E2E assertion |
| Phase 3. UI Surface Alignment | 2-3일 | 상태 노출/경고/알림/변경 desk 정합성 |
| Phase 4. Repeat Validation | 1-2일 | 3회 연속 green, flaky root-cause 고정 |
| 합계 | 8-14일 | 안정화 전용 스프린트 |

## Five-Axis 매핑

이 스프린트는 [five-axis-hardening-plan-2026-03-18.md](/home/taewoong/company-project/squadall/docs/exec-plans/active/five-axis-hardening-plan-2026-03-18.md)
를 대체하지 않고, canonical stabilization 관점에서 다시 배치한다.

| Five-Axis 항목 | 이번 스프린트 Phase | 설명 |
|---|---|---|
| Axis 1. project/subtask consistency | Phase 3 | canonical path를 가리는 project surface 정합성 정리 |
| Axis 2. knowledge metric accuracy | Phase 1-2 | retrieval axis와 같이 잠금 |
| Axis 3. IssueDetail query weight | Phase 3 | 상태 노출을 유지한 채 query weight 감산 |
| Axis 4. canonical full-delivery E2E realism | Phase 2 | scenario invariant lock의 핵심 |
| Axis 5. protocol-aware notifications | Phase 3 | UI surface alignment와 함께 정리 |

## Phase 0. Security Baseline

- `server/src/auth/better-auth.ts` hardcoded secret 제거
- email verification 기본 활성화
- issue document body size limit 설정
- deliverables route authorization / route pattern hardening
- upstream remote 추가 및 보안 패치 intake 루틴 문서화

## Phase 1. Fresh DB bootstrap 고정

- canonical company bootstrap 루틴을 하나로 통일
- old company / legacy corpus가 E2E 판단에 간섭하지 않게 격리
- knowledge sync readiness 확인을 선행 조건으로 명시
- migration `0024` 이후 현재 헤드까지 fresh run 검증
- [p1-retrieval-stabilization-plan.md](/home/taewoong/company-project/squadall/docs/exec-plans/active/p1-retrieval-stabilization-plan.md) 의
  선행 테스트/회귀 항목을 bootstrap phase에 연결
- `retrieval-cache.test.ts`, `dashboard-service.test.ts`처럼 현재 known drift가 있는 테스트를 먼저 복구

### Phase 1 구현 메모

- `scripts/e2e/company-bootstrap.mjs`에 company/project bootstrap helper를 분리했다.
- `cloud-swiftsight-autonomy-org.mjs`, `cloud-swiftsight-domain-aware-pm-eval.mjs`는 해당 helper를 사용한다.
- `pnpm db:verify-fresh`는 루트 `.env`의 `DATABASE_URL`을 기본 로드하고,
  empty DB에서도 현재 헤드 migration을 끝까지 적용할 수 있어야 한다.

## Phase 2. Scenario별 invariant 잠금

- 시나리오 1부터 5까지 순서대로 고정
- 각 시나리오에 대해 focused server test + E2E assertion 추가
- 상태 전이, ownership, retrieval를 각각 명시적으로 체크
- `P1 retrieval plan`의 `issue_snapshot demotion`, signal seed, lexical term 안정화 항목을
  retrieval axis의 하위 작업으로 포함
- external dependency flakiness를 줄이기 위해 OpenAI API mock/stub 전략 또는 determinism control을 문서화

### Phase 2 진행 메모

- `full-delivery.mjs`는 시나리오 1과 시나리오 5를 함께 잠근다.
- `cloud-swiftsight-domain-aware-pm-eval.mjs`는 시나리오 2를 잠근다.
- `cloud-swiftsight-real-org.mjs`는 시나리오 3과 시나리오 4를 잠근다.
- merge/deploy follow-up은 `change surface`, `close run candidate`, `close wake evidence`,
  `agent task session`까지 읽어서 `pending_external_merge`, merge candidate provenance,
  close follow-up wake 분리 여부를 검증한다.

## Phase 3. UI surface 정합성

- Inbox clarification
- IssueDetail progress / documents / deliverables / change recovery warning
- ChangeReviewDesk merge-deploy panel
- Overview / ProjectDetail가 canonical path를 가리지 않도록 정리

### Phase 3 진행 메모

- `ProjectDetail` overview는 project-scoped delivery summary와 parent issue current-delivery strip까지 반영됐다.
- `IssueDetail` progress strip은 clarification/subtask/review/QA/artifact 신호를 직접 드러내는 형태로 확장됐다.
- live activity invalidation은 `issues.listByProject`와 `projects.detail`까지 갱신해 project-scoped surfaces가 protocol 변화에 뒤처지지 않도록 맞췄다.
- protocol-aware notifications는 review / changes / merge / deploy 성격의 메시지를 `changes` surface로 연결하도록 정리됐다.

## Phase 4. 반복 검증

- canonical 5개 시나리오 전체를 3회 반복
- 실패 시 flaky로 분류하지 않고 원인을 구조적으로 고정

## Upstream 추적 전략

이번 스프린트 동안 upstream 추적은 Option B를 따른다.

1. upstream remote를 별도로 유지한다.
2. 보안 패치와 low-divergence core fix는 cherry-pick 후보로 관리한다.
3. UI cosmetic divergence는 안정화 스프린트 동안 더 늘리지 않는다.
4. security baseline과 canonical path에 영향을 주는 upstream 변경은 Phase 0/1에서 우선 검토한다.

# 테스트 전략

## Focused server tests

- protocol state / policy / execution
- heartbeat wake / task session reset
- retrieval/routing scoring
- QA policy
- auth / route hardening
- migration fresh-run validation

## UI / browser validation

- support smoke
- full smoke
- critical state surfaces screenshot or DOM assertions

## Canonical system validation

- `pnpm e2e:full-delivery`
- domain-aware PM scenario evaluation
- recovery and QA follow-up scenarios

# Definition of Done

다음 조건을 모두 만족해야 이번 스프린트는 완료다.

1. canonical E2E 5개가 fresh DB 기준으로 green
2. 3회 연속 재실행에서도 green
3. flaky rerun 없이 통과
4. 관련 focused server tests와 browser smoke 유지
5. invariant마다 최소 1개 이상의 테스트 또는 E2E assertion 존재

# 위험 요소

- **HIGH**: migration `0024` 이후 분기 누적으로 fresh DB migrate 자체가 깨질 수 있다.
- **HIGH**: retrieval이 외부 OpenAI API에 의존하므로 E2E determinism이 흔들릴 수 있다.
- **MEDIUM**: deterministic E2E를 위해 fixture를 강화할수록 실행 시간이 늘어날 수 있다.
- **MEDIUM**: close/qa/recovery follow-up은 stale session 버그가 재발한 이력이 있어 재검증이 필요하다.
- **LOW**: UI 표면이 상태를 더 직접 노출하면서 copy tuning이 필요할 수 있다.

# 권고

다음 1~2주 동안은 신규 기능보다 다음 원칙을 우선한다.

- canonical path를 깨는 변경 금지
- security baseline 선행
- state/session invariant 우선
- retrieval axis는 [p1-retrieval-stabilization-plan.md](/home/taewoong/company-project/squadall/docs/exec-plans/active/p1-retrieval-stabilization-plan.md) 과
  분리하지 않고 같이 잠금
- symptom-first routing 보존
- green E2E를 “시연 결과”가 아니라 “제품 계약”으로 취급

이 스프린트가 끝나면 Squadrail은 “강한 베타”에서 “운영 가능한 안정화 베타” 수준으로 올라갈 수 있다.
