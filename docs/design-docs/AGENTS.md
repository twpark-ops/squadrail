# AGENTS.md

이 파일은 `docs/design-docs/` 아래에서만 적용되는 짧은 로컬 규칙이다.
루트 `AGENTS.md`와 `docs/AGENTS.md`를 보완하며, 설계 문서의 역할을 좁혀준다.

## Scope

- 구조 원칙
- 아키텍처 판단
- 장기 설계 방향
- 상태기계 / 데이터모델 / 정보구조 설명

## Keep Here

- 실행 체크리스트보다 설계 이유를 우선한다.
- 현재 구현과 어긋나는 부분은 명시적으로 `가정`, `리스크`, `미구현`으로 적는다.
- `.puml` 짝이 있는 설계 문서는 Markdown과 다이어그램을 함께 갱신한다.

## Do Not Put Here

- 활성 작업 목록
- 완료 여부를 추적하는 운영 TODO
- 제품 UI 카피 초안

## Validation

- `pnpm docs:check`
- 설계 축을 건드리면 상위 맵 `../DESIGN.md` 링크도 확인
