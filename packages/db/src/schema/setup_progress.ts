import { pgTable, uuid, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { projectWorkspaces } from "./project_workspaces.js";

export const setupProgress = pgTable(
  "setup_progress",
  {
    companyId: uuid("company_id").primaryKey().references(() => companies.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("not_started"),
    selectedEngine: text("selected_engine"),
    selectedWorkspaceId: uuid("selected_workspace_id").references(() => projectWorkspaces.id, {
      onDelete: "set null",
    }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    statusIdx: index("setup_progress_status_idx").on(table.status),
    workspaceIdx: index("setup_progress_workspace_idx").on(table.selectedWorkspaceId),
  }),
);
