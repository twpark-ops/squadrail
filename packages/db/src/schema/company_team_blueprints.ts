import { pgTable, uuid, text, timestamp, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const companyTeamBlueprints = pgTable(
  "company_team_blueprints",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    label: text("label").notNull(),
    description: text("description"),
    sourceBlueprintKey: text("source_blueprint_key"),
    definition: jsonb("definition").$type<Record<string, unknown>>().notNull(),
    defaultPreviewRequest: jsonb("default_preview_request").$type<Record<string, unknown>>().notNull().default({}),
    sourceMetadata: jsonb("source_metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companySlugIdx: uniqueIndex("company_team_blueprints_company_slug_idx").on(table.companyId, table.slug),
    companyIdx: index("company_team_blueprints_company_idx").on(table.companyId),
  }),
);
