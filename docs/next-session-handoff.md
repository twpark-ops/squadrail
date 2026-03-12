# Next Session Handoff

## Start Here

Open this file first, then read these in order:

1. [next-session-handoff.md](/home/taewoong/company-project/squadall/docs/next-session-handoff.md)
2. [backend-post-phase-plan.md](/home/taewoong/company-project/squadall/docs/backend-post-phase-plan.md)
3. [run-first-burn-in-priority-plan.md](/home/taewoong/company-project/squadall/docs/run-first-burn-in-priority-plan.md)
4. [summary.md](/home/taewoong/company-project/squadall/memory-bank/projects/squadall-run-first/summary.md)

One-line startup rule:

- open this handoff first, then start immediately with `rerank provider abstraction` phase 2

Current HEAD:

- `163a444` `feat(retrieval): consolidate cache provenance trends`
- working tree includes uncommitted `cross-issue memory reuse` + E2E harness/protocol fixes validated in burn-in

## Current Product State

- `root CLO 1개 -> hidden child work item fan-out -> multi-project parallel execution -> reviewer -> QA -> done` 검증 완료
- `Human -> PM intake`, `PM projection`, `QA separate gate`, `organizational memory ingest` 완료
- `cross-issue memory reuse` 완료
- `fast / normal / deep` execution lane classifier 완료
- `issue routes split` 1차 완료
- `issue-retrieval` helper extraction 1차 완료
- `knowledge-setup` read-model cache 1차 완료
- `PR verify / release workflow` 추가 완료
- `18-agent real-org burn-in batch1` 완료
  - `CLO-204`~`CLO-207`: `done`
  - coordinated root `CLO-208`: child fan-out 후 의도대로 `cancelled`
  - child `CLO-209`~`CLO-211`: reviewer/QA 포함 `done`

## Next Backend Priorities

Order:

1. `rerank provider abstraction` phase 2
2. `execution lane / fast lane` operational instrumentation

Interpretation:

- next focus is not new protocol/kernel work
- next focus is retrieval/ops quality stabilization after org-memory reuse completion

## Recommended First Task Next Session

`cross-issue memory reuse`와 `18-agent burn-in`은 완료됐다.

Start with `rerank provider abstraction` phase 2.

Suggested slice:

1. ordered provider chain config 해석 추가
2. timeout / 429 / 5xx / malformed response failure taxonomy 정리
3. `rerankProviderAttempted`, `rerankProviderUsed`, `rerankFallbackReason` surface 추가
4. fallback tests 추가
5. update memory-bank summary

## Important Files

Rerank / retrieval:

- [config.ts](/home/taewoong/company-project/squadall/server/src/services/knowledge-rerank/config.ts)
- [providers.ts](/home/taewoong/company-project/squadall/server/src/services/knowledge-rerank/providers.ts)
- [knowledge-reranking.ts](/home/taewoong/company-project/squadall/server/src/services/knowledge-reranking.ts)
- [issue-retrieval.ts](/home/taewoong/company-project/squadall/server/src/services/issue-retrieval.ts)
- [knowledge.ts](/home/taewoong/company-project/squadall/server/src/services/knowledge.ts)
- [knowledge-reranking.test.ts](/home/taewoong/company-project/squadall/server/src/__tests__/knowledge-reranking.test.ts)

Planning / memory:

- [backend-post-phase-plan.md](/home/taewoong/company-project/squadall/docs/backend-post-phase-plan.md)
- [run-first-burn-in-priority-plan.md](/home/taewoong/company-project/squadall/docs/run-first-burn-in-priority-plan.md)
- [summary.md](/home/taewoong/company-project/squadall/memory-bank/projects/squadall-run-first/summary.md)
- [backend-next-priority-detailed-plan.md](/home/taewoong/company-project/squadall/docs/backend-next-priority-detailed-plan.md)

## Do Not Touch

These are unrelated local changes:

- [README.md](/home/taewoong/company-project/squadall/memory-bank/README.md)
- [squadall-ui-only-followup](/home/taewoong/company-project/squadall/memory-bank/projects/squadall-ui-only-followup/)

## Validation Commands

Run after backend changes:

```bash
pnpm -r typecheck
pnpm test:run
pnpm build
```

For targeted rerank work:

```bash
pnpm vitest run server/src/__tests__/knowledge-reranking.test.ts
```

If protocol helper or burn-in harness changes again:

```bash
pnpm vitest run server/src/__tests__/protocol-helper-cli.test.ts
node --check scripts/e2e/cloud-swiftsight-real-org.mjs
SQUADRAIL_BASE_URL=http://127.0.0.1:3144 pnpm e2e:cloud-swiftsight-burn-in
```

Suggested order for rerank-only edits:

1. run the focused rerank Vitest command first
2. then run `pnpm -r typecheck`
3. then run `pnpm test:run`
4. then run `pnpm build`

## Product Direction Reminder

- product direction is `standardized software delivery org kernel`
- not arbitrary workflow builder
- `peer mode` is deferred optional feature, not current priority
