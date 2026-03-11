import { describe, expect, it } from "vitest";
import {
  buildDashboardAttentionSummary,
  buildDashboardKnowledgeSummary,
  buildExecutionReliabilitySummary,
  buildProtocolDashboardBuckets,
  isProtocolDashboardStale,
  type DashboardProtocolQueueItem,
} from "../services/dashboard.js";

function queueItem(overrides: Partial<DashboardProtocolQueueItem>): DashboardProtocolQueueItem {
  return {
    issueId: overrides.issueId ?? crypto.randomUUID(),
    identifier: overrides.identifier ?? null,
    title: overrides.title ?? "Issue",
    priority: overrides.priority ?? "medium",
    projectId: overrides.projectId ?? null,
    projectName: overrides.projectName ?? null,
    coarseIssueStatus: overrides.coarseIssueStatus ?? "in_progress",
    workflowState: overrides.workflowState ?? "implementing",
    currentReviewCycle: overrides.currentReviewCycle ?? 0,
    lastTransitionAt: overrides.lastTransitionAt ?? new Date("2026-03-07T00:00:00.000Z"),
    stale: overrides.stale ?? false,
    nextOwnerRole: overrides.nextOwnerRole ?? "engineer",
    blockedPhase: overrides.blockedPhase ?? null,
    blockedCode: overrides.blockedCode ?? null,
    openViolationCount: overrides.openViolationCount ?? 0,
    highestViolationSeverity: overrides.highestViolationSeverity ?? null,
    techLead: overrides.techLead ?? null,
    engineer: overrides.engineer ?? null,
    reviewer: overrides.reviewer ?? null,
    latestMessage: overrides.latestMessage ?? null,
    openReviewCycle: overrides.openReviewCycle ?? null,
    latestBriefs: overrides.latestBriefs ?? {},
  };
}

describe("dashboard helpers", () => {
  it("marks long-running active protocol states as stale", () => {
    expect(isProtocolDashboardStale({
      workflowState: "implementing",
      lastTransitionAt: new Date("2026-03-07T00:00:00.000Z"),
      now: new Date("2026-03-07T05:00:00.000Z"),
      staleAfterHours: 4,
    })).toBe(true);

    expect(isProtocolDashboardStale({
      workflowState: "blocked",
      lastTransitionAt: new Date("2026-03-07T00:00:00.000Z"),
      now: new Date("2026-03-07T05:00:00.000Z"),
      staleAfterHours: 4,
    })).toBe(false);
  });

  it("builds protocol queue buckets for operations views", () => {
    const buckets = buildProtocolDashboardBuckets({
      limit: 5,
      items: [
        queueItem({
          issueId: "issue-exec",
          title: "Execution issue",
          workflowState: "implementing",
        }),
        queueItem({
          issueId: "issue-review",
          title: "Review issue",
          workflowState: "submitted_for_review",
        }),
        queueItem({
          issueId: "issue-handoff",
          title: "Changes requested issue",
          workflowState: "changes_requested",
        }),
        queueItem({
          issueId: "issue-blocked",
          title: "Blocked issue",
          workflowState: "blocked",
          blockedCode: "dependency_wait",
        }),
        queueItem({
          issueId: "issue-human",
          title: "Human decision issue",
          workflowState: "awaiting_human_decision",
        }),
        queueItem({
          issueId: "issue-close",
          title: "Approved issue",
          workflowState: "approved",
        }),
        queueItem({
          issueId: "issue-stale",
          title: "Stale issue",
          workflowState: "implementing",
          stale: true,
        }),
        queueItem({
          issueId: "issue-violation",
          title: "Violation issue",
          workflowState: "implementing",
          openViolationCount: 2,
          highestViolationSeverity: "high",
        }),
      ],
    });

    expect(buckets.executionQueue.map((item) => item.issueId)).toContain("issue-exec");
    expect(buckets.reviewQueue.map((item) => item.issueId)).toContain("issue-review");
    expect(buckets.handoffBlockerQueue.map((item) => item.issueId)).toEqual(
      expect.arrayContaining(["issue-handoff", "issue-human", "issue-close"]),
    );
    expect(buckets.blockedQueue[0]?.issueId).toBe("issue-blocked");
    expect(buckets.humanDecisionQueue[0]?.issueId).toBe("issue-human");
    expect(buckets.readyToCloseQueue[0]?.issueId).toBe("issue-close");
    expect(buckets.staleQueue.map((item) => item.issueId)).toContain("issue-stale");
    expect(buckets.violationQueue[0]?.issueId).toBe("issue-violation");
  });

  it("builds execution reliability rollups for dashboard summaries", () => {
    expect(
      buildExecutionReliabilitySummary({
        runningRuns: 2,
        queuedRuns: 1,
        dispatchRedispatchesLast24h: 3,
        dispatchTimeoutsLast24h: 1,
        processLostLast24h: 0,
        workspaceBlockedLast24h: 2,
      }),
    ).toEqual({
      runningRuns: 2,
      queuedRuns: 1,
      dispatchRedispatchesLast24h: 3,
      dispatchTimeoutsLast24h: 1,
      processLostLast24h: 0,
      workspaceBlockedLast24h: 2,
    });
  });

  it("builds attention rollups for operator-first overview cards", () => {
    expect(
      buildDashboardAttentionSummary({
        blockedQueueCount: 2,
        awaitingHumanDecisionCount: 1,
        staleQueueCount: 3,
        staleTasks: 4,
        openViolationCount: 5,
        reviewQueueCount: 6,
        readyToCloseCount: 2,
        dispatchTimeoutsLast24h: 1,
        processLostLast24h: 2,
        workspaceBlockedLast24h: 3,
      }),
    ).toEqual({
      urgentIssueCount: 14,
      reviewPressureCount: 8,
      staleWorkCount: 7,
      runtimeRiskCount: 6,
    });
  });

  it("builds knowledge rollups for company-wide evidence coverage", () => {
    expect(
      buildDashboardKnowledgeSummary({
        totalDocuments: 24,
        connectedDocuments: 16,
        linkedChunks: 40,
        totalLinks: 72,
        activeProjects: 3,
        lowConfidenceRuns7d: 5,
      }),
    ).toEqual({
      totalDocuments: 24,
      connectedDocuments: 16,
      linkedChunks: 40,
      totalLinks: 72,
      activeProjects: 3,
      lowConfidenceRuns7d: 5,
    });
  });
});
