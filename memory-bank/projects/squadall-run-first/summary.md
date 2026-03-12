# Squadall Run-First Priority Summary

작성일: 2026-03-12

## 2026-03-13 runtime/protocol coverage uplift 7차 업데이트

- `13-O runtime/protocol coverage uplift batch 7`: **완료**
  - `issue-protocol-state-policy.test.ts`에 state projection, mirror comment, review/approval transition helper coverage를 추가했다.
  - `issue-retrieval.test.ts`에 cached embedding / retrieval hit serialization / cache payload / provenance / revision signature helper coverage를 추가했다.
  - `knowledge-service-operations.test.ts`에 document / retrieval policy / retrieval run read path direct service test를 추가했다.
  - `heartbeat-service-flow.test.ts`에 `invoke` wrapper와 `cancelActiveForAgent` direct service branch를 추가했다.
- 이번 라운드 검증:
  - `pnpm --filter @squadrail/server exec vitest run src/__tests__/issue-protocol-state-policy.test.ts src/__tests__/heartbeat-service-flow.test.ts src/__tests__/knowledge-service-operations.test.ts src/__tests__/issue-retrieval.test.ts`
  - `pnpm --filter @squadrail/server typecheck`
  - `pnpm --filter @squadrail/server build`
  - `pnpm --filter @squadrail/server test:coverage -- --reporter=default`
  - 최신 server coverage: statements/lines `47.70%`, branches `62.88%`, functions `71.31%`
  - 최신 server tests: `105 files / 736 tests` 통과
  - immediate next는 `issue-protocol appendMessage / heartbeat reap-watchdog / knowledge listRecentRetrievalRuns / issue-retrieval service-body cache-revision path`다.

## 2026-03-13 recovery / workflow / role integrity hardening 업데이트

- `review doc follow-up 1~4`: **완료**
  - `merge-routes.ts` recovery reopen이 `issueProtocolService.reopenForRecovery()`를 사용해 terminal protocol state를 `assigned`로 되돌리고 assignee wakeup까지 함께 처리한다.
  - `workflow-template` shared validator와 `workflow-templates.ts` service가 duplicate ID / reserved `default-*` ID를 함께 차단한다.
  - `role-packs.ts createCustomRolePack()`은 transaction으로 감싸 partial persisted custom role row를 남기지 않게 했다.
  - `CompanySettings.tsx` custom role create success는 `setupProgress` / `doctor` query까지 invalidate한다.
- 이번 라운드 검증:
  - `pnpm --filter @squadrail/server exec vitest run src/__tests__/issues-routes.test.ts src/__tests__/issue-protocol-service.test.ts src/__tests__/workflow-templates.test.ts src/__tests__/role-pack-service.test.ts src/__tests__/companies-routes.test.ts`
  - `pnpm --filter @squadrail/shared typecheck`
  - `pnpm --filter @squadrail/server typecheck`
  - `pnpm --filter @squadrail/ui typecheck`
  - `pnpm --filter @squadrail/server build`
  - `pnpm --filter @squadrail/ui build`
  - `pnpm --filter @squadrail/server test`
  - 최신 server tests: `105 files / 723 tests` 통과
  - coverage baseline은 직전 측정치 `46.75%`
  - immediate next는 `issue-protocol / heartbeat / knowledge / issue-retrieval coverage uplift`이다.

## 2026-03-13 runtime/protocol coverage uplift 6차 업데이트

- `13-M runtime/protocol coverage uplift batch 6`: **진행 중**
  - `projects-routes.test.ts`, `secrets-routes.test.ts`, `access-admin-routes.test.ts`를 추가해 low-coverage route shell 1차를 닫았다.
  - `issue-protocol-service.test.ts`, `heartbeat-service-flow.test.ts`, `knowledge-service-operations.test.ts`, `issue-retrieval-finalization.test.ts`에 direct service/finalization branch를 추가했다.
  - `access.ts`, `projects.ts`, `secrets.ts` route coverage를 끌어올리고, `knowledge.ts`, `heartbeat.ts`, `issue-protocol.ts`, `issue-retrieval.ts` bottleneck에 추가 테스트를 넣었다.
- 이번 라운드 검증:
  - `pnpm --filter @squadrail/server exec vitest run src/__tests__/projects-routes.test.ts src/__tests__/secrets-routes.test.ts src/__tests__/access-admin-routes.test.ts src/__tests__/issue-protocol-service.test.ts src/__tests__/heartbeat-service-flow.test.ts src/__tests__/knowledge-service-operations.test.ts src/__tests__/issue-retrieval-finalization.test.ts`
  - `pnpm --filter @squadrail/server typecheck`
  - `pnpm --filter @squadrail/server build`
  - `pnpm --filter @squadrail/server test:coverage -- --reporter=default`
  - 최신 server coverage: statements/lines `46.75%`, branches `63.56%`, functions `69.56%`
  - 최신 server tests: `105 files / 717 tests` 통과
  - immediate next는 `issue-protocol / heartbeat / knowledge / issue-retrieval coverage uplift`이되, shell 쪽은 `board-claim.ts / dashboard.ts / companies.ts / secrets.ts` ROI pass로 좁혀졌다.

## 2026-03-13 runtime/protocol coverage uplift 5차 업데이트

- `13-L runtime coverage/decomposition batch 5`: **진행 중**
  - `heartbeat-service-flow.test.ts`에 `resetRuntimeSession` global clear, `cancelSupersededIssueFollowups` direct service test를 추가했다.
  - `knowledge-service-operations.test.ts`에 retrieval policy upsert, retrieval run brief link, retrieval debug patch merge service test를 추가했다.
  - `issue-retrieval-finalization.test.ts`에 zero-evidence finalization artifact regression을 추가했다.
- 이번 라운드 검증:
  - `pnpm --filter @squadrail/server exec vitest run src/__tests__/heartbeat-service-flow.test.ts src/__tests__/knowledge-service-operations.test.ts src/__tests__/issue-retrieval-finalization.test.ts`
  - `pnpm --filter @squadrail/server typecheck`
  - `pnpm --filter @squadrail/server build`
  - `pnpm --filter @squadrail/server test:coverage -- --reporter=default`
  - 최신 server coverage: statements/lines `45.78%`, branches `63.75%`, functions `68.64%`
  - 최신 server tests: `102 files / 693 tests` 통과
  - immediate next는 `issue-protocol / heartbeat / knowledge / issue-retrieval coverage uplift`이다.

## 2026-03-13 large operator/service direct coverage uplift 업데이트

- `13-K large operator/service direct coverage uplift`: **진행 중**
  - `company-service.test.ts`, `dashboard-service.test.ts`, `issue-protocol-service.test.ts`, `role-pack-service.test.ts`를 추가했다.
  - `companies.ts`, `dashboard.ts`, `issue-protocol.ts`, `role-packs.ts` direct service path를 route bypass 없이 직접 검증한다.
- 이번 라운드 검증:
  - `pnpm --filter @squadrail/server exec vitest run src/__tests__/company-service.test.ts src/__tests__/dashboard-service.test.ts src/__tests__/issue-protocol-service.test.ts src/__tests__/role-pack-service.test.ts`
  - `pnpm --filter @squadrail/server typecheck`
  - `pnpm --filter @squadrail/server build`
  - `pnpm --filter @squadrail/server test:coverage -- --reporter=default`
  - 최신 server coverage: statements/lines `45.46%`, branches `63.70%`, functions `68.17%`
  - 최신 server tests: `102 files / 688 tests` 통과
  - immediate next는 `heartbeat / issue-retrieval / knowledge` 추가 batch였다.

## 2026-03-13 route-level operator story + support/runtime uplift 3차 업데이트

- `13-J route-level operator story + support/runtime uplift batch 3`: **진행 중**
  - `issues-routes.test.ts` change-surface route가 workflow template trace, PR gate, failure assist, revert assist, retrieval feedback/brief context를 같이 검증한다.
  - `companies-routes.test.ts`가 workflow template action-type dedupe와 recent operating alert delivery surface를 직접 고정한다.
  - `costs.test.ts`가 `createEvent`, `byAgent`, `byProject` direct service 경로까지 덮고, `operating-alerts.test.ts`, `merge-pr-bridge.test.ts`가 violation / unsupported remote / missing token 분기를 추가로 닫았다.
  - `heartbeat-service-flow.test.ts`, `knowledge-service-cache.test.ts`, `issue-retrieval-finalization.test.ts`에 runtime 4차 focused regression을 추가했다.
- 이번 라운드 검증:
  - `pnpm --filter @squadrail/server exec vitest run src/__tests__/issues-routes.test.ts src/__tests__/companies-routes.test.ts src/__tests__/costs.test.ts src/__tests__/merge-pr-bridge.test.ts src/__tests__/operating-alerts.test.ts src/__tests__/operating-alerts-service.test.ts src/__tests__/heartbeat-service-flow.test.ts src/__tests__/knowledge-service-cache.test.ts src/__tests__/issue-retrieval-finalization.test.ts`
  - `pnpm --filter @squadrail/server typecheck`
  - `pnpm --filter @squadrail/server build`
  - `pnpm --filter @squadrail/server test:coverage -- --reporter=default`
  - 최신 server coverage: statements/lines `41.34%`, branches `64.74%`, functions `65.71%`
  - 최신 server tests: `98 files / 670 tests` 통과
  - immediate next는 `remaining global coverage uplift on large operator/runtime services`다.

## 2026-03-13 operator/support coverage uplift 2차 업데이트

- `13-I operator/support coverage uplift batch 2`: **진행 중**
  - `merge-pr-bridge.test.ts`를 실제 GitHub/GitLab sync normalization 경로까지 확장했다.
  - `operating-alerts-service.test.ts`를 추가해 config normalization, test alert, dedupe skip, dependency-blocked live event delivery를 직접 고정했다.
  - `costs.test.ts`에 `costService.summary()` direct service test를 추가해 monthly forecast aggregation을 검증했다.
  - `issue-change-surface.test.ts`에 workflow template trace + PR gate + revert assist + failure assist를 한 surface에 묶는 composite regression을 추가했다.
- 이번 라운드 검증:
  - `pnpm --filter @squadrail/server exec vitest run src/__tests__/merge-pr-bridge.test.ts src/__tests__/operating-alerts.test.ts src/__tests__/operating-alerts-service.test.ts src/__tests__/costs.test.ts src/__tests__/issue-change-surface.test.ts`
  - `pnpm --filter @squadrail/server typecheck`
  - `pnpm --filter @squadrail/server build`
  - `pnpm --filter @squadrail/server test:coverage -- --reporter=default`
  - 최신 server coverage: statements/lines `40.93%`, branches `64.49%`, functions `65.47%`
  - 최신 server tests: `98 files / 659 tests` 통과
  - immediate next는 `route-level operator integration story + remaining global coverage uplift`이다.

## 2026-03-13 support service coverage uplift 업데이트

- `13-H support service coverage uplift batch 1`: **진행 중**
  - `activity-log.ts` direct test를 추가해 sanitize + live event publish 경로를 직접 고정했다.
  - `live-events.ts` direct test를 추가해 company subscription / sink fan-out / sink failure warning 경로를 직접 고정했다.
  - `costs.test.ts`에 unbounded forecast 케이스를 추가했다.
- 이번 라운드 검증:
  - `pnpm --filter @squadrail/server typecheck`
  - `pnpm --filter @squadrail/server exec vitest run src/__tests__/activity-log.test.ts src/__tests__/live-events.test.ts src/__tests__/costs.test.ts`
  - `pnpm --filter @squadrail/server test:coverage -- --reporter=default`
  - 최신 server coverage: statements/lines `39.53%`, branches `65.19%`, functions `64.10%`
  - 최신 server tests: `97 files / 651 tests` 통과
  - immediate next는 `PR bridge / merge recovery / workflow template integration scenario 강화`다.

## 2026-03-13 heartbeat / issue-retrieval / knowledge coverage+decomposition 3차 업데이트

- `13-G runtime coverage/decomposition batch 3`: **진행 중**
  - `heartbeat.ts`에서 deferred wake promotion helper를 추출하고 `cancelIssueScope` direct service test를 추가했다.
  - `issue-retrieval.ts`에서 completion persistence apply helper를 추출해 brief link -> debug patch -> activity/live-event 순서를 direct test로 고정했다.
  - `knowledge.ts` `replaceDocumentChunks` populated path와 retrieval cache insert path service test를 추가했다.
- 이번 라운드 검증:
  - `pnpm -r typecheck`
  - `pnpm --filter @squadrail/server exec vitest run src/__tests__/heartbeat-wakeup.test.ts src/__tests__/heartbeat-service-flow.test.ts src/__tests__/heartbeat-dispatch-watchdog.test.ts src/__tests__/issue-retrieval-finalization.test.ts src/__tests__/knowledge-service-builders.test.ts src/__tests__/knowledge-service-cache.test.ts src/__tests__/knowledge-service-operations.test.ts`
  - `pnpm --filter @squadrail/server build`
  - `pnpm --filter @squadrail/server test:coverage -- --reporter=default`
  - 최신 server coverage: statements/lines `39.38%`, branches `65.11%`, functions `63.69%`
  - 최신 server tests: `95 files / 647 tests` 통과
  - immediate next는 `PR bridge / merge recovery / workflow template integration scenario + global coverage uplift`이다.

## 2026-03-13 heartbeat / issue-retrieval / knowledge coverage+decomposition 2차 업데이트

- `13-F runtime coverage/decomposition batch 2`: **진행 중**
  - `heartbeat.ts`에서 outcome/cancel persistence helper를 추출해 execute/cancel lifecycle 중복을 줄였다.
  - `issue-retrieval.ts`에서 completion persistence/live-event plan seam을 추출해 finalization tail을 더 압축했다.
  - `knowledge.ts`에서 chunk insert/link builder seam을 추출하고 `replaceDocumentChunks` no-op service test를 추가했다.
- 이번 라운드 검증:
  - `pnpm --filter @squadrail/server typecheck`
  - `pnpm --filter @squadrail/server exec vitest run src/__tests__/heartbeat-dispatch-watchdog.test.ts src/__tests__/heartbeat-priority.test.ts src/__tests__/heartbeat-service-flow.test.ts src/__tests__/issue-retrieval-finalization.test.ts src/__tests__/knowledge-service-builders.test.ts src/__tests__/knowledge-service-operations.test.ts`
  - `pnpm --filter @squadrail/server build`
  - `pnpm --filter @squadrail/server test:coverage -- --reporter=default`
  - 최신 server coverage: statements/lines `38.74%`, branches `65.07%`, functions `62.69%`
  - 최신 server tests: `95 files / 642 tests` 통과
  - immediate next는 그대로 `heartbeat / issue-retrieval / knowledge` coverage + decomposition이며, 다음 slice는 execute/cancel/promoted wake service path와 retrieval persistence ordering, knowledge populated replace/cache inspection 보강이다.

## 2026-03-13 heartbeat / issue-retrieval / knowledge coverage+decomposition 업데이트

- `13-E runtime coverage/decomposition batch 1`: **진행 중**
  - `heartbeat.ts`에서 dispatch preemption context/detail builder seam을 추출하고 runtime state service test를 추가했다.
  - `issue-retrieval.ts`에서 finalization graph/exact-path metric builder seam을 추출하고 direct test를 추가했다.
  - `knowledge.ts`에서 project revision / document deprecation builder seam을 추출하고 `createDocument`, `touchProjectKnowledgeRevision` service test를 추가했다.
- 이번 라운드 검증:
  - `pnpm --filter @squadrail/server typecheck`
  - `pnpm --filter @squadrail/server exec vitest run src/__tests__/heartbeat-priority.test.ts src/__tests__/heartbeat-service-flow.test.ts src/__tests__/issue-retrieval-finalization.test.ts src/__tests__/knowledge-service-builders.test.ts src/__tests__/knowledge-service-operations.test.ts`
  - `pnpm --filter @squadrail/server build`
  - `pnpm --filter @squadrail/server test:coverage -- --reporter=default`
  - 최신 server coverage: statements/lines `38.49%`, branches `65.14%`, functions `62.42%`
  - 최신 server tests: `95 files / 637 tests` 통과
  - immediate next는 그대로 `heartbeat / issue-retrieval / knowledge` coverage + decomposition이며, 그 다음은 `PR bridge / merge recovery / workflow template` 통합 시나리오 강화다.

## 2026-03-13 workflow/recovery/custom-role hardening 업데이트

- `13-D workflow/recovery/custom-role hardening`: **완료**
  - `workflow-templates.ts`, `revert-assist.ts`, `role-packs.ts` direct service test를 추가해 template clone/update/delete, revert recovery action, custom role identity/metadata normalization을 직접 고정했다.
  - `issue-retrieval.ts`에서 recipient brief quality 계산을 exported helper로 분리하고 direct test를 추가했다.
  - `role-packs.ts`는 custom role identity/metadata builder seam을 추출해 slug/status drift를 줄였다.
- 이번 라운드 검증:
  - `pnpm --filter @squadrail/server typecheck`
  - `pnpm --filter @squadrail/server build`
  - `pnpm --filter @squadrail/server exec vitest run src/__tests__/role-packs.test.ts src/__tests__/issue-retrieval-finalization.test.ts src/__tests__/workflow-templates.test.ts src/__tests__/revert-assist.test.ts`
  - `pnpm --filter @squadrail/server test`
  - `pnpm --filter @squadrail/server test:coverage -- --reporter=default`
  - 최신 server coverage: statements/lines `38.20%`, branches `65.03%`, functions `62.04%`
  - 최신 server tests: `95 files / 629 tests` 통과
  - 다음 immediate next: `heartbeat / issue-retrieval / knowledge` coverage + decomposition 이후 `PR bridge / merge recovery / workflow template` 통합 시나리오 강화

## 2026-03-13 workflow templates / revert assist / custom role creation 업데이트

- `13-B workflow templates + auto revert assist`: **완료**
  - company-scoped workflow templates를 `setupProgress.metadata.workflowTemplates`에 저장하고 Company Settings에서 편집할 수 있게 올렸다.
  - Protocol Action Console이 company/default template set을 실제로 읽어 payload를 구성하고, protocol activity/change surface에 template trace를 남긴다.
  - Change Review Desk와 merge recovery route에서 `create_revert_followup` / `reopen_with_rollback_context` action을 제공한다.
- `13-C custom role creation`: **완료**
  - Company Settings에서 base role 상속형 custom role pack을 생성하고 곧바로 Role Studio/Simulation으로 연결했다.
  - custom role은 `roleKey=custom`, `scopeId=custom:<slug>` 구조로 저장된다.
- 이번 라운드 검증:
  - `pnpm --filter @squadrail/shared typecheck`
  - `pnpm --filter @squadrail/server typecheck`
  - `pnpm --filter @squadrail/ui typecheck`
  - `pnpm --filter @squadrail/server build`
  - `pnpm --filter @squadrail/ui build`
  - `pnpm --filter @squadrail/server exec vitest run src/__tests__/companies-routes.test.ts src/__tests__/issue-change-surface.test.ts src/__tests__/issues-routes.test.ts src/__tests__/role-packs.test.ts`
  - `pnpm --filter @squadrail/server test`
  - `pnpm --filter @squadrail/server test:coverage -- --reporter=default`
  - 최신 server coverage: statements/lines `38.03%`, branches `64.76%`, functions `61.86%`
  - 최신 server tests: `95 files / 625 tests` 통과
  - 이후 hardening batch에서 direct service test와 decomposition을 추가해 `38.20% / 629 tests`까지 갱신했다.

## 2026-03-13 운영 알림 / goal planning / cost forecast 업데이트

- `11. external operating alerts`: **완료**
  - company-level webhook/slack config를 `setupProgress.metadata`에 저장하고, live event sink에서 runtime failure / review changes / dependency block / ready-to-close / protocol violation을 외부 채널로 fan-out한다.
  - Company Settings에서 alert enable, severity threshold, cooldown, destinations, test alert, recent delivery history를 바로 관리할 수 있다.
- `12. goal progress / sprint / capacity`: **완료**
  - `goals` schema에 `progressPercent`, `targetDate`, `sprintName`, `capacityTargetPoints`, `capacityCommittedPoints`를 추가했다.
  - Goal detail / side properties에서 진행률, 스프린트, 목표일, capacity planning을 직접 편집할 수 있다.
- `13-A cost prediction`: **완료**
  - Costs surface에 month-end projected spend와 budget risk status를 추가했다.
- 이번 라운드 검증:
  - `pnpm --filter @squadrail/shared typecheck`
  - `pnpm --filter @squadrail/server typecheck`
  - `pnpm --filter @squadrail/ui typecheck`
  - `pnpm --filter @squadrail/server exec vitest run src/__tests__/operating-alerts.test.ts src/__tests__/companies-routes.test.ts src/__tests__/goals-routes.test.ts src/__tests__/costs.test.ts`
  - `pnpm --filter @squadrail/server build`
  - `pnpm --filter @squadrail/ui build`
  - `pnpm --filter @squadrail/server test`
  - `pnpm --filter @squadrail/server test:coverage -- --reporter=default`
  - 최신 server coverage: statements/lines `37.34%`, branches `64.67%`, functions `61.46%`
  - 최신 server tests: `93 files / 614 tests` 통과

## 2026-03-12 P2 failure-learning gate integration 업데이트

- `10. execution-failure learning`: **완료**
  - repeated runtime failure signal을 집계하는 `failure-learning` service를 추가했다.
  - `issue-protocol-policy`가 unresolved repeated failure를 읽고 merged/completed close를 실제로 차단한다.
  - Change Review Desk가 `failure learning gate` 패널에서 retryability, failure family, repeated hit count, blocker, suggested action을 함께 보여준다.
  - `issues-routes` 테스트 경계도 새 dependency를 mock해 route-level 회귀가 계속 닫히게 정리했다.
- 이번 라운드 검증:
  - `pnpm --filter @squadrail/shared typecheck`
  - `pnpm --filter @squadrail/ui typecheck`
  - `pnpm --filter @squadrail/server typecheck`
  - `pnpm --filter @squadrail/server build`
  - `pnpm --filter @squadrail/ui build`
  - `pnpm --filter @squadrail/server exec vitest run src/__tests__/issues-routes.test.ts src/__tests__/failure-learning.test.ts src/__tests__/issue-protocol-policy.test.ts src/__tests__/issue-change-surface.test.ts`
  - `pnpm --filter @squadrail/server test:coverage -- --reporter=default`
  - 최신 server coverage: statements/lines `37.28%`, branches `64.81%`, functions `61.34%`

## 2026-03-12 P2 failure-learning 업데이트

- `10. execution-failure learning`: **1차 feed/summary 완료**
  - recovery queue를 `failureFamily / retryability / repeated / occurrenceCount24h / operatorActionLabel`를 가진 failure-learning feed로 확장했다.
  - runtime `dispatch_timeout / process_lost / workspace_required`는 repeated case를 감지해 blind retry보다 operator review를 먼저 유도하도록 score를 올린다.
  - Runs 화면에서 repeated case, operator-required case, next action을 바로 읽을 수 있게 summary card와 grouped recovery card를 보강했다.
- 이번 라운드 검증:
  - `pnpm --filter @squadrail/shared typecheck`
  - `pnpm --filter @squadrail/ui typecheck`
  - `pnpm --filter @squadrail/server typecheck`
  - `pnpm --filter @squadrail/server build`
  - `pnpm --filter @squadrail/ui build`
  - `pnpm --filter @squadrail/server test`
  - `pnpm --filter @squadrail/server test:coverage -- --reporter=default`
  - focused vitest `14 tests` 통과
  - 최신 server coverage: statements/lines `37.07%`, branches `64.68%`, functions `61.21%`

## 2026-03-12 P2 운영 최적화 업데이트

- `7. priority preemption`: **완료**
  - heartbeat queued run selection에 priority-aware dispatch를 추가했다.
  - `critical/high` work가 queued `medium/low`보다 먼저 선점되며, starvation guard와 dispatch trace를 함께 남긴다.
  - review 중 발견한 queue scan cap 문제를 같이 정리해서, 긴 대기열 뒤쪽의 `critical` work도 실제 선점 대상에서 빠지지 않게 했다.
- `8. per-agent performance scorecard`: **완료**
  - dashboard에 agent별 성공률, 평균 run 시간, review/QA bounce, open load, priority preemption 집계를 추가했다.
  - Team 화면에서 operator가 lane health를 즉시 읽을 수 있는 scorecard UI를 붙였다.
- `9. merge conflict assist`: **완료**
  - change surface에 merge preflight warning / external mergeability / gate blocker를 합친 conflict assist를 추가했다.
  - Review Desk에서 conflict signal과 suggested action을 바로 볼 수 있게 올렸다.
- 이번 라운드 검증:
  - `pnpm --filter @squadrail/shared typecheck`
  - `pnpm --filter @squadrail/ui typecheck`
  - `pnpm --filter @squadrail/server typecheck`
  - `pnpm --filter @squadrail/server build`
  - `pnpm --filter @squadrail/server test`
  - `pnpm --filter @squadrail/server test:coverage -- --reporter=default`
  - focused vitest `24 tests` 통과
  - 최신 server coverage: statements/lines `37.11%`, branches `64.64%`, functions `61.25%`

## 2026-03-12 P1 운영 레이어 업데이트

- `4. Team supervision layer`: **완료**
  - company dashboard에 `team-supervision` feed/read model을 추가했다.
  - hidden child issue / internal work item / reviewer watch / lead supervision 신호를 Inbox와 Issue Detail에서 바로 볼 수 있게 올렸다.
  - internal work item 생성과 supervision-aware invalidation/UI까지 연결했다.
- `5. Human -> PM intake productization`: **완료**
  - New Issue Dialog에 `Human intake` 진입 모드를 추가했다.
  - PM 라우팅, reviewer 지정, intake root 생성, intake root -> delivery projection dialog를 제품 메인 흐름으로 연결했다.
  - Issue Detail에서 intake root를 실제 delivery root/child work item으로 투영하는 operator surface를 추가했다.
- `6. issue dependency graph + blocked dispatch enforcement`: **완료**
  - protocol `dependsOn` reference를 issue id / identifier 기준 dependency graph metadata로 정규화했다.
  - dispatch 시 unresolved / open dependency가 남아 있으면 workflow를 `blocked`로 유지하고 wakeup을 차단한다.
  - blocked reason과 dependency snapshot이 protocol metadata / issue workflow surface에 함께 남는다.
- 이번 라운드 검증:
  - `pnpm --filter @squadrail/shared typecheck`
  - `pnpm --filter @squadrail/server typecheck`
  - `pnpm --filter @squadrail/ui typecheck`
  - `pnpm --filter @squadrail/server build`
  - `pnpm --filter @squadrail/ui build`
  - `pnpm --filter @squadrail/server test`
  - `pnpm --filter @squadrail/server test:coverage -- --reporter=default`
  - focused vitest `33 tests` 통과
  - 최신 server coverage: statements/lines `37.27%`, branches `64.55%`, functions `61.17%`

## 2026-03-12 P0 안정화 업데이트

- `1. 통합 경계 안정화`: **P0 1차 완료**
  - protocol -> merge candidate -> review desk -> merged close 경계에 실제 회귀 테스트를 추가했다.
  - `merge-candidate` / `change-surface` / `issue-protocol-policy` / `issue-protocol` 경계가 typed surface와 gate로 묶였다.
  - 다만 이 항목은 성격상 계속되는 품질 트랙이라, product-wide 통합 hardening 전체가 영원히 끝났다는 뜻은 아니다.
- `2. 사람 최종 리뷰 유지 PR bridge`: **완료**
  - GitHub/GitLab remote 판별
  - draft PR/MR 생성 또는 상태 동기화 (`sync_pr_bridge`)
  - PR URL / mergeability / review decision / check status를 change surface와 review desk에 노출
  - auto-merge는 넣지 않았고 human final review는 그대로 유지했다.
- `3. CI status gate`: **완료**
  - synced PR이 존재하는 경우에만 required check / mergeability / requested changes를 gate로 강제한다.
  - `mark_merged`와 `mergeStatus=merged` close 경로가 blocked reason과 함께 차단된다.
  - 로컬/offline merge flow는 깨지지 않게, PR bridge가 없는 경로에는 강제하지 않는다.

## 이전 실행 맥락

- P0 `1, 2, 3`은 이번 라운드에서 닫혔다.
- P1 `4, 5, 6`도 이번 라운드에서 닫혔다.
- P2 `7, 8, 9`도 이번 라운드에서 닫혔다.
- `10. execution-failure learning`도 이번 라운드에서 닫혔다.
- 따라서 다음 순차 작업은 `11. external operating alerts`부터 이어가면 된다.
- 단, `1. 통합 경계 안정화`는 broad quality track이라 후속 기능 작업 때마다 계속 병행된다.

## 현재 기준

- 방향은 `AI software company / autonomous org`로 일관된다.
- 다만 retrieval 최적화 비중이 burn-in보다 앞서기 시작해 우선순위를 재정렬했다.
- `peer engineer` (예: Codex + Claude 공동 구현)는 유효한 후속 기능이지만, 현재 기본 커널에는 포함하지 않는다.
- 현재 제품 기준 기본 실행 모델은 `single engineer per child + reviewer + QA`이며, peer mode는 선택형 고도화로 뒤로 미룬다.

## 현재 우선순위

1. external operating alerts
2. goal progress / sprint / capacity
3. auto revert / custom role / templates / cost prediction

## 중요한 판단

- replay 기능 자체는 이미 성공했다.
- 현재 막는 것은 readiness gate와 historical coverage hygiene다.
- 따라서 다음 구현은 retrieval 미세튜닝이 아니라 replay gate 정상화와 burn-in이다.
- 진짜 제품 검증 대상은 단일 프로젝트 완주만이 아니다.
- 상위 요구 하나가 여러 프로젝트 child work item으로 fan-out되어 병렬 실행되는지까지 확인해야 한다.
- 현재 병렬성 primitive는 "한 issue에 여러 primary engineer"가 아니라 "root coordinating issue + hidden child work items"다.
- 다만 현재 커널은 child work item의 project override가 없어, 진짜 멀티프로젝트 coordinated delivery를 검증하려면 이 지원을 먼저 넣어야 한다.
- 따라서 멀티프로젝트 동시 작업 시나리오는 root issue 아래 project별 child lane으로 검증해야 한다.
- burn-in에서 추가로 확인된 갭은 `projectId=null` coordinating root가 projection 이후 unintended engineer lane으로 drift할 수 있다는 점이다.
- 현재 harness는 projection 직후 root를 archive해서 child fan-out만 검증한다.
- 제품 후속 과제는 dedicated `coordination-only root` 상태를 추가하는 것이다.
- 최신 coordinated burn-in (`CLO-150`)에서는 root archive 이후 실제 child 3개 fan-out이 재확인됐다.
- 구현 child에서 reviewer watch가 조기 개입해 `REASSIGN_TASK`를 발생시키던 문제를 확인했고, `work:implementation` child assignment에는 reviewer watch를 비활성화했다.
- 현재 관측된 진행:
  - root `CLO-150`: `cancelled + hidden`
  - `CLO-151` swiftsight-agent child: `in_progress`
  - `CLO-152` swiftsight-cloud child: `in_progress`
  - child lane별 retrieval/brief/heartbeat dispatch는 독립적으로 발생
- 즉 현 시점 병목은 "fan-out 가능 여부"가 아니라 "child lane completion / timeout / recovery"다.
- 추가 관측:
  - coordinating-root drift는 재현되지 않음
  - 첫 coordinated rerun에서는 hidden child의 lingering active run 때문에 `swiftcl` lane이 `dispatch_timeout`으로 막혔음
  - cleanup 범위를 `tagged root -> internal child family -> active heartbeat runs`로 넓혀 stale hidden child/run 정리 로직을 넣음
  - cleanup 후 rerun `CLO-158`은 `CLO-159`, `CLO-160`, `CLO-161` 세 child lane이 모두 `in_progress`까지 올라감
  - 이후 burn-in wrapper가 `429`로 끊겼는데, 원인은 product protocol이 아니라 harness가 poll마다 `issue/state/messages/briefs/reviewCycles/violations`를 모두 조회한 관측 방식이었음
  - wait loop를 `issue + state + messages`만 poll하고 extended data는 completion 시점에만 읽도록 줄임
  - fresh bucket 재실행 `CLO-162`에서도 root fan-out 후 세 child engineer run이 모두 `running` 상태까지 올라감
  - 따라서 현재 실질 우선순위는 `coordinated burn-in completion 관찰` 다음 `blocked / legacy / protocol-required semantics cleanup`이다
  - 이후 coordinated rerun `CLO-166`에서 `swiftsight-cloud` child는 더 이상 조기 `REASSIGN_TASK`로 되돌아가지 않았다.
  - 새 병목은 `Claude` implementation lane이 clean workspace에서 `SUBMIT_FOR_REVIEW requires diff or commit artifact`에 막히는 것이었고, `clean committed workspace`에도 commit artifact를 자동 첨부하도록 수정했다.
  - PM intake harness에는 두 번째 불필요한 `PATCH /issues/:id`가 있었고 제거했다.
  - lingering coordinated child cleanup은 root family만으로는 부족했다. 실제 잔재 `CLO-144`처럼 `parent만 E2E root`인 child run이 agent를 점유하는 케이스가 있어서, cleanup을 `company issue list + parent chain + active runs` 기준으로 확장했다.
- 최신 coordinated rerun `CLO-179`에서는 root 하나가 다시 child 3개로 fan-out됐고, `CLO-180`(agent), `CLO-181`(cloud), `CLO-182`(swiftcl) 모두 `ACK_ASSIGNMENT -> START_IMPLEMENTATION`까지 확인됐다.
  - `CLO-181` cloud/claude lane은 이번에는 queued나 422 handoff 오류 없이 실제 구현 로그를 쓰기 시작했고, 이후 `SUBMIT_FOR_REVIEW -> START_REVIEW`까지 확인됐다.
  - 즉 `clean committed workspace`의 review handoff bug는 coordinated burn-in 실데이터에서 해소됐다.
  - 후속 관측에서 `CLO-181`은 실제로 `APPROVE_IMPLEMENTATION -> done`까지 닫혔다.
  - `CLO-180`은 QA가 실제로 `REQUEST_CHANGES`를 보낸 뒤 engineer가 재작업하고 다시 `SUBMIT_FOR_REVIEW -> START_REVIEW -> APPROVE_IMPLEMENTATION -> START_REVIEW(qa) -> APPROVE_IMPLEMENTATION(qa) -> CLOSE_TASK`까지 닫혔다. 즉 `review -> QA -> 개발팀 재반환 -> 재검증 -> done` 루프가 실데이터로 검증됐다.
  - `CLO-182`는 reviewer 변경 요청 후 engineer가 재작업을 완료했지만 초기에 `SUBMIT_FOR_REVIEW` helper/API artifact semantics 때문에 `REPORT_PROGRESS`로만 끝난 뒤 stale implementation 상태에 남는 케이스가 드러났다.
  - recovery comment는 이슈에 정상 저장됐지만, plain comment만으로는 execution lock 우회가 되지 않고 `issue_comment_mentioned`가 필요했다.
  - route patch로 assignee/reviewer/qa mention이 현재 protocol state를 읽어 `protocolRecipientRole`과 `protocolWorkflowStateAfter`를 함께 wake context에 싣도록 수정했다. 이걸로 `changes_requested` 상태의 engineer recovery가 다시 implementation lane으로 복귀할 수 있게 만들었다.
  - 이후 protocol helper를 보정해 `submit-for-review`에만 git artifact를 자동 첨부하도록 고쳤고, `CLO-182`는 실제로 `SUBMIT_FOR_REVIEW -> START_REVIEW -> APPROVE_IMPLEMENTATION -> START_REVIEW(qa) -> APPROVE_IMPLEMENTATION(qa) -> CLOSE_TASK`까지 닫혔다.
- 따라서 최신 coordinated burn-in 기준으로 `CLO-180`, `CLO-181`, `CLO-182` 세 child 모두 reviewer/QA/done까지 닫히는 것이 실데이터로 확인됐다. 즉 root 하나에서 fan-out된 multi-project child lane이 review와 QA 반환 루프까지 포함해 완주 가능하다는 것이 검증됐다.
- burn-in이 닫힌 현재 활성 최우선은 `blocked / legacy / protocol semantics cleanup`이다.
- 첫 정리 항목으로 `protocol_required_retry`는 이제 current workflow state가 requirement lane과 일치할 때만 다시 enqueue한다.
- `blocked` 상태는 별도 `blocked_resolution_timeout` 규칙으로 reminder/escalation을 탄다.

## 현재 활성 슬라이스

- `1-A commit-after ingest rollout`: 완료
- `1-B historical backfill reliability`: embedding input sanitize + parse-error retry 1차 완료
- `1-C readiness gate threshold split`: functional readiness / historical hygiene gate 분리 1차 완료
- `2-A cross-project child work item support`: 완료
- `2-B coordinating-root drift containment`: burn-in harness 우회 완료, product kernel 후속 과제로 유지
- `2-B coordinating-root drift containment`: `coordinationOnly` projection flag로 root drift 재현 제거
- `2-C coordinated burn-in completion analysis`: 진행 중
  - 목표: child 3개가 reviewer/QA/close까지 닫히는지 확인
  - 관찰 포인트: `dispatch_timeout`, `process_lost`, `protocol_required`, reviewer/QA 병목, root/child aggregation 누락, `changes_requested -> implementing` recovery
  - 최신 실측 root: `CLO-179`
  - 최신 child lanes:
    - `CLO-180` swiftsight-agent
    - `CLO-181` swiftsight-cloud
    - `CLO-182` swiftcl
  - 최신 상태:
    - `CLO-181`: `done`
    - `CLO-180`: `done` (QA change request loop 포함)
    - `CLO-182`: `done` (reviewer change request recovery + QA gate 포함)

## 관련 문서

- `docs/run-first-burn-in-priority-plan.md`
- `docs/backend-post-phase-plan.md`
- `docs/autonomous-org-full-loop-plan.md`

## 추가 우선순위 보정

- 현재 제품 평가는 `retrieval 미세튜닝`보다 `operator UX + 구조 부채 + release discipline`이 더 직접적인 레벨업 포인트다.
- 검토 결과:
  - merge candidate backend는 이미 있으나, operator action UI는 아직 완성 전이다.
  - change surface는 read-only evidence panel에 가깝고, 실제 review desk로는 부족하다.
  - `issues.ts`와 `issue-retrieval.ts`는 여전히 god-file 리스크가 크다.
  - knowledge setup read model은 프로젝트 수가 늘면 sync 상태 조회가 느려질 가능성이 있다.
  - UI regression은 smoke가 일부 있지만 change/merge/knowledge setup 핵심 표면을 지키는 회귀 테스트는 부족하다.
  - CI/release workflow는 repo 루트 기준 아직 부재다.
- 따라서 `run first` 우선순위 다음 배치는 아래 순서로 본다.
  1. `issues.ts` route split slice 2
  2. `issue-retrieval.ts` refactor
  3. knowledge setup read-model cache/background refresh
  4. PR verify / release workflow 추가

## 최근 진행

- `issues.ts` route split slice 1 완료
  - approvals, intake, protocol read, merge/change-surface, attachments를 `server/src/routes/issues/` 하위 모듈로 분리
  - 메인 `issues.ts`는 create/update/delete/checkout/release, comments, protocol write 등 고변동 write path 중심으로 축소
  - 집중 테스트 + 전체 `typecheck/test/build` 모두 통과
- `issue-retrieval.ts` refactor slice 1 완료
  - graph expansion helper를 `server/src/services/retrieval/graph.ts`로 이동
  - model rerank helper를 `server/src/services/retrieval/model-rerank.ts`로 이동
  - 공통 path/text helper를 `server/src/services/retrieval/shared.ts`로 이동
- `issue-retrieval.ts` refactor slice 2 완료
  - scoring / rationale helper를 `server/src/services/retrieval/scoring.ts`로 이동
  - 메인 retrieval 파일은 temporal context / orchestration / persistence 중심으로 축소
- `rerank provider abstraction` 1차 완료
  - config 해석을 `server/src/services/knowledge-rerank/config.ts`로 분리
  - provider transport를 `server/src/services/knowledge-rerank/providers.ts`로 분리
  - facade `knowledge-reranking.ts`는 기존 인터페이스를 유지
- `knowledge-setup` read model cache 1차 완료
  - setup view는 15초 fresh / 2분 stale 캐시 사용
  - stale 구간에서는 cached view를 반환하고 background refresh 수행
  - knowledge sync / org repair 시 cache invalidate
  - `KnowledgeSetupView.cache`에 `state / refreshInFlight / freshUntil / staleUntil / lastRefresh*` 메타데이터 추가
- 루트 CI/release workflow 추가
  - `.github/workflows/pr-verify.yml`
  - `.github/workflows/release.yml`
- 이번 배치 전체 검증:
  - `pnpm vitest run server/src/__tests__/issue-retrieval.test.ts server/src/__tests__/companies-routes.test.ts server/src/__tests__/knowledge-routes.test.ts`
  - `pnpm -r typecheck`
  - `pnpm test:run`
  - `pnpm build`
- 추가 진행:
  - `issue-retrieval.ts` refactor slice 2 완료
    - scoring / rationale helper를 `server/src/services/retrieval/scoring.ts`로 이동
  - `rerank provider abstraction` 1차 완료
    - provider config / transport를 `server/src/services/knowledge-rerank/` 하위 모듈로 분리
- `execution lane classifier + fast lane optimization + lane-aware multi-hop` 완료
  - `server/src/services/execution-lanes.ts` 추가
  - retrieval은 `fast / normal / deep` lane을 분류해 dense/sparse/rerank/finalK, model candidate count, graph hop depth, brief evidence 개수를 lane-aware하게 조정
  - wake payload / contextSnapshot / taskBrief에도 `executionLane`을 기록
  - retrieval cache identity / stage key에도 lane을 포함
  - replay 실측 기준 `candidateCacheHit`, `finalCacheHit`, `exactPathSatisfied`, `multiHopGraphHitCount=8`까지 확인
- `ranking/cache/trend consolidation` 1차 완료
  - retrieval run cache inspection에 `exact_key / normalized_input / feedback_drift` provenance를 추가
  - candidate/final cache 모두 requested/matched cache key fingerprint를 분리해 recent runs에 노출
  - `/api/knowledge/quality` daily trend에 role/project/sourceType/cache reason/provenance bucket을 추가
  - summary에 `candidateCacheProvenanceCounts`, `finalCacheProvenanceCounts`, `topHitSourceTypeCounts`, `perSourceType`를 추가
  - brief quality에도 candidate/final cache reason/provenance와 `exactPathSatisfied`를 포함해 E2E/inspection 경로를 일치시킴
  - focused retrieval tests + 전체 `typecheck/test/build` 모두 통과
- `cross-issue memory reuse` 완료
  - `server/src/services/retrieval/query.ts`, `server/src/services/retrieval/quality.ts` 추가
  - related issue identifier 추출, prior issue artifact boost, reuse trace surface, reuse quality metric을 retrieval/knowledge 표면에 연결
  - `issue-retrieval`, `shared`, `scoring`, `knowledge`와 focused tests를 함께 갱신
  - 검증:
    - `pnpm vitest run server/src/__tests__/issue-retrieval.test.ts server/src/__tests__/knowledge-quality-trend.test.ts server/src/__tests__/knowledge-routes.test.ts server/src/__tests__/retrieval-cache.test.ts`
    - `pnpm -r typecheck`
    - `pnpm test:run`
    - `pnpm build`
- `18-agent real-org burn-in` 완료
  - `scripts/runtime/squadrail-protocol.mjs`
    - TL title을 가진 agent의 engineer-only command 기본 sender-role 추론 보강
  - `scripts/e2e/cloud-swiftsight-real-org.mjs`
    - `diff || commit` artifact 허용
    - active-run timeout grace 추가
    - base repo snapshot 검증을 HEAD-aware 방식으로 완화
  - 추가 검증:
    - `pnpm vitest run server/src/__tests__/protocol-helper-cli.test.ts`
    - `node --check scripts/e2e/cloud-swiftsight-real-org.mjs`
    - `SQUADRAIL_BASE_URL=http://127.0.0.1:3144 pnpm e2e:cloud-swiftsight-burn-in`
  - 최종 배치 결과:
    - `ok=true`
    - `durationMs=3230399`
    - single-lane `CLO-204`, `CLO-205`, `CLO-206`, `CLO-207` 모두 `done`
    - coordinated root `CLO-208`은 child fan-out 후 의도대로 `cancelled`
    - coordinated child `CLO-209`, `CLO-210`, `CLO-211` 모두 reviewer/QA 포함 `done`

## 현재 남은 우선순위

1. remaining global coverage uplift toward `60%`
2. `issue-protocol.ts / heartbeat.ts / knowledge.ts / issue-retrieval.ts` direct test와 tail branch coverage 확대
3. low-coverage support shell (`access.ts`, `board-claim.ts`, `dashboard.ts`, `companies.ts`, `secrets.ts`) ROI pass

상세 실행 문서:

- `docs/backend-next-priority-detailed-plan.md`
- `docs/issue-board-ux-plan.md`
- `docs/agent-presence-ui-plan.md`

## 다음 세션 핸드오프

- 다음 확인 순서는 `docs/next-session-handoff.md` -> `memory-bank/projects/squadall-run-first/summary.md`다.
- 다음 시작 작업은 `external operating alerts`다.
- 그 다음은 `goal progress / sprint / capacity`, 이후 `auto revert / custom role / templates / cost prediction` 순서다.
- UI 확장 탐색은 `issue board`와 `agent presence`를 별도 UX 라운드로 보고, 현재 초안은 `docs/issue-board-ux-plan.md`, `docs/agent-presence-ui-plan.md`에 있다.
- 기본 검증 순서는 `pnpm -r typecheck` -> `pnpm test:run` -> `pnpm build`다.
- merge/review/protocol 경계를 건드릴 때는 먼저 `pnpm --filter @squadrail/server test`를 기준 검증으로 삼는다.
- 건드리지 말아야 할 경로는 `memory-bank/README.md`와 `memory-bank/projects/squadall-ui-only-followup/`다.
- 제품 방향은 계속 `standardized software delivery org kernel`이며, `peer mode`는 후순위다.
