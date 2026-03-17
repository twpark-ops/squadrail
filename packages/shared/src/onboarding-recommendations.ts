import type { OnboardingProfileV1 } from "./types/setup.js";

/**
 * Recommendation output produced by computeOnboardingRecommendations().
 * Every field is a human-readable or machine-key value that the UI can
 * display immediately (guidance/note) or use to pre-select options (blueprintKey, adapterSuggestion).
 */
export interface OnboardingRecommendation {
  /** Team blueprint key: "small_delivery_team" | "standard_product_squad" | "delivery_plus_qa" */
  blueprintKey: string;
  /** Adapter suggestion key: "codex_local" | "claude_local" | "openclaw" */
  adapterSuggestion: string;
  /** Human-readable workspace guidance sentence. */
  workspaceGuidance: string;
  /** Human-readable note about approval / clarification behaviour. */
  autonomyNote: string;
}

/**
 * Pure function that maps an onboarding interview profile to a
 * recommendation set.  No side effects, no I/O — safe for both
 * server-side and browser use.
 */
export function computeOnboardingRecommendations(
  profile: OnboardingProfileV1,
): OnboardingRecommendation {
  // --- Blueprint selection ---
  let blueprintKey: string;
  switch (profile.useCase) {
    case "solo_builder":
      blueprintKey = "small_delivery_team";
      break;
    case "software_team":
      blueprintKey = "standard_product_squad";
      break;
    case "ops_control_plane":
      blueprintKey = "delivery_plus_qa";
      break;
    case "evaluation_lab":
      blueprintKey = "small_delivery_team";
      break;
    default:
      blueprintKey = "small_delivery_team";
  }

  // --- Adapter suggestion ---
  let adapterSuggestion: string;
  if (profile.runtimePreference === "decide_later") {
    // evaluation_lab or undecided — fall back to claude_local as a safe default
    adapterSuggestion = "claude_local";
  } else if (profile.runtimePreference === "openclaw") {
    adapterSuggestion = "openclaw";
  } else if (profile.runtimePreference === "codex_local") {
    adapterSuggestion = "codex_local";
  } else {
    adapterSuggestion = "claude_local";
  }

  // Override: solo_builder + local → codex_local (spec rule)
  if (
    profile.useCase === "solo_builder" &&
    profile.deploymentMode === "local_single_host" &&
    profile.runtimePreference !== "claude_local" &&
    profile.runtimePreference !== "openclaw"
  ) {
    adapterSuggestion = "codex_local";
  }

  // Override: software_team always defaults to claude_local unless explicitly chosen otherwise
  if (
    profile.useCase === "software_team" &&
    (profile.runtimePreference === "decide_later" || profile.runtimePreference === "claude_local")
  ) {
    adapterSuggestion = "claude_local";
  }

  // --- Workspace guidance ---
  let workspaceGuidance: string;
  switch (profile.deploymentMode) {
    case "local_single_host":
      workspaceGuidance =
        "Point the primary workspace to a local directory. Doctor checks and implementation runs will use this path directly.";
      break;
    case "private_network":
      workspaceGuidance =
        "Provide the internal network repository URL and, optionally, a local clone path for the primary workspace.";
      break;
    case "public_service":
      workspaceGuidance =
        "Connect a public repository URL with authentication. Ensure the workspace path is accessible to the selected execution engine.";
      break;
    default:
      workspaceGuidance =
        "Connect a workspace path or repository URL for the primary execution environment.";
  }

  // --- Autonomy note ---
  let autonomyNote: string;
  switch (profile.autonomyMode) {
    case "guided":
      autonomyNote =
        "All changes require human approval before merge. Agents will pause at every decision gate and wait for explicit confirmation.";
      break;
    case "balanced":
      autonomyNote =
        "Routine work auto-proceeds, high-risk needs approval. Agents will ask for confirmation only on scope changes, architecture decisions, and merge operations.";
      break;
    case "aggressive":
      autonomyNote =
        "Agents operate with minimal human gates. Only critical blockers and policy overrides will surface for human review.";
      break;
    default:
      autonomyNote =
        "Default autonomy: agents will ask for approval on significant decisions.";
  }

  return {
    blueprintKey,
    adapterSuggestion,
    workspaceGuidance,
    autonomyNote,
  };
}
