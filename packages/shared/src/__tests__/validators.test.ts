import { describe, expect, it } from "vitest";
import { createIssueSchema, createInternalWorkItemSchema, updateIssueSchema } from "../validators/issue.js";
import { createIssueProtocolMessageSchema } from "../validators/protocol.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const uuid1 = "00000000-0000-1000-8000-000000000001";
const uuid2 = "00000000-0000-1000-8000-000000000002";
const uuid3 = "00000000-0000-1000-8000-000000000003";

function validAssignTaskMessage() {
  return {
    messageType: "ASSIGN_TASK" as const,
    sender: { actorType: "agent" as const, actorId: uuid1, role: "tech_lead" as const },
    recipients: [
      { recipientType: "agent" as const, recipientId: uuid2, role: "engineer" as const },
    ],
    workflowStateBefore: "backlog" as const,
    workflowStateAfter: "assigned" as const,
    summary: "Assign the initial implementation task",
    payload: {
      goal: "Implement feature X",
      acceptanceCriteria: ["AC-1"],
      definitionOfDone: ["DoD-1"],
      priority: "medium" as const,
      assigneeAgentId: uuid2,
      reviewerAgentId: uuid3,
    },
  };
}

function validInternalWorkItem() {
  return {
    title: "Implement auth module",
    kind: "implementation" as const,
    assigneeAgentId: uuid1,
    reviewerAgentId: uuid2,
    acceptanceCriteria: ["Users can log in"],
    definitionOfDone: ["Unit tests pass"],
  };
}

// ---------------------------------------------------------------------------
// Issue validators
// ---------------------------------------------------------------------------

describe("createIssueSchema", () => {
  it("accepts valid issue", () => {
    const input = { title: "Fix login bug" };
    const result = createIssueSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBe("Fix login bug");
      expect(result.data.status).toBe("backlog");
      expect(result.data.priority).toBe("medium");
    }
  });

  it("rejects empty title", () => {
    const result = createIssueSchema.safeParse({ title: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const titleIssue = result.error.issues.find((i) => i.path.includes("title"));
      expect(titleIssue).toBeDefined();
    }
  });
});

describe("createInternalWorkItemSchema", () => {
  it("rejects assignee === reviewer", () => {
    const input = { ...validInternalWorkItem(), reviewerAgentId: uuid1 }; // same as assignee
    const result = createInternalWorkItemSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.includes("reviewerAgentId"));
      expect(issue).toBeDefined();
      expect(issue!.message).toMatch(/Reviewer must be different from assignee/);
    }
  });

  it("rejects qa === assignee", () => {
    const input = { ...validInternalWorkItem(), qaAgentId: uuid1 }; // same as assignee
    const result = createInternalWorkItemSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.includes("qaAgentId"));
      expect(issue).toBeDefined();
      expect(issue!.message).toMatch(/QA must be different from assignee/);
    }
  });

  it("allows qa === reviewer", () => {
    const input = { ...validInternalWorkItem(), qaAgentId: uuid2 }; // same as reviewer
    const result = createInternalWorkItemSchema.safeParse(input);
    expect(result.success).toBe(true);
  });
});

describe("updateIssueSchema", () => {
  it("strips unknown fields (Zod default strip)", () => {
    const input = { title: "Updated title", hiddenAt: "2024-01-01T00:00:00Z" };
    const result = updateIssueSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBe("Updated title");
      expect((result.data as Record<string, unknown>)["hiddenAt"]).toBeUndefined();
    }
  });

  it("accepts partial updates", () => {
    const result = updateIssueSchema.safeParse({ title: "Only title" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBe("Only title");
      expect(result.data.description).toBeUndefined();
      expect(result.data.status).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Protocol validators
// ---------------------------------------------------------------------------

describe("createIssueProtocolMessageSchema", () => {
  it("accepts valid ASSIGN_TASK", () => {
    const result = createIssueProtocolMessageSchema.safeParse(validAssignTaskMessage());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.messageType).toBe("ASSIGN_TASK");
      expect(result.data.payload.goal).toBe("Implement feature X");
    }
  });

  it("rejects missing messageType", () => {
    const { messageType: _, ...noType } = validAssignTaskMessage();
    const result = createIssueProtocolMessageSchema.safeParse(noType);
    expect(result.success).toBe(false);
  });

  it("rejects empty recipients", () => {
    const input = { ...validAssignTaskMessage(), recipients: [] };
    const result = createIssueProtocolMessageSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.includes("recipients"));
      expect(issue).toBeDefined();
    }
  });
});
