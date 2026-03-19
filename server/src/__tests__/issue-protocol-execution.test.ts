import { describe, expect, it } from "vitest";
import {
  buildProtocolExecutionDispatchPlan,
  shouldTransferActiveIssueExecution,
} from "../services/issue-protocol-execution.js";

describe("buildProtocolExecutionDispatchPlan", () => {
  it("maps assignment messages to assignment wakeups", () => {
    const plan = buildProtocolExecutionDispatchPlan({
      issueId: "issue-1",
      protocolMessageId: "msg-1",
      senderAgentId: null,
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
        ],
        workflowStateBefore: "backlog",
        workflowStateAfter: "assigned",
        summary: "assign",
        payload: {
          goal: "goal",
          acceptanceCriteria: ["a"],
          definitionOfDone: ["d"],
          priority: "high",
          assigneeAgentId: "00000000-0000-0000-0000-000000000001",
          reviewerAgentId: "00000000-0000-0000-0000-000000000002",
        },
        artifacts: [],
      },
    });

    expect(plan[0]).toMatchObject({
      kind: "wakeup",
      source: "assignment",
      reason: "issue_assigned",
      recipientId: "eng-1",
    });
  });

  it("wakes the clarifying participant when a human clarification answer is posted", () => {
    const plan = buildProtocolExecutionDispatchPlan({
      issueId: "issue-clarify",
      protocolMessageId: "msg-answer-1",
      senderAgentId: null,
      message: {
        messageType: "ANSWER_CLARIFICATION",
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
        workflowStateBefore: "implementing",
        workflowStateAfter: "implementing",
        summary: "Board answered the missing project question",
        causalMessageId: "question-1",
        payload: {
          answer: "Use the swiftsight-cloud project.",
          nextStep: "Resume implementation planning.",
        },
        artifacts: [],
      },
    });

    expect(plan[0]).toMatchObject({
      kind: "wakeup",
      source: "automation",
      reason: "protocol_clarification_answered",
      recipientId: "eng-1",
      contextSnapshot: {
        protocolMessageType: "ANSWER_CLARIFICATION",
      },
    });
  });

  it("keeps reviewer recipients as notify_only during assignment handoff", () => {
    const plan = buildProtocolExecutionDispatchPlan({
      issueId: "issue-1",
      protocolMessageId: "msg-1b",
      senderAgentId: null,
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
            recipientId: "lead-1",
            role: "tech_lead",
          },
          {
            recipientType: "agent",
            recipientId: "reviewer-1",
            role: "reviewer",
          },
        ],
        workflowStateBefore: "backlog",
        workflowStateAfter: "assigned",
        summary: "assign",
        payload: {
          goal: "goal",
          acceptanceCriteria: ["a"],
          definitionOfDone: ["d"],
          priority: "high",
          assigneeAgentId: "00000000-0000-0000-0000-000000000001",
          reviewerAgentId: "00000000-0000-0000-0000-000000000002",
        },
        artifacts: [],
      },
    });

    expect(plan[0]?.kind).toBe("wakeup");
    expect(plan[1]?.kind).toBe("notify_only");
  });

  it("keeps QA recipients as notify_only during assignment handoff", () => {
    const plan = buildProtocolExecutionDispatchPlan({
      issueId: "issue-1",
      protocolMessageId: "msg-1qa",
      senderAgentId: null,
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
            recipientId: "qa-1",
            role: "qa",
          },
        ],
        workflowStateBefore: "backlog",
        workflowStateAfter: "assigned",
        summary: "assign with qa gate",
        payload: {
          goal: "goal",
          acceptanceCriteria: ["a"],
          definitionOfDone: ["d"],
          priority: "high",
          assigneeAgentId: "00000000-0000-0000-0000-000000000001",
          reviewerAgentId: "00000000-0000-0000-0000-000000000002",
          qaAgentId: "00000000-0000-0000-0000-000000000003",
        },
        artifacts: [],
      },
    });

    expect(plan[0]?.kind).toBe("wakeup");
    expect(plan[1]).toMatchObject({
      kind: "notify_only",
      recipientId: "qa-1",
      recipientRole: "qa",
    });
  });

  it("keeps reviewer recipients as notify_only for internal implementation child assignment even when watch mode is enabled", () => {
    const plan = buildProtocolExecutionDispatchPlan({
      issueId: "child-1",
      protocolMessageId: "msg-1c",
      senderAgentId: null,
      issueContext: {
        issueId: "child-1",
        parentId: "root-1",

        labelNames: ["team:internal", "work:implementation", "watch:reviewer", "watch:lead"],
        techLeadAgentId: "lead-1",
      },
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
        summary: "assign child work item",
        payload: {
          goal: "goal",
          acceptanceCriteria: ["a"],
          definitionOfDone: ["d"],
          priority: "high",
          assigneeAgentId: "00000000-0000-0000-0000-000000000001",
          reviewerAgentId: "00000000-0000-0000-0000-000000000002",
        },
        artifacts: [],
      },
    });

    expect(plan[1]).toMatchObject({
      kind: "notify_only",
      recipientRole: "reviewer",
      payload: {
        issueInternalWorkItem: true,
        rootIssueId: "root-1",
      },
      contextSnapshot: {
        issueInternalWorkItem: true,
        rootIssueId: "root-1",
      },
    });
  });

  it("keeps lead watchers as notify_only for internal implementation child assignment when an engineer is already assigned", () => {
    const plan = buildProtocolExecutionDispatchPlan({
      issueId: "child-impl-lead-watch-1",
      protocolMessageId: "msg-1c-lead",
      senderAgentId: null,
      issueContext: {
        issueId: "child-impl-lead-watch-1",
        parentId: "root-1",
        labelNames: ["team:internal", "work:implementation", "watch:reviewer", "watch:lead"],
        techLeadAgentId: "lead-1",
        primaryEngineerAgentId: "eng-1",
      },
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
            recipientId: "lead-1",
            role: "tech_lead",
          },
        ],
        workflowStateBefore: "backlog",
        workflowStateAfter: "assigned",
        summary: "assign implementation work item with TL watch",
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
    });

    expect(plan[0]).toMatchObject({
      kind: "wakeup",
      recipientRole: "engineer",
    });
    expect(plan[1]).toMatchObject({
      kind: "notify_only",
      recipientRole: "tech_lead",
      payload: {
        issueInternalWorkItem: true,
        rootIssueId: "root-1",
      },
      contextSnapshot: {
        issueInternalWorkItem: true,
        rootIssueId: "root-1",
      },
    });
  });

  it("still wakes reviewer recipients for internal review child assignment when watch mode is enabled", () => {
    const plan = buildProtocolExecutionDispatchPlan({
      issueId: "child-review-1",
      protocolMessageId: "msg-1d",
      senderAgentId: null,
      issueContext: {
        issueId: "child-review-1",
        parentId: "root-1",

        labelNames: ["team:internal", "work:review", "watch:reviewer", "watch:lead"],
        techLeadAgentId: "lead-1",
      },
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
            recipientId: "reviewer-1",
            role: "reviewer",
          },
        ],
        workflowStateBefore: "backlog",
        workflowStateAfter: "assigned",
        summary: "assign review work item",
        payload: {
          goal: "review",
          acceptanceCriteria: ["a"],
          definitionOfDone: ["d"],
          priority: "high",
          assigneeAgentId: "00000000-0000-0000-0000-000000000002",
          reviewerAgentId: "00000000-0000-0000-0000-000000000002",
        },
        artifacts: [],
      },
    });

    expect(plan[0]).toMatchObject({
      kind: "wakeup",
      reason: "issue_watch_assigned",
      payload: {
        issueInternalWorkItem: true,
        rootIssueId: "root-1",
        protocolDispatchMode: "reviewer_watch",
      },
    });
  });

  it("includes review submission artifacts in reviewer wake context", () => {
    const plan = buildProtocolExecutionDispatchPlan({
      issueId: "issue-review-1",
      protocolMessageId: "msg-review-1",
      senderAgentId: "eng-1",
      message: {
        messageType: "SUBMIT_FOR_REVIEW",
        sender: {
          actorType: "agent",
          actorId: "eng-1",
          role: "engineer",
        },
        recipients: [
          {
            recipientType: "agent",
            recipientId: "reviewer-1",
            role: "reviewer",
          },
        ],
        workflowStateBefore: "implementing",
        workflowStateAfter: "submitted_for_review",
        summary: "Ready for review",
        payload: {
          implementationSummary: "Implemented build-info version resolution.",
          diffSummary: "2 files changed, 52 insertions(+), 5 deletions(-)",
          changedFiles: ["internal/observability/tracing.go", "internal/observability/tracing_test.go"],
          testResults: ["go test ./internal/observability -count=1: PASS"],
          evidence: ["resolveServiceVersion() replaces the hard-coded constant."],
          reviewChecklist: ["Version is no longer hard-coded."],
          residualRisks: ["Fallback remains necessary outside stamped builds."],
        },
        artifacts: [
          {
            kind: "diff",
            uri: "run://run-1/workspace-diff",
            label: "2 files changed, 52 insertions(+), 5 deletions(-)",
            metadata: {
              changedFiles: ["internal/observability/tracing.go", "internal/observability/tracing_test.go"],
              diffStat: "2 files changed, 52 insertions(+), 5 deletions(-)",
            },
          },
          {
            kind: "doc",
            uri: "workspace://ws-1/binding",
            label: "Workspace binding project_isolated",
            metadata: {
              bindingType: "implementation_workspace",
              cwd: "/tmp/.squadrail-worktrees/swiftsight-cloud/run-1",
              branchName: "squadrail/test/review",
              headSha: "abc123",
            },
          },
          {
            kind: "test_run",
            uri: "run://run-1/test",
            label: "go test ./internal/observability -count=1",
            metadata: {
              observedStatus: "passed",
            },
          },
        ],
      },
    });

    expect(plan[0]?.kind).toBe("wakeup");
    expect(plan[0]?.contextSnapshot.reviewSubmission).toMatchObject({
      implementationSummary: "Implemented build-info version resolution.",
      changedFiles: ["internal/observability/tracing.go", "internal/observability/tracing_test.go"],
      implementationWorkspace: {
        bindingType: "implementation_workspace",
        cwd: "/tmp/.squadrail-worktrees/swiftsight-cloud/run-1",
      },
      diffArtifact: {
        kind: "diff",
        label: "2 files changed, 52 insertions(+), 5 deletions(-)",
      },
      verificationArtifacts: [
        {
          kind: "test_run",
          label: "go test ./internal/observability -count=1",
          observedStatus: "passed",
        },
      ],
    });
  });

  it("skips wakeup to the sender agent", () => {
    const plan = buildProtocolExecutionDispatchPlan({
      issueId: "issue-1",
      protocolMessageId: "msg-2",
      senderAgentId: "eng-1",
      message: {
        messageType: "ASK_CLARIFICATION",
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
        ],
        workflowStateBefore: "implementing",
        workflowStateAfter: "implementing",
        summary: "clarify",
        payload: {
          questionType: "implementation",
          question: "question",
          blocking: true,
          requestedFrom: "tech_lead",
        },
        artifacts: [],
      },
    });

    expect(plan[0]?.kind).toBe("skip_sender");
  });

  it("keeps CANCEL_TASK recipients as notify_only", () => {
    const plan = buildProtocolExecutionDispatchPlan({
      issueId: "issue-1",
      protocolMessageId: "msg-cancel",
      senderAgentId: null,
      message: {
        messageType: "CANCEL_TASK",
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
        workflowStateBefore: "implementing",
        workflowStateAfter: "cancelled",
        summary: "cancel task",
        payload: {
          reason: "stop",
          cancelType: "manual_stop",
          replacementIssueId: null,
        },
        artifacts: [],
      },
    });

    expect(plan.map((item) => item.kind)).toEqual(["notify_only", "notify_only"]);
  });

  it("coalesces engineer self-START into active run with workspace override", () => {
    const plan = buildProtocolExecutionDispatchPlan({
      issueId: "issue-1",
      protocolMessageId: "msg-2b",
      senderAgentId: "eng-1",
      message: {
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
        ],
        workflowStateBefore: "planning",
        workflowStateAfter: "implementing",
        summary: "start implementation",
        payload: {
          implementationMode: "code_change",
          activeHypotheses: ["worktree should be isolated"],
        },
        artifacts: [],
      },
    });

    expect(plan[0]).toMatchObject({
      kind: "wakeup",
      reason: "protocol_implementation_started",
      payload: {
        forceFollowupRun: true,
        workspaceUsageOverride: "implementation",
      },
      contextSnapshot: {
        forceFollowupRun: true,
        workspaceUsageOverride: "implementation",
      },
    });
    // No protocolDispatchMode — default mode is omitted from payload
    expect(plan[0].payload).not.toHaveProperty("protocolDispatchMode");
  });

  it("forces a fresh engineer recovery run after REQUEST_CHANGES", () => {
    const plan = buildProtocolExecutionDispatchPlan({
      issueId: "issue-1",
      protocolMessageId: "msg-recovery-1",
      senderAgentId: "reviewer-1",
      message: {
        messageType: "REQUEST_CHANGES",
        sender: {
          actorType: "agent",
          actorId: "reviewer-1",
          role: "reviewer",
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
        workflowStateBefore: "under_review",
        workflowStateAfter: "changes_requested",
        summary: "Need one deterministic recovery cycle",
        payload: {
          reviewSummary: "Recovery proof is required before approval.",
          requiredEvidence: [
            "ACK_CHANGE_REQUEST from the active engineer owner",
            "Focused resubmission from the same implementation lane",
          ],
          changeRequests: [
            {
              title: "refresh-evidence",
              reason: "Reviewer wants one explicit recovery cycle.",
              affectedFiles: ["internal/observability/tracing.go"],
              suggestedAction: "Acknowledge and resubmit from the same engineer lane.",
            },
          ],
        },
        artifacts: [],
      },
    });

    expect(plan.find((item) => item.recipientRole === "engineer")).toMatchObject({
      kind: "wakeup",
      recipientId: "eng-1",
      reason: "protocol_changes_requested",
      payload: {
        forceFollowupRun: true,
        workspaceUsageOverride: "implementation",
      },
      contextSnapshot: {
        forceFollowupRun: true,
        workspaceUsageOverride: "implementation",
        protocolRecipientRole: "engineer",
      },
    });

    expect(plan.find((item) => item.recipientRole === "tech_lead")).toMatchObject({
      kind: "notify_only",
      recipientId: "lead-1",
      reason: "protocol_changes_requested",
    });
  });

  it("requeues the project tech lead for CLOSE_TASK after reviewer approval, even when reviewer and tech lead are the same agent", () => {
    const plan = buildProtocolExecutionDispatchPlan({
      issueId: "issue-approval-1",
      protocolMessageId: "msg-approval-1",
      senderAgentId: "lead-1",
      issueContext: {
        issueId: "issue-approval-1",
        parentId: null,

        labelNames: [],
        techLeadAgentId: "lead-1",
      },
      message: {
        messageType: "APPROVE_IMPLEMENTATION",
        sender: {
          actorType: "agent",
          actorId: "lead-1",
          role: "reviewer",
        },
        recipients: [
          {
            recipientType: "agent",
            recipientId: "lead-1",
            role: "reviewer",
          },
        ],
        workflowStateBefore: "under_review",
        workflowStateAfter: "approved",
        summary: "approved",
        payload: {
          approvalSummary: "Looks good.",
          approvalMode: "agent_review",
          approvalChecklist: ["Focused tests passed."],
          verifiedEvidence: ["go test ./internal/observability -count=1: PASS"],
          residualRisks: ["Fallback remains relevant in unstamped builds."],
        },
        artifacts: [],
      },
    });

    expect(plan).toHaveLength(2);
    expect(plan[1]).toMatchObject({
      kind: "wakeup",
      recipientId: "lead-1",
      recipientRole: "tech_lead",
      reason: "issue_ready_for_closure",
      payload: {
        forceFollowupRun: true,
        forceFreshAdapterSession: true,
        protocolDispatchMode: "approval_close_followup",
      },
      contextSnapshot: {
        forceFollowupRun: true,
        forceFreshAdapterSession: true,
        protocolDispatchMode: "approval_close_followup",
        protocolRecipientRole: "tech_lead",
      },
    });
  });

  it("routes reviewer approval into a QA gate when qaAgentId is configured", () => {
    const plan = buildProtocolExecutionDispatchPlan({
      issueId: "issue-approval-qa-1",
      protocolMessageId: "msg-approval-qa-1",
      senderAgentId: "reviewer-1",
      issueContext: {
        issueId: "issue-approval-qa-1",
        parentId: null,

        labelNames: [],
        techLeadAgentId: "lead-1",
        qaAgentId: "qa-1",
      },
      message: {
        messageType: "APPROVE_IMPLEMENTATION",
        sender: {
          actorType: "agent",
          actorId: "reviewer-1",
          role: "reviewer",
        },
        recipients: [
          {
            recipientType: "agent",
            recipientId: "reviewer-1",
            role: "reviewer",
          },
        ],
        workflowStateBefore: "under_review",
        workflowStateAfter: "qa_pending",
        summary: "approved pending qa gate",
        payload: {
          approvalSummary: "Primary review passed.",
          approvalMode: "agent_review",
          approvalChecklist: ["Focused tests passed."],
          verifiedEvidence: ["go test ./pkg -count=1: PASS"],
          residualRisks: ["Operational QA validation is still pending."],
        },
        artifacts: [],
      },
    });

    expect(plan.some((item) => item.recipientRole === "tech_lead" && item.reason === "issue_ready_for_closure")).toBe(false);
    expect(plan.find((item) => item.recipientRole === "qa")).toMatchObject({
      kind: "wakeup",
      recipientId: "qa-1",
      reason: "issue_ready_for_qa_gate",
      payload: {
        forceFollowupRun: true,
        protocolDispatchMode: "qa_gate_followup",
      },
      contextSnapshot: {
        forceFollowupRun: true,
        protocolDispatchMode: "qa_gate_followup",
        protocolRecipientRole: "qa",
      },
    });
  });

  it("promotes direct tech lead approval recipients into a closure follow-up wake", () => {
    const plan = buildProtocolExecutionDispatchPlan({
      issueId: "issue-approval-direct-close-1",
      protocolMessageId: "msg-approval-direct-close-1",
      senderAgentId: "reviewer-1",
      issueContext: {
        issueId: "issue-approval-direct-close-1",
        parentId: null,
        labelNames: [],
        techLeadAgentId: "lead-1",
      },
      message: {
        messageType: "APPROVE_IMPLEMENTATION",
        sender: {
          actorType: "agent",
          actorId: "reviewer-1",
          role: "reviewer",
        },
        recipients: [
          {
            recipientType: "agent",
            recipientId: "lead-1",
            role: "tech_lead",
          },
        ],
        workflowStateBefore: "under_review",
        workflowStateAfter: "approved",
        summary: "approved for closure",
        payload: {
          approvalSummary: "Ready for closure.",
          approvalMode: "agent_review",
          approvalChecklist: ["Focused tests passed."],
          verifiedEvidence: ["pnpm test: PASS", "pnpm build: PASS"],
          residualRisks: ["External merge remains pending."],
        },
        artifacts: [],
      },
    });

    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({
      kind: "wakeup",
      recipientId: "lead-1",
      recipientRole: "tech_lead",
      reason: "issue_ready_for_closure",
      payload: {
        forceFollowupRun: true,
        forceFreshAdapterSession: true,
        protocolDispatchMode: "approval_close_followup",
      },
      contextSnapshot: {
        forceFollowupRun: true,
        forceFreshAdapterSession: true,
        protocolDispatchMode: "approval_close_followup",
        protocolRecipientRole: "tech_lead",
      },
    });
  });

  it("keeps board recipients as notify_only", () => {
    const plan = buildProtocolExecutionDispatchPlan({
      issueId: "issue-1",
      protocolMessageId: "msg-3",
      senderAgentId: "reviewer-1",
      message: {
        messageType: "REQUEST_HUMAN_DECISION",
        sender: {
          actorType: "agent",
          actorId: "reviewer-1",
          role: "reviewer",
        },
        recipients: [
          {
            recipientType: "role_group",
            recipientId: "human_board",
            role: "human_board",
          },
        ],
        workflowStateBefore: "under_review",
        workflowStateAfter: "awaiting_human_decision",
        summary: "need decision",
        payload: {
          decisionType: "architecture_choice",
          decisionQuestion: "pick one",
          options: ["a", "b"],
        },
        artifacts: [],
      },
    });

    expect(plan[0]).toMatchObject({
      kind: "notify_only",
      reason: "protocol_human_decision_requested",
    });
  });

  it("propagates timeout metadata into wake payload and context", () => {
    const plan = buildProtocolExecutionDispatchPlan({
      issueId: "issue-1",
      protocolMessageId: "msg-4",
      senderAgentId: null,
      message: {
        messageType: "TIMEOUT_ESCALATION",
        sender: {
          actorType: "system",
          actorId: "timeout-worker",
          role: "system",
        },
        recipients: [
          {
            recipientType: "agent",
            recipientId: "lead-1",
            role: "tech_lead",
          },
        ],
        workflowStateBefore: "submitted_for_review",
        workflowStateAfter: "submitted_for_review",
        summary: "timeout escalation",
        payload: {
          timeoutCode: "review_start_timeout",
          expiredActorRole: "reviewer",
          nextEscalationTarget: "tech_lead",
        },
        artifacts: [],
      },
    });

    expect(plan[0]).toMatchObject({
      kind: "wakeup",
      reason: "protocol_timeout_escalation",
      payload: {
        timeoutCode: "review_start_timeout",
      },
      contextSnapshot: {
        timeoutCode: "review_start_timeout",
      },
    });
  });

  it("injects a lead supervisor wake for tracked child issue protocol events", () => {
    const plan = buildProtocolExecutionDispatchPlan({
      issueId: "child-2",
      protocolMessageId: "msg-4b",
      senderAgentId: "eng-1",
      issueContext: {
        issueId: "child-2",
        parentId: "root-2",

        labelNames: ["team:internal", "work:implementation", "watch:lead"],
        techLeadAgentId: "lead-1",
      },
      message: {
        messageType: "SUBMIT_FOR_REVIEW",
        sender: {
          actorType: "agent",
          actorId: "eng-1",
          role: "engineer",
        },
        recipients: [
          {
            recipientType: "agent",
            recipientId: "reviewer-1",
            role: "reviewer",
          },
        ],
        workflowStateBefore: "implementing",
        workflowStateAfter: "submitted_for_review",
        summary: "ready for review",
        payload: {
          implementationSummary: "review package",
          evidence: ["tests"],
          reviewChecklist: ["review critical path"],
          changedFiles: ["src/retry.ts"],
          testResults: ["pnpm vitest retry"],
          residualRisks: ["No known residual risk."],
          diffSummary: "Updated retry control flow and tests.",
        },
        artifacts: [],
      },
    });

    expect(plan).toHaveLength(2);
    expect(plan[1]).toMatchObject({
      kind: "wakeup",
      recipientId: "lead-1",
      recipientRole: "tech_lead",
      reason: "issue_supervisor_review_submitted",
      payload: {
        issueInternalWorkItem: true,
        rootIssueId: "root-2",
        protocolDispatchMode: "lead_supervisor",
      },
      contextSnapshot: {
        issueInternalWorkItem: true,
        rootIssueId: "root-2",
        protocolDispatchMode: "lead_supervisor",
      },
    });
  });

  it("propagates recipient retrieval hints into wake payload and context", () => {
    const plan = buildProtocolExecutionDispatchPlan({
      issueId: "issue-1",
      protocolMessageId: "msg-5",
      senderAgentId: null,
      recipientHints: [
        {
          recipientId: "eng-1",
          recipientRole: "engineer",
          executionLane: "fast",
          briefId: "brief-1",
          briefScope: "engineer",
          retrievalRunId: "retrieval-1",
          briefContentMarkdown: "# engineer brief\n\nUse retry policy ADR.",
          briefEvidenceSummary: [
            {
              rank: 1,
              sourceType: "code",
              path: "src/retry.ts",
              title: "Retry policy",
              fusedScore: 0.93,
            },
          ],
        },
      ],
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
        ],
        workflowStateBefore: "backlog",
        workflowStateAfter: "assigned",
        summary: "assign",
        payload: {
          goal: "goal",
          acceptanceCriteria: ["a"],
          definitionOfDone: ["d"],
          priority: "high",
          assigneeAgentId: "00000000-0000-0000-0000-000000000001",
          reviewerAgentId: "00000000-0000-0000-0000-000000000002",
        },
        artifacts: [],
      },
    });

    expect(plan[0]).toMatchObject({
      payload: {
        latestBriefId: "brief-1",
        latestBriefScope: "engineer",
        retrievalRunId: "retrieval-1",
        executionLane: "fast",
        taskBrief: {
          id: "brief-1",
          scope: "engineer",
          retrievalRunId: "retrieval-1",
          executionLane: "fast",
          contentMarkdown: "# engineer brief\n\nUse retry policy ADR.",
          evidence: [
            {
              rank: 1,
              sourceType: "code",
              path: "src/retry.ts",
              title: "Retry policy",
              fusedScore: 0.93,
            },
          ],
        },
      },
      contextSnapshot: {
        latestBriefId: "brief-1",
        latestBriefScope: "engineer",
        retrievalRunId: "retrieval-1",
        executionLane: "fast",
        taskBrief: {
          id: "brief-1",
          scope: "engineer",
          retrievalRunId: "retrieval-1",
          executionLane: "fast",
          contentMarkdown: "# engineer brief\n\nUse retry policy ADR.",
          evidence: [
            {
              rank: 1,
              sourceType: "code",
              path: "src/retry.ts",
              title: "Retry policy",
              fusedScore: 0.93,
            },
          ],
        },
      },
    });
  });
});

describe("shouldTransferActiveIssueExecution", () => {
  it("transfers execution for assignment handoff to a different agent", () => {
    expect(
      shouldTransferActiveIssueExecution({
        messageType: "ASSIGN_TASK",
        targetAgentId: "agent-b",
        activeRunAgentId: "agent-a",
        activeRunStatus: "running",
      }),
    ).toBe(true);
  });

  it("does not transfer execution for the same assignee", () => {
    expect(
      shouldTransferActiveIssueExecution({
        messageType: "REASSIGN_TASK",
        targetAgentId: "agent-a",
        activeRunAgentId: "agent-a",
        activeRunStatus: "running",
      }),
    ).toBe(false);
  });

  it("does not transfer execution for non-handoff protocol messages", () => {
    expect(
      shouldTransferActiveIssueExecution({
        messageType: "REPORT_PROGRESS",
        targetAgentId: "agent-b",
        activeRunAgentId: "agent-a",
        activeRunStatus: "running",
      }),
    ).toBe(false);
  });
});
