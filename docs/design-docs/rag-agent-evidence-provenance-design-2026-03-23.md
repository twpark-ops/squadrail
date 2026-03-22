# RAG Agent Evidence Provenance Design

Status: phase-a baseline implemented, phase-b follow-up active
Last updated: 2026-03-23

## Problem

현재 Squadrail은 아래는 이미 알고 있다.

- 어떤 retrieval run이 생성됐는지
- 어떤 hit가 최종 evidence로 선택됐는지
- 어떤 brief가 agent wake에 주입됐는지

하지만 아직 아래는 직접 증명하지 못한다.

- agent가 brief 안의 어떤 evidence path를 실제로 채택했는지
- retrieval evidence가 review / QA / close payload에 어떤 근거로 이어졌는지
- summary source가 단순 노출이 아니라 실제 decision reasoning에 반영됐는지

즉 현재 상태는 **delivery-side trace는 강하지만 agent-side evidence provenance는 약하다.**

## Current Visibility

현재 확보된 trace:

1. retrieval trace
   - `retrieval_runs`
   - `retrieval_run_hits`
2. brief trace
   - `issue_task_briefs`
   - `retrievalRunId`, `briefId`, `briefScope`
3. wake injection
   - run prompt에 `retrievalRunId`, brief content, evidence summary를 주입
4. outcome trace
   - protocol message payload
   - review / QA / close artifacts

이 구조 덕분에 "무엇을 전달했는지"는 알 수 있다.

## Gap

현재 빈 구간은 아래다.

`brief delivered -> agent reasoning -> protocol payload / review handoff / QA decision`

이 사이에서 우리는 지금 주로 **행동 추론**만 한다.

예를 들면:

- exact path가 맞았다
- top hit가 code였다
- 결과 patch가 그 파일을 수정했다

이건 좋은 간접 지표지만, "어떤 evidence를 근거로 삼았는가"를 직접 남기진 않는다.

## Design Goal

retrieval evidence provenance를 **모델 내부 추론 해석**이 아니라 **agent가 제출하는 구조화된 citation contract**로 끌어올린다.

핵심 원칙:

1. 모델 내부 attention을 추정하려 하지 않는다.
2. 대신 agent action payload에 최소 citation을 남기게 한다.
3. citation은 retrieval/brief trace와 stable identifier로 연결된다.
4. summary source는 raw code evidence를 대체하지 않고 보조 의미층으로만 추적한다.

## Proposed Contract

### 1. Evidence citation payload

아래 protocol payload 계열에 optional citation contract를 추가한다.

- `REPORT_PROGRESS`
- `SUBMIT_FOR_REVIEW`
- `REQUEST_CHANGES`
- `APPROVE_IMPLEMENTATION`
- `CLOSE_TASK`

shape:

```ts
type RetrievalEvidenceCitation = {
  retrievalRunId: string;
  briefId?: string | null;
  citedHitRanks?: number[];
  citedPaths?: string[];
  citedSourceTypes?: string[];
  citedSummaryKinds?: string[];
  citationReason?: string | null;
};
```

### 2. Runtime helper guidance

protocol helper examples와 runtime note에 아래 규칙을 추가한다.

- brief를 근거로 판단했다면 `retrievalRunId`를 유지한다
- review / QA / close payload에는 최소 1개 이상의 `citedPaths` 또는 `citedHitRanks`를 남긴다
- summary source를 근거로 썼다면 `citedSummaryKinds`와 `citationReason`을 남긴다

### 3. Persistence and read surface

최소 1차 구현은 새 테이블 없이 아래에 저장한다.

- protocol message payload
- review/approval artifact payload
- task brief / retrieval run read model join

이후 운영 가치가 높아지면 별도 `retrieval_evidence_citations` read model로 승격할 수 있다.

## Why This Boundary

이 방식은 세 가지 장점이 있다.

1. **Opaque model problem 회피**
   - 모델 내부 추론을 역추적하려 하지 않는다.
2. **Workflow alignment**
   - Squadrail은 이미 protocol payload가 중심이므로, 같은 surface에 citation을 묶는 편이 자연스럽다.
3. **Live proof 가능**
   - real-org E2E에서 "citation이 실제로 남았는지"를 직접 검증할 수 있다.

## Initial Success Metrics

1. review / QA / close message 중 citation 포함 비율
2. citation path와 실제 changed file / review artifact path 일치율
3. summary-enabled scenario에서 `citedSummaryKinds` 등장 비율
4. PM projection / reviewer / QA lane별 citation coverage

## Risks

### 1. Over-reporting

agent가 실제로 보지 않은 evidence를 형식적으로만 채울 수 있다.

완화:

- cited path와 changed files / review diff / approval checklist를 교차 검증한다.

### 2. Payload bloat

citation을 너무 많이 실으면 protocol payload가 비대해질 수 있다.

완화:

- hit rank / path를 상위 몇 개로 제한한다.

### 3. Summary overclaim

natural-language summary가 실제 code evidence보다 앞에 나서는 순간 왜곡이 생길 수 있다.

완화:

- `citedSummaryKinds`는 보조 trace로만 취급하고, code/test/review direct evidence와 별도 계수한다.

## Recommended Rollout

### Phase A

- shared payload contract 추가
- helper/runtime note 예시 추가
- focused protocol validator test

### Phase B

- review / QA / close lane 우선 연결
- citation read surface 추가
- real-org E2E에서 citation presence 검증

### Phase C

- PM projection / domain-aware proof에도 summary citation trace 연결
- summary layer uplift와 citation coverage를 같은 artifact로 비교

## Implementation Status

2026-03-23 기준 아래는 이미 들어갔다.

- shared protocol payload contract에 `evidenceCitations[]` 추가
- protocol helper CLI에 citation option 추가
- runtime note short lane에도 citation guidance 반영
- retrieval query/signals가 `citedPaths`, `citedSourceTypes`, `citedSummaryKinds`, `citationReason`를 읽도록 연결
- focused validator / CLI / runtime note / retrieval tests 추가

아직 남은 것은 아래다.

- citation read surface를 별도 operator view나 proof artifact로 노출하는 것
- real-org E2E에서 citation presence를 공식 gate로 검증하는 것
- PM projection / domain-aware proof에 summary citation trace를 직접 연결하는 것

## Exit Condition

아래가 가능하면 이 설계는 성공이다.

- "agent가 어떤 retrieval evidence를 받았는가"뿐 아니라
- "agent가 어떤 evidence를 근거로 제출했는가"를
- stable `retrievalRunId + briefId + cited path/rank` 기준으로 설명할 수 있다.
