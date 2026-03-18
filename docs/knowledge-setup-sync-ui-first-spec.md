# Knowledge Setup / Sync UI-First Spec

작성일: 2026-03-11  
작성자: Taewoong Park (park.taewoong@airsmed.com)

## 1. 배경

현재 `Squadrail`의 Knowledge 표면은 `explorer` 중심이다.

- 회사 전체 문서/청크/링크 현황 조회
- 프로젝트별 문서 분포
- 문서 브라우징
- RAG quality summary

하지만 운영자가 실제로 필요한 것은 `탐색`만이 아니다.

운영자는 최소한 아래 질문에 즉시 답할 수 있어야 한다.

1. 어떤 프로젝트가 knowledge에 들어가 있나?
2. 어떤 프로젝트가 비어 있거나 stale 상태인가?
3. 지금 RAG 품질이 낮은 이유가 import 누락인지 retrieval 품질 문제인지?
4. 회사를 18-agent canonical 조직으로 맞추려면 무엇이 drift 상태인가?
5. 이 작업을 UI에서 한 번에 돌릴 수 있나?

현재도 이 질문에 답하기 어렵다.

- live `cloud-swiftsight` 회사는 이제 canonical 18-agent 조직으로 정렬돼 있다.
- canonical bootstrap bundle은 프로젝트별 `Claude/Codex engineer` 쌍을 포함한 18-agent 설계다.
- knowledge import는 `project` 단위 API만 존재한다.
- graph/version/personalization 후속 보강은 script 또는 maintenance 수준이다.
- 따라서 운영자가 UI에서 `이 프로젝트를 knowledge에 넣겠다`를 자연스럽게 실행하고, canonical 상태를 지속적으로 유지하기 어렵다.

## 2. 목표

`Knowledge`를 단순한 읽기 화면이 아니라 `지식 운영 + 탐색` 제품 표면으로 재정의한다.

이번 스펙의 목표는 세 가지다.

1. `UI-first` company knowledge sync 경험 설계
2. `18-agent canonical org sync`와 knowledge sync의 경계 명확화
3. 이후 구현 순서를 `UI -> API -> optional CLI`로 고정

## 3. 비목표

이번 스펙은 아래를 직접 구현하지 않는다.

- deep graph algorithm 구현
- version-aware retrieval 세부 스코어링 변경
- merge automation UI
- 모바일 최적화

모바일은 현재 우선순위가 아니며, 데스크톱 운영 화면을 기준으로 설계한다.

## 4. 현재 상태 요약

### 4.1 실제 live 조직

`cloud-swiftsight` live 회사는 현재 canonical 18-agent 기준으로 정렬돼 있다.

현재 live agent 구성:

- CTO
- PM
- QA Engineer
- QA Lead
- swiftsight-cloud TL
- swiftsight-agent TL
- swiftcl TL
- Python TL
- swiftsight-cloud Codex Engineer
- swiftsight-cloud Claude Engineer
- swiftsight-agent Codex Engineer
- swiftsight-agent Claude Engineer
- swiftcl Codex Engineer
- swiftcl Claude Engineer
- swiftsight-report-server Codex Engineer
- swiftsight-report-server Claude Engineer
- swiftsight-worker Codex Engineer
- swiftsight-worker Claude Engineer

즉 현재 문제는 `설계 부재`가 아니라, 이 canonical 상태를 setup / sync 흐름에서 지속적으로 유지하고 설명 가능한 UI가 부족하다는 점이다.

### 4.2 현재 knowledge import 경로

현재 public route:

- `POST /api/knowledge/projects/:projectId/import-workspace`

현재 후속 maintenance:

- graph rebuild
- version rebuild
- personalization backfill

즉 현재는 `project import`는 되지만, `company sync orchestration`이 없다.

### 4.3 현재 setup progress

현재 setup progress는 아래 단계 플래그를 사용한다.

- companyReady
- squadReady
- engineReady
- workspaceConnected
- knowledgeSeeded
- firstIssueReady

문제는 이 모델이 너무 얕다.

- `knowledgeSeeded=true`여도 일부 프로젝트만 import된 상태일 수 있다.
- `squadReady=true`여도 이후 drift를 조기에 설명하지 못할 수 있다.
- 즉 지금의 setup progress는 회사 운영 준비도를 정밀하게 설명하지 못한다.

## 5. 제품 원칙

### 5.1 UI-first

주 경로는 UI다.

- 운영자는 UI에서 프로젝트를 선택하고 knowledge sync를 실행한다.
- UI는 상태, 실패 원인, drift를 설명한다.
- API는 orchestration과 job 상태를 담당한다.
- CLI는 나중에 nightly/ops wrapper로만 존재한다.

### 5.2 Explorer와 Setup 분리

현재 Knowledge 화면에 setup와 explorer를 모두 얹으면 다시 복잡해진다.

따라서 Knowledge는 두 가지 모드로 분리한다.

1. `Explore`
   - current brief / graph / documents / quality
2. `Setup`
   - org sync / project import / graph rebuild / version rebuild / personalization backfill

### 5.3 Company-level orchestration, project-level control

운영자는 회사 관점에서 본다.
하지만 실행은 프로젝트 단위로 세밀하게 제어해야 한다.

따라서 UI는:

- company overview
- project row actions
- selected projects bulk sync
- sync-all

이 네 단계를 함께 지원해야 한다.

### 5.4 Explainable drift

모든 경고는 이유가 있어야 한다.

예:

- `Org drift: missing 5 Claude/Codex engineers`
- `Knowledge stale: workspace head changed since last import`
- `Version context missing: no document version snapshot`
- `Graph coverage low: code_symbol_edges density below threshold`

## 6. 새 Information Architecture

### 6.1 Top-level 위치

Knowledge는 유지하되, 내부를 아래 2-pane로 나눈다.

- `Knowledge / Explore`
- `Knowledge / Setup`

### 6.2 Knowledge / Setup 화면 구조

#### A. Company Readiness Header

compact header만 둔다.

표시:

- company name
- canonical org status
- knowledge coverage status
- latest sync status
- last successful sync time

행동:

- `Sync all`
- `Sync selected`
- `Repair org drift`

#### B. Readiness Strips

큰 hero 카드 대신 compact strips 사용.

1. `Org`
   - live agent count
   - canonical target count
   - missing agents
   - extra agents

2. `Knowledge`
   - indexed projects / total projects
   - total documents / chunks / links
   - stale projects count
   - failed imports count

3. `RAG Quality`
   - low-confidence run count
   - graph-expanded runs
   - average graph hit count
   - feedback coverage

#### C. Project Sync Table

핵심 표면이다.

컬럼:

- project
- repo/workspace path
- org owner lane
- import state
- last import
- docs / chunks / links
- graph state
- version state
- personalization state
- drift badge
- actions

`actions`:

- Import workspace
- Rebuild graph
- Rebuild versions
- Backfill personalization
- View quality

행 선택:

- multi-select bulk sync

#### D. Job Activity Rail

우측 또는 하단 보조 패널:

- running job
- queued steps
- failed steps
- last success / last error

#### E. Failure Drilldown

선택한 project/job에 대해 표시:

- failure reason
- workspace path
- head sha mismatch 여부
- embedding provider 없음 여부
- graph rebuild 미실행 여부
- retry button

## 7. Org Sync와 Knowledge Sync의 관계

둘은 연결되지만 다른 개념이다.

### 7.1 Org Sync

목표:

- live company를 canonical 18-agent bundle 기준으로 맞춘다.

포함:

- missing agent detect
- stale adapter config detect
- role drift detect
- optional repair

출력:

- `missingAgents`
- `extraAgents`
- `mismatchedAgents`

### 7.2 Knowledge Sync

목표:

- 프로젝트 workspace를 import하고 graph/version/personalization 상태를 맞춘다.

포함:

- import workspace
- rebuild graph
- rebuild versions
- backfill personalization

출력:

- `documents/chunks/links`
- `revision/head/tree signature`
- `quality stats`

### 7.3 제품 표면에서의 관계

UI에서는 둘을 하나의 setup experience 안에 두되, step은 분리한다.

권장 순서:

1. Org Sync
2. Workspace import
3. Graph rebuild
4. Version rebuild
5. Personalization backfill
6. RAG quality check

## 8. 필요한 API

이번 스펙 기준 필요한 API는 아래다.

### 8.1 Org Drift

#### `GET /api/companies/:companyId/org-sync`

응답:

- canonicalAgentCount
- liveAgentCount
- missingAgents[]
- extraAgents[]
- mismatchedAgents[]

#### `POST /api/companies/:companyId/org-sync/repair`

옵션:

- `repairMissing`
- `repairMismatched`
- `pauseExtraAgents`

### 8.2 Knowledge Sync Job

#### `POST /api/companies/:companyId/knowledge-sync`

옵션:

- `projectIds[]`
- `steps[]`
  - `import_workspace`
  - `rebuild_graph`
  - `rebuild_versions`
  - `backfill_personalization`
- `forceFull`

응답:

- job id
- initial step summary

#### `GET /api/companies/:companyId/knowledge-sync/:jobId`

응답:

- overall status
- project step status
- startedAt / updatedAt
- failed steps
- progress percent

### 8.3 Knowledge Setup Summary

#### `GET /api/companies/:companyId/knowledge-setup`

응답:

- org readiness
- project sync rows
- quality summary
- active jobs

이 route가 Setup 페이지의 단일 read model이 된다.

## 9. UI 상태 모델

### 9.1 Project Sync Row State

각 프로젝트는 아래 state를 가진다.

- `not_indexed`
- `indexed`
- `stale`
- `syncing`
- `failed`
- `partial`

### 9.2 Org Drift State

- `aligned`
- `missing_agents`
- `config_drift`
- `extra_agents`
- `mixed`

### 9.3 Step Status

- `pending`
- `running`
- `completed`
- `skipped`
- `failed`

## 10. 첫 구현 범위

### Slice A. Read Model

- `GET /api/companies/:companyId/knowledge-setup`
- project row summary
- org drift summary
- quality summary

### Slice B. Setup UI

- `Knowledge / Setup` 탭
- company readiness header
- project sync table
- active job panel

### Slice C. Sync Execution

- `POST /api/companies/:companyId/knowledge-sync`
- selected projects bulk sync
- `Import workspace` / `Sync selected` / `Sync all`

### Slice D. Org Drift

- org drift detect
- `Repair org drift` action

### Slice E. RAG E2E Validation

- 18-agent sync 반영 후
- swiftsight real-agent RAG E2E
- second issue brief에 graph/personalization 반영 확인

## 11. 추천 구현 순서

1. live company 18-agent drift read model
2. company knowledge setup read model
3. Knowledge Setup UI
4. knowledge sync orchestration API
5. org repair action
6. real-agent RAG E2E 재검증

## 12. 결정

### 결정 1. CLI-first로 가지 않는다

이 기능의 주 경로는 UI다.

이유:

- Squadrail은 CLI 제품이 아니다.
- knowledge sync는 운영자가 반복적으로 보는 setup surface다.
- 따라서 UI가 primary, API가 source of truth, CLI는 optional wrapper가 맞다.

### 결정 2. Knowledge Explorer와 Setup을 분리한다

이유:

- 탐색과 운영 setup은 사용 목적이 다르다.
- 둘을 한 화면에 계속 얹으면 scroll과 정보 과밀이 다시 발생한다.

### 결정 3. Org Sync와 Knowledge Sync를 한 페이지에 둔다

이유:

- 실제로 18-agent drift와 knowledge 품질은 강하게 연결된다.
- 운영자는 둘을 따로 찾지 않고 한 setup 콘솔에서 봐야 한다.

## 13. 완료 기준

이 스펙이 제품으로 실현됐다고 볼 기준:

1. 운영자가 UI에서 어떤 프로젝트가 knowledge에 들어갔는지 즉시 본다.
2. 운영자가 UI에서 `Sync selected` 또는 `Sync all`을 실행한다.
3. 운영자가 live org가 18-agent canonical과 drift인지 UI에서 본다.
4. 운영자가 UI에서 drift repair를 실행한다.
5. real-agent RAG E2E에서 follow-up issue brief가 graph/personalization을 실제로 사용한다.
