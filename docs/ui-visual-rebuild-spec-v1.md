# UI Visual Rebuild Spec v1

작성일: 2026-03-10

## 1. 목적

현재 UI는 정보 구조는 새로 정리되었지만, 시각언어는 여전히 기존 Paperclip 콘솔의 흔적을 많이 갖고 있다.

- 좌측 상단 브랜드/마크가 제품 정체성을 설명하지 못함
- lime/cyan 중심 색 체계가 `운영 콘솔` 느낌은 주지만 `개발 조직 워크스페이스` 느낌은 약함
- 카드, 배지, 사이드바, 헤더가 모두 같은 무게로 보여 판단 흐름이 약함
- `Overview / Work / Changes / Runs / Knowledge`가 다른 목적을 갖는데도 시각 규칙이 거의 동일함

이 문서의 목표는 정보 구조 위에 얹을 새 시각언어를 고정하는 것이다.

## 2. 제품 톤 재정의

새 제품은 `AI 회사 관리 콘솔`이 아니라 아래처럼 보여야 한다.

> 설계, 구현, 리뷰, 복구, 반영을 한 화면 체계 안에서 운영하는 반자율 개발 조직 워크스페이스

핵심 인상:

- 차갑고 과장된 해커 UI보다 `정밀한 운영 스튜디오`
- flashy dashboard보다 `판단 가능한 evidence workspace`
- 엔티티 관리보다 `delivery flow`

## 3. 시각 방향

### 방향 이름

`Editorial Operations Studio`

### 키워드

- editorial
- technical
- crisp
- operational
- grounded

### 버려야 하는 것

- neon lime/cyan에 과도하게 기대는 색 체계
- 작은 badge와 숫자를 과도하게 나열하는 콘솔 느낌
- 0px radius 기반의 딱딱한 box grid
- 회사/에이전트 아이콘만 전면에 나오는 shell

## 4. 디자인 시스템 원칙

1. 큰 제목보다 `판단 단위`가 먼저 보이게 한다.
2. 색은 장식이 아니라 `상태/위험/행동`을 구분하기 위해 사용한다.
3. 카드 수를 줄이고, 중요한 면은 `panel`, 덜 중요한 면은 `row`로 설계한다.
4. 사이드바는 엔티티 인덱스가 아니라 `업무 모드 전환기`처럼 보여야 한다.
5. `Changes`와 `Knowledge`는 둘 다 evidence를 보여주지만, 하나는 code diff, 다른 하나는 retrieval evidence라는 차이를 시각적으로 분명히 구분해야 한다.

## 5. 타이포그래피

### 권장 조합

- Heading: `Space Grotesk`
- UI / Body: `Pretendard Variable`
- Code: `IBM Plex Mono`

이유:

- Heading은 제품 아이덴티티와 기술 제품의 결을 동시에 준다.
- Body는 한글 가독성과 운영 UI 밀도에 유리하다.
- Code는 diff, path, branch, artifact에서 읽기 좋다.

## 6. 색 체계

### 기본 방향

- light-first
- neutral base + restrained signal colors
- dark mode는 지원하되 기준 화면은 light mode

### Core Tokens

- `canvas`: bone white
- `panel`: warm white
- `ink`: deep charcoal
- `muted`: cool gray
- `line`: smoke gray
- `accent`: steel blue
- `success`: moss green
- `warning`: amber clay
- `danger`: brick red
- `focus`: electric blue

### 상태 색 적용 규칙

- `running / active`: accent
- `review / awaiting`: amber
- `blocked / failed`: brick
- `approved / healthy`: moss
- `archived / deprecated / stale`: neutral gray

### 주의

현재 [index.css](/home/taewoong/company-project/squadall/ui/src/index.css)의 lime/cyan 중심 토큰은 교체 대상이다.

## 7. Shell 재설계

### 7.1 Company Rail

현재 Company Rail은 작은 패턴 아이콘 중심이다. 다음처럼 바꾼다.

- 회사 패턴 아이콘은 유지하되 더 작은 상태 인디케이터로 축소
- 선택된 회사는 브랜드 색 기반 vertical rail로 강조
- hover tooltip에는 회사 이름 + prefix + health hint 노출

### 7.2 Left Navigation

현재 사이드바는 old console의 압축된 버튼 목록 느낌이 강하다. 다음처럼 바꾼다.

- 상단에 제품 로고타입 + 현재 company context
- 중앙에 primary mode navigation
- 하단에 secondary tools와 settings
- `New Issue`는 list 내부 버튼이 아니라 고정된 primary CTA

### 7.3 Top Bar

- breadcrumb보다 `현재 판단 컨텍스트`를 더 크게 보여준다
- command palette trigger를 명시 버튼으로 승격
- live run / recovery indicator를 top bar에 요약 배치

## 8. 핵심 화면 패턴

### 8.1 Overview

패턴:

- `today strip`
- `blocked/review/merge pending` tri-panel
- `runtime health` band
- `recent critical movement` timeline

의미:

- 숫자 카드 그리드보다 상황판이어야 한다.

### 8.2 Work

패턴:

- 좌측: saved lanes / filters
- 중앙: work list
- 우측: selected issue quick insight

핵심:

- list는 엔티티 테이블이 아니라 `delivery queue`

### 8.3 Changes

패턴:

- 상단: merge readiness + verification
- 본문: changed files / diff summary
- 우측: branch, workspace, test/build, approval

핵심:

- operator가 `이 변경을 반영할 수 있는가`를 바로 판단

### 8.4 Runs

패턴:

- live runs ribbon
- recovery queue panel
- recent failures table
- checkpoint/event timeline

핵심:

- 개발자용 console이 아니라 운영자용 runtime board

### 8.5 Knowledge

패턴:

- 상단: retrieval health / document volume / embedding status
- 본문 좌측: filters + source breakdown
- 본문 우측: document/evidence explorer

핵심:

- 단순 문서 브라우저가 아니라 `RAG evidence browser`

### 8.6 Team

패턴:

- role coverage cards
- squad lanes
- project ownership grid
- escalation chain

핵심:

- agent 목록보다 `역할과 책임`이 먼저 보여야 한다.

## 9. 우선 구현 순서

1. global tokens / typography / radius / spacing 재정의
2. company rail + sidebar + top shell 재설계
3. Overview visual rebuild
4. Work / Changes / Knowledge 핵심 패턴 적용
5. Runs / Team 확장

## 10. 완료 기준

- 첫 화면에서 더 이상 Paperclip 계열 제품처럼 보이지 않는다.
- 사용자가 `어디서 무엇을 봐야 하는지`를 시각적으로 바로 이해한다.
- Knowledge, Changes, Runs의 성격 차이가 시각적으로 분명하다.
- shell만 봐도 `운영 콘솔`이 아니라 `개발 조직 워크스페이스`라는 인상이 난다.
