# AGENTS.md

이 파일은 Squadrail 저장소에서 작업하는 코딩 에이전트를 위한 짧은 맵이다.
상세 규칙의 백과사전이 아니라, 어디를 보고 어떻게 검증해야 하는지 알려주는 입구 역할만 한다.

## Project Overview

- Squadrail은 protocol-first orchestration for autonomous AI squads를 목표로 한다.
- 핵심 제품 루프는 quick request -> PM intake -> project routing -> implementation -> review -> QA/close 이다.
- 작업 전에는 반드시 현재 구조 맵과 active execution plan을 먼저 확인한다.

## Primary Maps

- Repository architecture: `ARCHITECTURE.md`
- Design maps: `docs/DESIGN.md`
- Product maps: `docs/PRODUCT_SENSE.md`
- Active and completed plans: `docs/PLANS.md`
- Reliability: `docs/RELIABILITY.md`
- Security: `docs/SECURITY.md`
- Quality and review findings: `docs/QUALITY_SCORE.md`
- Frontend surfaces: `docs/FRONTEND.md`

## Docs Layout

- `docs/design-docs/`: architecture, principles, information architecture
- `docs/exec-plans/active/`: currently executing plans
- `docs/exec-plans/completed/`: completed or superseded plans
- `docs/product-specs/`: product flows and feature contracts
- `docs/references/`: API, deploy, runbook, adapter references
- `docs/generated/`: generated reports and exports

## Working Rules

- Keep this file short. Put deep detail in docs, not here.
- New active plans go under `docs/exec-plans/active/`.
- Completed or superseded plans move to `docs/exec-plans/completed/`.
- New design docs go under `docs/design-docs/`.
- New product-facing feature specs go under `docs/product-specs/`.
- Prefer updating an existing active plan over creating a duplicate plan.

## Core Commands

- Install workspace deps: `pnpm install`
- Server typecheck: `pnpm --filter @squadrail/server typecheck`
- UI typecheck: `pnpm --filter @squadrail/ui typecheck`
- UI build: `pnpm --filter @squadrail/ui build`
- Full delivery E2E: `pnpm e2e:full-delivery`
- Domain-aware PM burn-in: `pnpm e2e:cloud-swiftsight-domain-aware-pm-burn-in`
- Full UI smoke: `RUN_SUPPORT_PLAYWRIGHT_SPEC=false SMOKE_SCOPE=full ./scripts/smoke/local-ui-flow.sh`

## Testing Expectations

- Run focused tests for the files you change.
- If you touch state transitions, ownership, sessions, or retrieval routing, update canonical E2E or focused protocol tests.
- Before finishing a non-trivial change, run relevant typecheck and at least one realistic end-to-end or smoke path.

## Key Areas

- Protocol and ownership: `server/src/services/issue-protocol*.ts`
- Execution and wake/session handling: `server/src/services/issue-protocol-execution.ts`, `server/src/services/heartbeat*.ts`
- Intake and retrieval routing: `server/src/services/pm-intake.ts`, `server/src/services/retrieval/*`
- Main UI surfaces: `ui/src/pages/IssueDetail.tsx`, `ui/src/pages/DashboardOptimized.tsx`, `ui/src/pages/Inbox.tsx`

## Security / Reliability Guardrails

- Do not reintroduce hardcoded auth secrets.
- Keep company boundary checks explicit on company-scoped routes.
- Treat stale session reuse, missing ownership, and retrieval false positives as reliability bugs.
- If a change affects canonical path behavior, update the active plan under `docs/exec-plans/active/`.
