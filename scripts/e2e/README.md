# E2E Scripts

- `full-delivery.mjs`: boots a temporary Squadrail instance, creates a temporary git fixture repo, and verifies the full delivery loop through issue closure.
- `cloud-swiftsight-real-org.mjs`: deterministic kernel burn-in for the cloud-swiftsight org model.
- `cloud-swiftsight-autonomy-org.mjs`: Phase 7 bounded autonomy burn-in for `intake -> projection preview/apply -> ACK_ASSIGNMENT -> START_IMPLEMENTATION -> ESCALATE_BLOCKER -> ASK_CLARIFICATION -> ANSWER_CLARIFICATION -> review -> QA -> CLOSE_TASK` invariants.
