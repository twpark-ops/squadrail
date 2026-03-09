import type { CreateIssueProtocolMessage, IssueProtocolArtifact } from "@squadrail/shared";

export const REVIEW_SUBMISSION_REQUIRED_ARTIFACT_KINDS = ["diff", "commit", "test_run"] as const;
export const CLOSE_TASK_VERIFICATION_ARTIFACT_KINDS = [
  "diff",
  "commit",
  "approval",
  "test_run",
  "build_run",
  "doc",
] as const;

type ProtocolArtifactLike = Pick<IssueProtocolArtifact, "kind">;

export interface ProtocolPolicyViolationResult {
  violationCode: "missing_required_artifact" | "close_without_verification";
  message: string;
}

export function hasProtocolArtifactKind(
  artifacts: ProtocolArtifactLike[] | undefined,
  kinds: readonly string[],
) {
  return (artifacts ?? []).some((artifact) => kinds.includes(artifact.kind));
}

export function evaluateProtocolEvidenceRequirement(input: {
  message: CreateIssueProtocolMessage;
  latestReviewArtifacts?: ProtocolArtifactLike[];
}): ProtocolPolicyViolationResult | null {
  const { message, latestReviewArtifacts = [] } = input;

  if (message.messageType === "SUBMIT_FOR_REVIEW") {
    if ((message.payload.changedFiles?.length ?? 0) === 0) {
      return {
        violationCode: "missing_required_artifact",
        message: "Missing required artifact: SUBMIT_FOR_REVIEW requires changedFiles",
      };
    }
    if (!hasProtocolArtifactKind(message.artifacts, REVIEW_SUBMISSION_REQUIRED_ARTIFACT_KINDS)) {
      return {
        violationCode: "missing_required_artifact",
        message: "Missing required artifact: SUBMIT_FOR_REVIEW requires diff, commit, or test_run",
      };
    }
    return null;
  }

  if (message.messageType === "APPROVE_IMPLEMENTATION") {
    if (!hasProtocolArtifactKind(latestReviewArtifacts, REVIEW_SUBMISSION_REQUIRED_ARTIFACT_KINDS)) {
      return {
        violationCode: "missing_required_artifact",
        message: "Missing required artifact: latest SUBMIT_FOR_REVIEW evidence is incomplete",
      };
    }
    return null;
  }

  if (message.messageType === "CLOSE_TASK") {
    if (
      message.payload.finalTestStatus === "passed_with_known_risk"
      && (message.payload.remainingRisks?.length ?? 0) === 0
    ) {
      return {
        violationCode: "close_without_verification",
        message: "Close task requires residual risks when final test status is passed_with_known_risk",
      };
    }
    if (message.payload.closeReason === "moved_to_followup" && (message.payload.followUpIssueIds?.length ?? 0) === 0) {
      return {
        violationCode: "close_without_verification",
        message: "Close task requires follow-up issues when close reason is moved_to_followup",
      };
    }
    if (
      message.payload.mergeStatus === "merged"
      && !hasProtocolArtifactKind(message.artifacts, CLOSE_TASK_VERIFICATION_ARTIFACT_KINDS)
    ) {
      return {
        violationCode: "close_without_verification",
        message: "Close task requires verification artifacts when merge status is merged",
      };
    }
    return null;
  }

  return null;
}
