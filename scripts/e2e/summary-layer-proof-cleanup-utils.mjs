function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function readString(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function collectVisibleIssueIds(issues) {
  return new Set(
    asArray(issues)
      .filter((issue) => !issue?.parentId)
      .map((issue) => issue?.id)
      .filter((issueId) => typeof issueId === "string" && issueId.length > 0),
  );
}

export function collectIssueIds(issues) {
  return new Set(
    asArray(issues)
      .map((issue) => issue?.id)
      .filter((issueId) => typeof issueId === "string" && issueId.length > 0),
  );
}

export function collectCleanupIssueIds(currentResults) {
  const record = currentResults && typeof currentResults === "object" ? currentResults : {};
  const scenarioDetails = asArray(record.scenarioDetails);
  const ids = new Set();

  for (const entry of scenarioDetails) {
    if (typeof entry?.issueId === "string" && entry.issueId.length > 0) {
      ids.add(entry.issueId);
    }
    const cleanupTouched = asArray(entry?.cleanup?.touched);
    for (const touched of cleanupTouched) {
      if (typeof touched?.issueId === "string" && touched.issueId.length > 0) {
        ids.add(touched.issueId);
      }
    }
    const childResults = asArray(entry?.delivery?.childResults);
    for (const child of childResults) {
      if (typeof child?.issueId === "string" && child.issueId.length > 0) {
        ids.add(child.issueId);
      }
    }
  }

  return ids;
}

export function expandCleanupIssueIds(issues, seedIssueIds) {
  const seeds = new Set(
    [...(seedIssueIds instanceof Set ? seedIssueIds : new Set(asArray(seedIssueIds)))]
      .map((value) => readString(value))
      .filter(Boolean),
  );
  if (seeds.size === 0) return seeds;

  const childrenByParent = new Map();
  for (const issue of asArray(issues)) {
    const issueId = readString(issue?.id);
    const parentId = readString(issue?.parentId);
    if (!issueId || !parentId) continue;
    const siblings = childrenByParent.get(parentId) ?? [];
    siblings.push(issueId);
    childrenByParent.set(parentId, siblings);
  }

  const queue = [...seeds];
  while (queue.length > 0) {
    const currentId = queue.shift();
    if (!currentId) continue;
    for (const childId of childrenByParent.get(currentId) ?? []) {
      if (seeds.has(childId)) continue;
      seeds.add(childId);
      queue.push(childId);
    }
  }

  return seeds;
}

export function summarizePostRunCleanup({ issues, heartbeatRuns, visibleIssueIdsBefore, trackedIssueIds }) {
  const terminalStatuses = new Set(["cancelled", "done"]);
  const trackedIds = expandCleanupIssueIds(issues, trackedIssueIds);
  const visibleBefore = visibleIssueIdsBefore instanceof Set
    ? visibleIssueIdsBefore
    : collectVisibleIssueIds(visibleIssueIdsBefore);

  const visibleNewIssues = asArray(issues)
    .filter((issue) => !issue?.parentId)
    .filter((issue) => !visibleBefore.has(issue?.id))
    .filter((issue) => !terminalStatuses.has(issue?.status))
    .filter((issue) => trackedIds.size === 0 || trackedIds.has(issue?.id));

  const activeRuns = asArray(heartbeatRuns)
    .filter((run) => ["queued", "claimed", "running"].includes(run?.status))
    .filter((run) => {
      if (trackedIds.size === 0) return true;
      const issueId = readString(run?.contextSnapshot?.issueId);
      return Boolean(issueId) && trackedIds.has(issueId);
    });

  return {
    trackedIssueCount: trackedIds.size,
    visibleNewIssueCount: visibleNewIssues.length,
    visibleNewIssues: visibleNewIssues.map((issue) => ({
      id: issue.id,
      identifier: issue.identifier ?? null,
      title: issue.title ?? null,
      status: issue.status ?? null,
    })),
    activeRunCount: activeRuns.length,
    activeRuns: activeRuns.map((run) => ({
      id: run.id,
      status: run.status,
      issueId: run?.contextSnapshot?.issueId ?? null,
    })),
  };
}
