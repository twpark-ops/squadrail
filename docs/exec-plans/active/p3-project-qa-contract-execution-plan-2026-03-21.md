---
title: "P3 Project QA Contract Execution Plan"
owner: "taewoong"
status: "active"
last-reviewed: "2026-03-21"
---

# Goal

현재 `Squadrail`의 QA gate는 상태 전이와 evidence gate는 검증됐지만, **프로젝트별로 정의된 실제 테스트 방법을 QA가 그대로 실행하는 계약**은 아직 약하다.

이 계획의 목표는 다음을 닫는 것이다.

1. 운영자가 정의한 프로젝트별 QA 실행 방법을 구조화한다.
2. QA role이 그 계약을 실제 issue에서 그대로 실행하게 만든다.
3. 승인/반려가 generic comment가 아니라 **실행 evidence 기반 판단**이 되게 만든다.

관련 배경 문서:

- [../../design-docs/qa-execution-gate-design.md](../../design-docs/qa-execution-gate-design.md)
- [../../product-specs/qa-gate-sanity-panel-plan-2026-03-17.md](../../product-specs/qa-gate-sanity-panel-plan-2026-03-17.md)

# Scope

## In

- 프로젝트별 QA contract shape 정의
- QA가 따라야 하는 최소 실행 필드 정의
- QA brief / prompt / runbook surface 연결
- QA approval / change-request evidence contract 강화
- 실제 프로젝트 이슈에서 QA가 operator-defined procedure를 실행하는 검증

## Out

- 모든 프로젝트에 대한 완전한 fixture library 구축
- full CI mock adapter 도입
- QA 외 다른 role의 broad prompt overhaul
- 회사 전역 품질 정책 전체 재설계

# Invariants

- QA approval은 operator-defined test procedure 없이 나오면 안 된다.
- QA contract는 최소한 아래를 구조화해야 한다.
  - server or app start method
  - test or probe commands
  - fixtures or input data
  - pass criteria
  - fail / escalation criteria
- QA는 reviewer와 구분된 실행 검증 역할이어야 한다.
- 프로젝트별 contract가 없으면 “QA contract missing”이 명시적으로 드러나야 한다.
- 실제 검증 시나리오는 적어도 한 개 이상의 real project issue로 확인해야 한다.

# Implementation Plan

1. project QA contract schema를 확정한다.
   - 최소 필드:
     - `serverStart`
     - `setupSteps`
     - `fixtureInputs`
     - `commands`
     - `expectedSignals`
     - `passCriteria`
     - `failCriteria`
     - `evidenceRequirements`
2. operator input 수집 포맷을 정한다.
   - 운영자가 프로젝트별 QA 방법을 plain text가 아니라 일정한 구조로 입력하게 만든다.
3. QA read model을 추가한다.
   - IssueDetail / QA panel / brief generation에서 project-scoped QA contract를 읽을 수 있어야 한다.
4. QA execution contract를 agent prompt/runtime note에 연결한다.
   - QA role이 “generic review”가 아니라 “정해진 절차 실행”을 우선 수행하게 만든다.
5. QA evidence policy를 project contract 기반으로 강화한다.
   - 어떤 command를 돌렸는지
   - 어떤 fixture를 썼는지
   - 어떤 output을 확인했는지
   - 왜 pass/fail인지
   가 구조적으로 남아야 한다.
6. 실제 검증을 수행한다.
   - operator-defined QA procedure가 있는 project issue를 하나 골라
   - reviewer approval 이후 QA가 해당 절차를 실행하고
   - `APPROVE_IMPLEMENTATION` 또는 `REQUEST_CHANGES`를 evidence와 함께 남기는지 확인한다.

# Validation

- focused server tests for QA policy / QA contract read model
- UI tests for QA panel / issue detail surface if UI changes are 포함되면
- at least one real project QA issue validation
- `pnpm --filter @squadrail/server typecheck`
- `pnpm docs:check`

# Dependencies / Inputs Needed

이 계획은 아래 operator-defined input이 있어야 본격 진행할 수 있다.

1. 어떤 프로젝트를 QA 대상으로 먼저 잠글지
2. 그 프로젝트에서 QA가 실제로 따라야 하는 실행 절차
3. 서버 실행 방법
4. fixture 또는 sample input
5. pass/fail 기준

예시:

- project: `swiftsight-cloud`
- server start: `...`
- fixture: `...`
- commands:
  - `...`
  - `...`
- pass:
  - `...`
- fail:
  - `...`

# Exit Criteria

- 최소 한 프로젝트에 대해 operator-defined QA contract가 문서화되어 있다.
- QA gate가 그 contract를 issue context에서 읽을 수 있다.
- QA role이 실제 issue에서 해당 절차를 수행하고 structured evidence를 남긴다.
- 승인/반려가 “generic reviewer-style summary”가 아니라 contract 기반 evidence로 기록된다.
- 실검증 결과가 문서와 review findings에 반영된다.
