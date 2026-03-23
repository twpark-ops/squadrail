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
        protocolPayload: {
          verifiedEvidence: [
            "go test ./internal/storage -count=1",
          ],
        },
      },
    });

    expect(output).toContain("IMMEDIATE PROTOCOL ACTION:");
    expect(output).toContain("SHORT PROTOCOL LANE:");
    expect(output).toContain("Do not open `SKILL.md`, run `--help`, or rediscover helper usage in this lane.");
    expect(output).toContain("Do not use the `squadrail` skill in this lane and do not inspect any file under the repository `skills/` directory or the helper source file path unless the runtime note is missing entirely.");
    expect(output).toContain("QA must execute the acceptance check before deciding. Do not edit source files in this lane.");
    expect(output).toContain("QA review is already open in this lane. After rerunning verification, move directly to `APPROVE_IMPLEMENTATION`, `REQUEST_CHANGES`, or `REQUEST_HUMAN_DECISION`.");
    expect(output).toContain('approve-implementation --issue "issue-1"');
    expect(output).not.toContain('start-review --issue "issue-1" --payload');
    expect(output).toContain("QA review is already open in this lane.");
    expect(output).toContain("Start with the reviewer-approved verification command: go test ./internal/storage -count=1");
    expect(output).toContain("Do not fetch another brief or re-open helper documentation before running that command unless the command text itself is missing.");
    expect(output).toContain("Reviewer-approved verification inputs:");
    expect(output).toContain("prefer `APPROVE_IMPLEMENTATION` over `REQUEST_HUMAN_DECISION`");
    expect(output).toContain("go test ./internal/storage -count=1");
    expect(output).toContain("optional `evidenceCitations[]`");
    expect(output).not.toContain("For `START_REVIEW`, describe your execution plan:");
  });

  it("keeps QA START_REVIEW guidance while the workflow is still qa_pending", () => {
    const output = renderSquadrailRuntimeNote({
      env: { SQUADRAIL_TASK_ID: "issue-1b" },
      context: {
        issueId: "issue-1b",
        protocolMessageType: "APPROVE_IMPLEMENTATION",
        protocolRecipientRole: "qa",
        protocolWorkflowStateBefore: "qa_pending",
        protocolWorkflowStateAfter: "approved",
        protocolPayload: {
          verifiedEvidence: [
            "go test ./internal/storage -count=1",
          ],
        },
      },
    });

    expect(output).toContain("IMMEDIATE PROTOCOL ACTION:");
    expect(output).toContain('start-review --issue "issue-1b" --sender-role "qa" --payload');
    expect(output).toContain('approve-implementation --issue "issue-1b"');
    expect(output).toContain("Start with the reviewer-approved verification command: go test ./internal/storage -count=1");
    expect(output).toContain("- Expected protocol message: START_REVIEW");
    expect(output).toContain("- If the lane still requires progress after the previous command, run this next:");
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
        taskBrief: {
          contentMarkdown: "# engineer brief",
          evidence: [
            { path: "internal/storage/path.go" },
            { path: "internal/storage/path_test.go" },
          ],
        },
      },
    });

    expect(output).toContain("IMMEDIATE PROTOCOL ACTION:");
    expect(output).toContain("workspaceUsageOverride");
    expect(output).toContain("ACK-only runs are incomplete and will be retried.");
    expect(output).toContain('ack-assignment --issue "issue-2" --sender-role "engineer" --payload');
    expect(output).toContain('start-implementation --issue "issue-2" --sender-role "engineer" --payload');
    expect(output).toContain("If the previous command succeeds and the issue remains in the same lane, run this next in the same run:");
    expect(output).toContain("internal/storage/path.go");
    expect(output).not.toContain("service.version");
    expect(output).not.toContain("observability");
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
        reviewerAgentId: "reviewer-123",
        squadrailWorkspace: {
          workspaceUsage: "implementation",
          source: "project_worktree",
        },
        taskBrief: {
          contentMarkdown: "# implementation brief",
          evidence: [
            { path: "internal/storage/path.go" },
            { path: "internal/storage/path_test.go" },
          ],
        },
      },
    });

    expect(output).toContain("acceptance criteria");
    expect(output).toContain("Do not open `SKILL.md`, run helper `--help`, or rediscover Squadrail transport usage in this lane.");
    expect(output).toContain("Do not use the `squadrail` skill in this lane and do not inspect any file under the repository `skills/` directory or the helper source file path itself.");
    expect(output).toContain("`REPORT_PROGRESS` is not mandatory");
    expect(output).toContain("send one early progress update as soon as you can name the target files");
    expect(output).toContain("A valid early `REPORT_PROGRESS` may describe the intended file edits");
    expect(output).toContain("Do not stop after `REPORT_PROGRESS`.");
    expect(output).toContain("Do not spend a long turn reading files");
    expect(output).toContain("prefer going straight from `START_IMPLEMENTATION` to focused edits");
    expect(output).toContain("send `ASK_CLARIFICATION` with `--question-type \"implementation\"`");
    expect(output).toContain("Use the concrete `ask-clarification` helper form below");
    expect(output).toContain('get-brief --issue "$SQUADRAIL_TASK_ID" --scope "engineer"');
    expect(output).toContain('ask-clarification --issue "issue-3" --sender-role "engineer"');
    expect(output).toContain('--question-type "implementation"');
    expect(output).toContain('--requested-from "human_board"');
    expect(output).toContain('submit-for-review --issue "issue-3" --sender-role "engineer" --reviewer-id "reviewer-123"');
    expect(output).toContain("your next protocol action should be the concrete `submit-for-review` helper command shown below");
    expect(output).toContain("Do not spend another turn drafting a prose recap");
    expect(output).toContain('--implementation-summary');
    expect(output).toContain('--review-checklist');
    expect(output).not.toContain("--recipients");
  });

  it("tightens implementation retry guidance after a protocol-required retry", () => {
    const output = renderSquadrailRuntimeNote({
      env: { SQUADRAIL_TASK_ID: "issue-3b" },
      context: {
        issueId: "issue-3b",
        protocolMessageType: "START_IMPLEMENTATION",
        protocolRecipientRole: "engineer",
        protocolWorkflowStateBefore: "implementing",
        protocolWorkflowStateAfter: "implementing",
        reviewerAgentId: "reviewer-123",
        protocolRequiredRetryCount: 2,
        protocolRequiredPreviousRunId: "run-prev-123",
        squadrailWorkspace: {
          workspaceUsage: "implementation",
          source: "project_worktree",
        },
      },
    });

    expect(output).toContain("RETRY MODE: complete the required protocol action first.");
    expect(output).toContain("RETRY WARNING: previous run run-prev-123 ended without required protocol progress.");
    expect(output).toContain("IMPLEMENTATION RETRY RULE: inspect the current workspace diff first");
    expect(output).toContain("IMPLEMENTATION RETRY RULE: if the focused acceptance test is already green");
  });

  it("adds follow-up implementation guidance after a progress-only implementation run", () => {
    const output = renderSquadrailRuntimeNote({
      env: { SQUADRAIL_TASK_ID: "issue-3c" },
      context: {
        issueId: "issue-3c",
        protocolMessageType: "START_IMPLEMENTATION",
        protocolRecipientRole: "engineer",
        protocolWorkflowStateBefore: "implementing",
        protocolWorkflowStateAfter: "implementing",
        reviewerAgentId: "reviewer-123",
        protocolProgressFollowupCount: 1,
        protocolProgressPreviousRunId: "run-progress-123",
        squadrailWorkspace: {
          workspaceUsage: "implementation",
          source: "project_worktree",
        },
      },
    });

    expect(output).toContain("FOLLOW-UP WARNING: previous implementation run run-progress-123 ended after progress only.");
    expect(output).toContain("FOLLOW-UP MODE: continue from the existing isolated workspace diff");
    expect(output).toContain("FOLLOW-UP MODE: do not restart baseline exploration");
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
        retrievalRunId: "00000000-0000-0000-0000-000000000444",
        taskBrief: {
          evidence: [
            { rank: 1, path: "internal/storage/path.go", sourceType: "code" },
            {
              rank: 2,
              path: "internal/storage/path.go",
              sourceType: "code_summary",
              documentMetadata: { summaryKind: "file" },
            },
          ],
        },
      },
    });

    expect(output).toContain("IMMEDIATE PROTOCOL ACTION:");
    expect(output).toContain("SHORT PROTOCOL LANE:");
    expect(output).toContain("Approval is incomplete until `CLOSE_TASK` or `REQUEST_HUMAN_DECISION` is recorded.");
    expect(output).toContain('close-task --issue "issue-4"');
    expect(output).toContain('--citation-run-id "00000000-0000-0000-0000-000000000444"');
    expect(output).toContain('--cited-source-types "code||code_summary"');
    expect(output).toContain('--cited-summary-kinds "file"');
    expect(output).toContain("include `evidenceCitations[]`");
  });

  it("includes concrete reviewer helper commands for short supervisory review lanes", () => {
    const output = renderSquadrailRuntimeNote({
      env: { SQUADRAIL_TASK_ID: "issue-5" },
      context: {
        issueId: "issue-5",
        protocolMessageType: "SUBMIT_FOR_REVIEW",
        protocolRecipientRole: "reviewer",
        protocolWorkflowStateBefore: "under_review",
        protocolWorkflowStateAfter: "under_review",
        retrievalRunId: "00000000-0000-0000-0000-000000000555",
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
          evidence: [
            { rank: 1, path: "internal/storage/path.go", sourceType: "code" },
            {
              rank: 2,
              path: "internal/storage/path.go",
              sourceType: "code_summary",
              documentMetadata: { summaryKind: "file" },
            },
          ],
        },
      },
    });

    expect(output).toContain("IMMEDIATE PROTOCOL ACTION:");
    expect(output).toContain("SHORT PROTOCOL LANE:");
    expect(output).toContain("Do not open `SKILL.md`, run `--help`, or rediscover helper usage in this lane.");
    expect(output).toContain("Do not use the `squadrail` skill in this lane and do not inspect any file under the repository `skills/` directory or the helper source file path unless the runtime note is missing entirely.");
    expect(output).toContain("Review is already open in this lane. Move directly to `APPROVE_IMPLEMENTATION`, `REQUEST_CHANGES`, or `REQUEST_HUMAN_DECISION`.");
    expect(output).toContain('approve-implementation --issue "issue-5"');
    expect(output).toContain('--citation-run-id "00000000-0000-0000-0000-000000000555"');
    expect(output).toContain('--cited-source-types "code||code_summary"');
    expect(output).toContain('--cited-summary-kinds "file"');
    expect(output).toContain("Structured wake context:");
    expect(output).not.toContain("very long retrieval query that should be omitted in short supervisory lanes");
    expect(output).not.toContain('start-review --issue "issue-5" --payload');
    expect(output).toContain("cite it with `evidenceCitations[]`");
    expect(output).toContain("prefer `APPROVE_IMPLEMENTATION` over `REQUEST_HUMAN_DECISION`");
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
    expect(output).toContain('reassign-task --issue "issue-6" --sender-role "tech_lead" --payload');
    expect(output).toContain('"newAssigneeAgentId":"agent-eng-1"');
    expect(output).toContain('"newReviewerAgentId":"agent-rev-1"');
  });

  it("prefers tech-lead routing in PM supervisory reassignment snippets", () => {
    const output = renderSquadrailRuntimeNote({
      env: { SQUADRAIL_TASK_ID: "issue-6b" },
      context: {
        issueId: "issue-6b",
        protocolMessageType: "ASSIGN_TASK",
        protocolRecipientRole: "pm",
        protocolWorkflowStateBefore: "backlog",
        protocolWorkflowStateAfter: "assigned",
        protocolSummary: "Clarify the scope, then hand execution to the project tech lead.",
        techLeadAgentId: "agent-tl-1",
        protocolPayload: {
          assigneeAgentId: "agent-pm-1",
          reviewerAgentId: "agent-tl-1",
          qaAgentId: "agent-qa-1",
        },
      },
    });

    expect(output).toContain('reassign-task --issue "issue-6b" --sender-role "pm" --payload');
    expect(output).toContain('"newAssigneeAgentId":"agent-tl-1"');
    expect(output).toContain('"newAssigneeRole":"tech_lead"');
    expect(output).not.toContain('"newAssigneeAgentId":"agent-pm-1"');
    expect(output).not.toContain('"newReviewerAgentId":"agent-tl-1"');
    expect(output).not.toContain('"newReviewerAgentId":"agent-qa-1"');
    expect(output).not.toContain("$TARGET_REVIEWER_AGENT_ID");
    expect(output).toContain('"newQaAgentId":"agent-qa-1"');
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
