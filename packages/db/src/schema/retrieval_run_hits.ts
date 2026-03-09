import { pgTable, uuid, text, integer, boolean, doublePrecision, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { retrievalRuns } from "./retrieval_runs.js";
import { knowledgeChunks } from "./knowledge_chunks.js";

export const retrievalRunHits = pgTable(
  "retrieval_run_hits",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    retrievalRunId: uuid("retrieval_run_id").notNull().references(() => retrievalRuns.id, { onDelete: "cascade" }),
    chunkId: uuid("chunk_id").notNull().references(() => knowledgeChunks.id, { onDelete: "cascade" }),
    denseScore: doublePrecision("dense_score"),
    sparseScore: doublePrecision("sparse_score"),
    rerankScore: doublePrecision("rerank_score"),
    fusedScore: doublePrecision("fused_score"),
    finalRank: integer("final_rank"),
    selected: boolean("selected").notNull().default(false),
    rationale: text("rationale"),
  },
  (table) => ({
    retrievalRunIdx: index("retrieval_run_hits_run_idx").on(table.retrievalRunId, table.finalRank),
    chunkIdx: index("retrieval_run_hits_chunk_idx").on(table.chunkId),
  }),
);
