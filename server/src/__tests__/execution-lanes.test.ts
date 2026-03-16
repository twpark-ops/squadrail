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

    it("returns true at exactly 3 knowledge tags (boundary crossing)", () => {
      expect(isComplexIntake({ ...simple, requiredKnowledgeTagCount: 3 })).toBe(true);
    });

    it("returns false for exactly 1 cross-project (boundary)", () => {
      expect(isComplexIntake({ ...simple, crossProjectCount: 1 })).toBe(false);
    });

    it("returns false for priority 'high' (only critical triggers complexity)", () => {
      expect(isComplexIntake({ ...simple, priority: "high" })).toBe(false);
    });

    it("returns false for priority 'low'", () => {
      expect(isComplexIntake({ ...simple, priority: "low" })).toBe(false);
    });

    it("returns false when all signals are at their non-complex boundary simultaneously", () => {
      expect(isComplexIntake({
        explicitQaRequested: false,
        coordinationOnly: false,
        crossProjectCount: 1,
        priority: "high",
        requiredKnowledgeTagCount: 2,
      })).toBe(false);
    });

    it("returns true when multiple complexity signals are true simultaneously", () => {
      expect(isComplexIntake({
        explicitQaRequested: true,
        coordinationOnly: true,
        crossProjectCount: 3,
        priority: "critical",
        requiredKnowledgeTagCount: 5,
      })).toBe(true);
    });

    it("returns true for crossProjectCount exactly 2 (first crossing)", () => {
      expect(isComplexIntake({ ...simple, crossProjectCount: 2 })).toBe(true);
    });

    it("returns false for zero knowledge tags", () => {
      expect(isComplexIntake({ ...simple, requiredKnowledgeTagCount: 0 })).toBe(false);
    });

    it("treats critical priority as complex even with 2 tags", () => {
      expect(isComplexIntake({
        explicitQaRequested: false,
        coordinationOnly: false,
        crossProjectCount: 1,
        priority: "critical",
        requiredKnowledgeTagCount: 2,
      })).toBe(true);
    });
  });

  it("returns deep for coordinationOnly issues", () => {
    expect(resolveExecutionLane({
      issueProjectId: "project-1",
      mentionedProjectCount: 1,
      labelNames: [],
      recipientRole: "engineer",
      messageType: "ASSIGN_TASK",
      coordinationOnly: true,
    })).toBe("deep");
  });

  it("returns deep for plan work items", () => {
    expect(resolveExecutionLane({
      issueProjectId: "project-1",
      mentionedProjectCount: 1,
      labelNames: [],
      recipientRole: "engineer",
      messageType: "ASSIGN_TASK",
      internalWorkItemKind: "plan",
    })).toBe("deep");
  });

  it("returns deep for REQUEST_HUMAN_DECISION", () => {
    expect(resolveExecutionLane({
      issueProjectId: "project-1",
      mentionedProjectCount: 1,
      labelNames: [],
      recipientRole: "engineer",
      messageType: "REQUEST_HUMAN_DECISION",
    })).toBe("deep");
  });

  it("returns deep for clarification-heavy questions", () => {
    expect(resolveExecutionLane({
      issueProjectId: "project-1",
      mentionedProjectCount: 1,
      labelNames: [],
      recipientRole: "engineer",
      messageType: "ASSIGN_TASK",
      questionType: "requirement",
    })).toBe("deep");
  });

  it("returns normal as default fallthrough", () => {
    expect(resolveExecutionLane({
      issueProjectId: "project-1",
      mentionedProjectCount: 1,
      labelNames: [],
      recipientRole: "engineer",
      messageType: "ASSIGN_TASK",
      workflowStateAfter: "assigned",
      exactPaths: ["src/a.ts", "src/b.ts", "lib/c.ts"],
      acceptanceCriteriaCount: 2,
      symbolHintCount: 3,
    })).toBe("normal");
  });

  it("blocks fast lane for reviewer recipient", () => {
    // This input would be fast except recipientRole is "reviewer"
    expect(resolveExecutionLane({
      issueProjectId: "project-1",
      mentionedProjectCount: 1,
      labelNames: [],
      recipientRole: "reviewer",
      messageType: "ASSIGN_TASK",
      workflowStateAfter: "assigned",
      exactPaths: ["src/a.ts"],
      acceptanceCriteriaCount: 2,
      symbolHintCount: 1,
    })).toBe("normal");
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

    it("returns full for coordinationOnly", () => {
      expect(deriveProductLane({ ...fast, coordinationOnly: true })).toBe("full");
    });

    it("returns fast when all signals are false simultaneously", () => {
      expect(deriveProductLane({
        qaAgentId: null,
        hasSubtasks: false,
        crossProject: false,
        coordinationOnly: false,
        priority: "low",
      })).toBe("fast");
    });

    it("returns fast for priority 'high' (only critical triggers full)", () => {
      expect(deriveProductLane({ ...fast, priority: "high" })).toBe("fast");
    });

    it("returns fast for priority 'medium'", () => {
      expect(deriveProductLane({ ...fast, priority: "medium" })).toBe("fast");
    });

    it("returns full when multiple signals are true simultaneously", () => {
      expect(deriveProductLane({
        qaAgentId: "qa-1",
        hasSubtasks: true,
        crossProject: true,
        coordinationOnly: true,
        priority: "critical",
      })).toBe("full");
    });

    it("returns full when only hasSubtasks is true (single signal)", () => {
      expect(deriveProductLane({
        qaAgentId: null,
        hasSubtasks: true,
        crossProject: false,
        coordinationOnly: false,
        priority: "medium",
      })).toBe("full");
    });

    it("returns full when only crossProject is true (single signal)", () => {
      expect(deriveProductLane({
        qaAgentId: null,
        hasSubtasks: false,
        crossProject: true,
        coordinationOnly: false,
        priority: "medium",
      })).toBe("full");
    });

    it("returns full when only coordinationOnly is true (single signal)", () => {
      expect(deriveProductLane({
        qaAgentId: null,
        hasSubtasks: false,
        crossProject: false,
        coordinationOnly: true,
        priority: "medium",
      })).toBe("full");
    });
  });
});
