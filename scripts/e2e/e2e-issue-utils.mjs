export const ACTIVE_E2E_ISSUE_STATUSES = new Set([
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "blocked",
]);

export const TERMINAL_E2E_ISSUE_STATUSES = new Set([
  "done",
  "cancelled",
]);

export function buildE2eLabelSpecs(options = {}) {
  const nightly = options.nightly === true;
  const specs = [
    { name: "ops:e2e", color: "#475569" },
    { name: "ops:e2e:real-org", color: "#2563EB" },
  ];
  if (nightly) {
    specs.push({ name: "ops:e2e:nightly", color: "#7C3AED" });
  }
  return specs;
}

export function needsE2eCancellation(status) {
  return ACTIVE_E2E_ISSUE_STATUSES.has(status);
}

export function shouldHideE2eIssue(status) {
  return TERMINAL_E2E_ISSUE_STATUSES.has(status);
}

export function hasAnyLabelId(issue, labelIds) {
  const issueLabelIds = new Set((issue?.labelIds ?? []).filter(Boolean));
  for (const labelId of labelIds) {
    if (issueLabelIds.has(labelId)) {
      return true;
    }
  }
  return false;
}

export function collectTaggedIssues(issues, labelIds) {
  return issues.filter((issue) => hasAnyLabelId(issue, labelIds));
}

export function collectIssueFamily(rootIssues) {
  const family = [];
  const seen = new Set();
  const stack = [...rootIssues];

  while (stack.length > 0) {
    const issue = stack.pop();
    if (!issue?.id || seen.has(issue.id)) continue;
    seen.add(issue.id);
    family.push(issue);
    if (Array.isArray(issue.internalWorkItems)) {
      for (const child of issue.internalWorkItems) {
        stack.push(child);
      }
    }
  }

  return family;
}
