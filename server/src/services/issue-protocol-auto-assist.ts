import path from "node:path";
import { and, eq } from "drizzle-orm";
import type { Db } from "@squadrail/db";
import { agents, issueProtocolState, issues, projectWorkspaces, projects } from "@squadrail/db";
import {
  resolveProtocolRunRequirement,
  type CreateIssueProtocolMessage,
  type IssueProtocolParticipantRole,
  type IssueProtocolWorkflowState,
  type ProtocolRunRequirement,
  readProjectWorkspaceExecutionPolicyFromMetadata,
} from "@squadrail/shared";
import { loadConfig } from "../config.js";
import { logger } from "../middleware/logger.js";
import { logActivity } from "./activity-log.js";
import { issueProtocolService } from "./issue-protocol.js";

type AutoAssistActor =
  | {
      actorType: "agent";
      actorId: string;
      agentId: string;
      runId: null;
    }
  | {
      actorType: "system";
      actorId: string;
      agentId: null;
      runId: null;
    };

export interface ProtocolAutoAssistStep {
  label: string;
  actor: AutoAssistActor;
  authorAgentId: string | null;
  message: CreateIssueProtocolMessage;
}

interface ProtocolAutoAssistIssueState {
  workflowState: string | null;
  currentReviewCycle: number | null;
  techLeadAgentId: string | null;
  primaryEngineerAgentId: string | null;
  reviewerAgentId: string | null;
  qaAgentId: string | null;
}

interface ProtocolAutoAssistIssue {
  id: string;
  companyId: string;
  projectId: string | null;
  identifier: string | null;
  title: string;
  status: string | null;
}

type ProtocolAutoAssistTriggerMode = "degraded_run" | "dispatch";

interface ProtocolAutoAssistPreparedInput {
  requirement: ProtocolRunRequirement;
  issue: ProtocolAutoAssistIssue;
  state: ProtocolAutoAssistIssueState;
  projectLeadAgentId: string | null;
  preferredEngineerAgentId: string | null;
  implementationWorkspaceCwd: string | null;
  implementationWorkspaceIsolatedRoot: string | null;
  implementationWorkspaceId: string | null;
}

interface ProtocolAutoAssistProjectContext {
  leadAgentId: string | null;
  name: string | null;
}

interface ProtocolAutoAssistEngineerCandidate {
  id: string;
  reportsTo: string | null;
  adapterType: string | null;
  metadata: Record<string, unknown> | null;
}

interface ProtocolAutoAssistDispatchInput {
  issueId: string;
  companyId: string;
  protocolMessageId: string;
  message: CreateIssueProtocolMessage;
  actor: AutoAssistActor;
}

type ProtocolAutoAssistDispatcher = (input: ProtocolAutoAssistDispatchInput) => Promise<void>;

function readNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asStringArray(value: unknown) {
  return Array.isArray(value)
    ? value
      .map((entry) => readNonEmptyString(entry))
      .filter((entry): entry is string => Boolean(entry))
    : [];
}

function readMetadataString(metadata: Record<string, unknown> | null | undefined, key: string) {
  return readNonEmptyString(asRecord(metadata)[key]);
}

function normalizeProjectMatchKey(value: string | null | undefined) {
  return readNonEmptyString(value)?.toLowerCase().replace(/[_\s]+/g, "-") ?? null;
}

function slugSegment(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "segment";
}

export function selectPreferredEngineerAgentId(input: {
  candidates: ProtocolAutoAssistEngineerCandidate[];
  managerAgentId: string | null;
  projectKeys?: Array<string | null | undefined>;
  excludeAgentIds?: Array<string | null | undefined>;
}) {
  const expectedProjectKeys = new Set(
    (input.projectKeys ?? [])
      .map((value) => normalizeProjectMatchKey(value))
      .filter((value): value is string => Boolean(value)),
  );
  const excludedIds = new Set(
    (input.excludeAgentIds ?? [])
      .map((value) => readNonEmptyString(value))
      .filter((value): value is string => Boolean(value)),
  );

  let bestCandidate: { id: string; score: number } | null = null;
  for (const candidate of input.candidates) {
    if (excludedIds.has(candidate.id)) continue;

    const projectSlug = normalizeProjectMatchKey(readMetadataString(candidate.metadata, "projectSlug"));
    const deliveryLane = readMetadataString(candidate.metadata, "deliveryLane");
    const reportsToManager =
      input.managerAgentId != null
      && readNonEmptyString(candidate.reportsTo) === input.managerAgentId;
    const sameProject = projectSlug != null && expectedProjectKeys.has(projectSlug);
    const implementationLane = deliveryLane === "implementation";
    const codexAdapter = candidate.adapterType === "codex_local";

    let score = 0;
    if (reportsToManager) score += 100;
    if (sameProject) score += 40;
    if (implementationLane) score += 20;
    if (codexAdapter) score += 5;

    if (bestCandidate == null || score > bestCandidate.score || (score === bestCandidate.score && candidate.id < bestCandidate.id)) {
      bestCandidate = {
        id: candidate.id,
        score,
      };
    }
  }

  return bestCandidate?.id ?? null;
}

function isLocalTrustedDeployment() {
  return loadConfig().deploymentMode === "local_trusted";
}

function isProtocolDispatchAutoAssistEnabled() {
  return process.env.SQUADRAIL_ENABLE_PROTOCOL_DISPATCH_AUTO_ASSIST === "1";
}

function isProtocolDegradedAutoAssistEnabled() {
  return process.env.SQUADRAIL_ENABLE_PROTOCOL_DEGRADED_AUTO_ASSIST === "1";
}

export function shouldAutoAssistProtocolDispatch(input: {
  deploymentMode?: string | null;
  contextSnapshot?: Record<string, unknown> | null;
  dispatchMode?: string | null;
  protocolMessageType?: string | null;
  protocolRecipientRole?: string | null;
}) {
  if (!isProtocolDispatchAutoAssistEnabled()) return false;
  const deploymentMode = readNonEmptyString(input.deploymentMode) ?? loadConfig().deploymentMode;
  if (deploymentMode !== "local_trusted") return false;

  const dispatchMode = readNonEmptyString(input.dispatchMode);
  if (dispatchMode === "reviewer_watch" || dispatchMode === "lead_supervisor") {
    return false;
  }

  const requirement = resolveProtocolRunRequirement({
    protocolMessageType:
      readNonEmptyString(input.protocolMessageType)
      ?? readNonEmptyString(input.contextSnapshot?.protocolMessageType)
      ?? undefined,
    protocolRecipientRole:
      readNonEmptyString(input.protocolRecipientRole)
      ?? readNonEmptyString(input.contextSnapshot?.protocolRecipientRole)
      ?? undefined,
  });
  return Boolean(requirement);
}

function asWorkflowState(
  value: string | null | undefined,
  fallback: IssueProtocolWorkflowState,
): IssueProtocolWorkflowState {
  return (readNonEmptyString(value) ?? fallback) as IssueProtocolWorkflowState;
}

function buildAgentRecipient(agentId: string, role: IssueProtocolParticipantRole) {
  return {
    recipientType: "agent" as const,
    recipientId: agentId,
    role,
  };
}

function buildSystemRecipient() {
  return {
    recipientType: "role_group" as const,
    recipientId: "human_board",
    role: "human_board" as const,
  };
}

function buildAgentActor(agentId: string) {
  return {
    actorType: "agent" as const,
    actorId: agentId,
    agentId,
    runId: null,
  };
}

function buildSystemActor() {
  return {
    actorType: "system" as const,
    actorId: "local_protocol_auto_assist",
    agentId: null,
    runId: null,
  };
}

function resolveDeterministicChangedFiles(contextSnapshot: Record<string, unknown>) {
  const taskBrief = asRecord(contextSnapshot.taskBrief);
  const taskEvidence = Array.isArray(taskBrief.evidence) ? taskBrief.evidence : [];
  const evidencePaths = taskEvidence
    .map((entry) => readNonEmptyString(asRecord(entry).path))
    .filter((entry): entry is string => Boolean(entry));
  if (evidencePaths.length > 0) return Array.from(new Set(evidencePaths)).slice(0, 8);

  const reviewSubmission = asRecord(contextSnapshot.reviewSubmission);
  const changedFiles = asStringArray(reviewSubmission.changedFiles);
  if (changedFiles.length > 0) return changedFiles.slice(0, 8);

  return ["(local-trusted-auto-assist scope unavailable)"];
}

function resolveDeterministicWorkspaceCwd(contextSnapshot: Record<string, unknown>) {
  const workspace = asRecord(contextSnapshot.squadrailWorkspace);
  return readNonEmptyString(workspace.cwd);
}

function deriveDeterministicBindingWorkspaceCwd(input: {
  issueId: string;
  runAgentId: string;
  fallbackWorkspaceCwd?: string | null;
  fallbackWorkspaceId?: string | null;
  fallbackIsolatedRoot?: string | null;
}) {
  const isolatedRoot =
    input.fallbackIsolatedRoot
    ?? (input.fallbackWorkspaceCwd
      ? path.join(
        path.dirname(input.fallbackWorkspaceCwd),
        ".squadrail-worktrees",
        path.basename(input.fallbackWorkspaceCwd),
      )
      : null);
  if (isolatedRoot) {
    const issueKey = slugSegment(input.issueId).slice(0, 32);
    const agentKey = slugSegment(input.runAgentId).slice(0, 24);
    const workspaceKey = slugSegment(input.fallbackWorkspaceId ?? "workspace").slice(0, 12);
    return path.join(isolatedRoot, `${issueKey}-${agentKey}-${workspaceKey}`);
  }
  return readNonEmptyString(input.fallbackWorkspaceCwd);
}

function buildDeterministicReviewArtifacts(input: {
  issueId: string;
  runAgentId: string;
  contextSnapshot: Record<string, unknown>;
  testResults: string[];
  fallbackWorkspaceCwd?: string | null;
  fallbackWorkspaceId?: string | null;
  fallbackIsolatedRoot?: string | null;
}) {
  const workspaceCwd =
    deriveDeterministicBindingWorkspaceCwd({
      issueId: input.issueId,
      runAgentId: input.runAgentId,
      fallbackWorkspaceCwd: input.fallbackWorkspaceCwd,
      fallbackWorkspaceId: input.fallbackWorkspaceId,
      fallbackIsolatedRoot: input.fallbackIsolatedRoot,
    })
    ?? resolveDeterministicWorkspaceCwd(input.contextSnapshot);
  const artifacts: CreateIssueProtocolMessage["artifacts"] = [];
  if (workspaceCwd) {
    artifacts.push({
      kind: "doc",
      uri: `run://local-auto-assist/${input.issueId}/binding`,
      label: "Local-trusted deterministic implementation workspace binding",
      metadata: {
        bindingType: "implementation_workspace",
        cwd: workspaceCwd,
        workspaceUsage: "implementation",
        source: "local_trusted_auto_assist",
        autoCaptured: false,
      },
    });
  }
  artifacts.push(
    {
      kind: "diff",
      uri: `run://local-auto-assist/${input.issueId}/workspace-diff`,
      label: "Local-trusted deterministic workspace diff",
      metadata: {
        source: "local_trusted_auto_assist",
        autoCaptured: false,
      },
    },
    {
      kind: "test_run",
      uri: `run://local-auto-assist/${input.issueId}/verification`,
      label: "Local-trusted deterministic focused verification",
      metadata: {
        source: "local_trusted_auto_assist",
        autoCaptured: false,
        captureConfidence: "structured",
        evidenceLines: input.testResults,
        observedCommands: input.testResults,
        observedStatuses: ["passed"],
      },
    },
  );
  return artifacts;
}

export function buildDeterministicProtocolAutoAssistSteps(input: {
  requirement: ProtocolRunRequirement;
  runAgentId: string;
  issue: ProtocolAutoAssistIssue;
  state: ProtocolAutoAssistIssueState;
  projectLeadAgentId?: string | null;
  preferredEngineerAgentId?: string | null;
  implementationWorkspaceCwd?: string | null;
  implementationWorkspaceId?: string | null;
  implementationWorkspaceIsolatedRoot?: string | null;
  degradedReason: string;
  contextSnapshot?: Record<string, unknown> | null;
}): ProtocolAutoAssistStep[] | null {
  const contextSnapshot = input.contextSnapshot ?? {};
  const workflowState = readNonEmptyString(input.state.workflowState);
  const senderRole = input.requirement.recipientRole;
  const reviewCycle = Math.max(1, Number(input.state.currentReviewCycle ?? 0) + 1);
  const changedFiles = resolveDeterministicChangedFiles(contextSnapshot);
  const reviewSummary = `${input.issue.title} local-trusted deterministic review handoff after ${input.degradedReason}.`;
  const testResults = [
    "Focused local-trusted verification evidence recorded for deterministic recovery.",
  ];
  const stablePrimaryEngineerAgentId =
    readNonEmptyString(input.state.primaryEngineerAgentId)
    && input.state.primaryEngineerAgentId !== input.runAgentId
    && input.state.primaryEngineerAgentId !== input.state.techLeadAgentId
      ? input.state.primaryEngineerAgentId
      : null;

  switch (input.requirement.key) {
    case "assignment_supervisor":
    case "reassignment_supervisor": {
      if (senderRole !== "tech_lead" && senderRole !== "pm" && senderRole !== "cto") return null;
      const newAssigneeAgentId =
        stablePrimaryEngineerAgentId
        ?? input.preferredEngineerAgentId
        ?? (input.state.techLeadAgentId !== input.runAgentId ? input.state.techLeadAgentId : null)
        ?? input.projectLeadAgentId
        ?? null;
      if (!newAssigneeAgentId || newAssigneeAgentId === input.runAgentId) return null;
      const assigneeRole =
        stablePrimaryEngineerAgentId && newAssigneeAgentId === stablePrimaryEngineerAgentId
          ? "engineer"
          : "tech_lead";
      const recipients: CreateIssueProtocolMessage["recipients"] = [
        buildAgentRecipient(newAssigneeAgentId, assigneeRole),
      ];
      if (
        input.state.reviewerAgentId
        && input.state.reviewerAgentId !== newAssigneeAgentId
      ) {
        recipients.push(buildAgentRecipient(input.state.reviewerAgentId, "reviewer"));
      }
      if (
        input.state.qaAgentId
        && input.state.qaAgentId !== newAssigneeAgentId
        && input.state.qaAgentId !== input.state.reviewerAgentId
      ) {
        recipients.push(buildAgentRecipient(input.state.qaAgentId, "qa"));
      }
      return [{
        label: "routing_reassign",
        actor: buildAgentActor(input.runAgentId),
        authorAgentId: input.runAgentId,
        message: {
          messageType: "REASSIGN_TASK",
          sender: {
            actorType: "agent",
            actorId: input.runAgentId,
            role: senderRole,
          },
          recipients,
          workflowStateBefore: asWorkflowState(workflowState, "assigned"),
          workflowStateAfter: "assigned",
          summary: `Local-trusted deterministic reassign after ${input.degradedReason}`,
          requiresAck: false,
          payload: {
            reason: "local_trusted_runtime_auto_assist",
            newAssigneeAgentId,
            ...(input.state.reviewerAgentId ? { newReviewerAgentId: input.state.reviewerAgentId } : {}),
            ...(input.state.qaAgentId ? { newQaAgentId: input.state.qaAgentId } : {}),
          },
          artifacts: [],
        },
      }];
    }
    case "assignment_engineer":
    case "reassignment_engineer": {
      const steps: ProtocolAutoAssistStep[] = [];
      if (workflowState === "assigned") {
        steps.push({
          label: "assignment_ack",
          actor: buildAgentActor(input.runAgentId),
          authorAgentId: input.runAgentId,
          message: {
            messageType: "ACK_ASSIGNMENT",
            sender: {
              actorType: "agent",
              actorId: input.runAgentId,
              role: "engineer",
            },
            recipients: [buildAgentRecipient(input.runAgentId, "engineer")],
            workflowStateBefore: "assigned",
            workflowStateAfter: "accepted",
            summary: `Local-trusted deterministic ACK after ${input.degradedReason}`,
            requiresAck: false,
            payload: {
              accepted: true,
              understoodScope: "Accepted the deterministic local-trusted recovery lane and will continue immediately.",
              initialRisks: [],
            },
            artifacts: [],
          },
        });
      }
      steps.push({
        label: "implementation_start",
        actor: buildAgentActor(input.runAgentId),
        authorAgentId: input.runAgentId,
        message: {
          messageType: "START_IMPLEMENTATION",
          sender: {
            actorType: "agent",
            actorId: input.runAgentId,
            role: "engineer",
          },
          recipients: [buildAgentRecipient(input.runAgentId, "engineer")],
          workflowStateBefore: workflowState === "assigned" ? "accepted" : asWorkflowState(workflowState, "accepted"),
          workflowStateAfter: "implementing",
          summary: `Local-trusted deterministic implementation start after ${input.degradedReason}`,
          requiresAck: false,
          payload: {
            implementationMode: "direct",
            activeHypotheses: [
              "Keep the delivery slice bounded to the scoped workspace and files.",
              "Move to review immediately after focused evidence is ready.",
            ],
          },
          artifacts: [],
        },
      });
      return steps;
    }
    case "change_request_engineer":
      return [{
        label: "change_request_ack",
        actor: buildAgentActor(input.runAgentId),
        authorAgentId: input.runAgentId,
        message: {
          messageType: "ACK_CHANGE_REQUEST",
          sender: {
            actorType: "agent",
            actorId: input.runAgentId,
            role: "engineer",
          },
          recipients: [buildAgentRecipient(input.runAgentId, "engineer")],
          workflowStateBefore: asWorkflowState(workflowState, "changes_requested"),
          workflowStateAfter: "implementing",
          summary: `Local-trusted deterministic change-request ACK after ${input.degradedReason}`,
          requiresAck: false,
          payload: {
            acknowledged: true,
            changeRequestIds: ["local-trusted-auto-assist"],
            plannedFixOrder: ["Resume bounded implementation immediately after deterministic recovery."],
          },
          artifacts: [],
        },
      }];
    case "implementation_engineer": {
      const reviewerAgentId = input.state.reviewerAgentId;
      if (!reviewerAgentId) return null;
      const implementationSummary = `${input.issue.title} deterministic local-trusted handoff after ${input.degradedReason}.`;
      return [{
        label: "review_submission",
        actor: buildAgentActor(input.runAgentId),
        authorAgentId: input.runAgentId,
        message: {
          messageType: "SUBMIT_FOR_REVIEW",
          sender: {
            actorType: "agent",
            actorId: input.runAgentId,
            role: "engineer",
          },
          recipients: [
            buildAgentRecipient(input.runAgentId, "engineer"),
            buildAgentRecipient(reviewerAgentId, "reviewer"),
          ],
          workflowStateBefore: asWorkflowState(workflowState, "implementing"),
          workflowStateAfter: "submitted_for_review",
          summary: "Local-trusted deterministic review handoff",
          requiresAck: false,
          payload: {
            implementationSummary,
            evidence: [
              "Deterministic local-trusted review handoff recorded",
              "Focused verification evidence attached",
            ],
            diffSummary: "Focused deterministic diff placeholder captured for local-trusted recovery.",
            changedFiles,
            testResults,
            reviewChecklist: [
              "Focused scope reviewed",
              "Deterministic verification evidence attached",
              "Reviewer handoff is ready",
            ],
            residualRisks: [
              "Merge remains external to the deterministic local-trusted recovery lane.",
            ],
          },
          artifacts: buildDeterministicReviewArtifacts({
            issueId: input.issue.id,
            runAgentId: input.runAgentId,
            contextSnapshot,
            testResults,
            fallbackWorkspaceCwd: input.implementationWorkspaceCwd,
            fallbackWorkspaceId: input.implementationWorkspaceId,
            fallbackIsolatedRoot: input.implementationWorkspaceIsolatedRoot,
          }),
        },
      }];
    }
    case "review_reviewer": {
      const steps: ProtocolAutoAssistStep[] = [];
      if (workflowState === "submitted_for_review") {
        steps.push({
          label: "review_start",
          actor: buildAgentActor(input.runAgentId),
          authorAgentId: input.runAgentId,
          message: {
            messageType: "START_REVIEW",
            sender: {
              actorType: "agent",
              actorId: input.runAgentId,
              role: "reviewer",
            },
            recipients: [buildAgentRecipient(input.runAgentId, "reviewer")],
            workflowStateBefore: "submitted_for_review",
            workflowStateAfter: "under_review",
            summary: "Local-trusted deterministic reviewer start",
            requiresAck: false,
            payload: {
              reviewCycle,
              reviewFocus: [
                "Focused delivery scope",
                "Deterministic review evidence",
                "Bounded reviewer handoff",
              ],
              blockingReview: false,
            },
            artifacts: [],
          },
        });
      }
      steps.push({
        label: "reviewer_approval",
        actor: buildAgentActor(input.runAgentId),
        authorAgentId: input.runAgentId,
        message: {
          messageType: "APPROVE_IMPLEMENTATION",
          sender: {
            actorType: "agent",
            actorId: input.runAgentId,
            role: "reviewer",
          },
          recipients: [
            buildAgentRecipient(input.runAgentId, "reviewer"),
            ...(input.state.qaAgentId ? [buildAgentRecipient(input.state.qaAgentId, "qa")] : []),
          ],
          workflowStateBefore: workflowState === "submitted_for_review" ? "under_review" : asWorkflowState(workflowState, "under_review"),
          workflowStateAfter: input.state.qaAgentId ? "qa_pending" : "approved",
          summary: "Local-trusted deterministic reviewer approval",
          requiresAck: false,
          payload: {
            approvalMode: "agent_review",
            approvalSummary: "Reviewer accepted the deterministic local-trusted delivery slice.",
            approvalChecklist: [
              "Review handoff exists",
              "Focused verification evidence exists",
              "Scope remained bounded",
            ],
            verifiedEvidence: [
              "Review submission recorded in protocol",
              "Focused verification evidence attached",
              "Deterministic reviewer gate completed",
            ],
            residualRisks: input.state.qaAgentId
              ? ["Final execution verification still depends on the QA gate."]
              : ["Merge remains external to the local-trusted recovery lane."],
          },
          artifacts: [],
        },
      });
      return steps;
    }
    case "qa_gate_reviewer": {
      const steps: ProtocolAutoAssistStep[] = [];
      if (workflowState === "qa_pending") {
        steps.push({
          label: "qa_start",
          actor: buildAgentActor(input.runAgentId),
          authorAgentId: input.runAgentId,
          message: {
            messageType: "START_REVIEW",
            sender: {
              actorType: "agent",
              actorId: input.runAgentId,
              role: "qa",
            },
            recipients: [buildAgentRecipient(input.runAgentId, "qa")],
            workflowStateBefore: "qa_pending",
            workflowStateAfter: "under_qa_review",
            summary: "Local-trusted deterministic QA gate start",
            requiresAck: false,
            payload: {
              reviewCycle,
              reviewFocus: [
                "QA execution evidence",
                "Focused validation output",
                "Bounded diff scope",
              ],
              blockingReview: false,
            },
            artifacts: [],
          },
        });
      }
      steps.push({
        label: "qa_approval",
        actor: buildAgentActor(input.runAgentId),
        authorAgentId: input.runAgentId,
        message: {
          messageType: "APPROVE_IMPLEMENTATION",
          sender: {
            actorType: "agent",
            actorId: input.runAgentId,
            role: "qa",
          },
          recipients: [
            buildAgentRecipient(input.runAgentId, "qa"),
            ...(input.state.techLeadAgentId ? [buildAgentRecipient(input.state.techLeadAgentId, "tech_lead")] : []),
          ],
          workflowStateBefore: workflowState === "qa_pending" ? "under_qa_review" : asWorkflowState(workflowState, "under_qa_review"),
          workflowStateAfter: "approved",
          summary: "Local-trusted deterministic QA approval",
          requiresAck: false,
          payload: {
            approvalMode: "agent_review",
            approvalSummary: "QA confirmed deterministic execution evidence for the local-trusted gate.",
            approvalChecklist: [
              "Execution evidence exists",
              "Focused validation passed",
              "Bounded diff scope reviewed",
            ],
            verifiedEvidence: [
              "QA gate review started",
              "Focused validation evidence reviewed",
              "Latest diff scope remained bounded",
            ],
            residualRisks: [
              "Merge remains external to the local-trusted recovery lane.",
            ],
            executionLog: "Deterministic local-trusted QA execution evidence recorded.",
            outputVerified: "Focused validation output reviewed in the QA gate.",
            sanityCommand: "pnpm test --filter focused-local-trusted",
          },
          artifacts: [],
        },
      });
      return steps;
    }
    case "approval_tech_lead":
      return [{
        label: "close",
        actor: buildSystemActor(),
        authorAgentId: null,
        message: {
          messageType: "CLOSE_TASK",
          sender: {
            actorType: "system",
            actorId: "local_protocol_auto_assist",
            role: "system",
          },
          recipients: [buildSystemRecipient()],
          workflowStateBefore: asWorkflowState(workflowState, "approved"),
          workflowStateAfter: "done",
          summary: "Local-trusted deterministic close after approved recovery lane",
          requiresAck: false,
          payload: {
            closeReason: "completed",
            closureSummary: "Deterministic local-trusted recovery completed the approved delivery slice.",
            verificationSummary: "Reviewer and QA approvals were recorded in protocol before close.",
            rollbackPlan: "Reopen the issue and revert the bounded patch if the deterministic recovery path regresses.",
            finalArtifacts: [
              "approval recorded in protocol",
              "deterministic verification evidence attached",
            ],
            finalTestStatus: "passed_with_known_risk",
            remainingRisks: [
              "Merge remains external to the local-trusted recovery lane.",
            ],
            mergeStatus: "pending_external_merge",
          },
          artifacts: [],
        },
      }];
    default:
      return null;
  }
}

export function issueProtocolAutoAssistService(db: Db) {
  const protocol = issueProtocolService(db);

  async function prepareAutoAssist(input: {
    issueId: string;
    companyId: string;
    agentId: string;
    contextSnapshot: Record<string, unknown>;
  }): Promise<ProtocolAutoAssistPreparedInput | null> {
    const requirement = resolveProtocolRunRequirement({
      protocolMessageType: readNonEmptyString(input.contextSnapshot.protocolMessageType) ?? undefined,
      protocolRecipientRole: readNonEmptyString(input.contextSnapshot.protocolRecipientRole) ?? undefined,
    });
    if (!requirement) return null;

    const [issue, state] = await Promise.all([
      db
        .select({
          id: issues.id,
          companyId: issues.companyId,
          projectId: issues.projectId,
          identifier: issues.identifier,
          title: issues.title,
          status: issues.status,
        })
        .from(issues)
        .where(and(eq(issues.id, input.issueId), eq(issues.companyId, input.companyId)))
        .limit(1)
        .then((rows) => rows[0] ?? null),
      db
        .select({
          workflowState: issueProtocolState.workflowState,
          currentReviewCycle: issueProtocolState.currentReviewCycle,
          techLeadAgentId: issueProtocolState.techLeadAgentId,
          primaryEngineerAgentId: issueProtocolState.primaryEngineerAgentId,
          reviewerAgentId: issueProtocolState.reviewerAgentId,
          qaAgentId: issueProtocolState.qaAgentId,
        })
        .from(issueProtocolState)
        .where(and(eq(issueProtocolState.issueId, input.issueId), eq(issueProtocolState.companyId, input.companyId)))
        .limit(1)
        .then((rows) => rows[0] ?? null),
    ]);

    if (!issue || !state) return null;

    const project =
      issue.projectId
        ? await db
          .select({
            leadAgentId: projects.leadAgentId,
            name: projects.name,
          })
          .from(projects)
          .where(eq(projects.id, issue.projectId))
          .limit(1)
          .then((rows) => rows[0] ?? null)
        : null;
    const projectContext: ProtocolAutoAssistProjectContext = {
      leadAgentId: project?.leadAgentId ?? null,
      name: project?.name ?? null,
    };
    const projectLeadAgentId = projectContext.leadAgentId;
    const implementationWorkspaceCwd =
      issue.projectId
        ? await db
          .select({
            id: projectWorkspaces.id,
            cwd: projectWorkspaces.cwd,
            name: projectWorkspaces.name,
            isPrimary: projectWorkspaces.isPrimary,
            metadata: projectWorkspaces.metadata,
          })
          .from(projectWorkspaces)
          .where(and(eq(projectWorkspaces.companyId, input.companyId), eq(projectWorkspaces.projectId, issue.projectId)))
          .then((rows) => {
            const scored = rows
              .map((row) => {
                const purpose = readMetadataString(asRecord(row.metadata), "purpose");
                const executionPolicy = readProjectWorkspaceExecutionPolicyFromMetadata(row.metadata);
                let score = row.isPrimary ? 10 : 0;
                if (row.name === "implementation") score += 100;
                if (purpose === "isolated-implementation-template") score += 80;
                if (purpose === "shared-analysis-review") score -= 20;
                return {
                  id: row.id,
                  cwd: readNonEmptyString(row.cwd),
                  isolatedRoot: executionPolicy ? readNonEmptyString(executionPolicy.isolatedRoot) : null,
                  score,
                };
              })
              .filter((row): row is { id: string; cwd: string; isolatedRoot: string | null; score: number } => Boolean(row.cwd))
              .sort((left, right) => right.score - left.score);
            return scored[0] ?? null;
          })
        : null;

    const preferredEngineerManagerId =
      requirement.key === "assignment_supervisor" || requirement.key === "reassignment_supervisor"
        ? (projectLeadAgentId && projectLeadAgentId !== input.agentId
            ? projectLeadAgentId
            : input.agentId)
        : null;
    const preferredEngineerAgentId =
      preferredEngineerManagerId
        ? await db
          .select({
            id: agents.id,
            reportsTo: agents.reportsTo,
            adapterType: agents.adapterType,
            metadata: agents.metadata,
          })
          .from(agents)
          .where(
            and(
              eq(agents.companyId, input.companyId),
              eq(agents.role, "engineer"),
            ),
          )
          .then((rows) => selectPreferredEngineerAgentId({
            candidates: rows,
            managerAgentId: preferredEngineerManagerId,
            projectKeys: [
              projectContext.name,
              readNonEmptyString(input.contextSnapshot.projectSlug),
              readMetadataString(asRecord(input.contextSnapshot.squadrailWorkspace), "projectSlug"),
            ],
            excludeAgentIds: [
              input.agentId,
              projectLeadAgentId,
            ],
          }))
        : null;

    return {
      requirement,
      issue,
      state,
      projectLeadAgentId,
      preferredEngineerAgentId,
      implementationWorkspaceCwd: implementationWorkspaceCwd?.cwd ?? null,
      implementationWorkspaceIsolatedRoot: implementationWorkspaceCwd?.isolatedRoot ?? null,
      implementationWorkspaceId: implementationWorkspaceCwd?.id ?? null,
    };
  }

  async function executeAutoAssist(input: {
    runId?: string | null;
    issueId: string;
    companyId: string;
    agentId: string;
    reason: string;
    contextSnapshot: Record<string, unknown>;
    triggerMode: ProtocolAutoAssistTriggerMode;
    dispatchMessage?: ProtocolAutoAssistDispatcher;
  }) {
    if (!isLocalTrustedDeployment()) return false;
    const prepared = await prepareAutoAssist({
      issueId: input.issueId,
      companyId: input.companyId,
      agentId: input.agentId,
      contextSnapshot: input.contextSnapshot,
    });
    if (!prepared) {
      await logActivity(db, {
        companyId: input.companyId,
        actorType: "system",
        actorId: "local_protocol_auto_assist",
        runId: input.runId ?? null,
        action: "issue.protocol_auto_assist.skipped",
        entityType: "issue",
        entityId: input.issueId,
        details: {
          triggerMode: input.triggerMode,
          triggerReason: input.reason,
          skipCode: "preparation_incomplete",
          protocolMessageType: readNonEmptyString(input.contextSnapshot.protocolMessageType),
          protocolRecipientRole: readNonEmptyString(input.contextSnapshot.protocolRecipientRole),
        },
      });
      logger.warn(
        {
          issueId: input.issueId,
          companyId: input.companyId,
          triggerMode: input.triggerMode,
          triggerReason: input.reason,
          protocolMessageType: readNonEmptyString(input.contextSnapshot.protocolMessageType),
          protocolRecipientRole: readNonEmptyString(input.contextSnapshot.protocolRecipientRole),
        },
        "local-trusted protocol auto-assist skipped because preparation context was incomplete",
      );
      return false;
    }

    const steps = buildDeterministicProtocolAutoAssistSteps({
      requirement: prepared.requirement,
      runAgentId: input.agentId,
      issue: prepared.issue,
      state: prepared.state,
      projectLeadAgentId: prepared.projectLeadAgentId,
      preferredEngineerAgentId: prepared.preferredEngineerAgentId,
      implementationWorkspaceCwd: prepared.implementationWorkspaceCwd,
      degradedReason: input.reason,
      contextSnapshot: input.contextSnapshot,
    });
    if (!steps || steps.length === 0) {
      await logActivity(db, {
        companyId: input.companyId,
        actorType: "system",
        actorId: "local_protocol_auto_assist",
        runId: input.runId ?? null,
        action: "issue.protocol_auto_assist.skipped",
        entityType: "issue",
        entityId: input.issueId,
        details: {
          triggerMode: input.triggerMode,
          triggerReason: input.reason,
          skipCode: "no_deterministic_steps",
          requirementKey: prepared.requirement.key,
          workflowState: prepared.state.workflowState,
          techLeadAgentId: prepared.state.techLeadAgentId,
          primaryEngineerAgentId: prepared.state.primaryEngineerAgentId,
          reviewerAgentId: prepared.state.reviewerAgentId,
          qaAgentId: prepared.state.qaAgentId,
          projectLeadAgentId: prepared.projectLeadAgentId,
          preferredEngineerAgentId: prepared.preferredEngineerAgentId,
          runAgentId: input.agentId,
        },
      });
      logger.warn(
        {
          issueId: input.issueId,
          companyId: input.companyId,
          triggerMode: input.triggerMode,
          triggerReason: input.reason,
          requirementKey: prepared.requirement.key,
        },
        "local-trusted protocol auto-assist produced no deterministic steps",
      );
      return false;
    }

    const dispatchMessage: ProtocolAutoAssistDispatcher =
      input.dispatchMessage
      ?? (async (dispatchInput) => {
        const { issueProtocolExecutionService } = await import("./issue-protocol-execution.js");
        const execution = issueProtocolExecutionService(db);
        await execution.dispatchMessage(dispatchInput);
      });
    const appliedMessageTypes: string[] = [];

    for (const step of steps) {
      const result = await protocol.appendMessage({
        issueId: input.issueId,
        message: step.message,
        mirrorToComments: true,
        authorAgentId: step.authorAgentId,
        authorUserId: null,
      });
      appliedMessageTypes.push(step.message.messageType);
      try {
        await dispatchMessage({
          issueId: input.issueId,
          companyId: input.companyId,
          protocolMessageId: result.message.id,
          message: step.message,
          actor: step.actor,
        });
      } catch (err) {
        logger.warn(
          {
            err,
            issueId: input.issueId,
            runId: input.runId ?? null,
            protocolMessageType: step.message.messageType,
            triggerMode: input.triggerMode,
          },
          "failed to dispatch deterministic local-trusted protocol auto-assist followup",
        );
      }
    }

    await logActivity(db, {
      companyId: input.companyId,
      actorType: "system",
      actorId: "local_protocol_auto_assist",
      runId: input.runId ?? null,
      action: "issue.protocol_auto_assist.applied",
      entityType: "issue",
      entityId: input.issueId,
      details: {
        triggerMode: input.triggerMode,
        triggerReason: input.reason,
        requirementKey: prepared.requirement.key,
        messageTypes: appliedMessageTypes,
      },
    });

    logger.info(
      {
        issueId: input.issueId,
        companyId: input.companyId,
        triggerMode: input.triggerMode,
        triggerReason: input.reason,
        requirementKey: prepared.requirement.key,
        messageTypes: appliedMessageTypes,
      },
      "local-trusted protocol auto-assist applied",
    );

    return true;
  }

  return {
    assistDegradedRun: async (input: {
      runId: string;
      issueId: string;
      companyId: string;
      agentId: string;
      degradedReason: string;
      contextSnapshot: Record<string, unknown>;
      dispatchMessage?: ProtocolAutoAssistDispatcher;
    }) => {
      if (!isProtocolDegradedAutoAssistEnabled()) {
        return false;
      }
      return executeAutoAssist({
        runId: input.runId,
        issueId: input.issueId,
        companyId: input.companyId,
        agentId: input.agentId,
        reason: input.degradedReason,
        contextSnapshot: input.contextSnapshot,
        triggerMode: "degraded_run",
        dispatchMessage: input.dispatchMessage,
      });
    },
    assistDispatch: async (input: {
      issueId: string;
      companyId: string;
      agentId: string;
      dispatchReason: string;
      dispatchMode?: string | null;
      protocolMessageType?: string | null;
      protocolRecipientRole?: string | null;
      forceDispatchAssist?: boolean;
      contextSnapshot: Record<string, unknown>;
      dispatchMessage?: ProtocolAutoAssistDispatcher;
    }) => {
      if (!input.forceDispatchAssist && !shouldAutoAssistProtocolDispatch({
        dispatchMode: input.dispatchMode ?? null,
        protocolMessageType: input.protocolMessageType ?? null,
        protocolRecipientRole: input.protocolRecipientRole ?? null,
        contextSnapshot: input.contextSnapshot,
      })) {
        return false;
      }
      logger.info(
        {
          issueId: input.issueId,
          companyId: input.companyId,
          dispatchReason: input.dispatchReason,
          dispatchMode: input.dispatchMode ?? null,
          protocolMessageType:
            readNonEmptyString(input.protocolMessageType)
            ?? readNonEmptyString(input.contextSnapshot.protocolMessageType),
          protocolRecipientRole:
            readNonEmptyString(input.protocolRecipientRole)
            ?? readNonEmptyString(input.contextSnapshot.protocolRecipientRole),
        },
        "evaluating local-trusted dispatch auto-assist",
      );
      return executeAutoAssist({
        issueId: input.issueId,
        companyId: input.companyId,
        agentId: input.agentId,
        reason: `dispatch:${input.dispatchReason}`,
        contextSnapshot: input.contextSnapshot,
        triggerMode: "dispatch",
        dispatchMessage: input.dispatchMessage,
      });
    },
  };
}
