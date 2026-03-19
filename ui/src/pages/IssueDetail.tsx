import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useParams, Link, useNavigate, useLocation, useSearchParams } from "@/lib/router";
import {
  useQuery,
  useQueries,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { issuesApi } from "../api/issues";
import { activityApi } from "../api/activity";
import { heartbeatsApi } from "../api/heartbeats";
import { agentsApi } from "../api/agents";
import { authApi } from "../api/auth";
import { companiesApi } from "../api/companies";
import { knowledgeApi } from "../api/knowledge";
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
import {
  ProtocolActionConsole,
  type PendingClarificationRequest,
} from "../components/ProtocolActionConsole";
import type { MentionOption } from "../components/MarkdownEditor.types";
import { StatusIcon } from "../components/StatusIcon";
import { PriorityIcon } from "../components/PriorityIcon";
import { StatusBadge } from "../components/StatusBadge";
import { Identity } from "../components/Identity";
import { InternalWorkItemDialog } from "../components/InternalWorkItemDialog";
import { PmIntakeProjectionDialog } from "../components/PmIntakeProjectionDialog";
import { Separator } from "@/components/ui/separator";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BriefPanelV2 } from "../components/BriefPanelV2";
import { ChangeReviewDesk } from "../components/ChangeReviewDesk";
import { StatusBadgeV2 } from "../components/StatusBadgeV2";
import {
  type DeliveryPartySlot,
  type DeliveryPartySlotKey,
  type DeliveryPartySlotTone,
} from "../components/DeliveryPartyStrip";
import {
  Activity as ActivityIcon,
  BookText,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  GitBranch,
  GitCommitHorizontal,
  Hexagon,
  ListTree,
  MessageSquare,
  MoreHorizontal,
  FileText as AttachmentIcon,
  ShieldAlert,
  SlidersHorizontal,
  TestTube2,
  Trash2,
  TriangleAlert,
  Workflow,
  XCircle,
  Lightbulb,
  Package,
  Pin,
  PinOff,
  ScrollText,
  ShieldCheck,
  Terminal,
  ExternalLink,
  FilePenLine,
  Plus,
  Save,
  History,
  ChevronLeft,
} from "lucide-react";
import type {
  ActivityEvent,
  Agent,
  DashboardBriefSnapshot,
  IssueChangeSurface,
  IssueDeliverable,
  IssueDocumentSummary,
  IssueAttachment,
  IssueProgressSnapshot,
  IssueProgressPhase,
  IssueProtocolMessage,
  IssueProtocolState,
  IssueProtocolViolation,
  IssueReviewCycle,
  IssueRuntimeSummary,
  IssueTaskBrief,
  OnboardingMetadata,
} from "@squadrail/shared";
import { ISSUE_DOCUMENT_KEYS } from "@squadrail/shared";
import {
  deriveLatestHumanClarificationResolution,
  derivePendingHumanClarifications,
} from "@squadrail/shared";
import { appRoutes } from "../lib/appRoutes";
import {
  buildIssueProgressSignals,
  type IssueProgressSignalTone,
} from "../lib/issue-progress-signals";

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
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return null;
  return value as Record<string, unknown>;
}

type BriefQualitySnapshot = {
  confidenceLevel: "high" | "medium" | "low";
  evidenceCount: number;
  denseEnabled: boolean;
  degradedReasons: string[];
};

type DependencyGraphSnapshotItem = {
  reference: string;
  issueId: string | null;
  identifier: string | null;
  title: string | null;
  status: string | null;
  workflowState: string | null;
  resolved: boolean;
};

type ResolvedClarificationView = {
  question: string;
  answer: string;
  nextStep: string | null;
  askedByLabel: string;
  answeredByLabel: string;
  answeredAt: Date;
  resumeWorkflowState: string | null;
};

function readDependencyGraphSnapshot(
  protocolState: IssueProtocolState | null | undefined
) {
  const metadata = asRecord(protocolState?.metadata);
  const dependencyGraph = asRecord(metadata?.dependencyGraph);
  if (!dependencyGraph) return [];
  const items = Array.isArray(dependencyGraph.items)
    ? dependencyGraph.items
        .map((value) => asRecord(value))
        .filter((value): value is Record<string, unknown> => value !== null)
        .flatMap((value) => {
          const reference =
            typeof value.reference === "string" ? value.reference : "";
          if (!reference) return [];
          return [
            {
              reference,
              issueId: typeof value.issueId === "string" ? value.issueId : null,
              identifier:
                typeof value.identifier === "string" ? value.identifier : null,
              title: typeof value.title === "string" ? value.title : null,
              status: typeof value.status === "string" ? value.status : null,
              workflowState:
                typeof value.workflowState === "string"
                  ? value.workflowState
                  : null,
              resolved: value.resolved === true,
            } satisfies DependencyGraphSnapshotItem,
          ];
        })
    : [];
  return items;
}

function readBriefQuality(brief: IssueTaskBrief): BriefQualitySnapshot | null {
  const quality = asRecord(asRecord(brief.contentJson)?.quality);
  if (!quality) return null;
  const confidenceLevel = quality.confidenceLevel;
  if (
    confidenceLevel !== "high" &&
    confidenceLevel !== "medium" &&
    confidenceLevel !== "low"
  )
    return null;
  return {
    confidenceLevel,
    evidenceCount:
      typeof quality.evidenceCount === "number" ? quality.evidenceCount : 0,
    denseEnabled: quality.denseEnabled === true,
    degradedReasons: Array.isArray(quality.degradedReasons)
      ? quality.degradedReasons.filter(
          (reason): reason is string => typeof reason === "string"
        )
      : [],
  };
}

function briefQualityBadgeClass(
  confidenceLevel: BriefQualitySnapshot["confidenceLevel"]
) {
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

function resolveDeliveryPartyFocusKey(
  protocolState: IssueProtocolState | null | undefined,
  liveRunAgentId: string | null,
): DeliveryPartySlotKey | null {
  if (protocolState?.techLeadAgentId && liveRunAgentId === protocolState.techLeadAgentId) {
    return "lead";
  }
  if (protocolState?.primaryEngineerAgentId && liveRunAgentId === protocolState.primaryEngineerAgentId) {
    return "engineer";
  }
  if (protocolState?.reviewerAgentId && liveRunAgentId === protocolState.reviewerAgentId) {
    return "reviewer";
  }
  if (protocolState?.qaAgentId && liveRunAgentId === protocolState.qaAgentId) {
    return "qa";
  }

  switch (protocolState?.workflowState) {
    case "submitted_for_review":
    case "under_review":
      return "reviewer";
    case "qa_pending":
    case "under_qa_review":
      return "qa";
    case "approved":
    case "done":
      return "lead";
    case "cancelled":
      return null;
    default:
      return "engineer";
  }
}

function resolveBlockedDeliveryPartyKey(
  protocolState: IssueProtocolState | null | undefined,
): DeliveryPartySlotKey | null {
  switch (protocolState?.blockedPhase) {
    case "assignment":
    case "planning":
    case "closing":
      return "lead";
    case "implementing":
      return "engineer";
    case "review":
      return "reviewer";
    default:
      return null;
  }
}

function formatDeliveryPartyClarificationDetail(
  clarification: PendingClarificationRequest | null | undefined,
) {
  if (!clarification) return null;
  return `Clarification pending: ${truncate(clarification.question, 92)}`;
}

function describeDeliveryPartyDetail(args: {
  slotKey: DeliveryPartySlotKey;
  workflowState: string | null;
  blockedCode: string | null | undefined;
  blocked: boolean;
  isFocused: boolean;
  pendingClarification: PendingClarificationRequest | null;
}) {
  const { slotKey, workflowState, blockedCode, blocked, isFocused, pendingClarification } = args;
  const clarificationDetail = formatDeliveryPartyClarificationDetail(pendingClarification);

  if (blocked) {
    return clarificationDetail ?? `Blocked on ${formatProtocolValue(blockedCode)}.`;
  }

  if (isFocused) {
    switch (slotKey) {
      case "lead":
        if (workflowState === "submitted_for_review" || workflowState === "under_review") {
          return "Lead is holding the release line while review ownership clears the diff.";
        }
        if (workflowState === "qa_pending" || workflowState === "under_qa_review") {
          return "Lead is waiting on the QA gate before closing the issue.";
        }
        return "Lead is steering scope, handoffs, and final closeout.";
      case "engineer":
        return "Engineer owns the active implementation lane right now.";
      case "reviewer":
        return workflowState === "submitted_for_review"
          ? "Implementation handoff landed and is waiting for a review decision."
          : "Reviewer is checking code quality, design, and regression risk.";
      case "qa":
        return "QA is validating acceptance criteria and release readiness.";
    }
  }

  switch (slotKey) {
    case "lead":
      if (workflowState === "submitted_for_review" || workflowState === "under_review") {
        return "Waiting for reviewer approval before final close.";
      }
      if (workflowState === "qa_pending" || workflowState === "under_qa_review") {
        return "Waiting for QA sign-off before final close.";
      }
      return "Holding ownership while downstream lanes execute.";
    case "engineer":
      if (workflowState === "assigned" || workflowState === "accepted") {
        return "Waiting for implementation kickoff.";
      }
      if (workflowState === "submitted_for_review" || workflowState === "under_review") {
        return "Implementation is complete; waiting on reviewer feedback.";
      }
      if (workflowState === "qa_pending" || workflowState === "under_qa_review") {
        return "Implementation cleared review and is waiting on QA evidence.";
      }
      return "Queued until implementation becomes the active lane.";
    case "reviewer":
      if (
        workflowState === "assigned" ||
        workflowState === "accepted" ||
        workflowState === "implementing" ||
        workflowState === "changes_requested"
      ) {
        return "Waiting for implementation handoff before review begins.";
      }
      if (workflowState === "qa_pending" || workflowState === "under_qa_review") {
        return "Review lane already cleared and is waiting on QA.";
      }
      return "Waiting for the review lane to open.";
    case "qa":
      if (
        workflowState === "assigned" ||
        workflowState === "accepted" ||
        workflowState === "implementing"
      ) {
        return "Waiting for review handoff before the QA gate opens.";
      }
      if (workflowState === "submitted_for_review" || workflowState === "under_review") {
        return "Waiting for reviewer approval before QA starts.";
      }
      if (workflowState === "qa_pending") {
        return "QA gate is queued and ready to start.";
      }
      return "Waiting for QA evidence and release checks.";
  }
}

function describeDeliveryPartySignal(args: {
  slotKey: DeliveryPartySlotKey;
  workflowState: string | null;
  blocked: boolean;
  isFocused: boolean;
}) {
  const { slotKey, workflowState, blocked, isFocused } = args;
  if (blocked) return "Blocked here";
  if (isFocused) return "Holding baton";
  switch (slotKey) {
    case "lead":
      return workflowState === "done" || workflowState === "approved"
        ? "Closing lane"
        : "Routing next";
    case "engineer":
      return workflowState === "assigned" || workflowState === "accepted"
        ? "Next to implement"
        : "Waiting on handoff";
    case "reviewer":
      return workflowState === "submitted_for_review" || workflowState === "under_review"
        ? "Review lane open"
        : "Waiting on diff";
    case "qa":
      return workflowState === "qa_pending" || workflowState === "under_qa_review"
        ? "QA gate open"
        : "Waiting on review";
  }
}

function buildDeliveryPartySlots(args: {
  protocolState: IssueProtocolState | null | undefined;
  agentMap: Map<string, Agent>;
  liveRunAgentId: string | null;
  pendingClarification: PendingClarificationRequest | null;
}): DeliveryPartySlot[] {
  const { protocolState, agentMap, liveRunAgentId, pendingClarification } = args;
  const focusKey = resolveDeliveryPartyFocusKey(protocolState, liveRunAgentId);
  const blockedKey = resolveBlockedDeliveryPartyKey(protocolState);
  const workflowState = protocolState?.workflowState ?? null;
  const blocked = Boolean(protocolState?.blockedCode);
  const closed = workflowState === "approved" || workflowState === "done";

  const slotConfigs: Array<{
    key: DeliveryPartySlotKey;
    label: string;
    agentId: string | null;
    activeLabel: string;
    waitingLabel: string;
    missingLabel: string;
  }> = [
    {
      key: "lead",
      label: "Tech Lead",
      agentId: protocolState?.techLeadAgentId ?? null,
      activeLabel: closed ? "Closing" : "Coordinating",
      waitingLabel: "Watching",
      missingLabel: "No lead assigned",
    },
    {
      key: "engineer",
      label: "Engineer",
      agentId: protocolState?.primaryEngineerAgentId ?? null,
      activeLabel: blocked ? "Blocked" : "Implementing",
      waitingLabel: "Queued",
      missingLabel:
        workflowState === "changes_requested"
          ? "Reassign an engineer to resume implementation"
          : "No engineer assigned",
    },
    {
      key: "reviewer",
      label: "Reviewer",
      agentId: protocolState?.reviewerAgentId ?? null,
      activeLabel: "Reviewing",
      waitingLabel: "Waiting",
      missingLabel: "No reviewer assigned",
    },
    {
      key: "qa",
      label: "QA Gate",
      agentId: protocolState?.qaAgentId ?? null,
      activeLabel: blocked ? "Blocked" : "Verifying",
      waitingLabel: "Waiting",
      missingLabel: "No QA gate",
    },
  ];

  return slotConfigs.map((slot) => {
    const agent = slot.agentId ? agentMap.get(slot.agentId) ?? null : null;
    if (!agent) {
      return {
        key: slot.key,
        label: slot.label,
        agentId: slot.agentId,
        agent: null,
        statusLabel: slot.missingLabel,
        tone: "idle",
        helperText:
          slot.key === "qa"
            ? "This issue can still close through review if QA is not staffed."
            : "Assign this slot before expecting work to move through it.",
        signalLabel: "Unstaffed",
        detailText: null,
      } satisfies DeliveryPartySlot;
    }

    if (closed) {
      return {
        key: slot.key,
        label: slot.label,
        agentId: slot.agentId,
        agent,
        statusLabel: slot.key === "lead" ? "Closed" : "Complete",
        tone: "done",
        helperText:
          slot.key === "lead"
            ? "Lead owns the final closeout and release posture."
            : "This handoff already cleared its lane.",
        signalLabel: slot.key === "lead" ? "Closed" : "Cleared",
        detailText: null,
      } satisfies DeliveryPartySlot;
    }

    const isBlockedSlot = blocked && blockedKey === slot.key;
    const isFocusedSlot = focusKey === slot.key;

    if (isFocusedSlot || isBlockedSlot) {
      return {
        key: slot.key,
        label: slot.label,
        agentId: slot.agentId,
        agent,
        statusLabel: isBlockedSlot ? "Blocked" : slot.activeLabel,
        tone: isBlockedSlot ? "blocked" : "active",
        helperText:
          slot.key === "lead"
            ? "Lead is coordinating scope, review, or final closure."
            : slot.key === "engineer"
            ? "Engineer owns the active implementation loop."
            : slot.key === "reviewer"
            ? "Reviewer is responsible for code quality and diff acceptance."
            : "QA verifies acceptance criteria and release readiness.",
        signalLabel: describeDeliveryPartySignal({
          slotKey: slot.key,
          workflowState,
          blocked: isBlockedSlot,
          isFocused: true,
        }),
        detailText: describeDeliveryPartyDetail({
          slotKey: slot.key,
          workflowState,
          blockedCode: protocolState?.blockedCode,
          blocked: isBlockedSlot,
          isFocused: true,
          pendingClarification,
        }),
      } satisfies DeliveryPartySlot;
    }

    return {
      key: slot.key,
      label: slot.label,
      agentId: slot.agentId,
      agent,
      statusLabel: slot.waitingLabel,
      tone: "waiting",
        helperText:
          slot.key === "engineer"
          ? "Engineer is ready once implementation becomes the active lane."
          : slot.key === "reviewer"
          ? "Reviewer joins after implementation is submitted."
          : slot.key === "qa"
          ? "QA engages only when the issue crosses the QA gate."
          : "Lead keeps ownership while downstream lanes execute.",
      signalLabel: describeDeliveryPartySignal({
        slotKey: slot.key,
        workflowState,
        blocked: false,
        isFocused: false,
      }),
      detailText: describeDeliveryPartyDetail({
        slotKey: slot.key,
        workflowState,
        blockedCode: protocolState?.blockedCode,
        blocked: false,
        isFocused: false,
        pendingClarification,
      }),
    } satisfies DeliveryPartySlot;
  });
}

function collectProtocolEvidence(message: IssueProtocolMessage) {
  const payload = (message.payload ?? {}) as unknown as Record<string, unknown>;
  const evidence: string[] = [];
  const artifactLabels = (message.artifacts ?? [])
    .map((artifact) => artifact.label ?? artifact.uri)
    .filter(
      (value): value is string =>
        typeof value === "string" && value.trim().length > 0
    );

  for (const key of [
    "evidence",
    "reviewChecklist",
    "testResults",
    "residualRisks",
    "requiredEvidence",
    "approvalChecklist",
    "verifiedEvidence",
    "finalArtifacts",
    "followUpActions",
  ]) {
    const value = payload[key];
    if (!Array.isArray(value)) continue;
    for (const entry of value) {
      if (typeof entry === "string" && entry.trim().length > 0)
        evidence.push(entry.trim());
    }
  }

  return Array.from(new Set([...evidence, ...artifactLabels])).slice(0, 8);
}

function readProtocolStringArray(
  payload: Record<string, unknown>,
  key: string
) {
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

function derivePendingClarificationRequests(
  protocolMessages: IssueProtocolMessage[],
  agentMap: Map<string, Agent>,
): PendingClarificationRequest[] {
  return derivePendingHumanClarifications(
    protocolMessages.map((message) => ({
      id: message.id,
      messageType: message.messageType,
      causalMessageId: message.causalMessageId,
      ackedAt: message.ackedAt,
      createdAt: message.createdAt,
      payload: (message.payload ?? {}) as unknown as Record<string, unknown>,
      sender: message.sender,
    })),
  ).map((request) => {
    const senderAgent = request.askedByActorType === "agent"
      ? agentMap.get(request.askedByActorId) ?? null
      : null;
    return {
      questionMessageId: request.questionMessageId,
      questionType: request.questionType,
      question: request.question,
      blocking: request.blocking,
      askedByActorType: request.askedByActorType,
      askedByActorId: request.askedByActorId,
      askedByRole: request.askedByRole,
      askedByLabel: senderAgent?.name ?? formatProtocolValue(request.askedByRole),
      createdAt: request.createdAt,
      resumeWorkflowState: request.resumeWorkflowState,
    } satisfies PendingClarificationRequest;
  });
}

function deriveLatestClarificationResolutionView(
  protocolMessages: IssueProtocolMessage[],
  agentMap: Map<string, Agent>,
): ResolvedClarificationView | null {
  const resolution = deriveLatestHumanClarificationResolution(
    protocolMessages.map((message) => ({
      id: message.id,
      messageType: message.messageType,
      causalMessageId: message.causalMessageId,
      ackedAt: message.ackedAt,
      createdAt: message.createdAt,
      workflowStateAfter: message.workflowStateAfter,
      payload: (message.payload ?? {}) as unknown as Record<string, unknown>,
      sender: message.sender,
    })),
  );
  if (!resolution) return null;
  const askedByAgent = resolution.askedByActorType === "agent"
    ? agentMap.get(resolution.askedByActorId) ?? null
    : null;
  const answeredByAgent = resolution.answeredByActorType === "agent"
    ? agentMap.get(resolution.answeredByActorId) ?? null
    : null;
  return {
    question: resolution.question,
    answer: resolution.answer,
    nextStep: resolution.nextStep,
    askedByLabel: askedByAgent?.name ?? formatProtocolValue(resolution.askedByRole),
    answeredByLabel: answeredByAgent?.name ?? formatProtocolValue(resolution.answeredByRole),
    answeredAt: resolution.answeredAt,
    resumeWorkflowState: resolution.resumeWorkflowState,
  };
}

function deriveFeedbackTarget(hit: {
  path: string | null;
  symbolName: string | null;
  sourceType: string;
  chunkId: string;
}) {
  if (hit.path) {
    return {
      targetType: "path" as const,
      targetIds: [hit.path],
      label: hit.path,
    };
  }
  if (hit.symbolName) {
    return {
      targetType: "symbol" as const,
      targetIds: [hit.symbolName],
      label: hit.symbolName,
    };
  }
  return {
    targetType: "source_type" as const,
    targetIds: [hit.sourceType],
    label: hit.sourceType,
  };
}

type ProtocolReviewHandoffSnapshot = {
  implementationSummary: string | null;
  diffSummary: string | null;
  changedFiles: string[];
  testResults: string[];
  reviewChecklist: string[];
  residualRisks: string[];
};

function readProtocolReviewHandoff(
  message: IssueProtocolMessage
): ProtocolReviewHandoffSnapshot | null {
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

type ProtocolChangeRequestSnapshot = {
  reviewSummary: string | null;
  requiredEvidence: string[];
  changeRequests: Array<{
    title: string | null;
    reason: string | null;
    affectedFiles: string[];
    suggestedAction: string | null;
  }>;
};

function readProtocolChangeRequest(
  message: IssueProtocolMessage
): ProtocolChangeRequestSnapshot | null {
  if (message.messageType !== "REQUEST_CHANGES") return null;
  const payload = asRecord(message.payload) ?? {};
  const rawRequests = Array.isArray(payload.changeRequests)
    ? payload.changeRequests
    : [];
  return {
    reviewSummary: readProtocolString(payload, "reviewSummary"),
    requiredEvidence: readProtocolStringArray(payload, "requiredEvidence"),
    changeRequests: rawRequests
      .filter(
        (entry): entry is Record<string, unknown> =>
          Boolean(entry) && typeof entry === "object"
      )
      .map((entry) => ({
        title: readProtocolString(entry, "title"),
        reason: readProtocolString(entry, "reason"),
        affectedFiles: readProtocolStringArray(entry, "affectedFiles"),
        suggestedAction: readProtocolString(entry, "suggestedAction"),
      })),
  };
}

type ProtocolApprovalSnapshot = {
  approvalSummary: string | null;
  approvalChecklist: string[];
  verifiedEvidence: string[];
  residualRisks: string[];
  followUpActions: string[];
};

function readProtocolApproval(
  message: IssueProtocolMessage
): ProtocolApprovalSnapshot | null {
  if (message.messageType !== "APPROVE_IMPLEMENTATION") return null;
  const payload = asRecord(message.payload) ?? {};
  return {
    approvalSummary: readProtocolString(payload, "approvalSummary"),
    approvalChecklist: readProtocolStringArray(payload, "approvalChecklist"),
    verifiedEvidence: readProtocolStringArray(payload, "verifiedEvidence"),
    residualRisks: readProtocolStringArray(payload, "residualRisks"),
    followUpActions: readProtocolStringArray(payload, "followUpActions"),
  };
}

type ProtocolCloseSnapshot = {
  closureSummary: string | null;
  verificationSummary: string | null;
  rollbackPlan: string | null;
  finalArtifacts: string[];
  remainingRisks: string[];
  mergeStatus: string | null;
};

function readProtocolClose(
  message: IssueProtocolMessage
): ProtocolCloseSnapshot | null {
  if (message.messageType !== "CLOSE_TASK") return null;
  const payload = asRecord(message.payload) ?? {};
  return {
    closureSummary: readProtocolString(payload, "closureSummary"),
    verificationSummary: readProtocolString(payload, "verificationSummary"),
    rollbackPlan: readProtocolString(payload, "rollbackPlan"),
    finalArtifacts: readProtocolStringArray(payload, "finalArtifacts"),
    remainingRisks: readProtocolStringArray(payload, "remainingRisks"),
    mergeStatus: readProtocolString(payload, "mergeStatus"),
  };
}

type ChangeWorkspaceSnapshot = {
  branchName: string | null;
  headSha: string | null;
  changedFiles: string[];
  diffStat: string | null;
  workspaceStatus: string | null;
};

function readChangeWorkspaceSnapshot(
  resultJson: Record<string, unknown> | null | undefined
): ChangeWorkspaceSnapshot | null {
  const root = asRecord(resultJson);
  const snapshot = asRecord(root?.workspaceGitSnapshot);
  if (!snapshot) return null;
  return {
    branchName: readProtocolString(snapshot, "branchName"),
    headSha: readProtocolString(snapshot, "headSha"),
    changedFiles: readProtocolStringArray(snapshot, "changedFiles"),
    diffStat: readProtocolString(snapshot, "diffStat"),
    workspaceStatus: readProtocolString(root ?? {}, "workspaceStatus"),
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
  protocolViolations: IssueProtocolViolation[]
): ProtocolRecoveryAlert[] {
  const timeoutAlerts = protocolMessages.flatMap((message) => {
    if (
      message.messageType !== "TIMEOUT_ESCALATION" &&
      message.messageType !== "SYSTEM_REMINDER"
    )
      return [];
    const payload = asRecord(message.payload) ?? {};
    const timeoutCode =
      typeof payload.timeoutCode === "string"
        ? payload.timeoutCode
        : typeof payload.reminderCode === "string"
        ? payload.reminderCode
        : "unknown_timeout";
    const metadata: string[] = [];
    if (typeof payload.expiredActorRole === "string") {
      metadata.push(
        `Expired role: ${formatProtocolValue(payload.expiredActorRole)}`
      );
    }
    if (typeof payload.nextEscalationTarget === "string") {
      metadata.push(
        `Escalates to: ${formatProtocolValue(payload.nextEscalationTarget)}`
      );
    }
    if (typeof payload.reminderMessage === "string") {
      metadata.push(payload.reminderMessage);
    }
    return [
      {
        id: message.id,
        kind: "timeout" as const,
        severity:
          message.messageType === "TIMEOUT_ESCALATION"
            ? ("high" as const)
            : ("medium" as const),
        title: formatProtocolValue(timeoutCode),
        detail: message.summary,
        recommendation: timeoutRecommendation(timeoutCode),
        statusLabel:
          message.messageType === "TIMEOUT_ESCALATION"
            ? "Escalated"
            : "Reminder",
        createdAt: new Date(message.createdAt),
        metadata,
      },
    ];
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
      metadata.push(
        `Message: ${formatProtocolValue(violation.details.messageType)}`
      );
    }
    return {
      id: violation.id,
      kind: "violation" as const,
      severity: violation.severity,
      title: formatProtocolValue(violation.violationCode),
      detail:
        violation.status === "open"
          ? "Protocol action was rejected and still needs correction."
          : "Historical protocol violation.",
      recommendation: violationRecommendation(violation.violationCode),
      statusLabel: formatProtocolValue(violation.status),
      createdAt: new Date(violation.createdAt),
      metadata,
    };
  });

  const integrityAlerts = protocolMessages.flatMap((message) => {
    if (!message.integrityStatus || message.integrityStatus === "verified")
      return [];
    const metadata: string[] = [];
    if (message.integritySignature)
      metadata.push(`Signature: ${message.integritySignature.slice(0, 12)}…`);
    if (message.payloadSha256)
      metadata.push(`Payload hash: ${message.payloadSha256.slice(0, 12)}…`);
    return [
      {
        id: `integrity:${message.id}`,
        kind: "violation" as const,
        severity:
          message.integrityStatus === "tampered"
            ? ("critical" as const)
            : ("medium" as const),
        title:
          message.integrityStatus === "legacy_unsealed"
            ? "Legacy unsealed protocol message"
            : "Protocol integrity check failed",
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
      },
    ];
  });

  return [...timeoutAlerts, ...violationAlerts, ...integrityAlerts]
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
    .slice(0, 10);
}

function formatAction(
  action: string,
  details?: Record<string, unknown> | null
): string {
  if (action === "issue.updated" && details) {
    const previous = (details._previous ?? {}) as Record<string, unknown>;
    const parts: string[] = [];

    if (details.status !== undefined) {
      const from = previous.status;
      parts.push(
        from
          ? `changed the status from ${humanizeValue(from)} to ${humanizeValue(
              details.status
            )}`
          : `changed the status to ${humanizeValue(details.status)}`
      );
    }
    if (details.priority !== undefined) {
      const from = previous.priority;
      parts.push(
        from
          ? `changed the priority from ${humanizeValue(
              from
            )} to ${humanizeValue(details.priority)}`
          : `changed the priority to ${humanizeValue(details.priority)}`
      );
    }
    if (
      details.assigneeAgentId !== undefined ||
      details.assigneeUserId !== undefined
    ) {
      parts.push(
        details.assigneeAgentId || details.assigneeUserId
          ? "assigned the issue"
          : "unassigned the issue"
      );
    }
    if (details.title !== undefined) parts.push("updated the title");
    if (details.description !== undefined)
      parts.push("updated the description");

    if (parts.length > 0) return parts.join(", ");
  }
  return ACTION_LABELS[action] ?? action.replace(/[._]/g, " ");
}

function ActorIdentity({
  evt,
  agentMap,
}: {
  evt: ActivityEvent;
  agentMap: Map<string, Agent>;
}) {
  const id = evt.actorId;
  if (evt.actorType === "agent") {
    const agent = agentMap.get(id);
    return <Identity name={agent?.name ?? id.slice(0, 8)} size="sm" />;
  }
  if (evt.actorType === "system") return <Identity name="System" size="sm" />;
  if (evt.actorType === "user") return <Identity name="Board" size="sm" />;
  return <Identity name={id || "Unknown"} size="sm" />;
}

/* ── Progress snapshot helpers ── */

const PHASE_BADGE_STYLES: Record<IssueProgressPhase, string> = {
  intake: "border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300",
  clarification: "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-600 dark:bg-amber-900 dark:text-amber-300",
  planning: "border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-600 dark:bg-blue-900 dark:text-blue-300",
  implementing: "border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-600 dark:bg-violet-900 dark:text-violet-300",
  review: "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-600 dark:bg-indigo-900 dark:text-indigo-300",
  qa: "border-teal-300 bg-teal-50 text-teal-700 dark:border-teal-600 dark:bg-teal-900 dark:text-teal-300",
  merge: "border-cyan-300 bg-cyan-50 text-cyan-700 dark:border-cyan-600 dark:bg-cyan-900 dark:text-cyan-300",
  blocked: "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-600 dark:bg-rose-900 dark:text-rose-300",
  done: "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-600 dark:bg-emerald-900 dark:text-emerald-300",
  cancelled: "border-gray-300 bg-gray-50 text-gray-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-400",
};

const PHASE_LABELS: Record<IssueProgressPhase, string> = {
  intake: "Intake",
  clarification: "Clarification",
  planning: "Planning",
  implementing: "Implementing",
  review: "Review",
  qa: "QA",
  merge: "Merge",
  blocked: "Blocked",
  done: "Done",
  cancelled: "Cancelled",
};

function ProgressPhaseBadge({ phase }: { phase: IssueProgressPhase }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide shrink-0",
        PHASE_BADGE_STYLES[phase] ?? PHASE_BADGE_STYLES.intake,
      )}
    >
      {PHASE_LABELS[phase] ?? phase}
    </span>
  );
}

function ProgressHeroStrip({
  snapshot,
  agentMap,
}: {
  snapshot: IssueProgressSnapshot;
  agentMap: Map<string, Agent>;
}) {
  const ownerAgent = snapshot.activeOwnerAgentId
    ? agentMap.get(snapshot.activeOwnerAgentId)
    : null;
  const signals = buildIssueProgressSignals(snapshot);
  const signalToneClass: Record<IssueProgressSignalTone, string> = {
    neutral: "border-border bg-background text-muted-foreground",
    info: "border-sky-300/70 bg-sky-500/10 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/15 dark:text-sky-200",
    warn: "border-amber-300/70 bg-amber-500/10 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-200",
    blocked: "border-rose-300/70 bg-rose-500/10 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/15 dark:text-rose-200",
    success: "border-emerald-300/70 bg-emerald-500/10 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-200",
  };

  return (
    <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <ProgressPhaseBadge phase={snapshot.phase} />
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{snapshot.headline}</span>
        {ownerAgent && (
          <span className="shrink-0">
            <Identity name={ownerAgent.name} size="sm" />
          </span>
        )}
        {snapshot.phase === "blocked" && snapshot.blockedReason && (
          <span className="shrink-0 flex items-center gap-1 text-rose-600 dark:text-rose-400 text-xs">
            <TriangleAlert className="h-3 w-3" />
            {snapshot.blockedReason.replace(/_/g, " ")}
          </span>
        )}
      </div>
      {signals.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {signals.map((signal) => (
            <span
              key={signal.key}
              className={cn(
                "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium",
                signalToneClass[signal.tone],
              )}
            >
              {signal.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function IssueDetail() {
  const { issueId } = useParams<{ issueId: string }>();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { selectedCompanyId } = useCompany();
  const { pushToast } = useToast();
  const { openPanel, closePanel, panelVisible, setPanelVisible } = usePanel();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const issueSection = location.pathname.includes("/changes/")
    ? "Changes"
    : "Work";
  const issueBasePath =
    issueSection === "Changes" ? appRoutes.changes : appRoutes.work;
  const [moreOpen, setMoreOpen] = useState(false);
  const [mobilePropsOpen, setMobilePropsOpen] = useState(false);
  const [detailTab, setDetailTab] = useState("brief");
  const [secondaryOpen, setSecondaryOpen] = useState({
    approvals: false,
    cost: false,
  });
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [internalWorkItemDialogOpen, setInternalWorkItemDialogOpen] =
    useState(false);
  const [intakeProjectionDialogOpen, setIntakeProjectionDialogOpen] =
    useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const preferredProtocolTab = searchParams.get("tab");
  const preferredProtocolAction = searchParams.get("action");
  const preferredClarificationId = searchParams.get("clarification");

  const {
    data: issue,
    isLoading,
    error,
  } = useQuery({
    queryKey: queryKeys.issues.detail(issueId!),
    queryFn: () => issuesApi.get(issueId!),
    enabled: !!issueId,
  });

  const commentsTabActive = detailTab === "comments";
  const subissuesTabActive = detailTab === "subissues";
  const documentsTabActive = detailTab === "documents";
  const activityTabActive = detailTab === "activity";
  const deliverablesTabActive = detailTab === "deliverables";

  const { data: comments } = useQuery({
    queryKey: queryKeys.issues.comments(issueId!),
    queryFn: () => issuesApi.listComments(issueId!),
    enabled: !!issueId && commentsTabActive,
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

  const { data: changeSurface } = useQuery({
    queryKey: queryKeys.issues.changeSurface(issueId!),
    queryFn: () => issuesApi.getChangeSurface(issueId!),
    enabled: !!issueId && issueSection === "Changes",
    refetchInterval: issueSection === "Changes" ? 5000 : false,
  });

  const { data: activity } = useQuery({
    queryKey: queryKeys.issues.activity(issueId!),
    queryFn: () => activityApi.forIssue(issueId!),
    enabled: !!issueId && activityTabActive,
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

  const { data: deliverables } = useQuery({
    queryKey: queryKeys.issues.deliverables(issueId!),
    queryFn: () => issuesApi.deliverables(issueId!, issue!.companyId),
    enabled: !!issueId && !!issue && deliverablesTabActive,
  });

  const { data: issueDocuments, refetch: refetchDocuments } = useQuery({
    queryKey: queryKeys.issues.documents(issueId!),
    queryFn: () => issuesApi.documents.list(issue!.companyId, issueId!),
    enabled: !!issueId && !!issue && documentsTabActive,
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
  const primaryLiveRunStartedAt =
    primaryLiveRun?.startedAt ?? primaryLiveRun?.createdAt ?? null;
  const primaryLiveAdapterLabel = primaryLiveRun?.adapterType
    ? formatProtocolValue(primaryLiveRun.adapterType)
    : null;
  const primaryLiveTrigger = primaryLiveRun?.triggerDetail
    ? primaryLiveRun.triggerDetail
    : primaryLiveRun?.invocationSource
    ? formatProtocolValue(primaryLiveRun.invocationSource)
    : null;

  // Group consecutive protocol-gate + implementation runs for the same engineer
  // into a single logical execution, then filter out live-widget duplicates.
  const timelineRuns = useMemo(() => {
    const raw = linkedRuns ?? [];
    const grouped: Array<(typeof raw)[number] & { mergedRunIds?: string[] }> = [];
    for (let i = 0; i < raw.length; i++) {
      const current = raw[i];
      const next = raw[i + 1];
      // Merge consecutive assignment→automation runs from the same agent
      if (
        next &&
        current.agentId === next.agentId &&
        current.invocationSource === "assignment" &&
        next.invocationSource === "automation" &&
        current.status !== "running"
      ) {
        grouped.push({
          ...current,
          finishedAt: next.finishedAt ?? current.finishedAt,
          usageJson: next.usageJson ?? current.usageJson,
          resultJson: next.resultJson ?? current.resultJson,
          mergedRunIds: [current.runId, next.runId],
        });
        i++; // skip the merged run
      } else {
        grouped.push(current);
      }
    }
    const liveIds = new Set<string>();
    for (const r of liveRuns ?? []) liveIds.add(r.id);
    if (activeRun) liveIds.add(activeRun.id);
    if (liveIds.size === 0) return grouped;
    return grouped.filter((r) => {
      if (liveIds.has(r.runId)) return false;
      // For merged runs, also check the secondary run ID
      if (r.mergedRunIds?.some((id) => liveIds.has(id))) return false;
      return true;
    });
  }, [linkedRuns, liveRuns, activeRun]);

  const { data: allIssues } = useQuery({
    queryKey: [...queryKeys.issues.list(selectedCompanyId!), "include-subtasks"],
    queryFn: () => issuesApi.list(selectedCompanyId!, { includeSubtasks: true }),
    enabled: !!selectedCompanyId && subissuesTabActive,
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

  const { data: setupProgress } = useQuery({
    queryKey: queryKeys.companies.setupProgress(selectedCompanyId!),
    queryFn: () => companiesApi.getSetupProgress(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const onboardingMeta = setupProgress?.metadata as OnboardingMetadata | undefined;
  const isOnboardingIssue = Boolean(
    onboardingMeta?.onboardingIssueId && onboardingMeta.onboardingIssueId === issue?.id
  );

  const retrievalRunHitsQueries = useQueries({
    queries: (changeSurface?.retrievalContext.latestRuns ?? [])
      .slice(0, 3)
      .map((run) => ({
        queryKey: ["knowledge", "retrieval-run-hits", run.retrievalRunId],
        queryFn: () => knowledgeApi.getRetrievalRunHits(run.retrievalRunId),
        enabled: issueSection === "Changes",
        staleTime: 15_000,
      })),
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
  const pendingClarificationRequests = useMemo(
    () => derivePendingClarificationRequests(protocolMessages, agentMap),
    [agentMap, protocolMessages],
  );
  const deliveryPartySlots = useMemo(
    () =>
      buildDeliveryPartySlots({
        protocolState,
        agentMap,
        liveRunAgentId: primaryLiveRun?.agentId ?? null,
        pendingClarification: pendingClarificationRequests[0] ?? null,
      }),
    [agentMap, pendingClarificationRequests, primaryLiveRun?.agentId, protocolState]
  );
  const activeDeliveryPartySlot =
    deliveryPartySlots.find(
      (slot) => slot.tone === "active" || slot.tone === "blocked"
    ) ?? null;
  const needsImplementationRecovery =
    protocolState?.workflowState === "changes_requested"
    && !protocolState.primaryEngineerAgentId;

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
      .sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
    const combined = [...detailChildren];
    const seen = new Set(detailChildren.map((child) => child.id));
    for (const child of visibleChildren) {
      if (seen.has(child.id)) continue;
      combined.push(child);
    }
    return combined.sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
  }, [allIssues, issue]);

  const subtaskOverview = useMemo(() => {
    const summary = issue?.internalWorkItemSummary;
    if (!summary) {
      return {
        total: childIssues.length,
        done: childIssues.filter((child) => child.status === "done" || child.status === "cancelled").length,
        blocked: childIssues.filter((child) => child.status === "blocked").length,
        inReview: childIssues.filter((child) => child.status === "in_review").length,
        open: childIssues.filter((child) => !["done", "cancelled"].includes(child.status)).length,
      };
    }

    return {
      total: summary.total,
      done: summary.done,
      blocked: summary.blocked,
      inReview: summary.inReview,
      open: summary.todo + summary.inProgress + summary.inReview + summary.blocked,
    };
  }, [childIssues, issue?.internalWorkItemSummary]);

  const subtaskProgressPercent = useMemo(() => {
    if (subtaskOverview.total <= 0) return 0;
    return Math.max(0, Math.min(100, Math.round((subtaskOverview.done / subtaskOverview.total) * 100)));
  }, [subtaskOverview.done, subtaskOverview.total]);

  const dependencyGraphItems = useMemo(
    () => readDependencyGraphSnapshot(protocolState ?? null),
    [protocolState]
  );
  const unresolvedDependencyItems = useMemo(
    () => dependencyGraphItems.filter((item) => item.resolved === false),
    [dependencyGraphItems]
  );
  const isIntakeRootIssue = Boolean(
    issue &&
      !issue.parentId &&
      (issue.labels ?? []).some((label) => label.name === "workflow:intake")
  );

  const commentReassignOptions = useMemo(() => {
    const options: Array<{ id: string; label: string; searchText?: string }> =
      [];
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
    const runMetaByCommentId = new Map<
      string,
      { runId: string; runAgentId: string | null }
    >();
    const agentIdByRunId = new Map<string, string>();
    for (const run of linkedRuns ?? []) {
      agentIdByRunId.set(run.runId, run.agentId);
    }
    for (const evt of activity ?? []) {
      if (evt.action !== "issue.comment_added" || !evt.runId) continue;
      const details = evt.details ?? {};
      const commentId =
        typeof details["commentId"] === "string" ? details["commentId"] : null;
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

  const latestBriefs = useMemo(
    () => latestBriefsByScope(protocolBriefs),
    [protocolBriefs]
  );
  const briefSnapshots = useMemo(() => {
    return latestBriefs.reduce<Partial<Record<string, DashboardBriefSnapshot>>>(
      (acc, brief) => {
        acc[brief.briefScope] = {
          id: brief.id,
          briefScope: brief.briefScope,
          briefVersion: brief.briefVersion,
          workflowState: brief.workflowState,
          retrievalRunId: brief.retrievalRunId,
          createdAt: brief.createdAt,
          preview: truncate(brief.contentMarkdown, 1200),
        };
        return acc;
      },
      {}
    );
  }, [latestBriefs]);
  const protocolTimeline = useMemo(
    () => [...protocolMessages].slice(-12).reverse(),
    [protocolMessages]
  );
  const latestResolvedClarification = useMemo(
    () => deriveLatestClarificationResolutionView(protocolMessages, agentMap),
    [agentMap, protocolMessages],
  );
  const openViolations = useMemo(
    () => protocolViolations.filter((violation) => violation.status === "open"),
    [protocolViolations]
  );
  const protocolRecoveryAlerts = useMemo(
    () => buildProtocolRecoveryAlerts(protocolMessages, protocolViolations),
    [protocolMessages, protocolViolations]
  );
  const openTimeoutAlertCount = useMemo(
    () =>
      protocolMessages.filter(
        (message) => message.messageType === "TIMEOUT_ESCALATION"
      ).length,
    [protocolMessages]
  );
  const integrityIssueCount = useMemo(
    () =>
      protocolMessages.filter(
        (message) =>
          message.integrityStatus && message.integrityStatus !== "verified"
      ).length,
    [protocolMessages]
  );
  const latestReviewCycle = useMemo(
    () => reviewCycles[0] ?? null,
    [reviewCycles]
  );
  const latestReviewSubmission = useMemo(
    () =>
      [...protocolMessages]
        .reverse()
        .find((message) => message.messageType === "SUBMIT_FOR_REVIEW") ?? null,
    [protocolMessages]
  );
  const latestApprovalMessage = useMemo(
    () =>
      [...protocolMessages]
        .reverse()
        .find((message) => message.messageType === "APPROVE_IMPLEMENTATION") ??
      null,
    [protocolMessages]
  );
  const latestCloseMessage = useMemo(
    () =>
      [...protocolMessages]
        .reverse()
        .find((message) => message.messageType === "CLOSE_TASK") ?? null,
    [protocolMessages]
  );
  const latestReviewHandoff = useMemo(
    () =>
      latestReviewSubmission
        ? readProtocolReviewHandoff(latestReviewSubmission)
        : null,
    [latestReviewSubmission]
  );
  const latestApprovalSnapshot = useMemo(
    () =>
      latestApprovalMessage
        ? readProtocolApproval(latestApprovalMessage)
        : null,
    [latestApprovalMessage]
  );
  const latestCloseSnapshot = useMemo(
    () => (latestCloseMessage ? readProtocolClose(latestCloseMessage) : null),
    [latestCloseMessage]
  );
  const latestWorkspaceSnapshot = useMemo(() => {
    for (const run of linkedRuns ?? []) {
      const snapshot = readChangeWorkspaceSnapshot(run.resultJson ?? null);
      if (snapshot) return snapshot;
    }
    return null;
  }, [linkedRuns]);
  const latestReviewArtifacts = useMemo(() => {
    const artifacts = latestReviewSubmission?.artifacts ?? [];
    const diffArtifacts = artifacts.filter(
      (artifact) => artifact.kind === "diff"
    );
    const verificationArtifacts = artifacts.filter(
      (artifact) =>
        artifact.kind === "test_run" || artifact.kind === "build_run"
    );
    return {
      diffArtifacts,
      verificationArtifacts,
    };
  }, [latestReviewSubmission]);
  const retrievalRunDetails = useMemo(
    () =>
      retrievalRunHitsQueries
        .map((query) => query.data)
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry)),
    [retrievalRunHitsQueries]
  );
  const retrievalRunById = useMemo(
    () =>
      new Map(
        retrievalRunDetails.map((entry) => [entry.retrievalRun.id, entry])
      ),
    [retrievalRunDetails]
  );
  const latestRetrievalRuns = changeSurface?.retrievalContext.latestRuns ?? [];
  const retrievalFeedbackSummary =
    changeSurface?.retrievalContext.feedbackSummary ?? null;

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
        "cache_read_input_tokens"
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
    queryClient.invalidateQueries({
      queryKey: queryKeys.issues.detail(issueId!),
    });
    queryClient.invalidateQueries({
      queryKey: queryKeys.issues.changeSurface(issueId!),
    });
    queryClient.invalidateQueries({
      queryKey: queryKeys.issues.protocolState(issueId!),
    });
    queryClient.invalidateQueries({
      queryKey: queryKeys.issues.protocolMessages(issueId!),
    });
    queryClient.invalidateQueries({
      queryKey: queryKeys.issues.protocolBriefs(issueId!),
    });
    queryClient.invalidateQueries({
      queryKey: queryKeys.issues.protocolReviewCycles(issueId!),
    });
    queryClient.invalidateQueries({
      queryKey: queryKeys.issues.protocolViolations(issueId!),
    });
    queryClient.invalidateQueries({
      queryKey: queryKeys.issues.activity(issueId!),
    });
    queryClient.invalidateQueries({
      queryKey: queryKeys.issues.runs(issueId!),
    });
    queryClient.invalidateQueries({
      queryKey: queryKeys.issues.approvals(issueId!),
    });
    queryClient.invalidateQueries({
      queryKey: queryKeys.issues.attachments(issueId!),
    });
    queryClient.invalidateQueries({
      queryKey: queryKeys.issues.liveRuns(issueId!),
    });
    queryClient.invalidateQueries({
      queryKey: queryKeys.issues.activeRun(issueId!),
    });
    if (selectedCompanyId) {
      queryClient.invalidateQueries({
        queryKey: queryKeys.issues.list(selectedCompanyId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.dashboardProtocolQueue(selectedCompanyId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.dashboard(selectedCompanyId),
      });
      queryClient.invalidateQueries({
        queryKey: ["knowledge", "quality", selectedCompanyId],
      });
    }
  };

  const updateIssue = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      issuesApi.update(issueId!, data),
    onSuccess: (updated) => {
      invalidateIssue();
      const issueRef = updated.identifier ?? `Issue ${updated.id.slice(0, 8)}`;
      pushToast({
        dedupeKey: `activity:issue.updated:${updated.id}`,
        title: `${issueRef} updated`,
        body: truncate(updated.title, 96),
        tone: "success",
        action: {
          label: `View ${issueRef}`,
          href: `${issueBasePath}/${updated.identifier ?? updated.id}`,
        },
      });
    },
  });

  const addComment = useMutation({
    mutationFn: ({ body, reopen }: { body: string; reopen?: boolean }) =>
      issuesApi.addComment(issueId!, body, reopen),
    onSuccess: (comment) => {
      invalidateIssue();
      queryClient.invalidateQueries({
        queryKey: queryKeys.issues.comments(issueId!),
      });
      const issueRef =
        issue?.identifier ??
        (issueId ? `Issue ${issueId.slice(0, 8)}` : "Issue");
      pushToast({
        dedupeKey: `activity:issue.comment_added:${issueId}:${comment.id}`,
        title: `Comment posted on ${issueRef}`,
        body: issue?.title ? truncate(issue.title, 96) : undefined,
        tone: "success",
        action: issueId
          ? {
              label: `View ${issueRef}`,
              href: `${issueBasePath}/${issue?.identifier ?? issueId}`,
            }
          : undefined,
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
      queryClient.invalidateQueries({
        queryKey: queryKeys.issues.comments(issueId!),
      });
      const issueRef =
        updated.identifier ??
        (issueId ? `Issue ${issueId.slice(0, 8)}` : "Issue");
      pushToast({
        dedupeKey: `activity:issue.reassigned:${updated.id}`,
        title: `${issueRef} reassigned`,
        body: issue?.title ? truncate(issue.title, 96) : undefined,
        tone: "success",
        action: issueId
          ? {
              label: `View ${issueRef}`,
              href: `${issueBasePath}/${issue?.identifier ?? issueId}`,
            }
          : undefined,
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
      queryClient.invalidateQueries({
        queryKey: queryKeys.issues.attachments(issueId!),
      });
      invalidateIssue();
    },
    onError: (err) => {
      setAttachmentError(err instanceof Error ? err.message : "Upload failed");
    },
  });

  const deleteAttachment = useMutation({
    mutationFn: (attachmentId: string) =>
      issuesApi.deleteAttachment(attachmentId),
    onSuccess: () => {
      setAttachmentError(null);
      queryClient.invalidateQueries({
        queryKey: queryKeys.issues.attachments(issueId!),
      });
      invalidateIssue();
    },
    onError: (err) => {
      setAttachmentError(err instanceof Error ? err.message : "Delete failed");
    },
  });

  const createProtocolMessage = useMutation({
    mutationFn: (
      message: Parameters<typeof issuesApi.createProtocolMessage>[1]
    ) => issuesApi.createProtocolMessage(issueId!, message),
    onSuccess: () => {
      invalidateIssue();
      const issueRef =
        issue?.identifier ??
        (issueId ? `Issue ${issueId.slice(0, 8)}` : "Issue");
      pushToast({
        dedupeKey: `activity:issue.protocol_message.created:${issueId}`,
        title: `Protocol action posted on ${issueRef}`,
        body: issue?.title ? truncate(issue.title, 96) : undefined,
        tone: "success",
        action: issueId
          ? {
              label: `View ${issueRef}`,
              href: `${issueBasePath}/${issue?.identifier ?? issueId}`,
            }
          : undefined,
      });
    },
    onError: (err) => {
      pushToast({
        title: "Protocol action failed",
        body:
          err instanceof Error ? err.message : "Failed to post protocol action",
        tone: "error",
      });
    },
  });

  useEffect(() => {
    if (preferredProtocolTab === "protocol" && detailTab !== "protocol") {
      setDetailTab("protocol");
    }
  }, [detailTab, preferredProtocolTab]);

  function clearProtocolIntent() {
    if (!preferredProtocolTab && !preferredProtocolAction && !preferredClarificationId && !searchParams.get("source")) {
      return;
    }
    const next = new URLSearchParams(searchParams);
    next.delete("tab");
    next.delete("action");
    next.delete("clarification");
    next.delete("source");
    setSearchParams(next, { replace: true });
  }

  const recordRetrievalFeedback = useMutation({
    mutationFn: (input: {
      retrievalRunId: string;
      feedbackType: "operator_pin" | "operator_hide";
      targetType: "chunk" | "path" | "symbol" | "source_type";
      targetIds: string[];
      noteBody?: string | null;
    }) => issuesApi.recordRetrievalFeedback(issueId!, input),
    onSuccess: (_, variables) => {
      invalidateIssue();
      for (const run of latestRetrievalRuns) {
        queryClient.invalidateQueries({
          queryKey: ["knowledge", "retrieval-run-hits", run.retrievalRunId],
        });
      }
      pushToast({
        title:
          variables.feedbackType === "operator_pin"
            ? "Retrieval hit pinned"
            : "Retrieval hit hidden",
        body: variables.targetIds[0] ?? variables.retrievalRunId,
        tone: "success",
      });
    },
    onError: (err) => {
      pushToast({
        title: "Retrieval feedback failed",
        body:
          err instanceof Error
            ? err.message
            : "Failed to record retrieval feedback",
        tone: "error",
      });
    },
  });

  useEffect(() => {
    setBreadcrumbs([
      { label: issueSection, href: issueBasePath },
      { label: issue?.title ?? issueId ?? "Issue" },
    ]);
  }, [setBreadcrumbs, issue, issueId, issueSection, issueBasePath]);

  // Redirect to identifier-based URL if navigated via UUID
  useEffect(() => {
    if (issue?.identifier && issueId !== issue.identifier) {
      navigate(`${issueBasePath}/${issue.identifier}`, { replace: true });
    }
  }, [issue, issueId, navigate, issueBasePath]);

  useEffect(() => {
    if (issue) {
      openPanel(
        <IssueProperties
          issue={issue}
          onUpdate={(data) => updateIssue.mutate(data)}
        />
      );
    }
    return () => closePanel();
  }, [issue]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading)
    return <p className="text-sm text-muted-foreground">Loading...</p>;
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

  const isImageAttachment = (attachment: IssueAttachment) =>
    attachment.contentType.startsWith("image/");

  return (
    <div
      className={cn(
        issueSection === "Changes" ? "max-w-5xl" : "max-w-4xl",
        "space-y-4"
      )}
    >
      {/* Post-onboarding welcome banner: shown when this issue is the onboarding issue
           (identified via setupProgress.metadata.onboardingIssueId). Message varies by state. */}
      {isOnboardingIssue && issue?.status !== "done" && issue?.status !== "cancelled" && (() => {
        const hasPendingClarification = pendingClarificationRequests.length > 0;
        const wfState = protocolState?.workflowState;
        let bannerTitle = "Welcome to your first issue";
        let bannerMessage = "Your PM is structuring this request. Watch for clarification questions in the Inbox.";

        if (hasPendingClarification) {
          bannerTitle = "Clarification needed";
          bannerMessage = "A clarification is waiting — check your Inbox to keep things moving.";
        } else if (wfState === "implementing") {
          bannerTitle = "Implementation underway";
          bannerMessage = "Your team is building the solution. Progress updates appear in the protocol timeline below.";
        } else if (
          wfState === "submitted_for_review" ||
          wfState === "under_review"
        ) {
          bannerTitle = "Review in progress";
          bannerMessage = "The implementation is being reviewed. You will see the outcome here shortly.";
        }

        return (
          <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
            <div className="text-sm font-medium text-foreground">{bannerTitle}</div>
            <div className="mt-1 text-xs text-muted-foreground">{bannerMessage}</div>
          </div>
        );
      })()}

      {/* Parent chain breadcrumb */}
      {ancestors.length > 0 && (
        <nav className="flex items-center gap-1 text-xs text-muted-foreground flex-wrap">
          {[...ancestors].reverse().map((ancestor, i) => (
            <span key={ancestor.id} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="h-3 w-3 shrink-0" />}
              <Link
                to={`${issueBasePath}/${ancestor.identifier ?? ancestor.id}`}
                className="hover:text-foreground transition-colors truncate max-w-[200px]"
                title={ancestor.title}
              >
                {ancestor.title}
              </Link>
            </span>
          ))}
          <ChevronRight className="h-3 w-3 shrink-0" />
          <span className="text-foreground/60 truncate max-w-[200px]">
            {issue.title}
          </span>
        </nav>
      )}

      {issue.parentId && (
        <div className="flex items-center gap-2 rounded-md border border-muted-foreground/30 bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
          <ListTree className="h-4 w-4 shrink-0" />
          Subtask
        </div>
      )}

      {issueSection === "Changes" && (
        <div className="space-y-4">
          <section className="space-y-4 rounded-[1.8rem] border border-border bg-card px-5 py-5 shadow-card">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-2">
                <div className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-muted-foreground">
                  <GitCommitHorizontal className="h-3.5 w-3.5" />
                  Change Review Surface
                </div>
                <div>
                  <h2 className="text-2xl font-semibold tracking-tight">
                    Change Evidence
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Branch, diff, verification signals, and merge handoff captured
                    from the delivery loop.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {latestCloseSnapshot?.mergeStatus && (
                  <span className="rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-foreground">
                    Merge {formatProtocolValue(latestCloseSnapshot.mergeStatus)}
                  </span>
                )}
                {latestWorkspaceSnapshot?.workspaceStatus && (
                  <span className="rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-muted-foreground">
                    {latestWorkspaceSnapshot.workspaceStatus.replace(/_/g, " ")}
                  </span>
                )}
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-[1.35rem] border border-border bg-background px-4 py-4">
                <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  <GitBranch className="h-3.5 w-3.5" />
                  Branch
                </div>
                <div className="mt-3 text-sm font-semibold text-foreground">
                  {latestWorkspaceSnapshot?.branchName ??
                    "No implementation branch yet"}
                </div>
                {latestWorkspaceSnapshot?.headSha && (
                  <div className="mt-1 font-['IBM_Plex_Mono'] text-xs text-muted-foreground">
                    {latestWorkspaceSnapshot.headSha.slice(0, 12)}
                  </div>
                )}
              </div>
              <div className="rounded-[1.35rem] border border-border bg-background px-4 py-4">
                <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  <GitCommitHorizontal className="h-3.5 w-3.5" />
                  Diff Coverage
                </div>
                <div className="mt-3 text-2xl font-semibold text-foreground">
                  {latestWorkspaceSnapshot?.changedFiles.length ??
                    latestReviewHandoff?.changedFiles.length ??
                    0}
                </div>
                <div className="mt-1 text-sm text-muted-foreground">
                  {latestWorkspaceSnapshot?.diffStat ??
                    "Changed files captured from review handoff."}
                </div>
              </div>
              <div className="rounded-[1.35rem] border border-border bg-background px-4 py-4">
                <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  <TestTube2 className="h-3.5 w-3.5" />
                  Verification
                </div>
                <div className="mt-3 text-2xl font-semibold text-foreground">
                  {latestReviewArtifacts.verificationArtifacts.length}
                </div>
                <div className="mt-1 text-sm text-muted-foreground">
                  Corroborated test/build artifacts attached to the latest review
                  submission.
                </div>
              </div>
              <div className="rounded-[1.35rem] border border-border bg-background px-4 py-4">
                <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  <CheckCheck className="h-3.5 w-3.5" />
                  Approval
                </div>
                <div className="mt-3 text-sm font-semibold text-foreground">
                  {latestApprovalSnapshot?.approvalSummary ??
                    "No approval summary yet"}
                </div>
              </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
              <div className="rounded-[1.35rem] border border-border bg-background px-4 py-4">
                <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  Changed Files
                </div>
                {(latestWorkspaceSnapshot?.changedFiles.length ?? 0) > 0 ||
                (latestReviewHandoff?.changedFiles.length ?? 0) > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(latestWorkspaceSnapshot?.changedFiles.length
                      ? latestWorkspaceSnapshot.changedFiles
                      : latestReviewHandoff?.changedFiles ?? []
                    )
                      .slice(0, 10)
                      .map((file) => (
                        <span
                          key={file}
                          className="rounded-full border border-border bg-card px-3 py-1 text-xs text-foreground"
                        >
                          {file}
                        </span>
                      ))}
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-muted-foreground">
                    No changed file manifest has been attached yet.
                  </p>
                )}
              </div>
              <div className="rounded-[1.35rem] border border-border bg-background px-4 py-4">
                <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  Merge Handoff
                </div>
                <div className="mt-3 space-y-2 text-sm text-muted-foreground">
                  {latestCloseSnapshot?.closureSummary && (
                    <p className="text-foreground">
                      {latestCloseSnapshot.closureSummary}
                    </p>
                  )}
                  {latestCloseSnapshot?.verificationSummary && (
                    <p>Verification: {latestCloseSnapshot.verificationSummary}</p>
                  )}
                  {latestCloseSnapshot?.rollbackPlan && (
                    <p>Rollback: {latestCloseSnapshot.rollbackPlan}</p>
                  )}
                  {!latestCloseSnapshot && (
                    <p>No close handoff has been recorded yet.</p>
                  )}
                </div>
              </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
              <div className="rounded-[1.35rem] border border-border bg-background px-4 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                      Retrieval Feedback
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      Pin or hide evidence directly from the change surface to
                      steer follow-up briefs.
                    </div>
                  </div>
                  {retrievalFeedbackSummary && (
                    <div className="text-right text-xs text-muted-foreground">
                      <div>{retrievalFeedbackSummary.positiveCount} positive</div>
                      <div>{retrievalFeedbackSummary.negativeCount} negative</div>
                    </div>
                  )}
                </div>
                {latestRetrievalRuns.length === 0 ? (
                  <p className="mt-4 text-sm text-muted-foreground">
                    No retrieval-backed brief has been attached yet.
                  </p>
                ) : (
                  <div className="mt-4 space-y-4">
                    {latestRetrievalRuns.map((run) => {
                      const runDetail = retrievalRunById.get(run.retrievalRunId);
                      const hits = (runDetail?.hits ?? []).slice(0, 5);
                      return (
                        <div
                          key={run.retrievalRunId}
                          className="rounded-[1rem] border border-border bg-card px-3 py-3"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                              <span className="rounded-full border border-border bg-background px-2.5 py-1 font-medium text-foreground">
                                {formatProtocolValue(run.briefScope)}
                              </span>
                              <span className="font-mono">
                                {run.retrievalRunId.slice(0, 8)}
                              </span>
                              {run.candidateCacheHit && (
                                <span className="rounded-full border border-emerald-300/70 bg-emerald-50 px-2.5 py-1 text-emerald-700">
                                  candidate cache
                                </span>
                              )}
                              {run.finalCacheHit && (
                                <span className="rounded-full border border-blue-300/70 bg-blue-50 px-2.5 py-1 text-blue-700">
                                  final cache
                                </span>
                              )}
                              {run.multiHopGraphHitCount > 0 && (
                                <span className="rounded-full border border-violet-300/70 bg-violet-50 px-2.5 py-1 text-violet-700">
                                  {run.multiHopGraphHitCount} multi-hop
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {run.graphHitCount} graph hits
                              {run.personalized ? " · personalized" : ""}
                            </div>
                          </div>
                          {hits.length === 0 ? (
                            <p className="mt-3 text-sm text-muted-foreground">
                              Retrieval hits are loading or unavailable.
                            </p>
                          ) : (
                            <div className="mt-3 space-y-2">
                              {hits.map((hit) => {
                                const target = deriveFeedbackTarget({
                                  path: hit.documentPath,
                                  symbolName: hit.symbolName,
                                  sourceType: hit.sourceType,
                                  chunkId: hit.chunkId,
                                });
                                return (
                                  <div
                                    key={`${run.retrievalRunId}:${hit.chunkId}`}
                                    className="rounded-[0.95rem] border border-border/80 bg-background px-3 py-3"
                                  >
                                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                      <div className="space-y-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                          <span className="rounded-full border border-border bg-card px-2 py-0.5 text-[11px] font-medium text-foreground">
                                            {hit.sourceType}
                                          </span>
                                          {hit.documentPath && (
                                            <span className="font-mono text-xs text-foreground/80">
                                              {hit.documentPath}
                                            </span>
                                          )}
                                        </div>
                                        <div className="text-sm font-medium text-foreground">
                                          {hit.documentTitle ??
                                            hit.symbolName ??
                                            hit.chunkId.slice(0, 8)}
                                        </div>
                                        <div className="line-clamp-2 text-sm text-muted-foreground">
                                          {hit.rationale ?? hit.textContent}
                                        </div>
                                      </div>
                                      <div className="flex shrink-0 gap-2">
                                        <Button
                                          type="button"
                                          size="sm"
                                          variant="outline"
                                          disabled={
                                            recordRetrievalFeedback.isPending
                                          }
                                          onClick={() =>
                                            recordRetrievalFeedback.mutate({
                                              retrievalRunId: run.retrievalRunId,
                                              feedbackType: "operator_pin",
                                              targetType: target.targetType,
                                              targetIds: target.targetIds,
                                              noteBody: `Pinned from change surface: ${target.label}`,
                                            })
                                          }
                                        >
                                          <Pin className="mr-2 h-3.5 w-3.5" />
                                          Pin
                                        </Button>
                                        <Button
                                          type="button"
                                          size="sm"
                                          variant="ghost"
                                          disabled={
                                            recordRetrievalFeedback.isPending
                                          }
                                          onClick={() =>
                                            recordRetrievalFeedback.mutate({
                                              retrievalRunId: run.retrievalRunId,
                                              feedbackType: "operator_hide",
                                              targetType: target.targetType,
                                              targetIds: target.targetIds,
                                              noteBody: `Hidden from change surface: ${target.label}`,
                                            })
                                          }
                                        >
                                          <PinOff className="mr-2 h-3.5 w-3.5" />
                                          Hide
                                        </Button>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              <div className="rounded-[1.35rem] border border-border bg-background px-4 py-4">
                <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  Retrieval Summary
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-[1rem] border border-border bg-card px-3 py-3">
                    <div className="text-xs text-muted-foreground">
                      Pinned paths
                    </div>
                    <div className="mt-1 text-2xl font-semibold text-foreground">
                      {retrievalFeedbackSummary?.pinnedPathCount ?? 0}
                    </div>
                  </div>
                  <div className="rounded-[1rem] border border-border bg-card px-3 py-3">
                    <div className="text-xs text-muted-foreground">
                      Hidden paths
                    </div>
                    <div className="mt-1 text-2xl font-semibold text-foreground">
                      {retrievalFeedbackSummary?.hiddenPathCount ?? 0}
                    </div>
                  </div>
                  <div className="rounded-[1rem] border border-border bg-card px-3 py-3">
                    <div className="text-xs text-muted-foreground">
                      Latest retrieval runs
                    </div>
                    <div className="mt-1 text-2xl font-semibold text-foreground">
                      {latestRetrievalRuns.length}
                    </div>
                  </div>
                  <div className="rounded-[1rem] border border-border bg-card px-3 py-3">
                    <div className="text-xs text-muted-foreground">
                      Last feedback
                    </div>
                    <div className="mt-1 text-sm font-medium text-foreground">
                      {retrievalFeedbackSummary?.lastFeedbackAt
                        ? relativeTime(retrievalFeedbackSummary.lastFeedbackAt)
                        : "No feedback yet"}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <ChangeReviewDesk
            companyId={selectedCompanyId}
            issueId={issueId!}
            issueRef={issue.identifier ?? issue.id.slice(0, 8)}
            issueTitle={issue.title}
            reviewHref={`${appRoutes.changes}/${issue.identifier ?? issue.id}`}
            workHref={`${appRoutes.work}/${issue.identifier ?? issue.id}`}
            surface={changeSurface}
            onRefresh={invalidateIssue}
          />
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <StatusIcon
            status={issue.status}
            onChange={(status) => updateIssue.mutate({ status })}
          />
          <PriorityIcon
            priority={issue.priority}
            onChange={(priority) => updateIssue.mutate({ priority })}
          />
          <span className="text-sm font-mono text-muted-foreground shrink-0">
            {issue.identifier ?? issue.id.slice(0, 8)}
          </span>

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
              <span className="truncate">
                {(projects ?? []).find((p) => p.id === issue.projectId)?.name ??
                  issue.projectId.slice(0, 8)}
              </span>
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
                <span className="text-[10px] text-muted-foreground">
                  +{(issue.labels ?? []).length - 4}
                </span>
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
                panelVisible
                  ? "opacity-0 pointer-events-none w-0 overflow-hidden"
                  : "opacity-100"
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
                    if (!window.confirm("Are you sure you want to cancel this issue?")) return;
                    updateIssue.mutate(
                      { status: "cancelled" },
                      { onSuccess: () => navigate(appRoutes.work) }
                    );
                    setMoreOpen(false);
                  }}
                >
                  <XCircle className="h-3 w-3" />
                  Cancel Issue
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

        {issue.progressSnapshot && (
          <ProgressHeroStrip snapshot={issue.progressSnapshot} agentMap={agentMap} />
        )}

        {issue.runtimeSummary && (
          <div className={cn(
            "flex items-center gap-3 rounded-lg border px-3 py-2 text-xs",
            issue.runtimeSummary.severity === "risk"
              ? "border-red-300/70 bg-red-500/5 text-red-700"
              : issue.runtimeSummary.severity === "warning"
                ? "border-amber-300/70 bg-amber-500/5 text-amber-700"
                : "border-border bg-muted/30 text-muted-foreground"
          )}>
            <Terminal className="h-3.5 w-3.5 shrink-0" />
            <span className="font-medium">{issue.runtimeSummary.headline}</span>
            {issue.runtimeSummary.detail && (
              <span className="text-muted-foreground">{issue.runtimeSummary.detail}</span>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            asChild
            variant={issueSection === "Work" ? "default" : "outline"}
            size="sm"
            className="rounded-full"
          >
            <Link to={`${appRoutes.work}/${issue.identifier ?? issue.id}`}>
              <Workflow className="h-3.5 w-3.5" />
              Work View
            </Link>
          </Button>
          <Button
            asChild
            variant={issueSection === "Changes" ? "default" : "outline"}
            size="sm"
            className="rounded-full"
          >
            <Link to={`${appRoutes.changes}/${issue.identifier ?? issue.id}`}>
              <GitBranch className="h-3.5 w-3.5" />
              Change View
            </Link>
          </Button>
        </div>
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
                {primaryLiveAdapterLabel && (
                  <span>Engine: {primaryLiveAdapterLabel}</span>
                )}
                {primaryLiveTrigger && (
                  <span>Trigger: {primaryLiveTrigger}</span>
                )}
                {primaryLiveRunStartedAt && (
                  <span>Started {relativeTime(primaryLiveRunStartedAt)}</span>
                )}
                <span>Run {primaryLiveRun.id.slice(0, 8)}</span>
                {liveRunCount > 1 && (
                  <span>{liveRunCount} live runs attached</span>
                )}
              </div>
            </div>
            <div className="max-w-sm text-xs leading-5 text-muted-foreground">
              This issue already triggered a real Claude Code or Codex run
              through the API workflow. Follow the live log below to inspect
              progress and runtime events.
            </div>
          </div>
          <div className="mt-3">
            <LiveRunWidget issueId={issueId!} companyId={issue.companyId} />
          </div>
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-3">
        <div className="rounded-lg border border-border bg-card px-3 py-2.5">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <Workflow className="h-3.5 w-3.5" />
            Workflow
          </div>
          <div className="mt-2 text-sm font-semibold text-foreground">
            {formatProtocolValue(protocolState?.workflowState ?? issue.status)}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            Coarse status:{" "}
            {formatProtocolValue(
              protocolState?.coarseIssueStatus ?? issue.status
            )}
          </div>
          {protocolState?.blockedCode && (
            <div className="mt-2 inline-flex rounded-full border border-amber-400 px-2 py-0.5 text-[11px] text-amber-700">
              {formatProtocolValue(protocolState.blockedCode)}
            </div>
          )}
          {unresolvedDependencyItems.length > 0 && (
            <div className="mt-3 rounded-md border border-amber-300/60 bg-amber-50/60 px-3 py-2 text-xs text-amber-900">
              <div className="font-medium">Dependencies</div>
              <div className="mt-1 space-y-1">
                {unresolvedDependencyItems.slice(0, 4).map((item) => (
                  <div key={`${item.reference}:${item.issueId ?? "missing"}`}>
                    {item.identifier ?? item.reference}
                    {item.title ? ` · ${item.title}` : ""}
                    {item.status ? ` (${formatProtocolValue(item.status)})` : " (unresolved)"}
                  </div>
                ))}
              </div>
            </div>
          )}
          {isIntakeRootIssue && (
            <div className="mt-3">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setIntakeProjectionDialogOpen(true)}
              >
                Project intake to delivery
              </Button>
            </div>
          )}
        </div>
        <div className="rounded-lg border border-border bg-card px-3 py-2.5">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <ClipboardCheck className="h-3.5 w-3.5" />
            Protocol ownership
          </div>
          <div className="mt-1.5 space-y-1.5 text-xs text-muted-foreground">
            {deliveryPartySlots.map((slot) => (
              <div key={slot.key} className="flex items-center gap-2">
                <span className="w-16 shrink-0">{slot.label}</span>
                {slot.agent ? (
                  <Identity name={slot.agent.name} size="sm" />
                ) : (
                  <span>Unassigned</span>
                )}
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card px-3 py-2.5">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <ShieldAlert className="h-3.5 w-3.5" />
            Readiness
          </div>
          <div className="mt-1.5 space-y-1.5 text-xs text-muted-foreground">
            <div>Review cycle: {protocolState?.currentReviewCycle ?? 0}</div>
            <div>Open violations: {openViolations.length}</div>
            <div>Timeout escalations: {openTimeoutAlertCount}</div>
            <div>Integrity alerts: {integrityIssueCount}</div>
            <div>Briefs ready: {latestBriefs.length}</div>
            <div>Messages: {protocolMessages.length}</div>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium text-muted-foreground">
            Attachments
          </h3>
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

        {!attachments || attachments.length === 0 ? (
          <p className="text-xs text-muted-foreground">No attachments yet.</p>
        ) : (
          <div className="space-y-2">
            {attachments.map((attachment) => (
              <div
                key={attachment.id}
                className="border border-border rounded-md p-2"
              >
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
                  {attachment.contentType} ·{" "}
                  {(attachment.byteSize / 1024).toFixed(1)} KB
                </p>
                {isImageAttachment(attachment) && (
                  <a
                    href={attachment.contentPath}
                    target="_blank"
                    rel="noreferrer"
                  >
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

      <Tabs
        value={detailTab}
        onValueChange={setDetailTab}
        className="space-y-2"
      >
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
          <TabsTrigger value="documents" className="gap-1.5">
            <FilePenLine className="h-3.5 w-3.5" />
            Documents
            {(issueDocuments?.length ?? 0) > 0 && (
              <span className="ml-0.5 text-[10px] text-muted-foreground">
                {issueDocuments!.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="activity" className="gap-1.5">
            <ActivityIcon className="h-3.5 w-3.5" />
            Activity
          </TabsTrigger>
          <TabsTrigger value="delivery" className="gap-1.5">
            <ClipboardCheck className="h-3.5 w-3.5" />
            Delivery
          </TabsTrigger>
          <TabsTrigger value="deliverables" className="gap-1.5">
            <Package className="h-3.5 w-3.5" />
            Deliverables
          </TabsTrigger>
        </TabsList>

        <TabsContent value="brief">
          <BriefPanelV2 briefs={briefSnapshots} />
        </TabsContent>

        <TabsContent value="protocol">
          <div className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
              <div className="space-y-4">
                {(pendingClarificationRequests.length > 0 || latestResolvedClarification) && (
                  <section className="rounded-lg border border-border bg-card px-4 py-4">
                    <div className="flex items-center gap-2">
                      <MessageSquare className="h-4 w-4 text-muted-foreground" />
                      <h3 className="text-sm font-semibold text-foreground">
                        Clarification Status
                      </h3>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Badge variant="outline">
                        {pendingClarificationRequests.length} pending
                      </Badge>
                      {latestResolvedClarification?.resumeWorkflowState ? (
                        <Badge variant="outline">
                          resumed {formatProtocolValue(latestResolvedClarification.resumeWorkflowState)}
                        </Badge>
                      ) : null}
                    </div>
                    {pendingClarificationRequests[0] ? (
                      <div className="mt-3 rounded-md border border-border/80 bg-background/70 px-3 py-3">
                        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                          Waiting on board
                        </div>
                        <div className="mt-1 text-sm text-foreground">
                          {pendingClarificationRequests[0].question}
                        </div>
                        <div className="mt-2 text-xs text-muted-foreground">
                          Asked by {pendingClarificationRequests[0].askedByLabel}
                          {pendingClarificationRequests[0].resumeWorkflowState
                            ? ` · resumes ${formatProtocolValue(pendingClarificationRequests[0].resumeWorkflowState)}`
                            : ""}
                        </div>
                      </div>
                    ) : null}
                    {latestResolvedClarification ? (
                      <div className="mt-3 rounded-md border border-emerald-500/20 bg-emerald-500/5 px-3 py-3">
                        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                          Latest answered clarification
                        </div>
                        <div className="mt-1 text-sm text-foreground">
                          Q: {latestResolvedClarification.question}
                        </div>
                        <div className="mt-2 text-sm text-foreground">
                          A: {latestResolvedClarification.answer}
                        </div>
                        <div className="mt-2 text-xs text-muted-foreground">
                          Asked by {latestResolvedClarification.askedByLabel}
                          {" · "}
                          answered by {latestResolvedClarification.answeredByLabel}
                          {" · "}
                          {relativeTime(latestResolvedClarification.answeredAt)}
                          {latestResolvedClarification.resumeWorkflowState
                            ? ` · resumed ${formatProtocolValue(latestResolvedClarification.resumeWorkflowState)}`
                            : ""}
                        </div>
                        {latestResolvedClarification.nextStep ? (
                          <div className="mt-2 text-xs text-muted-foreground">
                            Next step: {latestResolvedClarification.nextStep}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </section>
                )}

                {needsImplementationRecovery && (
                  <section
                    data-testid="issue-detail-missing-engineer-warning"
                    className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-4"
                  >
                    <div className="flex items-start gap-3">
                      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                      <div className="space-y-1">
                        <h3 className="text-sm font-semibold text-foreground">
                          Changes are requested, but no engineer is assigned
                        </h3>
                        <p className="text-sm text-muted-foreground">
                          The review loop cannot resume until implementation ownership is reassigned.
                          Use <span className="font-medium text-foreground">REASSIGN TASK</span> to staff an engineer,
                          then continue with ACK_CHANGE_REQUEST or START_IMPLEMENTATION.
                        </p>
                      </div>
                    </div>
                  </section>
                )}

                <ProtocolActionConsole
                  companyId={issue.companyId}
                  issueIdentifier={issue.identifier ?? issue.id.slice(0, 8)}
                  protocolState={protocolState ?? null}
                  agents={agents ?? []}
                  currentUserId={currentUserId}
                  clarificationRequests={pendingClarificationRequests}
                  preferredAction={preferredProtocolAction === "ANSWER_CLARIFICATION" ? "ANSWER_CLARIFICATION" : null}
                  preferredClarificationId={preferredClarificationId}
                  onSubmit={async (message) => {
                    await createProtocolMessage.mutateAsync(message);
                  }}
                  onActionCommitted={clearProtocolIntent}
                  isSubmitting={createProtocolMessage.isPending}
                />

                <section className="rounded-lg border border-border bg-card px-4 py-4">
                  <div className="flex items-center gap-2">
                    <BookText className="h-4 w-4 text-muted-foreground" />
                    <h3 className="text-sm font-semibold text-foreground">
                      Task Briefs
                    </h3>
                  </div>
                  {latestBriefs.length === 0 ? (
                    <p className="mt-3 text-sm text-muted-foreground">
                      No role-scoped briefs yet. Retrieval will populate this
                      once protocol handoffs start.
                    </p>
                  ) : (
                    <div className="mt-3 space-y-3">
                      {latestBriefs.map((brief) => {
                        const quality = readBriefQuality(brief);
                        return (
                          <div
                            key={brief.id}
                            className="rounded-md border border-border/80 bg-background/70 px-3 py-3"
                          >
                            <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                              <span className="rounded-full border border-border px-2 py-0.5">
                                {formatProtocolValue(brief.briefScope)}
                              </span>
                              <span>v{brief.briefVersion}</span>
                              <span>
                                {formatProtocolValue(brief.workflowState)}
                              </span>
                              {brief.retrievalRunId && (
                                <span className="font-mono">
                                  {brief.retrievalRunId.slice(0, 8)}
                                </span>
                              )}
                              <span className="ml-auto">
                                {relativeTime(brief.createdAt)}
                              </span>
                            </div>
                            {quality && (
                              <div className="mt-3 flex flex-wrap items-center gap-2">
                                <Badge
                                  variant="outline"
                                  className={briefQualityBadgeClass(
                                    quality.confidenceLevel
                                  )}
                                >
                                  {quality.confidenceLevel} confidence
                                </Badge>
                                <Badge variant="outline">
                                  {quality.evidenceCount} evidence
                                </Badge>
                                <Badge variant="outline">
                                  {quality.denseEnabled
                                    ? "semantic ready"
                                    : "semantic off"}
                                </Badge>
                              </div>
                            )}
                            {quality && quality.degradedReasons.length > 0 && (
                              <p className="mt-2 text-xs text-amber-700">
                                Limited context:{" "}
                                {quality.degradedReasons
                                  .map(formatBriefQualityReason)
                                  .join(", ")}
                              </p>
                            )}
                            <pre className="mt-3 whitespace-pre-wrap text-sm text-foreground">
                              {brief.contentMarkdown
                                .split(/\r?\n/)
                                .slice(0, 12)
                                .join("\n")}
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
                    <h3 className="text-sm font-semibold text-foreground">
                      Protocol Timeline
                    </h3>
                  </div>
                  {protocolTimeline.length === 0 ? (
                    <p className="mt-3 text-sm text-muted-foreground">
                      This issue has not entered the structured workflow yet.
                    </p>
                  ) : (
                    <div className="mt-3 space-y-3">
                      {protocolTimeline.map((message) => {
                        const evidence = collectProtocolEvidence(message);
                        const reviewHandoff =
                          readProtocolReviewHandoff(message);
                        const changeRequest =
                          readProtocolChangeRequest(message);
                        const approvalSnapshot = readProtocolApproval(message);
                        const closeSnapshot = readProtocolClose(message);
                        return (
                          <div
                            key={message.id}
                            className="rounded-md border border-border/80 bg-background/70 px-3 py-3"
                          >
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
                                      : message.integrityStatus ===
                                        "legacy_unsealed"
                                      ? "border-amber-300 bg-amber-50 text-amber-700"
                                      : "border-red-300 bg-red-50 text-red-700"
                                  )}
                                >
                                  {formatProtocolValue(message.integrityStatus)}
                                </span>
                              )}
                              <span>
                                {formatProtocolValue(message.sender.role)}
                              </span>
                              <span>
                                {`${formatProtocolValue(
                                  message.workflowStateBefore
                                )} -> ${formatProtocolValue(
                                  message.workflowStateAfter
                                )}`}
                              </span>
                              <span className="ml-auto">
                                {relativeTime(message.createdAt)}
                              </span>
                            </div>
                            <p className="mt-2 text-sm font-medium text-foreground">
                              {message.summary}
                            </p>
                            {message.recipients.length > 0 && (
                              <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                                {message.recipients.map((recipient) => (
                                  <span
                                    key={`${message.id}:${recipient.recipientId}:${recipient.role}`}
                                    className="rounded-full border border-border px-2 py-0.5"
                                  >
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
                                    <li
                                      key={`${message.id}:${item}`}
                                      className="flex gap-2"
                                    >
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
                                    <p className="mt-2 text-sm text-foreground">
                                      {reviewHandoff.implementationSummary}
                                    </p>
                                  </div>
                                )}
                                {reviewHandoff.diffSummary && (
                                  <div className="rounded-md border border-border/70 bg-card px-3 py-3 md:col-span-2">
                                    <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                      Diff Summary
                                    </div>
                                    <p className="mt-2 text-sm text-foreground">
                                      {reviewHandoff.diffSummary}
                                    </p>
                                  </div>
                                )}
                                {[
                                  ["Changed Files", reviewHandoff.changedFiles],
                                  ["Test Results", reviewHandoff.testResults],
                                  [
                                    "Review Checklist",
                                    reviewHandoff.reviewChecklist,
                                  ],
                                  [
                                    "Residual Risks",
                                    reviewHandoff.residualRisks,
                                  ],
                                ].map(([title, items]) =>
                                  Array.isArray(items) && items.length > 0 ? (
                                    <div
                                      key={`${message.id}:${title}`}
                                      className="rounded-md border border-border/70 bg-card px-3 py-3"
                                    >
                                      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                        {title}
                                      </div>
                                      <ul className="mt-2 space-y-1 text-sm text-foreground">
                                        {items.map((item) => (
                                          <li
                                            key={`${message.id}:${title}:${item}`}
                                            className="flex gap-2"
                                          >
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
                            {changeRequest && (
                              <div className="mt-3 grid gap-3 md:grid-cols-2">
                                {changeRequest.reviewSummary && (
                                  <div className="rounded-md border border-border/70 bg-card px-3 py-3 md:col-span-2">
                                    <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                      Review Summary
                                    </div>
                                    <p className="mt-2 text-sm text-foreground">
                                      {changeRequest.reviewSummary}
                                    </p>
                                  </div>
                                )}
                                {changeRequest.requiredEvidence.length > 0 && (
                                  <div className="rounded-md border border-border/70 bg-card px-3 py-3 md:col-span-2">
                                    <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                      Required Evidence
                                    </div>
                                    <ul className="mt-2 space-y-1 text-sm text-foreground">
                                      {changeRequest.requiredEvidence.map(
                                        (item) => (
                                          <li
                                            key={`${message.id}:requiredEvidence:${item}`}
                                            className="flex gap-2"
                                          >
                                            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-foreground/40" />
                                            <span>{item}</span>
                                          </li>
                                        )
                                      )}
                                    </ul>
                                  </div>
                                )}
                                {changeRequest.changeRequests.map(
                                  (request, index) => (
                                    <div
                                      key={`${message.id}:changeRequest:${index}`}
                                      className="rounded-md border border-border/70 bg-card px-3 py-3 md:col-span-2"
                                    >
                                      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                        Change Request {index + 1}
                                      </div>
                                      {request.title && (
                                        <p className="mt-2 text-sm font-medium text-foreground">
                                          {request.title}
                                        </p>
                                      )}
                                      {request.reason && (
                                        <p className="mt-1 text-sm text-foreground">
                                          {request.reason}
                                        </p>
                                      )}
                                      {request.suggestedAction && (
                                        <p className="mt-2 text-sm text-muted-foreground">
                                          Suggested action:{" "}
                                          {request.suggestedAction}
                                        </p>
                                      )}
                                      {request.affectedFiles.length > 0 && (
                                        <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                                          {request.affectedFiles.map((item) => (
                                            <li
                                              key={`${message.id}:affected:${index}:${item}`}
                                              className="flex gap-2"
                                            >
                                              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-foreground/40" />
                                              <span>{item}</span>
                                            </li>
                                          ))}
                                        </ul>
                                      )}
                                    </div>
                                  )
                                )}
                              </div>
                            )}
                            {approvalSnapshot && (
                              <div className="mt-3 grid gap-3 md:grid-cols-2">
                                {approvalSnapshot.approvalSummary && (
                                  <div className="rounded-md border border-border/70 bg-card px-3 py-3 md:col-span-2">
                                    <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                      Approval Summary
                                    </div>
                                    <p className="mt-2 text-sm text-foreground">
                                      {approvalSnapshot.approvalSummary}
                                    </p>
                                  </div>
                                )}
                                {[
                                  [
                                    "Approval Checklist",
                                    approvalSnapshot.approvalChecklist,
                                  ],
                                  [
                                    "Verified Evidence",
                                    approvalSnapshot.verifiedEvidence,
                                  ],
                                  [
                                    "Residual Risks",
                                    approvalSnapshot.residualRisks,
                                  ],
                                  [
                                    "Follow-up Actions",
                                    approvalSnapshot.followUpActions,
                                  ],
                                ].map(([title, items]) =>
                                  Array.isArray(items) && items.length > 0 ? (
                                    <div
                                      key={`${message.id}:${title}`}
                                      className="rounded-md border border-border/70 bg-card px-3 py-3"
                                    >
                                      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                        {title}
                                      </div>
                                      <ul className="mt-2 space-y-1 text-sm text-foreground">
                                        {items.map((item) => (
                                          <li
                                            key={`${message.id}:${title}:${item}`}
                                            className="flex gap-2"
                                          >
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
                            {closeSnapshot && (
                              <div className="mt-3 grid gap-3 md:grid-cols-2">
                                {closeSnapshot.closureSummary && (
                                  <div className="rounded-md border border-border/70 bg-card px-3 py-3 md:col-span-2">
                                    <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                      Closure Summary
                                    </div>
                                    <p className="mt-2 text-sm text-foreground">
                                      {closeSnapshot.closureSummary}
                                    </p>
                                  </div>
                                )}
                                {closeSnapshot.verificationSummary && (
                                  <div className="rounded-md border border-border/70 bg-card px-3 py-3">
                                    <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                      Verification Summary
                                    </div>
                                    <p className="mt-2 text-sm text-foreground">
                                      {closeSnapshot.verificationSummary}
                                    </p>
                                  </div>
                                )}
                                {closeSnapshot.rollbackPlan && (
                                  <div className="rounded-md border border-border/70 bg-card px-3 py-3">
                                    <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                      Rollback Plan
                                    </div>
                                    <p className="mt-2 text-sm text-foreground">
                                      {closeSnapshot.rollbackPlan}
                                    </p>
                                  </div>
                                )}
                                {[
                                  [
                                    "Final Artifacts",
                                    closeSnapshot.finalArtifacts,
                                  ],
                                  [
                                    "Remaining Risks",
                                    closeSnapshot.remainingRisks,
                                  ],
                                ].map(([title, items]) =>
                                  Array.isArray(items) && items.length > 0 ? (
                                    <div
                                      key={`${message.id}:${title}`}
                                      className="rounded-md border border-border/70 bg-card px-3 py-3"
                                    >
                                      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                        {title}
                                      </div>
                                      <ul className="mt-2 space-y-1 text-sm text-foreground">
                                        {items.map((item) => (
                                          <li
                                            key={`${message.id}:${title}:${item}`}
                                            className="flex gap-2"
                                          >
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
                    <h3 className="text-sm font-semibold text-foreground">
                      Review Cycles
                    </h3>
                  </div>
                  {reviewCycles.length === 0 ? (
                    <p className="mt-3 text-sm text-muted-foreground">
                      No review cycles yet.
                    </p>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {reviewCycles.slice(0, 6).map((cycle) => (
                        <div
                          key={cycle.id}
                          className="rounded-md border border-border/80 bg-background/70 px-3 py-3 text-sm"
                        >
                          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                            <span className="rounded-full border border-border px-2 py-0.5">
                              Cycle {cycle.cycleNumber}
                            </span>
                            <span>
                              {cycle.outcome
                                ? formatProtocolValue(cycle.outcome)
                                : "Open"}
                            </span>
                            <span className="ml-auto">
                              {relativeTime(cycle.openedAt)}
                            </span>
                          </div>
                          <div className="mt-2 text-xs text-muted-foreground">
                            Reviewer{" "}
                            {cycle.reviewerAgentId
                              ? cycle.reviewerAgentId.slice(0, 8)
                              : cycle.reviewerUserId
                              ? "board"
                              : "unassigned"}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                <section className="rounded-lg border border-border bg-card px-4 py-4">
                  <div className="flex items-center gap-2">
                    <TriangleAlert className="h-4 w-4 text-muted-foreground" />
                    <h3 className="text-sm font-semibold text-foreground">
                      Escalations &amp; Recovery
                    </h3>
                  </div>
                  {protocolRecoveryAlerts.length === 0 ? (
                    <p className="mt-3 text-sm text-muted-foreground">
                      No timeout escalations or recovery guidance yet.
                    </p>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {protocolRecoveryAlerts.map((alert) => (
                        <div
                          key={alert.id}
                          className="rounded-md border border-border/80 bg-background/70 px-3 py-3 text-sm"
                        >
                          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                            <span
                              className={cn(
                                "rounded-full border px-2 py-0.5",
                                alert.severity === "critical" ||
                                  alert.severity === "high"
                                  ? "border-red-400 text-red-700"
                                  : alert.severity === "medium"
                                  ? "border-amber-400 text-amber-700"
                                  : "border-border"
                              )}
                            >
                              {formatProtocolValue(alert.statusLabel)}
                            </span>
                            <span>{formatProtocolValue(alert.kind)}</span>
                            <span>{formatProtocolValue(alert.severity)}</span>
                            <span className="ml-auto">
                              {relativeTime(alert.createdAt)}
                            </span>
                          </div>
                          <p className="mt-2 text-sm font-medium text-foreground">
                            {alert.title}
                          </p>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {alert.detail}
                          </p>
                          <div className="mt-3 rounded-md border border-border/60 bg-muted/20 px-3 py-2">
                            <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                              Recommended next action
                            </div>
                            <p className="mt-1 text-sm text-foreground">
                              {alert.recommendation}
                            </p>
                          </div>
                          {alert.metadata.length > 0 && (
                            <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                              {alert.metadata.map((entry) => (
                                <li
                                  key={`${alert.id}:${entry}`}
                                  className="flex gap-2"
                                >
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
                    <h3 className="text-sm font-semibold text-foreground">
                      Protocol Violations
                    </h3>
                  </div>
                  {protocolViolations.length === 0 ? (
                    <p className="mt-3 text-sm text-muted-foreground">
                      No protocol violations recorded.
                    </p>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {protocolViolations.slice(0, 8).map((violation) => (
                        <div
                          key={violation.id}
                          className="rounded-md border border-border/80 bg-background/70 px-3 py-3 text-sm"
                        >
                          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                            <span
                              className={cn(
                                "rounded-full border px-2 py-0.5",
                                violation.status === "open"
                                  ? "border-red-400 text-red-700"
                                  : "border-border"
                              )}
                            >
                              {formatProtocolValue(violation.status)}
                            </span>
                            <span>
                              {formatProtocolValue(violation.severity)}
                            </span>
                            <span className="ml-auto">
                              {relativeTime(violation.createdAt)}
                            </span>
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
                      <h3 className="text-sm font-semibold text-foreground">
                        Current Review Snapshot
                      </h3>
                    </div>
                    <div className="mt-3 space-y-2 text-sm text-muted-foreground">
                      <div>Latest cycle: {latestReviewCycle.cycleNumber}</div>
                      <div>
                        Outcome:{" "}
                        {latestReviewCycle.outcome
                          ? formatProtocolValue(latestReviewCycle.outcome)
                          : "Open"}
                      </div>
                      <div>
                        Submitted message:{" "}
                        {latestReviewCycle.submittedMessageId.slice(0, 8)}
                      </div>
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
                await addCommentAndReassign.mutateAsync({
                  body,
                  reopen,
                  reassignment,
                });
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
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">No sub-issues.</p>
                {!issue.parentId && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setInternalWorkItemDialogOpen(true)}
                  >
                    New subtask
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border bg-card px-4 py-4">
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                    Parent issue progress
                  </div>
                  <div className="mt-1 text-sm font-semibold text-foreground">
                    {subtaskOverview.done}/{subtaskOverview.total} subtasks closed
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-[width] duration-300"
                      style={{ width: `${subtaskProgressPercent}%` }}
                    />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                    <span className="rounded-full border border-border px-2 py-0.5">
                      {subtaskOverview.open} open
                    </span>
                    <span className="rounded-full border border-border px-2 py-0.5">
                      {subtaskOverview.blocked} blocked
                    </span>
                    <span className="rounded-full border border-border px-2 py-0.5">
                      {subtaskOverview.inReview} in review
                    </span>
                    <span className="rounded-full border border-border px-2 py-0.5">
                      {subtaskOverview.total} total
                    </span>
                  </div>
                </div>
                {!issue.parentId && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setInternalWorkItemDialogOpen(true)}
                  >
                    New subtask
                  </Button>
                )}
              </div>
              <div className="grid gap-3 xl:grid-cols-2">
                {childIssues.map((child) => {
                  const workLabel =
                    child.labels?.find((label) => label.name.startsWith("work:"))?.name.replace("work:", "") ?? null;
                  const reviewerWatch = child.labels?.some((label) => label.name === "watch:reviewer");
                  const leadWatch = child.labels?.some((label) => label.name === "watch:lead");
                  const assigneeName = child.assigneeAgentId ? agentMap.get(child.assigneeAgentId)?.name ?? null : null;

                  return (
                    <Link
                      key={child.id}
                      to={`${issueBasePath}/${child.identifier ?? child.id}`}
                      className="rounded-xl border border-border bg-card px-4 py-4 text-sm no-underline transition-colors hover:border-primary/20 hover:bg-accent/20"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <span className="font-mono">{child.identifier ?? child.id.slice(0, 8)}</span>
                            <StatusBadge status={child.status} />
                          </div>
                          <div className="mt-2 line-clamp-2 text-sm font-semibold text-foreground">
                            {child.title}
                          </div>
                        </div>
                        <div className="shrink-0">
                          <PriorityIcon priority={child.priority} />
                        </div>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {workLabel ? (
                          <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                            {workLabel}
                          </span>
                        ) : null}
                        {reviewerWatch ? (
                          <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                            Reviewer watch
                          </span>
                        ) : null}
                        {leadWatch ? (
                          <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                            Lead watch
                          </span>
                        ) : null}
                      </div>

                      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
                        <div className="flex min-w-0 items-center gap-2">
                          {assigneeName ? (
                            <Identity name={assigneeName} size="sm" />
                          ) : (
                            <span className="rounded-full border border-dashed border-border px-2 py-0.5">
                              Unassigned
                            </span>
                          )}
                        </div>
                        <span>Updated {relativeTime(child.updatedAt)}</span>
                      </div>
                    </Link>
                  );
                })}
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
                <div
                  key={evt.id}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground"
                >
                  <ActorIdentity evt={evt} agentMap={agentMap} />
                  <span>{formatAction(evt.action, evt.details)}</span>
                  <span className="ml-auto shrink-0">
                    {relativeTime(evt.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="delivery">
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground">
              Staffed delivery chain for this issue. Click an agent to inspect their profile and run history.
            </div>
            <div className="space-y-2">
              {deliveryPartySlots.map((slot) => {
                const agent = slot.agentId ? agentMap.get(slot.agentId) : null;
                const agentHref = agent ? `/agents/${agent.urlKey ?? slot.agentId}` : null;
                const toneCls =
                  slot.tone === "active" ? "border-cyan-300/70 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300"
                  : slot.tone === "done" ? "border-emerald-300/70 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                  : slot.tone === "blocked" ? "border-red-300/70 bg-red-500/10 text-red-700 dark:text-red-300"
                  : slot.tone === "waiting" ? "border-amber-300/70 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                  : "border-border bg-background text-muted-foreground";
                return (
                  <div key={slot.key} className="flex items-center gap-4 rounded-lg border border-border bg-card px-4 py-3">
                    <div className="w-20 shrink-0">
                      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{slot.label}</div>
                    </div>
                    <div className="min-w-0 flex-1">
                      {slot.agent && agentHref ? (
                        <Link to={agentHref} className="flex items-center gap-2 no-underline group">
                          <Identity name={slot.agent.name} size="sm" />
                          <span className="text-xs text-muted-foreground">
                            {slot.agent.role}{slot.agent.adapterType ? ` · ${slot.agent.adapterType.replace(/_/g, " ")}` : ""}
                          </span>
                          <span className="text-xs text-primary opacity-0 group-hover:opacity-100 transition-opacity">
                            View agent →
                          </span>
                        </Link>
                      ) : (
                        <span className="text-xs text-muted-foreground">{slot.helperText || "Unassigned"}</span>
                      )}
                    </div>
                    <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase", toneCls)}>
                      {slot.statusLabel}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="documents">
          <DocumentsPanel
            companyId={issue.companyId}
            issueId={issue.id}
            documents={issueDocuments ?? []}
            onMutated={refetchDocuments}
          />
        </TabsContent>

        <TabsContent value="deliverables">
          <DeliverablesPanel deliverables={deliverables ?? []} />
        </TabsContent>
      </Tabs>

      {linkedApprovals && linkedApprovals.length > 0 && (
        <Collapsible
          open={secondaryOpen.approvals}
          onOpenChange={(open) =>
            setSecondaryOpen((prev) => ({ ...prev, approvals: open }))
          }
          className="rounded-lg border border-border"
        >
          <CollapsibleTrigger className="flex w-full items-center justify-between px-3 py-2 text-left">
            <span className="text-sm font-medium text-muted-foreground">
              Linked Approvals ({linkedApprovals.length})
            </span>
            <ChevronDown
              className={cn(
                "h-4 w-4 text-muted-foreground transition-transform",
                secondaryOpen.approvals && "rotate-180"
              )}
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
                      {approval.type
                        .replace(/_/g, " ")
                        .replace(/\b\w/g, (c) => c.toUpperCase())}
                    </span>
                    <span className="font-mono text-muted-foreground">
                      {approval.id.slice(0, 8)}
                    </span>
                  </div>
                  <span className="text-muted-foreground">
                    {relativeTime(approval.createdAt)}
                  </span>
                </Link>
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      {linkedRuns && linkedRuns.length > 0 && (
        <Collapsible
          open={secondaryOpen.cost}
          onOpenChange={(open) =>
            setSecondaryOpen((prev) => ({ ...prev, cost: open }))
          }
          className="rounded-lg border border-border"
        >
          <CollapsibleTrigger className="flex w-full items-center justify-between px-3 py-2 text-left">
            <span className="text-sm font-medium text-muted-foreground">
              Cost Summary
            </span>
            <ChevronDown
              className={cn(
                "h-4 w-4 text-muted-foreground transition-transform",
                secondaryOpen.cost && "rotate-180"
              )}
            />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="border-t border-border px-3 py-2">
              {!issueCostSummary.hasCost && !issueCostSummary.hasTokens ? (
                <div className="text-xs text-muted-foreground">
                  No cost data yet.
                </div>
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
                        ? ` (in ${formatTokens(
                            issueCostSummary.input
                          )}, out ${formatTokens(
                            issueCostSummary.output
                          )}, cached ${formatTokens(issueCostSummary.cached)})`
                        : ` (in ${formatTokens(
                            issueCostSummary.input
                          )}, out ${formatTokens(issueCostSummary.output)})`}
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
        <SheetContent
          side="bottom"
          className="max-h-[85dvh] pb-[env(safe-area-inset-bottom)]"
        >
          <SheetHeader>
            <SheetTitle className="text-sm">Properties</SheetTitle>
          </SheetHeader>
          <ScrollArea className="flex-1 overflow-y-auto">
            <div className="px-4 pb-4">
              <IssueProperties
                issue={issue}
                onUpdate={(data) => updateIssue.mutate(data)}
                inline
              />
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>

      {issue && !issue.parentId && (
        <InternalWorkItemDialog
          open={internalWorkItemDialogOpen}
          onOpenChange={setInternalWorkItemDialogOpen}
          issue={issue}
          agents={agents ?? []}
          projects={orderedProjects}
          defaultReviewerAgentId={protocolState?.reviewerAgentId ?? null}
          defaultQaAgentId={protocolState?.qaAgentId ?? null}
        />
      )}

      {issue && isIntakeRootIssue && (
        <PmIntakeProjectionDialog
          open={intakeProjectionDialogOpen}
          onOpenChange={setIntakeProjectionDialogOpen}
          issue={issue}
          agents={agents ?? []}
          projects={orderedProjects}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Deliverables Panel                                                 */
/* ------------------------------------------------------------------ */

const DELIVERABLE_KIND_GROUP: Record<string, string> = {
  file: "Files",
  diff: "Code / Review",
  approval: "Code / Review",
  workspace_binding: "Code / Review",
  test_run: "Verification",
  build_run: "Verification",
  run_log: "Verification",
  report: "Reports",
  preview: "Reports",
};

const DELIVERABLE_GROUP_ORDER = ["Files", "Code / Review", "Verification", "Reports"];

function deliverableIcon(kind: IssueDeliverable["kind"]) {
  switch (kind) {
    case "file":
      return <AttachmentIcon className="h-3.5 w-3.5 text-muted-foreground" />;
    case "diff":
      return <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />;
    case "approval":
      return <ShieldCheck className="h-3.5 w-3.5 text-muted-foreground" />;
    case "test_run":
      return <TestTube2 className="h-3.5 w-3.5 text-muted-foreground" />;
    case "build_run":
      return <Package className="h-3.5 w-3.5 text-muted-foreground" />;
    case "workspace_binding":
      return <Terminal className="h-3.5 w-3.5 text-muted-foreground" />;
    case "run_log":
      return <ScrollText className="h-3.5 w-3.5 text-muted-foreground" />;
    case "report":
      return <ScrollText className="h-3.5 w-3.5 text-muted-foreground" />;
    case "preview":
      return <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />;
    default:
      return <AttachmentIcon className="h-3.5 w-3.5 text-muted-foreground" />;
  }
}

function DeliverablesPanel({ deliverables }: { deliverables: IssueDeliverable[] }) {
  if (deliverables.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        No deliverables yet
      </div>
    );
  }

  // Group by kind → group label
  const grouped = new Map<string, IssueDeliverable[]>();
  for (const d of deliverables) {
    const group = DELIVERABLE_KIND_GROUP[d.kind] ?? "Files";
    const list = grouped.get(group) ?? [];
    list.push(d);
    grouped.set(group, list);
  }

  return (
    <div className="space-y-4">
      {DELIVERABLE_GROUP_ORDER.filter((g) => grouped.has(g)).map((groupLabel) => (
        <div key={groupLabel}>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {groupLabel}
          </h4>
          <div className="space-y-1">
            {grouped.get(groupLabel)!.map((d) => (
              <div
                key={d.id}
                className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm"
              >
                {deliverableIcon(d.kind)}
                <span className="min-w-0 flex-1 truncate font-medium">
                  {d.href ? (
                    <a
                      href={d.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:underline"
                    >
                      {d.label}
                    </a>
                  ) : (
                    d.label
                  )}
                </span>
                <Badge variant="outline" className="shrink-0 text-[10px]">
                  {d.source === "attachment" ? "file" : "artifact"}
                </Badge>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {relativeTime(d.createdAt)}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Documents Panel
// ---------------------------------------------------------------------------

const DOCUMENT_KEY_LABELS: Record<string, string> = {
  plan: "Plan",
  spec: "Spec",
  "decision-log": "Decision Log",
  "qa-notes": "QA Notes",
  "release-note": "Release Note",
};

function DocumentsPanel({
  companyId,
  issueId,
  documents,
  onMutated,
}: {
  companyId: string;
  issueId: string;
  documents: IssueDocumentSummary[];
  onMutated: () => void;
}) {
  const { pushToast } = useToast();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [editorBody, setEditorBody] = useState("");
  const [editorTitle, setEditorTitle] = useState("");
  const [baseRevisionNumber, setBaseRevisionNumber] = useState<
    number | undefined
  >(undefined);
  const [saving, setSaving] = useState(false);
  const [showRevisions, setShowRevisions] = useState(false);
  const [newDocKey, setNewDocKey] = useState<string>("");
  const [isCreatingNew, setIsCreatingNew] = useState(false);

  // Fetch full document when a key is selected
  const { data: activeDocument, refetch: refetchDoc } = useQuery({
    queryKey: queryKeys.issues.document(issueId, selectedKey ?? "__none__"),
    queryFn: () => issuesApi.documents.get(companyId, issueId, selectedKey!),
    enabled: !!selectedKey && !isCreatingNew,
  });

  // Fetch revisions when viewing history
  const { data: revisions } = useQuery({
    queryKey: queryKeys.issues.documentRevisions(
      issueId,
      selectedKey ?? "__none__",
    ),
    queryFn: () =>
      issuesApi.documents.revisions(companyId, issueId, selectedKey!),
    enabled: !!selectedKey && showRevisions,
  });

  // Sync editor state when document loads
  useEffect(() => {
    if (activeDocument) {
      setEditorBody(activeDocument.body);
      setEditorTitle(activeDocument.title);
      setBaseRevisionNumber(activeDocument.revisionNumber);
    }
  }, [activeDocument]);

  const usedKeys = new Set(documents.map((d) => d.key));
  const availableKeys = ISSUE_DOCUMENT_KEYS.filter(
    (k) => !usedKeys.has(k),
  );

  async function handleSave() {
    if (!selectedKey) return;
    setSaving(true);
    try {
      await issuesApi.documents.upsert(companyId, issueId, selectedKey, {
        title: editorTitle || undefined,
        body: editorBody,
        baseRevisionNumber,
      });
      pushToast({ title: "Document saved", tone: "success" });
      setIsCreatingNew(false);
      onMutated();
      refetchDoc();
    } catch (err: unknown) {
      if (
        err &&
        typeof err === "object" &&
        "status" in err &&
        (err as { status: number }).status === 409
      ) {
        pushToast({
          title: "Conflict",
          body: "This document was modified by someone else. Refresh and try again.",
          tone: "error",
        });
      } else {
        pushToast({
          title: "Save failed",
          body: String((err as { message?: string })?.message ?? err),
          tone: "error",
        });
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleCreate() {
    if (!newDocKey) return;
    setIsCreatingNew(true);
    setSelectedKey(newDocKey);
    setEditorTitle(DOCUMENT_KEY_LABELS[newDocKey] ?? newDocKey);
    setEditorBody("");
    setBaseRevisionNumber(undefined);
    setNewDocKey("");
  }

  async function handleDelete() {
    if (!selectedKey) return;
    try {
      await issuesApi.documents.delete(companyId, issueId, selectedKey);
      pushToast({ title: "Document deleted", tone: "success" });
      setSelectedKey(null);
      setEditorBody("");
      setEditorTitle("");
      setBaseRevisionNumber(undefined);
      onMutated();
    } catch (err: unknown) {
      pushToast({
        title: "Delete failed",
        body: String((err as { message?: string })?.message ?? err),
        tone: "error",
      });
    }
  }

  // ------ List view (no document selected) ------
  if (!selectedKey) {
    return (
      <div className="space-y-3">
        {/* New document control */}
        {availableKeys.length > 0 && (
          <div className="flex items-center gap-2">
            <select
              value={newDocKey}
              onChange={(e) => setNewDocKey(e.target.value)}
              className="h-8 rounded-md border border-border bg-background px-2 text-sm"
            >
              <option value="">Select document type...</option>
              {availableKeys.map((k) => (
                <option key={k} value={k}>
                  {DOCUMENT_KEY_LABELS[k] ?? k}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              variant="outline"
              disabled={!newDocKey}
              onClick={handleCreate}
              className="gap-1"
            >
              <Plus className="h-3.5 w-3.5" />
              New Document
            </Button>
          </div>
        )}

        {documents.length === 0 && !newDocKey ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No documents yet. Create a plan, spec, or decision log to get
            started.
          </div>
        ) : (
          <div className="space-y-1">
            {documents.map((doc) => (
              <button
                key={doc.id}
                type="button"
                onClick={() => {
                  setSelectedKey(doc.key);
                  setShowRevisions(false);
                  setIsCreatingNew(false);
                }}
                className="flex w-full items-center gap-2 rounded-md border border-border bg-card px-3 py-2.5 text-left text-sm transition-colors hover:bg-accent/20"
              >
                <FilePenLine className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate font-medium">
                  {doc.title}
                </span>
                <Badge variant="outline" className="shrink-0 text-[10px]">
                  {doc.key}
                </Badge>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  rev {doc.revisionNumber}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {relativeTime(doc.updatedAt)}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ------ Document editor view ------
  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setSelectedKey(null);
            setShowRevisions(false);
            setIsCreatingNew(false);
          }}
          className="gap-1"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Back
        </Button>
        <Badge variant="outline" className="text-[10px]">
          {selectedKey}
        </Badge>
        {baseRevisionNumber !== undefined && (
          <span className="text-[10px] text-muted-foreground">
            rev {baseRevisionNumber}
          </span>
        )}
        <div className="flex-1" />
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setShowRevisions((v) => !v)}
          className="gap-1 text-xs"
        >
          <History className="h-3.5 w-3.5" />
          {showRevisions ? "Hide History" : "History"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={handleDelete}
          className="gap-1 text-xs text-destructive hover:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </Button>
        <Button
          size="sm"
          onClick={handleSave}
          disabled={saving}
          className="gap-1"
        >
          <Save className="h-3.5 w-3.5" />
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>

      {/* Title */}
      <input
        type="text"
        value={editorTitle}
        onChange={(e) => setEditorTitle(e.target.value)}
        placeholder="Document title"
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-semibold"
      />

      {/* Body (markdown textarea for V1) */}
      <textarea
        value={editorBody}
        onChange={(e) => setEditorBody(e.target.value)}
        placeholder="Write your document in markdown..."
        rows={16}
        className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm leading-relaxed focus:outline-none focus:ring-1 focus:ring-ring"
      />

      {/* Revision history */}
      {showRevisions && revisions && (
        <div className="space-y-2 rounded-lg border border-border bg-card p-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Revision History
          </h4>
          {revisions.length === 0 ? (
            <p className="text-xs text-muted-foreground">No revisions yet.</p>
          ) : (
            <div className="space-y-1">
              {revisions.map((rev) => (
                <button
                  key={rev.id}
                  type="button"
                  onClick={() => {
                    setEditorBody(rev.body);
                    setEditorTitle(rev.title);
                    pushToast({
                      title: `Loaded revision ${rev.revisionNumber}`,
                      tone: "info",
                    });
                  }}
                  className="flex w-full items-center gap-2 rounded-md border border-border/50 px-3 py-2 text-left text-xs transition-colors hover:bg-accent/20"
                >
                  <span className="font-medium">
                    Revision {rev.revisionNumber}
                  </span>
                  <span className="truncate text-muted-foreground" title={rev.title}>
                    {rev.title}
                  </span>
                  <span className="shrink-0 text-muted-foreground">
                    {relativeTime(rev.createdAt)}
                  </span>
                  <span className="text-muted-foreground">
                    {rev.body.length} chars
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
