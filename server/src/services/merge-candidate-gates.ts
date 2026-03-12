import type {
  IssueMergeCandidateCheck,
  IssueMergeCandidateCheckSummary,
  IssueMergeCandidateGateStatus,
  IssueMergeCandidatePrBridge,
} from "@squadrail/shared";

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readBoolean(value: unknown) {
  return value === true;
}

function normalizeDate(value: unknown) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeCheckStatus(value: unknown): IssueMergeCandidateCheck["status"] {
  const normalized = readString(value)?.toLowerCase();
  switch (normalized) {
    case "queued":
    case "pending":
    case "running":
    case "success":
    case "failure":
    case "error":
    case "cancelled":
    case "skipped":
    case "neutral":
      return normalized;
    default:
      return "unknown";
  }
}

function computeCheckSummary(checks: IssueMergeCandidateCheck[]): IssueMergeCandidateCheckSummary {
  const summary: IssueMergeCandidateCheckSummary = {
    total: checks.length,
    passing: 0,
    failing: 0,
    pending: 0,
    requiredTotal: 0,
    requiredPassing: 0,
    requiredFailing: 0,
    requiredPending: 0,
  };

  for (const check of checks) {
    const isPassing = check.status === "success" || check.status === "neutral" || check.status === "skipped";
    const isFailing = check.status === "failure" || check.status === "error" || check.status === "cancelled";
    const isPending = check.status === "queued" || check.status === "pending" || check.status === "running" || check.status === "unknown";

    if (isPassing) summary.passing += 1;
    if (isFailing) summary.failing += 1;
    if (isPending) summary.pending += 1;

    if (check.required) {
      summary.requiredTotal += 1;
      if (isPassing) summary.requiredPassing += 1;
      if (isFailing) summary.requiredFailing += 1;
      if (isPending) summary.requiredPending += 1;
    }
  }

  return summary;
}

function normalizeChecks(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const record = asRecord(entry);
      const name = readString(record.name);
      if (!name) return null;
      return {
        name,
        status: normalizeCheckStatus(record.status),
        conclusion: readString(record.conclusion),
        summary: readString(record.summary),
        detailsUrl: readString(record.detailsUrl),
        required: readBoolean(record.required),
      } satisfies IssueMergeCandidateCheck;
    })
    .filter((entry): entry is IssueMergeCandidateCheck => Boolean(entry));
}

function normalizeMergeability(value: unknown): IssueMergeCandidatePrBridge["mergeability"] {
  const normalized = readString(value)?.toLowerCase();
  switch (normalized) {
    case "mergeable":
    case "conflicting":
    case "blocked":
      return normalized;
    default:
      return "unknown";
  }
}

function normalizePrState(value: unknown): IssueMergeCandidatePrBridge["state"] {
  const normalized = readString(value)?.toLowerCase();
  switch (normalized) {
    case "draft":
    case "open":
    case "merged":
    case "closed":
      return normalized;
    default:
      return "unknown";
  }
}

export function buildMergeCandidatePrBridge(input: {
  automationMetadata: Record<string, unknown> | null | undefined;
  remoteUrl?: string | null;
}): IssueMergeCandidatePrBridge | null {
  const metadata = asRecord(input.automationMetadata);
  const prBridge = asRecord(metadata.prBridge);
  const provider = readString(prBridge.provider);
  if (provider !== "github" && provider !== "gitlab") return null;

  const checks = normalizeChecks(prBridge.checks);
  const normalized: IssueMergeCandidatePrBridge = {
    provider,
    repoOwner: readString(prBridge.repoOwner) ?? "",
    repoName: readString(prBridge.repoName) ?? "",
    repoUrl: readString(prBridge.repoUrl),
    remoteUrl: readString(prBridge.remoteUrl) ?? readString(input.remoteUrl),
    number: readNumber(prBridge.number),
    externalId: readString(prBridge.externalId),
    url: readString(prBridge.url),
    title: readString(prBridge.title),
    state: normalizePrState(prBridge.state),
    mergeability: normalizeMergeability(prBridge.mergeability),
    headBranch: readString(prBridge.headBranch),
    baseBranch: readString(prBridge.baseBranch),
    headSha: readString(prBridge.headSha),
    reviewDecision: readString(prBridge.reviewDecision),
    commentCount: readNumber(prBridge.commentCount) ?? 0,
    reviewCommentCount: readNumber(prBridge.reviewCommentCount) ?? 0,
    lastSyncedAt: normalizeDate(prBridge.lastSyncedAt),
    checks,
    checkSummary: computeCheckSummary(checks),
  };

  if (!normalized.repoOwner || !normalized.repoName) return null;
  return normalized;
}

export function buildMergeCandidateGateStatus(input: {
  prBridge: IssueMergeCandidatePrBridge | null;
}): IssueMergeCandidateGateStatus | null {
  if (!input.prBridge) return null;

  const blockingReasons: string[] = [];
  const summary = input.prBridge.checkSummary;
  const requiredChecksConfigured = summary.requiredTotal > 0;
  const failingChecks = requiredChecksConfigured ? summary.requiredFailing : summary.failing;
  const pendingChecks = requiredChecksConfigured ? summary.requiredPending : summary.pending;

  if (failingChecks > 0) {
    blockingReasons.push(
      requiredChecksConfigured
        ? `Required checks failing (${failingChecks}).`
        : `Checks failing (${failingChecks}).`,
    );
  }
  if (pendingChecks > 0) {
    blockingReasons.push(
      requiredChecksConfigured
        ? `Required checks still pending (${pendingChecks}).`
        : `Checks still pending (${pendingChecks}).`,
    );
  }
  if (input.prBridge.mergeability === "conflicting") {
    blockingReasons.push("PR mergeability reports conflicts.");
  }
  if (input.prBridge.mergeability === "blocked") {
    blockingReasons.push("PR mergeability is blocked by repository policy.");
  }
  const reviewDecision = input.prBridge.reviewDecision?.toLowerCase() ?? "";
  if (reviewDecision.includes("changes_requested") || reviewDecision.includes("request_changes")) {
    blockingReasons.push("PR still has requested changes.");
  }

  const ciReady = failingChecks === 0 && pendingChecks === 0;
  const mergeReady = ciReady
    && input.prBridge.mergeability !== "conflicting"
    && input.prBridge.mergeability !== "blocked"
    && !blockingReasons.some((reason) => reason.includes("requested changes"));

  return {
    ciReady,
    mergeReady,
    closeReady: mergeReady,
    requiredChecksConfigured,
    blockingReasons,
  };
}

export function mergeCandidateRequiresGateEnforcement(input: {
  prBridge: IssueMergeCandidatePrBridge | null;
  gateStatus: IssueMergeCandidateGateStatus | null;
}) {
  if (!input.prBridge || !input.gateStatus) return false;
  return input.prBridge.state === "draft" || input.prBridge.state === "open" || input.prBridge.state === "unknown";
}
