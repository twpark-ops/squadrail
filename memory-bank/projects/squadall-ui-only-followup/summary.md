# Squadall UI-Only Follow-up Summary

작성일: 2026-03-11

## 현재 기준

- 메인 6개 탭과 shell 1차 리빌드는 이미 끝난 상태다.
- 현재 활성 worktree는 `/home/taewoong/company-project/squadall-ui-only-followup-2026`이고 브랜치는 `ui-only-followup-2026`이다.
- 방향은 "예쁜 대시보드"보다 "잘 쓰이는 운영 툴"이다.

## 사용자 선호

- 왼쪽 rail, sidebar, wordmark는 GPT platform처럼 더 얇고 조밀한 방향을 선호한다.
- 다만 밀도를 올리더라도 사용성을 희생하면 안 된다.
- `Overview`, `Changes`, `Knowledge`처럼 정보가 넓게 퍼져 보이는 화면은 한눈에 판단되는 구조를 원한다.
- UI 코드와 사용자 노출 copy에 한글 문자열이 남는 것을 원치 않는다.

## 이번까지 완료된 범위

- shell density follow-up
- support/detail/admin 라우트 전반 리디자인
- `Overview`, `Changes`, `Knowledge`의 first-fold와 sparse-state 정리
- dark-mode 점검 및 보정
- browser smoke + Playwright 상호작용 검증

## 현재 검증 상태

- `pnpm --filter @squadrail/ui typecheck`: pass
- `pnpm --filter @squadrail/ui build`: pass
- `scripts/smoke/local-ui-flow.sh`: pass
- `pnpm exec playwright test scripts/smoke/ui-interaction-review.spec.ts scripts/smoke/ui-support-routes.spec.ts --reporter=line`: pass
- `ui/src`, `scripts` 범위 한글 문자열/주석 검색: clean
- `Overview` first-load log review: root entry no longer fetches `mdx-editor` or `dnd-kit`
- production root bundle no longer contains static `framer-motion`, `mdx-editor`, or `dnd-kit` references
- company rail persistence is now verified through stored-order reload validation with a two-company smoke seed

## 남은 UI-only 핵심

1. optional bundle shaving beyond current baseline
2. pointer-drag reorder automation remains a manual-only gap in headless `dnd-kit`
3. Playwright를 로컬 regression suite로 계속 유지

## 중요한 관찰

- 현재 구조적 UI 문제는 대부분 닫혔다.
- `CompanyRail` reorder는 lazy mode로 분리되어 기본 shell에서 `@dnd-kit/*`가 빠졌다.
- `MarkdownEditor` 경로 분리 이후 `Overview` 첫 진입에서 `mdx-editor`와 `dnd-kit` 요청이 사라졌다.
- `HeroSection`의 shell-level motion 제거로 primary surfaces의 공통 animation cost를 더 줄였다.
- `framer-motion` 의존도는 UI root entry 기준으로 제거되었고 별도 motion chunk도 더 이상 생성되지 않는다.
- 남은 일은 broad redesign이 아니라 optional perf polishing과 deeper QA다.
