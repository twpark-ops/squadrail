import { pgTable, uuid, text, timestamp, integer, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const retrievalPolicies = pgTable(
  "retrieval_policies",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    role: text("role").notNull(),
    eventType: text("event_type").notNull(),
    workflowState: text("workflow_state").notNull(),
    topKDense: integer("top_k_dense").notNull().default(20),
    topKSparse: integer("top_k_sparse").notNull().default(20),
    rerankK: integer("rerank_k").notNull().default(20),
    finalK: integer("final_k").notNull().default(8),
    allowedSourceTypes: jsonb("allowed_source_types").$type<string[]>().notNull().default([]),
    allowedAuthorityLevels: jsonb("allowed_authority_levels").$type<string[]>().notNull().default([]),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uniquePolicyIdx: uniqueIndex("retrieval_policies_unique_idx").on(
      table.companyId,
      table.role,
      table.eventType,
      table.workflowState,
    ),
    companyRoleIdx: index("retrieval_policies_company_role_idx").on(table.companyId, table.role, table.workflowState),
  }),
);
