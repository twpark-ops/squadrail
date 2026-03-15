---
title: "UI Squad Stage Implementation Backlog 2026"
author: "Taewoong Park <park.taewoong@airsmed.com>"
date: "2026-03-15"
---

# UI Squad Stage Implementation Backlog 2026

상태: planning  
브랜치: `feat/ui-agent-presence-2026`

## 1. Backlog 원칙

- 한 phase는 실제로 리뷰 가능한 화면까지 만든다.
- `Team -> Stage`가 먼저고, 나머지 surface는 뒤따라 맞춘다.
- asset 문제와 UI 문제를 섞지 않는다.

## 2. Phase 1. Actor Foundation

### 목표

`pixel-agents` 스타일 actor를 Squadall stage에서 움직일 수 있게 만든다.

### 작업

1. `squad-stage` 폴더 구조 추가
- `ui/src/components/squad-stage/`
- `ui/src/lib/squad-stage/`
- `ui/src/components/squad-stage/assets/`

2. sprite adapter 정의
- `16x32` actor frame model
- direction/state/frame indexing
- role tint / prop overlay model

3. actor component 작성
- `SquadStageActor`
- `StageActorShadow`
- `StageActorBadge`

4. state mapping 작성
- issue/run/protocol state -> `idle / walking / working / reviewing / verifying / blocked`

### 영향 파일

- `ui/src/components/squad-stage/*`
- `ui/src/lib/squad-stage/*`
- [`ui/src/index.css`](/home/taewoong/company-project/squadall-ui-agent-presence-2026/ui/src/index.css)

### 종료 조건

- actor 하나를 mock lane 위에 배치하고
- state에 따라 frame/pose가 바뀐다

## 3. Phase 2. Office Tileset V1

### 목표

stage background를 `빈 lane`이 아니라 `실제 station`으로 만든다.

### 작업

1. floor primitives
- neutral floor
- accent floor
- shadow patch

2. wall primitives
- straight
- corner
- divider

3. station primitives
- PM podium
- TL routing desk
- engineer bench
- review desk
- QA gate

4. common props
- chair
- terminal
- queue marker
- signal pillar

### 영향 파일

- `ui/src/components/squad-stage/assets/*`
- `ui/src/components/squad-stage/stations/*`

### 종료 조건

- actor 없이도 각 lane이 무엇인지 읽힌다

## 4. Phase 3. Stage Shell

### 목표

`Team` 메인 탭을 실제 stage board로 교체한다.

### 작업

1. tab 구조 변경
- Stage default
- Roster
- Coverage

2. stage board skeleton
- lane header
- station block
- queue pocket
- active slot

3. stage read model
- role -> lane assignment
- active issue pulse
- blocked/review/qa signal

### 영향 파일

- [`ui/src/pages/Team.tsx`](/home/taewoong/company-project/squadall-ui-agent-presence-2026/ui/src/pages/Team.tsx)
- `ui/src/components/squad-stage/SquadStageBoard.tsx`
- `ui/src/lib/squad-stage/stage-model.ts`

### 종료 조건

- Team 기본 탭에서 stage가 실제로 열린다

## 5. Phase 4. Motion & Handoff

### 목표

stage를 정적 배치가 아니라 `일하고 있는 팀`처럼 보이게 만든다.

### 작업

1. walking motion
- lane movement
- seat approach

2. working motion
- typing
- reviewing
- verifying

3. blocked state
- freeze
- warning flicker
- blocked beacon

4. handoff
- baton arc
- receive flash
- target lane highlight

### 영향 파일

- `ui/src/components/squad-stage/animation/*`
- `ui/src/index.css`

### 종료 조건

- TL -> Engineer handoff 1개가 실제로 읽힌다

## 6. Phase 5. Surface Parity

### 목표

Stage, Runs, Issue Detail이 같은 phase language를 쓰게 만든다.

### 작업

1. vocabulary harmonization
- protocol gate
- implementation
- review
- QA
- blocked

2. party strip parity
- IssueDetail wait reason
- active owner
- lane context

3. run parity
- Runs page chip / severity / copy 통일

### 영향 파일

- [`ui/src/pages/Runs.tsx`](/home/taewoong/company-project/squadall-ui-agent-presence-2026/ui/src/pages/Runs.tsx)
- [`ui/src/pages/IssueDetail.tsx`](/home/taewoong/company-project/squadall-ui-agent-presence-2026/ui/src/pages/IssueDetail.tsx)
- [`ui/src/components/LiveRunWidget.tsx`](/home/taewoong/company-project/squadall-ui-agent-presence-2026/ui/src/components/LiveRunWidget.tsx)

### 종료 조건

- 같은 상태가 Stage / Runs / Issue Detail에서 같은 말로 보인다

## 7. 권장 커밋 슬라이스

1. `feat(ui): scaffold squad stage actor system`
2. `feat(ui): add squad stage office tileset v1`
3. `feat(ui): introduce team stage shell`
4. `feat(ui): animate squad handoff lanes`
5. `feat(ui): align stage run issue vocabulary`

## 8. 비고

이 backlog는 순서가 중요하다.

- actor 먼저
- office second
- stage shell third
- motion fourth
- parity last

이 순서를 바꾸면 디버깅 비용이 커진다.
