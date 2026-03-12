# Next Session Handoff

## Start Here

Open this file first, then read:

1. [next-session-handoff.md](/home/taewoong/company-project/squadall/docs/next-session-handoff.md)
2. [summary.md](/home/taewoong/company-project/squadall/memory-bank/projects/squadall-run-first/summary.md)
3. [backend-next-priority-detailed-plan.md](/home/taewoong/company-project/squadall/docs/backend-next-priority-detailed-plan.md)

One-line startup rule:

- open this handoff first, then continue immediately with `workflow templates + auto revert assist`

## Current Status

- `1. 통합 경계 안정화`: P0 1차 완료
  - protocol -> merge candidate -> review desk -> merged close 경계 테스트/타입/정책 정리 완료
- `2. 사람 최종 리뷰 유지 PR bridge`: 완료
  - GitHub/GitLab remote 판별
  - draft PR/MR 생성 또는 상태 동기화
  - PR URL / mergeability / review decision / check status surface 추가
- `3. CI status gate`: 완료
  - synced PR이 있는 경우 `mark_merged`와 `mergeStatus=merged` close를 check/mergeability blocker로 차단
  - PR bridge 없는 local/offline flow는 계속 허용
- `4. Team supervision layer`: 완료
  - company dashboard `team-supervision` feed, Inbox section, Issue Detail operator surface 연결 완료
- `5. Human -> PM intake productization`: 완료
  - New Issue Dialog `Human intake` 진입점과 intake root -> delivery projection UI 연결 완료
- `6. issue dependency graph + blocked dispatch enforcement`: 완료
  - `dependsOn` graph metadata 정규화와 dependency-blocked dispatch gate 완료
- `7. priority preemption`: 완료
  - heartbeat queued run selection이 priority-aware dispatch와 starvation guard를 사용한다.
  - preemption trace가 heartbeat event / activity log / dashboard reliability surface에 남는다.
- `8. per-agent performance scorecard`: 완료
  - dashboard route와 Team page에 agent health / success rate / run duration / bounce / priority preemption scorecard 추가
- `9. merge conflict assist`: 완료
  - change surface와 Review Desk에 mergeability warning / preflight blocker / suggested action surface 추가
- `10. execution-failure learning`: 완료
  - recovery queue가 `failureFamily / retryability / repeated / occurrenceCount24h / operatorActionLabel`를 가진 structured feed가 됐다.
  - repeated runtime failure signal이 review/close gate에서 실제로 close-ready 판단을 보수화한다.
  - Change Review Desk가 failure learning gate, blocker, suggested action, repeated hit count를 직접 surface 한다.
- `11. external operating alerts`: 완료
  - company-level webhook/slack config, live-event sink fan-out, severity/dedupe/cooldown rule, test alert, recent delivery history를 추가했다.
- `12. goal progress / sprint / capacity`: 완료
  - goal schema에 `progressPercent`, `targetDate`, `sprintName`, `capacityTargetPoints`, `capacityCommittedPoints`를 추가하고 Goal detail/properties에서 편집 가능하게 올렸다.
- `13-A. cost prediction`: 완료
  - Costs surface에 month-end projected spend와 budget risk 상태를 추가했다.

## Current Product State

- `root 1개 -> hidden child work item fan-out -> multi-project parallel execution -> reviewer -> QA -> done` 검증 완료
- `Human -> PM intake`, `PM projection`, `QA separate gate`, `organizational memory ingest` 완료
- `cross-issue memory reuse` 완료
- `PR bridge + CI gate` 완료
- `team supervision feed + internal work item operator flow` 완료
- `dependency-blocked dispatch enforcement` 완료
- `priority-aware dispatch + agent scorecard + merge conflict assist` 완료
- `execution-failure learning feed + gate integration` 완료
- `external operating alerts` 완료
- `goal progress / sprint / capacity` 완료
- `monthly cost prediction` 완료
- `18-agent real-org burn-in` 완료
- 최신 검증:
  - `pnpm --filter @squadrail/server test` `614 tests` 통과
  - `pnpm --filter @squadrail/server test:coverage -- --reporter=default` 통과
  - server coverage `37.34%`
- 현재 다음 순차 작업은 `workflow templates + auto revert assist`

## Next Priorities

1. `workflow templates`
2. `auto revert assist`
3. `custom role creation`

Interpretation:

- next focus is operator action acceleration and safer post-merge recovery
- rerank/provider work는 지금 immediate next가 아니다

## Recommended First Task Next Session

Start with `workflow templates + auto revert assist`.

Suggested slice:

1. Protocol Action Console의 hardcoded board templates를 company-configurable template set으로 올리기
2. merge candidate / close snapshot 기준 `revert follow-up issue` 또는 `reopen with rollback plan` assist를 붙이기
3. Change Review Desk와 issue activity에 template usage / revert assist trace를 남기기
4. route/service/UI tests와 memory-bank summary 업데이트

## Important Files

Team supervision / intake:

- [phase1-team-supervisor-mvp.md](/home/taewoong/company-project/squadall/docs/phase1-team-supervisor-mvp.md)
- [agent-team-mode-plan.md](/home/taewoong/company-project/squadall/docs/agent-team-mode-plan.md)
- [p0b-human-pm-intake-layer.md](/home/taewoong/company-project/squadall/docs/p0b-human-pm-intake-layer.md)
- [issues.ts](/home/taewoong/company-project/squadall/server/src/routes/issues.ts)
- [internal-work-item-supervision.test.ts](/home/taewoong/company-project/squadall/server/src/__tests__/internal-work-item-supervision.test.ts)

Next operator / recovery surfaces:

- [ProtocolActionConsole.tsx](/home/taewoong/company-project/squadall/ui/src/components/ProtocolActionConsole.tsx)
- [ChangeReviewDesk.tsx](/home/taewoong/company-project/squadall/ui/src/components/ChangeReviewDesk.tsx)
- [merge-routes.ts](/home/taewoong/company-project/squadall/server/src/routes/issues/merge-routes.ts)
- [issue-merge-automation.ts](/home/taewoong/company-project/squadall/server/src/services/issue-merge-automation.ts)
- [issues.ts](/home/taewoong/company-project/squadall/server/src/routes/issues.ts)

Planning / memory:

- [summary.md](/home/taewoong/company-project/squadall/memory-bank/projects/squadall-run-first/summary.md)
- [backend-next-priority-detailed-plan.md](/home/taewoong/company-project/squadall/docs/backend-next-priority-detailed-plan.md)

## Validation Commands

Run after backend changes:

```bash
pnpm -r typecheck
pnpm test:run
pnpm build
```

For workflow-template / revert-assist work:

```bash
pnpm vitest run server/src/__tests__/issues-routes.test.ts server/src/__tests__/issue-change-surface.test.ts server/src/__tests__/issue-merge-automation.test.ts server/src/__tests__/companies-routes.test.ts
```

## Product Direction Reminder

- product direction is `standardized software delivery org kernel`
- not arbitrary workflow builder
- `peer mode` is deferred optional feature, not current priority
