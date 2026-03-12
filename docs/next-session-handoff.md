# Next Session Handoff

## Start Here

Open this file first, then read:

1. [next-session-handoff.md](/home/taewoong/company-project/squadall/docs/next-session-handoff.md)
2. [summary.md](/home/taewoong/company-project/squadall/memory-bank/projects/squadall-run-first/summary.md)
3. [backend-next-priority-detailed-plan.md](/home/taewoong/company-project/squadall/docs/backend-next-priority-detailed-plan.md)

One-line startup rule:

- open this handoff first, then continue immediately with `PR bridge / merge recovery / workflow template integration scenario + global coverage uplift`

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
- `18-agent real-org burn-in` 완료
- 최신 검증:
  - `pnpm -r typecheck`
  - `pnpm --filter @squadrail/server build`
  - `pnpm --filter @squadrail/server test:coverage -- --reporter=default` 통과
  - `97 files / 651 tests` 통과
  - server coverage `39.53%`
- 현재 다음 순차 작업은 `PR bridge / merge recovery / workflow template integration scenario + global coverage uplift`

## Next Priorities

1. `PR bridge / merge recovery / workflow template integration scenario` 강화
2. global coverage uplift toward `60%` across runtime/operator services
3. low-coverage operator/support services (`merge-pr-bridge`, `operating-alerts`, `costs`) 직접 테스트 확대

Interpretation:

- next focus is preserving the newly hardened operator surfaces with explicit route/change-surface integration scenarios
- 새 기능 backlog보다 integration regression 고정과 low-coverage support service 확장이 immediate next다

## Recommended First Task Next Session

Start with `PR bridge / merge recovery / workflow template integration scenario + coverage uplift`.

Suggested slice:

1. `ProtocolActionConsole -> issues route -> change surface -> ChangeReviewDesk` 통합 시나리오를 한 번 더 강화해 workflow template / revert assist / PR gate trace 회귀를 고정하기
2. `merge-pr-bridge.ts` / `operating-alerts.ts` / `costs.ts` 같은 남은 low-coverage support service direct test를 늘리기
3. 필요하면 `heartbeat.ts` / `issue-retrieval.ts` / `knowledge.ts`의 다음 seam batch를 이어서 global coverage를 `40%+`로 올리기
4. 마지막에 `pnpm -r typecheck`, `pnpm --filter @squadrail/server build`, `pnpm --filter @squadrail/server test:coverage -- --reporter=default` 재실행

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
pnpm vitest run server/src/__tests__/issues-routes.test.ts server/src/__tests__/issue-change-surface.test.ts server/src/__tests__/companies-routes.test.ts server/src/__tests__/merge-pr-bridge.test.ts server/src/__tests__/operating-alerts.test.ts server/src/__tests__/costs.test.ts server/src/__tests__/activity-log.test.ts server/src/__tests__/live-events.test.ts
```

## Product Direction Reminder

- product direction is `standardized software delivery org kernel`
- not arbitrary workflow builder
- `peer mode` is deferred optional feature, not current priority
