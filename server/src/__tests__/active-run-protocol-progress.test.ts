import { describe, expect, it } from "vitest";
import { summarizeActiveRunProtocolProgress } from "../services/active-run-protocol-progress.js";

describe("summarizeActiveRunProtocolProgress", () => {
  it("tracks intermediate-only reviewer progress without marking required progress complete", () => {
    const summary = summarizeActiveRunProtocolProgress({
      protocolMessageType: "SUBMIT_FOR_REVIEW",
      protocolRecipientRole: "reviewer",
      agentId: "agent-reviewer-1",
      startedAt: "2026-03-20T10:00:00.000Z",
      workflowState: "under_review",
      messages: [
        {
          messageType: "START_REVIEW",
          senderActorType: "agent",
          senderActorId: "agent-reviewer-1",
          senderRole: "reviewer",
          createdAt: "2026-03-20T10:00:05.000Z",
        },
      ],
    });

    expect(summary).toMatchObject({
      required: true,
      requirementKey: "review_reviewer",
      actorAttemptedAfterRunStart: true,
      actorMessageCount: 1,
      roleMessageCount: 1,
      latestActorMessageType: "START_REVIEW",
      latestDecisionMessageType: null,
      latestIntermediateMessageType: "START_REVIEW",
      intermediateOnly: true,
      requiredProgressRecorded: false,
      humanOverrideCount: 0,
    });
  });

  it("marks required progress complete once a decision message is recorded", () => {
    const summary = summarizeActiveRunProtocolProgress({
      protocolMessageType: "SUBMIT_FOR_REVIEW",
      protocolRecipientRole: "reviewer",
      agentId: "agent-reviewer-1",
      startedAt: "2026-03-20T10:00:00.000Z",
      workflowState: "qa_pending",
      messages: [
        {
          messageType: "START_REVIEW",
          senderActorType: "agent",
          senderActorId: "agent-reviewer-1",
          senderRole: "reviewer",
          createdAt: "2026-03-20T10:00:05.000Z",
        },
        {
          messageType: "APPROVE_IMPLEMENTATION",
          senderActorType: "agent",
          senderActorId: "agent-reviewer-1",
          senderRole: "reviewer",
          createdAt: "2026-03-20T10:00:12.000Z",
        },
      ],
    });

    expect(summary).toMatchObject({
      required: true,
      requirementKey: "review_reviewer",
      actorMessageCount: 2,
      latestActorMessageType: "APPROVE_IMPLEMENTATION",
      latestDecisionMessageType: "APPROVE_IMPLEMENTATION",
      intermediateOnly: false,
      requiredProgressRecorded: true,
    });
    expect(summary.observedActorMessageTypes).toEqual(["START_REVIEW", "APPROVE_IMPLEMENTATION"]);
  });

  it("captures human override after run start for close lane diagnostics", () => {
    const summary = summarizeActiveRunProtocolProgress({
      protocolMessageType: "APPROVE_IMPLEMENTATION",
      protocolRecipientRole: "tech_lead",
      agentId: "agent-tl-1",
      startedAt: "2026-03-20T10:00:00.000Z",
      workflowState: "approved",
      messages: [
        {
          messageType: "CLOSE_TASK",
          senderActorType: "user",
          senderActorId: "user-1",
          senderRole: "human_board",
          createdAt: "2026-03-20T10:00:30.000Z",
        },
      ],
    });

    expect(summary).toMatchObject({
      required: true,
      requirementKey: "approval_tech_lead",
      actorAttemptedAfterRunStart: false,
      actorMessageCount: 0,
      latestActorMessageType: null,
      requiredProgressRecorded: false,
      humanOverrideCount: 1,
      latestHumanOverrideMessageType: "CLOSE_TASK",
    });
  });
});
