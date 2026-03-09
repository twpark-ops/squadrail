# Phase 1 Team Supervisor MVP

작성일: 2026-03-09  
작성자: Taewoong Park <park.taewoong@airsmed.com>

## 결론

Phase 1은 새로운 `team_runs`, `mailbox`, `team_work_items`를 한 번에 추가하는 방향으로 가면 과하다.

현재 Squadrail은 이미 아래 자산을 갖고 있다.

- `issues.parentId` 와 `hiddenAt`
- issue별 protocol state machine
- role별 brief / retrieval
- heartbeat wakeup / execution lock
- reviewer / tech lead ownership 필드

따라서 Phase 1 MVP는 `hidden child issue + reserved labels + lead/reviewer wake rules` 기반으로 설계하는 것이 맞다.

이 방식이면 새 coordination plane을 크게 만들지 않고도 `shared task list`, `reviewer watch mode`, `lead supervision`의 핵심을 먼저 붙일 수 있다.

## 목표

사람이 보드에서 상위 issue 하나를 던지면, Tech Lead가 그 issue 아래에 내부 작업을 분해하고, engineer와 reviewer가 child task 기준으로 움직이며, lead는 주요 이벤트만 받아 감독하는 구조를 만든다.

## 설계 대안

### 대안 A. full team_runs + mailbox + work_items

장점:

- 장기 구조가 가장 깔끔하다
- Claude Code team mode와 형태가 가장 유사하다

단점:

- 현재 코드 경계와 거리가 멀다
- 새 API, 새 UI, 새 state machine, 새 recovery까지 동시에 들어간다
- 지금 단계에선 **과한 설계**다

판정:

- Phase 1 MVP로는 부적합
- Phase 3 이후 확장안으로 유지

### 대안 B. dedicated team_work_items만 추가

장점:

- board pollution 없이 내부 작업 단위를 분리할 수 있다
- 미래 mailbox 설계와도 잘 맞는다

단점:

- brief/retrieval/protocol/issue detail 흐름을 다시 한 번 연결해야 한다
- 기존 issue 중심 스택을 우회하는 새 계층이 생긴다

판정:

- 중간 단계 대안
- 하지만 현 시점에는 기존 issue 재사용이 더 빠르고 안전하다

### 대안 C. hidden child issue 재사용

장점:

- `issues.parentId`, `hiddenAt`, `issue_protocol_state`, `issue_task_briefs`, `heartbeat`를 그대로 활용할 수 있다
- child issue 자체가 work item 역할을 한다
- 기본 board/dashboard 쿼리가 이미 `hiddenAt is null` 필터를 쓰므로 보드 오염이 적다

단점:

- work item 전용 필드가 부족해 label convention이 필요하다
- child issue 수가 많아지면 계층이 복잡해진다

판정:

- **Phase 1 MVP 추천안**

## 추천안

### 1. internal work item = hidden child issue

상위 issue를 `root delivery issue`로 두고, 내부 작업 단위는 `hidden child issue`로 만든다.

규칙:

- `parentId = rootIssue.id`
- `hiddenAt = now()`
- board 기본 목록에는 나오지 않음
- issue detail에서만 `internal work items` 섹션으로 노출

child issue는 기존 issue처럼 아래를 그대로 가진다.

- assignee
- protocol state
- brief / retrieval
- execution lock
- review cycle

즉 새 table 없이도 child issue 하나가 팀 내부 work item이 된다.

### 2. reserved labels로 work item kind를 표현

새 스키마 없이 먼저 label convention으로 종류를 표현한다.

예약 label:

- `team:internal`
- `work:plan`
- `work:implementation`
- `work:review`
- `work:qa`
- `watch:lead`
- `watch:reviewer`

필수 규칙:

- hidden child issue는 항상 `team:internal`
- 종류는 `work:*` label 하나만 허용
- reviewer watch가 필요하면 `watch:reviewer`
- lead supervision이 필요하면 `watch:lead`

이 접근의 장점은 migration 없이 시작할 수 있다는 점이다.

### 3. child issue 생성 경로

새로운 최소 API를 추가한다.

제안:

- `POST /api/issues/:issueId/internal-work-items`

입력:

- `title`
- `description`
- `kind`
- `assigneeAgentId`
- `reviewerAgentId`
- `priority`
- `acceptanceCriteria[]`

동작:

1. root issue 아래 hidden child issue 생성
2. reserved labels 연결
3. 즉시 child issue에 `ASSIGN_TASK` protocol message 생성
4. retrieval / brief / wakeup은 기존 protocol execution path 재사용

핵심은 `child issue를 만든 뒤 별도 supervisor state를 두는 것이 아니라, 기존 ASSIGN_TASK를 child issue에 다시 태우는 것`이다.

### 4. reviewer watch mode

현재 `ASSIGN_TASK` 시 reviewer는 `notify_only`다.

Phase 1 MVP에서는 다음 규칙으로 바꾼다.

- root issue의 일반 assignment는 기존처럼 `notify_only`
- hidden child issue의 assignment는 reviewer를 `watch wakeup` 대상으로 승격

의도:

- reviewer가 child task 시작 시점부터 brief를 읽고 대기
- engineer가 `SUBMIT_FOR_REVIEW` 할 때 context gap을 줄임

구현 방향:

- `issue-protocol-execution.ts` 에서 `shouldWakeRecipientForMessage(...)` 규칙을 issue visibility / label context와 함께 판단
- reviewer wake reason은 `issue_watch_assigned`
- workspace usage는 `analysis` 또는 `review`
- reviewer는 shared workspace에서 읽기/검토만 수행

### 5. lead supervisor wake rules

Tech Lead는 모든 child task를 계속 polling 하지 않고, 주요 protocol event에서만 자동 wakeup 된다.

Phase 1 MVP wake rules:

- child issue `ACK_ASSIGNMENT`
- child issue `ASK_CLARIFICATION`
- child issue `ESCALATE_BLOCKER`
- child issue `SUBMIT_FOR_REVIEW`
- child issue `REQUEST_CHANGES`
- child issue `APPROVE_IMPLEMENTATION`
- child issue `TIMEOUT_ESCALATION`
- child issue run `failed / timed_out / process_lost`

이렇게 하면 별도 `supervisor loop` 프로세스를 만들지 않아도, event-driven supervision이 먼저 가능해진다.

추가 규칙:

- child issue는 가능하면 root issue의 `techLeadAgentId`를 상속한다
- `watch:lead`가 활성화된 internal work item은 유효한 tech lead owner 없이 생성하지 않는다

### 6. parent issue summary

root issue는 child issue 상태를 자동 요약해서 보여준다.

MVP 규칙:

- root issue status는 기존처럼 사람이 바꾸거나 protocol이 바꾸는 방식을 유지
- 대신 issue detail API에 child summary를 추가

summary 예시:

- `todo / running / blocked / in_review / done` 개수
- 현재 active engineer
- current blocker child issue
- latest review-request child issue

이 단계에서는 root issue status를 child issue aggregate로 자동 변경하지 않는다.

이유:

- 숨은 coupling이 커진다
- rollback과 설명 가능성이 떨어진다

### 7. minimal review handoff contract

Phase 1 마지막 슬라이스에서는 `SUBMIT_FOR_REVIEW`를 메모가 아니라 구조화된 handoff 계약으로 다룬다.

최소 필수 항목:

- `implementationSummary`
- `diffSummary`
- `changedFiles[]`
- `testResults[]`
- `reviewChecklist[]`
- `residualRisks[]`

추가 규칙:

- `APPROVE_IMPLEMENTATION`은 최신 `SUBMIT_FOR_REVIEW`가 위 계약을 모두 만족할 때만 허용한다
- 다만 Phase 1 배포 이전 legacy review submission은 기존 evidence bar를 만족하면 승인 호환성을 유지한다
- reviewer brief / retrieval query는 `testResults`와 `residualRisks`를 포함해 handoff 근거를 읽는다
- issue detail timeline은 위 handoff 항목을 별도 섹션으로 노출한다

## 코드 경계 기준 구현 포인트

### API / Service

- [issues.ts](/home/taewoong/company-project/squadall/server/src/routes/issues.ts)
  - internal work item 생성 엔드포인트
  - root issue detail에 hidden children 조회 추가

- [issues.ts](/home/taewoong/company-project/squadall/server/src/services/issues.ts)
  - hidden child issue 생성 helper
  - root-child summary helper

- [issue-protocol-execution.ts](/home/taewoong/company-project/squadall/server/src/services/issue-protocol-execution.ts)
  - reviewer watch wake rule
  - tech lead supervisor wake rule

- [dashboard.ts](/home/taewoong/company-project/squadall/server/src/services/dashboard.ts)
  - hidden child issue summary aggregation

### UI

- [IssueDetail.tsx](/home/taewoong/company-project/squadall/ui/src/pages/IssueDetail.tsx)
  - `Internal Work Items` 섹션
  - child issue summary / action

## 비목표

- full mailbox threading
- dedicated team_runs table
- SLA dashboard
- multi-team balancing
- child issue 자동 merge / 자동 close orchestration

## 테스트 계획

### 서버

1. hidden child issue는 기본 issue 목록에 나타나지 않는다
2. hidden child issue 생성 시 parentId, hiddenAt, labels가 정확히 저장된다
3. child issue ASSIGN_TASK가 기존 brief / retrieval / wake path를 그대로 탄다
4. reviewer가 hidden child issue assignment에서 `notify_only`가 아니라 wakeup 대상이 된다
5. tech lead가 blocker / review 요청 이벤트에서 자동 wakeup 된다
6. root issue detail summary가 hidden child issue 상태를 정확히 집계한다

### E2E

1. root issue 생성
2. internal work item 2개 생성
3. engineer child issue assignment
4. reviewer watch wakeup 확인
5. engineer `SUBMIT_FOR_REVIEW`
6. lead / reviewer wakeup과 parent summary 갱신 확인

## 롤아웃 순서

1. hidden child issue 생성 API
2. child summary 조회
3. reviewer watch wake rule
4. lead supervisor wake rule
5. issue detail UI

## 다음 구현 슬라이스

### Slice 1

- hidden child issue 생성 API
- reserved label convention
- root issue detail에 child summary 노출

### Slice 2

- reviewer watch wake rule
- tech lead supervisor wake rule

### Slice 3

- issue detail UI
- e2e 시나리오

## 판단

Phase 1 MVP는 `full team system`이 아니라 `기존 issue/protocol/heartbeat를 팀처럼 쓰게 만드는 최소 감독 계층`이어야 한다.

따라서 지금 정답은 새 거대한 coordination plane이 아니라:

`hidden child issue + reserved labels + lead/reviewer wake rules`

이다.
