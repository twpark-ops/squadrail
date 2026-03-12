# Next Session Handoff

## Start Here

Open this file first, then read:

1. [next-session-handoff.md](/home/taewoong/company-project/squadall/docs/next-session-handoff.md)
2. [summary.md](/home/taewoong/company-project/squadall/memory-bank/projects/squadall-run-first/summary.md)
3. [backend-next-priority-detailed-plan.md](/home/taewoong/company-project/squadall/docs/backend-next-priority-detailed-plan.md)

One-line startup rule:

- open this handoff first, then continue immediately with `issue-protocol / heartbeat / knowledge / issue-retrieval coverage uplift`

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
- `13-B. workflow templates + auto revert assist`: 완료
  - Company Settings에서 company-scoped workflow templates를 저장/편집할 수 있게 올렸다.
  - Protocol Action Console이 company/default template set을 읽어 board payload를 실제로 구성한다.
  - Change Review Desk와 merge recovery route가 revert follow-up / reopen with rollback context를 제품 action으로 제공한다.
- `13-C. custom role creation`: 완료
  - Company Settings에서 base role을 상속한 custom role pack을 생성하고 바로 Role Studio로 편집할 수 있게 연결했다.
  - custom role은 `roleKey=custom`, `scopeId=custom:<slug>`로 저장돼 다수 company-specific 역할을 지원한다.
- `13-D. workflow/recovery/custom-role hardening`: 완료
  - `workflow-templates.ts`, `revert-assist.ts`, `role-packs.ts` direct service 테스트를 추가해 operator surface의 edge case를 닫았다.
  - `issue-retrieval.ts`에서 recipient brief quality 계산 seam을 exported helper로 분리하고 direct test로 고정했다.
  - custom role identity/metadata normalization을 pure helper로 분리해 duplicate/slug/status 관련 drift를 줄였다.
- `13-E. runtime coverage/decomposition batch 1`: 진행 중
  - `heartbeat.ts`에서 dispatch preemption context/detail builder seam을 추출하고 direct test를 추가했다.
  - `issue-retrieval.ts`에서 finalization graph/exact-path metric builder seam을 추출하고 direct test를 추가했다.
  - `knowledge.ts`에서 project revision / document deprecation builder seam을 추출하고 service test를 추가했다.
- `13-F. runtime coverage/decomposition batch 2`: 진행 중
  - `heartbeat.ts`에서 outcome/cancel persistence helper를 추출해 execute/cancel lifecycle 중복을 줄였다.
  - `issue-retrieval.ts`에서 completion persistence/live-event plan seam을 추출해 finalization tail을 더 압축했다.
  - `knowledge.ts`에서 chunk insert/link builder seam을 추출하고 `replaceDocumentChunks` no-op service test를 추가했다.
- `13-G. runtime coverage/decomposition batch 3`: 진행 중
  - `heartbeat.ts`에서 deferred wake promotion helper를 추출하고 `cancelIssueScope` direct service test를 추가했다.
  - `issue-retrieval.ts`에서 completion persistence apply helper를 추출해 brief persist -> debug patch -> activity/live-event 순서를 direct test로 고정했다.
  - `knowledge.ts`의 `replaceDocumentChunks` populated path와 retrieval cache insert path service test를 추가했다.
- `13-H. support service coverage uplift batch 1`: 진행 중
  - `activity-log.ts` direct test를 추가해 sanitize + live event publish 경로를 고정했다.
  - `live-events.ts` direct test를 추가해 company subscription / sink fan-out / sink failure warning 경로를 고정했다.
  - `costs.test.ts`에 unbounded forecast 케이스를 추가했다.
- `13-I. operator/support coverage uplift batch 2`: 진행 중
  - `merge-pr-bridge.test.ts`를 remote detection만 보던 수준에서 실제 GitHub/GitLab sync normalization 경로까지 확장했다.
  - `operating-alerts-service.test.ts`를 추가해 view normalization, test alert, dedupe skip, dependency-blocked live event delivery를 직접 고정했다.
  - `costs.test.ts`에 `costService.summary()` direct service test를 추가해 monthly forecast aggregation까지 검증했다.
  - `issue-change-surface.test.ts`에 workflow template trace + PR gate + revert assist + failure assist가 동시에 유지되는 composite regression을 추가했다.
- `13-J. route-level operator story + support/runtime uplift batch 3`: 진행 중
  - `issues-routes.test.ts`의 change-surface route가 workflow template trace, PR bridge gate, failure assist, revert assist, retrieval feedback/brief context를 한 번에 검증하도록 확장됐다.
  - `companies-routes.test.ts`가 workflow template action type dedupe와 recent operating alert delivery surface를 직접 고정한다.
  - `costs.test.ts`가 `createEvent`, `byAgent`, `byProject` direct service 경로까지 덮고, `operating-alerts.test.ts`와 `merge-pr-bridge.test.ts`가 violation/missing-token/unsupported-remote 분기를 추가로 닫았다.
  - `heartbeat-service-flow.test.ts`, `knowledge-service-cache.test.ts`, `issue-retrieval-finalization.test.ts`에 runtime 4차 focused regression을 추가했다.
- `13-K. large operator/service direct coverage uplift`: 진행 중
  - `company-service.test.ts`, `dashboard-service.test.ts`, `issue-protocol-service.test.ts`, `role-pack-service.test.ts`를 추가해 large operator/service direct path를 고정했다.
  - `companies.ts`, `dashboard.ts`, `issue-protocol.ts`, `role-packs.ts`의 주요 service 경계가 route bypass 없이 직접 검증된다.
- `13-L. runtime coverage/decomposition batch 5`: 진행 중
  - `heartbeat-service-flow.test.ts`에 `resetRuntimeSession` global clear와 `cancelSupersededIssueFollowups` direct service test를 추가했다.
  - `knowledge-service-operations.test.ts`에 retrieval policy upsert, retrieval run brief link, retrieval debug patch merge service test를 추가했다.
  - `issue-retrieval-finalization.test.ts`에 zero-evidence finalization artifact regression을 추가했다.
- `13-M. runtime/protocol coverage uplift batch 6`: 진행 중
  - `projects-routes.test.ts`, `secrets-routes.test.ts`, `access-admin-routes.test.ts`를 추가해 low-coverage route shell 1차를 닫았다.
  - `issue-protocol-service.test.ts`, `heartbeat-service-flow.test.ts`, `knowledge-service-operations.test.ts`, `issue-retrieval-finalization.test.ts`에 direct service/finalization branch를 추가했다.
  - `access.ts`, `projects.ts`, `secrets.ts` route coverage를 끌어올리고, `knowledge.ts`, `heartbeat.ts`, `issue-protocol.ts`, `issue-retrieval.ts` bottleneck을 추가로 눌렀다.
- `13-N. recovery/template/role integrity hardening`: 완료
  - `merge recovery reopen`이 issue row만 `todo`로 되돌리던 경로에서 벗어나, `issue-protocol` terminal state를 `assigned`로 복구하고 assignee wakeup까지 같이 타도록 정리했다.
  - workflow template update는 `default-*` reserved prefix와 duplicate ID를 shared validator + service layer 양쪽에서 차단한다.
  - custom role creation은 transaction으로 감싸 partial set/revision/file row가 남지 않게 했다.
  - Company Settings custom role success는 `setupProgress` / `doctor` query까지 invalidate해서 stale operator shell을 줄였다.

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
- `workflow templates` 완료
- `auto revert assist` 완료
- `custom role creation` 완료
- `recovery reopen consistency / workflow template invariants / custom role transactionality / Company Settings invalidate` 완료
- `18-agent real-org burn-in` 완료
- 최신 검증:
  - `pnpm --filter @squadrail/shared typecheck`
  - `pnpm --filter @squadrail/server typecheck`
  - `pnpm --filter @squadrail/ui typecheck`
  - `pnpm --filter @squadrail/server build`
  - `pnpm --filter @squadrail/ui build`
  - `pnpm --filter @squadrail/server exec vitest run src/__tests__/issues-routes.test.ts src/__tests__/issue-protocol-service.test.ts src/__tests__/workflow-templates.test.ts src/__tests__/role-pack-service.test.ts src/__tests__/companies-routes.test.ts`
  - `pnpm --filter @squadrail/server test`
  - `105 files / 723 tests` 통과
  - coverage baseline은 직전 측정치 `46.75%`
- 현재 다음 순차 작업은 `issue-protocol / heartbeat / knowledge / issue-retrieval coverage uplift`

## Next Priorities

1. remaining global coverage uplift toward `60%` across large runtime/operator services
2. `issue-protocol.ts / heartbeat.ts / knowledge.ts / issue-retrieval.ts` direct test와 tail branch coverage 확대
3. low-coverage support shell (`access.ts`, `board-claim.ts`, `dashboard.ts`, `companies.ts`, `secrets.ts` service/route surface) 중 ROI 높은 표면만 선택 보강

Interpretation:

- next focus is raising coverage on the biggest runtime/protocol bottlenecks
- 새 기능 backlog보다 large service direct test와 tail branch regression 고정이 immediate next다

## Recommended First Task Next Session

Start with `issue-protocol / heartbeat / knowledge / issue-retrieval coverage uplift`.

Suggested slice:

1. `issue-protocol.ts` direct service test를 더 늘리고, heavy path는 `appendMessage` 전체보다 `listMessages/createViolation/close gate edge`부터 메우기
2. `heartbeat.ts`는 `tickTimers/reap/reset/cancel/promote` service path를 계속 direct test로 늘리기
3. `knowledge.ts`는 retrieval policy/run/debug/cache/report 계열 service path를 더 직접 고정하기
4. `issue-retrieval.ts`는 finalization/orchestration helper coverage를 계속 올리기
5. shell 쪽은 `access/projects/secrets` 1차 이후 `board-claim.ts`와 `dashboard/companies` service surface 위주로 좁혀서 메우기
6. 마지막에 `pnpm -r typecheck`, `pnpm --filter @squadrail/server build`, `pnpm --filter @squadrail/server test:coverage -- --reporter=default` 재실행

## Important Files

Team supervision / intake:

- [phase1-team-supervisor-mvp.md](/home/taewoong/company-project/squadall/docs/phase1-team-supervisor-mvp.md)
- [agent-team-mode-plan.md](/home/taewoong/company-project/squadall/docs/agent-team-mode-plan.md)
- [p0b-human-pm-intake-layer.md](/home/taewoong/company-project/squadall/docs/p0b-human-pm-intake-layer.md)
- [issues.ts](/home/taewoong/company-project/squadall/server/src/routes/issues.ts)
- [internal-work-item-supervision.test.ts](/home/taewoong/company-project/squadall/server/src/__tests__/internal-work-item-supervision.test.ts)

Recently completed operator / recovery surfaces:

- [ProtocolActionConsole.tsx](/home/taewoong/company-project/squadall/ui/src/components/ProtocolActionConsole.tsx)
- [ChangeReviewDesk.tsx](/home/taewoong/company-project/squadall/ui/src/components/ChangeReviewDesk.tsx)
- [merge-routes.ts](/home/taewoong/company-project/squadall/server/src/routes/issues/merge-routes.ts)
- [issue-protocol.ts](/home/taewoong/company-project/squadall/server/src/services/issue-protocol.ts)
- [workflow-templates.ts](/home/taewoong/company-project/squadall/server/src/services/workflow-templates.ts)
- [role-packs.ts](/home/taewoong/company-project/squadall/server/src/services/role-packs.ts)
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

For heartbeat / issue-retrieval / knowledge hardening:

```bash
pnpm vitest run server/src/__tests__/heartbeat-service-flow.test.ts server/src/__tests__/issue-retrieval-finalization.test.ts server/src/__tests__/knowledge-service-operations.test.ts server/src/__tests__/issues-routes.test.ts server/src/__tests__/issue-change-surface.test.ts
```

For operator integration + coverage uplift:

```bash
pnpm vitest run server/src/__tests__/issues-routes.test.ts server/src/__tests__/issue-change-surface.test.ts server/src/__tests__/companies-routes.test.ts server/src/__tests__/projects-routes.test.ts server/src/__tests__/secrets-routes.test.ts server/src/__tests__/access-admin-routes.test.ts server/src/__tests__/merge-pr-bridge.test.ts server/src/__tests__/operating-alerts.test.ts server/src/__tests__/costs.test.ts server/src/__tests__/activity-log.test.ts server/src/__tests__/live-events.test.ts
```

## Product Direction Reminder

- product direction is `standardized software delivery org kernel`
- not arbitrary workflow builder
- `peer mode` is deferred optional feature, not current priority
