import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ISSUE_PRIORITIES,
  ISSUE_PROTOCOL_APPROVAL_MODES,
  ISSUE_PROTOCOL_ARTIFACT_KINDS,
  ISSUE_PROTOCOL_CANCEL_TYPES,
  ISSUE_PROTOCOL_CLOSE_REASONS,
  ISSUE_PROTOCOL_FINAL_TEST_STATUSES,
  ISSUE_PROTOCOL_MERGE_STATUSES,
  ISSUE_PROTOCOL_NOTE_TYPES,
  type Agent,
  type CreateIssueProtocolMessage,
  type IssueProtocolRecipient,
  type IssueProtocolState,
  type IssueProtocolWorkflowState,
  type WorkflowTemplate,
} from "@squadrail/shared";
import { companiesApi } from "@/api/companies";
import { queryKeys } from "@/lib/queryKeys";
import { Button } from "@/components/ui/button";
import { cn } from "../lib/utils";

type HumanBoardAction =
  | "ASSIGN_TASK"
  | "REASSIGN_TASK"
  | "REQUEST_CHANGES"
  | "APPROVE_IMPLEMENTATION"
  | "CLOSE_TASK"
  | "CANCEL_TASK"
  | "NOTE";

type ExtraRecipientRole = "tech_lead" | "engineer" | "reviewer";
type AssignmentRecipientRole = "tech_lead" | "engineer";

interface ProtocolActionConsoleProps {
  companyId: string | null;
  issueIdentifier: string;
  protocolState: IssueProtocolState | null;
  agents: Agent[];
  currentUserId: string | null;
  onSubmit: (message: CreateIssueProtocolMessage) => Promise<void>;
  isSubmitting: boolean;
}

const HUMAN_BOARD_ACTIONS: HumanBoardAction[] = [
  "ASSIGN_TASK",
  "REASSIGN_TASK",
  "REQUEST_CHANGES",
  "APPROVE_IMPLEMENTATION",
  "CLOSE_TASK",
  "CANCEL_TASK",
  "NOTE",
];

const CLOSE_TASK_REPO_ARTIFACT_KINDS = new Set([
  "diff",
  "commit",
]);

const CLOSE_TASK_APPROVAL_ARTIFACT_KINDS = new Set([
  "approval",
]);

const CLOSE_TASK_VERIFICATION_ARTIFACT_KINDS = new Set([
  "test_run",
  "build_run",
  "doc",
]);

function formatProtocolValue(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function parseLineList(value: string) {
  return value
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function renderTemplateText(value: string | null | undefined, issueIdentifier: string) {
  if (!value) return "";
  return value.replaceAll("{issueIdentifier}", issueIdentifier);
}

function parseChangeRequests(value: string) {
  return value
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [title = "", reason = "", affectedFiles = "", suggestedAction = ""] = entry
        .split("|")
        .map((part) => part.trim());
      return {
        title,
        reason,
        affectedFiles: affectedFiles
          .split(",")
          .map((part) => part.trim())
          .filter(Boolean),
        ...(suggestedAction ? { suggestedAction } : {}),
      };
    });
}

function parseArtifacts(value: string): NonNullable<CreateIssueProtocolMessage["artifacts"]> {
  return value
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [kind, uri, label] = entry.split("|").map((part) => part.trim());
      return {
        kind: (kind || "doc") as NonNullable<CreateIssueProtocolMessage["artifacts"]>[number]["kind"],
        uri: uri || label || entry,
        ...(label ? { label } : {}),
      };
    })
    .filter((artifact) => ISSUE_PROTOCOL_ARTIFACT_KINDS.includes(artifact.kind));
}

function dedupeRecipients(recipients: IssueProtocolRecipient[]) {
  const seen = new Set<string>();
  return recipients.filter((recipient) => {
    const key = `${recipient.recipientType}:${recipient.recipientId}:${recipient.role}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function availableActions(state: IssueProtocolState | null): HumanBoardAction[] {
  if (!state) {
    return ["ASSIGN_TASK"];
  }
  const workflowState = state?.workflowState ?? "backlog";
  switch (workflowState) {
    case "backlog":
      return ["ASSIGN_TASK", "NOTE", "CANCEL_TASK"];
    case "assigned":
    case "accepted":
    case "planning":
    case "implementing":
    case "blocked":
    case "changes_requested":
      return ["REASSIGN_TASK", "NOTE", "CANCEL_TASK"];
    case "submitted_for_review":
    case "qa_pending":
      return ["NOTE", "CANCEL_TASK"];
    case "under_review":
    case "under_qa_review":
      return ["APPROVE_IMPLEMENTATION", "NOTE", "CANCEL_TASK"];
    case "awaiting_human_decision":
      return ["REQUEST_CHANGES", "APPROVE_IMPLEMENTATION", "NOTE", "CANCEL_TASK"];
    case "approved":
      return ["CLOSE_TASK", "NOTE", "CANCEL_TASK"];
    case "done":
    case "cancelled":
      return ["NOTE"];
    default:
      return ["NOTE"];
  }
}

function nextWorkflowState(action: HumanBoardAction, currentState: IssueProtocolWorkflowState): IssueProtocolWorkflowState {
  switch (action) {
    case "ASSIGN_TASK":
    case "REASSIGN_TASK":
      return "assigned";
    case "REQUEST_CHANGES":
      return "changes_requested";
    case "APPROVE_IMPLEMENTATION":
      return "approved";
    case "CLOSE_TASK":
      return "done";
    case "CANCEL_TASK":
      return "cancelled";
    case "NOTE":
      return currentState;
  }
}

function buildCurrentParticipantRecipients(input: {
  protocolState: IssueProtocolState | null;
  currentUserId: string | null;
}): IssueProtocolRecipient[] {
  const recipients: IssueProtocolRecipient[] = [];
  if (input.protocolState?.techLeadAgentId) {
    recipients.push({
      recipientType: "agent",
      recipientId: input.protocolState.techLeadAgentId,
      role: "tech_lead",
    });
  }
  if (input.protocolState?.primaryEngineerAgentId) {
    recipients.push({
      recipientType: "agent",
      recipientId: input.protocolState.primaryEngineerAgentId,
      role: "engineer",
    });
  }
  if (input.protocolState?.reviewerAgentId) {
    recipients.push({
      recipientType: "agent",
      recipientId: input.protocolState.reviewerAgentId,
      role: "reviewer",
    });
  }
  if (input.protocolState?.qaAgentId) {
    recipients.push({
      recipientType: "agent",
      recipientId: input.protocolState.qaAgentId,
      role: "qa",
    });
  }
  if (recipients.length === 0 && input.currentUserId) {
    recipients.push({
      recipientType: "user",
      recipientId: input.currentUserId,
      role: "human_board",
    });
  }
  return recipients;
}

export function ProtocolActionConsole({
  companyId,
  issueIdentifier,
  protocolState,
  agents,
  currentUserId,
  onSubmit,
  isSubmitting,
}: ProtocolActionConsoleProps) {
  const allowedActions = useMemo(() => availableActions(protocolState), [protocolState]);
  const [selectedAction, setSelectedAction] = useState<HumanBoardAction>(allowedActions[0] ?? "NOTE");
  const [summary, setSummary] = useState("");
  const [goal, setGoal] = useState("");
  const [acceptanceCriteria, setAcceptanceCriteria] = useState("");
  const [definitionOfDone, setDefinitionOfDone] = useState("");
  const [priority, setPriority] = useState<(typeof ISSUE_PRIORITIES)[number]>("high");
  const [assigneeAgentId, setAssigneeAgentId] = useState("");
  const [assignmentRecipientRole, setAssignmentRecipientRole] = useState<AssignmentRecipientRole>("engineer");
  const [reviewerAgentId, setReviewerAgentId] = useState("");
  const [requiredKnowledgeTags, setRequiredKnowledgeTags] = useState("");
  const [deadlineAt, setDeadlineAt] = useState("");
  const [reviewSummary, setReviewSummary] = useState("");
  const [requiredEvidence, setRequiredEvidence] = useState("");
  const [changeRequestLines, setChangeRequestLines] = useState("");
  const [reassignReason, setReassignReason] = useState("");
  const [approvalSummary, setApprovalSummary] = useState("");
  const [approvalMode, setApprovalMode] = useState<(typeof ISSUE_PROTOCOL_APPROVAL_MODES)[number]>("human_override");
  const [approvalChecklist, setApprovalChecklist] = useState("");
  const [verifiedEvidence, setVerifiedEvidence] = useState("");
  const [approvalResidualRisks, setApprovalResidualRisks] = useState("");
  const [followUpActions, setFollowUpActions] = useState("");
  const [artifactLines, setArtifactLines] = useState("");
  const [closeReason, setCloseReason] = useState<(typeof ISSUE_PROTOCOL_CLOSE_REASONS)[number]>("completed");
  const [closureSummary, setClosureSummary] = useState("");
  const [verificationSummary, setVerificationSummary] = useState("");
  const [rollbackPlan, setRollbackPlan] = useState("");
  const [finalArtifacts, setFinalArtifacts] = useState("");
  const [finalTestStatus, setFinalTestStatus] = useState<(typeof ISSUE_PROTOCOL_FINAL_TEST_STATUSES)[number]>("passed");
  const [mergeStatus, setMergeStatus] = useState<(typeof ISSUE_PROTOCOL_MERGE_STATUSES)[number]>("merged");
  const [remainingRisks, setRemainingRisks] = useState("");
  const [followUpIssueIds, setFollowUpIssueIds] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [cancelType, setCancelType] = useState<(typeof ISSUE_PROTOCOL_CANCEL_TYPES)[number]>("manual_stop");
  const [replacementIssueId, setReplacementIssueId] = useState("");
  const [noteType, setNoteType] = useState<(typeof ISSUE_PROTOCOL_NOTE_TYPES)[number]>("context");
  const [noteBody, setNoteBody] = useState("");
  const [noteAudience, setNoteAudience] = useState<Record<"tech_lead" | "engineer" | "reviewer" | "human_board", boolean>>({
    tech_lead: true,
    engineer: true,
    reviewer: true,
    human_board: false,
  });
  const [extraRecipients, setExtraRecipients] = useState<Array<{ recipientId: string; role: ExtraRecipientRole }>>([]);
  const [extraRecipientAgentId, setExtraRecipientAgentId] = useState("");
  const [extraRecipientRole, setExtraRecipientRole] = useState<ExtraRecipientRole>("engineer");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [lastAppliedTemplate, setLastAppliedTemplate] = useState<WorkflowTemplate | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: workflowTemplatesView } = useQuery({
    queryKey: companyId ? queryKeys.companies.workflowTemplates(companyId) : ["companies", "__none__", "workflow-templates"],
    queryFn: () => companiesApi.getWorkflowTemplates(companyId!),
    enabled: Boolean(companyId),
  });

  useEffect(() => {
    if (allowedActions.includes(selectedAction)) return;
    setSelectedAction(allowedActions[0] ?? "NOTE");
  }, [allowedActions, selectedAction]);

  useEffect(() => {
    setLastAppliedTemplate(null);
  }, [selectedAction]);

  useEffect(() => {
    if (!protocolState?.primaryEngineerAgentId) return;
    setAssigneeAgentId((current) => current || protocolState.primaryEngineerAgentId || "");
  }, [protocolState?.primaryEngineerAgentId]);

  useEffect(() => {
    if (!protocolState?.reviewerAgentId) return;
    setReviewerAgentId((current) => current || protocolState.reviewerAgentId || "");
  }, [protocolState?.reviewerAgentId]);

  const availableTemplates = useMemo(
    () => (workflowTemplatesView?.templates ?? []).filter((template) => template.actionType === selectedAction),
    [selectedAction, workflowTemplatesView?.templates],
  );

  useEffect(() => {
    if (availableTemplates.length === 0) {
      setSelectedTemplateId("");
      return;
    }
    setSelectedTemplateId((current) =>
      current && availableTemplates.some((template) => template.id === current)
        ? current
        : availableTemplates[0]!.id,
    );
  }, [availableTemplates]);

  const activeAgents = useMemo(
    () => [...agents].filter((agent) => agent.status !== "terminated").sort((left, right) => left.name.localeCompare(right.name)),
    [agents],
  );

  const currentState: IssueProtocolWorkflowState = protocolState?.workflowState ?? "backlog";
  const nextState = nextWorkflowState(selectedAction, currentState);
  const artifacts = useMemo(() => parseArtifacts(artifactLines), [artifactLines]);

  const extraRecipientViews = useMemo(
    () =>
      extraRecipients.map((entry) => ({
        ...entry,
        agentName: activeAgents.find((agent) => agent.id === entry.recipientId)?.name ?? entry.recipientId,
      })),
    [activeAgents, extraRecipients],
  );

  function autoSummary(action: HumanBoardAction): string {
    switch (action) {
      case "ASSIGN_TASK":
        return `Board assigned ${issueIdentifier} for execution`;
      case "REASSIGN_TASK":
        return `Board reassigned ${issueIdentifier}`;
      case "REQUEST_CHANGES":
        return `Board requested changes for ${issueIdentifier}`;
      case "APPROVE_IMPLEMENTATION":
        return `Board approved implementation for ${issueIdentifier}`;
      case "CLOSE_TASK":
        return `Board closed ${issueIdentifier}`;
      case "CANCEL_TASK":
        return `Board cancelled ${issueIdentifier}`;
      case "NOTE":
        return `Board note for ${issueIdentifier}`;
    }
  }

  function buildRecipients(): IssueProtocolRecipient[] {
    if (selectedAction === "ASSIGN_TASK") {
      const recipients: IssueProtocolRecipient[] = [];
      if (assigneeAgentId) {
        recipients.push({ recipientType: "agent", recipientId: assigneeAgentId, role: assignmentRecipientRole });
      }
      if (reviewerAgentId) {
        recipients.push({ recipientType: "agent", recipientId: reviewerAgentId, role: "reviewer" });
      }
      return dedupeRecipients([
        ...recipients,
        ...extraRecipients.map((recipient) => ({
          recipientType: "agent" as const,
          recipientId: recipient.recipientId,
          role: recipient.role,
        })),
      ]);
    }

    if (selectedAction === "REASSIGN_TASK") {
      const recipients: IssueProtocolRecipient[] = [];
      if (assigneeAgentId) {
        recipients.push({ recipientType: "agent", recipientId: assigneeAgentId, role: assignmentRecipientRole });
      }
      if (reviewerAgentId) {
        recipients.push({ recipientType: "agent", recipientId: reviewerAgentId, role: "reviewer" });
      }
      return dedupeRecipients([
        ...recipients,
        ...extraRecipients.map((recipient) => ({
          recipientType: "agent" as const,
          recipientId: recipient.recipientId,
          role: recipient.role,
        })),
      ]);
    }

    if (selectedAction === "NOTE") {
      const recipients: IssueProtocolRecipient[] = [];
      if (noteAudience.tech_lead && protocolState?.techLeadAgentId) {
        recipients.push({ recipientType: "agent", recipientId: protocolState.techLeadAgentId, role: "tech_lead" });
      }
      if (noteAudience.engineer && protocolState?.primaryEngineerAgentId) {
        recipients.push({ recipientType: "agent", recipientId: protocolState.primaryEngineerAgentId, role: "engineer" });
      }
      if (noteAudience.reviewer && protocolState?.reviewerAgentId) {
        recipients.push({ recipientType: "agent", recipientId: protocolState.reviewerAgentId, role: "reviewer" });
      }
      if (noteAudience.human_board && currentUserId) {
        recipients.push({ recipientType: "user", recipientId: currentUserId, role: "human_board" });
      }
      return dedupeRecipients([
        ...recipients,
        ...extraRecipients.map((recipient) => ({
          recipientType: "agent" as const,
          recipientId: recipient.recipientId,
          role: recipient.role,
        })),
      ]);
    }

    return dedupeRecipients([
      ...buildCurrentParticipantRecipients({ protocolState, currentUserId }),
      ...extraRecipients.map((recipient) => ({
        recipientType: "agent" as const,
        recipientId: recipient.recipientId,
        role: recipient.role,
      })),
    ]);
  }

  function applyFallbackTemplate(action: HumanBoardAction) {
    if (action === "ASSIGN_TASK") {
      setGoal(`Deliver ${issueIdentifier} with explicit scope, reviewer ownership, and rollout-safe evidence.`);
      setAcceptanceCriteria("Implementation scope is explicit\nEvidence is attached\nReviewer ownership is assigned");
      setDefinitionOfDone("Changed files listed\nTests reported\nReview requested with residual risks");
      setRequiredKnowledgeTags("code\nadr\nreview");
      return;
    }
    if (action === "REASSIGN_TASK") {
      setReassignReason(`Reassign ${issueIdentifier} to unblock delivery while preserving current brief and reviewer expectations.`);
      return;
    }
    if (action === "REQUEST_CHANGES") {
      setReviewSummary(`Human review for ${issueIdentifier} requires explicit follow-up before approval.`);
      setRequiredEvidence("Updated verification evidence\nRollback readiness note");
      setChangeRequestLines(
        "Strengthen verification evidence|Current handoff does not show enough validation coverage.|docs/release/checklist.md,server/src/__tests__/release.test.ts|Attach the missing verification evidence and summarize the expected rollback trigger.",
      );
      return;
    }
    if (action === "APPROVE_IMPLEMENTATION") {
      setApprovalSummary(`Approval for ${issueIdentifier} is based on attached evidence, review outcomes, and rollout readiness.`);
      setApprovalChecklist("Acceptance criteria covered\nVerification evidence reviewed\nResidual risks recorded");
      setVerifiedEvidence("Reviewed diff and retrieval brief\nValidated test evidence");
      setApprovalResidualRisks("No known residual risk.");
      setFollowUpActions("Monitor rollout metrics\nTrack follow-up issue if residual risk remains");
      return;
    }
    if (action === "CLOSE_TASK") {
      setClosureSummary(`Close ${issueIdentifier} with explicit delivery and verification context.`);
      setVerificationSummary("Reviewed merged artifacts, verification evidence, and follow-up state.");
      setRollbackPlan("Revert the merge commit or reopen a follow-up issue if production regressions appear.");
      setFinalArtifacts("Implementation merged\nVerification evidence recorded\nOperational follow-up linked");
      setRemainingRisks("No unresolved delivery blocker remains");
      return;
    }
    if (action === "CANCEL_TASK") {
      setCancelReason(`Stop ${issueIdentifier} because the scope should move to a replacement task or no longer matches delivery goals.`);
      return;
    }
    if (action === "NOTE") {
      setNoteBody(`Board context for ${issueIdentifier}: preserve the current workflow intent and keep the next handoff evidence-backed.`);
    }
  }

  function applyConfiguredTemplate(template: WorkflowTemplate) {
    setSummary(renderTemplateText(template.summary, issueIdentifier));
    const fields = template.fields ?? {};

    if (template.actionType === "ASSIGN_TASK") {
      setGoal(renderTemplateText(fields.goal, issueIdentifier));
      setAcceptanceCriteria(renderTemplateText(fields.acceptanceCriteria, issueIdentifier));
      setDefinitionOfDone(renderTemplateText(fields.definitionOfDone, issueIdentifier));
      setRequiredKnowledgeTags(renderTemplateText(fields.requiredKnowledgeTags, issueIdentifier));
      if (fields.priority && ISSUE_PRIORITIES.includes(fields.priority as (typeof ISSUE_PRIORITIES)[number])) {
        setPriority(fields.priority as (typeof ISSUE_PRIORITIES)[number]);
      }
      if (fields.assignmentRecipientRole === "engineer" || fields.assignmentRecipientRole === "tech_lead") {
        setAssignmentRecipientRole(fields.assignmentRecipientRole);
      }
    }
    if (template.actionType === "REASSIGN_TASK") {
      setReassignReason(renderTemplateText(fields.reason, issueIdentifier));
      if (fields.assignmentRecipientRole === "engineer" || fields.assignmentRecipientRole === "tech_lead") {
        setAssignmentRecipientRole(fields.assignmentRecipientRole);
      }
    }
    if (template.actionType === "REQUEST_CHANGES") {
      setReviewSummary(renderTemplateText(fields.reviewSummary, issueIdentifier));
      setRequiredEvidence(renderTemplateText(fields.requiredEvidence, issueIdentifier));
      setChangeRequestLines(renderTemplateText(fields.changeRequestLines, issueIdentifier));
    }
    if (template.actionType === "APPROVE_IMPLEMENTATION") {
      setApprovalSummary(renderTemplateText(fields.approvalSummary, issueIdentifier));
      setApprovalChecklist(renderTemplateText(fields.approvalChecklist, issueIdentifier));
      setVerifiedEvidence(renderTemplateText(fields.verifiedEvidence, issueIdentifier));
      setApprovalResidualRisks(renderTemplateText(fields.approvalResidualRisks, issueIdentifier));
      setFollowUpActions(renderTemplateText(fields.followUpActions, issueIdentifier));
      if (
        fields.approvalMode
        && ISSUE_PROTOCOL_APPROVAL_MODES.includes(fields.approvalMode as (typeof ISSUE_PROTOCOL_APPROVAL_MODES)[number])
      ) {
        setApprovalMode(fields.approvalMode as (typeof ISSUE_PROTOCOL_APPROVAL_MODES)[number]);
      }
    }
    if (template.actionType === "CLOSE_TASK") {
      setClosureSummary(renderTemplateText(fields.closureSummary, issueIdentifier));
      setVerificationSummary(renderTemplateText(fields.verificationSummary, issueIdentifier));
      setRollbackPlan(renderTemplateText(fields.rollbackPlan, issueIdentifier));
      setFinalArtifacts(renderTemplateText(fields.finalArtifacts, issueIdentifier));
      setRemainingRisks(renderTemplateText(fields.remainingRisks, issueIdentifier));
      if (
        fields.closeReason
        && ISSUE_PROTOCOL_CLOSE_REASONS.includes(fields.closeReason as (typeof ISSUE_PROTOCOL_CLOSE_REASONS)[number])
      ) {
        setCloseReason(fields.closeReason as (typeof ISSUE_PROTOCOL_CLOSE_REASONS)[number]);
      }
      if (
        fields.finalTestStatus
        && ISSUE_PROTOCOL_FINAL_TEST_STATUSES.includes(fields.finalTestStatus as (typeof ISSUE_PROTOCOL_FINAL_TEST_STATUSES)[number])
      ) {
        setFinalTestStatus(fields.finalTestStatus as (typeof ISSUE_PROTOCOL_FINAL_TEST_STATUSES)[number]);
      }
      if (
        fields.mergeStatus
        && ISSUE_PROTOCOL_MERGE_STATUSES.includes(fields.mergeStatus as (typeof ISSUE_PROTOCOL_MERGE_STATUSES)[number])
      ) {
        setMergeStatus(fields.mergeStatus as (typeof ISSUE_PROTOCOL_MERGE_STATUSES)[number]);
      }
    }
    if (template.actionType === "CANCEL_TASK") {
      setCancelReason(renderTemplateText(fields.reason, issueIdentifier));
      if (
        fields.cancelType
        && ISSUE_PROTOCOL_CANCEL_TYPES.includes(fields.cancelType as (typeof ISSUE_PROTOCOL_CANCEL_TYPES)[number])
      ) {
        setCancelType(fields.cancelType as (typeof ISSUE_PROTOCOL_CANCEL_TYPES)[number]);
      }
    }
    if (template.actionType === "NOTE") {
      setNoteBody(renderTemplateText(fields.body, issueIdentifier));
      if (
        fields.noteType
        && ISSUE_PROTOCOL_NOTE_TYPES.includes(fields.noteType as (typeof ISSUE_PROTOCOL_NOTE_TYPES)[number])
      ) {
        setNoteType(fields.noteType as (typeof ISSUE_PROTOCOL_NOTE_TYPES)[number]);
      }
    }

    setLastAppliedTemplate(template);
  }

  function applyTemplate(action: HumanBoardAction) {
    const selectedTemplate = availableTemplates.find((template) => template.id === selectedTemplateId) ?? availableTemplates[0];
    if (selectedTemplate) {
      applyConfiguredTemplate(selectedTemplate);
      return;
    }
    applyFallbackTemplate(action);
    setLastAppliedTemplate(null);
  }

  function applyTemplateTrace<TPayload extends Record<string, unknown>>(payload: TPayload) {
    if (!lastAppliedTemplate || lastAppliedTemplate.actionType !== selectedAction) return payload;
    return {
      ...payload,
      boardTemplateId: lastAppliedTemplate.id,
      boardTemplateLabel: lastAppliedTemplate.label,
      boardTemplateScope: lastAppliedTemplate.scope,
    };
  }

  function addExtraRecipient() {
    if (!extraRecipientAgentId) return;
    setExtraRecipients((current) =>
      dedupeRecipients([
        ...current.map((entry) => ({
          recipientType: "agent" as const,
          recipientId: entry.recipientId,
          role: entry.role,
        })),
        {
          recipientType: "agent" as const,
          recipientId: extraRecipientAgentId,
          role: extraRecipientRole,
        },
      ]).map((entry) => ({
        recipientId: entry.recipientId,
        role: entry.role as ExtraRecipientRole,
      })),
    );
    setExtraRecipientAgentId("");
  }

  function removeExtraRecipient(recipientId: string, role: ExtraRecipientRole) {
    setExtraRecipients((current) => current.filter((entry) => !(entry.recipientId === recipientId && entry.role === role)));
  }

  async function handleSubmit() {
    if (!currentUserId) {
      setError("Board session is required to send protocol messages.");
      return;
    }

    const recipients = buildRecipients();
    if (recipients.length === 0) {
      setError("Select at least one valid recipient for this action.");
      return;
    }

    let message: CreateIssueProtocolMessage;
    const resolvedSummary = summary.trim() || autoSummary(selectedAction);

    switch (selectedAction) {
      case "ASSIGN_TASK":
        if (!assigneeAgentId || !reviewerAgentId) {
          setError("Assignment requires an execution owner and a reviewer.");
          return;
        }
        message = {
          messageType: "ASSIGN_TASK",
          sender: { actorType: "user", actorId: currentUserId, role: "human_board" },
          recipients,
          workflowStateBefore: currentState,
          workflowStateAfter: nextState,
          summary: resolvedSummary,
          requiresAck: false,
          payload: applyTemplateTrace({
            goal: goal.trim(),
            acceptanceCriteria: parseLineList(acceptanceCriteria),
            definitionOfDone: parseLineList(definitionOfDone),
            priority,
            assigneeAgentId,
            reviewerAgentId,
            ...(deadlineAt ? { deadlineAt: new Date(deadlineAt).toISOString() } : {}),
            ...(parseLineList(requiredKnowledgeTags).length > 0
              ? { requiredKnowledgeTags: parseLineList(requiredKnowledgeTags) }
              : {}),
          }),
          artifacts,
        };
        break;
      case "REASSIGN_TASK":
        if (!assigneeAgentId || !reassignReason.trim()) {
          setError("Reassignment requires a new execution owner and a reason.");
          return;
        }
        message = {
          messageType: "REASSIGN_TASK",
          sender: { actorType: "user", actorId: currentUserId, role: "human_board" },
          recipients,
          workflowStateBefore: currentState,
          workflowStateAfter: nextState,
          summary: resolvedSummary,
          requiresAck: false,
          payload: applyTemplateTrace({
            reason: reassignReason.trim(),
            newAssigneeAgentId: assigneeAgentId,
            ...(reviewerAgentId ? { newReviewerAgentId: reviewerAgentId } : {}),
          }),
          artifacts,
        };
        break;
      case "REQUEST_CHANGES": {
        const parsedChangeRequests = parseChangeRequests(changeRequestLines);
        if (
          !reviewSummary.trim()
          || parseLineList(requiredEvidence).length === 0
          || parsedChangeRequests.length === 0
          || parsedChangeRequests.some((request) =>
            !request.title
            || !request.reason
            || (request.affectedFiles.length === 0 && !request.suggestedAction)
          )
        ) {
          setError("Request changes requires review summary, required evidence, and structured change requests.");
          return;
        }
        message = {
          messageType: "REQUEST_CHANGES",
          sender: { actorType: "user", actorId: currentUserId, role: "human_board" },
          recipients,
          workflowStateBefore: currentState,
          workflowStateAfter: nextState,
          summary: resolvedSummary,
          requiresAck: false,
          payload: applyTemplateTrace({
            reviewSummary: reviewSummary.trim(),
            changeRequests: parsedChangeRequests,
            severity: "high",
            mustFixBeforeApprove: true,
            requiredEvidence: parseLineList(requiredEvidence),
          }),
          artifacts,
        };
        break;
      }
      case "APPROVE_IMPLEMENTATION":
        if (
          !approvalSummary.trim()
          || parseLineList(approvalChecklist).length === 0
          || parseLineList(verifiedEvidence).length === 0
          || parseLineList(approvalResidualRisks).length === 0
        ) {
          setError("Approval requires summary, checklist, verified evidence, and residual risks.");
          return;
        }
        message = {
          messageType: "APPROVE_IMPLEMENTATION",
          sender: { actorType: "user", actorId: currentUserId, role: "human_board" },
          recipients,
          workflowStateBefore: currentState,
          workflowStateAfter: nextState,
          summary: resolvedSummary,
          requiresAck: false,
          payload: applyTemplateTrace({
            approvalSummary: approvalSummary.trim(),
            approvalMode,
            approvalChecklist: parseLineList(approvalChecklist),
            verifiedEvidence: parseLineList(verifiedEvidence),
            residualRisks: parseLineList(approvalResidualRisks),
            ...(parseLineList(followUpActions).length > 0
              ? { followUpActions: parseLineList(followUpActions) }
              : {}),
          }),
          artifacts,
        };
        break;
      case "CLOSE_TASK":
        if (
          !closureSummary.trim()
          || !verificationSummary.trim()
          || !rollbackPlan.trim()
          || parseLineList(finalArtifacts).length === 0
        ) {
          setError("Close task requires closure summary, verification summary, rollback plan, and final artifacts.");
          return;
        }
        if (closeReason === "moved_to_followup" && parseLineList(followUpIssueIds).length === 0) {
          setError("Close task with follow-up requires follow-up issue IDs.");
          return;
        }
        if (finalTestStatus === "passed_with_known_risk" && parseLineList(remainingRisks).length === 0) {
          setError("Close task with known risk requires remaining risks.");
          return;
        }
        if (
          mergeStatus === "merged"
          && (
            !artifacts.some((artifact) => CLOSE_TASK_REPO_ARTIFACT_KINDS.has(artifact.kind))
            || !artifacts.some((artifact) => CLOSE_TASK_APPROVAL_ARTIFACT_KINDS.has(artifact.kind))
            || !artifacts.some((artifact) => CLOSE_TASK_VERIFICATION_ARTIFACT_KINDS.has(artifact.kind))
          )
        ) {
          setError("Close task with merged status requires repo evidence, approval, and verification artifacts.");
          return;
        }
        message = {
          messageType: "CLOSE_TASK",
          sender: { actorType: "user", actorId: currentUserId, role: "human_board" },
          recipients,
          workflowStateBefore: currentState,
          workflowStateAfter: nextState,
          summary: resolvedSummary,
          requiresAck: false,
          payload: applyTemplateTrace({
            closeReason,
            closureSummary: closureSummary.trim(),
            verificationSummary: verificationSummary.trim(),
            rollbackPlan: rollbackPlan.trim(),
            finalArtifacts: parseLineList(finalArtifacts),
            finalTestStatus,
            mergeStatus,
            ...(parseLineList(followUpIssueIds).length > 0
              ? { followUpIssueIds: parseLineList(followUpIssueIds) }
              : {}),
            ...(parseLineList(remainingRisks).length > 0
              ? { remainingRisks: parseLineList(remainingRisks) }
              : {}),
          }),
          artifacts,
        };
        break;
      case "CANCEL_TASK":
        if (!cancelReason.trim()) {
          setError("Cancel task requires a reason.");
          return;
        }
        message = {
          messageType: "CANCEL_TASK",
          sender: { actorType: "user", actorId: currentUserId, role: "human_board" },
          recipients,
          workflowStateBefore: currentState,
          workflowStateAfter: nextState,
          summary: resolvedSummary,
          requiresAck: false,
          payload: applyTemplateTrace({
            reason: cancelReason.trim(),
            cancelType,
            ...(replacementIssueId.trim() ? { replacementIssueId: replacementIssueId.trim() } : {}),
          }),
          artifacts,
        };
        break;
      case "NOTE":
        if (!noteBody.trim()) {
          setError("Note body is required.");
          return;
        }
        message = {
          messageType: "NOTE",
          sender: { actorType: "user", actorId: currentUserId, role: "human_board" },
          recipients,
          workflowStateBefore: currentState,
          workflowStateAfter: nextState,
          summary: resolvedSummary,
          requiresAck: false,
          payload: applyTemplateTrace({
            noteType,
            body: noteBody.trim(),
          }),
          artifacts,
        };
        break;
    }

    setError(null);
    await onSubmit(message);
    if (selectedAction === "NOTE") {
      setNoteBody("");
      setArtifactLines("");
      setSummary("");
      return;
    }
    setSummary("");
  }

  const payloadPreview = useMemo(() => {
    switch (selectedAction) {
      case "ASSIGN_TASK":
        return {
          goal: goal.trim(),
          acceptanceCriteria: parseLineList(acceptanceCriteria),
          definitionOfDone: parseLineList(definitionOfDone),
          priority,
          assigneeAgentId,
          assignmentRecipientRole,
          reviewerAgentId,
          requiredKnowledgeTags: parseLineList(requiredKnowledgeTags),
        };
      case "REASSIGN_TASK":
        return {
          reason: reassignReason.trim(),
          newAssigneeAgentId: assigneeAgentId,
          assignmentRecipientRole,
          newReviewerAgentId: reviewerAgentId || null,
        };
      case "REQUEST_CHANGES":
        return {
          reviewSummary: reviewSummary.trim(),
          requiredEvidence: parseLineList(requiredEvidence),
          changeRequests: parseChangeRequests(changeRequestLines),
          severity: "major",
          mustFixBeforeApprove: true,
        };
      case "APPROVE_IMPLEMENTATION":
        return {
          approvalSummary: approvalSummary.trim(),
          approvalMode,
          approvalChecklist: parseLineList(approvalChecklist),
          verifiedEvidence: parseLineList(verifiedEvidence),
          residualRisks: parseLineList(approvalResidualRisks),
          followUpActions: parseLineList(followUpActions),
        };
      case "CLOSE_TASK":
        return {
          closeReason,
          closureSummary: closureSummary.trim(),
          verificationSummary: verificationSummary.trim(),
          rollbackPlan: rollbackPlan.trim(),
          finalArtifacts: parseLineList(finalArtifacts),
          finalTestStatus,
          mergeStatus,
          followUpIssueIds: parseLineList(followUpIssueIds),
          remainingRisks: parseLineList(remainingRisks),
        };
      case "CANCEL_TASK":
        return {
          reason: cancelReason.trim(),
          cancelType,
          replacementIssueId: replacementIssueId.trim() || null,
        };
      case "NOTE":
        return {
          noteType,
          body: noteBody.trim(),
        };
    }
  }, [
    acceptanceCriteria,
    approvalMode,
    approvalChecklist,
    approvalResidualRisks,
    approvalSummary,
    assigneeAgentId,
    cancelReason,
    cancelType,
    closeReason,
    definitionOfDone,
    finalArtifacts,
    finalTestStatus,
    followUpActions,
    followUpIssueIds,
    goal,
    changeRequestLines,
    mergeStatus,
    noteBody,
    noteType,
    priority,
    reassignReason,
    remainingRisks,
    replacementIssueId,
    requiredKnowledgeTags,
    requiredEvidence,
    assignmentRecipientRole,
    reviewerAgentId,
    reviewSummary,
    selectedAction,
    verifiedEvidence,
    closureSummary,
    verificationSummary,
    rollbackPlan,
  ]);

  return (
    <section className="rounded-lg border border-border bg-card px-4 py-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Protocol Action Console</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Human-board interventions only. Agents continue to drive engineer, reviewer, and tech-lead protocol messages.
          </p>
          {!protocolState ? (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Protocol state is not initialized yet. Start this issue with an assignment before notes, review actions, or closure.
            </p>
          ) : null}
        </div>
        <div className="rounded-full border border-border px-2 py-1 text-[11px] text-muted-foreground">
          {formatProtocolValue(currentState)} -&gt; {formatProtocolValue(nextState)}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {HUMAN_BOARD_ACTIONS.filter((action) => allowedActions.includes(action)).map((action) => (
          <button
            key={action}
            type="button"
            onClick={() => setSelectedAction(action)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs transition-colors",
              selectedAction === action
                ? "border-foreground bg-foreground text-background"
                : "border-border text-muted-foreground hover:bg-accent/50",
            )}
          >
            {formatProtocolValue(action)}
          </button>
        ))}
        <button
          type="button"
          onClick={() => applyTemplate(selectedAction)}
          className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent/50"
        >
          Load template
        </button>
      </div>

      {availableTemplates.length > 0 ? (
        <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
          <select
            className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none"
            value={selectedTemplateId}
            onChange={(event) => setSelectedTemplateId(event.target.value)}
          >
            {availableTemplates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.label} {template.scope === "company" ? "· Company" : "· Default"}
              </option>
            ))}
          </select>
          {lastAppliedTemplate ? (
            <div className="rounded-full border border-border px-3 py-1 text-[11px] text-muted-foreground">
              Applied {lastAppliedTemplate.label}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-4 space-y-3">
        <label className="block">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Summary</div>
          <input
            className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none"
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            placeholder={autoSummary(selectedAction)}
          />
        </label>

        {selectedAction === "ASSIGN_TASK" && (
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block">
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Execution role</div>
              <select
                className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none"
                value={assignmentRecipientRole}
                onChange={(event) => setAssignmentRecipientRole(event.target.value as AssignmentRecipientRole)}
              >
                <option value="engineer">Engineer</option>
                <option value="tech_lead">Tech Lead</option>
              </select>
            </label>
            <label className="block">
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Execution owner</div>
              <select
                className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none"
                value={assigneeAgentId}
                onChange={(event) => setAssigneeAgentId(event.target.value)}
              >
                <option value="">Select execution owner</option>
                {activeAgents.map((agent) => (
                  <option key={agent.id} value={agent.id}>{agent.name}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Reviewer</div>
              <select
                className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none"
                value={reviewerAgentId}
                onChange={(event) => setReviewerAgentId(event.target.value)}
              >
                <option value="">Select reviewer</option>
                {activeAgents.map((agent) => (
                  <option key={agent.id} value={agent.id}>{agent.name}</option>
                ))}
              </select>
            </label>
            <label className="block md:col-span-2">
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Goal</div>
              <textarea
                className="min-h-[88px] w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none"
                value={goal}
                onChange={(event) => setGoal(event.target.value)}
                placeholder="Describe the exact outcome expected from this issue."
              />
            </label>
            <label className="block">
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Acceptance criteria</div>
              <textarea
                className="min-h-[112px] w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none"
                value={acceptanceCriteria}
                onChange={(event) => setAcceptanceCriteria(event.target.value)}
                placeholder={"One item per line\nRegression risk covered\nEvidence available"}
              />
            </label>
            <label className="block">
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Definition of done</div>
              <textarea
                className="min-h-[112px] w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none"
                value={definitionOfDone}
                onChange={(event) => setDefinitionOfDone(event.target.value)}
                placeholder={"One item per line\nTests passed\nReviewer acknowledged"}
              />
            </label>
            <label className="block">
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Priority</div>
              <select
                className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none"
                value={priority}
                onChange={(event) => setPriority(event.target.value as (typeof ISSUE_PRIORITIES)[number])}
              >
                {ISSUE_PRIORITIES.map((value) => (
                  <option key={value} value={value}>{formatProtocolValue(value)}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Deadline</div>
              <input
                type="datetime-local"
                className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none"
                value={deadlineAt}
                onChange={(event) => setDeadlineAt(event.target.value)}
              />
            </label>
            <label className="block md:col-span-2">
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Knowledge tags</div>
              <textarea
                className="min-h-[72px] w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none"
                value={requiredKnowledgeTags}
                onChange={(event) => setRequiredKnowledgeTags(event.target.value)}
                placeholder={"One tag per line\napi\nmigration\nretry-policy"}
              />
            </label>
          </div>
        )}

        {selectedAction === "REASSIGN_TASK" && (
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block">
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Execution role</div>
              <select
                className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none"
                value={assignmentRecipientRole}
                onChange={(event) => setAssignmentRecipientRole(event.target.value as AssignmentRecipientRole)}
              >
                <option value="engineer">Engineer</option>
                <option value="tech_lead">Tech Lead</option>
              </select>
            </label>
            <label className="block">
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">New execution owner</div>
              <select
                className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none"
                value={assigneeAgentId}
                onChange={(event) => setAssigneeAgentId(event.target.value)}
              >
                <option value="">Select execution owner</option>
                {activeAgents.map((agent) => (
                  <option key={agent.id} value={agent.id}>{agent.name}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Reviewer</div>
              <select
                className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none"
                value={reviewerAgentId}
                onChange={(event) => setReviewerAgentId(event.target.value)}
              >
                <option value="">Keep current reviewer</option>
                {activeAgents.map((agent) => (
                  <option key={agent.id} value={agent.id}>{agent.name}</option>
                ))}
              </select>
            </label>
            <label className="block md:col-span-2">
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Reason</div>
              <textarea
                className="min-h-[96px] w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none"
                value={reassignReason}
                onChange={(event) => setReassignReason(event.target.value)}
                placeholder="Explain why reassignment is required and what must carry forward."
              />
            </label>
          </div>
        )}

        {selectedAction === "REQUEST_CHANGES" && (
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block md:col-span-2">
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Review summary</div>
              <textarea
                className="min-h-[88px] w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none"
                value={reviewSummary}
                onChange={(event) => setReviewSummary(event.target.value)}
                placeholder="Explain why approval is blocked and what must change before the issue can proceed."
              />
            </label>
            <label className="block">
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Required evidence</div>
              <textarea
                className="min-h-[96px] w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none"
                value={requiredEvidence}
                onChange={(event) => setRequiredEvidence(event.target.value)}
                placeholder={"One item per line\nUpdated test run\nRollback checkpoint note"}
              />
            </label>
            <label className="block md:col-span-2">
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Change requests</div>
              <textarea
                className="min-h-[120px] w-full rounded-md border border-border bg-transparent px-3 py-2 font-mono text-xs outline-none"
                value={changeRequestLines}
                onChange={(event) => setChangeRequestLines(event.target.value)}
                placeholder={
                  "One request per line: title|reason|file1,file2|suggested action\nMissing rollback evidence|Rollback trigger is not documented.|docs/release/checklist.md|Add rollback trigger and rollback owner."
                }
              />
            </label>
          </div>
        )}

        {selectedAction === "APPROVE_IMPLEMENTATION" && (
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block md:col-span-2">
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Approval summary</div>
              <textarea
                className="min-h-[88px] w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none"
                value={approvalSummary}
                onChange={(event) => setApprovalSummary(event.target.value)}
                placeholder="Summarize why the implementation is approved and what evidence was considered."
              />
            </label>
            <label className="block">
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Approval checklist</div>
              <textarea
                className="min-h-[88px] w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none"
                value={approvalChecklist}
                onChange={(event) => setApprovalChecklist(event.target.value)}
                placeholder={"One item per line\nAcceptance criteria covered\nRegression risks reviewed"}
              />
            </label>
            <label className="block">
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Verified evidence</div>
              <textarea
                className="min-h-[88px] w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none"
                value={verifiedEvidence}
                onChange={(event) => setVerifiedEvidence(event.target.value)}
                placeholder={"One item per line\nTest run reviewed\nDiff inspected"}
              />
            </label>
            <label className="block">
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Approval mode</div>
              <select
                className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none"
                value={approvalMode}
                onChange={(event) => setApprovalMode(event.target.value as (typeof ISSUE_PROTOCOL_APPROVAL_MODES)[number])}
              >
                {ISSUE_PROTOCOL_APPROVAL_MODES.map((value) => (
                  <option key={value} value={value}>{formatProtocolValue(value)}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Residual risks</div>
              <textarea
                className="min-h-[88px] w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none"
                value={approvalResidualRisks}
                onChange={(event) => setApprovalResidualRisks(event.target.value)}
                placeholder={"One item per line\nNo known residual risk."}
              />
            </label>
            <label className="block md:col-span-2">
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Follow-up actions</div>
              <textarea
                className="min-h-[88px] w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none"
                value={followUpActions}
                onChange={(event) => setFollowUpActions(event.target.value)}
                placeholder={"One action per line\nCreate rollout note\nMonitor retry queue"}
              />
            </label>
          </div>
        )}

        {selectedAction === "CLOSE_TASK" && (
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block">
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Close reason</div>
              <select
                className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none"
                value={closeReason}
                onChange={(event) => setCloseReason(event.target.value as (typeof ISSUE_PROTOCOL_CLOSE_REASONS)[number])}
              >
                {ISSUE_PROTOCOL_CLOSE_REASONS.map((value) => (
                  <option key={value} value={value}>{formatProtocolValue(value)}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Final test status</div>
              <select
                className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none"
                value={finalTestStatus}
                onChange={(event) => setFinalTestStatus(event.target.value as (typeof ISSUE_PROTOCOL_FINAL_TEST_STATUSES)[number])}
              >
                {ISSUE_PROTOCOL_FINAL_TEST_STATUSES.map((value) => (
                  <option key={value} value={value}>{formatProtocolValue(value)}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Merge status</div>
              <select
                className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none"
                value={mergeStatus}
                onChange={(event) => setMergeStatus(event.target.value as (typeof ISSUE_PROTOCOL_MERGE_STATUSES)[number])}
              >
                {ISSUE_PROTOCOL_MERGE_STATUSES.map((value) => (
                  <option key={value} value={value}>{formatProtocolValue(value)}</option>
                ))}
              </select>
            </label>
            <label className="block md:col-span-2">
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Closure summary</div>
              <textarea
                className="min-h-[88px] w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none"
                value={closureSummary}
                onChange={(event) => setClosureSummary(event.target.value)}
                placeholder="Summarize what is complete, what was verified, and why this issue can close."
              />
            </label>
            <label className="block">
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Verification summary</div>
              <textarea
                className="min-h-[88px] w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none"
                value={verificationSummary}
                onChange={(event) => setVerificationSummary(event.target.value)}
                placeholder="Summarize validation, review, and release readiness."
              />
            </label>
            <label className="block">
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Rollback plan</div>
              <textarea
                className="min-h-[88px] w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none"
                value={rollbackPlan}
                onChange={(event) => setRollbackPlan(event.target.value)}
                placeholder="Describe the first rollback step if production validation fails."
              />
            </label>
            <label className="block">
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Follow-up issue IDs</div>
              <textarea
                className="min-h-[88px] w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none"
                value={followUpIssueIds}
                onChange={(event) => setFollowUpIssueIds(event.target.value)}
                placeholder={"One issue ID per line\n6c5a...\n9d4b..."}
              />
            </label>
            <label className="block md:col-span-2">
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Final artifacts</div>
              <textarea
                className="min-h-[96px] w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none"
                value={finalArtifacts}
                onChange={(event) => setFinalArtifacts(event.target.value)}
                placeholder={"One item per line\nPR #84 merged\nRelease note updated\nObservability dashboard linked"}
              />
            </label>
            <label className="block md:col-span-2">
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Remaining risks</div>
              <textarea
                className="min-h-[88px] w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none"
                value={remainingRisks}
                onChange={(event) => setRemainingRisks(event.target.value)}
                placeholder={"One item per line\nKnown queue delay under peak load"}
              />
            </label>
          </div>
        )}

        {selectedAction === "CANCEL_TASK" && (
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block">
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Cancel type</div>
              <select
                className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none"
                value={cancelType}
                onChange={(event) => setCancelType(event.target.value as (typeof ISSUE_PROTOCOL_CANCEL_TYPES)[number])}
              >
                {ISSUE_PROTOCOL_CANCEL_TYPES.map((value) => (
                  <option key={value} value={value}>{formatProtocolValue(value)}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Replacement issue</div>
              <input
                className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none"
                value={replacementIssueId}
                onChange={(event) => setReplacementIssueId(event.target.value)}
                placeholder="Optional issue UUID"
              />
            </label>
            <label className="block md:col-span-2">
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Reason</div>
              <textarea
                className="min-h-[96px] w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none"
                value={cancelReason}
                onChange={(event) => setCancelReason(event.target.value)}
                placeholder="Explain why this task should stop and what replaces it."
              />
            </label>
          </div>
        )}

        {selectedAction === "NOTE" && (
          <div className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <label className="block">
                <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Note type</div>
                <select
                  className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none"
                  value={noteType}
                  onChange={(event) => setNoteType(event.target.value as (typeof ISSUE_PROTOCOL_NOTE_TYPES)[number])}
                >
                  {ISSUE_PROTOCOL_NOTE_TYPES.map((value) => (
                    <option key={value} value={value}>{formatProtocolValue(value)}</option>
                  ))}
                </select>
              </label>
              <div>
                <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Audience</div>
                <div className="flex flex-wrap gap-2">
                  {([
                    ["tech_lead", protocolState?.techLeadAgentId],
                    ["engineer", protocolState?.primaryEngineerAgentId],
                    ["reviewer", protocolState?.reviewerAgentId],
                    ["human_board", currentUserId],
                  ] as const)
                    .filter(([, value]) => Boolean(value))
                    .map(([role]) => (
                      <label key={role} className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-xs">
                        <input
                          type="checkbox"
                          checked={noteAudience[role]}
                          onChange={(event) =>
                            setNoteAudience((current) => ({ ...current, [role]: event.target.checked }))
                          }
                        />
                        {formatProtocolValue(role)}
                      </label>
                    ))}
                </div>
              </div>
            </div>
            <label className="block">
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Note body</div>
              <textarea
                className="min-h-[120px] w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none"
                value={noteBody}
                onChange={(event) => setNoteBody(event.target.value)}
                placeholder="Write the board note, escalation context, or policy decision."
              />
            </label>
          </div>
        )}

        {selectedAction !== "NOTE" && (
          <label className="block">
            <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Artifacts</div>
            <textarea
              className="min-h-[88px] w-full rounded-md border border-border bg-transparent px-3 py-2 font-mono text-xs outline-none"
              value={artifactLines}
              onChange={(event) => setArtifactLines(event.target.value)}
              placeholder={"One artifact per line: kind|uri|label\ncommit|https://git/commit/abc|merge commit\ndoc|https://notion/spec|review note"}
            />
          </label>
        )}

        <div className="rounded-md border border-border bg-muted/20 px-3 py-3">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Additional recipients</div>
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_auto]">
            <select
              className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none"
              value={extraRecipientAgentId}
              onChange={(event) => setExtraRecipientAgentId(event.target.value)}
            >
              <option value="">Select additional agent</option>
              {activeAgents.map((agent) => (
                <option key={agent.id} value={agent.id}>{agent.name}</option>
              ))}
            </select>
            <select
              className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none"
              value={extraRecipientRole}
              onChange={(event) => setExtraRecipientRole(event.target.value as ExtraRecipientRole)}
            >
              <option value="engineer">Engineer</option>
              <option value="reviewer">Reviewer</option>
              <option value="tech_lead">Tech Lead</option>
            </select>
            <Button size="sm" variant="outline" onClick={addExtraRecipient} disabled={!extraRecipientAgentId}>
              Add recipient
            </Button>
          </div>
          {extraRecipientViews.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {extraRecipientViews.map((recipient) => (
                <button
                  key={`${recipient.recipientId}:${recipient.role}`}
                  type="button"
                  onClick={() => removeExtraRecipient(recipient.recipientId, recipient.role)}
                  className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent/50"
                >
                  {recipient.agentName} · {formatProtocolValue(recipient.role)} · remove
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-md border border-border bg-muted/20 px-3 py-3">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Payload preview</div>
          <pre className="overflow-auto whitespace-pre-wrap rounded-md border border-border bg-background px-3 py-3 text-xs text-foreground">
            {JSON.stringify({
              recipients: buildRecipients(),
              payload: payloadPreview,
              artifacts,
            }, null, 2)}
          </pre>
        </div>

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="flex items-center justify-between gap-3">
          <div className="text-xs text-muted-foreground">
            Sender: Human Board. Current participants are used as recipients unless the action explicitly selects new ownership.
          </div>
          <Button size="sm" onClick={() => void handleSubmit()} disabled={isSubmitting}>
            {isSubmitting ? "Posting..." : `Post ${formatProtocolValue(selectedAction)}`}
          </Button>
        </div>
      </div>
    </section>
  );
}
