import { describe, expect, it } from "vitest";
import {
  computeLeaseExpiresAt,
  deriveCommentId,
  deriveTaskKey,
  normalizeAgentNameKey,
  normalizeIssuePriorityValue,
  normalizeMaxConcurrentRuns,
  normalizeSessionParams,
  parseHeartbeatPolicyConfig,
  parseIssueAssigneeAdapterOverrides,
  priorityClassFromRank,
  priorityRank,
  readNonEmptyString,
  toEpochMillis,
  truncateDisplayId,
} from "../services/heartbeat.js";

describe("heartbeat internal helpers", () => {
  it("normalizes heartbeat concurrency and runtime policy config", () => {
    expect(normalizeMaxConcurrentRuns(undefined)).toBe(1);
    expect(normalizeMaxConcurrentRuns(0)).toBe(1);
    expect(normalizeMaxConcurrentRuns(25)).toBe(10);
    expect(normalizeMaxConcurrentRuns(2.8)).toBe(2);

    expect(parseHeartbeatPolicyConfig({
      heartbeat: {
        enabled: false,
        intervalSec: -5,
        wakeOnAssignment: false,
        maxConcurrentRuns: 4.9,
      },
    })).toEqual({
      enabled: false,
      intervalSec: 0,
      wakeOnDemand: false,
      maxConcurrentRuns: 4,
    });
  });

  it("reads normalized strings and issue priorities", () => {
    expect(readNonEmptyString("  retry ")).toBe("  retry ");
    expect(readNonEmptyString("   ")).toBeNull();
    expect(readNonEmptyString(null)).toBeNull();

    expect(normalizeIssuePriorityValue("CRITICAL")).toBe("critical");
    expect(normalizeIssuePriorityValue("medium")).toBe("medium");
    expect(normalizeIssuePriorityValue("later")).toBeNull();
  });

  it("maps priority ranks to dispatch classes", () => {
    expect(priorityRank("critical")).toBe(3);
    expect(priorityRank("high")).toBe(2);
    expect(priorityRank("medium")).toBe(1);
    expect(priorityRank(null)).toBe(0);

    expect(priorityClassFromRank(4)).toBe("critical");
    expect(priorityClassFromRank(2)).toBe("high");
    expect(priorityClassFromRank(1)).toBe("normal");
    expect(priorityClassFromRank(0)).toBe("low");
  });

  it("parses assignee overrides and task/comment keys from wake context", () => {
    expect(parseIssueAssigneeAdapterOverrides(null)).toBeNull();
    expect(parseIssueAssigneeAdapterOverrides({
      adapterConfig: {
        sandboxMode: "workspace-write",
      },
      useProjectWorkspace: true,
    })).toEqual({
      adapterConfig: {
        sandboxMode: "workspace-write",
      },
      useProjectWorkspace: true,
    });
    expect(parseIssueAssigneeAdapterOverrides({
      adapterConfig: {},
      useProjectWorkspace: "bad",
    })).toBeNull();

    expect(deriveTaskKey(
      { taskKey: "task-1", taskId: "task-2", issueId: "issue-1" },
      { taskId: "task-3" },
    )).toBe("task-1");
    expect(deriveTaskKey(
      {},
      { taskId: "task-3", issueId: "issue-2" },
    )).toBe("task-3");
    expect(deriveCommentId(
      { wakeCommentId: "comment-1", commentId: "comment-2" },
      { commentId: "comment-3" },
    )).toBe("comment-1");
    expect(deriveCommentId(
      {},
      { commentId: "comment-3" },
    )).toBe("comment-3");
  });

  it("normalizes display/session ids and lease timestamps", () => {
    expect(truncateDisplayId("session-123", 20)).toBe("session-123");
    expect(truncateDisplayId("abcdefghijklmnopqrstuvwxyz", 10)).toBe("abcdefghij");
    expect(truncateDisplayId(null)).toBeNull();

    const now = new Date("2026-03-13T12:00:00.000Z");
    expect(toEpochMillis(now)).toBe(now.getTime());
    expect(toEpochMillis("2026-03-13T12:01:00.000Z")).toBe(new Date("2026-03-13T12:01:00.000Z").getTime());
    expect(toEpochMillis("not-a-date")).toBeNull();

    expect(computeLeaseExpiresAt(now).toISOString()).toBe("2026-03-13T12:00:45.000Z");
    expect(normalizeSessionParams({})).toBeNull();
    expect(normalizeSessionParams({ sessionId: "session-1" })).toEqual({ sessionId: "session-1" });
    expect(normalizeAgentNameKey("  QA Lead  ")).toBe("qa lead");
    expect(normalizeAgentNameKey("   ")).toBeNull();
  });
});
