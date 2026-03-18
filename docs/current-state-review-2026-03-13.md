# Current State Review (2026-03-13)

작성자: Taewoong Park (park.taewoong@airsmed.com)

## Scope

이 문서는 2026-03-13 기준 워킹트리 변경분을 대상으로 다시 수행한 리뷰 결과를 정리한다.
이번 리뷰는 특히 아래 축에 집중했다.

- Issue / protocol / merge recovery 흐름
- Company Settings의 workflow template / custom role UX
- Shared validator와 UI selector 간 계약 정합성
- 현재 테스트 신뢰도와 잔여 공백

## Validation Run

다음 검증을 실제로 실행했다.

```bash
pnpm --filter @squadrail/server typecheck
pnpm --filter @squadrail/ui typecheck
cd server && pnpm exec vitest run \
  src/__tests__/workflow-templates.test.ts \
  src/__tests__/revert-assist.test.ts \
  src/__tests__/role-packs.test.ts \
  src/__tests__/issue-change-surface.test.ts \
  src/__tests__/issues-routes.test.ts \
  src/__tests__/companies-routes.test.ts
pnpm --filter @squadrail/server build
pnpm --filter @squadrail/ui build
```

결과:

- 서버 typecheck 통과
- UI typecheck 통과
- 대상 서버 테스트 83개 통과
- 서버 build 통과
- UI build 통과

추가 관찰:

- `pnpm --filter @squadrail/ui exec vitest run`은 현재 바로 동작하지 않는다.
- 이유는 UI 패키지에 test script와 `jsdom` 기반 unit harness가 준비되지 않았기 때문이다.

## Executive Summary

현재 상태는 “기능이 많이 붙었고 큰 줄기는 맞지만, 몇 개의 통합 경계가 여전히 불안정한 상태”다.

가장 중요한 이슈는 아래 네 가지다.

1. `reopen_with_rollback_context`가 issue row 상태만 되돌리고 protocol state는 그대로 남길 수 있다.
2. custom role 생성 후 Company Settings의 readiness / doctor 카드가 stale 상태로 남는다.
3. workflow template API가 중복 ID와 default ID 충돌을 막지 않는다.
4. custom role 생성은 트랜잭션 밖에서 이루어져 partial row를 남길 수 있다.

## Detailed Findings

### 1. Revert Assist Reopen Path Can Reopen the Issue Row Without Reopening Protocol State

중요도: **HIGH**

#### What Changed

`POST /issues/:id/merge-candidate/recovery`가 추가되었고, `reopen_with_rollback_context` 액션이 `svc.update(issue.id, { status: "todo" })`로 이슈 상태를 되돌린다.

관련 파일:

- `server/src/routes/issues/merge-routes.ts`
- `server/src/services/issues.ts`
- `server/src/services/heartbeat.ts`
- `ui/src/pages/IssueDetail.tsx`
- `ui/src/components/ProtocolActionConsole.tsx`

#### Why This Is Risky

현재 reopen 경로는 issue row 상태만 바꾸고 protocol state는 직접 만지지 않는다.

- `server/src/routes/issues/merge-routes.ts`
  - recovery reopen이 generic issue update만 호출
- `server/src/services/issues.ts`
  - update는 `issues` 테이블만 갱신
- `ui/src/pages/IssueDetail.tsx`
  - Issue Detail은 `protocolState`를 별도 query로 읽음
- `ui/src/components/ProtocolActionConsole.tsx`
  - 보드 액션 허용 여부를 `protocolState.workflowState` 기준으로 결정
- `server/src/services/heartbeat.ts`
  - session reset / special wake reason 목록에 reopen 전용 이유가 없음

즉 아래 불일치가 발생할 수 있다.

- issue.status = `todo`
- protocolState.workflowState = `done` 또는 `cancelled`

이 경우 사용자는 “이슈는 reopened처럼 보이는데, 실제 프로토콜상으론 계속 닫힌 상태”를 보게 된다.

#### User-Facing Impact

- Change Review Desk에서 `Reopen with rollback context`가 성공으로 보인다.
- 하지만 Issue Detail의 board console은 여전히 terminal state처럼 행동할 수 있다.
- 후속 protocol action이 막히거나, reopened issue가 다시 실제 delivery loop에 진입하지 못할 수 있다.

#### Why Existing Tests Miss It

현재 `issues-routes.test.ts`는 reopen recovery가 `svc.update(..., { status: "todo" })`를 호출하는지만 확인한다.
protocol state reset 또는 후속 wake semantics는 검증하지 않는다.

#### Recommended Fix

둘 중 하나로 명확하게 정리해야 한다.

1. reopen은 protocol-level action으로 승격
   - reopen 전용 protocol transition 추가
   - issue status와 protocol state를 같이 되돌림
2. reopen을 현재 방식으로 유지
   - heartbeat / execution layer에서 `issue_reopened_via_comment` 또는 recovery reopen을 first-class wake reason으로 처리
   - protocol state를 resume 가능한 상태로 명시적으로 재설정

#### Suggested Test Additions

- recovery reopen 후 `GET /issues/:id/protocol/state`가 terminal이 아님을 검증
- recovery reopen 후 board console 허용 action이 `NOTE`만 남지 않음을 검증
- recovery reopen 후 다음 wake가 실제 execution loop로 들어가는 integration test 추가

### 2. Company Settings Does Not Refresh Setup Progress / Doctor After Custom Role Creation

중요도: **MEDIUM**

#### What Changed

Company Settings에 custom role 생성 UI가 추가되었다.

관련 파일:

- `ui/src/pages/CompanySettings.tsx`
- `server/src/routes/companies.ts`
- `server/src/services/role-packs.ts`
- `server/src/services/setup-progress.ts`

#### Why This Is Risky

화면 상단은 아래 query를 별도로 사용한다.

- `setupProgress`
- `doctorReport`

하지만 custom role 생성 성공 시 invalidate 되는 것은 role pack query뿐이다.

결과적으로:

- 첫 published custom role을 생성해도
- 상단 `Setup progress`, `Doctor failures` 카드가 즉시 갱신되지 않을 수 있다.

특히 `setupProgressService`는 published role pack count를 직접 보고 readiness를 계산하므로, 서버 상태는 바뀌었는데 UI 카드만 stale 상태가 된다.

#### User-Facing Impact

- 사용자는 custom role creation이 setup readiness에 반영되지 않았다고 오해할 수 있다.
- 운영자가 “생성은 됐는데 왜 readiness가 그대로지?”라는 혼란을 겪게 된다.

#### Recommended Fix

custom role 생성 성공 시 아래 query도 함께 invalidate 한다.

- `queryKeys.companies.setupProgress(selectedCompanyId)`
- `queryKeys.companies.doctor(selectedCompanyId)`

필요하면 role pack revision query와 함께 `operatingAlerts` 또는 doctor deep report 캐시도 정리한다.

#### Suggested Test Additions

- custom role creation mutation success 이후 readiness metric이 갱신되는 UI test
- 첫 published custom role creation이 `setupProgress.steps.squadReady`에 반영되는 integration test

### 3. Workflow Template IDs Are Not Validated for Uniqueness or Reserved Default Collisions

중요도: **MEDIUM**

#### What Changed

company-scoped workflow templates가 추가되었고, board console에서 template selector를 통해 사용한다.

관련 파일:

- `packages/shared/src/validators/workflow-template.ts`
- `server/src/services/workflow-templates.ts`
- `ui/src/components/ProtocolActionConsole.tsx`
- `ui/src/pages/CompanySettings.tsx`

#### Why This Is Risky

현재 validator는 템플릿 배열의 개별 shape만 검증하고, 아래를 전혀 막지 않는다.

- 같은 `id`를 가진 company template 여러 개
- `default-close-task` 같은 reserved default ID 재사용
- actionType은 다르지만 같은 ID 재사용

서버도 update 시 입력 배열을 그대로 저장하고, UI는 template `id`를 selector value / React key / applied trace 기준으로 사용한다.

결과적으로 중복 ID가 들어오면:

- selector가 엉뚱한 템플릿을 고를 수 있고
- applied trace가 어떤 template를 가리키는지 불명확해지고
- default와 company template 구분이 깨질 수 있다.

#### User-Facing Impact

- Protocol Action Console에서 드롭다운 선택이 의도와 다르게 동작할 수 있다.
- board template trace가 wrong template로 기록될 수 있다.
- Company Settings에서 저장/삭제 대상이 헷갈릴 수 있다.

#### Recommended Fix

`updateWorkflowTemplatesSchema` 또는 service 레벨에서 아래를 강제한다.

- company template `id` uniqueness
- reserved `default-*` ID 금지
- 동일 actionType 안에서 label 또는 id uniqueness 정책 명시

#### Suggested Test Additions

- duplicate template ID 요청이 `400` 또는 `422`로 거절되는 route test
- reserved default ID를 company template로 저장하려 할 때 실패하는 test

### 4. Custom Role Creation Is Not Transactional

중요도: **LOW**

#### What Changed

custom role 생성은 아래 순서로 수행된다.

1. `role_pack_sets` insert
2. `role_pack_revisions` insert
3. `role_pack_files` insert

관련 파일:

- `server/src/services/role-packs.ts`
- `packages/db/src/schema/role_pack_sets.ts`
- `packages/db/src/schema/role_pack_revisions.ts`
- `packages/db/src/schema/role_pack_files.ts`

#### Why This Is Risky

현재 이 경로는 트랜잭션 밖에서 실행된다.

따라서:

- set insert 성공
- revision insert 또는 files insert 실패

상황이 발생하면 partial custom role pack row가 남을 수 있다.

`listRolePacks`는 latest revision이 없는 set도 그대로 view로 만들 수 있기 때문에, 운영자는 반쯤 생성된 custom role을 보게 될 수 있다.

#### User-Facing Impact

- custom role이 목록엔 보이는데 파일이 비어 있거나 latest revision이 비정상적으로 비어 있을 수 있다.
- 이후 restore/publish flow에서 원인 파악이 어려워진다.

#### Recommended Fix

`createCustomRolePack` 전체를 `db.transaction(...)`으로 감싸고, set / revision / files를 하나의 atomic mutation으로 만든다.

#### Suggested Test Additions

- role pack file insert 실패를 mock해서 set row가 롤백되는지 검증
- partial row가 남지 않는지 service-level test 추가

## UI-Specific State

현재 UI는 전반적으로 많이 정리됐지만, 이번 변경 기준으로는 아래가 핵심이다.

### Stable

- `ChangeReviewDesk`의 PR bridge / merge candidate / recovery surface 연결
- `ProtocolActionConsole`의 company workflow template selector
- `CompanySettings`의 workflow template / role pack editor

### Still Fragile

- recovery reopen 후 protocol-aware surface 일관성
- setup readiness cards와 role pack mutation 간 캐시 정합성
- workflow template selector가 `id` uniqueness에 지나치게 의존하는 점

## Test Gaps

### UI Unit Harness

현재 `ui/package.json`에는 다음이 없다.

- `test` script
- `jsdom`
- React Testing Library 계열 의존성

즉 UI는 build/typecheck 기준으로는 확인되지만, unit/component 수준 회귀는 막지 못한다.

### Missing Scenarios

특히 아래 시나리오 테스트가 없다.

- merge recovery reopen 후 protocol state 복구
- custom role 생성 후 setup progress refresh
- workflow template duplicate/reserved ID rejection

## Priority

### P0

- recovery reopen과 protocol state의 불일치 해결

### P1

- custom role 생성 후 setup/doctor invalidate 보강
- workflow template ID uniqueness / reserved namespace validation 추가

### P2

- custom role creation transaction화
- UI unit harness 보강

## Recommended Next Execution Order

1. recovery reopen semantics 정리
   - protocol reset인지
   - reopen-only wake semantics인지
   - 제품 정책을 먼저 고정
2. Company Settings query invalidation 수정
3. workflow template validator 강화
4. role pack mutation transaction화
5. 위 4개에 대한 회귀 테스트 추가

