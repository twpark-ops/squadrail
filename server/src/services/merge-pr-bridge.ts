import type { IssueMergeCandidateCheck, IssueMergeCandidatePrBridge } from "@squadrail/shared";

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

function normalizeCheckStatus(
  status: string | null,
  conclusion?: string | null,
): IssueMergeCandidateCheck["status"] {
  const normalizedStatus = status?.toLowerCase() ?? "";
  const normalizedConclusion = conclusion?.toLowerCase() ?? "";
  if (normalizedStatus === "queued") return "queued";
  if (normalizedStatus === "pending" || normalizedStatus === "waiting_for_resource") return "pending";
  if (normalizedStatus === "in_progress" || normalizedStatus === "running") return "running";
  if (normalizedStatus === "success" || normalizedConclusion === "success") return "success";
  if (
    normalizedStatus === "failure"
    || normalizedStatus === "failed"
    || normalizedConclusion === "failure"
    || normalizedConclusion === "failed"
  ) {
    return "failure";
  }
  if (normalizedStatus === "error" || normalizedConclusion === "error") return "error";
  if (normalizedStatus === "cancelled" || normalizedConclusion === "cancelled") return "cancelled";
  if (normalizedStatus === "skipped" || normalizedConclusion === "skipped") return "skipped";
  if (normalizedStatus === "neutral" || normalizedConclusion === "neutral") return "neutral";
  return "unknown";
}

function uniqueByName<T extends { name: string }>(items: T[]) {
  const seen = new Set<string>();
  const results: T[] = [];
  for (const item of items) {
    if (seen.has(item.name)) continue;
    seen.add(item.name);
    results.push(item);
  }
  return results;
}

function stringifyId(value: unknown) {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

type MergePrBridgeRemote = {
  provider: "github" | "gitlab";
  host: string;
  origin: string;
  apiBaseUrl: string;
  repoOwner: string;
  repoName: string;
  repoPath: string;
  repoUrl: string;
};

export type MergePrBridgeSyncInput = {
  remoteUrl: string;
  baseBranch: string;
  headBranch: string;
  headSha: string | null;
  title: string;
  body: string;
  existing?: {
    number?: number | null;
    externalId?: string | null;
  } | null;
};

type MergePrBridgeClient = {
  sync(input: MergePrBridgeSyncInput): Promise<IssueMergeCandidatePrBridge>;
};

let mergePrBridgeClientOverride: MergePrBridgeClient | null = null;

export function setMergePrBridgeClientForTests(client: MergePrBridgeClient | null) {
  mergePrBridgeClientOverride = client;
}

export function detectMergePrBridgeRemote(remoteUrl: string | null | undefined): MergePrBridgeRemote | null {
  const raw = readString(remoteUrl);
  if (!raw) return null;

  let url: URL;
  try {
    if (raw.startsWith("git@")) {
      const sshBody = raw.slice("git@".length);
      const separatorIndex = sshBody.indexOf(":");
      if (separatorIndex < 0) return null;
      const host = sshBody.slice(0, separatorIndex);
      const repoPath = sshBody.slice(separatorIndex + 1).replace(/\.git$/u, "");
      url = new URL(`https://${host}/${repoPath}`);
    } else if (raw.startsWith("ssh://")) {
      url = new URL(raw.replace(/\.git$/u, ""));
    } else {
      url = new URL(raw.replace(/\.git$/u, ""));
    }
  } catch {
    return null;
  }

  const repoPath = url.pathname.replace(/^\/+/u, "").replace(/\.git$/u, "");
  const segments = repoPath.split("/").filter(Boolean);
  if (segments.length < 2) return null;

  const repoName = segments[segments.length - 1] ?? "";
  const repoOwner = segments.slice(0, -1).join("/");
  const host = url.host.toLowerCase();
  const origin = `${url.protocol}//${url.host}`;

  if (host === "github.com" || host.includes("github")) {
    return {
      provider: "github",
      host,
      origin,
      apiBaseUrl: host === "github.com" ? "https://api.github.com" : `${origin}/api/v3`,
      repoOwner,
      repoName,
      repoPath: `${repoOwner}/${repoName}`,
      repoUrl: `${origin}/${repoOwner}/${repoName}`,
    };
  }

  if (host === "gitlab.com" || host.includes("gitlab")) {
    return {
      provider: "gitlab",
      host,
      origin,
      apiBaseUrl: `${origin}/api/v4`,
      repoOwner,
      repoName,
      repoPath: `${repoOwner}/${repoName}`,
      repoUrl: `${origin}/${repoOwner}/${repoName}`,
    };
  }

  return null;
}

async function requestJson<T>(input: {
  url: string;
  method?: string;
  token: string;
  headers?: Record<string, string>;
  body?: Record<string, unknown>;
}) {
  const headers = Object.fromEntries(
    Object.entries({
      Accept: "application/json",
      Authorization: `Bearer ${input.token}`,
      ...(input.body ? { "Content-Type": "application/json" } : {}),
      ...input.headers,
    }).filter(([, value]) => typeof value === "string" && value.length > 0),
  );
  const response = await fetch(input.url, {
    method: input.method ?? (input.body ? "POST" : "GET"),
    headers,
    body: input.body ? JSON.stringify(input.body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`PR bridge request failed (${response.status} ${response.statusText}): ${text || input.url}`);
  }

  return response.json() as Promise<T>;
}

function buildGithubReviewDecision(reviews: Array<Record<string, unknown>>) {
  let latestDecision: string | null = null;
  for (const review of reviews) {
    const state = readString(review.state)?.toLowerCase() ?? null;
    if (!state || state === "commented" || state === "dismissed" || state === "pending") continue;
    latestDecision = state;
  }
  return latestDecision;
}

async function syncGithubPullRequest(input: MergePrBridgeSyncInput, remote: MergePrBridgeRemote) {
  const token = process.env.SQUADRAIL_GITHUB_TOKEN?.trim() || process.env.GITHUB_TOKEN?.trim();
  if (!token) {
    throw new Error("GitHub PR bridge requires SQUADRAIL_GITHUB_TOKEN or GITHUB_TOKEN");
  }

  const repoRef = `${remote.repoOwner}/${remote.repoName}`;
  let pr = input.existing?.number
    ? await requestJson<Record<string, unknown>>({
        url: `${remote.apiBaseUrl}/repos/${repoRef}/pulls/${input.existing.number}`,
        token,
        headers: { "X-GitHub-Api-Version": "2022-11-28" },
      })
    : await requestJson<Record<string, unknown>>({
        url: `${remote.apiBaseUrl}/repos/${repoRef}/pulls`,
        token,
        headers: { "X-GitHub-Api-Version": "2022-11-28" },
        body: {
          title: input.title,
          head: input.headBranch,
          base: input.baseBranch,
          body: input.body,
          draft: true,
        },
      });

  const prNumber = readNumber(pr.number);
  if (!prNumber) {
    throw new Error("GitHub PR bridge failed to resolve pull request number");
  }

  // Refresh after creation so mergeability fields settle consistently.
  pr = await requestJson<Record<string, unknown>>({
    url: `${remote.apiBaseUrl}/repos/${repoRef}/pulls/${prNumber}`,
    token,
    headers: { "X-GitHub-Api-Version": "2022-11-28" },
  });

  const head = asRecord(pr.head);
  const base = asRecord(pr.base);
  const resolvedHeadSha = readString(head.sha) ?? input.headSha;
  const reviews = await requestJson<Array<Record<string, unknown>>>({
    url: `${remote.apiBaseUrl}/repos/${repoRef}/pulls/${prNumber}/reviews`,
    token,
    headers: { "X-GitHub-Api-Version": "2022-11-28" },
  }).catch(() => []);
  const checkRunsPayload = resolvedHeadSha
    ? await requestJson<{ check_runs?: Array<Record<string, unknown>> }>({
        url: `${remote.apiBaseUrl}/repos/${repoRef}/commits/${resolvedHeadSha}/check-runs`,
        token,
        headers: {
          "X-GitHub-Api-Version": "2022-11-28",
          Accept: "application/vnd.github+json",
        },
      }).catch(() => ({ check_runs: [] }))
    : { check_runs: [] };
  const commitStatus = resolvedHeadSha
    ? await requestJson<{ statuses?: Array<Record<string, unknown>> }>({
        url: `${remote.apiBaseUrl}/repos/${repoRef}/commits/${resolvedHeadSha}/status`,
        token,
        headers: { "X-GitHub-Api-Version": "2022-11-28" },
      }).catch(() => ({ statuses: [] }))
    : { statuses: [] };
  const protection = await requestJson<Record<string, unknown>>({
    url: `${remote.apiBaseUrl}/repos/${repoRef}/branches/${input.baseBranch}/protection/required_status_checks`,
    token,
    headers: { "X-GitHub-Api-Version": "2022-11-28" },
  }).catch(() => null);

  const requiredContexts = new Set<string>();
  for (const context of Array.isArray(protection?.contexts) ? protection.contexts : []) {
    const name = readString(context);
    if (name) requiredContexts.add(name);
  }
  for (const item of Array.isArray(protection?.checks) ? protection.checks : []) {
    const name = readString(asRecord(item).context);
    if (name) requiredContexts.add(name);
  }

  const checks: IssueMergeCandidateCheck[] = uniqueByName([
    ...(checkRunsPayload.check_runs ?? []).map((checkRun) => ({
      name: readString(checkRun.name) ?? "Unnamed check",
      status: normalizeCheckStatus(readString(checkRun.status), readString(checkRun.conclusion)),
      conclusion: readString(checkRun.conclusion),
      summary: readString(asRecord(checkRun.output).title) ?? readString(asRecord(checkRun.output).summary),
      detailsUrl: readString(checkRun.details_url),
      required: requiredContexts.has(readString(checkRun.name) ?? ""),
    })),
    ...(commitStatus.statuses ?? []).map((status) => ({
      name: readString(status.context) ?? "Unnamed status",
      status: normalizeCheckStatus(readString(status.state)),
      conclusion: readString(status.state),
      summary: readString(status.description),
      detailsUrl: readString(status.target_url),
      required: requiredContexts.has(readString(status.context) ?? ""),
    })),
  ]);

  const mergedAt = readString(pr.merged_at);
  const state = mergedAt
    ? "merged"
    : pr.state === "open"
      ? (pr.draft === true ? "draft" : "open")
      : pr.state === "closed"
        ? "closed"
        : "unknown";
  const mergeableState = readString(pr.mergeable_state)?.toLowerCase() ?? "";
  const mergeability = mergedAt
    ? "mergeable"
    : mergeableState === "dirty" || mergeableState === "conflicting"
      ? "conflicting"
      : mergeableState === "blocked" || mergeableState === "behind"
        ? "blocked"
        : pr.mergeable === true
          ? "mergeable"
          : pr.mergeable === false
            ? "blocked"
            : "unknown";

  return {
    provider: "github",
    repoOwner: remote.repoOwner,
    repoName: remote.repoName,
    repoUrl: remote.repoUrl,
    remoteUrl: input.remoteUrl,
    number: prNumber,
    externalId: stringifyId(pr.id) ?? String(prNumber),
    url: readString(pr.html_url),
    title: readString(pr.title),
    state,
    mergeability,
    headBranch: readString(head.ref) ?? input.headBranch,
    baseBranch: readString(base.ref) ?? input.baseBranch,
    headSha: resolvedHeadSha,
    reviewDecision: buildGithubReviewDecision(reviews),
    commentCount: readNumber(pr.comments) ?? 0,
    reviewCommentCount: readNumber(pr.review_comments) ?? 0,
    lastSyncedAt: new Date(),
    checks,
    checkSummary: {
      total: 0,
      passing: 0,
      failing: 0,
      pending: 0,
      requiredTotal: 0,
      requiredPassing: 0,
      requiredFailing: 0,
      requiredPending: 0,
    },
  } satisfies IssueMergeCandidatePrBridge;
}

async function syncGitlabMergeRequest(input: MergePrBridgeSyncInput, remote: MergePrBridgeRemote) {
  const token = process.env.SQUADRAIL_GITLAB_TOKEN?.trim() || process.env.GITLAB_TOKEN?.trim();
  if (!token) {
    throw new Error("GitLab PR bridge requires SQUADRAIL_GITLAB_TOKEN or GITLAB_TOKEN");
  }

  const projectRef = encodeURIComponent(remote.repoPath);
  let mr = input.existing?.number
    ? await requestJson<Record<string, unknown>>({
        url: `${remote.apiBaseUrl}/projects/${projectRef}/merge_requests/${input.existing.number}`,
        token,
        headers: { "PRIVATE-TOKEN": token, Authorization: "" },
      })
    : await requestJson<Record<string, unknown>>({
        url: `${remote.apiBaseUrl}/projects/${projectRef}/merge_requests`,
        token,
        headers: { "PRIVATE-TOKEN": token, Authorization: "" },
        body: {
          source_branch: input.headBranch,
          target_branch: input.baseBranch,
          title: input.title.toLowerCase().startsWith("draft:") ? input.title : `Draft: ${input.title}`,
          description: input.body,
          remove_source_branch: false,
        },
      });

  const mrIid = readNumber(mr.iid);
  if (!mrIid) {
    throw new Error("GitLab PR bridge failed to resolve merge request iid");
  }

  mr = await requestJson<Record<string, unknown>>({
    url: `${remote.apiBaseUrl}/projects/${projectRef}/merge_requests/${mrIid}`,
    token,
    headers: { "PRIVATE-TOKEN": token, Authorization: "" },
  });

  const headPipeline = asRecord(mr.head_pipeline);
  const jobsPayload = readNumber(headPipeline.id)
    ? await requestJson<Array<Record<string, unknown>>>({
        url: `${remote.apiBaseUrl}/projects/${projectRef}/pipelines/${headPipeline.id}/jobs`,
        token,
        headers: { "PRIVATE-TOKEN": token, Authorization: "" },
      }).catch(() => [])
    : [];

  const checks: IssueMergeCandidateCheck[] = uniqueByName(
    jobsPayload.map((job) => ({
      name: readString(job.name) ?? "Unnamed job",
      status: normalizeCheckStatus(readString(job.status)),
      conclusion: readString(job.status),
      summary: readString(job.stage),
      detailsUrl: readString(job.web_url),
      required: false,
    })),
  );

  const detailedMergeStatus = readString(mr.detailed_merge_status)?.toLowerCase() ?? "";
  const mergeability = detailedMergeStatus.includes("conflict")
    ? "conflicting"
    : detailedMergeStatus.includes("blocked") || detailedMergeStatus.includes("not_open") || detailedMergeStatus.includes("ci_must_pass")
      ? "blocked"
      : detailedMergeStatus.includes("mergeable")
        ? "mergeable"
        : "unknown";
  const state = readString(mr.state)?.toLowerCase() === "merged"
    ? "merged"
    : readString(mr.state)?.toLowerCase() === "closed"
      ? "closed"
      : mr.draft === true || readString(mr.title)?.startsWith("Draft:")
        ? "draft"
        : "open";

  return {
    provider: "gitlab",
    repoOwner: remote.repoOwner,
    repoName: remote.repoName,
    repoUrl: remote.repoUrl,
    remoteUrl: input.remoteUrl,
    number: mrIid,
    externalId: stringifyId(mr.id) ?? String(mrIid),
    url: readString(mr.web_url),
    title: readString(mr.title),
    state,
    mergeability,
    headBranch: readString(mr.source_branch) ?? input.headBranch,
    baseBranch: readString(mr.target_branch) ?? input.baseBranch,
    headSha: readString(asRecord(mr.diff_refs).head_sha) ?? input.headSha,
    reviewDecision: readBoolean(mr.blocking_discussions_resolved) ? "approved" : null,
    commentCount: readNumber(mr.user_notes_count) ?? 0,
    reviewCommentCount: 0,
    lastSyncedAt: new Date(),
    checks,
    checkSummary: {
      total: 0,
      passing: 0,
      failing: 0,
      pending: 0,
      requiredTotal: 0,
      requiredPassing: 0,
      requiredFailing: 0,
      requiredPending: 0,
    },
  } satisfies IssueMergeCandidatePrBridge;
}

function readBoolean(value: unknown) {
  return value === true;
}

export async function syncMergePrBridge(input: MergePrBridgeSyncInput): Promise<IssueMergeCandidatePrBridge> {
  if (mergePrBridgeClientOverride) {
    return mergePrBridgeClientOverride.sync(input);
  }

  const remote = detectMergePrBridgeRemote(input.remoteUrl);
  if (!remote) {
    throw new Error(`Unsupported PR bridge remote: ${input.remoteUrl}`);
  }

  if (remote.provider === "github") {
    return syncGithubPullRequest(input, remote);
  }
  return syncGitlabMergeRequest(input, remote);
}
