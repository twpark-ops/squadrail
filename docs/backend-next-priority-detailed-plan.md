# Backend Next Priority Detailed Plan

작성일: 2026-03-12
기준 커밋: `163a444` `feat(retrieval): consolidate cache provenance trends`
작성자: Taewoong Park <park.taewoong@airsmed.com>

> 업데이트 2026-03-13:
> 이 문서는 원래 retrieval follow-up 중심 계획이었지만, 현재 즉시 시작 기준은 아래 상태가 우선이다.
> 완료된 항목:
> - `1. 통합 경계 안정화` P0 1차 완료
> - `2. 사람 최종 리뷰 유지 PR bridge` 완료
> - `3. CI status gate` 완료
> - `4. Team supervision layer` 완료
> - `5. Human -> PM intake productization` 완료
> - `6. issue dependency graph + blocked dispatch enforcement` 완료
> - `7. priority preemption` 완료
> - `8. per-agent performance scorecard` 완료
> - `9. merge conflict assist` 완료
> - `10. execution-failure learning` 완료
> - `11. external operating alerts` 완료
> - `12. goal progress / sprint / capacity` 완료
> - `13-A. cost prediction` 완료
> - `13-B. workflow templates + auto revert assist` 완료
> - `13-C. custom role creation` 완료
> - `13-K. large operator/service direct coverage uplift` 진행 중
> - `13-L. runtime coverage/decomposition batch 5` 진행 중
> - `13-M. runtime/protocol coverage uplift batch 6` 진행 중
> - `13-N. recovery/template/role integrity hardening` 완료
> - `13-O. runtime/protocol coverage uplift batch 7` 완료
> - `13-P. coverage threshold push` 완료
> 현재 다음 순차 작업은 `heartbeat / issue-retrieval / knowledge runtime bottleneck hardening`이다.

## 목적

현재 immediate next backend/product follow-up을 다음 우선순위로 고정하고, 각 항목을 바로 구현 가능한 슬라이스로 풀어 적는다.

현재 제품 방향은 계속 `standardized software delivery org kernel`이다.
즉 지금은 새 protocol/kernel 확장이나 peer mode 실험보다, dispatch 정책 / 운영 scorecard / human-reviewed merge assistance를 제품 수준으로 닫는 것이 우선이다.

## 2026-03-13 coverage threshold push

- `13-P coverage threshold push` 완료
  - `access.ts` helper/onboarding path, `retrieval-personalization.ts` feedback helper, `organizational-memory-ingest.ts` protocol artifact variants를 direct test로 닫았다.
  - `board-claim.ts`, `issue-merge-candidates.ts`, `issue-approvals.ts`, `goals.ts`, `sidebar-badges.ts` direct service test를 추가했다.
  - `issues` 하위 route shell `approvals-routes.ts`, `attachments-routes.ts`, `protocol-read-routes.ts`를 direct route test로 고정했다.
  - `agents-routes.test.ts` fixture contract mismatch를 route validator 기준으로 정리했다.
- 검증:
  - `pnpm --filter @squadrail/server typecheck`
  - `pnpm --filter @squadrail/server build`
  - `pnpm --filter @squadrail/server test:coverage -- --reporter=default`
  - 최신 coverage: statements/lines `60.11%`, branches `61.09%`, functions `80.63%`
  - 최신 server tests: `130 files / 855 tests` 통과

## 상태 업데이트

- `2026-03-12 P1 batch` 완료
  - company-wide `team-supervision` dashboard feed / Inbox / Issue Detail operator surface 추가
  - `Human intake` entry와 intake root -> delivery projection dialog를 제품 메인 UI에 연결
  - protocol `dependsOn` graph metadata 정규화와 blocked dispatch enforcement 추가
  - 검증:
    - `pnpm --filter @squadrail/shared typecheck`
    - `pnpm --filter @squadrail/server typecheck`
    - `pnpm --filter @squadrail/ui typecheck`
    - `pnpm --filter @squadrail/server build`
    - `pnpm --filter @squadrail/ui build`
    - `pnpm --filter @squadrail/server test`
    - `pnpm --filter @squadrail/server test:coverage -- --reporter=default`
  - 최신 coverage: statements/lines `37.27%`, branches `64.55%`, functions `61.17%`
- `2026-03-12 P2 batch` 완료
  - heartbeat dispatch에 priority-aware preemption, starvation guard, audit/event trace를 추가했다.
  - dashboard / Team UI에 per-agent performance scorecard를 추가했다.
  - change surface / Review Desk에 merge conflict assist를 추가했다.
  - review 중 발견한 queued-run scan cap을 제거해서 긴 queue 뒤의 `critical` work도 실제 선점 대상에 포함되게 했다.
  - 검증:
    - `pnpm --filter @squadrail/shared typecheck`
    - `pnpm --filter @squadrail/ui typecheck`
    - `pnpm --filter @squadrail/server typecheck`
    - `pnpm --filter @squadrail/server build`
    - `pnpm --filter @squadrail/server test`
    - `pnpm --filter @squadrail/server test:coverage -- --reporter=default`
  - 최신 coverage: statements/lines `37.11%`, branches `64.64%`, functions `61.25%`
- `2026-03-12 failure-learning batch` 1차 부분 완료
  - recovery queue를 structured failure-learning feed로 확장했다.
  - `failureFamily / retryability / repeated / occurrenceCount24h / operatorActionLabel`를 dashboard contract와 Runs UI로 올렸다.
  - repeated runtime case는 retryability를 operator review 쪽으로 보수화한다.
  - 검증:
    - `pnpm --filter @squadrail/shared typecheck`
    - `pnpm --filter @squadrail/ui typecheck`
    - `pnpm --filter @squadrail/server typecheck`
    - `pnpm --filter @squadrail/server build`
    - `pnpm --filter @squadrail/ui build`
    - `pnpm --filter @squadrail/server test`
    - `pnpm --filter @squadrail/server test:coverage -- --reporter=default`
  - 최신 coverage: statements/lines `37.07%`, branches `64.68%`, functions `61.21%`
- `2026-03-12 failure-learning gate integration` 완료
  - repeated runtime failure signal을 issue close gate가 실제로 읽도록 `failure-learning` service를 추가했다.
  - `issue-protocol-policy`는 unresolved repeated failure가 남아 있으면 merged/completed close를 차단한다.
  - `issue change surface`와 Review Desk에 `failureAssist` panel을 추가해 retryability, failure family, repeated hit count, suggested action을 함께 보여준다.
  - route test 경계도 갱신해서 `issues-routes`가 새 failure-learning dependency를 포함해 정상 동작하도록 맞췄다.
  - 검증:
    - `pnpm --filter @squadrail/shared typecheck`
    - `pnpm --filter @squadrail/ui typecheck`
    - `pnpm --filter @squadrail/server typecheck`
    - `pnpm --filter @squadrail/server build`
    - `pnpm --filter @squadrail/ui build`
    - `pnpm --filter @squadrail/server exec vitest run src/__tests__/issues-routes.test.ts src/__tests__/failure-learning.test.ts src/__tests__/issue-protocol-policy.test.ts src/__tests__/issue-change-surface.test.ts`
    - `pnpm --filter @squadrail/server test:coverage -- --reporter=default`
  - 최신 coverage: statements/lines `37.28%`, branches `64.81%`, functions `61.34%`
- `2026-03-13 external alerts + goal planning + cost forecast` 완료
  - company-level external operating alerts를 `setupProgress.metadata` 기반 config, live-event sink, webhook/slack transport, recent delivery history, test alert로 제품화했다.
  - goal schema에 progress / sprint / target date / capacity points를 추가하고 Goal detail/properties 편집 UI를 연결했다.
  - Costs 화면에 month-end projected spend와 budget risk 상태를 추가했다.
  - 검증:
    - `pnpm --filter @squadrail/shared typecheck`
    - `pnpm --filter @squadrail/server typecheck`
    - `pnpm --filter @squadrail/ui typecheck`
    - `pnpm --filter @squadrail/server build`
    - `pnpm --filter @squadrail/ui build`
    - `pnpm --filter @squadrail/server test`
  - `pnpm --filter @squadrail/server test:coverage -- --reporter=default`
  - 최신 coverage: statements/lines `37.34%`, branches `64.67%`, functions `61.46%`
- `2026-03-13 workflow templates + auto revert assist + custom role creation` 완료
  - workflow templates를 `setupProgress.metadata.workflowTemplates` 기반 company config로 올리고, Protocol Action Console이 실제 company/default template set을 읽게 했다.
  - protocol payload에 board template trace를 넣고 change surface / Review Desk에서 template usage를 읽을 수 있게 했다.
  - merge recovery route에 `create_revert_followup` / `reopen_with_rollback_context` action을 추가했다.
  - Company Settings에서 base role 상속형 custom role pack을 생성하고 곧바로 Role Studio/Simulation으로 이어지게 했다.
  - 검증:
    - `pnpm --filter @squadrail/shared typecheck`
    - `pnpm --filter @squadrail/server typecheck`
    - `pnpm --filter @squadrail/ui typecheck`
    - `pnpm --filter @squadrail/server build`
    - `pnpm --filter @squadrail/ui build`
    - `pnpm --filter @squadrail/server exec vitest run src/__tests__/companies-routes.test.ts src/__tests__/issue-change-surface.test.ts src/__tests__/issues-routes.test.ts src/__tests__/role-packs.test.ts`
    - `pnpm --filter @squadrail/server test`
    - `pnpm --filter @squadrail/server test:coverage -- --reporter=default`
  - 최신 coverage: statements/lines `38.03%`, branches `64.76%`, functions `61.86%`
- `2026-03-13 workflow/recovery/custom-role hardening` 완료
  - `workflow-templates.ts`, `revert-assist.ts`, `role-packs.ts` direct service test를 추가해 template clone/update/delete, revert recovery action, custom role identity/metadata normalization을 직접 고정했다.
  - `issue-retrieval.ts`에서 recipient brief quality 계산을 exported helper로 분리하고 direct test를 추가했다.
  - `role-packs.ts`는 custom role identity/metadata builder seam을 추출해 slug/status drift를 줄였다.
  - 검증:
    - `pnpm --filter @squadrail/server typecheck`
    - `pnpm --filter @squadrail/server build`
    - `pnpm --filter @squadrail/server exec vitest run src/__tests__/role-packs.test.ts src/__tests__/issue-retrieval-finalization.test.ts src/__tests__/workflow-templates.test.ts src/__tests__/revert-assist.test.ts`
    - `pnpm --filter @squadrail/server test`
    - `pnpm --filter @squadrail/server test:coverage -- --reporter=default`
  - 최신 coverage: statements/lines `38.20%`, branches `65.03%`, functions `62.04%`
- `2026-03-13 heartbeat / issue-retrieval / knowledge coverage + decomposition` 1차 진행
  - `heartbeat.ts`에서 dispatch preemption context/detail builder seam을 추출하고 runtime state service test를 추가했다.
  - `issue-retrieval.ts`에서 finalization graph/exact-path metric builder seam을 추출하고 direct test를 추가했다.
  - `knowledge.ts`에서 project revision / document deprecation builder seam을 추출하고 `createDocument`, `touchProjectKnowledgeRevision` service test를 추가했다.
  - 검증:
    - `pnpm --filter @squadrail/server typecheck`
    - `pnpm --filter @squadrail/server exec vitest run src/__tests__/heartbeat-priority.test.ts src/__tests__/heartbeat-service-flow.test.ts src/__tests__/issue-retrieval-finalization.test.ts src/__tests__/knowledge-service-builders.test.ts src/__tests__/knowledge-service-operations.test.ts`
    - `pnpm --filter @squadrail/server build`
    - `pnpm --filter @squadrail/server test:coverage -- --reporter=default`
  - 최신 coverage: statements/lines `38.49%`, branches `65.14%`, functions `62.42%`
- `2026-03-13 heartbeat / issue-retrieval / knowledge coverage + decomposition` 2차 진행
  - `heartbeat.ts`에서 outcome/cancel persistence helper를 추출해 execute/cancel lifecycle 중복을 줄였다.
  - `issue-retrieval.ts`에서 completion persistence/live-event plan seam을 추출해 finalization tail을 더 압축했다.
  - `knowledge.ts`에서 chunk insert/link builder seam을 추출하고 `replaceDocumentChunks` no-op service test를 추가했다.
  - 검증:
    - `pnpm --filter @squadrail/server typecheck`
    - `pnpm --filter @squadrail/server exec vitest run src/__tests__/heartbeat-dispatch-watchdog.test.ts src/__tests__/heartbeat-priority.test.ts src/__tests__/heartbeat-service-flow.test.ts src/__tests__/issue-retrieval-finalization.test.ts src/__tests__/knowledge-service-builders.test.ts src/__tests__/knowledge-service-operations.test.ts`
    - `pnpm --filter @squadrail/server build`
    - `pnpm --filter @squadrail/server test:coverage -- --reporter=default`
  - 최신 coverage: statements/lines `38.74%`, branches `65.07%`, functions `62.69%`
- `2026-03-13 heartbeat / issue-retrieval / knowledge coverage + decomposition` 3차 진행
  - `heartbeat.ts`에서 deferred wake promotion helper를 추출해 promoted wake payload/context 정규화를 pure seam으로 분리했다.
  - `heartbeat-service-flow.test.ts`에 `cancelIssueScope` direct service test를 추가해 queued run cancel -> wakeup cancel -> lease/event -> agent idle 경로를 고정했다.
  - `issue-retrieval.ts`에서 completion persistence apply helper를 추출해 brief link -> debug patch -> activity -> live event -> recipient hint push 순서를 direct test로 고정했다.
  - `knowledge-service-operations.test.ts`에 `replaceDocumentChunks` populated path test를, `knowledge-service-cache.test.ts`에 cache insert path test를 추가했다.
  - 검증:
    - `pnpm -r typecheck`
    - `pnpm --filter @squadrail/server exec vitest run src/__tests__/heartbeat-wakeup.test.ts src/__tests__/heartbeat-service-flow.test.ts src/__tests__/heartbeat-dispatch-watchdog.test.ts src/__tests__/issue-retrieval-finalization.test.ts src/__tests__/knowledge-service-builders.test.ts src/__tests__/knowledge-service-cache.test.ts src/__tests__/knowledge-service-operations.test.ts`
    - `pnpm --filter @squadrail/server build`
    - `pnpm --filter @squadrail/server test:coverage -- --reporter=default`
  - 최신 coverage: statements/lines `39.38%`, branches `65.11%`, functions `63.69%`
- `2026-03-13 support service coverage uplift` 1차 진행
  - `activity-log.ts` direct test를 추가해 sanitize + publish 경로를 직접 고정했다.
  - `live-events.ts` direct test를 추가해 company subscription / sink fan-out / sink failure warning 경로를 직접 고정했다.
  - `costs.test.ts`에 unbounded forecast case를 추가했다.
  - 검증:
    - `pnpm --filter @squadrail/server typecheck`
    - `pnpm --filter @squadrail/server exec vitest run src/__tests__/activity-log.test.ts src/__tests__/live-events.test.ts src/__tests__/costs.test.ts`
    - `pnpm --filter @squadrail/server test:coverage -- --reporter=default`
  - 최신 coverage: statements/lines `39.53%`, branches `65.19%`, functions `64.10%`
- `2026-03-13 operator/support coverage uplift` 2차 진행
  - `merge-pr-bridge.test.ts`를 remote detection만 검증하던 수준에서 실제 GitHub/GitLab sync normalization 경로까지 확장했다.
  - `operating-alerts-service.test.ts`를 추가해 `getView`, `sendTestAlert`, dedupe skip, dependency-blocked live event delivery를 직접 고정했다.
  - `costs.test.ts`에 `costService.summary()` direct service test를 추가해 monthly forecast aggregation을 검증했다.
  - `issue-change-surface.test.ts`에 workflow template trace + PR gate + revert assist + failure assist가 같은 surface에 함께 유지되는 composite regression을 추가했다.
  - 검증:
    - `pnpm --filter @squadrail/server exec vitest run src/__tests__/merge-pr-bridge.test.ts src/__tests__/operating-alerts.test.ts src/__tests__/operating-alerts-service.test.ts src/__tests__/costs.test.ts src/__tests__/issue-change-surface.test.ts`
    - `pnpm --filter @squadrail/server typecheck`
    - `pnpm --filter @squadrail/server build`
    - `pnpm --filter @squadrail/server test:coverage -- --reporter=default`
  - 최신 coverage: statements/lines `40.93%`, branches `64.49%`, functions `65.47%`
- `2026-03-13 route-level operator story + support/runtime uplift` 3차 진행
  - `issues-routes.test.ts` change-surface route가 workflow template trace, PR gate, failure assist, revert assist, retrieval feedback/brief context를 함께 검증하도록 확장됐다.
  - `companies-routes.test.ts`가 workflow template action-type dedupe와 recent operating alert delivery surface를 직접 고정한다.
  - `costs.test.ts`가 `createEvent`, `byAgent`, `byProject` direct service 경로까지 덮고, `operating-alerts.test.ts`, `merge-pr-bridge.test.ts`가 violation / unsupported remote / missing token 분기를 추가로 닫았다.
  - `heartbeat-service-flow.test.ts`, `knowledge-service-cache.test.ts`, `issue-retrieval-finalization.test.ts`에 runtime 4차 focused regression을 추가했다.
  - 검증:
    - `pnpm --filter @squadrail/server exec vitest run src/__tests__/issues-routes.test.ts src/__tests__/companies-routes.test.ts src/__tests__/costs.test.ts src/__tests__/merge-pr-bridge.test.ts src/__tests__/operating-alerts.test.ts src/__tests__/operating-alerts-service.test.ts src/__tests__/heartbeat-service-flow.test.ts src/__tests__/knowledge-service-cache.test.ts src/__tests__/issue-retrieval-finalization.test.ts`
    - `pnpm --filter @squadrail/server typecheck`
    - `pnpm --filter @squadrail/server build`
    - `pnpm --filter @squadrail/server test:coverage -- --reporter=default`
  - 최신 coverage: statements/lines `41.34%`, branches `64.74%`, functions `65.71%`
- `2026-03-13 large operator/service direct coverage uplift` 진행
  - `company-service.test.ts`, `dashboard-service.test.ts`, `issue-protocol-service.test.ts`, `role-pack-service.test.ts`를 추가했다.
  - `companies.ts`, `dashboard.ts`, `issue-protocol.ts`, `role-packs.ts` direct service path를 route bypass 없이 직접 검증한다.
  - 검증:
    - `pnpm --filter @squadrail/server exec vitest run src/__tests__/company-service.test.ts src/__tests__/dashboard-service.test.ts src/__tests__/issue-protocol-service.test.ts src/__tests__/role-pack-service.test.ts`
    - `pnpm --filter @squadrail/server typecheck`
    - `pnpm --filter @squadrail/server build`
    - `pnpm --filter @squadrail/server test:coverage -- --reporter=default`
  - 최신 coverage: statements/lines `45.46%`, branches `63.70%`, functions `68.17%`
- `2026-03-13 runtime coverage/decomposition` 5차 진행
  - `heartbeat-service-flow.test.ts`에 `resetRuntimeSession` global clear, `cancelSupersededIssueFollowups` direct service test를 추가했다.
  - `knowledge-service-operations.test.ts`에 retrieval policy upsert, retrieval run brief link, retrieval debug patch merge service test를 추가했다.
  - `issue-retrieval-finalization.test.ts`에 zero-evidence finalization artifact regression을 추가했다.
  - 검증:
    - `pnpm --filter @squadrail/server exec vitest run src/__tests__/heartbeat-service-flow.test.ts src/__tests__/knowledge-service-operations.test.ts src/__tests__/issue-retrieval-finalization.test.ts`
    - `pnpm --filter @squadrail/server typecheck`
    - `pnpm --filter @squadrail/server build`
    - `pnpm --filter @squadrail/server test:coverage -- --reporter=default`
  - 최신 coverage: statements/lines `45.78%`, branches `63.75%`, functions `68.64%`
- `2026-03-13 runtime/protocol coverage uplift` 6차 진행
  - `projects-routes.test.ts`, `secrets-routes.test.ts`, `access-admin-routes.test.ts`를 추가해 `projects.ts`, `secrets.ts`, `access.ts` route shell의 ROI 높은 표면을 보강했다.
  - `issue-protocol-service.test.ts`에 empty timeline / missing issue violation branch를 추가했다.
  - `heartbeat-service-flow.test.ts`에 `listTaskSessions`, `getActiveRunForAgent` direct service test를 추가했다.
  - `knowledge-service-operations.test.ts`에 `getOverview`, `getGraph`, `listDocumentChunksWithLinks` direct service test를 추가했다.
  - `issue-retrieval-finalization.test.ts`에 zero-evidence hint cap branch를 추가했다.
  - 검증:
    - `pnpm --filter @squadrail/server exec vitest run src/__tests__/projects-routes.test.ts src/__tests__/secrets-routes.test.ts src/__tests__/access-admin-routes.test.ts src/__tests__/issue-protocol-service.test.ts src/__tests__/heartbeat-service-flow.test.ts src/__tests__/knowledge-service-operations.test.ts src/__tests__/issue-retrieval-finalization.test.ts`
    - `pnpm --filter @squadrail/server typecheck`
    - `pnpm --filter @squadrail/server build`
    - `pnpm --filter @squadrail/server test:coverage -- --reporter=default`
  - 최신 coverage: statements/lines `46.75%`, branches `63.56%`, functions `69.56%`
  - 최신 server tests: `105 files / 717 tests` 통과
- `2026-03-13 recovery / workflow / role integrity hardening` 완료
  - `merge-routes.ts` recovery reopen이 `issueProtocolService.reopenForRecovery()`를 통해 terminal protocol state를 `assigned`로 되돌리고, recovery comment 이후 assignee wakeup까지 이어지게 맞췄다.
  - `workflow-template` validator와 `workflow-templates.ts` service 양쪽에 duplicate ID / reserved `default-*` ID invariant를 추가했다.
  - `role-packs.ts createCustomRolePack()`을 transaction으로 감싸 partial `set / revision / files` row를 남기지 않게 했다.
  - `CompanySettings.tsx` custom role success path에 `setupProgress` / `doctor` invalidate를 추가했다.
  - 검증:
    - `pnpm --filter @squadrail/server exec vitest run src/__tests__/issues-routes.test.ts src/__tests__/issue-protocol-service.test.ts src/__tests__/workflow-templates.test.ts src/__tests__/role-pack-service.test.ts src/__tests__/companies-routes.test.ts`
    - `pnpm --filter @squadrail/shared typecheck`
    - `pnpm --filter @squadrail/server typecheck`
    - `pnpm --filter @squadrail/ui typecheck`
    - `pnpm --filter @squadrail/server build`
    - `pnpm --filter @squadrail/ui build`
    - `pnpm --filter @squadrail/server test`
  - 최신 server tests: `105 files / 723 tests` 통과
  - coverage baseline은 직전 측정치 `46.75%`
- `2026-03-13 runtime/protocol coverage uplift` 7차 완료
  - `issue-protocol-state-policy.test.ts`에 `mapProtocolStateToIssueStatus`, `applyProjectedIssueStatus`, `renderMirrorComment`, `resolveExpectedWorkflowStateAfter` coverage를 추가했다.
  - `issue-retrieval.test.ts`에 cached embedding / retrieval hit serialization / cache payload / provenance / revision signature helper coverage를 추가했다.
  - `knowledge-service-operations.test.ts`에 `getDocumentById`, `listDocuments`, `getRetrievalPolicy`, `listRetrievalPolicies`, `getRetrievalRunById` direct read path를 추가했다.
  - `heartbeat-service-flow.test.ts`에 `invoke` wrapper와 `cancelActiveForAgent` direct service branch를 추가했다.
  - 검증:
    - `pnpm --filter @squadrail/server exec vitest run src/__tests__/issue-protocol-state-policy.test.ts src/__tests__/heartbeat-service-flow.test.ts src/__tests__/knowledge-service-operations.test.ts src/__tests__/issue-retrieval.test.ts`
    - `pnpm --filter @squadrail/server typecheck`
    - `pnpm --filter @squadrail/server build`
    - `pnpm --filter @squadrail/server test:coverage -- --reporter=default`
  - 최신 coverage: statements/lines `47.70%`, branches `62.88%`, functions `71.31%`
  - 최신 server tests: `105 files / 736 tests` 통과
- `cross-issue memory reuse`는 2026-03-12 세션에서 완료됐다.
  - related issue identifier 추출, prior issue artifact boost, reuse trace surface, reuse quality metric을 retrieval/knowledge 표면에 연결했다.
  - `server/src/services/retrieval/query.ts`, `server/src/services/retrieval/quality.ts`를 추가했고 `issue-retrieval`, `shared`, `scoring`, `knowledge`를 같이 갱신했다.
  - focused tests + `pnpm -r typecheck` + `pnpm test:run` + `pnpm build`를 모두 통과했다.
- 같은 세션에서 `18-agent real-org burn-in`도 재실행 후 `ok=true`로 닫혔다.
  - `scripts/runtime/squadrail-protocol.mjs` sender-role 추론 보강
  - `scripts/e2e/cloud-swiftsight-real-org.mjs`의 `diff || commit` artifact 허용, active-run timeout grace, HEAD-aware base repo snapshot check 보강
  - single-lane `CLO-204`~`CLO-207` done, coordinated root `CLO-208` cancelled(child fan-out archive), child `CLO-209`~`CLO-211` done

## 현재 남은 우선순위

1. remaining global coverage uplift toward `60%` across large runtime/operator services
2. `issue-protocol.ts / heartbeat.ts / knowledge.ts / issue-retrieval.ts` direct test와 tail branch coverage 확대
3. immediate next는 `issue-protocol appendMessage`, `heartbeat reap/watchdog`, `knowledge listRecentRetrievalRuns`, `issue-retrieval service-body cache/revision path`다
4. low-coverage support shell (`access.ts`, `board-claim.ts`, `dashboard.ts`, `companies.ts`, `secrets.ts` service/route surface) 중 ROI 높은 표면만 선택 보강

한 줄 요약:

- 다음 구현은 `issue-protocol / heartbeat / knowledge / issue-retrieval` bottleneck coverage를 더 올리고, shell 쪽은 `board-claim / dashboard / companies / secrets` ROI 순으로 좁혀서 고르는 것이다.

## Immediate Next: Runtime/Protocol Coverage Uplift

### 목표

- `issue-protocol.ts`, `heartbeat.ts`, `knowledge.ts`, `issue-retrieval.ts` 같은 runtime/protocol bottleneck 표면의 direct test를 늘려 전역 coverage를 계속 끌어올린다.
- route/service shell은 ROI가 높은 항목만 선택적으로 보강한다.
- heavy orchestration path는 가능한 한 service helper / tail branch / direct mutation 경계로 잘게 나눠서 덮는다.

### 구현 슬라이스

#### Slice F1. Runtime / Protocol Bottleneck Coverage

1. `issue-protocol.ts`는 `appendMessage`의 validation / evidence gate / review-cycle branch를 direct service 단위로 더 메운다
2. `heartbeat.ts`는 `reapOrphanedRuns`, watchdog tail, cancel lifecycle service path를 더 직접 고정한다
3. `knowledge.ts`는 `listRecentRetrievalRuns`, retrieval feedback aggregation, task brief read path를 더 늘린다
4. `issue-retrieval.ts`는 service-body cache/revision/provenance path를 helper보다 한 단계 안쪽까지 끌어올린다

#### Slice F2. Low-Coverage Shell ROI Pass

1. `access.ts`, `projects.ts`, `secrets.ts` route shell 1차는 완료했다
2. 다음은 `board-claim.ts`, `dashboard.ts`, `companies.ts`, `secrets.ts` service/route surface 중 ROI 높은 표면만 추가한다
3. 전역 coverage를 `47%+`에서 더 끌어올리는 데 가장 효율적인 표면만 고른다

우선 테스트 파일:

- `server/src/__tests__/dashboard.test.ts`
- `server/src/__tests__/dashboard-service.test.ts`
- `server/src/__tests__/company-service.test.ts`
- `server/src/__tests__/issue-protocol-policy.test.ts`
- `server/src/__tests__/issue-protocol-execution.test.ts`
- `server/src/__tests__/issue-protocol-service.test.ts`
- `server/src/__tests__/role-packs.test.ts`
- `server/src/__tests__/role-pack-service.test.ts`
- `server/src/__tests__/issues-routes.test.ts`
- `server/src/__tests__/issue-change-surface.test.ts`
- `server/src/__tests__/companies-routes.test.ts`
- `server/src/__tests__/projects-routes.test.ts`
- `server/src/__tests__/secrets-routes.test.ts`
- `server/src/__tests__/access-admin-routes.test.ts`
- `server/src/__tests__/merge-pr-bridge.test.ts`
- `server/src/__tests__/operating-alerts.test.ts`
- `server/src/__tests__/operating-alerts-service.test.ts`
- `server/src/__tests__/costs.test.ts`
- `server/src/__tests__/activity-log.test.ts`
- `server/src/__tests__/live-events.test.ts`
- `server/src/__tests__/heartbeat-service-flow.test.ts`
- `server/src/__tests__/issue-retrieval-finalization.test.ts`
- `server/src/__tests__/knowledge-service-operations.test.ts`

### 우선 구현 파일

- `server/src/services/heartbeat.ts`
- `server/src/services/issue-retrieval.ts`
- `server/src/services/knowledge.ts`
- `server/src/routes/issues.ts`
- `server/src/services/issue-change-surface.ts`
- `ui/src/components/ProtocolActionConsole.tsx`
- `ui/src/components/ChangeReviewDesk.tsx`

### 완료 기준

1. large operator/service direct test가 추가돼 global coverage가 `46%+`를 유지하면서 추가 상승한다.
2. 필요한 경우 runtime service optional batch가 이어지더라도 변경 범위는 focused하게 유지된다.
3. `pnpm -r typecheck`, `pnpm --filter @squadrail/server build`, `pnpm --filter @squadrail/server test:coverage -- --reporter=default`가 통과한다.

## Archive Note

- 아래 본문은 이전 retrieval/rerank follow-up 계획을 보존한 archive다.
- historical context는 유지하되, immediate next-start 기준은 위 `Immediate Next` 섹션을 따른다.

## Completed: Cross-Issue Memory Reuse

### 완료 메모

- reusable prior issue artifact taxonomy를 `decision / fix / review / close` 계열로 retrieval scoring에 연결했다.
- follow-up/related issue identifier 추출과 `knowledge_chunk_links` backlink를 합성해 reuse seed를 주입했다.
- brief quality / knowledge quality summary에 `reuseRunCount`, `reuseHitRate`, `reuseIssueCount`, `reuseDecisionHitCount`, `reuseCloseHitCount` 등 trace를 추가했다.
- 이 항목은 현재 완료된 archival worklog로 유지한다. immediate next-start 기준은 위 `Immediate Next` 섹션을 따른다.

### 목표

- 과거 issue / protocol / review / close artifact가 follow-up issue의 retrieval과 planning에 직접 재사용되게 만든다.
- 단순히 knowledge에 적재돼 있는 수준이 아니라, 이번 issue가 어떤 과거 issue 근거를 재사용했는지 trace 가능하게 만든다.

### 왜 지금 하는가

- issue / protocol / review artifact ingest는 이미 완료됐다.
- graph seed와 cache provenance도 이미 제품 surface에 올라왔다.
- 따라서 다음 병목은 `더 많이 적재하는 것`이 아니라 `이미 적재된 조직 기억을 실제로 다시 쓰는 것`이다.

### 이미 있는 기반

- `issue_snapshot` 문서 적재:
  - `server/src/services/organizational-memory-ingest.ts`
- `protocol_event` / `review_event` 문서 적재:
  - `server/src/services/organizational-memory-ingest.ts`
- related issue linkage:
  - payload에서 `linkedIssueIds` 추출
  - link reason `protocol_related_issue`
- retrieval graph seed:
  - `top_hit_issue_context`
  - `linked_issue_context`
  - `top_hit_changed_path`

즉 완전히 새 시스템을 만드는 것이 아니라, 이미 있는 organizational memory linkage를 retrieval 재사용으로 끝까지 연결하는 작업이다.

### 설계 원칙

1. 첫 슬라이스에서는 새 테이블 없이 시작한다.
2. reuse trace는 `retrievalRun.queryDebug`와 brief quality에서 먼저 노출한다.
3. lane-aware retrieval cost를 깨면 안 된다.
4. organizational memory가 code/test evidence를 다시 압도하게 만들면 안 된다.
5. **PEER MODE나 새 protocol state 확장으로 새지 않는다.**

### 구현 슬라이스

#### Slice 1-A. Reuse Taxonomy Audit

목표:

- 재사용 가능한 과거 artifact를 `decision`, `fix`, `review`, `close` 계열로 정리한다.

작업:

1. 기존 metadata 필드를 정리한다.
2. `issue_snapshot`, `protocol_event`, `review_event` 중 무엇을 어떤 목적에 재사용할지 분류한다.
3. close 관련 payload에서 `closureSummary`, `verificationSummary`, `rollbackPlan`, `remainingRisks`, `followUpIssueIds`를 우선 재사용 대상으로 본다.
4. review 관련 payload에서는 `REQUEST_CHANGES`, `APPROVE_IMPLEMENTATION`, `reviewChecklist`, `implementationSummary`를 우선 대상으로 본다.

산출물:

- artifact kind -> reuse intent 매핑 표
- retrieval scoring에서 읽을 최소 metadata 목록

#### Slice 1-B. Reuse Signal Injection

목표:

- 현재 issue가 follow-up/related issue일 때 과거 issue artifact가 retrieval 후보와 seed로 실제 반영되게 만든다.

작업:

1. issue text, labels, linked issue chain, close follow-up chain에서 prior issue hint를 추출한다.
2. graph expansion seed에 reusable prior issue context를 명시적으로 추가한다.
3. candidate shaping에서 prior issue artifact를 narrow boost로 반영한다.
4. `decision/fix/review/close`별로 과도하지 않은 boost를 준다.

가드레일:

- code/test exact path가 있는 경우 prior issue artifact는 보조 증거로만 남긴다.
- cross-issue reuse 때문에 source diversity가 줄면 안 된다.

#### Slice 1-C. Reuse Trace Surface

목표:

- retrieval run과 brief에서 “무엇을 재사용했는지” 설명 가능하게 만든다.

추가 필드 예시:

- `reuseHitCount`
- `reusedIssueIds`
- `reusedIssueIdentifiers`
- `reuseArtifactKinds`
- `reuseDecisionHitCount`
- `reuseFixHitCount`
- `reuseReviewHitCount`
- `reuseCloseHitCount`

노출 위치:

1. `retrievalRun.queryDebug`
2. brief `quality`
3. `/api/knowledge/quality`
4. recent retrieval runs read model

#### Slice 1-D. Reuse Metric

목표:

- reuse가 실제로 발생하는지 project / role / sourceType 기준으로 읽게 만든다.

추가 지표 예시:

- `reuseRunCount`
- `reuseHitRate`
- `averageReuseHitCount`
- `reuseArtifactKindCounts`
- `reuseIssueCount`
- `dailyTrend.reuseRuns`

#### Slice 1-E. Tests

필수 테스트:

1. follow-up issue가 prior close/review artifact를 retrieval 후보로 재사용하는지
2. exact path/code evidence가 있을 때 organizational memory가 top evidence를 독점하지 않는지
3. reuse trace가 brief quality와 recent runs/quality summary에 같이 보이는지
4. cache/lane 키가 reuse metadata 추가로 불안정해지지 않는지

우선 테스트 파일:

- `server/src/__tests__/issue-retrieval.test.ts`
- `server/src/__tests__/knowledge-routes.test.ts`
- 필요 시 `server/src/__tests__/knowledge-quality-trend.test.ts`

### 우선 구현 파일

- `server/src/services/issue-retrieval.ts`
- `server/src/services/retrieval/graph.ts`
- `server/src/services/retrieval/scoring.ts`
- `server/src/services/organizational-memory-ingest.ts`
- `server/src/services/knowledge.ts`

### 완료 기준

1. follow-up issue 하나 이상에서 과거 issue/review/close artifact가 final evidence에 실제 포함된다.
2. retrieval debug에서 `어떤 issue를 왜 재사용했는지`가 보인다.
3. quality summary에서 reuse 지표를 읽을 수 있다.
4. `pnpm -r typecheck`, `pnpm test:run`, `pnpm build`가 모두 통과한다.

## 1. Rerank Provider Abstraction 2차

### 목표

- 단일 active provider 선택을 넘어, 복수 provider 전략과 graceful fallback 정책을 실제 운영 설정으로 연다.

### 왜 다음 순서인가

- 1차에서는 `openai | generic_http | null` capability와 unavailable reason만 정리했다.
- 아직 provider chain, fallback semantics, per-provider failure accounting은 없다.
- cross-issue reuse 이후 retrieval candidate quality가 늘어나면 rerank fallback의 안정성이 더 중요해진다.

### 현재 상태

- provider resolution:
  - `server/src/services/knowledge-rerank/config.ts`
- transport:
  - `server/src/services/knowledge-rerank/providers.ts`
- facade:
  - `server/src/services/knowledge-reranking.ts`

### 구현 슬라이스

#### Slice 2-A. Provider Chain Config

작업:

1. 단일 provider가 아니라 ordered provider list를 해석한다.
2. 각 provider별 `timeout`, `maxCandidates`, `auth`, `model`을 설정 단위로 분리한다.
3. 기본 fallback 순서를 정의한다.

예시:

1. `openai`
2. `generic_http`
3. heuristic/no-model fallback

#### Slice 2-B. Failure Taxonomy

작업:

1. timeout
2. 429/rate limit
3. 5xx/provider unavailable
4. invalid response shape
5. unsupported capability

이유:

- 현재는 단순 throw 위주라 운영자가 fallback 이유를 읽기 어렵다.

#### Slice 2-C. Run Debug / Surface

작업:

1. retrieval run debug에 `rerankProviderAttempted`, `rerankProviderUsed`, `rerankFallbackReason`, `rerankAttemptCount`를 기록한다.
2. quality summary나 recent runs에서 fallback 분포를 읽게 만든다.

#### Slice 2-D. Tests

필수 테스트:

1. primary provider timeout 시 secondary provider fallback
2. malformed response 시 fallback
3. provider chain 전부 실패 시 heuristic order 유지
4. fallback reason이 debug/surface에 남는지

### 우선 구현 파일

- `server/src/services/knowledge-rerank/config.ts`
- `server/src/services/knowledge-rerank/providers.ts`
- `server/src/services/knowledge-reranking.ts`
- `server/src/services/issue-retrieval.ts`
- `server/src/__tests__/knowledge-reranking.test.ts`

### 완료 기준

1. primary provider failure가 retrieval 전체 실패로 바로 이어지지 않는다.
2. fallback reason이 recent run/debug에서 설명 가능하다.
3. 동일 query에 대해 provider별 behavior 차이를 운영자가 볼 수 있다.

## 2. Execution Lane / Fast Lane 실운영 계측

### 목표

- `fast / normal / deep` 분류가 실제로 latency와 운영 품질에 이득을 주는지 측정한다.

### 왜 마지막인가

- lane 분류와 lane-aware retrieval policy 자체는 이미 들어갔다.
- 지금 부족한 것은 “fast lane이 실제로 빠르고 덜 흔들리는가”를 증명하는 계측이다.
- 이 단계는 재사용성과 rerank 안정화가 어느 정도 들어간 뒤 보는 편이 지표 해석이 쉽다.

### 현재 상태

- lane classification:
  - `server/src/services/execution-lanes.ts`
- lane-aware retrieval/caching:
  - `server/src/services/issue-retrieval.ts`
- quality summary:
  - `server/src/services/knowledge.ts`

### 구현 슬라이스

#### Slice 3-A. Retrieval Timing

작업:

1. retrieval run에 end-to-end duration을 기록한다.
2. 가능하면 stage duration도 분리한다.

예시:

- embedding duration
- candidate query duration
- graph expansion duration
- model rerank duration
- finalization duration

#### Slice 3-B. Lane Outcome Metrics

작업:

1. lane별 cache hit rate
2. lane별 low-confidence rate
3. lane별 multi-hop hit rate
4. lane별 reuse hit rate

#### Slice 3-C. Workflow Quality Metrics

작업:

1. lane별 review reopen count
2. lane별 QA bounce count
3. lane별 done까지 걸린 시간
4. lane별 `changes_requested -> rework -> close` 루프 발생률

#### Slice 3-D. Surface

노출 위치:

1. `/api/knowledge/quality`
2. 필요 시 dashboard/support surface

추가 필드 예시:

- `perLane`
- `dailyTrend.laneCounts`
- `dailyTrend.laneLatency`
- `dailyTrend.laneReopenCount`
- `dailyTrend.laneQaBounceCount`

#### Slice 3-E. Validation

필수 검증:

1. fast lane 평균 retrieval duration이 normal/deep보다 낮은지
2. fast lane에서 review reopen/QA bounce가 과도하게 높지 않은지
3. deep lane이 cross-project/decision-heavy 상황에서 더 높은 evidence quality를 주는지

### 우선 구현 파일

- `server/src/services/issue-retrieval.ts`
- `server/src/services/knowledge.ts`
- `server/src/services/execution-lanes.ts`
- `server/src/services/issue-change-surface.ts`
- 관련 dashboard/knowledge route surface

### 완료 기준

1. lane별 latency/quality 차이를 숫자로 설명할 수 있다.
2. fast lane이 실제 이득을 주는지 판단할 수 있다.
3. 잘못 분류된 lane 사례를 운영자가 다시 찾을 수 있다.

## 이번 배치 권장 순서

### Batch A

1. `rerank provider abstraction` Slice 2-A
2. `rerank provider abstraction` Slice 2-B
3. `rerank provider abstraction` Slice 2-C

### Batch B

1. `rerank provider abstraction` Slice 2-D
2. `execution lane` Slice 3-A
3. `execution lane` Slice 3-B

### Batch C

1. `execution lane` Slice 3-C
2. `execution lane` Slice 3-D
3. `execution lane` Slice 3-E

## 당장 하지 않을 것

1. peer mode
2. arbitrary workflow builder 방향
3. 새로운 protocol/kernel 대확장
4. UI-only follow-up 로컬 변경 개입
5. `memory-bank/README.md` 수정

## 검증 순서

기본:

```bash
pnpm -r typecheck
pnpm test:run
pnpm build
```

retrieval 쪽만 수정할 때:

```bash
pnpm vitest run server/src/__tests__/issue-retrieval.test.ts
pnpm vitest run server/src/__tests__/knowledge-reranking.test.ts
```

## 다음 시작점

다음 구현 시작점은 `rerank provider abstraction`의 `Slice 2-A ~ 2-C`다.

가장 먼저 할 질문은 이것이다.

`primary rerank provider가 실패했을 때, 어떤 provider chain과 fallback reason을 debug surface에 남겨야 운영자가 바로 설명할 수 있는가?`

이 질문을 run debug와 quality surface에 trace로 남기는 것이 다음 단계의 핵심이다.
