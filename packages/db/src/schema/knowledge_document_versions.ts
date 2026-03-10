import { boolean, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { projects } from "./projects.js";
import { knowledgeDocuments } from "./knowledge_documents.js";

export const knowledgeDocumentVersions = pgTable(
  "knowledge_document_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    documentId: uuid("document_id").notNull().references(() => knowledgeDocuments.id, { onDelete: "cascade" }),
    path: text("path"),
    repoRef: text("repo_ref"),
    branchName: text("branch_name"),
    defaultBranchName: text("default_branch_name"),
    commitSha: text("commit_sha"),
    parentCommitSha: text("parent_commit_sha"),
    isHead: boolean("is_head").notNull().default(true),
    isDefaultBranch: boolean("is_default_branch").notNull().default(false),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    documentIdx: index("knowledge_document_versions_document_idx").on(table.documentId, table.updatedAt),
    branchIdx: index("knowledge_document_versions_branch_idx").on(table.companyId, table.projectId, table.branchName, table.isHead),
    pathIdx: index("knowledge_document_versions_path_idx").on(table.companyId, table.projectId, table.path, table.branchName),
    commitIdx: index("knowledge_document_versions_commit_idx").on(table.companyId, table.commitSha),
    uniqueVersionIdx: uniqueIndex("knowledge_document_versions_unique_idx").on(
      table.companyId,
      table.documentId,
      table.branchName,
      table.commitSha,
    ),
  }),
);
