---
title: "P2 Autonomy Fallback Hardening Plan"
owner: "taewoong"
status: "active"
last-reviewed: "2026-03-19"
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
