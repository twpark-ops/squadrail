---
title: "Batch C Budget, Quota, Command Composer, And Collaboration Plan"
author: "Taewoong Park (park.taewoong@airsmed.com)"
date: "2026-03-17"
---

# Batch C Budget, Quota, Command Composer, And Collaboration Plan

상태: design draft  
범위: `Squadrail` 현재 코드 기준 상세 설계  
관련 상위 문서: [squadrail-product-overview-and-expansion-roadmap-2026-03-17.md](./squadrail-product-overview-and-expansion-roadmap-2026-03-17.md)

## 1. 목표

`Batch C`의 목적은 아래 세 가지 운영 기능을 제품 표면으로 끌어올리는 것이다.

1. 비용/예산/쿼터를 운영자가 즉시 읽는 **guardrail surface**로 만든다.
2. 전역 입력을 chat이 아니라 **structured command composer**로 정리한다.
3. 이미 존재하는 invite/join-request/access foundation을 **coarse collaboration model**로 제품화한다.

즉 이번 배치는 delivery core 위에 **운영 제어층**을 올리는 배치다.

## 2. 왜 지금 필요한가

현재 `Squadrail`은 이미:

- protocol execution
- review / QA
- RAG instrumentation
- blueprint provisioning

까지 강하다.

하지만 운영자 관점에서 아직 세 가지 공백이 남는다.

1. 비용/예산은 집계되지만 **일상 운영 signal**로 충분히 전면화돼 있지 않다.
2. 새 입력이 `NewIssueDialog`, `ProtocolActionConsole`, `CommandPalette`로 흩어져 있다.
3. 협업 foundation은 있지만 `owner/admin/operator/viewer`처럼 제품적으로 이해되는 역할 모델은 아직 약하다.

## 3. 현재 상태 (AS-IS)

## 3.1 비용/예산 foundation은 이미 있다

관련 코드:

- [server/src/routes/costs.ts](../../server/src/routes/costs.ts)
  - company summary
  - by-agent
  - by-project
  - company/agent budget patch
- [ui/src/api/costs.ts](../../ui/src/api/costs.ts)
- [packages/shared/src/types/cost.ts](../../packages/shared/src/types/cost.ts)
- [ui/src/pages/Costs.tsx](../../ui/src/pages/Costs.tsx)
- [ui/src/pages/DashboardOptimized.tsx](../../ui/src/pages/DashboardOptimized.tsx)
- [ui/src/pages/Inbox.tsx](../../ui/src/pages/Inbox.tsx)
  - budget alert

즉 비용 데이터와 budget cap은 이미 있다.  
문제는 이것이 아직:

- lane pause reason
- provider quota pressure
- company rail / issue surface marker

로 충분히 올라오지 않았다는 점이다.

## 3.2 입력 surface는 이미 여러 개가 있다

관련 코드:

- [ui/src/components/CommandPalette.tsx](../../ui/src/components/CommandPalette.tsx)
- [ui/src/components/NewIssueDialog.tsx](../../ui/src/components/NewIssueDialog.tsx)
- [ui/src/components/ProtocolActionConsole.tsx](../../ui/src/components/ProtocolActionConsole.tsx)

즉 global input은 없는 것이 아니라, **분절돼 있다**.

현재 문제:

- create issue
- quick request
- protocol decision
- navigation/search

가 하나의 모델로 정리돼 있지 않다.

## 3.3 collaboration foundation은 이미 있다

관련 코드:

- [packages/shared/src/types/access.ts](../../packages/shared/src/types/access.ts)
- [ui/src/api/access.ts](../../ui/src/api/access.ts)
- [server/src/routes/access.ts](../../server/src/routes/access.ts)
- [ui/src/pages/InviteLanding.tsx](../../ui/src/pages/InviteLanding.tsx)
- [ui/src/pages/CompanySettings.tsx](../../ui/src/pages/CompanySettings.tsx)

현재 이미 있는 것:

- invite
- join request
- claim api key
- member permission update
- admin company access update

즉 access foundation은 충분하다.  
문제는 이것이 아직 everyday UI에서 “역할 모델”로 충분히 번역되지 않았다는 점이다.

## 4. 검증된 설계 패턴에서 실제로 가져올 것

### 비용/쿼터

- budget policy card
- provider quota card
- sidebar budget marker

### command surface / collaboration

- command surface
- minimal collaboration role template

그대로 가져오지 않을 것:

1. 범용 chat composer
2. enterprise-grade RBAC
3. provider quota 전체를 처음부터 외부 API 의존으로 강제하는 것

## 5. Batch C 설계 원칙

## 5.1 비용은 기록이 아니라 guardrail이어야 한다

운영자는 “이번 달 얼마 썼다”보다:

- 지금 어느 lane이 위험한지
- 어느 provider가 급격히 타는지
- budget 때문에 실제로 멈췄는지

를 더 빨리 읽어야 한다.

## 5.2 composer는 chat이 아니라 command surface다

입력은 자유 대화가 아니라:

- `ask`
- `task`
- `decision`

세 모드로 구조화돼야 한다.

## 5.3 collaboration은 coarse role부터

지금 필요한 것은 거대한 ACL이 아니라:

- `owner`
- `admin`
- `operator`
- `viewer`

정도의 coarse role template다.

## 6. 설계 범위

## 6.1 C1 — Budget / Quota Guardrail Surface

### 목표

비용/예산/쿼터를 다음 세 층으로 보여준다.

1. `Overview / Layout` — 현재 위험도
2. `Costs` — 상세 진단
3. `Issue / Inbox / Team` — budget-caused block marker

### V1: existing budget model productization

먼저 현재 [server/src/routes/costs.ts](../../server/src/routes/costs.ts) 와 [packages/shared/src/types/cost.ts](../../packages/shared/src/types/cost.ts) 위에서 다음을 만든다.

- company monthly budget strip
- by-agent burn ranking
- by-project burn ranking
- budget warning / hard stop badges
- budget-based lane pause marker

### V2: provider quota windows

provider quota card 패턴을 참고해 optional provider quota layer를 추가한다.

새 shared type:

```ts
interface ProviderQuotaWindow {
  provider: string;
  windowKey: "5h" | "24h" | "7d" | "month";
  limitCents: number | null;
  usedCents: number;
  utilizationPercent: number | null;
  source: "observed_only" | "provider_api";
  status: "healthy" | "warning" | "hard_stop" | "unknown";
  fetchedAt: string | null;
}
```

V2는 provider API key가 있는 경우만 `source = provider_api`를 채우고, 없으면 current spend 기반 `observed_only`로 시작한다.

### UI surface

- `Layout` 또는 `CompanyRail`에 budget marker
- `Overview`에 company guardrail strip
- `Costs`에 budget card + provider quota cards
- `Inbox`/`Work`에 “paused by budget” marker

### 영향 파일

- [ui/src/pages/Costs.tsx](../../ui/src/pages/Costs.tsx)
- [ui/src/pages/DashboardOptimized.tsx](../../ui/src/pages/DashboardOptimized.tsx)
- [ui/src/pages/Inbox.tsx](../../ui/src/pages/Inbox.tsx)
- [ui/src/components/Layout.tsx](../../ui/src/components/Layout.tsx)
- [ui/src/api/costs.ts](../../ui/src/api/costs.ts)
- [packages/shared/src/types/cost.ts](../../packages/shared/src/types/cost.ts)
- [server/src/routes/costs.ts](../../server/src/routes/costs.ts)

## 6.2 C2 — Command Composer V1

### 목표

현재 흩어진 입력을 global structured composer로 정리한다.

### 모드

```ts
type CommandComposerMode = "ask" | "task" | "decision";
type CommandComposerScope = "company" | "project" | "issue";
```

### 의미

- `ask`
  - quick request
  - clarification answer
  - operator note
- `task`
  - create issue
  - create internal work item
  - project-scoped task
- `decision`
  - approve/reject/close/reassign/merge gate

### 기존 UI 재사용 원칙

composer는 기존 mutation surface를 직접 대체하지 않는다.  
V1은 아래 UI를 orchestration layer로 묶는다.

- [ui/src/components/NewIssueDialog.tsx](../../ui/src/components/NewIssueDialog.tsx)
- [ui/src/components/ProtocolActionConsole.tsx](../../ui/src/components/ProtocolActionConsole.tsx)
- [ui/src/components/CommandPalette.tsx](../../ui/src/components/CommandPalette.tsx)

즉 새 composer는 새 backend가 아니라 기존 action path의 **front door**다.

중요한 결정:

- V1 global composer는 issue-scoped action을 직접 실행하지 않는다.
- `decision` mode에서 issue가 필요하면 먼저 issue를 선택하고, 해당 issue detail/deep link로 이동한다.
- 실제 issue-scoped protocol submit은 기존 `ProtocolActionConsole`이 계속 담당한다.

### UI 구조

1. `Cmd/Ctrl + K` 또는 상단 입력기
2. mode 선택
3. scope 선택
4. issue scope가 필요하면 대상 issue 선택
5. structured form body
6. preview / confirm

예:

- `ask + company`
  - quick request 생성
- `task + project`
  - project-scoped issue 생성
- `decision + issue`
  - 대상 issue 선택 후 해당 issue의 decision surface로 deep-link

### 파일 후보

- [ui/src/components/CommandPalette.tsx](../../ui/src/components/CommandPalette.tsx)
- [ui/src/components/NewIssueDialog.tsx](../../ui/src/components/NewIssueDialog.tsx)
- [ui/src/components/ProtocolActionConsole.tsx](../../ui/src/components/ProtocolActionConsole.tsx)
- [ui/src/components/Layout.tsx](../../ui/src/components/Layout.tsx)

## 6.3 C3 — Minimal Collaboration Productization

### 목표

이미 있는 membership/permission foundation을 사람이 이해하는 coarse product role로 번역한다.

### TO-BE role templates

```ts
type CompanyRoleTemplate = "owner" | "admin" | "operator" | "viewer";
```

### 매핑 원칙

이 role template는 새 거대한 ACL이 아니라, 기존 `PrincipalPermissionGrant`의 preset 묶음이다.

예:

- `owner`
  - company settings
  - invites
  - budgets
  - operating alerts
  - access grants
- `admin`
  - invites
  - budgets
  - workflow templates
  - company settings 일부
- `operator`
  - issue/protocol decisions
  - approvals
  - recovery / merge gate
- `viewer`
  - read-only

### 저장 전략

V1은 새 role table을 만들지 않고:

- `CompanyMembership.membershipRole`
- `PrincipalPermissionGrant`
- invite `defaultsPayload`

를 조합해 시작한다.

즉 coarse role은 **preset**이고, source of truth는 여전히 permission grant다.

### UI surface

- `CompanySettings > Access`
- invite 생성 시 role template 선택
- join request 승인 시 기본 role template 할당
- member list에서 current template 표시

### 영향 파일

- [packages/shared/src/types/access.ts](../../packages/shared/src/types/access.ts)
- [packages/shared/src/validators/access.ts](../../packages/shared/src/validators/access.ts)
- [server/src/routes/access.ts](../../server/src/routes/access.ts)
- [ui/src/api/access.ts](../../ui/src/api/access.ts)
- [ui/src/pages/CompanySettings.tsx](../../ui/src/pages/CompanySettings.tsx)

## 7. 구현 순서

1. `C1 budget guardrail V1`
   - 현재 데이터 위에 즉시 얹을 수 있다.
2. `C3 collaboration templates`
   - 기존 permission foundation을 제품화한다.
3. `C2 command composer`
   - 위 두 배치의 permission / action path를 반영해 안정적으로 얹는다.
4. `C1 quota V2`
   - provider API integration은 마지막이다.

## 8. 테스트 시나리오

### 단위 테스트

- cost guardrail status derivation
- command mode -> mutation route selection
- role template -> permission grant mapping

### 통합 테스트

- budget warning이 rail / inbox / costs에서 같은 상태로 보임
- invite 승인 시 role template이 membershipRole + grants로 반영
- composer에서 `ask/task/decision`이 기존 path로 정상 전송

### UI smoke

1. budget warning fixture
2. paused-by-budget marker
3. command composer mode 전환
4. access role template selection

## 9. 완료 기준

1. 운영자는 `Overview`와 `Costs`만 보고 현재 budget risk를 이해할 수 있다.
2. `Cmd/Ctrl + K` 입력기가 navigation을 넘어서 실제 command surface로 동작한다.
3. invite/join request/member list에서 coarse role이 제품적으로 읽힌다.
4. budget-caused pause가 `Inbox`, `Work`, `Team` 등 운영 surface에 동일하게 보인다.

## 10. 결론

`Batch C`는 “AI 팀이 더 똑똑해지는 배치”가 아니라:

- 돈을 어디서 태우는지
- 누가 어떤 권한으로 운영하는지
- 사람이 시스템에 어떤 명령을 넣는지

를 더 분명하게 만드는 배치다.

즉 core delivery loop 위에 **운영 guardrail layer**를 올리는 단계다.
