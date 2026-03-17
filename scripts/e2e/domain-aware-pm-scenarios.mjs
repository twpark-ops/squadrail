export const DOMAIN_AWARE_PM_SCENARIOS = {
  workflow_mismatch_diagnostics: {
    key: "workflow_mismatch_diagnostics",
    label: "workflow mismatch diagnostics",
    request: [
      "특정 MR study가 왜 workflow에 매칭되지 않았는지 운영자가 설명 가능하게 보여줘.",
      "",
      "- 실패하면 어떤 조건이 안 맞았는지도 보여줘",
      "- 운영자가 study 단위로 빠르게 판단할 수 있어야 해",
      "- 환자 정보는 과하게 노출하지 말아야 해",
    ].join("\n"),
    expectedPrimaryProjects: ["swiftsight-cloud"],
    expectedTopProjects: ["swiftsight-cloud"],
    requiredKnowledgeTags: ["workflow-matching", "dicom-metadata", "operator-diagnostics"],
    minimumAcceptanceCriteria: 3,
    clarificationMode: "human_board",
    manualReviewChecklist: [
      "PM이 Settings/Trigger 경계와 swiftcl matching 책임을 구분했는가",
      "PHI 노출 수준을 clarification으로 질문했는가",
      "operator surface인지 internal diagnostics인지 구분했는가",
    ],
  },
  pacs_delivery_audit_evidence: {
    key: "pacs_delivery_audit_evidence",
    label: "PACS delivery audit evidence",
    request: [
      "PACS 전달이 실패했을 때 cloud와 agent 양쪽 evidence를 한 번에 추적할 수 있게 해줘.",
      "",
      "- 어떤 단계에서 실패했는지 운영자가 바로 알아야 해",
      "- retry 중간 시도와 최종 실패를 구분해서 봐야 해",
      "- endpoint 정보는 필요 이상으로 노출하지 말아야 해",
    ].join("\n"),
    expectedPrimaryProjects: ["swiftsight-cloud", "swiftsight-agent"],
    expectedTopProjects: ["swiftsight-cloud", "swiftsight-agent"],
    requiredKnowledgeTags: ["pacs-delivery", "audit-evidence", "retry-trace"],
    minimumAcceptanceCriteria: 3,
    clarificationMode: "human_board",
    manualReviewChecklist: [
      "PM이 cloud와 agent를 coordination 대상으로 인식했는가",
      "retry attempt와 final failure evidence를 분리해서 다뤘는가",
      "PACS endpoint/PHI 마스킹 정책을 clarification으로 다뤘는가",
    ],
  },
  multi_destination_artifact_routing: {
    key: "multi_destination_artifact_routing",
    label: "multi-destination artifact routing",
    request: [
      "같은 분석에서 segmentation artifact는 PACS A와 PACS B로 보내고, physician report는 PACS A에만 보내는 설정을 지원해줘.",
      "",
      "- 설정과 실행 결과가 서로 다르게 보이면 안 돼",
      "- 잘못된 destination policy는 미리 막아야 해",
      "- focused verification이면 충분해",
    ].join("\n"),
    expectedPrimaryProjects: ["swiftcl", "swiftsight-cloud"],
    expectedTopProjects: ["swiftcl", "swiftsight-cloud", "swiftsight-agent"],
    requiredKnowledgeTags: ["artifact-routing", "pacs-destinations", "workflow-compiler"],
    minimumAcceptanceCriteria: 3,
    clarificationMode: "reviewer",
    manualReviewChecklist: [
      "PM이 compile-time policy와 runtime delivery 책임을 구분했는가",
      "swiftcl, swiftsight-cloud, swiftsight-agent의 경계를 제대로 읽었는가",
      "partial delivery failure와 validation 정책을 acceptance criteria에 반영했는가",
    ],
  },
  simple_storage_logging: {
    key: "simple_storage_logging",
    label: "simple storage logging (fast lane)",
    request: [
      "SafeJoin 함수에 디버그 로깅을 추가해서 path 정규화 과정을 운영자가 추적할 수 있게 해줘.",
      "",
      "- 기존 동작 변경 없이 로깅만 추가",
      "- 빠른 turnaround이 중요해",
    ].join("\n"),
    expectedPrimaryProjects: ["swiftsight-agent"],
    expectedTopProjects: ["swiftsight-agent"],
    requiredKnowledgeTags: ["storage", "logging"],
    minimumAcceptanceCriteria: 1,
    clarificationMode: "reviewer",
    manualReviewChecklist: [
      "PM이 스코프를 단일 파일 수정으로 좁게 유지했는가",
      "QA gate 없이 reviewer 직접 승인 경로를 선택했는가",
    ],
  },
  siemens_series_name_cloud_routing: {
    key: "siemens_series_name_cloud_routing",
    label: "Siemens series_name cloud routing",
    request: [
      "Siemens 벤더 DICOM에서 series_name이 DB에 ProtocolName(0018,1030) 대신 SeriesDescription(0008,103E) 값으로 저장되는 문제를 고쳐줘.",
      "",
      "- 사용자는 어떤 프로젝트를 고쳐야 하는지 모르는 상태라고 가정해",
      "- Siemens만 다르게 판단되어야 하고 GE/Philips 동작은 깨지면 안 돼",
      "- 어떤 경로에서 DB series_name이 저장되는지 먼저 파악해야 해",
      "- focused verification이면 충분해",
    ].join("\n"),
    expectedPrimaryProjects: ["swiftsight-cloud"],
    expectedTopProjects: ["swiftsight-cloud"],
    requiredKnowledgeTags: ["dicom-metadata", "series-name"],
    minimumAcceptanceCriteria: 2,
    clarificationMode: "none",
    expectedImplementationOwner: "engineer_assigned",
    expectedKnowledgePathHints: [
      "internal/server/settings/workflow_metadata.go",
      "internal/server/temporal/service.go",
      "internal/server/registry/workflow_execution.go",
    ],
    minimumKnowledgePathMatches: 1,
    manualReviewChecklist: [
      "입력에 프로젝트 힌트를 주지 않았는데도 PM이 swiftsight-cloud를 primary project로 선택했는가",
      "retrieval이 workflow_metadata, temporal service, registry workflow execution처럼 cloud 쪽 저장/입력 경로를 실제로 잡았는가",
      "더 깊은 근거가 필요하면 usage_events.go, report_activity.go, series_name migration까지 사람이 추가 확인할 수 있는가",
      "TL 판단 이후 engineer implementation owner가 배정되고 최종 ownership이 engineer에 묶였는가",
    ],
  },
};

export function listDomainAwarePmScenarioKeys() {
  return Object.keys(DOMAIN_AWARE_PM_SCENARIOS);
}

export function resolveDomainAwarePmScenario(inputKey) {
  const normalized = typeof inputKey === "string" ? inputKey.trim() : "";
  const scenario = DOMAIN_AWARE_PM_SCENARIOS[normalized];
  if (!scenario) {
    const supported = listDomainAwarePmScenarioKeys().join(", ");
    throw new Error(`Unsupported domain-aware PM scenario: ${normalized}. Supported: ${supported}`);
  }
  return scenario;
}

function normalizeProjectName(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function evaluateDomainAwarePmPreview(preview, scenario) {
  const selectedProjectName = normalizeProjectName(preview?.selectedProjectName);
  const candidates = Array.isArray(preview?.projectCandidates) ? preview.projectCandidates : [];
  const topCandidates = candidates
    .slice(0, 3)
    .map((candidate) => normalizeProjectName(candidate?.projectName))
    .filter(Boolean);
  const workItems = Array.isArray(preview?.draft?.workItems) ? preview.draft.workItems : [];
  const acceptanceCriteria = Array.isArray(preview?.draft?.root?.acceptanceCriteria)
    ? preview.draft.root.acceptanceCriteria
    : [];
  const definitionOfDone = Array.isArray(preview?.draft?.root?.definitionOfDone)
    ? preview.draft.root.definitionOfDone
    : [];
  const warnings = Array.isArray(preview?.warnings) ? preview.warnings : [];

  const expectedPrimaryProjects = scenario.expectedPrimaryProjects.map(normalizeProjectName);
  const expectedTopProjects = scenario.expectedTopProjects.map(normalizeProjectName);

  const checks = {
    selectedPrimaryProject: expectedPrimaryProjects.includes(selectedProjectName),
    topProjectCoverage: expectedTopProjects.every((project) => topCandidates.includes(project)),
    workItemPresent: workItems.length > 0,
    acceptanceCriteriaSufficient: acceptanceCriteria.length >= scenario.minimumAcceptanceCriteria,
    definitionOfDoneSufficient: definitionOfDone.length >= 3,
    projectConfidenceWarning: warnings.includes("project_match_low_confidence"),
  };

  let score = 0;
  if (checks.selectedPrimaryProject) score += 2;
  if (checks.topProjectCoverage) score += 2;
  if (checks.workItemPresent) score += 2;
  if (checks.acceptanceCriteriaSufficient) score += 2;
  if (checks.definitionOfDoneSufficient) score += 2;
  if (!checks.projectConfidenceWarning) score += 2;

  // Fast lane verification: mirror isComplexIntake() logic from execution-lanes.ts.
  // Complex = explicitQa OR coordinationOnly OR crossProject>1 OR critical OR tags>2.
  const qaAssigned = Boolean(preview?.staffing?.qaAgentId);
  const tags = (scenario.requiredKnowledgeTags ?? []).length;
  const scenarioPriority = scenario.priority ?? "high";
  const isFastLaneScenario = tags <= 2
    && scenarioPriority !== "critical"
    && scenario.clarificationMode !== "human_board"  // human_board implies coordinationOnly
    && (scenario.expectedTopProjects ?? []).length <= 1;  // single project
  const fastLaneCorrect = isFastLaneScenario ? !qaAssigned : qaAssigned || true;
  if (fastLaneCorrect && isFastLaneScenario) score += 2;

  return {
    score,
    maxScore: isFastLaneScenario ? 14 : 12,
    checks: { ...checks, fastLaneCorrect },
    selectedProjectName: preview?.selectedProjectName ?? null,
    topCandidates: candidates.slice(0, 3).map((candidate) => ({
      projectName: candidate?.projectName ?? null,
      score: candidate?.score ?? null,
      reasons: Array.isArray(candidate?.reasons) ? candidate.reasons : [],
    })),
    staffing: preview?.staffing ?? null,
    warnings,
    workItemCount: workItems.length,
    acceptanceCriteriaCount: acceptanceCriteria.length,
    definitionOfDoneCount: definitionOfDone.length,
    manualReviewChecklist: scenario.manualReviewChecklist,
  };
}
