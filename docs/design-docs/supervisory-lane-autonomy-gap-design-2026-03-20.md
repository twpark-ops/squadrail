---
title: "Supervisory Lane Autonomy Gap Design"
owner: "taewoong"
status: "active"
last-reviewed: "2026-03-20"
author: "Taewoong Park (park.taewoong@airsmed.com)"
date: "2026-03-20"
lang: "ko"
CJKmainfont: "Noto Sans CJK KR"
mainfont: "Noto Sans"
---

# Context

canonical stabilization은 끝났지만, real-org 시나리오 `swiftsight-agent-tl-qa-loop`는 여전히 deterministic fallback `7`개를 사용한다.

최신 관찰은 두 갈래였다.

- `CLO-181`
  - `runtimeDegradedTotal = 0`
  - 남은 reviewer / QA / close fallback은 일시적으로 normal runtime follow-up autonomy debt처럼 보였다.
- `CLO-183`
  - `runtimeDegradedTotal = 3`
  - `supervisoryInvokeStallCount = 3`
  - reviewer / QA / close가 다시 `supervisory_invoke_stall`로 수렴했다.

즉 남은 문제는 단순한 “fallback이 많다”가 아니라, 짧은 supervisory lane이 `adapter.execute_start` 또는 `adapter.invoke`에 오래 머무르면서 decision message를 남기지 못하는 패턴이다.

# Design Decision

## 선택한 방향

P2 남은 debt를 아래 두 층으로 분리한다.

1. `runtime degraded supervisory stall`
2. `normal-runtime follow-up autonomy gap`

먼저 server와 E2E는 두 층을 명확히 구분하는 계측을 강화하고, 그 다음에 current-lane follow-up contract를 좁힌다.

## 이유

- 지금까지는 “runtime degraded인지 아닌지”와 “decision message를 왜 못 남겼는지”가 한 덩어리로 섞였다.
- `supervisory_invoke_stall`을 별도 상태로 올리면, provider/runtime debt와 protocol follow-up debt를 혼동하지 않는다.
- `human_board close`는 repeated runtime failure에 대한 operator review 그 자체이므로, close gate는 이를 막는 쪽보다 인정하는 쪽이 정책 문구와 일치한다.

## 대안

### 대안 A. deterministic fallback을 더 빠르게 보낸다

- 장점: E2E green이 빨라진다.
- 단점: 자율성 debt의 원인을 더 가린다.

### 대안 B. adapter/provider mock으로 전환한다

- 장점: 더 결정적인 재현이 가능하다.
- 단점: 지금 남은 문제는 runtime degraded뿐 아니라 protocol follow-up 계약도 섞여 있으므로, mock만으로는 current-lane stall 원인을 다 드러내지 못한다.

### 선택

- 지금은 **A를 피하고**, **계측 + 계약 분리**를 먼저 한다.
- mock adapter는 별도 reliability plan으로 분리한다.

# Constraints

- canonical 5시나리오 green은 깨지면 안 된다.
- `human_board` close 허용은 failure-learning gate를 무력화하는 것이 아니라, **operator review를 close action 자체로 인정**하는 범위에 한정한다.
- `implementation_engineer`는 장시간 정상 실행이 가능한 lane이므로, short supervisory lane 규칙을 그대로 적용하지 않는다.
- current-lane stall 진단은 false positive가 많아지면 안 된다. `adapter.execute_start`와 `adapter.invoke`만 대상으로 제한한다.

# Runtime Taxonomy

## 1. Provider / Runtime Degraded

- `claude_stream_incomplete_retry_loop`
- `adapter_retry_loop`
- `supervisory_invoke_stall`
- `recovered_supervisory_invoke_stall`

이 그룹은 “lane은 맞지만 adapter/provider 경계에서 의사결정 메시지까지 못 간다”는 뜻이다.

## 2. Follow-up Autonomy Gap

다음 wake는 정상으로 들어왔지만 message를 끝내 못 남겨 deterministic fallback이 개입하는 경우다.

- `reviewer_approval`
- `qa_approval`
- `close`

이 그룹은 runtime degraded 여부와 별개로 추적한다.

# Planned Changes

## Phase A. Measurement Lock

- `supervisory_invoke_stall`를 summary KPI의 1급 항목으로 유지
- fallback 직전 active run에 대해 아래를 더 수집
  - latest event progression
  - checkpoint phase drift
  - protocol helper invocation 흔적
  - last protocol message attempt

### Implementation update — 2026-03-20

- `active-run` route는 이제 fallback 직전 run의 `protocolProgress`를 내려준다.
- `active-run` route는 latest `adapter.invoke` payload 기반 `helperTrace`도 내려준다.
- `active-run` route는 latest `protocol.helper_invocation` run event도 `helperTrace`에 합쳐서 내려준다.
- latest real-org run(`CLO-185`) 기준:
  - reviewer / QA / close lane은 `actorAttemptedAfterRunStart = false`
  - engineer reassignment lane은 `ACK_ASSIGNMENT`
  - implementation lane은 `START_IMPLEMENTATION`
- 따라서 현재 남은 gap은 "decision 이후 유실"보다 `supervisory lane이 decision 시도 전 adapter.invoke에 머무는 문제`로 보는 편이 정확하다.
- 추가로 watchdog recovery chain은 이제 idle/degraded를 독립적으로 시도하므로, idle recovery 예외가 degraded recovery 자체를 막지 않는다.
- protocol helper CLI는 이제 protocol POST마다 helper transport header를 보낸다.
- issue route는 이를 `protocol.helper_invocation` run event로 적재한다.
- 따라서 다음 진단부터는 "helper contract가 prompt/env에 있었는가"와 "실제 helper POST가 서버에 도달했는가"를 분리해서 볼 수 있다.
- latest real-org run(`CLO-187`) 기준 stalled fallback run은 모두 `helperTransportObserved = false`였다.
- 따라서 현재 남은 gap은 "helper POST 이후 decision 유실"보다 `adapter.invoke` 이전 단계에서 shell-level helper execution까지 못 가는 문제`로 더 좁혀졌다.

## Phase B. Current-lane Follow-up Contract

- reviewer / QA / close lane에서
  - `protocol_review_requested`
  - `protocol_implementation_approved`
  - `issue_ready_for_closure`
  wake 이후 expected decision message window를 명시한다.
- 이 window를 넘기면
  - degraded recovery
  - 또는 deterministic fallback
  둘 중 무엇으로 넘길지 lane별로 분리한다.

## Phase C. Provider Boundary Narrowing

- `supervisory_invoke_stall`이 발생한 run에 대해
  - adapter event sequence
  - retry/error code
  - fresh session 여부
  - protocol helper usage
  를 묶어서 provider-side debt인지 protocol-side debt인지 구분한다.

# Implementation Notes

## Server

- `heartbeat.ts`
  - short supervisory lane 분류
  - degraded recovery threshold 정렬
  - current-lane stall recovery gate 추가 후보
- `issue-protocol-policy.ts`
  - `human_board` close와 failure-learning gate 정합성 유지

## E2E Harness

- `cloud-swiftsight-real-org.mjs`
  - fallback 직전 active run diagnostic 수집 강화
  - `REQUEST_HUMAN_DECISION` / `human_board close` 경로를 별도 관찰 포인트로 유지
- `fallback-summary.mjs`
  - stall family별 KPI 유지

## Documentation

- active plan: `../exec-plans/active/p2-autonomy-fallback-hardening-plan-2026-03-19.md`
- debt tracker: `../exec-plans/tech-debt-tracker.md`
- review findings: `../review-findings-2026-03-18.md`

# Risks

- `supervisory_invoke_stall`이 너무 공격적으로 잡히면 legitimate long-running supervisory work를 잘못 취소할 수 있다.
- `human_board` close 허용은 operator review gate를 우회하는 것으로 오해될 수 있으므로 문서와 테스트로 범위를 고정해야 한다.
- live model variability가 남아 있어서 동일 시나리오도 `CLO-181`과 `CLO-183`처럼 다른 진단 결과를 낼 수 있다.

# Validation

- `pnpm --filter @squadrail/server exec vitest run src/__tests__/heartbeat-protocol-progress.test.ts`
- `pnpm --filter @squadrail/server exec vitest run src/__tests__/issue-protocol-policy.test.ts -t "runtime failures"`
- `pnpm exec vitest run --config scripts/e2e/vitest.config.ts scripts/e2e/__tests__/fallback-summary.test.ts`
- `pnpm --filter @squadrail/server typecheck`
- `pnpm docs:check`
- `SQUADRAIL_E2E_BYPASS_RATE_LIMIT=1 SWIFTSIGHT_E2E_SCENARIO=swiftsight-agent-tl-qa-loop pnpm e2e:cloud-swiftsight-real-org`

# Exit Signal

아래 둘 중 하나가 달성되면 이 설계 문서는 completed로 내릴 수 있다.

1. `reviewer_approval`, `qa_approval`, `close` 중 최소 두 개가 deterministic fallback 없이 자율 완료된다.
2. 남은 fallback이 모두 `supervisory_invoke_stall` 또는 명시적 provider/runtime error로 수렴하고, adapter/provider boundary debt로 확정된다.
