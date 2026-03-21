import { describe, expect, it } from "vitest";
import {
  renderSquadrailRuntimeNote,
  withProtocolTransportGuards,
} from "@squadrail/adapter-utils/server-utils";

describe("renderSquadrailRuntimeNote", () => {
  it("includes QA execution gate guidance when protocolRequirement is qa_gate_reviewer", () => {
    // qa_gate_reviewer is resolved when protocolMessageType=APPROVE_IMPLEMENTATION, protocolRecipientRole=qa
    const output = renderSquadrailRuntimeNote({
      env: { SQUADRAIL_TASK_ID: "issue-1" },
      context: {
        issueId: "issue-1",
        protocolMessageType: "APPROVE_IMPLEMENTATION",
        protocolRecipientRole: "qa",
        protocolWorkflowStateBefore: "under_qa_review",
        protocolWorkflowStateAfter: "approved",
      },
    });

    expect(output).toContain("IMMEDIATE PROTOCOL ACTION:");
    expect(output).toContain("SHORT PROTOCOL LANE:");
    expect(output).toContain("QA must execute the acceptance check before deciding. Do not edit source files in this lane.");
    expect(output).toContain('start-review --issue "issue-1" --payload');
  });

  it("includes engineer single-flow guidance for assignment_engineer", () => {
    // assignment_engineer is resolved when protocolMessageType=ASSIGN_TASK, protocolRecipientRole=engineer
    const output = renderSquadrailRuntimeNote({
      env: { SQUADRAIL_TASK_ID: "issue-2" },
      context: {
        issueId: "issue-2",
        protocolMessageType: "ASSIGN_TASK",
        protocolRecipientRole: "engineer",
        protocolWorkflowStateBefore: "open",
        protocolWorkflowStateAfter: "assigned",
        // Use a non-implementation workspace to trigger workspaceUsageOverride mention
        squadrailWorkspace: { workspaceUsage: "shared", source: "local" },
      },
    });

    expect(output).toContain("IMMEDIATE PROTOCOL ACTION:");
    expect(output).toContain("workspaceUsageOverride");
    expect(output).toContain("ACK-only runs are incomplete and will be retried.");
    expect(output).toContain('ack-assignment --issue "issue-2" --payload');
    expect(output).toContain('start-implementation --issue "issue-2" --payload');
    expect(output).toContain("If the previous command succeeds and the issue remains in the same lane, run this next in the same run:");
  });

  it("includes implementation scope guidance for implementation_engineer", () => {
    // implementation_engineer is resolved when protocolMessageType=START_IMPLEMENTATION, protocolRecipientRole=engineer
    const output = renderSquadrailRuntimeNote({
      env: { SQUADRAIL_TASK_ID: "issue-3" },
      context: {
        issueId: "issue-3",
        protocolMessageType: "START_IMPLEMENTATION",
        protocolRecipientRole: "engineer",
        protocolWorkflowStateBefore: "assigned",
        protocolWorkflowStateAfter: "implementing",
      },
    });

    expect(output).toContain("acceptance criteria");
  });

  it("includes closure guidance for approval_tech_lead", () => {
    const output = renderSquadrailRuntimeNote({
      env: { SQUADRAIL_TASK_ID: "issue-4" },
      context: {
        issueId: "issue-4",
        protocolMessageType: "APPROVE_IMPLEMENTATION",
        protocolRecipientRole: "tech_lead",
        protocolWorkflowStateBefore: "under_qa_review",
        protocolWorkflowStateAfter: "approved",
      },
    });

    expect(output).toContain("IMMEDIATE PROTOCOL ACTION:");
    expect(output).toContain("SHORT PROTOCOL LANE:");
    expect(output).toContain("Approval is incomplete until `CLOSE_TASK` or `REQUEST_HUMAN_DECISION` is recorded.");
    expect(output).toContain('close-task --issue "issue-4" --payload');
  });

  it("includes concrete reviewer helper commands for short supervisory review lanes", () => {
    const output = renderSquadrailRuntimeNote({
      env: { SQUADRAIL_TASK_ID: "issue-5" },
      context: {
        issueId: "issue-5",
        protocolMessageType: "SUBMIT_FOR_REVIEW",
        protocolRecipientRole: "reviewer",
        protocolWorkflowStateBefore: "submitted_for_review",
        protocolWorkflowStateAfter: "under_review",
        taskBrief: {
          contentMarkdown: [
            "# reviewer brief",
            "",
            "## Retrieval Query",
            "```text",
            "very long retrieval query that should be omitted in short supervisory lanes",
            "```",
            "",
            "## Retrieved Evidence",
            "- omitted in condensed rendering",
          ].join("\n"),
        },
      },
    });

    expect(output).toContain("IMMEDIATE PROTOCOL ACTION:");
    expect(output).toContain("SHORT PROTOCOL LANE:");
    expect(output).toContain("After `START_REVIEW`, conclude the lane with `APPROVE_IMPLEMENTATION`, `REQUEST_CHANGES`, or `REQUEST_HUMAN_DECISION`.");
    expect(output).toContain("Structured wake context:");
    expect(output).not.toContain("very long retrieval query that should be omitted in short supervisory lanes");
    expect(output).toContain('start-review --issue "issue-5" --payload');
  });

  it("includes concrete staffing helper commands for assignment supervisor lanes", () => {
    const output = renderSquadrailRuntimeNote({
      env: { SQUADRAIL_TASK_ID: "issue-6" },
      context: {
        issueId: "issue-6",
        protocolMessageType: "ASSIGN_TASK",
        protocolRecipientRole: "tech_lead",
        protocolWorkflowStateBefore: "backlog",
        protocolWorkflowStateAfter: "assigned",
        protocolSummary: "Route the task to the project engineer and keep the reviewer attached.",
        protocolPayload: {
          assigneeAgentId: "agent-eng-1",
          reviewerAgentId: "agent-rev-1",
          qaAgentId: "agent-qa-1",
        },
      },
    });

    expect(output).toContain("IMMEDIATE PROTOCOL ACTION:");
    expect(output).toContain("SHORT PROTOCOL LANE:");
    expect(output).toContain("Route with `REASSIGN_TASK` when the execution owner is clear.");
    expect(output).toContain('reassign-task --issue "issue-6" --payload');
    expect(output).toContain('"newAssigneeAgentId":"agent-eng-1"');
    expect(output).toContain('"newReviewerAgentId":"agent-rev-1"');
  });
});

describe("buildGitWriteGuardScript", () => {
  it("git write guard script blocks commit when SQUADRAIL_WORKSPACE_READ_ONLY=1", async () => {
    // withProtocolTransportGuards writes the git guard shim to a temp dir.
    // After calling it we can read the generated script and verify its content.
    const { readFile } = await import("node:fs/promises");
    const path = await import("node:path");

    const env = await withProtocolTransportGuards(
      { ...process.env, PATH: process.env.PATH ?? "" } as Record<string, string>,
      { readOnlyWorkspace: true },
    );

    const guardDir = (env.PATH ?? "").split(":")[0] ?? "";
    const gitScript = await readFile(path.join(guardDir, "git"), "utf8");

    // Verify the script contains blocked subcommands
    expect(gitScript).toContain("commit");
    expect(gitScript).toContain("add");
    expect(gitScript).toContain("push");
    expect(gitScript).toContain("BLOCK_MESSAGE");
    expect(gitScript).toContain("SQUADRAIL_WORKSPACE_READ_ONLY");
  });

  it("withProtocolTransportGuards sets SQUADRAIL_WORKSPACE_READ_ONLY when readOnlyWorkspace is true", async () => {
    const env = await withProtocolTransportGuards(
      { ...process.env, PATH: process.env.PATH ?? "" } as Record<string, string>,
      { readOnlyWorkspace: true },
    );

    expect(env.SQUADRAIL_WORKSPACE_READ_ONLY).toBe("1");
  });
});
