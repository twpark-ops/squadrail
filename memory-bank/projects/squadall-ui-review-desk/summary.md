# Squadall UI Review Desk Follow-Up

업데이트 기준: 2026-03-12

## 범위

- UI-only worktree: `ui-review-desk-2026`
- 목표:
  - merge candidate operator UI 추가
  - change surface를 review desk로 승격
  - knowledge setup UX 정리
  - Playwright 회귀 테스트 확장

## 완료된 변경

- `ui/src/api/issues.ts`
  - merge candidate resolve / automation wrapper 추가
- `ui/src/components/ChangeReviewDesk.tsx`
  - branch/workspace copy
  - diff / changed-files preview
  - verification artifact drilldown
  - merge candidate operator actions
- `ui/src/pages/IssueDetail.tsx`
  - change section에 operator review desk 연결
- `ui/src/pages/Changes.tsx`
  - primary review desk 추가
  - `primaryReviewSurfaceQuery` 훅을 early return 앞쪽으로 이동해 React hook-order crash 수정
- `ui/src/components/knowledge/KnowledgeSetupPanel.tsx`
  - refresh / sync all / retry failed / active job UI 보강
- `ui/vite.config.ts`
  - markdown/editor vendor chunk strategy를 세분화해 editor async bundle을 추가로 절감
  - `lexical` / `markdown` vendor를 editor shell에서 분리
  - `vite/preload-helper`를 별도 chunk로 분리해 root entry가 editor vendor에 다시 묶이지 않게 고정
- `scripts/smoke/ui-interaction-review.spec.ts`
  - `Overview` first load에서 `mdx-editor` / `lexical` / `markdown` vendor 요청이 발생하지 않는 회귀 검증 추가

## 검증 상태

- `pnpm --filter @squadrail/ui typecheck` 통과
- `pnpm --filter @squadrail/ui build` 통과
- `scripts/smoke/local-ui-flow.sh` 통과
- `UI_REVIEW_BASE_URL=http://127.0.0.1:3390 pnpm exec playwright test scripts/smoke/ui-interaction-review.spec.ts scripts/smoke/ui-support-routes.spec.ts --reporter=line` 통과 (`8 passed`)

## 회귀 테스트 메모

- `local-ui-flow.sh`
  - API 권한 제약 때문에 protocol message를 직접 POST하지 않고 embedded Postgres에 valid merge-candidate/change-surface seed를 직접 주입하도록 변경
  - changes page는 headless `dump-dom` 특성상 title/API log 기준으로 smoke 확인
- `ui-interaction-review.spec.ts`
  - change detail / merge candidate / knowledge setup 회귀 추가
  - `Runs`는 runtime seed 부재를 고려해 페이지 가시성 검증으로 제한
- `ui-support-routes.spec.ts`
  - `Agent Detail` 진입은 현재 backend `runtime-state` 500 이슈 때문에 제외

## 남은 리스크

- backend scope:
  - `GET /api/agents/:id/runtime-state`에서 duplicate-key 500이 발생할 수 있음
  - 이번 worktree에서는 UI-only 범위라 테스트 대상에서 제외
- perf scope:
  - main entry 약 `430kB`, `MarkdownEditor` async chunk 약 `815kB`
  - root entry HTML은 editor CSS preload를 더 이상 포함하지 않는다
  - `Overview` first-load 회귀 테스트 기준으로 editor vendor(`mdx-editor` / `lexical` / `markdown`)는 초기 요청에서 제거됐다
  - editor chunk warning은 줄었지만 아직 Vite large-chunk warning 기준(`500kB`)은 넘는다
