# Domain-Aware PM 평가 시나리오: Cloud SwiftSight Fixture

작성자: Taewoong Park (park.taewoong@airsmed.com)
작성일: 2026-03-15

## 목적

이 문서는 `Squadrail PM`이 단순히 이슈를 형식적으로 구조화하는 수준을 넘어서, 실제 `cloud-swiftsight` 도메인 맥락을 읽고 신규 기능 요청을 적절한 프로젝트, 역할, clarification, work item으로 분해할 수 있는지 평가하기 위한 기준 문서다.

중요한 전제는 하나다.

> 이 문서는 `cloud-swiftsight`를 제품 로직의 하드코딩 대상이 아니라, **domain-aware PM 품질을 검증하기 위한 fixture**로 사용한다.

즉 실제 제품 로직은 특정 회사명이나 repo slug에 기대지 않고 아래 generic 계약으로 올라가야 한다.

- `requiredKnowledgeTags`
- knowledge metadata의 `pmProjectSelection.ownerTags / supportTags / avoidTags`
- `code_summary / symbol_summary / adr / prd / runbook` source type
- project candidate scoring의 generic weighting policy

`cloud-swiftsight`는 이 generic 계약이 실제 도메인에서도 통하는지 검증하는 샘플 환경이다.

핵심 질문은 하나다.

> 사람이 도메인 요구를 비교적 자연어로 던졌을 때, PM이 실제 제품/시스템 경계를 이해하고 실행 가능한 delivery slice로 바꿀 수 있는가?

이 문서는 실제 워크스페이스를 기준으로 작성했다.

- `/home/taewoong/workspace/cloud-swiftsight/swiftsight-cloud`
- `/home/taewoong/workspace/cloud-swiftsight/swiftsight-agent`
- `/home/taewoong/workspace/cloud-swiftsight/swiftcl`
- `/home/taewoong/workspace/cloud-swiftsight/swiftsight-worker`

## 실제 도메인 경계 요약

### `swiftsight-cloud`

- 중앙 BFF/API 서버
- Settings / Registry / Temporal / Agent stream / RabbitMQ / PostgreSQL 경계를 가진다
- 병원별 설정과 DICOM study를 받아 실제 AI workflow 실행을 조율한다

기준 확인 파일:

- `swiftsight-cloud/README.md`
- `swiftsight-cloud/docs/project/PRD.md`

### `swiftsight-agent`

- 병원 내부 DICOM gateway
- Scanner에서 C-STORE로 파일을 받고, Cloud 명령(`UPLOAD`, `SEND`)을 실행한다
- S3 업로드와 PACS 전송, 로컬 retention, reconnect/retry 흐름이 중요하다

기준 확인 파일:

- `swiftsight-agent/README.md`

### `swiftcl`

- Settings 기반 workflow를 DAG/Temporal 실행 모델로 변환하는 compiler/DSL 레이어
- workflow matching, artifact routing, multi-destination delivery 같은 규칙을 품고 있다

기준 확인 파일:

- `swiftcl/README.md`
- `swiftcl/docs/KB/031-settings-to-dag-temporal-workflow.md`

### `swiftsight-worker`

- 실제 AI inference worker 묶음
- 현재 README 밀도는 상대적으로 약하다
- worker 관련 평가 시나리오는 advanced tier로 두는 편이 안전하다

기준 확인 파일:

- `swiftsight-worker/README.md`

## 왜 이 평가가 필요한가

`Squadrail`의 최종 목표는 generic 챗봇이 아니라 `도메인을 이해하는 PM + 실행 조직`이다.

즉 아래가 되어야 한다.

1. 사람이 기능 요청을 던진다
2. PM이 도메인 경계와 영향을 읽는다
3. 어느 프로젝트가 맡아야 하는지 정한다
4. 어떤 clarification이 필요한지 고른다
5. 실행 가능한 child work item으로 분해한다
6. review/QA 기준까지 잡는다

이 평가가 없으면 `quick request -> projection -> clarification`이 돌아도, 실제로는 도메인을 모른 채 형식만 맞추는 PM일 수 있다.

## Genericity 원칙

이 평가를 통과했다고 해서 `Swiftsight 전용 튜닝`을 제품 가치로 간주하면 안 된다.

좋은 상태는 아래다.

1. 특정 회사명 기반 shortcut이 없다
2. project selection은 generic knowledge/tag contract로 움직인다
3. domain boundary hint는 다른 회사에도 같은 포맷으로 주입 가능하다
4. 같은 evaluator를 다른 회사 fixture에도 그대로 적용할 수 있다

즉 `domain-aware PM`의 목표는 `SwiftSight 전용 PM`이 아니라, **어떤 회사든 knowledge boundary를 읽는 generic PM**이다.

## 북극성

좋은 PM 판정 기준은 아래다.

1. **올바른 프로젝트/팀 선택**
2. **도메인상 중요한 clarification만 질문**
3. **실행 가능한 child work item 분해**
4. **review/QA에서 봐야 할 증거 제시**
5. **cross-project 영향이 있을 때 coordination을 먼저 세움**
6. **규제/추적성/안전성 요구를 빼먹지 않음**

## 평가 방식

평가는 두 층으로 본다.

### 1. Structuring correctness

PM이 아래를 맞추는지 본다.

- 올바른 project lane
- 올바른 assignee/reviewer/QA 흐름
- 적절한 acceptance criteria
- 필요 시 coordination root 판단

### 2. Domain awareness

PM이 아래를 읽는지 본다.

- DICOM -> Agent -> Cloud -> Temporal -> Worker -> PACS 흐름
- Settings/Workflow matching과 runtime delivery의 차이
- artifact routing과 PACS destination의 차이
- audit evidence / traceability / retry / PHI 민감도

## 선행 기본 테스트 게이트

domain-aware PM 평가는 아래 기본 게이트를 먼저 통과한 뒤에 태우는 것이 맞다.

이유는 간단하다.

- lower-kernel이 흔들리면 PM 판단 실패인지 runtime failure인지 구분이 안 된다
- autonomy loop가 안 닫히면 PM 구조화 품질보다 프로토콜 결함이 먼저 섞인다
- operator surface가 깨져 있으면 PM이 맞게 판단해도 제품 경험은 실패한다

### Gate 1. Strict kernel burn-in

명령:

```bash
pnpm e2e:cloud-swiftsight-kernel-burn-in:strict
```

목적:

- 실제 코드 작성
- focused test 실행
- protocol review/QA
- ownership/routing 회귀

즉 `AI가 실제 delivery loop를 끝까지 밀 수 있느냐`를 복구 없이 본다.

### Gate 2. Autonomy matrix

명령:

```bash
pnpm e2e:cloud-swiftsight-autonomy-burn-in
```

목적:

- quick request
- PM projection preview/apply
- clarification ask/answer/resume
- review/QA/close

즉 `상위 제품 루프`가 닫히는지 본다.

권장 variant:

1. `baseline`
2. `multi_child_coordination`
3. `reviewer_clarification_policy`

### Gate 3. Browser smoke

명령 예시:

```bash
RUN_SUPPORT_PLAYWRIGHT_SPEC=true ./scripts/smoke/local-ui-flow.sh --port 3398 --home /tmp/squadrail-pm-eval-3398
```

목적:

- onboarding / settings / library / preview/apply 같은 operator surface가 실제로 열리는지 확인
- domain-aware PM이 맞게 판단해도 UI/operator flow가 깨져 있으면 평가 신뢰도가 떨어진다

### Optional Gate 4. RAG readiness

명령:

```bash
pnpm e2e:cloud-swiftsight-rag-readiness
```

목적:

- retrieval이 최소한 project affinity와 핵심 맥락을 제대로 잡는지 본다
- PM이 도메인 판단을 잘 못했을 때, retrieval 부재와 PM structuring 실패를 구분하는 데 도움 된다

### 권장 실행 순서

1. `strict kernel burn-in`
2. `autonomy matrix`
3. `browser smoke`
4. `rag readiness`
5. `domain-aware PM live evaluation`

즉 이 문서의 시나리오는 위 기본 게이트가 녹색일 때 태우는 것이 맞다.

실행 커맨드:

```bash
pnpm e2e:cloud-swiftsight-domain-aware-pm-eval
pnpm e2e:cloud-swiftsight-domain-aware-pm-burn-in
```

현재 harness는 아래 두 단계를 같이 본다.

1. `preview correctness`
- project selection
- top candidate coverage
- work item / acceptance criteria / definition of done quality
- low-confidence warning 여부

2. `bounded delivery completion`
- 같은 preview draft를 그대로 apply
- projected child가 실제 protocol delivery loop를 닫는지
- clarification ask/answer/resume가 시나리오 정책과 맞는지
- review/QA/close까지 완료되는지

## 점수표

각 항목 0~2점, 총점 12점으로 본다.

| 항목 | 0점 | 1점 | 2점 |
|---|---|---|---|
| Project 선택 | 틀림 | 일부 맞음 | 핵심 project/lane 정확 |
| Clarification | 무관하거나 과다 | 일부 유효 | 부족한 정보만 정확히 질문 |
| Work item 분해 | 구현 불가 수준 | 거칠지만 진행 가능 | 실행/리뷰 가능한 slice로 분해 |
| Acceptance criteria | 추상적 | 일부 측정 가능 | 구체적이고 테스트 가능 |
| Domain risk | 놓침 | 일부 언급 | 규제/운영/traceability 리스크 포함 |
| Review evidence | 없음 | 일부 있음 | 어떤 evidence가 필요한지 명확 |

권장 판정:

- `10~12`: domain-aware PM usable
- `7~9`: 기본 구조화는 가능, 도메인 맥락은 보강 필요
- `0~6`: 아직 template-driven PM에 가까움

## 2026-03-15 Live 검증 결과

실제 live fixture 회사 `cloud-swiftsight-route-rebuild`에서 아래를 확인했다.

1. `preview correctness`
2. `same preview draft -> apply`
3. `bounded delivery`
4. `clarification ask/answer/resume`
5. `review / QA / close`

즉 단순 preview 점수만이 아니라 실제 child delivery가 `done`까지 닫히는지 함께 확인했다.

결과:

| Scenario | Selected project | Preview | Delivery | Overall |
|---|---|---:|---:|---:|
| `workflow_mismatch_diagnostics` | `swiftsight-cloud` | 12/12 | 8/8 | 20/20 |
| `pacs_delivery_audit_evidence` | `swiftsight-agent` | 12/12 | 8/8 | 20/20 |
| `multi_destination_artifact_routing` | `swiftcl` | 12/12 | 8/8 | 20/20 |

이 결과는 `cloud-swiftsight` 전용 shortcut을 넣어서 얻은 것이 아니다.

실제 수정 축은 아래 generic policy였다.

- preview request에 `requiredKnowledgeTags` 추가
- knowledge metadata 기반 `owner/support/avoid` scoring
- project 문서량이 많은 repo가 lexical overlap만으로 이기는 것을 막기 위해 ambient knowledge score capped weighting 적용

따라서 이번 결과는 `SwiftSight-specific hardcode`가 아니라, **generic project-selection/RAG weighting 개선이 실제 도메인 fixture에서도 먹혔다**는 의미로 해석해야 한다.

## 평가 시나리오 템플릿

각 평가 케이스는 아래 형식으로 만든다.

### 입력

- 인간 요청 원문
- 필요한 최소 배경
- non-goal

### PM이 찾아야 하는 것

- 관련 project
- 관련 repo/module
- coordination 필요 여부
- 필요한 clarification

### 기대 산출물

- structured title
- execution summary
- child work items
- acceptance criteria
- review/QA evidence

### 실패 신호

- 잘못된 프로젝트 선택
- 질문을 안 하거나 너무 많이 함
- runtime/compile-time 경계를 섞음
- 규제/추적성 요구를 누락

## 추천 평가 시나리오

### 시나리오 A. Workflow mismatch diagnostics

#### 요청 원문

`특정 MR study가 왜 workflow에 매칭되지 않았는지 운영자가 설명 가능하게 보여줘. 실패하면 어떤 조건이 안 맞았는지도 보여줘.`

#### 왜 좋은가

- 단순 코드 수정이 아니라 도메인 판단이 필요하다
- `swiftsight-cloud`의 Settings/Trigger 경계와 `swiftcl`의 workflow matching 책임을 함께 이해해야 한다
- 사람이 implementation detail은 몰라도 문제의 업무 의미는 명확히 설명할 수 있다

#### PM이 찾아야 하는 핵심 맥락

- 설정은 `swiftsight-cloud`가 관리하지만, matching/transform 논리는 `swiftcl`과 맞닿아 있다
- 진단 결과는 운영 surface에 노출될 수 있지만, 실제 matching 근거는 workflow/series 조건이다
- PHI/metadata 노출 수준을 clarification 해야 한다

#### 기대 project/lane

- 기본: `swiftsight-cloud`
- cross-project 검토: `swiftcl`
- reviewer/QA는 cloud lane 기준, compiler 영향이 크면 `swiftcl` TL review 포함 가능

#### 기대 clarification

- 어떤 사용자 surface에 보여줄지: operator API, UI, internal log 중 무엇인지
- 환자/Study metadata를 어느 수준까지 노출 가능한지
- single failed study 진단인지, batch triage인지

#### 기대 child work item

1. Settings/workflow match 진단 payload 정의
2. match failure reason 수집 또는 compiler diagnostics 노출 방식 정의
3. operator read surface 또는 API 응답 shape 추가
4. review/QA용 regression test 추가

#### 기대 acceptance criteria

- workflow 미매칭 study에 대해 reason 목록이 남는다
- 성공 케이스와 실패 케이스가 구분된다
- PHI 노출 정책을 위반하지 않는다

### 시나리오 B. PACS 전달 실패 audit evidence 강화

#### 요청 원문

`PACS 전달이 실패했을 때 cloud와 agent 양쪽 evidence를 한 번에 추적할 수 있게 해줘. 어떤 단계에서 실패했는지 운영자가 바로 알아야 해.`

#### 왜 좋은가

- 실제 의료 현장 운영성과 traceability가 걸린다
- `swiftsight-agent`와 `swiftsight-cloud` 경계를 동시에 읽어야 한다
- 단순 로그 추가가 아니라 command lifecycle과 audit surface 설계가 필요하다

#### PM이 찾아야 하는 핵심 맥락

- Agent는 `SEND` 명령을 실제로 수행하고 결과를 Cloud에 보고한다
- Cloud는 Registry/Temporal/Agent stream 쪽에서 상태를 조합할 수 있다
- 실패 원인은 download, PACS connect, C-STORE, retry exhaustion 등 여러 단계다

#### 기대 project/lane

- coordination root 권장
- child 1: `swiftsight-agent`
- child 2: `swiftsight-cloud`

#### 기대 clarification

- 필요한 evidence가 operator UI인지 audit export인지
- retry 이후 최종 실패만 볼지, 중간 attempt도 볼지
- PHI/endpoint 정보 마스킹 정책

#### 기대 child work item

1. agent command failure taxonomy 정리
2. cloud-side audit/event ingestion 확장
3. delivery evidence read model 또는 timeline surface 추가
4. focused integration test 추가

#### 기대 acceptance criteria

- 운영자가 한 study의 SEND 실패를 end-to-end로 추적할 수 있다
- 어느 단계에서 실패했는지 구분 가능하다
- retry/최종 실패가 timeline으로 보인다

### 시나리오 C. Multi-destination artifact routing 정책 추가

#### 요청 원문

`같은 분석에서 segmentation artifact는 PACS A와 PACS B로 보내고, physician report는 PACS A에만 보내는 설정을 지원해줘.`

#### 왜 좋은가

- 설정, compiler, runtime delivery를 모두 이해해야 한다
- `swiftcl`의 artifact-based route와 `swiftsight-cloud` runtime orchestration, `swiftsight-agent` SEND 수행을 함께 읽어야 한다

#### PM이 찾아야 하는 핵심 맥락

- `swiftcl`은 artifact routing을 가진다
- destination policy가 compile-time 정의인지 runtime override인지 정해야 한다
- agent SEND가 artifact/destination 단위 fan-out을 견딜 수 있어야 한다

#### 기대 project/lane

- coordination root 권장
- child 1: `swiftcl`
- child 2: `swiftsight-cloud`
- child 3: `swiftsight-agent` 가능

#### 기대 clarification

- artifact 구분 기준이 무엇인지
- destination 정책이 병원별 설정인지 workflow별 설정인지
- partial delivery failure 시 성공/실패를 어떻게 기록할지

#### 기대 child work item

1. route policy contract 확장
2. compiler output parity 정리
3. runtime delivery fan-out 처리
4. evidence/QA verification 추가

#### 기대 acceptance criteria

- artifact별 destination policy를 설정할 수 있다
- 잘못된 policy는 compile 또는 validation 단계에서 걸린다
- runtime에서 각 destination 결과가 추적 가능하다

### 시나리오 D. Analysis provenance before report delivery

#### 요청 원문

`리포트와 PACS 전달 전에 어떤 모델 버전과 worker 실행 결과로 이 분석이 만들어졌는지 evidence를 남겨줘.`

#### 왜 좋은가

- 실제 의료/규제 도메인 요구다
- `swiftsight-cloud` registry/temporal, `swiftsight-worker` execution provenance, report delivery traceability를 함께 읽어야 한다

#### 주의

- 현재 `swiftsight-worker` 문서 밀도가 상대적으로 낮다
- 따라서 이 시나리오는 advanced tier로 두는 편이 좋다

#### 기대 project/lane

- coordination root 권장
- child 1: `swiftsight-cloud`
- child 2: `swiftsight-worker`

#### 기대 clarification

- evidence를 operator용으로 볼지 external audit export까지 포함할지
- model version, git sha, container image, runtime params 중 어디까지 남길지
- PHI와 provenance를 같은 payload에 둘지 분리할지

## 첫 평가로 추천하는 시나리오

처음 한 번 돌릴 때는 **시나리오 B**를 추천한다.

이유:

- 실제 의료 운영 맥락이 있다
- cross-project 판단이 필요하다
- 사람이 성공/실패를 판정하기 쉽다
- PM이 clarification을 잘 해야 좋은 결과가 나온다

그 다음은 **시나리오 A**, 마지막으로 **시나리오 C** 순서가 좋다.

## 실제 실행 절차

1. 평가할 시나리오 하나를 고른다
2. 관련 repo 문서를 knowledge에 노출한다
   - 최소: 각 repo README
   - 가능하면 PRD/KB 문서도 포함
3. 사람은 요청 원문만 던진다
4. PM projection 결과를 저장한다
5. 아래 항목으로 채점한다
   - project 선택
   - clarification 품질
   - child work item 구조
   - acceptance criteria
   - review/QA evidence
6. 부족한 점을 다시 RAG 요구사항으로 환류한다

## 평가 시 반드시 볼 실패 패턴

1. `swiftsight-cloud` 하나로 모든 걸 처리하려고 함
2. `swiftcl`을 단순 CLI repo로만 보고 compiler 책임을 놓침
3. `agent`를 단순 upload client로만 보고 PACS delivery evidence를 놓침
4. 규제/traceability 요구를 non-functional note로만 밀어둠
5. clarification이 너무 추상적이거나 너무 많음

## 이 문서의 용도

이 문서는 두 용도로 쓴다.

1. live PM evaluation 시나리오 설계
2. 향후 `RAG 자연어 코드 의미층`이 실제로 PM 판단 깊이를 얼마나 끌어올렸는지 비교하는 기준점

즉 동일 시나리오를 다음 두 상태에서 비교할 수 있다.

- 현재: code chunk + symbol graph + issue/history 중심
- 향후: natural-language code summary layer 추가 후

비교 지표는 아래가 좋다.

- clarification 횟수
- project misroute 여부
- child work item 품질
- acceptance criteria 구체성
- reviewer/QA evidence 품질

## 결론

`cloud-swiftsight`에서 진짜 보고 싶은 것은 “PM이 기능 요청을 예쁘게 문장화하느냐”가 아니다.

진짜 보고 싶은 것은 아래다.

1. 도메인 경계를 제대로 읽는가
2. compile-time과 runtime 책임을 구분하는가
3. cross-project coordination이 필요한 순간을 알아채는가
4. 의료 운영/추적성 요구를 빠뜨리지 않는가

이 문서의 시나리오들은 그 네 가지를 보도록 설계했다.
