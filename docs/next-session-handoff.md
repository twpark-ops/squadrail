# Next Session Handoff

## Start Here

Open this file first, then read:

1. [next-session-handoff.md](/home/taewoong/company-project/squadall/docs/next-session-handoff.md)
2. [summary.md](/home/taewoong/company-project/squadall/memory-bank/projects/squadall-run-first/summary.md)
3. [backend-next-priority-detailed-plan.md](/home/taewoong/company-project/squadall/docs/backend-next-priority-detailed-plan.md)

One-line startup rule:

- open this handoff first, then continue immediately with `Phase 6 onboarding / Company Settings reframe + swiftsight canonical absorption follow-through`
  - Phase 5 `apply contract -> confirmation gate -> semantics test -> Company Settings apply flow`는 이미 닫혔다.
  - coverage threshold work is done; backend coverage hardening remains a maintenance track.
  - the immediate product track is now `quick request -> clarification -> blueprint -> bulk provisioning`.

## Current Status

- `P0 productization pivot`: Phase 1/2/3 shipped, Phase 4 preview/diff shipped
  - lower delivery kernel은 이미 제품 수준으로 닫혔다.
  - 다음 북극성은 `사람이 짧게 요청 -> 시스템/PM 구조화 -> 부족한 정보만 질문 -> 사람이 짧게 답변 -> 팀이 실행/리뷰/클로즈 -> 다른 회사에서도 같은 팀 구성을 쉽게 재사용`이다.
  - 새 상세 계획 문서:
    - [`p0-quick-request-clarification-blueprint-plan.md`](/home/taewoong/company-project/squadall/docs/p0-quick-request-clarification-blueprint-plan.md)
    - [`p0-quick-request-clarification-blueprint-plan.puml`](/home/taewoong/company-project/squadall/docs/p0-quick-request-clarification-blueprint-plan.puml)
  - 이번 배치 완료:
    1. `NewIssueDialog` 기본 경로를 quick request로 전환
    2. 기존 상세 작성 경로를 `Advanced issue` secondary path로 정리
    3. `ANSWER_CLARIFICATION` shared/server contract + validator + wake reason 연결
    4. `Inbox` clarification queue read surface와 `IssueDetail` pending clarification view 추가
    5. `ProtocolActionConsole` 공식 clarification answer submit 경로 추가
    6. `ANSWER_CLARIFICATION`가 blocked / awaiting-human 상태를 공식 resume state로 되돌리도록 server-owned workflow transition을 추가
    7. `Inbox`와 `IssueDetail`이 shared pending human clarification contract를 사용하도록 통합
    8. `Inbox` clarification answer CTA/deep-link 추가
    9. `IssueDetail` / `ChangeReviewDesk`에 answered / resumed clarification trace 추가
    10. generic `team blueprint` shared/server contract skeleton과 `GET /api/companies/:companyId/team-blueprints` route 추가
    11. `team blueprint preview/diff` contract와 `POST /api/companies/:companyId/team-blueprints/:blueprintKey/preview` route 추가
    12. `CompanySettings`에 blueprint catalog read + preview diff surface 추가
    13. `previewHash`가 포함된 preview response와 `team blueprint apply` shared/server contract 추가
    14. `POST /api/companies/:companyId/team-blueprints/:blueprintKey/apply` route 추가
    15. apply가 stale preview hash를 거부하도록 confirmation gate 추가
    16. `team-blueprints-apply.test.ts`로 stale reject / first apply create / duplicate retry reject를 고정
    17. blueprint apply를 outer transaction으로 감싸 partial org/team 잔존을 막음
    18. `standard_product_squad`에서 per-project TL slot expansion과 project lead wiring을 실제 apply test로 고정
    19. project create / agent update 중간 실패 시 role-pack seed까지 rollback되는 failure injection test를 추가
  - immediate next:
    1. `OnboardingWizard`를 `회사 생성 -> blueprint 선택 -> workspace 연결 -> 첫 quick request` 기준으로 재편
    2. `CompanySettings`에서 role-pack studio보다 team builder가 먼저 보이는 hierarchy로 재정렬
    3. `swiftsight canonical` absorption prep metadata를 실제 generic blueprint apply/onboarding 흐름과 연결
  - 해석:
    - 지금 우선순위는 UI 미장이 아니라 기본 사용자 플로우 제품화다.
    - `cloud-swiftsight` 전용 canonical은 이후 phase에서 generic team blueprint registry로 일반화해야 한다.

- `13-S. runtime service-body coverage uplift toward 80%`: 완료
  - `access-invites-routes.test.ts`에 pending join request redaction, board reject, invalid claim secret 분기를 추가했다.
  - `agents-routes-read.test.ts`에 config revision redaction, heartbeat run list/cancel/event/log read, company/issue live run route 경로를 추가했다.
  - `heartbeat-service-flow.test.ts`, `issue-protocol-service.test.ts`에 reap/review-cycle rejection tail branch를 추가했다.
  - 새 `issue-retrieval-service-body.test.ts`를 추가해 `handleProtocolMessage()`의 cached-hit path와 cold-miss + embedding/cache persistence path를 dependency-mocked integration test로 직접 태웠다.
  - 검증:
    - `pnpm --filter @squadrail/server exec vitest run src/__tests__/access-invites-routes.test.ts src/__tests__/agents-routes-read.test.ts src/__tests__/heartbeat-service-flow.test.ts src/__tests__/issue-protocol-service.test.ts src/__tests__/issue-retrieval-service-body.test.ts`
    - `pnpm --filter @squadrail/server typecheck`
    - `pnpm --filter @squadrail/server build`
    - `pnpm --filter @squadrail/server test:coverage -- --reporter=default`
  - 최신 server tests: `174 files / 1108 tests` 통과
  - 최신 server coverage: statements/lines `80.38%`, branches `65.01%`, functions `91.29%`
  - 핵심 해석: 전역 `80%`는 넘겼지만 분포는 아직 불균형하다. 현재 병목은 `heartbeat.ts 44.47%`, `knowledge.ts 62.95%`, `routes/issues.ts 66.28%`다.

- `13-Q. runtime bottleneck helper coverage uplift`: 진행 중
  - `heartbeat.ts` internal normalization/session/policy helpers를 exported seam으로 정리하고 helper direct test를 추가했다.
  - `issue-retrieval.ts`의 related issue signal / temporal context / document version lookup helper를 exported seam으로 승격하고 DB mock direct test를 추가했다.
  - `issues.ts` protocol role / mention context / attachment path / memory ingest / label ensure helper를 route 바깥 direct test 가능한 형태로 추출했다.
  - `knowledge-service-operations.test.ts`에 populated `replaceDocumentChunks` code-graph rebuild path와 empty `listRecentRetrievalRuns` read path를 추가했다.
  - 검증:
    - `pnpm --filter @squadrail/server exec vitest run src/__tests__/heartbeat-internal-helpers.test.ts src/__tests__/issues-route-helpers.test.ts src/__tests__/issues-route-internal-ops.test.ts src/__tests__/issue-retrieval-internal-helpers.test.ts src/__tests__/knowledge-service-operations.test.ts`
    - `pnpm --filter @squadrail/server typecheck`
    - `pnpm --filter @squadrail/server build`
    - `pnpm --filter @squadrail/server test:coverage -- --reporter=default`
  - 최신 server tests: `170 files / 1058 tests` 통과
  - 최신 server coverage: statements/lines `77.34%`, branches `63.41%`, functions `91.34%`

- `13-R. runtime bottleneck helper/service-body uplift`: 진행 중
  - `issues.ts` internal work item / PM projection helper를 exported seam으로 분리하고 direct helper regression을 추가했다.
  - `heartbeat-service-flow.test.ts`에 task-key scoped runtime reset과 `tickTimers` overdue agent dispatch path를 추가했다.
  - `heartbeat-internal-helpers.test.ts`, `issue-retrieval-internal-helpers.test.ts`, `knowledge-service-builders.test.ts`를 확장해 heartbeat/retrieval/knowledge helper branch를 더 촘촘히 고정했다.
  - 검증:
    - `pnpm --filter @squadrail/server exec vitest run src/__tests__/heartbeat-internal-helpers.test.ts src/__tests__/heartbeat-service-flow.test.ts src/__tests__/issue-retrieval-internal-helpers.test.ts src/__tests__/knowledge-service-builders.test.ts src/__tests__/issues-route-helpers.test.ts src/__tests__/issues-route-internal-ops.test.ts src/__tests__/issues-route-work-item-helpers.test.ts`
    - `pnpm --filter @squadrail/server typecheck`
    - `pnpm --filter @squadrail/server build`
    - `pnpm --filter @squadrail/server test:coverage -- --reporter=default`
  - 최신 server tests: `171 files / 1073 tests` 통과
  - 최신 server coverage: statements/lines `77.41%`, branches `63.87%`, functions `91.31%`
  - helper seam 확대만으로는 총량이 거의 움직이지 않는 것이 확인됐고, immediate next는 `heartbeat / issue-retrieval / knowledge` service-body 통합 경로를 직접 목업하는 쪽으로 바뀌었다.

- `13-P. coverage threshold push`: 완료
  - server coverage가 `60.11%`까지 올라가서 목표 기준 `60%`를 넘겼다.
  - `access.ts` helper/onboarding path, `retrieval-personalization.ts` feedback helper, `organizational-memory-ingest.ts` protocol artifact variants를 direct test로 닫았다.
  - `board-claim.ts`, `issue-merge-candidates.ts`, `issue-approvals.ts`, `goals.ts`, `sidebar-badges.ts` direct service test를 추가했다.
  - `issues` 하위 route shell `approvals-routes.ts`, `attachments-routes.ts`, `protocol-read-routes.ts`를 direct route test로 고정했다.

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
- `13-O. runtime/protocol coverage uplift batch 7`: 완료
  - `issue-protocol-state-policy.test.ts`에 state projection, mirror comment, review/approval transition helper coverage를 추가했다.
  - `issue-retrieval.test.ts`에 cache serialization/provenance/revision-signature helper coverage를 추가했다.
  - `knowledge-service-operations.test.ts`에 document/policy/retrieval-run read path를 추가했고, `heartbeat-service-flow.test.ts`에 `invoke` / `cancelActiveForAgent` direct service branch를 보강했다.

## Current Product State

- `clarification operator surface polish` 완료
  - `Inbox` clarification card는 issue detail answer flow로 deep-link된다.
  - `IssueDetail`은 latest pending / latest answered clarification과 resumed workflow state를 함께 보여준다.
  - `ChangeReviewDesk`는 clarification trace를 operator surface로 노출한다.
- `generic team blueprint v1 contract skeleton` 완료
  - `packages/shared`에 team blueprint type / validator / constants를 추가했다.
  - `server/src/services/team-blueprints.ts`와 `GET /api/companies/:companyId/team-blueprints` route를 추가했다.
  - `POST /api/companies/:companyId/team-blueprints/:blueprintKey/preview` route와 preview/diff contract를 추가했다.
  - `CompanySettings`가 blueprint catalog와 preview diff를 읽는다.
  - 아직 apply mutation과 onboarding 소비 surface는 남아 있다.
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
  - `pnpm --filter @squadrail/server typecheck`
  - `pnpm --filter @squadrail/server build`
  - `pnpm --filter @squadrail/server test:coverage -- --reporter=default`
  - `174 files / 1108 tests` 통과
  - server coverage `80.38%`
- 현재 다음 순차 작업은 `Company Settings apply flow + swiftsight canonical absorption prep`

## Next Priorities

1. `Quick request 기본화`
2. `Clarification 질문/답변 루프`
3. `Human answer path 정식화`
4. `Generic team blueprint v1`
5. `Bulk provisioning with preview/diff`
6. `Onboarding / Company Settings 재편`
7. backend coverage hardening은 위 product flow가 흔들리지 않게 유지 보수 트랙으로 병행

Interpretation:

- next focus is productizing the primary user flow above the already-completed kernel
- backend runtime hardening is no longer the lead product track

## Recommended First Task Next Session

Start with `Phase 5 Company Settings apply flow`.

Suggested slice:

1. `Company Settings`가 preview 결과 위에서 apply를 호출하게 한다
2. apply 후 setup/doctor/agent/project invalidate와 success trace를 연결한다
3. 마지막에 `swiftsight canonical`과 generic blueprint parameter map 연결 초안을 만든다

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
- [p0-quick-request-clarification-blueprint-plan.md](/home/taewoong/company-project/squadall/docs/p0-quick-request-clarification-blueprint-plan.md)

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
- immediate productization target is `quick request -> clarification -> blueprint -> bulk provisioning`
- `peer mode` is deferred optional feature, not current priority
