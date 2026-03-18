# B8 Follow-up: Operator Feedback, Merge Outcome Refinement, and Real-Org RAG E2E

작성일: 2026-03-11

## 목표

planned B8 Slice 1~5는 끝났다.

이번 후속 패스의 목표는 세 가지다.

1. operator가 retrieval 결과에 직접 positive / negative feedback을 줄 수 있게 만든다.
2. merge candidate 최종 결과를 retrieval personalization에 더 정확히 반영한다.
3. 실제 agent가 업데이트된 RAG를 읽고 사용하는지 real-org E2E로 증명한다.

## 왜 이 패스가 필요한가

현재도 personalization은 protocol outcome을 통해 쌓인다.

하지만 아직 두 공백이 있다.

- operator가 "이 path는 맞았다 / 이 symbol은 틀렸다"를 직접 남길 수 없다.
- merge candidate의 `merged` / `rejected` 결과가 retrieval profile에 충분히 반영되지 않는다.

또, 구현이 있어도 실제 agent run에서 graph / personalization이 쓰였는지 조직 기준으로 증명하는 시나리오가 필요하다.

## 이번 구현 범위

### 1. Operator feedback surface

새 backend surface를 추가한다.

- issue 단위 retrieval feedback write API
- target type
  - `chunk`
  - `path`
  - `symbol`
  - `source_type`
- feedback type
  - `operator_pin`
  - `operator_hide`

설계 원칙:

- board/operator만 호출 가능
- retrieval run scope를 명시적으로 받는다
- weight는 explainable constant만 사용한다

### 2. Merge outcome feedback refinement

merge candidate resolution 시 아래를 retrieval feedback으로 연결한다.

- `mark_merged`
  - positive merge feedback
- `mark_rejected`
  - weak negative merge feedback

또한 close message에 anchoring된 retrieval run이 있으면 그 run을 기준으로 feedback을 쌓고,
merge candidate surface의 changed files도 path feedback으로 같이 반영한다.

### 3. Multi-hop symbol graph traversal

현재 1-hop에서 끝나는 symbol graph expansion을 2-hop까지 확장한다.

핵심 제약:

- hop depth는 2로 제한
- depth decay 적용
- edge type별 boost 차등 유지
- traversal budget을 depth별로 제한

추가 지표:

- `graphMaxDepth`
- `graphHopDepthCounts`
- `multiHopGraphHitCount`

### 4. Real-org RAG E2E

E2E는 2단계 issue로 구성한다.

1. seed issue
   - 실제 agent가 issue를 처리한다.
   - reviewer / close outcome으로 feedback을 남긴다.
2. follow-up issue
   - 같은 프로젝트 / 인접 파일 / 관련 symbol을 대상으로 새 issue를 만든다.
   - retrieval run에서 아래를 검증한다.
     - `graphHitCount > 0`
     - `graphMaxDepth >= 1` and preferably `multiHopGraphHitCount > 0`
     - `personalization.applied === true`
     - `personalizedHitCount > 0`

## 구현 순서

1. feedback / merge refinement service 확장
2. operator feedback route 추가
3. multi-hop traversal 구현
4. metric / quality summary 확장
5. unit / route tests
6. real-org RAG E2E harness 추가 및 실행

## 완료 기준

- board/operator가 retrieval result에 직접 pin/hide feedback을 남길 수 있다.
- merge candidate 결과가 personalization에 반영된다.
- retrieval debug와 knowledge quality에서 multi-hop / feedback metric이 보인다.
- real-org E2E에서 실제 agent brief가 graph/personalization signal을 사용한 흔적이 남는다.
