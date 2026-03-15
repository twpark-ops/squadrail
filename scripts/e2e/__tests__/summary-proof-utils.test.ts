import { describe, expect, it } from "vitest";
import {
  compareDomainAwareProofRuns,
  normalizeDomainAwareProofEntry,
  normalizeDomainAwareProofResultSet,
} from "../summary-proof-utils.mjs";

describe("summary-proof-utils", () => {
  it("normalizes single proof entries", () => {
    expect(
      normalizeDomainAwareProofEntry({
        scenario: "workflow_mismatch_diagnostics",
        previewScore: 10,
        overallScore: 18,
        selectedProjectName: "swiftcl",
        deliveryClosed: true,
      }),
    ).toEqual({
      scenario: "workflow_mismatch_diagnostics",
      previewScore: 10,
      previewMaxScore: null,
      deliveryScore: null,
      deliveryMaxScore: null,
      overallScore: 18,
      overallMaxScore: null,
      selectedProjectName: "swiftcl",
      issueIdentifier: null,
      deliveryClosed: true,
    });
  });

  it("normalizes artifact wrappers and compares baseline/current deltas", () => {
    const diff = compareDomainAwareProofRuns({
      baseline: {
        version: 1,
        fixture: { companyName: "baseline-fixture" },
        results: [
          {
            scenario: "workflow_mismatch_diagnostics",
            previewScore: 10,
            deliveryScore: 8,
            overallScore: 18,
            selectedProjectName: "swiftcl",
            deliveryClosed: true,
          },
          {
            scenario: "multi_destination_artifact_routing",
            previewScore: 8,
            deliveryScore: 8,
            overallScore: 16,
            selectedProjectName: "swiftsight-report-server",
            deliveryClosed: true,
          },
        ],
      },
      current: normalizeDomainAwareProofResultSet([
        {
          scenario: "workflow_mismatch_diagnostics",
          previewScore: 12,
          deliveryScore: 8,
          overallScore: 20,
          selectedProjectName: "swiftsight-cloud",
          deliveryClosed: true,
        },
        {
          scenario: "multi_destination_artifact_routing",
          previewScore: 12,
          deliveryScore: 8,
          overallScore: 20,
          selectedProjectName: "swiftcl",
          deliveryClosed: true,
        },
      ]),
    });

    expect(diff.summary).toEqual({
      baselineScenarioCount: 2,
      currentScenarioCount: 2,
      improvedScenarioCount: 2,
      regressedScenarioCount: 0,
      changedProjectSelectionCount: 2,
      missingScenarioCount: 0,
      newScenarioCount: 0,
      improvedScenarios: ["workflow_mismatch_diagnostics", "multi_destination_artifact_routing"],
      regressedScenarios: [],
      changedProjectSelectionScenarios: ["workflow_mismatch_diagnostics", "multi_destination_artifact_routing"],
    });
    expect(diff.scenarioDiffs[0]).toMatchObject({
      scenario: "workflow_mismatch_diagnostics",
      baselineSelectedProjectName: "swiftcl",
      currentSelectedProjectName: "swiftsight-cloud",
      previewScoreDelta: 2,
      deliveryScoreDelta: 0,
      overallScoreDelta: 2,
      deliveryClosedMaintained: true,
      improved: true,
      regressed: false,
    });
  });

  it("treats missing baseline scenarios in the current run as regressions", () => {
    const diff = compareDomainAwareProofRuns({
      baseline: {
        version: 1,
        fixture: { companyName: "baseline-fixture" },
        results: [
          {
            scenario: "workflow_mismatch_diagnostics",
            previewScore: 10,
            deliveryScore: 8,
            overallScore: 18,
            selectedProjectName: "swiftcl",
            deliveryClosed: true,
          },
          {
            scenario: "multi_destination_artifact_routing",
            previewScore: 8,
            deliveryScore: 8,
            overallScore: 16,
            selectedProjectName: "swiftsight-report-server",
            deliveryClosed: true,
          },
        ],
      },
      current: {
        version: 1,
        fixture: { companyName: "current-fixture" },
        results: [
          {
            scenario: "workflow_mismatch_diagnostics",
            previewScore: 12,
            deliveryScore: 8,
            overallScore: 20,
            selectedProjectName: "swiftsight-cloud",
            deliveryClosed: true,
          },
        ],
      },
    });

    expect(diff.summary).toEqual({
      baselineScenarioCount: 2,
      currentScenarioCount: 1,
      improvedScenarioCount: 1,
      regressedScenarioCount: 1,
      changedProjectSelectionCount: 2,
      missingScenarioCount: 1,
      newScenarioCount: 0,
      improvedScenarios: ["workflow_mismatch_diagnostics"],
      regressedScenarios: ["multi_destination_artifact_routing"],
      changedProjectSelectionScenarios: ["workflow_mismatch_diagnostics", "multi_destination_artifact_routing"],
    });
    expect(diff.scenarioDiffs[1]).toMatchObject({
      scenario: "multi_destination_artifact_routing",
      baselineSelectedProjectName: "swiftsight-report-server",
      currentSelectedProjectName: null,
      previewScoreDelta: null,
      deliveryScoreDelta: null,
      overallScoreDelta: null,
      deliveryClosedMaintained: false,
      missingInCurrent: true,
      newInCurrent: false,
      improved: false,
      regressed: true,
    });
  });
});
