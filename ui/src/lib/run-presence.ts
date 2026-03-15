export type RunVisualPhase =
  | "protocol"
  | "implementation"
  | "review"
  | "qa"
  | "automation"
  | "timer";

export type RunVisualState = "running" | "queued" | "failed" | "complete";

export type RunPhaseInput = {
  invocationSource: string | null | undefined;
  triggerDetail?: string | null | undefined;
};

export type RunPhaseMeta = {
  phase: RunVisualPhase;
  label: string;
  threadLabel: string;
  summary: string;
  className: string;
};

function normalizeTriggerDetail(triggerDetail: string | null | undefined) {
  return (triggerDetail ?? "").trim().toLowerCase();
}

export function resolveRunVisualPhase(input: RunPhaseInput): RunVisualPhase {
  const triggerDetail = normalizeTriggerDetail(input.triggerDetail);
  const invocationSource = (input.invocationSource ?? "").trim().toLowerCase();

  if (
    triggerDetail.includes("review") ||
    triggerDetail.includes("diff") ||
    triggerDetail.includes("approval")
  ) {
    return "review";
  }

  if (
    triggerDetail.includes("qa") ||
    triggerDetail.includes("verification") ||
    triggerDetail.includes("release")
  ) {
    return "qa";
  }

  if (invocationSource === "assignment") return "protocol";
  if (invocationSource === "on_demand") return "implementation";
  if (invocationSource === "automation") return "automation";
  return "timer";
}

export function getRunPhaseMeta(input: RunPhaseInput): RunPhaseMeta {
  const phase = resolveRunVisualPhase(input);
  switch (phase) {
    case "protocol":
      return {
        phase,
        label: "Protocol gate",
        threadLabel: "Protocol thread",
        summary: "Assignment acceptance, escalation, and kickoff gate.",
        className:
          "border-violet-300/70 bg-violet-500/10 text-violet-700 dark:border-violet-500/30 dark:bg-violet-500/15 dark:text-violet-200",
      };
    case "implementation":
      return {
        phase,
        label: "Implementation",
        threadLabel: "Build thread",
        summary: "Active implementation and workspace execution loop.",
        className:
          "border-cyan-300/70 bg-cyan-500/10 text-cyan-700 dark:border-cyan-500/30 dark:bg-cyan-500/15 dark:text-cyan-200",
      };
    case "review":
      return {
        phase,
        label: "Review gate",
        threadLabel: "Review thread",
        summary: "Diff quality, design fit, and regression review.",
        className:
          "border-fuchsia-300/70 bg-fuchsia-500/10 text-fuchsia-700 dark:border-fuchsia-500/30 dark:bg-fuchsia-500/15 dark:text-fuchsia-200",
      };
    case "qa":
      return {
        phase,
        label: "QA gate",
        threadLabel: "QA thread",
        summary: "Acceptance criteria and release-readiness validation.",
        className:
          "border-emerald-300/70 bg-emerald-500/10 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-200",
      };
    case "automation":
      return {
        phase,
        label: "Automation",
        threadLabel: "Automation thread",
        summary: "System-driven run outside the interactive delivery lane.",
        className:
          "border-amber-300/70 bg-amber-500/10 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-200",
      };
    case "timer":
    default:
      return {
        phase: "timer",
        label: "Timer wake",
        threadLabel: "Timer thread",
        summary: "Scheduled heartbeat wake without issue handoff intent.",
        className:
          "border-slate-300/70 bg-slate-500/10 text-slate-700 dark:border-slate-500/30 dark:bg-slate-500/15 dark:text-slate-200",
      };
  }
}

export function resolveRunVisualState(status: string | null | undefined): RunVisualState {
  switch ((status ?? "").trim().toLowerCase()) {
    case "queued":
      return "queued";
    case "failed":
    case "timed_out":
    case "cancelled":
      return "failed";
    case "running":
      return "running";
    default:
      return "complete";
  }
}

export function summarizeRunClusterPhases(inputs: RunPhaseInput[]): RunPhaseMeta[] {
  const seen = new Set<RunVisualPhase>();
  const ordered: RunPhaseMeta[] = [];
  for (const input of inputs) {
    const meta = getRunPhaseMeta(input);
    if (seen.has(meta.phase)) continue;
    seen.add(meta.phase);
    ordered.push(meta);
  }
  return ordered;
}

export function summarizeRunClusterState(statuses: Array<string | null | undefined>): RunVisualState {
  if (statuses.some((status) => resolveRunVisualState(status) === "running")) return "running";
  if (statuses.some((status) => resolveRunVisualState(status) === "failed")) return "failed";
  if (statuses.some((status) => resolveRunVisualState(status) === "queued")) return "queued";
  return "complete";
}
