# Phase 3 Real Repo Execution Hardening

작성일: 2026-03-10

## 목표

Phase 3의 목표는 `실제 repo에서 작업했다`는 증거를 run, protocol, review 단계에 일관되게 남기는 것이다.

핵심 질문은 세 가지다.

1. implementation run이 어떤 worktree/branch에서 실행됐는지 남는가
2. 실제 working tree diff와 변경 파일이 구조적으로 캡처되는가
3. review/close 단계가 payload 진술이 아니라 repo와 verification evidence에 더 강하게 묶이는가

## Slice 구성

### Slice 1. Run-bound git snapshot + diff artifact

이번 턴에 완료한 범위:

- implementation run 종료 시 resolved workspace 기준 git snapshot 캡처
- git snapshot을 heartbeat run event와 `resultJson.workspaceGitSnapshot`에 저장
- agent protocol append 시 active run workspace를 다시 검사해 genuine `diff` artifact 자동 첨부
- `START_IMPLEMENTATION`은 sender engineer self-recipient를 강제해 follow-up implementation run과 workspace binding을 보장
- run scope가 다른 이슈의 artifact가 잘못 붙지 않도록 issue scope 검증 강화

핵심 결과:

- `SUBMIT_FOR_REVIEW`는 이제 payload 문자열만이 아니라 실제 workspace diff에서 생성된 artifact를 자동으로 가질 수 있다.
- implementation run은 종료 후 `branchName`, `headSha`, `changedFiles`, `diffStat`를 run event/resultJson에 남긴다.

### Slice 2. Verification artifact capture

이번 턴에 시작한 범위:

- run output / resultJson에서 `verificationSignals`를 구조적으로 추출해 `resultJson.verificationSignals`와 run event에 저장
- protocol artifact가 raw regex 대신 `verificationSignals`를 우선 사용해 `test_run` / `build_run` metadata를 강화
- `APPROVE_IMPLEMENTATION` 메시지에 `approval` artifact 자동 첨부
- `codex_local`, `cursor_local`, `opencode_local`, `claude_local` run result에 shell/tool execution 기록을 구조적으로 남겨 verification signal이 heuristic text만 보지 않도록 보강
- `merged` close는 이제 `repo evidence + approval + verification evidence` 조합이 없으면 통과하지 않도록 강화

다음 작업 범위:

- explicit verification command의 stdout/stderr/exit status를 artifact metadata에 더 풍부하게 반영
- adapter별 구조화 수준 차이를 줄여 `exit status`, `stderr`, `aggregated output` 필드를 더 일관되게 맞추기
- close 단계에서 merged 상태의 verification artifact completeness를 UI와 운영 가이드까지 더 강하게 연결

### Slice 3. Workspace lifecycle hardening

이번 턴에 시작한 범위:

- isolated worktree가 다른 경로에 이미 붙어 있으면 해당 path를 재사용해 branch collision을 흡수
- clean 상태의 stale isolated worktree는 branch mismatch를 감지하면 제거 후 재생성
- empty stale directory는 안전하게 정리하고 recreation

다음 작업 범위:

- isolated clone cleanup 정책
- dirty stale workspace에 대한 recovery/escalation 정책
- implementation retry/resume 정책과 branch collision 처리의 운영 표면 보강

## 완료 기준

Phase 3 전체 완료 기준:

1. implementation run마다 target workspace, branch, head commit, changed files가 남는다.
2. review submission은 실제 repo diff 또는 genuine commit evidence와 연결된다.
3. close 단계는 verification evidence와 repo state 없이 통과하지 않는다.
4. 운영자는 run event만 봐도 어떤 workspace에서 어떤 diff가 생겼는지 파악할 수 있다.
