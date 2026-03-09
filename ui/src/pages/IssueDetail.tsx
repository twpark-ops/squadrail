import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { issuesApi } from "../api/issues";
import { activityApi } from "../api/activity";
import { heartbeatsApi } from "../api/heartbeats";
import { agentsApi } from "../api/agents";
import { authApi } from "../api/auth";
import { projectsApi } from "../api/projects";
import { useCompany } from "../context/CompanyContext";
import { useToast } from "../context/ToastContext";
import { usePanel } from "../context/PanelContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { useProjectOrder } from "../hooks/useProjectOrder";
import { relativeTime, cn, formatTokens } from "../lib/utils";
import { InlineEditor } from "../components/InlineEditor";
import { CommentThread } from "../components/CommentThread";
import { IssueProperties } from "../components/IssueProperties";
import { LiveRunWidget } from "../components/LiveRunWidget";
import { ProtocolActionConsole } from "../components/ProtocolActionConsole";
import type { MentionOption } from "../components/MarkdownEditor";
import { StatusIcon } from "../components/StatusIcon";
import { PriorityIcon } from "../components/PriorityIcon";
import { StatusBadge } from "../components/StatusBadge";
import { Identity } from "../components/Identity";
import { Separator } from "@/components/ui/separator";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BriefPanelV2 } from "../components/BriefPanelV2";
import { StatusBadgeV2 } from "../components/StatusBadgeV2";
import {
  Activity as ActivityIcon,
  BookText,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  EyeOff,
  Hexagon,
  ListTree,
  MessageSquare,
  MoreHorizontal,
  FileText as AttachmentIcon,
  ShieldAlert,
  SlidersHorizontal,
  Trash2,
  TriangleAlert,
  Workflow,
  Lightbulb,
} from "lucide-react";
import type {
  ActivityEvent,
  Agent,
  IssueAttachment,
  IssueProtocolMessage,
  IssueProtocolState,
  IssueProtocolViolation,
  IssueReviewCycle,
  IssueTaskBrief,
} from "@squadrail/shared";

type CommentReassignment = {
  assigneeAgentId: string | null;
  assigneeUserId: string | null;
};

const ACTION_LABELS: Record<string, string> = {
  "issue.created": "created the issue",
  "issue.updated": "updated the issue",
  "issue.checked_out": "checked out the issue",
  "issue.released": "released the issue",
  "issue.comment_added": "added a comment",
  "issue.attachment_added": "added an attachment",
  "issue.attachment_removed": "removed an attachment",
  "issue.deleted": "deleted the issue",
  "agent.created": "created an agent",
  "agent.updated": "updated the agent",
  "agent.paused": "paused the agent",
  "agent.resumed": "resumed the agent",
  "agent.terminated": "terminated the agent",
  "heartbeat.invoked": "invoked a heartbeat",
  "heartbeat.cancelled": "cancelled a heartbeat",
  "approval.created": "requested approval",
  "approval.approved": "approved",
  "approval.rejected": "rejected",
};

function humanizeValue(value: unknown): string {
  if (typeof value !== "string") return String(value ?? "none");
  return value.replace(/_/g, " ");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

type BriefQualitySnapshot = {
  confidenceLevel: "high" | "medium" | "low";
  evidenceCount: number;
  denseEnabled: boolean;
  degradedReasons: string[];
};

function readBriefQuality(brief: IssueTaskBrief): BriefQualitySnapshot | null {
  const quality = asRecord(asRecord(brief.contentJson)?.quality);
  if (!quality) return null;
  const confidenceLevel = quality.confidenceLevel;
  if (confidenceLevel !== "high" && confidenceLevel !== "medium" && confidenceLevel !== "low") return null;
  return {
    confidenceLevel,
    evidenceCount: typeof quality.evidenceCount === "number" ? quality.evidenceCount : 0,
    denseEnabled: quality.denseEnabled === true,
    degradedReasons: Array.isArray(quality.degradedReasons)
      ? quality.degradedReasons.filter((reason): reason is string => typeof reason === "string")
      : [],
  };
}

function briefQualityBadgeClass(confidenceLevel: BriefQualitySnapshot["confidenceLevel"]) {
  switch (confidenceLevel) {
    case "high":
      return "border-emerald-300 bg-emerald-50 text-emerald-700";
    case "medium":
      return "border-amber-300 bg-amber-50 text-amber-700";
    default:
      return "border-rose-300 bg-rose-50 text-rose-700";
  }
}

function formatBriefQualityReason(reason: string) {
  switch (reason) {
    case "semantic_search_unavailable":
      return "semantic search unavailable";
    case "semantic_search_empty":
      return "semantic search returned no hits";
    case "no_retrieval_hits":
      return "no retrieval hits";
    case "low_evidence_count":
      return "low evidence count";
    case "narrow_source_diversity":
      return "narrow source diversity";
    default:
      return reason.replace(/_/g, " ");
  }
}

function usageNumber(usage: Record<string, unknown> | null, ...keys: string[]) {
  if (!usage) return 0;
  for (const key of keys) {
    const value = usage[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return 0;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "\u2026";
}

function formatProtocolValue(value: string | null | undefined) {
  if (!value) return "Unknown";
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function collectProtocolEvidence(message: IssueProtocolMessage) {
  const payload = ((message.payload ?? {}) as unknown) as Record<string, unknown>;
  const evidence: string[] = [];
  const artifactLabels = (message.artifacts ?? [])
    .map((artifact) => artifact.label ?? artifact.uri)
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0);

  for (const key of ["evidence", "reviewChecklist", "testResults", "residualRisks", "finalArtifacts", "followUpActions"]) {
    const value = payload[key];
    if (!Array.isArray(value)) continue;
    for (const entry of value) {
      if (typeof entry === "string" && entry.trim().length > 0) evidence.push(entry.trim());
    }
  }

  return Array.from(new Set([...evidence, ...artifactLabels])).slice(0, 8);
}

function readProtocolStringArray(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function readProtocolString(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

type ProtocolReviewHandoffSnapshot = {
  implementationSummary: string | null;
  diffSummary: string | null;
  changedFiles: string[];
  testResults: string[];
  reviewChecklist: string[];
  residualRisks: string[];
};

function readProtocolReviewHandoff(message: IssueProtocolMessage): ProtocolReviewHandoffSnapshot | null {
  if (message.messageType !== "SUBMIT_FOR_REVIEW") return null;
  const payload = asRecord(message.payload) ?? {};
  return {
    implementationSummary: readProtocolString(payload, "implementationSummary"),
    diffSummary: readProtocolString(payload, "diffSummary"),
    changedFiles: readProtocolStringArray(payload, "changedFiles"),
    testResults: readProtocolStringArray(payload, "testResults"),
    reviewChecklist: readProtocolStringArray(payload, "reviewChecklist"),
    residualRisks: readProtocolStringArray(payload, "residualRisks"),
  };
}

function latestBriefsByScope(briefs: IssueTaskBrief[]) {
  const result = new Map<string, IssueTaskBrief>();
  for (const brief of briefs) {
    if (!result.has(brief.briefScope)) {
      result.set(brief.briefScope, brief);
    }
  }
  return [...result.values()];
}

type ProtocolRecoveryAlert = {
  id: string;
  kind: "timeout" | "violation";
  severity: "low" | "medium" | "high" | "critical";
  title: string;
  detail: string;
  recommendation: string;
  statusLabel: string;
  createdAt: Date;
  metadata: string[];
};

function timeoutRecommendation(code: string) {
  switch (code) {
    case "assignment_ack_timeout":
      return "Confirm ownership, then either reassign or force an explicit ACK from the engineer.";
    case "plan_start_timeout":
      return "Require a plan or START_IMPLEMENTATION before more work proceeds.";
    case "progress_stale":
      return "Request a concrete progress report with changed files, tests, and next steps.";
    case "review_start_timeout":
      return "Wake the reviewer or reassign review ownership before approving anything.";
    case "review_decision_timeout":
      return "Ask the reviewer for an explicit approve/request-changes decision with evidence.";
    case "changes_ack_timeout":
      return "Require the engineer to acknowledge requested changes or reassign implementation.";
    case "close_timeout":
      return "Close the issue only after final artifacts, merge state, and test status are attached.";
    case "human_decision_timeout":
      return "Board intervention is required. Resolve the pending decision or cancel the task.";
    default:
      return "Review the latest protocol messages and clear the blocked handoff.";
  }
}

function violationRecommendation(code: string) {
  switch (code) {
    case "invalid_state_transition":
    case "invalid_predecessor_message":
      return "Correct the workflow order and resend the message from the current protocol state.";
    case "duplicate_active_review":
    case "stale_review_cycle_action":
      return "Inspect the active review cycle before sending more review messages.";
    case "missing_required_artifact":
      return "Attach the missing artifacts or evidence before retrying the transition.";
    case "close_without_approval":
    case "close_without_verification":
      return "Do not close the issue until approval, final artifacts, and verification evidence are present.";
    case "recipient_role_mismatch":
    case "unauthorized_sender":
      return "Use the correct actor role and recipients for the workflow step.";
    case "payload_schema_mismatch":
      return "Fix the structured payload fields before retrying the protocol action.";
    case "message_replay_conflict":
      return "Avoid replaying stale messages. Refresh the issue state and submit a fresh action.";
    default:
      return "Inspect the violation details and latest protocol timeline before retrying.";
  }
}

function buildProtocolRecoveryAlerts(
  protocolMessages: IssueProtocolMessage[],
  protocolViolations: IssueProtocolViolation[],
): ProtocolRecoveryAlert[] {
  const timeoutAlerts = protocolMessages.flatMap((message) => {
    if (message.messageType !== "TIMEOUT_ESCALATION" && message.messageType !== "SYSTEM_REMINDER") return [];
    const payload = asRecord(message.payload) ?? {};
    const timeoutCode =
      typeof payload.timeoutCode === "string"
        ? payload.timeoutCode
        : typeof payload.reminderCode === "string"
          ? payload.reminderCode
          : "unknown_timeout";
    const metadata: string[] = [];
    if (typeof payload.expiredActorRole === "string") {
      metadata.push(`Expired role: ${formatProtocolValue(payload.expiredActorRole)}`);
    }
    if (typeof payload.nextEscalationTarget === "string") {
      metadata.push(`Escalates to: ${formatProtocolValue(payload.nextEscalationTarget)}`);
    }
    if (typeof payload.reminderMessage === "string") {
      metadata.push(payload.reminderMessage);
    }
    return [{
      id: message.id,
      kind: "timeout" as const,
      severity: message.messageType === "TIMEOUT_ESCALATION" ? "high" as const : "medium" as const,
      title: formatProtocolValue(timeoutCode),
      detail: message.summary,
      recommendation: timeoutRecommendation(timeoutCode),
      statusLabel: message.messageType === "TIMEOUT_ESCALATION" ? "Escalated" : "Reminder",
      createdAt: message.createdAt,
      metadata,
    }];
  });

  const violationAlerts = protocolViolations.map((violation) => {
    const metadata: string[] = [];
    if (typeof violation.details.error === "string") {
      metadata.push(violation.details.error);
    }
    if (typeof violation.details.reason === "string") {
      metadata.push(`Reason: ${formatProtocolValue(violation.details.reason)}`);
    }
    if (typeof violation.details.messageType === "string") {
      metadata.push(`Message: ${formatProtocolValue(violation.details.messageType)}`);
    }
    return {
      id: violation.id,
      kind: "violation" as const,
      severity: violation.severity,
      title: formatProtocolValue(violation.violationCode),
      detail: violation.status === "open" ? "Protocol action was rejected and still needs correction." : "Historical protocol violation.",
      recommendation: violationRecommendation(violation.violationCode),
      statusLabel: formatProtocolValue(violation.status),
      createdAt: violation.createdAt,
      metadata,
    };
  });

  const integrityAlerts = protocolMessages.flatMap((message) => {
    if (!message.integrityStatus || message.integrityStatus === "verified") return [];
    const metadata: string[] = [];
    if (message.integritySignature) metadata.push(`Signature: ${message.integritySignature.slice(0, 12)}…`);
    if (message.payloadSha256) metadata.push(`Payload hash: ${message.payloadSha256.slice(0, 12)}…`);
    return [{
      id: `integrity:${message.id}`,
      kind: "violation" as const,
      severity: message.integrityStatus === "tampered" ? "critical" as const : "medium" as const,
      title: message.integrityStatus === "legacy_unsealed" ? "Legacy unsealed protocol message" : "Protocol integrity check failed",
      detail:
        message.integrityStatus === "legacy_unsealed"
          ? "This message predates tamper-evident sealing."
          : "The stored protocol message no longer matches its integrity signature chain.",
      recommendation:
        message.integrityStatus === "legacy_unsealed"
          ? "Historical messages remain readable, but rely on newer sealed protocol traffic for strict audit trails."
          : "Treat this issue timeline as compromised until a board operator reviews the message history.",
      statusLabel: formatProtocolValue(message.integrityStatus),
      createdAt: new Date(message.createdAt),
      metadata,
    }];
  });

  return [...timeoutAlerts, ...violationAlerts, ...integrityAlerts]
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
    .slice(0, 10);
}

function formatAction(action: string, details?: Record<string, unknown> | null): string {
  if (action === "issue.updated" && details) {
    const previous = (details._previous ?? {}) as Record<string, unknown>;
    const parts: string[] = [];

    if (details.status !== undefined) {
      const from = previous.status;
      parts.push(
        from
          ? `changed the status from ${humanizeValue(from)} to ${humanizeValue(details.status)}`
          : `changed the status to ${humanizeValue(details.status)}`
      );
    }
    if (details.priority !== undefined) {
      const from = previous.priority;
      parts.push(
        from
          ? `changed the priority from ${humanizeValue(from)} to ${humanizeValue(details.priority)}`
          : `changed the priority to ${humanizeValue(details.priority)}`
      );
    }
    if (details.assigneeAgentId !== undefined || details.assigneeUserId !== undefined) {
      parts.push(
        details.assigneeAgentId || details.assigneeUserId
          ? "assigned the issue"
          : "unassigned the issue",
      );
    }
    if (details.title !== undefined) parts.push("updated the title");
    if (details.description !== undefined) parts.push("updated the description");

    if (parts.length > 0) return parts.join(", ");
  }
  return ACTION_LABELS[action] ?? action.replace(/[._]/g, " ");
}

function ActorIdentity({ evt, agentMap }: { evt: ActivityEvent; agentMap: Map<string, Agent> }) {
  const id = evt.actorId;
  if (evt.actorType === "agent") {
    const agent = agentMap.get(id);
    return <Identity name={agent?.name ?? id.slice(0, 8)} size="sm" />;
  }
  if (evt.actorType === "system") return <Identity name="System" size="sm" />;
  if (evt.actorType === "user") return <Identity name="Board" size="sm" />;
  return <Identity name={id || "Unknown"} size="sm" />;
}

export function IssueDetail() {
  const { issueId } = useParams<{ issueId: string }>();
  const { selectedCompanyId } = useCompany();
  const { pushToast } = useToast();
  const { openPanel, closePanel, panelVisible, setPanelVisible } = usePanel();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [moreOpen, setMoreOpen] = useState(false);
  const [mobilePropsOpen, setMobilePropsOpen] = useState(false);
  const [detailTab, setDetailTab] = useState("brief");
  const [secondaryOpen, setSecondaryOpen] = useState({
    approvals: false,
    cost: false,
  });
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const { data: issue, isLoading, error } = useQuery({
    queryKey: queryKeys.issues.detail(issueId!),
    queryFn: () => issuesApi.get(issueId!),
    enabled: !!issueId,
  });

  const { data: comments } = useQuery({
    queryKey: queryKeys.issues.comments(issueId!),
    queryFn: () => issuesApi.listComments(issueId!),
    enabled: !!issueId,
  });

  const { data: protocolState } = useQuery({
    queryKey: queryKeys.issues.protocolState(issueId!),
    queryFn: () => issuesApi.getProtocolState(issueId!),
    enabled: !!issueId,
    refetchInterval: 5000,
  });

  const { data: protocolMessages = [] } = useQuery({
    queryKey: queryKeys.issues.protocolMessages(issueId!),
    queryFn: () => issuesApi.listProtocolMessages(issueId!),
    enabled: !!issueId,
    refetchInterval: 5000,
  });

  const { data: protocolBriefs = [] } = useQuery({
    queryKey: queryKeys.issues.protocolBriefs(issueId!),
    queryFn: async () => {
      const result = await issuesApi.listProtocolBriefs(issueId!);
      return Array.isArray(result) ? result : [result];
    },
    enabled: !!issueId,
    refetchInterval: 5000,
  });

  const { data: reviewCycles = [] } = useQuery({
    queryKey: queryKeys.issues.protocolReviewCycles(issueId!),
    queryFn: () => issuesApi.listProtocolReviewCycles(issueId!),
    enabled: !!issueId,
    refetchInterval: 5000,
  });

  const { data: protocolViolations = [] } = useQuery({
    queryKey: queryKeys.issues.protocolViolations(issueId!),
    queryFn: () => issuesApi.listProtocolViolations(issueId!),
    enabled: !!issueId,
    refetchInterval: 5000,
  });

  const { data: activity } = useQuery({
    queryKey: queryKeys.issues.activity(issueId!),
    queryFn: () => activityApi.forIssue(issueId!),
    enabled: !!issueId,
  });

  const { data: linkedRuns } = useQuery({
    queryKey: queryKeys.issues.runs(issueId!),
    queryFn: () => activityApi.runsForIssue(issueId!),
    enabled: !!issueId,
    refetchInterval: 5000,
  });

  const { data: linkedApprovals } = useQuery({
    queryKey: queryKeys.issues.approvals(issueId!),
    queryFn: () => issuesApi.listApprovals(issueId!),
    enabled: !!issueId,
  });

  const { data: attachments } = useQuery({
    queryKey: queryKeys.issues.attachments(issueId!),
    queryFn: () => issuesApi.listAttachments(issueId!),
    enabled: !!issueId,
  });

  const { data: liveRuns } = useQuery({
    queryKey: queryKeys.issues.liveRuns(issueId!),
    queryFn: () => heartbeatsApi.liveRunsForIssue(issueId!),
    enabled: !!issueId,
    refetchInterval: 3000,
  });

  const { data: activeRun } = useQuery({
    queryKey: queryKeys.issues.activeRun(issueId!),
    queryFn: () => heartbeatsApi.activeRunForIssue(issueId!),
    enabled: !!issueId,
    refetchInterval: 3000,
  });

  const hasLiveRuns = (liveRuns ?? []).length > 0 || !!activeRun;
  const primaryLiveRun = activeRun ?? liveRuns?.[0] ?? null;
  const liveRunCount = useMemo(() => {
    const runIds = new Set<string>();
    for (const run of liveRuns ?? []) runIds.add(run.id);
    if (activeRun) runIds.add(activeRun.id);
    return runIds.size;
  }, [activeRun, liveRuns]);
  const primaryLiveRunStartedAt = primaryLiveRun?.startedAt ?? primaryLiveRun?.createdAt ?? null;
  const primaryLiveAdapterLabel = primaryLiveRun?.adapterType
    ? formatProtocolValue(primaryLiveRun.adapterType)
    : null;
  const primaryLiveTrigger = primaryLiveRun?.triggerDetail
    ? primaryLiveRun.triggerDetail
    : primaryLiveRun?.invocationSource
      ? formatProtocolValue(primaryLiveRun.invocationSource)
      : null;

  // Filter out runs already shown by the live widget to avoid duplication
  const timelineRuns = useMemo(() => {
    const liveIds = new Set<string>();
    for (const r of liveRuns ?? []) liveIds.add(r.id);
    if (activeRun) liveIds.add(activeRun.id);
    if (liveIds.size === 0) return linkedRuns ?? [];
    return (linkedRuns ?? []).filter((r) => !liveIds.has(r.runId));
  }, [linkedRuns, liveRuns, activeRun]);

  const { data: allIssues } = useQuery({
    queryKey: queryKeys.issues.list(selectedCompanyId!),
    queryFn: () => issuesApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: session } = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
  });

  const { data: projects } = useQuery({
    queryKey: queryKeys.projects.list(selectedCompanyId!),
    queryFn: () => projectsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });
  const currentUserId = session?.user?.id ?? session?.session?.userId ?? null;
  const { orderedProjects } = useProjectOrder({
    projects: projects ?? [],
    companyId: selectedCompanyId,
    userId: currentUserId,
  });

  const agentMap = useMemo(() => {
    const map = new Map<string, Agent>();
    for (const a of agents ?? []) map.set(a.id, a);
    return map;
  }, [agents]);

  const mentionOptions = useMemo<MentionOption[]>(() => {
    const options: MentionOption[] = [];
    const activeAgents = [...(agents ?? [])]
      .filter((agent) => agent.status !== "terminated")
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const agent of activeAgents) {
      options.push({
        id: `agent:${agent.id}`,
        name: agent.name,
        kind: "agent",
      });
    }
    for (const project of orderedProjects) {
      options.push({
        id: `project:${project.id}`,
        name: project.name,
        kind: "project",
        projectId: project.id,
        projectColor: project.color,
      });
    }
    return options;
  }, [agents, orderedProjects]);

  const childIssues = useMemo(() => {
    if (!issue) return [];
    const detailChildren = issue.internalWorkItems ?? [];
    const visibleChildren = (allIssues ?? [])
      .filter((i) => i.parentId === issue.id)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    const combined = [...detailChildren];
    const seen = new Set(detailChildren.map((child) => child.id));
    for (const child of visibleChildren) {
      if (seen.has(child.id)) continue;
      combined.push(child);
    }
    return combined.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }, [allIssues, issue]);

  const commentReassignOptions = useMemo(() => {
    const options: Array<{ id: string; label: string; searchText?: string }> = [];
    const activeAgents = [...(agents ?? [])]
      .filter((agent) => agent.status !== "terminated")
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const agent of activeAgents) {
      options.push({ id: `agent:${agent.id}`, label: agent.name });
    }
    if (currentUserId) {
      const label = currentUserId === "local-board" ? "Board" : "Me (Board)";
      options.push({ id: `user:${currentUserId}`, label });
    }
    return options;
  }, [agents, currentUserId]);

  const currentAssigneeValue = useMemo(() => {
    if (issue?.assigneeAgentId) return `agent:${issue.assigneeAgentId}`;
    if (issue?.assigneeUserId) return `user:${issue.assigneeUserId}`;
    return "";
  }, [issue?.assigneeAgentId, issue?.assigneeUserId]);

  const commentsWithRunMeta = useMemo(() => {
    const runMetaByCommentId = new Map<string, { runId: string; runAgentId: string | null }>();
    const agentIdByRunId = new Map<string, string>();
    for (const run of linkedRuns ?? []) {
      agentIdByRunId.set(run.runId, run.agentId);
    }
    for (const evt of activity ?? []) {
      if (evt.action !== "issue.comment_added" || !evt.runId) continue;
      const details = evt.details ?? {};
      const commentId = typeof details["commentId"] === "string" ? details["commentId"] : null;
      if (!commentId || runMetaByCommentId.has(commentId)) continue;
      runMetaByCommentId.set(commentId, {
        runId: evt.runId,
        runAgentId: evt.agentId ?? agentIdByRunId.get(evt.runId) ?? null,
      });
    }
    return (comments ?? []).map((comment) => {
      const meta = runMetaByCommentId.get(comment.id);
      return meta ? { ...comment, ...meta } : comment;
    });
  }, [activity, comments, linkedRuns]);

  const latestBriefs = useMemo(() => latestBriefsByScope(protocolBriefs), [protocolBriefs]);
  const protocolTimeline = useMemo(() => [...protocolMessages].slice(-12).reverse(), [protocolMessages]);
  const openViolations = useMemo(
    () => protocolViolations.filter((violation) => violation.status === "open"),
    [protocolViolations],
  );
  const protocolRecoveryAlerts = useMemo(
    () => buildProtocolRecoveryAlerts(protocolMessages, protocolViolations),
    [protocolMessages, protocolViolations],
  );
  const openTimeoutAlertCount = useMemo(
    () => protocolMessages.filter((message) => message.messageType === "TIMEOUT_ESCALATION").length,
    [protocolMessages],
  );
  const integrityIssueCount = useMemo(
    () => protocolMessages.filter((message) => message.integrityStatus && message.integrityStatus !== "verified").length,
    [protocolMessages],
  );
  const latestReviewCycle = useMemo(() => reviewCycles[0] ?? null, [reviewCycles]);

  const issueCostSummary = useMemo(() => {
    let input = 0;
    let output = 0;
    let cached = 0;
    let cost = 0;
    let hasCost = false;
    let hasTokens = false;

    for (const run of linkedRuns ?? []) {
      const usage = asRecord(run.usageJson);
      const result = asRecord(run.resultJson);
      const runInput = usageNumber(usage, "inputTokens", "input_tokens");
      const runOutput = usageNumber(usage, "outputTokens", "output_tokens");
      const runCached = usageNumber(
        usage,
        "cachedInputTokens",
        "cached_input_tokens",
        "cache_read_input_tokens",
      );
      const runCost =
        usageNumber(usage, "costUsd", "cost_usd", "total_cost_usd") ||
        usageNumber(result, "total_cost_usd", "cost_usd", "costUsd");
      if (runCost > 0) hasCost = true;
      if (runInput + runOutput + runCached > 0) hasTokens = true;
      input += runInput;
      output += runOutput;
      cached += runCached;
      cost += runCost;
    }

    return {
      input,
      output,
      cached,
      cost,
      totalTokens: input + output,
      hasCost,
      hasTokens,
    };
  }, [linkedRuns]);

  const invalidateIssue = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.issues.detail(issueId!) });
    queryClient.invalidateQueries({ queryKey: queryKeys.issues.protocolState(issueId!) });
    queryClient.invalidateQueries({ queryKey: queryKeys.issues.protocolMessages(issueId!) });
    queryClient.invalidateQueries({ queryKey: queryKeys.issues.protocolBriefs(issueId!) });
    queryClient.invalidateQueries({ queryKey: queryKeys.issues.protocolReviewCycles(issueId!) });
    queryClient.invalidateQueries({ queryKey: queryKeys.issues.protocolViolations(issueId!) });
    queryClient.invalidateQueries({ queryKey: queryKeys.issues.activity(issueId!) });
    queryClient.invalidateQueries({ queryKey: queryKeys.issues.runs(issueId!) });
    queryClient.invalidateQueries({ queryKey: queryKeys.issues.approvals(issueId!) });
    queryClient.invalidateQueries({ queryKey: queryKeys.issues.attachments(issueId!) });
    queryClient.invalidateQueries({ queryKey: queryKeys.issues.liveRuns(issueId!) });
    queryClient.invalidateQueries({ queryKey: queryKeys.issues.activeRun(issueId!) });
    if (selectedCompanyId) {
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.list(selectedCompanyId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboardProtocolQueue(selectedCompanyId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(selectedCompanyId) });
    }
  };

  const updateIssue = useMutation({
    mutationFn: (data: Record<string, unknown>) => issuesApi.update(issueId!, data),
    onSuccess: (updated) => {
      invalidateIssue();
      const issueRef = updated.identifier ?? `Issue ${updated.id.slice(0, 8)}`;
      pushToast({
        dedupeKey: `activity:issue.updated:${updated.id}`,
        title: `${issueRef} updated`,
        body: truncate(updated.title, 96),
        tone: "success",
        action: { label: `View ${issueRef}`, href: `/issues/${updated.identifier ?? updated.id}` },
      });
    },
  });

  const addComment = useMutation({
    mutationFn: ({ body, reopen }: { body: string; reopen?: boolean }) =>
      issuesApi.addComment(issueId!, body, reopen),
    onSuccess: (comment) => {
      invalidateIssue();
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.comments(issueId!) });
      const issueRef = issue?.identifier ?? (issueId ? `Issue ${issueId.slice(0, 8)}` : "Issue");
      pushToast({
        dedupeKey: `activity:issue.comment_added:${issueId}:${comment.id}`,
        title: `Comment posted on ${issueRef}`,
        body: issue?.title ? truncate(issue.title, 96) : undefined,
        tone: "success",
        action: issueId ? { label: `View ${issueRef}`, href: `/issues/${issue?.identifier ?? issueId}` } : undefined,
      });
    },
  });

  const addCommentAndReassign = useMutation({
    mutationFn: ({
      body,
      reopen,
      reassignment,
    }: {
      body: string;
      reopen?: boolean;
      reassignment: CommentReassignment;
    }) =>
      issuesApi.update(issueId!, {
        comment: body,
        assigneeAgentId: reassignment.assigneeAgentId,
        assigneeUserId: reassignment.assigneeUserId,
        ...(reopen ? { status: "todo" } : {}),
      }),
    onSuccess: (updated) => {
      invalidateIssue();
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.comments(issueId!) });
      const issueRef = updated.identifier ?? (issueId ? `Issue ${issueId.slice(0, 8)}` : "Issue");
      pushToast({
        dedupeKey: `activity:issue.reassigned:${updated.id}`,
        title: `${issueRef} reassigned`,
        body: issue?.title ? truncate(issue.title, 96) : undefined,
        tone: "success",
        action: issueId ? { label: `View ${issueRef}`, href: `/issues/${issue?.identifier ?? issueId}` } : undefined,
      });
    },
  });

  const uploadAttachment = useMutation({
    mutationFn: async (file: File) => {
      if (!selectedCompanyId) throw new Error("No company selected");
      return issuesApi.uploadAttachment(selectedCompanyId, issueId!, file);
    },
    onSuccess: () => {
      setAttachmentError(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.attachments(issueId!) });
      invalidateIssue();
    },
    onError: (err) => {
      setAttachmentError(err instanceof Error ? err.message : "Upload failed");
    },
  });

  const deleteAttachment = useMutation({
    mutationFn: (attachmentId: string) => issuesApi.deleteAttachment(attachmentId),
    onSuccess: () => {
      setAttachmentError(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.attachments(issueId!) });
      invalidateIssue();
    },
    onError: (err) => {
      setAttachmentError(err instanceof Error ? err.message : "Delete failed");
    },
  });

  const createProtocolMessage = useMutation({
    mutationFn: (message: Parameters<typeof issuesApi.createProtocolMessage>[1]) =>
      issuesApi.createProtocolMessage(issueId!, message),
    onSuccess: () => {
      invalidateIssue();
      const issueRef = issue?.identifier ?? (issueId ? `Issue ${issueId.slice(0, 8)}` : "Issue");
      pushToast({
        dedupeKey: `activity:issue.protocol_message.created:${issueId}`,
        title: `Protocol action posted on ${issueRef}`,
        body: issue?.title ? truncate(issue.title, 96) : undefined,
        tone: "success",
        action: issueId ? { label: `View ${issueRef}`, href: `/issues/${issue?.identifier ?? issueId}` } : undefined,
      });
    },
    onError: (err) => {
      pushToast({
        title: "Protocol action failed",
        body: err instanceof Error ? err.message : "Failed to post protocol action",
        tone: "error",
      });
    },
  });

  useEffect(() => {
    setBreadcrumbs([
      { label: "Issues", href: "/issues" },
      { label: issue?.title ?? issueId ?? "Issue" },
    ]);
  }, [setBreadcrumbs, issue, issueId]);

  // Redirect to identifier-based URL if navigated via UUID
  useEffect(() => {
    if (issue?.identifier && issueId !== issue.identifier) {
      navigate(`/issues/${issue.identifier}`, { replace: true });
    }
  }, [issue, issueId, navigate]);

  useEffect(() => {
    if (issue) {
      openPanel(
        <IssueProperties issue={issue} onUpdate={(data) => updateIssue.mutate(data)} />
      );
    }
    return () => closePanel();
  }, [issue]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading...</p>;
  if (error) return <p className="text-sm text-destructive">{error.message}</p>;
  if (!issue) return null;

  // Ancestors are returned oldest-first from the server (root at end, immediate parent at start)
  const ancestors = issue.ancestors ?? [];

  const handleFilePicked = async (evt: ChangeEvent<HTMLInputElement>) => {
    const file = evt.target.files?.[0];
    if (!file) return;
    await uploadAttachment.mutateAsync(file);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const isImageAttachment = (attachment: IssueAttachment) => attachment.contentType.startsWith("image/");

  return (
    <div className="max-w-2xl space-y-6">
      {/* Parent chain breadcrumb */}
      {ancestors.length > 0 && (
        <nav className="flex items-center gap-1 text-xs text-muted-foreground flex-wrap">
          {[...ancestors].reverse().map((ancestor, i) => (
            <span key={ancestor.id} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="h-3 w-3 shrink-0" />}
              <Link
                to={`/issues/${ancestor.identifier ?? ancestor.id}`}
                className="hover:text-foreground transition-colors truncate max-w-[200px]"
                title={ancestor.title}
              >
                {ancestor.title}
              </Link>
            </span>
          ))}
          <ChevronRight className="h-3 w-3 shrink-0" />
          <span className="text-foreground/60 truncate max-w-[200px]">{issue.title}</span>
        </nav>
      )}

      {issue.hiddenAt && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <EyeOff className="h-4 w-4 shrink-0" />
          This issue is hidden
        </div>
      )}

      <div className="space-y-3">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <StatusIcon
            status={issue.status}
            onChange={(status) => updateIssue.mutate({ status })}
          />
          <PriorityIcon
            priority={issue.priority}
            onChange={(priority) => updateIssue.mutate({ priority })}
          />
          <span className="text-sm font-mono text-muted-foreground shrink-0">{issue.identifier ?? issue.id.slice(0, 8)}</span>

          {hasLiveRuns && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-cyan-500/10 border border-cyan-500/30 px-2 py-0.5 text-[10px] font-medium text-cyan-600 dark:text-cyan-400 shrink-0">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-cyan-400" />
              </span>
              Live
            </span>
          )}

          {issue.projectId ? (
            <Link
              to={`/projects/${issue.projectId}`}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors rounded px-1 -mx-1 py-0.5 min-w-0"
            >
              <Hexagon className="h-3 w-3 shrink-0" />
              <span className="truncate">{(projects ?? []).find((p) => p.id === issue.projectId)?.name ?? issue.projectId.slice(0, 8)}</span>
            </Link>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground opacity-50 px-1 -mx-1 py-0.5">
              <Hexagon className="h-3 w-3 shrink-0" />
              No project
            </span>
          )}

          {(issue.labels ?? []).length > 0 && (
            <div className="hidden sm:flex items-center gap-1">
              {(issue.labels ?? []).slice(0, 4).map((label) => (
                <span
                  key={label.id}
                  className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium"
                  style={{
                    borderColor: label.color,
                    color: label.color,
                    backgroundColor: `${label.color}1f`,
                  }}
                >
                  {label.name}
                </span>
              ))}
              {(issue.labels ?? []).length > 4 && (
                <span className="text-[10px] text-muted-foreground">+{(issue.labels ?? []).length - 4}</span>
              )}
            </div>
          )}

          <Button
            variant="ghost"
            size="icon-xs"
            className="ml-auto md:hidden shrink-0"
            onClick={() => setMobilePropsOpen(true)}
            title="Properties"
          >
            <SlidersHorizontal className="h-4 w-4" />
          </Button>

          <div className="hidden md:flex items-center md:ml-auto shrink-0">
            <Button
              variant="ghost"
              size="icon-xs"
              className={cn(
                "shrink-0 transition-opacity duration-200",
                panelVisible ? "opacity-0 pointer-events-none w-0 overflow-hidden" : "opacity-100",
              )}
              onClick={() => setPanelVisible(true)}
              title="Show properties"
            >
              <SlidersHorizontal className="h-4 w-4" />
            </Button>

            <Popover open={moreOpen} onOpenChange={setMoreOpen}>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon-xs" className="shrink-0">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
            <PopoverContent className="w-44 p-1" align="end">
              <button
                className="flex items-center gap-2 w-full px-2 py-1.5 text-xs rounded hover:bg-accent/50 text-destructive"
                onClick={() => {
                  updateIssue.mutate(
                    { hiddenAt: new Date().toISOString() },
                    { onSuccess: () => navigate("/issues/all") },
                  );
                  setMoreOpen(false);
                }}
              >
                <EyeOff className="h-3 w-3" />
                Hide this Issue
              </button>
            </PopoverContent>
            </Popover>
          </div>
        </div>

        <InlineEditor
          value={issue.title}
          onSave={(title) => updateIssue.mutate({ title })}
          as="h2"
          className="text-xl font-bold"
        />

        <InlineEditor
          value={issue.description ?? ""}
          onSave={(description) => updateIssue.mutate({ description })}
          as="p"
          className="text-sm text-muted-foreground"
          placeholder="Add a description..."
          multiline
          mentions={mentionOptions}
          imageUploadHandler={async (file) => {
            const attachment = await uploadAttachment.mutateAsync(file);
            return attachment.contentPath;
          }}
        />
      </div>

      {primaryLiveRun && (
        <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/5 px-4 py-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-1.5 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-cyan-700 dark:text-cyan-300">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-cyan-400" />
                </span>
                Execution Active
              </div>
              <div className="text-sm font-semibold text-foreground">
                {primaryLiveRun.agentName} is actively working on this issue
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {primaryLiveAdapterLabel && <span>Engine: {primaryLiveAdapterLabel}</span>}
                {primaryLiveTrigger && <span>Trigger: {primaryLiveTrigger}</span>}
                {primaryLiveRunStartedAt && <span>Started {relativeTime(primaryLiveRunStartedAt)}</span>}
                <span>Run {primaryLiveRun.id.slice(0, 8)}</span>
                {liveRunCount > 1 && <span>{liveRunCount} live runs attached</span>}
              </div>
            </div>
            <div className="max-w-sm text-xs leading-5 text-muted-foreground">
              This issue already triggered a real Claude Code or Codex run through the API workflow.
              Follow the live log below to inspect progress and runtime events.
            </div>
          </div>
          <div className="mt-3">
            <LiveRunWidget issueId={issueId!} companyId={issue.companyId} />
          </div>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-lg border border-border bg-card px-4 py-3">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <Workflow className="h-3.5 w-3.5" />
            Workflow
          </div>
          <div className="mt-2 text-sm font-semibold text-foreground">
            {formatProtocolValue(protocolState?.workflowState ?? issue.status)}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            Coarse status: {formatProtocolValue(protocolState?.coarseIssueStatus ?? issue.status)}
          </div>
          {protocolState?.blockedCode && (
            <div className="mt-2 inline-flex rounded-full border border-amber-400 px-2 py-0.5 text-[11px] text-amber-700">
              {formatProtocolValue(protocolState.blockedCode)}
            </div>
          )}
        </div>
        <div className="rounded-lg border border-border bg-card px-4 py-3">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <ClipboardCheck className="h-3.5 w-3.5" />
            Ownership
          </div>
          <div className="mt-2 space-y-2 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <span className="w-16 shrink-0">Lead</span>
              {protocolState?.techLeadAgentId && agentMap.get(protocolState.techLeadAgentId)
                ? <Identity name={agentMap.get(protocolState.techLeadAgentId)?.name ?? protocolState.techLeadAgentId.slice(0, 8)} size="sm" />
                : <span>Unassigned</span>}
            </div>
            <div className="flex items-center gap-2">
              <span className="w-16 shrink-0">Engineer</span>
              {protocolState?.primaryEngineerAgentId && agentMap.get(protocolState.primaryEngineerAgentId)
                ? <Identity name={agentMap.get(protocolState.primaryEngineerAgentId)?.name ?? protocolState.primaryEngineerAgentId.slice(0, 8)} size="sm" />
                : <span>Unassigned</span>}
            </div>
            <div className="flex items-center gap-2">
              <span className="w-16 shrink-0">Reviewer</span>
              {protocolState?.reviewerAgentId && agentMap.get(protocolState.reviewerAgentId)
                ? <Identity name={agentMap.get(protocolState.reviewerAgentId)?.name ?? protocolState.reviewerAgentId.slice(0, 8)} size="sm" />
                : <span>Unassigned</span>}
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card px-4 py-3">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <ShieldAlert className="h-3.5 w-3.5" />
            Readiness
          </div>
          <div className="mt-2 space-y-2 text-xs text-muted-foreground">
            <div>Review cycle: {protocolState?.currentReviewCycle ?? 0}</div>
            <div>Open violations: {openViolations.length}</div>
            <div>Timeout escalations: {openTimeoutAlertCount}</div>
            <div>Integrity alerts: {integrityIssueCount}</div>
            <div>Briefs ready: {latestBriefs.length}</div>
            <div>Messages: {protocolMessages.length}</div>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium text-muted-foreground">Attachments</h3>
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={handleFilePicked}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadAttachment.isPending}
            >
              <AttachmentIcon className="h-3.5 w-3.5 mr-1.5" />
              {uploadAttachment.isPending ? "Uploading..." : "Upload image"}
            </Button>
          </div>
        </div>

        {attachmentError && (
          <p className="text-xs text-destructive">{attachmentError}</p>
        )}

        {(!attachments || attachments.length === 0) ? (
          <p className="text-xs text-muted-foreground">No attachments yet.</p>
        ) : (
          <div className="space-y-2">
            {attachments.map((attachment) => (
              <div key={attachment.id} className="border border-border rounded-md p-2">
                <div className="flex items-center justify-between gap-2">
                  <a
                    href={attachment.contentPath}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs hover:underline truncate"
                    title={attachment.originalFilename ?? attachment.id}
                  >
                    {attachment.originalFilename ?? attachment.id}
                  </a>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => deleteAttachment.mutate(attachment.id)}
                    disabled={deleteAttachment.isPending}
                    title="Delete attachment"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {attachment.contentType} · {(attachment.byteSize / 1024).toFixed(1)} KB
                </p>
                {isImageAttachment(attachment) && (
                  <a href={attachment.contentPath} target="_blank" rel="noreferrer">
                    <img
                      src={attachment.contentPath}
                      alt={attachment.originalFilename ?? "attachment"}
                      className="mt-2 max-h-56 rounded border border-border object-contain bg-accent/10"
                      loading="lazy"
                    />
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <Separator />

      <Tabs value={detailTab} onValueChange={setDetailTab} className="space-y-3">
        <TabsList variant="line" className="w-full justify-start gap-1">
          <TabsTrigger value="brief" className="gap-1.5">
            <Lightbulb className="h-3.5 w-3.5" />
            Brief
          </TabsTrigger>
          <TabsTrigger value="protocol" className="gap-1.5">
            <Workflow className="h-3.5 w-3.5" />
            Protocol
          </TabsTrigger>
          <TabsTrigger value="comments" className="gap-1.5">
            <MessageSquare className="h-3.5 w-3.5" />
            Comments
          </TabsTrigger>
          <TabsTrigger value="subissues" className="gap-1.5">
            <ListTree className="h-3.5 w-3.5" />
            Sub-issues
          </TabsTrigger>
          <TabsTrigger value="activity" className="gap-1.5">
            <ActivityIcon className="h-3.5 w-3.5" />
            Activity
          </TabsTrigger>
        </TabsList>

        <TabsContent value="brief">
          <div className="py-12 text-center text-sm text-muted-foreground">
            Brief panel - Coming soon. Will display task briefs from protocol state.
          </div>
        </TabsContent>

        <TabsContent value="protocol">
          <div className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
              <div className="space-y-4">
                <ProtocolActionConsole
                  issueIdentifier={issue.identifier ?? issue.id.slice(0, 8)}
                  protocolState={protocolState ?? null}
                  agents={agents ?? []}
                  currentUserId={currentUserId}
                  onSubmit={async (message) => {
                    await createProtocolMessage.mutateAsync(message);
                  }}
                  isSubmitting={createProtocolMessage.isPending}
                />

                <section className="rounded-lg border border-border bg-card px-4 py-4">
                  <div className="flex items-center gap-2">
                    <BookText className="h-4 w-4 text-muted-foreground" />
                    <h3 className="text-sm font-semibold text-foreground">Task Briefs</h3>
                  </div>
                  {latestBriefs.length === 0 ? (
                    <p className="mt-3 text-sm text-muted-foreground">
                      No role-scoped briefs yet. Retrieval will populate this once protocol handoffs start.
                    </p>
                  ) : (
                    <div className="mt-3 space-y-3">
                      {latestBriefs.map((brief) => {
                        const quality = readBriefQuality(brief);
                        return (
                          <div key={brief.id} className="rounded-md border border-border/80 bg-background/70 px-3 py-3">
                            <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                              <span className="rounded-full border border-border px-2 py-0.5">
                                {formatProtocolValue(brief.briefScope)}
                              </span>
                              <span>v{brief.briefVersion}</span>
                              <span>{formatProtocolValue(brief.workflowState)}</span>
                              {brief.retrievalRunId && <span className="font-mono">{brief.retrievalRunId.slice(0, 8)}</span>}
                              <span className="ml-auto">{relativeTime(brief.createdAt)}</span>
                            </div>
                            {quality && (
                              <div className="mt-3 flex flex-wrap items-center gap-2">
                                <Badge variant="outline" className={briefQualityBadgeClass(quality.confidenceLevel)}>
                                  {quality.confidenceLevel} confidence
                                </Badge>
                                <Badge variant="outline">{quality.evidenceCount} evidence</Badge>
                                <Badge variant="outline">
                                  {quality.denseEnabled ? "semantic ready" : "semantic off"}
                                </Badge>
                              </div>
                            )}
                            {quality && quality.degradedReasons.length > 0 && (
                              <p className="mt-2 text-xs text-amber-700">
                                Limited context: {quality.degradedReasons.map(formatBriefQualityReason).join(", ")}
                              </p>
                            )}
                            <pre className="mt-3 whitespace-pre-wrap text-sm text-foreground">
                              {brief.contentMarkdown.split(/\r?\n/).slice(0, 12).join("\n")}
                            </pre>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>

                <section className="rounded-lg border border-border bg-card px-4 py-4">
                  <div className="flex items-center gap-2">
                    <Workflow className="h-4 w-4 text-muted-foreground" />
                    <h3 className="text-sm font-semibold text-foreground">Protocol Timeline</h3>
                  </div>
                  {protocolTimeline.length === 0 ? (
                    <p className="mt-3 text-sm text-muted-foreground">
                      This issue has not entered the structured workflow yet.
                    </p>
                  ) : (
                    <div className="mt-3 space-y-3">
                      {protocolTimeline.map((message) => {
                        const evidence = collectProtocolEvidence(message);
                        const reviewHandoff = readProtocolReviewHandoff(message);
                        return (
                          <div key={message.id} className="rounded-md border border-border/80 bg-background/70 px-3 py-3">
                            <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                              <span className="rounded-full border border-border px-2 py-0.5">
                                {formatProtocolValue(message.messageType)}
                              </span>
                              {message.integrityStatus && (
                                <span
                                  className={cn(
                                    "rounded-full border px-2 py-0.5",
                                    message.integrityStatus === "verified"
                                      ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                                      : message.integrityStatus === "legacy_unsealed"
                                        ? "border-amber-300 bg-amber-50 text-amber-700"
                                        : "border-red-300 bg-red-50 text-red-700",
                                  )}
                                >
                                  {formatProtocolValue(message.integrityStatus)}
                                </span>
                              )}
                              <span>{formatProtocolValue(message.sender.role)}</span>
                              <span>
                                {`${formatProtocolValue(message.workflowStateBefore)} -> ${formatProtocolValue(message.workflowStateAfter)}`}
                              </span>
                              <span className="ml-auto">{relativeTime(message.createdAt)}</span>
                            </div>
                            <p className="mt-2 text-sm font-medium text-foreground">{message.summary}</p>
                            {message.recipients.length > 0 && (
                              <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                                {message.recipients.map((recipient) => (
                                  <span key={`${message.id}:${recipient.recipientId}:${recipient.role}`} className="rounded-full border border-border px-2 py-0.5">
                                    {formatProtocolValue(recipient.role)}
                                  </span>
                                ))}
                              </div>
                            )}
                            {evidence.length > 0 && (
                              <div className="mt-3">
                                <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                  Evidence
                                </div>
                                <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                                  {evidence.map((item) => (
                                    <li key={`${message.id}:${item}`} className="flex gap-2">
                                      <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-foreground/40" />
                                      <span>{item}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {reviewHandoff && (
                              <div className="mt-3 grid gap-3 md:grid-cols-2">
                                {reviewHandoff.implementationSummary && (
                                  <div className="rounded-md border border-border/70 bg-card px-3 py-3 md:col-span-2">
                                    <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                      Implementation Summary
                                    </div>
                                    <p className="mt-2 text-sm text-foreground">{reviewHandoff.implementationSummary}</p>
                                  </div>
                                )}
                                {reviewHandoff.diffSummary && (
                                  <div className="rounded-md border border-border/70 bg-card px-3 py-3 md:col-span-2">
                                    <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                      Diff Summary
                                    </div>
                                    <p className="mt-2 text-sm text-foreground">{reviewHandoff.diffSummary}</p>
                                  </div>
                                )}
                                {[
                                  ["Changed Files", reviewHandoff.changedFiles],
                                  ["Test Results", reviewHandoff.testResults],
                                  ["Review Checklist", reviewHandoff.reviewChecklist],
                                  ["Residual Risks", reviewHandoff.residualRisks],
                                ].map(([title, items]) =>
                                  Array.isArray(items) && items.length > 0 ? (
                                    <div key={`${message.id}:${title}`} className="rounded-md border border-border/70 bg-card px-3 py-3">
                                      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                        {title}
                                      </div>
                                      <ul className="mt-2 space-y-1 text-sm text-foreground">
                                        {items.map((item) => (
                                          <li key={`${message.id}:${title}:${item}`} className="flex gap-2">
                                            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-foreground/40" />
                                            <span>{item}</span>
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                  ) : null
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              </div>

              <div className="space-y-4">
                <section className="rounded-lg border border-border bg-card px-4 py-4">
                  <div className="flex items-center gap-2">
                    <ClipboardCheck className="h-4 w-4 text-muted-foreground" />
                    <h3 className="text-sm font-semibold text-foreground">Review Cycles</h3>
                  </div>
                  {reviewCycles.length === 0 ? (
                    <p className="mt-3 text-sm text-muted-foreground">No review cycles yet.</p>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {reviewCycles.slice(0, 6).map((cycle) => (
                        <div key={cycle.id} className="rounded-md border border-border/80 bg-background/70 px-3 py-3 text-sm">
                          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                            <span className="rounded-full border border-border px-2 py-0.5">Cycle {cycle.cycleNumber}</span>
                            <span>{cycle.outcome ? formatProtocolValue(cycle.outcome) : "Open"}</span>
                            <span className="ml-auto">{relativeTime(cycle.openedAt)}</span>
                          </div>
                          <div className="mt-2 text-xs text-muted-foreground">
                            Reviewer {cycle.reviewerAgentId ? cycle.reviewerAgentId.slice(0, 8) : cycle.reviewerUserId ? "board" : "unassigned"}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                <section className="rounded-lg border border-border bg-card px-4 py-4">
                  <div className="flex items-center gap-2">
                    <TriangleAlert className="h-4 w-4 text-muted-foreground" />
                    <h3 className="text-sm font-semibold text-foreground">Escalations &amp; Recovery</h3>
                  </div>
                  {protocolRecoveryAlerts.length === 0 ? (
                    <p className="mt-3 text-sm text-muted-foreground">No timeout escalations or recovery guidance yet.</p>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {protocolRecoveryAlerts.map((alert) => (
                        <div key={alert.id} className="rounded-md border border-border/80 bg-background/70 px-3 py-3 text-sm">
                          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                            <span
                              className={cn(
                                "rounded-full border px-2 py-0.5",
                                alert.severity === "critical" || alert.severity === "high"
                                  ? "border-red-400 text-red-700"
                                  : alert.severity === "medium"
                                    ? "border-amber-400 text-amber-700"
                                    : "border-border",
                              )}
                            >
                              {formatProtocolValue(alert.statusLabel)}
                            </span>
                            <span>{formatProtocolValue(alert.kind)}</span>
                            <span>{formatProtocolValue(alert.severity)}</span>
                            <span className="ml-auto">{relativeTime(alert.createdAt)}</span>
                          </div>
                          <p className="mt-2 text-sm font-medium text-foreground">{alert.title}</p>
                          <p className="mt-1 text-sm text-muted-foreground">{alert.detail}</p>
                          <div className="mt-3 rounded-md border border-border/60 bg-muted/20 px-3 py-2">
                            <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                              Recommended next action
                            </div>
                            <p className="mt-1 text-sm text-foreground">{alert.recommendation}</p>
                          </div>
                          {alert.metadata.length > 0 && (
                            <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                              {alert.metadata.map((entry) => (
                                <li key={`${alert.id}:${entry}`} className="flex gap-2">
                                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-foreground/40" />
                                  <span>{entry}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                <section className="rounded-lg border border-border bg-card px-4 py-4">
                  <div className="flex items-center gap-2">
                    <TriangleAlert className="h-4 w-4 text-muted-foreground" />
                    <h3 className="text-sm font-semibold text-foreground">Protocol Violations</h3>
                  </div>
                  {protocolViolations.length === 0 ? (
                    <p className="mt-3 text-sm text-muted-foreground">No protocol violations recorded.</p>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {protocolViolations.slice(0, 8).map((violation) => (
                        <div key={violation.id} className="rounded-md border border-border/80 bg-background/70 px-3 py-3 text-sm">
                          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                            <span className={cn(
                              "rounded-full border px-2 py-0.5",
                              violation.status === "open" ? "border-red-400 text-red-700" : "border-border",
                            )}>
                              {formatProtocolValue(violation.status)}
                            </span>
                            <span>{formatProtocolValue(violation.severity)}</span>
                            <span className="ml-auto">{relativeTime(violation.createdAt)}</span>
                          </div>
                          <p className="mt-2 text-sm font-medium text-foreground">
                            {formatProtocolValue(violation.violationCode)}
                          </p>
                          {Object.keys(violation.details ?? {}).length > 0 && (
                            <pre className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">
                              {JSON.stringify(violation.details, null, 2)}
                            </pre>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                {latestReviewCycle && (
                  <section className="rounded-lg border border-border bg-card px-4 py-4">
                    <div className="flex items-center gap-2">
                      <ShieldAlert className="h-4 w-4 text-muted-foreground" />
                      <h3 className="text-sm font-semibold text-foreground">Current Review Snapshot</h3>
                    </div>
                    <div className="mt-3 space-y-2 text-sm text-muted-foreground">
                      <div>Latest cycle: {latestReviewCycle.cycleNumber}</div>
                      <div>Outcome: {latestReviewCycle.outcome ? formatProtocolValue(latestReviewCycle.outcome) : "Open"}</div>
                      <div>Submitted message: {latestReviewCycle.submittedMessageId.slice(0, 8)}</div>
                    </div>
                  </section>
                )}
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="comments">
          <CommentThread
            comments={commentsWithRunMeta}
            linkedRuns={timelineRuns}
            issueStatus={issue.status}
            agentMap={agentMap}
            draftKey={`squadrail:issue-comment-draft:${issue.id}`}
            enableReassign
            reassignOptions={commentReassignOptions}
            currentAssigneeValue={currentAssigneeValue}
            mentions={mentionOptions}
            onAdd={async (body, reopen, reassignment) => {
              if (reassignment) {
                await addCommentAndReassign.mutateAsync({ body, reopen, reassignment });
                return;
              }
              await addComment.mutateAsync({ body, reopen });
            }}
            imageUploadHandler={async (file) => {
              const attachment = await uploadAttachment.mutateAsync(file);
              return attachment.contentPath;
            }}
            onAttachImage={async (file) => {
              await uploadAttachment.mutateAsync(file);
            }}
          />
        </TabsContent>

        <TabsContent value="subissues">
          {childIssues.length === 0 ? (
            <p className="text-xs text-muted-foreground">No sub-issues.</p>
          ) : (
            <div className="space-y-3">
              {issue.internalWorkItemSummary && issue.internalWorkItemSummary.total > 0 && (
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground">
                    <div className="font-medium text-foreground">Open</div>
                    <div>
                      {issue.internalWorkItemSummary.todo + issue.internalWorkItemSummary.inProgress + issue.internalWorkItemSummary.inReview + issue.internalWorkItemSummary.blocked}
                      {" / "}
                      {issue.internalWorkItemSummary.total}
                    </div>
                  </div>
                  <div className="rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground">
                    <div className="font-medium text-foreground">Blocked</div>
                    <div>{issue.internalWorkItemSummary.blocked}</div>
                  </div>
                  <div className="rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground">
                    <div className="font-medium text-foreground">In Review</div>
                    <div>{issue.internalWorkItemSummary.inReview}</div>
                  </div>
                  <div className="rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground">
                    <div className="font-medium text-foreground">Done</div>
                    <div>{issue.internalWorkItemSummary.done}</div>
                  </div>
                </div>
              )}
              <div className="border border-border rounded-lg divide-y divide-border">
                {childIssues.map((child) => (
                  <Link
                    key={child.id}
                    to={`/issues/${child.identifier ?? child.id}`}
                    className="flex items-center justify-between px-3 py-2 text-sm hover:bg-accent/20 transition-colors"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <StatusIcon status={child.status} />
                      <PriorityIcon priority={child.priority} />
                      <span className="font-mono text-muted-foreground shrink-0">
                        {child.identifier ?? child.id.slice(0, 8)}
                      </span>
                      <span className="truncate">{child.title}</span>
                      {child.hiddenAt && (
                        <span className="rounded-full border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                          Internal
                        </span>
                      )}
                    </div>
                    {child.assigneeAgentId && (() => {
                      const name = agentMap.get(child.assigneeAgentId)?.name;
                      return name
                        ? <Identity name={name} size="sm" />
                        : <span className="text-muted-foreground font-mono">{child.assigneeAgentId.slice(0, 8)}</span>;
                    })()}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="activity">
          {!activity || activity.length === 0 ? (
            <p className="text-xs text-muted-foreground">No activity yet.</p>
          ) : (
            <div className="space-y-1.5">
              {activity.slice(0, 20).map((evt) => (
                <div key={evt.id} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <ActorIdentity evt={evt} agentMap={agentMap} />
                  <span>{formatAction(evt.action, evt.details)}</span>
                  <span className="ml-auto shrink-0">{relativeTime(evt.createdAt)}</span>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {linkedApprovals && linkedApprovals.length > 0 && (
        <Collapsible
          open={secondaryOpen.approvals}
          onOpenChange={(open) => setSecondaryOpen((prev) => ({ ...prev, approvals: open }))}
          className="rounded-lg border border-border"
        >
          <CollapsibleTrigger className="flex w-full items-center justify-between px-3 py-2 text-left">
            <span className="text-sm font-medium text-muted-foreground">
              Linked Approvals ({linkedApprovals.length})
            </span>
            <ChevronDown
              className={cn("h-4 w-4 text-muted-foreground transition-transform", secondaryOpen.approvals && "rotate-180")}
            />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="border-t border-border divide-y divide-border">
              {linkedApprovals.map((approval) => (
                <Link
                  key={approval.id}
                  to={`/approvals/${approval.id}`}
                  className="flex items-center justify-between px-3 py-2 text-xs hover:bg-accent/20 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <StatusBadge status={approval.status} />
                    <span className="font-medium">
                      {approval.type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                    </span>
                    <span className="font-mono text-muted-foreground">{approval.id.slice(0, 8)}</span>
                  </div>
                  <span className="text-muted-foreground">{relativeTime(approval.createdAt)}</span>
                </Link>
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      {linkedRuns && linkedRuns.length > 0 && (
        <Collapsible
          open={secondaryOpen.cost}
          onOpenChange={(open) => setSecondaryOpen((prev) => ({ ...prev, cost: open }))}
          className="rounded-lg border border-border"
        >
          <CollapsibleTrigger className="flex w-full items-center justify-between px-3 py-2 text-left">
            <span className="text-sm font-medium text-muted-foreground">Cost Summary</span>
            <ChevronDown
              className={cn("h-4 w-4 text-muted-foreground transition-transform", secondaryOpen.cost && "rotate-180")}
            />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="border-t border-border px-3 py-2">
              {!issueCostSummary.hasCost && !issueCostSummary.hasTokens ? (
                <div className="text-xs text-muted-foreground">No cost data yet.</div>
              ) : (
                <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                  {issueCostSummary.hasCost && (
                    <span className="font-medium text-foreground">
                      ${issueCostSummary.cost.toFixed(4)}
                    </span>
                  )}
                  {issueCostSummary.hasTokens && (
                    <span>
                      Tokens {formatTokens(issueCostSummary.totalTokens)}
                      {issueCostSummary.cached > 0
                        ? ` (in ${formatTokens(issueCostSummary.input)}, out ${formatTokens(issueCostSummary.output)}, cached ${formatTokens(issueCostSummary.cached)})`
                        : ` (in ${formatTokens(issueCostSummary.input)}, out ${formatTokens(issueCostSummary.output)})`}
                    </span>
                  )}
                </div>
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Mobile properties drawer */}
      <Sheet open={mobilePropsOpen} onOpenChange={setMobilePropsOpen}>
        <SheetContent side="bottom" className="max-h-[85dvh] pb-[env(safe-area-inset-bottom)]">
          <SheetHeader>
            <SheetTitle className="text-sm">Properties</SheetTitle>
          </SheetHeader>
          <ScrollArea className="flex-1 overflow-y-auto">
            <div className="px-4 pb-4">
              <IssueProperties issue={issue} onUpdate={(data) => updateIssue.mutate(data)} inline />
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>
    </div>
  );
}
