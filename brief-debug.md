# Brief 자동 생성 디버깅 결과

## 발견된 문제

### 1. OPENAI_API_KEY 미설정 ❌

**증거**:
```bash
$ cat .env
DATABASE_URL=postgres://squadrail:squadrail@localhost:5432/squadrail
PORT=3100
SERVE_UI=false
BETTER_AUTH_SECRET=...
# OPENAI_API_KEY 없음!
```

**영향**:
- `knowledge-embeddings.ts` Line 63-81: `resolveOpenAiEmbeddingConfig()` returns `null`
- `issue-retrieval.ts` Line 1295-1312: Embedding generation fails silently
- Dense search disabled (queryEmbedding = null)
- Brief generation still proceeds but with degraded quality

### 2. Error Handling이 Silent Fail

**코드**: `/home/taewoong/company-project/squadall/server/src/routes/issues.ts` Line 1170-1194

```typescript
try {
  const retrieval = await issueRetrieval.handleProtocolMessage(...);
  recipientHints = retrieval.recipientHints;
} catch (err) {
  logger.warn({ err, issueId: issue.id }, "failed to build protocol retrieval context");
  // ⚠️ Continue without hints - Silent fail
}
```

**문제**:
- Retrieval 실패해도 protocol message는 정상 진행
- 에러가 로그에만 기록되고 알림 없음
- Brief 없이 task assign 가능

### 3. Retrieval Service는 정상 동작

**분석**: `/home/taewoong/company-project/squadall/server/src/services/issue-retrieval.ts` Line 1219-1555

**핵심 로직**:
1. Line 1231-1238: Event type 확인
2. Line 1258-1272: Retrieval policy 가져오거나 생성
3. Line 1278-1282: Query text 생성
4. Line 1294-1312: **Embedding 생성 (실패 가능)**
5. Line 1338-1371: Sparse/Dense/Path/Symbol 검색
6. Line 1446-1480: **Brief 생성**
7. Line 1484-1500: Activity log 기록

**결론**: 로직은 정상이지만 OPENAI_API_KEY 없으면 dense search 건너뛰기

## 적용된 수정 사항

### ✅ 1. 향상된 Error Logging

**파일**: `server/src/services/issue-retrieval.ts`

- Line 1231-1247: 함수 시작 시 상세 로깅 추가
- Line 1267-1275: 각 recipient 처리 로깅
- Line 1303-1310: Query 생성 로깅
- Line 1312-1327: Embedding 실패 시 CRITICAL 로그
- Line 1381-1392: Search hits 카운트 로깅
- Line 1500-1509: Brief 생성 성공 로깅

**효과**:
- 디버깅 용이성 극대화
- 실패 지점 즉시 파악 가능
- Production 모니터링 개선

### ✅ 2. Routes Error Handling 개선

**파일**: `server/src/routes/issues.ts`

- Line 1191-1203: Brief 생성 성공 시 INFO 로그
- Line 1205-1216: Retrieval 실패 시 ERROR 로그 (WARN→ERROR 변경)

**효과**:
- Silent fail 방지
- 에러 추적 개선
- 운영 알림 트리거 가능

### ✅ 3. 설정 검증 스크립트

**파일**: `server/scripts/verify-retrieval-config.ts`

기능:
1. Embedding provider 상태 확인
2. API key 검증 (실제 요청 테스트)
3. Database connectivity 확인
4. Knowledge base 통계
5. Retrieval policies 확인
6. Retrieval history 확인

사용법:
```bash
cd server
npm run tsx scripts/verify-retrieval-config.ts
```

### ✅ 4. 환경 설정 템플릿

**파일**: `.env.example`

추가된 내용:
- OPENAI_API_KEY 설정 가이드
- Optional configuration 예시
- API key 획득 링크

### ✅ 5. 상세 설정 가이드

**파일**: `RETRIEVAL_SETUP.md`

포함 내용:
- Configuration 단계별 가이드
- 동작 원리 상세 설명
- Troubleshooting 가이드
- Performance tuning 지침
- Monitoring queries
- Architecture diagram
- Development guide

## 즉시 조치 사항 (사용자)

### 1. OPENAI_API_KEY 설정

```bash
cd /home/taewoong/company-project/squadall
echo "OPENAI_API_KEY=sk-..." >> .env
```

### 2. 설정 검증

```bash
cd server
npm run tsx scripts/verify-retrieval-config.ts
```

예상 출력:
```
✅ Embedding provider configured
✅ Embedding generation successful
✅ Database connection successful
✅ Knowledge base ready
✅ CONFIGURATION COMPLETE
```

### 3. 서버 재시작

```bash
npm run dev
```

### 4. 테스트

1. 새 issue 생성
2. Agent에게 ASSIGN_TASK
3. 로그 확인:
   ```bash
   tail -f logs/server.log | grep RETRIEVAL
   ```
4. 예상 로그:
   ```
   [RETRIEVAL] Starting retrieval for message: {...}
   [RETRIEVAL] Event type derived: on_assignment
   [RETRIEVAL] Processing recipients: {...}
   [RETRIEVAL] Query generated: {...}
   [RETRIEVAL] Sparse hits: 15
   [RETRIEVAL] Dense hits: 12
   [RETRIEVAL] Brief created: {...}
   ```

### 5. 검증

```sql
-- Retrieval runs 확인
SELECT COUNT(*) FROM retrieval_runs;

-- Brief 확인
SELECT id, brief_scope, brief_version, created_at
FROM task_briefs
ORDER BY created_at DESC
LIMIT 5;
```

## 완료 체크리스트

- ✅ 문제 진단 완료
- ✅ Error logging 개선
- ✅ Debug logging 추가
- ✅ 설정 검증 스크립트 생성
- ✅ .env.example 업데이트
- ✅ 상세 설정 가이드 작성
- ⏳ OPENAI_API_KEY 설정 (사용자 작업)
- ⏳ 테스트 및 검증 (사용자 작업)

## 파일 변경 내역

### 수정된 파일

1. `/home/taewoong/company-project/squadall/server/src/services/issue-retrieval.ts`
   - 디버그 로깅 추가 (10개 지점)
   - Embedding 실패 시 CRITICAL 로그

2. `/home/taewoong/company-project/squadall/server/src/routes/issues.ts`
   - Brief 생성 성공/실패 로깅 개선
   - WARN → ERROR 변경

3. `/home/taewoong/company-project/squadall/.env.example`
   - OPENAI_API_KEY 설정 예시 추가

### 생성된 파일

1. `/home/taewoong/company-project/squadall/server/scripts/verify-retrieval-config.ts`
   - 설정 검증 스크립트

2. `/home/taewoong/company-project/squadall/RETRIEVAL_SETUP.md`
   - 완전한 설정 및 troubleshooting 가이드

3. `/home/taewoong/company-project/squadall/brief-debug.md`
   - 이 문서

## 다음 단계

1. **OPENAI_API_KEY 설정**
2. **검증 스크립트 실행**
3. **테스트 수행**
4. **Production 배포 전 확인**:
   - Embedding 생성률 > 90%
   - Retrieval policy 설정 확인
   - 모니터링 설정
