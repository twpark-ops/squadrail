import { pgTable, uuid, text, timestamp, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const rolePackSets = pgTable(
  "role_pack_sets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    scopeType: text("scope_type").notNull(),
    scopeId: text("scope_id").notNull().default(""),
    roleKey: text("role_key").notNull(),
    status: text("status").notNull().default("draft"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uniqueScopeRoleIdx: uniqueIndex("role_pack_sets_scope_role_idx").on(
      table.companyId,
      table.scopeType,
      table.scopeId,
      table.roleKey,
    ),
    companyScopeIdx: index("role_pack_sets_company_scope_idx").on(table.companyId, table.scopeType, table.roleKey),
  }),
);
