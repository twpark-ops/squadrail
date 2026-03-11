# Squadall Run-First Priority Summary

작성일: 2026-03-11

## 현재 기준

- 방향은 `AI software company / autonomous org`로 일관된다.
- 다만 retrieval 최적화 비중이 burn-in보다 앞서기 시작해 우선순위를 재정렬했다.

## 현재 우선순위

1. Replay E2E gate normalization
2. 18-agent real-org burn-in
3. blocked timeout + legacy semantics cleanup
4. retrieval god-file refactor
5. rerank provider abstraction
6. execution lane classifier
7. fast lane optimization
8. deeper multi-hop
9. ranking/cache/trend consolidation
10. cross-issue memory reuse

## 중요한 판단

- replay 기능 자체는 이미 성공했다.
- 현재 막는 것은 readiness gate와 historical coverage hygiene다.
- 따라서 다음 구현은 retrieval 미세튜닝이 아니라 replay gate 정상화와 burn-in이다.

## 관련 문서

- `docs/run-first-burn-in-priority-plan.md`
- `docs/backend-post-phase-plan.md`
- `docs/autonomous-org-full-loop-plan.md`
