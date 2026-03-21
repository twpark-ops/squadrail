import { pgTable, uuid, text, timestamp, integer, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { issues } from "./issues.js";
import { issueProtocolMessages } from "./issue_protocol_messages.js";

export const issueProtocolDispatchOutbox = pgTable(
  "issue_protocol_dispatch_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    issueId: uuid("issue_id").notNull().references(() => issues.id, { onDelete: "cascade" }),
    protocolMessageId: uuid("protocol_message_id")
      .notNull()
      .references(() => issueProtocolMessages.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    notBefore: timestamp("not_before", { withTimezone: true }).notNull().defaultNow(),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    lastError: text("last_error"),
    dispatchResult: jsonb("dispatch_result").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    protocolMessageIdx: uniqueIndex("issue_protocol_dispatch_outbox_message_idx").on(table.protocolMessageId),
    companyStatusNotBeforeIdx: index("issue_protocol_dispatch_outbox_company_status_not_before_idx").on(
      table.companyId,
      table.status,
      table.notBefore,
    ),
    issueStatusIdx: index("issue_protocol_dispatch_outbox_issue_status_idx").on(table.companyId, table.issueId, table.status),
  }),
);
