# Squadall Run-First Priority Summary

작성일: 2026-03-11

## 현재 기준

- 방향은 `AI software company / autonomous org`로 일관된다.
- 다만 retrieval 최적화 비중이 burn-in보다 앞서기 시작해 우선순위를 재정렬했다.
- `peer engineer` (예: Codex + Claude 공동 구현)는 유효한 후속 기능이지만, 현재 기본 커널에는 포함하지 않는다.
- 현재 제품 기준 기본 실행 모델은 `single engineer per child + reviewer + QA`이며, peer mode는 선택형 고도화로 뒤로 미룬다.

## 현재 우선순위

1. Replay E2E gate normalization
2. 18-agent real-org burn-in
3. blocked timeout + legacy semantics cleanup
4. retrieval god-file refactor
5. rerank provider abstraction
6. execution lane classifier
7. fast lane optimization
8. deeper multi-hop
9. ranking/cache/trend consolidation
10. cross-issue memory reuse

## 중요한 판단

- replay 기능 자체는 이미 성공했다.
- 현재 막는 것은 readiness gate와 historical coverage hygiene다.
- 따라서 다음 구현은 retrieval 미세튜닝이 아니라 replay gate 정상화와 burn-in이다.
- 진짜 제품 검증 대상은 단일 프로젝트 완주만이 아니다.
- 상위 요구 하나가 여러 프로젝트 child work item으로 fan-out되어 병렬 실행되는지까지 확인해야 한다.
- 현재 병렬성 primitive는 "한 issue에 여러 primary engineer"가 아니라 "root coordinating issue + hidden child work items"다.
- 다만 현재 커널은 child work item의 project override가 없어, 진짜 멀티프로젝트 coordinated delivery를 검증하려면 이 지원을 먼저 넣어야 한다.
- 따라서 멀티프로젝트 동시 작업 시나리오는 root issue 아래 project별 child lane으로 검증해야 한다.
- burn-in에서 추가로 확인된 갭은 `projectId=null` coordinating root가 projection 이후 unintended engineer lane으로 drift할 수 있다는 점이다.
- 현재 harness는 projection 직후 root를 archive해서 child fan-out만 검증한다.
- 제품 후속 과제는 dedicated `coordination-only root` 상태를 추가하는 것이다.
- 최신 coordinated burn-in (`CLO-150`)에서는 root archive 이후 실제 child 3개 fan-out이 재확인됐다.
- 구현 child에서 reviewer watch가 조기 개입해 `REASSIGN_TASK`를 발생시키던 문제를 확인했고, `work:implementation` child assignment에는 reviewer watch를 비활성화했다.
- 현재 관측된 진행:
  - root `CLO-150`: `cancelled + hidden`
  - `CLO-151` swiftsight-agent child: `in_progress`
  - `CLO-152` swiftsight-cloud child: `in_progress`
  - child lane별 retrieval/brief/heartbeat dispatch는 독립적으로 발생
- 즉 현 시점 병목은 "fan-out 가능 여부"가 아니라 "child lane completion / timeout / recovery"다.
- 추가 관측:
  - coordinating-root drift는 재현되지 않음
  - 첫 coordinated rerun에서는 hidden child의 lingering active run 때문에 `swiftcl` lane이 `dispatch_timeout`으로 막혔음
  - cleanup 범위를 `tagged root -> internal child family -> active heartbeat runs`로 넓혀 stale hidden child/run 정리 로직을 넣음
  - cleanup 후 rerun `CLO-158`은 `CLO-159`, `CLO-160`, `CLO-161` 세 child lane이 모두 `in_progress`까지 올라감
  - 이후 burn-in wrapper가 `429`로 끊겼는데, 원인은 product protocol이 아니라 harness가 poll마다 `issue/state/messages/briefs/reviewCycles/violations`를 모두 조회한 관측 방식이었음
  - wait loop를 `issue + state + messages`만 poll하고 extended data는 completion 시점에만 읽도록 줄임
  - fresh bucket 재실행 `CLO-162`에서도 root fan-out 후 세 child engineer run이 모두 `running` 상태까지 올라감
  - 따라서 현재 실질 우선순위는 `coordinated burn-in completion 관찰` 다음 `blocked / legacy / protocol-required semantics cleanup`이다
  - 이후 coordinated rerun `CLO-166`에서 `swiftsight-cloud` child는 더 이상 조기 `REASSIGN_TASK`로 되돌아가지 않았다.
  - 새 병목은 `Claude` implementation lane이 clean workspace에서 `SUBMIT_FOR_REVIEW requires diff or commit artifact`에 막히는 것이었고, `clean committed workspace`에도 commit artifact를 자동 첨부하도록 수정했다.
  - PM intake harness에는 두 번째 불필요한 `PATCH /issues/:id`가 있었고 제거했다.
  - lingering coordinated child cleanup은 root family만으로는 부족했다. 실제 잔재 `CLO-144`처럼 `parent만 E2E root`인 child run이 agent를 점유하는 케이스가 있어서, cleanup을 `company issue list + parent chain + active runs` 기준으로 확장했다.
- 최신 coordinated rerun `CLO-179`에서는 root 하나가 다시 child 3개로 fan-out됐고, `CLO-180`(agent), `CLO-181`(cloud), `CLO-182`(swiftcl) 모두 `ACK_ASSIGNMENT -> START_IMPLEMENTATION`까지 확인됐다.
  - `CLO-181` cloud/claude lane은 이번에는 queued나 422 handoff 오류 없이 실제 구현 로그를 쓰기 시작했고, 이후 `SUBMIT_FOR_REVIEW -> START_REVIEW`까지 확인됐다.
  - 즉 `clean committed workspace`의 review handoff bug는 coordinated burn-in 실데이터에서 해소됐다.
  - 후속 관측에서 `CLO-181`은 실제로 `APPROVE_IMPLEMENTATION -> done`까지 닫혔다.
  - `CLO-180`은 QA가 실제로 `REQUEST_CHANGES`를 보낸 뒤 engineer가 재작업하고 다시 `SUBMIT_FOR_REVIEW -> START_REVIEW -> APPROVE_IMPLEMENTATION -> START_REVIEW(qa) -> APPROVE_IMPLEMENTATION(qa) -> CLOSE_TASK`까지 닫혔다. 즉 `review -> QA -> 개발팀 재반환 -> 재검증 -> done` 루프가 실데이터로 검증됐다.
  - `CLO-182`는 reviewer 변경 요청 후 engineer가 재작업을 완료했지만 초기에 `SUBMIT_FOR_REVIEW` helper/API artifact semantics 때문에 `REPORT_PROGRESS`로만 끝난 뒤 stale implementation 상태에 남는 케이스가 드러났다.
  - recovery comment는 이슈에 정상 저장됐지만, plain comment만으로는 execution lock 우회가 되지 않고 `issue_comment_mentioned`가 필요했다.
  - route patch로 assignee/reviewer/qa mention이 현재 protocol state를 읽어 `protocolRecipientRole`과 `protocolWorkflowStateAfter`를 함께 wake context에 싣도록 수정했다. 이걸로 `changes_requested` 상태의 engineer recovery가 다시 implementation lane으로 복귀할 수 있게 만들었다.
  - 이후 protocol helper를 보정해 `submit-for-review`에만 git artifact를 자동 첨부하도록 고쳤고, `CLO-182`는 실제로 `SUBMIT_FOR_REVIEW -> START_REVIEW -> APPROVE_IMPLEMENTATION -> START_REVIEW(qa) -> APPROVE_IMPLEMENTATION(qa) -> CLOSE_TASK`까지 닫혔다.
- 따라서 최신 coordinated burn-in 기준으로 `CLO-180`, `CLO-181`, `CLO-182` 세 child 모두 reviewer/QA/done까지 닫히는 것이 실데이터로 확인됐다. 즉 root 하나에서 fan-out된 multi-project child lane이 review와 QA 반환 루프까지 포함해 완주 가능하다는 것이 검증됐다.
- burn-in이 닫힌 현재 활성 최우선은 `blocked / legacy / protocol semantics cleanup`이다.
- 첫 정리 항목으로 `protocol_required_retry`는 이제 current workflow state가 requirement lane과 일치할 때만 다시 enqueue한다.
- `blocked` 상태는 별도 `blocked_resolution_timeout` 규칙으로 reminder/escalation을 탄다.

## 현재 활성 슬라이스

- `1-A commit-after ingest rollout`: 완료
- `1-B historical backfill reliability`: embedding input sanitize + parse-error retry 1차 완료
- `1-C readiness gate threshold split`: functional readiness / historical hygiene gate 분리 1차 완료
- `2-A cross-project child work item support`: 완료
- `2-B coordinating-root drift containment`: burn-in harness 우회 완료, product kernel 후속 과제로 유지
- `2-B coordinating-root drift containment`: `coordinationOnly` projection flag로 root drift 재현 제거
- `2-C coordinated burn-in completion analysis`: 진행 중
  - 목표: child 3개가 reviewer/QA/close까지 닫히는지 확인
  - 관찰 포인트: `dispatch_timeout`, `process_lost`, `protocol_required`, reviewer/QA 병목, root/child aggregation 누락, `changes_requested -> implementing` recovery
  - 최신 실측 root: `CLO-179`
  - 최신 child lanes:
    - `CLO-180` swiftsight-agent
    - `CLO-181` swiftsight-cloud
    - `CLO-182` swiftcl
  - 최신 상태:
    - `CLO-181`: `done`
    - `CLO-180`: `done` (QA change request loop 포함)
    - `CLO-182`: `done` (reviewer change request recovery + QA gate 포함)

## 관련 문서

- `docs/run-first-burn-in-priority-plan.md`
- `docs/backend-post-phase-plan.md`
- `docs/autonomous-org-full-loop-plan.md`

## 추가 우선순위 보정

- 현재 제품 평가는 `retrieval 미세튜닝`보다 `operator UX + 구조 부채 + release discipline`이 더 직접적인 레벨업 포인트다.
- 검토 결과:
  - merge candidate backend는 이미 있으나, operator action UI는 아직 완성 전이다.
  - change surface는 read-only evidence panel에 가깝고, 실제 review desk로는 부족하다.
  - `issues.ts`와 `issue-retrieval.ts`는 여전히 god-file 리스크가 크다.
  - knowledge setup read model은 프로젝트 수가 늘면 sync 상태 조회가 느려질 가능성이 있다.
  - UI regression은 smoke가 일부 있지만 change/merge/knowledge setup 핵심 표면을 지키는 회귀 테스트는 부족하다.
  - CI/release workflow는 repo 루트 기준 아직 부재다.
- 따라서 `run first` 우선순위 다음 배치는 아래 순서로 본다.
  1. `issues.ts` route split slice 2
  2. `issue-retrieval.ts` refactor
  3. knowledge setup read-model cache/background refresh
  4. PR verify / release workflow 추가

## 최근 진행

- `issues.ts` route split slice 1 완료
  - approvals, intake, protocol read, merge/change-surface, attachments를 `server/src/routes/issues/` 하위 모듈로 분리
  - 메인 `issues.ts`는 create/update/delete/checkout/release, comments, protocol write 등 고변동 write path 중심으로 축소
  - 집중 테스트 + 전체 `typecheck/test/build` 모두 통과
- `issue-retrieval.ts` refactor slice 1 완료
  - graph expansion helper를 `server/src/services/retrieval/graph.ts`로 이동
  - model rerank helper를 `server/src/services/retrieval/model-rerank.ts`로 이동
  - 공통 path/text helper를 `server/src/services/retrieval/shared.ts`로 이동
- `knowledge-setup` read model cache 1차 완료
  - setup view는 15초 fresh / 2분 stale 캐시 사용
  - stale 구간에서는 cached view를 반환하고 background refresh 수행
  - knowledge sync / org repair 시 cache invalidate
- 루트 CI/release workflow 추가
  - `.github/workflows/pr-verify.yml`
  - `.github/workflows/release.yml`
- 이번 배치 전체 검증:
  - `pnpm vitest run server/src/__tests__/issue-retrieval.test.ts server/src/__tests__/companies-routes.test.ts server/src/__tests__/knowledge-routes.test.ts`
  - `pnpm -r typecheck`
  - `pnpm test:run`
  - `pnpm build`
