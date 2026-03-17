import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { issues } from "./issues.js";
import { agents } from "./agents.js";

/**
 * Mutable issue documents — key-based (plan, spec, decision-log, etc.)
 * Each issue can have at most one document per key.
 * The body lives inline for simplicity (V1 — no separate body table).
 */
export const issueDocuments = pgTable(
  "issue_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    issueId: uuid("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    title: text("title").notNull(),
    format: text("format").notNull().default("markdown"),
    body: text("body").notNull().default(""),
    revisionNumber: integer("revision_number").notNull().default(1),
    createdByAgentId: uuid("created_by_agent_id").references(() => agents.id, {
      onDelete: "set null",
    }),
    createdByUserId: text("created_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    issueIdx: index("issue_documents_issue_idx").on(table.issueId),
    companyIdx: index("issue_documents_company_idx").on(table.companyId),
    issueKeyUq: unique("issue_documents_issue_key_uq").on(
      table.issueId,
      table.key,
    ),
  }),
);

/**
 * Revision history for issue documents.
 * A new row is created on every upsert so operators can review past versions.
 */
export const issueDocumentRevisions = pgTable(
  "issue_document_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => issueDocuments.id, { onDelete: "cascade" }),
    revisionNumber: integer("revision_number").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    createdByAgentId: uuid("created_by_agent_id").references(() => agents.id, {
      onDelete: "set null",
    }),
    createdByUserId: text("created_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    documentIdx: index("issue_document_revisions_document_idx").on(
      table.documentId,
    ),
    documentRevisionUq: unique("issue_document_revisions_doc_rev_uq").on(
      table.documentId,
      table.revisionNumber,
    ),
  }),
);
