import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { projects } from "./projects.js";

export const projectKnowledgeRevisions = pgTable(
  "project_knowledge_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull().default(0),
    lastHeadSha: text("last_head_sha"),
    lastTreeSignature: text("last_tree_signature"),
    lastImportMode: text("last_import_mode"),
    lastImportedAt: timestamp("last_imported_at", { withTimezone: true }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uniqueProjectIdx: uniqueIndex("project_knowledge_revisions_company_project_idx").on(
      table.companyId,
      table.projectId,
    ),
    revisionIdx: index("project_knowledge_revisions_revision_idx").on(table.companyId, table.revision, table.updatedAt),
  }),
);
