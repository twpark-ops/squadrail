import { and, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import type { Db } from "@squadrail/db";
import type { IssueProtocolWorkflowState } from "@squadrail/shared";
import {
  agents,
  approvals,
  companies,
  costEvents,
  heartbeatRunEvents,
  heartbeatRuns,
  issueLabels,
  issueProtocolMessages,
  issueProtocolState,
  issueProtocolViolations,
  issueReviewCycles,
  issueTaskBriefs,
  issues,
  labels,
  projects,
  retrievalRuns,
} from "@squadrail/db";
import { issueProtocolService } from "./issue-protocol.js";
import { notFound } from "../errors.js";

const DASHBOARD_PROTOCOL_STALE_HOURS = 4;
const DASHBOARD_PROTOCOL_QUEUE_STATES = [
  "assigned",
  "accepted",
  "planning",
  "implementing",
  "submitted_for_review",
  "under_review",
  "qa_pending",
  "under_qa_review",
  "changes_requested",
  "blocked",
  "awaiting_human_decision",
  "approved",
] as const;

const DASHBOARD_BRIEF_SCOPES = ["engineer", "reviewer", "tech_lead", "closure"] as const;
const PROTOCOL_SUMMARY_WORKFLOW_STATES = [
  "backlog",
  ...DASHBOARD_PROTOCOL_QUEUE_STATES,
  "done",
  "cancelled",
] as const;

type DashboardProtocolQueueState = (typeof DASHBOARD_PROTOCOL_QUEUE_STATES)[number];
type DashboardBriefScope = (typeof DASHBOARD_BRIEF_SCOPES)[number];

export interface DashboardActorSnapshot {
  id: string;
  name: string;
  title: string | null;
  role: string;
  status: string;
}

export interface DashboardLatestMessageSnapshot {
  id: string;
  messageType: string;
  summary: string;
  senderRole: string;
  createdAt: Date;
}

export interface DashboardBriefSnapshot {
  id: string;
  briefScope: string;
  briefVersion: number;
  workflowState: string;
  retrievalRunId: string | null;
  createdAt: Date;
  preview: string;
}

export interface DashboardProtocolQueueItem {
  issueId: string;
  identifier: string | null;
  title: string;
  priority: string;
  projectId: string | null;
  projectName: string | null;
  coarseIssueStatus: string;
  workflowState: string;
  currentReviewCycle: number;
  lastTransitionAt: Date;
  stale: boolean;
  nextOwnerRole: string | null;
  blockedPhase: string | null;
  blockedCode: string | null;
  openViolationCount: number;
  highestViolationSeverity: string | null;
  techLead: DashboardActorSnapshot | null;
  engineer: DashboardActorSnapshot | null;
  reviewer: DashboardActorSnapshot | null;
  latestMessage: DashboardLatestMessageSnapshot | null;
  openReviewCycle: {
    cycleNumber: number;
    openedAt: Date;
  } | null;
  latestBriefs: Partial<Record<DashboardBriefScope, DashboardBriefSnapshot>>;
}

export interface DashboardProtocolBuckets {
  executionQueue: DashboardProtocolQueueItem[];
  reviewQueue: DashboardProtocolQueueItem[];
  handoffBlockerQueue: DashboardProtocolQueueItem[];
  blockedQueue: DashboardProtocolQueueItem[];
  humanDecisionQueue: DashboardProtocolQueueItem[];
  readyToCloseQueue: DashboardProtocolQueueItem[];
  staleQueue: DashboardProtocolQueueItem[];
  violationQueue: DashboardProtocolQueueItem[];
}

export interface DashboardRecoveryCase {
  issueId: string;
  identifier: string | null;
  title: string;
  workflowState: string;
  recoveryType: "violation" | "timeout" | "integrity" | "runtime";
  severity: string;
  code: string | null;
  summary: string;
  nextAction: string;
  createdAt: Date;
}

export interface DashboardTeamSupervisionItem {
  rootIssueId: string;
  rootIdentifier: string | null;
  rootTitle: string;
  rootProjectId: string | null;
  rootProjectName: string | null;
  workItemIssueId: string;
  workItemIdentifier: string | null;
  workItemTitle: string;
  kind: "plan" | "implementation" | "review" | "qa" | null;
  priority: string;
  issueStatus: string;
  workflowState: string | null;
  blockedCode: string | null;
  watchReviewer: boolean;
  watchLead: boolean;
  lastTransitionAt: Date | null;
  updatedAt: Date;
  summaryKind: "blocked" | "review" | "active" | "queued";
  summaryText: string;
  assignee: DashboardActorSnapshot | null;
  reviewer: DashboardActorSnapshot | null;
  techLead: DashboardActorSnapshot | null;
}

function deriveTeamWorkItemKind(labelNames: string[]) {
  if (labelNames.includes("work:plan")) return "plan" as const;
  if (labelNames.includes("work:implementation")) return "implementation" as const;
  if (labelNames.includes("work:review")) return "review" as const;
  if (labelNames.includes("work:qa")) return "qa" as const;
  return null;
}

function teamSupervisionSummaryKind(input: {
  issueStatus: string;
  workflowState: string | null;
}) {
  if (input.issueStatus === "blocked" || input.workflowState === "blocked") {
    return "blocked" as const;
  }
  if (
    input.workflowState === "submitted_for_review"
    || input.workflowState === "under_review"
    || input.workflowState === "qa_pending"
    || input.workflowState === "under_qa_review"
    || input.workflowState === "changes_requested"
    || input.issueStatus === "in_review"
  ) {
    return "review" as const;
  }
  if (
    input.issueStatus === "todo"
    || input.issueStatus === "in_progress"
    || input.workflowState === "assigned"
    || input.workflowState === "accepted"
    || input.workflowState === "planning"
    || input.workflowState === "implementing"
  ) {
    return "active" as const;
  }
  return "queued" as const;
}

function buildTeamSupervisionSummaryText(input: {
  summaryKind: "blocked" | "review" | "active" | "queued";
  blockedCode: string | null;
  latestMessageSummary: string | null;
}) {
  if (input.summaryKind === "blocked") {
    if (input.blockedCode === "dependency_wait") {
      return "Waiting for dependency issues to land before execution can resume.";
    }
    if (input.latestMessageSummary) return compactText(input.latestMessageSummary);
    return input.blockedCode ? `Blocked: ${input.blockedCode.replace(/_/g, " ")}` : "Blocked and waiting for supervisor action.";
  }
  if (input.latestMessageSummary) return compactText(input.latestMessageSummary);
  switch (input.summaryKind) {
    case "review":
      return "Waiting on reviewer, QA, or supervisor handoff.";
    case "active":
      return "Active work item under team supervision.";
    default:
      return "Queued internal work item ready for assignment or kickoff.";
  }
}

export function buildTeamSupervisionSummary(input: {
  items: DashboardTeamSupervisionItem[];
}) {
  return input.items.reduce(
    (summary, item) => {
      summary.total += 1;
      summary[item.summaryKind] += 1;
      return summary;
    },
    {
      total: 0,
      blocked: 0,
      review: 0,
      active: 0,
      queued: 0,
    },
  );
}

function recoveryRecipients(input: {
  engineerAgentId: string | null;
  reviewerAgentId: string | null;
  techLeadAgentId: string | null;
  userId: string | null;
}) {
  const recipients: Array<{
    recipientType: "agent" | "user";
    recipientId: string;
    role: "engineer" | "reviewer" | "tech_lead" | "human_board";
  }> = [];
  if (input.techLeadAgentId) {
    recipients.push({ recipientType: "agent", recipientId: input.techLeadAgentId, role: "tech_lead" });
  }
  if (input.engineerAgentId) {
    recipients.push({ recipientType: "agent", recipientId: input.engineerAgentId, role: "engineer" });
  }
  if (input.reviewerAgentId) {
    recipients.push({ recipientType: "agent", recipientId: input.reviewerAgentId, role: "reviewer" });
  }
  if (recipients.length === 0 && input.userId) {
    recipients.push({ recipientType: "user", recipientId: input.userId, role: "human_board" });
  }
  return recipients;
}

function compactText(value: string | null | undefined, max = 180) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1)}...`;
}

function severityRank(severity: string | null | undefined) {
  switch (severity) {
    case "critical":
      return 4;
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
    default:
      return 0;
  }
}

function compareQueueItems(left: DashboardProtocolQueueItem, right: DashboardProtocolQueueItem) {
  if (left.lastTransitionAt.getTime() !== right.lastTransitionAt.getTime()) {
    return left.lastTransitionAt.getTime() - right.lastTransitionAt.getTime();
  }
  return left.title.localeCompare(right.title);
}

function compareViolationQueueItems(left: DashboardProtocolQueueItem, right: DashboardProtocolQueueItem) {
  const severityDelta = severityRank(right.highestViolationSeverity) - severityRank(left.highestViolationSeverity);
  if (severityDelta !== 0) return severityDelta;
  if (right.openViolationCount !== left.openViolationCount) return right.openViolationCount - left.openViolationCount;
  return compareQueueItems(left, right);
}

function deriveNextOwnerRole(workflowState: string) {
  switch (workflowState) {
    case "assigned":
    case "accepted":
    case "planning":
    case "implementing":
    case "changes_requested":
      return "engineer";
    case "submitted_for_review":
    case "under_review":
      return "reviewer";
    case "qa_pending":
    case "under_qa_review":
      return "qa";
    case "blocked":
      return "tech_lead";
    case "awaiting_human_decision":
      return "human_board";
    case "approved":
      return "tech_lead";
    default:
      return null;
  }
}

export function buildExecutionReliabilitySummary(input: {
  runningRuns: number;
  queuedRuns: number;
  dispatchRedispatchesLast24h: number;
  dispatchTimeoutsLast24h: number;
  processLostLast24h: number;
  workspaceBlockedLast24h: number;
}) {
  return {
    runningRuns: input.runningRuns,
    queuedRuns: input.queuedRuns,
    dispatchRedispatchesLast24h: input.dispatchRedispatchesLast24h,
    dispatchTimeoutsLast24h: input.dispatchTimeoutsLast24h,
    processLostLast24h: input.processLostLast24h,
    workspaceBlockedLast24h: input.workspaceBlockedLast24h,
  };
}

export function buildDashboardAttentionSummary(input: {
  blockedQueueCount: number;
  awaitingHumanDecisionCount: number;
  staleQueueCount: number;
  staleTasks: number;
  openViolationCount: number;
  reviewQueueCount: number;
  readyToCloseCount: number;
  dispatchTimeoutsLast24h: number;
  processLostLast24h: number;
  workspaceBlockedLast24h: number;
}) {
  const runtimeRiskCount =
    input.dispatchTimeoutsLast24h
    + input.processLostLast24h
    + input.workspaceBlockedLast24h;
  const reviewPressureCount = input.reviewQueueCount + input.readyToCloseCount;
  const staleWorkCount = input.staleQueueCount + input.staleTasks;
  const urgentIssueCount =
    input.blockedQueueCount
    + input.awaitingHumanDecisionCount
    + input.openViolationCount
    + runtimeRiskCount;

  return {
    urgentIssueCount,
    reviewPressureCount,
    staleWorkCount,
    runtimeRiskCount,
  };
}

export function buildDashboardKnowledgeSummary(input: {
  totalDocuments: number;
  connectedDocuments: number;
  linkedChunks: number;
  totalLinks: number;
  activeProjects: number;
  lowConfidenceRuns7d: number;
}) {
  return {
    totalDocuments: input.totalDocuments,
    connectedDocuments: input.connectedDocuments,
    linkedChunks: input.linkedChunks,
    totalLinks: input.totalLinks,
    activeProjects: input.activeProjects,
    lowConfidenceRuns7d: input.lowConfidenceRuns7d,
  };
}

export function isProtocolDashboardStale(input: {
  workflowState: string;
  lastTransitionAt: Date;
  now?: Date;
  staleAfterHours?: number;
}) {
  if (!["assigned", "accepted", "planning", "implementing", "submitted_for_review", "under_review", "qa_pending", "under_qa_review", "approved"].includes(input.workflowState)) {
    return false;
  }

  const now = input.now ?? new Date();
  const staleAfterHours = input.staleAfterHours ?? DASHBOARD_PROTOCOL_STALE_HOURS;
  const ageMs = now.getTime() - input.lastTransitionAt.getTime();
  return ageMs >= staleAfterHours * 60 * 60 * 1000;
}

export function buildProtocolDashboardBuckets(input: {
  items: DashboardProtocolQueueItem[];
  limit?: number;
}) {
  const limit = input.limit ?? 20;
  const executionQueue = input.items
    .filter((item) => ["assigned", "accepted", "planning", "implementing"].includes(item.workflowState))
    .sort(compareQueueItems)
    .slice(0, limit);
  const reviewQueue = input.items
    .filter((item) => ["submitted_for_review", "under_review", "qa_pending", "under_qa_review", "changes_requested"].includes(item.workflowState))
    .sort(compareQueueItems)
    .slice(0, limit);
  const handoffBlockerQueue = input.items
    .filter((item) => ["qa_pending", "changes_requested", "awaiting_human_decision", "approved"].includes(item.workflowState))
    .sort(compareQueueItems)
    .slice(0, limit);
  const blockedQueue = input.items
    .filter((item) => item.workflowState === "blocked")
    .sort(compareQueueItems)
    .slice(0, limit);
  const humanDecisionQueue = input.items
    .filter((item) => item.workflowState === "awaiting_human_decision")
    .sort(compareQueueItems)
    .slice(0, limit);
  const readyToCloseQueue = input.items
    .filter((item) => item.workflowState === "approved")
    .sort(compareQueueItems)
    .slice(0, limit);
  const staleQueue = input.items
    .filter((item) => item.stale)
    .sort(compareQueueItems)
    .slice(0, limit);
  const violationQueue = input.items
    .filter((item) => item.openViolationCount > 0)
    .sort(compareViolationQueueItems)
    .slice(0, limit);

  return {
    executionQueue,
    reviewQueue,
    handoffBlockerQueue,
    blockedQueue,
    humanDecisionQueue,
    readyToCloseQueue,
    staleQueue,
    violationQueue,
  } satisfies DashboardProtocolBuckets;
}

function deriveRunIssueId(contextSnapshot: unknown) {
  const context = (contextSnapshot as Record<string, unknown> | null) ?? {};
  const issueId = typeof context.issueId === "string" ? context.issueId.trim() : "";
  const taskId = typeof context.taskId === "string" ? context.taskId.trim() : "";
  return issueId || taskId || null;
}

function runtimeRecoveryDescriptor(errorCode: string | null | undefined, message: string | null | undefined) {
  switch (errorCode) {
    case "process_lost":
      return {
        severity: "critical" as const,
        summary: compactText(message ?? "Heartbeat process disappeared before completion."),
        nextAction: "Inspect run events and host health, then retry the run or escalate to the tech lead.",
      };
    case "dispatch_timeout":
      return {
        severity: "high" as const,
        summary: compactText(message ?? "Dispatch watchdog timed out before execution started."),
        nextAction: "Inspect adapter cold-start and watchdog events, then rerun once execution can start cleanly.",
      };
    case "workspace_required":
      return {
        severity: "warning" as const,
        summary: compactText(message ?? "Implementation run was blocked because no safe isolated workspace was available."),
        nextAction: "Repair or clean the isolated workspace before retrying implementation.",
      };
    default:
      return null;
  }
}

function emptyProtocolWorkflowCounts() {
  return Object.fromEntries(PROTOCOL_SUMMARY_WORKFLOW_STATES.map((state) => [state, 0])) as Record<string, number>;
}

export function dashboardService(db: Db) {
  const protocol = issueProtocolService(db);
  async function ensureCompany(companyId: string) {
    const company = await db
      .select()
      .from(companies)
      .where(eq(companies.id, companyId))
      .then((rows) => rows[0] ?? null);

    if (!company) throw notFound("Company not found");
    return company;
  }

  return {
    summary: async (companyId: string) => {
      const company = await ensureCompany(companyId);

      const agentRows = await db
        .select({ status: agents.status, count: sql<number>`count(*)` })
        .from(agents)
        .where(eq(agents.companyId, companyId))
        .groupBy(agents.status);

      const taskRows = await db
        .select({ status: issues.status, count: sql<number>`count(*)` })
        .from(issues)
        .where(eq(issues.companyId, companyId))
        .groupBy(issues.status);

      const pendingApprovals = await db
        .select({ count: sql<number>`count(*)` })
        .from(approvals)
        .where(and(eq(approvals.companyId, companyId), eq(approvals.status, "pending")))
        .then((rows) => Number(rows[0]?.count ?? 0));

      const staleCutoff = new Date(Date.now() - 60 * 60 * 1000);
      const staleTasks = await db
        .select({ count: sql<number>`count(*)` })
        .from(issues)
        .where(
          and(
            eq(issues.companyId, companyId),
            eq(issues.status, "in_progress"),
            sql`${issues.startedAt} < ${staleCutoff.toISOString()}`,
          ),
        )
        .then((rows) => Number(rows[0]?.count ?? 0));

      const protocolStateCounts = await db
        .select({
          workflowState: issueProtocolState.workflowState,
          count: sql<number>`count(*)`,
        })
        .from(issueProtocolState)
        .innerJoin(issues, eq(issueProtocolState.issueId, issues.id))
        .where(and(eq(issueProtocolState.companyId, companyId), isNull(issues.hiddenAt)))
        .groupBy(issueProtocolState.workflowState);

      const protocolOpenViolations = await db
        .select({ count: sql<number>`count(*)` })
        .from(issueProtocolViolations)
        .where(and(eq(issueProtocolViolations.companyId, companyId), eq(issueProtocolViolations.status, "open")))
        .then((rows) => Number(rows[0]?.count ?? 0));

      const protocolMessagesLastDay = await db
        .select({ count: sql<number>`count(*)` })
        .from(issueProtocolMessages)
        .where(
          and(
            eq(issueProtocolMessages.companyId, companyId),
            gte(issueProtocolMessages.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000)),
          ),
        )
        .then((rows) => Number(rows[0]?.count ?? 0));

      const staleProtocolStateCount = await db
        .select({ count: sql<number>`count(*)` })
        .from(issueProtocolState)
        .innerJoin(issues, eq(issueProtocolState.issueId, issues.id))
        .where(
          and(
            eq(issueProtocolState.companyId, companyId),
            isNull(issues.hiddenAt),
            inArray(issueProtocolState.workflowState, [
              "assigned",
              "accepted",
              "planning",
              "implementing",
              "submitted_for_review",
              "under_review",
              "qa_pending",
              "under_qa_review",
              "approved",
            ]),
            sql`${issueProtocolState.lastTransitionAt} < ${new Date(Date.now() - DASHBOARD_PROTOCOL_STALE_HOURS * 60 * 60 * 1000).toISOString()}`,
          ),
        )
        .then((rows) => Number(rows[0]?.count ?? 0));

      const agentCounts: Record<string, number> = {
        active: 0,
        running: 0,
        paused: 0,
        error: 0,
      };
      for (const row of agentRows) {
        const count = Number(row.count);
        const bucket = row.status === "idle" ? "active" : row.status;
        agentCounts[bucket] = (agentCounts[bucket] ?? 0) + count;
      }

      const taskCounts: Record<string, number> = {
        open: 0,
        inProgress: 0,
        blocked: 0,
        done: 0,
      };
      for (const row of taskRows) {
        const count = Number(row.count);
        if (row.status === "in_progress") taskCounts.inProgress += count;
        if (row.status === "blocked") taskCounts.blocked += count;
        if (row.status === "done") taskCounts.done += count;
        if (row.status !== "done" && row.status !== "cancelled") taskCounts.open += count;
      }

      const workflowCounts = emptyProtocolWorkflowCounts();
      for (const row of protocolStateCounts) {
        workflowCounts[row.workflowState] = Number(row.count);
      }

      const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const [runningRunsRow, queuedRunsRow, redispatchesRow] = await Promise.all([
        db
          .select({ count: sql<number>`count(*)` })
          .from(heartbeatRuns)
          .where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.status, "running")))
          .then((rows) => Number(rows[0]?.count ?? 0)),
        db
          .select({ count: sql<number>`count(*)` })
          .from(heartbeatRuns)
          .where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.status, "queued")))
          .then((rows) => Number(rows[0]?.count ?? 0)),
        db
          .select({ count: sql<number>`count(*)` })
          .from(heartbeatRunEvents)
          .where(
            and(
              eq(heartbeatRunEvents.companyId, companyId),
              eq(heartbeatRunEvents.eventType, "dispatch.watchdog"),
              eq(heartbeatRunEvents.level, "warn"),
              gte(heartbeatRunEvents.createdAt, last24h),
            ),
          )
          .then((rows) => Number(rows[0]?.count ?? 0)),
      ]);
      const knowledgeSince = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const [knowledgeTotalsRows, lowConfidenceKnowledgeRuns] = await Promise.all([
        db.execute<{
          totalDocuments: number;
          totalLinks: number;
          linkedChunks: number;
          connectedDocuments: number;
          activeProjects: number;
        }>(sql`
          select
            (select count(*)::int from knowledge_documents where company_id = ${companyId}) as "totalDocuments",
            (select count(*)::int from knowledge_chunk_links where company_id = ${companyId}) as "totalLinks",
            (select count(distinct chunk_id)::int from knowledge_chunk_links where company_id = ${companyId}) as "linkedChunks",
            (
              select count(distinct kc.document_id)::int
              from knowledge_chunk_links kcl
              join knowledge_chunks kc on kc.id = kcl.chunk_id
              where kcl.company_id = ${companyId}
            ) as "connectedDocuments",
            (
              select count(distinct project_id)::int
              from knowledge_documents
              where company_id = ${companyId}
                and project_id is not null
            ) as "activeProjects"
        `),
        db
          .select({ count: sql<number>`count(*)` })
          .from(retrievalRuns)
          .where(
            and(
              eq(retrievalRuns.companyId, companyId),
              gte(retrievalRuns.createdAt, knowledgeSince),
              sql`coalesce(${retrievalRuns.queryDebug} -> 'quality' ->> 'confidenceLevel', '') = 'low'`,
            ),
          )
          .then((rows) => Number(rows[0]?.count ?? 0)),
      ]);
      const failureRows = await db
        .select({
          errorCode: heartbeatRuns.errorCode,
          count: sql<number>`count(*)`,
        })
        .from(heartbeatRuns)
        .where(
          and(
            eq(heartbeatRuns.companyId, companyId),
            gte(heartbeatRuns.createdAt, last24h),
            inArray(heartbeatRuns.errorCode, ["dispatch_timeout", "process_lost", "workspace_required"]),
          ),
        )
        .groupBy(heartbeatRuns.errorCode);
      const failureCounts = new Map(
        failureRows.map((row) => [row.errorCode ?? "", Number(row.count ?? 0)]),
      );

      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const [{ monthSpend }] = await db
        .select({
          monthSpend: sql<number>`coalesce(sum(${costEvents.costCents}), 0)::int`,
        })
        .from(costEvents)
        .where(
          and(
            eq(costEvents.companyId, companyId),
            gte(costEvents.occurredAt, monthStart),
          ),
        );

      const monthSpendCents = Number(monthSpend);
      const utilization =
        company.budgetMonthlyCents > 0
          ? (monthSpendCents / company.budgetMonthlyCents) * 100
          : 0;
      const knowledgeTotals = knowledgeTotalsRows[0] ?? {
        totalDocuments: 0,
        totalLinks: 0,
        linkedChunks: 0,
        connectedDocuments: 0,
        activeProjects: 0,
      };
      const executionReliability = buildExecutionReliabilitySummary({
        runningRuns: runningRunsRow,
        queuedRuns: queuedRunsRow,
        dispatchRedispatchesLast24h: redispatchesRow,
        dispatchTimeoutsLast24h: failureCounts.get("dispatch_timeout") ?? 0,
        processLostLast24h: failureCounts.get("process_lost") ?? 0,
        workspaceBlockedLast24h: failureCounts.get("workspace_required") ?? 0,
      });
      const protocolSummary = {
        workflowCounts,
        executionQueueCount:
          workflowCounts.assigned
          + workflowCounts.accepted
          + workflowCounts.planning
          + workflowCounts.implementing,
        reviewQueueCount:
          workflowCounts.submitted_for_review
          + workflowCounts.under_review
          + workflowCounts.qa_pending
          + workflowCounts.under_qa_review
          + workflowCounts.changes_requested,
        handoffBlockerCount:
          workflowCounts.qa_pending
          + workflowCounts.under_qa_review
          + workflowCounts.changes_requested
          + workflowCounts.awaiting_human_decision
          + workflowCounts.approved,
        blockedQueueCount: workflowCounts.blocked,
        awaitingHumanDecisionCount: workflowCounts.awaiting_human_decision,
        readyToCloseCount: workflowCounts.approved,
        staleQueueCount: staleProtocolStateCount,
        openViolationCount: protocolOpenViolations,
        protocolMessagesLast24h: protocolMessagesLastDay,
      };

      return {
        companyId,
        agents: {
          active: agentCounts.active,
          running: agentCounts.running,
          paused: agentCounts.paused,
          error: agentCounts.error,
        },
        tasks: taskCounts,
        protocol: protocolSummary,
        executionReliability,
        attention: buildDashboardAttentionSummary({
          blockedQueueCount: protocolSummary.blockedQueueCount,
          awaitingHumanDecisionCount: protocolSummary.awaitingHumanDecisionCount,
          staleQueueCount: protocolSummary.staleQueueCount,
          staleTasks,
          openViolationCount: protocolSummary.openViolationCount,
          reviewQueueCount: protocolSummary.reviewQueueCount,
          readyToCloseCount: protocolSummary.readyToCloseCount,
          dispatchTimeoutsLast24h: executionReliability.dispatchTimeoutsLast24h,
          processLostLast24h: executionReliability.processLostLast24h,
          workspaceBlockedLast24h: executionReliability.workspaceBlockedLast24h,
        }),
        knowledge: buildDashboardKnowledgeSummary({
          totalDocuments: Number(knowledgeTotals.totalDocuments ?? 0),
          connectedDocuments: Number(knowledgeTotals.connectedDocuments ?? 0),
          linkedChunks: Number(knowledgeTotals.linkedChunks ?? 0),
          totalLinks: Number(knowledgeTotals.totalLinks ?? 0),
          activeProjects: Number(knowledgeTotals.activeProjects ?? 0),
          lowConfidenceRuns7d: lowConfidenceKnowledgeRuns,
        }),
        costs: {
          monthSpendCents,
          monthBudgetCents: company.budgetMonthlyCents,
          monthUtilizationPercent: Number(utilization.toFixed(2)),
        },
        pendingApprovals,
        staleTasks,
      };
    },

    protocolQueue: async (input: {
      companyId: string;
      limit?: number;
    }) => {
      await ensureCompany(input.companyId);
      const limit = input.limit ?? 20;

      const stateRows = await db
        .select({
          issueId: issueProtocolState.issueId,
          workflowState: issueProtocolState.workflowState,
          coarseIssueStatus: issueProtocolState.coarseIssueStatus,
          techLeadAgentId: issueProtocolState.techLeadAgentId,
          primaryEngineerAgentId: issueProtocolState.primaryEngineerAgentId,
          reviewerAgentId: issueProtocolState.reviewerAgentId,
          currentReviewCycle: issueProtocolState.currentReviewCycle,
          lastProtocolMessageId: issueProtocolState.lastProtocolMessageId,
          lastTransitionAt: issueProtocolState.lastTransitionAt,
          blockedPhase: issueProtocolState.blockedPhase,
          blockedCode: issueProtocolState.blockedCode,
          issueIdentifier: issues.identifier,
          issueTitle: issues.title,
          issuePriority: issues.priority,
          projectId: issues.projectId,
          projectName: projects.name,
        })
        .from(issueProtocolState)
        .innerJoin(issues, eq(issueProtocolState.issueId, issues.id))
        .leftJoin(projects, eq(issues.projectId, projects.id))
        .where(
          and(
            eq(issueProtocolState.companyId, input.companyId),
            isNull(issues.hiddenAt),
            inArray(issueProtocolState.workflowState, [...DASHBOARD_PROTOCOL_QUEUE_STATES]),
          ),
        )
        .orderBy(issueProtocolState.lastTransitionAt);

      if (stateRows.length === 0) {
        return {
          companyId: input.companyId,
          generatedAt: new Date().toISOString(),
          buckets: buildProtocolDashboardBuckets({ items: [], limit }),
        };
      }

      const issueIds = stateRows.map((row) => row.issueId);
      const agentIds = Array.from(new Set(
        stateRows.flatMap((row) => [
          row.techLeadAgentId,
          row.primaryEngineerAgentId,
          row.reviewerAgentId,
        ]).filter((value): value is string => typeof value === "string"),
      ));
      const messageIds = Array.from(new Set(
        stateRows.map((row) => row.lastProtocolMessageId).filter((value): value is string => typeof value === "string"),
      ));

      const [agentRows, messageRows, violationRows, reviewCycleRows, briefRows] = await Promise.all([
        agentIds.length === 0
          ? Promise.resolve([])
          : db
            .select()
            .from(agents)
            .where(inArray(agents.id, agentIds)),
        messageIds.length === 0
          ? Promise.resolve([])
          : db
            .select()
            .from(issueProtocolMessages)
            .where(inArray(issueProtocolMessages.id, messageIds)),
        db
          .select({
            issueId: issueProtocolViolations.issueId,
            severity: issueProtocolViolations.severity,
          })
          .from(issueProtocolViolations)
          .where(
            and(
              eq(issueProtocolViolations.companyId, input.companyId),
              eq(issueProtocolViolations.status, "open"),
              inArray(issueProtocolViolations.issueId, issueIds),
            ),
          ),
        db
          .select({
            issueId: issueReviewCycles.issueId,
            cycleNumber: issueReviewCycles.cycleNumber,
            openedAt: issueReviewCycles.openedAt,
          })
          .from(issueReviewCycles)
          .where(
            and(
              eq(issueReviewCycles.companyId, input.companyId),
              isNull(issueReviewCycles.closedAt),
              inArray(issueReviewCycles.issueId, issueIds),
            ),
          ),
        db
          .select({
            id: issueTaskBriefs.id,
            issueId: issueTaskBriefs.issueId,
            briefScope: issueTaskBriefs.briefScope,
            briefVersion: issueTaskBriefs.briefVersion,
            workflowState: issueTaskBriefs.workflowState,
            retrievalRunId: issueTaskBriefs.retrievalRunId,
            contentMarkdown: issueTaskBriefs.contentMarkdown,
            createdAt: issueTaskBriefs.createdAt,
          })
          .from(issueTaskBriefs)
          .where(
            and(
              eq(issueTaskBriefs.companyId, input.companyId),
              inArray(issueTaskBriefs.issueId, issueIds),
              inArray(issueTaskBriefs.briefScope, [...DASHBOARD_BRIEF_SCOPES]),
            ),
          )
          .orderBy(desc(issueTaskBriefs.createdAt), desc(issueTaskBriefs.briefVersion)),
      ]);

      const agentMap = new Map(agentRows.map((agent) => [agent.id, agent]));
      const messageMap = new Map(messageRows.map((message) => [message.id, message]));

      const violationMap = new Map<string, { count: number; highestSeverity: string | null }>();
      for (const row of violationRows) {
        const current = violationMap.get(row.issueId) ?? { count: 0, highestSeverity: null };
        current.count += 1;
        if (severityRank(row.severity) > severityRank(current.highestSeverity)) {
          current.highestSeverity = row.severity;
        }
        violationMap.set(row.issueId, current);
      }

      const reviewCycleMap = new Map(reviewCycleRows.map((row) => [row.issueId, row]));

      const briefMap = new Map<string, Partial<Record<DashboardBriefScope, DashboardBriefSnapshot>>>();
      for (const row of briefRows) {
        if (!DASHBOARD_BRIEF_SCOPES.includes(row.briefScope as DashboardBriefScope)) continue;
        const current = briefMap.get(row.issueId) ?? {};
        if (current[row.briefScope as DashboardBriefScope]) continue;
        current[row.briefScope as DashboardBriefScope] = {
          id: row.id,
          briefScope: row.briefScope,
          briefVersion: row.briefVersion,
          workflowState: row.workflowState,
          retrievalRunId: row.retrievalRunId ?? null,
          createdAt: row.createdAt,
          preview: compactText(row.contentMarkdown),
        };
        briefMap.set(row.issueId, current);
      }

      const items = stateRows.map((row) => {
        const violationSummary = violationMap.get(row.issueId) ?? { count: 0, highestSeverity: null };
        const techLead = row.techLeadAgentId ? agentMap.get(row.techLeadAgentId) ?? null : null;
        const engineer = row.primaryEngineerAgentId ? agentMap.get(row.primaryEngineerAgentId) ?? null : null;
        const reviewer = row.reviewerAgentId ? agentMap.get(row.reviewerAgentId) ?? null : null;
        const latestMessage = row.lastProtocolMessageId ? messageMap.get(row.lastProtocolMessageId) ?? null : null;
        const openReviewCycle = reviewCycleMap.get(row.issueId) ?? null;
        const latestBriefs = briefMap.get(row.issueId) ?? {};

        return {
          issueId: row.issueId,
          identifier: row.issueIdentifier,
          title: row.issueTitle,
          priority: row.issuePriority,
          projectId: row.projectId,
          projectName: row.projectName ?? null,
          coarseIssueStatus: row.coarseIssueStatus,
          workflowState: row.workflowState,
          currentReviewCycle: row.currentReviewCycle,
          lastTransitionAt: row.lastTransitionAt,
          stale: isProtocolDashboardStale({
            workflowState: row.workflowState,
            lastTransitionAt: row.lastTransitionAt,
          }),
          nextOwnerRole: deriveNextOwnerRole(row.workflowState),
          blockedPhase: row.blockedPhase ?? null,
          blockedCode: row.blockedCode ?? null,
          openViolationCount: violationSummary.count,
          highestViolationSeverity: violationSummary.highestSeverity,
          techLead: techLead
            ? {
              id: techLead.id,
              name: techLead.name,
              title: techLead.title ?? null,
              role: techLead.role,
              status: techLead.status,
            }
            : null,
          engineer: engineer
            ? {
              id: engineer.id,
              name: engineer.name,
              title: engineer.title ?? null,
              role: engineer.role,
              status: engineer.status,
            }
            : null,
          reviewer: reviewer
            ? {
              id: reviewer.id,
              name: reviewer.name,
              title: reviewer.title ?? null,
              role: reviewer.role,
              status: reviewer.status,
            }
            : null,
          latestMessage: latestMessage
            ? {
              id: latestMessage.id,
              messageType: latestMessage.messageType,
              summary: latestMessage.summary,
              senderRole: latestMessage.senderRole,
              createdAt: latestMessage.createdAt,
            }
            : null,
          openReviewCycle: openReviewCycle
            ? {
              cycleNumber: openReviewCycle.cycleNumber,
              openedAt: openReviewCycle.openedAt,
            }
            : null,
          latestBriefs,
        } satisfies DashboardProtocolQueueItem;
      });

      return {
        companyId: input.companyId,
        generatedAt: new Date().toISOString(),
        totalActiveIssues: items.length,
        buckets: buildProtocolDashboardBuckets({
          items,
          limit,
        }),
      };
    },

    teamSupervision: async (input: {
      companyId: string;
      limit?: number;
    }) => {
      await ensureCompany(input.companyId);
      const limit = input.limit ?? 20;

      const rows = await db
        .select({
          issueId: issues.id,
          parentId: issues.parentId,
          identifier: issues.identifier,
          title: issues.title,
          priority: issues.priority,
          status: issues.status,
          assigneeAgentId: issues.assigneeAgentId,
          updatedAt: issues.updatedAt,
          workflowState: issueProtocolState.workflowState,
          reviewerAgentId: issueProtocolState.reviewerAgentId,
          techLeadAgentId: issueProtocolState.techLeadAgentId,
          blockedCode: issueProtocolState.blockedCode,
          lastTransitionAt: issueProtocolState.lastTransitionAt,
          lastProtocolMessageId: issueProtocolState.lastProtocolMessageId,
        })
        .from(issues)
        .leftJoin(issueProtocolState, eq(issueProtocolState.issueId, issues.id))
        .where(
          and(
            eq(issues.companyId, input.companyId),
            inArray(issues.status, ["backlog", "todo", "in_progress", "in_review", "blocked"]),
            sql`${issues.hiddenAt} is not null`,
          ),
        )
        .orderBy(desc(issueProtocolState.lastTransitionAt), desc(issues.updatedAt));

      if (rows.length === 0) {
        return {
          companyId: input.companyId,
          generatedAt: new Date().toISOString(),
          summary: buildTeamSupervisionSummary({ items: [] }),
          items: [] as DashboardTeamSupervisionItem[],
        };
      }

      const workItemIds = rows.map((row) => row.issueId);
      const parentIds = Array.from(new Set(
        rows.map((row) => row.parentId).filter((value): value is string => typeof value === "string"),
      ));
      const agentIds = Array.from(new Set(
        rows.flatMap((row) => [row.assigneeAgentId, row.reviewerAgentId, row.techLeadAgentId])
          .filter((value): value is string => typeof value === "string"),
      ));
      const messageIds = Array.from(new Set(
        rows.map((row) => row.lastProtocolMessageId).filter((value): value is string => typeof value === "string"),
      ));

      const [rootRows, labelRows, agentRows, messageRows] = await Promise.all([
        parentIds.length === 0
          ? Promise.resolve([])
          : db
            .select({
              id: issues.id,
              identifier: issues.identifier,
              title: issues.title,
              projectId: issues.projectId,
              projectName: projects.name,
            })
            .from(issues)
            .leftJoin(projects, eq(issues.projectId, projects.id))
            .where(inArray(issues.id, parentIds)),
        db
          .select({
            issueId: issueLabels.issueId,
            name: labels.name,
          })
          .from(issueLabels)
          .innerJoin(labels, eq(issueLabels.labelId, labels.id))
          .where(inArray(issueLabels.issueId, workItemIds)),
        agentIds.length === 0
          ? Promise.resolve([])
          : db
            .select()
            .from(agents)
            .where(inArray(agents.id, agentIds)),
        messageIds.length === 0
          ? Promise.resolve([])
          : db
            .select({
              id: issueProtocolMessages.id,
              summary: issueProtocolMessages.summary,
            })
            .from(issueProtocolMessages)
            .where(inArray(issueProtocolMessages.id, messageIds)),
      ]);

      const rootMap = new Map(rootRows.map((row) => [row.id, row]));
      const agentMap = new Map(agentRows.map((agent) => [agent.id, agent]));
      const messageMap = new Map(messageRows.map((message) => [message.id, message]));
      const labelMap = new Map<string, string[]>();

      for (const row of labelRows) {
        const existing = labelMap.get(row.issueId);
        if (existing) existing.push(row.name);
        else labelMap.set(row.issueId, [row.name]);
      }

      const items = rows
        .flatMap((row) => {
          if (!row.parentId) return [];
          const root = rootMap.get(row.parentId);
          if (!root) return [];
          const labelNames = labelMap.get(row.issueId) ?? [];
          const summaryKind = teamSupervisionSummaryKind({
            issueStatus: row.status,
            workflowState: row.workflowState ?? null,
          });
          const latestMessageSummary =
            row.lastProtocolMessageId ? (messageMap.get(row.lastProtocolMessageId)?.summary ?? null) : null;
          const assignee = row.assigneeAgentId ? agentMap.get(row.assigneeAgentId) ?? null : null;
          const reviewer = row.reviewerAgentId ? agentMap.get(row.reviewerAgentId) ?? null : null;
          const techLead = row.techLeadAgentId ? agentMap.get(row.techLeadAgentId) ?? null : null;

          return [{
            rootIssueId: root.id,
            rootIdentifier: root.identifier ?? null,
            rootTitle: root.title,
            rootProjectId: root.projectId ?? null,
            rootProjectName: root.projectName ?? null,
            workItemIssueId: row.issueId,
            workItemIdentifier: row.identifier ?? null,
            workItemTitle: row.title,
            kind: deriveTeamWorkItemKind(labelNames),
            priority: row.priority,
            issueStatus: row.status,
            workflowState: row.workflowState ?? null,
            blockedCode: row.blockedCode ?? null,
            watchReviewer: labelNames.includes("watch:reviewer"),
            watchLead: labelNames.includes("watch:lead"),
            lastTransitionAt: row.lastTransitionAt ?? null,
            updatedAt: row.updatedAt,
            summaryKind,
            summaryText: buildTeamSupervisionSummaryText({
              summaryKind,
              blockedCode: row.blockedCode ?? null,
              latestMessageSummary,
            }),
            assignee: assignee
              ? {
                  id: assignee.id,
                  name: assignee.name,
                  title: assignee.title ?? null,
                  role: assignee.role,
                  status: assignee.status,
                }
              : null,
            reviewer: reviewer
              ? {
                  id: reviewer.id,
                  name: reviewer.name,
                  title: reviewer.title ?? null,
                  role: reviewer.role,
                  status: reviewer.status,
                }
              : null,
            techLead: techLead
              ? {
                  id: techLead.id,
                  name: techLead.name,
                  title: techLead.title ?? null,
                  role: techLead.role,
                  status: techLead.status,
                }
              : null,
          } satisfies DashboardTeamSupervisionItem];
        })
        .sort((left, right) => {
          const rank = { blocked: 0, review: 1, active: 2, queued: 3 } as const;
          if (rank[left.summaryKind] !== rank[right.summaryKind]) {
            return rank[left.summaryKind] - rank[right.summaryKind];
          }
          const leftTime = left.lastTransitionAt?.getTime() ?? left.updatedAt.getTime();
          const rightTime = right.lastTransitionAt?.getTime() ?? right.updatedAt.getTime();
          return rightTime - leftTime;
        })
        .slice(0, limit);

      return {
        companyId: input.companyId,
        generatedAt: new Date().toISOString(),
        summary: buildTeamSupervisionSummary({ items }),
        items,
      };
    },

    recoveryQueue: async (input: {
      companyId: string;
      limit?: number;
    }) => {
      await ensureCompany(input.companyId);
      const limit = input.limit ?? 20;

      const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const [violationRows, timeoutRows, integrityRows, runtimeRows] = await Promise.all([
        db
          .select({
            issueId: issueProtocolViolations.issueId,
            createdAt: issueProtocolViolations.createdAt,
            severity: issueProtocolViolations.severity,
            code: issueProtocolViolations.violationCode,
            summary: issueProtocolViolations.details,
          })
          .from(issueProtocolViolations)
          .where(
            and(
              eq(issueProtocolViolations.companyId, input.companyId),
              eq(issueProtocolViolations.status, "open"),
            ),
          )
          .orderBy(desc(issueProtocolViolations.createdAt)),
        db
          .select({
            issueId: issueProtocolMessages.issueId,
            createdAt: issueProtocolMessages.createdAt,
            summary: issueProtocolMessages.summary,
            code: sql<string | null>`${issueProtocolMessages.payload} ->> 'timeoutCode'`,
          })
          .from(issueProtocolMessages)
          .where(
            and(
              eq(issueProtocolMessages.companyId, input.companyId),
              eq(issueProtocolMessages.messageType, "TIMEOUT_ESCALATION"),
            ),
          )
          .orderBy(desc(issueProtocolMessages.createdAt)),
        db
          .select({
            issueId: issueProtocolMessages.issueId,
            createdAt: sql<Date>`max(${issueProtocolMessages.createdAt})`,
            unsignedCount: sql<number>`count(*)`,
          })
          .from(issueProtocolMessages)
          .where(
            and(
              eq(issueProtocolMessages.companyId, input.companyId),
              or(isNull(issueProtocolMessages.integritySignature), isNull(issueProtocolMessages.integrityAlgorithm)),
            ),
          )
          .groupBy(issueProtocolMessages.issueId),
        db
          .select({
            id: heartbeatRuns.id,
            contextSnapshot: heartbeatRuns.contextSnapshot,
            errorCode: heartbeatRuns.errorCode,
            error: heartbeatRuns.error,
            finishedAt: heartbeatRuns.finishedAt,
            updatedAt: heartbeatRuns.updatedAt,
          })
          .from(heartbeatRuns)
          .where(
            and(
              eq(heartbeatRuns.companyId, input.companyId),
              inArray(heartbeatRuns.errorCode, ["dispatch_timeout", "process_lost", "workspace_required"]),
              gte(heartbeatRuns.updatedAt, last24h),
            ),
          )
          .orderBy(desc(heartbeatRuns.updatedAt)),
      ]);

      const dedupedRuntimeRows = new Map<string, (typeof runtimeRows)[number]>();
      for (const row of runtimeRows) {
        const issueId = deriveRunIssueId(row.contextSnapshot);
        if (!issueId) continue;
        const key = `${issueId}:${row.errorCode ?? "unknown"}`;
        if (!dedupedRuntimeRows.has(key)) {
          dedupedRuntimeRows.set(key, row);
        }
      }

      const referencedIssueIds = Array.from(new Set([
        ...violationRows.map((row) => row.issueId),
        ...timeoutRows.map((row) => row.issueId),
        ...integrityRows.map((row) => row.issueId),
        ...Array.from(dedupedRuntimeRows.values()).map((row) => deriveRunIssueId(row.contextSnapshot)).filter((value): value is string => Boolean(value)),
      ]));
      if (referencedIssueIds.length === 0) {
        return {
          companyId: input.companyId,
          generatedAt: new Date().toISOString(),
          items: [] as DashboardRecoveryCase[],
        };
      }

      const issueRows = await db
        .select({
          issueId: issueProtocolState.issueId,
          workflowState: issueProtocolState.workflowState,
          identifier: issues.identifier,
          title: issues.title,
        })
        .from(issueProtocolState)
        .innerJoin(issues, eq(issueProtocolState.issueId, issues.id))
        .where(
          and(
            eq(issueProtocolState.companyId, input.companyId),
            inArray(issueProtocolState.issueId, referencedIssueIds),
          ),
        );

      const issueMap = new Map(issueRows.map((row) => [row.issueId, row]));
      const cases: DashboardRecoveryCase[] = [];

      for (const row of violationRows) {
        const issue = issueMap.get(row.issueId);
        if (!issue) continue;
        const details = (row.summary as Record<string, unknown> | null) ?? {};
        cases.push({
          issueId: row.issueId,
          identifier: issue.identifier,
          title: issue.title,
          workflowState: issue.workflowState,
          recoveryType: "violation",
          severity: row.severity,
          code: row.code,
          summary: compactText(String(details.error ?? details.messageType ?? row.code ?? "Protocol violation detected")),
          nextAction: "Open the issue, inspect the violation payload, and post the corrective protocol message.",
          createdAt: row.createdAt,
        });
      }

      for (const row of timeoutRows) {
        const issue = issueMap.get(row.issueId);
        if (!issue) continue;
        cases.push({
          issueId: row.issueId,
          identifier: issue.identifier,
          title: issue.title,
          workflowState: issue.workflowState,
          recoveryType: "timeout",
          severity: "warning",
          code: row.code,
          summary: compactText(row.summary),
          nextAction: "Open the issue, review the stale owner, and either unblock, reassign, or close the task.",
          createdAt: row.createdAt,
        });
      }

      for (const row of integrityRows) {
        const issue = issueMap.get(row.issueId);
        if (!issue) continue;
        cases.push({
          issueId: row.issueId,
          identifier: issue.identifier,
          title: issue.title,
          workflowState: issue.workflowState,
          recoveryType: "integrity",
          severity: "warning",
          code: "legacy_unsealed",
          summary: `${row.unsignedCount} protocol messages are missing integrity signatures.`,
          nextAction: "Inspect the issue timeline and re-run or archive legacy protocol messages before audit export.",
          createdAt: row.createdAt,
        });
      }

      for (const row of dedupedRuntimeRows.values()) {
        const issueId = deriveRunIssueId(row.contextSnapshot);
        if (!issueId) continue;
        const issue = issueMap.get(issueId);
        if (!issue) continue;
        const descriptor = runtimeRecoveryDescriptor(row.errorCode, row.error);
        if (!descriptor) continue;
        cases.push({
          issueId,
          identifier: issue.identifier,
          title: issue.title,
          workflowState: issue.workflowState,
          recoveryType: "runtime",
          severity: descriptor.severity,
          code: row.errorCode,
          summary: descriptor.summary,
          nextAction: descriptor.nextAction,
          createdAt: row.finishedAt ?? row.updatedAt,
        });
      }

      cases.sort((left, right) => {
        const severityDelta = severityRank(right.severity) - severityRank(left.severity);
        if (severityDelta !== 0) return severityDelta;
        return right.createdAt.getTime() - left.createdAt.getTime();
      });

      return {
        companyId: input.companyId,
        generatedAt: new Date().toISOString(),
        items: cases.slice(0, limit),
      };
    },

    applyRecoveryAction: async (input: {
      companyId: string;
      actionType: "resolve_violations" | "post_recovery_note";
      issueIds: string[];
      recoveryTypes?: Array<DashboardRecoveryCase["recoveryType"]>;
      noteBody?: string | null;
      actor: {
        userId: string | null;
      };
    }) => {
      await ensureCompany(input.companyId);

      if (input.issueIds.length === 0) {
        return {
          actionType: input.actionType,
          issueIds: [],
          affectedViolationCount: 0,
          createdMessageCount: 0,
        };
      }

      let affectedViolationCount = 0;
      let createdMessageCount = 0;

      if (input.actionType === "resolve_violations") {
        if (!input.recoveryTypes || input.recoveryTypes.includes("violation")) {
          const updated = await db
            .update(issueProtocolViolations)
            .set({
              status: "resolved",
              resolvedAt: new Date(),
            })
            .where(
              and(
                eq(issueProtocolViolations.companyId, input.companyId),
                eq(issueProtocolViolations.status, "open"),
                inArray(issueProtocolViolations.issueId, input.issueIds),
              ),
            )
            .returning({ id: issueProtocolViolations.id });
          affectedViolationCount = updated.length;
        }
      }

      if (input.actionType === "post_recovery_note" && input.actor.userId && input.noteBody?.trim()) {
        const stateRows = await db
          .select({
            issueId: issueProtocolState.issueId,
            workflowState: issueProtocolState.workflowState,
            engineerAgentId: issueProtocolState.primaryEngineerAgentId,
            reviewerAgentId: issueProtocolState.reviewerAgentId,
            techLeadAgentId: issueProtocolState.techLeadAgentId,
          })
          .from(issueProtocolState)
          .where(
            and(
              eq(issueProtocolState.companyId, input.companyId),
              inArray(issueProtocolState.issueId, input.issueIds),
            ),
          );
        const stateByIssueId = new Map(stateRows.map((row) => [row.issueId, row]));

        for (const issueId of input.issueIds) {
          const state = stateByIssueId.get(issueId);
          const workflowState =
            (state?.workflowState as IssueProtocolWorkflowState | null | undefined) ?? "backlog";
          const recipients = recoveryRecipients({
            engineerAgentId: state?.engineerAgentId ?? null,
            reviewerAgentId: state?.reviewerAgentId ?? null,
            techLeadAgentId: state?.techLeadAgentId ?? null,
            userId: input.actor.userId,
          });
          if (recipients.length === 0) continue;

          await protocol.appendMessage({
            issueId,
            authorUserId: input.actor.userId,
            message: {
              messageType: "NOTE",
              sender: {
                actorType: "user",
                actorId: input.actor.userId,
                role: "human_board",
              },
              recipients,
              workflowStateBefore: workflowState,
              workflowStateAfter: workflowState,
              summary: "Board recovery note",
              requiresAck: false,
              payload: {
                noteType: "context",
                body: input.noteBody.trim(),
              },
              artifacts: [],
            },
          });
          createdMessageCount += 1;
        }
      }

      return {
        actionType: input.actionType,
        issueIds: input.issueIds,
        affectedViolationCount,
        createdMessageCount,
      };
    },
  };
}
