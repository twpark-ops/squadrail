# UI Rebuild Spec v1

작성일: 2026-03-10

## 1. 배경

지금 `squadall` 엔진은 이미 다음을 실증했다.

- issue 생성
- 역할 기반 라우팅
- isolated worktree 구현
- review / approval / close
- real-org E2E

하지만 현재 UI는 아직 `Paperclip식 control plane` 성격이 강하다.

- 회사/에이전트/프로젝트/설정 중심 탐색
- 운영 콘솔 중심 정보 구조
- 실제 코드 변경과 merge candidate보다 엔티티 목록이 먼저 보임
- 사용자가 변경 사항을 보려면 숨김 worktree 경로를 알아야 함

따라서 다음 단계는 기존 UI를 조금씩 보수하는 것이 아니라, `반자율 개발 조직 운영 도구`에 맞게 전면 재구성하는 것이다.

비주얼 시스템과 shell 톤은 [ui-visual-rebuild-spec-v1.md](/home/taewoong/company-project/squadall/docs/ui-visual-rebuild-spec-v1.md) 를 따른다.

## 2. 외부 참고와 해석

이번 리빌드 방향은 최신 제품 패턴을 그대로 복제하는 것이 아니라, 아래 제품들의 강점을 목적에 맞게 조합하는 방식으로 잡는다.

### Linear에서 가져올 것

- intake와 triage를 분리하는 사고방식
- 강한 filtering / saved views
- SLA/우선순위를 상태 표면에 자연스럽게 얹는 방식

의미:

- `Work` 화면은 단순 이슈 목록이 아니라 `triage`, `active`, `review`, `blocked`, `merge pending`으로 보이게 해야 한다.

참고:

- https://linear.app/docs/triage
- https://linear.app/docs/filters
- https://linear.app/docs/sla
- https://linear.app/features/asks

### GitHub에서 가져올 것

- 변경 검토의 기본 단위는 결국 `diff + review decision`
- `Approve` / `Request changes` / 재검토 요구 흐름은 파일 변경과 강하게 묶여야 함

의미:

- `Change Detail` 화면은 단순 artifact 모음이 아니라 review decision이 내려지는 기준 화면이어야 한다.

참고:

- https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/approving-a-pull-request-with-required-reviews
- https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/managing-pull-request-reviews-in-your-repository

### Graphite에서 가져올 것

- merge queue/activity는 `변경 반영 흐름`을 명확하게 보여준다
- operator는 단순 diff만 보는 게 아니라 `queue 위치`, `merge readiness`, `failure reason`을 본다

의미:

- `pending_external_merge` 이후는 buried state가 아니라 `Merge Candidate` surface로 승격해야 한다.

참고:

- https://graphite.dev/docs/get-started-merge-queue
- https://graphite.dev/features/merge-queue
- https://graphite.dev/docs/merge-when-ready
- https://graphite.dev/docs/customize-pr-inbox

### Anthropic Claude Code에서 가져올 것

- agent/subagent는 개별 봇 목록보다 `역할과 위임 흐름`이 중요하다
- specialized context와 tool scope 분리가 성공률에 중요하다

의미:

- `Team` 화면은 agent 카드 그리드보다 `역할`, `책임`, `현재 lane`, `권한/도구`를 중심으로 보여야 한다.

참고:

- https://docs.anthropic.com/en/docs/claude-code/sub-agents
- https://docs.anthropic.com/en/docs/claude-code/tutorials

## 3. 제품 재정의

새 UI는 더 이상 `AI 회사 관리 콘솔`이 아니다.

새 제품 정의:

> 사람이 목표와 경계만 주면, squad가 설계, 구현, 리뷰, 종료의 대부분을 처리하고, 사람은 상태, 근거, 승인, 반영만 판단하는 반자율 개발 조직 워크스페이스

UI가 즉시 답해야 하는 질문은 다섯 가지다.

1. 지금 우리 팀은 무엇을 하고 있나?
2. 어디가 막혀 있나?
3. agent가 실제로 무엇을 바꿨나?
4. review/approval은 어디까지 왔나?
5. 지금 merge 가능한가?

## 4. 설계 원칙

1. `Entity-first` 대신 `Workflow-first`
2. `관리`보다 `판단`
3. 한 화면에서 `상태 + 근거 + 액션`을 함께 제공
4. 숨김 worktree 같은 내부 구현은 추상화하되, 필요하면 `Open Worktree` escape hatch 제공
5. 운영자와 엔지니어 둘 다 사용할 수 있지만, 기본 시선은 `board operator / tech lead / reviewer`
6. `Issues`, `Changes`, `Runs`, `Knowledge`를 서로 분리하되 상호 링크를 강하게 유지

## 5. 새 정보 구조

### Top-level Navigation

1. `Overview`
2. `Work`
3. `Changes`
4. `Runs`
5. `Knowledge`
6. `Team`
7. `Settings`

### 기존 대비 정리

- `Dashboard` -> `Overview`로 재정의
- `Issues` + `Inbox` + `Approvals` -> `Work` 중심으로 통합
- `Agents` + `Projects` 일부 -> `Team`과 `Runs`로 분해
- `Activity` + `Recovery` 일부 -> `Runs`와 `Overview`로 흡수
- `Knowledge`는 유지하되 `RAG 관리`가 아니라 `근거/brief` 표면으로 재배치
- `Costs`, `Analytics`는 1차에서는 `Settings` 또는 secondary surface로 축소

## 6. 핵심 화면 정의

### 6.1 Overview

목적:

- 팀 상태를 10초 안에 파악

핵심 블록:

- Today’s delivery state
- Blocked work
- Review queue
- Merge pending
- Runtime failures / recovery
- Recent major protocol transitions

버려야 할 것:

- metric card만 나열하는 admin dashboard

### 6.2 Work

목적:

- 조직이 지금 처리 중인 업무 흐름 전체를 본다

필수 view:

- Triage
- Active
- Review
- Blocked
- Merge Pending
- Done / Recent

필수 row 정보:

- issue title
- owner role
- current workflow state
- review state
- evidence/brief confidence hint
- latest run state
- merge state

### 6.3 Work Detail

목적:

- issue 하나에 대한 운영 판단을 끝낸다

섹션 구성:

- Summary
- Protocol timeline
- Child work items
- Brief / evidence
- Current change summary
- Current run summary
- Next action rail

핵심:

- 지금의 [IssueDetail.tsx](/home/taewoong/company-project/squadall/ui/src/pages/IssueDetail.tsx)를 확장하는 것이 아니라 재배치해야 한다.
- timeline, brief, comments, live run, action console이 지금은 한 화면에 병렬로 놓여 있는데, 새 구조에서는 `decision flow` 순서로 정렬해야 한다.

### 6.4 Changes

목적:

- 사용자가 실제 코드 변경을 이해하고 승인 준비를 한다

필수 정보:

- changed files
- diff preview
- branch
- workspace binding
- head sha
- diff stat
- test/build results
- approval summary
- rollback note

이 화면이 필요한 이유:

- 지금은 실제 변경이 `.squadrail-worktrees/...`에 있고 사용자가 직접 경로를 알아야 한다.
- 새 UI에서는 이 화면이 `worktree를 대신 설명하는 표면`이 되어야 한다.

### 6.5 Runs

목적:

- 에이전트 실행, 실패, recovery를 runtime 관점에서 본다

필수 정보:

- run status
- checkpoints
- active/recent logs
- retry / redispatch / timeout / workspace blocked
- recovered/resumed/fresh workspace state

### 6.6 Knowledge

목적:

- brief와 retrieval 근거를 검토하고, RAG 품질 문제를 찾는다

필수 정보:

- current brief
- confidence
- degraded reasons
- evidence list
- source project/path breakdown
- retrieval quality summary

### 6.7 Team

목적:

- 개별 agent 목록이 아니라 `역할 조직`을 본다

필수 정보:

- role lane
- current owner
- review owner
- adapter / permissions
- current workload
- failure hotspots

## 7. 핵심 사용자 흐름

### Flow A. Board operator

1. `Overview`에서 blocked / merge pending 확인
2. `Work`에서 issue 선택
3. `Work Detail`에서 protocol / brief / next action 확인
4. `Changes`에서 diff / verification 검토
5. `Merge Candidate` 판단

### Flow B. Reviewer / QA

1. `Work -> Review`
2. `Work Detail`에서 context 확인
3. `Changes`에서 diff + test/build evidence 확인
4. `Approve` 또는 `Request changes`

### Flow C. Runtime operator

1. `Overview`에서 runtime failures 확인
2. `Runs`에서 checkpoint / failure reason 확인
3. recovery action 수행

## 8. 시각 방향

이 리빌드는 평균적인 SaaS 관리 콘솔처럼 가면 안 된다.

권장 방향:

- dense but editorial
- 좌측 navigation + 중앙 workstream + 우측 evidence/action rail
- 카드보다 panel/rail 위주
- 중요 상태 색은 적게 쓰고, `blocked`, `needs review`, `ready to merge`만 강하게 강조
- 타이포그래피는 `관리 UI`보다 `작업판` 느낌이 나야 함

디자인 제약:

- 기존 design system primitive는 재사용 가능
- 하지만 정보 구조와 layout은 새로 짜야 한다

## 9. 기존 라우트 정리 방안

현재 [App.tsx](/home/taewoong/company-project/squadall/ui/src/App.tsx) 기준 라우트는 다음 문제가 있다.

- `companies`, `agents`, `projects`, `issues`, `approvals`, `activity`, `inbox`, `knowledge`, `analytics`가 병렬 1급 네비게이션
- 실제 사용자 목표보다 엔티티 종류가 우선된다

1차 개편안:

- `/dashboard` -> `/overview`
- `/issues` -> `/work`
- `/issues/:issueId` -> `/work/:issueId`
- 신규 `/changes` 와 `/changes/:issueId`
- `/agents`의 runtime view 일부 -> `/runs`
- `/knowledge` 유지
- `/projects`, `/approvals`, `/activity`, `/inbox`는 1차에서 deep link 또는 secondary 진입점으로 축소

## 10. 구현 순서

### Slice 1. App Shell Rebuild

- 새 top navigation / side navigation
- route renaming
- global layout 재정의

### Slice 2. Work + Work Detail Rebuild

- triage/review/blocked/merge pending view
- protocol-first detail layout

### Slice 3. Changes Surface

- branch/worktree/diff/test/build artifact 노출
- merge candidate card

### Slice 4. Runs Surface

- runtime / recovery / log drill-down 정리

### Slice 5. Knowledge + Team Cleanup

- brief/evidence 시야 정리
- 팀 역할/책임 중심 뷰 재배치

## 11. 비목표

이번 리빌드에서 바로 하지 않을 것:

- 대규모 visual branding 작업만 먼저 하는 것
- 3D/과한 모션 위주 전시형 UI
- RAG deep hardening을 UI 개편과 동시에 진행하는 것
- 모든 legacy 화면을 한 번에 삭제하는 것

## 12. 결론

최적의 UI는 `Issue tracker`, `Code review tool`, `Agent runtime console`, `Knowledge console`을 각각 따로 잘 만드는 것이 아니다.

`squadall`에 맞는 최적의 UI는 다음 성격을 동시에 가져야 한다.

- Linear처럼 intake와 work queue가 명확해야 하고
- GitHub처럼 변경 검토와 review decision이 강해야 하며
- Graphite처럼 merge readiness가 분명해야 하고
- Claude Code처럼 역할 기반 delegation을 드러내야 한다

즉 다음 구현 기준은:

> Paperclip식 control plane을 버리고, Work / Changes / Runs / Knowledge 중심의 반자율 개발 조직 워크스페이스로 재구성한다.
