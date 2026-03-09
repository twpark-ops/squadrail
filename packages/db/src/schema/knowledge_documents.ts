import { pgTable, uuid, text, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { projects } from "./projects.js";
import { issues } from "./issues.js";
import { issueProtocolMessages } from "./issue_protocol_messages.js";

export const knowledgeDocuments = pgTable(
  "knowledge_documents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    sourceType: text("source_type").notNull(),
    authorityLevel: text("authority_level").notNull(),
    repoUrl: text("repo_url"),
    repoRef: text("repo_ref"),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    issueId: uuid("issue_id").references(() => issues.id, { onDelete: "set null" }),
    messageId: uuid("message_id").references(() => issueProtocolMessages.id, { onDelete: "set null" }),
    path: text("path"),
    title: text("title"),
    language: text("language"),
    contentSha256: text("content_sha256").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    rawContent: text("raw_content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uniqueContentIdx: uniqueIndex("knowledge_documents_unique_content_idx").on(
      table.companyId,
      table.sourceType,
      table.repoUrl,
      table.repoRef,
      table.path,
      table.contentSha256,
    ),
    issueIdx: index("knowledge_documents_issue_idx").on(table.companyId, table.issueId),
    projectIdx: index("knowledge_documents_project_idx").on(table.companyId, table.projectId, table.sourceType),
    sourceIdx: index("knowledge_documents_source_idx").on(table.companyId, table.sourceType, table.authorityLevel),
  }),
);
