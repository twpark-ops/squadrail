# AGENTS.md

이 파일은 `docs/exec-plans/` 아래에서만 적용되는 짧은 로컬 규칙이다.
계획 문서를 `active`와 `completed`로 분리해 유지하는 데 집중한다.

## Placement

- 진행 중인 계획만 `active/`
- 완료되었거나 흡수된 계획은 `completed/`
- 둘 사이에 애매하면 먼저 `active/`에 두고 종료 조건을 적는다

## Plan Rules

- 각 계획은 목표, 범위, 검증, 종료 조건을 가져야 한다.
- 현재 코드/테스트/E2E와 연결되는 링크를 넣는다.
- 완료된 항목은 문서 안에서만 체크하지 말고, 문서 위치도 `completed/`로 옮긴다.
- 운영 부채만 남은 항목은 `tech-debt-tracker.md`로 연결한다.

## Validation

- `pnpm docs:check`
- 상위 맵 `../PLANS.md` 와 인덱스 `index.md` / `active/index.md` / `completed/index.md` 갱신 여부 확인
