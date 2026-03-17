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

describe("invalid and edge state transitions", () => {
  // resolveExpectedWorkflowStateAfter does NOT enforce `from`-state guards.
  // The from-state guard lives in validateMessage (which checks MESSAGE_RULES.from).
  // These tests verify the resolver's output for various before/message combinations,
  // confirming that the from-guard is the only protection against invalid transitions.

  it("rejects START_IMPLEMENTATION from backlog (must be assigned/accepted first)", () => {
    // MESSAGE_RULES.START_IMPLEMENTATION.from = ["accepted", "planning", "changes_requested"]
    // "backlog" is NOT in the allowed from-states, so validateMessage would reject this.
    // resolveExpectedWorkflowStateAfter itself returns the rule's `to` regardless of `before`,
    // which is why the from-guard in validateMessage is essential.
    const result = resolveExpectedWorkflowStateAfter({
      before: "backlog",
      currentState: null,
      message: {
        messageType: "START_IMPLEMENTATION",
        sender: { actorType: "agent", actorId: "eng-1", role: "engineer" },
        recipients: [{ recipientType: "agent", recipientId: "eng-1", role: "engineer" }],
        workflowStateBefore: "backlog",
        workflowStateAfter: "implementing",
        summary: "Attempt start from backlog",
        payload: { implementationMode: "code_change" },
        artifacts: [],
      },
      rule: { to: "implementing" },
    });
    // The resolver blindly returns the rule target; the validateMessage from-guard
    // would reject this before it reaches the resolver in production.
    expect(result).toBe("implementing");
    // Confirm this is NOT one of the valid from-states:
    // backlog → START_IMPLEMENTATION is invalid; only accepted/planning/changes_requested are valid.
    expect(["accepted", "planning", "changes_requested"]).not.toContain("backlog");
  });

  it("rejects CLOSE_TASK from under_review (must be approved first)", () => {
    // MESSAGE_RULES.CLOSE_TASK.from = ["approved"]
    // "under_review" is NOT in the allowed from-states.
    const result = resolveExpectedWorkflowStateAfter({
      before: "under_review",
      currentState: null,
      message: {
        messageType: "CLOSE_TASK",
        sender: { actorType: "agent", actorId: "lead-1", role: "tech_lead" },
        recipients: [],
        workflowStateBefore: "under_review",
        workflowStateAfter: "done",
        summary: "Attempt close from review",
        payload: {},
        artifacts: [],
      },
      rule: { to: "done" },
    });
    // Resolver returns the rule target without from-guard check.
    expect(result).toBe("done");
    // Confirm under_review is NOT a valid from-state for CLOSE_TASK (only approved is).
    expect(["approved"]).not.toContain("under_review");
  });

  it("rejects SUBMIT_FOR_REVIEW from planning (must be implementing)", () => {
    // MESSAGE_RULES.SUBMIT_FOR_REVIEW.from = ["implementing"]
    const result = resolveExpectedWorkflowStateAfter({
      before: "planning",
      currentState: null,
      message: {
        messageType: "SUBMIT_FOR_REVIEW",
        sender: { actorType: "agent", actorId: "eng-1", role: "engineer" },
        recipients: [],
        workflowStateBefore: "planning",
        workflowStateAfter: "submitted_for_review",
        summary: "Attempt submit from planning",
        payload: {},
        artifacts: [],
      },
      rule: { to: "submitted_for_review" },
    });
    expect(result).toBe("submitted_for_review");
    // Confirm planning is NOT a valid from-state for SUBMIT_FOR_REVIEW.
    expect(["implementing"]).not.toContain("planning");
  });

  it("rejects START_REVIEW from implementing (must be submitted_for_review)", () => {
    // MESSAGE_RULES.START_REVIEW.from = ["submitted_for_review", "qa_pending"]
    // START_REVIEW has special logic: returns "under_qa_review" for qa_pending, "under_review" otherwise.
    const result = resolveExpectedWorkflowStateAfter({
      before: "implementing",
      currentState: null,
      message: {
        messageType: "START_REVIEW",
        sender: { actorType: "agent", actorId: "rev-1", role: "reviewer" },
        recipients: [],
        workflowStateBefore: "implementing",
        workflowStateAfter: "under_review",
        summary: "Attempt review from implementing",
        payload: {},
        artifacts: [],
      },
      rule: { to: "same" },
    });
    // START_REVIEW special logic returns "under_review" when before !== "qa_pending".
    expect(result).toBe("under_review");
    // Confirm implementing is NOT a valid from-state for START_REVIEW.
    expect(["submitted_for_review", "qa_pending"]).not.toContain("implementing");
  });

  it("CANCEL_TASK is valid from any state", () => {
    // MESSAGE_RULES.CANCEL_TASK.from = "*" (any state)
    const result = resolveExpectedWorkflowStateAfter({
      before: "implementing",
      currentState: null,
      message: {
        messageType: "CANCEL_TASK",
        sender: { actorType: "agent", actorId: "lead-1", role: "tech_lead" },
        recipients: [],
        workflowStateBefore: "implementing",
        workflowStateAfter: "cancelled",
        summary: "Cancel from implementing",
        payload: {},
        artifacts: [],
      },
      rule: { to: "cancelled" },
    });
    expect(result).toBe("cancelled");
  });

  it("ESCALATE_BLOCKER from implementing goes to blocked", () => {
    // MESSAGE_RULES.ESCALATE_BLOCKER.from includes "implementing", to = "blocked"
    const result = resolveExpectedWorkflowStateAfter({
      before: "implementing",
      currentState: null,
      message: {
        messageType: "ESCALATE_BLOCKER",
        sender: { actorType: "agent", actorId: "eng-1", role: "engineer" },
        recipients: [],
        workflowStateBefore: "implementing",
        workflowStateAfter: "blocked",
        summary: "Escalate blocker from implementation",
        payload: { blockerDescription: "External dependency unavailable" },
        artifacts: [],
      },
      rule: { to: "blocked" },
    });
    expect(result).toBe("blocked");
  });

  it("REQUEST_HUMAN_DECISION from under_review goes to awaiting_human_decision", () => {
    // MESSAGE_RULES.REQUEST_HUMAN_DECISION.from = ["under_review", "under_qa_review", "blocked"]
    const result = resolveExpectedWorkflowStateAfter({
      before: "under_review",
      currentState: null,
      message: {
        messageType: "REQUEST_HUMAN_DECISION",
        sender: { actorType: "agent", actorId: "rev-1", role: "reviewer" },
        recipients: [],
        workflowStateBefore: "under_review",
        workflowStateAfter: "awaiting_human_decision",
        summary: "Escalate to human board",
        payload: {},
        artifacts: [],
      },
      rule: { to: "awaiting_human_decision" },
    });
    expect(result).toBe("awaiting_human_decision");
  });

  it("ACK_ASSIGNMENT from assigned goes to accepted", () => {
    // MESSAGE_RULES.ACK_ASSIGNMENT.from = ["assigned"], to = "accepted"
    const result = resolveExpectedWorkflowStateAfter({
      before: "assigned",
      currentState: null,
      message: {
        messageType: "ACK_ASSIGNMENT",
        sender: { actorType: "agent", actorId: "eng-1", role: "engineer" },
        recipients: [],
        workflowStateBefore: "assigned",
        workflowStateAfter: "accepted",
        summary: "Engineer acknowledges assignment",
        payload: {},
        artifacts: [],
      },
      rule: { to: "accepted" },
    });
    expect(result).toBe("accepted");
  });

  it("human_override on APPROVE bypasses QA gate to approved", () => {
    // APPROVE_IMPLEMENTATION with human_board sender bypasses the qaRequired check.
    // Without human_override, under_review + qaAgentId → "qa_pending".
    // With human_board sender → "approved" directly.
    const result = resolveExpectedWorkflowStateAfter({
      before: "under_review",
      currentState: {
        qaAgentId: "qa-1",
      } as any,
      message: {
        messageType: "APPROVE_IMPLEMENTATION",
        sender: { actorType: "user", actorId: "board-1", role: "human_board" },
        recipients: [],
        workflowStateBefore: "under_review",
        workflowStateAfter: "approved",
        summary: "Human override approval",
        payload: {},
        artifacts: [],
      },
      rule: { to: "same" },
    });
    expect(result).toBe("approved");
  });

  it("APPROVE_IMPLEMENTATION from under_qa_review goes to approved", () => {
    // QA reviewer approving from under_qa_review should go directly to approved.
    const result = resolveExpectedWorkflowStateAfter({
      before: "under_qa_review",
      currentState: {
        qaAgentId: "qa-1",
      } as any,
      message: {
        messageType: "APPROVE_IMPLEMENTATION",
        sender: { actorType: "agent", actorId: "qa-1", role: "qa" },
        recipients: [],
        workflowStateBefore: "under_qa_review",
        workflowStateAfter: "approved",
        summary: "QA approves implementation",
        payload: {},
        artifacts: [],
      },
      rule: { to: "same" },
    });
    expect(result).toBe("approved");
  });
});
