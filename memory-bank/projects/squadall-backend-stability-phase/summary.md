# Squadall Backend Stability Phase

## 목표
- 서버 테스트 하네스 정리
- `issue-retrieval.ts` 분해 시작
- `issues` 라우트 분리 컨텍스트 타입 강화
- cross-issue retrieval reuse 1차 도입
- 서버 테스트/커버리지 실행 경로 고정

## 이번 세션 결과
- `server/vitest.config.ts`에 서버 루트와 테스트 include/coverage 설정을 추가해 `.paperclip` 오염 없이 서버 테스트만 실행되도록 정리했다.
- `protocol-helper-cli.test.ts`, `codex-local-execute.test.ts`의 경로 가정을 루트 기준 실제 경로로 고쳤다.
- `server/src/services/retrieval/query.ts`, `server/src/services/retrieval/quality.ts`를 신설하고 `issue-retrieval.ts`에서 query construction / reuse quality 계산 로직을 분리했다.
- retrieval signals에 `relatedIssueIds`를 포함하고, graph seed / scoring / cache identity까지 cross-issue reuse 힌트를 반영했다.
- `server/src/routes/issues/context.ts`를 실사용 subset 타입으로 재작성하고 split subroute 등록 지점에 typed context를 적용했다.
- PM intake cleanup 실패 경로에서 잘못된 helper 호출을 제거하고 activity log 기반으로 정리했다.
- knowledge retrieval 품질 집계에 reuse 지표를 노출하도록 확장했다.
- `@vitest/coverage-v8`를 서버 devDependency에 추가하고 `test`, `test:coverage` 스크립트를 만들었다.

## 테스트 보강
- 추가 테스트 파일
  - `server/src/__tests__/retrieval-query.test.ts`
  - `server/src/__tests__/retrieval-quality.test.ts`
  - `server/src/__tests__/retrieval-shared.test.ts`
- 기존 테스트 보강
  - `server/src/__tests__/issue-retrieval.test.ts`
  - `server/src/__tests__/retrieval-cache.test.ts`
  - `server/src/__tests__/knowledge-quality-trend.test.ts`

## 검증 결과
- `pnpm --filter @squadrail/server typecheck` 통과
- `pnpm --filter @squadrail/server build` 통과
- `pnpm --filter @squadrail/server test` 통과
- `pnpm --filter @squadrail/server test:coverage` 통과
- 전체 테스트: `72 files`, `473 tests` 통과
- 서버 전체 coverage:
  - statements `31.19%`
  - branches `64.91%`
  - functions `61.53%`
  - lines `31.19%`

## 판단
- 이번 변경 범위 파일의 커버리지는 직접 올렸지만, 서버 전체 커버리지는 기존 미테스트 entrypoint / route / service 파일이 많아서 아직 낮다.
- 즉 이번 작업은 "이번 범위 안정화"는 끝났고, "서버 전체 60%+"는 별도 대형 테스트 라운드가 필요하다.

## 다음 백엔드 우선순위
1. `heartbeat.ts`와 `issue-retrieval.ts`의 추가 분해를 이어간다.
2. `agents.ts`, `approvals.ts`, `knowledge.ts` 같은 대형 route/service의 직접 테스트를 늘린다.
3. coverage를 파일군 단위 목표로 끌어올린다.
