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
