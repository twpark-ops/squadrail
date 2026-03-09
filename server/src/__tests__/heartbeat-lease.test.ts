import { describe, expect, it } from "vitest";
import { buildProcessLostError, shouldReapHeartbeatRun } from "../services/heartbeat.js";

describe("heartbeat lease helpers", () => {
  it("keeps an active run when the lease has not expired", () => {
    const now = new Date("2026-03-09T12:00:00.000Z");

    expect(
      shouldReapHeartbeatRun({
        runStatus: "running",
        runUpdatedAt: new Date("2026-03-09T11:59:30.000Z"),
        lease: {
          status: "executing",
          leaseExpiresAt: new Date("2026-03-09T12:00:30.000Z"),
          releasedAt: null,
        },
        now,
        staleThresholdMs: 30_000,
      }),
    ).toBe(false);
  });

  it("reaps a run when the lease is expired beyond the stale threshold", () => {
    const now = new Date("2026-03-09T12:00:00.000Z");

    expect(
      shouldReapHeartbeatRun({
        runStatus: "running",
        runUpdatedAt: new Date("2026-03-09T11:58:00.000Z"),
        lease: {
          status: "executing",
          checkpointJson: { phase: "adapter.execute_start" },
          leaseExpiresAt: new Date("2026-03-09T11:59:00.000Z"),
          releasedAt: null,
        },
        now,
        staleThresholdMs: 30_000,
      }),
    ).toBe(true);
  });

  it("falls back to run.updatedAt when no lease exists", () => {
    const now = new Date("2026-03-09T12:00:00.000Z");

    expect(
      shouldReapHeartbeatRun({
        runStatus: "queued",
        runUpdatedAt: new Date("2026-03-09T11:59:50.000Z"),
        lease: null,
        now,
        staleThresholdMs: 30_000,
      }),
    ).toBe(false);
  });

  it("includes the last checkpoint phase in process_lost errors", () => {
    expect(
      buildProcessLostError({
        status: "executing",
        checkpointJson: {
          phase: "adapter.invoke",
          message: "adapter invocation",
        },
      }),
    ).toBe("Process lost during adapter.invoke -- server may have restarted");
  });

  it("uses a generic process_lost message without checkpoint data", () => {
    expect(buildProcessLostError(null)).toBe("Process lost -- server may have restarted");
  });
});
