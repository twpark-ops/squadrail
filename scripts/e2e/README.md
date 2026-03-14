# E2E Scripts

- `full-delivery.mjs`: boots a temporary Squadrail instance, creates a temporary git fixture repo, and verifies the full delivery loop through issue closure.
- `cloud-swiftsight-real-org.mjs`: deterministic kernel burn-in entrypoint for the cloud-swiftsight canonical org model. Use this when validating the lower delivery kernel against the full scripted org roster.
- `cloud-swiftsight-burn-in.mjs`: deterministic kernel burn-in batch runner. It cleans lingering tagged issues, runs the scripted scenario batch, and emits an enriched summary.
- `cloud-swiftsight-autonomy-org.mjs`: Phase 7 bounded autonomy baseline harness for `intake -> projection preview/apply -> ACK_ASSIGNMENT -> START_IMPLEMENTATION -> ESCALATE_BLOCKER -> ASK_CLARIFICATION -> ANSWER_CLARIFICATION -> review -> QA -> CLOSE_TASK` invariants, with clarification ask/answer/resume driven through the runtime helper contract instead of direct protocol API shortcuts.
- `cloud-swiftsight-autonomy-burn-in.mjs`: bounded autonomy matrix runner. It executes the baseline, multi-child coordination, and reviewer clarification policy variants sequentially and emits a consolidated summary.

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
