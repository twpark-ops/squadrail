---
title: "P3 Runtime Review Hardening Plan"
owner: "taewoong"
status: "completed"
last-reviewed: "2026-03-20"
author: "Taewoong Park (park.taewoong@airsmed.com)"
date: "2026-03-20"
lang: "ko"
CJKmainfont: "Noto Sans CJK KR"
mainfont: "Noto Sans"
---

# Goal

최근 리뷰에서 드러난 런타임/캐시/E2E 인프라 hardening 항목 중, 제품 계약을 직접 흔들 수 있는 중간 크기 debt를 줄인다.

# Scope

## In

- retrieval reviewer cache의 future revision reuse 차단
- knowledge sync orphan resume 중복 실행 방지
- knowledge sync failure summary persistence 에러 로깅
- protocol idle watchdog cleanup / backoff 일관성 정리
- config env alias 중복 호출 정리

## Out

- live-model E2E를 mock/stub으로 치환하는 구조 변경
- provider/runtime degraded debt 자체 제거
- 새로운 UI surface 추가

# Design

1. reviewer cache reuse는 현재 revision 이하의 entry만 허용한다.
2. knowledge sync resume는 `active`와 별도로 `scheduled` 집합을 둬 TOCTOU를 막는다.
3. fire-and-forget failure path는 summary update 실패를 별도 로그로 남긴다.
4. idle watchdog은 지수 backoff와 explicit clear를 같이 가져간다.
5. config env helper는 helper level에서 duplicate alias를 dedupe하고, boolean env parsing을 공용화한다.

# Validation

- `pnpm --filter @squadrail/server exec vitest run src/__tests__/knowledge-service-cache.test.ts src/__tests__/knowledge-setup-service.test.ts src/__tests__/config-service.test.ts src/__tests__/heartbeat-protocol-progress.test.ts`
- `pnpm --filter @squadrail/server typecheck`
- `pnpm docs:check`

# Status

- current batch implementation in progress
- live-model mock/stub은 별도 slice로 유지
