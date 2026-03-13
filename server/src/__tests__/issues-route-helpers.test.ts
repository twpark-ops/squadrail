import { describe, expect, it } from "vitest";
import {
  buildMentionProtocolContext,
  canBypassAssignPermissionForProtocolMessage,
  getAllowedProtocolRoles,
  getProtocolRole,
  readString,
  shouldGenerateProtocolRetrievalContext,
  withIssueAttachmentContentPath,
} from "../routes/issues.js";

describe("issue route helpers", () => {
  it("maps agent roles to allowed protocol roles", () => {
    expect(getProtocolRole("cto")).toBe("cto");
    expect(getProtocolRole("pm")).toBe("pm");
    expect(getProtocolRole("qa")).toBe("qa");
    expect(getProtocolRole("engineer")).toBe("engineer");
    expect(getProtocolRole("manager")).toBe("tech_lead");
    expect(getProtocolRole("unknown")).toBe("reviewer");

    expect(getAllowedProtocolRoles({ role: "qa" })).toEqual(new Set(["qa", "reviewer"]));
    expect(getAllowedProtocolRoles({ role: "engineer", title: "Tech Lead" })).toEqual(
      new Set(["engineer", "tech_lead", "reviewer"]),
    );
  });

  it("only bypasses assignment permission for privileged agent protocol messages", () => {
    expect(canBypassAssignPermissionForProtocolMessage({
      messageType: "REASSIGN_TASK",
      sender: {
        actorType: "agent",
        role: "tech_lead",
      },
    })).toBe(true);
    expect(canBypassAssignPermissionForProtocolMessage({
      messageType: "CLOSE_TASK",
      sender: {
        actorType: "agent",
        role: "pm",
      },
    })).toBe(true);
    expect(canBypassAssignPermissionForProtocolMessage({
      messageType: "ASSIGN_TASK",
      sender: {
        actorType: "agent",
        role: "tech_lead",
      },
    })).toBe(false);
    expect(canBypassAssignPermissionForProtocolMessage({
      messageType: "REASSIGN_TASK",
      sender: {
        actorType: "user",
        role: "tech_lead",
      },
    })).toBe(false);
  });

  it("recognizes retrieval-generating protocol messages and mention contexts", () => {
    expect(shouldGenerateProtocolRetrievalContext("ASSIGN_TASK")).toBe(true);
    expect(shouldGenerateProtocolRetrievalContext("SUBMIT_FOR_REVIEW")).toBe(true);
    expect(shouldGenerateProtocolRetrievalContext("CLOSE_TASK")).toBe(false);

    expect(buildMentionProtocolContext({
      issue: { assigneeAgentId: "eng-1" },
      mentionedAgentId: "eng-1",
      protocolState: {
        workflowState: "implementing",
      },
    })).toEqual({
      protocolRecipientRole: "engineer",
      protocolWorkflowStateAfter: "implementing",
    });

    expect(buildMentionProtocolContext({
      issue: { assigneeAgentId: "eng-1" },
      mentionedAgentId: "rev-1",
      protocolState: {
        workflowState: "under_review",
        reviewerAgentId: "rev-1",
      },
    })).toEqual({
      protocolRecipientRole: "reviewer",
      protocolWorkflowStateAfter: "under_review",
    });

    expect(buildMentionProtocolContext({
      issue: { assigneeAgentId: "eng-1" },
      mentionedAgentId: "qa-1",
      protocolState: {
        workflowState: "qa_pending",
        qaAgentId: "qa-1",
      },
    })).toEqual({
      protocolRecipientRole: "qa",
      protocolWorkflowStateAfter: "qa_pending",
    });

    expect(buildMentionProtocolContext({
      issue: { assigneeAgentId: "eng-1" },
      mentionedAgentId: "other",
      protocolState: {
        workflowState: "todo",
      },
    })).toEqual({});
  });

  it("reads trimmed strings and builds attachment content paths", () => {
    expect(readString("  retry worker  ")).toBe("retry worker");
    expect(readString("   ")).toBeNull();
    expect(readString(null)).toBeNull();

    expect(withIssueAttachmentContentPath({
      id: "attachment-1",
      name: "diff.patch",
    })).toEqual({
      id: "attachment-1",
      name: "diff.patch",
      contentPath: "/api/attachments/attachment-1/content",
    });
  });
});
