function asRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value;
}

export function extractJsonTail(stdout) {
  const trimmed = typeof stdout === "string" ? stdout.trim() : "";
  if (!trimmed) return null;
  const candidates = [];
  for (let index = 0; index < trimmed.length; index += 1) {
    const token = trimmed[index];
    if (token === "[" || token === "{") {
      candidates.push(index);
    }
  }
  let latestParsed = null;
  for (const startIndex of candidates) {
    const candidate = trimmed.slice(startIndex).trim();
    try {
      latestParsed = JSON.parse(candidate);
    } catch {
      continue;
    }
  }
  return latestParsed;
}

export function collectNonReadyProjectIds(setup) {
  const projects = Array.isArray(setup?.projects) ? setup.projects : [];
  return projects
    .filter((project) => project?.projectStatus !== "ready")
    .map((project) => project?.projectId)
    .filter((projectId) => typeof projectId === "string" && projectId.length > 0);
}

export function isKnowledgeSetupReady(setup) {
  const projects = Array.isArray(setup?.projects) ? setup.projects : [];
  return (setup?.activeJobCount ?? 0) === 0 && projects.length > 0 && projects.every((project) => project?.projectStatus === "ready");
}

export function findLatestBriefByScope(briefs, scope) {
  const normalizedScope = typeof scope === "string" ? scope : "";
  const candidates = (Array.isArray(briefs) ? briefs : [])
    .filter((brief) => brief?.briefScope === normalizedScope)
    .sort((left, right) => {
      const leftTime = new Date(left?.createdAt ?? 0).getTime();
      const rightTime = new Date(right?.createdAt ?? 0).getTime();
      return rightTime - leftTime;
    });
  return candidates[0] ?? null;
}

export function summarizeBriefQuality(brief) {
  const content = asRecord(brief?.contentJson);
  const quality = asRecord(content.quality);
  const hits = Array.isArray(content.hits) ? content.hits : [];
  const hitPaths = hits
    .map((hit) => (typeof hit?.path === "string" ? hit.path : null))
    .filter((value) => value != null);
  const degradedReasons = Array.isArray(quality.degradedReasons)
    ? quality.degradedReasons.filter((value) => typeof value === "string")
    : [];
  return {
    briefScope: typeof brief?.briefScope === "string" ? brief.briefScope : null,
    retrievalRunId: typeof brief?.retrievalRunId === "string" ? brief.retrievalRunId : null,
    confidenceLevel: typeof quality.confidenceLevel === "string" ? quality.confidenceLevel : null,
    graphHitCount: typeof quality.graphHitCount === "number" ? quality.graphHitCount : 0,
    graphMaxDepth: typeof quality.graphMaxDepth === "number" ? quality.graphMaxDepth : 0,
    multiHopGraphHitCount: typeof quality.multiHopGraphHitCount === "number" ? quality.multiHopGraphHitCount : 0,
    personalizationApplied: quality.personalizationApplied === true,
    personalizedHitCount: typeof quality.personalizedHitCount === "number" ? quality.personalizedHitCount : 0,
    averagePersonalizationBoost:
      typeof quality.averagePersonalizationBoost === "number" ? quality.averagePersonalizationBoost : 0,
    degradedReasons,
    hitPaths,
  };
}
