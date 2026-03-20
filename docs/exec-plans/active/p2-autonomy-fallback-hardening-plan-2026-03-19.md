---
title: "P2 Autonomy Fallback Hardening Plan"
owner: "taewoong"
status: "active"
last-reviewed: "2026-03-20"
author: "Taewoong Park (park.taewoong@airsmed.com)"
date: "2026-03-19"
lang: "ko"
CJKmainfont: "Noto Sans CJK KR"
mainfont: "Noto Sans"
---

# Goal

canonical stabilization은 끝났지만, real-org E2E는 아직 deterministic fallback에 의존하는 구간이 남아 있다.
이 계획의 목표는 제품 계약을 깨지지 않게 유지하면서도, scripted fallback 없이 자율적으로 닫히는 비율을 올리는 것이다.

# Scope

## In

- PM routing fallback
- TL staffing / engineer wake fallback
- review submission and reviewer approval fallback
- QA approval fallback
- `approved -> CLOSE_TASK` fallback
- fallback 발생량 계측과 시나리오별 요약 출력

## Out

- retrieval relevance 자체의 점수 조정
- 새로운 product surface 추가
- 새로운 agent role model 설계
- public auth or signup hardening

# Invariants

- fallback을 줄이는 과정에서 canonical 5시나리오 green을 깨면 안 된다.
- `approved -> close`는 stale task session을 재사용하면 안 된다.
- `changes_requested` 이후 recover owner는 항상 존재해야 한다.
- QA gate가 있는 이슈는 QA decision 없이 close 되면 안 된다.
- symptom-first routing 시나리오는 입력에 project 힌트를 넣지 않는다.

# Fallback Families

## 1. PM Routing

- `assigned state persisted without PM routing`
- 의도: PM projection / route follow-up이 스스로 발생해야 한다.

## 2. TL Staffing and Engineer Wake

- `TL lane stayed assigned without engineer execution`
- `assigned state still lacks engineer execution after staffing`
- 의도: TL staffing 이후 engineer wake가 별도 board intervention 없이 이어져야 한다.

## 3. Review Handoff

- `implementing state stalled without SUBMIT_FOR_REVIEW`
- `review stage stalled in submitted_for_review`
- 의도: engineer implementation run이 증빙과 함께 review로 자연스럽게 넘어가야 한다.

## 4. QA Gate

- `QA gate stalled in qa_pending`
- 의도: reviewer approval 이후 QA start / QA decision이 follow-up wake로 이어져야 한다.

## 5. Closure

- `approved persisted after approval without CLOSE_TASK`
- 의도: close follow-up이 watcher wake에 덮이지 않고 closure agent로 바로 이어져야 한다.

# Implementation Plan

1. fallback 발생 지점을 시나리오별로 계수해 summary에 남긴다.
2. `cloud-swiftsight-real-org.mjs`와 `cloud-swiftsight-domain-aware-pm-eval.mjs`에서 fallback family별 카운터를 추가한다.
3. `scripts/e2e/canonical-repeat` 출력에 iteration별 fallback summary를 포함한다.
4. 가장 많이 발생하는 fallback부터 server-side 원인을 역추적한다.
5. 필요한 경우 protocol dispatch, wake enqueue, heartbeat session reset, reviewer/QA follow-up 경로를 server에서 먼저 수정한다.
6. 수정 후 fallback count expectation을 focused test와 E2E assertion에 반영한다.
7. 최종적으로 canonical bundle이 green이면서 fallback count가 기준 이하인지 확인한다.

# Validation

- `pnpm exec vitest run --config scripts/e2e/vitest.config.ts scripts/e2e/__tests__/*.test.ts`
- `pnpm e2e:full-delivery`
- `SWIFTSIGHT_PM_EVAL_SCENARIO=workflow_mismatch_diagnostics pnpm e2e:cloud-swiftsight-domain-aware-pm-eval`
- `SWIFTSIGHT_E2E_SCENARIO=swiftsight-cloud-pm-tl-change-recovery-loop pnpm e2e:cloud-swiftsight-real-org`
- `ITERATIONS=3 pnpm e2e:canonical-repeat`
- `pnpm docs:check`

# Exit Criteria

- canonical 5시나리오가 계속 green이다.
- repeat harness가 fallback family별 count를 출력한다.
- `close fallback`, `QA fallback`, `reviewer approval fallback` 중 최소 하나는 제거되거나 steady-state zero가 된다.
- 남은 fallback은 의도와 원인이 문서화되어 `tech-debt-tracker.md`에서 추적된다.

# Notes

- 이 계획은 retrieval stabilization보다 우선순위가 높지 않다.
- 다만 자율 진행률을 올리는 reliability debt이므로, retrieval과 병렬로 작은 배치로 소거할 수 있다.

# Current Status

- fallback family summary와 scenario별 count는 실제 E2E 출력에 포함되도록 구현했다.
- fallback event는 이제 active run diagnostic도 포함한다.
  - `runId`
  - `status`
  - `agentId / agentName`
  - `wakeReason / adapterRetryCount / adapterRetryErrorCode`
  - `latestEventType / latestEventMessage`
  - `checkpointPhase / checkpointMessage`
- fallback summary는 이제 runtime degraded count도 함께 남긴다.
  - `adapter_retry`
  - `claude_stream_incomplete`
- active run route는 이제 `leaseStatus / checkpoint / leaseHeartbeatAt / latestEvent`를 함께 내려 fallback 시점의 active run 상태를 직접 보여준다.
- active run route는 이제 `runtimeDegradedState / runtimeHealth`도 함께 내려준다.
  - 예: `claude_stream_incomplete_retry_loop`
  - 예: `recovered_supervisory_invoke_stall`
- real-org harness는 이제 `runtimeDegradedState / runtimeHealth`를 보고 short-circuit fallback policy를 적용한다.
  - 목표: degraded supervisory lane을 더 이상 full timeout까지 기다리지 않고 바로 deterministic handoff로 넘긴다.
  - 범위: `routing_reassign`, `staffing_reassign`, `engineer_wake`, `implementation_start`, `review_submission`, `reviewer_approval`, `qa_approval`, `close`
- 짧은 protocol lane 전용 idle watchdog을 heartbeat per-run timer로 올렸다.
  - 포함: routing, staffing, reviewer, QA, close
  - 제외: 장시간 구현이 가능한 `implementation_engineer`
- supervisory lane에서 `adapter_retry`가 반복되고 age threshold를 넘기면 `protocol_required_retry`로 승격하는 degraded recovery를 추가했다.
  - 조건: short lane + retry-eligible workflow + adapter/preflight phase + degraded threshold 초과
  - `claude_stream_incomplete`는 `adapterRetryCount >= 1`부터 degraded로 본다.
  - degraded recovery는 `protocolRequiredRetryCount`와 별도 1회 budget(`protocolDegradedRecoveryCount`)를 쓴다.
  - 현재는 `implementation_engineer`는 제외한다.
- `swiftsight-agent-tl-qa-loop`는 현재 기준 `total=7` fallback으로 측정된다.
  - `pm_routing: 1`
  - `staffing_and_wake: 2`
  - `review_handoff: 2`
  - `qa_gate: 1`
  - `closure: 1`
- role pack refresh, runtime note 강화, protocol retry contract 보강까지 반영했지만 reviewer/QA/closure fallback은 아직 steady-state zero가 아니다.

# Findings

- 남은 reviewer/QA/closure fallback의 직접 원인은 "필요한 메시지를 모르거나 validation이 막아서"가 아니라, active heartbeat run이 intermediate action 이후 끝나지 않고 멈추는 경우가 많다는 점이다.
- 특히 아래 intermediate action은 이제 제품 계약상 "불완전"으로 간주한다.
  - engineer assignment/reassignment에서 `ACK_ASSIGNMENT`
  - reviewer/QA lane에서 `START_REVIEW`
- 다만 위 contract 강화는 run이 **종료된 뒤** retry를 거는 성격이므로, active run이 장시간 멈춘 경우까지 즉시 해결하지는 못한다.
- 최신 재검증(`CLO-171`)에서 active run API는 아래를 보여줬다.
  - `leaseStatus: executing`
  - `checkpoint.phase: adapter.invoke`
  - `checkpoint.lastProgressAt`는 실제로 계속 advance
  - `wakeReason: adapter_retry`
  - `adapterRetryCount: 2`
- 즉 남은 PM/reviewer/QA/close fallback의 상당 부분은 "idle run" 자체보다 `claude_stream_incomplete -> adapter_retry` 계열 runtime degraded state에 더 가깝다.
- 따라서 fallback 수 자체와 별도로 `runtime degraded` count를 함께 봐야 한다.
- 이번 슬라이스 이후에도 fallback이 남는다면, 우선순위는 fallback reason보다 `degraded runtime loop`를 줄이는 쪽으로 잡는다.
- 최신 재검증(`CLO-174`)에서는 watchdog recovery가 실제로 개입한 흔적이 보였다.
  - active run context에 `protocolIdleRecovery: true`
  - `protocolRequiredRetryCount: 1`
  - `adapterRetryCount: 2`
  - `forceFreshAdapterSession: true`
- 다만 recovery 이후에도 같은 supervisory lane run이 다시 `adapter.invoke`에 장시간 머무를 수 있었다.
  - 즉 "recovery enqueue 자체가 안 된다"는 단계는 넘겼고,
  - 남은 문제는 "recovered run이 adapter runtime에서 다시 빠져나오지 못하는 degraded loop"에 더 가깝다.
- 이번 슬라이스로 "recovered run이 degraded loop에 머물 때도 harness가 무한 대기한다"는 운영성 갭은 닫았다.
  - degraded runtime state는 이제 fallback family로 직접 매핑된다.
  - 따라서 남은 문제는 "기다림"이 아니라 "왜 degraded state가 반복되느냐"로 축소된다.
- 최신 재검증(`CLO-175`)에서는 아래가 실제로 확인됐다.
  - `accepted` 상태에서 `recovered_supervisory_invoke_stall`이 관측되자 `implementation_start` fallback이 즉시 short-circuit 되었다.
  - 결과적으로 `ACK_ASSIGNMENT -> START_IMPLEMENTATION` 구간의 full timeout 대기는 사라졌다.
  - 다만 total fallback은 아직 `7`이고, runtime degraded count는 `recovered_supervisory_invoke_stall = 2`였다.

# Next Slice

1. `recovered_supervisory_invoke_stall` 발생률을 시나리오별 KPI로 남기고, repeat harness에서 추세를 확인한다.
2. `protocol recovery applied` 이후에도 같은 issue/role에서 재차 stuck되면 adapter/provider-level degrade로 분류해 tech debt로 추적한다.
3. `adapter_retry`가 남더라도 protocol recovery로 자율 수습되는 비율을 separate KPI로 남긴다.
4. `implementation_engineer` fallback은 별도 slice로 분리한다.
