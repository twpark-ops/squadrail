# SquadRail 데이터 무결성 및 일관성 감사 보고서

**감사 일자**: 2026-03-09
**감사 범위**: Backend Database Schema & Services
**심각도 분류**: CRITICAL, HIGH, MEDIUM, LOW

---

## 목차
1. [핵심 요약](#핵심-요약)
2. [CRITICAL 이슈](#critical-이슈)
3. [HIGH 이슈](#high-이슈)
4. [MEDIUM 이슈](#medium-이슈)
5. [긍정적 발견사항](#긍정적-발견사항)
6. [권장사항 요약](#권장사항-요약)

---

## 핵심 요약

### 주요 발견사항
- **CRITICAL**: 40개 테이블의 외래키에 CASCADE DELETE 미설정으로 인한 데이터 불일치 위험
- **CRITICAL**: `companies.remove()` 메서드의 수동 삭제 로직 불완전
- **HIGH**: 여러 테이블의 외래키에 orphan 레코드 발생 가능성
- **HIGH**: Transaction 범위 내 Race Condition 취약점
- **MEDIUM**: RLS 정책 활성화로 인한 성능 영향 가능성
- **긍정적**: Issue Protocol 메시지 무결성 검증 시스템 우수
- **긍정적**: RLS(Row Level Security) 정책 전면 적용으로 Multi-tenant 보안 강화

---

## CRITICAL 이슈

### 1. Companies Deletion Path의 데이터 무결성 위험
**파일**: `/home/taewoong/company-project/squadall/server/src/services/companies.ts:100-128`

#### 문제점
Company 삭제 시 수동으로 23개 테이블을 순차 삭제하지만, **40개 테이블**이 `companies.id`를 참조하고 있어 누락된 테이블들이 존재합니다.

**현재 삭제 중인 테이블 (23개)**:
```typescript
// companies.ts의 remove() 메서드
await tx.delete(heartbeatRunEvents).where(eq(heartbeatRunEvents.companyId, id));
await tx.delete(agentTaskSessions).where(eq(agentTaskSessions.companyId, id));
await tx.delete(heartbeatRuns).where(eq(heartbeatRuns.companyId, id));
await tx.delete(agentWakeupRequests).where(eq(agentWakeupRequests.companyId, id));
await tx.delete(agentApiKeys).where(eq(agentApiKeys.companyId, id));
await tx.delete(agentRuntimeState).where(eq(agentRuntimeState.companyId, id));
await tx.delete(issueComments).where(eq(issueComments.companyId, id));
await tx.delete(costEvents).where(eq(costEvents.companyId, id));
await tx.delete(approvalComments).where(eq(approvalComments.companyId, id));
await tx.delete(approvals).where(eq(approvals.companyId, id));
await tx.delete(companySecrets).where(eq(companySecrets.companyId, id));
await tx.delete(joinRequests).where(eq(joinRequests.companyId, id));
await tx.delete(invites).where(eq(invites.companyId, id));
await tx.delete(principalPermissionGrants).where(eq(principalPermissionGrants.companyId, id));
await tx.delete(companyMemberships).where(eq(companyMemberships.companyId, id));
await tx.delete(issues).where(eq(issues.companyId, id));
await tx.delete(goals).where(eq(goals.companyId, id));
await tx.delete(projects).where(eq(projects.companyId, id));
await tx.delete(agents).where(eq(agents.companyId, id));
await tx.delete(activityLog).where(eq(activityLog.companyId, id));
```

**누락된 테이블 (17개 이상)**:
- `knowledge_documents` - 지식 문서 orphan 발생
- `knowledge_chunks` - 임베딩 데이터 orphan 발생
- `knowledge_chunk_links` - 링크 orphan 발생
- `retrieval_policies` - 검색 정책 orphan 발생
- `retrieval_runs` - 검색 실행 기록 orphan 발생
- `retrieval_run_hits` - 검색 결과 orphan 발생
- `issue_protocol_messages` - 프로토콜 메시지 orphan 발생
- `issue_protocol_threads` - 프로토콜 스레드 orphan 발생
- `issue_protocol_state` - 프로토콜 상태 orphan 발생
- `issue_protocol_artifacts` - 아티팩트 orphan 발생
- `issue_protocol_recipients` - 수신자 orphan 발생
- `issue_protocol_violations` - 위반 기록 orphan 발생
- `issue_review_cycles` - 리뷰 사이클 orphan 발생
- `issue_task_briefs` - Task Brief orphan 발생
- `issue_attachments` - 첨부파일 orphan 발생
- `issue_labels` - 라벨 연결 orphan 발생
- `issue_approvals` - Approval 연결 orphan 발생
- `labels` - CASCADE 설정되어 있음
- `role_pack_sets` - CASCADE 설정되어 있음
- `setup_progress` - CASCADE 설정되어 있음
- `project_workspaces` - 워크스페이스 orphan 발생
- `project_goals` - 프로젝트-목표 연결 orphan 발생
- `assets` - 에셋 orphan 발생
- `agent_config_revisions` - CASCADE 설정되어 있음

#### 데이터 손상 시나리오
```sql
-- 시나리오: Company "ACME Corp" 삭제 시도
BEGIN;
  DELETE FROM companies WHERE id = 'uuid-acme';
  -- 수동 삭제 중 네트워크 오류 발생
ROLLBACK;

-- 결과:
-- 1. 일부 테이블만 삭제된 상태로 롤백
-- 2. knowledge_documents 등의 orphan 레코드가 영구 잔류
-- 3. 디스크 공간 낭비 및 쿼리 성능 저하
-- 4. 다른 company의 데이터 참조 시 혼란
```

#### 권장 수정사항

**옵션 1: Database CASCADE 설정 (권장)**
```sql
-- Migration: Add CASCADE DELETE to all company foreign keys
ALTER TABLE knowledge_documents
  DROP CONSTRAINT knowledge_documents_company_id_companies_id_fk,
  ADD CONSTRAINT knowledge_documents_company_id_companies_id_fk
    FOREIGN KEY (company_id) REFERENCES companies(id)
    ON DELETE CASCADE;

-- 40개 테이블 모두 적용 필요
```

**옵션 2: 완전한 수동 삭제 로직**
```typescript
// 의존성 순서에 따른 완전한 삭제 체인
remove: (id: string) =>
  db.transaction(async (tx) => {
    // Level 5: Deep nested dependencies
    await tx.delete(retrievalRunHits).where(eq(retrievalRunHits.companyId, id));
    await tx.delete(knowledgeChunkLinks).where(eq(knowledgeChunkLinks.companyId, id));
    await tx.delete(issueProtocolArtifacts).where(eq(issueProtocolArtifacts.companyId, id));
    await tx.delete(issueProtocolRecipients).where(eq(issueProtocolRecipients.companyId, id));
    await tx.delete(rolePackFiles).where(...); // via role_pack_revisions join

    // Level 4: Protocol & Knowledge
    await tx.delete(issueProtocolMessages).where(eq(issueProtocolMessages.companyId, id));
    await tx.delete(knowledgeChunks).where(eq(knowledgeChunks.companyId, id));
    await tx.delete(retrievalRuns).where(eq(retrievalRuns.companyId, id));
    await tx.delete(issueProtocolViolations).where(eq(issueProtocolViolations.companyId, id));
    await tx.delete(issueReviewCycles).where(eq(issueReviewCycles.companyId, id));

    // Level 3: Issue related
    await tx.delete(issueProtocolThreads).where(eq(issueProtocolThreads.companyId, id));
    await tx.delete(issueProtocolState).where(eq(issueProtocolState.companyId, id));
    await tx.delete(issueTaskBriefs).where(eq(issueTaskBriefs.companyId, id));
    await tx.delete(issueAttachments).where(eq(issueAttachments.companyId, id));
    await tx.delete(issueLabels).where(eq(issueLabels.companyId, id));
    await tx.delete(issueApprovals).where(eq(issueApprovals.companyId, id));

    // Level 2: Documents & Policies
    await tx.delete(knowledgeDocuments).where(eq(knowledgeDocuments.companyId, id));
    await tx.delete(retrievalPolicies).where(eq(retrievalPolicies.companyId, id));
    await tx.delete(projectWorkspaces).where(eq(projectWorkspaces.companyId, id));
    await tx.delete(projectGoals).where(eq(projectGoals.companyId, id));
    await tx.delete(assets).where(eq(assets.companyId, id));

    // 기존 삭제 로직 계속...
    // ...

    // Level 0: Company itself
    const rows = await tx
      .delete(companies)
      .where(eq(companies.id, id))
      .returning();
    return rows[0] ?? null;
  }),
```

**비용-효율 분석**:
- CASCADE 설정: DB 레벨 보장, 성능 우수, 유지보수 간편 ✅ **강력 권장**
- 수동 삭제: 복잡도 높음, 실수 가능성, 순서 의존성 관리 필요

---

### 2. Foreign Key Constraint 누락으로 인한 Orphan 레코드 위험

#### 2.1 Issues 관련 Orphan 위험
**파일**: `/home/taewoong/company-project/squadall/packages/db/src/schema/issues.ts:22-36`

```typescript
// 현재 상태
projectId: uuid("project_id").references(() => projects.id),  // ❌ onDelete 없음
parentId: uuid("parent_id").references((): AnyPgColumn => issues.id),  // ❌ onDelete 없음
assigneeAgentId: uuid("assignee_agent_id").references(() => agents.id),  // ❌ onDelete 없음
createdByAgentId: uuid("created_by_agent_id").references(() => agents.id),  // ❌ onDelete 없음
```

**문제점**:
1. **Project 삭제 시**: Issue의 `projectId`가 dangling reference로 남음
2. **Agent 삭제 시**: Issue의 `assigneeAgentId`, `createdByAgentId`가 유효하지 않은 ID 참조
3. **Parent Issue 삭제 시**: Sub-issue가 존재하지 않는 parent 참조

**데이터 손상 시나리오**:
```sql
-- Agent 삭제
DELETE FROM agents WHERE id = 'agent-123';

-- Issue는 여전히 삭제된 Agent를 참조
SELECT * FROM issues WHERE assignee_agent_id = 'agent-123';
-- ⚠️ 결과: Orphan 레코드, UI에서 "Unknown Agent" 표시 또는 크래시

-- JOIN 시 데이터 누락
SELECT i.*, a.name FROM issues i
LEFT JOIN agents a ON i.assignee_agent_id = a.id
WHERE i.company_id = 'company-xyz';
-- ⚠️ assignee_agent_id IS NOT NULL이지만 a.name IS NULL인 비정상 상태
```

**권장 수정**:
```typescript
// issues.ts
projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
parentId: uuid("parent_id").references((): AnyPgColumn => issues.id, { onDelete: "set null" }),
assigneeAgentId: uuid("assignee_agent_id").references(() => agents.id, { onDelete: "set null" }),
createdByAgentId: uuid("created_by_agent_id").references(() => agents.id, { onDelete: "set null" }),

// Migration 필요:
-- ALTER TABLE issues
--   DROP CONSTRAINT issues_project_id_projects_id_fk,
--   ADD CONSTRAINT issues_project_id_projects_id_fk
--     FOREIGN KEY (project_id) REFERENCES projects(id)
--     ON DELETE SET NULL;
```

#### 2.2 Agent 관련 Orphan 위험
**파일**: `/home/taewoong/company-project/squadall/packages/db/src/schema/agents.ts:17-23`

**누락된 onDelete 설정**:
- `agent_api_keys.agentId` → agents.id
- `agent_task_sessions.agentId` → agents.id
- `agent_wakeup_requests.agentId` → agents.id
- `agent_runtime_state.agentId` → agents.id (PK이므로 CASCADE 필수)
- `heartbeat_runs.agentId` → agents.id
- `heartbeat_run_events.agentId` → agents.id
- `cost_events.agentId` → agents.id
- 등 18개 테이블

**심각도**: Agent 삭제 시 관련된 모든 하위 데이터가 orphan 상태로 남아 디스크 공간 낭비 및 참조 무결성 위반

---

### 3. Issue Comments의 CASCADE 누락
**파일**: `/home/taewoong/company-project/squadall/packages/db/src/schema/issue_comments.ts:11`

```typescript
// 현재
issueId: uuid("issue_id").notNull().references(() => issues.id),  // ❌ onDelete 없음

// 문제: Issue 삭제 시 Comments는 남아있음
// 권장
issueId: uuid("issue_id").notNull().references(() => issues.id, { onDelete: "cascade" }),
```

**영향**: Issue 삭제 시 댓글이 orphan으로 남아 데이터 일관성 위반

---

## HIGH 이슈

### 4. Race Condition: Issue Status 변경 시 Concurrent Update

**파일**: `/home/taewoong/company-project/squadall/server/src/services/issue-protocol.ts:556-766`

#### 문제점
`appendMessage()` 메서드는 Transaction 내에서 다음 순서로 동작:
```typescript
db.transaction(async (tx) => {
  // 1. 현재 상태 조회
  const currentState = await tx.select()...;

  // 2. 메시지 검증
  await validateMessage(currentState, input.message);

  // 3. 메시지 삽입
  const [createdMessage] = await tx.insert(issueProtocolMessages)...;

  // 4. 상태 업데이트
  await tx.update(issueProtocolState)...;

  // 5. Issue 상태 업데이트
  await tx.update(issues)...;
})
```

**Race Condition 시나리오**:
```
Time | Transaction A (Agent 1)           | Transaction B (Agent 2)
-----|-----------------------------------|---------------------------
T1   | BEGIN                             | BEGIN
T2   | SELECT currentState (status: backlog) |
T3   |                                   | SELECT currentState (status: backlog)
T4   | INSERT message (ASSIGN_TASK)      |
T5   |                                   | INSERT message (ASSIGN_TASK) ✅ 통과
T6   | UPDATE state (assigned)           |
T7   |                                   | UPDATE state (assigned) ⚠️ 잘못된 전환
T8   | COMMIT                            | COMMIT

결과: 동일한 Issue에 대해 두 개의 ASSIGN_TASK 메시지가 생성됨
      → 프로토콜 위반, 데이터 일관성 깨짐
```

#### 권장 수정
```typescript
// Option 1: Optimistic Locking with Row-level Lock
db.transaction(async (tx) => {
  // SELECT FOR UPDATE로 row lock 획득
  const currentState = await tx
    .select()
    .from(issueProtocolState)
    .where(eq(issueProtocolState.issueId, issue.id))
    .for('update')  // PostgreSQL: SELECT ... FOR UPDATE
    .then((rows) => rows[0] ?? null);

  // 이후 로직 동일
})

// Option 2: Version-based Optimistic Locking
// issueProtocolState에 version 컬럼 추가
const [updated] = await tx
  .update(issueProtocolState)
  .set({
    ...nextStateValues,
    version: sql`${issueProtocolState.version} + 1`
  })
  .where(and(
    eq(issueProtocolState.issueId, issue.id),
    eq(issueProtocolState.version, currentState.version)  // CAS
  ))
  .returning();

if (!updated) {
  throw conflict('State was modified by another transaction');
}
```

---

### 5. Knowledge Document 삭제 시 Chunk Cascade 불완전

**파일**: `/home/taewoong/company-project/squadall/packages/db/src/schema/knowledge_chunks.ts:18`

```typescript
// ✅ 현재 CASCADE 설정됨
documentId: uuid("document_id").notNull().references(() => knowledgeDocuments.id, { onDelete: "cascade" }),
```

**하지만** `knowledgeDocuments`의 참조는:
```typescript
// knowledge_documents.ts:16-18
projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),  // ✅ 적절
issueId: uuid("issue_id").references(() => issues.id, { onDelete: "set null" }),  // ✅ 적절
messageId: uuid("message_id").references(() => issueProtocolMessages.id, { onDelete: "set null" }),  // ✅ 적절
```

**긍정적**: SET NULL 설정으로 참조 무결성 유지 ✅

---

### 6. Heartbeat Run Deletion 시 Issue 참조 문제

**파일**: `/home/taewoong/company-project/squadall/packages/db/src/schema/issues.ts:32-33`

```typescript
checkoutRunId: uuid("checkout_run_id").references(() => heartbeatRuns.id, { onDelete: "set null" }),  // ✅
executionRunId: uuid("execution_run_id").references(() => heartbeatRuns.id, { onDelete: "set null" }),  // ✅
```

**긍정적**: 적절한 SET NULL 설정 ✅

---

### 7. Transaction Rollback 시 Side Effect 처리 누락

**파일**: `/home/taewoong/company-project/squadall/server/src/middleware/rls.ts:56-100`

#### 문제점
RLS 미들웨어는 모든 요청을 Transaction으로 감싸지만, 400+ 상태 코드 시 자동 롤백합니다:

```typescript
await new Promise<void>((resolve, reject) => {
  const onFinish = () => {
    if (res.statusCode >= 400) {
      reject(new RlsRequestRollback(`response finished with status ${res.statusCode}`));
      return;
    }
    resolve();
  };
  res.once("finish", onFinish);
})
```

**시나리오**:
```typescript
// POST /api/issues - Issue 생성 요청
await db.transaction(async (tx) => {
  // 1. Issue 생성 성공
  const issue = await tx.insert(issues).values(...);

  // 2. External API 호출 (Slack 알림 등)
  await notifySlack({ issueId: issue.id });  // ⚠️ Side Effect

  // 3. 유효성 검증 실패
  throw unprocessable('Invalid data');
})

// 결과:
// - DB: Issue 롤백됨 ✅
// - Slack: 알림 전송됨 ❌ (롤백 불가능한 Side Effect)
// - 데이터 불일치 발생
```

#### 권장사항
```typescript
// Side Effect는 Transaction 외부 또는 COMMIT 후 실행
await db.transaction(async (tx) => {
  const issue = await tx.insert(issues).values(...);
  return issue;
});

// Transaction 성공 후에만 Side Effect 실행
await notifySlack({ issueId: issue.id });
```

---

## MEDIUM 이슈

### 8. RLS Policy로 인한 성능 영향

**파일**: `/home/taewoong/company-project/squadall/packages/db/src/migrations/0028_responsive_rls_vector.sql:71-189`

#### 분석
모든 테이블에 RLS(Row Level Security) 정책이 활성화되어 있습니다:

```sql
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
CREATE POLICY companies_select_access ON companies
  FOR SELECT
  USING (app.company_allowed(id));
```

**영향**:
1. **보안**: Multi-tenant 데이터 격리 보장 ✅
2. **성능**: 모든 쿼리에 `WHERE app.company_allowed(company_id)` 조건 추가
3. **복잡도**: JOIN 시 각 테이블마다 RLS 검사

**성능 최적화 권장사항**:
```sql
-- 1. Function을 STABLE에서 IMMUTABLE로 변경 (가능한 경우)
-- 2. company_ids를 배열이 아닌 임시 테이블로 저장
CREATE TEMP TABLE session_companies (company_id uuid);

-- 3. Index 활용 강화
CREATE INDEX CONCURRENTLY idx_issues_company_id ON issues(company_id)
  WHERE company_id = ANY(app.current_company_ids());
```

---

### 9. Issue Protocol Message Integrity 체인 검증 누락

**파일**: `/home/taewoong/company-project/squadall/server/src/services/issue-protocol.ts:516-538`

#### 분석
메시지 무결성 검증 시스템은 잘 구현되어 있으나, 중간 메시지 누락 검증이 없습니다:

```typescript
let previousIntegritySignature: string | null = null;

return messages.map((message) => {
  const integrity = verifyProtocolMessageIntegrity({
    message: {...},
    expectedPreviousIntegritySignature: previousIntegritySignature,
  });
  previousIntegritySignature = message.integritySignature ?? previousIntegritySignature;
  // ...
})
```

**문제**: 메시지 seq가 1, 2, 5로 건너뛰어도 감지 불가

**권장**:
```typescript
let expectedSeq = 1;
return messages.map((message) => {
  if (message.seq !== expectedSeq) {
    throw new Error(`Message sequence gap detected: expected ${expectedSeq}, got ${message.seq}`);
  }
  expectedSeq++;
  // 기존 검증 로직...
})
```

---

### 10. Company Secrets의 Versioning CASCADE

**파일**: `/home/taewoong/company-project/squadall/packages/db/src/schema/company_secret_versions.ts:9`

```typescript
secretId: uuid("secret_id").notNull().references(() => companySecrets.id, { onDelete: "cascade" }),
```

**긍정적**: Secret 삭제 시 모든 버전이 자동 삭제됨 ✅

---

## 긍정적 발견사항

### 1. ✅ Issue Protocol의 강력한 무결성 보장
- SHA256 해시를 통한 payload 검증
- 이전 메시지 서명 체인 검증
- Causal Message 추적
- 상태 전이 규칙 엄격 검증

### 2. ✅ Transaction 적극 활용
- 대부분의 복잡한 작업이 Transaction으로 보호됨
- Rollback 처리 명확

### 3. ✅ RLS Policy 전면 적용
- Multi-tenant 데이터 격리 보장
- Instance Admin 권한 분리
- SQL Injection 공격 표면 축소

### 4. ✅ 일부 테이블의 올바른 CASCADE 설정
- `knowledge_chunks` → `knowledge_documents` (CASCADE)
- `issue_protocol_messages` → `issues` (CASCADE)
- `issue_protocol_threads` → `issues` (CASCADE)
- `labels` → `companies` (CASCADE)
- `project_workspaces` → `projects` (CASCADE)

### 5. ✅ Soft Delete 패턴 활용
- `companies.archive()` 메서드로 복구 가능한 삭제

---

## 권장사항 요약

### 즉시 조치 필요 (CRITICAL)

1. **Companies 삭제 로직 완전성 확보**
   - [ ] 누락된 17개 테이블 삭제 로직 추가
   - [ ] 또는 Database CASCADE 설정으로 전환 (권장)
   - [ ] Integration Test 작성하여 모든 관련 데이터 삭제 확인

2. **Foreign Key Constraint 전면 재검토**
   - [ ] 40개 테이블의 `company_id` 참조에 `ON DELETE CASCADE` 추가
   - [ ] Agent 관련 테이블에 `ON DELETE SET NULL` 또는 `CASCADE` 추가
   - [ ] Issue 관련 참조에 `ON DELETE SET NULL` 추가

### 단기 조치 (HIGH)

3. **Race Condition 방지**
   - [ ] `issue_protocol_state`에 `SELECT FOR UPDATE` 적용
   - [ ] 또는 Version-based Optimistic Locking 도입

4. **Orphan 데이터 정리 스크립트**
   ```sql
   -- 정기 실행 (Daily Cron)
   DELETE FROM issue_comments
   WHERE issue_id NOT IN (SELECT id FROM issues);

   DELETE FROM knowledge_chunks
   WHERE document_id NOT IN (SELECT id FROM knowledge_documents);
   ```

### 중기 조치 (MEDIUM)

5. **성능 모니터링**
   - [ ] RLS Policy 성능 영향 측정
   - [ ] Slow Query 로그 분석
   - [ ] `app.company_allowed()` 함수 최적화

6. **데이터 무결성 검증 도구**
   ```typescript
   // Scheduled Job: 매일 실행
   async function auditDataIntegrity() {
     // 1. Orphan 레코드 검사
     // 2. Foreign Key 제약조건 위반 검사
     // 3. Protocol 메시지 체인 무결성 검사
     // 4. 보고서 생성 및 알림
   }
   ```

### 장기 조치 (BEST PRACTICE)

7. **Migration Safety**
   - [ ] 모든 Migration에 Rollback 스크립트 포함
   - [ ] Production 적용 전 Staging 환경 검증 필수
   - [ ] 대량 데이터 변경 시 Batch 처리

8. **GDPR Compliance 강화**
   - [ ] PII 필드 식별 및 암호화 확인
   - [ ] Right to be Forgotten 구현 검증
   - [ ] Data Retention Policy 자동화

---

## 구체적 수정 예시

### Migration Script: Add CASCADE to Companies

```sql
-- File: packages/db/src/migrations/XXXX_add_company_cascade.sql

BEGIN;

-- knowledge_documents
ALTER TABLE knowledge_documents
  DROP CONSTRAINT IF EXISTS knowledge_documents_company_id_companies_id_fk,
  ADD CONSTRAINT knowledge_documents_company_id_companies_id_fk
    FOREIGN KEY (company_id) REFERENCES companies(id)
    ON DELETE CASCADE;

-- knowledge_chunks
ALTER TABLE knowledge_chunks
  DROP CONSTRAINT IF EXISTS knowledge_chunks_company_id_companies_id_fk,
  ADD CONSTRAINT knowledge_chunks_company_id_companies_id_fk
    FOREIGN KEY (company_id) REFERENCES companies(id)
    ON DELETE CASCADE;

-- retrieval_policies
ALTER TABLE retrieval_policies
  DROP CONSTRAINT IF EXISTS retrieval_policies_company_id_companies_id_fk,
  ADD CONSTRAINT retrieval_policies_company_id_companies_id_fk
    FOREIGN KEY (company_id) REFERENCES companies(id)
    ON DELETE CASCADE;

-- ... (나머지 37개 테이블)

COMMIT;
```

### TypeScript Schema Update

```typescript
// File: packages/db/src/schema/issues.ts
export const issues = pgTable("issues", {
  // ...
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  parentId: uuid("parent_id").references((): AnyPgColumn => issues.id, { onDelete: "set null" }),
  assigneeAgentId: uuid("assignee_agent_id").references(() => agents.id, { onDelete: "set null" }),
  createdByAgentId: uuid("created_by_agent_id").references(() => agents.id, { onDelete: "set null" }),
  // ...
});
```

### Service Layer Update

```typescript
// File: server/src/services/companies.ts

// BEFORE: 수동 삭제 (불완전)
remove: (id: string) => db.transaction(async (tx) => {
  await tx.delete(heartbeatRunEvents).where(...);
  // ... 23개만 삭제
})

// AFTER: Database CASCADE 활용 (권장)
remove: (id: string) => db.transaction(async (tx) => {
  // CASCADE가 모든 관련 데이터를 자동 삭제
  const rows = await tx
    .delete(companies)
    .where(eq(companies.id, id))
    .returning();

  if (!rows[0]) {
    throw notFound('Company not found');
  }

  return rows[0];
})
```

---

## 결론

SquadRail의 데이터베이스 아키텍처는 **Issue Protocol의 무결성 보장**, **RLS 정책 적용**, **Transaction 활용** 측면에서 우수하나, **Foreign Key Constraint 관리**와 **CASCADE 정책**에서 개선이 필요합니다.

**즉시 조치가 필요한 핵심 위험**:
1. Company 삭제 시 40개 테이블 중 17개만 삭제되어 orphan 데이터 발생
2. Agent/Issue 삭제 시 참조 무결성 위반
3. Concurrent 요청 시 Race Condition 가능성

**권장 우선순위**:
1. **1주 이내**: Database CASCADE 설정 Migration 작성 및 배포
2. **2주 이내**: Race Condition 방지 로직 추가
3. **1개월 이내**: Orphan 데이터 정리 및 무결성 검증 자동화

이러한 개선사항 적용 시 **Production 환경의 데이터 무결성과 안정성이 크게 향상**될 것으로 예상됩니다.

---

**감사자**: Data Integrity Guardian (Claude Sonnet 4.5)
**다음 리뷰 권장일**: 2026-06-09 (3개월 후)
