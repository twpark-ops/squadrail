import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { projects } from "./projects.js";

export const retrievalRoleProfiles = pgTable(
  "retrieval_role_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    eventType: text("event_type").notNull(),
    profileJson: jsonb("profile_json").$type<Record<string, unknown>>().notNull().default({}),
    feedbackCount: integer("feedback_count").notNull().default(0),
    lastFeedbackAt: timestamp("last_feedback_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    projectScopeIdx: index("retrieval_role_profiles_project_scope_idx").on(
      table.companyId,
      table.projectId,
      table.role,
      table.eventType,
      table.updatedAt,
    ),
    globalScopeIdx: index("retrieval_role_profiles_global_scope_idx").on(
      table.companyId,
      table.role,
      table.eventType,
      table.updatedAt,
    ),
  }),
);
