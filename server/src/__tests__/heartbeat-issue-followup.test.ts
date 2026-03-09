import { describe, expect, it } from "vitest";
import { shouldQueueFollowupIssueExecution } from "../services/heartbeat.js";

describe("shouldQueueFollowupIssueExecution", () => {
  it("forces a follow-up run when the wake context requests implementation follow-up", () => {
    expect(
      shouldQueueFollowupIssueExecution({
        sameExecutionAgent: true,
        activeExecutionRunStatus: "running",
        wakeCommentId: null,
        contextSnapshot: {
          forceFollowupRun: true,
        },
      }),
    ).toBe(true);
  });

  it("preserves comment wake follow-up behavior", () => {
    expect(
      shouldQueueFollowupIssueExecution({
        sameExecutionAgent: true,
        activeExecutionRunStatus: "running",
        wakeCommentId: "comment-1",
        contextSnapshot: {},
      }),
    ).toBe(true);
  });

  it("coalesces same-agent wakes when no follow-up signal is present", () => {
    expect(
      shouldQueueFollowupIssueExecution({
        sameExecutionAgent: true,
        activeExecutionRunStatus: "running",
        wakeCommentId: null,
        contextSnapshot: {},
      }),
    ).toBe(false);
  });
});
