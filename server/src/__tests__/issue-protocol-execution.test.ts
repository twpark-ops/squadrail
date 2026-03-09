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

  it("wakes reviewer recipients for internal child issue assignment when watch mode is enabled", () => {
    const plan = buildProtocolExecutionDispatchPlan({
      issueId: "child-1",
      protocolMessageId: "msg-1c",
      senderAgentId: null,
      issueContext: {
        issueId: "child-1",
        parentId: "root-1",
        hiddenAt: new Date("2026-03-09T00:00:00.000Z"),
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
      kind: "wakeup",
      reason: "issue_watch_assigned",
      payload: {
        issueInternalWorkItem: true,
        rootIssueId: "root-1",
        protocolDispatchMode: "reviewer_watch",
      },
      contextSnapshot: {
        issueInternalWorkItem: true,
        rootIssueId: "root-1",
        protocolDispatchMode: "reviewer_watch",
      },
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
        hiddenAt: new Date("2026-03-09T00:00:00.000Z"),
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
          summary: "review package",
          evidence: ["tests"],
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
        taskBrief: {
          id: "brief-1",
          scope: "engineer",
          retrievalRunId: "retrieval-1",
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
        taskBrief: {
          id: "brief-1",
          scope: "engineer",
          retrievalRunId: "retrieval-1",
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
