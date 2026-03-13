import {
  agents,
  approvals,
  companies,
  costEvents,
  heartbeatRunEvents,
  heartbeatRuns,
  issueLabels,
  issueProtocolMessages,
  issueProtocolState,
  issueProtocolViolations,
  issueReviewCycles,
  issueTaskBriefs,
  issues,
  labels,
  projects,
  retrievalRuns,
} from "@squadrail/db";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockProtocolAppendMessage } = vi.hoisted(() => ({
  mockProtocolAppendMessage: vi.fn(),
}));

vi.mock("../services/issue-protocol.js", () => ({
  issueProtocolService: () => ({
    appendMessage: mockProtocolAppendMessage,
  }),
}));

import { dashboardService } from "../services/dashboard.js";

function createResolvedChain(rows: unknown[]) {
  const chain = {
    from: () => chain,
    where: () => chain,
    innerJoin: () => chain,
    leftJoin: () => chain,
    groupBy: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    then: <T>(resolve: (value: unknown[]) => T | PromiseLike<T>) =>
      Promise.resolve(rows).then(resolve),
  };
  return chain;
}

function createDashboardDbMock(input: {
  selectResults?: unknown[][];
  executeResults?: unknown[][];
  updateResults?: unknown[][];
}) {
  const selectQueue = [...(input.selectResults ?? [])];
  const executeQueue = [...(input.executeResults ?? [])];
  const updateQueue = [...(input.updateResults ?? [])];
  const updateSets: Array<{ table: unknown; value: unknown }> = [];

  const db = {
    select: () => createResolvedChain(selectQueue.shift() ?? []),
    execute: async () => executeQueue.shift() ?? [],
    update: (table: unknown) => ({
      set: (value: unknown) => {
        updateSets.push({ table, value });
        return {
          where: () => ({
            returning: async () => updateQueue.shift() ?? [],
          }),
        };
      },
    }),
  };

  return {
    db,
    updateSets,
  };
}

describe("dashboard service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds summary payloads from company-wide operator metrics", async () => {
    const { db } = createDashboardDbMock({
      selectResults: [
        [{ id: "company-1", budgetMonthlyCents: 40_000 }],
        [
          { status: "idle", count: 2 },
          { status: "running", count: 1 },
          { status: "paused", count: 1 },
          { status: "error", count: 1 },
        ],
        [
          { status: "backlog", count: 2 },
          { status: "in_progress", count: 3 },
          { status: "blocked", count: 1 },
          { status: "done", count: 4 },
        ],
        [{ count: 2 }],
        [{ count: 1 }],
        [
          { workflowState: "implementing", count: 2 },
          { workflowState: "submitted_for_review", count: 1 },
          { workflowState: "blocked", count: 1 },
          { workflowState: "awaiting_human_decision", count: 1 },
          { workflowState: "approved", count: 1 },
        ],
        [{ count: 3 }],
        [{ count: 12 }],
        [{ count: 2 }],
        [{ count: 1 }],
        [{ count: 2 }],
        [{ count: 4 }],
        [{ count: 1 }],
        [{ count: 5 }],
        [
          { errorCode: "dispatch_timeout", count: 2 },
          { errorCode: "process_lost", count: 1 },
          { errorCode: "workspace_required", count: 3 },
        ],
        [{ monthSpend: 20_000 }],
      ],
      executeResults: [[{
        totalDocuments: 20,
        totalLinks: 50,
        linkedChunks: 30,
        connectedDocuments: 15,
        activeProjects: 2,
      }]],
    });
    const service = dashboardService(db as never);

    const summary = await service.summary("company-1");

    expect(summary).toMatchObject({
      companyId: "company-1",
      agents: {
        active: 2,
        running: 1,
        paused: 1,
        error: 1,
      },
      tasks: {
        open: 6,
        inProgress: 3,
        blocked: 1,
        done: 4,
      },
      protocol: {
        executionQueueCount: 2,
        reviewQueueCount: 1,
        blockedQueueCount: 1,
        awaitingHumanDecisionCount: 1,
        readyToCloseCount: 1,
        staleQueueCount: 2,
        openViolationCount: 3,
        protocolMessagesLast24h: 12,
      },
      executionReliability: {
        runningRuns: 1,
        queuedRuns: 2,
        dispatchRedispatchesLast24h: 4,
        dispatchTimeoutsLast24h: 2,
        processLostLast24h: 1,
        workspaceBlockedLast24h: 3,
        priorityPreemptionsLast24h: 1,
      },
      attention: {
        urgentIssueCount: 11,
        reviewPressureCount: 2,
        staleWorkCount: 3,
        runtimeRiskCount: 6,
      },
      knowledge: {
        totalDocuments: 20,
        connectedDocuments: 15,
        linkedChunks: 30,
        totalLinks: 50,
        activeProjects: 2,
        lowConfidenceRuns7d: 5,
      },
      costs: {
        monthSpendCents: 20_000,
        monthBudgetCents: 40_000,
        monthUtilizationPercent: 50,
      },
      pendingApprovals: 2,
      staleTasks: 1,
    });
  });

  it("builds supervised work item views from hidden child issues", async () => {
    const { db } = createDashboardDbMock({
      selectResults: [
        [{ id: "company-1" }],
        [{
          issueId: "child-1",
          parentId: "root-1",
          identifier: "CLO-201",
          title: "Implement dependency gate",
          priority: "high",
          status: "blocked",
          assigneeAgentId: "eng-1",
          updatedAt: new Date("2026-03-13T10:00:00.000Z"),
          workflowState: "blocked",
          reviewerAgentId: "rev-1",
          techLeadAgentId: "lead-1",
          blockedCode: "dependency_wait",
          lastTransitionAt: new Date("2026-03-13T09:55:00.000Z"),
          lastProtocolMessageId: "message-1",
        }],
        [{
          id: "root-1",
          identifier: "CLO-200",
          title: "Ship dependency gate",
          projectId: "project-1",
          projectName: "Swiftsight Cloud",
        }],
        [
          { issueId: "child-1", name: "work:implementation" },
          { issueId: "child-1", name: "watch:reviewer" },
          { issueId: "child-1", name: "watch:lead" },
        ],
        [
          {
            id: "eng-1",
            name: "Engineer One",
            title: "Engineer",
            role: "engineer",
            status: "active",
          },
          {
            id: "rev-1",
            name: "Reviewer One",
            title: "Reviewer",
            role: "reviewer",
            status: "active",
          },
          {
            id: "lead-1",
            name: "Lead One",
            title: "Tech Lead",
            role: "tech_lead",
            status: "active",
          },
        ],
        [{ id: "message-1", summary: "Waiting for CLO-199 to land" }],
      ],
    });
    const service = dashboardService(db as never);

    const view = await service.teamSupervision({
      companyId: "company-1",
      limit: 10,
    });

    expect(view.summary).toEqual({
      total: 1,
      blocked: 1,
      review: 0,
      active: 0,
      queued: 0,
    });
    expect(view.items).toEqual([
      expect.objectContaining({
        rootIssueId: "root-1",
        rootIdentifier: "CLO-200",
        rootProjectName: "Swiftsight Cloud",
        workItemIssueId: "child-1",
        workItemIdentifier: "CLO-201",
        kind: "implementation",
        summaryKind: "blocked",
        summaryText: "Waiting for dependency issues to land before execution can resume.",
        watchReviewer: true,
        watchLead: true,
      }),
    ]);
  });

  it("builds per-agent performance views with health and queue stats", async () => {
    const { db } = createDashboardDbMock({
      selectResults: [
        [{ id: "company-1" }],
        [
          {
            id: "agent-1",
            name: "Engineer One",
            title: "Engineer",
            role: "engineer",
            status: "active",
            adapterType: "codex_local",
            lastHeartbeatAt: new Date("2026-03-13T10:00:00.000Z"),
          },
          {
            id: "agent-2",
            name: "Reviewer Two",
            title: "Reviewer",
            role: "reviewer",
            status: "active",
            adapterType: "claude_local",
            lastHeartbeatAt: new Date("2026-03-13T09:00:00.000Z"),
          },
        ],
        [
          { agentId: "agent-1", count: 3 },
          { agentId: "agent-2", count: 1 },
        ],
        [{ agentId: "agent-1", count: 4 }],
        [{ agentId: "agent-1", count: 2 }],
        [{ agentId: "agent-2", count: 1 }],
        [
          { agentId: "agent-1", status: "running", count: 1 },
          { agentId: "agent-1", status: "queued", count: 2 },
        ],
        [
          {
            agentId: "agent-1",
            status: "succeeded",
            startedAt: new Date("2026-03-13T08:00:00.000Z"),
            finishedAt: new Date("2026-03-13T08:03:00.000Z"),
          },
          {
            agentId: "agent-1",
            status: "failed",
            startedAt: new Date("2026-03-13T09:00:00.000Z"),
            finishedAt: new Date("2026-03-13T09:05:00.000Z"),
          },
        ],
        [{ agentId: "agent-1", count: 3 }],
      ],
    });
    const service = dashboardService(db as never);

    const view = await service.agentPerformance({
      companyId: "company-1",
      limit: 10,
    });

    expect(view.summary).toEqual({
      totalAgents: 2,
      healthyAgents: 0,
      warningAgents: 0,
      riskAgents: 2,
      priorityPreemptions7d: 3,
    });
    expect(view.items[0]).toMatchObject({
      agentId: "agent-1",
      openIssueCount: 3,
      completedIssueCount30d: 4,
      reviewBounceCount30d: 2,
      qaBounceCount30d: 0,
      runningCount: 1,
      queuedCount: 2,
      totalRuns7d: 2,
      successfulRuns7d: 1,
      failedRuns7d: 1,
      successRate7d: 50,
      averageRunDurationMs7d: 240000,
      priorityPreemptions7d: 3,
      health: "risk",
    });
  });

  it("builds protocol queue buckets with actors, violations, review cycles, and briefs", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-13T12:00:00.000Z"));

    const { db } = createDashboardDbMock({
      selectResults: [
        [{ id: "company-1", budgetMonthlyCents: 0 }],
        [
          {
            issueId: "issue-1",
            workflowState: "submitted_for_review",
            coarseIssueStatus: "in_review",
            techLeadAgentId: "lead-1",
            primaryEngineerAgentId: "eng-1",
            reviewerAgentId: "rev-1",
            currentReviewCycle: 2,
            lastProtocolMessageId: "message-1",
            lastTransitionAt: new Date("2026-03-13T06:00:00.000Z"),
            blockedPhase: null,
            blockedCode: null,
            issueIdentifier: "CLO-301",
            issueTitle: "Review runtime migration",
            issuePriority: "high",
            projectId: "project-1",
            projectName: "Runtime",
          },
          {
            issueId: "issue-2",
            workflowState: "blocked",
            coarseIssueStatus: "blocked",
            techLeadAgentId: "lead-1",
            primaryEngineerAgentId: "eng-2",
            reviewerAgentId: null,
            currentReviewCycle: 0,
            lastProtocolMessageId: null,
            lastTransitionAt: new Date("2026-03-13T11:30:00.000Z"),
            blockedPhase: "implementing",
            blockedCode: "dependency_wait",
            issueIdentifier: "CLO-302",
            issueTitle: "Wait for dependency",
            issuePriority: "medium",
            projectId: null,
            projectName: null,
          },
        ],
        [
          { id: "lead-1", name: "Lead", title: "Tech Lead", role: "tech_lead", status: "active" },
          { id: "eng-1", name: "Engineer", title: "Engineer", role: "engineer", status: "active" },
          { id: "eng-2", name: "Engineer Two", title: "Engineer", role: "engineer", status: "active" },
          { id: "rev-1", name: "Reviewer", title: "Reviewer", role: "reviewer", status: "active" },
        ],
        [
          {
            id: "message-1",
            messageType: "SUBMIT_FOR_REVIEW",
            summary: "Ready for reviewer pass",
            senderRole: "engineer",
            createdAt: new Date("2026-03-13T06:01:00.000Z"),
          },
        ],
        [
          { issueId: "issue-1", severity: "high" },
          { issueId: "issue-1", severity: "critical" },
        ],
        [
          { issueId: "issue-1", cycleNumber: 2, openedAt: new Date("2026-03-13T05:55:00.000Z") },
        ],
        [
          {
            id: "brief-1",
            issueId: "issue-1",
            briefScope: "reviewer",
            briefVersion: 3,
            workflowState: "submitted_for_review",
            retrievalRunId: "retrieval-1",
            contentMarkdown: "Review the migration patch and check the rollback notes.",
            createdAt: new Date("2026-03-13T06:00:00.000Z"),
          },
          {
            id: "brief-older",
            issueId: "issue-1",
            briefScope: "reviewer",
            briefVersion: 2,
            workflowState: "submitted_for_review",
            retrievalRunId: "retrieval-old",
            contentMarkdown: "Older brief",
            createdAt: new Date("2026-03-13T05:00:00.000Z"),
          },
        ],
      ],
    });
    const service = dashboardService(db as never);

    const view = await service.protocolQueue({
      companyId: "company-1",
      limit: 10,
    });

    expect(view.totalActiveIssues).toBe(2);
    expect(view.buckets.reviewQueue).toEqual([
      expect.objectContaining({
        issueId: "issue-1",
        identifier: "CLO-301",
        stale: true,
        nextOwnerRole: "reviewer",
        openViolationCount: 2,
        highestViolationSeverity: "critical",
        latestMessage: expect.objectContaining({
          summary: "Ready for reviewer pass",
        }),
        openReviewCycle: {
          cycleNumber: 2,
          openedAt: new Date("2026-03-13T05:55:00.000Z"),
        },
        latestBriefs: {
          reviewer: expect.objectContaining({
            id: "brief-1",
            briefVersion: 3,
            retrievalRunId: "retrieval-1",
          }),
        },
      }),
    ]);
    expect(view.buckets.blockedQueue).toEqual([
      expect.objectContaining({
        issueId: "issue-2",
        blockedCode: "dependency_wait",
        nextOwnerRole: "tech_lead",
      }),
    ]);
    expect(view.buckets.violationQueue[0]).toMatchObject({
      issueId: "issue-1",
      highestViolationSeverity: "critical",
    });

    vi.useRealTimers();
  });

  it("dedupes recovery cases and escalates repeated runtime failures", async () => {
    const now = new Date("2026-03-13T12:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const { db } = createDashboardDbMock({
      selectResults: [
        [{ id: "company-1" }],
        [
          {
            issueId: "issue-1",
            createdAt: new Date("2026-03-13T10:00:00.000Z"),
            severity: "high",
            code: "close_without_verification",
            summary: { error: "Close missing verification" },
          },
          {
            issueId: "issue-1",
            createdAt: new Date("2026-03-13T09:00:00.000Z"),
            severity: "high",
            code: "close_without_verification",
            summary: { error: "Duplicate violation" },
          },
        ],
        [
          {
            issueId: "issue-2",
            createdAt: new Date("2026-03-13T08:00:00.000Z"),
            summary: "Reviewer timeout",
            code: "review_timeout",
          },
        ],
        [
          {
            issueId: "issue-3",
            createdAt: new Date("2026-03-13T07:00:00.000Z"),
            unsignedCount: 2,
          },
        ],
        [
          {
            id: "run-1",
            contextSnapshot: { issueId: "issue-4" },
            errorCode: "dispatch_timeout",
            error: "Dispatch timed out",
            finishedAt: new Date("2026-03-13T11:00:00.000Z"),
            updatedAt: new Date("2026-03-13T11:00:00.000Z"),
          },
          {
            id: "run-2",
            contextSnapshot: { issueId: "issue-4" },
            errorCode: "dispatch_timeout",
            error: "Dispatch timed out again",
            finishedAt: new Date("2026-03-13T10:30:00.000Z"),
            updatedAt: new Date("2026-03-13T10:30:00.000Z"),
          },
        ],
        [
          { issueId: "issue-1", workflowState: "approved", identifier: "CLO-1", title: "Violation issue" },
          { issueId: "issue-2", workflowState: "blocked", identifier: "CLO-2", title: "Timeout issue" },
          { issueId: "issue-3", workflowState: "implementing", identifier: "CLO-3", title: "Integrity issue" },
          { issueId: "issue-4", workflowState: "implementing", identifier: "CLO-4", title: "Runtime issue" },
        ],
      ],
    });
    const service = dashboardService(db as never);

    const view = await service.recoveryQueue({
      companyId: "company-1",
      limit: 10,
    });

    expect(view.summary).toEqual({
      totalCases: 4,
      repeatedCases: 3,
      retryableCases: 0,
      operatorRequiredCases: 4,
      blockedCases: 0,
    });
    expect(view.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          issueId: "issue-1",
          recoveryType: "violation",
          occurrenceCount24h: 2,
          repeated: true,
        }),
        expect.objectContaining({
          issueId: "issue-4",
          recoveryType: "runtime",
          retryability: "operator_required",
          occurrenceCount24h: 2,
          repeated: true,
        }),
      ]),
    );

    vi.useRealTimers();
  });

  it("resolves open protocol violations in bulk", async () => {
    const { db, updateSets } = createDashboardDbMock({
      selectResults: [[{ id: "company-1" }]],
      updateResults: [[{ id: "violation-1" }, { id: "violation-2" }]],
    });
    const service = dashboardService(db as never);

    const result = await service.applyRecoveryAction({
      companyId: "company-1",
      actionType: "resolve_violations",
      issueIds: ["issue-1", "issue-2"],
      recoveryTypes: ["violation"],
      actor: {
        userId: "board-1",
      },
    });

    expect(result).toEqual({
      actionType: "resolve_violations",
      issueIds: ["issue-1", "issue-2"],
      affectedViolationCount: 2,
      createdMessageCount: 0,
    });
    expect(updateSets[0]).toEqual({
      table: issueProtocolViolations,
      value: expect.objectContaining({
        status: "resolved",
        resolvedAt: expect.any(Date),
      }),
    });
  });

  it("posts recovery notes through the protocol service with resolved recipients", async () => {
    const { db } = createDashboardDbMock({
      selectResults: [
        [{ id: "company-1" }],
        [
          {
            issueId: "issue-1",
            workflowState: "blocked",
            engineerAgentId: "eng-1",
            reviewerAgentId: "rev-1",
            techLeadAgentId: "lead-1",
          },
          {
            issueId: "issue-2",
            workflowState: "approved",
            engineerAgentId: null,
            reviewerAgentId: null,
            techLeadAgentId: null,
          },
        ],
      ],
    });
    const service = dashboardService(db as never);

    const result = await service.applyRecoveryAction({
      companyId: "company-1",
      actionType: "post_recovery_note",
      issueIds: ["issue-1", "issue-2"],
      noteBody: "Review the latest recovery evidence before another retry.",
      actor: {
        userId: "board-1",
      },
    });

    expect(result).toEqual({
      actionType: "post_recovery_note",
      issueIds: ["issue-1", "issue-2"],
      affectedViolationCount: 0,
      createdMessageCount: 2,
    });
    expect(mockProtocolAppendMessage).toHaveBeenCalledTimes(2);
    expect(mockProtocolAppendMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        issueId: "issue-1",
        authorUserId: "board-1",
        message: expect.objectContaining({
          messageType: "NOTE",
          workflowStateBefore: "blocked",
          workflowStateAfter: "blocked",
          recipients: [
            { recipientType: "agent", recipientId: "lead-1", role: "tech_lead" },
            { recipientType: "agent", recipientId: "eng-1", role: "engineer" },
            { recipientType: "agent", recipientId: "rev-1", role: "reviewer" },
          ],
        }),
      }),
    );
    expect(mockProtocolAppendMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        issueId: "issue-2",
        message: expect.objectContaining({
          recipients: [
            { recipientType: "user", recipientId: "board-1", role: "human_board" },
          ],
        }),
      }),
    );
  });
});
