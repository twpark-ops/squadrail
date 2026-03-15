import path from "node:path";

export const EXECUTION_LANES = ["fast", "normal", "deep"] as const;
export type ExecutionLane = (typeof EXECUTION_LANES)[number];

type DispatchRole = "engineer" | "reviewer" | "tech_lead" | "pm" | "cto" | "qa" | "human_board";
type InternalWorkItemKind = "plan" | "implementation" | "review" | "qa" | null;

export interface ExecutionLaneClassificationInput {
  issueProjectId: string | null;
  mentionedProjectCount: number;
  labelNames?: string[];
  recipientRole: DispatchRole;
  messageType: string;
  workflowStateAfter?: string | null;
  blockerCode?: string | null;
  questionType?: string | null;
  exactPaths?: string[];
  acceptanceCriteriaCount?: number;
  symbolHintCount?: number;
  internalWorkItemKind?: InternalWorkItemKind;
  coordinationOnly?: boolean;
}

export interface ExecutionLanePolicyInput {
  topKDense: number;
  topKSparse: number;
  rerankK: number;
  finalK: number;
  modelRerankCandidateCount: number;
}

export interface ExecutionLanePolicy {
  lane: ExecutionLane;
  topKDense: number;
  topKSparse: number;
  rerankK: number;
  finalK: number;
  modelRerankCandidateCount: number;
  chunkGraphMaxHops: number;
  maxEvidenceItems: number;
}

function uniqueLabelNames(labelNames: string[] | undefined) {
  return Array.from(new Set((labelNames ?? []).map((value) => value.trim()).filter((value) => value.length > 0)));
}

function resolveLabelOverride(labelNames: string[] | undefined): ExecutionLane | null {
  const labels = uniqueLabelNames(labelNames);
  if (labels.includes("lane:fast")) return "fast";
  if (labels.includes("lane:deep")) return "deep";
  if (labels.includes("lane:normal")) return "normal";
  return null;
}

function normalizePaths(paths: string[] | undefined) {
  return Array.from(new Set(
    (paths ?? [])
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
      .map((value) => value.replace(/\\/g, "/"))
      .map((value) => path.posix.normalize(value)),
  ));
}

function isArchitecturalBlocker(blockerCode: string | null | undefined) {
  const normalized = (blockerCode ?? "").toLowerCase();
  if (normalized.length === 0) return false;
  return (
    normalized.includes("architecture")
    || normalized.includes("schema")
    || normalized.includes("security")
    || normalized.includes("infra")
    || normalized.includes("dependency")
  );
}

function isClarificationHeavy(questionType: string | null | undefined) {
  const normalized = (questionType ?? "").toLowerCase();
  return normalized === "requirement" || normalized === "scope" || normalized === "decision";
}

export function resolveExecutionLane(input: ExecutionLaneClassificationInput): ExecutionLane {
  const labelOverride = resolveLabelOverride(input.labelNames);
  if (labelOverride) return labelOverride;

  if (input.coordinationOnly) return "deep";

  const exactPaths = normalizePaths(input.exactPaths);
  const exactDirectoryCount = new Set(exactPaths.map((value) => path.posix.dirname(value))).size;
  const exactFileCount = exactPaths.length;
  const acceptanceCriteriaCount = input.acceptanceCriteriaCount ?? 0;
  const symbolHintCount = input.symbolHintCount ?? 0;
  const crossProject = input.mentionedProjectCount > 1;
  const blockerDriven = isArchitecturalBlocker(input.blockerCode);
  const clarificationHeavy = isClarificationHeavy(input.questionType);
  const reviewPhase = input.recipientRole === "reviewer" || input.recipientRole === "qa";
  const planningRole =
    input.recipientRole === "tech_lead"
    || input.recipientRole === "pm"
    || input.recipientRole === "cto"
    || input.recipientRole === "human_board";

  if (
    crossProject
    || blockerDriven
    || clarificationHeavy
    || input.internalWorkItemKind === "plan"
    || input.messageType === "REQUEST_HUMAN_DECISION"
    || (!input.issueProjectId && planningRole)
  ) {
    return "deep";
  }

  if (
    !reviewPhase
    && input.internalWorkItemKind !== "qa"
    && exactFileCount > 0
    && exactFileCount <= 2
    && exactDirectoryCount <= 1
    && acceptanceCriteriaCount > 0
    && acceptanceCriteriaCount <= 4
    && symbolHintCount <= 8
    && (input.workflowStateAfter === "assigned" || input.workflowStateAfter === "implementing" || input.workflowStateAfter === "changes_requested")
  ) {
    return "fast";
  }

  return "normal";
}

export function applyExecutionLanePolicy(input: ExecutionLanePolicyInput & { lane: ExecutionLane }): ExecutionLanePolicy {
  const base = {
    lane: input.lane,
    topKDense: input.topKDense,
    topKSparse: input.topKSparse,
    rerankK: input.rerankK,
    finalK: input.finalK,
    modelRerankCandidateCount: input.modelRerankCandidateCount,
    chunkGraphMaxHops: 3,
    maxEvidenceItems: 6,
  } satisfies ExecutionLanePolicy;

  if (input.lane === "fast") {
    return {
      ...base,
      topKDense: Math.min(input.topKDense, 8),
      topKSparse: Math.min(input.topKSparse, 8),
      rerankK: Math.min(input.rerankK, 10),
      finalK: Math.min(input.finalK, 4),
      modelRerankCandidateCount: Math.min(input.modelRerankCandidateCount, 4),
      chunkGraphMaxHops: 2,
      maxEvidenceItems: 4,
    };
  }

  if (input.lane === "deep") {
    return {
      ...base,
      topKDense: Math.max(input.topKDense, 24),
      topKSparse: Math.max(input.topKSparse, 24),
      rerankK: Math.max(input.rerankK, 28),
      finalK: Math.max(input.finalK, 10),
      modelRerankCandidateCount: Math.max(input.modelRerankCandidateCount, 8),
      chunkGraphMaxHops: 4,
      maxEvidenceItems: 8,
    };
  }

  return base;
}

// Product-level lane: determines whether an issue goes through fast or full workflow.
// Fast lane = no QA gate, lighter review, no subtask decomposition.
// Full lane = QA gate active, full review evidence, decomposition possible.
export type ProductLane = "fast" | "full";

export interface ProductLaneSignals {
  qaAgentId: string | null;
  hasSubtasks: boolean;
  crossProject: boolean;
  coordinationOnly: boolean;
  priority: string;
}

export function deriveProductLane(signals: ProductLaneSignals): ProductLane {
  if (signals.qaAgentId) return "full";
  if (signals.hasSubtasks) return "full";
  if (signals.crossProject) return "full";
  if (signals.coordinationOnly) return "full";
  if (signals.priority === "critical") return "full";
  return "fast";
}
