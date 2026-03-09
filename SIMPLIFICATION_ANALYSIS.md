# SquadRail 코드 단순화 분석 리포트

## 핵심 목적

SquadRail 서버는 이슈 관리 시스템으로, 다음의 핵심 기능을 제공합니다:
- 이슈 CRUD 및 상태 관리 (backlog → todo → in_progress → in_review → done)
- 프로토콜 기반 워크플로우 (할당, 검토, 승인, 종료)
- AI 에이전트 및 사용자 협업 시스템
- 지식 검색 및 컨텍스트 제공

## 복잡도 메트릭 요약

### 주요 파일 분석

| 파일 | LOC | 함수 | 조건문 | 순환복잡도 | 복잡도/100LOC | 평가 |
|------|-----|------|--------|------------|--------------|------|
| **routes/issues.ts** | 1,631 | 16 | 131 | 203 | 12.4 | **HIGH** |
| **services/issues.ts** | 1,176 | 39 | 97 | 149 | 12.7 | **HIGH** |
| **services/issue-retrieval.ts** | 1,612 | 47 | 95 | 141 | 8.7 | MEDIUM |
| **services/heartbeat.ts** | 2,116 | 54 | 133 | 203 | 9.6 | MEDIUM-HIGH |
| **services/issue-protocol.ts** | 799 | 21 | 53 | 72 | 9.0 | MEDIUM |

### 라우트 핸들러 분석 (issues.ts)

- **총 라우트**: 26개 (GET: 13, POST: 8, DELETE: 4, PATCH: 1)
- **평균 핸들러 크기**: 41.2 라인
- **최대 핸들러 크기**: 208 라인 ⚠️
- **50+ 라인 핸들러**: 4개
- **100+ 라인 핸들러**: 3개 🚨

---

## 불필요한 복잡도 발견

### 1. **과도하게 큰 라우트 핸들러들** (routes/issues.ts)

#### 문제점
- 단일 핸들러가 200+ 라인으로 비대함
- 비즈니스 로직이 라우트 레이어에 혼재
- 함수당 평균 102 라인 (정상: 20-30 라인)

#### 구체적 예시
```typescript
// Line ~400-600: POST /api/v1/issues/:id/protocol/messages
// 이 핸들러는 다음을 모두 수행:
// 1. 권한 검증
// 2. 에이전트 정보 조회
// 3. 프로토콜 메시지 생성
// 4. 지식 검색 트리거
// 5. 라이브 이벤트 발행
// 6. 활동 로그 기록
// → 단일 책임 원칙 위반
```

#### 단순화 권장사항
```typescript
// BEFORE: 라우트에 모든 로직
router.post("/:id/protocol/messages", async (req, res) => {
  // 200+ lines of business logic, validation, orchestration
});

// AFTER: 얇은 라우트 + 서비스 레이어
router.post("/:id/protocol/messages", async (req, res) => {
  const { companyId } = await assertCompanyAccess(req);
  const actor = await getActorInfo(req);

  const result = await issueProtocolExecutionService.appendMessage({
    issueId: req.params.id,
    message: req.body,
    actor,
  });

  res.json(result);
});
```

**LOC 절감 예상**: 600+ 라인

---

### 2. **중복된 권한 검증 패턴**

#### 문제점
- `assertCompanyAccess` 호출: 28회
- `getActorInfo` 호출: 16회
- 매 핸들러마다 동일한 패턴 반복

#### 현재 코드
```typescript
// 26개 핸들러에서 반복
router.get("/some-endpoint", async (req, res) => {
  const { companyId } = await assertCompanyAccess(req);
  const actor = await getActorInfo(req);
  // ... actual logic
});
```

#### 단순화 권장사항
```typescript
// 미들웨어로 추출
const withCompanyAccess = async (req, res, next) => {
  req.context = {
    companyId: (await assertCompanyAccess(req)).companyId,
    actor: await getActorInfo(req),
  };
  next();
};

// 모든 이슈 라우트에 적용
router.use("/", withCompanyAccess);

router.get("/some-endpoint", async (req, res) => {
  const { companyId, actor } = req.context;
  // ... actual logic
});
```

**LOC 절감 예상**: 150+ 라인

---

### 3. **과도한 레이블 enrichment 추상화** (services/issues.ts)

#### 문제점
```typescript
// 87, 108, 358, 370, 427, 497, 522, 568, 629, 641, 746행
// 11번의 withIssueLabels() 호출
// 5번의 labelMapForIssues() 호출

async function labelMapForIssues(dbOrTx: any, issueIds: string[]): Promise<Map<...>> {
  // 20 lines
}

async function withIssueLabels(dbOrTx: any, rows: IssueRow[]): Promise<IssueWithLabels[]> {
  // 10 lines - just calls labelMapForIssues and maps
}

// 그리고 매번:
const [enriched] = await withIssueLabels(db, [row]);
```

#### 단순화 권장사항
```typescript
// YAGNI 위반: 대부분의 경우 단일 이슈만 조회
// 배치 최적화는 실제로 N개 이슈를 조회할 때만 필요

// BEFORE: 2단계 추상화
labelMapForIssues → withIssueLabels → caller

// AFTER: 직접 호출 또는 1단계 헬퍼
async function enrichIssueWithLabels(db: Db, issue: IssueRow) {
  const labels = await db
    .select({ label: labels })
    .from(issueLabels)
    .innerJoin(labels, eq(issueLabels.labelId, labels.id))
    .where(eq(issueLabels.issueId, issue.id));

  return {
    ...issue,
    labels,
    labelIds: labels.map(l => l.id),
  };
}

// 배치가 정말 필요한 list()에서만 별도 처리
```

**LOC 절감 예상**: 40-50 라인
**인지 부하 감소**: 중간 레이어 제거로 코드 추적 용이

---

### 4. **복잡한 checkout 로직 중복** (services/issues.ts)

#### 문제점
- `checkout()` 메서드: 127 라인 (526-652행)
- `assertCheckoutOwner()` 메서드: 53 라인 (654-706행)
- `adoptStaleCheckoutRun()`: 32 라인 (250-286행)
- 유사한 검증 로직이 3곳에 분산

```typescript
// 526-652: checkout()
// - 5개의 중첩된 if 블록
// - DB 업데이트 시도 → 실패 시 현재 상태 조회 → 조건 재확인 → 재시도
// - adoptStaleCheckoutRun 호출 (중복 로직)

// 654-706: assertCheckoutOwner()
// - checkout()과 거의 동일한 로직
// - adoptStaleCheckoutRun 다시 호출
```

#### 단순화 권장사항
```typescript
// BEFORE: 복잡한 낙관적 잠금 + 재시도 로직이 분산
// AFTER: 명확한 상태 머신 + 단일 책임 함수

// 1. 상태 검증 분리
function validateCheckoutConditions(current, agentId, runId) {
  if (current.status !== "in_progress") return { canCheckout: false, reason: "wrong_status" };
  if (current.assigneeAgentId !== agentId) return { canCheckout: false, reason: "wrong_assignee" };
  if (current.checkoutRunId && current.checkoutRunId !== runId) {
    return { canCheckout: false, reason: "locked_by_other", checkStale: true };
  }
  return { canCheckout: true };
}

// 2. 단순화된 checkout
async checkout(id, agentId, expectedStatuses, runId) {
  const current = await this.getById(id);
  const validation = validateCheckoutConditions(current, agentId, runId);

  if (!validation.canCheckout && validation.checkStale) {
    if (await isStaleRun(current.checkoutRunId)) {
      return await this.forceCheckout(id, agentId, runId); // 명확한 의도
    }
  }

  if (!validation.canCheckout) {
    throw conflict(validation.reason, current);
  }

  return await this.performCheckout(id, agentId, runId);
}
```

**LOC 절감 예상**: 80-100 라인
**순환복잡도 감소**: 현재 ~30 → 목표 ~10

---

### 5. **과도한 activeRun 확장 로직** (services/issues.ts)

#### 문제점
```typescript
// 123-156: activeRunMapForIssues - 34 lines
// 158-166: withActiveRuns - 9 lines
//
// 실제 사용: list() 메서드에서만 사용
// 359-360:
const withLabels = await withIssueLabels(db, rows);
const runMap = await activeRunMapForIssues(db, withLabels);
return withActiveRuns(withLabels, runMap);
```

#### YAGNI 위반
- `activeRun` 정보가 필요한 곳: 이슈 목록 UI
- 실제로 사용하는 곳: 1개 함수 (list)
- 그런데 별도 추상화로 분리: 2개 함수, 43 라인

#### 단순화 권장사항
```typescript
// BEFORE: 과도한 추상화
const runMap = await activeRunMapForIssues(db, withLabels);
return withActiveRuns(withLabels, runMap);

// AFTER: list() 내부로 인라인
async list(companyId, filters) {
  // ... query issues
  const withLabels = await withIssueLabels(db, rows);

  // Inline activeRun enrichment
  const runIds = withLabels.map(r => r.executionRunId).filter(Boolean);
  if (runIds.length === 0) return withLabels.map(r => ({ ...r, activeRun: null }));

  const activeRuns = await db.select(/* ... */).from(heartbeatRuns)
    .where(and(inArray(heartbeatRuns.id, runIds), inArray(heartbeatRuns.status, ACTIVE_RUN_STATUSES)));

  const runMap = new Map(activeRuns.map(r => [r.id, r]));
  return withLabels.map(r => ({ ...r, activeRun: runMap.get(r.executionRunId) ?? null }));
}
```

**LOC 절감 예상**: 30 라인
**명확성 향상**: 한 곳에서 전체 로직 파악 가능

---

### 6. **불필요한 status 전환 검증** (services/issues.ts)

#### 문제점
```typescript
// 27-32: assertTransition()
function assertTransition(from: string, to: string) {
  if (from === to) return;
  if (!ALL_ISSUE_STATUSES.includes(to)) {
    throw conflict(`Unknown issue status: ${to}`);
  }
}

// 그런데 실제로는:
// 1. from === to 체크만 수행 (실제 전환 규칙 없음)
// 2. to가 유효한지만 확인
// 3. 호출은 update() 메서드에서만 (442행)
```

#### YAGNI 위반
- 함수 이름: "전환 검증"
- 실제 동작: "같은 상태면 스킵, 유효한 상태인지만 확인"
- 복잡한 상태 전환 규칙은 **issue-protocol.ts**에 이미 존재 (MESSAGE_RULES)

#### 단순화 권장사항
```typescript
// BEFORE: 오해를 유발하는 추상화
assertTransition(existing.status, issueData.status);

// AFTER: 직접 검증
if (issueData.status && !ALL_ISSUE_STATUSES.includes(issueData.status)) {
  throw conflict(`Unknown issue status: ${issueData.status}`);
}

// assertTransition 함수 삭제
```

**LOC 절감 예상**: 6 라인
**명확성 향상**: 오해의 소지 제거

---

### 7. **복잡한 검색 정렬 로직** (services/issues.ts: 289-360)

#### 문제점
```typescript
// 72 lines for list() method
// - 복잡한 LIKE 패턴 (startsWithPattern, containsPattern)
// - 6개의 다른 매칭 조건 (title starts, title contains, identifier starts, ...)
// - CASE WHEN 정렬 로직 (0-6 우선순위)
// - 중첩된 조건문

const titleStartsWithMatch = sql<boolean>`${issues.title} ILIKE ${startsWithPattern} ESCAPE '\\'`;
const titleContainsMatch = sql<boolean>`${issues.title} ILIKE ${containsPattern} ESCAPE '\\'`;
const identifierStartsWithMatch = sql<boolean>`${issues.identifier} ILIKE ${startsWithPattern} ESCAPE '\\'`;
const identifierContainsMatch = sql<boolean>`${issues.identifier} ILIKE ${containsPattern} ESCAPE '\\'`;
const descriptionContainsMatch = sql<boolean>`${issues.description} ILIKE ${containsPattern} ESCAPE '\\'`;
const commentContainsMatch = sql<boolean>`EXISTS (SELECT 1 FROM ...)`;

const searchOrder = sql<number>`CASE
  WHEN ${titleStartsWithMatch} THEN 0
  WHEN ${titleContainsMatch} THEN 1
  WHEN ${identifierStartsWithMatch} THEN 2
  WHEN ${identifierContainsMatch} THEN 3
  WHEN ${descriptionContainsMatch} THEN 4
  WHEN ${commentContainsMatch} THEN 5
  ELSE 6 END`;
```

#### 과도한 엔지니어링
- **현재**: 6단계 검색 우선순위
- **실제 필요**: 제목 + 설명 검색만으로 충분
- 초기 최적화 (premature optimization)

#### 단순화 권장사항
```typescript
// BEFORE: 6단계 정렬 + 복잡한 CASE WHEN
if (hasSearch) {
  conditions.push(
    or(
      sql`${issues.title} ILIKE ${containsPattern} ESCAPE '\\'`,
      sql`${issues.identifier} ILIKE ${containsPattern} ESCAPE '\\'`,
      sql`${issues.description} ILIKE ${containsPattern} ESCAPE '\\'`,
    )!
  );
}

// Simple relevance: prioritize title/identifier matches
const rows = await db.select().from(issues)
  .where(and(...conditions))
  .orderBy(
    hasSearch
      ? sql`CASE WHEN ${issues.title} ILIKE ${containsPattern} OR ${issues.identifier} ILIKE ${containsPattern} THEN 0 ELSE 1 END`
      : asc(priorityOrder),
    asc(priorityOrder),
    desc(issues.updatedAt)
  );

// 코멘트 검색이 정말 필요하면 나중에 추가
```

**LOC 절감 예상**: 30-40 라인
**성능 향상**: 불필요한 EXISTS 서브쿼리 제거

---

### 8. **이슈 계층구조 조회 복잡도** (services/issues.ts: 1031-1156)

#### 문제점
```typescript
// getAncestors: 125 lines
// - While 루프로 부모 이슈 순회
// - 프로젝트/골 일괄 조회 후 매핑
// - workspace 정보 enrichment
// - 중첩된 Map 구조 (projectMap, goalMap, workspaceMap)
// - executionPolicy 메타데이터 변환
```

#### 과도한 최적화
- N+1 쿼리 회피를 위한 복잡한 배치 로직
- 그런데 대부분의 이슈는 부모가 **0-2개**
- 50개 제한이 있지만 실제로는 거의 도달하지 않음

#### 단순화 권장사항
```typescript
// BEFORE: 125 lines of batching logic

// AFTER: Simple recursive approach with reasonable limit
async getAncestors(issueId: string, limit = 10) {
  const ancestors = [];
  let currentId = (await this.getById(issueId))?.parentId;

  while (currentId && ancestors.length < limit) {
    const parent = await db.select({
      id: issues.id,
      identifier: issues.identifier,
      title: issues.title,
      description: issues.description,
      status: issues.status,
      priority: issues.priority,
      assigneeAgentId: issues.assigneeAgentId,
      projectId: issues.projectId,
      goalId: issues.goalId,
      parentId: issues.parentId,
    })
    .from(issues)
    .where(eq(issues.id, currentId))
    .then(r => r[0] ?? null);

    if (!parent) break;

    // Only fetch project/goal if needed
    const [project, goal] = await Promise.all([
      parent.projectId ? projectService.getById(parent.projectId) : null,
      parent.goalId ? goalService.getById(parent.goalId) : null,
    ]);

    ancestors.push({ ...parent, project, goal });
    currentId = parent.parentId;
  }

  return ancestors;
}
```

**LOC 절감 예상**: 60-70 라인
**trade-off**: N+1 쿼리 발생하지만, 실제 부모 이슈 수가 적어 성능 영향 미미

---

### 9. **중복된 메시지 검증 로직** (issue-protocol.ts)

#### 문제점
```typescript
// 330-407: validateMessage() - 78 lines
// - MESSAGE_RULES 테이블 조회 (30-114행, 85 lines)
// - 중첩된 if 체크 10+ 개
// - 페이로드 검증이 메시지 검증과 혼재

// 409-432: validateEvidenceRequirements() - 24 lines
// - 별도 정책 파일 (issue-protocol-policy.ts) 호출
```

#### 과도한 추상화
- 검증 로직이 3곳에 분산:
  1. MESSAGE_RULES 상수 (85 lines)
  2. validateMessage 함수 (78 lines)
  3. issue-protocol-policy.ts (89 lines)

#### 단순화 권장사항
```typescript
// BEFORE: 3-layer validation
MESSAGE_RULES → validateMessage → validateEvidenceRequirements → evaluateProtocolEvidenceRequirement

// AFTER: 2-layer with clearer separation
// 1. Protocol state machine (MESSAGE_RULES - keep as is)
// 2. Single validation function with sections

async function validateProtocolMessage(currentState, message) {
  const rule = MESSAGE_RULES[message.messageType];

  // 1. Role validation
  if (!rule.roles.includes(message.sender.role)) {
    throw unprocessable(`Role ${message.sender.role} cannot send ${message.messageType}`);
  }

  // 2. State transition validation
  const from = currentState?.workflowState ?? null;
  const to = message.workflowStateAfter;

  if (!from && message.messageType !== "ASSIGN_TASK") {
    throw conflict("First message must be ASSIGN_TASK");
  }
  if (from && message.workflowStateBefore !== from) {
    throw conflict(`State mismatch: expected ${from}, got ${message.workflowStateBefore}`);
  }
  if (rule.from !== "*" && !rule.from.includes(from)) {
    throw conflict(`Cannot transition from ${from} with ${message.messageType}`);
  }

  // 3. Payload validation (inline simple checks)
  validateMessagePayload(message);

  // 4. Evidence validation (only for specific messages)
  validateMessageEvidence(message, currentState);
}
```

**LOC 절감 예상**: 40-50 라인

---

## 제거 대상 코드

### Dead Code 후보

1. **escapeLikePattern** (issues.ts:83-85)
   - 사용처: list() 메서드에서만
   - 인라인 가능: 3줄 → 호출처에 직접 작성

2. **sameRunLock** (issues.ts:76-79)
   - 단순 비교 로직을 함수로 추상화
   - 호출처: 3곳 → 직접 비교로 대체 가능

3. **applyStatusSideEffects** (issues.ts:34-50)
   - 호출처: update() 메서드 1곳 (469행)
   - 인라인하면 더 명확

4. **normalizeIntegrityRecipients/Artifacts** (issue-protocol.ts:165-193)
   - 단순 매핑 로직
   - 호출처에서 직접 map() 사용 가능

### 미사용 타입 정의

```typescript
// issues.ts:73-74
type IssueActiveRunRow = { ... };  // 단 1곳에서만 사용
type IssueWithLabelsAndRun = ...;  // 단 1곳에서만 사용

// → 사용처에 직접 인라인
```

---

## YAGNI 위반 사례

### 1. **프로토콜 무결성 서명** (protocol-integrity.ts)

```typescript
// 전체 파일이 암호화 서명 시스템
// - SHA256 해시
// - HMAC 서명
// - 체인 무결성 검증

// 그런데:
// 1. 실제 사용: 내부 시스템 간 통신
// 2. 외부 공격자 없음
// 3. DB 트랜잭션으로 이미 일관성 보장
```

**질문**: 이 무결성 검증이 정말 필요한가?
- 법적 감사 요구사항? → 문서에 명시 없음
- 블록체인 연동? → 계획 없음
- 외부 API 노출? → 내부용

**권장**: 실제 요구사항이 명확해질 때까지 제거 고려

---

### 2. **복잡한 Evidence Policy** (issue-protocol-policy.ts)

```typescript
// 89 lines for artifact validation
// - SUBMIT_FOR_REVIEW requires diff/commit/test_run
// - APPROVE_IMPLEMENTATION requires evidence
// - CLOSE_TASK requires verification

// 그런데 실제로:
// 1. 프런트엔드에서 이미 파일 변경사항 UI 표시
// 2. Git integration 없음 (계획만 존재)
// 3. CI/CD integration 없음
```

**권장**: 단순화
```typescript
// BEFORE: Complex artifact requirements
if (!hasProtocolArtifactKind(message.artifacts, REQUIRED_KINDS)) {
  throw unprocessable("Missing required artifact");
}

// AFTER: Simple validation
if (message.messageType === "SUBMIT_FOR_REVIEW" && !message.payload.changedFiles?.length) {
  throw unprocessable("Review submission requires changed files");
}
```

**LOC 절감**: 60+ 라인

---

### 3. **지식 검색 복잡도** (issue-retrieval.ts: 1,612 lines)

#### 과도한 기능
```typescript
// - 13개의 retrieval event types
// - 7개의 brief scopes
// - 복잡한 authority level 계산
// - 임베딩 + reranking 2단계 검색
// - chunk linking 시스템
```

#### 실제 사용 현황
- 프로덕션 데이터: ?
- 사용자 피드백: ?
- 성능 병목: ?

**권장**:
1. 메트릭 수집 먼저
2. 실제로 사용되는 기능만 유지
3. 나머지는 feature flag로 비활성화

---

## 복잡한 조건문 체인

### 1. **checkout() 메서드** (issues.ts:526-652)

```typescript
// 5단계 중첩 if 블록
if (!updated) {
  const current = await db.select(...)

  if (조건1 && 조건2 && 조건3 && 조건4) {
    const adopted = await db.update(...)
    if (adopted) return adopted;
  }

  if (조건A && 조건B && 조건C) {
    const adopted = await adoptStaleCheckoutRun(...)
    if (adopted) {
      const row = await db.select(...)
      return enriched;
    }
  }

  if (조건X && 조건Y && 조건Z) {
    const row = await db.select(...)
    return enriched;
  }

  throw conflict(...);
}
```

**순환복잡도**: ~30
**가독성**: 낮음 (로직 추적 어려움)

#### 단순화 권장사항
```typescript
// Early return pattern
async checkout(id, agentId, expectedStatuses, runId) {
  // 1. Try optimistic update
  const updated = await tryOptimisticCheckout(...);
  if (updated) return updated;

  // 2. Fetch current state
  const current = await getCurrentIssueState(id);

  // 3. Check if already owned
  if (isAlreadyOwned(current, agentId, runId)) {
    return await adoptOrReturn(current, agentId, runId);
  }

  // 4. Check if can steal from stale run
  if (canStealFromStaleRun(current, agentId, runId)) {
    return await stealCheckout(id, agentId, runId);
  }

  // 5. Cannot checkout
  throw conflict("Checkout failed", current);
}
```

---

### 2. **list() 검색 조건** (issues.ts:289-360)

```typescript
// 7개의 서로 다른 필터 조건
if (filters?.status) { ... }
if (filters?.assigneeAgentId) { ... }
if (filters?.assigneeUserId) { ... }
if (filters?.projectId) { ... }
if (filters?.labelId) { ... }  // 이것만 서브쿼리
if (hasSearch) { ... }  // 6개 조건 OR
conditions.push(isNull(issues.hiddenAt));  // 항상 추가
```

#### 단순화 권장사항
```typescript
// Filter builder pattern
class IssueQueryBuilder {
  private conditions = [];

  forCompany(companyId) {
    this.conditions.push(eq(issues.companyId, companyId));
    return this;
  }

  withStatus(status) {
    if (!status) return this;
    const statuses = status.split(",");
    this.conditions.push(statuses.length === 1
      ? eq(issues.status, statuses[0])
      : inArray(issues.status, statuses));
    return this;
  }

  withAssignee(agentId, userId) {
    if (agentId) this.conditions.push(eq(issues.assigneeAgentId, agentId));
    if (userId) this.conditions.push(eq(issues.assigneeUserId, userId));
    return this;
  }

  // ... more filters

  build() {
    this.conditions.push(isNull(issues.hiddenAt));
    return and(...this.conditions);
  }
}

// Usage
const query = new IssueQueryBuilder()
  .forCompany(companyId)
  .withStatus(filters?.status)
  .withAssignee(filters?.assigneeAgentId, filters?.assigneeUserId)
  .withSearch(filters?.q)
  .build();
```

---

## 테스트하기 어려운 코드

### 1. **거대한 라우트 핸들러**

**문제**: 200+ 라인 핸들러는 단위 테스트 불가능
- HTTP request/response mocking 필요
- 모든 의존성 mock 필요
- Integration test로만 가능 (느림, 불안정)

**해결**: Service layer로 로직 이동
```typescript
// BEFORE: Route handler with business logic (untestable)
router.post("/endpoint", async (req, res) => {
  // 200 lines of logic
});

// AFTER: Testable service
class IssueService {
  async performAction(input) {
    // Pure business logic - easy to test
  }
}

// Route becomes thin
router.post("/endpoint", async (req, res) => {
  const result = await issueService.performAction(req.body);
  res.json(result);
});
```

---

### 2. **DB 트랜잭션 내부 복잡 로직**

```typescript
// issues.ts:402-429
return db.transaction(async (tx) => {
  const [company] = await tx.update(companies)...
  const issueNumber = company.issueCounter;
  const identifier = `${company.issuePrefix}-${issueNumber}`;

  const values = { ...issueData, companyId, issueNumber, identifier };
  if (values.status === "in_progress" && !values.startedAt) {
    values.startedAt = new Date();
  }
  // ... more logic

  const [issue] = await tx.insert(issues).values(values).returning();
  if (inputLabelIds) {
    await syncIssueLabels(issue.id, companyId, inputLabelIds, tx);
  }
  const [enriched] = await withIssueLabels(tx, [issue]);
  return enriched;
});
```

**문제**: 트랜잭션 내부 로직 테스트 어려움

**해결**: 순수 함수 분리
```typescript
// Testable pure function
function prepareIssueForCreation(issueData, company) {
  const issueNumber = company.issueCounter;
  const identifier = `${company.issuePrefix}-${issueNumber}`;

  return {
    ...issueData,
    issueNumber,
    identifier,
    startedAt: issueData.status === "in_progress" ? new Date() : null,
    // ...
  };
}

// Thin transaction wrapper
return db.transaction(async (tx) => {
  const [company] = await tx.update(companies)...
  const values = prepareIssueForCreation(issueData, company);
  const [issue] = await tx.insert(issues).values(values).returning();
  // ...
});
```

---

## 대규모 모듈 분할 제안

### routes/issues.ts (1,631 lines) → 4개 파일

```
routes/
  issues/
    index.ts          # Router setup (50 lines)
    crud.ts           # GET/POST/PATCH/DELETE basic CRUD (400 lines)
    protocol.ts       # Protocol message endpoints (300 lines)
    attachments.ts    # Attachment/comment endpoints (250 lines)
    labels.ts         # Label endpoints (150 lines)
```

**이점**:
- 파일당 150-400 라인
- 관련 기능끼리 그룹화
- 병렬 개발 용이

---

### services/issues.ts (1,176 lines) → 3개 파일

```
services/
  issues/
    index.ts          # Main service factory (100 lines)
    crud.ts           # create/update/delete/list/get (500 lines)
    checkout.ts       # checkout/release/assertCheckoutOwner (300 lines)
    labels.ts         # Label operations (200 lines)
```

---

### services/issue-retrieval.ts (1,612 lines) → 분석 필요

**현재 구조**:
- 지식 검색 로직
- 임베딩 + 리랭킹
- Brief 생성
- 복잡한 스코어링

**문제**: 실제 사용률 불명확

**권장**:
1. 메트릭 먼저 수집
2. 사용되는 기능만 유지
3. 사용 안되면 삭제 고려

---

## 최종 평가

### 전체 잠재 LOC 감소량

| 카테고리 | 현재 LOC | 감소 예상 | 감소율 |
|---------|----------|----------|--------|
| routes/issues.ts | 1,631 | 600-800 | 37-49% |
| services/issues.ts | 1,176 | 300-400 | 26-34% |
| services/issue-protocol.ts | 799 | 100-150 | 13-19% |
| services/issue-retrieval.ts | 1,612 | 400-800 | 25-50% |
| **합계** | **5,218** | **1,400-2,150** | **27-41%** |

### 복잡도 점수

| 파일 | 현재 | 목표 | 개선 |
|------|------|------|------|
| routes/issues.ts | **HIGH** (12.4) | MEDIUM (6-8) | ✅ 50% 감소 |
| services/issues.ts | **HIGH** (12.7) | MEDIUM (6-8) | ✅ 50% 감소 |
| services/issue-retrieval.ts | MEDIUM (8.7) | LOW (4-6) | ✅ 40% 감소 |

---

## 권장 조치 우선순위

### 🔥 즉시 실행 (Quick Wins)

1. **라우트 핸들러 얇게 만들기** (1-2일)
   - 영향: 높음
   - 난이도: 낮음
   - LOC 감소: 600+

2. **중복 권한 검증 미들웨어화** (1일)
   - 영향: 중간
   - 난이도: 낮음
   - LOC 감소: 150+

3. **불필요한 헬퍼 함수 제거** (1일)
   - escapeLikePattern, sameRunLock, assertTransition 등
   - 영향: 낮음
   - 난이도: 낮음
   - LOC 감소: 50+

### ⚡ 단기 실행 (1-2주)

4. **checkout 로직 단순화** (2-3일)
   - 영향: 높음 (가독성, 유지보수성)
   - 난이도: 중간
   - LOC 감소: 100+

5. **검색 정렬 로직 단순화** (2일)
   - 영향: 중간
   - 난이도: 낮음
   - LOC 감소: 40+

6. **레이블 enrichment 단순화** (1일)
   - 영향: 낮음
   - 난이도: 낮음
   - LOC 감소: 40+

### 🎯 중기 실행 (1개월)

7. **파일 분할** (1주)
   - routes/issues.ts → 4개 파일
   - services/issues.ts → 3개 파일
   - 영향: 높음
   - 난이도: 중간

8. **프로토콜 검증 로직 통합** (3일)
   - 영향: 중간
   - 난이도: 중간
   - LOC 감소: 100+

### 🤔 장기 검토 (요구사항 재확인 필요)

9. **프로토콜 무결성 시스템 재평가** (1주)
   - 실제 요구사항 확인
   - 법적/감사 요구사항 문서화
   - 불필요시 제거

10. **지식 검색 시스템 최적화** (2주)
    - 사용률 메트릭 수집
    - 사용 안되는 기능 제거
    - LOC 감소: 400-800

---

## 결론

SquadRail의 이슈 관리 시스템은 **과도한 엔지니어링(Over-engineering)**으로 인해 불필요한 복잡도가 높습니다.

### 핵심 문제
1. ✅ **Fat Routes**: 비즈니스 로직이 라우트 레이어에 혼재
2. ✅ **Premature Optimization**: 실제 필요하지 않은 배치 처리, 복잡한 정렬
3. ✅ **Unnecessary Abstractions**: 1곳에서만 쓰는 3단계 추상화
4. ✅ **YAGNI Violations**: 사용하지 않는 무결성 검증, 복잡한 정책

### 예상 효과
- **LOC 27-41% 감소** (5,218 → 3,000-3,800 라인)
- **복잡도 50% 감소** (순환복잡도 12+ → 6-8)
- **테스트 용이성 향상** (순수 함수 분리)
- **개발 속도 향상** (명확한 코드, 작은 파일)
- **버그 감소** (단순한 로직, 적은 엣지 케이스)

### 추천 액션
**1주차**: Quick Wins 3개 실행 (항목 1-3)
**2-3주차**: 단기 실행 3개 (항목 4-6)
**4주차**: 파일 분할 (항목 7)

이후 메트릭 수집하여 장기 항목 결정.

---

**작성일**: 2026-03-09
**분석 대상**: `/home/taewoong/company-project/squadall/server/src`
**주요 파일**: routes/issues.ts (1,631줄), services/issues.ts (1,176줄)
