import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { projects } from "./projects.js";
import { projectWorkspaces } from "./project_workspaces.js";
import { knowledgeSyncJobs } from "./knowledge_sync_jobs.js";

export const knowledgeSyncProjectRuns = pgTable(
  "knowledge_sync_project_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id").notNull().references(() => knowledgeSyncJobs.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id").references(() => projectWorkspaces.id, { onDelete: "set null" }),
    status: text("status").notNull().default("queued"),
    stepJson: jsonb("step_json").$type<Record<string, unknown>>().notNull().default({}),
    resultJson: jsonb("result_json").$type<Record<string, unknown>>().notNull().default({}),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    jobUpdatedIdx: index("knowledge_sync_project_runs_job_updated_idx").on(table.jobId, table.updatedAt),
    companyProjectIdx: index("knowledge_sync_project_runs_company_project_idx").on(
      table.companyId,
      table.projectId,
      table.updatedAt,
    ),
    uniqueJobProjectIdx: uniqueIndex("knowledge_sync_project_runs_job_project_idx").on(table.jobId, table.projectId),
  }),
);
