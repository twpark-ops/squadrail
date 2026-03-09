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
type ReviewSubmissionPayloadLike = Record<string, unknown> | null | undefined;
type ReviewSubmissionContractMode = "legacy" | "strict";

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

function readStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function determineReviewSubmissionContractMode(payload: ReviewSubmissionPayloadLike): ReviewSubmissionContractMode {
  const reviewPayload = payload ?? {};
  const hasStrictFields =
    Object.prototype.hasOwnProperty.call(reviewPayload, "testResults")
    || Object.prototype.hasOwnProperty.call(reviewPayload, "residualRisks")
    || Object.prototype.hasOwnProperty.call(reviewPayload, "diffSummary");
  return hasStrictFields ? "strict" : "legacy";
}

function validateReviewSubmissionContract(input: {
  payload: ReviewSubmissionPayloadLike;
  artifacts?: ProtocolArtifactLike[];
  mode: ReviewSubmissionContractMode;
}) {
  const payload = input.payload ?? {};
  if (!readString(payload.implementationSummary)) {
    return "SUBMIT_FOR_REVIEW requires implementationSummary";
  }

  const evidence = readStringArray(payload.evidence);
  if (evidence.length === 0) {
    return "SUBMIT_FOR_REVIEW requires evidence";
  }

  const changedFiles = readStringArray(payload.changedFiles);
  if (changedFiles.length === 0) {
    return "SUBMIT_FOR_REVIEW requires changedFiles";
  }

  const reviewChecklist = readStringArray(payload.reviewChecklist);
  if (reviewChecklist.length === 0) {
    return "SUBMIT_FOR_REVIEW requires reviewChecklist";
  }

  if (input.mode === "strict") {
    const testResults = readStringArray(payload.testResults);
    if (testResults.length === 0) {
      return "SUBMIT_FOR_REVIEW requires testResults";
    }

    const residualRisks = readStringArray(payload.residualRisks);
    if (residualRisks.length === 0) {
      return "SUBMIT_FOR_REVIEW requires residualRisks";
    }

    if (!readString(payload.diffSummary)) {
      return "SUBMIT_FOR_REVIEW requires diffSummary";
    }
  }

  if (!hasProtocolArtifactKind(input.artifacts, REVIEW_SUBMISSION_REQUIRED_ARTIFACT_KINDS)) {
    return "SUBMIT_FOR_REVIEW requires diff, commit, or test_run artifact";
  }

  return null;
}

export function evaluateProtocolEvidenceRequirement(input: {
  message: CreateIssueProtocolMessage;
  latestReviewArtifacts?: ProtocolArtifactLike[];
  latestReviewPayload?: ReviewSubmissionPayloadLike;
}): ProtocolPolicyViolationResult | null {
  const { message, latestReviewArtifacts = [], latestReviewPayload = null } = input;

  if (message.messageType === "SUBMIT_FOR_REVIEW") {
    const reviewViolation = validateReviewSubmissionContract({
      payload: message.payload as ReviewSubmissionPayloadLike,
      artifacts: message.artifacts,
      mode: "strict",
    });
    if (reviewViolation) {
      return {
        violationCode: "missing_required_artifact",
        message: `Missing required artifact: ${reviewViolation}`,
      };
    }
    return null;
  }

  if (message.messageType === "APPROVE_IMPLEMENTATION") {
    const mode = determineReviewSubmissionContractMode(latestReviewPayload);
    const reviewViolation = validateReviewSubmissionContract({
      payload: latestReviewPayload,
      artifacts: latestReviewArtifacts,
      mode,
    });
    if (reviewViolation) {
      return {
        violationCode: "missing_required_artifact",
        message: `Missing required artifact: latest SUBMIT_FOR_REVIEW evidence is incomplete (${reviewViolation})`,
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
