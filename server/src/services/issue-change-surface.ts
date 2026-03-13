import {
  deriveLatestHumanClarificationResolution,
  derivePendingHumanClarifications,
  type IssueChangeSurface,
  type ProtocolClarificationMessageLike,
} from "@squadrail/shared";
import {
  buildMergeCandidateGateStatus,
  buildMergeCandidatePrBridge,
} from "./merge-candidate-gates.js";
import { buildIssueRevertAssist } from "./revert-assist.js";

type IssueLike = {
  id: string;
  identifier: string | null;
  title: string;
  status: string;
};

type ProtocolMessageLike = {
  id: string;
  messageType: string;
  summary: string;
  createdAt: Date | string;
  workflowStateAfter?: string | null;
  causalMessageId?: string | null;
  ackedAt?: Date | string | null;
  sender?: {
    actorType: string;
    actorId: string;
    role: string;
  } | null;
  payload?: Record<string, unknown> | null;
  artifacts?: Array<{
    kind: string;
    uri: string;
    label?: string | null;
    metadata?: Record<string, unknown> | null;
  }>;
};

type ProtocolArtifactLike = NonNullable<ProtocolMessageLike["artifacts"]>[number];

type MergeCandidateRecordLike = {
  state: string;
  closeMessageId: string | null;
  sourceBranch: string | null;
  workspacePath: string | null;
  headSha: string | null;
  diffStat: string | null;
  targetBaseBranch: string | null;
  mergeCommitSha: string | null;
  automationMetadata?: Record<string, unknown> | null;
  operatorNote: string | null;
  resolvedAt: Date | string | null;
} | null;

type BriefLike = {
  id: string;
  briefScope: string;
  retrievalRunId: string | null;
  createdAt: Date | string;
  contentJson?: Record<string, unknown> | null;
} | null;

type RetrievalFeedbackSummaryLike = {
  positiveCount: number;
  negativeCount: number;
  pinnedPathCount: number;
  hiddenPathCount: number;
  lastFeedbackAt: Date | string | null;
  feedbackTypeCounts: Record<string, number>;
};

type FailureLearningGateLike = {
  closeReady: boolean;
  retryability: "retryable" | "operator_required" | "blocked" | "clean";
  failureFamily: "dispatch" | "runtime_process" | "workspace" | null;
  blockingReasons: string[];
  summary: string;
  suggestedActions: string[];
  repeatedFailureCount24h: number;
  lastSeenAt: Date | string | null;
} | null;

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
}

function buildMergeCandidateTemplateTrace(payload: Record<string, unknown>) {
  const id = readString(payload.boardTemplateId);
  const label = readString(payload.boardTemplateLabel);
  const scope = readString(payload.boardTemplateScope);
  if (!id || !label) return null;
  if (scope !== "default" && scope !== "company") return null;
  return {
    id,
    label,
    scope: scope as "default" | "company",
  };
}

function buildMergeConflictAssist(input: {
  automationMetadata: Record<string, unknown> | null | undefined;
  prBridge: NonNullable<IssueChangeSurface["mergeCandidate"]>["prBridge"];
  gateStatus: NonNullable<IssueChangeSurface["mergeCandidate"]>["gateStatus"];
}) {
  const automationMetadata = asRecord(input.automationMetadata);
  const blockers = [
    ...readStringArray(automationMetadata.lastPlanWarnings),
    ...(input.prBridge?.mergeability === "conflicting"
      ? ["External PR mergeability reports conflicts against the base branch."]
      : []),
  ];

  const uniqueBlockers = Array.from(new Set(blockers));
  const conflicting =
    input.prBridge?.mergeability === "conflicting"
    || uniqueBlockers.some((warning) => /conflict|diverge|merge/i.test(warning));

  if (uniqueBlockers.length === 0 && input.prBridge?.mergeability !== "blocked") {
    return {
      status: "clean" as const,
      summary: "Latest merge preflight does not report a conflict signal.",
      blockers: [],
      suggestedActions: [
        "Keep PR status synced before marking the change merged.",
      ],
    };
  }

  const suggestedActions = conflicting
    ? [
        "Sync the base branch and rerun merge preflight before pushing another review round.",
        "Resolve overlapping file edits in the source workspace, then refresh the PR bridge status.",
      ]
    : [
        "Review the latest preflight warnings before marking the change merged.",
        "Refresh PR status after external checks or repository policies clear.",
      ];

  return {
    status: conflicting ? "conflicting" as const : "warning" as const,
    summary: conflicting
      ? "Merge conflict signals are present in the latest local or external preflight."
      : "Merge preflight still has warnings that should be reviewed before close.",
    blockers: uniqueBlockers.length > 0
      ? uniqueBlockers
      : input.gateStatus?.blockingReasons ?? [],
    suggestedActions,
  };
}

function buildMergeFailureAssist(input: {
  failureLearningGate: FailureLearningGateLike;
}) {
  const gate = input.failureLearningGate;
  if (!gate || gate.closeReady) {
    return {
      status: "clean" as const,
      summary: "No unresolved runtime failure signal is currently blocking close.",
      retryability: "clean" as const,
      failureFamily: null,
      blockers: [],
      suggestedActions: [],
      repeatedFailureCount24h: 0,
      lastSeenAt: null,
    };
  }

  return {
    status: gate.retryability === "blocked" ? "blocked" as const : "watch" as const,
    summary: gate.summary,
    retryability: gate.retryability,
    failureFamily: gate.failureFamily,
    blockers: gate.blockingReasons,
    suggestedActions: gate.suggestedActions,
    repeatedFailureCount24h: gate.repeatedFailureCount24h,
    lastSeenAt: gate.lastSeenAt ? normalizeDate(gate.lastSeenAt) : null,
  };
}

function normalizeDate(value: Date | string | null | undefined) {
  if (!value) return new Date(0);
  return value instanceof Date ? value : new Date(value);
}

function flattenArtifacts(messages: ProtocolMessageLike[]) {
  const artifacts: Array<{
    messageId: string;
    messageType: string;
    createdAt: Date;
    artifact: ProtocolArtifactLike;
  }> = [];
  for (const message of messages) {
    for (const artifact of message.artifacts ?? []) {
      artifacts.push({
        messageId: message.id,
        messageType: message.messageType,
        createdAt: normalizeDate(message.createdAt),
        artifact,
      });
    }
  }
  artifacts.sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
  return artifacts;
}

function artifactSummary(entry: ReturnType<typeof flattenArtifacts>[number] | null) {
  if (!entry) return null;
  return {
    messageId: entry.messageId,
    messageType: entry.messageType,
    createdAt: entry.createdAt,
    kind: entry.artifact.kind,
    uri: entry.artifact.uri,
    label: entry.artifact.label ?? null,
    metadata: entry.artifact.metadata ?? null,
  };
}

function firstArtifactBy(input: {
  artifacts: ReturnType<typeof flattenArtifacts>;
  predicate: (artifact: ProtocolArtifactLike) => boolean;
}) {
  return input.artifacts.find((entry) => input.predicate(entry.artifact)) ?? null;
}

function latestMessage(messages: ProtocolMessageLike[], messageType: string) {
  return messages
    .filter((message) => message.messageType === messageType)
    .sort((left, right) => normalizeDate(right.createdAt).getTime() - normalizeDate(left.createdAt).getTime())[0]
    ?? null;
}

function buildClarificationTrace(messages: ProtocolMessageLike[]): IssueChangeSurface["clarificationTrace"] {
  const protocolMessages: ProtocolClarificationMessageLike[] = messages.flatMap((message) => {
    const sender = asRecord(message.sender);
    if (!sender) return [];
    const actorType = readString(sender.actorType);
    const actorId = readString(sender.actorId);
    const role = readString(sender.role);
    if (!actorType || !actorId || !role) return [];
    return [{
      id: message.id,
      messageType: message.messageType as ProtocolClarificationMessageLike["messageType"],
      causalMessageId: message.causalMessageId ?? null,
      ackedAt: message.ackedAt ?? null,
      createdAt: normalizeDate(message.createdAt),
      workflowStateAfter: readString(message.workflowStateAfter) as ProtocolClarificationMessageLike["workflowStateAfter"],
      payload: message.payload ?? null,
      sender: {
        actorType: actorType as ProtocolClarificationMessageLike["sender"]["actorType"],
        actorId,
        role: role as ProtocolClarificationMessageLike["sender"]["role"],
      },
    }];
  });

  const pending = derivePendingHumanClarifications(protocolMessages);
  const resolved = deriveLatestHumanClarificationResolution(protocolMessages);
  if (pending.length === 0 && !resolved) return null;

  const latestPending = pending[pending.length - 1] ?? null;
  return {
    pendingCount: pending.length,
    latestPendingQuestion: latestPending?.question ?? null,
    latestPendingAt: latestPending?.createdAt ?? null,
    latestPendingResumeWorkflowState: latestPending?.resumeWorkflowState ?? null,
    latestResolvedAt: resolved?.answeredAt ?? null,
    latestResolvedQuestion: resolved?.question ?? null,
    latestResolvedAnswer: resolved?.answer ?? null,
    latestResolvedResumeWorkflowState: resolved?.resumeWorkflowState ?? null,
    latestAskedByRole: resolved?.askedByRole ?? latestPending?.askedByRole ?? null,
    latestAnsweredByRole: resolved?.answeredByRole ?? null,
  };
}

function findMergeCandidateCloseMessage(input: {
  messages: ProtocolMessageLike[];
  mergeCandidateRecord?: MergeCandidateRecordLike;
}) {
  if (input.mergeCandidateRecord?.closeMessageId) {
    const anchored = input.messages.find((message) => message.id === input.mergeCandidateRecord?.closeMessageId);
    if (anchored) return anchored;
  }

  return input.messages
    .filter((message) => {
      if (message.messageType !== "CLOSE_TASK") return false;
      const payload = asRecord(message.payload);
      return readString(payload.mergeStatus) === "pending_external_merge";
    })
    .sort((left, right) => normalizeDate(right.createdAt).getTime() - normalizeDate(left.createdAt).getTime())[0]
    ?? null;
}

function readBriefQualityValue(
  brief: BriefLike,
  key: "confidenceLevel" | "graphHitCount" | "multiHopGraphHitCount" | "personalizationApplied",
) {
  const quality = asRecord(asRecord(brief?.contentJson)?.quality);
  if (key === "confidenceLevel") {
    const confidenceLevel = readString(quality.confidenceLevel);
    return confidenceLevel === "high" || confidenceLevel === "medium" || confidenceLevel === "low"
      ? confidenceLevel
      : null;
  }
  if (key === "personalizationApplied") {
    return quality.personalizationApplied === true;
  }
  const numeric = quality[key];
  return typeof numeric === "number" ? numeric : 0;
}

export function buildIssueChangeSurface(input: {
  issue: IssueLike;
  messages: ProtocolMessageLike[];
  mergeCandidateRecord?: MergeCandidateRecordLike;
  briefs?: BriefLike[];
  retrievalFeedbackSummary?: RetrievalFeedbackSummaryLike | null;
  failureLearningGate?: FailureLearningGateLike;
}): IssueChangeSurface {
  const mergeCandidateClose = findMergeCandidateCloseMessage(input);
  const candidateCutoff = mergeCandidateClose ? normalizeDate(mergeCandidateClose.createdAt) : null;
  const scopedMessages = candidateCutoff
    ? input.messages.filter((message) => normalizeDate(message.createdAt).getTime() <= candidateCutoff.getTime())
    : input.messages;
  const artifacts = flattenArtifacts(scopedMessages);
  const workspaceBinding = firstArtifactBy({
    artifacts,
    predicate: (artifact) => artifact.kind === "doc" && asRecord(artifact.metadata).bindingType === "implementation_workspace",
  });
  const diffArtifact = firstArtifactBy({
    artifacts,
    predicate: (artifact) => artifact.kind === "diff",
  });
  const runArtifact = firstArtifactBy({
    artifacts,
    predicate: (artifact) => artifact.kind === "run",
  });
  const approvalArtifact = firstArtifactBy({
    artifacts,
    predicate: (artifact) => artifact.kind === "approval",
  });
  const verificationArtifacts = artifacts
    .filter((entry) => entry.artifact.kind === "test_run" || entry.artifact.kind === "build_run")
    .slice(0, 6)
    .map((entry) => artifactSummary(entry)!);

  const bindingMetadata = asRecord(workspaceBinding?.artifact.metadata);
  const boundWorkspace = asRecord(bindingMetadata.workspace);
  const diffMetadata = asRecord(diffArtifact?.artifact.metadata);
  const latestApproval = latestMessage(scopedMessages, "APPROVE_IMPLEMENTATION");
  const closePayload = asRecord(mergeCandidateClose?.payload);
  const approvalPayload = asRecord(latestApproval?.payload);
  const sourceBranch =
    readString(diffMetadata.branchName)
    ?? readString(bindingMetadata.branchName)
    ?? input.mergeCandidateRecord?.sourceBranch
    ?? null;
  const headSha =
    readString(diffMetadata.headSha)
    ?? readString(bindingMetadata.headSha)
    ?? input.mergeCandidateRecord?.headSha
    ?? null;
  const workspacePath =
    readString(bindingMetadata.cwd)
    ?? input.mergeCandidateRecord?.workspacePath
    ?? null;
  const diffStat =
    readString(diffMetadata.diffStat)
    ?? input.mergeCandidateRecord?.diffStat
    ?? null;
  const changedFiles = readStringArray(diffMetadata.changedFiles);
  const statusEntries = readStringArray(diffMetadata.statusEntries);
  const latestRuns = (input.briefs ?? [])
    .filter((brief): brief is Exclude<BriefLike, null> => Boolean(brief?.retrievalRunId))
    .sort((left, right) => normalizeDate(right.createdAt).getTime() - normalizeDate(left.createdAt).getTime())
    .slice(0, 6)
    .map((brief) => ({
      briefScope: brief.briefScope,
      briefId: brief.id,
      retrievalRunId: brief.retrievalRunId!,
      createdAt: normalizeDate(brief.createdAt),
      confidenceLevel:
        readBriefQualityValue(brief, "confidenceLevel") as IssueChangeSurface["retrievalContext"]["latestRuns"][number]["confidenceLevel"],
      graphHitCount: Number(readBriefQualityValue(brief, "graphHitCount") ?? 0),
      multiHopGraphHitCount: Number(readBriefQualityValue(brief, "multiHopGraphHitCount") ?? 0),
      personalized: Boolean(readBriefQualityValue(brief, "personalizationApplied")),
      candidateCacheHit:
        asRecord(asRecord(brief.contentJson)?.quality).candidateCacheHit === true,
      finalCacheHit:
        asRecord(asRecord(brief.contentJson)?.quality).finalCacheHit === true,
    }));
  const feedbackSummary = input.retrievalFeedbackSummary ?? {
    positiveCount: 0,
    negativeCount: 0,
    pinnedPathCount: 0,
    hiddenPathCount: 0,
    lastFeedbackAt: null,
    feedbackTypeCounts: {},
  };
  const clarificationTrace = buildClarificationTrace(input.messages);

  let mergeCandidate: IssueChangeSurface["mergeCandidate"] = null;
  const mergeStatus = readString(closePayload.mergeStatus);
  if (mergeStatus === "pending_external_merge" || input.mergeCandidateRecord) {
    const recordState = input.mergeCandidateRecord?.state;
    const normalizedState = recordState === "merged" || recordState === "rejected" || recordState === "pending"
      ? recordState
      : "pending";
    const automationMetadata = input.mergeCandidateRecord?.automationMetadata ?? null;
    const prBridge = buildMergeCandidatePrBridge({ automationMetadata });
    const gateStatus = buildMergeCandidateGateStatus({ prBridge });
    const conflictAssist = buildMergeConflictAssist({
      automationMetadata,
      prBridge,
      gateStatus,
    });
    const failureAssist = buildMergeFailureAssist({
      failureLearningGate: input.failureLearningGate ?? null,
    });
    const templateTrace = buildMergeCandidateTemplateTrace(closePayload);
    const revertAssist = buildIssueRevertAssist({
      issueIdentifier: input.issue.identifier,
      issueTitle: input.issue.title,
      issueStatus: input.issue.status,
      mergeCommitSha: input.mergeCandidateRecord?.mergeCommitSha ?? null,
      closePayload,
      automationMetadata,
    });
    mergeCandidate = {
      issueId: input.issue.id,
      identifier: input.issue.identifier,
      state: normalizedState,
      sourceBranch,
      headSha,
      workspacePath,
      diffStat,
      changedFiles,
      targetBaseBranch: input.mergeCandidateRecord?.targetBaseBranch ?? null,
      mergeCommitSha: input.mergeCandidateRecord?.mergeCommitSha ?? null,
      closeSummary: readString(closePayload.closureSummary),
      verificationSummary: readString(closePayload.verificationSummary),
      rollbackPlan: readString(closePayload.rollbackPlan),
      approvalSummary: readString(approvalPayload.approvalSummary),
      remainingRisks: readStringArray(closePayload.remainingRisks),
      automationMetadata,
      operatorNote: input.mergeCandidateRecord?.operatorNote ?? null,
      resolvedAt: input.mergeCandidateRecord?.resolvedAt
        ? normalizeDate(input.mergeCandidateRecord.resolvedAt)
        : null,
      closeMessageId: input.mergeCandidateRecord?.closeMessageId ?? mergeCandidateClose?.id ?? null,
      prBridge,
      gateStatus,
      conflictAssist,
      failureAssist,
      templateTrace,
      revertAssist,
    };
  }

  return {
    issueId: input.issue.id,
    identifier: input.issue.identifier,
    title: input.issue.title,
    issueStatus: input.issue.status as IssueChangeSurface["issueStatus"],
    branchName: sourceBranch,
    headSha,
    workspacePath,
    workspaceSource: readString(bindingMetadata.source) ?? readString(boundWorkspace.source),
    workspaceState: readString(bindingMetadata.workspaceState) ?? readString(boundWorkspace.workspaceState),
    changedFiles,
    statusEntries,
    diffStat,
    verificationSummary: readString(closePayload.verificationSummary),
    closureSummary: readString(closePayload.closureSummary),
    clarificationTrace,
    latestRunArtifact: artifactSummary(runArtifact),
    workspaceBindingArtifact: artifactSummary(workspaceBinding),
    diffArtifact: artifactSummary(diffArtifact),
    approvalArtifact: artifactSummary(approvalArtifact),
    verificationArtifacts,
    retrievalContext: {
      latestRuns,
      feedbackSummary: {
        positiveCount: feedbackSummary.positiveCount,
        negativeCount: feedbackSummary.negativeCount,
        pinnedPathCount: feedbackSummary.pinnedPathCount,
        hiddenPathCount: feedbackSummary.hiddenPathCount,
        lastFeedbackAt: feedbackSummary.lastFeedbackAt ? normalizeDate(feedbackSummary.lastFeedbackAt) : null,
        feedbackTypeCounts: feedbackSummary.feedbackTypeCounts,
      },
    },
    mergeCandidate,
  };
}
