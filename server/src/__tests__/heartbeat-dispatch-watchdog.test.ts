import { describe, expect, it } from "vitest";
import { decideDispatchWatchdogAction, scheduleDeferredRunDispatch } from "../services/heartbeat.js";

describe("decideDispatchWatchdogAction", () => {
  it("returns noop when the run is no longer running", () => {
    expect(
      decideDispatchWatchdogAction({
        runStatus: "failed",
        leaseStatus: "launching",
        checkpointPhase: "claim.queued",
        dispatchAttempts: 0,
        hasRunningProcess: false,
      }),
    ).toBe("noop");
  });

  it("returns noop when a child process is already running", () => {
    expect(
      decideDispatchWatchdogAction({
        runStatus: "running",
        leaseStatus: "launching",
        checkpointPhase: "claim.queued",
        dispatchAttempts: 0,
        hasRunningProcess: true,
      }),
    ).toBe("noop");
  });

  it("requests redispatch when a claimed run never entered execution", () => {
    expect(
      decideDispatchWatchdogAction({
        runStatus: "running",
        leaseStatus: "launching",
        checkpointPhase: "claim.queued",
        dispatchAttempts: 1,
        hasRunningProcess: false,
      }),
    ).toBe("redispatch");
  });

  it("fails when redispatch attempts are exhausted", () => {
    expect(
      decideDispatchWatchdogAction({
        runStatus: "running",
        leaseStatus: "launching",
        checkpointPhase: "dispatch.redispatch",
        dispatchAttempts: 2,
        hasRunningProcess: false,
      }),
    ).toBe("fail");
  });

  it("defers run dispatch until the next turn", async () => {
    const calls: string[] = [];

    scheduleDeferredRunDispatch(() => {
      calls.push("dispatched");
    });

    calls.push("scheduled");
    expect(calls).toEqual(["scheduled"]);

    await new Promise((resolve) => setImmediate(resolve));
    expect(calls).toEqual(["scheduled", "dispatched"]);
  });
});
