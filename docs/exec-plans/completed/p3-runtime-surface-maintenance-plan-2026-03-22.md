---
title: "Runtime Surface Maintenance Plan Phase 3"
owner: "taewoong"
status: "completed"
last-reviewed: "2026-03-22"
---

# Goal

`heartbeat` service 본문에서 DB access/lifecycle cluster를 더 줄이고, dashboard pagination 계약을 실제 UI surface에 연결한다.

# Scope

## In

- `heartbeat-state-store.ts` 도입
- `Team` supervision tab infinite pagination
- `Runs` recovery tab infinite pagination
- pagination helper와 focused UI test 추가
- 설계/맵 문서 동기화

## Out

- `heartbeat.ts` full decomposition
- dashboard 모든 feed의 cursor pagination
- `Inbox` / `Overview` summary surface pagination
- QA contract execution tooling

# Invariants

- 기존 `offset=0` 첫 페이지 contract는 유지된다
- `Team` / `Runs` summary semantics는 첫 페이지 기준으로 유지된다
- paginated UI는 duplicate item을 노출하지 않는다
- `heartbeat` runtime behavior는 service orchestration 관점에서 동일하다

# Implementation Plan

1. `heartbeat-state-store.ts`에 run/lease/session 상태 접근 helper를 옮긴다.
2. `heartbeat.ts`는 state store에서 해당 helper를 주입받도록 바꾼다.
3. `Team` / `Runs`에 paginated feed helper와 `useInfiniteQuery`를 연결한다.
4. load-more UI를 추가하고 first-page summary는 그대로 유지한다.
5. focused tests, typecheck, build, docs 검증을 다시 실행한다.

# Validation

- `pnpm --filter @squadrail/server exec vitest run src/__tests__/heartbeat-internal-helpers.test.ts src/__tests__/heartbeat-workspace-session.test.ts`
- `pnpm exec vitest run --config ui/vitest.config.ts --environment node ui/src/lib/dashboard-feed-pagination.test.ts`
- `pnpm --filter @squadrail/server typecheck`
- `pnpm --filter @squadrail/ui typecheck`
- `pnpm --filter @squadrail/ui build`
- `pnpm docs:check`
- `git diff --check`

# Exit Criteria

- `heartbeat.ts`가 state access/lifecycle helper를 별도 store module에서 가져온다
- `Team` supervision tab이 다음 페이지를 실제로 불러온다
- `Runs` recovery tab이 다음 페이지를 실제로 불러온다
- helper test와 typecheck/build가 green이다

# Result

1. `heartbeat-state-store.ts`를 추가해 agent/run/lease/task-session 관련 state helper를 service 본문 밖으로 옮겼다.
2. `Team` supervision tab은 `useInfiniteQuery`와 `load more`를 사용해 실제 paginated feed를 소비한다.
3. `Runs` recovery tab도 같은 방식으로 다음 페이지를 가져오고 grouped recovery를 누적 표시한다.
4. UI helper test, server/ui typecheck, UI build, docs 검증이 모두 통과했다.
