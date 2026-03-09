import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { issues } from "./issues.js";

export const issueProtocolThreads = pgTable(
  "issue_protocol_threads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    issueId: uuid("issue_id").notNull().references(() => issues.id, { onDelete: "cascade" }),
    threadType: text("thread_type").notNull().default("primary"),
    title: text("title"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIssueIdx: index("issue_protocol_threads_company_issue_idx").on(table.companyId, table.issueId),
    issueTypeIdx: index("issue_protocol_threads_issue_type_idx").on(table.issueId, table.threadType),
  }),
);
