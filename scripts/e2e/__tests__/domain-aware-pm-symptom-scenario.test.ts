import { describe, expect, it } from "vitest";
import {
  evaluateDomainAwarePmPreview,
  resolveDomainAwarePmScenario,
} from "../domain-aware-pm-scenarios.mjs";
import { evaluateDomainAwarePmDelivery } from "../cloud-swiftsight-domain-aware-pm-eval.mjs";

describe("domain-aware PM symptom-first scenario", () => {
  it("keeps the Siemens symptom scenario project-agnostic in the user request", () => {
    const scenario = resolveDomainAwarePmScenario("siemens_series_name_cloud_routing");

    expect(scenario.expectedPrimaryProjects).toEqual(["swiftsight-cloud"]);
    expect(scenario.request.toLowerCase()).not.toContain("swiftsight-cloud");
    expect(scenario.request.toLowerCase()).toContain("siemens");
    expect(scenario.request).toContain("ProtocolName");
    expect(scenario.request).toContain("SeriesDescription");
  });

  it("scores preview as a fast-lane cloud routing when PM selects swiftsight-cloud without QA", () => {
    const scenario = resolveDomainAwarePmScenario("siemens_series_name_cloud_routing");

    const preview = {
      selectedProjectName: "swiftsight-cloud",
      projectCandidates: [
        { projectName: "swiftsight-cloud", score: 0.92, reasons: ["series_name storage path"] },
        { projectName: "swiftsight-agent", score: 0.31, reasons: ["vendor metadata source"] },
      ],
      staffing: {
        implementationAssigneeAgentId: "engineer-1",
        techLeadAgentId: "tl-1",
        reviewerAgentId: "reviewer-1",
        qaAgentId: null,
      },
      draft: {
        coordinationOnly: false,
        root: {
          acceptanceCriteria: [
            "Siemens series_name follows ProtocolName semantics where required",
            "Cloud storage path is corrected without breaking other vendors",
          ],
          definitionOfDone: [
            "Focused verification passes",
            "Routing stays inside swiftsight-cloud",
            "Regression path is documented in review evidence",
          ],
        },
        workItems: [{ id: "work-1" }],
      },
      warnings: [],
    };

    const evaluation = evaluateDomainAwarePmPreview(preview, scenario);

    expect(evaluation.checks.selectedPrimaryProject).toBe(true);
    expect(evaluation.checks.topProjectCoverage).toBe(true);
    expect(evaluation.checks.fastLaneCorrect).toBe(true);
    expect(evaluation.maxScore).toBe(14);
  });

  it("flags non-fast-lane previews when a human-board scenario still looks like a fast lane", () => {
    const scenario = resolveDomainAwarePmScenario("workflow_mismatch_diagnostics");
    const preview = {
      selectedProjectName: "swiftsight-cloud",
      projectCandidates: [
        { projectName: "swiftsight-cloud", score: 0.84, reasons: ["operator diagnostics"] },
      ],
      staffing: {
        implementationAssigneeAgentId: "engineer-1",
        techLeadAgentId: "tl-1",
        reviewerAgentId: "reviewer-1",
        qaAgentId: null,
      },
      draft: {
        coordinationOnly: false,
        root: {
          acceptanceCriteria: [
            "Operators can explain why workflow matching failed for a study",
            "Patient identifiers remain masked",
            "Relevant cloud settings evidence is attached",
          ],
          definitionOfDone: [
            "Operator-facing diagnostics render clearly",
            "Evidence is linked",
            "Focused verification passes",
          ],
        },
        workItems: [{ id: "work-1" }],
      },
      warnings: [],
    };

    const evaluation = evaluateDomainAwarePmPreview(preview, scenario);

    expect(evaluation.checks.selectedPrimaryProject).toBe(true);
    expect(evaluation.checks.fastLaneCorrect).toBe(false);
  });

  it("requires retrieval evidence and engineer ownership for the Siemens symptom delivery", async () => {
    const scenario = resolveDomainAwarePmScenario("siemens_series_name_cloud_routing");
    const delivery = {
      projectedChildCount: 1,
      rootWorkflowState: "assigned",
      childResults: [
        {
          issueId: "child-1",
          finalWorkflowState: "done",
          clarificationMode: "none",
          askMessageId: null,
          implementationAssigneeAgentId: "engineer-1",
          finalPrimaryEngineerAgentId: "engineer-1",
          finalTechLeadAgentId: "tl-1",
          retrievalRunIds: ["run-1"],
        },
      ],
    };

    const evaluation = await evaluateDomainAwarePmDelivery(delivery, scenario, {
      fetchRetrievalRunHits: async (runId) => ({
        retrievalRun: { id: runId },
        hits: [
          {
            documentPath: "internal/server/registry/workflow_execution.go",
            documentTitle: "workflow_execution.go",
            headingPath: "registry persistence",
            symbolName: "persistSeriesName",
            textContent: "SeriesName is persisted into the registry workflow execution path after DICOM metadata normalization.",
          },
        ],
      }),
    });

    expect(evaluation.checks.childDeliveryClosed).toBe(true);
    expect(evaluation.checks.retrievalUsed).toBe(true);
    expect(evaluation.checks.knowledgePathCoverage).toBe(true);
    expect(evaluation.checks.implementationOwnerMatched).toBe(true);
    expect(evaluation.maxScore).toBe(14);
    expect(evaluation.score).toBe(14);
  });

  it("fails clarification-free delivery checks when a symptom-first flow still asks the board", async () => {
    const scenario = resolveDomainAwarePmScenario("siemens_series_name_cloud_routing");
    const delivery = {
      projectedChildCount: 1,
      rootWorkflowState: "assigned",
      childResults: [
        {
          issueId: "child-1",
          finalWorkflowState: "done",
          clarificationMode: "human_board",
          askMessageId: "msg-1",
          implementationAssigneeAgentId: "engineer-1",
          finalPrimaryEngineerAgentId: "engineer-1",
          finalTechLeadAgentId: "tl-1",
          retrievalRunIds: ["run-1"],
        },
      ],
    };

    const evaluation = await evaluateDomainAwarePmDelivery(delivery, scenario, {
      fetchRetrievalRunHits: async (runId) => ({
        retrievalRun: { id: runId },
        hits: [
          {
            documentPath: "internal/server/registry/workflow_execution.go",
            documentTitle: "workflow_execution.go",
            headingPath: "registry persistence",
            symbolName: "persistSeriesName",
            textContent: "SeriesName is persisted into the registry workflow execution path after DICOM metadata normalization.",
          },
        ],
      }),
    });

    expect(evaluation.checks.clarificationModeMatched).toBe(false);
    expect(evaluation.checks.clarificationRecorded).toBe(false);
    expect(evaluation.clarificationLoopEvaluation.failures).toEqual(
      expect.arrayContaining(["clarificationModeMatched", "clarificationRecorded"]),
    );
  });

  it("requires linked answers, blocked close, resume, and retrieval after clarification for board-driven scenarios", async () => {
    const scenario = resolveDomainAwarePmScenario("workflow_mismatch_diagnostics");
    const delivery = {
      projectedChildCount: 1,
      rootWorkflowState: "assigned",
      childResults: [
        {
          issueId: "child-1",
          finalWorkflowState: "done",
          clarificationMode: "human_board",
          askMessageId: "ask-1",
          askMessageSeq: 4,
          answerMessageId: "answer-1",
          answerMessageSeq: 6,
          answerCausalMessageId: "ask-1",
          closeBlockedWhileClarificationPending: true,
          resumedWorkflowState: "implementing",
          retrievalRunIdsAfterClarification: ["run-2"],
          implementationAssigneeAgentId: "engineer-1",
          finalPrimaryEngineerAgentId: "engineer-1",
          finalTechLeadAgentId: "tl-1",
          retrievalRunIds: ["run-1", "run-2"],
        },
      ],
    };

    const evaluation = await evaluateDomainAwarePmDelivery(delivery, scenario, {
      fetchRetrievalRunHits: async (runId) => ({
        retrievalRun: { id: runId },
        hits: [
          {
            documentPath: "internal/server/settings/workflow_metadata.go",
            documentTitle: "workflow_metadata.go",
            headingPath: "matching diagnostics",
            symbolName: "describeWorkflowMismatch",
            textContent: `workflow mismatch diagnostic evidence for ${runId}`,
          },
        ],
      }),
    });

    expect(evaluation.checks.clarificationModeMatched).toBe(true);
    expect(evaluation.checks.clarificationRecorded).toBe(true);
    expect(evaluation.checks.clarificationAnswered).toBe(true);
    expect(evaluation.checks.clarificationAnswerLinked).toBe(true);
    expect(evaluation.checks.clarificationCloseBlockedWhilePending).toBe(true);
    expect(evaluation.checks.clarificationResumedToImplementing).toBe(true);
    expect(evaluation.checks.clarificationRetrievalAfterResume).toBe(true);
    expect(evaluation.clarificationLoopEvaluation.failures).toEqual([]);
  });
});
