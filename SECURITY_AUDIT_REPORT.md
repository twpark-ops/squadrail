# SquadRail 백엔드 보안 감사 보고서

**감사 일자:** 2026-03-09
**감사 대상:** /home/taewoong/company-project/squadall/server/src/
**총 파일 수:** 147개 TypeScript 파일

---

## 📋 요약 (Executive Summary)

### 전체 위험도 평가: **MEDIUM** 🟡

SquadRail 백엔드는 전반적으로 양호한 보안 구조를 가지고 있으나, 몇 가지 중요한 개선이 필요합니다.

**주요 발견사항:**
- ✅ SQL Injection 방어: Drizzle ORM 사용으로 대부분 안전
- ✅ XSS 방어: 서버사이드에서 innerHTML/eval 사용 없음
- ⚠️ JWT 보안: 일부 약점 존재
- ⚠️ 인증/인가: 개선 필요 영역 존재
- ⚠️ 비밀 관리: 강화 권장
- ⚠️ WebSocket 보안: 토큰 노출 위험

**긴급 조치 필요:**
- 🔴 HIGH: WebSocket 쿼리 파라미터 토큰 노출 (1건)
- 🔴 HIGH: 환경변수 중복 검증 로직 (1건)
- 🟡 MEDIUM: JWT 시크릿 생성 및 관리 (3건)
- 🟡 MEDIUM: Rate Limiting 메모리 관리 (1건)

---

## 🔍 상세 발견사항

### 1. 인증/인가 (Authentication & Authorization)

#### ✅ 양호한 부분

**1.1 Actor 기반 인증 시스템**
- 파일: `/server/src/middleware/auth.ts`
- Board(사용자)와 Agent 두 가지 actor 타입 구분
- API Key는 SHA-256 해시로 저장 (Line 11-12)
- Timing attack 방어를 위한 `timingSafeEqual` 사용 (agent-auth-jwt.ts Line 116)

**1.2 Row-Level Security (RLS)**
- 파일: `/server/src/middleware/rls.ts`
- PostgreSQL RLS를 통한 데이터 격리
- Transaction-scoped context 설정 (Line 56-65)
- Company ID 기반 격리 강제

**1.3 인가 체크**
- 파일: `/server/src/routes/authz.ts`
- `assertBoard()`: Board 접근 검증
- `assertCompanyAccess()`: Company별 접근 제어
- Agent는 자신의 Company만 접근 가능 (Line 14-16)

#### 🔴 HIGH - 긴급 조치 필요

**1.4 WebSocket 인증 토큰 노출 위험**
- **파일:** `/server/src/realtime/live-events-ws.ts` (Line 105)
- **위치:** Line 105
```typescript
const queryToken = url.searchParams.get("token")?.trim() ?? "";
```

**문제점:**
- WebSocket 연결 시 쿼리 파라미터로 토큰 전달 허용
- 브라우저 히스토리, 프록시 로그, 서버 액세스 로그에 토큰 노출 위험
- Bearer 헤더 사용도 가능하지만 쿼리 파라미터가 fallback으로 존재

**영향도:**
- 토큰이 서버 로그나 중간 프록시에 평문으로 기록될 수 있음
- 공격자가 로그 파일 접근 시 유효한 인증 토큰 탈취 가능

**권장 조치:**
```typescript
// BEFORE (위험)
const queryToken = url.searchParams.get("token")?.trim() ?? "";
const token = authToken ?? (queryToken.length > 0 ? queryToken : null);

// AFTER (안전)
// 쿼리 파라미터 토큰 완전 제거, Authorization 헤더만 허용
const token = parseBearerToken(req.headers.authorization);
if (!token) {
  // 세션 기반 인증으로 fallback
}
```

**우선순위:** 🔴 HIGH
**CVE 참조:** CWE-598 (Use of GET Request Method With Sensitive Query Strings)

---

#### 🟡 MEDIUM - 개선 권장

**1.5 JWT 시크릿 키 관리 약점**
- **파일:** `/server/src/agent-auth-jwt.ts` (Line 76-89)
- **위치:** Line 68-69

**문제점:**
```typescript
const next = randomBytes(32).toString("base64url");
writeFileSync(filePath, `${next}\n`, { encoding: "utf8", mode: 0o600 });
```

- 시크릿 파일이 없으면 자동 생성
- 컨테이너 재시작 시 새로운 키 생성될 수 있음 (ephemeral storage)
- 이전에 발급된 JWT가 모두 무효화됨

**권장 조치:**
1. 시크릿이 없으면 에러 발생 (자동 생성 비활성화)
2. Kubernetes Secret/AWS Secrets Manager 등 사용 강제
3. 환경변수 `SQUADRAIL_AGENT_JWT_SECRET` 필수화

**우선순위:** 🟡 MEDIUM

---

**1.6 Better Auth 시크릿 기본값 사용**
- **파일:** `/server/src/auth/better-auth.ts` (Line 47-51)

**문제점:**
```typescript
const secret =
  process.env.BETTER_AUTH_SECRET ??
  process.env.SQUADRAIL_AGENT_JWT_SECRET ??
  process.env.SQUADRAIL_AGENT_JWT_SECRET ??
  "squadrail-dev-secret";  // ⚠️ 위험한 fallback
```

- 프로덕션에서 기본 시크릿 사용 가능
- 모든 SquadRail 인스턴스가 동일한 시크릿 사용 시 크로스 인스턴스 공격 가능

**권장 조치:**
```typescript
const secret = process.env.BETTER_AUTH_SECRET
  ?? process.env.SQUADRAIL_AGENT_JWT_SECRET;
if (!secret) {
  throw new Error("BETTER_AUTH_SECRET must be set in production");
}
```

**우선순위:** 🟡 MEDIUM
**CVE 참조:** CWE-798 (Use of Hard-coded Credentials)

---

**1.7 JWT 만료 시간 검증 부족**
- **파일:** `/server/src/agent-auth-jwt.ts` (Line 173-174)

**관찰사항:**
```typescript
const now = Math.floor(Date.now() / 1000);
if (exp < now) return null;  // 만료 체크만 존재
```

- `iat` (issued at) 검증 없음
- 미래 시점의 토큰 허용 가능
- Clock skew 공격 가능성

**권장 조치:**
```typescript
const now = Math.floor(Date.now() / 1000);
const CLOCK_TOLERANCE = 60; // 1분
if (exp < now) return null;
if (iat > now + CLOCK_TOLERANCE) return null; // 미래 토큰 거부
```

**우선순위:** 🟢 LOW

---

### 2. SQL Injection 위험 분석

#### ✅ 양호한 부분

**2.1 Drizzle ORM 사용**
- 모든 쿼리가 parameterized query 사용
- Type-safe 쿼리 빌더

**2.2 Raw SQL 사용 검토**
분석 대상 파일 (12개):
- `server/src/services/issue-retrieval.ts`
- `server/src/services/knowledge.ts`
- `server/src/middleware/rls.ts`
- 기타 9개 파일

**검증 결과:**
모든 raw SQL이 안전하게 사용됨:

```typescript
// ✅ 안전 - RLS 설정 (rls.ts Line 57-64)
await tx.execute(sql`
  select
    set_config('app.company_ids', ${JSON.stringify(companyIds)}, true),
    set_config('app.actor_type', ${identity.actorType}, true)
`);

// ✅ 안전 - 벡터 리터럴 생성 (knowledge.ts Line 36-40)
const vectorLiteral = formatVectorLiteral(chunk.embedding);
await dbOrTx.execute(sql`
  UPDATE knowledge_chunks
  SET embedding_vector = ${vectorLiteral}::vector
  WHERE id = ${chunk.id}
`);
```

**위험도:** ✅ **없음** - SQL Injection 위험 없음

---

### 3. 입력 검증 (Input Validation)

#### ✅ 양호한 부분

**3.1 Zod 스키마 검증**
- 파일: `/server/src/middleware/validate.ts`
- 모든 요청 body를 Zod 스키마로 검증 (Line 4-8)

```typescript
export function validate(schema: ZodSchema) {
  return (req: Request, _res: Response, next: NextFunction) => {
    req.body = schema.parse(req.body);  // 파싱 실패 시 자동 에러
    next();
  };
}
```

**3.2 적용 범위**
- `createIssueSchema`
- `updateIssueSchema`
- `createSecretSchema`
- `createAssetImageMetadataSchema`
- 기타 10+ 스키마

#### 🟡 MEDIUM - 개선 권장

**3.3 파일 업로드 검증**
- **파일:** `/server/src/routes/assets.ts` (Line 55-69)

**현재 구현:**
```typescript
const contentType = (file.mimetype || "").toLowerCase();
if (!ALLOWED_IMAGE_CONTENT_TYPES.has(contentType)) {
  res.status(422).json({ error: `Unsupported image type: ${contentType}` });
}
```

**약점:**
- MIME type은 클라이언트가 조작 가능
- 파일 매직 넘버 검증 없음
- 이미지 처리 라이브러리 없이 직접 저장

**권장 조치:**
```typescript
// 파일 매직 넘버로 실제 타입 검증
import { fileTypeFromBuffer } from 'file-type';

const detectedType = await fileTypeFromBuffer(file.buffer);
if (!detectedType || !ALLOWED_IMAGE_CONTENT_TYPES.has(detectedType.mime)) {
  return res.status(422).json({ error: "Invalid image file" });
}
```

**우선순위:** 🟡 MEDIUM
**CVE 참조:** CWE-434 (Unrestricted Upload of File with Dangerous Type)

---

**3.4 URL 파라미터 검증 부족**
- **파일:** 여러 routes 파일들

**관찰사항:**
```typescript
// routes/secrets.ts Line 72
const id = req.params.id as string;  // 타입 캐스팅만, 검증 없음
```

- URL 파라미터를 직접 사용
- UUID 형식 검증 없음
- 특수문자 필터링 없음

**권장 조치:**
```typescript
import { z } from 'zod';

const uuidSchema = z.string().uuid();
const id = uuidSchema.parse(req.params.id);
```

**우선순위:** 🟢 LOW (DB 조회 실패로 자연스럽게 처리됨)

---

### 4. 비밀 관리 (Secrets Management)

#### ✅ 양호한 부분

**4.1 암호화된 시크릿 저장**
- 파일: `/server/src/secrets/local-encrypted-provider.ts`
- AES-256-GCM 사용 (Line 82)
- 인증 태그를 통한 무결성 검증 (Line 84)

```typescript
function encryptValue(masterKey: Buffer, value: string): LocalEncryptedMaterial {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { scheme: "local_encrypted_v1", iv: iv.toString("base64"),
           tag: tag.toString("base64"), ciphertext: ciphertext.toString("base64") };
}
```

**4.2 시크릿 값 SHA-256 해시**
- 시크릿 변경 감지용 해시 저장
- 실제 값은 암호화되어 저장

#### 🔴 HIGH - 긴급 조치 필요

**4.3 환경변수 중복 검증 패턴**
- **파일:** `/server/src/secrets/local-encrypted-provider.ts` (Line 15-16)
- **위치:** Line 15-16

**문제점:**
```typescript
const fromEnv =
  process.env.SQUADRAIL_SECRETS_MASTER_KEY_FILE ??
  process.env.SQUADRAIL_SECRETS_MASTER_KEY_FILE;  // ⚠️ 동일 변수 중복
```

이 패턴이 여러 파일에서 반복됨:
- `config.ts` Line 88, 94, 102 등
- `routes/secrets.ts` Line 18
- `local-encrypted-provider.ts` Line 16, 43

**의도된 것으로 보이는 이유:**
아마도 이전에는 다른 환경변수명(예: `OPENCODE_*`)을 사용했고,
`SQUADRAIL_*`로 마이그레이션하면서 호환성을 위해 두 변수를 체크하려 했으나
리팩토링 과정에서 동일한 변수가 중복된 것으로 추정.

**영향도:**
- 실제 보안 위험은 낮음 (기능적으로 동일)
- 코드 가독성 저하 및 유지보수 혼란

**권장 조치:**
```typescript
// BEFORE
const fromEnv =
  process.env.SQUADRAIL_SECRETS_MASTER_KEY_FILE ??
  process.env.SQUADRAIL_SECRETS_MASTER_KEY_FILE;

// AFTER
const fromEnv = process.env.SQUADRAIL_SECRETS_MASTER_KEY_FILE;
// 또는 레거시 지원이 필요하면
const fromEnv =
  process.env.SQUADRAIL_SECRETS_MASTER_KEY_FILE ??
  process.env.LEGACY_MASTER_KEY_FILE;
```

**우선순위:** 🔴 HIGH (심각도는 낮지만 여러 곳에서 발견되어 즉시 수정 필요)

---

**4.4 마스터 키 자동 생성**
- **파일:** `/server/src/secrets/local-encrypted-provider.ts` (Line 64-74)

**관찰사항:**
```typescript
const generated = randomBytes(32);
writeFileSync(keyPath, generated.toString("base64"),
              { encoding: "utf8", mode: 0o600 });
```

- 키가 없으면 자동 생성
- 파일 권한 0o600 (소유자만 읽기/쓰기)
- 디렉토리는 recursive 생성

**잠재적 위험:**
- 컨테이너 환경에서 ephemeral storage 사용 시 재시작마다 새 키 생성
- 기존 암호화된 시크릿 복호화 불가

**권장 조치:**
- Strict Mode 활성화 시 자동 생성 비활성화
- 프로덕션에서는 외부 KMS 사용 강제

**우선순위:** 🟡 MEDIUM

---

### 5. API 보안

#### ✅ 양호한 부분

**5.1 Rate Limiting**
- 파일: `/server/src/middleware/api-rate-limit.ts`
- 읽기: 3000 req/15분 (Line 4)
- 쓰기: 300 req/15분 (Line 5)
- Actor별 (user/agent) 독립적인 버킷 (Line 17-21)

**5.2 CORS 설정**
- 파일: `/server/src/middleware/api-cors.ts`
- Origin 검증 (Line 49-51)
- Credentials 허용 (Line 39)
- 허용 메서드 제한 (Line 40)
- Custom 헤더: `X-Squadrail-Run-Id` (Line 43)

#### 🟡 MEDIUM - 개선 권장

**5.3 Rate Limit 메모리 누수 위험**
- **파일:** `/server/src/middleware/api-rate-limit.ts` (Line 71-75)

**현재 구현:**
```typescript
if (buckets.size > 2048) {
  for (const [candidateKey, candidate] of buckets.entries()) {
    if (candidate.resetAt <= currentTime) buckets.delete(candidateKey);
  }
}
```

**문제점:**
- 2048개 버킷 초과 시에만 정리
- 많은 unique IP/agent가 있으면 메모리 계속 증가
- 만료된 버킷도 2048개 제한 전까지 보관

**권장 조치:**
```typescript
// 매 요청마다 확률적 정리 (1% 확률)
if (Math.random() < 0.01) {
  const currentTime = now();
  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetAt <= currentTime) buckets.delete(key);
  }
}

// 또는 주기적 정리 타이머 사용
setInterval(() => {
  const currentTime = Date.now();
  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetAt <= currentTime) buckets.delete(key);
  }
}, 60000); // 1분마다
```

**우선순위:** 🟡 MEDIUM

---

**5.4 CORS Origin 동적 허용**
- **파일:** `/server/src/middleware/api-cors.ts` (Line 28-32)

**현재 구현:**
```typescript
const host = req.header("host")?.trim().toLowerCase();
if (host) {
  allowed.add(`http://${host}`);
  allowed.add(`https://${host}`);
}
```

**관찰사항:**
- Host 헤더 기반으로 자동으로 origin 허용
- Host 헤더는 클라이언트가 조작 가능

**잠재적 위험:**
- Host 헤더 인젝션 공격 가능성
- 하지만 `normalizeOrigin()`으로 검증됨 (Line 8-16)

**현재 상태:** ✅ 안전 (URL 파싱으로 검증)

**권장 개선:**
```typescript
// 명시적 allowlist만 허용하도록 변경 권장
const allowed = new Set<string>(parseConfiguredOrigins());
// Host 기반 자동 허용 제거
```

**우선순위:** 🟢 LOW

---

### 6. WebSocket 보안

#### ✅ 양호한 부분

**6.1 WebSocket 인증**
- 파일: `/server/src/realtime/live-events-ws.ts`
- Upgrade 전 인증 검증 (Line 249-257)
- Company ID 기반 접근 제어 (Line 162-164)
- Ping/Pong으로 연결 상태 관리 (Line 190-199)

**6.2 구독 격리**
- Company별로 이벤트 스트림 격리
- Context에 companyId 저장 (Line 202-206)

#### 🔴 HIGH - 이미 언급

**6.3 토큰 노출 위험**
- 섹션 1.4 참조 (WebSocket 쿼리 파라미터)

---

### 7. Agent 실행 보안

#### ✅ 양호한 부분

**7.1 Adapter 격리**
- HTTP Adapter: 외부 HTTP 호출만 (Line 19-27, http/execute.ts)
- Process Adapter: 환경변수 격리 (Line 20-23, process/execute.ts)

**7.2 환경변수 Redaction**
- 파일: `/server/src/adapters/utils.ts` → `@squadrail/adapter-utils`
- 민감 정보 로그 제거 기능 (`redactEnvForLogs`)

**7.3 Process Timeout**
- 파일: `/server/src/adapters/process/execute.ts` (Line 25-26)
- Timeout 설정 (timeoutSec)
- Graceful shutdown 지원 (graceSec)

#### 🟡 MEDIUM - 개선 권장

**7.4 HTTP Adapter SSRF 위험**
- **파일:** `/server/src/adapters/http/execute.ts` (Line 6)

**현재 구현:**
```typescript
const url = asString(config.url, "");
if (!url) throw new Error("HTTP adapter missing url");
// ... 바로 fetch 호출
const res = await fetch(url, { ... });
```

**문제점:**
- URL 검증 없음
- 내부 네트워크 호출 가능 (127.0.0.1, 169.254.169.254 등)
- SSRF (Server-Side Request Forgery) 공격 가능

**권장 조치:**
```typescript
import { parse } from 'url';

function isAllowedUrl(urlString: string): boolean {
  try {
    const parsed = parse(urlString);
    const hostname = parsed.hostname?.toLowerCase();

    // Private IP 차단
    if (hostname === 'localhost' || hostname === '127.0.0.1') return false;
    if (hostname?.startsWith('10.')) return false;
    if (hostname?.startsWith('192.168.')) return false;
    if (hostname?.startsWith('172.')) {
      const octets = hostname.split('.');
      const second = parseInt(octets[1]);
      if (second >= 16 && second <= 31) return false;
    }

    // AWS metadata endpoint 차단
    if (hostname === '169.254.169.254') return false;

    return true;
  } catch {
    return false;
  }
}

const url = asString(config.url, "");
if (!url || !isAllowedUrl(url)) {
  throw new Error("Invalid or disallowed URL");
}
```

**우선순위:** 🟡 MEDIUM
**CVE 참조:** CWE-918 (Server-Side Request Forgery)

---

**7.5 Process Adapter Command Injection**
- **파일:** `/server/src/adapters/process/execute.ts` (Line 14)

**현재 구현:**
```typescript
const command = asString(config.command, "");
const args = asStringArray(config.args);
// ... spawn(command, args) 형태로 실행
```

**현재 상태:** ✅ 안전
- `command`와 `args`를 분리하여 전달
- Shell 없이 직접 실행
- 인자 배열로 전달하여 인젝션 방지

**검증 완료:** Command Injection 위험 없음

---

### 8. 프로토콜 메시지 무결성

#### ✅ 우수한 부분

**8.1 HMAC 기반 무결성 검증**
- 파일: `/server/src/protocol-integrity.ts`
- HMAC-SHA256 서명 (Line 111-113)
- Timing-safe 비교 (Line 115-120)
- Canonical JSON 정규화 (Line 90-105)

```typescript
function signPayload(secret: string, value: string) {
  return createHmac("sha256", secret).update(value).digest("hex");
}

function safeCompareHex(left: string, right: string) {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  if (leftBuffer.length !== rightBuffer.length || leftBuffer.length === 0)
    return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}
```

**8.2 체인 무결성**
- 이전 메시지 서명 포함 (Line 143-144)
- Payload SHA-256 해시 검증 (Line 172-174)
- Tampering 감지 (Line 233-237, 250-254)

**8.3 검증 상태**
- `verified`: 검증 성공
- `legacy_unsealed`: 서명 없음 (하위 호환)
- `tampered`: 무결성 위반
- `unsupported_algorithm`: 알고리즘 불일치

**위험도:** ✅ **없음** - 매우 우수한 구현

---

### 9. 환경 설정 보안

#### ✅ 양호한 부분

**9.1 설정 파일 구조**
- 파일: `/server/src/config.ts`
- 환경변수 우선순위 관리
- Type-safe 설정

**9.2 민감 정보 분리**
- `.env.example`에 실제 값 없음
- OpenAI API Key 플레이스홀더만 존재

#### ⚠️ 관찰사항

**9.3 .env.example 분석**
```bash
DATABASE_URL=postgres://squadrail:squadrail@localhost:5432/squadrail
PORT=3100
SERVE_UI=false
OPENAI_API_KEY=sk-your-openai-api-key-here
```

**현재 상태:** ✅ 안전 (예시 값만 포함)

**권장사항:**
- `.env` 파일이 `.gitignore`에 포함되어 있는지 확인 필요
- 프로덕션 환경에서는 환경변수 주입 사용 권장

---

## 📊 위험도 매트릭스

| 심각도 | 개수 | 항목 |
|--------|------|------|
| 🔴 HIGH | 2 | - WebSocket 쿼리 파라미터 토큰<br>- 환경변수 중복 검증 패턴 |
| 🟡 MEDIUM | 6 | - JWT 시크릿 자동 생성<br>- Better Auth 기본 시크릿<br>- Rate Limit 메모리 관리<br>- 파일 업로드 MIME 검증<br>- HTTP Adapter SSRF<br>- 마스터 키 자동 생성 |
| 🟢 LOW | 3 | - JWT iat 검증<br>- URL 파라미터 검증<br>- CORS 동적 origin |

---

## ✅ OWASP Top 10 (2021) 준수 체크리스트

| # | 항목 | 상태 | 비고 |
|---|------|------|------|
| A01 | Broken Access Control | ⚠️ 부분 | RLS 구현 우수, WebSocket 토큰 개선 필요 |
| A02 | Cryptographic Failures | ⚠️ 부분 | AES-256-GCM 우수, 시크릿 관리 개선 필요 |
| A03 | Injection | ✅ 양호 | Drizzle ORM, Zod 검증 |
| A04 | Insecure Design | ✅ 양호 | Actor 모델, RLS 설계 우수 |
| A05 | Security Misconfiguration | ⚠️ 부분 | 기본 시크릿 제거 필요 |
| A06 | Vulnerable Components | ℹ️ 미검증 | 별도 의존성 스캔 필요 |
| A07 | Auth/AuthN Failures | ⚠️ 부분 | JWT 검증 강화 필요 |
| A08 | Software/Data Integrity | ✅ 우수 | Protocol Integrity 구현 우수 |
| A09 | Logging Failures | ✅ 양호 | Pino 로거 사용 |
| A10 | SSRF | ⚠️ 부분 | HTTP Adapter URL 검증 필요 |

---

## 🛠️ 우선순위별 수정 로드맵

### Phase 1: 긴급 (1주 이내)

1. **WebSocket 토큰 노출 제거**
   - 파일: `server/src/realtime/live-events-ws.ts`
   - 쿼리 파라미터 토큰 지원 제거
   - Authorization 헤더만 허용

2. **환경변수 중복 검증 수정**
   - 파일: `server/src/config.ts`, `server/src/secrets/local-encrypted-provider.ts` 등
   - 모든 중복 `process.env.*` 참조 제거
   - 레거시 변수명 지원이 필요하면 명시적으로 fallback 추가

### Phase 2: 중요 (2주 이내)

3. **JWT/시크릿 관리 강화**
   - `BETTER_AUTH_SECRET` 필수화
   - JWT 시크릿 자동 생성 비활성화 (strict mode)
   - 환경변수 검증 추가

4. **Rate Limiting 메모리 관리**
   - 주기적 정리 메커니즘 추가
   - 메모리 상한선 설정

5. **파일 업로드 검증 강화**
   - `file-type` 라이브러리 추가
   - 매직 넘버 검증

6. **HTTP Adapter SSRF 방어**
   - Private IP 필터링
   - URL allowlist 구현

### Phase 3: 개선 (1개월 이내)

7. **JWT 검증 강화**
   - `iat` 검증 추가
   - Clock skew tolerance 설정

8. **URL 파라미터 검증**
   - UUID 형식 검증 추가
   - Zod 스키마 적용

9. **모니터링 및 로깅**
   - 보안 이벤트 로깅 강화
   - 실패한 인증 시도 추적

### Phase 4: 장기 (3개월 이내)

10. **외부 KMS 통합**
    - AWS Secrets Manager / HashiCorp Vault 지원
    - 자동 키 로테이션

11. **의존성 보안 스캔**
    - `npm audit` 정기 실행
    - Snyk/Dependabot 통합

12. **침투 테스트**
    - 전문 보안 업체 의뢰
    - Bug Bounty 프로그램 고려

---

## 📝 코드 예시 - 주요 수정사항

### 수정 1: WebSocket 토큰 (HIGH)

**파일:** `server/src/realtime/live-events-ws.ts`

```typescript
// BEFORE (Line 105-107)
const queryToken = url.searchParams.get("token")?.trim() ?? "";
const authToken = parseBearerToken(req.headers.authorization);
const token = authToken ?? (queryToken.length > 0 ? queryToken : null);

// AFTER
const token = parseBearerToken(req.headers.authorization);
// 쿼리 파라미터 토큰 완전 제거
// 클라이언트는 반드시 Authorization 헤더 사용
```

### 수정 2: Better Auth 시크릿 (MEDIUM)

**파일:** `server/src/auth/better-auth.ts`

```typescript
// BEFORE (Line 47-51)
const secret =
  process.env.BETTER_AUTH_SECRET ??
  process.env.SQUADRAIL_AGENT_JWT_SECRET ??
  "squadrail-dev-secret";

// AFTER
const secret = process.env.BETTER_AUTH_SECRET
  ?? process.env.SQUADRAIL_AGENT_JWT_SECRET;

if (!secret) {
  if (config.deploymentMode === 'authenticated') {
    throw new Error(
      'BETTER_AUTH_SECRET must be set in authenticated deployment mode'
    );
  }
  // local_trusted 모드에서만 기본값 허용
  return "squadrail-dev-secret-local-only";
}
```

### 수정 3: HTTP Adapter SSRF 방어 (MEDIUM)

**파일:** `server/src/adapters/http/execute.ts`

```typescript
// 파일 상단에 추가
function isPrivateIP(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '127.0.0.1') return true;
  if (hostname.startsWith('10.')) return true;
  if (hostname.startsWith('192.168.')) return true;
  if (hostname.startsWith('172.')) {
    const second = parseInt(hostname.split('.')[1]);
    if (second >= 16 && second <= 31) return true;
  }
  if (hostname === '169.254.169.254') return true; // AWS metadata
  return false;
}

function validateUrl(urlString: string): void {
  const url = new URL(urlString);

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only HTTP/HTTPS protocols allowed');
  }

  if (isPrivateIP(url.hostname)) {
    throw new Error('Private IP addresses not allowed');
  }
}

// Line 6-7 수정
const url = asString(config.url, "");
if (!url) throw new Error("HTTP adapter missing url");
validateUrl(url); // 추가
```

---

## 🔒 보안 강화 권장사항

### 일반 권장사항

1. **환경 분리**
   - 개발/스테이징/프로덕션 환경 명확히 분리
   - 각 환경별 독립적인 시크릿 사용

2. **시크릿 로테이션**
   - JWT 시크릿 정기 교체 (분기별)
   - API Key 만료 정책 설정

3. **모니터링**
   - 실패한 인증 시도 알림
   - Rate limit 초과 모니터링
   - 비정상 WebSocket 연결 패턴 감지

4. **정기 감사**
   - 분기별 보안 코드 리뷰
   - 연간 침투 테스트
   - 의존성 취약점 스캔 (매주)

### 프로덕션 체크리스트

- [ ] `BETTER_AUTH_SECRET` 설정됨
- [ ] `SQUADRAIL_AGENT_JWT_SECRET` 설정됨 (32바이트 이상)
- [ ] `SQUADRAIL_SECRETS_MASTER_KEY_FILE` 또는 외부 KMS 설정
- [ ] `.env` 파일 `.gitignore`에 포함
- [ ] HTTPS 강제 (프록시 레벨)
- [ ] Rate limiting 활성화
- [ ] RLS 활성화 (`enabled: true`)
- [ ] 로그에 민감 정보 없음 확인
- [ ] CORS origin allowlist 설정
- [ ] WebSocket Authorization 헤더만 사용

---

## 📚 참고 자료

- [OWASP Top 10 (2021)](https://owasp.org/Top10/)
- [CWE Top 25](https://cwe.mitre.org/top25/)
- [Node.js Security Best Practices](https://nodejs.org/en/docs/guides/security/)
- [PostgreSQL Row-Level Security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)

---

## 결론

SquadRail 백엔드는 **전반적으로 양호한 보안 수준**을 보여줍니다.

**강점:**
- ✅ SQL Injection 방어 (Drizzle ORM)
- ✅ RLS 구현 (데이터 격리)
- ✅ Protocol Integrity (HMAC 체인)
- ✅ 입력 검증 (Zod)
- ✅ 암호화 (AES-256-GCM)

**개선 필요:**
- 🔴 WebSocket 토큰 노출
- 🔴 환경변수 중복 참조
- 🟡 시크릿 관리 강화
- 🟡 SSRF 방어

**권장 조치:** Phase 1-2 항목을 2주 이내 완료하여 HIGH/MEDIUM 위험 제거

---

**감사자:** Claude Opus 4.6 (Application Security Specialist)
**보고서 버전:** 1.0
**다음 감사 예정일:** 2026-06-09 (3개월 후)
