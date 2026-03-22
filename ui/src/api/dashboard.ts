import type {
  DashboardAgentPerformanceFeed,
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
  agentPerformance: (companyId: string, limit: number = 20) =>
    api.get<DashboardAgentPerformanceFeed>(`/companies/${companyId}/dashboard/agent-performance?limit=${limit}`),
  teamSupervision: (companyId: string, limit: number = 20, offset: number = 0) =>
    api.get<DashboardTeamSupervisionFeed>(
      `/companies/${companyId}/dashboard/team-supervision?limit=${limit}&offset=${offset}`,
    ),
  recoveryQueue: (companyId: string, limit: number = 20, offset: number = 0) =>
    api.get<DashboardRecoveryQueue>(
      `/companies/${companyId}/dashboard/recovery-queue?limit=${limit}&offset=${offset}`,
    ),
  applyRecoveryAction: (companyId: string, data: DashboardRecoveryActionRequest) =>
    api.post<DashboardRecoveryActionResult>(`/companies/${companyId}/dashboard/recovery-queue/actions`, data),
};
