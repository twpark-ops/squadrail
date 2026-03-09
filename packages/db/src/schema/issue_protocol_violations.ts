import { pgTable, uuid, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { issues } from "./issues.js";
import { issueProtocolThreads } from "./issue_protocol_threads.js";
import { issueProtocolMessages } from "./issue_protocol_messages.js";

export const issueProtocolViolations = pgTable(
  "issue_protocol_violations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    issueId: uuid("issue_id").notNull().references(() => issues.id, { onDelete: "cascade" }),
    threadId: uuid("thread_id").references(() => issueProtocolThreads.id, { onDelete: "cascade" }),
    messageId: uuid("message_id").references(() => issueProtocolMessages.id, { onDelete: "set null" }),
    violationCode: text("violation_code").notNull(),
    severity: text("severity").notNull(),
    detectedByActorType: text("detected_by_actor_type").notNull(),
    detectedByActorId: text("detected_by_actor_id").notNull(),
    status: text("status").notNull().default("open"),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => ({
    issueStatusIdx: index("issue_protocol_violations_issue_status_idx").on(
      table.companyId,
      table.issueId,
      table.status,
    ),
    codeIdx: index("issue_protocol_violations_code_idx").on(table.companyId, table.violationCode, table.createdAt),
    messageIdx: index("issue_protocol_violations_message_idx").on(table.messageId),
  }),
);
