import { describe, expect, it } from "vitest";
import { applyExecutionLanePolicy, resolveExecutionLane } from "../services/execution-lanes.js";

describe("execution lanes", () => {
  it("prefers explicit lane label overrides", () => {
    expect(resolveExecutionLane({
      issueProjectId: "project-1",
      mentionedProjectCount: 3,
      labelNames: ["lane:fast", "cross-project"],
      recipientRole: "engineer",
      messageType: "ASSIGN_TASK",
      workflowStateAfter: "assigned",
      exactPaths: ["internal/storage/path.go"],
      acceptanceCriteriaCount: 2,
      symbolHintCount: 1,
    })).toBe("fast");
  });

  it("classifies narrow implementation work as fast lane", () => {
    expect(resolveExecutionLane({
      issueProjectId: "project-1",
      mentionedProjectCount: 1,
      labelNames: [],
      recipientRole: "engineer",
      messageType: "ASSIGN_TASK",
      workflowStateAfter: "implementing",
      exactPaths: ["internal/storage/path.go", "internal/storage/path_test.go"],
      acceptanceCriteriaCount: 2,
      symbolHintCount: 3,
    })).toBe("fast");
  });

  it("classifies cross-project or blocked work as deep lane", () => {
    expect(resolveExecutionLane({
      issueProjectId: "project-1",
      mentionedProjectCount: 2,
      labelNames: [],
      recipientRole: "tech_lead",
      messageType: "REASSIGN_TASK",
      workflowStateAfter: "assigned",
      blockerCode: "architecture_cross_project_alignment",
      exactPaths: ["internal/storage/path.go"],
      acceptanceCriteriaCount: 2,
      symbolHintCount: 1,
    })).toBe("deep");
  });

  it("applies fast and deep lane policy adjustments", () => {
    const fast = applyExecutionLanePolicy({
      lane: "fast",
      topKDense: 24,
      topKSparse: 24,
      rerankK: 20,
      finalK: 8,
      modelRerankCandidateCount: 10,
    });
    const deep = applyExecutionLanePolicy({
      lane: "deep",
      topKDense: 8,
      topKSparse: 8,
      rerankK: 8,
      finalK: 4,
      modelRerankCandidateCount: 4,
    });

    expect(fast).toMatchObject({
      lane: "fast",
      topKDense: 8,
      topKSparse: 8,
      rerankK: 10,
      finalK: 4,
      modelRerankCandidateCount: 4,
      chunkGraphMaxHops: 2,
      maxEvidenceItems: 4,
    });
    expect(deep).toMatchObject({
      lane: "deep",
      topKDense: 24,
      topKSparse: 24,
      rerankK: 28,
      finalK: 10,
      modelRerankCandidateCount: 8,
      chunkGraphMaxHops: 4,
      maxEvidenceItems: 8,
    });
  });
});
