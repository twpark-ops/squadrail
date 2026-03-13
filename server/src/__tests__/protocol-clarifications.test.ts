import { describe, expect, it } from "vitest";
import {
  deriveLatestHumanClarificationResolution,
  derivePendingHumanClarifications,
} from "@squadrail/shared";

describe("protocol clarification helpers", () => {
  it("keeps only unanswered human-board clarification requests pending", () => {
    const pending = derivePendingHumanClarifications([
      {
        id: "ask-agent",
        messageType: "ASK_CLARIFICATION",
        createdAt: new Date("2026-03-14T00:00:00.000Z"),
        payload: {
          questionType: "scope",
          question: "Need API scope",
          blocking: true,
          requestedFrom: "human_board",
          resumeWorkflowState: "planning",
        },
        sender: {
          actorType: "agent",
          actorId: "agent-1",
          role: "tech_lead",
        },
      },
      {
        id: "ask-nonhuman",
        messageType: "ASK_CLARIFICATION",
        createdAt: new Date("2026-03-14T00:01:00.000Z"),
        payload: {
          questionType: "scope",
          question: "Need reviewer note",
          blocking: false,
          requestedFrom: "reviewer",
        },
        sender: {
          actorType: "agent",
          actorId: "agent-2",
          role: "engineer",
        },
      },
      {
        id: "answer-agent",
        messageType: "ANSWER_CLARIFICATION",
        causalMessageId: "ask-agent",
        createdAt: new Date("2026-03-14T00:02:00.000Z"),
        payload: {
          answer: "Use the smaller API scope.",
        },
        sender: {
          actorType: "user",
          actorId: "user-1",
          role: "human_board",
        },
      },
      {
        id: "ask-human-2",
        messageType: "ASK_CLARIFICATION",
        createdAt: new Date("2026-03-14T00:03:00.000Z"),
        payload: {
          questionType: "requirement",
          question: "Is this still a hard deadline?",
          blocking: true,
          requestedFrom: "human_board",
          resumeWorkflowState: "implementing",
        },
        sender: {
          actorType: "agent",
          actorId: "agent-3",
          role: "reviewer",
        },
      },
    ]);

    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      questionMessageId: "ask-human-2",
      questionType: "requirement",
      resumeWorkflowState: "implementing",
      askedByRole: "reviewer",
    });
  });

  it("derives the latest answered human clarification with resume state", () => {
    const resolution = deriveLatestHumanClarificationResolution([
      {
        id: "ask-1",
        messageType: "ASK_CLARIFICATION",
        createdAt: new Date("2026-03-14T01:00:00.000Z"),
        payload: {
          questionType: "requirement",
          question: "Is the release cutoff still hard?",
          blocking: true,
          requestedFrom: "human_board",
          resumeWorkflowState: "implementing",
        },
        sender: {
          actorType: "agent",
          actorId: "agent-1",
          role: "tech_lead",
        },
      },
      {
        id: "answer-1",
        messageType: "ANSWER_CLARIFICATION",
        causalMessageId: "ask-1",
        createdAt: new Date("2026-03-14T01:04:00.000Z"),
        workflowStateAfter: "implementing",
        payload: {
          answer: "Yes. Keep the release cutoff for today.",
          nextStep: "Ship the minimal patch only.",
        },
        sender: {
          actorType: "user",
          actorId: "user-1",
          role: "human_board",
        },
      },
    ]);

    expect(resolution).toMatchObject({
      questionMessageId: "ask-1",
      answerMessageId: "answer-1",
      questionType: "requirement",
      askedByRole: "tech_lead",
      answeredByRole: "human_board",
      resumeWorkflowState: "implementing",
      nextStep: "Ship the minimal patch only.",
    });
  });
});
