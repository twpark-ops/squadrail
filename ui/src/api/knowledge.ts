import { api } from "./client";

export interface KnowledgeDocument {
  id: string;
  companyId: string;
  sourceType: string;
  authorityLevel: string;
  repoUrl: string | null;
  repoRef: string | null;
  projectId: string | null;
  issueId: string | null;
  messageId: string | null;
  path: string | null;
  title: string | null;
  language: string | null;
  contentSha256: string;
  metadata: Record<string, unknown>;
  rawContent: string;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeChunk {
  id: string;
  companyId: string;
  documentId: string;
  chunkIndex: number;
  headingPath: string | null;
  symbolName: string | null;
  tokenCount: number;
  textContent: string;
  embedding: number[];
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface RetrievalRun {
  id: string;
  companyId: string;
  role: string;
  eventType: string;
  workflowState: string;
  query: string;
  topKDense: number;
  topKSparse: number;
  rerankK: number;
  finalK: number;
  createdAt: string;
}

export interface RetrievalHit {
  id: string;
  retrievalRunId: string;
  chunkId: string;
  denseScore: number | null;
  sparseScore: number | null;
  rerankScore: number | null;
  fusedScore: number | null;
  finalRank: number | null;
  selected: boolean;
  rationale: string | null;
}

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
  listDocuments: (params: {
    companyId: string;
    projectId?: string;
    sourceType?: string;
    limit?: number;
  }) => {
    const queryParams = new URLSearchParams({ companyId: params.companyId });
    if (params.projectId) queryParams.append("projectId", params.projectId);
    if (params.sourceType) queryParams.append("sourceType", params.sourceType);
    if (params.limit) queryParams.append("limit", params.limit.toString());
    return api.get<KnowledgeDocument[]>(`/knowledge/documents?${queryParams.toString()}`);
  },
  getDocument: (documentId: string) =>
    api.get<KnowledgeDocument>(`/knowledge/documents/${documentId}`),
  getDocumentChunks: (documentId: string) =>
    api.get<KnowledgeChunk[]>(`/knowledge/documents/${documentId}/chunks`),
  getRetrievalRunHits: (runId: string) =>
    api.get<{ retrievalRun: RetrievalRun; hits: RetrievalHit[] }>(`/knowledge/retrieval-runs/${runId}/hits`),
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
