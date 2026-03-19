#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ITERATIONS="${ITERATIONS:-3}"

run_step() {
  local label="$1"
  shift
  printf '\n==> [%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$label"
  "$@"
}

cd "$REPO_ROOT"

for iteration in $(seq 1 "$ITERATIONS"); do
  printf '\n########################################\n'
  printf '## Canonical repeat iteration %s/%s\n' "$iteration" "$ITERATIONS"
  printf '########################################\n'

  run_step "scenario 1 + 5 / full delivery" pnpm e2e:full-delivery
  run_step "scenario 2 / clarification loop" env SWIFTSIGHT_PM_EVAL_SCENARIO=workflow_mismatch_diagnostics SWIFTSIGHT_PM_EVAL_CLEANUP=1 pnpm e2e:cloud-swiftsight-domain-aware-pm-eval
  run_step "scenario 2 guard / no unexpected clarification" env SWIFTSIGHT_PM_EVAL_SCENARIO=siemens_series_name_cloud_routing SWIFTSIGHT_PM_EVAL_CLEANUP=1 pnpm e2e:cloud-swiftsight-domain-aware-pm-eval
  run_step "scenario 3 / change recovery" env SWIFTSIGHT_E2E_SCENARIO=swiftsight-cloud-pm-tl-change-recovery-loop pnpm e2e:cloud-swiftsight-real-org
  run_step "scenario 4 / QA gate" env SWIFTSIGHT_E2E_SCENARIO=swiftsight-agent-tl-qa-loop pnpm e2e:cloud-swiftsight-real-org
done

printf '\n==> canonical repeat validation completed (%s iteration(s))\n' "$ITERATIONS"
