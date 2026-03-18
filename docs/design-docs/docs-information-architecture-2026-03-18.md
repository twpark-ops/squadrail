# Docs Information Architecture Plan

## Goal

현재 `docs/`는 내용은 풍부하지만, active plan과 참고 문서가 같은 층위에 섞여 있다.  
이번 구조 개편의 목표는 다음 세 가지다.

1. 루트 진입점을 줄인다.
2. 실행 계획을 `active / completed`로 분리한다.
3. 설계 / 제품 스펙 / 참고 문서를 서로 다른 카테고리로 분리한다.

## Target Structure

- `AGENTS.md`
- `ARCHITECTURE.md`
- `docs/DESIGN.md`
- `docs/FRONTEND.md`
- `docs/PLANS.md`
- `docs/PRODUCT_SENSE.md`
- `docs/QUALITY_SCORE.md`
- `docs/RELIABILITY.md`
- `docs/SECURITY.md`
- `docs/design-docs/`
- `docs/exec-plans/active/`
- `docs/exec-plans/completed/`
- `docs/product-specs/`
- `docs/references/`
- `docs/generated/`

## Migration Policy

1. 기존 문서는 바로 대량 이동하지 않는다.
2. 먼저 인덱스와 상위 맵을 추가한다.
3. 앞으로 새 문서는 새 구조 아래에 쓴다.
4. 기존 top-level 문서는 active/completed 전환 때 점진적으로 이동한다.

## First Mapping

### Active execution plans

- `exec-plans/active/canonical-stabilization-sprint-plan-2026-03-18.md`
- `exec-plans/active/phase-0-security-baseline-design-2026-03-18.md`
- `exec-plans/active/p1-retrieval-stabilization-plan.md`
- `exec-plans/active/five-axis-hardening-plan-2026-03-18.md`

### Product specs

- `batch-a-parent-issue-documents-artifacts-plan-2026-03-17.md`
- `batch-b-onboarding-first-success-runtime-plan-2026-03-17.md`
- `batch-c-budget-quota-composer-collaboration-plan-2026-03-17.md`
- `qa-gate-sanity-panel-plan-2026-03-17.md`
- `onboarding-3-step-first-success-plan-2026-03-17.md`

### References

- `api/`
- `deploy/`
- `runbooks/`
- `adapters/`
- `cli/`

## Exit Criteria

1. 루트 `AGENTS.md`와 `ARCHITECTURE.md`가 존재한다.
2. 루트 진입 문서가 생성되어 있다.
3. 새 문서는 카테고리 기준으로 위치를 찾을 수 있다.
4. active plan과 completed/superseded plan 구분 규칙이 문서화돼 있다.
