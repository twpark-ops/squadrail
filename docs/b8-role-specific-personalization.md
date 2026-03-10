# B8 Slice 5: Role-Specific Personalization

작성일: 2026-03-10

## 목표

Slice 5의 목적은 retrieval이 역할과 실제 delivery outcome을 반영해, 같은 프로젝트에서도 reviewer / tech lead / qa / engineer가 더 잘 맞는 근거를 보게 만드는 것이다.

이번 슬라이스에서 닫은 범위:

- `retrieval_feedback_events` 도입
- `retrieval_role_profiles` 도입
- protocol outcome 기반 feedback 적재
- role/project/event explainable boost 적용
- quality summary에 personalization metric 노출
- historical backfill script 추가

## 설계 포인트

### 1. black-box memory 대신 explainable profile

이번 패스는 per-agent hidden memory를 만들지 않는다.

대신 아래 세 축만 저장한다.

- `sourceType`
- `path`
- `symbol`

즉 "reviewer가 어떤 파일/심볼/소스 타입을 반복적으로 신뢰했는가"를 사람이 읽을 수 있는 형태로 남긴다.

### 2. feedback source는 protocol outcome만 사용

피드백 소스는 아래 message type에 한정한다.

- `REQUEST_CHANGES`
- `APPROVE_IMPLEMENTATION`
- `CLOSE_TASK`

이유:

- delivery loop와 직접 연결된다.
- QA / reviewer / tech lead의 실제 승인/반려 판단을 반영한다.
- free-form chat보다 신호 품질이 높다.

### 3. scope merge 규칙

profile은 두 단위로 저장한다.

- global company scope
- project scope

retrieval 시에는 `global -> project` 순서로 merge한다. project scope가 있으면 같은 키의 global boost를 덮어쓴다.

### 4. additive boost만 허용

personalization은 기존 hybrid / graph / temporal score 위에 additive하게 붙는다.

적용 대상:

- `sourceType`
- `path`
- `symbol`

즉 semantic correctness를 뒤집는 강한 규칙이 아니라, 동률 혹은 근접 후보의 정렬을 더 실무적으로 만드는 정도로 제한한다.

## 새 스키마

### `retrieval_feedback_events`

- `companyId`
- `projectId`
- `issueId`
- `retrievalRunId`
- `feedbackMessageId`
- `actorRole`
- `eventType`
- `feedbackType`
- `targetType`
- `targetId`
- `weight`
- `metadata`
- `createdAt`

### `retrieval_role_profiles`

- `companyId`
- `projectId`
- `role`
- `eventType`
- `profileJson`
- `feedbackCount`
- `lastFeedbackAt`
- `createdAt`
- `updatedAt`

## 적용 흐름

1. protocol message가 저장된다.
2. `REQUEST_CHANGES` / `APPROVE_IMPLEMENTATION` / `CLOSE_TASK`면 feedback recording을 시도한다.
3. message가 연결된 retrieval run을 찾는다.
4. selected retrieval hit를 path / symbol / sourceType 기준으로 feedback event로 적재한다.
5. `(company, project|null, role, eventType)` profile을 재집계한다.
6. 이후 retrieval에서 같은 role/eventType이 오면 additive personalization boost를 적용한다.

## 추가된 지표

`brief quality` / `/api/knowledge/quality`에 아래가 추가됐다.

- `profileAppliedRunCount`
- `averagePersonalizedHitCount`
- `averagePersonalizationBoost`
- `feedbackEventCount`
- `positiveFeedbackCount`
- `negativeFeedbackCount`
- `feedbackCoverageRate`
- `profileCount`

retrieval run debug에는 아래가 기록된다.

- `applied`
- `scopes`
- `personalizedHitCount`
- `averagePersonalizationBoost`

## 운영 메모

현재 `cloud-swiftsight` 실데이터에는 historical `REQUEST_CHANGES`, `APPROVE_IMPLEMENTATION`, `CLOSE_TASK`가 거의 없어서 backfill 결과는 0건일 수 있다.

이건 구현 결함이 아니라, 현재 회사 데이터가 personalization seed를 아직 충분히 만들지 못했다는 의미다.

따라서 초기 검증은 synthetic smoke와 이후 real-org delivery accumulation으로 보는 게 맞다.

## 실검증 결과

실제 retrieval run을 대상으로 synthetic feedback recording을 태웠을 때:

- `feedbackEventCount`: 24
- `profiledRunCount`: 1
- profile scope: `global`, `project`
- `sourceType`, `path`, `symbol` boost 생성 확인

검증 후 synthetic row는 정리해서 회사 데이터 오염을 남기지 않았다.

## 다음 단계

이제 planned Slice 1~5는 모두 구현됐다.

후속 심화 우선순위는 아래다.

1. operator pin/hide UI를 personalization feedback에 연결
2. merge outcome feedback을 더 정교하게 분해
3. multi-hop graph traversal과 personalization의 상호작용 튜닝
