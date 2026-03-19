import type {
  IssueProgressQaState,
  IssueProgressReviewState,
  IssueProgressSnapshot,
} from "@squadrail/shared";

export type IssueProgressSignalTone = "neutral" | "info" | "warn" | "blocked" | "success";

export interface IssueProgressSignal {
  key: string;
  label: string;
  tone: IssueProgressSignalTone;
}

const REVIEW_STATE_LABELS: Record<IssueProgressReviewState, string | null> = {
  idle: null,
  waiting_review: "Review queued",
  in_review: "In review",
  changes_requested: "Changes requested",
  approved: "Review approved",
};

const QA_STATE_LABELS: Record<IssueProgressQaState, string | null> = {
  not_required: null,
  pending: "QA pending",
  running: "QA running",
  passed: "QA passed",
  failed: "QA failed",
};

function countLabel(value: number, singular: string, plural = `${singular}s`) {
  return `${value} ${value === 1 ? singular : plural}`;
}

export function buildIssueProgressSignals(
  snapshot: IssueProgressSnapshot,
  limit = 5,
): IssueProgressSignal[] {
  const signals: IssueProgressSignal[] = [];

  if (snapshot.pendingClarificationCount > 0) {
    signals.push({
      key: "clarifications",
      label: `${countLabel(snapshot.pendingClarificationCount, "clarification")} pending`,
      tone: "warn",
    });
  }

  if (snapshot.subtaskSummary.total > 0) {
    signals.push({
      key: "subtasks",
      label: `${snapshot.subtaskSummary.done}/${snapshot.subtaskSummary.total} subtasks`,
      tone:
        snapshot.subtaskSummary.done === snapshot.subtaskSummary.total
          ? "success"
          : "neutral",
    });
  }

  if (snapshot.subtaskSummary.blocked > 0) {
    signals.push({
      key: "blocked-subtasks",
      label: `${countLabel(snapshot.subtaskSummary.blocked, "blocked subtask")}`,
      tone: "blocked",
    });
  }

  const reviewLabel = REVIEW_STATE_LABELS[snapshot.reviewState];
  if (reviewLabel) {
    signals.push({
      key: "review-state",
      label: reviewLabel,
      tone:
        snapshot.reviewState === "approved"
          ? "success"
          : snapshot.reviewState === "changes_requested"
            ? "warn"
            : "info",
    });
  }

  const qaLabel = QA_STATE_LABELS[snapshot.qaState];
  if (qaLabel) {
    signals.push({
      key: "qa-state",
      label: qaLabel,
      tone:
        snapshot.qaState === "failed"
          ? "blocked"
          : snapshot.qaState === "passed"
            ? "success"
            : "info",
    });
  }

  if (snapshot.latestArtifactKinds.length > 0) {
    signals.push({
      key: "artifacts",
      label: `${countLabel(snapshot.latestArtifactKinds.length, "artifact")} ready`,
      tone: "neutral",
    });
  }

  return signals.slice(0, limit);
}
