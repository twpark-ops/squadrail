# Execution Phase Roadmap

작성일: 2026-03-09  
현재 활성 단계: `Phase 2 (Slice 2 완료, Phase 3 준비)`

## 목표

최종 목표는 `완전 무인 회사`가 아니라, 사람이 목표와 경계만 주면 squad가 설계, 구현, 리뷰 루프의 대부분을 스스로 처리하는 반자율 개발 조직을 만드는 것이다.

## Phase 정의

### Phase 0. Execution Reliability

목표: agent run이 실종되지 않고, 항상 명시적인 성공/실패 원인을 남기게 만든다.

범위:

- preflight 예외를 explicit failure로 처리
- run checkpoint event 추가
- orphan/process_lost 원인 축소
- recovery 설계의 기초 마련

완료 기준:

- analysis run이 silent fail 없이 종료된다
- `process_lost`가 "조용한 예외 누락" 때문에 발생하지 않는다
- run events만 봐도 어느 단계에서 실패했는지 파악 가능하다

### Phase 1. Team Supervisor MVP

목표: lead, engineer, reviewer가 조직처럼 연결된 최소 루프를 만든다.

범위:

- hidden child issue 기반 internal work items
- lead supervisor wake 규칙
- reviewer watch mode
- parent issue에 대한 child execution summary

완료 기준:

- 상위 issue 하나에서 내부 작업 분해와 reviewer 연결이 자동으로 유지된다

### Phase 2. Delivery Contract MVP

목표: review 가능한 handoff를 강제한다.

범위:

- diff summary
- test result
- risk note
- review checklist

완료 기준:

- review 단계에 필요한 근거가 구조적으로 항상 남는다

### Phase 3. Real Repo Execution Hardening

목표: 실제 repo 수정과 검증을 안전하게 수행한다.

범위:

- isolated worktree/branch
- target repo diff 검증
- 테스트/빌드 결과 캡처
- retry 정책

완료 기준:

- target repo에서 실제 코드 변경과 검증 로그가 남는다

### Phase 4. Operations & Visibility

목표: 운영자가 DB를 직접 보지 않고도 squad 상태를 파악하게 만든다.

범위:

- mailbox UI
- recovery queue
- team board
- 실패/SLA 메트릭

완료 기준:

- 운영자가 stuck run과 blocked handoff를 UI에서 바로 파악한다

## 상태 요약

- `Phase 0` 핵심 산출물 완료
  - preflight 예외 explicit failure 처리
  - checkpoint event / run lease / orphan reaper 보강
  - 실서버에서 `schedule -> dispatch -> entered -> checkpoint -> lease heartbeat -> success` 검증
- `Phase 1 / Slice 1` 완료
  - `hidden child issue` 기반 internal work item 생성 API 추가
  - reserved label 자동 보장 (`team:internal`, `work:*`, `watch:*`)
  - root issue detail에 internal work item summary / child list 추가
  - route contract 테스트, 전체 typecheck, 전체 test, build 통과
- `Phase 1 / Slice 2` 완료
  - hidden child issue assignment에서 reviewer `watch wake` 활성화
  - child issue 주요 protocol event에 대해 tech lead supervisor wake 주입
  - child issue run `failed / timed_out / process_lost` 시 tech lead supervisor wake 추가
  - internal work item 생성 시 root tech lead ownership 상속 보강
- `Phase 1 / Slice 3` 완료
  - `SUBMIT_FOR_REVIEW`에 `changedFiles`, `testResults`, `diffSummary`, `reviewChecklist`, `residualRisks` 최소 handoff 계약 강제
  - `APPROVE_IMPLEMENTATION` 시 최신 review submission 계약 완전성 재검증
  - legacy review submission은 기존 evidence bar를 유지한 채 승인 호환성 보장
  - reviewer brief retrieval query에 residual risk / test evidence 반영
  - Issue detail timeline에서 review handoff를 구조적으로 노출
  - engineer role pack / skill docs를 새 handoff contract 기준으로 정렬
- `Phase 2 / Slice 1` 완료
  - `REQUEST_CHANGES`에 `reviewSummary`, `requiredEvidence`, file-level follow-up 계약 강제
  - `APPROVE_IMPLEMENTATION`에 `approvalChecklist`, `verifiedEvidence`, `residualRisks` 계약 강제
  - `CLOSE_TASK`에 `closureSummary`, `verificationSummary`, `rollbackPlan` 계약 강제
  - Issue detail timeline / board console / role pack / skill docs를 delivery loop 계약 기준으로 정렬
- `Phase 2 / Slice 2` 완료
  - engineer가 자기 자신에게 보내는 `START_IMPLEMENTATION`이 `skip_sender`로 소실되지 않고 `implementation_followup` wake로 이어지도록 조정
  - same-agent issue execution coalescing에 `forceFollowupRun` 예외를 추가해 analysis run 뒤에 구현 run이 따로 생성되도록 보강
  - agent protocol message에 현재 heartbeat run 기준 `run`, `workspace binding`, `test_run`, `build_run` artifact 자동 첨부
  - route/dispatch/heartbeat 경계 테스트 추가로 self-followup implementation run과 auto artifact capture 회귀 고정
- 잔여 주의사항
  - 개발 서버 재기동 직후 간헐 `claim-only` 관찰이 있어 cold-start 구간은 계속 관찰 필요
  - richer shell command 수준의 verification artifact 캡처와 실제 repo diff 검증은 `Phase 3`에서 계속 강화

## Phase 1 세부 슬라이스

1. Slice 1 완료
   - hidden child issue 생성
   - parent summary 노출
   - UI read path 연결
2. Slice 2 완료
   - reviewer watch wake rule
   - lead supervisor wake rule
   - child issue 주요 protocol event 기반 supervision
3. Slice 3 완료
   - reviewer/lead handoff artifact 최소 계약
   - child issue review evidence/테스트 결과 의무화

## 현재 진행 순서

1. Phase 0
2. Phase 1
3. Phase 2
4. Phase 3
5. Phase 4

## Phase 1 설계 원칙

1. 새 `team_runs/mailbox`를 바로 만들지 않는다.
2. 기존 `issues.parentId + hiddenAt + protocol + retrieval + heartbeat`를 최대한 재사용한다.
3. 내부 병렬 작업은 `hidden child issue`로 먼저 모델링한다.
4. reviewer는 `notify_only` 대신 `watch` 성격의 wakeup으로 조기 참여시킨다.
5. tech lead는 child issue의 주요 protocol event를 자동 감독한다.

## Phase 0 작업 순서

1. preflight 예외가 orphan로 남는 구간 제거
2. checkpoint event 추가
3. 실패 payload에 phase 정보 남기기
4. analysis run 재검증
5. 그 다음 DB lease/recovery 보강
