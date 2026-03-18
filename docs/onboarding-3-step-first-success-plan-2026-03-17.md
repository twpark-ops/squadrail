---
title: "Onboarding 3-Step First Success Plan"
author: "Taewoong Park (park.taewoong@airsmed.com)"
date: "2026-03-17"
---

# Onboarding 3-Step First Success Plan

상태: design draft  
범위: 현재 `Squadrail` 코드 기준 온보딩 UX 단순화 설계  
관련 코드:

- [ui/src/components/OnboardingWizard.tsx](../ui/src/components/OnboardingWizard.tsx)
- [ui/src/components/Layout.tsx](../ui/src/components/Layout.tsx)
- [ui/src/pages/IssueDetail.tsx](../ui/src/pages/IssueDetail.tsx)
- [ui/src/components/IssuesList.tsx](../ui/src/components/IssuesList.tsx)

## 1. 목표

현재 5단계 온보딩을 사용자 표면에서는 **3단계처럼 느껴지게** 줄이고, 첫 quick request 이후의 첫 성공 경험까지 더 강하게 안내한다.

핵심 목표는 다음 세 가지다.

1. technical setup를 덜 보이게 한다.
2. 사용자가 “무엇을 만들고 싶은지”에 더 빨리 도달하게 한다.
3. 첫 요청 제출 후 “이제 무엇을 기다리면 되는지”를 명확히 보여준다.

## 2. 현재 상태 (AS-IS)

현재 온보딩은 `Step 0..4` 총 5단계다.

1. `Profile interview`
2. `Company name + goal`
3. `Team blueprint preview/apply`
4. `Execution engine + primary workspace + probe`
5. `First quick request`

참고:

- step 정의: [ui/src/components/OnboardingWizard.tsx](../ui/src/components/OnboardingWizard.tsx#L69)
- profile recommendation: [ui/src/components/OnboardingWizard.tsx](../ui/src/components/OnboardingWizard.tsx#L228)
- blueprint step: [ui/src/components/OnboardingWizard.tsx](../ui/src/components/OnboardingWizard.tsx#L1319)
- workspace / engine step: [ui/src/components/OnboardingWizard.tsx](../ui/src/components/OnboardingWizard.tsx#L1763)
- quick request step: [ui/src/components/OnboardingWizard.tsx](../ui/src/components/OnboardingWizard.tsx#L2048)

첫 요청 제출 후에는 다음 표면이 이미 있다.

- setup checklist: [ui/src/components/Layout.tsx](../ui/src/components/Layout.tsx#L354)
- onboarding issue welcome banner: [ui/src/pages/IssueDetail.tsx](../ui/src/pages/IssueDetail.tsx#L2134)

즉 기능은 이미 많이 들어와 있다.  
문제는 **사용자 표면이 아직 setup-heavy** 하다는 점이다.

## 3. 현재 문제

### 3.1 step 수가 많고 용어가 기술적이다

현재는 다음 용어가 전면에 나온다.

- blueprint
- engine
- workspace
- probe

개발자에게는 익숙하지만, 첫 진입 사용자에게는 “무엇을 만들고 싶은지”보다 “무엇을 설정해야 하는지”가 먼저 보인다.

### 3.2 workspace 연결이 가장 어렵다

현재 Step 3은 실제로 가장 중요한 단계지만, 동시에 가장 복잡하다.

- 프로젝트 선택
- existing/new workspace 선택
- cwd 입력
- repo URL 입력
- doctor probe 실행

이 단계는 현재 가장 많은 인지 부하를 만든다.

### 3.3 첫 quick request가 너무 blank canvas다

현재도 추천 요청 힌트는 있지만([ui/src/components/OnboardingWizard.tsx](../ui/src/components/OnboardingWizard.tsx#L1496)), 사용자는 여전히 무엇을 첫 요청으로 써야 할지 망설일 수 있다.

### 3.4 first-success guidance가 산재돼 있다

첫 요청 이후 안내는 이미 존재하지만:

- setup checklist
- issue detail welcome banner
- issues empty state

로 나뉘어 있어서 한 번에 읽히는 경험은 아직 약하다.

## 4. 목표 모델 (TO-BE)

표면상 온보딩은 아래 3단계만 보여준다.

### Step 1. Tell us what you are building

현재 `Profile interview + Company name/goal + blueprint recommendation`을 하나의 스텝으로 묶는다.

사용자가 결정하는 것:

- use case
- deployment mode
- autonomy mode
- runtime preference
- company name
- short goal

시스템이 자동으로 정하는 것:

- recommended blueprint
- recommended wording
- recommended starter request

### Step 2. Connect your repo

현재 `engine/workspace/probe`를 하나의 단계로 보이게 한다.

사용자 표면에서는:

- project/workspace 자동 감지
- 추천 경로 prefill
- primary workspace 자동 생성 제안
- probe는 “연결 확인” 1개 버튼

만 보인다.

advanced 설정은 접을 수 있어야 한다.

### Step 3. Launch your first request

현재 quick request step을 더 구체화한다.

표면 요소:

- starter prompt 카드 3~4개
- 제목/본문 자동 채움
- priority는 기본값만 두고 고급 옵션으로 숨김
- 제출 후 즉시 onboarding issue detail로 이동

## 5. 설계 결정

### 5.1 내부 step은 유지하고, visible step만 3개로 줄인다

현재 구현은 이미 많고 안정적이다.  
따라서 내부 로직을 크게 흔들지 않고:

- `0 + 1 + 2`를 visible step 1
- `3`을 visible step 2
- `4`를 visible step 3

로 묶는 것이 V1에서 가장 안전하다.

### 5.2 추천값 자동 채움이 기본이고, 수동 override는 접어서 제공한다

`computeOnboardingRecommendations()`는 이미 존재한다.  
이를 더 적극적으로 써서 기본 경로는 다음처럼 만든다.

- recommended blueprint preselected
- recommended runtime preselected
- recommended first request prefilled

수동 제어는 “Advanced setup” 안으로 내린다.

### 5.3 첫 성공은 issue 단위로 추적한다

첫 요청 후 first-success는 새 전용 상태를 만들기보다 현재 구현을 유지한다.

- `setupProgress.steps.firstIssueReady`
- `setupProgress.metadata.onboardingIssueId`
- company-wide first closed root issue count

이 세 가지를 기준으로 안내를 보여준다.

## 6. 상세 UX

## 6.1 Step 1 — Team shape card

좌측:

- short interview cards
- company name / goal

우측:

- recommended blueprint
- why this blueprint
- expected team shape (`PM / TL / Engineer / Reviewer / QA`)
- starter quick request examples

버튼:

- `Use recommended path`
- `Customize manually`

## 6.2 Step 2 — Repo connect card

기본 표면:

- detected project/repo
- current path
- engine selector
- `Run environment check`

숨김 표면:

- manual project selection
- create workspace fields
- repo URL override

프로브 결과는 현재처럼 raw diagnostic dump가 아니라:

- `Ready`
- `Needs attention`
- `Blocked`

3단 요약 + 펼치기 detail로 보여준다.

## 6.3 Step 3 — Starter request card

기본 starter:

- `Fix a bug in the current project`
- `Ship a small feature`
- `Improve setup / tooling`
- `Write a delivery plan`

선택 시:

- title auto-fill
- body scaffold auto-fill

예:

```md
We need a small first delivery task for this workspace.

Goal:
- ...

Constraints:
- ...

Expected output:
- ...
```

## 6.4 Post-submit first-success surface

첫 quick request를 제출하면:

1. 해당 issue detail로 이동
2. onboarding welcome banner 노출
3. layout checklist가 계속 보임
4. clarification이 오면 Inbox로 유도

이 흐름은 현재 기반이 있으므로, 문구와 노출 우선순위를 더 강화하는 정도로 간다.

## 7. 구현 순서

### O1. Visible 3-step shell

목표:

- step indicator를 3단으로 바꿈
- 내부 step state는 그대로 유지
- current recommendation summary를 한 화면에 모음

영향 파일:

- [ui/src/components/OnboardingWizard.tsx](../ui/src/components/OnboardingWizard.tsx)

### O2. Workspace autopilot

목표:

- current repo/project/workspace 자동 선택
- advanced override 접기
- probe result 요약 카드

영향 파일:

- [ui/src/components/OnboardingWizard.tsx](../ui/src/components/OnboardingWizard.tsx)
- [ui/src/pages/CompanySettings.tsx](../ui/src/pages/CompanySettings.tsx)

### O3. Starter quick request + first-success copy

목표:

- starter prompt cards
- quick request prefill
- first-success 안내 문구 강화

영향 파일:

- [ui/src/components/OnboardingWizard.tsx](../ui/src/components/OnboardingWizard.tsx)
- [ui/src/pages/IssueDetail.tsx](../ui/src/pages/IssueDetail.tsx)
- [ui/src/components/Layout.tsx](../ui/src/components/Layout.tsx)
- [ui/src/components/IssuesList.tsx](../ui/src/components/IssuesList.tsx)

## 8. 테스트 시나리오

### 8.1 Browser happy path

1. 신규 회사 진입
2. visible step count가 3인지 확인
3. recommended blueprint가 preselected인지 확인
4. repo connect 후 probe 실행
5. starter request 선택
6. issue detail landing + welcome banner 확인
7. layout checklist에 `First quick request submitted` 반영 확인

### 8.2 Manual override path

1. 추천값 대신 custom blueprint 선택
2. workspace를 새로 생성
3. probe 성공
4. quick request 제출

### 8.3 Clarification path

1. onboarding issue에서 PM이 clarification 요청
2. issue detail banner가 clarification 상태로 전환
3. Inbox unread badge와 queue 확인

## 9. 리스크

| 리스크 | 설명 | 대응 |
|---|---|---|
| auto-detect 오판 | 잘못된 project/workspace를 추천할 수 있음 | advanced override 유지 |
| step 축소로 정보 누락 | 고급 사용자가 필요한 설정을 못 볼 수 있음 | expand/collapse 제공 |
| starter prompts가 너무 generic | 실제 회사/도메인에 안 맞을 수 있음 | blueprint별 추천 문구 연결 |

## 10. 권장 결론

온보딩은 새 기능을 더 넣기보다:

1. visible steps를 줄이고
2. 추천값을 더 자동으로 채우고
3. 첫 요청 이후 안내를 더 강하게 연결하는 것

이 가장 효과가 크다.
