import type {
  AgentAdapterType,
  DoctorCheckCategory,
  DoctorCheckStatus,
  SetupProgressState,
} from "../constants.js";

export interface SetupProgress {
  companyId: string;
  status: SetupProgressState;
  selectedEngine: AgentAdapterType | null;
  selectedWorkspaceId: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface SetupProgressView extends SetupProgress {
  steps: {
    companyReady: boolean;
    squadReady: boolean;
    engineReady: boolean;
    workspaceConnected: boolean;
    knowledgeSeeded: boolean;
    firstIssueReady: boolean;
  };
}

/**
 * Onboarding interview profile captured in Step 0 of the wizard.
 * Used by computeOnboardingRecommendations() to auto-suggest blueprint,
 * adapter, and workspace guidance before the user proceeds.
 */
export interface OnboardingProfileV1 {
  useCase: "solo_builder" | "software_team" | "ops_control_plane" | "evaluation_lab";
  deploymentMode: "local_single_host" | "private_network" | "public_service";
  autonomyMode: "guided" | "balanced" | "aggressive";
  runtimePreference: "codex_local" | "claude_local" | "openclaw" | "decide_later";
  createdAt: string;
}

/**
 * Typed view of onboarding metadata stored inside SetupProgress.metadata.
 * The wizard persists the onboarding issue ID here so downstream surfaces
 * can identify the "first success" issue without relying on query params.
 */
export interface OnboardingMetadata {
  /** Whether the first issue has been created during onboarding. */
  firstIssueReady?: boolean;
  /** The issue ID created during the onboarding wizard quick-request step. */
  onboardingIssueId?: string;
  /** Interview profile captured at wizard Step 0. */
  profile?: OnboardingProfileV1;
}

export interface DoctorCheck {
  code: string;
  category: DoctorCheckCategory;
  status: DoctorCheckStatus;
  label: string;
  message: string;
  detail?: string | null;
  hint?: string | null;
}

export interface DoctorWorkspaceTarget {
  workspaceId: string | null;
  projectId: string | null;
  projectName: string | null;
  workspaceName: string | null;
  cwd: string | null;
}

export interface DoctorReport {
  status: DoctorCheckStatus;
  companyId: string | null;
  selectedEngine: AgentAdapterType | null;
  workspace: DoctorWorkspaceTarget | null;
  checkedAt: string;
  checks: DoctorCheck[];
  summary: {
    pass: number;
    warn: number;
    fail: number;
  };
}
