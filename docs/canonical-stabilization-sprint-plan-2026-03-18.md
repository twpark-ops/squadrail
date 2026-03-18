---
title: "Canonical Stabilization Sprint Plan"
author: "Taewoong Park <park.taewoong@airsmed.com>"
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
시나리오, invariant, 검증 계획을 정리한다.

# 배경

최근 수정과 검증을 통해 다음 사실이 분명해졌다.

1. 핵심 프로토콜 모델과 역할 기반 실행 제어는 유효하다.
2. 실제 불안정성은 주로 후속 wake, task session reset, close follow-up 같은 운영 glue에서 발생한다.
3. symptom-first intake, retrieval evidence, engineer assignment, review/close를 한 줄로 묶는
   canonical E2E가 제품 의도를 가장 잘 드러낸다.
4. 같은 종류의 버그가 반복되는 이유는, 시나리오별 invariant가 충분히 테스트로 잠기지 않았기 때문이다.

# 목표

## 1. 시스템 목표

- 제품의 golden path를 명시적으로 5개로 고정한다.
- 각 경로에 대해 반드시 지켜야 하는 상태 전이와 ownership/session invariant를 정의한다.
- UI smoke, focused server tests, canonical E2E가 같은 제품 계약을 바라보게 만든다.

## 2. 품질 목표

- **MUST**: canonical E2E 5개 3회 연속 green
- **MUST**: `approved -> close`, `changes_requested -> recovery`, `qa_pending -> close` 경로에서
  stale session 재사용이 없어야 한다.
- **MUST**: symptom-first 시나리오에서 입력에 프로젝트 힌트를 넣지 않는다.
- **MUST**: retrieval-required 시나리오에서 실제 evidence가 기록된다.
- **SHOULD**: UI가 해당 상태를 숨기지 않고 직접 노출한다.

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

## Phase 1. Fresh DB bootstrap 고정

- canonical company bootstrap 루틴을 하나로 통일
- old company / legacy corpus가 E2E 판단에 간섭하지 않게 격리
- knowledge sync readiness 확인을 선행 조건으로 명시

## Phase 2. Scenario별 invariant 잠금

- 시나리오 1부터 5까지 순서대로 고정
- 각 시나리오에 대해 focused server test + E2E assertion 추가
- 상태 전이, ownership, retrieval를 각각 명시적으로 체크

## Phase 3. UI surface 정합성

- Inbox clarification
- IssueDetail progress / documents / deliverables / change recovery warning
- ChangeReviewDesk merge-deploy panel
- Overview / ProjectDetail가 canonical path를 가리지 않도록 정리

## Phase 4. 반복 검증

- canonical 5개 시나리오 전체를 3회 반복
- 실패 시 flaky로 분류하지 않고 원인을 구조적으로 고정

# 테스트 전략

## Focused server tests

- protocol state / policy / execution
- heartbeat wake / task session reset
- retrieval/routing scoring
- QA policy

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

- **MEDIUM**: deterministic E2E를 위해 fixture를 강화할수록 실행 시간이 늘어날 수 있다.
- **MEDIUM**: close/qa/recovery follow-up은 세션 재사용 버그가 다시 나타날 가능성이 높다.
- **LOW**: UI 표면이 상태를 더 직접 노출하면서 copy tuning이 필요할 수 있다.

# 권고

다음 1~2주 동안은 신규 기능보다 다음 원칙을 우선한다.

- canonical path를 깨는 변경 금지
- state/session invariant 우선
- symptom-first routing 보존
- green E2E를 “시연 결과”가 아니라 “제품 계약”으로 취급

이 스프린트가 끝나면 Squadrail은 “강한 베타”에서 “운영 가능한 안정화 베타” 수준으로 올라갈 수 있다.
