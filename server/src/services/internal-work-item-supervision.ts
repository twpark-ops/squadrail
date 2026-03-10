import { and, asc, eq } from "drizzle-orm";
import { issueLabels, issueProtocolState, issues, labels, type Db } from "@squadrail/db";

export const INTERNAL_WORK_ITEM_TEAM_LABEL = "team:internal";
export const INTERNAL_WORK_ITEM_WATCH_REVIEWER_LABEL = "watch:reviewer";
export const INTERNAL_WORK_ITEM_WATCH_LEAD_LABEL = "watch:lead";

const INTERNAL_WORK_ITEM_KIND_LABELS = ["work:plan", "work:implementation", "work:review", "work:qa"] as const;

const LEAD_SUPERVISOR_PROTOCOL_REASON_BY_MESSAGE_TYPE: Record<string, string> = {
  ACK_ASSIGNMENT: "issue_supervisor_assignment_acknowledged",
  ASK_CLARIFICATION: "issue_supervisor_clarification_requested",
  ESCALATE_BLOCKER: "issue_supervisor_blocker_escalated",
  SUBMIT_FOR_REVIEW: "issue_supervisor_review_submitted",
  REQUEST_CHANGES: "issue_supervisor_changes_requested",
  APPROVE_IMPLEMENTATION: "issue_supervisor_implementation_approved",
  TIMEOUT_ESCALATION: "issue_supervisor_timeout_escalated",
};

export interface InternalWorkItemSupervisorContext {
  issueId: string;
  parentId: string | null;
  hiddenAt: Date | null;
  labelNames: string[];
  techLeadAgentId: string | null;
  reviewerAgentId?: string | null;
  qaAgentId?: string | null;
  primaryEngineerAgentId?: string | null;
}

function normalizeLabelNames(labelNames: string[] | null | undefined) {
  return [...new Set((labelNames ?? []).filter((label): label is string => Boolean(label)).map((label) => label.trim()))];
}

function hasLabel(context: Pick<InternalWorkItemSupervisorContext, "labelNames"> | null | undefined, labelName: string) {
  if (!context) return false;
  return normalizeLabelNames(context.labelNames).includes(labelName);
}

export function loadInternalWorkItemSupervisorContext(
  db: Db,
  companyId: string,
  issueId: string,
): Promise<InternalWorkItemSupervisorContext | null> {
  return (async () => {
    const [issueRow, labelRows] = await Promise.all([
      db
        .select({
          issueId: issues.id,
          parentId: issues.parentId,
          hiddenAt: issues.hiddenAt,
          techLeadAgentId: issueProtocolState.techLeadAgentId,
          reviewerAgentId: issueProtocolState.reviewerAgentId,
          qaAgentId: issueProtocolState.qaAgentId,
          primaryEngineerAgentId: issueProtocolState.primaryEngineerAgentId,
        })
        .from(issues)
        .leftJoin(issueProtocolState, eq(issueProtocolState.issueId, issues.id))
        .where(and(eq(issues.companyId, companyId), eq(issues.id, issueId)))
        .limit(1)
        .then((rows) => rows[0] ?? null),
      db
        .select({
          name: labels.name,
        })
        .from(issueLabels)
        .innerJoin(labels, eq(labels.id, issueLabels.labelId))
        .where(and(eq(issueLabels.companyId, companyId), eq(issueLabels.issueId, issueId)))
        .orderBy(asc(labels.name), asc(labels.id)),
    ]);

    if (!issueRow) return null;

    return {
      issueId: issueRow.issueId,
      parentId: issueRow.parentId,
      hiddenAt: issueRow.hiddenAt,
      techLeadAgentId: issueRow.techLeadAgentId ?? null,
      reviewerAgentId: issueRow.reviewerAgentId ?? null,
      qaAgentId: issueRow.qaAgentId ?? null,
      primaryEngineerAgentId: issueRow.primaryEngineerAgentId ?? null,
      labelNames: normalizeLabelNames(labelRows.map((row) => row.name)),
    };
  })();
}

export function isInternalWorkItemContext(context: InternalWorkItemSupervisorContext | null | undefined) {
  if (!context?.parentId) return false;
  return Boolean(context.hiddenAt) || hasLabel(context, INTERNAL_WORK_ITEM_TEAM_LABEL);
}

export function getInternalWorkItemKind(
  context: Pick<InternalWorkItemSupervisorContext, "labelNames"> | null | undefined,
): "plan" | "implementation" | "review" | "qa" | null {
  const labelName = INTERNAL_WORK_ITEM_KIND_LABELS.find((candidate) => hasLabel(context, candidate));
  if (!labelName) return null;
  return labelName.slice("work:".length) as "plan" | "implementation" | "review" | "qa";
}

export function isReviewerWatchEnabled(context: InternalWorkItemSupervisorContext | null | undefined) {
  return isInternalWorkItemContext(context) && hasLabel(context, INTERNAL_WORK_ITEM_WATCH_REVIEWER_LABEL);
}

export function reviewerWatchReason(messageType: string) {
  return messageType === "REASSIGN_TASK" ? "issue_watch_reassigned" : "issue_watch_assigned";
}

export function isLeadWatchEnabled(context: InternalWorkItemSupervisorContext | null | undefined) {
  return isInternalWorkItemContext(context) && hasLabel(context, INTERNAL_WORK_ITEM_WATCH_LEAD_LABEL);
}

export function leadSupervisorProtocolReason(messageType: string) {
  return LEAD_SUPERVISOR_PROTOCOL_REASON_BY_MESSAGE_TYPE[messageType] ?? null;
}

export function leadSupervisorRunFailureReason(input: {
  status: string | null | undefined;
  errorCode?: string | null;
}) {
  if (input.errorCode === "process_lost") return "issue_supervisor_run_process_lost";
  if (input.status === "timed_out") return "issue_supervisor_run_timed_out";
  if (input.status === "failed") return "issue_supervisor_run_failed";
  return null;
}

export function buildInternalWorkItemDispatchMetadata(
  context: InternalWorkItemSupervisorContext | null | undefined,
) {
  if (!isInternalWorkItemContext(context)) return {};

  return {
    issueInternalWorkItem: true,
    rootIssueId: context?.parentId ?? null,
    internalWorkItemKind: getInternalWorkItemKind(context),
    reviewerWatchEnabled: isReviewerWatchEnabled(context),
    leadWatchEnabled: isLeadWatchEnabled(context),
  };
}
