import { z } from "zod";
import {
  ISSUE_PRIORITIES,
  ISSUE_PROTOCOL_ACTOR_TYPES,
  ISSUE_PROTOCOL_APPROVAL_MODES,
  ISSUE_PROTOCOL_ARTIFACT_KINDS,
  ISSUE_PROTOCOL_BLOCKED_PHASES,
  ISSUE_PROTOCOL_BLOCKER_CODES,
  ISSUE_PROTOCOL_CANCEL_TYPES,
  ISSUE_PROTOCOL_CLARIFICATION_TYPES,
  ISSUE_PROTOCOL_CLOSE_REASONS,
  ISSUE_PROTOCOL_DECISION_TYPES,
  ISSUE_PROTOCOL_FINAL_TEST_STATUSES,
  ISSUE_PROTOCOL_IMPLEMENTATION_MODES,
  ISSUE_PROTOCOL_MESSAGE_TYPES,
  ISSUE_PROTOCOL_MERGE_STATUSES,
  ISSUE_PROTOCOL_NOTE_TYPES,
  ISSUE_PROTOCOL_PARTICIPANT_ROLES,
  ISSUE_PROTOCOL_RECIPIENT_TYPES,
  ISSUE_PROTOCOL_REQUEST_TARGET_ROLES,
  ISSUE_PROTOCOL_REVIEW_OUTCOMES,
  ISSUE_PROTOCOL_REVIEW_SEVERITIES,
  ISSUE_PROTOCOL_ROLES,
  ISSUE_PROTOCOL_TIMEOUT_CODES,
  ISSUE_PROTOCOL_VIOLATION_CODES,
  ISSUE_PROTOCOL_VIOLATION_SEVERITIES,
  ISSUE_PROTOCOL_VIOLATION_STATUSES,
  ISSUE_PROTOCOL_WORKFLOW_STATES,
} from "../constants.js";

const uuidSchema = z.string().uuid();
const optionalUuidSchema = uuidSchema.nullable().optional();
const stringArraySchema = z.array(z.string());
const nonEmptyStringArraySchema = z.array(z.string().trim().min(1));

export const issueProtocolWorkflowStateSchema = z.enum(ISSUE_PROTOCOL_WORKFLOW_STATES);
export const issueProtocolBlockedPhaseSchema = z.enum(ISSUE_PROTOCOL_BLOCKED_PHASES);
export const issueProtocolActorTypeSchema = z.enum(ISSUE_PROTOCOL_ACTOR_TYPES);
export const issueProtocolRoleSchema = z.enum(ISSUE_PROTOCOL_ROLES);
export const issueProtocolParticipantRoleSchema = z.enum(ISSUE_PROTOCOL_PARTICIPANT_ROLES);
export const issueProtocolRecipientTypeSchema = z.enum(ISSUE_PROTOCOL_RECIPIENT_TYPES);
export const issueProtocolMessageTypeSchema = z.enum(ISSUE_PROTOCOL_MESSAGE_TYPES);
export const issueProtocolArtifactKindSchema = z.enum(ISSUE_PROTOCOL_ARTIFACT_KINDS);
export const issueProtocolViolationCodeSchema = z.enum(ISSUE_PROTOCOL_VIOLATION_CODES);
export const issueProtocolViolationSeveritySchema = z.enum(ISSUE_PROTOCOL_VIOLATION_SEVERITIES);
export const issueProtocolViolationStatusSchema = z.enum(ISSUE_PROTOCOL_VIOLATION_STATUSES);
export const issueProtocolReviewOutcomeSchema = z.enum(ISSUE_PROTOCOL_REVIEW_OUTCOMES);

export const issueProtocolSenderSchema = z.object({
  actorType: issueProtocolActorTypeSchema,
  actorId: z.string().min(1),
  role: issueProtocolRoleSchema,
}).strict();

export const issueProtocolRecipientSchema = z.object({
  recipientType: issueProtocolRecipientTypeSchema,
  recipientId: z.string().min(1),
  role: issueProtocolParticipantRoleSchema,
}).strict();

export const issueProtocolArtifactSchema = z.object({
  kind: issueProtocolArtifactKindSchema,
  uri: z.string().min(1),
  label: z.string().min(1).optional(),
  metadata: z.record(z.unknown()).optional(),
}).strict();

export const issueProtocolAssignTaskPayloadSchema = z.object({
  goal: z.string().min(1),
  acceptanceCriteria: stringArraySchema.min(1),
  definitionOfDone: stringArraySchema.min(1),
  priority: z.enum(ISSUE_PRIORITIES),
  assigneeAgentId: uuidSchema,
  reviewerAgentId: uuidSchema,
  deadlineAt: z.string().datetime().nullable().optional(),
  relatedIssueIds: z.array(uuidSchema).optional(),
  requiredKnowledgeTags: stringArraySchema.optional(),
}).strict();

export const issueProtocolAckAssignmentPayloadSchema = z.object({
  accepted: z.literal(true),
  understoodScope: z.string().min(1),
  initialRisks: stringArraySchema.optional(),
}).strict();

export const issueProtocolAskClarificationPayloadSchema = z.object({
  questionType: z.enum(ISSUE_PROTOCOL_CLARIFICATION_TYPES),
  question: z.string().min(1),
  blocking: z.boolean(),
  requestedFrom: z.enum(ISSUE_PROTOCOL_REQUEST_TARGET_ROLES),
  relatedArtifacts: stringArraySchema.optional(),
  proposedAssumptions: stringArraySchema.optional(),
}).strict();

export const issueProtocolPlanStepSchema = z.object({
  title: z.string().min(1),
  expectedOutcome: z.string().min(1),
  dependsOn: stringArraySchema.optional(),
}).strict();

export const issueProtocolProposePlanPayloadSchema = z.object({
  planSummary: z.string().min(1),
  steps: z.array(issueProtocolPlanStepSchema).min(1),
  risks: stringArraySchema,
  needsApproval: z.boolean().optional().default(false),
}).strict();

export const issueProtocolStartImplementationPayloadSchema = z.object({
  implementationMode: z.enum(ISSUE_PROTOCOL_IMPLEMENTATION_MODES),
  activeHypotheses: stringArraySchema.optional(),
}).strict();

export const issueProtocolProgressPayloadSchema = z.object({
  progressPercent: z.number().int().min(0).max(100),
  completedItems: stringArraySchema,
  nextSteps: stringArraySchema,
  risks: stringArraySchema,
  changedFiles: stringArraySchema.optional(),
  testSummary: z.string().nullable().optional(),
}).strict();

export const issueProtocolEscalateBlockerPayloadSchema = z.object({
  blockerCode: z.enum(ISSUE_PROTOCOL_BLOCKER_CODES),
  blockingReason: z.string().min(1),
  requestedAction: z.string().min(1),
  requestedFrom: z.enum(ISSUE_PROTOCOL_REQUEST_TARGET_ROLES).optional(),
}).strict();

export const issueProtocolSubmitForReviewPayloadSchema = z.object({
  implementationSummary: z.string().trim().min(1),
  evidence: nonEmptyStringArraySchema.min(1),
  reviewChecklist: nonEmptyStringArraySchema.min(1),
  changedFiles: nonEmptyStringArraySchema.min(1),
  testResults: nonEmptyStringArraySchema.min(1),
  residualRisks: nonEmptyStringArraySchema.min(1),
  diffSummary: z.string().trim().min(1),
}).strict();

export const issueProtocolStartReviewPayloadSchema = z.object({
  reviewCycle: z.number().int().min(1),
  reviewFocus: stringArraySchema.min(1),
  blockingReview: z.boolean().optional().default(false),
}).strict();

export const issueProtocolChangeRequestItemSchema = z.object({
  title: z.string().min(1),
  reason: z.string().min(1),
  affectedFiles: stringArraySchema.optional(),
  suggestedAction: z.string().nullable().optional(),
}).strict();

export const issueProtocolRequestChangesPayloadSchema = z.object({
  changeRequests: z.array(issueProtocolChangeRequestItemSchema).min(1),
  severity: z.enum(ISSUE_PROTOCOL_REVIEW_SEVERITIES),
  mustFixBeforeApprove: z.boolean(),
}).strict();

export const issueProtocolAckChangeRequestPayloadSchema = z.object({
  acknowledged: z.literal(true),
  changeRequestIds: stringArraySchema,
  plannedFixOrder: stringArraySchema.optional(),
}).strict();

export const issueProtocolRequestHumanDecisionPayloadSchema = z.object({
  decisionType: z.enum(ISSUE_PROTOCOL_DECISION_TYPES),
  decisionQuestion: z.string().min(1),
  options: stringArraySchema.min(2),
  recommendedOption: z.string().nullable().optional(),
}).strict();

export const issueProtocolApproveImplementationPayloadSchema = z.object({
  approvalSummary: z.string().min(1),
  approvalMode: z.enum(ISSUE_PROTOCOL_APPROVAL_MODES),
  followUpActions: stringArraySchema.optional(),
}).strict();

export const issueProtocolCloseTaskPayloadSchema = z.object({
  closeReason: z.enum(ISSUE_PROTOCOL_CLOSE_REASONS),
  finalArtifacts: stringArraySchema.min(1),
  finalTestStatus: z.enum(ISSUE_PROTOCOL_FINAL_TEST_STATUSES),
  mergeStatus: z.enum(ISSUE_PROTOCOL_MERGE_STATUSES),
  followUpIssueIds: z.array(uuidSchema).optional(),
  remainingRisks: stringArraySchema.optional(),
}).strict();

export const issueProtocolReassignTaskPayloadSchema = z.object({
  reason: z.string().min(1),
  newAssigneeAgentId: uuidSchema,
  newReviewerAgentId: optionalUuidSchema,
  carryForwardBriefVersion: z.number().int().nonnegative().nullable().optional(),
}).strict();

export const issueProtocolCancelTaskPayloadSchema = z.object({
  reason: z.string().min(1),
  cancelType: z.enum(ISSUE_PROTOCOL_CANCEL_TYPES),
  replacementIssueId: optionalUuidSchema,
}).strict();

export const issueProtocolNotePayloadSchema = z.object({
  noteType: z.enum(ISSUE_PROTOCOL_NOTE_TYPES),
  body: z.string().min(1),
}).strict();

export const issueProtocolSystemReminderPayloadSchema = z.object({
  reminderCode: z.string().min(1),
  reminderMessage: z.string().min(1),
  dueAt: z.string().datetime().nullable().optional(),
}).strict();

export const issueProtocolTimeoutEscalationPayloadSchema = z.object({
  timeoutCode: z.enum(ISSUE_PROTOCOL_TIMEOUT_CODES),
  expiredActorRole: z.enum(ISSUE_PROTOCOL_PARTICIPANT_ROLES),
  nextEscalationTarget: z.enum(ISSUE_PROTOCOL_ROLES),
}).strict();

export const issueProtocolRecordViolationPayloadSchema = z.object({
  violationCode: z.enum(ISSUE_PROTOCOL_VIOLATION_CODES),
  severity: z.enum(ISSUE_PROTOCOL_VIOLATION_SEVERITIES),
  note: z.string().nullable().optional(),
}).strict();

const issueProtocolMessageBaseSchema = z.object({
  sender: issueProtocolSenderSchema,
  recipients: z.array(issueProtocolRecipientSchema).min(1),
  workflowStateBefore: issueProtocolWorkflowStateSchema,
  workflowStateAfter: issueProtocolWorkflowStateSchema,
  summary: z.string().min(1).max(500),
  artifacts: z.array(issueProtocolArtifactSchema).optional().default([]),
  causalMessageId: optionalUuidSchema,
  retrievalRunId: optionalUuidSchema,
  requiresAck: z.boolean().optional().default(false),
}).strict();

function createTypedProtocolMessageSchema<
  TMessageType extends z.infer<typeof issueProtocolMessageTypeSchema>,
  TPayload extends z.ZodTypeAny,
>(
  messageType: TMessageType,
  payloadSchema: TPayload,
) {
  return issueProtocolMessageBaseSchema.extend({
    messageType: z.literal(messageType),
    payload: payloadSchema,
  });
}

const createIssueProtocolMessageSchemaUnion = z.discriminatedUnion("messageType", [
  createTypedProtocolMessageSchema("ASSIGN_TASK", issueProtocolAssignTaskPayloadSchema),
  createTypedProtocolMessageSchema("ACK_ASSIGNMENT", issueProtocolAckAssignmentPayloadSchema),
  createTypedProtocolMessageSchema("ASK_CLARIFICATION", issueProtocolAskClarificationPayloadSchema),
  createTypedProtocolMessageSchema("PROPOSE_PLAN", issueProtocolProposePlanPayloadSchema),
  createTypedProtocolMessageSchema("START_IMPLEMENTATION", issueProtocolStartImplementationPayloadSchema),
  createTypedProtocolMessageSchema("REPORT_PROGRESS", issueProtocolProgressPayloadSchema),
  createTypedProtocolMessageSchema("ESCALATE_BLOCKER", issueProtocolEscalateBlockerPayloadSchema),
  createTypedProtocolMessageSchema("SUBMIT_FOR_REVIEW", issueProtocolSubmitForReviewPayloadSchema),
  createTypedProtocolMessageSchema("START_REVIEW", issueProtocolStartReviewPayloadSchema),
  createTypedProtocolMessageSchema("REQUEST_CHANGES", issueProtocolRequestChangesPayloadSchema),
  createTypedProtocolMessageSchema("ACK_CHANGE_REQUEST", issueProtocolAckChangeRequestPayloadSchema),
  createTypedProtocolMessageSchema("REQUEST_HUMAN_DECISION", issueProtocolRequestHumanDecisionPayloadSchema),
  createTypedProtocolMessageSchema("APPROVE_IMPLEMENTATION", issueProtocolApproveImplementationPayloadSchema),
  createTypedProtocolMessageSchema("CLOSE_TASK", issueProtocolCloseTaskPayloadSchema),
  createTypedProtocolMessageSchema("REASSIGN_TASK", issueProtocolReassignTaskPayloadSchema),
  createTypedProtocolMessageSchema("CANCEL_TASK", issueProtocolCancelTaskPayloadSchema),
  createTypedProtocolMessageSchema("NOTE", issueProtocolNotePayloadSchema),
  createTypedProtocolMessageSchema("SYSTEM_REMINDER", issueProtocolSystemReminderPayloadSchema),
  createTypedProtocolMessageSchema("TIMEOUT_ESCALATION", issueProtocolTimeoutEscalationPayloadSchema),
  createTypedProtocolMessageSchema("RECORD_PROTOCOL_VIOLATION", issueProtocolRecordViolationPayloadSchema),
]);

export const createIssueProtocolMessageSchema = createIssueProtocolMessageSchemaUnion.superRefine((message, ctx) => {
  if (message.messageType === "ASSIGN_TASK") {
    if (message.payload.assigneeAgentId === message.payload.reviewerAgentId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Reviewer must be different from assignee",
        path: ["payload", "reviewerAgentId"],
      });
    }
  }

  if (message.messageType === "REASSIGN_TASK" && message.payload.newReviewerAgentId) {
    if (message.payload.newAssigneeAgentId === message.payload.newReviewerAgentId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Reviewer must be different from assignee",
        path: ["payload", "newReviewerAgentId"],
      });
    }
  }
});

export type CreateIssueProtocolMessage = z.infer<typeof createIssueProtocolMessageSchema>;

export const createIssueProtocolViolationSchema = z.object({
  threadId: optionalUuidSchema,
  messageId: optionalUuidSchema,
  violationCode: issueProtocolViolationCodeSchema,
  severity: issueProtocolViolationSeveritySchema,
  detectedByActorType: issueProtocolActorTypeSchema,
  detectedByActorId: z.string().min(1),
  status: issueProtocolViolationStatusSchema.optional().default("open"),
  details: z.record(z.unknown()).optional().default({}),
}).strict();

export type CreateIssueProtocolViolation = z.infer<typeof createIssueProtocolViolationSchema>;

export const updateIssueProtocolStateSchema = z.object({
  workflowState: issueProtocolWorkflowStateSchema.optional(),
  coarseIssueStatus: z.string().min(1).optional(),
  techLeadAgentId: optionalUuidSchema,
  primaryEngineerAgentId: optionalUuidSchema,
  reviewerAgentId: optionalUuidSchema,
  currentReviewCycle: z.number().int().nonnegative().optional(),
  lastProtocolMessageId: optionalUuidSchema,
  blockedPhase: issueProtocolBlockedPhaseSchema.nullable().optional(),
  blockedCode: z.string().nullable().optional(),
  blockedByMessageId: optionalUuidSchema,
  metadata: z.record(z.unknown()).optional(),
}).strict();

export type UpdateIssueProtocolState = z.infer<typeof updateIssueProtocolStateSchema>;
