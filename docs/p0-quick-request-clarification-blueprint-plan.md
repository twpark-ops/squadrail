# P0 Quick Request, Clarification, and Team Blueprint Plan

작성일: 2026-03-13  
작성자: Taewoong Park <park.taewoong@airsmed.com>

## 1. 목표

현재 `Squadrail`의 delivery kernel은 이미 닫혔다. 다음 제품 목표는 아래 기본 사용자 플로우를 제품 수준으로 닫는 것이다.

1. 사람이 짧게 요청한다.
2. 시스템/PM이 구조화한다.
3. 부족한 정보만 질문한다.
4. 사람은 짧게 답한다.
5. 팀이 실행, 리뷰, QA, close를 수행한다.
6. 같은 팀 구성을 다른 회사에도 쉽게 재사용한다.

즉 다음 트랙의 목적은 `kernel hardening`이 아니라 `generic software-delivery company OS productization`이다.

## 2. 북극성

`사람은 짧게 요청하고, 시스템은 팀을 빠르게 세팅하고, 에이전트는 필요한 질문만 던지고, 운영자는 짧게 답하면 된다.`

## 3. 현재 상태

이미 있는 것:

- `Human -> PM intake` backend kernel
- `PM projection -> hidden child work item` backend kernel
- `TL -> Engineer -> Reviewer/QA -> Close` delivery kernel
- protocol / retrieval / memory / review / QA / close / org burn-in
- onboarding, role-pack seed, custom role, single-agent hire

아직 부족한 것:

- quick request는 기본 입력 경로이자 onboarding first path까지 올라왔지만, 상위 autonomy E2E는 아직 없다
- clarification loop는 공식 answer path와 shared pending contract까지 닫혔고 operator surface도 올라왔지만, 질문 정책 기반 상위 시나리오 검증은 아직 없다
- `cloud-swiftsight` canonical을 일반화한 generic team blueprint system은 catalog + preview/apply + Company Settings/onboarding consumption까지 올라왔지만, legacy canonical을 완전히 registry 중심으로 흡수하는 마이그레이션은 아직 남아 있다
- 팀을 blueprint 단위로 preview/apply 하는 bulk provisioning은 server contract와 Company Settings/onboarding flow까지 올라왔지만, 회사 간 portability/import-export와 parameter editing은 아직 없다
- 다음 immediate next는 `Phase 7 bounded autonomy E2E`다

### 구현 체크포인트 2026-03-13

- `Phase 1` 1차 구현 완료
  - `NewIssueDialog` 기본 모드를 `quick request`로 전환했다.
  - 기존 상세 작성은 `Advanced issue` secondary path로 내렸다.
- `Phase 2` 1차 구현 완료
  - `ANSWER_CLARIFICATION` protocol contract를 shared/server validator까지 올렸다.
  - `Inbox` clarification queue read surface와 `IssueDetail` pending clarification view를 추가했다.
- `Phase 3` 완료
  - `ProtocolActionConsole`에 공식 clarification answer submit action을 추가했다.
  - answer -> question ack -> retrieval/memory ingest -> wake reason propagation까지 연결했다.
  - `ANSWER_CLARIFICATION`가 blocked / awaiting-human 상태를 공식 resume state로 되돌리도록 서버가 workflow state를 재계산한다.
  - `Inbox`와 `IssueDetail`이 같은 pending human clarification contract를 공유하도록 정리했다.
- `Phase 4` 1차 구현 완료
  - generic `team blueprint` shared type / validator / constants를 추가했다.
  - server `team-blueprints` catalog service와 `GET /api/companies/:companyId/team-blueprints` read route를 추가했다.
  - `Inbox` answer CTA deep-link, `IssueDetail` answered/resumed trace, `ChangeReviewDesk` clarification trace를 추가했다.
- `Phase 4` 2차 구현 완료
  - `team blueprint preview/diff` request/response contract를 추가했다.
  - `POST /api/companies/:companyId/team-blueprints/:blueprintKey/preview` route를 추가했다.
  - `CompanySettings`가 blueprint catalog를 읽고 preview diff를 operator surface로 보여준다.
  - 남은 immediate next는 `apply contract -> confirmation gate -> semantics test -> UI flow`다.
- `Phase 5` 구현 완료
  - `previewHash`가 포함된 preview response contract를 추가했다.
  - `team blueprint apply` request/response contract를 추가했다.
  - `POST /api/companies/:companyId/team-blueprints/:blueprintKey/apply` route를 추가했다.
  - apply는 preview hash drift가 있으면 stale preview로 거부한다.
  - apply는 outer transaction으로 묶여 partial org/team residue를 남기지 않는다.
  - per-project TL slot expansion과 project lead wiring을 `standard_product_squad` 실제 apply test로 고정했다.
  - service/unit + route regression으로 `stale reject`, `first apply create`, `same preview retry reject`, rollback failure injection을 고정했다.
  - `CompanySettings`가 preview diff 확인 -> confirmation -> apply까지 공식 operator flow로 연결됐다.
  - apply 성공 후 `setup/doctor/agent/project/orgSync/knowledgeSetup/activity/sidebar badges` invalidate와 success toast를 연결했다.
  - `swiftsight-org-canonical`에 generic blueprint parameter-map 흡수 준비 메타를 추가했다.
  - 남은 immediate next는 `Phase 6 onboarding / company settings reframe + swiftsight absorption follow-through`다.
- `Phase 6` 1차 구현 완료
  - `OnboardingWizard`를 `회사 생성 -> blueprint 선택/preview/apply -> workspace 연결 -> 첫 quick request` 흐름으로 재편했다.
  - 기존 `CEO 생성 -> 첫 일반 이슈 생성` onboarding path를 제거했다.
  - browser smoke에서 onboarding이 blueprint 선택 단계까지 실제로 열리는지 고정했다.
- `Phase 6` 2차 구현 완료
  - `CompanySettings` hierarchy를 role-pack studio보다 team builder / blueprint / apply가 먼저 보이도록 재정렬했다.
  - `swiftsight` canonical absorption prep metadata를 onboarding / Company Settings preview guidance에서 실제로 소비하게 연결했다.
  - browser smoke에서 `onboarding company -> blueprint preview/apply -> workspace -> quick request` happy path와 `Company Settings preview/apply confirmation gate`를 끝까지 고정했다.
  - server test는 메모리 절약형 기본 실행으로 재구성했다.
    - `pnpm --filter @squadrail/server test` = `test:base(maxWorkers=2) + test:heavy(fileParallelism=false)`
    - `pnpm --filter @squadrail/server test:coverage` = 필요할 때만 별도 실행

## 4. 제품 계약

### 4.1 Human Input Minimum Contract

휴먼은 아래 수준까지는 적어야 한다.

- 요청 목적
- 왜 필요한지
- 대략의 범위 또는 project 힌트
- 우선순위 또는 마감 감각
- 있으면 좋은 완료 기준

이 계약은 `완전 자유형 한 줄 입력`이 아니다. `업무적으로 의미 있는 이슈`를 사람이 제공하고, 시스템이 그것을 실행 가능 상태로 더 구조화하는 모델이다.

### 4.2 Clarification Trigger Policy

시스템/PM/TL/Engineer는 아래 조건에서만 질문한다.

- project 선택 ambiguity
- scope boundary ambiguity
- hard deadline ambiguity
- reviewer / QA bar ambiguity
- release / merge / deploy safety ambiguity
- conflicting requirements or missing evidence

질문은 적을수록 좋지만, 필요한 질문은 반드시 보여야 한다.

### 4.3 Clarification Answer Contract v0

현재 protocol에는 `ASK_CLARIFICATION`은 있지만 전용 answer message type은 없다. 현재 human-side 공식 action은 사실상 `NOTE`에 가깝다.

따라서 Phase 2 UI 착수 전에 아래를 먼저 고정해야 한다.

1. answer contract는 전용 protocol action으로 갈지, `NOTE` 재사용으로 갈지
2. answer가 특정 clarification message와 어떻게 연결되는지
3. answer 이후 owner wake와 resume가 어떤 규칙으로 발생하는지

권장안:

- 1차 제품화는 `전용 clarification answer action`을 도입한다.
- fallback으로 `NOTE` 재사용을 택할 수는 있지만, 그 경우에도 아래는 필수다.
  - answer 전용 구분자
  - causal message linkage
  - wake/resume rule
  - inbox/thread rendering parity

### 4.4 Resume Semantics

clarification 답변 이후에는 아래가 명확해야 한다.

1. 질문이 해결됨
2. root issue / protocol state / brief에 답변이 반영됨
3. 해당 owner(PM, TL, engineer)가 다시 wake 됨
4. 진행 중단 상태가 공식적으로 해제됨

### 4.5 Team Blueprint Contract v1

blueprint는 최소 아래를 가져야 한다.

- team key / label / description
- projects[]
- role structure
- reportsTo graph
- engine defaults
- lane/capability defaults
- role-pack preset
- optional PM / QA / CTO toggles
- workspace / repo expectation
- knowledge import / readiness expectation
- execution readiness metadata
  - required workspaces
  - approval-required agents
  - doctor/setup prerequisites
  - recommended first quick request

## 5. 비목표

이번 트랙에서 하지 않는 것:

- auto merge
- generic workflow builder
- non-software teams full support
- fancy character UI
- peer-to-peer agent chat
- sprint/capacity 고도화

## 6. Phase Plan

## Phase 1. Quick Request 기본화 [1차 완료]

### 목표

기본 issue 입력을 `quick request` 중심으로 전환하고, 기존 상세 폼은 `Advanced issue`로 내린다.

### 구현 범위

- 기본 create entry를 `POST /api/companies/:companyId/intake/issues` 기반으로 전환
- `request + optional project + optional priority + optional related issue` 중심 입력
- 기존 상세 issue create는 유지하되 secondary path로 이동

### 주요 파일

- `ui/src/components/NewIssueDialog.tsx`
- `ui/src/api/issues.ts`
- `server/src/routes/issues/intake-routes.ts`
- `packages/shared/src/validators/issue.ts`

### 성공 조건

- 기본 입력 진입점이 quick request를 사용한다
- intake root가 기존 issue/protocol kernel 위에서 정상 생성된다
- Advanced issue는 기능 회귀 없이 별도 경로로 남는다

### 테스트

- quick request route success / validation route test
- Playwright smoke or browser interaction regression for primary/advanced mode
- intake-created issue + PM assignment regression
- UI unit harness는 Phase 1 범위가 커질 경우 별도 추가 여부를 결정한다

## Phase 2. Clarification Contract + Read Surface [1차 완료]

### 목표

clarification question contract를 먼저 고정하고, 질문을 Inbox/Issue surface의 1급 read experience로 올린다.

### 구현 범위

- answer contract decision 고정
  - dedicated answer action vs NOTE reuse
  - causal linkage
  - resume trigger rule
- clarification question card surface
- decision / clarification queue in Inbox
- issue detail thread에서 same question view 유지

### 주요 파일

- `ui/src/pages/Inbox.tsx`
- `ui/src/pages/IssueDetail.tsx`
- `ui/src/components/ProtocolActionConsole.tsx`
- `server/src/services/issue-protocol.ts`
- `packages/shared/src/types/protocol.ts`

### 성공 조건

- 운영자가 어떤 질문이 대기 중인지 한 눈에 본다
- 질문이 issue detail / inbox 어디서 봐도 동일 contract를 사용한다
- clarification answer contract가 UI 착수 전에 문서/타입 기준으로 고정된다
- 이 phase에서는 answer submit 자체를 닫지 않고, read surface와 contract freeze를 우선한다

### 테스트

- inbox clarification feed route/service tests
- issue detail clarification rendering test
- protocol change-surface regression
- answer contract type/validator test or doc-linked contract test

## Phase 3. Human Answer Path + Resume Semantics [완료]

### 목표

운영자가 짧게 답한 뒤, PM/TL/Engineer가 공식적으로 다시 진행되게 만든다.

### 구현 범위

- clarification answer submit action
- answer -> issue/protocol/brief update
- answer -> wake scheduling / dispatch resume

### 주요 파일

- `server/src/routes/issues.ts`
- `server/src/services/issue-protocol.ts`
- `server/src/services/heartbeat.ts`
- `ui/src/components/ProtocolActionConsole.tsx`
- `ui/src/pages/Inbox.tsx`

### 성공 조건

- 질문 보기 -> 답변 -> 재개가 단일 공식 플로우로 보인다
- 답변 후 owner wake가 실제로 발생한다
- stale pending clarification 상태가 남지 않는다
- NOTE 우회가 아니라 공식 answer path로 인식된다
- blocked / human-decision 대기 상태에서 답변하면 protocol workflow state가 공식 resume state로 복구된다
- Inbox와 Issue Detail이 동일한 pending human clarification 소스를 사용한다
- Inbox에서 바로 answer CTA 또는 Issue Detail deep-link를 통해 공식 answer path로 들어간다
- answered / resumed 상태를 Issue Detail과 change surface에서 operator가 읽을 수 있다

### 테스트

- answer action route test
- protocol state transition test
- wake/resume regression
- pending human clarification derivation parity test
- inbox -> issue detail -> resume end-to-end smoke

## Phase 4. Generic Team Blueprint v1 [preview/diff kickoff 완료]

### 목표

`cloud-swiftsight` 전용 canonical을 일반화된 team blueprint registry로 바꾼다.

### 구현 범위

- `swiftsight-org-canonical` 분리/일반화
- 최소 3종 blueprint 제공
  - `small_delivery_team`
  - `standard_product_squad`
  - `delivery_plus_qa`
- company-scoped blueprint catalog read route
- preview/diff/apply를 위한 readiness metadata skeleton
- preview request/response contract
- Company Settings catalog/preview surface

### 주요 파일

- `server/src/services/swiftsight-org-canonical.ts`
- `server/src/services/team-blueprints.ts` 신규
- `packages/shared/src/types/team-blueprint.ts` 신규
- `packages/shared/src/validators/team-blueprint.ts` 신규
- `server/src/services/knowledge-setup.ts`
- `server/src/routes/companies.ts`
- `ui/src/api/companies.ts`

### 성공 조건

- 특정 회사명 하드코딩 없이 blueprint registry가 동작한다
- blueprint metadata만으로 project/agent/reportsTo/lane defaults를 설명할 수 있다
- blueprint metadata만으로 workspace/knowledge/setup readiness expectations도 함께 설명할 수 있다
- operator surface가 company blueprint catalog를 읽을 수 있다
- operator surface가 preview diff와 readiness warnings를 읽을 수 있다
- 기존 `cloud-swiftsight` canonical은 registry의 한 blueprint로 흡수될 준비가 된다

### 테스트

- blueprint registry service tests
- team blueprint route tests
- readiness metadata preview regression
- Company Settings typecheck/build regression

## Phase 5. Bulk Provisioning with Preview/Diff [완료]

### 목표

팀 생성을 single-agent hire가 아니라 blueprint preview/apply로 처리한다.

### 구현 범위

- apply request/response contract
- preview hash/token 기반 confirmation gate
- preview 대비 실제 apply 결과 일치 보장
- reportsTo / project / lane / engine / role-pack preset 일괄 생성
- Company Settings preview -> apply operator flow

### 주요 파일

- `server/src/routes/companies.ts`
- `server/src/routes/agents.ts`
- `server/src/services/team-blueprints.ts`
- `ui/src/pages/CompanySettings.tsx`

### 성공 조건

- preview 없이 apply가 불가능하다
- preview 결과와 회사 상태가 drift하면 stale preview apply를 거부한다
- create/update/adopt/pause diff를 operator가 본다
- preview의 projectDiff와 실제 apply 결과가 일치한다
- preview의 roleDiff와 실제 agent/reportsTo 결과가 일치한다
- apply 후 company setup 상태가 일관되게 갱신된다
- preview route와 Company Settings read/apply surface가 함께 shipped 상태다
- apply 성공 후 setup/doctor/agent/project/orgSync/knowledgeSetup/activity/sidebar 상태가 invalidate 된다
- `swiftsight canonical`은 generic blueprint parameter map 흡수 준비 메타를 가진다

### 테스트

- apply contract validator tests
- preview hash/token gate tests
- stale preview rejection tests
- preview/apply service semantics tests
- preview/apply route tests
- company setup invalidation regression

## Phase 6. Onboarding / Company Settings 재편 [완료]

### 목표

온보딩과 회사 설정을 아래 흐름에 맞게 재편한다.

1. 회사 생성
2. blueprint 선택
3. workspace 연결
4. 첫 quick request

### 구현 범위

- onboarding wizard step reflow
- company settings team builder surface
- role-pack studio는 sub-surface로 유지

### 주요 파일

- `ui/src/components/OnboardingWizard.tsx`
- `ui/src/pages/CompanySettings.tsx`
- `ui/src/api/companies.ts`

### 성공 조건

- 새 회사 생성 후 “첫 팀 구성”이 명확한 기본 경로를 가진다
- role-pack/custom-role는 secondary admin surface로 남는다
- first quick request까지 이어지는 path가 단일 흐름으로 보인다
- onboarding이 `회사 -> blueprint -> workspace -> quick request`를 실제로 보여준다
- Company Settings가 `team builder -> blueprint preview/apply -> setup readiness` 중심 hierarchy를 가진다
- canonical absorption guidance가 onboarding / Company Settings에서 실제 preview request로 연결된다

### 테스트

- onboarding UI flow tests
- company settings team builder mutation tests
- browser smoke onboarding regression
- browser smoke company settings preview/apply confirmation regression

## Phase 7. Bounded Autonomy E2E

### 목표

`kernel burn-in` 위에 상위 제품 목표를 검증하는 autonomy E2E를 추가한다.

### 구현 범위

- human starts with structured-but-short request
- PM structuring
- optional clarification
- projection
- execution / review / QA / close

### 주요 파일

- `scripts/e2e/cloud-swiftsight-real-org.mjs` 유지
- `scripts/e2e/*autonomy*.mjs` 신규
- `scripts/runtime/squadrail-protocol.mjs` projection helper 확장
- `server/src/routes/issues/intake-routes.ts` projection preview 계약 추가
- `server/src/services/pm-intake.ts` preview heuristics / staffing selection

### 성공 조건

- 기존 deterministic kernel burn-in은 그대로 유지된다
- 새로운 autonomy E2E는 exact actor/file 고정 대신 invariant로 합격한다
- PM/runtime helper가 `list-projects -> preview-intake-projection -> apply-intake-projection` 경로를 공식 지원한다

### 테스트 invariant

- intake root created
- PM structuring trace exists
- clarification can be asked and answered
- projected work items exist when decomposition is needed
- review / QA / close semantics stay valid

### 2026-03-14 kickoff 상태

- `projection preview` shared/server/runtime helper contract를 추가했다.
- PM helper CLI가 `list-projects`, `preview-intake-projection`, `apply-intake-projection`를 지원한다.
- PM role pack guide를 projection-first flow로 업데이트했다.
- kickoff harness [`scripts/e2e/cloud-swiftsight-autonomy-org.mjs`](/home/taewoong/company-project/squadall/scripts/e2e/cloud-swiftsight-autonomy-org.mjs)를 추가했다.
  - 현재 kickoff invariant는 `human intake -> projection preview -> projection apply -> assigned child created`다.
  - 아직 live control plane에서 full `execution / review / QA / close` burn-in까지는 실행하지 않았다.

## 7. 권장 실행 순서

1. Phase 1 `Quick Request`
2. Phase 2 `Clarification Contract + Read Surface`
3. Phase 3 `Answer + Resume`
4. Phase 4 `Generic Blueprint`
5. Phase 5 `Bulk Provisioning`
6. Phase 6 `Onboarding / Company Settings`
7. Phase 7 `Bounded Autonomy E2E`

## 8. Immediate Next Slice

현재 immediate next slice는 아래다.

1. kickoff autonomy script를 live control plane에서 실제 실행하고 invariant를 고정
2. clarification ask/answer를 autonomy harness에 포함
3. downstream `execution / review / QA / close`까지 상위 burn-in을 확장

즉 다음 배치는 `Phase 7 bounded autonomy E2E`다.
