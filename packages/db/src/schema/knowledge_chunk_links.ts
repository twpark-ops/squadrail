import { pgTable, uuid, text, doublePrecision, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { knowledgeChunks } from "./knowledge_chunks.js";

export const knowledgeChunkLinks = pgTable(
  "knowledge_chunk_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    chunkId: uuid("chunk_id").notNull().references(() => knowledgeChunks.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    linkReason: text("link_reason").notNull(),
    weight: doublePrecision("weight").notNull().default(1),
  },
  (table) => ({
    chunkIdx: index("knowledge_chunk_links_chunk_idx").on(table.chunkId),
    entityIdx: index("knowledge_chunk_links_entity_idx").on(table.companyId, table.entityType, table.entityId),
  }),
);
