export const COMPANY_STATUSES = ["active", "paused", "archived"] as const;
export type CompanyStatus = (typeof COMPANY_STATUSES)[number];

export const DEPLOYMENT_MODES = ["local_trusted", "authenticated"] as const;
export type DeploymentMode = (typeof DEPLOYMENT_MODES)[number];

export const DEPLOYMENT_EXPOSURES = ["private", "public"] as const;
export type DeploymentExposure = (typeof DEPLOYMENT_EXPOSURES)[number];

export const AUTH_BASE_URL_MODES = ["auto", "explicit"] as const;
export type AuthBaseUrlMode = (typeof AUTH_BASE_URL_MODES)[number];

export const AGENT_STATUSES = [
  "active",
  "paused",
  "idle",
  "running",
  "error",
  "pending_approval",
  "terminated",
] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

export const AGENT_ADAPTER_TYPES = ["process", "http", "claude_local", "codex_local", "opencode_local", "cursor", "openclaw"] as const;
export type AgentAdapterType = (typeof AGENT_ADAPTER_TYPES)[number];

export const AGENT_ROLES = [
  "ceo",
  "cto",
  "cmo",
  "cfo",
  "engineer",
  "designer",
  "pm",
  "qa",
  "devops",
  "researcher",
  "general",
] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

export const AGENT_ICON_NAMES = [
  "bot",
  "cpu",
  "brain",
  "zap",
  "rocket",
  "code",
  "terminal",
  "shield",
  "eye",
  "search",
  "wrench",
  "hammer",
  "lightbulb",
  "sparkles",
  "star",
  "heart",
  "flame",
  "bug",
  "cog",
  "database",
  "globe",
  "lock",
  "mail",
  "message-square",
  "file-code",
  "git-branch",
  "package",
  "puzzle",
  "target",
  "wand",
  "atom",
  "circuit-board",
  "radar",
  "swords",
  "telescope",
  "microscope",
  "crown",
  "gem",
  "hexagon",
  "pentagon",
  "fingerprint",
] as const;
export type AgentIconName = (typeof AGENT_ICON_NAMES)[number];

export const ISSUE_STATUSES = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "blocked",
  "cancelled",
] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

export const ISSUE_PRIORITIES = ["critical", "high", "medium", "low"] as const;
export type IssuePriority = (typeof ISSUE_PRIORITIES)[number];

export const GOAL_LEVELS = ["company", "team", "agent", "task"] as const;
export type GoalLevel = (typeof GOAL_LEVELS)[number];

export const GOAL_STATUSES = ["planned", "active", "achieved", "cancelled"] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

export const PROJECT_STATUSES = [
  "backlog",
  "planned",
  "in_progress",
  "completed",
  "cancelled",
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_WORKSPACE_EXECUTION_MODES = ["shared", "isolated"] as const;
export type ProjectWorkspaceExecutionMode = (typeof PROJECT_WORKSPACE_EXECUTION_MODES)[number];

export const PROJECT_WORKSPACE_ISOLATION_STRATEGIES = ["worktree", "clone"] as const;
export type ProjectWorkspaceIsolationStrategy = (typeof PROJECT_WORKSPACE_ISOLATION_STRATEGIES)[number];

export const PROJECT_WORKSPACE_USAGE_PROFILES = ["analysis", "implementation", "review"] as const;
export type ProjectWorkspaceUsageProfile = (typeof PROJECT_WORKSPACE_USAGE_PROFILES)[number];

export const PROJECT_COLORS = [
  "#6366f1", // indigo
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#ef4444", // red
  "#f97316", // orange
  "#eab308", // yellow
  "#22c55e", // green
  "#14b8a6", // teal
  "#06b6d4", // cyan
  "#3b82f6", // blue
] as const;

export const APPROVAL_TYPES = ["hire_agent", "approve_ceo_strategy"] as const;
export type ApprovalType = (typeof APPROVAL_TYPES)[number];

export const APPROVAL_STATUSES = [
  "pending",
  "revision_requested",
  "approved",
  "rejected",
  "cancelled",
] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const SECRET_PROVIDERS = [
  "local_encrypted",
  "aws_secrets_manager",
  "gcp_secret_manager",
  "vault",
] as const;
export type SecretProvider = (typeof SECRET_PROVIDERS)[number];

export const STORAGE_PROVIDERS = ["local_disk", "s3"] as const;
export type StorageProvider = (typeof STORAGE_PROVIDERS)[number];

export const HEARTBEAT_INVOCATION_SOURCES = [
  "timer",
  "assignment",
  "on_demand",
  "automation",
] as const;
export type HeartbeatInvocationSource = (typeof HEARTBEAT_INVOCATION_SOURCES)[number];

export const WAKEUP_TRIGGER_DETAILS = ["manual", "ping", "callback", "system"] as const;
export type WakeupTriggerDetail = (typeof WAKEUP_TRIGGER_DETAILS)[number];

export const WAKEUP_REQUEST_STATUSES = [
  "queued",
  "deferred_issue_execution",
  "claimed",
  "coalesced",
  "skipped",
  "completed",
  "failed",
  "cancelled",
] as const;
export type WakeupRequestStatus = (typeof WAKEUP_REQUEST_STATUSES)[number];

export const HEARTBEAT_RUN_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "timed_out",
] as const;
export type HeartbeatRunStatus = (typeof HEARTBEAT_RUN_STATUSES)[number];

export const LIVE_EVENT_TYPES = [
  "heartbeat.run.queued",
  "heartbeat.run.status",
  "heartbeat.run.event",
  "heartbeat.run.log",
  "agent.status",
  "activity.logged",
  "issue.brief.updated",
  "retrieval.run.completed",
] as const;
export type LiveEventType = (typeof LIVE_EVENT_TYPES)[number];

export const OPERATING_ALERT_SEVERITIES = ["medium", "high", "critical"] as const;
export type OperatingAlertSeverity = (typeof OPERATING_ALERT_SEVERITIES)[number];

export const OPERATING_ALERT_DESTINATION_TYPES = ["generic_webhook", "slack_webhook"] as const;
export type OperatingAlertDestinationType = (typeof OPERATING_ALERT_DESTINATION_TYPES)[number];

export const OPERATING_ALERT_DELIVERY_STATUSES = ["delivered", "failed"] as const;
export type OperatingAlertDeliveryStatus = (typeof OPERATING_ALERT_DELIVERY_STATUSES)[number];

export const WORKFLOW_TEMPLATE_ACTION_TYPES = [
  "ASSIGN_TASK",
  "REASSIGN_TASK",
  "REQUEST_CHANGES",
  "APPROVE_IMPLEMENTATION",
  "CLOSE_TASK",
  "CANCEL_TASK",
  "NOTE",
] as const;
export type WorkflowTemplateActionType = (typeof WORKFLOW_TEMPLATE_ACTION_TYPES)[number];

export const WORKFLOW_TEMPLATE_SCOPES = ["default", "company"] as const;
export type WorkflowTemplateScope = (typeof WORKFLOW_TEMPLATE_SCOPES)[number];

export const PRINCIPAL_TYPES = ["user", "agent"] as const;
export type PrincipalType = (typeof PRINCIPAL_TYPES)[number];

export const MEMBERSHIP_STATUSES = ["pending", "active", "suspended"] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export const INSTANCE_USER_ROLES = ["instance_admin"] as const;
export type InstanceUserRole = (typeof INSTANCE_USER_ROLES)[number];

export const INVITE_TYPES = ["company_join", "bootstrap_ceo"] as const;
export type InviteType = (typeof INVITE_TYPES)[number];

export const INVITE_JOIN_TYPES = ["human", "agent", "both"] as const;
export type InviteJoinType = (typeof INVITE_JOIN_TYPES)[number];

export const JOIN_REQUEST_TYPES = ["human", "agent"] as const;
export type JoinRequestType = (typeof JOIN_REQUEST_TYPES)[number];

export const JOIN_REQUEST_STATUSES = ["pending_approval", "approved", "rejected"] as const;
export type JoinRequestStatus = (typeof JOIN_REQUEST_STATUSES)[number];

export const PERMISSION_KEYS = [
  "agents:create",
  "users:invite",
  "users:manage_permissions",
  "tasks:assign",
  "tasks:assign_scope",
  "joins:approve",
] as const;
export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export const ISSUE_PROTOCOL_WORKFLOW_STATES = [
  "backlog",
  "assigned",
  "accepted",
  "planning",
  "implementing",
  "submitted_for_review",
  "under_review",
  "qa_pending",
  "under_qa_review",
  "changes_requested",
  "awaiting_human_decision",
  "approved",
  "blocked",
  "done",
  "cancelled",
] as const;
export type IssueProtocolWorkflowState = (typeof ISSUE_PROTOCOL_WORKFLOW_STATES)[number];

export const ISSUE_PROTOCOL_BLOCKED_PHASES = [
  "assignment",
  "planning",
  "implementing",
  "review",
  "closing",
] as const;
export type IssueProtocolBlockedPhase = (typeof ISSUE_PROTOCOL_BLOCKED_PHASES)[number];

export const ISSUE_PROTOCOL_PARTICIPANT_ROLES = [
  "tech_lead",
  "engineer",
  "reviewer",
  "cto",
  "pm",
  "qa",
  "human_board",
] as const;
export type IssueProtocolParticipantRole = (typeof ISSUE_PROTOCOL_PARTICIPANT_ROLES)[number];

export const ISSUE_PROTOCOL_ROLES = [
  ...ISSUE_PROTOCOL_PARTICIPANT_ROLES,
  "system",
] as const;
export type IssueProtocolRole = (typeof ISSUE_PROTOCOL_ROLES)[number];

export const ISSUE_PROTOCOL_ACTOR_TYPES = ["agent", "user", "system"] as const;
export type IssueProtocolActorType = (typeof ISSUE_PROTOCOL_ACTOR_TYPES)[number];

export const ISSUE_PROTOCOL_RECIPIENT_TYPES = ["agent", "user", "role_group"] as const;
export type IssueProtocolRecipientType = (typeof ISSUE_PROTOCOL_RECIPIENT_TYPES)[number];

export const ISSUE_PROTOCOL_STATE_CHANGING_MESSAGE_TYPES = [
  "ASSIGN_TASK",
  "ACK_ASSIGNMENT",
  "PROPOSE_PLAN",
  "START_IMPLEMENTATION",
  "ESCALATE_BLOCKER",
  "SUBMIT_FOR_REVIEW",
  "START_REVIEW",
  "REQUEST_CHANGES",
  "ACK_CHANGE_REQUEST",
  "REQUEST_HUMAN_DECISION",
  "APPROVE_IMPLEMENTATION",
  "CLOSE_TASK",
  "REASSIGN_TASK",
  "CANCEL_TASK",
] as const;
export type IssueProtocolStateChangingMessageType = (typeof ISSUE_PROTOCOL_STATE_CHANGING_MESSAGE_TYPES)[number];

export const ISSUE_PROTOCOL_NON_STATE_MESSAGE_TYPES = [
  "ASK_CLARIFICATION",
  "REPORT_PROGRESS",
  "NOTE",
] as const;
export type IssueProtocolNonStateMessageType = (typeof ISSUE_PROTOCOL_NON_STATE_MESSAGE_TYPES)[number];

export const ISSUE_PROTOCOL_SYSTEM_MESSAGE_TYPES = [
  "SYSTEM_REMINDER",
  "TIMEOUT_ESCALATION",
  "RECORD_PROTOCOL_VIOLATION",
] as const;
export type IssueProtocolSystemMessageType = (typeof ISSUE_PROTOCOL_SYSTEM_MESSAGE_TYPES)[number];

export const ISSUE_PROTOCOL_MESSAGE_TYPES = [
  ...ISSUE_PROTOCOL_STATE_CHANGING_MESSAGE_TYPES,
  ...ISSUE_PROTOCOL_NON_STATE_MESSAGE_TYPES,
  ...ISSUE_PROTOCOL_SYSTEM_MESSAGE_TYPES,
] as const;
export type IssueProtocolMessageType = (typeof ISSUE_PROTOCOL_MESSAGE_TYPES)[number];

export const ISSUE_PROTOCOL_ARTIFACT_KINDS = [
  "file",
  "diff",
  "commit",
  "test_run",
  "build_run",
  "doc",
  "approval",
  "run",
] as const;
export type IssueProtocolArtifactKind = (typeof ISSUE_PROTOCOL_ARTIFACT_KINDS)[number];

export const ISSUE_PROTOCOL_CLARIFICATION_TYPES = [
  "scope",
  "requirement",
  "implementation",
  "environment",
  "review_feedback",
] as const;
export type IssueProtocolClarificationType = (typeof ISSUE_PROTOCOL_CLARIFICATION_TYPES)[number];

export const ISSUE_PROTOCOL_REQUEST_TARGET_ROLES = [
  "tech_lead",
  "reviewer",
  "human_board",
] as const;
export type IssueProtocolRequestTargetRole = (typeof ISSUE_PROTOCOL_REQUEST_TARGET_ROLES)[number];

export const ISSUE_PROTOCOL_IMPLEMENTATION_MODES = [
  "direct",
  "after_plan",
  "after_change_request",
] as const;
export type IssueProtocolImplementationMode = (typeof ISSUE_PROTOCOL_IMPLEMENTATION_MODES)[number];

export const ISSUE_PROTOCOL_BLOCKER_CODES = [
  "missing_requirement",
  "missing_access",
  "dependency_wait",
  "failing_test_baseline",
  "architecture_conflict",
  "environment_failure",
  "needs_human_decision",
] as const;
export type IssueProtocolBlockerCode = (typeof ISSUE_PROTOCOL_BLOCKER_CODES)[number];

export const ISSUE_PROTOCOL_REVIEW_SEVERITIES = ["low", "medium", "high", "critical"] as const;
export type IssueProtocolReviewSeverity = (typeof ISSUE_PROTOCOL_REVIEW_SEVERITIES)[number];

export const ISSUE_PROTOCOL_DECISION_TYPES = [
  "scope_conflict",
  "risk_acceptance",
  "architecture_choice",
  "priority_tradeoff",
  "policy_override",
] as const;
export type IssueProtocolDecisionType = (typeof ISSUE_PROTOCOL_DECISION_TYPES)[number];

export const ISSUE_PROTOCOL_APPROVAL_MODES = [
  "agent_review",
  "tech_lead_review",
  "human_override",
] as const;
export type IssueProtocolApprovalMode = (typeof ISSUE_PROTOCOL_APPROVAL_MODES)[number];

export const ISSUE_PROTOCOL_CLOSE_REASONS = [
  "completed",
  "superseded",
  "cancelled_by_decision",
  "moved_to_followup",
] as const;
export type IssueProtocolCloseReason = (typeof ISSUE_PROTOCOL_CLOSE_REASONS)[number];

export const ISSUE_PROTOCOL_FINAL_TEST_STATUSES = [
  "passed",
  "passed_with_known_risk",
  "not_applicable",
] as const;
export type IssueProtocolFinalTestStatus = (typeof ISSUE_PROTOCOL_FINAL_TEST_STATUSES)[number];

export const ISSUE_PROTOCOL_MERGE_STATUSES = [
  "merged",
  "merge_not_required",
  "pending_external_merge",
] as const;
export type IssueProtocolMergeStatus = (typeof ISSUE_PROTOCOL_MERGE_STATUSES)[number];

export const ISSUE_MERGE_CANDIDATE_STATES = [
  "pending",
  "merged",
  "rejected",
] as const;
export type IssueMergeCandidateState = (typeof ISSUE_MERGE_CANDIDATE_STATES)[number];

export const ISSUE_PROTOCOL_CANCEL_TYPES = [
  "obsolete",
  "duplicate",
  "invalid_requirement",
  "policy_decision",
  "manual_stop",
] as const;
export type IssueProtocolCancelType = (typeof ISSUE_PROTOCOL_CANCEL_TYPES)[number];

export const ISSUE_PROTOCOL_NOTE_TYPES = [
  "context",
  "observation",
  "decision_log",
  "handoff_note",
] as const;
export type IssueProtocolNoteType = (typeof ISSUE_PROTOCOL_NOTE_TYPES)[number];

export const ISSUE_PROTOCOL_TIMEOUT_CODES = [
  "assignment_ack_timeout",
  "plan_start_timeout",
  "progress_stale",
  "review_start_timeout",
  "review_decision_timeout",
  "changes_ack_timeout",
  "blocked_resolution_timeout",
  "close_timeout",
  "human_decision_timeout",
] as const;
export type IssueProtocolTimeoutCode = (typeof ISSUE_PROTOCOL_TIMEOUT_CODES)[number];

export const ISSUE_PROTOCOL_VIOLATION_CODES = [
  "invalid_state_transition",
  "invalid_predecessor_message",
  "duplicate_active_review",
  "duplicate_ack",
  "unauthorized_sender",
  "payload_schema_mismatch",
  "missing_required_artifact",
  "recipient_role_mismatch",
  "close_without_approval",
  "close_without_verification",
  "request_human_decision_without_reason",
  "stale_review_cycle_action",
  "message_replay_conflict",
] as const;
export type IssueProtocolViolationCode = (typeof ISSUE_PROTOCOL_VIOLATION_CODES)[number];

export const ISSUE_PROTOCOL_VIOLATION_SEVERITIES = ["low", "medium", "high", "critical"] as const;
export type IssueProtocolViolationSeverity = (typeof ISSUE_PROTOCOL_VIOLATION_SEVERITIES)[number];

export const ISSUE_PROTOCOL_VIOLATION_STATUSES = ["open", "resolved", "ignored"] as const;
export type IssueProtocolViolationStatus = (typeof ISSUE_PROTOCOL_VIOLATION_STATUSES)[number];

export const ISSUE_PROTOCOL_REVIEW_OUTCOMES = [
  "changes_requested",
  "approved",
  "human_decision_requested",
  "cancelled",
] as const;
export type IssueProtocolReviewOutcome = (typeof ISSUE_PROTOCOL_REVIEW_OUTCOMES)[number];

export const SETUP_PROGRESS_STATES = [
  "not_started",
  "company_ready",
  "squad_ready",
  "engine_ready",
  "workspace_connected",
  "knowledge_seeded",
  "first_issue_ready",
] as const;
export type SetupProgressState = (typeof SETUP_PROGRESS_STATES)[number];

export const DOCTOR_CHECK_STATUSES = ["pass", "warn", "fail"] as const;
export type DoctorCheckStatus = (typeof DOCTOR_CHECK_STATUSES)[number];

export const DOCTOR_CHECK_CATEGORIES = [
  "auth",
  "engine",
  "database",
  "workspace",
  "retrieval",
  "scheduler",
] as const;
export type DoctorCheckCategory = (typeof DOCTOR_CHECK_CATEGORIES)[number];

export const ROLE_PACK_SCOPE_TYPES = ["company", "squad", "agent"] as const;
export type RolePackScopeType = (typeof ROLE_PACK_SCOPE_TYPES)[number];

export const ROLE_PACK_SET_STATUSES = ["draft", "published", "archived"] as const;
export type RolePackSetStatus = (typeof ROLE_PACK_SET_STATUSES)[number];

export const ROLE_PACK_REVISION_STATUSES = ["draft", "published", "archived"] as const;
export type RolePackRevisionStatus = (typeof ROLE_PACK_REVISION_STATUSES)[number];

export const ROLE_PACK_FILE_NAMES = [
  "ROLE.md",
  "AGENTS.md",
  "HEARTBEAT.md",
  "REVIEW.md",
  "STYLE.md",
  "TOOLS.md",
] as const;
export type RolePackFileName = (typeof ROLE_PACK_FILE_NAMES)[number];

export const ROLE_PACK_ROLE_KEYS = [
  "cto",
  "tech_lead",
  "engineer",
  "reviewer",
  "qa",
  "human_board",
  "pm",
  "custom",
] as const;
export type RolePackRoleKey = (typeof ROLE_PACK_ROLE_KEYS)[number];

export const ROLE_PACK_CUSTOM_BASE_ROLE_KEYS = [
  "cto",
  "tech_lead",
  "engineer",
  "reviewer",
  "qa",
  "human_board",
  "pm",
] as const;
export type RolePackCustomBaseRoleKey = (typeof ROLE_PACK_CUSTOM_BASE_ROLE_KEYS)[number];

export const ROLE_PACK_PRESET_KEYS = [
  "squadrail_default_v1",
  "example_product_squad_v1",
  "example_large_org_v1",
] as const;
export type RolePackPresetKey = (typeof ROLE_PACK_PRESET_KEYS)[number];
