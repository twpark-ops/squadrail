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

    expect(output).toContain("Do not create, edit, or delete any source files");
    expect(output).toContain("QA-start-only runs are incomplete and will be retried.");
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

    expect(output).toContain("workspaceUsageOverride");
    expect(output).toContain("ACK-only runs are incomplete and will be retried.");
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

    expect(output).toContain("Do not idle in `approved`.");
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
