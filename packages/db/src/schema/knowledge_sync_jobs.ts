import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const knowledgeSyncJobs = pgTable(
  "knowledge_sync_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("queued"),
    requestedByActorType: text("requested_by_actor_type").notNull(),
    requestedByActorId: text("requested_by_actor_id").notNull(),
    requestedByAgentId: uuid("requested_by_agent_id"),
    selectedProjectIds: jsonb("selected_project_ids").$type<string[]>().notNull().default([]),
    optionsJson: jsonb("options_json").$type<Record<string, unknown>>().notNull().default({}),
    summaryJson: jsonb("summary_json").$type<Record<string, unknown>>().notNull().default({}),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyUpdatedIdx: index("knowledge_sync_jobs_company_updated_idx").on(table.companyId, table.updatedAt),
    companyStatusIdx: index("knowledge_sync_jobs_company_status_idx").on(table.companyId, table.status, table.updatedAt),
  }),
);
