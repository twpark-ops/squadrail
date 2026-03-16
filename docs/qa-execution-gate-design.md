# QA Execution Gate Design

작성일: 2026-03-16  
작성자: Taewoong Park <park.taewoong@airsmed.com>

## 1. 목표

`Squadrail`의 `QA`를 더 이상 “reviewer 확장판”으로 두지 않고, **프로젝트별 실행 검증 오퍼레이터**로 재정의한다.

즉 QA는 아래를 수행해야 한다.

1. 프로젝트가 제공한 검증 도구를 실행한다.
2. 준비된 fixture를 주입한다.
3. 실제 프로그램 동작 결과를 확인한다.
4. evidence를 구조적으로 남긴다.
5. evidence가 없으면 `approved`로 올리지 않는다.

## 2. 현재 상태

현재 커널은 이미 `reviewer -> QA -> approved -> close` 방향을 지원한다.

- reviewer approval 뒤 `qaAgentId`가 있으면 `qa_pending`으로 전이된다.  
  근거: [issue-protocol.ts](/home/taewoong/company-project/squadall/server/src/services/issue-protocol.ts#L392)
- QA gate wake는 `issue_ready_for_qa_gate`로 발생한다.  
  근거: [issue-protocol-execution.ts](/home/taewoong/company-project/squadall/server/src/services/issue-protocol-execution.ts#L403)
- QA sender는 자기 QA slot에서만 동작한다.  
  근거: [issue-protocol.ts](/home/taewoong/company-project/squadall/server/src/services/issue-protocol.ts#L631)

하지만 지금 QA는 아직 충분히 제품화되지 않았다.

### 2.1 현재 부족한 점

1. **QA tool contract 부재**
   - 어떤 명령을 실행해야 하는지 프로젝트별로 구조화돼 있지 않다.
2. **fixture contract 부재**
   - 어떤 DICOM / sample input / test dataset을 써야 하는지 공식 shape가 없다.
3. **evidence contract 부재**
   - QA가 무엇을 실행했고, 무엇을 봤고, pass/fail을 왜 판단했는지 구조적으로 강제되지 않는다.
4. **reviewer/QA 역할 경계 일부 중첩**
   - QA agent가 기술적으로 reviewer role도 가질 수 있다.  
     근거: [issues.ts](/home/taewoong/company-project/squadall/server/src/routes/issues.ts#L85)

### 2.2 현재 QA 흐름 (AS-IS)

현재 실제 흐름은 아래에 가깝다.

1. `Reviewer APPROVE_IMPLEMENTATION`
2. `qa_pending`
3. QA wake
4. QA가 brief를 읽음
5. `START_REVIEW`
6. `APPROVE_IMPLEMENTATION` 또는 `REQUEST_CHANGES`

하지만 이 흐름은 아직 실행 검증 중심이 아니다.

- QA workspace usage는 현재 사실상 `review`로 분류된다.  
  근거: [project-workspace-routing.ts](/home/taewoong/company-project/squadall/server/src/services/project-workspace-routing.ts#L243)
- QA brief에는 `runbook`이 섞일 수 있지만, “반드시 실행하라”는 강한 guidance는 아직 없다.  
  근거: [issue-retrieval.ts](/home/taewoong/company-project/squadall/server/src/services/issue-retrieval.ts#L1635), [server-utils.ts](/home/taewoong/company-project/squadall/packages/adapter-utils/src/server-utils.ts#L727)
- `APPROVE_IMPLEMENTATION` payload는 generic approval evidence는 강제하지만, QA 실행 evidence를 별도로 강제하지는 않는다.  
  근거: [issue-protocol-policy.ts](/home/taewoong/company-project/squadall/server/src/services/issue-protocol-policy.ts#L161)

즉 지금 QA는 `runbook/test_report/code/review`를 읽고 승인하는 방향에 더 가깝고, 네가 원하는 “실제 프로그램 실행 검증”까지는 아직 제품 계약이 부족하다.

## 3. 역할 재정의

### 3.1 Reviewer

Reviewer는 **코드 품질 / 설계 / diff / 테스트 범위**를 본다.

- 구현이 요구사항에 맞는가
- 설계가 안전한가
- 변경 범위가 적절한가
- 테스트 전략이 충분한가
- release risk가 설명됐는가

Reviewer는 “실행 검증자”가 아니다.

### 3.2 QA Engineer

QA Engineer는 **프로젝트 실행 검증자**다.

- 개발된 프로그램을 실제로 실행할 수 있어야 한다.
- 프로젝트가 제공하는 검증 도구를 다룰 수 있어야 한다.
- fixture를 실제로 주입할 수 있어야 한다.
- 결과를 수집하고 evidence로 남길 수 있어야 한다.
- evidence가 모자라면 `REQUEST_CHANGES`로 돌려보낼 수 있어야 한다.

도메인 예시:

- `swiftsight-agent`
  - 준비된 DICOM fixture를 전송
  - agent/service pipeline 실행
  - expected output / log / artifact 확인
- `swiftsight-cloud`
  - API / workflow / export flow 실행
  - expected state transition / output artifact / audit trace 확인
- `swiftcl`
  - compile or generation command 실행
  - generated output or validation result 확인

### 3.3 QA Lead

QA Lead는 **검증 정책 설계자**다.

- 프로젝트별 QA sanity contract를 정의
- fixture/tool/runbook 기준을 정함
- QA evidence 요구 수준을 결정
- cross-project regression or release risk를 관리

즉 QA Lead는 “검증 방법을 설계”, QA Engineer는 “그 방법을 실행”한다.

## 4. 제품 원칙

### 4.1 QA는 slot이 아니라 capability + contract다

`qaAgentId`만 있다고 QA가 되는 것이 아니다.

QA가 성립하려면 최소 3개가 함께 있어야 한다.

1. `QA role`
2. `QA tools`
3. `QA contract`

### 4.2 QA는 프로젝트별로 다르게 실행된다

QA는 회사 공통 role이지만, 실행 방식은 프로젝트마다 달라진다.

예:

- DICOM sender
- REST/ConnectRPC smoke probe
- export artifact checker
- fixture loader
- focused system command

그래서 제품은 `generic QA gate kernel + project-scoped validation contract` 구조가 맞다.

### 4.3 QA 승인에는 evidence가 필수다

QA approval은 단순 텍스트 메시지로 충분하지 않다.

최소 아래가 남아야 한다.

- 어떤 tool을 실행했는가
- 어떤 fixture를 사용했는가
- 어떤 command/entrypoint를 썼는가
- 어떤 output을 확인했는가
- pass/fail/block 판단은 무엇인가

## 5. 제안 구조

## 5.1 Project QA Contract

각 프로젝트는 선택적으로 아래 QA contract를 가진다.

```ts
type ProjectQaContract = {
  enabled: boolean;
  sanityProfiles: QaSanityProfile[];
  defaultProfileKey?: string | null;
  tools: QaToolDefinition[];
  fixtures: QaFixtureDefinition[];
  evidencePolicy: QaEvidencePolicy;
};
```

### 5.1.1 QaSanityProfile

```ts
type QaSanityProfile = {
  key: string;
  label: string;
  goal: string;
  toolKeys: string[];
  fixtureKeys: string[];
  steps: QaExecutionStep[];
  expectedSignals: QaExpectedSignal[];
  requiredEvidence: QaEvidenceRequirement[];
  appliesToTags?: string[];
};
```

예시:

- `dicom_ingest_smoke`
- `cloud_export_handoff_smoke`
- `swiftcl_generation_smoke`

### 5.1.2 QaToolDefinition

```ts
type QaToolDefinition = {
  key: string;
  kind: "command" | "script" | "api_probe" | "fixture_sender" | "checker";
  label: string;
  description: string;
  commandTemplate: string;
  workspaceMode: "shared" | "isolated" | "project_runtime";
  timeoutSeconds?: number;
};
```

핵심은 QA가 프로젝트별로 **실행 가능한 표준 도구 세트**를 가지는 것이다.

### 5.1.3 QaFixtureDefinition

```ts
type QaFixtureDefinition = {
  key: string;
  label: string;
  fixtureType: "dicom" | "payload" | "archive" | "config" | "dataset";
  location: string;
  description?: string;
  expectedUse?: string;
  sensitivity?: "safe" | "restricted";
};
```

### 5.1.4 QaEvidencePolicy

```ts
type QaEvidencePolicy = {
  requireCommandLog: boolean;
  requireFixtureTrace: boolean;
  requireResultSummary: boolean;
  requireArtifactLinks: boolean;
  requireScreenshot?: boolean;
};
```

## 5.2 QA Protocol Artifact Contract

QA 관련 protocol message에는 아래 artifact type을 추가한다.

- `qa_plan`
- `qa_run`
- `qa_fixture_trace`
- `qa_result`
- `qa_evidence_bundle`

예시 shape:

```ts
type QaRunArtifact = {
  profileKey: string;
  toolKey: string;
  fixtureKeys: string[];
  command: string;
  exitCode: number | null;
  outputSummary: string;
  startedAt: string;
  finishedAt: string | null;
};
```

```ts
type QaResultArtifact = {
  verdict: "pass" | "fail" | "blocked";
  expectedBehavior: string;
  observedBehavior: string;
  residualRisks: string[];
  followUpRequired: boolean;
};
```

## 5.3 QA State Semantics

상태머신 자체는 지금 방향을 유지한다.

1. reviewer approval
2. `qa_pending`
3. QA `START_REVIEW`
4. `under_qa_review`
5. QA `REQUEST_CHANGES` or `APPROVE_IMPLEMENTATION`
6. `approved`
7. TL/PM/CTO `CLOSE_TASK`

추가 강제 규칙:

1. `qaAgentId`가 있으면 QA approval 전 close 금지
2. QA approval 시 required evidence artifact 없으면 reject
3. QA는 assigned profile/tool/fixture 중 최소 sanity 하나를 실행해야 함

### 5.3.1 목표 QA 흐름 (TO-BE)

목표 상태는 아래다.

1. `Reviewer APPROVE_IMPLEMENTATION`
2. `qa_pending`
3. QA wake with execution-oriented context
4. QA reads runbook-first brief
5. QA records execution plan
6. QA runs project-defined sanity commands
7. QA injects fixture or probe input
8. QA checks output / logs / result artifact
9. QA sends:
   - `APPROVE_IMPLEMENTATION` with execution evidence
   - 또는 `REQUEST_CHANGES` with failure evidence

이때 QA는 **코드 읽기만으로 승인하면 안 된다.**

## 5.4 Workspace / Runtime Policy

QA는 code edit role이 아니므로 기본값은 아래가 맞다.

- shared workspace: brief/diff/log/evidence 검토
- project runtime or validation workspace: 실제 sanity 실행

즉 QA는 “shared workspace only”가 아니다.  
**프로그램을 실행해야 하므로 검증용 runtime surface가 필요하다.**

권장 정책:

1. code edit: 금지
2. runtime execution: 허용
3. fixture send / probe / checker 실행: 허용
4. broad destructive command: 금지

### 5.4.1 최소 구현 선택지

이 부분은 두 단계로 나누는 것이 맞다.

#### Option A. Small first slice

새 `qa` workspace type을 바로 만들지 않고, QA gate run에서 `implementation` workspace override를 허용하되 write guard를 추가한다.

장점:

- 변경 범위가 작다
- 기존 workspace router와 adapter 경로를 덜 흔든다

단점:

- `review`와 `qa`의 의미가 런타임 타입으로는 여전히 덜 분리된다

#### Option B. Full explicit model

shared `ProjectWorkspaceUsageProfile`에 `qa`를 추가하고, routing / policy / UI가 이를 first-class로 취급한다.

장점:

- 의미가 명확하다
- 나중에 QA-specific guard나 metrics를 붙이기 쉽다

단점:

- shared/server/adapter 전부 건드려야 한다

권장:

- **1차는 Option A**
- **제품 모델이 안정되면 Option B**

즉 지금 당장 필요한 것은 “QA가 실행 가능한 환경을 갖는 것”이고, `qa` 타입의 완전한 first-class 승격은 그 다음 단계가 맞다.

## 5.5 최소 구현 Slice

현재 설계에서 가장 먼저 들어갈 실제 구현 slice는 아래 4층이다.

### Layer 1. Runbook-first brief

대상:

- [issue-retrieval.ts](/home/taewoong/company-project/squadall/server/src/services/issue-retrieval.ts)

내용:

1. QA brief에서 `runbook`을 최우선 source로 pin
2. `test_report`를 그 다음에 둠
3. runbook hit가 0이면 `qa_runbook_missing` warning을 brief metadata에 추가

핵심 목적:

- QA가 “무엇을 실행해야 하는지”를 먼저 읽게 한다

### Layer 2. QA execution guidance

대상:

- [server-utils.ts](/home/taewoong/company-project/squadall/packages/adapter-utils/src/server-utils.ts)
- [protocol-run-requirements.ts](/home/taewoong/company-project/squadall/packages/shared/src/protocol-run-requirements.ts)

내용:

`qa_gate_reviewer` guidance에 아래를 명시한다.

- QA는 built software를 실행해야 한다
- runbook이 없으면 `ASK_CLARIFICATION`
- approval 전 실행 evidence를 기록해야 한다
- 코드 읽기만으로는 승인할 수 없다

예시 evidence field:

- `executionLog`
- `fixtureUsed`
- `outputVerified`
- `sanityCommand`

### Layer 3. QA execution evidence gate

대상:

- [issue-protocol-policy.ts](/home/taewoong/company-project/squadall/server/src/services/issue-protocol-policy.ts)

내용:

QA sender가 보내는 `APPROVE_IMPLEMENTATION`에는 generic approval evidence 외에 최소 하나의 execution evidence를 강제한다.

예:

- `executionLog`
- `outputVerified`
- `fixtureUsed`
- `sanityCommand`

주의:

- 이 검증은 `issue-protocol.ts`보다 **policy layer**에 넣는 것이 맞다
- 현재 approval payload 중앙 검증이 이미 policy layer에 있기 때문이다

### Layer 4. QA runtime workspace policy

대상:

- [project-workspace-routing.ts](/home/taewoong/company-project/squadall/server/src/services/project-workspace-routing.ts)
- [constants.ts](/home/taewoong/company-project/squadall/packages/shared/src/constants.ts#L122)

내용:

1차:

- QA gate run에서 implementation-capable workspace를 쓸 수 있게 override
- write guard 유지

2차:

- shared usage profile에 `qa`를 추가
- QA 전용 workspace semantics를 first-class로 승격

## 5.6 DICOM-type domain interpretation

네가 말한 도메인 기준으로 QA는 사실상 아래를 할 수 있어야 한다.

1. 준비된 DICOM fixture를 고른다
2. 대상 프로그램 또는 서비스가 떠 있는지 확인한다
3. 정해진 sender / probe / command로 fixture를 주입한다
4. output, downstream trace, log, artifact를 확인한다
5. pass / fail / blocked를 evidence와 함께 남긴다

즉 이 도메인에서 QA는 “테스트 로그를 읽는 사람”이 아니라 **프로그램 실행 검증 오퍼레이터**다.

## 6. DICOM 도메인 예시

`swiftsight-agent` 기준 최소 sanity profile 예시:

### 6.1 Profile

- key: `dicom_send_sanity`
- goal: “준비된 DICOM fixture를 전송했을 때 ingest path가 정상 동작하고 expected downstream signal이 남는가”

### 6.2 Tools

- `agent_start_or_probe`
- `dicom_fixture_sender`
- `ingest_log_checker`
- `output_artifact_checker`

### 6.3 Fixtures

- `fixture_dicom_ct_small`
- `fixture_dicom_mr_small`

### 6.4 Required Evidence

- 실행 command
- 사용 fixture
- 전송 대상 endpoint or runtime
- output/log summary
- pass/fail verdict

즉 QA는 “테스트가 있다고 적혀 있네”가 아니라, **실제 DICOM을 보내서 프로그램이 도는지 확인**해야 한다.

## 7. UI / Operator Surface

QA gate UI는 최소 아래를 보여줘야 한다.

1. 선택된 QA profile
2. 사용할 tools / fixtures
3. 현재 evidence completeness
4. QA verdict
5. close readiness

`IssueDetail` / `ChangeReviewDesk` / `Stage`에 필요한 표시:

- `qa_pending`
- `under_qa_review`
- active profile label
- evidence completeness chip
- last QA verdict

## 8. 구현 순서

### Phase A. Contract

- shared `ProjectQaContract`
- shared QA artifact schema
- project metadata route
- QA execution evidence payload schema

### Phase B. Runtime / Protocol

- runbook-first brief + `qa_runbook_missing`
- QA prompt guidance
- QA approval evidence gate
- close readiness 강화

### Phase C. Role Packs

- QA Engineer prompt를 “실행 검증자” 중심으로 교체
- QA Lead prompt를 “검증 정책 설계자” 중심으로 교체

### Phase D. Project Tooling

- 프로젝트별 sanity profile 추가
- 최소 tool wrapper / script / checker 추가

### Phase E. UI

- Issue detail QA panel
- evidence completeness
- QA profile / fixture / result trace

### Phase F. E2E

- reviewer approval -> QA gate -> close
- 실제 fixture 전송 기반 sanity proof
- failure path: QA changes requested

## 9. Non-Goals

이번 설계에서 바로 하지 않는 것:

1. 모든 프로젝트를 동일한 QA 방식으로 통일
2. QA가 full end-to-end release approval을 단독 소유
3. QA가 implementation owner 역할을 겸하는 것

## 10. 최종 판단

지금 `Squadrail`에 QA를 제대로 넣으려면, 핵심은 QA agent 숫자를 늘리는 게 아니다.

필요한 것은 아래 세 가지다.

1. **QA를 reviewer와 분리된 실행 검증 역할로 고정**
2. **프로젝트별 QA tool/fixture/sanity contract 제공**
3. **QA approval에 evidence를 강제**

한 줄로 요약하면:

**QA는 “코드가 괜찮아 보이는지”를 보는 사람이 아니라, 프로젝트가 제공한 검증 도구와 fixture를 사용해 “개발된 프로그램이 실제로 동작하는지”를 확인하는 실행 검증자여야 한다.**
