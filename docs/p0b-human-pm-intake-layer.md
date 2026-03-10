# P0-B Human -> PM Intake Layer

## 목표

사람이 모호한 요청만 줘도 root issue를 만들고, PM lane으로 자동 assignment하여 구조화 run을 시작한다.

## 현재 상태

`P0-B`는 두 슬라이스로 나눠 구현했다.

- `Slice 1` 완료
  - freeform human request intake
  - active PM / reviewer-capable agent 선택
  - root intake issue 생성
  - PM lane `ASSIGN_TASK` 자동 부착
- `Slice 2` 완료
  - PM structuring 결과를 root issue enrichment로 반영
  - TL lane `REASSIGN_TASK` 자동 부착
  - hidden child work item 자동 projection
  - optional QA gate owner 연결

## 이번 문서 범위

이 문서는 `single root issue enrichment + hidden child projection`까지 포함한다.

포함:

- human freeform request 전용 API
- active PM / reviewer-capable agent 자동 선택
- intake root issue 생성
- PM lane `ASSIGN_TASK` 자동 부착
- 기존 brief / wake / protocol dispatch 재사용

미포함:

- intake 전용 UI form
- PM clarification 전용 별도 workflow state
- projection 결과를 PM agent용 helper command로 감싼 전용 CLI

## API

### `POST /api/companies/:companyId/intake/issues`

입력:

- `request`
- `title?`
- `projectId?`
- `goalId?`
- `priority?`
- `relatedIssueIds?`
- `requiredKnowledgeTags?`
- `pmAgentId?`
- `reviewerAgentId?`
- `requestedDueAt?`

출력:

- `issue`
- `protocol`
- `warnings`
- `intake.pmAgentId`
- `intake.reviewerAgentId`

### `POST /api/issues/:id/intake/projection`

입력:

- `reason`
- `techLeadAgentId`
- `reviewerAgentId`
- `qaAgentId?`
- `carryForwardBriefVersion?`
- `root`
  - `structuredTitle?`
  - `projectId?`
  - `priority?`
  - `executionSummary`
  - `acceptanceCriteria[]`
  - `definitionOfDone[]`
  - `risks[]?`
  - `openQuestions[]?`
  - `documentationDebt[]?`
- `workItems[]`

출력:

- `issue`
- `protocol`
- `warnings`
- `projectedWorkItems`
- `intakeProjection.techLeadAgentId`
- `intakeProjection.reviewerAgentId`
- `intakeProjection.qaAgentId`

## 동작

1. active PM agent 선택
2. active reviewer-capable QA/TL 선택
3. intake labels 보장
   - `workflow:intake`
   - `lane:pm`
   - `source:human_request`
4. root issue 생성
5. `ASSIGN_TASK` to PM
6. PM brief / retrieval / wake 실행

Projection:

1. visible root intake issue만 허용
2. root issue title / description / project / priority enrichment
3. TL lane `REASSIGN_TASK`
4. hidden child work item 생성
5. child work item `ASSIGN_TASK`
6. optional QA gate owner 전달

## 선택 규칙

### PM

- 명시된 `pmAgentId` 우선
- 없으면 active PM 중 top-level PM 우선

### Reviewer

- 명시된 `reviewerAgentId` 우선
- 없으면 active QA lead
- 다음 active QA
- 다음 reviewer-capable tech lead

## 설계 이유

- 새 intake 전용 테이블 없이 기존 `issue + protocol` 커널을 재사용한다.
- PM이 이미 direct assignment wake에서 `REASSIGN_TASK / ASK_CLARIFICATION / ESCALATE_BLOCKER`를 우선 수행하도록 role pack이 준비돼 있다.
- `Slice 2`도 새 intake 전용 테이블 없이 기존 `issue + protocol + hidden child work item` 커널을 재사용한다.
- root issue를 execution summary가 있는 canonical container로 유지하고, 실제 분해는 child work item으로 projection하는 편이 추적과 E2E에 유리하다.

## 다음 확장

1. intake UI surface
2. PM clarification 전용 interaction pattern
3. QA separate gate와 결합한 full upstream-downstream org loop
