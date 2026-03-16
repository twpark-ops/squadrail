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

type ProtocolArtifactLike = Pick<IssueProtocolArtifact, "kind" | "metadata">;
type ReviewSubmissionPayloadLike = Record<string, unknown> | null | undefined;
type ReviewSubmissionContractMode = "legacy" | "strict";

export interface ProtocolPolicyViolationResult {
  violationCode: "missing_required_artifact" | "missing_qa_execution_evidence" | "close_without_verification";
  message: string;
}

export function hasProtocolArtifactKind(
  artifacts: ProtocolArtifactLike[] | undefined,
  kinds: readonly string[],
) {
  return (artifacts ?? []).some((artifact) => kinds.includes(artifact.kind));
}

function isTrustedAutoArtifact(artifact: ProtocolArtifactLike) {
  if (artifact.metadata?.autoCaptured !== true) return false;
  return artifact.metadata?.captureConfidence === "corroborated"
    || artifact.metadata?.captureConfidence === "structured";
}

function hasReviewSubmissionEvidenceArtifact(artifacts: ProtocolArtifactLike[] | undefined) {
  return (artifacts ?? []).some((artifact) => {
    return artifact.kind === "diff" || artifact.kind === "commit";
  });
}

function hasRepoEvidenceArtifact(artifacts: ProtocolArtifactLike[] | undefined) {
  return (artifacts ?? []).some((artifact) => artifact.kind === "diff" || artifact.kind === "commit");
}

function hasApprovalArtifact(artifacts: ProtocolArtifactLike[] | undefined) {
  return (artifacts ?? []).some((artifact) => artifact.kind === "approval");
}

function hasVerificationArtifact(artifacts: ProtocolArtifactLike[] | undefined) {
  return (artifacts ?? []).some((artifact) => {
    if (artifact.kind === "test_run" || artifact.kind === "build_run") {
      return isTrustedAutoArtifact(artifact) || artifact.metadata?.autoCaptured !== true;
    }
    if (artifact.kind === "doc") {
      return artifact.metadata?.autoCaptured !== true;
    }
    return false;
  });
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

function validateRequestChangesContract(payload: Record<string, unknown> | null | undefined) {
  const reviewPayload = payload ?? {};
  if (!readString(reviewPayload.reviewSummary)) {
    return "REQUEST_CHANGES requires reviewSummary";
  }

  const requiredEvidence = readStringArray(reviewPayload.requiredEvidence);
  if (requiredEvidence.length === 0) {
    return "REQUEST_CHANGES requires requiredEvidence";
  }

  const changeRequests = Array.isArray(reviewPayload.changeRequests) ? reviewPayload.changeRequests : [];
  if (changeRequests.length === 0) {
    return "REQUEST_CHANGES requires changeRequests";
  }

  for (const request of changeRequests) {
    if (!request || typeof request !== "object") {
      return "REQUEST_CHANGES requires structured changeRequests";
    }
    const requestRecord = request as Record<string, unknown>;
    const hasAffectedFiles = readStringArray(requestRecord.affectedFiles).length > 0;
    const hasSuggestedAction = readString(requestRecord.suggestedAction).length > 0;
    if (!hasAffectedFiles && !hasSuggestedAction) {
      return "REQUEST_CHANGES requires affectedFiles or suggestedAction for every change request";
    }
  }

  return null;
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

  if (!hasReviewSubmissionEvidenceArtifact(input.artifacts)) {
    return "SUBMIT_FOR_REVIEW requires diff or commit artifact";
  }

  return null;
}

function validateApprovalContract(payload: Record<string, unknown> | null | undefined) {
  const approvalPayload = payload ?? {};
  if (!readString(approvalPayload.approvalSummary)) {
    return "APPROVE_IMPLEMENTATION requires approvalSummary";
  }

  const approvalChecklist = readStringArray(approvalPayload.approvalChecklist);
  if (approvalChecklist.length === 0) {
    return "APPROVE_IMPLEMENTATION requires approvalChecklist";
  }

  const verifiedEvidence = readStringArray(approvalPayload.verifiedEvidence);
  if (verifiedEvidence.length === 0) {
    return "APPROVE_IMPLEMENTATION requires verifiedEvidence";
  }

  const residualRisks = readStringArray(approvalPayload.residualRisks);
  if (residualRisks.length === 0) {
    return "APPROVE_IMPLEMENTATION requires residualRisks";
  }

  return null;
}

function validateQaFailureEvidence(payload: Record<string, unknown> | null | undefined) {
  const p = payload ?? {};
  const hasExecutionLog = Boolean(readString(p.executionLog));
  const hasFailureEvidence = Boolean(readString(p.failureEvidence));
  if (!hasExecutionLog && !hasFailureEvidence) {
    return "QA REQUEST_CHANGES requires execution failure evidence: executionLog or failureEvidence";
  }
  return null;
}

function validateQaExecutionEvidence(payload: Record<string, unknown> | null | undefined) {
  const p = payload ?? {};
  const hasExecutionLog = Boolean(readString(p.executionLog));
  const hasOutputVerified = Boolean(readString(p.outputVerified));
  const hasSanityCommand = Boolean(readString(p.sanityCommand));
  if (!hasExecutionLog && !hasOutputVerified && !hasSanityCommand) {
    return "QA approval requires at least one execution evidence field: executionLog, outputVerified, or sanityCommand";
  }
  return null;
}

function validateCloseTaskContract(payload: Record<string, unknown> | null | undefined) {
  const closePayload = payload ?? {};
  if (!readString(closePayload.closureSummary)) {
    return "CLOSE_TASK requires closureSummary";
  }
  if (!readString(closePayload.verificationSummary)) {
    return "CLOSE_TASK requires verificationSummary";
  }
  if (!readString(closePayload.rollbackPlan)) {
    return "CLOSE_TASK requires rollbackPlan";
  }
  return null;
}

export function evaluateProtocolEvidenceRequirement(input: {
  message: CreateIssueProtocolMessage;
  latestReviewArtifacts?: ProtocolArtifactLike[];
  latestReviewPayload?: ReviewSubmissionPayloadLike;
  mergeGateStatus?: {
    mergeReady: boolean;
    blockingReasons: string[];
  } | null;
  failureLearningGate?: {
    closeReady: boolean;
    blockingReasons: string[];
  } | null;
  enforceMergeGate?: boolean;
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

  if (message.messageType === "REQUEST_CHANGES") {
    const reviewViolation = validateRequestChangesContract(message.payload as Record<string, unknown> | null);
    if (reviewViolation) {
      return {
        violationCode: "missing_required_artifact",
        message: `Missing required artifact: ${reviewViolation}`,
      };
    }

    // QA REQUEST_CHANGES must include execution failure evidence.
    if (message.sender.role === "qa") {
      const qaViolation = validateQaFailureEvidence(message.payload as Record<string, unknown> | null);
      if (qaViolation) {
        return {
          violationCode: "missing_qa_execution_evidence",
          message: qaViolation,
        };
      }
    }
    return null;
  }

  if (message.messageType === "APPROVE_IMPLEMENTATION") {
    const approvalViolation = validateApprovalContract(message.payload as Record<string, unknown> | null);
    if (approvalViolation) {
      return {
        violationCode: "missing_required_artifact",
        message: `Missing required artifact: ${approvalViolation}`,
      };
    }

    // QA execution evidence gate: QA must prove they ran the software.
    if (message.sender.role === "qa") {
      const qaViolation = validateQaExecutionEvidence(message.payload as Record<string, unknown> | null);
      if (qaViolation) {
        return {
          violationCode: "missing_qa_execution_evidence",
          message: qaViolation,
        };
      }
    }

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
    const closeViolation = validateCloseTaskContract(message.payload as Record<string, unknown> | null);
    if (closeViolation) {
      return {
        violationCode: "close_without_verification",
        message: closeViolation,
      };
    }
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
      && (
        !hasRepoEvidenceArtifact(message.artifacts)
        || !hasApprovalArtifact(message.artifacts)
        || !hasVerificationArtifact(message.artifacts)
      )
    ) {
      return {
        violationCode: "close_without_verification",
        message: "Close task requires repo evidence, approval, and corroborated verification artifacts when merge status is merged",
      };
    }
    if (
      input.enforceMergeGate === true
      && message.payload.mergeStatus === "merged"
      && input.mergeGateStatus
      && input.mergeGateStatus.mergeReady === false
    ) {
      return {
        violationCode: "close_without_verification",
        message: `Close task requires passing synced CI gate before merged handoff (${input.mergeGateStatus.blockingReasons.join(" ")})`,
      };
    }
    if (
      (message.payload.mergeStatus === "merged" || message.payload.closeReason === "completed")
      && input.failureLearningGate
      && input.failureLearningGate.closeReady === false
    ) {
      return {
        violationCode: "close_without_verification",
        message: `Close task requires operator review of unresolved repeated failure signals before close (${input.failureLearningGate.blockingReasons.join(" ")})`,
      };
    }
    return null;
  }

  return null;
}
