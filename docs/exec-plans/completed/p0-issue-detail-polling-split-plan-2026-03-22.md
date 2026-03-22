---
title: "Issue Detail Polling Split Plan"
owner: "taewoong"
status: "completed"
last-reviewed: "2026-03-22"
---

# Goal

`IssueDetail`의 기본 `brief` 진입 경로에서 protocol timeline / review / live run 폴링이 같이 돌던 구조를 줄여, 탭 가시성에 맞는 요청만 지속 갱신하게 만든다.

# Scope

## In

- `IssueDetail` polling gate 분리
- pure helper와 focused UI test 추가
- UI typecheck / build 검증

## Out

- `IssueDetail.tsx` 전체 컴포넌트 분리
- run widget / delivery panel 자체의 별도 lazy split

# Invariants

- 기본 `brief` 탭은 brief refresh만 지속 polling한다
- `protocol` / `delivery` / `changes` surface는 필요한 protocol/live data만 polling한다
- live run query는 active tab이 아니어도 기존 live data가 있으면 추적을 이어간다

# Implementation

1. [issue-detail-polling.ts](/home/taewoong/company-project/squadall/ui/src/lib/issue-detail-polling.ts) 로 polling policy를 pure helper로 추출했다.
2. [IssueDetail.tsx](/home/taewoong/company-project/squadall/ui/src/pages/IssueDetail.tsx) 에서 protocol, brief, review, live-run polling을 helper 기준으로 나눴다.
3. [issue-detail-polling.test.ts](/home/taewoong/company-project/squadall/ui/src/lib/issue-detail-polling.test.ts) 로 brief/protocol/delivery/changes 정책과 live refetch interval을 잠갔다.

# Validation

- `pnpm exec vitest run --config ui/vitest.config.ts --environment node ui/src/lib/issue-detail-polling.test.ts`
- `pnpm --filter @squadrail/ui typecheck`
- `pnpm --filter @squadrail/ui build`
- `git diff --check`

# Result

- 기본 `brief` 탭에서는 protocol state/messages/review/live-run 지속 polling이 멈춘다.
- `protocol` / `delivery` / `changes`에서만 해당 surface가 필요한 live refresh가 유지된다.
- live run query는 active tab이 아니어도 이미 active run/live run data가 있으면 3초 추적을 이어간다.
