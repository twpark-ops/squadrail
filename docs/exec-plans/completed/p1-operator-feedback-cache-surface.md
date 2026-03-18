# P1 Operator Feedback and Cache Surface

작성일: 2026-03-11

## 목표

이번 배치의 목표는 이미 들어가 있는 retrieval feedback, candidate cache, final-hit cache를
운영자가 실제 제품 표면에서 읽고 교정할 수 있게 만드는 것이다.

핵심 질문은 세 가지다.

1. 최근 retrieval run이 어떤 issue/role 맥락에서 발생했는가
2. cache가 실제로 어디서 적중하고 있는가
3. operator가 어떤 evidence를 pin/hide해서 후속 brief를 교정하고 있는가

## 12단계 실행 계획

1. 진행 중인 real-org readiness E2E 상태를 먼저 확인한다.
2. Knowledge Explore 표면에 필요한 retrieval read model을 정의한다.
3. 최근 retrieval run 목록 API를 추가한다.
4. 각 retrieval run의 top hit, cache hit, graph signal, personalization signal을 요약한다.
5. Knowledge 페이지에 `Recent Retrieval Loops` 패널을 추가한다.
6. issue-linked retrieval run에 대해 Knowledge 화면에서도 `pin` / `hide`를 기록할 수 있게 한다.
7. operator feedback mutation 후 quality / recent runs 질의를 같이 무효화한다.
8. candidate/final cache 지표를 recent runs 맥락에서 읽을 수 있게 정리한다.
9. route 테스트와 retrieval 품질 테스트를 보강한다.
10. local smoke에 새 Knowledge surface 검증을 추가한다.
11. real-org readiness E2E를 새 서버에서 다시 실행한다.
12. 결과를 backlog / backend 후속 계획 문서에 반영한다.

## 이번 배치 변경점

### Backend

- `GET /api/knowledge/retrieval-runs`
  - 최근 retrieval run 목록
  - issue linkage
  - cache hit 상태
  - graph / personalization signal
  - top hit 5개
- `POST /api/knowledge/retrieval-runs/:id/feedback`
  - issue 없는 ad-hoc retrieval run도 직접 pin / hide 가능
  - retrieval run 기준 feedback event / profile rebuild 수행
- retrieval run read model에 추가
  - feedback summary
  - candidate cache provenance
  - code / review / organizational memory hit mix

### Frontend

- `Knowledge > Explore > Recent Retrieval Loops`
  - 최근 retrieval run 카드
  - top hit preview
  - `Pin` / `Hide` 버튼
  - cache / graph / personalization 배지
  - `issue-linked / ad-hoc` 필터
  - `touched / pinned / hidden / untouched` 필터
  - candidate cache state / revision provenance
  - run-level feedback summary

### 검증

- route/unit 테스트
- UI typecheck
- build / smoke
- live recent runs API smoke
- full test suite

## 남은 후속

1. final-hit cache provenance를 동일 수준으로 더 강조
2. candidate/final cache invalidation taxonomy 정규화
3. deeper chunk-link multi-hop
4. ranking stabilization phase 2
