# Squadall Run-First Priority Summary

작성일: 2026-03-11

## 현재 기준

- 방향은 `AI software company / autonomous org`로 일관된다.
- 다만 retrieval 최적화 비중이 burn-in보다 앞서기 시작해 우선순위를 재정렬했다.

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

## 현재 활성 슬라이스

- `1-A commit-after ingest rollout`: 완료
- `1-B historical backfill reliability`: embedding input sanitize + parse-error retry 1차 완료
- `1-C readiness gate threshold split`: functional readiness / historical hygiene gate 분리 1차 완료
- `2-A cross-project child work item support`: 완료
- `2-B coordinating-root drift containment`: burn-in harness 우회 완료, product kernel 후속 과제로 유지
- `2-B coordinating-root drift containment`: `coordinationOnly` projection flag로 root drift 재현 제거
- `2-C coordinated burn-in completion analysis`: 진행 중
  - 목표: child 3개가 reviewer/QA/close까지 닫히는지 확인
  - 관찰 포인트: `dispatch_timeout`, `process_lost`, `protocol_required`, reviewer/QA 병목, root/child aggregation 누락

## 관련 문서

- `docs/run-first-burn-in-priority-plan.md`
- `docs/backend-post-phase-plan.md`
- `docs/autonomous-org-full-loop-plan.md`
