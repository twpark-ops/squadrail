# P0-C Separate QA Gate

## 목표

`reviewer`와 `qa`를 같은 review lane에 두지 않고, 필요 시 QA를 별도 강제 품질 게이트로 승격한다.

이 단계가 닫혀야 `Reviewer -> QA -> Close`가 명시적인 조직 루프로 동작한다.

## 정책

- `qaAgentId`가 없는 이슈:
  - 기존과 동일한 `Reviewer -> approved -> Close`
- `qaAgentId`가 있는 이슈:
  - `Reviewer APPROVE_IMPLEMENTATION`
  - `under_review -> qa_pending`
  - QA가 `START_REVIEW`
  - `qa_pending -> under_qa_review`
  - QA가 `REQUEST_CHANGES` 또는 `APPROVE_IMPLEMENTATION`
  - 최종 승인 시에만 `approved`

## 상태 전이

1. `submitted_for_review -> under_review`
   - reviewer가 primary review 시작
2. `under_review -> qa_pending`
   - reviewer approval, QA gate 존재, human override 아님
3. `qa_pending -> under_qa_review`
   - assigned QA starts review
4. `under_qa_review -> changes_requested`
   - QA changes requested
5. `under_qa_review -> approved`
   - QA final approval

## 구현 범위

- protocol state에 `qaAgentId` 추가
- `ASSIGN_TASK`, `REASSIGN_TASK` payload에 QA owner 추가
- reviewer approval이 `qa_pending`으로 승격되도록 상태머신 조정
- QA 전용 follow-up wake 추가
- timeout rule에 `qa_pending`, `under_qa_review` 추가
- dashboard / workspace profile / protocol run requirement에 QA 상태 반영

## 실행 의미

- QA는 assignment 시점에는 `notify_only`
- reviewer approval 뒤에만 `issue_ready_for_qa_gate` wake를 받는다
- TL close follow-up은 `approved`일 때만 동작한다

즉 reviewer approval은 더 이상 곧바로 close candidate가 아니라, QA gate가 있는 경우 QA handoff가 된다.

## 검증 포인트

- reviewer approval + `qaAgentId` 설정 시 `qa_pending`
- `approval_close_followup`은 발생하지 않음
- `qa_gate_followup`만 발생
- QA timeout은 reviewer timeout과 같은 code를 공유하되 QA recipient로 발송

## 남은 후속

1. human board / operator UI에서 QA lane을 더 명확히 보여주는 시각화
2. QA 결과를 organizational memory feedback으로 더 강하게 반영
3. QA 별도 artifact contract 여부 재검토

