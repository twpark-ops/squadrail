---
title: "Squadrail Product Overview And Expansion Roadmap"
author: "Taewoong Park <park.taewoong@airsmed.com>"
date: "2026-03-17"
---

# Squadrail Product Overview And Expansion Roadmap

## 1. 문서 목적

이 문서는 2026-03-17 기준으로 `Squadrail`의 제품 기능을 전체 관점에서 다시 설명하고, 현재 코드와 검증된 제품 패턴을 바탕으로 다음 우선순위 기능 아이디어를 정리한다.

이 문서는 세 가지를 동시에 다룬다.

1. 현재 `Squadrail`이 실제로 무엇을 하는 제품인지
2. 사용자 입장에서 이미 잘 닫힌 루프와 아직 애매한 루프가 무엇인지
3. 현재 제품에 어떤 확장 패턴을 붙이는 것이 맞는지

## 2. 참고 기준

### Squadrail 내부 기준

- [docs/start/what-is-squadrail.md](./start/what-is-squadrail.md)
- [docs/start/core-concepts.md](./start/core-concepts.md)
- [docs/start/quickstart.md](./start/quickstart.md)
- [docs/p0-quick-request-clarification-blueprint-plan.md](./p0-quick-request-clarification-blueprint-plan.md)
- [docs/ui-squad-stage-spec-2026.md](./ui-squad-stage-spec-2026.md)

### 외부 패턴 기준

이 문서는 아래처럼 반복적으로 검증된 제품 패턴을 참고한다.

- interview-first onboarding
- issue documents / deliverables
- artifact / preview surface
- budget / quota visibility
- worktree awareness
- command composer
- coarse collaboration roles
- plugin / extension surface

## 3. 제품 한 줄 정의

> `Squadrail`은 기능 설명 수준의 요청을 받아 PM/TL/Engineer/Reviewer/QA로 구성된 AI delivery squad가 그것을 구조화, 실행, 검토, QA, close까지 밀어주는 **protocol-first control plane**이다.

핵심은 다음 두 가지다.

1. **단순 채팅 제품이 아니다.**
2. **단순 task board도 아니다.**

즉 `Squadrail`은 “AI 직원들이 일하는 회사”를 운영하는 제품이라기보다, 더 정확히는 **소프트웨어 delivery 팀이 프로토콜대로 일하게 만드는 운영 시스템**에 가깝다.

## 4. 제품 북극성

현재까지 정리된 제품 북극성은 아래와 같다.

1. 사람은 짧게 요청한다.
2. 시스템/PM이 요청을 구조화한다.
3. 부족한 정보만 질문한다.
4. 사람은 짧게 답한다.
5. 팀이 실행, 리뷰, QA, close를 수행한다.
6. 운영자는 전체 흐름을 추적하고 필요하면 개입한다.

즉 사람은 완성된 PRD를 쓰지 않는다.  
반대로 완전 자유형 한 줄 채팅도 아니다.

`Squadrail`의 기본 입력 계약은:

- 기능 설명
- 왜 필요한지
- 범위/제약
- 우선순위
- 있으면 좋은 완료 기준

정도다.

## 5. 현재 제품 기능 설명

## 5.1 온보딩과 첫 회사 생성

첫 진입 시 사용자는 아래 루프를 거친다.

1. 회사 생성
2. 팀 블루프린트 선택/적용
3. adapter/primary workspace 연결
4. 첫 quick request 제출

이 흐름은 이미 `onboarding` UI와 `Company Settings`를 통해 많이 닫혔다.

이 단계의 목표는 “빈 대시보드”가 아니라:

- 실제 회사 객체 생성
- delivery team provisioning
- workspace 연결
- 첫 요청 제출

까지 한 번에 연결하는 것이다.

## 5.2 Quick Request -> PM 구조화

사용자가 실제로 던지는 입력은 `Quick Request`다.

이 요청은 곧바로:

- PM structuring
- project 선택
- acceptance criteria 초안화
- 필요 시 clarification

로 이어진다.

즉 사용자가 직접 subtasks를 다 쪼개는 구조가 아니다.  
구조화는 PM과 시스템이 맡는다.

## 5.3 Clarification loop

이 제품의 중요한 성격은 **불확실한 부분만 다시 질문한다**는 점이다.

clarification은 이미 아래 surface로 정리돼 있다.

- Inbox clarification queue
- IssueDetail pending clarification
- ProtocolActionConsole answer path

따라서 질문과 답변은 단순 chat 로그가 아니라, **공식 protocol action**으로 다뤄진다.

## 5.4 팀 프로비저닝과 블루프린트

`Squadrail`의 현재 강한 축 중 하나는 team blueprint다.

지원 범위:

- built-in blueprint preview/apply
- import/export
- saved library
- parameter editing
- company-scoped saved blueprint versioning
- lifecycle governance

즉 팀 구성 자체를 **재사용 가능한 delivery contract**로 다룬다.

이건 단순 role seed를 넘어서:

- 어떤 역할을 둘지
- PM/QA를 포함할지
- 기본 preview/apply 파라미터가 무엇인지
- 저장된 팀 버전이 어떻게 진화하는지

까지 포함한다.

## 5.5 Protocol-first execution

실행은 task 상태 변경만으로 끝나지 않는다.

중요 상태는 protocol message로 남는다.

예:

- `ACK_ASSIGNMENT`
- `START_IMPLEMENTATION`
- `SUBMIT_FOR_REVIEW`
- `APPROVE_IMPLEMENTATION`
- `QA`
- `CLOSE_TASK`

이 구조 덕분에 “누가 뭘 했는지”보다 더 중요한:

- 지금 어느 단계인지
- 어디서 막혔는지
- 누가 다음 baton을 받아야 하는지

를 추적할 수 있다.

## 5.6 Review / QA / 운영 가시성

현재 UI는 아래 운영 면을 분리해 제공한다.

- `Work`
- `Changes`
- `Runs`
- `Team`
- `Knowledge`

즉 한 화면에 모든 것을 억지로 몰지 않고,

- 이슈 진행
- 변경 검토
- run 상태
- 팀 상태
- retrieval 상태

를 surface 단위로 나눈다.

## 5.7 Knowledge / Retrieval / RAG

`Squadrail`은 이미 단순 “문서 붙인 검색”을 넘었다.

현재 있는 것:

- workspace knowledge import/sync
- retrieval run 저장
- evidence / hit / source diversity / confidence 추적
- issue-linked retrieval 활용률 집계
- feedback / personalization / graph hit 메트릭

즉 RAG는 이미 운영 지표를 가진 subsystem이다.

## 5.8 Governance / 비용 / 승인

이 제품이 단순 agent playground가 아닌 이유는 governance 때문이다.

현재 개념:

- approval gate
- audit trail
- budgets / spend
- role / org structure
- company isolation

즉 자동화는 허용하지만, 무제한 자율 루프를 그냥 풀어두진 않는다.

## 6. 현재 제품의 강점

현재 강점은 분명하다.

1. **입력 모델이 명확하다.**
   - 짧은 요청 -> 구조화 -> 실행 루프가 이미 잘 보인다.

2. **protocol 기반이라 추적성이 좋다.**
   - 단순 상태 보드보다 운영 이해도가 높다.

3. **team blueprint 축이 강하다.**
   - provisioning, portability, library, versioning이 이미 들어와 있다.

4. **RAG가 실제 운영 subsystem으로 붙어 있다.**
   - retrieval run, evidence, feedback, quality가 다 계측된다.

5. **control plane 성격이 분명하다.**
   - agent 런처가 아니라, delivery 운영 시스템으로 자리잡고 있다.

## 7. 현재 제품의 핵심 긴장

현재 가장 큰 제품 질문은 이것이다.

> 사용자가 가장 궁금한 것은 “팀이 멋있게 움직이는가”인가,
> 아니면 “내 parent issue가 지금 어디까지 왔는가”인가?

현재 판단은 명확하다.

- `Team`/stage/운영 가시성은 유용하다.
- 하지만 메인 질문은 여전히 **parent issue 진행 상태**다.

즉 제품 우선순위는:

1. `issue-centric progress`
2. 그 다음 `team-centric operational visibility`

여야 한다.

이 판단은 UI와 기능 우선순위 모두에 영향을 준다.

## 8. 앞으로 추가할 가치가 높은 방향

특히 아래 기능 축은 `Squadrail`에 직접 참고 가치가 높다.

### 8.1 Interview-first onboarding

온보딩은 “질문 몇 개로 시작해서 맞는 경로를 추천”하는 방향이 유효하다.

핵심 포인트:

- 설정값 20개를 먼저 묻지 않음
- 사용 목적, 배포 방식, 자율성 정도를 먼저 파악
- 그 후 적절한 경로를 추천

이건 `Squadrail`에도 매우 잘 맞는다.

### 8.2 Issue Documents / Deliverables

이슈 문서를 별도 section으로 두는 방향이 유효하다.

핵심 포인트:

- plan/spec/notes를 issue 단위 문서로 관리
- markdown 저장/자동저장
- 문서 conflict 처리

이건 `Squadrail`에서 특히 큰 가치가 있다.  
왜냐하면 지금은 많은 문맥이 comment/protocol 안에 흩어질 위험이 있기 때문이다.

### 8.3 Artifact / Preview model

attachment를 넘어 artifact 개념으로 끌어올리는 방향이 유효하다.

이건 `Squadrail`에서도 필요하다.

예:

- markdown plan
- generated report
- json output
- pdf
- preview URL
- static HTML 결과물

결과물은 comment body보다 **issue deliverable panel**로 끌어올리는 게 맞다.

### 8.4 Budget / Quota surface

비용 제어 surface를 전면화하는 방향이 유효하다.

핵심 포인트:

- budget policy card
- provider quota card
- sidebar budget marker

`Squadrail`도 비용/예산 개념은 이미 있지만, operator가 즉시 읽는 surface는 더 키울 수 있다.

### 8.5 Worktree awareness

worktree banner 형태의 실행 문맥 표면이 유효하다.

이건 `Squadrail`과 특히 잘 맞는다.

이유:

- shared vs isolated workspace
- implementation vs review workspace
- 현재 이슈가 어느 worktree에서 도는지

는 실제 운영에서 매우 중요한 정보이기 때문이다.

### 8.6 Command Composer

“chat product”가 아니라 “command surface”를 강조하는 방향이 유효하다.

이건 `Squadrail`에도 그대로 맞다.

추천 방향:

- 전역 composer
- `ask / task / decision` 모드
- company / project / issue scope

이렇게 하면 chat 제품처럼 흐르지 않으면서도 대화형 입력감을 줄 수 있다.

### 8.7 Minimal collaboration

거대한 enterprise RBAC보다 작은 membership model이 유효하다.

이 방향도 맞다.

추천 방향:

- `owner`
- `admin`
- `operator`
- `viewer`

정도의 coarse role만 먼저 둔다.

### 8.8 Plugin surface

plugin manager 류의 extension surface는 장기적으로 의미가 크다.

이건 `Squadrail`에 당장 필수는 아니지만, 장기적으로는 의미가 크다.

좋은 확장 예:

- knowledge sync plugin
- preview deploy plugin
- report export plugin
- notifier plugin

## 9. Squadrail에 추천하는 다음 기능 우선순위

현재 `Squadrail`에 붙였을 때 ROI가 큰 순서는 아래와 같다.

## 9.1 1순위 — Parent Issue Progress Surface

가장 먼저 강화해야 할 것은:

- 내 parent issue가 지금 어느 단계인지
- 누가 들고 있는지
- 왜 멈췄는지
- subtasks가 얼마나 진행됐는지

를 한눈에 보여주는 surface다.

이건 `Overview`, `Work`, `IssueDetail` 모두에 영향을 준다.

## 9.2 2순위 — Issue Documents / Deliverables

issue마다 아래 문서를 1급 객체로 다뤄야 한다.

- plan
- spec
- decision log
- QA notes
- release note

그리고 결과물도 issue panel에 모아야 한다.

## 9.3 3순위 — Artifact / Preview System

output를 comment에서 분리해야 한다.

지원 대상:

- `.md`
- `.txt`
- `.json`
- `.csv`
- `.pdf`
- `.html`
- preview URL

## 9.4 4순위 — Interview-first onboarding

현재 onboarding이 이미 많이 좋아졌지만, 더 좋아지려면:

- use case
- deployment mode
- autonomy mode
- primary runtime

같은 질문 몇 개로 흐름을 추천해야 한다.

## 9.5 5순위 — Budget / Quota visibility

운영자 관점에서는 다음이 즉시 보여야 한다.

- budget 위험
- quota 부족
- lane pause reason
- provider burn rate

## 9.6 6순위 — Worktree awareness

현재 issue와 run이 어느 execution 공간에서 돌고 있는지 명확히 보여줘야 한다.

이건 runtime 신뢰성을 크게 높인다.

## 9.7 7순위 — Command Composer

전역 입력기를 두되, **chat**이 아니라 **command surface**로 가야 한다.

이건 구조화된 대화형 제품 경험을 만든다.

## 9.8 8순위 — Minimal collaboration

이 제품이 실제 팀 툴이 되려면 최소 멤버십 모델이 필요하다.

## 9.9 9순위 — Plugin / extension

이건 장기 우선순위다. core가 더 잠긴 뒤 가는 것이 맞다.

## 10. 비추천 우선순위

지금 당장 우선순위가 낮은 것은 아래다.

1. 과한 stage animation 고도화
2. fancy character UI 확대
3. plugin system 조기 도입
4. enterprise-grade human RBAC
5. 범용 workflow builder

이유는 간단하다.

현재 제품의 본질은 `issue delivery clarity`이지, `시각 효과`가 아니기 때문이다.

## 11. 제품 방향 결론

현재 `Squadrail`은 이미 아래까지 올라와 있다.

- 짧은 요청 입력
- PM structuring
- clarification
- blueprint provisioning
- protocol execution
- review/QA
- retrieval instrumentation
- governance

즉 “delivery company control plane”의 중심축은 이미 잘 깔려 있다.

다음 단계는 새 시스템을 또 만드는 것이 아니라, 아래를 더 명확하게 만드는 것이다.

1. **내 issue가 지금 어디까지 왔는가**
2. **그 issue의 문서와 결과물이 어디 모이는가**
3. **이 팀이 어떤 실행 공간에서 어떤 비용으로 일하고 있는가**
4. **첫 사용자가 얼마나 빨리 첫 성공을 경험하는가**

따라서 앞으로의 제품 방향은 다음처럼 요약할 수 있다.

> `Squadrail`의 다음 성숙 단계는 “더 멋진 AI 팀 시뮬레이션”이 아니라,
> “더 명확한 issue 진행, 문서/산출물, 비용/실행 가시성, 그리고 더 쉬운 첫 성공 경험”이다.

## 12. 바로 이어서 실행할 수 있는 backlog

### Batch A

1. parent issue progress summary strip — 🟡 부분 완료 (클라이언트 SubtaskProgressBar + computeChildSummary 구현, 서버 IssueProgressSnapshot 미구현)
2. issue documents section — ❌ 미진행
3. deliverables/artifact panel — ❌ 미진행

상세 설계:

- [batch-a-parent-issue-documents-artifacts-plan-2026-03-17.md](./batch-a-parent-issue-documents-artifacts-plan-2026-03-17.md)

### Batch B

1. onboarding interview profile
2. post-onboarding first-success guidance
3. worktree/runtime banner

상세 설계:

- [batch-b-onboarding-first-success-runtime-plan-2026-03-17.md](./batch-b-onboarding-first-success-runtime-plan-2026-03-17.md)

### Batch C

1. budget/quota summary strip
2. provider quota warning
3. command composer v1
4. minimal collaboration role templates

상세 설계:

- [batch-c-budget-quota-composer-collaboration-plan-2026-03-17.md](./batch-c-budget-quota-composer-collaboration-plan-2026-03-17.md)

### Batch D

1. plugin registry model
2. company plugin binding/config
3. notifier/exporter capability
4. plugin manager UI

상세 설계:

- [batch-d-plugin-extension-surface-plan-2026-03-17.md](./batch-d-plugin-extension-surface-plan-2026-03-17.md)

## 12.1 배치 의존 관계

권장 순서는 아래와 같다.

1. `Batch A`
   - issue-centric progress
   - issue documents
   - deliverables
2. `Batch B`
   - onboarding first success
   - runtime/worktree awareness
3. `Batch C`
   - budget/quota guardrails
   - command composer
   - collaboration templates
4. `Batch D`
   - plugin / extension surface

이 순서가 맞는 이유:

- `Batch A`가 사용자 질문의 중심을 잡고
- `Batch B`가 첫 성공과 실행 문맥을 붙이며
- `Batch C`가 운영 제어층을 올리고
- `Batch D`는 core가 안정된 뒤 확장성을 여는 것이기 때문이다

## 13. 2026-03-17 추가 구현 완료 (backlog 외)

이 로드맵 작성일에 아래 항목들이 추가로 구현되었다.

### 13.1 UI 구조 전면 개편

| # | 변경 | 파일 |
|---|------|------|
| 1 | Work 페이지 — Board 기본값 + Board\|List\|Queue 3탭. 기존 대시보드는 Queue 탭으로 이동. 상단 컴팩트 summary pill 바. | `ui/src/pages/Issues.tsx` |
| 2 | Kanban 보드 — 컬럼 max-height + 스크롤. Done/Cancelled 기본 접기 ("51 completed" 토글). 5개 활성 컬럼만 기본 표시. | `ui/src/components/KanbanBoard.tsx` |
| 3 | IssuesList — 외부 제어용 `viewMode` prop. 내부 토글 자동 숨김. parent 행에 bg-muted/20 + chevron 접기/펼치기. `collapsedParents` persist. | `ui/src/components/IssuesList.tsx` |
| 4 | SubtaskProgressBar — 색상별 세그먼트 바 (done=green, inProgress=blue, inReview=amber, blocked=red). compact/full 모드. | `ui/src/components/SubtaskProgressBar.tsx` |
| 5 | 클라이언트 사이드 subtask summary — `computeChildSummary()`. 서버가 summary를 안 줘도 children 상태에서 직접 계산. `buildIssueTree()` → `{ issue, children, summary }`. | `ui/src/components/IssuesList.tsx` |
| 6 | Issue detail 여백 축소 — `max-w-2xl` → `max-w-4xl`. `space-y-6` → `space-y-4`. Workflow/Protocol/Readiness 카드 `px-3 py-2.5`. 탭/첨부/제목 `space-y-2`. | `ui/src/pages/IssueDetail.tsx` |
| 7 | Issue detail — Delivery 전용 탭. Brief\|Protocol\|Comments\|Sub-issues\|Activity\|**Delivery** 탭. 에이전트 이름 클릭 → 프로필 링크. 역할별 상태 뱃지. | `ui/src/pages/IssueDetail.tsx` |
| 8 | Issue detail — Protocol Ownership 카드 deliveryPartySlots 기반 동적 렌더링. | `ui/src/pages/IssueDetail.tsx` |
| 9 | DeliveryPartyStrip — 2×2 그리드 → 1칸 full-width row. Label 왼쪽 \| Agent 중앙 \| 뱃지 오른쪽. 헤더 1줄 인라인. | `ui/src/components/DeliveryPartyStrip.tsx` |
| 10 | Team — 컴팩트 pill 바 (leadership/engineers/verification/live + healthy/warning/risk). | `ui/src/pages/Team.tsx` |
| 11 | Team — Scorecard 탭 (throughput 7d, avg success rate, avg run duration, open load, review/QA bounces, preemptions). Per-agent 성과 카드. | `ui/src/pages/Team.tsx` |
| 12 | Team — Supervision 탭 (rootIssueId 그룹핑, ParentIssueSupervisionCard). | `ui/src/pages/Team.tsx`, `ui/src/components/ParentIssueSupervisionCard.tsx` |
| 13 | Changes — Desk\|Lanes\|Metrics 탭. 컴팩트 summary bar. | `ui/src/pages/Changes.tsx` |
| 14 | Runs — Live\|Recovery\|History 탭. 컴팩트 summary bar. | `ui/src/pages/Runs.tsx` |

### 13.2 #4 Clarification Loop 최적화

**목표**: PM이 부족한 정보만 구조화해서 질문. 전체 해결 시에만 workflow resume.

**구현 내역:**

| 레이어 | 변경 | 파일 |
|--------|------|------|
| Shared types | `IssueProtocolClarificationItem` (fieldKey, domain, question, whyNeeded, suggestedDefault). `IssueProtocolClarificationAnswerItem` (fieldKey, answer, acceptedSuggestion). 12개 domain enum. | `packages/shared/src/constants.ts`, `types/protocol.ts` |
| Validators | `issueProtocolClarificationItemSchema`, `issueProtocolClarificationAnswerItemSchema`. 기존 payload에 optional `missingItems[]`, `answeredItems[]` 추가. | `packages/shared/src/validators/protocol.ts` |
| Resolution logic | `deriveClarificationResolutionSummary()` — 전체 ASK/ANSWER 메시지 분석, allResolved 감지, unresolvedFieldKeys 반환. | `packages/shared/src/protocol-clarifications.ts` |
| Server protocol | ANSWER_CLARIFICATION cross-validation (answeredItems vs missingItems fieldKey 매칭). 모든 blocking 질문 해결 시에만 resume (resume suppression). | `server/src/services/issue-protocol.ts` |
| Dashboard | `DashboardPendingHumanClarificationSnapshot`에 `missingItemCount` 추가. | `packages/shared/src/types/dashboard.ts`, `server/src/services/dashboard.ts` |
| UI answer form | missingItems가 있으면 per-item 답변 폼 렌더링 (domain badge, whyNeeded, suggestedDefault "Accept" 체크박스). answeredItems[] 자동 조립. 레거시 질문은 기존 단일 textarea 유지. | `ui/src/components/ProtocolActionConsole.tsx` |
| UI status | clarification 진행률 "X of Y items resolved" 표시. per-item domain badge + 해결/미해결 아이콘. | `ui/src/pages/IssueDetail.tsx` |

**하위 호환**: 모든 새 필드 optional. 기존 에이전트는 변경 없이 동작. role-pack 프롬프트 가이드로 점진 적용.

### 13.3 #2 Human-reviewed Merge Assistance

**목표**: CLOSE_TASK 후 수동이던 merge를 first-class 프로토콜 이벤트로. 인간 리뷰 게이트 + 자동 실행 + 배포 추적.

**상태 머신 확장:**

```
approved
  ├── CLOSE_TASK(merged|merge_not_required) → done          [기존 경로, 변경 없음]
  └── REQUEST_MERGE(pending_merge) → merge_requested
        ├── APPROVE_MERGE → merge_approved
        │     ├── CONFIRM_DEPLOY → deploying → CLOSE_TASK → done
        │     └── CLOSE_TASK(no deploy) → done
        └── REJECT_MERGE → changes_requested                [엔지니어로 복귀]
```

**구현 내역:**

| 레이어 | 변경 | 파일 |
|--------|------|------|
| Protocol states | +3: `merge_requested`, `merge_approved`, `deploying` | `packages/shared/src/constants.ts` |
| Protocol messages | +5: `REQUEST_MERGE`, `APPROVE_MERGE`, `REJECT_MERGE`, `CONFIRM_DEPLOY`, `ROLLBACK_DEPLOY` | `packages/shared/src/constants.ts` |
| Payload types | `RequestMergePayload` (sourceBranch, headSha, rollbackPlan 등). `ApproveMergePayload` (mergeStrategy, autoExecute). `RejectMergePayload`. `ConfirmDeployPayload` (mergeCommitSha, deployTarget). `RollbackDeployPayload`. | `packages/shared/src/types/protocol.ts` |
| Validators | 5개 Zod 스키마. discriminated union 추가. | `packages/shared/src/validators/protocol.ts` |
| MESSAGE_RULES | 5개 규칙 추가. CLOSE_TASK의 from에 `merge_approved`, `deploying` 추가. | `server/src/services/issue-protocol.ts` |
| Auto-conversion | `CLOSE_TASK(mergeStatus=pending_external_merge)` → `REQUEST_MERGE` 자동 변환. 에이전트 변경 불필요. | `server/src/services/issue-protocol.ts` |
| Status mapping | `merge_requested`, `merge_approved`, `deploying` → coarse `in_review` | `server/src/services/issue-protocol.ts` |
| DB migration | `issue_merge_candidates`에 8개 컬럼 추가: merge_strategy, deploy_target, deploy_method, deploy_started_at, deploy_confirmed_at, external_pr_number, external_pr_url, rollback_count | `packages/db/src/migrations/0042_merge_review_gate.sql` |
| Drizzle schema | 8개 컬럼 정의 추가 | `packages/db/src/schema/issue_merge_candidates.ts` |
| API routes | `POST /issues/:id/merge-candidate/approve-merge`, `reject-merge`, `confirm-deploy`, `rollback-deploy`. board-only. 내부적으로 프로토콜 메시지 전송. | `server/src/routes/issues/merge-routes.ts` |
| Live events | +4: `issue.merge.requested`, `issue.merge.approved`, `issue.deploy.confirmed`, `issue.deploy.rollback` | `packages/shared/src/constants.ts` |
| UI status badges | StatusBadgeV2에 3개 신규 상태 (label, icon, color) | `ui/src/components/StatusBadgeV2.tsx` |
| UI delivery party | 3개 신규 상태의 delivery party slot 매핑 | `ui/src/pages/IssueDetail.tsx` |

**하위 호환**: 에이전트는 기존대로 CLOSE_TASK 전송. 서버가 `pending_external_merge`를 감지해 자동 변환. 비-merge close는 기존 경로 유지.

### 13.4 #5 Blueprint Bulk Provisioning

**목표**: 같은 팀 블루프린트를 여러 회사에 한 번에 적용.

**CLI 커맨드:**

```bash
squadrail blueprint list                              # 블루프린트 목록
squadrail blueprint preview <key> -C <id>             # 단건 미리보기
squadrail blueprint apply <key> -C <id>               # 단건 적용
squadrail blueprint bulk-preview <key> --all          # 전체 회사 미리보기
squadrail blueprint bulk-apply <key> --all            # 전체 회사 적용
  --companies <id1,id2>   # 특정 회사만
  --exclude <id1>         # 제외
  --filter-status active  # 상태 필터
  --dry-run               # 미리보기만
  --concurrency 2         # 병렬 수
  --continue-on-error     # 실패 시 계속
  --yes                   # 확인 건너뛰기
```

**구현 내역:**

| 레이어 | 변경 | 파일 |
|--------|------|------|
| Shared types | `TeamBlueprintBulkTarget` (mode, companyIds, excludeCompanyIds, filterStatus). `BulkCompanyPreview`, `BulkPreviewResult`, `BulkCompanyResult`, `BulkApplyResult`. | `packages/shared/src/types/team-blueprint.ts` |
| CLI commands | `registerBlueprintCommands()` — list, preview, apply, bulk-preview, bulk-apply. resolveCommandContext/addCommonClientOptions/handleCommandError 패턴. @clack/prompts 확인 프롬프트. | `cli/src/commands/client/blueprint.ts` |
| CLI registration | `registerBlueprintCommands(program)` 호출 추가 | `cli/src/index.ts` |

**아키텍처**: v1은 서버 변경 없이 CLI가 기존 단건 API(`POST /:companyId/team-blueprints/:key/preview`, `apply`)를 순차 호출하는 오케스트레이터. per-company 트랜잭션으로 원자성 보장.

### 13.5 #1 + #6 Subtask Progress + UI Tree

**목표**: parent issue에서 subtask 완료율을 보여주고, parent-child 관계를 시각적으로 표현.

**구현 내역:**

| 레이어 | 변경 | 파일 |
|--------|------|------|
| UI component | `SubtaskProgressBar` — done(green)/inProgress(blue)/inReview(amber)/blocked(red) 세그먼트 바. compact(바+숫자) / full(바+뱃지) 모드. | `ui/src/components/SubtaskProgressBar.tsx` |
| Client summary | `computeChildSummary()` — children 상태에서 `IssueInternalWorkItemSummary` 계산. 서버가 summary를 안 줘도 동작. | `ui/src/components/IssuesList.tsx` |
| Tree building | `buildIssueTree()` → `{ issue, children, summary }` 반환. summary는 서버 `internalWorkItemSummary` fallback → `computeChildSummary`. | `ui/src/components/IssuesList.tsx` |
| Parent row | children > 0이면 bg-muted/20 배경 + chevron 접기/펼치기 버튼. `collapsedParents` localStorage persist. | `ui/src/components/IssuesList.tsx` |
| Avatar stack | `activeAssigneeAgentIds` 기반 아바타 (최대 3 + "+N"). | `ui/src/components/IssuesList.tsx` |
| Kanban card | 기존 `done/total` 텍스트 → `SubtaskProgressBar compact`로 교체. | `ui/src/components/KanbanBoard.tsx` |

### 13.6 #3 Operational Scorecard

**목표**: 팀 성과 지표 (처리량, 평균 시간, 품질).

**구현 내역:**

| 레이어 | 변경 | 파일 |
|--------|------|------|
| Scorecard 탭 | Team 페이지에 **Scorecard** 탭 추가 (Supervision \| Roster \| Scorecard \| Coverage). | `ui/src/pages/Team.tsx` |
| 팀 집계 | Throughput(7d) — successfulRuns/totalRuns. Avg success rate (색상: ≥80% green, ≥60% amber, <60% red). Avg run duration. Open load. | `ui/src/pages/Team.tsx` |
| 품질 시그널 | Review bounces(30d), QA bounces(30d), Priority preemptions(7d). 임계값 초과 시 amber/red 표시. | `ui/src/pages/Team.tsx` |
| Per-agent 카드 | 기존 `AgentPerformanceCard`를 Scorecard 탭으로 이동. | `ui/src/pages/Team.tsx` |
| Summary bar | 컴팩트 pill 바에 healthy/warning/risk 뱃지 추가 (performanceSummary 기반). | `ui/src/pages/Team.tsx` |

### 13.7 Root Config 정비

| 변경 | 파일 |
|------|------|
| MIT LICENSE 파일 생성 | `LICENSE` |
| Dockerfile — `node:22-bookworm-slim` 핀, `HEALTHCHECK`, OCI 라벨 추가 | `Dockerfile` |
| Dockerfile.onboard-smoke — 중복 ENV 2쌍 제거 | `Dockerfile.onboard-smoke` |
| docker-compose*.yml — `restart: unless-stopped`, server healthcheck | `docker-compose.yml`, `docker-compose.quickstart.yml` |
| .dockerignore — 로컬 에이전트/workspace 산출물, test-results 등 12항목 추가 | `.dockerignore` |
| .gitignore — .symphony/, capture.PNG 추가 | `.gitignore` |
| .env.example — BETTER_AUTH_SECRET, ANTHROPIC_API_KEY, 배포/knowledge 섹션 | `.env.example` |
| README.md — Why Squadrail 테이블, UI 섹션, 환경변수/배포/문서 인덱스 테이블, Node/pnpm 뱃지 | `README.md` |
| CONTRIBUTING.md — 프로젝트 구조, 코드 스타일, PR 워크플로우 | `CONTRIBUTING.md` |
| .mailmap — 외부 프로젝트 잔재 → 프로젝트 메인테이너 | `.mailmap` |

### 13.8 수치 요약

| 항목 | 값 |
|------|:---:|
| 수정/생성 파일 | 40+ |
| 새 컴포넌트 | 3 (SubtaskProgressBar, ParentIssueSupervisionCard, blueprint CLI) |
| 새 프로토콜 상태 | 3 (merge_requested, merge_approved, deploying) |
| 새 프로토콜 메시지 | 5 (REQUEST/APPROVE/REJECT_MERGE, CONFIRM/ROLLBACK_DEPLOY) |
| 새 API 라우트 | 4 (approve/reject/confirm-deploy/rollback) |
| DB 마이그레이션 | 1 (0042_merge_review_gate) |
| 테스트 | 182 파일 / 1096 통과 (기존 178/1043 대비 +4/+53) |
| TypeScript 에러 | 0 |

## 14. 다이어그램

관련 구조 다이어그램:

- [squadrail-product-overview-and-expansion-roadmap-2026-03-17.puml](./squadrail-product-overview-and-expansion-roadmap-2026-03-17.puml)
- [batch-a-parent-issue-documents-artifacts-plan-2026-03-17.md](./batch-a-parent-issue-documents-artifacts-plan-2026-03-17.md)
- [batch-b-onboarding-first-success-runtime-plan-2026-03-17.md](./batch-b-onboarding-first-success-runtime-plan-2026-03-17.md)
- [batch-c-budget-quota-composer-collaboration-plan-2026-03-17.md](./batch-c-budget-quota-composer-collaboration-plan-2026-03-17.md)
- [batch-d-plugin-extension-surface-plan-2026-03-17.md](./batch-d-plugin-extension-surface-plan-2026-03-17.md)
