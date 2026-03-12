import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockLoggerWarn } = vi.hoisted(() => ({
  mockLoggerWarn: vi.fn(),
}));

vi.mock("../middleware/logger.js", () => ({
  logger: {
    warn: mockLoggerWarn,
  },
}));

import {
  publishLiveEvent,
  registerLiveEventSink,
  subscribeCompanyLiveEvents,
} from "../services/live-events.js";

describe("live events service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("publishes to company listeners and registered sinks", () => {
    const listener = vi.fn();
    const sink = vi.fn();
    const unsubscribe = subscribeCompanyLiveEvents("company-1", listener);
    const unregisterSink = registerLiveEventSink(sink);

    const event = publishLiveEvent({
      companyId: "company-1",
      type: "heartbeat.run.queued",
      payload: {
        runId: "run-1",
      },
    });

    expect(event).toMatchObject({
      companyId: "company-1",
      type: "heartbeat.run.queued",
      payload: {
        runId: "run-1",
      },
    });
    expect(listener).toHaveBeenCalledWith(event);
    expect(sink).toHaveBeenCalledWith(event);

    unsubscribe();
    unregisterSink();
  });

  it("logs sink failures without interrupting publish", async () => {
    const unregisterSink = registerLiveEventSink(async () => {
      throw new Error("sink down");
    });

    publishLiveEvent({
      companyId: "company-2",
      type: "activity.logged",
      payload: {
        action: "issue.protocol_violation.recorded",
      },
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: "company-2",
        type: "activity.logged",
      }),
      "live event sink failed",
    );

    unregisterSink();
  });
});
