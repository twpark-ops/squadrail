import type { IssueChangeSurface, IssueRuntimeSummary } from "@squadrail/shared";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

type WorkspaceUsage = IssueRuntimeSummary["workspaceUsage"];
type WorkspaceSource = IssueRuntimeSummary["workspaceSource"];
type WorkspaceState = IssueRuntimeSummary["workspaceState"];
type Severity = IssueRuntimeSummary["severity"];

const VALID_USAGES = new Set<string>(["analysis", "implementation", "review"]);
const VALID_SOURCES = new Set<string>(["project_shared", "project_isolated"]);
const VALID_STATES = new Set<string>([
  "fresh",
  "reused_clean",
  "resumed_dirty",
  "recreated_clean",
  "recovered_existing",
]);

// ---------------------------------------------------------------------------
// Severity
// ---------------------------------------------------------------------------

function deriveSeverity(state: WorkspaceState): Severity {
  if (state === "resumed_dirty") return "risk";
  if (state === "recovered_existing") return "warning";
  return "info";
}

// ---------------------------------------------------------------------------
// Headline
// ---------------------------------------------------------------------------

function deriveHeadline(
  usage: WorkspaceUsage,
  source: WorkspaceSource,
  state: WorkspaceState,
): string {
  const sourcePart = source === "project_isolated"
    ? "Isolated"
    : source === "project_shared"
      ? "Shared project"
      : "Unknown";

  const usagePart = usage ?? "workspace";

  const statePart = state
    ? state.replace(/_/g, " ")
    : null;

  // e.g. "Isolated implementation worktree · fresh"
  // e.g. "Shared project workspace · review"
  const label = source === "project_isolated"
    ? `${sourcePart} ${usagePart} worktree`
    : `${sourcePart} workspace · ${usagePart}`;

  return statePart ? `${label} · ${statePart}` : label;
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

function deriveDetail(
  usage: WorkspaceUsage,
  source: WorkspaceSource,
  state: WorkspaceState,
): string | null {
  if (state === "resumed_dirty") {
    return "This workspace has uncommitted changes from a previous run. " +
      "Verify file state before approving any output.";
  }
  if (state === "recovered_existing") {
    return "A pre-existing worktree was recovered instead of freshly created. " +
      "Check for stale state that may affect the current run.";
  }
  if (state === "recreated_clean") {
    return "The worktree was recreated from scratch after a previous cleanup.";
  }
  if (state === "reused_clean") {
    return "A previously used worktree was confirmed clean before reuse.";
  }
  if (source === "project_shared" && usage === "implementation") {
    return "Implementation is running in the shared project workspace. " +
      "Other agents may share this directory.";
  }
  if (source === "project_isolated") {
    return "Running in a dedicated isolated worktree for this issue.";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Derive a runtime summary from an IssueChangeSurface.
 *
 * Returns `null` when no meaningful workspace data is present
 * (e.g. the issue has not yet been assigned to a workspace).
 */
export function computeIssueRuntimeSummary(
  changeSurface: IssueChangeSurface | null | undefined,
): IssueRuntimeSummary | null {
  if (!changeSurface) return null;

  // The workspace binding artifact metadata stores the full workspace context
  // under `metadata.workspace`.  The change surface builder already extracts
  // `workspaceSource` and `workspaceState` from it.
  const rawSource = changeSurface.workspaceSource;
  const rawState = changeSurface.workspaceState;

  // If there is no workspace data at all, nothing to show.
  if (!rawSource && !rawState && !changeSurface.workspacePath) return null;

  // Derive workspaceUsage from the workspace binding artifact metadata.
  // The binding artifact stores the full workspace routing result inside
  // `metadata.workspace.workspaceUsage`.
  const bindingMeta = asRecord(changeSurface.workspaceBindingArtifact?.metadata);
  const boundWorkspace = asRecord(bindingMeta.workspace);
  const rawUsage = readNonEmptyString(boundWorkspace.workspaceUsage)
    ?? readNonEmptyString(bindingMeta.workspaceUsage);

  const workspaceUsage: WorkspaceUsage =
    rawUsage && VALID_USAGES.has(rawUsage)
      ? (rawUsage as WorkspaceUsage)
      // Fallback: the binding is only created for implementation usage,
      // so if a binding artifact exists we can assume implementation.
      : changeSurface.workspaceBindingArtifact
        ? "implementation"
        : null;

  const workspaceSource: WorkspaceSource =
    rawSource && VALID_SOURCES.has(rawSource)
      ? (rawSource as WorkspaceSource)
      : null;

  const workspaceState: WorkspaceState =
    rawState && VALID_STATES.has(rawState)
      ? (rawState as WorkspaceState)
      : null;

  const headline = deriveHeadline(workspaceUsage, workspaceSource, workspaceState);
  const severity = deriveSeverity(workspaceState);
  const detail = deriveDetail(workspaceUsage, workspaceSource, workspaceState);

  return {
    workspaceUsage,
    workspaceSource,
    workspaceState,
    workspacePath: changeSurface.workspacePath,
    branchName: changeSurface.branchName,
    headline,
    detail,
    severity,
  };
}
