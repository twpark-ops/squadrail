import { describe, expect, it } from "vitest";
import { applyExecutionLanePolicy, deriveProductLane, isComplexIntake, resolveExecutionLane } from "../services/execution-lanes.js";

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

  describe("isComplexIntake", () => {
    const simple = {
      explicitQaRequested: false,
      coordinationOnly: false,
      crossProjectCount: 1,
      priority: "medium" as const,
      requiredKnowledgeTagCount: 0,
    };

    it("returns false for simple intake signals", () => {
      expect(isComplexIntake(simple)).toBe(false);
    });

    it("returns true when QA is explicitly requested", () => {
      expect(isComplexIntake({ ...simple, explicitQaRequested: true })).toBe(true);
    });

    it("returns true for coordination-only issues", () => {
      expect(isComplexIntake({ ...simple, coordinationOnly: true })).toBe(true);
    });

    it("returns true for cross-project issues", () => {
      expect(isComplexIntake({ ...simple, crossProjectCount: 2 })).toBe(true);
    });

    it("returns true for critical priority", () => {
      expect(isComplexIntake({ ...simple, priority: "critical" })).toBe(true);
    });

    it("returns true when knowledge tags exceed threshold", () => {
      expect(isComplexIntake({ ...simple, requiredKnowledgeTagCount: 3 })).toBe(true);
    });

    it("returns false at exactly 2 knowledge tags", () => {
      expect(isComplexIntake({ ...simple, requiredKnowledgeTagCount: 2 })).toBe(false);
    });
  });

  describe("deriveProductLane", () => {
    const fast = {
      qaAgentId: null,
      hasSubtasks: false,
      crossProject: false,
      coordinationOnly: false,
      priority: "medium" as const,
    };

    it("returns fast for simple signals", () => {
      expect(deriveProductLane(fast)).toBe("fast");
    });

    it("returns full when QA is assigned", () => {
      expect(deriveProductLane({ ...fast, qaAgentId: "qa-1" })).toBe("full");
    });

    it("returns full when subtasks exist", () => {
      expect(deriveProductLane({ ...fast, hasSubtasks: true })).toBe("full");
    });

    it("returns full for cross-project", () => {
      expect(deriveProductLane({ ...fast, crossProject: true })).toBe("full");
    });

    it("returns full for critical priority", () => {
      expect(deriveProductLane({ ...fast, priority: "critical" })).toBe("full");
    });
  });
});
