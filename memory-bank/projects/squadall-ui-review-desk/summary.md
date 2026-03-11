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

## 검증 상태

- `pnpm --filter @squadrail/ui typecheck` 통과
- `pnpm --filter @squadrail/ui build` 통과
- `scripts/smoke/local-ui-flow.sh` 통과
- `UI_REVIEW_BASE_URL=http://127.0.0.1:3386 pnpm exec playwright test scripts/smoke/ui-interaction-review.spec.ts scripts/smoke/ui-support-routes.spec.ts --reporter=line` 통과 (`7 passed`)

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
  - main entry 약 `431kB`, `MarkdownEditor` async chunk 약 `816kB`
  - editor chunk warning은 줄었지만 아직 Vite large-chunk warning 기준(`500kB`)은 넘는다
  - browser/server log 기준 일부 첫 진입 경로에서도 editor vendor(`mdx-editor` / `lexical` / `markdown`) 요청이 따라와서 완전한 lazy isolation은 아직 아니다
