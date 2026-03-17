export const BURN_IN_BATCH_SCENARIOS = {
  batch1: [
    "swiftsight-agent-tl-qa-loop",
    "swiftsight-cloud-pm-tl-review-loop",
    "swiftsight-cloud-pm-tl-change-recovery-loop",
    "swiftcl-cto-cross-project-loop",
    "multi-project-coordinated-delivery",
    "swiftsight-worker-codex-clone-isolation",
  ],
};

export function parseScenarioSelection(input) {
  const raw = typeof input === "string" ? input.trim() : "";
  if (!raw) return [];

  if (raw in BURN_IN_BATCH_SCENARIOS) {
    return [...BURN_IN_BATCH_SCENARIOS[raw]];
  }

  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}
