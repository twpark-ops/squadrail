import { useEffect, useRef, type ReactNode } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { Agent, Issue, LiveEvent } from "@squadrail/shared";
import { useCompany } from "./CompanyContext";
import type { ToastInput } from "./ToastContext";
import { useToast } from "./ToastContext";
import { queryKeys } from "../lib/queryKeys";
import { issueUrl } from "../lib/utils";

const TOAST_COOLDOWN_WINDOW_MS = 10_000;
const TOAST_COOLDOWN_MAX = 3;
const RECONNECT_SUPPRESS_MS = 2000;

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function shortId(value: string) {
  return value.slice(0, 8);
}

function resolveAgentName(
  queryClient: QueryClient,
  companyId: string,
  agentId: string,
): string | null {
  const agents = queryClient.getQueryData<Agent[]>(queryKeys.agents.list(companyId));
  if (!agents) return null;
  const agent = agents.find((a) => a.id === agentId);
  return agent?.name ?? null;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "\u2026";
}

function resolveActorLabel(
  queryClient: QueryClient,
  companyId: string,
  actorType: string | null,
  actorId: string | null,
): string {
  if (actorType === "agent" && actorId) {
    return resolveAgentName(queryClient, companyId, actorId) ?? `Agent ${shortId(actorId)}`;
  }
  if (actorType === "system") return "System";
  if (actorType === "user" && actorId) {
    return "Board";
  }
  return "Someone";
}

interface IssueToastContext {
  ref: string;
  title: string | null;
  label: string;
  href: string;
  changesHref: string;
}

function resolveIssueQueryRefs(
  queryClient: QueryClient,
  companyId: string,
  issueId: string,
  details: Record<string, unknown> | null,
): string[] {
  const refs = new Set<string>([issueId]);
  const detailIssue = queryClient.getQueryData<Issue>(queryKeys.issues.detail(issueId));
  const listIssues = queryClient.getQueryData<Issue[]>(queryKeys.issues.list(companyId));
  const detailsIdentifier =
    readString(details?.identifier) ??
    readString(details?.issueIdentifier);

  if (detailsIdentifier) refs.add(detailsIdentifier);

  if (detailIssue?.id) refs.add(detailIssue.id);
  if (detailIssue?.identifier) refs.add(detailIssue.identifier);

  const listIssue = listIssues?.find((issue) => {
    if (issue.id === issueId) return true;
    if (issue.identifier && issue.identifier === issueId) return true;
    if (detailsIdentifier && issue.identifier === detailsIdentifier) return true;
    return false;
  });
  if (listIssue?.id) refs.add(listIssue.id);
  if (listIssue?.identifier) refs.add(listIssue.identifier);

  return Array.from(refs);
}

function resolveIssueToastContext(
  queryClient: QueryClient,
  companyId: string,
  issueId: string,
  details: Record<string, unknown> | null,
): IssueToastContext {
  const issueRefs = resolveIssueQueryRefs(queryClient, companyId, issueId, details);
  const detailIssue = issueRefs
    .map((ref) => queryClient.getQueryData<Issue>(queryKeys.issues.detail(ref)))
    .find((issue): issue is Issue => !!issue);
  const listIssue = queryClient
    .getQueryData<Issue[]>(queryKeys.issues.list(companyId))
    ?.find((issue) => issueRefs.some((ref) => issue.id === ref || issue.identifier === ref));
  const cachedIssue = detailIssue ?? listIssue ?? null;
  const ref =
    readString(details?.identifier) ??
    readString(details?.issueIdentifier) ??
    cachedIssue?.identifier ??
    `Issue ${shortId(issueId)}`;
  const title =
    readString(details?.title) ??
    readString(details?.issueTitle) ??
    cachedIssue?.title ??
    null;
  return {
    ref,
    title,
    label: title ? `${ref} - ${truncate(title, 72)}` : ref,
    href: issueUrl({ id: issueId, identifier: cachedIssue?.identifier ?? null }),
    changesHref: `/changes/${cachedIssue?.identifier ?? issueId}`,
  };
}

const ISSUE_TOAST_ACTIONS = new Set([
  "issue.created",
  "issue.updated",
  "issue.comment_added",
  "issue.protocol_message.created",
  "issue.merge_candidate.resolved",
  "issue.merge_candidate.automation",
  "issue.protocol_timeout.reminder",
  "issue.protocol_timeout.escalated",
]);
const AGENT_TOAST_STATUSES = new Set(["running", "error"]);
const TERMINAL_RUN_STATUSES = new Set(["succeeded", "failed", "timed_out", "cancelled"]);

function formatProtocolMessageType(messageType: string): string {
  return messageType.replace(/_/g, " ").toLowerCase();
}

function buildProtocolMessageToast(
  actor: string,
  issue: IssueToastContext,
  details: Record<string, unknown> | null,
): ToastInput | null {
  const messageType = readString(details?.messageType);
  const summary = readString(details?.summary);
  const workflowStateAfter = readString(details?.workflowStateAfter);
  if (!messageType) return null;

  const toneByMessageType: Record<string, ToastInput["tone"]> = {
    ASK_CLARIFICATION: "warn",
    ANSWER_CLARIFICATION: "success",
    REQUEST_CHANGES: "warn",
    SUBMIT_FOR_REVIEW: "info",
    APPROVE_IMPLEMENTATION: "success",
    REQUEST_MERGE: "info",
    APPROVE_MERGE: "success",
    REJECT_MERGE: "warn",
    CONFIRM_DEPLOY: "success",
    ROLLBACK_DEPLOY: "warn",
    TIMEOUT_ESCALATION: "warn",
  };

  const titleByMessageType: Record<string, string> = {
    ASK_CLARIFICATION: `${issue.ref} needs clarification`,
    ANSWER_CLARIFICATION: `${issue.ref} clarification answered`,
    REQUEST_CHANGES: `${issue.ref} needs implementation changes`,
    SUBMIT_FOR_REVIEW: `${issue.ref} is ready for review`,
    APPROVE_IMPLEMENTATION: `${issue.ref} was approved`,
    REQUEST_MERGE: `${issue.ref} is ready for merge review`,
    APPROVE_MERGE: `${issue.ref} merge approved`,
    REJECT_MERGE: `${issue.ref} merge request rejected`,
    CONFIRM_DEPLOY: `${issue.ref} deploy confirmed`,
    ROLLBACK_DEPLOY: `${issue.ref} rollback recorded`,
    TIMEOUT_ESCALATION: `${issue.ref} timeout escalated`,
  };

  const title =
    titleByMessageType[messageType]
    ?? `${actor} recorded ${formatProtocolMessageType(messageType)} on ${issue.ref}`;
  const body = summary
    ?? (workflowStateAfter
      ? `Workflow -> ${workflowStateAfter.replace(/_/g, " ")}`
      : issue.title ?? undefined);
  const href =
    messageType.includes("MERGE") || messageType.includes("DEPLOY") || messageType === "ROLLBACK_DEPLOY"
      ? issue.changesHref
      : issue.href;

  return {
    title,
    body: body ? truncate(body, 100) : undefined,
    tone: toneByMessageType[messageType] ?? "info",
    action: {
      label:
        href === issue.changesHref
          ? `Open ${issue.ref} changes`
          : `View ${issue.ref}`,
      href,
    },
    dedupeKey: `activity:issue.protocol_message.created:${issue.ref}:${messageType}:${workflowStateAfter ?? "na"}`,
  };
}

function buildMergeCandidateToast(
  issue: IssueToastContext,
  details: Record<string, unknown> | null,
): ToastInput {
  const actionType = readString(details?.actionType) ?? "updated";
  const mergeCommitSha = readString(details?.mergeCommitSha);
  const targetBaseBranch = readString(details?.targetBaseBranch);
  const shaSuffix = mergeCommitSha ? ` (${mergeCommitSha.slice(0, 7)})` : "";
  return {
    title: `${issue.ref} merge candidate ${actionType.replace(/_/g, " ")}`,
    body: targetBaseBranch
      ? `Base branch: ${targetBaseBranch}${shaSuffix}`
      : issue.title ?? undefined,
    tone: actionType.includes("reject") ? "warn" : "info",
    action: { label: `Open ${issue.ref} changes`, href: issue.changesHref },
    dedupeKey: `activity:issue.merge_candidate.resolved:${issue.ref}:${actionType}:${mergeCommitSha ?? "na"}`,
  };
}

function buildMergeAutomationToast(
  issue: IssueToastContext,
  details: Record<string, unknown> | null,
): ToastInput {
  const actionType = readString(details?.actionType) ?? "automation";
  const externalProvider = readString(details?.externalProvider);
  const targetBranch = readString(details?.targetBranch);
  const externalUrl = readString(details?.externalUrl);
  return {
    title: `${issue.ref} ${actionType.replace(/_/g, " ")}`,
    body: externalProvider
      ? `Provider: ${externalProvider}${targetBranch ? ` -> ${targetBranch}` : ""}`
      : targetBranch
        ? `Target branch: ${targetBranch}`
        : issue.title ?? undefined,
    tone: "info",
    action: {
      label: externalUrl ? "Open external change" : `Open ${issue.ref} changes`,
      href: externalUrl ?? issue.changesHref,
    },
    dedupeKey: `activity:issue.merge_candidate.automation:${issue.ref}:${actionType}:${targetBranch ?? "na"}`,
  };
}

function buildProtocolTimeoutToast(
  issue: IssueToastContext,
  details: Record<string, unknown> | null,
  escalated: boolean,
): ToastInput {
  const timeoutCode = readString(details?.timeoutCode) ?? "timeout";
  const recipientRole = readString(details?.recipientRole);
  return {
    title: escalated ? `${issue.ref} needs recovery` : `${issue.ref} is waiting on action`,
    body: [
      timeoutCode.replace(/_/g, " "),
      recipientRole ? `target: ${recipientRole.replace(/_/g, " ")}` : null,
    ]
      .filter(Boolean)
      .join(" · "),
    tone: escalated ? "warn" : "info",
    action: { label: `View ${issue.ref}`, href: issue.href },
    dedupeKey: `activity:timeout:${issue.ref}:${timeoutCode}:${recipientRole ?? "na"}:${escalated ? "escalated" : "reminder"}`,
  };
}

function describeIssueUpdate(details: Record<string, unknown> | null): string | null {
  if (!details) return null;
  const changes: string[] = [];
  if (typeof details.status === "string") changes.push(`status -> ${details.status.replace(/_/g, " ")}`);
  if (typeof details.priority === "string") changes.push(`priority -> ${details.priority}`);
  if (typeof details.assigneeAgentId === "string" || typeof details.assigneeUserId === "string") {
    changes.push("reassigned");
  } else if (details.assigneeAgentId === null || details.assigneeUserId === null) {
    changes.push("unassigned");
  }
  if (details.reopened === true) {
    const from = readString(details.reopenedFrom);
    changes.push(from ? `reopened from ${from.replace(/_/g, " ")}` : "reopened");
  }
  if (typeof details.title === "string") changes.push("title changed");
  if (typeof details.description === "string") changes.push("description changed");
  if (changes.length > 0) return changes.join(", ");
  return null;
}

function buildActivityToast(
  queryClient: QueryClient,
  companyId: string,
  payload: Record<string, unknown>,
): ToastInput | null {
  const entityType = readString(payload.entityType);
  const entityId = readString(payload.entityId);
  const action = readString(payload.action);
  const details = readRecord(payload.details);
  const actorId = readString(payload.actorId);
  const actorType = readString(payload.actorType);

  if (entityType !== "issue" || !entityId || !action || !ISSUE_TOAST_ACTIONS.has(action)) {
    return null;
  }

  const issue = resolveIssueToastContext(queryClient, companyId, entityId, details);
  const actor = resolveActorLabel(queryClient, companyId, actorType, actorId);

  if (action === "issue.created") {
    return {
      title: `${actor} created ${issue.ref}`,
      body: issue.title ? truncate(issue.title, 96) : undefined,
      tone: "success",
      action: { label: `View ${issue.ref}`, href: issue.href },
      dedupeKey: `activity:${action}:${entityId}`,
    };
  }

  if (action === "issue.updated") {
    if (details?.reopened === true && readString(details.source) === "comment") {
      // Reopen-via-comment emits a paired comment event; show one combined toast on the comment event.
      return null;
    }
    const changeDesc = describeIssueUpdate(details);
    const body = changeDesc
      ? issue.title
        ? `${truncate(issue.title, 64)} - ${changeDesc}`
        : changeDesc
      : issue.title
        ? truncate(issue.title, 96)
        : issue.label;
    return {
      title: `${actor} updated ${issue.ref}`,
      body: truncate(body, 100),
      tone: "info",
      action: { label: `View ${issue.ref}`, href: issue.href },
      dedupeKey: `activity:${action}:${entityId}`,
    };
  }

  if (action === "issue.protocol_message.created") {
    return buildProtocolMessageToast(actor, issue, details);
  }

  if (action === "issue.merge_candidate.resolved") {
    return buildMergeCandidateToast(issue, details);
  }

  if (action === "issue.merge_candidate.automation") {
    return buildMergeAutomationToast(issue, details);
  }

  if (action === "issue.protocol_timeout.reminder") {
    return buildProtocolTimeoutToast(issue, details, false);
  }

  if (action === "issue.protocol_timeout.escalated") {
    return buildProtocolTimeoutToast(issue, details, true);
  }

  const commentId = readString(details?.commentId);
  const bodySnippet = readString(details?.bodySnippet);
  const reopened = details?.reopened === true;
  const reopenedFrom = readString(details?.reopenedFrom);
  const reopenedLabel = reopened
    ? reopenedFrom
      ? `reopened from ${reopenedFrom.replace(/_/g, " ")}`
      : "reopened"
    : null;
  const title = reopened ? `${actor} reopened and commented on ${issue.ref}` : `${actor} commented on ${issue.ref}`;
  const body = bodySnippet
    ? reopenedLabel
      ? `${reopenedLabel} - ${bodySnippet.replace(/^#+\s*/m, "").replace(/\n/g, " ")}`
      : bodySnippet.replace(/^#+\s*/m, "").replace(/\n/g, " ")
    : reopenedLabel
      ? issue.title
        ? `${reopenedLabel} - ${issue.title}`
        : reopenedLabel
      : issue.title ?? undefined;
  return {
    title,
    body: body ? truncate(body, 96) : undefined,
    tone: "info",
    action: { label: `View ${issue.ref}`, href: issue.href },
    dedupeKey: `activity:${action}:${entityId}:${commentId ?? "na"}`,
  };
}

function buildAgentStatusToast(
  payload: Record<string, unknown>,
  nameOf: (id: string) => string | null,
  queryClient: QueryClient,
  companyId: string,
): ToastInput | null {
  const agentId = readString(payload.agentId);
  const status = readString(payload.status);
  if (!agentId || !status || !AGENT_TOAST_STATUSES.has(status)) return null;

  const tone = status === "error" ? "error" : "info";
  const name = nameOf(agentId) ?? `Agent ${shortId(agentId)}`;
  const title =
    status === "running"
      ? `${name} started`
      : `${name} errored`;

  const agents = queryClient.getQueryData<Agent[]>(queryKeys.agents.list(companyId));
  const agent = agents?.find((a) => a.id === agentId);
  const body = agent?.title ?? undefined;

  return {
    title,
    body,
    tone,
    action: { label: "View agent", href: `/agents/${agentId}` },
    dedupeKey: `agent-status:${agentId}:${status}`,
  };
}

function buildRunStatusToast(
  payload: Record<string, unknown>,
  nameOf: (id: string) => string | null,
): ToastInput | null {
  const runId = readString(payload.runId);
  const agentId = readString(payload.agentId);
  const status = readString(payload.status);
  if (!runId || !agentId || !status || !TERMINAL_RUN_STATUSES.has(status)) return null;

  const error = readString(payload.error);
  const triggerDetail = readString(payload.triggerDetail);
  const name = nameOf(agentId) ?? `Agent ${shortId(agentId)}`;
  const tone = status === "succeeded" ? "success" : status === "cancelled" ? "warn" : "error";
  const statusLabel =
    status === "succeeded" ? "succeeded"
      : status === "failed" ? "failed"
        : status === "timed_out" ? "timed out"
          : "cancelled";
  const title = `${name} run ${statusLabel}`;

  let body: string | undefined;
  if (error) {
    body = truncate(error, 100);
  } else if (triggerDetail) {
    body = `Trigger: ${triggerDetail}`;
  }

  return {
    title,
    body,
    tone,
    ttlMs: status === "succeeded" ? 5000 : 7000,
    action: { label: "View run", href: `/agents/${agentId}/runs/${runId}` },
    dedupeKey: `run-status:${runId}:${status}`,
  };
}

function invalidateHeartbeatQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  companyId: string,
  payload: Record<string, unknown>,
) {
  queryClient.invalidateQueries({ queryKey: queryKeys.liveRuns(companyId) });
  queryClient.invalidateQueries({ queryKey: queryKeys.heartbeats(companyId) });
  queryClient.invalidateQueries({ queryKey: queryKeys.agents.list(companyId) });
  queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(companyId) });
  queryClient.invalidateQueries({ queryKey: queryKeys.dashboardProtocolQueue(companyId) });
  queryClient.invalidateQueries({ queryKey: queryKeys.costs(companyId) });
  queryClient.invalidateQueries({ queryKey: queryKeys.sidebarBadges(companyId) });

  const agentId = readString(payload.agentId);
  if (agentId) {
    queryClient.invalidateQueries({ queryKey: queryKeys.agents.detail(agentId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.heartbeats(companyId, agentId) });
  }
}

function invalidateActivityQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  companyId: string,
  payload: Record<string, unknown>,
) {
  queryClient.invalidateQueries({ queryKey: queryKeys.activity(companyId) });
  queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(companyId) });
  queryClient.invalidateQueries({ queryKey: queryKeys.dashboardProtocolQueue(companyId) });
  queryClient.invalidateQueries({ queryKey: queryKeys.sidebarBadges(companyId) });

  const entityType = readString(payload.entityType);
  const entityId = readString(payload.entityId);

  if (entityType === "issue") {
    queryClient.invalidateQueries({ queryKey: queryKeys.issues.list(companyId) });
    if (entityId) {
      const details = readRecord(payload.details);
      const issueRefs = resolveIssueQueryRefs(queryClient, companyId, entityId, details);
      for (const ref of issueRefs) {
        queryClient.invalidateQueries({ queryKey: queryKeys.issues.detail(ref) });
        queryClient.invalidateQueries({ queryKey: queryKeys.issues.protocolState(ref) });
        queryClient.invalidateQueries({ queryKey: queryKeys.issues.protocolMessages(ref) });
        queryClient.invalidateQueries({ queryKey: queryKeys.issues.protocolBriefs(ref) });
        queryClient.invalidateQueries({ queryKey: queryKeys.issues.protocolReviewCycles(ref) });
        queryClient.invalidateQueries({ queryKey: queryKeys.issues.protocolViolations(ref) });
        queryClient.invalidateQueries({ queryKey: queryKeys.issues.comments(ref) });
        queryClient.invalidateQueries({ queryKey: queryKeys.issues.activity(ref) });
        queryClient.invalidateQueries({ queryKey: queryKeys.issues.runs(ref) });
        queryClient.invalidateQueries({ queryKey: queryKeys.issues.approvals(ref) });
        queryClient.invalidateQueries({ queryKey: queryKeys.issues.attachments(ref) });
        queryClient.invalidateQueries({ queryKey: queryKeys.issues.changeSurface(ref) });
        queryClient.invalidateQueries({ queryKey: queryKeys.issues.deliverables(ref) });
        queryClient.invalidateQueries({ queryKey: queryKeys.issues.documents(ref) });
        queryClient.invalidateQueries({ queryKey: queryKeys.issues.liveRuns(ref) });
        queryClient.invalidateQueries({ queryKey: queryKeys.issues.activeRun(ref) });
      }
    }
    return;
  }

  if (entityType === "agent") {
    queryClient.invalidateQueries({ queryKey: queryKeys.agents.list(companyId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.org(companyId) });
    if (entityId) {
      queryClient.invalidateQueries({ queryKey: queryKeys.agents.detail(entityId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.heartbeats(companyId, entityId) });
    }
    return;
  }

  if (entityType === "project") {
    queryClient.invalidateQueries({ queryKey: queryKeys.projects.list(companyId) });
    if (entityId) queryClient.invalidateQueries({ queryKey: queryKeys.projects.detail(entityId) });
    return;
  }

  if (entityType === "goal") {
    queryClient.invalidateQueries({ queryKey: queryKeys.goals.list(companyId) });
    if (entityId) queryClient.invalidateQueries({ queryKey: queryKeys.goals.detail(entityId) });
    return;
  }

  if (entityType === "approval") {
    queryClient.invalidateQueries({ queryKey: queryKeys.approvals.list(companyId) });
    return;
  }

  if (entityType === "cost_event") {
    queryClient.invalidateQueries({ queryKey: queryKeys.costs(companyId) });
    return;
  }

  if (entityType === "company") {
    queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
    if (entityId) {
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.setupProgress(entityId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.rolePacks(entityId) });
    }
  }
}

interface ToastGate {
  cooldownHits: Map<string, number[]>;
  suppressUntil: number;
}

function shouldSuppressToast(gate: ToastGate, category: string): boolean {
  const now = Date.now();
  if (now < gate.suppressUntil) return true;

  const hits = gate.cooldownHits.get(category);
  if (!hits) return false;

  const recent = hits.filter((t) => now - t < TOAST_COOLDOWN_WINDOW_MS);
  gate.cooldownHits.set(category, recent);
  return recent.length >= TOAST_COOLDOWN_MAX;
}

function recordToastHit(gate: ToastGate, category: string) {
  const now = Date.now();
  const hits = gate.cooldownHits.get(category) ?? [];
  hits.push(now);
  gate.cooldownHits.set(category, hits);
}

function gatedPushToast(
  gate: ToastGate,
  pushToast: (toast: ToastInput) => string | null,
  category: string,
  toast: ToastInput,
) {
  if (shouldSuppressToast(gate, category)) return;
  const id = pushToast(toast);
  if (id !== null) recordToastHit(gate, category);
}

function handleLiveEvent(
  queryClient: QueryClient,
  expectedCompanyId: string,
  event: LiveEvent,
  pushToast: (toast: ToastInput) => string | null,
  gate: ToastGate,
) {
  if (event.companyId !== expectedCompanyId) return;

  const nameOf = (id: string) => resolveAgentName(queryClient, expectedCompanyId, id);
  const payload = event.payload ?? {};
  if (event.type === "heartbeat.run.log") {
    return;
  }

  if (event.type === "heartbeat.run.queued" || event.type === "heartbeat.run.status") {
    invalidateHeartbeatQueries(queryClient, expectedCompanyId, payload);
    if (event.type === "heartbeat.run.status") {
      const toast = buildRunStatusToast(payload, nameOf);
      if (toast) gatedPushToast(gate, pushToast, "run-status", toast);
    }
    return;
  }

  if (event.type === "heartbeat.run.event") {
    return;
  }

  if (event.type === "agent.status") {
    queryClient.invalidateQueries({ queryKey: queryKeys.agents.list(expectedCompanyId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(expectedCompanyId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.dashboardProtocolQueue(expectedCompanyId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.org(expectedCompanyId) });
    const agentId = readString(payload.agentId);
    if (agentId) queryClient.invalidateQueries({ queryKey: queryKeys.agents.detail(agentId) });
    const toast = buildAgentStatusToast(payload, nameOf, queryClient, expectedCompanyId);
    if (toast) gatedPushToast(gate, pushToast, "agent-status", toast);
    return;
  }

  if (event.type === "activity.logged") {
    invalidateActivityQueries(queryClient, expectedCompanyId, payload);
    const action = readString(payload.action);
    const toast = buildActivityToast(queryClient, expectedCompanyId, payload);
    if (toast) gatedPushToast(gate, pushToast, `activity:${action ?? "unknown"}`, toast);
  }
}

export function LiveUpdatesProvider({ children }: { children: ReactNode }) {
  const { selectedCompanyId } = useCompany();
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const gateRef = useRef<ToastGate>({ cooldownHits: new Map(), suppressUntil: 0 });

  useEffect(() => {
    if (!selectedCompanyId) return;

    let closed = false;
    let reconnectAttempt = 0;
    let reconnectTimer: number | null = null;
    let socket: WebSocket | null = null;

    const clearReconnect = () => {
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    const scheduleReconnect = () => {
      if (closed) return;
      reconnectAttempt += 1;
      const delayMs = Math.min(15000, 1000 * 2 ** Math.min(reconnectAttempt - 1, 4));
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delayMs);
    };

    const connect = () => {
      if (closed) return;
      const protocol = window.location.protocol === "https:" ? "wss" : "ws";
      const url = `${protocol}://${window.location.host}/api/companies/${encodeURIComponent(selectedCompanyId)}/events/ws`;
      socket = new WebSocket(url);

      socket.onopen = () => {
        if (reconnectAttempt > 0) {
          gateRef.current.suppressUntil = Date.now() + RECONNECT_SUPPRESS_MS;
        }
        reconnectAttempt = 0;
      };

      socket.onmessage = (message) => {
        const raw = typeof message.data === "string" ? message.data : "";
        if (!raw) return;

        try {
          const parsed = JSON.parse(raw) as LiveEvent;
          handleLiveEvent(queryClient, selectedCompanyId, parsed, pushToast, gateRef.current);
        } catch {
          // Ignore non-JSON payloads.
        }
      };

      socket.onerror = () => {
        socket?.close();
      };

      socket.onclose = () => {
        if (closed) return;
        scheduleReconnect();
      };
    };

    connect();

    return () => {
      closed = true;
      clearReconnect();
      if (socket) {
        socket.onopen = null;
        socket.onmessage = null;
        socket.onerror = null;
        socket.onclose = null;
        socket.close(1000, "provider_unmount");
      }
    };
  }, [queryClient, selectedCompanyId, pushToast]);

  return <>{children}</>;
}
