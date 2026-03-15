function asRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function readNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function normalizeDomainAwareProofEntry(value) {
  const record = asRecord(value);
  const scenario = readString(record.scenario);
  if (!scenario) return null;

  return {
    scenario,
    previewScore: readNumber(record.previewScore),
    previewMaxScore: readNumber(record.previewMaxScore),
    deliveryScore: readNumber(record.deliveryScore),
    deliveryMaxScore: readNumber(record.deliveryMaxScore),
    overallScore: readNumber(record.overallScore),
    overallMaxScore: readNumber(record.overallMaxScore),
    selectedProjectName: readString(record.selectedProjectName),
    issueIdentifier: readString(record.issueIdentifier),
    deliveryClosed: record.deliveryClosed === true,
  };
}

export function normalizeDomainAwareProofResultSet(value) {
  const record = asRecord(value);
  const rawResults = Array.isArray(value)
    ? value
    : asArray(record.results);
  const results = rawResults
    .map((entry) => normalizeDomainAwareProofEntry(entry))
    .filter((entry) => entry != null);

  return {
    version: readNumber(record.version) ?? 1,
    fixture: asRecord(record.fixture),
    results,
  };
}

export function compareDomainAwareProofRuns(input) {
  const baseline = normalizeDomainAwareProofResultSet(input.baseline);
  const current = normalizeDomainAwareProofResultSet(input.current);

  const baselineByScenario = new Map(
    baseline.results.map((entry) => [entry.scenario, entry]),
  );
  const currentByScenario = new Map(
    current.results.map((entry) => [entry.scenario, entry]),
  );
  const scenarioNames = Array.from(
    new Set([
      ...baseline.results.map((entry) => entry.scenario),
      ...current.results.map((entry) => entry.scenario),
    ]),
  );

  const scenarioDiffs = scenarioNames.map((scenario) => {
    const baselineEntry = baselineByScenario.get(scenario) ?? null;
    const currentEntry = currentByScenario.get(scenario) ?? null;
    const previewScoreDelta =
      baselineEntry?.previewScore == null || currentEntry?.previewScore == null
        ? null
        : currentEntry.previewScore - baselineEntry.previewScore;
    const deliveryScoreDelta =
      baselineEntry?.deliveryScore == null || currentEntry?.deliveryScore == null
        ? null
        : currentEntry.deliveryScore - baselineEntry.deliveryScore;
    const overallScoreDelta =
      baselineEntry?.overallScore == null || currentEntry?.overallScore == null
        ? null
        : currentEntry.overallScore - baselineEntry.overallScore;
    const missingInCurrent = baselineEntry != null && currentEntry == null;
    const newInCurrent = baselineEntry == null && currentEntry != null;

    return {
      scenario,
      baselineSelectedProjectName: baselineEntry?.selectedProjectName ?? null,
      currentSelectedProjectName: currentEntry?.selectedProjectName ?? null,
      selectedProjectChanged:
        (baselineEntry?.selectedProjectName ?? null) !== (currentEntry?.selectedProjectName ?? null),
      previewScoreDelta,
      deliveryScoreDelta,
      overallScoreDelta,
      deliveryClosedMaintained:
        baselineEntry == null
          ? currentEntry?.deliveryClosed === true
          : baselineEntry.deliveryClosed === true
            ? currentEntry?.deliveryClosed === true
            : currentEntry?.deliveryClosed === true,
      missingInCurrent,
      newInCurrent,
      improved:
        newInCurrent || (typeof overallScoreDelta === "number" && overallScoreDelta > 0),
      regressed:
        missingInCurrent || (typeof overallScoreDelta === "number" && overallScoreDelta < 0),
    };
  });

  const improvedScenarios = scenarioDiffs.filter((entry) => entry.improved).map((entry) => entry.scenario);
  const regressedScenarios = scenarioDiffs.filter((entry) => entry.regressed).map((entry) => entry.scenario);
  const changedProjectSelectionScenarios = scenarioDiffs
    .filter((entry) => entry.selectedProjectChanged)
    .map((entry) => entry.scenario);
  const missingScenarioCount = scenarioDiffs.filter((entry) => entry.missingInCurrent).length;
  const newScenarioCount = scenarioDiffs.filter((entry) => entry.newInCurrent).length;

  return {
    baselineFixture: baseline.fixture,
    currentFixture: current.fixture,
    scenarioDiffs,
    summary: {
      baselineScenarioCount: baseline.results.length,
      currentScenarioCount: current.results.length,
      improvedScenarioCount: improvedScenarios.length,
      regressedScenarioCount: regressedScenarios.length,
      changedProjectSelectionCount: changedProjectSelectionScenarios.length,
      missingScenarioCount,
      newScenarioCount,
      improvedScenarios,
      regressedScenarios,
      changedProjectSelectionScenarios,
    },
  };
}
