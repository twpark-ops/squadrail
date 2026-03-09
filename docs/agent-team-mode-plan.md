# Agent Team Mode Execution Plan

작성일: 2026-03-09  
작성자: Taewoong Park <park.taewoong@airsmed.com>

## 목적

목표는 단순히 agent를 깨우는 것이 아니라, 실제로 `조직처럼` 끝까지 일하게 만드는 것이다.

원하는 최종 흐름은 다음과 같다.

1. 상위 리더가 issue를 만든다.
2. 팀 리드가 요구를 분해하고 담당자와 reviewer를 확정한다.
3. 엔지니어가 실제 workspace에서 구현한다.
4. reviewer가 증거와 diff를 바탕으로 판단한다.
5. blocker나 질문은 팀 내부 소통으로 해결되거나 상위로 escalation 된다.
6. 결과물, 테스트, 의사결정 기록이 남고 issue가 닫힌다.

이 문서는 현재 Squadrail 구조와 Claude Code의 공식 team/subagent 모델을 비교해, 무엇을 더 개발해야 하는지 설계 관점에서 정리한다.

## 외부 기준에서 얻은 핵심

Claude Code 공식 문서 기준으로, 끝까지 일하는 팀 구조의 핵심은 다음 네 가지다.

1. `subagents`
   - 서브에이전트는 별도 컨텍스트에서 병렬 작업이 가능하고, 각자 독립된 프롬프트와 권한 규칙을 가질 수 있다.
   - 공식 문서는 hooks와 permission mode를 함께 써서 자동 delegation과 실행 제어를 붙이는 방식을 설명한다.
   - 출처: https://docs.anthropic.com/en/docs/claude-code/sub-agents

2. `agent teams`
   - 팀은 shared task list, mailbox, lead/teammate 역할, idle/completion/failure hook를 가진다.
   - 팀원은 각자 분리된 세션에서 일하고, 리드는 task list와 mailbox를 보고 다음 행동을 결정한다.
   - 출처: https://code.claude.com/docs/en/agent-teams

3. `hook-driven coordination`
   - 작업 완료, idle, 실패 같은 lifecycle 이벤트가 다음 orchestration의 트리거가 된다.
   - 즉 "한 번 깨우고 끝"이 아니라, 이벤트 기반으로 팀 루프가 계속 이어진다.
   - 출처: https://docs.anthropic.com/en/docs/claude-code/sub-agents

4. `작업 격리`
   - 팀원은 병렬로 움직이되, 각자 독립 브랜치/세션/작업 단위를 유지한다.
   - 출처: https://code.claude.com/docs/en/agent-teams

## 현재 Squadrail의 강점

현재 Squadrail은 이미 `조직 운영의 제어면`이 강하다.

1. `Typed protocol`
   - ASSIGN_TASK, START_IMPLEMENTATION, SUBMIT_FOR_REVIEW 같은 상태 전이가 강하게 정의돼 있다.
   - 관련 파일: [issue-protocol.ts](/home/taewoong/company-project/squadall/server/src/services/issue-protocol.ts)

2. `RAG + brief`
   - recipient role별 brief와 retrieval evidence가 생성된다.
   - 관련 파일: [issue-retrieval.ts](/home/taewoong/company-project/squadall/server/src/services/issue-retrieval.ts)

3. `Heartbeat contract`
   - agent는 assignment 조회, checkout, 작업, comment/status 갱신, delegation 절차를 갖는다.
   - 관련 문서: [heartbeat-protocol.md](/home/taewoong/company-project/squadall/docs/guides/agent-developer/heartbeat-protocol.md)

4. `소통 수단`
   - issue comment와 @-mention wakeup이 이미 존재한다.
   - 관련 문서: [api-reference.md](/home/taewoong/company-project/squadall/skills/squadrail/references/api-reference.md)

5. `Delegation 모델`
   - subtask 생성, chain of command, cross-team escalation 방향이 이미 문서화돼 있다.
   - 관련 문서: [SPEC.md](/home/taewoong/company-project/squadall/doc/SPEC.md)

즉, 지금 문제는 "소통 개념이 없다"가 아니다.  
문제는 `이 소통과 조직 절차를 실행 엔진이 끝까지 보장하지 못한다`는 점이다.

## 현재 핵심 부족점

### 1. 실행 안정성 부족

현재 가장 큰 문제는 run이 끝까지 보장되지 않는다는 점이다.

- orphan reaper가 메모리의 `runningProcesses`만 보고 `process_lost`를 판정한다.
- 즉 실행 추적의 단일 진실 공급원(source of truth)이 DB가 아니라 프로세스 메모리다.
- 서버 재시작, preflight 중단, 예외 누락이 있으면 agent는 실제로 일을 못 했는데도 "실종"처럼 처리된다.

관련 파일:

- [heartbeat.ts](/home/taewoong/company-project/squadall/server/src/services/heartbeat.ts)
- [server-utils.ts](/home/taewoong/company-project/squadall/packages/adapter-utils/src/server-utils.ts)

### 2. 조직용 mailbox가 없다

지금 소통은 주로 issue comment와 protocol message에 의존한다.

이 방식의 한계:

- 사람에게는 보이지만 agent 간 운영 mailbox로는 거칠다.
- issue timeline과 팀 내부 coordination가 섞인다.
- "질문 보냄", "리뷰 요청", "handoff 완료", "결정 필요", "작업 완료" 같은 팀 운영 이벤트를 구조적으로 구분하기 어렵다.

현재는 comment mention이 wakeup을 걸어주는 수준이다.

### 3. shared task list가 없다

현재 각 agent의 inbox는 `자기에게 assignee 된 issue` 중심이다.

이 방식의 한계:

- 팀 리드가 하나의 issue 안에서 내부 작업 단위를 병렬 분해해도, 이를 가볍게 공유/재배치하기 어렵다.
- child issue를 너무 많이 만들면 사람용 보드가 오염된다.
- reviewer/qa/tl이 "같은 작업군을 공유하면서 각자 상태를 본다"는 모델이 약하다.

### 4. lead loop가 없다

지금은 recipient wakeup은 있지만, 팀 리드가 "현재 task list와 mailbox를 보고 다음 지시를 내리는 supervisor loop"가 명시적으로 없다.

즉, orchestration이 `message dispatch`까진 있는데 `team supervision`까지는 아니다.

### 5. handoff artifact contract가 약하다

엔지니어에서 reviewer로 넘길 때 아래가 항상 구조적으로 보장돼야 한다.

- plan summary
- changed files
- diff summary
- test command/result
- risk/rollback
- review checklist

지금은 protocol evidence requirement가 일부 있지만, 팀 운영용 handoff 패키지로는 약하다.

### 6. hook 기반 재기동 규칙이 약하다

Claude Code team mode의 핵심은 lifecycle event가 다음 행동을 결정한다는 점이다.

지금 Squadrail은 wakeup과 timeout은 있지만, 아래 이벤트를 조직 단위 자동 루프로 쓰지는 못한다.

- teammate finished
- teammate blocked
- teammate idle
- reviewer requested changes
- lead intervention required

### 7. review 참여 방식이 너무 느슨하다

현재 assignment에서 reviewer는 notify_only로 남는다.

이건 비용 최적화엔 좋지만, 팀 단위 execution에는 reviewer의 조기 관여가 약해진다.  
리뷰어는 최소한 mailbox notification과 watch state는 가져야 한다.

관련 파일:

- [issue-protocol-execution.ts](/home/taewoong/company-project/squadall/server/src/services/issue-protocol-execution.ts)

## 목표 아키텍처

핵심 원칙은 하나다.

`Issue/Protocol은 인간과 감사(audit)를 위한 백본으로 유지하고, 그 위에 Team Execution Layer를 추가한다.`

즉, Claude Code team mode를 흉내 내기 위해 기존 구조를 버릴 필요는 없다.

### 계층 분리

1. `Control Plane`
   - 회사, 프로젝트, agent, issue, protocol, approvals, RAG, budgets
   - 기존 Squadrail이 이미 강함

2. `Execution Plane`
   - run lease
   - child execution
   - workspace isolation
   - resumable session
   - hook processing

3. `Team Coordination Plane`
   - shared task list
   - mailbox
   - handoff artifacts
   - lead supervision loop

## 제안 데이터 모델

### 1. team_runs

상위 issue 기준의 팀 실행 단위를 나타낸다.

- `id`
- `company_id`
- `issue_id`
- `lead_agent_id`
- `status` (`planning`, `executing`, `reviewing`, `blocked`, `done`, `failed`)
- `goal_summary`
- `definition_of_done_json`
- `latest_supervisor_run_id`
- `created_at`
- `updated_at`

### 2. team_work_items

human-facing issue와 분리된 내부 작업 단위다.

- `id`
- `team_run_id`
- `parent_work_item_id`
- `kind` (`plan`, `implementation`, `review`, `qa`, `research`, `decision`)
- `title`
- `owner_agent_id`
- `reviewer_agent_id`
- `status` (`todo`, `claimed`, `running`, `blocked`, `in_review`, `done`, `cancelled`)
- `workspace_scope`
- `branch_name`
- `priority`
- `acceptance_criteria_json`
- `input_artifact_ids_json`
- `output_artifact_ids_json`
- `lease_owner_run_id`
- `lease_expires_at`
- `created_at`
- `updated_at`

### 3. team_mailbox_messages

issue comment와 분리된 구조화된 agent-to-agent 통신 채널이다.

- `id`
- `company_id`
- `team_run_id`
- `issue_id`
- `thread_key`
- `sender_agent_id`
- `recipient_agent_id`
- `message_type`
  - `handoff`
  - `review_request`
  - `question`
  - `decision_request`
  - `blocker`
  - `status_update`
  - `completion`
- `body_markdown`
- `artifact_refs_json`
- `requires_ack`
- `acked_at`
- `created_at`

### 4. team_artifacts

handoff와 review의 필수 산출물이다.

- `id`
- `company_id`
- `team_run_id`
- `work_item_id`
- `kind`
  - `plan`
  - `diff_summary`
  - `test_result`
  - `review_report`
  - `rollback_plan`
  - `decision_log`
- `content_markdown`
- `metadata_json`
- `created_by_agent_id`
- `created_at`

### 5. run_leases

메모리 기반이 아닌 DB 기반 실행 생존 신호다.

- `run_id`
- `agent_id`
- `status`
  - `launching`
  - `executing`
  - `awaiting_hook`
  - `finalizing`
  - `lost`
- `heartbeat_at`
- `lease_expires_at`
- `checkpoint_json`

## 동작 방식

### 1. 리드 중심 supervisor loop

1. issue가 생성되면 lead agent가 `team_run`을 연다.
2. lead는 brief, comments, past artifacts를 보고 `team_work_items`를 만든다.
3. owner와 reviewer를 지정하고 acceptance criteria를 확정한다.
4. 각 작업은 mailbox와 wakeup으로 필요한 agent에게 전달된다.
5. lead는 `idle`, `blocked`, `review requested`, `done` 이벤트를 소비하며 다음 지시를 낸다.

### 2. agent 실행 루프

1. agent는 mailbox + assigned work items + protocol brief를 함께 읽는다.
2. work item lease를 claim한다.
3. workspace를 확보하고 작업한다.
4. 중간 결과와 blocker는 mailbox + artifact로 남긴다.
5. 완료 시 `completion` 또는 `review_request` 메시지를 보낸다.

### 3. reviewer 루프

1. reviewer는 mailbox의 `review_request`를 받는다.
2. handoff artifact가 없으면 바로 reject 또는 clarification 요청을 보낸다.
3. diff summary, test result, rollback plan을 검토한다.
4. 승인/변경요청 결정을 protocol message로 반영한다.

## 실행 안정성을 위한 필수 수정

이 부분은 `가장 먼저` 해야 한다.

### P0-A. run state machine 세분화

현재 `queued/running/succeeded/failed`만으로는 부족하다.

추가 상태:

- `launching`
- `executing`
- `finalizing`
- `recovering`

이렇게 해야 "spawn 전 실패"와 "실행 중 실종"을 구분할 수 있다.

### P0-B. DB lease heartbeat

adapter 실행 중 주기적으로 DB lease를 갱신해야 한다.

- 메모리 `runningProcesses`는 보조 캐시만 사용
- orphan 판정은 `run_leases.heartbeat_at` 기준으로 수행
- stale run은 바로 failed 하지 말고 `recovering`을 거친 뒤 재시도 또는 supervisor escalation

### P0-C. preflight checkpoint 기록

아래 단계마다 event를 남겨야 한다.

1. workspace resolved
2. runtime session resolved
3. log store opened
4. adapter config resolved
5. child process spawned
6. first stdout/stderr received
7. adapter completed

지금처럼 `run started` 이전 구간이 길면 silent loss를 진단하기 어렵다.

### P0-D. restart-safe resumption

서버 재시작 후 active run을 재평가하는 로직이 필요하다.

- child process 재부착이 불가능하면 `recovering` 상태로 전환
- 같은 work item을 lead에게 재보고
- 무조건 `process_lost`로 끝내지 말고 재시도 정책을 둔다

### P0-E. idempotent finalization

실패/취소/성공 finalization은 중복 호출돼도 안전해야 한다.

## 팀 실행을 위한 필수 수정

### P1-A. mailbox 도입

issue comment는 human-audit 채널로 남기고, agent 내부 조율은 mailbox로 분리한다.

원칙:

- 사람에게 보여야 하는 것만 comment mirror
- agent 간 조율은 mailbox first
- mention wakeup은 mailbox message가 있을 때만 유도적으로 사용

### P1-B. shared task list 도입

상위 issue 아래 내부 work item을 둘 수 있어야 한다.

원칙:

- top-level issue는 인간용
- 내부 세분화는 `team_work_items`
- cross-team/human-visible 작업만 child issue로 materialize

### P1-C. reviewer watch mode

reviewer는 assignment 시점부터 최소한 다음을 가져야 한다.

- mailbox notification
- current acceptance criteria
- current risk notes
- latest implementation artifact preview

즉 reviewer를 완전 sleep시키지 말고 `watcher`로 참여시켜야 한다.

### P1-D. supervisor hook engine

다음 이벤트가 오면 lead를 깨워야 한다.

- work item done
- work item blocked
- review request created
- review decision created
- lease expired
- retry exhausted

## 품질 보장을 위한 필수 수정

### P2-A. handoff artifact contract 강제

SUBMIT_FOR_REVIEW 전에 최소 산출물을 강제한다.

- changed files
- diff summary
- test commands
- test results
- known risks
- rollback note

### P2-B. role-specific operating contracts

role pack 수준을 넘어, 실행 시 주입되는 structured checklist가 필요하다.

- TL checklist
- engineer implementation checklist
- reviewer evidence checklist
- QA validation checklist

### P2-C. implementation isolation 강화

`START_IMPLEMENTATION` work item마다 branch/worktree를 고정해야 한다.

- work item id 기반 branch naming
- reviewer는 read-only shared workspace 또는 detached review workspace
- merge conflict detector와 worktree cleanup job 필요

## 관측성

### 필수 메트릭

- run orphan rate
- run recoverable failure rate
- average time from assignment to first artifact
- average review turnaround
- mailbox unanswered age
- blocked escalation age
- work item retry count
- issue closure lead time

### 필수 화면

1. team run board
2. mailbox inbox/outbox
3. work item graph
4. execution recovery queue
5. review SLA dashboard

## 단계별 구현 플랜

### Phase 0. Execution reliability hardening

목표: agent가 `실종되지 않도록` 한다.

1. DB lease heartbeat 추가
2. run lifecycle 세분화
3. preflight checkpoint 이벤트 추가
4. restart-safe recovery queue 추가
5. process_lost를 최종 원인 코드가 아니라 recovery 결과로만 기록

완료 기준:

- analysis run이 silent fail 없이 항상 성공/실패 원인을 남김
- 서버 재시작 후 active run이 고아처럼 사라지지 않음

### Phase 1. Team coordination layer

목표: agent들이 `서로 일하는 조직`이 되게 만든다.

1. team_runs
2. team_work_items
3. team_mailbox_messages
4. lead supervisor wake rules
5. reviewer watch mode

완료 기준:

- 하나의 top-level issue에서 lead가 내부 work item 2개 이상을 병렬 생성 가능
- engineer와 reviewer가 comment 없이도 mailbox로 coordination 가능

### Phase 2. Delivery loop enforcement

목표: 조직이 `끝까지 delivery` 하게 만든다.

1. handoff artifact contract
2. review artifact validation
3. implementation worktree/branch binding
4. test/build result capture
5. closure summary artifact

완료 기준:

- START_IMPLEMENTATION -> SUBMIT_FOR_REVIEW -> APPROVE/REQUEST_CHANGES -> CLOSE_TASK 흐름이 artifact 기반으로 자동 추적됨

### Phase 3. Human-visible operations

목표: 운영자가 실제로 믿고 쓸 수 있게 만든다.

1. team run board UI
2. mailbox UI
3. recovery queue UI
4. SLA and failure analytics

## 권장 구현 순서

가장 현실적인 순서는 아래다.

1. `실종 방지`
2. `mailbox + supervisor loop`
3. `shared work items`
4. `artifact contract`
5. `implementation isolation / review hardening`
6. `UI/metrics`

이 순서를 권장하는 이유는, 지금은 조직성을 늘리기 전에 실행 안정성이 먼저 해결돼야 하기 때문이다.

## 결론

당신이 원하는 건 단순 agent execution이 아니라 `운영 가능한 AI 개발 조직`이다.

이를 위해 필요한 것은 새 프롬프트 몇 줄이 아니라 다음 세 가지다.

1. `실행 생존성`
2. `조직형 소통 계층`
3. `handoff와 review를 강제하는 delivery contract`

즉, Claude Code team mode를 참고하는 방향은 맞다.  
하지만 Squadrail은 이미 강한 protocol/issue/RAG 백본이 있으므로, 정답은 재작성보다 `team execution layer 추가`다.
