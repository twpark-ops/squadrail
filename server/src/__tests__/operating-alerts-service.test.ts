import { activityLog, issues, setupProgress } from "@squadrail/db";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockSetupUpdate,
  mockLogActivity,
  mockLoggerError,
  mockLoggerWarn,
} = vi.hoisted(() => ({
  mockSetupUpdate: vi.fn(),
  mockLogActivity: vi.fn(),
  mockLoggerError: vi.fn(),
  mockLoggerWarn: vi.fn(),
}));

vi.mock("../services/setup-progress.js", () => ({
  setupProgressService: () => ({
    update: mockSetupUpdate,
  }),
}));

vi.mock("../services/activity-log.js", () => ({
  logActivity: mockLogActivity,
}));

vi.mock("../middleware/logger.js", () => ({
  logger: {
    warn: mockLoggerWarn,
    error: mockLoggerError,
  },
}));

import { operatingAlertService } from "../services/operating-alerts.js";

function shiftTableRows(queueMap: Map<unknown, unknown[][]>, table: unknown) {
  const queue = queueMap.get(table);
  return queue?.shift() ?? [];
}

function createResolvedChain(selectRows: Map<unknown, unknown[][]>) {
  let selectedTable: unknown = null;
  const chain = {
    from: (table: unknown) => {
      selectedTable = table;
      return chain;
    },
    where: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    then: <T>(resolve: (value: unknown[]) => T | PromiseLike<T>) =>
      Promise.resolve(shiftTableRows(selectRows, selectedTable)).then(resolve),
  };
  return chain;
}

function createOperatingAlertsDbMock(selectRows: Map<unknown, unknown[][]>) {
  return {
    select: () => createResolvedChain(selectRows),
  };
}

describe("operating alerts service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("reads config and recent delivery history into the company view", async () => {
    const db = createOperatingAlertsDbMock(new Map([
      [setupProgress, [[{
        metadata: {
          operatingAlerts: {
            enabled: true,
            minSeverity: "high",
            cooldownMinutes: 20,
            destinations: [{
              id: "dest-1",
              label: "Ops Slack",
              type: "slack_webhook",
              url: "https://hooks.slack.com/services/test",
              enabled: true,
            }],
          },
        },
      }]]],
      [activityLog, [[{
        id: "delivery-1",
        createdAt: new Date("2026-03-13T04:00:00.000Z"),
        action: "operating_alert.delivered",
        details: {
          severity: "high",
          reason: "dependency_blocked",
          intent: "operator_required",
          summary: "Dependency blocked",
          detail: "Waiting on CLO-9",
          dedupeKey: "dependency_blocked:issue-1",
          destinationLabel: "Ops Slack",
          destinationType: "slack_webhook",
          responseStatus: 200,
          issue: {
            id: "issue-1",
            identifier: "CLO-1",
            title: "Blocked issue",
          },
        },
      }]]],
    ]));
    const service = operatingAlertService(db as never);

    const view = await service.getView("company-1");

    expect(view.config).toEqual({
      enabled: true,
      minSeverity: "high",
      cooldownMinutes: 20,
      destinations: [{
        id: "dest-1",
        label: "Ops Slack",
        type: "slack_webhook",
        url: "https://hooks.slack.com/services/test",
        enabled: true,
        authHeaderName: null,
        authHeaderValue: null,
      }],
    });
    expect(view.recentDeliveries).toEqual([
      expect.objectContaining({
        id: "delivery-1",
        status: "delivered",
        dedupeKey: "dependency_blocked:issue-1",
        issue: {
          id: "issue-1",
          identifier: "CLO-1",
          title: "Blocked issue",
        },
      }),
    ]);
  });

  it("sends manual test alerts even when global alerts are disabled", async () => {
    const db = createOperatingAlertsDbMock(new Map([
      [setupProgress, [[{
        metadata: {
          operatingAlerts: {
            enabled: false,
            minSeverity: "critical",
            cooldownMinutes: 30,
            destinations: [{
              id: "dest-1",
              label: "Ops Slack",
              type: "slack_webhook",
              url: "https://hooks.slack.com/services/test",
              enabled: true,
            }],
          },
        },
      }]]],
    ]));
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const service = operatingAlertService(db as never);

    const result = await service.sendTestAlert("company-1", {
      severity: "critical",
      summary: "Manual alert check",
      detail: "Verify webhook transport",
    });

    expect(result).toMatchObject({
      companyId: "company-1",
      attemptedCount: 1,
      deliveredCount: 1,
      failedCount: 0,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mockLogActivity).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        action: "operating_alert.delivered",
        details: expect.objectContaining({
          reason: "test",
          summary: "Manual alert check",
          destinationLabel: "Ops Slack",
        }),
      }),
    );
  });

  it("dedupes live-event dispatch when the same alert was delivered recently", async () => {
    const db = createOperatingAlertsDbMock(new Map([
      [setupProgress, [[{
        metadata: {
          operatingAlerts: {
            enabled: true,
            minSeverity: "high",
            cooldownMinutes: 15,
            destinations: [{
              id: "dest-1",
              label: "Ops Webhook",
              type: "generic_webhook",
              url: "https://alerts.example.com/hooks",
              enabled: true,
            }],
          },
        },
      }]]],
      [issues, [[{
        id: "issue-1",
        identifier: "CLO-1",
        title: "Blocked issue",
      }]]],
      [activityLog, [[{
        count: 1,
      }]]],
    ]));
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const service = operatingAlertService(db as never);

    await service.dispatchLiveEvent({
      id: 1,
      companyId: "company-1",
      type: "activity.logged",
      createdAt: "2026-03-13T05:00:00.000Z",
      payload: {
        action: "issue.protocol_dispatch.blocked_by_dependency",
        entityType: "issue",
        entityId: "issue-1",
        details: {
          blockingIssueIds: ["issue-9"],
        },
      },
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockLogActivity).not.toHaveBeenCalled();
  });

  it("hydrates dependency-blocked issue refs and records successful deliveries", async () => {
    const db = createOperatingAlertsDbMock(new Map([
      [setupProgress, [[{
        metadata: {
          operatingAlerts: {
            enabled: true,
            minSeverity: "high",
            cooldownMinutes: 15,
            destinations: [{
              id: "dest-1",
              label: "Ops Webhook",
              type: "generic_webhook",
              url: "https://alerts.example.com/hooks",
              enabled: true,
            }],
          },
        },
      }]]],
      [issues, [[{
        id: "issue-1",
        identifier: "CLO-1",
        title: "Blocked issue",
      }]]],
      [activityLog, [[{
        count: 0,
      }]]],
    ]));
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok", { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    const service = operatingAlertService(db as never);

    await service.dispatchLiveEvent({
      id: 2,
      companyId: "company-1",
      type: "activity.logged",
      createdAt: "2026-03-13T05:10:00.000Z",
      payload: {
        action: "issue.protocol_dispatch.blocked_by_dependency",
        entityType: "issue",
        entityId: "issue-1",
        details: {
          blockingIssueIds: ["issue-9"],
          blockingSummary: "Waiting on CLO-9",
        },
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mockLogActivity).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        action: "operating_alert.delivered",
        details: expect.objectContaining({
          dedupeKey: "dependency_blocked:issue-1",
          responseStatus: 202,
          issue: {
            id: "issue-1",
            identifier: "CLO-1",
            title: "Blocked issue",
          },
        }),
      }),
    );
  });
});
