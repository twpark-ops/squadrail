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
  operatorNote: string | null;
  resolvedAt: Date | string | null;
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

export function buildIssueChangeSurface(input: {
  issue: IssueLike;
  messages: ProtocolMessageLike[];
  mergeCandidateRecord?: MergeCandidateRecordLike;
}): IssueChangeSurface {
  const artifacts = flattenArtifacts(input.messages);
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
  const diffMetadata = asRecord(diffArtifact?.artifact.metadata);
  const latestClose = latestMessage(input.messages, "CLOSE_TASK");
  const latestApproval = latestMessage(input.messages, "APPROVE_IMPLEMENTATION");
  const closePayload = asRecord(latestClose?.payload);
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
      operatorNote: input.mergeCandidateRecord?.operatorNote ?? null,
      resolvedAt: input.mergeCandidateRecord?.resolvedAt
        ? normalizeDate(input.mergeCandidateRecord.resolvedAt)
        : null,
      closeMessageId: input.mergeCandidateRecord?.closeMessageId ?? latestClose?.id ?? null,
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
    workspaceSource: readString(bindingMetadata.source),
    workspaceState: readString(bindingMetadata.workspaceState),
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
    mergeCandidate,
  };
}
