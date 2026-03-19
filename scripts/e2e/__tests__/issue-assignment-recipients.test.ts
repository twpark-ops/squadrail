import { describe, expect, it } from "vitest";
import { buildIssueAssignmentRecipients } from "../cloud-swiftsight-real-org.mjs";

describe("buildIssueAssignmentRecipients", () => {
  it("deduplicates the reviewer recipient when assignee and reviewer are the same agent", () => {
    const recipients = buildIssueAssignmentRecipients({
      assignee: { id: "agent-1" },
      assigneeRole: "tech_lead",
      reviewer: { id: "agent-1" },
      reviewerRole: "reviewer",
    });

    expect(recipients).toEqual([
      {
        recipientType: "agent",
        recipientId: "agent-1",
        role: "tech_lead",
      },
    ]);
  });

  it("keeps both recipients when assignee and reviewer differ", () => {
    const recipients = buildIssueAssignmentRecipients({
      assignee: { id: "agent-1" },
      assigneeRole: "pm",
      reviewer: { id: "agent-2" },
      reviewerRole: "reviewer",
    });

    expect(recipients).toEqual([
      {
        recipientType: "agent",
        recipientId: "agent-1",
        role: "pm",
      },
      {
        recipientType: "agent",
        recipientId: "agent-2",
        role: "reviewer",
      },
    ]);
  });

  it("uses assignmentReviewer when the final reviewer differs from the bootstrap reviewer", () => {
    const recipients = buildIssueAssignmentRecipients({
      assignee: { id: "lead-1" },
      assigneeRole: "tech_lead",
      reviewer: { id: "lead-1" },
      reviewerRole: "reviewer",
      assignmentReviewer: { id: "qa-1" },
      assignmentReviewerRole: "reviewer",
    });

    expect(recipients).toEqual([
      {
        recipientType: "agent",
        recipientId: "lead-1",
        role: "tech_lead",
      },
      {
        recipientType: "agent",
        recipientId: "qa-1",
        role: "reviewer",
      },
    ]);
  });
});
