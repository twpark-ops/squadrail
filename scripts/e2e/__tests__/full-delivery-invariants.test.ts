import { describe, expect, it } from "vitest";
import {
  assertCanonicalScenarioOne,
  evaluateCanonicalScenarioOne,
} from "../full-delivery-invariants.mjs";

function makeMessage(type, overrides = {}) {
  return {
    id: `${type}-1`,
    messageType: type,
    workflowStateBefore: "todo",
    workflowStateAfter: "todo",
    payload: {},
    artifacts: [],
    ...overrides,
  };
}

describe("full delivery scenario 1 invariants", () => {
  it("passes when canonical full-delivery loop closes with the expected staffing and artifacts", () => {
    const evaluation = assertCanonicalScenarioOne({
      expectedProjectId: "project-1",
      expectedStaffing: {
        techLeadAgentId: "tl-1",
        engineerAgentId: "eng-1",
        reviewerAgentId: "rev-1",
      },
      projectionPreview: {
        selectedProjectId: "project-1",
        staffing: {
          techLeadAgentId: "tl-1",
          implementationAssigneeAgentId: "eng-1",
          reviewerAgentId: "rev-1",
        },
      },
      rootSnapshot: {
        protocolMessages: [makeMessage("ASSIGN_TASK")],
      },
      deliverySnapshot: {
        issue: { id: "issue-1", identifier: "DEL-2" },
        protocolState: {
          workflowState: "done",
          primaryEngineerAgentId: "eng-1",
        },
        protocolMessages: [
          makeMessage("ASSIGN_TASK"),
          makeMessage("ACK_ASSIGNMENT"),
          makeMessage("START_IMPLEMENTATION"),
          makeMessage("SUBMIT_FOR_REVIEW", {
            artifacts: [{ kind: "diff" }, { kind: "test_run" }, { kind: "build_run" }],
          }),
          makeMessage("START_REVIEW"),
          makeMessage("APPROVE_IMPLEMENTATION"),
          makeMessage("CLOSE_TASK", {
            payload: {
              mergeStatus: "pending_external_merge",
              finalArtifacts: ["pending_external_merge", "changed_files:src/release-label.js"],
            },
          }),
        ],
        briefs: [{ id: "brief-1" }],
        runs: [
          {
            runId: "run-1",
            resultJson: {
              workspaceGitSnapshot: {
                changedFiles: ["src/release-label.js"],
              },
            },
          },
        ],
      },
    });

    expect(evaluation.failures).toEqual([]);
    expect(evaluation.checks.finalWorkflowStateDone).toBe(true);
    expect(evaluation.checks.submitArtifactsComplete).toBe(true);
    expect(evaluation.checks.implementationOwnershipMatched).toBe(true);
  });

  it("reports missing artifacts and wrong final ownership as invariant failures", () => {
    const evaluation = evaluateCanonicalScenarioOne({
      expectedProjectId: "project-1",
      expectedStaffing: {
        techLeadAgentId: "tl-1",
        engineerAgentId: "eng-1",
        reviewerAgentId: "rev-1",
      },
      projectionPreview: {
        selectedProjectId: "project-2",
        staffing: {
          techLeadAgentId: "tl-1",
          implementationAssigneeAgentId: "eng-1",
          reviewerAgentId: "rev-1",
        },
      },
      rootSnapshot: {
        protocolMessages: [],
      },
      deliverySnapshot: {
        issue: { id: "issue-1" },
        protocolState: {
          workflowState: "approved",
          primaryEngineerAgentId: "tl-1",
        },
        protocolMessages: [
          makeMessage("ASSIGN_TASK"),
          makeMessage("ACK_ASSIGNMENT"),
          makeMessage("START_IMPLEMENTATION"),
          makeMessage("SUBMIT_FOR_REVIEW", {
            artifacts: [{ kind: "diff" }],
          }),
          makeMessage("START_REVIEW"),
        ],
        briefs: [{ id: "brief-1" }],
        runs: [],
      },
    });

    expect(evaluation.failures).toEqual(
      expect.arrayContaining([
        "selectedProjectMatched",
        "finalWorkflowStateDone",
        "rootAssignTaskRecorded",
        "requiredMessageTypesPresent",
        "implementationRunCaptured",
        "submitArtifactsComplete",
        "approvalRecorded",
        "closeRecorded",
        "closeUsesPendingExternalMerge",
        "implementationOwnershipMatched",
      ]),
    );
  });
});
