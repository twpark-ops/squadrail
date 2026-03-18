# AGENTS.md

이 파일은 `docs/product-specs/` 아래에서만 적용되는 짧은 로컬 규칙이다.
제품 표면과 사용자 흐름 문서를 현재 코드와 맞춰 유지하는 데 집중한다.

## Scope

- 사용자 플로우
- 제품 기능 계약
- 화면/탭/CTA 기대 동작
- 구현된 기능과 예정 기능의 경계

## Working Rules

- 이미 구현된 기능이면 `design draft` 문구를 그대로 두지 말고 상태를 갱신한다.
- 코드 참조를 넣을 때는 실제 현재 경로를 쓴다.
- UI/제품 문서를 옮기거나 추가하면 상위 맵 `../PRODUCT_SENSE.md`, 필요 시 `../FRONTEND.md`도 같이 갱신한다.
- 구현 계획과 제품 설명을 섞지 않는다. 실행 순서는 `../exec-plans/`로 보낸다.

## Validation

- `pnpm docs:check`
- 구현 근거로 넣은 링크가 실제 코드 파일을 가리키는지 확인
