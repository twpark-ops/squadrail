#!/usr/bin/env node

import {
  buildE2eLabelSpecs,
  hasAnyLabelId,
  needsE2eCancellation,
  shouldHideE2eIssue,
} from "./e2e-issue-utils.mjs";
import { computeRateLimitRetryDelayMs } from "./e2e-api-utils.mjs";

const BASE_URL = process.env.SQUADRAIL_BASE_URL ?? "http://127.0.0.1:3101";
const COMPANY_NAME = process.env.SQUADRAIL_COMPANY_NAME ?? "cloud-swiftsight";
const NIGHTLY_MODE = process.env.SWIFTSIGHT_E2E_NIGHTLY === "1";
const HIDE_TERMINAL = process.env.SWIFTSIGHT_E2E_HIDE_COMPLETED !== "0";
const ACTOR_ID = process.env.SWIFTSIGHT_E2E_ACTOR_ID ?? "cloud-swiftsight-e2e-board";
const API_RETRY_LIMIT = Math.max(0, Number(process.env.SWIFTSIGHT_E2E_API_RETRY_LIMIT ?? 3));

function note(message = "") {
  process.stdout.write(`${message}\n`);
}

async function api(pathname, options = {}) {
  const attempt = options.attempt ?? 0;
  const response = await fetch(`${BASE_URL}${pathname}`, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      "x-squadrail-e2e-bypass-rate-limit": "true",
      ...(options.headers ?? {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const contentType = response.headers.get("content-type") ?? "";
  const body =
    contentType.includes("application/json")
      ? await response.json()
      : await response.text();

  if (!response.ok) {
    if (response.status === 429 && attempt < API_RETRY_LIMIT) {
      const delayMs = computeRateLimitRetryDelayMs({
        status: response.status,
        body,
        attempt,
      });
      note(`retry ${options.method ?? "GET"} ${pathname} after ${delayMs}ms due to rate limit`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return api(pathname, {
        ...options,
        attempt: attempt + 1,
      });
    }
    throw new Error(
      `API ${options.method ?? "GET"} ${pathname} failed with ${response.status}: ${
        typeof body === "string" ? body : JSON.stringify(body)
      }`,
    );
  }

  return body;
}

async function resolveCompany() {
  const companies = await api("/api/companies");
  const company = companies.find((entry) => entry.name === COMPANY_NAME);
  if (!company) {
    throw new Error(`Company not found: ${COMPANY_NAME}`);
  }
  return company;
}

async function ensureCompanyLabels(companyId, specs) {
  const existing = await api(`/api/companies/${companyId}/labels`);
  const byName = new Map(existing.map((label) => [label.name, label]));

  for (const spec of specs) {
    if (byName.has(spec.name)) continue;
    const created = await api(`/api/companies/${companyId}/labels`, {
      method: "POST",
      body: spec,
    });
    byName.set(created.name, created);
  }

  return specs.map((spec) => byName.get(spec.name)).filter(Boolean);
}

async function markIssueCancelled(issueId) {
  return api(`/api/issues/${issueId}`, {
    method: "PATCH",
    body: {
      status: "cancelled",
    },
  });
}

async function cancelHeartbeatRun(runId) {
  return api(`/api/heartbeat-runs/${runId}/cancel`, {
    method: "POST",
    body: {},
  });
}

function isLikelyE2eIssue(issue, labelIds) {
  if (!issue) return false;
  if (hasAnyLabelId(issue, labelIds)) return true;
  const title = String(issue.title ?? "");
  if (title.startsWith("E2E:") || title.startsWith("Org E2E:") || title.startsWith("Child delivery:")) {
    return true;
  }
  return false;
}

async function resolveLikelyE2eIssue(apiFn, issue, labelIds) {
  if (!issue) return null;
  if (isLikelyE2eIssue(issue, labelIds)) return issue;
  if (!issue.parentId) return null;
  const parent = await apiFn(`/api/issues/${issue.parentId}`).catch(() => null);
  return parent && isLikelyE2eIssue(parent, labelIds) ? parent : null;
}

async function cancelIssue(issueId, reason, workflowStateBefore) {
  return api(`/api/issues/${issueId}/protocol/messages`, {
    method: "POST",
    body: {
      messageType: "CANCEL_TASK",
      sender: {
        actorType: "user",
        actorId: ACTOR_ID,
        role: "human_board",
      },
      recipients: [
        {
          recipientType: "role_group",
          recipientId: "human_board",
          role: "human_board",
        },
      ],
      workflowStateBefore,
      workflowStateAfter: "cancelled",
      summary: "Cancel lingering E2E issue during cleanup",
      requiresAck: false,
      payload: {
        reason,
        cancelType: "duplicate",
      },
      artifacts: [],
    },
  });
}

async function cleanupTaggedIssues(companyId, labelIds) {
  const rootIssues = await api(`/api/companies/${companyId}/issues`);
  const taggedRoots = rootIssues.filter((issue) => isLikelyE2eIssue(issue, labelIds));

  // Fetch subtasks of tagged roots so cleanup covers child issues too.
  // GET /api/issues/:id returns internalWorkItems for each root.
  const childIssues = [];
  for (const root of taggedRoots) {
    const detail = await api(`/api/issues/${root.id}`).catch(() => null);
    const children = Array.isArray(detail?.internalWorkItems) ? detail.internalWorkItems : [];
    childIssues.push(...children);
  }

  const taggedIssues = [...taggedRoots, ...childIssues];
  const summary = {
    scanned: taggedIssues.length,
    cancelled: 0,
    hidden: 0,
    runsCancelled: 0,
  };
  const issueIds = new Set(taggedIssues.map((issue) => issue.id));

  for (const issue of taggedIssues) {
    if (needsE2eCancellation(issue.status)) {
      try {
        const state = await api(`/api/issues/${issue.id}/protocol/state`);
        await cancelIssue(
          issue.id,
          `Cleanup cancelled lingering E2E issue ${issue.identifier}.`,
          state.workflowState,
        );
        summary.cancelled += 1;
        note(`cancelled ${issue.identifier}`);
      } catch (error) {
        note(`skip cancel ${issue.identifier}: ${error.message}`);
      }
      if (HIDE_TERMINAL) {
        try {
          await markIssueCancelled(issue.id);
          summary.hidden += 1;
          note(`hid ${issue.identifier}`);
        } catch (error) {
          note(`skip hide ${issue.identifier}: ${error.message}`);
        }
      }
      continue;
    }

    if (HIDE_TERMINAL && shouldHideE2eIssue(issue.status)) {
      try {
        await markIssueCancelled(issue.id);
        summary.hidden += 1;
        note(`hid ${issue.identifier}`);
      } catch (error) {
        note(`skip hide ${issue.identifier}: ${error.message}`);
      }
    }
  }

  const heartbeatRuns = await api(`/api/companies/${companyId}/heartbeat-runs?limit=200`);
  const activeRuns = heartbeatRuns.filter((run) => {
    if (!["queued", "claimed", "running"].includes(run.status)) return false;
    const issueId = run?.contextSnapshot?.issueId;
    return Boolean(issueId);
  });

  for (const run of activeRuns) {
    const issueId = run?.contextSnapshot?.issueId;
    const issue = issueId ? await api(`/api/issues/${issueId}`).catch(() => null) : null;
    if (!issue) continue;
    const matchedIssue = await resolveLikelyE2eIssue(api, issue, labelIds);
    const shouldTreatAsE2e =
      issueIds.has(issue.id) ||
      Boolean(matchedIssue) ||
      (issue.parentId && String(issue.title ?? "").startsWith("Child delivery:"));

    if (!shouldTreatAsE2e) continue;

    if (needsE2eCancellation(issue.status)) {
      try {
        const state = await api(`/api/issues/${issue.id}/protocol/state`);
        await cancelIssue(
          issue.id,
          `Cleanup cancelled lingering active E2E issue ${issue.identifier}.`,
          state.workflowState,
        );
        summary.cancelled += 1;
        note(`cancelled lingering issue ${issue.identifier}`);
      } catch (error) {
        note(`skip cancel lingering issue ${issue.identifier}: ${error.message}`);
      }
    }

    try {
      await cancelHeartbeatRun(run.id);
      summary.runsCancelled += 1;
      note(`cancelled run ${run.id} for issue ${issue.identifier ?? issue.id}`);
    } catch (error) {
      note(`skip cancel run ${run.id}: ${error.message}`);
    }
  }

  return summary;
}

async function main() {
  const company = await resolveCompany();
  const labels = await ensureCompanyLabels(company.id, buildE2eLabelSpecs({ nightly: NIGHTLY_MODE }));
  const summary = await cleanupTaggedIssues(
    company.id,
    labels.map((label) => label.id),
  );
  note(JSON.stringify({ company: company.name, ...summary }, null, 2));
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
