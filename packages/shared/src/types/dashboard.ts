import type {
  IssuePriority,
  IssueProtocolBlockedPhase,
  IssueProtocolMessageType,
  IssueProtocolParticipantRole,
  IssueProtocolViolationSeverity,
  IssueProtocolWorkflowState,
  IssueStatus,
} from "../constants.js";

export interface DashboardSummary {
  companyId: string;
  agents: {
    active: number;
    running: number;
    paused: number;
    error: number;
  };
  tasks: {
    open: number;
    inProgress: number;
    blocked: number;
    done: number;
  };
  costs: {
    monthSpendCents: number;
    monthBudgetCents: number;
    monthUtilizationPercent: number;
  };
  protocol: {
    workflowCounts: Record<string, number>;
    executionQueueCount: number;
    reviewQueueCount: number;
    blockedQueueCount: number;
    awaitingHumanDecisionCount: number;
    readyToCloseCount: number;
    staleQueueCount: number;
    openViolationCount: number;
    protocolMessagesLast24h: number;
  };
  executionReliability: {
    runningRuns: number;
    queuedRuns: number;
    dispatchRedispatchesLast24h: number;
    dispatchTimeoutsLast24h: number;
    processLostLast24h: number;
    workspaceBlockedLast24h: number;
  };
  pendingApprovals: number;
  staleTasks: number;
}

export interface DashboardProtocolActorSnapshot {
  id: string;
  name: string;
  title: string | null;
  role: string;
  status: string;
}

export interface DashboardLatestMessageSnapshot {
  id: string;
  messageType: IssueProtocolMessageType;
  summary: string;
  senderRole: string;
  createdAt: Date;
}

export interface DashboardBriefSnapshot {
  id: string;
  briefScope: string;
  briefVersion: number;
  workflowState: IssueProtocolWorkflowState;
  retrievalRunId: string | null;
  createdAt: Date;
  preview: string;
}

export interface DashboardProtocolQueueItem {
  issueId: string;
  identifier: string | null;
  title: string;
  priority: IssuePriority;
  projectId: string | null;
  projectName: string | null;
  coarseIssueStatus: IssueStatus;
  workflowState: IssueProtocolWorkflowState;
  currentReviewCycle: number;
  lastTransitionAt: Date;
  stale: boolean;
  nextOwnerRole: IssueProtocolParticipantRole | null;
  blockedPhase: IssueProtocolBlockedPhase | null;
  blockedCode: string | null;
  openViolationCount: number;
  highestViolationSeverity: IssueProtocolViolationSeverity | null;
  techLead: DashboardProtocolActorSnapshot | null;
  engineer: DashboardProtocolActorSnapshot | null;
  reviewer: DashboardProtocolActorSnapshot | null;
  latestMessage: DashboardLatestMessageSnapshot | null;
  openReviewCycle: {
    cycleNumber: number;
    openedAt: Date;
  } | null;
  latestBriefs: Partial<Record<string, DashboardBriefSnapshot>>;
}

export interface DashboardProtocolBuckets {
  executionQueue: DashboardProtocolQueueItem[];
  reviewQueue: DashboardProtocolQueueItem[];
  blockedQueue: DashboardProtocolQueueItem[];
  humanDecisionQueue: DashboardProtocolQueueItem[];
  readyToCloseQueue: DashboardProtocolQueueItem[];
  staleQueue: DashboardProtocolQueueItem[];
  violationQueue: DashboardProtocolQueueItem[];
}

export interface DashboardProtocolQueue {
  companyId: string;
  generatedAt: string;
  buckets: DashboardProtocolBuckets;
}

export interface DashboardRecoveryCase {
  issueId: string;
  identifier: string | null;
  title: string;
  workflowState: IssueProtocolWorkflowState;
  recoveryType: "violation" | "timeout" | "integrity";
  severity: IssueProtocolViolationSeverity | "warning";
  code: string | null;
  summary: string;
  nextAction: string;
  createdAt: Date;
}

export interface DashboardRecoveryQueue {
  companyId: string;
  generatedAt: string;
  items: DashboardRecoveryCase[];
}

export type DashboardRecoveryActionType = "resolve_violations" | "post_recovery_note";

export interface DashboardRecoveryActionRequest {
  actionType: DashboardRecoveryActionType;
  issueIds: string[];
  recoveryTypes?: Array<DashboardRecoveryCase["recoveryType"]>;
  noteBody?: string | null;
}

export interface DashboardRecoveryActionResult {
  actionType: DashboardRecoveryActionType;
  issueIds: string[];
  affectedViolationCount: number;
  createdMessageCount: number;
}
