import { describe, expect, it } from "vitest";
import {
  buildGenericOperatingAlertPayload,
  buildOperatingAlertCandidate,
  buildSlackOperatingAlertPayload,
  normalizeOperatingAlertsConfig,
} from "../services/operating-alerts.js";

describe("operating alerts", () => {
  it("normalizes alert config and filters invalid destinations", () => {
    const config = normalizeOperatingAlertsConfig({
      enabled: true,
      minSeverity: "critical",
      cooldownMinutes: 45,
      destinations: [
        {
          id: "dest-1",
          label: "Ops Slack",
          type: "slack_webhook",
          url: "https://hooks.slack.com/services/test",
        },
        {
          id: "",
          label: "",
          type: "slack_webhook",
          url: "not-a-url",
        },
      ],
    });

    expect(config).toEqual({
      enabled: true,
      minSeverity: "critical",
      cooldownMinutes: 45,
      destinations: [
        {
          id: "dest-1",
          label: "Ops Slack",
          type: "slack_webhook",
          url: "https://hooks.slack.com/services/test",
          enabled: true,
          authHeaderName: null,
          authHeaderValue: null,
        },
      ],
    });
  });

  it("classifies repeated runtime failures from live events", () => {
    const candidate = buildOperatingAlertCandidate({
      id: 1,
      companyId: "company-1",
      type: "heartbeat.run.status",
      createdAt: "2026-03-13T00:00:00.000Z",
      payload: {
        runId: "run-1",
        agentId: "agent-1",
        status: "failed",
        errorCode: "process_lost",
      },
    });

    expect(candidate).toMatchObject({
      severity: "critical",
      reason: "runtime_failure",
      intent: "operator_required",
      runId: "run-1",
    });
  });

  it("classifies review change requests from activity events", () => {
    const candidate = buildOperatingAlertCandidate({
      id: 2,
      companyId: "company-1",
      type: "activity.logged",
      createdAt: "2026-03-13T00:00:00.000Z",
      payload: {
        action: "issue.protocol_message.created",
        entityType: "issue",
        entityId: "issue-1",
        details: {
          messageType: "REQUEST_CHANGES",
          workflowStateAfter: "changes_requested",
          summary: "Need stronger regression coverage",
        },
      },
    });

    expect(candidate).toMatchObject({
      severity: "high",
      reason: "review_changes_requested",
      issueId: "issue-1",
      summary: "Need stronger regression coverage",
    });
  });

  it("builds webhook payloads without dropping issue metadata", () => {
    const candidate = {
      companyId: "company-1",
      severity: "high" as const,
      intent: "operator_required" as const,
      reason: "dependency_blocked" as const,
      summary: "Dispatch is blocked by unresolved dependency work.",
      detail: "A dependency issue is still unresolved.",
      issueId: "issue-1",
      runId: null,
      dedupeKey: "dependency_blocked:issue-1",
      metadata: { blockingIssueIds: ["issue-2"] },
      issue: {
        id: "issue-1",
        identifier: "CLO-101",
        title: "Ship dependency graph gate",
      },
    };
    const destination = {
      id: "dest-1",
      label: "Ops Slack",
      type: "slack_webhook" as const,
      url: "https://hooks.slack.com/services/test",
      enabled: true,
      authHeaderName: null,
      authHeaderValue: null,
    };

    const slackPayload = buildSlackOperatingAlertPayload({
      candidate,
      destination,
    });
    const genericPayload = buildGenericOperatingAlertPayload({
      candidate,
      destination,
    });

    expect(slackPayload.text).toContain("Dispatch is blocked");
    expect(JSON.stringify(slackPayload)).toContain("CLO-101");
    expect(genericPayload.issue).toEqual({
      id: "issue-1",
      identifier: "CLO-101",
      title: "Ship dependency graph gate",
    });
    expect(genericPayload.metadata).toEqual({ blockingIssueIds: ["issue-2"] });
  });
});
