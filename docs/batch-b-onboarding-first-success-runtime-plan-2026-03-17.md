---
title: "Batch B Onboarding, First Success, And Runtime Awareness Plan"
author: "Taewoong Park (park.taewoong@airsmed.com)"
date: "2026-03-17"
---

# Batch B Onboarding, First Success, And Runtime Awareness Plan

상태: design draft  
범위: `Squadrail` 현재 코드 기준 상세 설계  
관련 상위 문서: [squadrail-product-overview-and-expansion-roadmap-2026-03-17.md](./squadrail-product-overview-and-expansion-roadmap-2026-03-17.md)

## 1. 목표

`Batch B`의 목적은 아래 세 가지를 한 배치로 잠그는 것이다.

1. 온보딩을 단순 설정 입력기가 아니라 **첫 성공을 빠르게 만드는 guided interview + recommendation**으로 바꾼다.
2. 첫 quick request 제출 후 사용자가 **“지금 뭐가 진행 중인지”** 바로 이해하게 만든다.
3. worktree/runtime 정보를 숨은 구현이 아니라 **운영 truth**로 끌어올린다.

즉 이번 배치는 새 기능 추가보다, 이미 있는:

- onboarding wizard
- setup progress
- invite/onboarding manifest
- workspace routing
- clarification surfaces

를 사용자 경험 기준으로 다시 제품화하는 배치다.

## 2. 왜 지금 필요한가

현재 `Squadrail`은 이미:

- 회사 생성
- 블루프린트 적용
- primary workspace 연결
- 첫 quick request 제출

까지 잘 닫혀 있다.

하지만 위저드 완료 이후에는 아직 다음 공백이 남는다.

1. **의도 입력은 있지만 추천 레이어가 약하다.**
   - 지금은 4-step wizard가 잘 동작하지만, 사용 목적/배포 방식/자율성 정도를 먼저 묻고 추천하는 레이어는 약하다.

2. **첫 성공 문맥이 약하다.**
   - quick request 제출 후 사용자가 “PM이 지금 뭘 하고 있는가”, “clarification이 오면 어디서 답해야 하는가”를 곧바로 알기 어렵다.

3. **runtime/worktree truth가 UI 전면에 없다.**
   - backend에는 worktree/clone/shared workspace 구분과 상태가 강하게 존재하지만, 사용자는 여전히 그것을 운영 surface에서 즉시 읽기 어렵다.

## 3. 현재 상태 (AS-IS)

## 3.1 온보딩과 setup progress는 이미 존재한다

관련 코드:

- [ui/src/components/OnboardingWizard.tsx](../ui/src/components/OnboardingWizard.tsx)
  - 회사 생성
  - 팀 블루프린트 선택/preview/apply
  - workspace 연결 + doctor/probe
  - 첫 quick request 제출
- [ui/src/components/Layout.tsx](../ui/src/components/Layout.tsx)
  - setup gate checklist 표시
- [server/src/services/setup-progress.ts](../server/src/services/setup-progress.ts)
  - `company_ready -> squad_ready -> engine_ready -> workspace_connected -> knowledge_seeded -> first_issue_ready`
- [packages/shared/src/types/setup.ts](../packages/shared/src/types/setup.ts)
  - `SetupProgressView`
- [ui/src/pages/CompanySettings.tsx](../ui/src/pages/CompanySettings.tsx)
  - setup readiness / doctor / blueprint readiness surface

즉 foundation은 이미 있다.  
문제는 이것이 아직:

- onboarding interview profile
- 추천 surface
- post-onboarding guidance

까지 확장되지는 않았다는 점이다.

## 3.2 invite/onboarding foundation도 이미 존재한다

관련 코드:

- [server/src/routes/access.ts](../server/src/routes/access.ts)
  - invite 생성
  - join request 승인/거절
  - onboarding manifest/text 문서
- [ui/src/api/access.ts](../ui/src/api/access.ts)
  - invite / join request / board claim
- [packages/shared/src/types/access.ts](../packages/shared/src/types/access.ts)
  - membership / permission / invite / join request

즉 사람/에이전트 온보딩의 하부 계약은 이미 있다.  
이번 배치는 이것을 “운영 경로”에서 더 쉽게 보이게 만드는 것이 핵심이다.

## 3.3 clarification surface는 이미 있지만 첫 사용자 친화성은 부족하다

관련 코드:

- [ui/src/pages/Inbox.tsx](../ui/src/pages/Inbox.tsx)
- [ui/src/pages/IssueDetail.tsx](../ui/src/pages/IssueDetail.tsx)
- [ui/src/components/CompanyRail.tsx](../ui/src/components/CompanyRail.tsx)
- [ui/src/components/ProtocolActionConsole.tsx](../ui/src/components/ProtocolActionConsole.tsx)

현재 clarification은 protocol-first로 잘 구성돼 있다.  
문제는 “어디서 답하면 되는지”를 첫 사용자에게 충분히 알려주지 않는다는 점이다.

## 3.4 runtime/worktree semantics는 backend에 이미 강하게 있다

관련 코드:

- [server/src/services/project-workspace-routing.ts](../server/src/services/project-workspace-routing.ts)
  - `analysis`, `implementation`, `review`
  - `project_shared`, `project_isolated`
  - `fresh`, `reused_clean`, `resumed_dirty`, `recreated_clean`, `recovered_existing`
- [server/src/__tests__/issue-protocol-execution.test.ts](../server/src/__tests__/issue-protocol-execution.test.ts)
  - self `START_IMPLEMENTATION` coalescing + `workspaceUsageOverride`
- [packages/shared/src/types/issue.ts](../packages/shared/src/types/issue.ts)
  - `IssueChangeSurface.workspacePath`
  - `workspaceSource`
  - `workspaceState`
- [ui/src/components/ChangeReviewDesk.tsx](../ui/src/components/ChangeReviewDesk.tsx)
  - workspace copy/open surface

즉 runtime/worktree는 이미 구현되어 있다.  
문제는 이것이 현재:

- change/review desk
- debug/test

에만 강하게 존재하고, `IssueDetail`, `Runs`, `Work` 상단의 공용 운영 문맥으로는 아직 올라오지 않았다는 점이다.

## 4. 검증된 설계 패턴에서 실제로 가져올 것

아래 방향이 특히 유효하다.

- interview-first onboarding
- lightweight worktree visibility banner

그대로 가져오지 않을 것:

1. 온보딩을 완전히 새 제품처럼 갈아엎는 것
2. worktree를 전역 decorative banner로만 보여주는 것

`Squadrail`에 맞는 번역은:

- interview-first onboarding은 `OnboardingWizard`의 pre-profile step으로
- worktree banner는 전역 배너보다 `issue/run/change context` 중심으로

가 더 적합하다.

## 5. Batch B 설계 원칙

## 5.1 설정 입력보다 추천이 먼저

사용자는 adapter type, workspace mode, knowledge seed 여부를 먼저 결정하고 싶지 않다.  
먼저 필요한 것은:

- 어떤 종류의 회사인지
- 어느 정도 자율성을 원하는지
- 실제 로컬 repo/workspace를 바로 붙일 것인지

다.

## 5.2 post-onboarding은 issue-centric여야 한다

첫 성공 경험의 핵심은 `Team`이 아니라:

- 첫 quick request가 어디까지 왔는지
- clarification이 필요한지
- 다음 행동이 무엇인지

다.

## 5.3 runtime/worktree는 숨기지 말고 번역한다

worktree는 내부 구현 detail이 아니라 운영상 중요한 truth다.  
다만 raw path dump가 아니라 아래 정보로 번역해야 한다.

- shared / isolated
- analysis / implementation / review
- clean / reused / dirty resume / recreated

## 6. 설계 범위

## 6.1 B1 — Onboarding Interview Profile

### 목표

현재 4-step wizard 앞에 **짧은 interview profile**을 추가해:

- 기본 team blueprint
- adapter recommendation
- workspace expectation
- autonomy recommendation

을 미리 정한다.

### 질문 축

V1 질문:

1. `useCase`
   - `solo_builder`
   - `software_team`
   - `ops_control_plane`
   - `evaluation_lab`
2. `deploymentMode`
   - `local_single_host`
   - `private_network`
   - `public_service`
3. `autonomyMode`
   - `guided`
   - `balanced`
   - `aggressive`
4. `runtimePreference`
   - `codex_local`
   - `claude_local`
   - `openclaw`
   - `decide_later`

### 저장 위치

새 테이블은 만들지 않는다.  
먼저 [packages/shared/src/types/setup.ts](../packages/shared/src/types/setup.ts) 의 `SetupProgress.metadata` 아래에 저장한다.

```ts
interface OnboardingProfileV1 {
  useCase: "solo_builder" | "software_team" | "ops_control_plane" | "evaluation_lab";
  deploymentMode: "local_single_host" | "private_network" | "public_service";
  autonomyMode: "guided" | "balanced" | "aggressive";
  runtimePreference: "codex_local" | "claude_local" | "openclaw" | "decide_later";
  createdAt: string;
}
```

### 추천 결과

wizard는 위 profile을 기반으로:

- 기본 team blueprint
- 기본 engine
- workspace guidance note
- clarification/approval safety note

를 자동 제안한다.

예:

- `solo_builder + local_single_host + guided`
  - `codex_local` 우선
  - smaller team blueprint
  - shared primary workspace 우선
- `software_team + private_network + balanced`
  - generic PM/TL/Engineer/Reviewer/QA blueprint
  - `claude_local` or `openclaw` guidance
  - isolated implementation workspace 권장

### 영향 파일

- [ui/src/components/OnboardingWizard.tsx](../ui/src/components/OnboardingWizard.tsx)
- [ui/src/api/companies.ts](../ui/src/api/companies.ts)
- [packages/shared/src/types/setup.ts](../packages/shared/src/types/setup.ts)
- [packages/shared/src/validators/setup.ts](../packages/shared/src/validators/setup.ts)
- [server/src/services/setup-progress.ts](../server/src/services/setup-progress.ts)

## 6.2 B2 — Post-Onboarding First Success Surface

### 목표

첫 quick request 제출 이후 사용자가:

- 지금 PM이 structuring 중인지
- clarification이 왔는지
- 어디서 진행을 보면 되는지

를 즉시 이해하게 만든다.

### TO-BE

#### 1. welcome banner

`IssueDetail` 상단에 onboarding source issue 전용 배너를 표시한다.

표시 조건은 heuristic이 아니라, 아래 canonical signal로 고정한다.

- `SetupProgress.metadata.onboardingIssueId`

즉 `OnboardingWizard`가 첫 quick request를 생성할 때:

- `firstIssueReady = true`
- `onboardingIssueId = createdIssueId`

를 함께 기록한다.

`?source=onboarding` query param은 있더라도 **보조 UX 힌트**일 뿐, source of truth로 쓰지 않는다.

#### 2. clarification escalation

기존 clarification surface를 유지하되:

- `CompanyRail` unread badge
- `Inbox` clarification queue
- `IssueDetail` pending clarification callout

세 군데를 onboarding source issue에서 더 강하게 연결한다.

#### 3. smart empty states

`Work`, `Inbox`, `Overview` empty state는 setup progress와 기존 issue/protocol 데이터 파생값을 함께 반영한다.

예:

- 첫 quick request 전: “Submit a quick request to get started.”
- 첫 quick request 후, 첫 close 전: “Your PM is structuring the first request.”
- clarification pending: “A clarification is waiting in Inbox.”

여기서 “첫 close 전”은 새 setup 단계 추가가 아니라 아래 파생 규칙으로 계산한다.

- `setupProgress.steps.firstIssueReady === false`
  - 아직 첫 quick request 전
- `setupProgress.steps.firstIssueReady === true` and `closedRootIssueCount === 0`
  - 첫 quick request 후, 첫 성공 전
- `closedRootIssueCount > 0`
  - first-success 종료 후 generic empty state로 복귀

#### 4. setup checklist reuse

새 checklist를 만들지 않는다.  
이미 있는 [ui/src/components/Layout.tsx](../ui/src/components/Layout.tsx) 의 setup gate와 [ui/src/pages/CompanySettings.tsx](../ui/src/pages/CompanySettings.tsx) readiness를 재사용해 `Overview`/`IssueDetail`에 얇게 재표현한다.

중요한 결정:

- `setupProgress` 자체에는 `firstCloseDone` 같은 새 단계를 추가하지 않는다.
- first-success 판별은 issue/protocol 데이터에서 파생한다.

### 영향 파일

- [ui/src/pages/IssueDetail.tsx](../ui/src/pages/IssueDetail.tsx)
- [ui/src/pages/Inbox.tsx](../ui/src/pages/Inbox.tsx)
- [ui/src/components/CompanyRail.tsx](../ui/src/components/CompanyRail.tsx)
- [ui/src/pages/Issues.tsx](../ui/src/pages/Issues.tsx)
- [ui/src/components/Layout.tsx](../ui/src/components/Layout.tsx)
- [ui/src/components/OnboardingWizard.tsx](../ui/src/components/OnboardingWizard.tsx)
- [server/src/services/setup-progress.ts](../server/src/services/setup-progress.ts)
- [server/src/services/issues.ts](../server/src/services/issues.ts)

## 6.3 B3 — Worktree / Runtime Awareness

### 목표

현재 issue/run이 어느 execution context에서 도는지:

- shared workspace인지
- isolated worktree인지
- review workspace인지
- 새로 만든 clean workspace인지
- dirty resume인지

를 운영자가 즉시 이해하게 만든다.

### TO-BE shared model

새 read model:

```ts
interface IssueRuntimeSummary {
  workspaceUsage: "analysis" | "implementation" | "review" | null;
  workspaceSource: "project_shared" | "project_isolated" | null;
  workspaceState:
    | "fresh"
    | "reused_clean"
    | "resumed_dirty"
    | "recreated_clean"
    | "recovered_existing"
    | null;
  workspacePath: string | null;
  branchName: string | null;
  headline: string;
  detail: string | null;
  severity: "info" | "warning" | "risk";
}
```

### 계산 입력

V1은 scope를 `IssueDetail + Changes`로 제한하고, 먼저 새 route는 만들지 않고 아래를 합성한다.

- `IssueChangeSurface`
- merge candidate automation metadata
- current protocol/run context

즉 V1은 existing route/read model 합성으로 시작한다.

### UI surface

#### IssueDetail

헤더 바로 아래에 `Runtime banner`를 둔다.

예:

- `Isolated implementation worktree · fresh`
- `Review is using shared project workspace`
- `Implementation resumed on dirty worktree`

#### Runs

`Runs`는 V1 범위에서 제외한다.

이유:

- 현재 heartbeat/live run 타입에는 normalized workspace summary가 없다.
- 회사 단위 live run list에서 이 정보를 안정적으로 노출하려면 heartbeat API 확장이 필요하다.

따라서:

- `V1` = `IssueDetail` + `Changes`
- `V2` = `Runs`까지 확장

#### Changes

기존 `ChangeReviewDesk`의 workspace 표현을 상단 compact summary로 승격한다.

### 영향 파일

- [packages/shared/src/types/issue.ts](../packages/shared/src/types/issue.ts)
- [ui/src/pages/IssueDetail.tsx](../ui/src/pages/IssueDetail.tsx)
- [ui/src/components/ChangeReviewDesk.tsx](../ui/src/components/ChangeReviewDesk.tsx)

## 7. 구현 순서

1. `B2 first-success banner + smart empty states`
   - 가장 사용자 체감 가치가 큼
2. `B3 runtime/worktree awareness`
   - backend truth를 운영 surface로 올림
3. `B1 onboarding interview profile`
   - 기존 wizard를 깨지 않고 앞단 추천 레이어를 추가

이 순서가 맞는 이유는:

- 첫 성공 경험은 즉시 ROI가 크고
- runtime awareness는 이미 구현된 truth를 노출하는 작업이라 안정적이며
- interview profile은 wizard 변경이 커서 마지막이 안전하다

## 8. 테스트 시나리오

### 단위 테스트

- setup progress metadata profile merge
- runtime summary derivation
- smart empty state message selection
- first-success derived state selection

### 통합 테스트

- onboarding quick request 생성 후 `IssueDetail` welcome banner
- clarification 발생 시 `Inbox` / `IssueDetail` / rail badge 동시 노출
- runtime banner가 `shared/review`와 `isolated/implementation`을 구분
- onboarding issue id가 setup metadata에 기록
- `Runs` surface는 V1에서 변경 없음

### UI smoke

1. onboarding source issue 진입
2. welcome banner 표시
3. pending clarification fixture 표시
4. runtime banner fixture 표시
5. first-success 이후 generic empty state 복귀

## 9. 완료 기준

1. onboarding 질문 3~4개로 기본 추천이 생성된다.
2. 첫 quick request 제출 후 사용자가 “다음에 무슨 일이 일어나는지”를 배너로 즉시 이해한다.
3. clarification이 왔을 때 Inbox를 열어야 한다는 사실이 surface에서 명확히 보인다.
4. issue/change surface에서 worktree/runtime context를 같은 vocabulary로 읽을 수 있다.

## 10. 결론

`Batch B`는 새 제품을 만드는 배치가 아니다.  
이미 있는:

- setup progress
- onboarding wizard
- clarification surface
- worktree/runtime engine

를 “첫 성공” 관점으로 다시 묶는 배치다.

즉 이번 배치의 핵심은:

> 더 많은 설정이 아니라, 더 적은 질문으로 더 빠르게 시작하고,
> 시작한 뒤에는 지금 무엇이 진행 중인지 더 분명하게 보여주는 것

이다.
