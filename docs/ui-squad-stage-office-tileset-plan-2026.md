---
title: "UI Squad Stage Office Tileset Plan 2026"
author: "Taewoong Park <park.taewoong@airsmed.com>"
date: "2026-03-15"
---

# UI Squad Stage Office Tileset Plan 2026

상태: design review  
브랜치: `feat/ui-agent-presence-2026`  
워크트리: `/home/taewoong/company-project/squadall-ui-agent-presence-2026`

## 1. 결론

`office tileset`은 직접 만들 수 있다.  
그리고 지금 기준으로는 **직접 만드는 쪽이 더 맞다.**

이유는 세 가지다.

1. `pixel-agents`는 캐릭터 애니메이션과 상태 머신이 이미 좋아서, 부족한 건 오피스 환경 쪽이다.
2. 유료 타일셋을 얹으면 라이선스와 배포 경계가 다시 복잡해진다.
3. 우리 제품은 일반 사무실이 아니라 `PM / TL / Engineer / Reviewer / QA`가 일하는 **operational stage**가 필요해서, 범용 office pack보다 우리용 타일이 더 잘 맞는다.

## 2. 확인된 기준 규격

`pixel-agents` 기준:

- tile size: `16x16`
- character frame: `16x32`
- furniture footprint:
  - desk `2x2`
  - bookshelf `1x2`
  - whiteboard `2x1`
  - chair / pc / lamp / plant `1x1`

관련 기준 파일:

- [pixel-agents webview constants](/home/taewoong/company-project/pixel-agents/webview-ui/src/constants.ts)
- [pixel-agents furniture catalog](/home/taewoong/company-project/pixel-agents/webview-ui/src/office/layout/furnitureCatalog.ts)
- [pixel-agents sprite data](/home/taewoong/company-project/pixel-agents/webview-ui/src/office/sprites/spriteData.ts)

즉 `Stage` V1은 **16x16 base tile + 16x32 actor** 기준으로 맞추는 게 가장 안전하다.

## 3. 아키텍처 결정

### 3.1 무엇을 직접 만들 것인가

직접 만들 대상:

- floor tile set
- wall pieces
- desk family
- review desk family
- QA gate family
- planning podium family
- support props

재사용 가능한 것:

- `pixel-agents`의 캐릭터 표현 방식
- 일부 hand-drawn furniture 표현 아이디어

### 3.2 무엇을 직접 만들지 않을 것인가

이번 V1에서는 아래는 하지 않는다.

- giant office editor
- 수십 종 furniture catalog
- decorative clutter pack
- fully modular auto-tile wall system beyond minimum variants

## 4. V1 Tileset 범위

### 4.1 Core floor/wall

필수:

- `floor_base`
- `floor_alt`
- `shadow_patch`
- `wall_straight_top`
- `wall_straight_left`
- `wall_corner_inner`
- `wall_corner_outer`
- `divider_glass`

### 4.2 Workstations

필수:

- `pm_podium`
- `tl_routing_desk`
- `engineer_bench`
- `review_desk`
- `qa_gate_console`

각 station은 최소한 아래 state를 가져야 한다.

- idle
- active glow
- blocked glow

### 4.3 Common props

필수:

- `chair`
- `terminal`
- `monitor`
- `stacked_docs`
- `signal_lamp`
- `status_pillar`
- `queue_marker`

### 4.4 Handoff / lane props

필수:

- `baton_line`
- `receive_flash`
- `blocked_beacon`
- `qa_seal`
- `review_stamp`

## 5. 시각 방향

### 5.1 톤

원하는 톤:

- playful but operational
- modern office but not corporate boring
- readable at small size
- game-like without becoming a game HUD

### 5.2 색 체계

lane 기준 accent:

- PM: amber
- TL: cyan steel
- Engineer: electric blue
- Reviewer: magenta-violet
- QA: emerald

neutral:

- graphite
- slate
- soft paper
- warm desk wood or dark composite

### 5.3 스타일

V1은 `pixel-art inspired`, 하지만 완전 복잡한 손그림보다 **clean chunk-based pixel style**로 간다.

즉:

- 16x16에서 읽히는 큰 실루엣
- 2~3단 하이라이트
- 색 수 제한
- 과한 디테일 금지

## 6. 구현 전략

### 옵션 A. PNG sprite sheet 직접 제작

장점:

- canvas/canvas-like rendering에 즉시 적합
- 실제 걷는 캐릭터와 가장 잘 맞음

단점:

- 수정 비용이 큼
- palette 변경이 불편

### 옵션 B. code-defined sprite matrix

장점:

- 버전 관리가 쉬움
- palette와 변형이 쉬움
- 현재 `pixel-agents`의 furniture 방식과 동일

단점:

- 초기에 손이 많이 감
- 큰 자산은 가독성이 떨어질 수 있음

### 추천

V1은 `hybrid`로 간다.

- furniture / signals / props = code-defined matrix
- floor / wall variation = small PNG atlas 또는 code-defined matrix

이유:

- 자주 바뀌는 desk/gate는 코드형이 낫다
- 반복 패턴 바닥은 atlas가 편하다

## 7. 단계별 제작 계획

### Phase 1. Minimal office foundation

범위:

- floor 2종
- wall 4종
- PM/TL/Engineer/Reviewer/QA station 5종
- chair / terminal / signal props

완료 기준:

- `Stage`에 5개 lane을 빈 사무실이 아니라 실제 워크스테이션으로 배치 가능

### Phase 2. Active state overlays

범위:

- active glow
- blocked glow
- queue markers
- handoff line

완료 기준:

- actor motion 없이도 station state가 읽힘

### Phase 3. Detail and richness

범위:

- bookshelf / plant / divider / meeting corner
- optional crowd/background props

완료 기준:

- `Stage`가 프로토타입이 아니라 제품 화면처럼 보임

## 8. 추천 다음 작업

바로 다음 구현 순서는 이렇다.

1. `pixel-agents` 캐릭터 시트를 UI worktree에 vendor-safe하게 가져온다
2. `office-v1 sprite primitives`를 새 `squad-stage/assets`에 만든다
3. `Stage shell`에 lane station 배경으로 먼저 붙인다
4. actor를 그 위에 올린다

## 9. 최종 판단

유료 office pack을 사서 붙이는 것도 가능하지만, 지금 목표엔 꼭 필요하지 않다.

현재 가장 맞는 전략은:

- character motion은 `pixel-agents` 계열 레퍼런스 활용
- office environment는 **우리 제품에 맞게 직접 제작**

한 줄 결론:

**네, 직접 만들 수 있고, 지금은 그게 더 맞다.**
