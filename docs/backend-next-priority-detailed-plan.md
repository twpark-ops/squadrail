# Backend Next Priority Detailed Plan

작성일: 2026-03-12
기준 커밋: `163a444` `feat(retrieval): consolidate cache provenance trends`
작성자: Taewoong Park <park.taewoong@airsmed.com>

## 목적

`ranking/cache/trend consolidation` 1차 이후 남은 백엔드 후속 작업을 다음 세 우선순위로 고정하고, 각 항목을 바로 구현 가능한 슬라이스로 풀어 적는다.

현재 제품 방향은 계속 `standardized software delivery org kernel`이다.
즉 지금은 새 protocol/kernel 확장이나 peer mode 실험보다, retrieval 재사용성과 운영 계측을 제품 수준으로 닫는 것이 우선이다.

## 상태 업데이트

- `cross-issue memory reuse`는 2026-03-12 세션에서 완료됐다.
  - related issue identifier 추출, prior issue artifact boost, reuse trace surface, reuse quality metric을 retrieval/knowledge 표면에 연결했다.
  - `server/src/services/retrieval/query.ts`, `server/src/services/retrieval/quality.ts`를 추가했고 `issue-retrieval`, `shared`, `scoring`, `knowledge`를 같이 갱신했다.
  - focused tests + `pnpm -r typecheck` + `pnpm test:run` + `pnpm build`를 모두 통과했다.
- 같은 세션에서 `18-agent real-org burn-in`도 재실행 후 `ok=true`로 닫혔다.
  - `scripts/runtime/squadrail-protocol.mjs` sender-role 추론 보강
  - `scripts/e2e/cloud-swiftsight-real-org.mjs`의 `diff || commit` artifact 허용, active-run timeout grace, HEAD-aware base repo snapshot check 보강
  - single-lane `CLO-204`~`CLO-207` done, coordinated root `CLO-208` cancelled(child fan-out archive), child `CLO-209`~`CLO-211` done

## 현재 남은 우선순위

1. `rerank provider abstraction` 2차
2. `execution lane / fast lane` 실운영 계측

한 줄 요약:

- 다음 구현은 `provider chain / fallback / rerank debug surface를 운영 가능한 수준으로 닫는 것`이다.

## Completed: Cross-Issue Memory Reuse

### 완료 메모

- reusable prior issue artifact taxonomy를 `decision / fix / review / close` 계열로 retrieval scoring에 연결했다.
- follow-up/related issue identifier 추출과 `knowledge_chunk_links` backlink를 합성해 reuse seed를 주입했다.
- brief quality / knowledge quality summary에 `reuseRunCount`, `reuseHitRate`, `reuseIssueCount`, `reuseDecisionHitCount`, `reuseCloseHitCount` 등 trace를 추가했다.
- 이 항목은 현재 완료된 worklog로 남기고, 다음 세션 시작점은 `rerank provider abstraction` 2차로 이동한다.

### 목표

- 과거 issue / protocol / review / close artifact가 follow-up issue의 retrieval과 planning에 직접 재사용되게 만든다.
- 단순히 knowledge에 적재돼 있는 수준이 아니라, 이번 issue가 어떤 과거 issue 근거를 재사용했는지 trace 가능하게 만든다.

### 왜 지금 하는가

- issue / protocol / review artifact ingest는 이미 완료됐다.
- graph seed와 cache provenance도 이미 제품 surface에 올라왔다.
- 따라서 다음 병목은 `더 많이 적재하는 것`이 아니라 `이미 적재된 조직 기억을 실제로 다시 쓰는 것`이다.

### 이미 있는 기반

- `issue_snapshot` 문서 적재:
  - `server/src/services/organizational-memory-ingest.ts`
- `protocol_event` / `review_event` 문서 적재:
  - `server/src/services/organizational-memory-ingest.ts`
- related issue linkage:
  - payload에서 `linkedIssueIds` 추출
  - link reason `protocol_related_issue`
- retrieval graph seed:
  - `top_hit_issue_context`
  - `linked_issue_context`
  - `top_hit_changed_path`

즉 완전히 새 시스템을 만드는 것이 아니라, 이미 있는 organizational memory linkage를 retrieval 재사용으로 끝까지 연결하는 작업이다.

### 설계 원칙

1. 첫 슬라이스에서는 새 테이블 없이 시작한다.
2. reuse trace는 `retrievalRun.queryDebug`와 brief quality에서 먼저 노출한다.
3. lane-aware retrieval cost를 깨면 안 된다.
4. organizational memory가 code/test evidence를 다시 압도하게 만들면 안 된다.
5. **PEER MODE나 새 protocol state 확장으로 새지 않는다.**

### 구현 슬라이스

#### Slice 1-A. Reuse Taxonomy Audit

목표:

- 재사용 가능한 과거 artifact를 `decision`, `fix`, `review`, `close` 계열로 정리한다.

작업:

1. 기존 metadata 필드를 정리한다.
2. `issue_snapshot`, `protocol_event`, `review_event` 중 무엇을 어떤 목적에 재사용할지 분류한다.
3. close 관련 payload에서 `closureSummary`, `verificationSummary`, `rollbackPlan`, `remainingRisks`, `followUpIssueIds`를 우선 재사용 대상으로 본다.
4. review 관련 payload에서는 `REQUEST_CHANGES`, `APPROVE_IMPLEMENTATION`, `reviewChecklist`, `implementationSummary`를 우선 대상으로 본다.

산출물:

- artifact kind -> reuse intent 매핑 표
- retrieval scoring에서 읽을 최소 metadata 목록

#### Slice 1-B. Reuse Signal Injection

목표:

- 현재 issue가 follow-up/related issue일 때 과거 issue artifact가 retrieval 후보와 seed로 실제 반영되게 만든다.

작업:

1. issue text, labels, linked issue chain, close follow-up chain에서 prior issue hint를 추출한다.
2. graph expansion seed에 reusable prior issue context를 명시적으로 추가한다.
3. candidate shaping에서 prior issue artifact를 narrow boost로 반영한다.
4. `decision/fix/review/close`별로 과도하지 않은 boost를 준다.

가드레일:

- code/test exact path가 있는 경우 prior issue artifact는 보조 증거로만 남긴다.
- cross-issue reuse 때문에 source diversity가 줄면 안 된다.

#### Slice 1-C. Reuse Trace Surface

목표:

- retrieval run과 brief에서 “무엇을 재사용했는지” 설명 가능하게 만든다.

추가 필드 예시:

- `reuseHitCount`
- `reusedIssueIds`
- `reusedIssueIdentifiers`
- `reuseArtifactKinds`
- `reuseDecisionHitCount`
- `reuseFixHitCount`
- `reuseReviewHitCount`
- `reuseCloseHitCount`

노출 위치:

1. `retrievalRun.queryDebug`
2. brief `quality`
3. `/api/knowledge/quality`
4. recent retrieval runs read model

#### Slice 1-D. Reuse Metric

목표:

- reuse가 실제로 발생하는지 project / role / sourceType 기준으로 읽게 만든다.

추가 지표 예시:

- `reuseRunCount`
- `reuseHitRate`
- `averageReuseHitCount`
- `reuseArtifactKindCounts`
- `reuseIssueCount`
- `dailyTrend.reuseRuns`

#### Slice 1-E. Tests

필수 테스트:

1. follow-up issue가 prior close/review artifact를 retrieval 후보로 재사용하는지
2. exact path/code evidence가 있을 때 organizational memory가 top evidence를 독점하지 않는지
3. reuse trace가 brief quality와 recent runs/quality summary에 같이 보이는지
4. cache/lane 키가 reuse metadata 추가로 불안정해지지 않는지

우선 테스트 파일:

- `server/src/__tests__/issue-retrieval.test.ts`
- `server/src/__tests__/knowledge-routes.test.ts`
- 필요 시 `server/src/__tests__/knowledge-quality-trend.test.ts`

### 우선 구현 파일

- `server/src/services/issue-retrieval.ts`
- `server/src/services/retrieval/graph.ts`
- `server/src/services/retrieval/scoring.ts`
- `server/src/services/organizational-memory-ingest.ts`
- `server/src/services/knowledge.ts`

### 완료 기준

1. follow-up issue 하나 이상에서 과거 issue/review/close artifact가 final evidence에 실제 포함된다.
2. retrieval debug에서 `어떤 issue를 왜 재사용했는지`가 보인다.
3. quality summary에서 reuse 지표를 읽을 수 있다.
4. `pnpm -r typecheck`, `pnpm test:run`, `pnpm build`가 모두 통과한다.

## 1. Rerank Provider Abstraction 2차

### 목표

- 단일 active provider 선택을 넘어, 복수 provider 전략과 graceful fallback 정책을 실제 운영 설정으로 연다.

### 왜 다음 순서인가

- 1차에서는 `openai | generic_http | null` capability와 unavailable reason만 정리했다.
- 아직 provider chain, fallback semantics, per-provider failure accounting은 없다.
- cross-issue reuse 이후 retrieval candidate quality가 늘어나면 rerank fallback의 안정성이 더 중요해진다.

### 현재 상태

- provider resolution:
  - `server/src/services/knowledge-rerank/config.ts`
- transport:
  - `server/src/services/knowledge-rerank/providers.ts`
- facade:
  - `server/src/services/knowledge-reranking.ts`

### 구현 슬라이스

#### Slice 2-A. Provider Chain Config

작업:

1. 단일 provider가 아니라 ordered provider list를 해석한다.
2. 각 provider별 `timeout`, `maxCandidates`, `auth`, `model`을 설정 단위로 분리한다.
3. 기본 fallback 순서를 정의한다.

예시:

1. `openai`
2. `generic_http`
3. heuristic/no-model fallback

#### Slice 2-B. Failure Taxonomy

작업:

1. timeout
2. 429/rate limit
3. 5xx/provider unavailable
4. invalid response shape
5. unsupported capability

이유:

- 현재는 단순 throw 위주라 운영자가 fallback 이유를 읽기 어렵다.

#### Slice 2-C. Run Debug / Surface

작업:

1. retrieval run debug에 `rerankProviderAttempted`, `rerankProviderUsed`, `rerankFallbackReason`, `rerankAttemptCount`를 기록한다.
2. quality summary나 recent runs에서 fallback 분포를 읽게 만든다.

#### Slice 2-D. Tests

필수 테스트:

1. primary provider timeout 시 secondary provider fallback
2. malformed response 시 fallback
3. provider chain 전부 실패 시 heuristic order 유지
4. fallback reason이 debug/surface에 남는지

### 우선 구현 파일

- `server/src/services/knowledge-rerank/config.ts`
- `server/src/services/knowledge-rerank/providers.ts`
- `server/src/services/knowledge-reranking.ts`
- `server/src/services/issue-retrieval.ts`
- `server/src/__tests__/knowledge-reranking.test.ts`

### 완료 기준

1. primary provider failure가 retrieval 전체 실패로 바로 이어지지 않는다.
2. fallback reason이 recent run/debug에서 설명 가능하다.
3. 동일 query에 대해 provider별 behavior 차이를 운영자가 볼 수 있다.

## 2. Execution Lane / Fast Lane 실운영 계측

### 목표

- `fast / normal / deep` 분류가 실제로 latency와 운영 품질에 이득을 주는지 측정한다.

### 왜 마지막인가

- lane 분류와 lane-aware retrieval policy 자체는 이미 들어갔다.
- 지금 부족한 것은 “fast lane이 실제로 빠르고 덜 흔들리는가”를 증명하는 계측이다.
- 이 단계는 재사용성과 rerank 안정화가 어느 정도 들어간 뒤 보는 편이 지표 해석이 쉽다.

### 현재 상태

- lane classification:
  - `server/src/services/execution-lanes.ts`
- lane-aware retrieval/caching:
  - `server/src/services/issue-retrieval.ts`
- quality summary:
  - `server/src/services/knowledge.ts`

### 구현 슬라이스

#### Slice 3-A. Retrieval Timing

작업:

1. retrieval run에 end-to-end duration을 기록한다.
2. 가능하면 stage duration도 분리한다.

예시:

- embedding duration
- candidate query duration
- graph expansion duration
- model rerank duration
- finalization duration

#### Slice 3-B. Lane Outcome Metrics

작업:

1. lane별 cache hit rate
2. lane별 low-confidence rate
3. lane별 multi-hop hit rate
4. lane별 reuse hit rate

#### Slice 3-C. Workflow Quality Metrics

작업:

1. lane별 review reopen count
2. lane별 QA bounce count
3. lane별 done까지 걸린 시간
4. lane별 `changes_requested -> rework -> close` 루프 발생률

#### Slice 3-D. Surface

노출 위치:

1. `/api/knowledge/quality`
2. 필요 시 dashboard/support surface

추가 필드 예시:

- `perLane`
- `dailyTrend.laneCounts`
- `dailyTrend.laneLatency`
- `dailyTrend.laneReopenCount`
- `dailyTrend.laneQaBounceCount`

#### Slice 3-E. Validation

필수 검증:

1. fast lane 평균 retrieval duration이 normal/deep보다 낮은지
2. fast lane에서 review reopen/QA bounce가 과도하게 높지 않은지
3. deep lane이 cross-project/decision-heavy 상황에서 더 높은 evidence quality를 주는지

### 우선 구현 파일

- `server/src/services/issue-retrieval.ts`
- `server/src/services/knowledge.ts`
- `server/src/services/execution-lanes.ts`
- `server/src/services/issue-change-surface.ts`
- 관련 dashboard/knowledge route surface

### 완료 기준

1. lane별 latency/quality 차이를 숫자로 설명할 수 있다.
2. fast lane이 실제 이득을 주는지 판단할 수 있다.
3. 잘못 분류된 lane 사례를 운영자가 다시 찾을 수 있다.

## 이번 배치 권장 순서

### Batch A

1. `rerank provider abstraction` Slice 2-A
2. `rerank provider abstraction` Slice 2-B
3. `rerank provider abstraction` Slice 2-C

### Batch B

1. `rerank provider abstraction` Slice 2-D
2. `execution lane` Slice 3-A
3. `execution lane` Slice 3-B

### Batch C

1. `execution lane` Slice 3-C
2. `execution lane` Slice 3-D
3. `execution lane` Slice 3-E

## 당장 하지 않을 것

1. peer mode
2. arbitrary workflow builder 방향
3. 새로운 protocol/kernel 대확장
4. UI-only follow-up 로컬 변경 개입
5. `memory-bank/README.md` 수정

## 검증 순서

기본:

```bash
pnpm -r typecheck
pnpm test:run
pnpm build
```

retrieval 쪽만 수정할 때:

```bash
pnpm vitest run server/src/__tests__/issue-retrieval.test.ts
pnpm vitest run server/src/__tests__/knowledge-reranking.test.ts
```

## 다음 시작점

다음 구현 시작점은 `rerank provider abstraction`의 `Slice 2-A ~ 2-C`다.

가장 먼저 할 질문은 이것이다.

`primary rerank provider가 실패했을 때, 어떤 provider chain과 fallback reason을 debug surface에 남겨야 운영자가 바로 설명할 수 있는가?`

이 질문을 run debug와 quality surface에 trace로 남기는 것이 다음 단계의 핵심이다.
