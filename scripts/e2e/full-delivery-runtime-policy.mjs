function readPositiveInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

export function resolveFullDeliveryRuntimePolicy(env = process.env) {
  const isCi = env.CI === "1" || env.CI === "true";

  return {
    e2eTimeoutMs: readPositiveInt(env.E2E_TIMEOUT_MS, isCi ? 15 * 60 * 1000 : 8 * 60 * 1000),
    pollIntervalMs: readPositiveInt(env.E2E_POLL_INTERVAL_MS, 4_000),
    healthTimeoutMs: readPositiveInt(env.E2E_HEALTH_TIMEOUT_MS, 60_000),
    healthRetryMs: readPositiveInt(env.E2E_HEALTH_RETRY_MS, 1_000),
    closeFollowupTimeoutMs: readPositiveInt(
      env.E2E_CLOSE_FOLLOWUP_TIMEOUT_MS,
      isCi ? 45_000 : 30_000,
    ),
    keepTemp: env.E2E_KEEP_TEMP === "1",
  };
}

export function classifyFullDeliveryTimeoutAxis(workflowState) {
  switch (workflowState) {
    case "assigned":
    case "accepted":
      return "staffing";
    case "implementing":
    case "blocked":
      return "implementation";
    case "submitted_for_review":
    case "under_review":
    case "changes_requested":
      return "review";
    case "qa_pending":
    case "under_qa_review":
      return "qa";
    case "approved":
      return "closure";
    case "done":
      return "completed";
    default:
      return "unknown";
  }
}
