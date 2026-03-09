import type {
  IssueProtocolMessageType,
  IssueProtocolWorkflowState,
  RolePackFileName,
  RolePackPresetKey,
  RolePackRevisionStatus,
  RolePackRoleKey,
  RolePackScopeType,
  RolePackSetStatus,
} from "../constants.js";

export interface RolePackSet {
  id: string;
  companyId: string;
  scopeType: RolePackScopeType;
  scopeId: string | null;
  roleKey: RolePackRoleKey;
  status: RolePackSetStatus;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface RolePackRevision {
  id: string;
  rolePackSetId: string;
  version: number;
  status: RolePackRevisionStatus;
  message: string | null;
  createdByUserId: string | null;
  createdByAgentId: string | null;
  createdAt: Date;
  publishedAt: Date | null;
}

export interface RolePackFile {
  id: string;
  revisionId: string;
  filename: RolePackFileName;
  content: string;
  checksumSha256: string;
  createdAt: Date;
}

export interface RolePackRevisionWithFiles extends RolePackRevision {
  files: RolePackFile[];
}

export interface RolePackWithLatestRevision extends RolePackSet {
  latestRevision: RolePackRevision | null;
  latestFiles: RolePackFile[];
}

export interface RolePackPresetDescriptor {
  key: RolePackPresetKey;
  label: string;
  description: string;
  recommended: boolean;
  starterTaskTitle: string;
  starterTaskDescription: string;
}

export interface SeedRolePackResult {
  presetKey: RolePackPresetKey;
  created: RolePackWithLatestRevision[];
  existing: RolePackWithLatestRevision[];
}

export interface RolePackSimulationInput {
  workflowState: IssueProtocolWorkflowState;
  messageType: IssueProtocolMessageType;
  issueTitle: string;
  issueSummary: string;
  taskBrief: string | null;
  retrievalSummary: string | null;
  acceptanceCriteria: string[];
  changedFiles: string[];
  reviewFindings: string[];
  blockerCode: string | null;
}

export interface RolePackSimulationDraftFile {
  filename: RolePackFileName;
  content: string;
}

export interface RolePackSimulationRequest {
  scenario: RolePackSimulationInput;
  draftFiles?: RolePackSimulationDraftFile[];
}

export interface RolePackSimulationSuggestion {
  messageType: IssueProtocolMessageType;
  reason: string;
  summaryTemplate: string;
}

export interface RolePackSimulationResult {
  companyId: string;
  rolePackSetId: string;
  roleKey: RolePackRoleKey;
  revisionId: string | null;
  revisionVersion: number | null;
  scenario: RolePackSimulationInput;
  compiledFiles: Array<{
    filename: RolePackFileName;
    content: string;
  }>;
  runtimePrompt: string;
  checklist: string[];
  guardrails: string[];
  suggestedMessages: RolePackSimulationSuggestion[];
}
