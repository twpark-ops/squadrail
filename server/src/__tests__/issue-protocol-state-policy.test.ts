import { describe, expect, it } from "vitest";
import {
  applyProjectedIssueStatus,
  mapProtocolStateToIssueStatus,
  renderMirrorComment,
  resolveProtocolOwnershipForMessage,
  resolveExpectedWorkflowStateAfter,
  validateHumanBoardProtocolIntervention,
  validateProtocolRecipientContract,
} from "../services/issue-protocol.js";

describe("validateHumanBoardProtocolIntervention", () => {
  it("allows human board change requests only after explicit human decision escalation", () => {
    expect(
      validateHumanBoardProtocolIntervention({
        messageType: "REQUEST_CHANGES",
        senderRole: "human_board",
        workflowStateBefore: "awaiting_human_decision",
      }),
    ).toBeNull();

    expect(
      validateHumanBoardProtocolIntervention({
        messageType: "REQUEST_CHANGES",
        senderRole: "human_board",
        workflowStateBefore: "under_review",
      }),
    ).toBe("Human board can request changes only after REQUEST_HUMAN_DECISION");
  });

  it("does not restrict non-board change requests or board approvals", () => {
    expect(
      validateHumanBoardProtocolIntervention({
        messageType: "REQUEST_CHANGES",
        senderRole: "reviewer",
        workflowStateBefore: "under_review",
      }),
    ).toBeNull();

    expect(
      validateHumanBoardProtocolIntervention({
        messageType: "APPROVE_IMPLEMENTATION",
        senderRole: "human_board",
        workflowStateBefore: "awaiting_human_decision",
      }),
    ).toBeNull();
  });
});

describe("validateProtocolRecipientContract", () => {
  it("requires START_IMPLEMENTATION to target the assigned engineer for follow-up execution", () => {
    expect(
      validateProtocolRecipientContract({
        messageType: "START_IMPLEMENTATION",
        sender: {
          actorType: "agent",
          actorId: "eng-1",
          role: "engineer",
        },
        recipients: [
          {
            recipientType: "agent",
            recipientId: "lead-1",
            role: "tech_lead",
          },
        ],
        workflowStateBefore: "planning",
        workflowStateAfter: "implementing",
        summary: "Start implementation",
        payload: {
          implementationMode: "code_change",
        },
        artifacts: [],
      }),
    ).toBe("START_IMPLEMENTATION must include the assigned engineer as a recipient");
  });

  it("accepts START_IMPLEMENTATION when the sender remains the engineer recipient", () => {
    expect(
      validateProtocolRecipientContract({
        messageType: "START_IMPLEMENTATION",
        sender: {
          actorType: "agent",
          actorId: "eng-1",
          role: "engineer",
        },
        recipients: [
          {
            recipientType: "agent",
            recipientId: "eng-1",
            role: "engineer",
          },
          {
            recipientType: "agent",
            recipientId: "lead-1",
            role: "tech_lead",
          },
        ],
        workflowStateBefore: "planning",
        workflowStateAfter: "implementing",
        summary: "Start implementation",
        payload: {
          implementationMode: "code_change",
        },
        artifacts: [],
      }),
    ).toBeNull();
  });

  it("rejects QA assignees that overlap with the reviewer", () => {
    expect(
      validateProtocolRecipientContract({
        messageType: "ASSIGN_TASK",
        sender: {
          actorType: "user",
          actorId: "board-1",
          role: "human_board",
        },
        recipients: [
          {
            recipientType: "agent",
            recipientId: "eng-1",
            role: "engineer",
          },
          {
            recipientType: "agent",
            recipientId: "rev-1",
            role: "reviewer",
          },
          {
            recipientType: "agent",
            recipientId: "rev-1",
            role: "qa",
          },
        ],
        workflowStateBefore: "backlog",
        workflowStateAfter: "assigned",
        summary: "Assign work with QA gate",
        payload: {
          goal: "goal",
          acceptanceCriteria: ["a"],
          definitionOfDone: ["d"],
          priority: "high",
          assigneeAgentId: "eng-1",
          reviewerAgentId: "rev-1",
          qaAgentId: "rev-1",
        },
        artifacts: [],
      }),
    ).toBe("QA must be different from reviewer");
  });
});

describe("resolveProtocolOwnershipForMessage", () => {
  it("falls back to the project lead for root issue assignment when the board assigns directly to an engineer", () => {
    expect(
      resolveProtocolOwnershipForMessage({
        currentState: null,
        fallbackTechLeadAgentId: "lead-1",
        message: {
          messageType: "ASSIGN_TASK",
          sender: {
            actorType: "user",
            actorId: "board-1",
            role: "human_board",
          },
          recipients: [
            {
              recipientType: "agent",
              recipientId: "eng-1",
              role: "engineer",
            },
            {
              recipientType: "agent",
              recipientId: "reviewer-1",
              role: "reviewer",
            },
          ],
          workflowStateBefore: "backlog",
          workflowStateAfter: "assigned",
          summary: "Assign root issue",
          payload: {
            goal: "goal",
            acceptanceCriteria: ["a"],
            definitionOfDone: ["d"],
            priority: "high",
            assigneeAgentId: "eng-1",
            reviewerAgentId: "reviewer-1",
          },
          artifacts: [],
        },
      }),
    ).toMatchObject({
      techLeadAgentId: "lead-1",
      primaryEngineerAgentId: "eng-1",
      reviewerAgentId: "reviewer-1",
    });
  });

  it("persists QA ownership when assignments provide an explicit QA gate agent", () => {
    expect(
      resolveProtocolOwnershipForMessage({
        currentState: null,
        fallbackTechLeadAgentId: "lead-1",
        message: {
          messageType: "ASSIGN_TASK",
          sender: {
            actorType: "user",
            actorId: "board-1",
            role: "human_board",
          },
          recipients: [
            {
              recipientType: "agent",
              recipientId: "eng-1",
              role: "engineer",
            },
            {
              recipientType: "agent",
              recipientId: "reviewer-1",
              role: "reviewer",
            },
            {
              recipientType: "agent",
              recipientId: "qa-1",
              role: "qa",
            },
          ],
          workflowStateBefore: "backlog",
          workflowStateAfter: "assigned",
          summary: "Assign root issue with QA gate",
          payload: {
            goal: "goal",
            acceptanceCriteria: ["a"],
            definitionOfDone: ["d"],
            priority: "high",
            assigneeAgentId: "eng-1",
            reviewerAgentId: "reviewer-1",
            qaAgentId: "qa-1",
          },
          artifacts: [],
        },
      }),
    ).toMatchObject({
      techLeadAgentId: "lead-1",
      primaryEngineerAgentId: "eng-1",
      reviewerAgentId: "reviewer-1",
      qaAgentId: "qa-1",
    });
  });
});

describe("protocol state projection helpers", () => {
  it("maps workflow states into coarse issue statuses", () => {
    expect(mapProtocolStateToIssueStatus("assigned")).toBe("todo");
    expect(mapProtocolStateToIssueStatus("implementing")).toBe("in_progress");
    expect(mapProtocolStateToIssueStatus("approved")).toBe("in_review");
    expect(mapProtocolStateToIssueStatus("done")).toBe("done");
  });

  it("applies projected issue status timestamps consistently", () => {
    expect(applyProjectedIssueStatus("todo")).toMatchObject({
      status: "todo",
      updatedAt: expect.any(Date),
    });
    expect(applyProjectedIssueStatus("in_progress")).toMatchObject({
      status: "in_progress",
      startedAt: expect.any(Date),
    });
    expect(applyProjectedIssueStatus("done")).toMatchObject({
      status: "done",
      completedAt: expect.any(Date),
    });
    expect(applyProjectedIssueStatus("cancelled")).toMatchObject({
      status: "cancelled",
      cancelledAt: expect.any(Date),
    });
  });

  it("renders protocol mirror comments with state, recipients, and payload", () => {
    const comment = renderMirrorComment({
      messageType: "NOTE",
      sender: {
        actorType: "user",
        actorId: "board-1",
        role: "human_board",
      },
      recipients: [
        {
          recipientType: "agent",
          recipientId: "eng-1",
          role: "engineer",
        },
      ],
      workflowStateBefore: "assigned",
      workflowStateAfter: "assigned",
      summary: "Capture delivery context",
      payload: {
        noteType: "context",
        body: "Keep rollback risk explicit",
      },
      artifacts: [],
    });

    expect(comment).toContain("**Protocol NOTE**");
    expect(comment).toContain("assigned");
    expect(comment).toContain("engineer:eng-1");
    expect(comment).toContain("\"noteType\": \"context\"");
  });

  it("resolves review and approval state transitions from current ownership", () => {
    expect(resolveExpectedWorkflowStateAfter({
      before: "submitted_for_review",
      currentState: null,
      message: {
        messageType: "START_REVIEW",
        sender: {
          actorType: "agent",
          actorId: "rev-1",
          role: "reviewer",
        },
        recipients: [],
        workflowStateBefore: "submitted_for_review",
        workflowStateAfter: "under_review",
        summary: "Start reviewer pass",
        payload: {},
        artifacts: [],
      },
      rule: { to: "same" },
    })).toBe("under_review");

    expect(resolveExpectedWorkflowStateAfter({
      before: "under_review",
      currentState: {
        qaAgentId: "qa-1",
      } as any,
      message: {
        messageType: "APPROVE_IMPLEMENTATION",
        sender: {
          actorType: "agent",
          actorId: "rev-1",
          role: "reviewer",
        },
        recipients: [],
        workflowStateBefore: "under_review",
        workflowStateAfter: "qa_pending",
        summary: "Approve and hand off to QA",
        payload: {},
        artifacts: [],
      },
      rule: { to: "same" },
    })).toBe("qa_pending");
  });
});
