---
title: "RAG Meaning Layer Live Proof Follow-up"
owner: "Taewoong Park"
status: "active"
last-reviewed: "2026-03-23"
---

# Goal

`code_summary` / `symbol_summary` 기반 의미층을 제품 수준으로 마감한다. 남아 있는 live proof follow-up을 닫아, summary layer가 실제 PM projection과 retrieval 품질에 연결되고 cleanup 뒤 follow-up run 누수 없이 반복 검증 가능한 상태로 만든다.

# Scope

## In

- hidden child issue cleanup 뒤 queued/running follow-up run이 다시 붙는 경로 추적 및 수정
- `domain-aware proof only`와 `rag-readiness` 검증 경로 분리
- summary hit를 PM project candidate scoring / projection surface에 더 직접 반영
- agent가 실제로 어떤 retrieval evidence를 근거로 제출했는지 추적하는 citation/provenance 계약 추가
- baseline vs summary-enabled proof artifact 갱신
- 관련 retrieval / PM / proof runner 문서와 상태 동기화

## Out

- 외부 semantic code search를 retrieval kernel로 교체
- generic code chat UI 추가
- QA contract 제품화
- retrieval kernel 전체 재작성

# Invariants

- 제품 로직은 회사명/slug 하드코딩 없이 generic contract만 사용한다.
- summary source는 raw code / symbol graph 위에 추가되는 의미층이어야 하며, direct code/test/review evidence를 압도하면 안 된다.
- 검증과 상태 변경은 UI / CLI / HTTP API 경로만 사용한다.
- proof는 같은 scenario set에서 baseline과 summary-enabled fixture를 비교 가능해야 한다.

# Remaining Work

1. `rag-natural-language-code-summary-progress.md`와 `next-session-handoff.md` 사이 Phase 5 상태 불일치를 정리한다.
2. hidden child issue cleanup 뒤 follow-up run이 다시 붙는 root cause를 추적한다.
3. `domain-aware proof only` runner와 `rag-readiness` runner를 분리해 proof axis를 독립시킨다.
4. summary hit / summary metadata가 PM project candidate scoring과 projection preview에 직접 반영되도록 보강한다.
5. baseline/current artifact를 다시 생성하고, 개선/회귀/잔여 debt를 문서에 반영한다.

# Progress

- retrieval evidence citation contract baseline shipped
  - shared payload / validator / helper CLI / runtime note / retrieval signal wiring 완료
  - focused tests:
    - `protocol-review-handoff-contract.test.ts`
    - `protocol-helper-cli.test.ts`
    - `squadrail-runtime-note.test.ts`
    - `retrieval-query.test.ts`
    - heavy `issue-retrieval.test.ts`
- citation read surface shipped
  - `issue-change-surface` retrieval context가 protocol payload citation summary를 노출한다.
  - `IssueDetail` retrieval panel이 cited message/path/latest decision을 보여준다.
  - focused tests:
    - `issue-change-surface.test.ts`
    - targeted heavy `issues-routes.test.ts`
- proof axis split started
  - `cloud-swiftsight-domain-aware-proof-only.mjs`를 추가해 domain-aware proof를 `rag-readiness`와 분리된 명령으로 실행할 수 있게 했다.
  - `cloud-swiftsight-rag-readiness.mjs`는 protocol citation coverage를 summary artifact로 남긴다.
  - focused tests:
    - `rag-readiness-utils.test.ts`
- live citation gate wiring shipped
  - `rag-readiness`가 follow-up / replay issue에서 `APPROVE_IMPLEMENTATION + CLOSE_TASK` citation coverage를 실제 pass/fail gate로 본다.
  - focused tests:
    - `rag-readiness-utils.test.ts`
- state-aware supervisory follow-up shipped
  - reviewer `APPROVE_IMPLEMENTATION` helper 기본값이 QA gate 존재 시 `qa_pending`으로 정렬된다.
  - `review_reviewer` / `qa_gate_reviewer` short lane은 이미 `under_review` / `under_qa_review` 상태면 `START_REVIEW`를 반복하지 않고 decision helper부터 제안한다.
  - QA short lane은 reviewer-approved verification command를 runtime note와 helper payload에 직접 주입한다.
  - focused tests:
    - `protocol-helper-cli.test.ts`
    - `squadrail-runtime-note.test.ts`
  - live rerun note:
    - `CLO-236` local rerun에서 reviewer approval은 `qa_pending`으로 정상 승격됐고, QA `START_REVIEW` payload가 reviewer-approved verification command를 직접 사용했다.
    - 최종 `rag-readiness` artifact refresh는 새 rerun에서 계속 진행 중이며, 남은 일은 full live proof summary 재생성과 artifact 문서 갱신이다.

# Implementation Plan

1. 현재 proof/runner/cleanup 경로를 static recon해서 남은 Phase 5 범위를 코드 기준으로 좁힌다.
2. hidden child issue cleanup과 follow-up wake/run enqueue 경로를 계측하고 focused regression test를 추가한다.
3. domain-aware proof와 rag-readiness runner를 분리해 각자 독립 artifact를 남기게 한다.
4. PM projection scoring에서 summary source와 summary metadata trace를 먼저 읽도록 연결하고 focused tests를 추가한다.
5. live proof를 재실행해 baseline 대비 개선/회귀를 기록하고, 종료 시 문서를 `completed/`로 이동한다.

# Validation

- `pnpm --filter @squadrail/server typecheck`
- `pnpm docs:check`
- retrieval / PM focused tests
- protocol payload / review-flow focused tests
- `pnpm e2e:cloud-swiftsight-rag-readiness`
- `pnpm e2e:cloud-swiftsight-domain-aware-pm-burn-in`

# Exit Criteria

- hidden child issue cleanup 뒤 residual queued/running follow-up run이 남지 않는다.
- `domain-aware proof only`와 `rag-readiness`가 서로 독립된 artifact와 판단 기준을 가진다.
- summary-enabled fixture가 PM projection / project selection에서 baseline 대비 개선 근거를 남긴다.
- review / QA / close payload에서 retrieval evidence citation이 stable `retrievalRunId + cited path/rank` 기준으로 남는다.
- progress / handoff / active plan 상태가 서로 모순되지 않는다.
