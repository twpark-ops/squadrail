import { activityLog } from "@squadrail/db";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPublishLiveEvent } = vi.hoisted(() => ({
  mockPublishLiveEvent: vi.fn(),
}));

vi.mock("../services/live-events.js", () => ({
  publishLiveEvent: mockPublishLiveEvent,
}));

import { logActivity } from "../services/activity-log.js";

describe("activity log service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sanitizes details before storing and publishing activity events", async () => {
    const insertValues: Array<{ table: unknown; value: unknown }> = [];
    const db = {
      insert: (table: unknown) => ({
        values: async (value: unknown) => {
          insertValues.push({ table, value });
          return [];
        },
      }),
    };

    await logActivity(db as never, {
      companyId: "company-1",
      actorType: "system",
      actorId: "system",
      action: "issue.protocol_message.created",
      entityType: "issue",
      entityId: "issue-1",
      details: {
        summary: "close ready",
        apiKey: "secret-token",
      },
    });

    expect(insertValues).toEqual([{
      table: activityLog,
      value: {
        companyId: "company-1",
        actorType: "system",
        actorId: "system",
        action: "issue.protocol_message.created",
        entityType: "issue",
        entityId: "issue-1",
        agentId: null,
        runId: null,
        details: {
          summary: "close ready",
          apiKey: "***REDACTED***",
        },
      },
    }]);
    expect(mockPublishLiveEvent).toHaveBeenCalledWith({
      companyId: "company-1",
      type: "activity.logged",
      payload: {
        actorType: "system",
        actorId: "system",
        action: "issue.protocol_message.created",
        entityType: "issue",
        entityId: "issue-1",
        agentId: null,
        runId: null,
        details: {
          summary: "close ready",
          apiKey: "***REDACTED***",
        },
      },
    });
  });
});
