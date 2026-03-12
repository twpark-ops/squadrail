import type {
  DashboardProtocolQueue,
  DashboardRecoveryActionRequest,
  DashboardRecoveryActionResult,
  DashboardRecoveryQueue,
  DashboardSummary,
  DashboardTeamSupervisionFeed,
} from "@squadrail/shared";
import { api } from "./client";

export const dashboardApi = {
  summary: (companyId: string) => api.get<DashboardSummary>(`/companies/${companyId}/dashboard`),
  protocolQueue: (companyId: string, limit: number = 20) =>
    api.get<DashboardProtocolQueue>(`/companies/${companyId}/dashboard/protocol-queue?limit=${limit}`),
  teamSupervision: (companyId: string, limit: number = 20) =>
    api.get<DashboardTeamSupervisionFeed>(`/companies/${companyId}/dashboard/team-supervision?limit=${limit}`),
  recoveryQueue: (companyId: string, limit: number = 20) =>
    api.get<DashboardRecoveryQueue>(`/companies/${companyId}/dashboard/recovery-queue?limit=${limit}`),
  applyRecoveryAction: (companyId: string, data: DashboardRecoveryActionRequest) =>
    api.post<DashboardRecoveryActionResult>(`/companies/${companyId}/dashboard/recovery-queue/actions`, data),
};
