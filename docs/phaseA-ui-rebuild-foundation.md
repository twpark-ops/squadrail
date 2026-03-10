# Phase A UI Rebuild Foundation

작성일: 2026-03-10

## 목표

Phase A의 목표는 기존 Paperclip식 control-plane navigation을 해체하고, 새 제품 정보 구조를 실제 app shell에 반영하는 것이다.

이번 단계는 `최종 UI 완성`이 아니라 아래 세 가지를 닫는 데 집중한다.

1. 새 top-level IA를 실제 route와 navigation에 반영
2. 기존 페이지를 새 정보 구조 아래에 안전하게 재배치
3. legacy 경로를 깨지 않으면서 새 경로가 기본 경험이 되도록 전환

## 완료 기준

- 기본 landing이 `Overview`로 들어간다
- top-level navigation이 `Overview / Work / Changes / Runs / Knowledge / Team / Settings`로 재구성된다
- `Work`, `Changes`, `Runs`, `Team`은 빈 placeholder가 아니라 실제 데이터가 보이는 foundation page를 가진다
- issue 기본 deep link는 `Work` 기준으로 이동한다
- 기존 `/dashboard`, `/issues`, `/company/settings` 등 legacy route는 새 shell로 자연스럽게 이어진다

## 구현 슬라이스

### Slice 1. Route Foundation

- 새 root route 추가
  - `/overview`
  - `/work`
  - `/work/:issueId`
  - `/changes`
  - `/changes/:issueId`
  - `/runs`
  - `/team`
  - `/settings`
- root redirect 및 company redirect 기본값을 `/overview`로 변경
- legacy route redirect 정리

### Slice 2. Navigation Rebuild

- sidebar를 새 IA 기준으로 재구성
- mobile bottom nav를 새 IA 기준으로 재구성
- command palette quick navigation 갱신
- company rail / page memory / onboarding redirect를 새 landing 기준으로 갱신

### Slice 3. Foundation Pages

- `Changes`
  - active implementation, review-ready, recent delivery를 보여주는 기본 허브
- `Runs`
  - live runs, recovery queue, recent heartbeat runs를 보여주는 기본 허브
- `Team`
  - 역할/프로젝트/조직 구조 진입 허브

### Slice 4. Link Hygiene

- issue 링크 기본값을 `/work/:issueId`로 변경
- issue detail breadcrumb와 identifier redirect가 현재 section(`Work` 또는 `Changes`)를 유지하도록 정리
- overview/work/runs surface에서 old route drift를 줄임

## 비목표

- `Changes Detail` 완성형 diff review UI
- `Runs Detail` 완성형 log/recovery UI
- `Team` 완성형 org/workload UI
- visual identity 전면 리디자인

이 항목들은 다음 slice에서 고도화한다.

## 리스크

- 기존 hardcoded path가 많아 route drift가 일부 남을 수 있음
- `IssueDetail`을 아직 재사용하므로 `Changes Detail` 경험은 중간 단계일 수 있음
- `Agents/Projects/Org`는 여전히 secondary route로 남아 있어 1차에서는 혼재가 존재함

## 권장 검증

1. `/overview` 진입 확인
2. sidebar / mobile nav / command palette에서 새 IA 진입 확인
3. `/work/:issueId`와 `/changes/:issueId` deep link 확인
4. 새 `Changes`, `Runs`, `Team` 허브 데이터 로딩 확인
5. 전체 typecheck / build 확인
