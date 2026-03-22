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
  const firstHit = asRecord(hits[0]);
  const hitPaths = hits
    .map((hit) => (typeof hit?.path === "string" ? hit.path : null))
    .filter((value) => value != null);
  const hitSourceTypes = hits
    .map((hit) => (typeof hit?.sourceType === "string" ? hit.sourceType : null))
    .filter((value) => value != null);
  const executableEvidenceHitCount = hitSourceTypes.filter((sourceType) =>
    sourceType === "code" || sourceType === "test_report").length;
  const degradedReasons = Array.isArray(quality.degradedReasons)
    ? quality.degradedReasons.filter((value) => typeof value === "string")
    : [];
  return {
    briefScope: typeof brief?.briefScope === "string" ? brief.briefScope : null,
    retrievalRunId: typeof brief?.retrievalRunId === "string" ? brief.retrievalRunId : null,
    confidenceLevel: typeof quality.confidenceLevel === "string" ? quality.confidenceLevel : null,
    graphHitCount: typeof quality.graphHitCount === "number" ? quality.graphHitCount : 0,
    graphMaxDepth: typeof quality.graphMaxDepth === "number" ? quality.graphMaxDepth : 0,
    graphHopDepthCounts:
      quality.graphHopDepthCounts && typeof quality.graphHopDepthCounts === "object" && !Array.isArray(quality.graphHopDepthCounts)
        ? quality.graphHopDepthCounts
        : {},
    multiHopGraphHitCount: typeof quality.multiHopGraphHitCount === "number" ? quality.multiHopGraphHitCount : 0,
    candidateCacheHit: quality.candidateCacheHit === true,
    finalCacheHit: quality.finalCacheHit === true,
    candidateCacheReason: typeof quality.candidateCacheReason === "string" ? quality.candidateCacheReason : null,
    finalCacheReason: typeof quality.finalCacheReason === "string" ? quality.finalCacheReason : null,
    exactPathSatisfied: quality.exactPathSatisfied !== false,
    personalizationApplied: quality.personalizationApplied === true,
    personalizedHitCount: typeof quality.personalizedHitCount === "number" ? quality.personalizedHitCount : 0,
    averagePersonalizationBoost:
      typeof quality.averagePersonalizationBoost === "number" ? quality.averagePersonalizationBoost : 0,
    organizationalMemoryHitCount:
      typeof quality.organizationalMemoryHitCount === "number" ? quality.organizationalMemoryHitCount : 0,
    codeHitCount: typeof quality.codeHitCount === "number" ? quality.codeHitCount : 0,
    reviewHitCount: typeof quality.reviewHitCount === "number" ? quality.reviewHitCount : 0,
    executableEvidenceHitCount,
    degradedReasons,
    hitPaths,
    hitSourceTypes,
    topHitPath: typeof firstHit.path === "string" ? firstHit.path : null,
    topHitSourceType: typeof firstHit.sourceType === "string" ? firstHit.sourceType : null,
    topHitArtifactKind:
      typeof firstHit.documentMetadata === "object"
        && firstHit.documentMetadata !== null
        && !Array.isArray(firstHit.documentMetadata)
        && typeof firstHit.documentMetadata.artifactKind === "string"
        ? firstHit.documentMetadata.artifactKind
        : null,
  };
}

export function summarizeKnowledgeQualityGate(summary) {
  const readinessGate = asRecord(summary?.readinessGate);
  const functionalReadinessGate = asRecord(summary?.functionalReadinessGate);
  const historicalHygieneGate = asRecord(summary?.historicalHygieneGate);
  const failures = Array.isArray(readinessGate.failures)
    ? readinessGate.failures.filter((value) => typeof value === "string")
    : [];
  const functionalFailures = Array.isArray(functionalReadinessGate.failures)
    ? functionalReadinessGate.failures.filter((value) => typeof value === "string")
    : [];
  const historicalFailures = Array.isArray(historicalHygieneGate.failures)
    ? historicalHygieneGate.failures.filter((value) => typeof value === "string")
    : [];
  const perProject = Array.isArray(summary?.perProject) ? summary.perProject : [];
  const perRole = Array.isArray(summary?.perRole) ? summary.perRole : [];
  return {
    status: typeof readinessGate.status === "string" ? readinessGate.status : null,
    failures,
    functionalStatus: typeof functionalReadinessGate.status === "string" ? functionalReadinessGate.status : null,
    functionalFailures,
    historicalStatus: typeof historicalHygieneGate.status === "string" ? historicalHygieneGate.status : null,
    historicalFailures,
    totalRuns: typeof summary?.totalRuns === "number" ? summary.totalRuns : 0,
    candidateCacheHitRate:
      typeof summary?.candidateCacheHitRate === "number" ? summary.candidateCacheHitRate : 0,
    finalCacheHitRate:
      typeof summary?.finalCacheHitRate === "number" ? summary.finalCacheHitRate : 0,
    multiHopGraphExpandedRuns:
      typeof summary?.multiHopGraphExpandedRuns === "number" ? summary.multiHopGraphExpandedRuns : 0,
    matchingProjectCount: perProject.filter((entry) => typeof entry?.projectId === "string").length,
    matchingRoleCount: perRole.filter((entry) => typeof entry?.role === "string").length,
  };
}

function readStringArray(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((entry) => typeof entry === "string" && entry.length > 0))];
}

export function summarizeProtocolCitationCoverage(messages) {
  const citationMessages = (Array.isArray(messages) ? messages : [])
    .map((message) => {
      const payload = asRecord(message?.payload);
      const citations = Array.isArray(payload.evidenceCitations)
        ? payload.evidenceCitations.filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
        : [];
      return { message, citations };
    })
    .filter((entry) => entry.citations.length > 0)
    .sort((left, right) => new Date(right.message?.createdAt ?? 0).getTime() - new Date(left.message?.createdAt ?? 0).getTime());

  const messageTypeCounts = {};
  const retrievalRunIds = new Set();
  const briefIds = new Set();
  const citedPaths = new Set();
  const citedSourceTypes = new Set();
  const citedSummaryKinds = new Set();
  let citationCount = 0;

  for (const entry of citationMessages) {
    const messageType = typeof entry.message?.messageType === "string" ? entry.message.messageType : "UNKNOWN";
    messageTypeCounts[messageType] = (messageTypeCounts[messageType] ?? 0) + 1;
    for (const citation of entry.citations) {
      citationCount += 1;
      if (typeof citation.retrievalRunId === "string" && citation.retrievalRunId.length > 0) {
        retrievalRunIds.add(citation.retrievalRunId);
      }
      if (typeof citation.briefId === "string" && citation.briefId.length > 0) {
        briefIds.add(citation.briefId);
      }
      for (const citedPath of readStringArray(citation.citedPaths)) citedPaths.add(citedPath);
      for (const citedSourceType of readStringArray(citation.citedSourceTypes)) citedSourceTypes.add(citedSourceType);
      for (const citedSummaryKind of readStringArray(citation.citedSummaryKinds)) citedSummaryKinds.add(citedSummaryKind);
    }
  }

  return {
    messageCount: citationMessages.length,
    citationCount,
    messageTypeCounts,
    retrievalRunIds: [...retrievalRunIds],
    briefIds: [...briefIds],
    citedPaths: [...citedPaths],
    citedSourceTypes: [...citedSourceTypes],
    citedSummaryKinds: [...citedSummaryKinds],
    latestMessageType: typeof citationMessages[0]?.message?.messageType === "string" ? citationMessages[0].message.messageType : null,
    latestMessageAt: citationMessages[0]?.message?.createdAt ? new Date(citationMessages[0].message.createdAt) : null,
  };
}

export function summarizeCitationCoverageGate(coverage, options = {}) {
  const record = asRecord(coverage);
  const requiredMessageTypes = readStringArray(options.requiredMessageTypes);
  const requiredSourceTypes = readStringArray(options.requiredSourceTypes);
  const messageTypeCounts =
    record.messageTypeCounts && typeof record.messageTypeCounts === "object" && !Array.isArray(record.messageTypeCounts)
      ? record.messageTypeCounts
      : {};
  const failures = [];

  if ((record.messageCount ?? 0) <= 0) failures.push("citation_message_missing");
  if ((record.citationCount ?? 0) <= 0) failures.push("citation_entry_missing");
  if (readStringArray(record.retrievalRunIds).length <= 0) failures.push("citation_retrieval_run_missing");
  if (readStringArray(record.citedPaths).length <= 0) failures.push("citation_path_missing");
  if (readStringArray(record.citedSourceTypes).length <= 0) failures.push("citation_source_type_missing");

  for (const messageType of requiredMessageTypes) {
    if ((messageTypeCounts[messageType] ?? 0) <= 0) {
      failures.push(`citation_message_type_missing:${messageType}`);
    }
  }

  if (
    requiredSourceTypes.length > 0
    && !requiredSourceTypes.some((sourceType) => readStringArray(record.citedSourceTypes).includes(sourceType))
  ) {
    failures.push(`citation_required_source_types_missing:${requiredSourceTypes.join(",")}`);
  }

  return {
    status: failures.length === 0 ? "pass" : "fail",
    failures,
    messageCount: typeof record.messageCount === "number" ? record.messageCount : 0,
    citationCount: typeof record.citationCount === "number" ? record.citationCount : 0,
    retrievalRunCount: readStringArray(record.retrievalRunIds).length,
    citedPathCount: readStringArray(record.citedPaths).length,
    citedSourceTypeCount: readStringArray(record.citedSourceTypes).length,
  };
}
