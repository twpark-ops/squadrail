---
title: "QA Gate Sanity Panel Plan"
author: "Taewoong Park (park.taewoong@airsmed.com)"
date: "2026-03-17"
---

# QA Gate Sanity Panel Plan

상태: design draft  
범위: 현재 `Squadrail` 코드 기준 QA gate 표면화 및 sanity evidence UX 설계  
관련 코드:

- [server/src/services/issue-protocol.ts](../server/src/services/issue-protocol.ts)
- [server/src/services/issue-protocol-execution.ts](../server/src/services/issue-protocol-execution.ts)
- [server/src/services/issue-protocol-policy.ts](../server/src/services/issue-protocol-policy.ts)
- [packages/shared/src/protocol-run-requirements.ts](../packages/shared/src/protocol-run-requirements.ts)
- [ui/src/pages/IssueDetail.tsx](../ui/src/pages/IssueDetail.tsx)
- [ui/src/components/ProtocolActionConsole.tsx](../ui/src/components/ProtocolActionConsole.tsx)
- [docs/qa-execution-gate-design.puml](./qa-execution-gate-design.puml)

## 1. 목표

QA gate를 “프로토콜 안에만 있는 상태”에서 꺼내서, 사용자가 실제로 다음을 볼 수 있게 만든다.

1. QA gate가 열렸는지
2. 누가 QA owner인지
3. 무엇을 실행해야 하는지
4. 어떤 evidence가 필요한지
5. QA가 승인/변경 요청 시 무엇을 남겼는지

## 2. 현재 상태 (AS-IS)

현재 QA gate의 핵심 백엔드 흐름은 이미 있다.

### 2.1 Reviewer approval이 QA gate로 라우팅된다

`qaAgentId`가 설정된 이슈에서 reviewer가 `APPROVE_IMPLEMENTATION`을 보내면 `qa_pending`으로 간다.

- 상태 전이 규칙: [server/src/services/issue-protocol.ts](../server/src/services/issue-protocol.ts#L75)
- follow-up wake 생성: [server/src/services/issue-protocol-execution.ts](../server/src/services/issue-protocol-execution.ts#L404)
- 테스트: [server/src/__tests__/issue-protocol-execution.test.ts](../server/src/__tests__/issue-protocol-execution.test.ts#L559)

### 2.2 QA는 별도 run contract를 가진다

QA recipient는 `START_REVIEW`로 시작하고, 이후:

- `APPROVE_IMPLEMENTATION`
- `REQUEST_CHANGES`
- `REQUEST_HUMAN_DECISION`

중 하나를 내야 한다.

- 계약: [packages/shared/src/protocol-run-requirements.ts](../packages/shared/src/protocol-run-requirements.ts#L128)

### 2.3 QA evidence policy가 이미 있다

QA는 단순 코멘트만 남기면 안 된다.

- QA approval에는 `executionLog`, `outputVerified`, `sanityCommand` 중 하나가 필요
- QA change request에는 `executionLog` 또는 `failureEvidence`가 필요

- 정책: [server/src/services/issue-protocol-policy.ts](../server/src/services/issue-protocol-policy.ts#L185)

### 2.4 UI는 일부만 있다

현재 UI에서 QA 상태는 부분적으로 보인다.

- delivery party에서 QA gate 설명: [ui/src/pages/IssueDetail.tsx](../ui/src/pages/IssueDetail.tsx#L379)
- ProtocolActionConsole은 QA 상태 전이를 알고 있음: [ui/src/components/ProtocolActionConsole.tsx](../ui/src/components/ProtocolActionConsole.tsx#L176)

하지만 아직 없다.

- dedicated QA gate panel
- sanity profile / fixture picker
- evidence-centric QA summary card
- QA가 실제 무엇을 검증해야 하는지 한눈에 보이는 UI

## 3. 핵심 원칙

문서 설계 의도는 분명하다.

- QA는 second reviewer가 아니다.
- QA는 실제 프로그램을 실행하고,
- 프로젝트가 정한 tool/fixture/runbook을 사용하고,
- structured evidence를 남겨야 한다.

근거:

- [docs/qa-execution-gate-design.puml](./qa-execution-gate-design.puml#L25)

## 4. 목표 모델 (TO-BE)

## 4.1 IssueDetail에 QA Gate Panel 추가

노출 조건:

- `workflowState === "qa_pending"`
- `workflowState === "under_qa_review"`
- 또는 latest protocol message가 QA evidence를 포함

패널 구성:

- current QA owner
- gate status (`queued`, `in review`, `changes requested`, `approved`)
- required evidence checklist
- selected sanity profile
- fixture/runbook summary
- last QA decision summary

## 4.2 QA Action Surface를 evidence-first로 바꾼다

현재 `ProtocolActionConsole`는 generic action form이다.  
QA 상태에서는 더 특화된 입력이 필요하다.

권장 입력 블록:

- `Sanity command`
- `Fixture used`
- `Execution log`
- `Output verified`
- `Failure evidence`
- `Residual risk`

즉 QA panel은 “승인/반려 버튼”보다 **실행 근거 입력**이 먼저여야 한다.

## 4.3 Project QA Contract는 단계적으로 간다

현재 문서 의도상 프로젝트별 QA contract가 필요하지만, 바로 편집기부터 만드는 것은 크다.

### Q1. Read-only contract surface

우선은 아래만 노출한다.

- recommended sanity steps
- runbook links
- expected evidence

source는:

- project metadata
- linked docs
- static config

중 하나를 읽어도 된다.

### Q2. Structured project QA contract

그 다음에야 아래 구조를 도입한다.

```ts
interface ProjectQaContract {
  projectId: string;
  sanityProfiles: Array<{
    key: string;
    label: string;
    description: string;
    fixtureKeys: string[];
    runbookUri?: string | null;
    commandTemplate?: string | null;
    checkerSummary?: string | null;
  }>;
}
```

### Q3. Fixture-aware execution

마지막에:

- fixture selection
- execution trace
- checker result

까지 넣는다.

## 5. 상세 UX

## 5.1 QA Gate Panel

위치:

- `IssueDetail > Work`
- `ChangeReviewDesk`와 같은 위계 또는 바로 위

구성:

1. `Gate status`
2. `Owner`
3. `Required evidence`
4. `Sanity profile`
5. `Runbook / fixture / commands`
6. `Latest QA decision`

## 5.2 QA Evidence Card

QA가 승인 또는 변경 요청을 남기면, protocol feed 외에 요약 카드가 보여야 한다.

예:

- `sanityCommand: pnpm test:smoke`
- `fixtureUsed: fixture_dicom_ct_small`
- `outputVerified: expected ingest logs confirmed`
- `failureEvidence: timeout in probe stage`

## 5.3 QA Decision Composer

QA 상태에서는 generic form 대신 전용 quick form이 낫다.

버튼:

- `Start QA`
- `Request changes`
- `Approve QA gate`
- `Escalate to human`

입력:

- summary
- evidence
- artifacts

## 6. 구현 순서

### Q1. Surface-only QA gate

목표:

- IssueDetail에 QA Gate Panel 추가
- existing protocol payload를 evidence card로 재구성
- 새 DB 스키마 없이 시작

영향 파일:

- [ui/src/pages/IssueDetail.tsx](../ui/src/pages/IssueDetail.tsx)
- [ui/src/components/ProtocolActionConsole.tsx](../ui/src/components/ProtocolActionConsole.tsx)

### Q2. QA contract read model

목표:

- 프로젝트별 sanity/runbook/evidence expectations read model 추가
- QA panel에서 read-only로 노출

영향 파일:

- server project service / route
- shared type
- issue detail

### Q3. Fixture-aware QA execution

목표:

- fixture selection
- execution trace
- richer artifact summary

이 단계는 이후 별도 실행 contract까지 포함한다.

## 7. 테스트 시나리오

### 7.1 Protocol to UI

1. reviewer approval
2. state = `qa_pending`
3. IssueDetail에서 QA Gate Panel 노출 확인
4. QA owner, required evidence, waiting copy 확인

### 7.2 QA approve path

1. QA starts review
2. `under_qa_review`
3. QA approval payload에 `executionLog` 또는 `sanityCommand` 포함
4. evidence card 노출 확인
5. state = `approved`

### 7.3 QA request changes path

1. QA starts review
2. `REQUEST_CHANGES`
3. `executionLog` 또는 `failureEvidence` 포함
4. engineer lane reopen 확인

## 8. 리스크

| 리스크 | 설명 | 대응 |
|---|---|---|
| QA가 reviewer처럼 보일 수 있음 | code review와 실행 검증이 혼재 | copy와 panel 구조를 evidence-first로 설계 |
| fixture model이 너무 빨리 커질 수 있음 | project contract까지 한 번에 벌어짐 | Q1/Q2/Q3 단계 분리 |
| protocol payload만으로 UX가 거칠 수 있음 | field naming이 low-level | panel read model에서 재구성 |

## 9. 권장 결론

QA gate는 이미 백엔드적으로는 충분히 들어와 있다.  
지금 필요한 것은 “새 QA 상태”가 아니라:

1. QA gate를 눈에 보이게 만들고
2. QA가 남긴 실행 근거를 잘 읽히게 하고
3. 프로젝트별 sanity contract를 단계적으로 surface에 올리는 것

이다.
