import { api } from "./client";

export interface WorkspaceKnowledgeImportResult {
  projectId: string;
  workspaceId: string;
  workspaceName: string;
  cwd: string;
  scannedFiles: number;
  importedFiles: number;
  skippedFiles: number;
  documents: Array<{
    documentId: string;
    path: string;
    chunkCount: number;
  }>;
}

export interface RetrievalPolicyRecord {
  id: string;
  companyId: string;
  role: string;
  eventType: string;
  workflowState: string;
  topKDense: number;
  topKSparse: number;
  rerankK: number;
  finalK: number;
  allowedSourceTypes: string[];
  allowedAuthorityLevels: string[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export const knowledgeApi = {
  importProjectWorkspace: (
    projectId: string,
    data: {
      workspaceId?: string;
      maxFiles?: number;
    } = {},
  ) => api.post<WorkspaceKnowledgeImportResult>(`/knowledge/projects/${projectId}/import-workspace`, data),
  listRetrievalPolicies: (companyId: string) =>
    api.get<RetrievalPolicyRecord[]>(`/knowledge/retrieval-policies?companyId=${encodeURIComponent(companyId)}`),
  upsertRetrievalPolicy: (data: {
    companyId: string;
    role: string;
    eventType: string;
    workflowState: string;
    topKDense?: number;
    topKSparse?: number;
    rerankK?: number;
    finalK?: number;
    allowedSourceTypes: string[];
    allowedAuthorityLevels: string[];
    metadata?: Record<string, unknown>;
  }) => api.put<RetrievalPolicyRecord>("/knowledge/retrieval-policies", data),
};
