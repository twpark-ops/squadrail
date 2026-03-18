---
title: "UI Squad Stage Spec 2026"
author: "Taewoong Park (park.taewoong@airsmed.com)"
date: "2026-03-15"
---

# UI Squad Stage Spec 2026

상태: design review  
브랜치: `feat/ui-agent-presence-2026`  
워크트리: `/home/taewoong/company-project/squadall-ui-agent-presence-2026`

## Related Docs

- [office tileset plan](/home/taewoong/company-project/squadall-ui-agent-presence-2026/docs/ui-squad-stage-office-tileset-plan-2026.md)
- [implementation backlog](/home/taewoong/company-project/squadall-ui-agent-presence-2026/docs/ui-squad-stage-implementation-backlog-2026.md)
- [test scenarios](/home/taewoong/company-project/squadall-ui-agent-presence-2026/docs/ui-squad-stage-test-scenarios-2026.md)

## 1. 문제 정의

현재 `Team` 화면은 정보 밀도가 올라갔지만, 사용자가 기대한 `캐릭터가 실제로 살아서 움직이는 squad board`와는 다르다.

지금 UI는 다음에 가깝다.

- 카드 리스트
- 아바타 오라
- badge drift
- status pulse

하지만 원하는 것은 이쪽이다.

- 역할이 있는 캐릭터가 lane 위에 서 있다
- handoff가 실제 이동처럼 보인다
- idle / walking / implementing / reviewing / blocked 상태가 motion으로 구분된다
- 사용자는 `조직이 일하고 있다`는 느낌을 즉시 받는다

즉 현재 접근은 `animated roster`이고, 목표는 `squad stage`다.

## 2. 북극성

> Team의 메인 surface는 정적인 roster가 아니라, PM / TL / Engineer / Reviewer / QA가
> 실제 lane 위에서 baton을 주고받으며 일하는 stage여야 한다.
> 상세 카드와 표는 보조 surface로 내려가고, 메인 탭은 살아 있는 orchestration board가 된다.

## 3. 설계 결론

### 추천 방향

`Team` 페이지를 아래 3탭으로 재편한다.

1. `Stage`  
   기본 탭. 캐릭터가 실제로 움직이는 lane board.
2. `Roster`  
   지금 만든 job-card 기반 roster. 상세 staffing과 fallback surface.
3. `Coverage`  
   metrics, engine mix, project load, performance scorecard.

### 핵심 판단

- 메인은 `Stage`
- 현재 roster UI는 버리지 않고 `Roster` 탭으로 이동
- 기존 metrics/coverage는 `Coverage`로 묶음
- `IssueDetail`과 `Runs`는 stage vocabulary를 공유하지만, stage 자체는 `Team`의 메인 탭으로 둔다

## 4. 왜 Stage가 필요한가

사용자 요구를 운영 모델로 번역하면 다음과 같다.

| 요구 | 지금 UI | 필요한 표현 |
|---|---|---|
| 누가 일하고 있나 | 카드 status | lane 위 actor |
| 누가 막혔나 | badge | blocked pose + signal |
| handoff가 일어났나 | text trace | actor 이동 + baton transfer |
| reviewer/QA 차이 | label | 서로 다른 station과 motion |
| full workflow가 길다 | logs | stage 상의 위치 변화 |

결론적으로 stage는 장식이 아니라 **상태 기계의 시각화**다.

## 5. Surface 구조

## 5.1 Team page IA

대상 파일:

- [ui/src/pages/Team.tsx](/home/taewoong/company-project/squadall-ui-agent-presence-2026/ui/src/pages/Team.tsx)

새 구조:

```text
Team
 ├─ Header / squad summary
 ├─ Tabs
 │   ├─ Stage      (default)
 │   ├─ Roster
 │   └─ Coverage
 └─ Context rail
     ├─ active issue pulse
     ├─ lane legend
     └─ motion / reduced-motion toggle
```

## 5.2 Stage layout

무대는 세로 카드 리스트가 아니라 가로 lane board로 설계한다.

```text
PM / Board lane      -> intake podium
Tech Lead lane       -> routing desk
Engineer lane        -> build bench
Reviewer lane        -> review desk
QA lane              -> release gate
```

각 lane은 아래 요소를 가진다.

- `lane header`
- `station`
- `queue pocket`
- `active actor slot`
- `handoff edge`

## 5.3 Actor 종류

각 팀원은 `card`가 아니라 `actor token`으로 본다.

actor 구성:

- portrait or crest
- body silhouette
- role prop
  - PM: scroll / plan slate
  - TL: routing baton / map board
  - Engineer: wrench / terminal slab
  - Reviewer: diff lens / stamp
  - QA: shield / check console
- status ring
- name plate

## 6. 캐릭터 시각 언어

## 6.1 Art direction

`claw empire` 느낌을 가져오되 그대로 복제하지 않는다.

지향점:

- playful
- readable
- slightly game-like
- still operational

비지향점:

- chibi 과장
- 게임 HUD 과밀도
- 픽셀아트 강제
- 과한 판타지 장비

추천 아트 스타일:

1. `pixel sprite atlas + stage props`
   - 걷는 느낌 strongest
   - 실제 office stage와 가장 잘 맞음
   - local reference project 재사용 가능
2. `SVG puppet + layered crest`
   - theme 대응 쉬움
   - fallback / badge reuse에는 좋음
   - main stage의 walking 감은 약함

### 추천

`V1 = pixel sprite atlas`

이유:

- 사용자가 원한 건 `실제 캐릭터가 걷는 UI`다.
- local reference로 `pixel-agents`와 `claw-empire`가 이미 있다.
- `Team -> Stage`는 card UI보다 `office simulation` 쪽이 더 맞다.
- role silhouette는 sprite base + prop overlay로도 충분히 분리할 수 있다.

## 6.2 Role silhouettes

각 역할은 silhouette만 봐도 구분돼야 한다.

- PM: planner slate, amber trim
- TL: baton / routing strip, steel cyan
- Engineer: tool or terminal prop, electric blue
- Reviewer: lens / diff folder, violet
- QA: shield / seal console, emerald

## 6.3 Reference implementation direction

실제 V1 기준은 이쪽이다.

- character base: `pixel-agents` 스타일의 16x32 sprite actor
- office/station: 자체 제작 office tileset
- scene mood: `claw-empire`의 lane/stage 감을 참고

즉:

- 캐릭터 motion은 `pixel-agents`
- stage mood와 orchestration 표현은 `claw-empire`
- 실제 product tone과 protocol lane은 `squadall`

## 7. Motion 모델

## 7.1 Actor states

모든 actor는 아래 공통 상태를 가진다.

```ts
type StageActorMotion =
  | "idle"
  | "walking"
  | "working"
  | "reviewing"
  | "verifying"
  | "blocked"
  | "handoff"
  | "offline";
```

## 7.2 Motion semantics

| state | motion | 의미 |
|---|---|---|
| `idle` | subtle breathing | 대기 |
| `walking` | left-right gait + forward drift | lane 이동 |
| `working` | typing / tool swing loop | 구현 진행 |
| `reviewing` | inspect / stamp loop | diff review |
| `verifying` | shield pulse / console scan | QA gate |
| `blocked` | freeze + warning flicker | blocked |
| `handoff` | baton arc + turn motion | 책임 이전 |
| `offline` | dimmed silhouette | 비활성 |

## 7.3 Handoff 표현

가장 중요한 모션은 handoff다.

예:

- TL -> Engineer
- Engineer -> Reviewer
- Reviewer -> QA

표현 규칙:

- source actor가 baton glow를 띄움
- target lane 쪽으로 짧은 arc trail
- target actor가 receive flash
- stage rail에 handoff label 1.2s 노출

이건 단순 이동보다 중요하다.  
왜냐하면 사용자가 실제로 보고 싶은 건 `누가 맡았고 누구에게 넘겼는가`이기 때문이다.

## 8. 상태 기계와 데이터 매핑

## 8.1 기존 데이터 재사용

백엔드 변경 없이도 V1은 기존 read model로 충분히 그릴 수 있다.

필요한 입력:

- company agents
- active/live runs
- issue protocol state
- reviewer/qa assignment
- recent protocol message

## 8.2 Stage read model

UI 전용 read model을 만든다.

대상 파일:

- 새 파일 제안: `ui/src/lib/squad-stage.ts`

```ts
type SquadStageLane = "pm" | "lead" | "engineer" | "reviewer" | "qa";

interface SquadStageActor {
  agentId: string;
  name: string;
  role: string;
  title?: string | null;
  lane: SquadStageLane;
  motion: StageActorMotion;
  issueId?: string | null;
  issueIdentifier?: string | null;
  cue?: string | null;
  severity: "normal" | "warning" | "blocked";
  targetLane?: SquadStageLane | null;
}

interface SquadStageBoard {
  lanes: Array<{
    lane: SquadStageLane;
    label: string;
    actors: SquadStageActor[];
    activeIssueCount: number;
  }>;
  handoffs: Array<{
    from: SquadStageLane;
    to: SquadStageLane;
    label: string;
  }>;
}
```

## 8.3 Mapping rules

초기 규칙:

- live run `assignment` -> `lead` or `engineer` `handoff`
- live run `on_demand` -> `engineer` `working`
- trigger/detail includes `review` -> `reviewer` `reviewing`
- trigger/detail includes `qa` -> `qa` `verifying`
- protocol state `blocked` -> current owner `blocked`
- no fresh heartbeat -> `idle`

## 9. Main tab spec

## 9.1 Stage tab

목표:

- 가장 재밌고 직관적인 surface
- first-glance understanding

구성:

1. `Squad stage header`
   - current mode
   - active issues count
   - live lanes count
2. `Animated lane board`
3. `Current handoff ticker`
4. `Focused issue baton rail`

## 9.2 Roster tab

현재 구현한 roster/job-card surface를 유지한다.

목표:

- staffing
- fallback debugging
- role inventory

## 9.3 Coverage tab

현재 metrics/performance/load를 유지한다.

목표:

- 운영 메트릭
- adapter mix
- project load
- health score

## 10. 구현 전략

## Phase 1. Stage shell

범위:

- `Team`에 tabs 추가
- `Stage` 기본 탭
- static lane board
- actor token 정적 렌더

완료 기준:

- Stage가 메인 surface로 뜸
- Roster/Coverage는 보조 탭으로 이동

## Phase 2. Actor motion system

범위:

- idle / walking / working / reviewing / verifying / blocked
- CSS keyframe + minimal transform 기반
- reduced motion 대응

완료 기준:

- actor motion이 상태별로 다르게 보임
- walking/handoff가 실제로 구분됨

## Phase 3. Handoff animation

범위:

- baton arc
- receive flash
- lane transfer label
- current active issue highlight

완료 기준:

- TL -> Engineer -> Reviewer -> QA 흐름이 텍스트 없이도 읽힘

## Phase 4. Detail integration

범위:

- `IssueDetail` mini stage
- `Runs`와 lane vocabulary 공유
- `LiveRunWidget` phase pill과 stage motion 동기화

완료 기준:

- Team / Runs / IssueDetail가 같은 상태 언어를 씀

## 11. 기술 선택

### 옵션 A. CSS-only transforms

장점:

- 가볍다
- 번들 영향 작다
- 유지보수 쉽다

단점:

- 걷는 느낌이 제한적

### 옵션 B. Framer Motion + SVG actors

장점:

- handoff, path, stagger, spring 표현 좋음
- component화 쉬움

단점:

- bundle 증가
- 지나친 motion 위험

### 옵션 C. Canvas / Pixi

장점:

- 가장 게임 같다

단점:

- 과한 스택
- 접근성/SSR/테스트 비용 큼

### 추천

`B + A 혼합`

- actor body: SVG
- small ambient motion: CSS
- lane transition / handoff: Framer Motion

## 12. 성능 기준

**BOLD CAPS: MOTION이 LIVE DATA보다 먼저 실패하면 안 된다.**

기준:

- `Team` initial render 추가 비용 최소화
- animation은 offscreen일 때 pause 가능
- `prefers-reduced-motion` 강제 지원
- 60fps를 못 지키는 heavy effect 금지

금지:

- blur-heavy giant shadows
- continuous full-page gradients
- canvas particle spam

## 13. 테스트 전략

## 13.1 Deterministic fixture

`DesignGuide` 또는 dedicated stage fixture 추가:

- idle lane
- walking handoff
- blocked engineer
- reviewer active
- qa active

## 13.2 Playwright

고정할 것:

1. `Stage`가 `Team` 기본 탭인지
2. actor token이 lane별로 보이는지
3. blocked actor가 blocked visual을 갖는지
4. handoff animation class/attribute가 붙는지
5. reduced-motion에서 animation class가 빠지는지

## 13.3 Manual capture

항상 남길 캡처:

- Stage default
- walking handoff
- blocked state
- review gate
- QA gate

## 14. 비목표

- 실제 game engine 도입
- drag-and-drop squad movement
- 3D scene
- sound effect
- procedural avatar generation API

## 15. 리스크

| 리스크 | 설명 | 완화 |
|---|---|---|
| 과한 장식화 | 운영 UI보다 게임처럼 보일 수 있음 | stage 아래에 roster/coverage 유지 |
| motion 과밀 | 장시간 사용 시 피로 | lane active actor 위주로만 강한 motion |
| 번들 증가 | SVG + motion lib 영향 | actor asset 재사용, lazy load |
| 상태 불일치 | stage와 detail이 다른 말 사용 | `squad-stage.ts` 공용 mapper 사용 |
| reduced motion 미흡 | 접근성 문제 | media query + toggle 둘 다 지원 |

## 16. 성공 기준

1. 사용자가 `Team`을 열면 Stage가 먼저 보인다
2. 적어도 한 명의 actor가 실제로 `걷는` 것으로 인식된다
3. handoff가 텍스트 없이도 이해된다
4. reviewer와 QA가 서로 다른 station과 motion을 갖는다
5. roster는 보조 surface로 남아 staffing 가독성을 유지한다
6. deterministic fixture + Playwright로 stage 상태를 고정한다

## 17. 바로 다음 작업 추천

1. `Phase 1 Stage shell`
2. `Phase 2 Actor motion system`
3. `Phase 3 Handoff animation`

한 줄로 정리하면, 이번 재설계의 핵심은 **카드 리스트를 더 예쁘게 만드는 게 아니라, Team의 메인 surface를 실제로 살아 움직이는 squad stage로 교체하는 것**이다.
