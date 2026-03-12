import type { Request, Response, Router } from "express";
import type { ZodTypeAny } from "zod";
import type { Db } from "@squadrail/db";
import type {
  CreateIssueProtocolMessage,
  IssueChangeSurface,
} from "@squadrail/shared";
import type { StorageService } from "../../storage/types.js";

interface IssueRouteAgentRecord {
  id: string;
  companyId: string;
  name: string;
  role: string;
  title?: string | null;
  status: string;
  reportsTo: string | null;
}

interface IssueRouteIssueRecord {
  id: string;
  companyId: string;
  projectId: string | null;
  identifier: string | null;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  parentId?: string | null;
  hiddenAt?: Date | null;
}

interface IssueRouteAttachmentRecord {
  id: string;
  companyId: string;
  issueId: string;
  contentType: string;
  byteSize: number;
  originalFilename: string | null;
  objectKey: string;
}

interface IssueRouteIssueService {
  getById(id: string): Promise<IssueRouteIssueRecord | null>;
  create(companyId: string, input: Record<string, unknown>): Promise<IssueRouteIssueRecord>;
  update(issueId: string, input: Record<string, unknown>): Promise<IssueRouteIssueRecord | null>;
  remove(issueId: string): Promise<IssueRouteIssueRecord | null>;
  listAttachments(issueId: string): Promise<IssueRouteAttachmentRecord[]>;
  createAttachment(input: {
    issueId: string;
    issueCommentId: string | null;
    provider: string;
    objectKey: string;
    contentType: string;
    byteSize: number;
    sha256: string;
    originalFilename: string | null;
    createdByAgentId: string | null;
    createdByUserId: string | null;
  }): Promise<IssueRouteAttachmentRecord>;
  getAttachmentById(attachmentId: string): Promise<(IssueRouteAttachmentRecord & { companyId: string }) | null>;
  removeAttachment(attachmentId: string): Promise<(IssueRouteAttachmentRecord & { companyId: string }) | null>;
}

interface IssueRouteApprovalService {
  listApprovalsForIssue(issueId: string): Promise<unknown>;
  link(issueId: string, approvalId: string, actor: { agentId: string | null; userId: string | null }): Promise<unknown>;
  unlink(issueId: string, approvalId: string): Promise<unknown>;
}

interface IssueRouteAgentService {
  list(companyId: string): Promise<IssueRouteAgentRecord[]>;
}

interface IssueRouteProjectService {
  getById(projectId: string): Promise<{
    id: string;
    companyId: string;
    name: string;
    primaryWorkspace?: {
      id: string;
      name: string;
      cwd: string | null;
      repoRef: string | null;
    } | null;
  } | null>;
}

interface IssueRouteProtocolService {
  getState(issueId: string): Promise<Record<string, unknown> | null>;
  listMessages(issueId: string): Promise<unknown[]>;
  listReviewCycles(issueId: string): Promise<unknown[]>;
  listViolations(input: { issueId: string; status: string | null }): Promise<unknown[]>;
}

interface IssueRouteKnowledgeService {
  getLatestTaskBrief(issueId: string, scope: string): Promise<unknown | null>;
  listTaskBriefs(input: { issueId: string; briefScope?: string | null; limit: number }): Promise<unknown[]>;
}

interface IssueRouteRetrievalPersonalizationService {
  recordManualFeedback(input: {
    companyId: string;
    issueId?: string | null;
    issueProjectId: string | null;
    retrievalRunId: string;
    feedbackType: "operator_pin" | "operator_hide";
    targetType: "chunk" | "path" | "symbol" | "source_type";
    targetIds: string[];
    actorRole?: string;
    noteBody?: string | null;
  }): Promise<{ feedbackEventCount: number }>;
  recordMergeCandidateOutcomeFeedback(input: {
    companyId: string;
    issueId: string;
    issueProjectId: string | null;
    closeMessageId: string | null;
    outcome: "merge_completed" | "merge_rejected";
    changedFiles?: string[];
    noteBody?: string | null;
    actorRole?: string;
    mergeCommitSha?: string | null;
    mergeStatus?: string | null;
  }): Promise<unknown>;
}

interface IssueRouteMergeCandidateService {
  upsertDecision(input: {
    companyId: string;
    issueId: string;
    closeMessageId: string | null;
    state: "pending" | "merged" | "rejected";
    sourceBranch: string | null;
    workspacePath: string | null;
    headSha: string | null;
    diffStat: string | null;
    targetBaseBranch: string | null;
    mergeCommitSha?: string | null;
    automationMetadata?: Record<string, unknown> | null;
    operatorActorType: string;
    operatorActorId: string;
    operatorNote: string | null;
  }): Promise<unknown>;
  patchAutomationMetadata(issueId: string, patch: Record<string, unknown>): Promise<unknown>;
}

type IssueRouteActorInfo = {
  actorType: "agent" | "user" | "system";
  actorId: string;
  agentId: string | null;
  runId: string | null;
};

type IssueRouteTaskSender = CreateIssueProtocolMessage["sender"];

type IssueRouteInternalWorkItemBody = {
  assigneeAgentId: string;
  reviewerAgentId: string;
  qaAgentId?: string | null;
  projectId?: string | null;
  title: string;
  description?: string | null;
  kind: "plan" | "implementation" | "review" | "qa";
  priority: string;
  goal?: string | null;
  acceptanceCriteria: string[];
  definitionOfDone: string[];
  deadlineAt?: string | null;
  relatedIssueIds?: string[];
  requiredKnowledgeTags?: string[];
  watchLead?: boolean;
  watchReviewer?: boolean;
};

export interface IssueRouteContext {
  router: Router;
  db: Db;
  storage: StorageService;
  services: {
    svc: IssueRouteIssueService;
    agentsSvc: IssueRouteAgentService;
    knowledge: IssueRouteKnowledgeService;
    projectsSvc: IssueRouteProjectService;
    issueApprovalsSvc: IssueRouteApprovalService;
    protocolSvc: IssueRouteProtocolService;
    retrievalPersonalization: IssueRouteRetrievalPersonalizationService;
    mergeCandidatesSvc: IssueRouteMergeCandidateService;
  };
  helpers: {
    withContentPath<T extends { id: string }>(attachment: T): T & { contentPath: string };
    scheduleIssueMemoryIngest(issueId: string, mutation: "create" | "update" | "internal_work_item"): void;
    ensureIssueLabelsByName(
      companyId: string,
      specs: ReadonlyArray<{ name: string; color: string }>,
    ): Promise<Array<{ id: string; name: string; color: string }>>;
    loadIssueChangeSurface(issue: {
      id: string;
      identifier: string | null;
      title: string;
      status?: string | null;
      companyId?: string | null;
      projectId?: string | null;
    }): Promise<IssueChangeSurface>;
    runSingleFileUpload(req: Request, res: Response): Promise<void>;
    assertCanManageIssueApprovalLinks(req: Request, res: Response, companyId: string): Promise<boolean>;
    assertCanAssignTasks(req: Request, companyId: string): Promise<void>;
    assertInternalWorkItemReviewer(companyId: string, reviewerAgentId: string): Promise<IssueRouteAgentRecord>;
    assertInternalWorkItemQa(companyId: string, qaAgentId: string): Promise<IssueRouteAgentRecord>;
    assertInternalWorkItemLeadSupervisor(companyId: string, techLeadAgentId: string): Promise<IssueRouteAgentRecord>;
    buildTaskAssignmentSender(req: Request, companyId: string): Promise<IssueRouteTaskSender>;
    createAndAssignInternalWorkItem(input: {
      rootIssue: IssueRouteIssueRecord;
      actor: IssueRouteActorInfo;
      sender: IssueRouteTaskSender;
      rootProtocolState: Record<string, unknown> | null;
      body: IssueRouteInternalWorkItemBody;
      leadAgentIdOverride?: string | null;
    }): Promise<{
      issue: IssueRouteIssueRecord;
      protocol: unknown;
      warnings: string[];
    }>;
    appendProtocolMessageAndDispatch(input: {
      issue: {
        id: string;
        companyId: string;
        projectId: string | null;
        identifier: string | null;
        title: string;
        description: string | null;
        labels?: Array<{ id: string; name: string; color: string }>;
        mentionedProjects?: Array<{ id: string; name: string }>;
      };
      message: CreateIssueProtocolMessage;
      actor: IssueRouteActorInfo;
      asyncDispatch?: boolean;
    }): Promise<{
      result: unknown;
      warnings: string[];
    }>;
    buildPmProjectionRootDescription(input: {
      requestDescription: string | null | undefined;
      projectName: string | null;
      techLeadName: string;
      reviewerName: string;
      qaName: string | null;
      root: {
        executionSummary: string;
        acceptanceCriteria: string[];
        definitionOfDone: string[];
        risks?: string[];
        openQuestions?: string[];
        documentationDebt?: string[];
      };
    }): string;
    resolvePmIntakeAgents(input: {
      agents: IssueRouteAgentRecord[];
      pmAgentId: string | null;
      reviewerAgentId: string | null;
    }): {
      pmAgent: IssueRouteAgentRecord;
      reviewerAgent: IssueRouteAgentRecord;
    };
    derivePmIntakeIssueTitle(input: {
      title: string | null;
      request: string;
    }): string;
    buildPmIntakeIssueDescription(input: {
      request: string;
      projectName: string | null;
      relatedIssueIdentifiers: string[];
    }): string;
    buildPmIntakeAssignment(input: {
      title: string;
      priority: "low" | "medium" | "high" | "critical";
      pmAgentId: string;
      reviewerAgentId: string;
      requestedDueAt: string | null;
      relatedIssueIds?: string[];
      requiredKnowledgeTags?: string[];
    }): {
      summary: string;
      payload: {
        priority: "low" | "medium" | "high" | "critical";
        assigneeAgentId: string;
        reviewerAgentId: string;
        goal: string;
        acceptanceCriteria: string[];
        definitionOfDone: string[];
        qaAgentId?: string | null;
        relatedIssueIds?: string[];
        requiredKnowledgeTags?: string[];
        deadlineAt?: string | null;
      };
    };
    buildMergeAutomationPlan(input: unknown): Promise<{
      targetBaseBranch: string | null;
      [key: string]: unknown;
    }>;
    runMergeAutomationAction(input: unknown): Promise<{
      plan: {
        targetBaseBranch: string | null;
        [key: string]: unknown;
      };
      targetBranch?: string | null;
      pushed?: boolean;
      patchPath?: string | null;
      prBundlePath?: string | null;
      mergeCommitSha?: string | null;
      automationMetadataPatch?: Record<string, unknown> | null;
    }>;
  };
  schemas: {
    mergeCandidateActionSchema: ZodTypeAny;
    mergeCandidateAutomationSchema: ZodTypeAny;
    retrievalFeedbackSchema: ZodTypeAny;
  };
  constants: {
    maxAttachmentBytes: number;
    allowedAttachmentContentTypes: Set<string>;
    pmIntakeLabelSpecs: ReadonlyArray<{ name: string; color: string }>;
  };
}
