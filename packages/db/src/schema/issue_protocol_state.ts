import { pgTable, uuid, text, timestamp, integer, jsonb, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { issues } from "./issues.js";
import { agents } from "./agents.js";
import { issueProtocolMessages } from "./issue_protocol_messages.js";

export const issueProtocolState = pgTable(
  "issue_protocol_state",
  {
    issueId: uuid("issue_id").primaryKey().references(() => issues.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    workflowState: text("workflow_state").notNull(),
    coarseIssueStatus: text("coarse_issue_status").notNull(),
    techLeadAgentId: uuid("tech_lead_agent_id").references(() => agents.id, { onDelete: "set null" }),
    primaryEngineerAgentId: uuid("primary_engineer_agent_id").references(() => agents.id, { onDelete: "set null" }),
    reviewerAgentId: uuid("reviewer_agent_id").references(() => agents.id, { onDelete: "set null" }),
    currentReviewCycle: integer("current_review_cycle").notNull().default(0),
    lastProtocolMessageId: uuid("last_protocol_message_id").references(() => issueProtocolMessages.id, {
      onDelete: "set null",
    }),
    lastTransitionAt: timestamp("last_transition_at", { withTimezone: true }).notNull().defaultNow(),
    blockedPhase: text("blocked_phase"),
    blockedCode: text("blocked_code"),
    blockedByMessageId: uuid("blocked_by_message_id").references(() => issueProtocolMessages.id, {
      onDelete: "set null",
    }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => ({
    companyStateIdx: index("issue_protocol_state_company_state_idx").on(table.companyId, table.workflowState),
    techLeadIdx: index("issue_protocol_state_tech_lead_idx").on(
      table.companyId,
      table.techLeadAgentId,
      table.workflowState,
    ),
    engineerIdx: index("issue_protocol_state_engineer_idx").on(
      table.companyId,
      table.primaryEngineerAgentId,
      table.workflowState,
    ),
    reviewerIdx: index("issue_protocol_state_reviewer_idx").on(
      table.companyId,
      table.reviewerAgentId,
      table.workflowState,
    ),
  }),
);
