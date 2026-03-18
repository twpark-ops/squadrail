---
title: "UI Agent Presence and Run Detail Plan 2026"
author: "Taewoong Park (park.taewoong@airsmed.com)"
date: "2026-03-15"
---

# UI Agent Presence and Run Detail Plan 2026

상태: design ready  
브랜치: `feat/ui-agent-presence-2026`  
워크트리: `/home/taewoong/company-project/squadall-ui-agent-presence-2026`

## 1. 목적

현재 UI는 정보는 많지만, 실제 운영자가 가장 먼저 보고 싶은 것보다 진단용 상세 정보가 앞에 나온다.

대표적인 문제:

- `AgentDetail > Run detail`에서 `Prompt`, `Context`, `Environment`가 transcript보다 먼저 길게 렌더링된다.
- `Team`과 `ActiveAgentsPanel`은 에이전트가 "조직 안에서 무슨 직업으로 무엇을 하고 있는지"보다 단순 목록이나 최근 로그 요약에 가깝다.
- 이슈 카드 리스트는 현재 상태는 보이지만, 진행 단계와 책임 체인이 충분히 한눈에 드러나지 않는다.

이 작업의 목표는 다음 두 가지를 동시에 만족시키는 것이다.

1. 운영자가 첫 3초 안에 "누가 무엇을 하고 있고 어디가 막혔는지"를 파악한다.
2. 상세 진단 정보는 유지하되, transcript와 실제 대화/행동 흐름이 먼저 보이게 재배치한다.

## 2. 북극성

> Squadrail UI는 에이전트 목록이 아니라, 역할이 있는 팀이 실제로 일하는 파티/스쿼드처럼 보여야 한다.
> Run detail은 디버그 패널이 아니라, 먼저 대화와 행동 흐름을 보여주고 필요할 때만 prompt/env를 열어보는 구조여야 한다.

## 3. 범위

### 포함

- `Team` 화면 카드 밀도 증가
- `ActiveAgentsPanel`의 에이전트 presence / 직업화
- `Issue` 카드 리스트 정보 구조 강화
- `IssueDetail` 상단 party strip 설계
- `AgentDetail > RunDetail` transcript-first 재배치
- run diagnostics(`Prompt`, `Context`, `Environment`) 기본 접힘 처리

### 제외

- backend contract 변경
- 새로운 run/event API 추가
- product-model simplification worktree와 충돌하는 parent/subtask semantics 변경
- RAG retrieval UI 변경

## 4. 현재 구조 진단

### 4.1 Run detail

대상 파일:

- [ui/src/pages/AgentDetail.tsx](/home/taewoong/company-project/squadall/ui/src/pages/AgentDetail.tsx)

현재 문제:

- `Invocation` 패널이 transcript보다 위에 있다.
- `Prompt`, `Context`, `Environment`가 기본 펼침 상태다.
- 운영자가 실제로 보고 싶은 `assistant/tool/system` 흐름보다 디버그 payload가 먼저 보인다.
- `Events`도 하단에 별도 원문 스트림으로 다시 나와 중복감이 있다.

결론:

- 기본 모드는 `Transcript-first`
- 진단 정보는 `Diagnostics drawer` 또는 `collapsed accordions`
- `Events`는 기본 표시가 아니라 `advanced trace`로 내려야 한다.

### 4.2 Team / Active Agents

대상 파일:

- [ui/src/pages/Team.tsx](/home/taewoong/company-project/squadall/ui/src/pages/Team.tsx)
- [ui/src/components/ActiveAgentsPanel.tsx](/home/taewoong/company-project/squadall/ui/src/components/ActiveAgentsPanel.tsx)
- [ui/src/components/AgentCardEnhanced.tsx](/home/taewoong/company-project/squadall/ui/src/components/AgentCardEnhanced.tsx)

현재 문제:

- agent가 "사람/직업"이 아니라 "런타임 엔티티"처럼 보인다.
- active panel은 최근 신호는 좋지만, 역할/상태/책임 범위가 약하다.
- Team은 lane 정보는 있으나 실제 squad feeling이 부족하다.

결론:

- role별 visual language를 올린다.
- `PM / Tech Lead / Engineer / Reviewer / QA`를 직업 카드처럼 구분한다.
- 단, 게임 UI를 그대로 복제하는 게 아니라 "operational party board" 톤으로 간다.

### 4.3 Issue cards

대상 파일:

- [ui/src/components/IssuesList.tsx](/home/taewoong/company-project/squadall/ui/src/components/IssuesList.tsx)

현재 문제:

- 상태/우선순위 중심은 있으나, 실제 작업 문맥이 약하다.
- `누가 잡고 있는지`, `어느 단계인지`, `review/QA/blocked`가 한눈에 약하다.

결론:

- 카드/row 모두 `delivery status strip`을 가져야 한다.
- 최소 정보 단위는 아래를 만족해야 한다.
  - 식별자와 제목
  - 현재 단계
  - 현재 책임 역할
  - blocked/review/QA 신호
  - live run 여부

## 5. UX 방향

### 5.1 Agent Persona Layer

목표:

- 각 agent를 `job card`처럼 보여준다.

핵심 요소:

- role crest 또는 portrait
- role color system
- adapter type보다 `job identity` 우선
- 상태 배지:
  - `Idle`
  - `Implementing`
  - `Reviewing`
  - `Waiting`
  - `Blocked`

원칙:

- 과한 게임풍 캐릭터 일러스트는 피한다.
- 대신 `class card`, `squad roster`, `crew board` 쪽으로 간다.

### 5.2 Transcript-First Run Detail

목표:

- 실제 채팅/행동 흐름을 가장 먼저 읽게 한다.

새 정보 계층:

1. run summary
2. phase strip
3. transcript
4. failure/recovery note
5. diagnostics (`Prompt`, `Context`, `Environment`, `Events`)

핵심 변화:

- `Invocation`은 접힌 상태가 기본
- `Prompt`, `Context`, `Environment`는 각각 별도 접힘 블록
- 긴 JSON/env는 `summary + expand` 구조
- transcript에는 `assistant/tool/system/stderr`만 우선적으로 보이게 정돈

### 5.3 Richer Issue Cards

목표:

- "이 카드가 지금 어디까지 왔는지"를 카드 레벨에서 바로 읽게 한다.

추가 요소:

- 현재 phase chip
- owner role chip
- `review pending`, `QA pending`, `blocked` signal badge
- live activity pulse
- 최근 protocol action 요약

### 5.4 Issue Party Strip

목표:

- IssueDetail 상단에서 책임 체인을 바로 보여준다.

구성:

- PM
- TL
- Engineer
- Reviewer
- QA

각 슬롯 정보:

- 이름 / title
- current status
- last action
- waiting on marker

## 6. 구체 설계

### Phase A. Run Detail Information Hierarchy

대상:

- `AgentDetail.tsx`

변경:

- `Invocation` 패널을 transcript 아래로 이동
- `Diagnostics` 아코디언 추가
- `Prompt`, `Context`, `Environment`, `Events`를 하위 섹션으로 분리
- `Environment`는 기본적으로 key count와 redacted summary만 보이고 펼치면 전체 표시
- `Prompt`는 첫 8~12줄 preview만 먼저 보이고 확장 시 전체 표시
- `Context`는 raw JSON 대신 핵심 필드 요약 카드 제공

추가 UI 규칙:

- `assistant`와 `tool_result`는 primary readability 우선
- `system`은 informational tone
- `stderr`만 error tone

### Phase B. Agent Presence / Character UI

대상:

- `ActiveAgentsPanel.tsx`
- `Team.tsx`
- `AgentCardEnhanced.tsx`

변경:

- role별 tone/token 정의
- active run card 헤더에 role crest + class title 노출
- `latest signal` 대신 `current job`과 `latest signal`을 분리
- Team roster를 단순 lane section에서 `squad lane board`로 확장
- `PM/TL/Engineer/Reviewer/QA`가 한 세트로 보이도록 lane grouping 정리

### Phase C. Issue Card Density

대상:

- `IssuesList.tsx`
- 필요 시 관련 row/card helper

변경:

- compact row에도 status strip 추가
- 현재 담당 에이전트/역할 표시
- active issue pulse
- blocked reason short label
- review/qa 상태 badge

### Phase D. Issue Detail Party Strip

대상:

- `IssueDetail.tsx`

변경:

- 상단 summary 아래 `party strip`
- 각 슬롯별 latest role action
- active run이 있으면 해당 슬롯 강조

## 7. 구현 순서

### Batch 1. Run Detail transcript-first

가장 먼저 하는 이유:

- 사용자 불만이 가장 직접적인 지점이다.
- backend 계약 변경 없이 UI만으로 개선 가능하다.
- 체감 효과가 가장 크다.

완료 기준:

- transcript가 diagnostics보다 먼저 보인다.
- `Prompt`, `Environment`가 기본 접힘이다.
- 실제 대화가 첫 화면에서 바로 읽힌다.

### Batch 2. Agent presence / character UI

완료 기준:

- Active agents가 단순 로그 카드가 아니라 역할 카드처럼 보인다.
- Team 화면에서 조직/직업 구분이 명확하다.

### Batch 3. Issue card density + party strip

완료 기준:

- issue list에서 현재 단계/책임/막힘이 더 분명하다.
- IssueDetail 상단에서 책임 체인을 한눈에 본다.

## 8. 파일별 영향 범위

| 파일 | 주요 변경 | 리스크 |
|------|-----------|--------|
| `ui/src/pages/AgentDetail.tsx` | run detail hierarchy, diagnostics accordion | Medium |
| `ui/src/components/ActiveAgentsPanel.tsx` | role/job card, tone cleanup | Medium |
| `ui/src/pages/Team.tsx` | squad lane board styling | Medium |
| `ui/src/components/AgentCardEnhanced.tsx` | class-card visual reuse | Low |
| `ui/src/components/IssuesList.tsx` | row/card density increase | Medium |
| `ui/src/pages/IssueDetail.tsx` | party strip | Medium |
| `ui/src/index.css` | token additions if needed | Low |

## 9. 검증 전략

### 타입/빌드

- `pnpm --filter @squadrail/ui typecheck`
- `pnpm --filter @squadrail/ui build`

### 브라우저 회귀

- support-only smoke 1개
- 새 Playwright case:
  - run detail opens transcript-first
  - diagnostics collapsed by default
  - Team role cards render

### 수동 검증 포인트

1. `/agents/:agentId/runs/:runId`
   - transcript가 첫 fold 안에 보여야 함
   - prompt/env는 펼치기 전 과도한 vertical space를 먹지 않아야 함
2. `/team`
   - role identity가 단순 이름 목록보다 선명해야 함
3. 이슈 리스트
   - 상태/책임/막힘이 한눈에 읽혀야 함

## 10. 비목표

- hidden child / parent-subtask UX 개편
- protocol state machine 변경
- backend run payload 축소
- 실제 캐릭터 아트 자산 도입

## 11. 추천 결정

### 디자인 톤

추천:

- `operational party board`

이유:

- claw-empire 같은 직업감은 살리되,
- Squadrail은 게임보다 운영 툴에 가까워야 한다.

### run detail 기본값

추천:

- `Transcript-first + Diagnostics collapsed`

이유:

- 지금 불편의 핵심은 데이터 부족이 아니라 정보 우선순위가 뒤집힌 것이다.

## 12. 다음 액션

1. Batch 1 구현: `RunDetail` transcript-first
2. Batch 1 Playwright/지원 smoke 추가
3. Batch 2 agent presence 카드로 확장

