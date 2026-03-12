import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import type { Db } from "@squadrail/db";
import { activityLog, heartbeatRuns, issues, setupProgress } from "@squadrail/db";
import type {
  LiveEvent,
  OperatingAlertDeliveryRecord,
  OperatingAlertDestinationConfig,
  OperatingAlertIntent,
  OperatingAlertIssueRef,
  OperatingAlertReason,
  OperatingAlertSeverity,
  OperatingAlertsConfig,
  OperatingAlertsView,
  SendOperatingAlertTest,
  SendOperatingAlertTestResult,
  UpdateOperatingAlertsConfig,
} from "@squadrail/shared";
import { logActivity } from "./activity-log.js";
import { setupProgressService } from "./setup-progress.js";
import { logger } from "../middleware/logger.js";

const OPERATING_ALERTS_METADATA_KEY = "operatingAlerts";
const DELIVERY_ACTIONS = ["operating_alert.delivered", "operating_alert.failed"] as const;
const DEFAULT_CONFIG: OperatingAlertsConfig = {
  enabled: false,
  minSeverity: "high",
  cooldownMinutes: 15,
  destinations: [],
};

type OperatingAlertCandidateSeed = {
  companyId: string;
  severity: OperatingAlertSeverity;
  intent: OperatingAlertIntent;
  reason: OperatingAlertReason;
  summary: string;
  detail: string | null;
  issueId: string | null;
  runId: string | null;
  dedupeKey: string;
  metadata: Record<string, unknown>;
};

type OperatingAlertCandidate = OperatingAlertCandidateSeed & {
  issue: OperatingAlertIssueRef | null;
};

function severityRank(value: OperatingAlertSeverity) {
  switch (value) {
    case "critical":
      return 3;
    case "high":
      return 2;
    default:
      return 1;
  }
}

function nonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function asInteger(value: unknown, fallback: number, min: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function normalizeDestination(
  destination: Partial<OperatingAlertDestinationConfig>,
  index: number,
): OperatingAlertDestinationConfig | null {
  const url = nonEmptyString(destination.url);
  const label = nonEmptyString(destination.label);
  const id = nonEmptyString(destination.id) ?? `destination-${index + 1}`;
  const type = destination.type === "slack_webhook" ? "slack_webhook" : destination.type === "generic_webhook" ? "generic_webhook" : null;
  if (!url || !label || !type) return null;
  return {
    id,
    label,
    type,
    url,
    enabled: asBoolean(destination.enabled, true),
    authHeaderName: nonEmptyString(destination.authHeaderName),
    authHeaderValue: nonEmptyString(destination.authHeaderValue),
  };
}

export function normalizeOperatingAlertsConfig(raw: unknown): OperatingAlertsConfig {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const destinations = Array.isArray(source.destinations)
    ? source.destinations
        .map((entry, index) =>
          entry && typeof entry === "object"
            ? normalizeDestination(entry as Partial<OperatingAlertDestinationConfig>, index)
            : null)
        .filter((entry): entry is OperatingAlertDestinationConfig => entry !== null)
    : [];

  return {
    enabled: asBoolean(source.enabled, DEFAULT_CONFIG.enabled),
    minSeverity:
      source.minSeverity === "medium" || source.minSeverity === "high" || source.minSeverity === "critical"
        ? source.minSeverity
        : DEFAULT_CONFIG.minSeverity,
    cooldownMinutes: asInteger(source.cooldownMinutes, DEFAULT_CONFIG.cooldownMinutes, 1, 24 * 60),
    destinations,
  };
}

export function buildOperatingAlertCandidate(event: LiveEvent): OperatingAlertCandidateSeed | null {
  const payload = event.payload ?? {};
  if (event.type === "heartbeat.run.status") {
    const status = nonEmptyString(payload.status);
    const errorCode = nonEmptyString(payload.errorCode);
    if ((status !== "failed" && status !== "timed_out") || !errorCode) return null;
    if (errorCode === "dispatch_timeout") {
      return {
        companyId: event.companyId,
        severity: "high",
        intent: "operator_required",
        reason: "runtime_failure",
        summary: "Runtime dispatch timeout needs operator review.",
        detail: "A queued or running heartbeat run timed out during dispatch.",
        issueId: null,
        runId: nonEmptyString(payload.runId),
        dedupeKey: `runtime_failure:${errorCode}:${nonEmptyString(payload.runId) ?? "unknown"}`,
        metadata: {
          errorCode,
          status,
          agentId: nonEmptyString(payload.agentId),
        },
      };
    }
    if (errorCode === "process_lost") {
      return {
        companyId: event.companyId,
        severity: "critical",
        intent: "operator_required",
        reason: "runtime_failure",
        summary: "Heartbeat process was lost and needs manual recovery.",
        detail: "The active runtime process exited or disappeared before the run could finish cleanly.",
        issueId: null,
        runId: nonEmptyString(payload.runId),
        dedupeKey: `runtime_failure:${errorCode}:${nonEmptyString(payload.runId) ?? "unknown"}`,
        metadata: {
          errorCode,
          status,
          agentId: nonEmptyString(payload.agentId),
        },
      };
    }
    if (errorCode === "workspace_required") {
      return {
        companyId: event.companyId,
        severity: "high",
        intent: "operator_required",
        reason: "runtime_failure",
        summary: "Workspace repair is required before execution can continue.",
        detail: "The run could not proceed because a workspace was missing, blocked, or not bound for execution.",
        issueId: null,
        runId: nonEmptyString(payload.runId),
        dedupeKey: `runtime_failure:${errorCode}:${nonEmptyString(payload.runId) ?? "unknown"}`,
        metadata: {
          errorCode,
          status,
          agentId: nonEmptyString(payload.agentId),
        },
      };
    }
    return null;
  }

  if (event.type !== "activity.logged") return null;
  const action = nonEmptyString(payload.action);
  if (!action || action.startsWith("operating_alert.")) return null;
  const details =
    payload.details && typeof payload.details === "object"
      ? (payload.details as Record<string, unknown>)
      : {};
  const entityType = nonEmptyString(payload.entityType);
  const entityId = nonEmptyString(payload.entityId);
  const issueId = entityType === "issue" ? entityId : null;

  if (action === "issue.protocol_message.created") {
    const messageType = nonEmptyString(details.messageType);
    const workflowStateAfter = nonEmptyString(details.workflowStateAfter);
    const summary = nonEmptyString(details.summary);
    if (messageType === "REQUEST_CHANGES") {
      return {
        companyId: event.companyId,
        severity: "high",
        intent: "operator_required",
        reason: "review_changes_requested",
        summary: summary ?? "Review requested changes and needs follow-up.",
        detail: "A reviewer or QA returned implementation for another pass.",
        issueId,
        runId: null,
        dedupeKey: `review_changes_requested:${issueId ?? "unknown"}`,
        metadata: {
          messageType,
          workflowStateAfter,
        },
      };
    }
    if (messageType === "APPROVE_IMPLEMENTATION" && (workflowStateAfter === "approved" || workflowStateAfter === "done")) {
      return {
        companyId: event.companyId,
        severity: "medium",
        intent: "informative",
        reason: "ready_to_close",
        summary: summary ?? "Implementation is ready for final close review.",
        detail: "Approval completed and the issue is now ready for close or final board verification.",
        issueId,
        runId: null,
        dedupeKey: `ready_to_close:${issueId ?? "unknown"}:${workflowStateAfter}`,
        metadata: {
          messageType,
          workflowStateAfter,
        },
      };
    }
  }

  if (action === "issue.protocol_dispatch.blocked_by_dependency") {
    const blockingSummary = nonEmptyString(details.blockingSummary);
    return {
      companyId: event.companyId,
      severity: "high",
      intent: "operator_required",
      reason: "dependency_blocked",
      summary: "Dispatch is blocked by unresolved dependency work.",
      detail: blockingSummary ?? "A dependency issue is still unresolved, so this task cannot resume dispatch.",
      issueId,
      runId: null,
      dedupeKey: `dependency_blocked:${issueId ?? "unknown"}`,
      metadata: {
        blockingIssueIds: Array.isArray(details.blockingIssueIds) ? details.blockingIssueIds : [],
      },
    };
  }

  if (action === "issue.protocol_violation.recorded") {
    const violationCode = nonEmptyString(details.violationCode);
    if (violationCode !== "close_without_verification") return null;
    return {
      companyId: event.companyId,
      severity: "critical",
      intent: "operator_required",
      reason: "protocol_violation",
      summary: "Close was attempted without the required verification contract.",
      detail: "The protocol gate recorded a close-without-verification violation that should be resolved before delivery continues.",
      issueId,
      runId: null,
      dedupeKey: `protocol_violation:${issueId ?? "unknown"}:${violationCode}`,
      metadata: {
        violationCode,
        severity: nonEmptyString(details.severity),
      },
    };
  }

  return null;
}

export function buildSlackOperatingAlertPayload(input: {
  candidate: OperatingAlertCandidate;
  destination: OperatingAlertDestinationConfig;
}) {
  const issueLine = input.candidate.issue?.identifier
    ? `${input.candidate.issue.identifier}${input.candidate.issue.title ? ` · ${input.candidate.issue.title}` : ""}`
    : input.candidate.issue?.title ?? "No linked issue";
  const detailText = input.candidate.detail ? `\n${input.candidate.detail}` : "";
  return {
    text: `[${input.candidate.severity.toUpperCase()}] ${input.candidate.summary}`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${input.candidate.summary}*${detailText}`,
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `Severity: *${input.candidate.severity}* • Intent: *${input.candidate.intent}* • Reason: \`${input.candidate.reason}\``,
          },
          {
            type: "mrkdwn",
            text: `Issue: ${issueLine}`,
          },
          {
            type: "mrkdwn",
            text: `Destination: ${input.destination.label}`,
          },
        ],
      },
    ],
  };
}

export function buildGenericOperatingAlertPayload(input: {
  candidate: OperatingAlertCandidate;
  destination: OperatingAlertDestinationConfig;
}) {
  return {
    companyId: input.candidate.companyId,
    severity: input.candidate.severity,
    intent: input.candidate.intent,
    reason: input.candidate.reason,
    summary: input.candidate.summary,
    detail: input.candidate.detail,
    dedupeKey: input.candidate.dedupeKey,
    issue: input.candidate.issue,
    destination: {
      id: input.destination.id,
      label: input.destination.label,
      type: input.destination.type,
    },
    metadata: input.candidate.metadata,
  };
}

async function postOperatingAlert(
  destination: OperatingAlertDestinationConfig,
  candidate: OperatingAlertCandidate,
) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (destination.authHeaderName && destination.authHeaderValue) {
    headers[destination.authHeaderName] = destination.authHeaderValue;
  }
  const body =
    destination.type === "slack_webhook"
      ? buildSlackOperatingAlertPayload({ candidate, destination })
      : buildGenericOperatingAlertPayload({ candidate, destination });
  const response = await fetch(destination.url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Alert delivery failed with HTTP ${response.status}`);
  }
  return response.status;
}

function toDeliveryRecord(row: {
  id: string;
  createdAt: Date;
  details: Record<string, unknown> | null;
  action: string;
}): OperatingAlertDeliveryRecord {
  const details = row.details ?? {};
  const issueValue =
    details.issue && typeof details.issue === "object"
      ? (details.issue as Record<string, unknown>)
      : null;
  return {
    id: row.id,
    createdAt: row.createdAt,
    status: row.action === "operating_alert.delivered" ? "delivered" : "failed",
    severity:
      details.severity === "medium" || details.severity === "high" || details.severity === "critical"
        ? details.severity
        : "high",
    reason:
      details.reason === "runtime_failure"
      || details.reason === "review_changes_requested"
      || details.reason === "ready_to_close"
      || details.reason === "dependency_blocked"
      || details.reason === "protocol_violation"
      || details.reason === "test"
        ? details.reason
        : "test",
    intent: details.intent === "informative" ? "informative" : "operator_required",
    destinationLabel: nonEmptyString(details.destinationLabel) ?? "Unknown destination",
    destinationType: details.destinationType === "slack_webhook" ? "slack_webhook" : "generic_webhook",
    summary: nonEmptyString(details.summary) ?? "Operating alert delivery",
    detail: nonEmptyString(details.detail),
    dedupeKey: nonEmptyString(details.dedupeKey) ?? `${row.id}:unknown`,
    issue: issueValue
      ? {
          id: nonEmptyString(issueValue.id) ?? "",
          identifier: nonEmptyString(issueValue.identifier),
          title: nonEmptyString(issueValue.title),
        }
      : null,
    responseStatus: typeof details.responseStatus === "number" ? details.responseStatus : null,
    errorMessage: nonEmptyString(details.errorMessage),
  };
}

export function operatingAlertService(db: Db) {
  const setup = setupProgressService(db);

  async function readConfig(companyId: string) {
    const row = await db
      .select({ metadata: setupProgress.metadata })
      .from(setupProgress)
      .where(eq(setupProgress.companyId, companyId))
      .then((rows) => rows[0] ?? null);
    const metadata =
      row?.metadata && typeof row.metadata === "object"
        ? (row.metadata as Record<string, unknown>)
        : {};
    return normalizeOperatingAlertsConfig(metadata[OPERATING_ALERTS_METADATA_KEY]);
  }

  async function readIssueRef(companyId: string, issueId: string | null) {
    if (!issueId) return null;
    const row = await db
      .select({
        id: issues.id,
        identifier: issues.identifier,
        title: issues.title,
      })
      .from(issues)
      .where(and(eq(issues.companyId, companyId), eq(issues.id, issueId)))
      .then((rows) => rows[0] ?? null);
    if (!row) return null;
    return {
      id: row.id,
      identifier: row.identifier ?? null,
      title: row.title ?? null,
    } satisfies OperatingAlertIssueRef;
  }

  async function readIssueRefForRun(companyId: string, runId: string | null) {
    if (!runId) return null;
    const row = await db
      .select({
        contextSnapshot: heartbeatRuns.contextSnapshot,
      })
      .from(heartbeatRuns)
      .where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.id, runId)))
      .then((rows) => rows[0] ?? null);
    const context = row?.contextSnapshot;
    const issueId =
      context && typeof context === "object" && typeof (context as Record<string, unknown>).issueId === "string"
        ? ((context as Record<string, unknown>).issueId as string)
        : null;
    return readIssueRef(companyId, issueId);
  }

  async function hydrateCandidate(seed: OperatingAlertCandidateSeed): Promise<OperatingAlertCandidate> {
    const issue = seed.issueId
      ? await readIssueRef(seed.companyId, seed.issueId)
      : await readIssueRefForRun(seed.companyId, seed.runId);
    const runtimeErrorCode = nonEmptyString(seed.metadata.errorCode);
    const dedupeKeyBase = issue?.id ?? seed.issueId ?? seed.runId ?? "unknown";
    const dedupeKey =
      seed.reason === "runtime_failure" && runtimeErrorCode && issue?.id
        ? `runtime_failure:${runtimeErrorCode}:${issue.id}`
        : seed.dedupeKey.includes("unknown")
          ? `${seed.reason}:${dedupeKeyBase}`
          : seed.dedupeKey;
    return {
      ...seed,
      issue,
      dedupeKey,
    };
  }

  async function wasRecentlyDelivered(input: {
    companyId: string;
    dedupeKey: string;
    cooldownMinutes: number;
  }) {
    const since = new Date(Date.now() - input.cooldownMinutes * 60 * 1000);
    const rows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(activityLog)
      .where(
        and(
          eq(activityLog.companyId, input.companyId),
          inArray(activityLog.action, [...DELIVERY_ACTIONS]),
          gte(activityLog.createdAt, since),
          sql`coalesce(${activityLog.details} ->> 'dedupeKey', '') = ${input.dedupeKey}`,
        ),
      );
    return Number(rows[0]?.count ?? 0) > 0;
  }

  async function recordDelivery(input: {
    companyId: string;
    candidate: OperatingAlertCandidate;
    destination: OperatingAlertDestinationConfig;
    status: "delivered" | "failed";
    responseStatus: number | null;
    errorMessage: string | null;
  }) {
    await logActivity(db, {
      companyId: input.companyId,
      actorType: "system",
      actorId: "operating_alerts",
      action: input.status === "delivered" ? "operating_alert.delivered" : "operating_alert.failed",
      entityType: "company",
      entityId: input.companyId,
      details: {
        severity: input.candidate.severity,
        reason: input.candidate.reason,
        intent: input.candidate.intent,
        summary: input.candidate.summary,
        detail: input.candidate.detail,
        dedupeKey: input.candidate.dedupeKey,
        destinationLabel: input.destination.label,
        destinationType: input.destination.type,
        responseStatus: input.responseStatus,
        errorMessage: input.errorMessage,
        issue: input.candidate.issue,
      },
    });
  }

  async function deliverCandidate(
    config: OperatingAlertsConfig,
    candidate: OperatingAlertCandidate,
    opts?: { bypassCooldown?: boolean; ignoreGlobalEnabled?: boolean },
  ) {
    if (!opts?.ignoreGlobalEnabled && !config.enabled) return [] as OperatingAlertDeliveryRecord[];
    if (severityRank(candidate.severity) < severityRank(config.minSeverity)) return [] as OperatingAlertDeliveryRecord[];
    if (!opts?.bypassCooldown) {
      const deduped = await wasRecentlyDelivered({
        companyId: candidate.companyId,
        dedupeKey: candidate.dedupeKey,
        cooldownMinutes: config.cooldownMinutes,
      });
      if (deduped) return [] as OperatingAlertDeliveryRecord[];
    }

    const records: OperatingAlertDeliveryRecord[] = [];
    for (const destination of config.destinations.filter((entry) => entry.enabled)) {
      try {
        const responseStatus = await postOperatingAlert(destination, candidate);
        await recordDelivery({
          companyId: candidate.companyId,
          candidate,
          destination,
          status: "delivered",
          responseStatus,
          errorMessage: null,
        });
        records.push({
          id: `${destination.id}:${candidate.dedupeKey}:delivered`,
          createdAt: new Date(),
          status: "delivered",
          severity: candidate.severity,
          reason: candidate.reason,
          intent: candidate.intent,
          destinationLabel: destination.label,
          destinationType: destination.type,
          summary: candidate.summary,
          detail: candidate.detail,
          dedupeKey: candidate.dedupeKey,
          issue: candidate.issue,
          responseStatus,
          errorMessage: null,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown alert delivery failure";
        logger.warn(
          {
            errorMessage,
            companyId: candidate.companyId,
            reason: candidate.reason,
            destinationId: destination.id,
          },
          "operating alert delivery failed",
        );
        await recordDelivery({
          companyId: candidate.companyId,
          candidate,
          destination,
          status: "failed",
          responseStatus: null,
          errorMessage,
        });
        records.push({
          id: `${destination.id}:${candidate.dedupeKey}:failed`,
          createdAt: new Date(),
          status: "failed",
          severity: candidate.severity,
          reason: candidate.reason,
          intent: candidate.intent,
          destinationLabel: destination.label,
          destinationType: destination.type,
          summary: candidate.summary,
          detail: candidate.detail,
          dedupeKey: candidate.dedupeKey,
          issue: candidate.issue,
          responseStatus: null,
          errorMessage,
        });
      }
    }
    return records;
  }

  async function getRecentDeliveries(companyId: string) {
    const rows = await db
      .select({
        id: activityLog.id,
        createdAt: activityLog.createdAt,
        details: activityLog.details,
        action: activityLog.action,
      })
      .from(activityLog)
      .where(and(eq(activityLog.companyId, companyId), inArray(activityLog.action, [...DELIVERY_ACTIONS])))
      .orderBy(desc(activityLog.createdAt))
      .limit(20);
    return rows.map(toDeliveryRecord);
  }

  async function getView(companyId: string): Promise<OperatingAlertsView> {
    const [config, recentDeliveries] = await Promise.all([
      readConfig(companyId),
      getRecentDeliveries(companyId),
    ]);
    return {
      companyId,
      config,
      recentDeliveries,
    };
  }

  async function updateConfig(companyId: string, patch: UpdateOperatingAlertsConfig): Promise<OperatingAlertsView> {
    const current = await readConfig(companyId);
    const next = normalizeOperatingAlertsConfig({
      ...current,
      ...patch,
      destinations: patch.destinations ?? current.destinations,
    });
    await setup.update(companyId, {
      metadata: {
        [OPERATING_ALERTS_METADATA_KEY]: next,
      },
    });
    return getView(companyId);
  }

  async function sendTestAlert(
    companyId: string,
    input: SendOperatingAlertTest,
  ): Promise<SendOperatingAlertTestResult> {
    const config = await readConfig(companyId);
    const candidate = await hydrateCandidate({
      companyId,
      severity: input.severity ?? "high",
      intent: "operator_required",
      reason: "test",
      summary: input.summary?.trim() || "Squadrail operating alert test",
      detail: input.detail?.trim() || "This is a manually triggered test alert from Company Settings.",
      issueId: null,
      runId: null,
      dedupeKey: `test:${Date.now()}`,
      metadata: {
        manual: true,
      },
    });
    const records = await deliverCandidate(config, candidate, {
      bypassCooldown: true,
      ignoreGlobalEnabled: true,
    });
    return {
      companyId,
      attemptedCount: config.destinations.filter((entry) => entry.enabled).length,
      deliveredCount: records.filter((entry) => entry.status === "delivered").length,
      failedCount: records.filter((entry) => entry.status === "failed").length,
      records,
    };
  }

  async function dispatchLiveEvent(event: LiveEvent) {
    try {
      const config = await readConfig(event.companyId);
      if (!config.enabled || config.destinations.every((entry) => !entry.enabled)) return;
      const seed = buildOperatingAlertCandidate(event);
      if (!seed) return;
      const candidate = await hydrateCandidate(seed);
      await deliverCandidate(config, candidate);
    } catch (error) {
      logger.error(
        {
          err: error,
          companyId: event.companyId,
          eventType: event.type,
        },
        "operating alert dispatcher failed",
      );
    }
  }

  return {
    getView,
    updateConfig,
    sendTestAlert,
    dispatchLiveEvent,
  };
}
