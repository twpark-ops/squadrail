#!/usr/bin/env node

import {
  buildE2eLabelSpecs,
  collectIssueFamily,
  collectTaggedIssues,
  hasAnyLabelId,
  needsE2eCancellation,
  shouldHideE2eIssue,
} from "./e2e-issue-utils.mjs";

const BASE_URL = process.env.SQUADRAIL_BASE_URL ?? "http://127.0.0.1:3101";
const COMPANY_NAME = process.env.SQUADRAIL_COMPANY_NAME ?? "cloud-swiftsight";
const NIGHTLY_MODE = process.env.SWIFTSIGHT_E2E_NIGHTLY === "1";
const HIDE_TERMINAL = process.env.SWIFTSIGHT_E2E_HIDE_COMPLETED !== "0";
const ACTOR_ID = process.env.SWIFTSIGHT_E2E_ACTOR_ID ?? "cloud-swiftsight-e2e-board";

function note(message = "") {
  process.stdout.write(`${message}\n`);
}

async function api(pathname, options = {}) {
  const response = await fetch(`${BASE_URL}${pathname}`, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
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

async function hideIssue(issueId) {
  return api(`/api/issues/${issueId}`, {
    method: "PATCH",
    body: {
      hiddenAt: new Date().toISOString(),
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
  const issues = await api(`/api/companies/${companyId}/issues`);
  const taggedRoots = collectTaggedIssues(issues, labelIds);
  const taggedIssues = collectIssueFamily(
    await Promise.all(taggedRoots.map((issue) => api(`/api/issues/${issue.id}`))),
  );
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
        await hideIssue(issue.id);
        summary.hidden += 1;
        note(`hid ${issue.identifier}`);
      }
      continue;
    }

    if (HIDE_TERMINAL && shouldHideE2eIssue(issue.status)) {
      await hideIssue(issue.id);
      summary.hidden += 1;
      note(`hid ${issue.identifier}`);
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
    const shouldTreatAsE2e =
      issueIds.has(issue.id) ||
      (issue.hiddenAt && isLikelyE2eIssue(issue, labelIds)) ||
      (issue.hiddenAt && issue.parentId && String(issue.title ?? "").startsWith("Child delivery:"));

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

    await cancelHeartbeatRun(run.id);
    summary.runsCancelled += 1;
    note(`cancelled run ${run.id} for issue ${issue.identifier ?? issue.id}`);
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
