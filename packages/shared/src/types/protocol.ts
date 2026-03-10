import type {
  IssuePriority,
  IssueStatus,
  IssueProtocolActorType,
  IssueProtocolApprovalMode,
  IssueProtocolArtifactKind,
  IssueProtocolBlockedPhase,
  IssueProtocolBlockerCode,
  IssueProtocolCancelType,
  IssueProtocolClarificationType,
  IssueProtocolCloseReason,
  IssueProtocolDecisionType,
  IssueProtocolFinalTestStatus,
  IssueProtocolImplementationMode,
  IssueProtocolMergeStatus,
  IssueProtocolMessageType,
  IssueProtocolNoteType,
  IssueProtocolParticipantRole,
  IssueProtocolRecipientType,
  IssueProtocolRequestTargetRole,
  IssueProtocolReviewOutcome,
  IssueProtocolReviewSeverity,
  IssueProtocolRole,
  IssueProtocolTimeoutCode,
  IssueProtocolViolationCode,
  IssueProtocolViolationSeverity,
  IssueProtocolViolationStatus,
  IssueProtocolWorkflowState,
} from "../constants.js";

export interface IssueProtocolActor {
  actorType: IssueProtocolActorType;
  actorId: string;
  role: IssueProtocolRole;
}

export interface IssueProtocolRecipient {
  recipientType: IssueProtocolRecipientType;
  recipientId: string;
  role: IssueProtocolParticipantRole;
}

export interface IssueProtocolArtifact {
  kind: IssueProtocolArtifactKind;
  uri: string;
  label?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface IssueProtocolAssignTaskPayload {
  goal: string;
  acceptanceCriteria: string[];
  definitionOfDone: string[];
  priority: IssuePriority;
  assigneeAgentId: string;
  reviewerAgentId: string;
  qaAgentId?: string | null;
  deadlineAt?: string | null;
  relatedIssueIds?: string[];
  requiredKnowledgeTags?: string[];
}

export interface IssueProtocolAckAssignmentPayload {
  accepted: true;
  understoodScope: string;
  initialRisks?: string[];
}

export interface IssueProtocolAskClarificationPayload {
  questionType: IssueProtocolClarificationType;
  question: string;
  blocking: boolean;
  requestedFrom: IssueProtocolRequestTargetRole;
  relatedArtifacts?: string[];
  proposedAssumptions?: string[];
}

export interface IssueProtocolPlanStep {
  title: string;
  expectedOutcome: string;
  dependsOn?: string[];
}

export interface IssueProtocolProposePlanPayload {
  planSummary: string;
  steps: IssueProtocolPlanStep[];
  risks: string[];
  needsApproval?: boolean;
}

export interface IssueProtocolStartImplementationPayload {
  implementationMode: IssueProtocolImplementationMode;
  activeHypotheses?: string[];
}

export interface IssueProtocolProgressPayload {
  progressPercent: number;
  completedItems: string[];
  nextSteps: string[];
  risks: string[];
  changedFiles?: string[];
  testSummary?: string | null;
}

export interface IssueProtocolEscalateBlockerPayload {
  blockerCode: IssueProtocolBlockerCode;
  blockingReason: string;
  requestedAction: string;
  requestedFrom?: IssueProtocolRequestTargetRole;
}

export interface IssueProtocolSubmitForReviewPayload {
  implementationSummary: string;
  evidence: string[];
  reviewChecklist: string[];
  changedFiles: string[];
  testResults: string[];
  residualRisks: string[];
  diffSummary: string;
}

export interface IssueProtocolStartReviewPayload {
  reviewCycle: number;
  reviewFocus: string[];
  blockingReview?: boolean;
}

export interface IssueProtocolChangeRequestItem {
  title: string;
  reason: string;
  affectedFiles?: string[];
  suggestedAction?: string | null;
}

export interface IssueProtocolRequestChangesPayload {
  reviewSummary: string;
  changeRequests: IssueProtocolChangeRequestItem[];
  severity: IssueProtocolReviewSeverity;
  mustFixBeforeApprove: boolean;
  requiredEvidence: string[];
}

export interface IssueProtocolAckChangeRequestPayload {
  acknowledged: true;
  changeRequestIds: string[];
  plannedFixOrder?: string[];
}

export interface IssueProtocolRequestHumanDecisionPayload {
  decisionType: IssueProtocolDecisionType;
  decisionQuestion: string;
  options: string[];
  recommendedOption?: string | null;
}

export interface IssueProtocolApproveImplementationPayload {
  approvalSummary: string;
  approvalMode: IssueProtocolApprovalMode;
  approvalChecklist: string[];
  verifiedEvidence: string[];
  residualRisks: string[];
  followUpActions?: string[];
}

export interface IssueProtocolCloseTaskPayload {
  closeReason: IssueProtocolCloseReason;
  closureSummary: string;
  verificationSummary: string;
  rollbackPlan: string;
  finalArtifacts: string[];
  finalTestStatus: IssueProtocolFinalTestStatus;
  mergeStatus: IssueProtocolMergeStatus;
  followUpIssueIds?: string[];
  remainingRisks?: string[];
}

export interface IssueProtocolReassignTaskPayload {
  reason: string;
  newAssigneeAgentId: string;
  newReviewerAgentId?: string | null;
  newQaAgentId?: string | null;
  carryForwardBriefVersion?: number | null;
}

export interface IssueProtocolCancelTaskPayload {
  reason: string;
  cancelType: IssueProtocolCancelType;
  replacementIssueId?: string | null;
}

export interface IssueProtocolNotePayload {
  noteType: IssueProtocolNoteType;
  body: string;
}

export interface IssueProtocolSystemReminderPayload {
  reminderCode: string;
  reminderMessage: string;
  dueAt?: string | null;
}

export interface IssueProtocolTimeoutEscalationPayload {
  timeoutCode: IssueProtocolTimeoutCode;
  expiredActorRole: IssueProtocolParticipantRole;
  nextEscalationTarget: IssueProtocolRole;
}

export interface IssueProtocolRecordViolationPayload {
  violationCode: IssueProtocolViolationCode;
  severity: IssueProtocolViolationSeverity;
  note?: string | null;
}

export interface IssueProtocolPayloadByMessageType {
  ASSIGN_TASK: IssueProtocolAssignTaskPayload;
  ACK_ASSIGNMENT: IssueProtocolAckAssignmentPayload;
  ASK_CLARIFICATION: IssueProtocolAskClarificationPayload;
  PROPOSE_PLAN: IssueProtocolProposePlanPayload;
  START_IMPLEMENTATION: IssueProtocolStartImplementationPayload;
  REPORT_PROGRESS: IssueProtocolProgressPayload;
  ESCALATE_BLOCKER: IssueProtocolEscalateBlockerPayload;
  SUBMIT_FOR_REVIEW: IssueProtocolSubmitForReviewPayload;
  START_REVIEW: IssueProtocolStartReviewPayload;
  REQUEST_CHANGES: IssueProtocolRequestChangesPayload;
  ACK_CHANGE_REQUEST: IssueProtocolAckChangeRequestPayload;
  REQUEST_HUMAN_DECISION: IssueProtocolRequestHumanDecisionPayload;
  APPROVE_IMPLEMENTATION: IssueProtocolApproveImplementationPayload;
  CLOSE_TASK: IssueProtocolCloseTaskPayload;
  REASSIGN_TASK: IssueProtocolReassignTaskPayload;
  CANCEL_TASK: IssueProtocolCancelTaskPayload;
  NOTE: IssueProtocolNotePayload;
  SYSTEM_REMINDER: IssueProtocolSystemReminderPayload;
  TIMEOUT_ESCALATION: IssueProtocolTimeoutEscalationPayload;
  RECORD_PROTOCOL_VIOLATION: IssueProtocolRecordViolationPayload;
}

export type IssueProtocolPayload = IssueProtocolPayloadByMessageType[IssueProtocolMessageType];

export interface IssueProtocolMessageInput<TType extends IssueProtocolMessageType = IssueProtocolMessageType> {
  messageType: TType;
  sender: IssueProtocolActor;
  recipients: IssueProtocolRecipient[];
  workflowStateBefore: IssueProtocolWorkflowState;
  workflowStateAfter: IssueProtocolWorkflowState;
  summary: string;
  payload: IssueProtocolPayloadByMessageType[TType];
  artifacts?: IssueProtocolArtifact[];
  causalMessageId?: string | null;
  retrievalRunId?: string | null;
  requiresAck?: boolean;
}

export interface IssueProtocolMessage<TType extends IssueProtocolMessageType = IssueProtocolMessageType>
  extends IssueProtocolMessageInput<TType> {
  id: string;
  companyId: string;
  issueId: string;
  threadId: string;
  seq: number;
  payloadSha256?: string | null;
  previousIntegritySignature?: string | null;
  integrityAlgorithm?: string | null;
  integritySignature?: string | null;
  integrityStatus?: "verified" | "legacy_unsealed" | "tampered" | "unsupported_algorithm";
  ackedAt: Date | null;
  createdAt: Date;
}

export interface IssueProtocolThread {
  id: string;
  companyId: string;
  issueId: string;
  threadType: string;
  title: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IssueProtocolState {
  issueId: string;
  companyId: string;
  workflowState: IssueProtocolWorkflowState;
  coarseIssueStatus: IssueStatus;
  techLeadAgentId: string | null;
  primaryEngineerAgentId: string | null;
  reviewerAgentId: string | null;
  qaAgentId: string | null;
  currentReviewCycle: number;
  lastProtocolMessageId: string | null;
  lastTransitionAt: Date;
  blockedPhase: IssueProtocolBlockedPhase | null;
  blockedCode: string | null;
  blockedByMessageId: string | null;
  metadata: Record<string, unknown>;
}

export interface IssueProtocolRecipientRecord {
  id: string;
  companyId: string;
  messageId: string;
  recipientType: IssueProtocolRecipientType;
  recipientId: string;
  recipientRole: IssueProtocolParticipantRole;
}

export interface IssueProtocolArtifactRecord {
  id: string;
  companyId: string;
  messageId: string;
  artifactKind: IssueProtocolArtifactKind;
  artifactUri: string;
  label: string | null;
  metadata: Record<string, unknown>;
}

export interface IssueReviewCycle {
  id: string;
  companyId: string;
  issueId: string;
  cycleNumber: number;
  reviewerAgentId: string | null;
  reviewerUserId: string | null;
  reviewerRole?: "reviewer" | "qa" | "tech_lead" | null;
  submittedMessageId: string;
  openedAt: Date;
  closedAt: Date | null;
  outcome: IssueProtocolReviewOutcome | null;
  outcomeMessageId: string | null;
}

export interface IssueProtocolViolation {
  id: string;
  companyId: string;
  issueId: string;
  threadId: string | null;
  messageId: string | null;
  violationCode: IssueProtocolViolationCode;
  severity: IssueProtocolViolationSeverity;
  detectedByActorType: IssueProtocolActorType;
  detectedByActorId: string;
  status: IssueProtocolViolationStatus;
  details: Record<string, unknown>;
  createdAt: Date;
  resolvedAt: Date | null;
}

export interface IssueTaskBrief {
  id: string;
  companyId: string;
  issueId: string;
  briefScope: string;
  briefVersion: number;
  generatedFromMessageSeq: number;
  workflowState: IssueProtocolWorkflowState;
  contentMarkdown: string;
  contentJson: Record<string, unknown>;
  retrievalRunId: string | null;
  createdAt: Date;
}
