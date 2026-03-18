import type { ToastInput } from "./ToastContext";

export interface IssueToastContext {
  ref: string;
  title: string | null;
  label: string;
  href: string;
  changesHref: string;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "\u2026";
}

function formatProtocolMessageType(messageType: string): string {
  return messageType.replace(/_/g, " ").toLowerCase();
}

export function sanitizeExternalToastHref(value: string | null): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.toString();
    }
  } catch {
    return null;
  }
  return null;
}

export function buildProtocolMessageToast(
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

export function buildMergeCandidateToast(
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

export function buildMergeAutomationToast(
  issue: IssueToastContext,
  details: Record<string, unknown> | null,
): ToastInput {
  const actionType = readString(details?.actionType) ?? "automation";
  const externalProvider = readString(details?.externalProvider);
  const targetBranch = readString(details?.targetBranch);
  const externalUrl = sanitizeExternalToastHref(readString(details?.externalUrl));
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

export function buildProtocolTimeoutToast(
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

export function buildRunStatusToast(
  payload: Record<string, unknown>,
  nameOf: (id: string) => string | null,
): ToastInput | null {
  const runId = readString(payload.runId);
  const agentId = readString(payload.agentId);
  const status = readString(payload.status);
  const terminalRunStatuses = new Set(["succeeded", "failed", "timed_out", "cancelled"]);
  if (!runId || !agentId || !status || !terminalRunStatuses.has(status)) return null;

  const error = readString(payload.error);
  const triggerDetail = readString(payload.triggerDetail);
  const name = nameOf(agentId) ?? `Agent ${agentId.slice(0, 8)}`;
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
