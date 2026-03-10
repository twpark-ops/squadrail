import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { issues } from "./issues.js";
import { issueProtocolMessages } from "./issue_protocol_messages.js";

export const issueMergeCandidates = pgTable(
  "issue_merge_candidates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    issueId: uuid("issue_id").notNull().references(() => issues.id, { onDelete: "cascade" }),
    closeMessageId: uuid("close_message_id").references(() => issueProtocolMessages.id, { onDelete: "set null" }),
    state: text("state").notNull().default("pending"),
    sourceBranch: text("source_branch"),
    workspacePath: text("workspace_path"),
    headSha: text("head_sha"),
    diffStat: text("diff_stat"),
    targetBaseBranch: text("target_base_branch"),
    mergeCommitSha: text("merge_commit_sha"),
    automationMetadata: jsonb("automation_metadata").$type<Record<string, unknown>>().notNull().default({}),
    operatorActorType: text("operator_actor_type"),
    operatorActorId: text("operator_actor_id"),
    operatorNote: text("operator_note"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    issueUniqueIdx: uniqueIndex("issue_merge_candidates_issue_idx").on(table.issueId),
    companyStateIdx: index("issue_merge_candidates_company_state_idx").on(table.companyId, table.state, table.updatedAt),
  }),
);
