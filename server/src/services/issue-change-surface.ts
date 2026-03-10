import type { IssueChangeSurface } from "@squadrail/shared";

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

  let mergeCandidate: IssueChangeSurface["mergeCandidate"] = null;
  const mergeStatus = readString(closePayload.mergeStatus);
  if (mergeStatus === "pending_external_merge" || input.mergeCandidateRecord) {
    const recordState = input.mergeCandidateRecord?.state;
    const normalizedState = recordState === "merged" || recordState === "rejected" || recordState === "pending"
      ? recordState
      : "pending";
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
      automationMetadata: input.mergeCandidateRecord?.automationMetadata ?? null,
      operatorNote: input.mergeCandidateRecord?.operatorNote ?? null,
      resolvedAt: input.mergeCandidateRecord?.resolvedAt
        ? normalizeDate(input.mergeCandidateRecord.resolvedAt)
        : null,
      closeMessageId: input.mergeCandidateRecord?.closeMessageId ?? mergeCandidateClose?.id ?? null,
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
