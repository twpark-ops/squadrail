# B7 Merge Automation

상태: 완료

## 목표

- `pending_external_merge`로 닫힌 merge candidate를 사람이 숨김 worktree를 뒤지지 않고 반영 준비까지 진행할 수 있게 만든다.
- merge candidate 근거가 close 이후 drift되지 않도록 후보 상태를 영속화한다.
- 실제 base branch를 바로 더럽히지 않고, integration branch 기반으로 merge/cherry-pick 보조를 제공한다.

## 범위

- pending merge candidate 영속화
- merge automation preflight / plan surface
- patch export
- PR bundle export
- local integration branch merge helper
- local integration branch cherry-pick helper
- optional branch push

## 의도적으로 제외한 것

- base branch direct mutation by default
- provider-specific PR creation
- automatic merge completion on GitHub/GitLab

이 단계는 안전한 integration branch 준비를 자동화하는 것이고, 실제 main/master merge는 후속 provider integration 또는 operator decision으로 남긴다.

## 구현 요약

### 1. Merge candidate anchoring

- `CLOSE_TASK.payload.mergeStatus = pending_external_merge`일 때 merge candidate를 DB에 `pending` 상태로 즉시 upsert
- `closeMessageId`, `sourceBranch`, `workspacePath`, `headSha`, `diffStat`를 영속화
- read model은 더 이상 최신 close/approval 전체를 뒤지지 않고 persisted `closeMessageId`에 anchor

### 2. Automation metadata

- `issue_merge_candidates.automation_metadata`
- 저장 항목 예:
  - `lastPlanGeneratedAt`
  - `lastPreparedBranch`
  - `lastPreparedWorktreePath`
  - `lastPatchPath`
  - `lastPrBundlePath`
  - `lastPushRemote`
  - `lastPushedBranch`

### 3. New backend surfaces

- `GET /api/issues/:id/merge-candidate/plan`
- `POST /api/issues/:id/merge-candidate/automation`

지원 action:

- `prepare_merge`
- `export_patch`
- `export_pr_bundle`
- `merge_local`
- `cherry_pick_local`
- `push_branch`

### 4. Safety model

- source workspace HEAD가 persisted `headSha`와 다르면 automation 차단
- base workspace / source workspace 둘 다 git repository여야 함
- target base branch가 resolve되지 않으면 차단
- integration branch는 `.squadrail-merge-worktrees/` 아래 별도 worktree에서 준비

## 완료 기준

- route 계약 테스트 통과
- temp git repo integration test 통과
- migration 적용 완료
- live repo 기준 `prepare -> export -> merge_local` smoke 가능
