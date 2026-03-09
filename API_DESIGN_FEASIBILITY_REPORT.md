# API Feasibility Report: UI Design Implementation

**프로젝트**: `/home/taewoong/company-project/squadall`
**분석일**: 2026-03-09
**분석 대상**: Backend API vs Frontend UI Design Requirements

---

## Executive Summary

제안된 UI 디자인의 **Backend API 구현 가능성: 7.5/10**

- **즉시 구현 가능**: 60%
- **계산/변환 필요**: 30%
- **API 추가/변경 필요**: 10%

---

## 1. Dashboard Alert Zone (Top-Left)

### 디자인 요구사항

```
🚨 NEEDS ATTENTION
- 3 Blocked Issues
- 1 Protocol Violation
- 5 Pending Approvals
```

### Backend API 분석

**엔드포인트**: `GET /api/companies/{id}/dashboard`

**응답 구조** (`DashboardSummary`):
```typescript
{
  protocol: {
    blockedQueueCount: number;        // ✅ 존재
    openViolationCount: number;       // ✅ 존재
    awaitingHumanDecisionCount: number;
    staleQueueCount: number;
  };
  pendingApprovals: number;           // ✅ 존재
}
```

**검증 결과**: ✅ **완전 구현 가능 (10/10)**

| 요구사항 | API 필드 | 상태 |
|---------|---------|------|
| Blocked Issues | `protocol.blockedQueueCount` | ✅ 직접 매핑 |
| Protocol Violations | `protocol.openViolationCount` | ✅ 직접 매핑 |
| Pending Approvals | `pendingApprovals` | ✅ 직접 매핑 |

**구현 코드**:
```typescript
const summary = await dashboardApi.summary(companyId);

const alerts = {
  blocked: summary.protocol.blockedQueueCount,
  violations: summary.protocol.openViolationCount,
  approvals: summary.pendingApprovals,
};
```

---

## 2. Agent Activity List

### 디자인 요구사항

```
● Alice Chen    #123 Add Redis caching
  swiftsight-cloud [████████░░] 80% • 2h ago
```

**필요 데이터**:
- Agent name, avatar, status
- Current issue (checkout 상태)
- Issue title, identifier
- Project name
- Progress percentage ⚠️
- Time since started
- Real-time status indicator

### Backend API 분석

#### API 1: `GET /api/companies/{id}/agents`

**응답** (`Agent[]`):
```typescript
{
  id: string;
  name: string;
  role: string;
  status: "idle" | "running" | "paused" | "error";  // ✅
  icon: string | null;
  lastHeartbeatAt: Date | null;  // ✅ 시간 계산 가능
}
```

**❌ 부족한 데이터**:
- `currentCheckoutIssueId` - 없음
- `currentCheckoutAt` - 없음
- Issue progress percentage - 없음

#### API 2: `GET /api/companies/{id}/dashboard/protocol-queue`

**응답** (`DashboardProtocolQueue`):
```typescript
{
  buckets: {
    executionQueue: DashboardProtocolQueueItem[];
  }
}

interface DashboardProtocolQueueItem {
  issueId: string;
  identifier: string | null;        // ✅
  title: string;                    // ✅
  projectName: string | null;       // ✅
  workflowState: string;
  engineer: {                       // ✅ Agent 정보
    id: string;
    name: string;
    status: string;
  } | null;
  lastTransitionAt: Date;           // ✅ 시간 계산

  // ❌ Progress percentage 없음
}
```

#### API 3: Database Schema 분석

**`issues` 테이블**:
```typescript
{
  assigneeAgentId: uuid;           // ✅ 할당된 Agent
  checkoutRunId: uuid;             // ✅ Checkout run 참조
  startedAt: timestamp;            // ✅ 시작 시간
  status: string;

  // ❌ progress percentage 필드 없음
}
```

### 검증 결과: ⚠️ **부분 구현 가능 (6/10)**

| 요구사항 | API 지원 | 구현 방법 |
|---------|---------|-----------|
| Agent name, icon | ✅ | `/agents` API |
| Current checkout | ⚠️ | **계산 필요**: protocol-queue에서 engineer로 필터링 |
| Issue title, identifier | ✅ | protocol-queue API |
| Project name | ✅ | protocol-queue API |
| **Progress %** | ❌ | **API 추가 필요** 또는 workflow state 기반 추정 |
| Time since started | ✅ | `lastTransitionAt` 기반 계산 |
| Status indicator | ✅ | `agent.status` |

### 구현 전략

#### Option A: Frontend에서 계산 (현재 가능)

```typescript
// 1. Agent 목록 조회
const agents = await agentsApi.list(companyId);

// 2. Protocol queue에서 각 agent의 현재 작업 찾기
const queue = await dashboardApi.protocolQueue(companyId);

const activityList = agents.map(agent => {
  // executionQueue에서 이 agent가 engineer로 할당된 issue 찾기
  const currentIssue = queue.buckets.executionQueue.find(
    item => item.engineer?.id === agent.id
  );

  return {
    agentId: agent.id,
    agentName: agent.name,
    agentStatus: agent.status,
    currentIssue: currentIssue ? {
      identifier: currentIssue.identifier,
      title: currentIssue.title,
      projectName: currentIssue.projectName,
      startedAt: currentIssue.lastTransitionAt,
      // ⚠️ Progress는 추정
      progress: estimateProgress(currentIssue.workflowState),
    } : null,
  };
});

function estimateProgress(state: string): number {
  // Workflow state 기반 추정
  const progressMap = {
    'assigned': 5,
    'accepted': 10,
    'planning': 25,
    'implementing': 50,
    'submitted_for_review': 80,
    'under_review': 90,
    'approved': 95,
  };
  return progressMap[state] ?? 0;
}
```

**단점**:
- 정확한 진행률 없음 (workflow state 기반 추정만 가능)
- N+1 쿼리 문제 (agent 수만큼 queue 필터링)

#### Option B: Backend API 추가 (권장)

**새 엔드포인트**: `GET /api/companies/{id}/agents/activity`

```typescript
interface AgentActivityResponse {
  agents: Array<{
    id: string;
    name: string;
    icon: string | null;
    status: string;
    lastHeartbeatAt: Date | null;
    currentCheckout: {
      issueId: string;
      identifier: string;
      title: string;
      projectId: string | null;
      projectName: string | null;
      checkoutAt: Date;
      workflowState: string;
      progress: number;  // 서버에서 계산
    } | null;
  }>;
}
```

**구현**: `/home/taewoong/company-project/squadall/server/src/routes/agents.ts` 에 추가

```typescript
router.get("/companies/:companyId/agents/activity", async (req, res) => {
  const companyId = req.params.companyId as string;
  assertCompanyAccess(req, companyId);

  // agents + issues JOIN
  const agents = await db
    .select({
      agentId: agents.id,
      agentName: agents.name,
      agentIcon: agents.icon,
      agentStatus: agents.status,
      lastHeartbeatAt: agents.lastHeartbeatAt,
      issueId: issues.id,
      issueIdentifier: issues.identifier,
      issueTitle: issues.title,
      projectName: projects.name,
      checkoutAt: issues.startedAt,
      workflowState: issueProtocolState.workflowState,
    })
    .from(agents)
    .leftJoin(issues, and(
      eq(issues.assigneeAgentId, agents.id),
      eq(issues.status, 'in_progress')
    ))
    .leftJoin(projects, eq(issues.projectId, projects.id))
    .leftJoin(issueProtocolState, eq(issueProtocolState.issueId, issues.id))
    .where(eq(agents.companyId, companyId));

  res.json({ agents });
});
```

---

## 3. Live Agent Status Counters

### 디자인 요구사항

```
12/14 active agents
● 12 Working
○ 2 Idle
× 0 Error
```

### Backend API 분석

**엔드포인트**: `GET /api/companies/{id}/dashboard`

**응답**:
```typescript
{
  agents: {
    active: number;    // ⚠️ idle + running 합계
    running: number;   // ✅
    paused: number;    // ✅
    error: number;     // ✅
  }
}
```

**Database 계산 로직** (`dashboard.ts:368-378`):
```typescript
const agentCounts: Record<string, number> = {
  active: 0,
  running: 0,
  paused: 0,
  error: 0,
};
for (const row of agentRows) {
  const count = Number(row.count);
  const bucket = row.status === "idle" ? "active" : row.status;
  agentCounts[bucket] = (agentCounts[bucket] ?? 0) + count;
}
```

**⚠️ 문제**: `active` = idle agents만 포함, `running`은 별도 카운트

### 검증 결과: ⚠️ **계산 필요 (7/10)**

| 요구사항 | API 필드 | 구현 |
|---------|---------|------|
| Total agents | - | `active + running + paused + error` |
| Working (running) | `agents.running` | ✅ 직접 사용 |
| Idle | `agents.active` | ✅ 직접 사용 |
| Error | `agents.error` | ✅ 직접 사용 |

**구현**:
```typescript
const summary = await dashboardApi.summary(companyId);

const statusCounts = {
  total: summary.agents.active + summary.agents.running +
         summary.agents.paused + summary.agents.error,
  working: summary.agents.running,
  idle: summary.agents.active,
  error: summary.agents.error,
};
```

---

## 4. Progress Bar & Percentage

### 디자인 요구사항

```
[████████░░] 80%
```

### Backend API 분석

**❌ 직접 지원 없음**

**가능한 접근**:

#### A. Workflow State 기반 추정 (현재 가능)

```typescript
const PROGRESS_MAP: Record<IssueProtocolWorkflowState, number> = {
  'backlog': 0,
  'assigned': 5,
  'accepted': 10,
  'planning': 25,
  'implementing': 50,
  'submitted_for_review': 75,
  'under_review': 85,
  'changes_requested': 60,
  'blocked': 40,
  'awaiting_human_decision': 70,
  'approved': 95,
  'done': 100,
  'cancelled': 0,
};

const progress = PROGRESS_MAP[item.workflowState] ?? 0;
```

**단점**: 부정확, 추정치일 뿐

#### B. Subtask 기반 계산 (Backend 추가 필요)

```typescript
// Issues 테이블의 parentId를 활용
const completedSubtasks = await db
  .select({ count: sql`count(*)` })
  .from(issues)
  .where(and(
    eq(issues.parentId, parentIssueId),
    eq(issues.status, 'done')
  ));

const totalSubtasks = await db
  .select({ count: sql`count(*)` })
  .from(issues)
  .where(eq(issues.parentId, parentIssueId));

const progress = totalSubtasks > 0
  ? (completedSubtasks / totalSubtasks) * 100
  : PROGRESS_MAP[workflowState];
```

#### C. Time-based 추정 (Backend 추가 필요)

```typescript
// 평균 완료 시간 기반 추정
const avgCompletionTime = await getAverageCompletionTime(issueType);
const elapsedTime = Date.now() - startedAt.getTime();
const progress = Math.min((elapsedTime / avgCompletionTime) * 100, 95);
```

### 검증 결과: ❌ **API 추가 필요 (3/10)**

**권장**: Backend에 `progress` 필드 추가

---

## 5. Real-time Updates (WebSocket)

### 디자인 요구사항

- WebSocket live updates
- Agent status changes
- Issue progress changes
- 2초마다 변경 감지

### Backend API 분석

**✅ WebSocket 지원 확인**

**엔드포인트**: `ws://localhost:PORT/api/companies/{companyId}/events/ws`

**구현**: `/home/taewoong/company-project/squadall/server/src/realtime/live-events-ws.ts`

**Event Types** (`constants.ts:204-212`):
```typescript
const LIVE_EVENT_TYPES = [
  "heartbeat.run.queued",
  "heartbeat.run.status",
  "heartbeat.run.event",
  "heartbeat.run.log",
  "agent.status",           // ✅ Agent 상태 변경
  "activity.logged",
  "issue.brief.updated",
  "retrieval.run.completed",
];
```

**Event 구조**:
```typescript
interface LiveEvent {
  id: number;
  companyId: string;
  type: LiveEventType;
  createdAt: string;
  payload: Record<string, unknown>;
}
```

### 검증 결과: ✅ **완전 구현 가능 (9/10)**

| 요구사항 | 지원 상태 | Event Type |
|---------|---------|------------|
| Agent status changes | ✅ | `agent.status` |
| Issue updates | ✅ | `issue.brief.updated` |
| Heartbeat updates | ✅ | `heartbeat.run.status` |
| Activity logs | ✅ | `activity.logged` |

**구현**:
```typescript
const ws = new WebSocket(
  `ws://localhost:3000/api/companies/${companyId}/events/ws?token=${token}`
);

ws.onmessage = (event) => {
  const liveEvent: LiveEvent = JSON.parse(event.data);

  switch (liveEvent.type) {
    case 'agent.status':
      updateAgentStatus(liveEvent.payload);
      break;
    case 'issue.brief.updated':
      refreshIssueBrief(liveEvent.payload);
      break;
    case 'heartbeat.run.status':
      updateRunStatus(liveEvent.payload);
      break;
  }
};
```

**⚠️ 제한사항**:
- Progress percentage 변경 이벤트는 없음
- Polling 필요할 수 있음

---

## 6. Issue Brief Panel

### 디자인 요구사항

```
📘 BRIEF
Evidence (6)
- ImageProcessor.ts
- Redis ADR
- Tests
```

### Backend API 분석

**엔드포인트**: `GET /api/companies/{id}/dashboard/protocol-queue`

**응답** (`DashboardProtocolQueueItem`):
```typescript
{
  latestBriefs: Partial<Record<string, DashboardBriefSnapshot>>;
}

interface DashboardBriefSnapshot {
  id: string;
  briefScope: string;              // "engineer" | "reviewer" | ...
  briefVersion: number;
  workflowState: string;
  retrievalRunId: string | null;   // ✅ Retrieval 참조
  createdAt: Date;
  preview: string;                 // ✅ 180자 요약
}
```

**Evidence 조회**: `GET /api/retrieval/runs/{retrievalRunId}`

**⚠️ 문제**: `latestBriefs`에 evidence list가 직접 포함되지 않음

### 검증 결과: ⚠️ **추가 API 호출 필요 (6/10)**

**구현**:
```typescript
// 1. Brief 조회
const queueItem = await dashboardApi.protocolQueue(companyId);
const brief = queueItem.latestBriefs['engineer'];

// 2. Evidence 조회 (추가 API 호출)
if (brief?.retrievalRunId) {
  const evidence = await retrievalApi.getRunHits(brief.retrievalRunId);
  // evidence: Array<{ title, path, score }>
}
```

**권장**: Brief API에 evidence 직접 포함

---

## 7. Org Chart Live Status

### 디자인 요구사항

```
[Avatar]
Alice Chen
● Working on #123
2h • 80%
```

### Backend API 분석

**엔드포인트**: `GET /api/companies/{id}/org`

**응답** (`OrgNode[]`):
```typescript
interface OrgNode {
  id: string;
  name: string;
  role: string;
  status: string;        // ✅
  reports: OrgNode[];

  // ❌ currentIssue 정보 없음
  // ❌ progress 없음
}
```

### 검증 결과: ⚠️ **부분 구현 가능 (5/10)**

**필요한 변경**: Org API에 current checkout 정보 추가

---

## Gap Summary: 필요한 Backend 변경

### 1. 새 엔드포인트 추가 (권장)

#### A. `/api/companies/{id}/agents/activity`

**목적**: Agent + 현재 작업 중인 Issue 정보를 JOIN하여 제공

**응답**:
```typescript
{
  agents: Array<{
    id: string;
    name: string;
    icon: string | null;
    status: string;
    lastHeartbeatAt: Date | null;
    currentCheckout: {
      issueId: string;
      identifier: string;
      title: string;
      projectName: string | null;
      checkoutAt: Date;
      workflowState: string;
      estimatedProgress: number;
    } | null;
  }>;
}
```

**구현 위치**: `/server/src/routes/agents.ts`

**난이도**: Medium (3일)

---

#### B. Progress 계산 로직 추가

**옵션 1**: Issue에 `progressPercent` 필드 추가

```typescript
// Database migration
ALTER TABLE issues ADD COLUMN progress_percent INTEGER DEFAULT 0;

// 계산 로직
UPDATE issues
SET progress_percent = (
  SELECT COUNT(*) FILTER (WHERE status = 'done') * 100.0 / COUNT(*)
  FROM issues AS subtasks
  WHERE subtasks.parent_id = issues.id
)
WHERE EXISTS (
  SELECT 1 FROM issues AS subtasks WHERE subtasks.parent_id = issues.id
);
```

**옵션 2**: Runtime 계산 (현재 방식 유지)

- Workflow state 기반 추정
- Frontend에서 계산

**권장**: 옵션 2 (현재 가능)

---

### 2. 기존 API 확장

#### A. `/api/companies/{id}/org` 확장

**추가 필드**:
```typescript
interface OrgNode {
  // 기존 필드
  id: string;
  name: string;
  role: string;
  status: string;
  reports: OrgNode[];

  // ✨ 추가
  currentCheckout?: {
    issueId: string;
    identifier: string;
    title: string;
    startedAt: Date;
  };
}
```

**난이도**: Easy (1일)

---

#### B. Protocol Queue에 totalActiveIssues 추가 (이미 존재)

**확인**:
```typescript
// dashboard.ts:686
return {
  companyId: input.companyId,
  generatedAt: new Date().toISOString(),
  totalActiveIssues: items.length,  // ✅ 이미 있음
  buckets: buildProtocolDashboardBuckets({ items, limit }),
};
```

---

### 3. WebSocket 이벤트 추가

**새 Event Type**:
```typescript
"issue.progress.updated"  // Issue 진행률 변경 시
"agent.checkout.changed"  // Agent가 issue checkout/release 시
```

**구현**:
```typescript
// services/live-events.ts
publishLiveEvent({
  companyId,
  type: 'agent.checkout.changed',
  payload: {
    agentId,
    issueId,
    action: 'checkout' | 'release',
    timestamp: new Date().toISOString(),
  },
});
```

**난이도**: Easy (1일)

---

## Frontend만으로 가능한 구현

### 1. Dashboard Alert Zone: ✅ 즉시 가능

```typescript
const summary = await dashboardApi.summary(companyId);

<AlertZone>
  <Alert>
    {summary.protocol.blockedQueueCount} Blocked Issues
  </Alert>
  <Alert>
    {summary.protocol.openViolationCount} Protocol Violations
  </Alert>
  <Alert>
    {summary.pendingApprovals} Pending Approvals
  </Alert>
</AlertZone>
```

---

### 2. Agent Status Counters: ✅ 즉시 가능

```typescript
const { agents } = await dashboardApi.summary(companyId);

const total = agents.active + agents.running + agents.paused + agents.error;

<StatusBar>
  {agents.running}/{total} active agents
  ● {agents.running} Working
  ○ {agents.active} Idle
  × {agents.error} Error
</StatusBar>
```

---

### 3. Agent Activity List: ⚠️ 계산 필요

```typescript
const agents = await agentsApi.list(companyId);
const queue = await dashboardApi.protocolQueue(companyId);

const activity = agents.map(agent => {
  const issue = queue.buckets.executionQueue.find(
    item => item.engineer?.id === agent.id
  );

  return {
    agent,
    currentIssue: issue,
    progress: issue ? estimateProgress(issue.workflowState) : null,
    elapsed: issue ? Date.now() - issue.lastTransitionAt.getTime() : null,
  };
});

function estimateProgress(state: string): number {
  const map = {
    'assigned': 5, 'planning': 25, 'implementing': 50,
    'submitted_for_review': 80, 'approved': 95,
  };
  return map[state] ?? 0;
}
```

---

### 4. Real-time Updates: ✅ 즉시 가능

```typescript
const ws = new WebSocket(`ws://.../${companyId}/events/ws?token=${token}`);

ws.onmessage = (event) => {
  const { type, payload } = JSON.parse(event.data);

  if (type === 'agent.status') {
    updateAgentInUI(payload.agentId, payload.status);
  }

  if (type === 'issue.brief.updated') {
    refreshIssue(payload.issueId);
  }
};
```

---

## 구현 난이도 평가

| Component | Backend 지원 | Frontend 난이도 | 필요 작업 |
|-----------|-------------|----------------|----------|
| **Dashboard Alert Zone** | 10/10 | Easy | 없음 - 즉시 구현 가능 |
| **Agent Status Counters** | 9/10 | Easy | 계산만 필요 |
| **Agent Activity List** | 6/10 | Medium | Protocol queue 필터링 |
| **Progress Bar** | 3/10 | Medium | Workflow state 추정 |
| **Real-time Updates** | 9/10 | Medium | WebSocket 연결 |
| **Issue Brief Panel** | 6/10 | Medium | 추가 API 호출 |
| **Org Chart Status** | 5/10 | Hard | API 확장 권장 |

---

## 최종 판단

### 즉시 구현 가능 (60%)

1. Dashboard Alert Zone - 완전 지원
2. Agent Status Counters - 계산만 필요
3. WebSocket Live Updates - 완전 지원
4. Basic Agent List - 완전 지원

### 계산/변환 필요 (30%)

1. **Agent Activity with Current Issue**
   - Protocol queue를 agent ID로 필터링
   - Frontend에서 JOIN 연산
   - Performance: N agents × M queue items

2. **Progress Percentage**
   - Workflow state 기반 추정
   - 정확도: ±20% 오차 예상

3. **Elapsed Time**
   - `lastTransitionAt` 기반 계산
   - Client-side formatting

### API 추가 필요 (10%)

1. **Accurate Progress Tracking** ⭐ 우선순위 높음
   - Subtask 완료율 또는
   - ML 기반 예측 또는
   - 수동 업데이트

2. **Optimized Agent Activity Endpoint** ⭐ 권장
   - Agent + Current Issue JOIN
   - `/api/companies/{id}/agents/activity`
   - Performance 개선

---

## 권장 구현 단계

### Phase 1: MVP (1주, Backend 변경 없음)

```typescript
// ✅ 현재 API만으로 구현
- Dashboard alerts (완전)
- Agent status counters (완전)
- Agent activity list (workflow state 추정)
- WebSocket 연결 (기본 이벤트)
```

**제한사항**: Progress는 추정치

---

### Phase 2: Optimization (2주)

```typescript
// Backend 추가: /api/companies/{id}/agents/activity
- 정확한 checkout 정보
- JOIN 연산 서버에서 수행
- Performance 개선
```

---

### Phase 3: Advanced (3주)

```typescript
// Backend 추가: Progress tracking
- Subtask 기반 진행률
- 새 WebSocket 이벤트
- Real-time progress updates
```

---

## 전체 구현 가능성: 7.5/10

### ✅ 강점

1. **Dashboard Summary API**: 매우 잘 설계됨
2. **WebSocket 인프라**: 완전 구현됨
3. **Protocol Queue**: 상세한 Issue 정보 제공
4. **Type Safety**: TypeScript로 전체 타입 정의

### ⚠️ 약점

1. **Progress Tracking**: 직접 지원 없음
2. **Agent-Issue Relationship**: JOIN 필요
3. **Checkout State**: 명시적 필드 없음

### 🎯 핵심 권장사항

1. **즉시 시작 가능**: Phase 1 MVP는 Backend 변경 없이 구현 가능
2. **API 추가 권장**: `/api/companies/{id}/agents/activity` (3일 소요)
3. **Progress는 추정으로 시작**: 나중에 정확도 개선
4. **WebSocket 적극 활용**: 이미 잘 구현되어 있음

---

## 참고 파일 경로

### Backend
- Dashboard Service: `/server/src/services/dashboard.ts`
- Dashboard Routes: `/server/src/routes/dashboard.ts`
- Agent Routes: `/server/src/routes/agents.ts`
- WebSocket: `/server/src/realtime/live-events-ws.ts`
- Live Events: `/server/src/services/live-events.ts`

### Database Schema
- Agents: `/packages/db/src/schema/agents.ts`
- Issues: `/packages/db/src/schema/issues.ts`
- Heartbeat Runs: `/packages/db/src/schema/heartbeat_runs.ts`

### Shared Types
- Dashboard Types: `/packages/shared/src/types/dashboard.ts`
- Constants: `/packages/shared/src/constants.ts`

### Frontend API
- Dashboard API: `/ui/src/api/dashboard.ts`
- Agents API: `/ui/src/api/agents.ts`

---

**작성자**: Backend Architect Agent
**검증 완료**: 2026-03-09
