# Next Session Handoff

## Start Here

Open this file first, then read:

1. [next-session-handoff.md](/home/taewoong/company-project/squadall/docs/next-session-handoff.md)
2. [summary.md](/home/taewoong/company-project/squadall/memory-bank/projects/squadall-run-first/summary.md)
3. [backend-next-priority-detailed-plan.md](/home/taewoong/company-project/squadall/docs/backend-next-priority-detailed-plan.md)

One-line startup rule:

- open this handoff first, then start immediately with `priority preemption`

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

## Current Product State

- `root 1개 -> hidden child work item fan-out -> multi-project parallel execution -> reviewer -> QA -> done` 검증 완료
- `Human -> PM intake`, `PM projection`, `QA separate gate`, `organizational memory ingest` 완료
- `cross-issue memory reuse` 완료
- `PR bridge + CI gate` 완료
- `team supervision feed + internal work item operator flow` 완료
- `dependency-blocked dispatch enforcement` 완료
- `18-agent real-org burn-in` 완료
- 최신 검증:
  - `pnpm --filter @squadrail/server test` `592 tests` 통과
  - `pnpm --filter @squadrail/server test:coverage -- --reporter=default` 통과
  - server coverage `37.27%`
- 현재 다음 순차 작업은 `7. priority preemption`

## Next Priorities

1. `priority preemption`
2. `per-agent performance scorecard`
3. `merge conflict assist`
4. `execution-failure learning`
5. `external operating alerts`

Interpretation:

- next focus is operator-facing coordination layer and dispatch quality
- rerank/provider work는 지금 immediate next가 아니다

## Recommended First Task Next Session

Start with `priority preemption`.

Suggested slice:

1. heartbeat queue / wakeup candidate에 priority class 모델 정리
2. critical / hotfix issue가 queued medium work보다 먼저 선점되도록 dispatch rule 추가
3. preemption trace를 dashboard / protocol metadata / audit 로그에 노출
4. starvation guard와 regression tests 추가
5. memory-bank summary 업데이트

## Important Files

Team supervision / intake:

- [phase1-team-supervisor-mvp.md](/home/taewoong/company-project/squadall/docs/phase1-team-supervisor-mvp.md)
- [agent-team-mode-plan.md](/home/taewoong/company-project/squadall/docs/agent-team-mode-plan.md)
- [p0b-human-pm-intake-layer.md](/home/taewoong/company-project/squadall/docs/p0b-human-pm-intake-layer.md)
- [issues.ts](/home/taewoong/company-project/squadall/server/src/routes/issues.ts)
- [internal-work-item-supervision.test.ts](/home/taewoong/company-project/squadall/server/src/__tests__/internal-work-item-supervision.test.ts)

Next dispatch / scheduling:

- [heartbeat.ts](/home/taewoong/company-project/squadall/server/src/services/heartbeat.ts)
- [issue-protocol-execution.ts](/home/taewoong/company-project/squadall/server/src/services/issue-protocol-execution.ts)
- [dashboard.ts](/home/taewoong/company-project/squadall/server/src/services/dashboard.ts)

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

For priority / dispatch work:

```bash
pnpm vitest run server/src/__tests__/issue-protocol-execution.test.ts server/src/__tests__/dashboard.test.ts
```

## Product Direction Reminder

- product direction is `standardized software delivery org kernel`
- not arbitrary workflow builder
- `peer mode` is deferred optional feature, not current priority
