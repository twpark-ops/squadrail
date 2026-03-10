import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { projects } from "./projects.js";

export const retrievalCacheEntries = pgTable(
  "retrieval_cache_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    stage: text("stage").notNull(),
    cacheKey: text("cache_key").notNull(),
    knowledgeRevision: integer("knowledge_revision").notNull().default(0),
    valueJson: jsonb("value_json").$type<Record<string, unknown>>().notNull().default({}),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    hitCount: integer("hit_count").notNull().default(0),
    lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uniqueStageKeyIdx: uniqueIndex("retrieval_cache_entries_unique_stage_key_idx").on(
      table.companyId,
      table.projectId,
      table.stage,
      table.cacheKey,
      table.knowledgeRevision,
    ),
    expiryIdx: index("retrieval_cache_entries_expiry_idx").on(table.companyId, table.stage, table.expiresAt),
    stageProjectIdx: index("retrieval_cache_entries_stage_project_idx").on(
      table.companyId,
      table.projectId,
      table.stage,
      table.updatedAt,
    ),
  }),
);
