# Full Delivery E2E Plan

작성일: 2026-03-10

## 목적

이 문서는 `상위 issue -> squad assignment -> implementation worktree -> review -> approval -> close`까지 실제 agent run으로 검증하는 golden E2E의 설계와 성공 기준을 정리한다.

이 E2E의 목적은 세 가지다.

1. Control plane이 아니라 delivery runtime이 실제로 닫히는지 확인한다.
2. implementation run이 shared checkout이 아니라 isolated workspace에서 실제 diff를 남기는지 확인한다.
3. review / approval / close contract가 artifact와 함께 끝까지 이어지는지 확인한다.

## 범위

이번 full delivery E2E는 다음 범위를 포함한다.

- temporary local Squadrail instance 부팅
- temporary git fixture repo 생성
- project workspace를 isolated implementation policy로 연결
- tech lead / engineer / reviewer agent 생성
- issue 생성 및 `ASSIGN_TASK`
- engineer의 `ACK_ASSIGNMENT -> START_IMPLEMENTATION -> SUBMIT_FOR_REVIEW`
- reviewer의 `START_REVIEW -> APPROVE_IMPLEMENTATION`
- tech lead의 `CLOSE_TASK`
- isolated worktree의 실제 diff와 test/build 성공 검증

이번 E2E는 기본적으로 `merge automation`까지 요구하지 않는다. 현재 V1의 성공 기준은 `pending_external_merge` 상태로 close되더라도 isolated implementation evidence가 남는 것이다.

## 시나리오

fixture repo는 intentionally failing test를 가진 아주 작은 JavaScript package로 만든다.

- 대상 파일: `src/release-label.js`
- failing behavior:
  - 공백과 `/`, `_`, `-` 같은 separator를 정규화하지 못한다.
  - duplicate separator를 collapse하지 못한다.
- acceptance criteria:
  - `pnpm test` 통과
  - `pnpm build` 통과
  - engineer implementation run이 isolated worktree에 실제 diff를 남긴다
  - issue protocol state가 `done`으로 끝난다

## Agent 전략

### Engineer

- assignment/analysis wake에서는 코드 변경을 하지 않는다.
- `ACK_ASSIGNMENT` 후 `START_IMPLEMENTATION`을 보내고 종료한다.
- implementation wake에서만 코드를 수정한다.
- `pnpm test`와 `pnpm build`를 모두 실행한 뒤 `SUBMIT_FOR_REVIEW`를 보낸다.

### Reviewer

- assignment watch wake에서는 관찰만 하고 종료한다.
- `submitted_for_review` 또는 `under_review` 상태에서만 행동한다.
- `START_REVIEW` 후 최신 review handoff를 확인하고 `APPROVE_IMPLEMENTATION`을 보낸다.

### Tech Lead

- `approved` 상태에서만 행동한다.
- approval 이후 `CLOSE_TASK`를 보내서 delivery loop를 닫는다.
- close payload는 `mergeStatus=pending_external_merge`를 사용한다.

## Success Criteria

full delivery E2E는 아래를 모두 만족해야 성공이다.

1. issue protocol state가 `done`이다.
2. protocol timeline에 아래 메시지가 모두 존재한다.
   - `ASSIGN_TASK`
   - `ACK_ASSIGNMENT`
   - `START_IMPLEMENTATION`
   - `SUBMIT_FOR_REVIEW`
   - `START_REVIEW`
   - `APPROVE_IMPLEMENTATION`
   - `CLOSE_TASK`
3. engineer implementation run의 `workspaceUsage=implementation`이며 source가 `project_isolated`다.
4. implementation run의 git snapshot에 changed file이 존재한다.
5. `SUBMIT_FOR_REVIEW` 메시지에 `diff` artifact가 자동 첨부된다.
6. `SUBMIT_FOR_REVIEW` 메시지에 corroborated `test_run` / `build_run` artifact가 붙는다.
7. isolated workspace에서 `pnpm test`가 실제로 통과한다.
8. base workspace는 unchanged 상태를 유지한다.

## Optional Checks

- embedding provider가 준비되어 있으면 project workspace knowledge import를 같이 시도한다.
- import가 성공하면 engineer/reviewer brief hit count도 같이 확인한다.
- embedding provider가 없으면 warning으로 남기고 delivery 검증은 계속 진행한다.

## 남는 후속 과제

이 golden E2E가 녹색이 되면 다음 backlog는 다음 순서가 맞다.

1. full delivery E2E를 CI-friendly 모드로 줄여 nightly 또는 gated pipeline에 올리기
2. retrieval-ready 환경에서 brief quality assertion 추가
3. reviewer / tech lead behavior를 fixture helper 의존 없이 더 일반화된 agent instructions로 끌어올리기
