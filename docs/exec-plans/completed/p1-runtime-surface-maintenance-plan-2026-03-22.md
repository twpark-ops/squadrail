---
title: "Runtime Surface Maintenance Plan"
owner: "taewoong"
status: "completed"
last-reviewed: "2026-03-22"
---

# Goal

`heartbeat`, `IssueDetail`, issue list summary, dashboard feed의 유지보수성과 요청량을 한 배치에서 낮춘다.

# Scope

## In

- `heartbeat.ts` helper split first slice
- `IssueDetail` query orchestration split
- issue list internal work summary batch query
- dashboard broad-load reduction with overscan cap

## Out

- `heartbeat.ts` full service decomposition
- `IssueDetail` tab component full split
- dashboard full cursor pagination
- QA contract execution tooling

# Invariants

- issue list `includeSubtasks` 응답 shape는 그대로 유지한다
- dashboard sort semantics는 유지한다
- `IssueDetail` polling gate 계약은 이전 배치와 동일하다
- `heartbeat` helper split은 runtime behavior를 바꾸지 않는다

# Implementation Plan

1. 설계 문서와 active plan을 추가한다.
2. `IssuesService` batched summary API를 추가하고 route loop를 제거한다.
3. dashboard feed에 overscan limit를 넣어 broad-load를 줄인다.
4. `heartbeat` pure helper를 새 module로 옮기고 re-export한다.
5. `IssueDetail` query orchestration을 hook로 추출한다.
6. focused tests, typecheck, build, docs 검증을 실행한다.

# Validation

- `pnpm --filter @squadrail/server exec vitest run src/__tests__/dashboard-service.test.ts`
- `pnpm --filter @squadrail/server exec vitest run src/__tests__/heartbeat-internal-helpers.test.ts src/__tests__/heartbeat-workspace-session.test.ts`
- `pnpm --filter @squadrail/server exec vitest run src/__tests__/issue-service.test.ts`
- `pnpm --filter @squadrail/server exec vitest run -c vitest.heavy.config.ts src/__tests__/issues-routes.test.ts -t "uses batched internal work item summaries for root issues|passes includeSubtasks=true to service"`
- `pnpm --filter @squadrail/server typecheck`
- `pnpm --filter @squadrail/ui typecheck`
- `pnpm --filter @squadrail/ui build`
- `pnpm docs:check`
- `git diff --check`

# Exit Criteria

- issue list N+1 root summary loop가 batched query로 바뀐다
- dashboard `teamSupervision` / `recoveryQueue`가 overscan limit를 사용한다
- `IssueDetail` page에서 query block이 hook로 분리된다
- `heartbeat.ts` helper split first slice가 완료되고 기존 helper tests가 green이다

# Result

1. `IssuesService`에 batched `listInternalWorkItemSummaries()`를 추가해 route-level per-root summary loop를 제거했다.
2. dashboard `teamSupervision`과 `recoveryQueue`는 overscan limit를 사용해 broad-load를 줄였다.
3. `IssueDetail` query orchestration을 `useIssueDetailQueries()` hook로 분리했다.
4. `heartbeat` pure helper를 `heartbeat-runtime-utils.ts`, `heartbeat-dispatch-priority.ts`로 옮기고 기존 export surface는 유지했다.
