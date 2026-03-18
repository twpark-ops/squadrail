# Core Beliefs

이 문서는 Squadrail의 문서 운영 원칙을 고정한다.
원칙의 큰 방향은 OpenAI의 `Harness Engineering` 글에서 드러난
`짧은 루트 문서 + active plan 분리 + reliability/security를 1급 문서로 취급`하는 접근을
Squadrail 저장소 현실에 맞게 적용한 것이다.

## Principles

1. 루트 진입점은 짧고 강해야 한다.
   - `AGENTS.md`는 작업 규칙
   - `ARCHITECTURE.md`는 기술 구조 진입점
   - `docs/PLANS.md`, `docs/SECURITY.md`, `docs/RELIABILITY.md`는 운영 축별 진입점

2. 설계와 실행 계획은 분리한다.
   - 설계 문서: 구조, 이유, 불변식
   - 실행 계획: active, completed, follow-up

3. Active plan은 작고 현재적이어야 한다.
   - 지금 태우는 계획만 `exec-plans/active`
   - 완료되거나 대체된 계획은 `exec-plans/completed`

4. 품질과 신뢰성은 제품 부속물이 아니라 1급 문서다.
   - `QUALITY_SCORE.md`
   - `RELIABILITY.md`
   - `SECURITY.md`

5. Generated / reference 문서는 설계 문서와 섞지 않는다.
   - generated: 생성물, 보고서, export
   - references: API, deploy, runbook, adapter

6. 새 문서는 템플릿에서 시작한다.
   - active plan: `docs/exec-plans/active/_template.md`
   - product spec: `docs/product-specs/_template.md`
   - design doc: `docs/design-docs/_template.md`
