import { doublePrecision, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { issues } from "./issues.js";
import { projects } from "./projects.js";
import { retrievalRuns } from "./retrieval_runs.js";
import { issueProtocolMessages } from "./issue_protocol_messages.js";

export const retrievalFeedbackEvents = pgTable(
  "retrieval_feedback_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    issueId: uuid("issue_id").references(() => issues.id, { onDelete: "cascade" }),
    retrievalRunId: uuid("retrieval_run_id").notNull().references(() => retrievalRuns.id, { onDelete: "cascade" }),
    feedbackMessageId: uuid("feedback_message_id").references(() => issueProtocolMessages.id, { onDelete: "set null" }),
    actorRole: text("actor_role").notNull(),
    eventType: text("event_type").notNull(),
    feedbackType: text("feedback_type").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    weight: doublePrecision("weight").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    runCreatedIdx: index("retrieval_feedback_events_run_created_idx").on(table.retrievalRunId, table.createdAt),
    issueCreatedIdx: index("retrieval_feedback_events_issue_created_idx").on(table.companyId, table.issueId, table.createdAt),
    scopeCreatedIdx: index("retrieval_feedback_events_scope_created_idx").on(
      table.companyId,
      table.projectId,
      table.actorRole,
      table.eventType,
      table.feedbackType,
      table.targetType,
      table.createdAt,
    ),
  }),
);
