export type OperatingAlertSeverity = "medium" | "high" | "critical";
export type OperatingAlertDestinationType = "generic_webhook" | "slack_webhook";
export type OperatingAlertDeliveryStatus = "delivered" | "failed";
export type OperatingAlertIntent = "operator_required" | "informative";
export type OperatingAlertReason =
  | "runtime_failure"
  | "review_changes_requested"
  | "ready_to_close"
  | "dependency_blocked"
  | "protocol_violation"
  | "test";

export interface OperatingAlertDestinationConfig {
  id: string;
  label: string;
  type: OperatingAlertDestinationType;
  url: string;
  enabled: boolean;
  authHeaderName: string | null;
  authHeaderValue: string | null;
}

export interface OperatingAlertsConfig {
  enabled: boolean;
  minSeverity: OperatingAlertSeverity;
  cooldownMinutes: number;
  destinations: OperatingAlertDestinationConfig[];
}

export interface OperatingAlertIssueRef {
  id: string;
  identifier: string | null;
  title: string | null;
}

export interface OperatingAlertDeliveryRecord {
  id: string;
  createdAt: Date;
  status: OperatingAlertDeliveryStatus;
  severity: OperatingAlertSeverity;
  reason: OperatingAlertReason;
  intent: OperatingAlertIntent;
  destinationLabel: string;
  destinationType: OperatingAlertDestinationType;
  summary: string;
  detail: string | null;
  dedupeKey: string;
  issue: OperatingAlertIssueRef | null;
  responseStatus: number | null;
  errorMessage: string | null;
}

export interface OperatingAlertsView {
  companyId: string;
  config: OperatingAlertsConfig;
  recentDeliveries: OperatingAlertDeliveryRecord[];
}

export interface SendOperatingAlertTestResult {
  companyId: string;
  attemptedCount: number;
  deliveredCount: number;
  failedCount: number;
  records: OperatingAlertDeliveryRecord[];
}
