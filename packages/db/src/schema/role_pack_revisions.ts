import { pgTable, uuid, text, timestamp, integer, uniqueIndex, index } from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { rolePackSets } from "./role_pack_sets.js";

export const rolePackRevisions = pgTable(
  "role_pack_revisions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    rolePackSetId: uuid("role_pack_set_id").notNull().references(() => rolePackSets.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    status: text("status").notNull().default("draft"),
    message: text("message"),
    createdByUserId: text("created_by_user_id"),
    createdByAgentId: uuid("created_by_agent_id").references(() => agents.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (table) => ({
    uniqueVersionIdx: uniqueIndex("role_pack_revisions_version_idx").on(table.rolePackSetId, table.version),
    setStatusIdx: index("role_pack_revisions_set_status_idx").on(table.rolePackSetId, table.status, table.version),
  }),
);
