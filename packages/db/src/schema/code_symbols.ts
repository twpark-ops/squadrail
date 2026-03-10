import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, integer } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { projects } from "./projects.js";
import { knowledgeDocuments } from "./knowledge_documents.js";
import { knowledgeChunks } from "./knowledge_chunks.js";

export const codeSymbols = pgTable(
  "code_symbols",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    documentId: uuid("document_id").notNull().references(() => knowledgeDocuments.id, { onDelete: "cascade" }),
    chunkId: uuid("chunk_id").notNull().references(() => knowledgeChunks.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    language: text("language"),
    symbolKey: text("symbol_key").notNull(),
    symbolName: text("symbol_name").notNull(),
    symbolKind: text("symbol_kind").notNull(),
    receiverType: text("receiver_type"),
    startLine: integer("start_line"),
    endLine: integer("end_line"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uniquePathSymbolIdx: uniqueIndex("code_symbols_company_project_path_symbol_idx").on(
      table.companyId,
      table.projectId,
      table.path,
      table.symbolKey,
    ),
    projectSymbolIdx: index("code_symbols_project_symbol_idx").on(table.companyId, table.projectId, table.symbolName),
    chunkIdx: index("code_symbols_chunk_idx").on(table.chunkId),
    documentIdx: index("code_symbols_document_idx").on(table.documentId),
    pathIdx: index("code_symbols_path_idx").on(table.companyId, table.projectId, table.path),
  }),
);
