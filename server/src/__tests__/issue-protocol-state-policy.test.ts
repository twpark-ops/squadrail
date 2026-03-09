import { describe, expect, it } from "vitest";
import {
  resolveProtocolOwnershipForMessage,
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
});
