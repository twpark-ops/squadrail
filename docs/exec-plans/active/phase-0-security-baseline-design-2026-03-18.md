---
title: "Phase 0 Security Baseline Design"
author: "Taewoong Park (park.taewoong@airsmed.com)"
date: "2026-03-18"
lang: "ko"
CJKmainfont: "Noto Sans CJK KR"
mainfont: "Noto Sans"
---

# 목적

이 문서는 canonical stabilization sprint의 선행 조건인 `Phase 0. Security Baseline`의
상세 설계를 다룬다.

이번 배치의 목표는 다음 네 가지다.

1. hardcoded auth secret 제거
2. email verification을 하드코딩된 비활성화 상태에서 설정 기반으로 전환
3. issue document body size limit 추가
4. deliverables route를 company-scoped 경로와 authorization 기준으로 정렬

이번 문서는 **즉시 구현 범위**와 **후속 의존 범위**를 분리해서 기록한다.

# 현재 상태

## 인증

- `server/src/auth/better-auth.ts`는 secret fallback으로 `"squadrail-dev-secret"`를 사용한다.
- 같은 파일에서 `requireEmailVerification: false`가 하드코딩되어 있다.
- `server/src/index.ts`는 authenticated mode에서 secret 존재만 확인하고, email verification policy는 확인하지 않는다.
- `ui/src/pages/Auth.tsx`는 “Email confirmation is not required in v1.”라고 명시한다.

## 문서 라우트

- `server/src/routes/issues/documents-routes.ts`는 body에 upper bound가 없다.
- 큰 payload가 들어오면 route/service/database까지 불필요하게 비용을 태울 수 있다.

## deliverables 라우트

- `server/src/routes/issues/deliverables-routes.ts`는 `/issues/:id/deliverables` 경로만 사용한다.
- authorization 자체는 `issue.companyId` 기준으로 검사하지만, documents/doc comments/attachments와 달리
  company-scoped route shape를 따르지 않는다.
- UI API도 현재 issue-global path만 사용한다.

# 설계 결정

## D1. Better Auth secret은 하드코딩 fallback 없이 외부 주입만 허용

### 결정

- `createBetterAuthInstance()`는 더 이상 하드코딩 fallback을 사용하지 않는다.
- secret 해석은 `BETTER_AUTH_SECRET` 또는 `SQUADRAIL_AGENT_JWT_SECRET`만 허용한다.
- 값이 없으면 명시적으로 실패한다.

### 이유

- 인증 secret은 테스트 편의를 위해 묵시적 기본값을 두면 안 된다.
- 이미 `server/src/index.ts`도 authenticated mode에서 secret 존재를 요구한다.
- helper 레벨에서도 같은 계약을 갖는 편이 일관된다.

## D2. Email verification은 “하드코딩 off” 대신 “설정 기반 정책”으로 바꾼다

### 결정

- shared config와 server config에 `auth.requireEmailVerification` 필드를 추가한다.
- `createBetterAuthInstance()`는 이 설정을 사용해 `requireEmailVerification`을 채운다.
- UI copy는 “v1에서 필요 없음” 같은 단정 문구를 제거한다.

### 이번 배치의 한계

- 현재 코드베이스에는 실제 outbound verification mail transport가 없다.
- 따라서 이번 배치에서 email verification을 **완전한 end-to-end 사용자 기능**으로 닫지는 않는다.
- 이번 배치는 다음까지를 목표로 한다.
  - 정책을 하드코딩이 아니라 설정으로 승격
  - 보안 posture를 숨기지 않음
  - 후속 mail transport가 붙을 자리 확보

### 이유

- 지금 상태는 “끄기로 고정”돼 있어 보안 의도 자체를 코드가 부정한다.
- 반면 즉시 강제 활성화하면 mail transport 부재로 실제 signup/signin 플로우를 깨뜨릴 수 있다.
- 따라서 이번 배치에서는 **정책을 코드상 외부화**하는 것이 현실적이고 안전하다.

## D3. Issue document body는 route 레벨에서 크기 제한

### 결정

- `config.issueDocumentMaxBodyChars`를 추가한다.
- 기본값은 `200_000` 문자로 둔다.
- `documents-routes.ts`의 request schema가 이 상한을 사용하게 한다.

### 이유

- body 제한은 service보다 route에서 막는 것이 비용과 오류 표면이 작다.
- title은 이미 500자로 제한돼 있으므로 body도 비슷하게 upper bound를 명시하는 편이 낫다.
- char limit은 markdown/plain text document 현실 범위와 구현 난이도를 같이 고려한 절충값이다.

## D4. Deliverables는 company-scoped route를 1급 경로로 승격

### 결정

- 새 canonical route를 추가한다.
  - `GET /companies/:companyId/issues/:issueId/deliverables`
- 기존 `/issues/:id/deliverables`는 호환성 때문에 유지한다.
- UI는 company-scoped route를 우선 사용한다.
- route helper는 공통 handler로 묶어서 결과를 동일하게 유지한다.

### 이유

- documents/attachments와 route shape가 맞아야 권한과 경계가 읽기 쉽다.
- 기존 경로를 바로 없애면 회귀 위험이 있으므로 alias migration으로 간다.

# 구현 계획

## 1. Config / schema

- `packages/shared/src/config-schema.ts`
  - `auth.requireEmailVerification: boolean`
  - `auth.issueDocumentMaxBodyChars`는 auth가 아니라 상위 config에 두지 않고 server runtime config에 추가
- `server/src/config.ts`
  - `authRequireEmailVerification`
  - `issueDocumentMaxBodyChars`
- `server/src/__tests__/config-service.test.ts`
  - 기본값 / env override 회귀

## 2. Better Auth

- `server/src/auth/better-auth.ts`
  - secret resolver helper 추가
  - 하드코딩 fallback 제거
  - `requireEmailVerification`을 config 값으로 연결
- `server/src/__tests__/better-auth.test.ts`
  - secret missing 시 throw
  - explicit secret 사용
  - email verification 설정 반영

## 3. Documents route

- `server/src/routes/issues/documents-routes.ts`
  - `buildUpsertDocumentBodySchema(maxChars)` 형태로 변경
  - max 초과 시 422
- 신규 route test 추가
  - oversize body reject
  - normal body accept

## 4. Deliverables route / UI

- `server/src/routes/issues/deliverables-routes.ts`
  - company-scoped route 추가
  - 공통 handler로 결과 일원화
  - `issue.companyId !== companyId`면 404
- `server/src/__tests__/issue-deliverables.test.ts`
  - 새 route path 추가 검증
  - company mismatch 검증
- `ui/src/api/issues.ts`
  - `deliverables(issueId, companyId?)`
- `ui/src/pages/IssueDetail.tsx`
  - company-scoped 호출로 전환

## 5. Auth UI copy

- `ui/src/pages/Auth.tsx`
  - “Email confirmation is not required in v1.” 문구 제거
  - instance policy neutral copy로 변경

# 테스트 전략

## Unit / focused integration

- `server/src/__tests__/better-auth.test.ts`
- `server/src/__tests__/config-service.test.ts`
- `server/src/__tests__/issue-deliverables.test.ts`
- 신규 `documents route` focused test

## Typecheck

- `pnpm --filter @squadrail/server typecheck`
- `pnpm --filter @squadrail/ui typecheck`

## Regression smoke

- deliverables 탭 진입
- documents 탭 저장/수정
- auth page copy regression

# 완료 기준

1. hardcoded auth secret 제거
2. email verification이 하드코딩 off가 아니라 config-driven
3. oversize issue document body가 route에서 거부
4. deliverables가 company-scoped route로도 제공되고 UI가 그 경로를 사용
5. 관련 focused tests와 typecheck green
6. `better-auth`, `config-service`, `documents route`, `deliverables route` focused tests가 모두 green

# 후속 작업

이번 배치 후 바로 이어져야 하는 항목은 다음이다.

1. verification mail transport 설계/구현
2. authenticated public exposure에서 verification policy 강제 조건 확정
3. `Phase 1 Fresh DB Bootstrap`에서 retrieval plan과 결합
