---
title: "Batch A Parent Issue Progress, Documents, And Deliverables Plan"
author: "Taewoong Park (park.taewoong@airsmed.com)"
date: "2026-03-17"
---

# Batch A Parent Issue Progress, Documents, And Deliverables Plan

상태: design draft  
범위: `Squadrail` 현재 코드 기준 상세 설계  
관련 상위 문서: [squadrail-product-overview-and-expansion-roadmap-2026-03-17.md](./squadrail-product-overview-and-expansion-roadmap-2026-03-17.md)

## 1. 목표

`Batch A`의 목적은 아래 세 가지를 같은 문제로 보고 한 번에 정리하는 것이다.

1. 사용자가 가장 궁금한 **parent issue 진행 상태**를 메인 표면으로 끌어올린다.
2. issue 단위로 **문서(plan/spec/decision/qa/release note)** 를 관리하게 만든다.
3. issue 결과물과 증거를 **deliverables panel**에 모아, comment와 review surface에 흩어진 산출물을 한 화면에서 보게 만든다.

즉 이번 배치는 “예쁜 팀 UI”가 아니라, **이슈 중심 delivery clarity**를 강화하는 배치다.

## 2. 왜 지금 필요한가

현재 `Squadrail`은 다음이 이미 강하다.

- quick request -> PM structuring
- clarification
- team blueprint
- protocol execution
- review / QA
- retrieval instrumentation

하지만 사용자가 “내 요청이 지금 어디까지 왔는가”를 이해하는 데는 아직 세 가지 공백이 있다.

1. parent issue progress가 `IssueDetail` 안쪽에만 부분적으로 있다.
2. issue 설명/계획/결정/QA 노트가 comment와 description에 흩어진다.
3. attachment, protocol artifact, verification artifact가 서로 다른 표면에 나뉘어 있다.

결과적으로:

- parent issue는 보이지만 **문맥이 분산**되고
- 산출물은 존재하지만 **issue deliverable**로 안 보이며
- 사용자는 여전히 comment/protocol을 읽어야 전체 상황을 이해한다.

## 3. 현재 상태 (AS-IS)

## 3.1 Parent issue progress

현재 `IssueDetail`에는 이미 subtask 진행 요약이 있다.

관련 코드:

- [ui/src/pages/IssueDetail.tsx](../ui/src/pages/IssueDetail.tsx)
  - `childIssues`
  - `subtaskOverview`
  - `subtaskProgressPercent`
  - `Parent issue progress` 블록
- [ui/src/components/IssuesList.tsx](../ui/src/components/IssuesList.tsx)
  - `SubtaskProgressBar`
  - grouped issue tree
- [server/src/services/issues.ts](../server/src/services/issues.ts)
  - `includeSubtasks`
  - visible subtask 생성 semantics
- [packages/shared/src/types/issue.ts](../packages/shared/src/types/issue.ts)
  - `internalWorkItemSummary`

즉 parent progress의 **재료는 이미 있다**.  
문제는 이것이 아직:

- `IssueDetail` 내부에만 강하게 묶여 있고
- `Work`, `Overview`, `Changes`까지 일관된 issue progress surface로 올라오지 않았다는 점이다.

## 3.2 Documents

현재 `Squadrail`에는 issue 전용 editable document 모델이 없다.

있는 것:

- issue description
- comments
- attachments
- protocol messages
- knowledge documents

없는 것:

- issue-scoped mutable markdown documents
- document revisions
- `plan/spec/decision-log/qa-notes/release-notes` 같은 키 기반 문서

중요한 점:

- `knowledge_documents`는 이미 존재하지만 retrieval/ingest용이다.
- 이건 mutable issue collaboration surface로 쓰기엔 성격이 다르다.

즉 document는 `knowledge_documents`를 재사용하기보다 **전용 issue document layer**가 맞다.

## 3.3 Deliverables / artifacts

현재 결과물은 이미 여러 표면에 존재한다.

관련 코드:

- [ui/src/pages/IssueDetail.tsx](../ui/src/pages/IssueDetail.tsx)
  - attachment query/render
- [ui/src/components/ChangeReviewDesk.tsx](../ui/src/components/ChangeReviewDesk.tsx)
  - verification artifacts
- [server/src/services/issue-change-surface.ts](../server/src/services/issue-change-surface.ts)
  - diff, approval, verification artifacts flatten
- [server/src/services/protocol-run-artifacts.ts](../server/src/services/protocol-run-artifacts.ts)
  - protocol message artifact enrichment
- [packages/shared/src/types/issue.ts](../packages/shared/src/types/issue.ts)
  - `IssueAttachment`
  - `IssueChangeSurfaceArtifact`

즉 artifact 자체는 없다기보다 **흩어져 있다**.

현재 상태:

- attachment는 file attachment surface
- diff / approval / verification은 change surface
- retrieval evidence는 knowledge / brief quality

문제는 사용자가 “이 issue의 결과물”을 한 번에 보는 panel이 없다는 점이다.

## 4. 검증된 설계 패턴에서 실제로 가져올 것

이번 배치는 외부 제품에서 이미 검증된 패턴을 그대로 복제하지 않는다.  
`Squadrail`에 직접 가치가 있는 구조만 옮긴다.

### 4.1 그대로 참고할 것

아래 패턴은 `Squadrail`에 직접 참고 가치가 높다.

- key 기반 issue document UI
  - autosave/conflict/revision 전개
- document upsert + revision service
- `/issues/:id/documents`
- `/issues/:id/documents/:key`
- `/issues/:id/documents/:key/revisions`
- `IssueDocumentSummary`
- `IssueDocument`
- `DocumentRevision`

### 4.2 그대로 가져오지 않을 것

아래는 그대로 가져오지 않는다.

1. `hiddenAt`
   - `Squadrail`은 이미 visible subtask 방향으로 가고 있다.

2. `legacyPlanDocument` fallback
   - 일부 제품은 description 안 `<plan>` 태그 fallback을 쓰지만,
   - `Squadrail`은 quick request / protocol / brief 흐름이 더 중요하므로 기본 전략으로 쓰지 않는다.

3. full autosave conflict UX를 처음부터 전부
   - V1에서는 key/revision/conflict contract만 먼저 올리고,
   - 고급 autosave UX는 2차로 미룬다.

### 4.3 핵심 번역

issue documents 패턴을 `Squadrail`에 맞게 번역하면 이렇게 된다.

- chat-like issue note 저장이 아니라
- **protocol delivery를 보조하는 운영 문서**

즉 문서 기본 키는 아래가 맞다.

- `plan`
- `spec`
- `decision-log`
- `qa-notes`
- `release-note`

## 5. Batch A 설계 원칙

## 5.1 메인은 issue-centric

이번 배치에서 메인 질문은 항상 이것이다.

> 이 parent issue가 지금 어느 단계이고, 누가 들고 있으며, 어떤 문서와 산출물이 붙어 있는가?

`Team`/stage는 보조 surface로 유지한다.

## 5.2 document는 mutable, knowledge는 immutable

document는 사람이 읽고 수정하는 issue 운영 문서다.  
knowledge는 retrieval/ingest artifact다.

둘은 연결될 수 있지만, 같은 저장소로 합치지 않는다.

## 5.3 deliverables는 먼저 read-model로 시작

V1 deliverables는 새 generic artifact table부터 시작하지 않는다.

대신 아래를 합성해서 시작한다.

- attachments
- change-surface artifacts
- latest verification artifacts
- latest diff / approval / run artifact

즉 **federated deliverables panel**부터 시작한다.

generic artifact registry는 이후 확장으로 둔다.

## 6. 설계 범위

## 6.1 A1 — Parent Issue Progress Surface

### 목표

parent issue 진행 상태를 `IssueDetail` 안쪽 박스 수준이 아니라, 제품 상단 공용 surface로 승격한다.

### TO-BE

새 shared read model:

```ts
interface IssueProgressSnapshot {
  phase:
    | "intake"
    | "clarification"
    | "planning"
    | "implementing"
    | "review"
    | "qa"
    | "blocked"
    | "done"
    | "cancelled";
  headline: string;
  activeOwnerRole: "pm" | "tech_lead" | "engineer" | "reviewer" | "qa" | null;
  activeOwnerAgentId: string | null;
  blockedReason: string | null;
  pendingClarificationCount: number;
  subtaskSummary: {
    total: number;
    done: number;
    open: number;
    blocked: number;
    inReview: number;
  };
  reviewState: "idle" | "waiting_review" | "in_review" | "changes_requested" | "approved";
  qaState: "not_required" | "pending" | "running" | "passed" | "failed";
  latestArtifactKinds: string[];
}
```

### 구현 방향

이 snapshot은 새 테이블이 아니라 현재 데이터에서 server-side로 계산한다.

계산 입력:

- `Issue`
- `IssueProtocolState`
- `IssueProtocolMessage[]`
- `internalWorkItemSummary`
- `IssueChangeSurface`

### 적용 surface

1. `IssueDetail`
   - 상단 hero block으로 승격
2. `Work`
   - root issue 카드 summary chip
3. `Overview`
   - “current delivery” strip

### 파일 후보

- [packages/shared/src/types/issue.ts](../packages/shared/src/types/issue.ts)
- [server/src/routes/issues.ts](../server/src/routes/issues.ts)
- [server/src/services/issues.ts](../server/src/services/issues.ts)
- [server/src/services/issue-change-surface.ts](../server/src/services/issue-change-surface.ts)
- [ui/src/pages/IssueDetail.tsx](../ui/src/pages/IssueDetail.tsx)
- [ui/src/components/IssuesList.tsx](../ui/src/components/IssuesList.tsx)
- [ui/src/pages/Overview.tsx](../ui/src/pages/Overview.tsx)

### 결정

**권장안: `Issue` response에 optional `progressSnapshot`를 추가한다.**

이유:

- `Work`와 `IssueDetail`가 같은 계산을 재사용할 수 있다.
- 클라이언트별 파생 계산 중복이 줄어든다.
- issue list/search/grouped view에서 일관성이 생긴다.

## 6.2 A2 — Issue Documents

### 목표

issue 설명과 comment 사이에 흩어진 운영 문서를 issue 내부 1급 객체로 끌어올린다.

### 데이터 모델

검증된 문서 관리 패턴을 따라 전용 document layer를 둔다.

권장 신규 테이블:

1. `documents`
2. `document_revisions`
3. `issue_documents`

핵심 포인트:

- `documents`는 현재 최신 본문/메타
- `document_revisions`는 revision history
- `issue_documents`는 issue + key binding

### 왜 knowledge_documents를 재사용하지 않는가

`knowledge_documents`는:

- retrieval ingest 중심
- immutable content identity 중심
- project/issue/message provenance 중심

반면 issue document는:

- mutable 협업 문서
- revision conflict
- human/operator editing
- stable key (`plan`, `spec`, ...)

가 중요하다.

즉 **용도가 다르다.**

### shared contract

검증된 문서 모델 패턴을 가져오되, naming은 `@squadrail/shared`에 맞춘다.

```ts
type DocumentFormat = "markdown";

interface IssueDocumentSummary { ... }
interface IssueDocument extends IssueDocumentSummary { body: string; }
interface DocumentRevision { ... }
```

### route 설계

권장 route:

- `GET /issues/:id/documents`
- `GET /issues/:id/documents/:key`
- `PUT /issues/:id/documents/:key`
- `GET /issues/:id/documents/:key/revisions`
- `DELETE /issues/:id/documents/:key`

### V1 문서 키

- `plan`
- `spec`
- `decision-log`
- `qa-notes`
- `release-note`

### UI 설계

`IssueDetail`에 새 `Documents` 섹션 또는 탭 추가.

V1은 다음 정도만 한다.

- 문서 목록
- 새 문서 생성
- markdown 편집
- revision 충돌 시 409 처리
- revision history 열람
- 다운로드

### V1에서 하지 않는 것

- multi-user collaborative editing
- rich document permissions
- full autosave merge UI

## 6.3 A3 — Deliverables / Artifact Panel

### 목표

사용자가 “이 이슈에서 나온 결과물”을 한 번에 보게 만든다.

### V1 접근

새 generic artifact table을 만들지 않고 read-model부터 시작한다.

새 panel 이름 권장:

- `Deliverables`

구성 소스:

1. attachments
2. latest diff artifact
3. latest approval artifact
4. verification artifacts
5. latest run/workspace artifact

### 새 shared read model

```ts
interface IssueDeliverable {
  id: string;
  source: "attachment" | "protocol_artifact";
  kind:
    | "file"
    | "diff"
    | "approval"
    | "test_run"
    | "build_run"
    | "workspace_binding"
    | "run_log"
    | "report"
    | "preview";
  label: string;
  summary: string | null;
  href: string | null;
  contentType: string | null;
  createdAt: Date;
  createdByRole: string | null;
  metadata: Record<string, unknown> | null;
}
```

### server 구현

권장:

- `IssueChangeSurface`에 바로 얹기보다
- `IssueDetail`용 `deliverables` field를 추가하거나
- 별도 `GET /issues/:id/deliverables` route를 만든다.

**권장안: 별도 route로 시작**

이유:

- `ChangeReviewDesk`와 `IssueDetail`의 관심사가 다르다.
- change-surface는 리뷰/머지 중심이고,
- deliverables는 issue 산출물 중심이다.

### UI 설계

`IssueDetail`

- 현재 attachment 섹션 대체
- `Files`
- `Verification`
- `Code/Review`
- `Preview/Reports`

묶음으로 렌더링

### V2 확장

generic artifact registry를 나중에 넣고 싶다면 그때 아래까지 간다.

- preview URL
- issue-generated report
- closure summary document
- reusable artifact taxonomy

## 7. 구현 순서

## Phase 1 — Parent Issue Progress

작업:

1. `IssueProgressSnapshot` shared type 추가
2. server-side 계산 helper 추가
3. `IssueDetail` 상단 승격
4. `IssuesList` card summary 연결

가치:

- 가장 바로 사용자 체감이 좋아짐
- “지금 어디까지 왔지?”를 바로 해결

## Phase 2 — Issue Documents contract

작업:

1. DB schema + migration
2. shared type + validator
3. server service/routes
4. `IssueDetail` 문서 UI

가치:

- 계획/결정/QA 노트의 저장 위치가 명확해짐

## Phase 3 — Deliverables panel

작업:

1. attachments + protocol artifacts federated read model
2. `GET /issues/:id/deliverables`
3. `IssueDetail` deliverables panel

가치:

- 결과물이 comment에서 분리됨
- review/qa evidence 추적성이 좋아짐

## 8. 테스트 시나리오

## 8.1 Parent issue progress

1. root issue가 child 3개를 가지면 progress snapshot이 올바르게 계산된다.
2. pending clarification이 있으면 phase가 `clarification`으로 올라간다.
3. reviewer cycle / QA state가 있으면 phase와 badge가 올바르게 반영된다.
4. `Work` 검색과 grouped list에서도 progress snapshot이 유지된다.

## 8.2 Issue documents

1. `PUT /issues/:id/documents/plan`이 새 문서를 만든다.
2. 같은 key 문서를 `baseRevisionId`와 함께 수정하면 revision number가 증가한다.
3. stale `baseRevisionId`는 `409 conflict`를 반환한다.
4. 삭제 후 activity log가 남는다.
5. root issue와 subtask 모두 문서를 가질 수 있다.

## 8.3 Deliverables

1. attachment가 deliverables에 들어온다.
2. latest review diff / verification artifact가 deliverables에 노출된다.
3. issue에 attachment가 없어도 verification artifact만으로 panel이 비지 않는다.
4. protocol artifact kind가 다르면 grouping이 올바르다.

## 8.4 Browser smoke

1. IssueDetail에서 parent issue progress hero가 보인다.
2. plan/spec 문서를 생성하고 새로고침 후 유지된다.
3. attachment와 verification artifact가 `Deliverables`에 같이 보인다.

## 9. 리스크와 대응

| 리스크 | 설명 | 대응 |
|---|---|---|
| **DOCUMENT MODEL OVERLAP** | `knowledge_documents`와 역할이 헷갈릴 수 있다 | mutable issue document와 immutable knowledge document를 문서/타입 이름으로 분명히 분리 |
| **N+1 READ MODEL** | progress/deliverables를 UI에서 다 따로 계산하면 비싸다 | server-side snapshot/read model 우선 |
| **OVER-SCOPING ARTIFACT SYSTEM** | 너무 빨리 generic artifact registry로 가면 범위가 커진다 | V1은 federated panel부터 시작 |
| **COMMENT VS DOCUMENT CONFUSION** | 무엇을 comment에 쓰고 무엇을 document에 쓰는지 불명확할 수 있다 | `plan/spec/decision/qa/release` 문서 키를 기본 제공 |

## 10. 권장 결론

`Batch A`는 아래 방식으로 가는 것이 가장 안전하고 효과가 크다.

1. **parent issue progress**는 기존 `IssueDetail` progress를 server-shared snapshot으로 승격
2. **issue documents**는 검증된 document model을 전용 테이블로 이식
3. **deliverables**는 먼저 attachments + protocol artifacts 합성 panel로 시작

즉,

- 문서는 외부 제품의 검증된 패턴을 가져오되
- artifact는 `Squadrail` 현재 protocol surface를 활용하고
- parent progress는 이미 있는 subtask/protocol 데이터를 issue-centric로 재구성하는 것이 맞다.

## 11. 2026-03-17 구현 완료 내역

아래는 이 문서 작성일에 실제 구현 완료된 항목이다.

### UI 구조 개편

| # | 변경 | 파일 | 상태 |
|---|------|------|:----:|
| 1 | Work 페이지 — Board 기본값 + Board\|List\|Queue 탭 | `ui/src/pages/Issues.tsx` | ✅ |
| 2 | Kanban 보드 — 컬럼 max-height 스크롤 + Done/Cancelled 접기 토글 | `ui/src/components/KanbanBoard.tsx` | ✅ |
| 3 | IssuesList — viewMode prop + parent-child 계층 (chevron 접기/펼치기, bg-muted/20) | `ui/src/components/IssuesList.tsx` | ✅ |
| 4 | SubtaskProgressBar — 색상별 세그먼트 바 (compact/full) | `ui/src/components/SubtaskProgressBar.tsx` | ✅ |
| 5 | 클라이언트 사이드 subtask summary 계산 (`computeChildSummary`) | `ui/src/components/IssuesList.tsx` | ✅ |
| 6 | Issue detail 여백 축소 (max-w-4xl, space-y-4, 카드 px-3 py-2.5) | `ui/src/pages/IssueDetail.tsx` | ✅ |
| 7 | Issue detail — Delivery 전용 탭 (에이전트 프로필 링크) | `ui/src/pages/IssueDetail.tsx` | ✅ |
| 8 | Issue detail — Protocol Ownership 카드 deliveryPartySlots 기반 동적 렌더링 | `ui/src/pages/IssueDetail.tsx` | ✅ |
| 9 | DeliveryPartyStrip — 가로 row 레이아웃 + 헤더 1줄 인라인 | `ui/src/components/DeliveryPartyStrip.tsx` | ✅ |

### 다른 페이지 탭 구조

| # | 변경 | 파일 | 상태 |
|---|------|------|:----:|
| 10 | Team — 컴팩트 pill 바 + healthy/warning/risk 뱃지 | `ui/src/pages/Team.tsx` | ✅ |
| 11 | Team — Scorecard 탭 (throughput, success rate, run duration, bounces) | `ui/src/pages/Team.tsx` | ✅ |
| 12 | Team — Supervision 탭 (rootIssueId 그룹핑, ParentIssueSupervisionCard) | `ui/src/pages/Team.tsx` | ✅ |
| 13 | Changes — Desk\|Lanes\|Metrics 탭 | `ui/src/pages/Changes.tsx` | ✅ |
| 14 | Runs — Live\|Recovery\|History 탭 | `ui/src/pages/Runs.tsx` | ✅ |

### 백로그 기능 구현

| # | 변경 | 파일 | 상태 |
|---|------|------|:----:|
| 15 | #4 Clarification — structured missingItems + 12 domain enum + Zod validators | `packages/shared/` | ✅ |
| 16 | #4 Clarification — Server resume suppression + cross-validation | `server/src/services/issue-protocol.ts` | ✅ |
| 17 | #4 Clarification — UI per-item 답변 폼 + "X of Y resolved" 진행률 | `ui/src/components/ProtocolActionConsole.tsx`, `IssueDetail.tsx` | ✅ |
| 18 | #2 Merge gate — 3 workflow states + 5 message types + 4 live events | `packages/shared/src/constants.ts`, `types/protocol.ts` | ✅ |
| 19 | #2 Merge gate — MESSAGE_RULES + CLOSE_TASK→REQUEST_MERGE 변환 + 4 API 라우트 | `server/src/services/issue-protocol.ts`, `merge-routes.ts` | ✅ |
| 20 | #2 Merge gate — DB migration (8 deploy 추적 컬럼) | `packages/db/src/migrations/0042_merge_review_gate.sql` | ✅ |
| 21 | #2 Merge gate — UI StatusBadgeV2 + delivery party 상태 매핑 | `ui/src/components/StatusBadgeV2.tsx` | ✅ |
| 22 | #5 Blueprint bulk — CLI 커맨드 (list/preview/apply/bulk-preview/bulk-apply) | `cli/src/commands/client/blueprint.ts` | ✅ |
| 23 | #5 Blueprint bulk — Shared types (BulkTarget, BulkPreviewResult, BulkApplyResult) | `packages/shared/src/types/team-blueprint.ts` | ✅ |

### Root config 정리

| # | 변경 | 파일 | 상태 |
|---|------|------|:----:|
| 24 | MIT LICENSE 파일 생성 | `LICENSE` | ✅ |
| 25 | Dockerfile — node:22-bookworm-slim 핀, HEALTHCHECK, OCI 라벨 | `Dockerfile` | ✅ |
| 26 | Dockerfile.onboard-smoke — 중복 ENV 제거 | `Dockerfile.onboard-smoke` | ✅ |
| 27 | docker-compose*.yml — restart policy, server healthcheck | `docker-compose.yml`, `docker-compose.quickstart.yml` | ✅ |
| 28 | .dockerignore — 로컬 에이전트/workspace, test-results 등 12항목 추가 | `.dockerignore` | ✅ |
| 29 | .gitignore — .symphony/, capture.PNG 추가 | `.gitignore` | ✅ |
| 30 | .env.example — BETTER_AUTH_SECRET, ANTHROPIC_API_KEY, 배포 설정 추가 | `.env.example` | ✅ |
| 31 | README.md — 비교 테이블, UI 섹션, 환경변수 레퍼런스 | `README.md` | ✅ |
| 32 | CONTRIBUTING.md — 프로젝트 구조, 코드 스타일, 워크플로우 확장 | `CONTRIBUTING.md` | ✅ |
| 33 | .mailmap — 프로젝트 메인테이너 업데이트 | `.mailmap` | ✅ |

### 수치 요약

| 항목 | 값 |
|------|:---:|
| 수정/생성 파일 | 40+ |
| 새 컴포넌트 | 3 (SubtaskProgressBar, ParentIssueSupervisionCard, blueprint CLI) |
| 새 프로토콜 상태 | 3 (merge_requested, merge_approved, deploying) |
| 새 프로토콜 메시지 | 5 (REQUEST/APPROVE/REJECT_MERGE, CONFIRM/ROLLBACK_DEPLOY) |
| 새 API 라우트 | 4 |
| DB 마이그레이션 | 1 (0042_merge_review_gate) |
| 테스트 | 182 파일 / 1096 통과 (기존 178/1043 대비 +4/+53) |
| TypeScript 에러 | 0 |

### Batch A 대비 진행 현황

| Batch A 항목 | 진행 상태 | 비고 |
|-------------|:--------:|------|
| A1. Parent Issue Progress Surface | ✅ 완료 | 서버 `IssueProgressSnapshot`, root/list simplified snapshot, `IssueDetail` progress hero, `IssuesList` phase chip까지 구현됨. |
| A2. Issue Documents | ✅ 완료 | DB schema + service + route + `IssueDetail` Documents panel 구현 및 revision history 반영됨. |
| A3. Deliverables Panel | ✅ 완료 | attachment + protocol artifact federated read model, route, `IssueDetail` Deliverables panel 구현됨. |

## 12. 산출물

관련 다이어그램:

- [batch-a-parent-issue-documents-artifacts-plan-2026-03-17.puml](./batch-a-parent-issue-documents-artifacts-plan-2026-03-17.puml)
