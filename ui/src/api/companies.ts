import type {
  Company,
  CompanyPortabilityExportResult,
  CompanyPortabilityInclude,
  CompanyPortabilityImportRequest,
  CompanyPortabilityImportResult,
  CompanyPortabilityPreviewRequest,
  CompanyPortabilityPreviewResult,
  CreateRolePackDraft,
  DoctorReport,
  RolePackPresetDescriptor,
  RolePackRevisionWithFiles,
  RolePackSimulationRequest,
  RolePackSimulationResult,
  RolePackPresetKey,
  RolePackRevisionStatus,
  RolePackWithLatestRevision,
  SeedRolePackResult,
  SetupProgressView,
  UpdateSetupProgress,
} from "@squadrail/shared";
import { api } from "./client";

export type CompanyStats = Record<string, { agentCount: number; issueCount: number }>;

export const companiesApi = {
  list: () => api.get<Company[]>("/companies"),
  get: (companyId: string) => api.get<Company>(`/companies/${companyId}`),
  stats: () => api.get<CompanyStats>("/companies/stats"),
  create: (data: { name: string; description?: string | null; budgetMonthlyCents?: number }) =>
    api.post<Company>("/companies", data),
  update: (
    companyId: string,
    data: Partial<
      Pick<
        Company,
        "name" | "description" | "status" | "budgetMonthlyCents" | "requireBoardApprovalForNewAgents" | "brandColor"
      >
    >,
  ) => api.patch<Company>(`/companies/${companyId}`, data),
  archive: (companyId: string) => api.post<Company>(`/companies/${companyId}/archive`, {}),
  remove: (companyId: string) => api.delete<{ ok: true }>(`/companies/${companyId}`),
  exportBundle: (companyId: string, data: { include?: Partial<CompanyPortabilityInclude> }) =>
    api.post<CompanyPortabilityExportResult>(`/companies/${companyId}/export`, data),
  importPreview: (data: CompanyPortabilityPreviewRequest) =>
    api.post<CompanyPortabilityPreviewResult>("/companies/import/preview", data),
  importBundle: (data: CompanyPortabilityImportRequest) =>
    api.post<CompanyPortabilityImportResult>("/companies/import", data),
  getSetupProgress: (companyId: string) =>
    api.get<SetupProgressView>(`/companies/${companyId}/setup-progress`),
  updateSetupProgress: (companyId: string, data: UpdateSetupProgress) =>
    api.patch<SetupProgressView>(`/companies/${companyId}/setup-progress`, data),
  getDoctorReport: (
    companyId: string,
    opts: {
      deep?: boolean;
      workspaceId?: string;
    } = {},
  ) => {
    const params = new URLSearchParams();
    if (opts.deep !== undefined) params.set("deep", String(opts.deep));
    if (opts.workspaceId) params.set("workspaceId", opts.workspaceId);
    const suffix = params.toString();
    return api.get<DoctorReport>(`/companies/${companyId}/doctor${suffix ? `?${suffix}` : ""}`);
  },
  listRolePackPresets: () =>
    api.get<RolePackPresetDescriptor[]>("/companies/role-pack-presets"),
  listRolePacks: (companyId: string) =>
    api.get<RolePackWithLatestRevision[]>(`/companies/${companyId}/role-packs`),
  getRolePack: (companyId: string, rolePackSetId: string) =>
    api.get<RolePackWithLatestRevision>(`/companies/${companyId}/role-packs/${rolePackSetId}`),
  listRolePackRevisions: (companyId: string, rolePackSetId: string) =>
    api.get<RolePackRevisionWithFiles[]>(`/companies/${companyId}/role-packs/${rolePackSetId}/revisions`),
  seedDefaultRolePacks: (
    companyId: string,
    data: { force?: boolean; presetKey?: RolePackPresetKey } = {},
  ) =>
    api.post<SeedRolePackResult>(`/companies/${companyId}/role-packs/seed-defaults`, data),
  createRolePackRevision: (companyId: string, rolePackSetId: string, data: CreateRolePackDraft) =>
    api.post<RolePackWithLatestRevision>(`/companies/${companyId}/role-packs/${rolePackSetId}/revisions`, data),
  restoreRolePackRevision: (
    companyId: string,
    rolePackSetId: string,
    revisionId: string,
    data: { message: string; status?: RolePackRevisionStatus },
  ) =>
    api.post<RolePackWithLatestRevision>(
      `/companies/${companyId}/role-packs/${rolePackSetId}/revisions/${revisionId}/restore`,
      data,
    ),
  simulateRolePack: (companyId: string, rolePackSetId: string, data: RolePackSimulationRequest) =>
    api.post<RolePackSimulationResult>(`/companies/${companyId}/role-packs/${rolePackSetId}/simulate`, data),
};
