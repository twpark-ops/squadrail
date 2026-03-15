# E2E Scripts

- `full-delivery.mjs`: boots a temporary Squadrail instance, creates a temporary git fixture repo, and verifies the full delivery loop through issue closure.
- `cloud-swiftsight-real-org.mjs`: deterministic kernel burn-in entrypoint for the cloud-swiftsight canonical org model. Use this when validating the lower delivery kernel against the full scripted org roster.
- `cloud-swiftsight-burn-in.mjs`: deterministic kernel burn-in batch runner. It cleans lingering tagged issues, runs the scripted scenario batch, and emits an enriched summary.
- `cloud-swiftsight-autonomy-org.mjs`: Phase 7 bounded autonomy baseline harness for `intake -> projection preview/apply -> ACK_ASSIGNMENT -> START_IMPLEMENTATION -> ESCALATE_BLOCKER -> ASK_CLARIFICATION -> ANSWER_CLARIFICATION -> review -> QA -> CLOSE_TASK` invariants, with clarification ask/answer/resume driven through the runtime helper contract instead of direct protocol API shortcuts.
- `cloud-swiftsight-autonomy-burn-in.mjs`: bounded autonomy matrix runner. It executes the baseline, multi-child coordination, and reviewer clarification policy variants sequentially and emits a consolidated summary.
- `cloud-swiftsight-rag-readiness.mjs`: readiness gate for knowledge sync / retrieval quality before higher-level PM/domain evaluation.
- `cloud-swiftsight-domain-aware-pm-eval.mjs`: single-scenario domain-aware PM harness. It creates a PM intake issue, previews PM projection, scores preview correctness, then applies the same preview draft into a bounded delivery loop and scores delivery completion. `cloud-swiftsight` is the current validation fixture, not a product-specific scoring shortcut.
- `cloud-swiftsight-domain-aware-pm-burn-in.mjs`: runs the domain-aware PM scenarios sequentially and emits preview/delivery/overall score summaries. The target is generic project-selection behavior driven by knowledge tags and boundary metadata.
- `cloud-swiftsight-summary-layer-proof.mjs`: compares the frozen Phase 0 domain-aware PM baseline artifact with the current summary-enabled matrix output and optionally attaches the current rag-readiness gate summary.

## Execution Split

- `kernel burn-in`
  - purpose: deterministic lower-kernel regression on the canonical cloud-swiftsight org model
  - primary command: `pnpm e2e:cloud-swiftsight-kernel-burn-in`
  - current policy: default kernel burn-in keeps bounded board recovery enabled for stale manager reroute drift so the canonical scripted batch remains operationally useful
  - strict command: `pnpm e2e:cloud-swiftsight-kernel-burn-in:strict`
  - strict policy: disables implementation recovery and fails fast on ownership drift instead of healing it
- `autonomy baseline`
  - purpose: validate a single bounded autonomy delivery loop on top of PM intake projection
  - primary command: `pnpm e2e:cloud-swiftsight-autonomy-org`
- `autonomy matrix`
  - purpose: validate bounded autonomy variants, including multi-child coordination and reviewer-targeted clarification policy
  - primary command: `pnpm e2e:cloud-swiftsight-autonomy-burn-in`
- `rag readiness`
  - purpose: validate that knowledge setup and retrieval quality are at least good enough to interpret project affinity and review scope
  - primary command: `pnpm e2e:cloud-swiftsight-rag-readiness`
- `domain-aware PM baseline`
  - purpose: validate whether PM projection can map a short but domain-heavy request into the right project lane and execution shape, then carry the same draft through bounded delivery
  - note: the validation fixture is currently `cloud-swiftsight`, but the scoring contract is expected to stay company-agnostic
  - primary command: `pnpm e2e:cloud-swiftsight-domain-aware-pm-eval`
- `domain-aware PM matrix`
  - purpose: run multiple domain-heavy PM evaluation scenarios in sequence and compare preview/delivery/overall score drift before/after RAG improvements
  - note: use this to validate generic PM/RAG behavior against a real domain fixture, not to justify company-name heuristics
  - primary command: `pnpm e2e:cloud-swiftsight-domain-aware-pm-burn-in`
- `summary-layer proof`
  - purpose: compare the frozen baseline artifact against the current summary-enabled PM matrix and emit a structured diff report
  - note: this is the Phase 4 proof runner, not the final Phase 5 live gate
  - primary command: `pnpm e2e:cloud-swiftsight-summary-layer-proof`
