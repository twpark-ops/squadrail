import { pgTable, uuid, text, timestamp, integer, jsonb, index, uniqueIndex, customType } from "drizzle-orm/pg-core";
import { knowledgeDocuments } from "./knowledge_documents.js";
import { companies } from "./companies.js";

const tsvector = customType<{ data: string; driverData: string }>({
  dataType() {
    return "tsvector";
  },
});

export const KNOWLEDGE_EMBEDDING_DIMENSIONS = 1536;

export const knowledgeChunks = pgTable(
  "knowledge_chunks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    documentId: uuid("document_id").notNull().references(() => knowledgeDocuments.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    headingPath: text("heading_path"),
    symbolName: text("symbol_name"),
    tokenCount: integer("token_count").notNull(),
    textContent: text("text_content").notNull(),
    searchTsv: tsvector("search_tsv").notNull(),
    embedding: jsonb("embedding").$type<number[]>().notNull().default([]),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    documentChunkIdx: uniqueIndex("knowledge_chunks_document_chunk_idx").on(table.documentId, table.chunkIndex),
    documentIdx: index("knowledge_chunks_document_idx").on(table.companyId, table.documentId, table.chunkIndex),
    symbolIdx: index("knowledge_chunks_symbol_idx").on(table.companyId, table.symbolName),
  }),
);
