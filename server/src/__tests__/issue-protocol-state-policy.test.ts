import { describe, expect, it } from "vitest";
import { validateHumanBoardProtocolIntervention } from "../services/issue-protocol.js";

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
