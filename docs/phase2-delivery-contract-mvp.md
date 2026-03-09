# Phase 2 Delivery Contract MVP

작성일: 2026-03-10

## 목표

Phase 2의 목표는 `delivery loop`를 구조화된 계약으로 강제하는 것이다.

핵심 질문은 세 가지다.

1. reviewer가 왜 변경을 요청했는지 구조적으로 남는가
2. approval이 어떤 검증 근거 위에서 내려졌는지 남는가
3. closure가 어떤 검증/rollback 계획 위에서 닫혔는지 남는가

## Slice 구성

### Slice 1. Review / Approval / Close contract

이번 턴에 완료한 범위:

- `SUBMIT_FOR_REVIEW`
  - `implementationSummary`
  - `evidence[]`
  - `diffSummary`
  - `changedFiles[]`
  - `testResults[]`
  - `reviewChecklist[]`
  - `residualRisks[]`
- `REQUEST_CHANGES`
  - `reviewSummary`
  - `requiredEvidence[]`
  - `changeRequests[]`마다 `affectedFiles[]` 또는 `suggestedAction`
- `APPROVE_IMPLEMENTATION`
  - `approvalChecklist[]`
  - `verifiedEvidence[]`
  - `residualRisks[]`
- `CLOSE_TASK`
  - `closureSummary`
  - `verificationSummary`
  - `rollbackPlan`

부가 반영:

- protocol policy 검증
- retrieval query 확장
- Issue detail timeline 구조화 노출
- board action console 입력 확장
- role pack / skill / API 문서 정렬

### Slice 2. Evidence capture + execution binding

다음 작업 범위:

- `START_IMPLEMENTATION`과 실제 workspace/worktree binding 강화
- test/build 결과를 protocol artifact로 자동 캡처
- close 전 verification artifact completeness를 더 엄격히 검사

## 완료 기준

Phase 2 전체 완료 기준:

1. `START_IMPLEMENTATION -> SUBMIT_FOR_REVIEW -> REQUEST_CHANGES/APPROVE_IMPLEMENTATION -> CLOSE_TASK` 전 구간이 구조화된 계약으로 남는다.
2. reviewer, tech lead, human board가 각 단계에서 필요한 근거를 Issue detail 하나만으로 읽을 수 있다.
3. 자동 agent가 role pack / skill 문서 기준으로 새 계약을 따라 protocol payload를 생성한다.
