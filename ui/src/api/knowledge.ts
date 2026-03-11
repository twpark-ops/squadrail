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
  links?: KnowledgeChunkLink[];
}

export interface KnowledgeChunkLink {
  entityType: string;
  entityId: string;
  linkReason: string;
  weight: number;
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
  textContent: string;
  headingPath: string | null;
  symbolName: string | null;
  chunkMetadata: Record<string, unknown>;
  documentId: string;
  documentPath: string | null;
  documentTitle: string | null;
  sourceType: string;
  authorityLevel: string;
  documentMetadata: Record<string, unknown>;
}

export interface RecentRetrievalRunSummary {
  retrievalRunId: string;
  companyId: string;
  issueId: string | null;
  issueIdentifier: string | null;
  issueTitle: string | null;
  issueProjectId: string | null;
  actorRole: string;
  eventType: string;
  workflowState: string;
  queryText: string;
  createdAt: string;
  confidenceLevel: "high" | "medium" | "low" | null;
  graphHitCount: number;
  multiHopGraphHitCount: number;
  candidateCacheHit: boolean;
  finalCacheHit: boolean;
  personalizationApplied: boolean;
  averagePersonalizationBoost: number;
  topHitPath: string | null;
  topHitSourceType: string | null;
  topHitArtifactKind: string | null;
  topHits: Array<{
    chunkId: string;
    finalRank: number | null;
    fusedScore: number | null;
    rationale: string | null;
    textContent: string;
    headingPath: string | null;
    symbolName: string | null;
    documentPath: string | null;
    documentTitle: string | null;
    sourceType: string;
    authorityLevel: string;
  }>;
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

export interface KnowledgeOverview {
  totalDocuments: number;
  totalChunks: number;
  totalLinks: number;
  linkedChunks: number;
  connectedDocuments: number;
  activeProjects: number;
  projectCoverage: Array<{
    projectId: string;
    projectName: string;
    documentCount: number;
    chunkCount: number;
    linkCount: number;
    lastUpdatedAt: string | null;
  }>;
  sourceTypeDistribution: Array<{ key: string; count: number }>;
  authorityDistribution: Array<{ key: string; count: number }>;
  languageDistribution: Array<{ key: string; count: number }>;
  linkEntityDistribution: Array<{ key: string; count: number }>;
}

export interface KnowledgeQualitySummary {
  totalRuns: number;
  lowConfidenceRuns: number;
  averageEvidenceCount: number;
  averageSourceDiversity: number;
  averageGraphHitCount: number;
  averageTemporalHitCount: number;
  averagePersonalizedHitCount: number;
  averagePersonalizationBoost: number;
  cacheHitRate: number;
  candidateCacheHitRate: number;
  finalCacheHitRate: number;
  feedbackEventCount: number;
  positiveFeedbackCount: number;
  negativeFeedbackCount: number;
  feedbackCoverageRate: number;
  profileCount: number;
  graphExpandedRuns: number;
  multiHopGraphExpandedRuns: number;
  graphEntityTypeCounts: Record<string, number>;
  feedbackTypeCounts: Record<string, number>;
  dailyTrend?: Array<{
    date: string;
    totalRuns: number;
    lowConfidenceRuns: number;
    graphExpandedRuns: number;
    multiHopGraphExpandedRuns: number;
    candidateCacheHits: number;
    finalCacheHits: number;
    personalizedRuns: number;
  }>;
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
  getOverview: (companyId: string) =>
    api.get<KnowledgeOverview>(`/knowledge/overview?companyId=${encodeURIComponent(companyId)}`),
  getQuality: (companyId: string, params?: { days?: number; limit?: number }) => {
    const queryParams = new URLSearchParams({ companyId });
    if (params?.days) queryParams.append("days", params.days.toString());
    if (params?.limit) queryParams.append("limit", params.limit.toString());
    return api.get<KnowledgeQualitySummary>(`/knowledge/quality?${queryParams.toString()}`);
  },
  listRecentRetrievalRuns: (params: {
    companyId: string;
    projectId?: string;
    limit?: number;
  }) => {
    const queryParams = new URLSearchParams({ companyId: params.companyId });
    if (params.projectId) queryParams.append("projectId", params.projectId);
    if (params.limit) queryParams.append("limit", params.limit.toString());
    return api.get<RecentRetrievalRunSummary[]>(`/knowledge/retrieval-runs?${queryParams.toString()}`);
  },
  getDocument: (documentId: string) =>
    api.get<KnowledgeDocument>(`/knowledge/documents/${documentId}`),
  getDocumentChunks: (documentId: string, options?: { includeLinks?: boolean }) => {
    const query = new URLSearchParams();
    if (options?.includeLinks) query.set("includeLinks", "true");
    return api.get<KnowledgeChunk[]>(
      `/knowledge/documents/${documentId}/chunks${query.size > 0 ? `?${query.toString()}` : ""}`,
    );
  },
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
