import { pgTable, uuid, text, timestamp, integer, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { issues } from "./issues.js";

export const issueTaskBriefs = pgTable(
  "issue_task_briefs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    issueId: uuid("issue_id").notNull().references(() => issues.id, { onDelete: "cascade" }),
    briefScope: text("brief_scope").notNull(),
    briefVersion: integer("brief_version").notNull(),
    generatedFromMessageSeq: integer("generated_from_message_seq").notNull(),
    workflowState: text("workflow_state").notNull(),
    contentMarkdown: text("content_markdown").notNull(),
    contentJson: jsonb("content_json").$type<Record<string, unknown>>().notNull().default({}),
    retrievalRunId: uuid("retrieval_run_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    issueScopeVersionIdx: uniqueIndex("issue_task_briefs_issue_scope_version_idx").on(
      table.issueId,
      table.briefScope,
      table.briefVersion,
    ),
    issueBriefScopeIdx: index("issue_task_briefs_issue_scope_idx").on(table.companyId, table.issueId, table.briefScope),
  }),
);
