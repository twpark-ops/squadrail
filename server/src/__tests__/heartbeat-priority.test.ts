import { describe, expect, it } from "vitest";
import {
  buildDispatchPriorityContextSnapshot,
  buildDispatchPrioritySelectionDetails,
  enrichWakeContextSnapshot,
  prioritizeQueuedRunsForDispatch,
} from "../services/heartbeat.js";

describe("heartbeat priority dispatch", () => {
  it("prioritizes critical queued work ahead of older medium work", () => {
    const ordered = prioritizeQueuedRunsForDispatch({
      now: new Date("2026-03-12T02:00:00.000Z"),
      runs: [
        {
          id: "run-medium",
          createdAt: new Date("2026-03-12T01:40:00.000Z"),
          contextSnapshot: {
            issueId: "issue-medium",
            issuePriority: "medium",
          },
        },
        {
          id: "run-critical",
          createdAt: new Date("2026-03-12T01:55:00.000Z"),
          contextSnapshot: {
            issueId: "issue-critical",
            issuePriority: "critical",
          },
        },
      ],
    });

    expect(ordered[0]).toMatchObject({
      run: { id: "run-critical" },
      priorityClass: "critical",
      preemptedRunIds: ["run-medium"],
    });
  });

  it("uses age boost to keep older low-priority work from starving forever", () => {
    const ordered = prioritizeQueuedRunsForDispatch({
      now: new Date("2026-03-12T03:00:00.000Z"),
      runs: [
        {
          id: "run-low-aged",
          createdAt: new Date("2026-03-12T02:00:00.000Z"),
          contextSnapshot: {
            issueId: "issue-low",
            issuePriority: "low",
          },
        },
        {
          id: "run-medium-fresh",
          createdAt: new Date("2026-03-12T02:55:00.000Z"),
          contextSnapshot: {
            issueId: "issue-medium",
            issuePriority: "medium",
          },
        },
      ],
    });

    expect(ordered[0]).toMatchObject({
      run: { id: "run-low-aged" },
      priorityClass: "high",
      ageBoost: 2,
    });
  });

  it("copies payload priority into wake context snapshots", () => {
    const result = enrichWakeContextSnapshot({
      contextSnapshot: {},
      reason: "issue_assigned",
      source: "automation",
      triggerDetail: "system",
      payload: {
        issueId: "issue-1",
        priority: "high",
      },
    });

    expect(result.contextSnapshot).toMatchObject({
      issueId: "issue-1",
      issuePriority: "high",
      wakeReason: "issue_assigned",
    });
  });

  it("builds stable dispatch priority details for event and activity traces", () => {
    expect(buildDispatchPrioritySelectionDetails({
      priorityClass: "critical",
      issuePriority: "critical",
      ageBoost: 2,
      preemptedRunIds: ["run-medium", "run-low"],
    })).toEqual({
      priorityClass: "critical",
      issuePriority: "critical",
      ageBoost: 2,
      preemptedRunIds: ["run-medium", "run-low"],
    });
  });

  it("adds preemption metadata to the run context only when preemption occurred", () => {
    expect(buildDispatchPriorityContextSnapshot({
      existingContext: {
        issueId: "issue-1",
      },
      selection: {
        issuePriority: "critical",
        priorityClass: "critical",
        ageBoost: 0,
        queuedForMs: 60_000,
        preemptedRunIds: ["run-medium"],
      },
      selectedAt: new Date("2026-03-12T02:00:00.000Z"),
    })).toMatchObject({
      issueId: "issue-1",
      issuePriority: "critical",
      dispatchPriorityClass: "critical",
      dispatchPriorityQueuedForMs: 60_000,
      dispatchPreemption: {
        preempted: true,
        priorityClass: "critical",
        preemptedRunIds: ["run-medium"],
      },
    });

    expect(buildDispatchPriorityContextSnapshot({
      existingContext: {
        issueId: "issue-2",
      },
      selection: {
        issuePriority: "medium",
        priorityClass: "normal",
        ageBoost: 0,
        queuedForMs: 30_000,
        preemptedRunIds: [],
      },
      selectedAt: new Date("2026-03-12T02:00:00.000Z"),
    })).not.toHaveProperty("dispatchPreemption");
  });
});
