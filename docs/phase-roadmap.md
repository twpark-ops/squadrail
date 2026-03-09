# Execution Phase Roadmap

작성일: 2026-03-09  
현재 활성 단계: `Phase 0`

## 목표

최종 목표는 `완전 무인 회사`가 아니라, 사람이 목표와 경계만 주면 squad가 설계, 구현, 리뷰 루프의 대부분을 스스로 처리하는 반자율 개발 조직을 만드는 것이다.

## Phase 정의

### Phase 0. Execution Reliability

목표: agent run이 실종되지 않고, 항상 명시적인 성공/실패 원인을 남기게 만든다.

범위:

- preflight 예외를 explicit failure로 처리
- run checkpoint event 추가
- orphan/process_lost 원인 축소
- recovery 설계의 기초 마련

완료 기준:

- analysis run이 silent fail 없이 종료된다
- `process_lost`가 "조용한 예외 누락" 때문에 발생하지 않는다
- run events만 봐도 어느 단계에서 실패했는지 파악 가능하다

### Phase 1. Team Supervisor MVP

목표: lead, engineer, reviewer가 조직처럼 연결된 최소 루프를 만든다.

범위:

- lead supervisor wake 규칙
- minimal internal work items
- reviewer watch mode

완료 기준:

- 상위 issue 하나에서 내부 작업 분해와 reviewer 연결이 자동으로 유지된다

### Phase 2. Delivery Contract MVP

목표: review 가능한 handoff를 강제한다.

범위:

- diff summary
- test result
- risk note
- review checklist

완료 기준:

- review 단계에 필요한 근거가 구조적으로 항상 남는다

### Phase 3. Real Repo Execution Hardening

목표: 실제 repo 수정과 검증을 안전하게 수행한다.

범위:

- isolated worktree/branch
- target repo diff 검증
- 테스트/빌드 결과 캡처
- retry 정책

완료 기준:

- target repo에서 실제 코드 변경과 검증 로그가 남는다

### Phase 4. Operations & Visibility

목표: 운영자가 DB를 직접 보지 않고도 squad 상태를 파악하게 만든다.

범위:

- mailbox UI
- recovery queue
- team board
- 실패/SLA 메트릭

완료 기준:

- 운영자가 stuck run과 blocked handoff를 UI에서 바로 파악한다

## 현재 진행 순서

1. Phase 0
2. Phase 1
3. Phase 2
4. Phase 3
5. Phase 4

## Phase 0 작업 순서

1. preflight 예외가 orphan로 남는 구간 제거
2. checkpoint event 추가
3. 실패 payload에 phase 정보 남기기
4. analysis run 재검증
5. 그 다음 DB lease/recovery 보강
