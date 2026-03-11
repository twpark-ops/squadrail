import type { Router } from "express";
import type { Db } from "@squadrail/db";
import type { StorageService } from "../../storage/types.js";

type AnyFn = (...args: any[]) => any;

export interface IssueRouteContext {
  router: Router;
  db: Db;
  storage: StorageService;
  services: {
    svc: any;
    access: any;
    heartbeat: any;
    agentsSvc: any;
    knowledge: any;
    projectsSvc: any;
    goalsSvc: any;
    issueApprovalsSvc: any;
    protocolExecution: any;
    issueRetrieval: any;
    protocolSvc: any;
    organizationalMemory: any;
    retrievalPersonalization: any;
    mergeCandidatesSvc: any;
  };
  helpers: {
    withContentPath: AnyFn;
    scheduleIssueMemoryIngest: AnyFn;
    scheduleProtocolMemoryIngest: AnyFn;
    ensureIssueLabelsByName: AnyFn;
    loadIssueChangeSurface: AnyFn;
    syncMergeCandidateFromProtocolMessage: AnyFn;
    runSingleFileUpload: AnyFn;
    assertCanManageIssueApprovalLinks: AnyFn;
    assertCanAssignTasks: AnyFn;
    queueIssueWakeup: AnyFn;
    assertInternalWorkItemAssignee: AnyFn;
    assertInternalWorkItemReviewer: AnyFn;
    assertInternalWorkItemQa: AnyFn;
    assertInternalWorkItemLeadSupervisor: AnyFn;
    buildTaskAssignmentSender: AnyFn;
    createAndAssignInternalWorkItem: AnyFn;
    appendProtocolMessageAndDispatch: AnyFn;
    assertCanPostProtocolMessage: AnyFn;
    recordProtocolViolation: AnyFn;
    requireAgentRunId: AnyFn;
    assertAgentRunCheckoutOwnership: AnyFn;
    buildPmProjectionRootDescription: AnyFn;
    resolvePmIntakeAgents: AnyFn;
    derivePmIntakeIssueTitle: AnyFn;
    buildPmIntakeIssueDescription: AnyFn;
    buildPmIntakeAssignment: AnyFn;
    normalizeProtocolRequestBodyAliases: AnyFn;
    buildMergeAutomationPlan: AnyFn;
    runMergeAutomationAction: AnyFn;
  };
  schemas: {
    mergeCandidateActionSchema: any;
    mergeCandidateAutomationSchema: any;
    retrievalFeedbackSchema: any;
  };
  constants: {
    maxAttachmentBytes: number;
    allowedAttachmentContentTypes: Set<string>;
    pmIntakeLabelSpecs: ReadonlyArray<{ name: string; color: string }>;
  };
}
