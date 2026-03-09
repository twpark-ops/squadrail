import { pgTable, uuid, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { issues } from "./issues.js";
import { issueProtocolMessages } from "./issue_protocol_messages.js";
import { retrievalPolicies } from "./retrieval_policies.js";

export const retrievalRuns = pgTable(
  "retrieval_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    issueId: uuid("issue_id").references(() => issues.id, { onDelete: "set null" }),
    triggeringMessageId: uuid("triggering_message_id").references(() => issueProtocolMessages.id, { onDelete: "set null" }),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id").notNull(),
    actorRole: text("actor_role").notNull(),
    eventType: text("event_type").notNull(),
    workflowState: text("workflow_state").notNull(),
    policyId: uuid("policy_id").references(() => retrievalPolicies.id, { onDelete: "set null" }),
    queryText: text("query_text").notNull(),
    queryDebug: jsonb("query_debug").$type<Record<string, unknown>>().notNull().default({}),
    finalBriefId: uuid("final_brief_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    issueCreatedIdx: index("retrieval_runs_issue_created_idx").on(table.companyId, table.issueId, table.createdAt),
    policyIdx: index("retrieval_runs_policy_idx").on(table.companyId, table.policyId, table.createdAt),
  }),
);
