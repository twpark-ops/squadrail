import { doublePrecision, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { projects } from "./projects.js";
import { codeSymbols } from "./code_symbols.js";

export const codeSymbolEdges = pgTable(
  "code_symbol_edges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    fromSymbolId: uuid("from_symbol_id").notNull().references(() => codeSymbols.id, { onDelete: "cascade" }),
    toSymbolId: uuid("to_symbol_id").notNull().references(() => codeSymbols.id, { onDelete: "cascade" }),
    edgeType: text("edge_type").notNull(),
    weight: doublePrecision("weight").notNull().default(1),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uniqueEdgeIdx: uniqueIndex("code_symbol_edges_unique_idx").on(
      table.fromSymbolId,
      table.toSymbolId,
      table.edgeType,
    ),
    companyEdgeIdx: index("code_symbol_edges_company_edge_idx").on(table.companyId, table.projectId, table.edgeType),
    fromIdx: index("code_symbol_edges_from_idx").on(table.fromSymbolId),
    toIdx: index("code_symbol_edges_to_idx").on(table.toSymbolId),
  }),
);
