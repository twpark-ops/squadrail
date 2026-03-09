import { pgTable, uuid, text, timestamp, integer, index, uniqueIndex } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { issues } from "./issues.js";
import { agents } from "./agents.js";
import { issueProtocolMessages } from "./issue_protocol_messages.js";

export const issueReviewCycles = pgTable(
  "issue_review_cycles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    issueId: uuid("issue_id").notNull().references(() => issues.id, { onDelete: "cascade" }),
    cycleNumber: integer("cycle_number").notNull(),
    reviewerAgentId: uuid("reviewer_agent_id").references(() => agents.id, { onDelete: "set null" }),
    reviewerUserId: text("reviewer_user_id"),
    submittedMessageId: uuid("submitted_message_id").notNull().references(() => issueProtocolMessages.id),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    outcome: text("outcome"),
    outcomeMessageId: uuid("outcome_message_id").references(() => issueProtocolMessages.id, { onDelete: "set null" }),
  },
  (table) => ({
    issueCycleUq: uniqueIndex("issue_review_cycles_issue_cycle_uq").on(table.issueId, table.cycleNumber),
    issueOpenedIdx: index("issue_review_cycles_issue_opened_idx").on(table.issueId, table.openedAt),
    reviewerIdx: index("issue_review_cycles_reviewer_idx").on(table.companyId, table.reviewerAgentId, table.closedAt),
  }),
);
